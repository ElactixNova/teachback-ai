// Sam always writes her question, and the right one (T27).
// Writing used to depend on the avatar's LLM choosing to call write_on_board. This module makes it
// deterministic: it listens to what Sam says, writes any maths question she did not write herself,
// and remembers her last question so "can you write it down?" writes that one, not a new one.
// The first half is pure (unit-tested); createQuestionWriter holds the per-session state.
import { MAX_NOTES_PER_SESSION, admitNote, plainMath, type NoteInput, type NoteOutcome } from "./notes.ts";

/** Verbs and openers that make a sentence something the student has to work on. */
const INSTRUCTION =
  /\b(solve|find|work out|calculate|simplify|factori[sz]e|expand|evaluate|differentiate|integrate|rearrange|complete the square|what is|what are|what's|what would|how many|how much)\b/i;
const MATHS_WORDS = /\b(squared|cubed|plus|minus|times|multiplied by|divided by|over|equals?|to the power|square root|root of|percent)\b/gi;

/** Splits text into finished sentences and the unfinished rest. A dot between digits (1.5) does not end a sentence. */
export function completeSentences(text: string): { done: string[]; rest: string } {
  const done: string[] = [];
  let start = 0;
  const end = /[.?!]+(?=\s|$)/g;
  for (let m = end.exec(text); m; m = end.exec(text)) {
    const sentence = text.slice(start, m.index + m[0].length).trim();
    if (sentence) done.push(sentence);
    start = m.index + m[0].length;
  }
  return { done, rest: text.slice(start).trim() };
}

/** True when the sentence holds maths to work with, spoken ("x squared plus five x") or written (x^2 = 4). */
export function hasMaths(sentence: string): boolean {
  const words = sentence.match(MATHS_WORDS)?.length ?? 0;
  return words >= 2 || (words >= 1 && /\d/.test(sentence)) || /[=^]|\\frac|\\sqrt/.test(sentence);
}

/** Something Sam asks the student: any question, or an instruction to work something out. */
export function isQuestion(sentence: string): boolean {
  return /\?\s*$/.test(sentence) || INSTRUCTION.test(sentence);
}

/** A question that belongs on the board: an instruction to work on something with maths in it. */
export function isBoardQuestion(sentence: string): boolean {
  return INSTRUCTION.test(sentence) && hasMaths(sentence);
}

/** The part of the sentence to write: from the instruction on, without the chat around it. */
export function boardText(sentence: string): string {
  const at = sentence.search(INSTRUCTION);
  const core = (at > 0 ? sentence.slice(at) : sentence)
    .replace(/[,\s]*\b(for me|please|on the board|if you can)\b/gi, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([?.!,])/g, "$1")
    .trim();
  return core.charAt(0).toUpperCase() + core.slice(1);
}

/** The maths of a question, normalised, so the same question compares equal however it was worded or typeset. */
export function mathKey(content: string): string {
  const maths = plainMath(content.replace(/\$/g, ""))
    .replace(/[A-Za-z]{2,}/g, "")
    .replace(/[^A-Za-z0-9^+\-*/=()√±.<>×÷]/g, "")
    .replace(/\.+$/, "")
    .toLowerCase();
  // No maths at all (a question in words): compare the words.
  return maths.length >= 3 ? maths : content.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** The student asks to see the question: "can you write it down?", "put that on the board", "say that again". */
export function asksToWrite(studentLine: string): boolean {
  return /\b(write|put|jot|note|pop)\b[^.?!]*\b(down|board|up)\b|\b(say|repeat|show)\b[^.?!]*\b(again|that|it|question)\b|\bwhat was the question\b/i.test(studentLine);
}

/**
 * What a write_on_board call should write. When the student has just asked to see the question, the
 * answer is Sam's last question, whatever the LLM put in the call (it tends to invent a new one).
 */
export function pickQuestion(toolContent: string, lastQuestion: string | null, studentAsked: boolean): { content: string; rewritten: boolean } {
  if (!studentAsked || !lastQuestion || mathKey(toolContent) === mathKey(lastQuestion)) return { content: toolContent, rewritten: false };
  return { content: lastQuestion, rewritten: true };
}

// ---- per-session state -------------------------------------------------------------------------

/** At least this long between two notes going to the board; a note that comes sooner waits, it is not dropped. */
export const NOTE_PACE_MS = 3000;
/** After the student asks to see the question, a write_on_board call this soon after means that question. */
const ASKED_WINDOW_MS = 20_000;
/** A tool call this recently means Sam wrote the question herself: the safety net stays out of it. */
const TOOL_WINDOW_MS = 12_000;

/** POST /api/to-latex for one text: the slower fallback when the local converter cannot typeset it. */
export async function remoteLatex(text: string): Promise<string | null> {
  const res = await fetch("/api/to-latex", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts: [text] }),
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as { texts?: unknown[] } | null;
  const out = body?.texts?.[0];
  return typeof out === "string" && out.includes("$") ? out : null;
}

export interface QuestionWriterOptions {
  /** Spoken maths -> the same text with $...$ maths, or null when it cannot be typeset (the words are written then). */
  toLatex: (spoken: string) => Promise<string | null>;
  now?: () => number;
  /** Runs `fn` after `ms`. Default setTimeout. */
  later?: (fn: () => void, ms: number) => void;
}

export function createQuestionWriter(write: (note: NoteInput) => NoteOutcome, opts: QuestionWriterOptions) {
  const now = opts.now ?? (() => Date.now());
  const later = opts.later ?? ((fn, ms) => void setTimeout(fn, ms));
  const { toLatex } = opts;

  /** Sam's last question, as it should read on the board (resolves once the maths is typeset). */
  let last: Promise<string> | null = null;
  const handled = new Map<string, number>(); // line id -> sentences already looked at
  const sent = new Set<string>(); // maths of every question sent to the board this session
  let count = 0;
  let nextSlot = 0;
  let askedAt = -Infinity;
  let toolAt = -Infinity;

  /** Sends a note to the board, keeping the pace: one that comes too soon waits its turn. */
  const put = (input: NoteInput): NoteOutcome => {
    const verdict = admitNote(input, count);
    if (!verdict.ok) return { status: "refused", reason: verdict.reason };
    // A repeat goes straight to the board, which shows the one that is there (or writes it again if the student removed it).
    const key = mathKey(verdict.note.content);
    if (sent.has(key)) return write(verdict.note);
    sent.add(key);
    count++;
    const wait = Math.max(0, nextSlot - now());
    nextSlot = now() + wait + NOTE_PACE_MS;
    if (wait === 0) return write(verdict.note);
    later(() => write(verdict.note), wait);
    return { status: "queued" };
  };

  const typeset = async (spoken: string): Promise<{ content: string; typeset: boolean }> => {
    const tex = await toLatex(spoken).catch(() => null);
    return { content: (tex ?? spoken).replace(/\$/g, ""), typeset: !!tex };
  };

  return {
    /** Sam's line so far (`final` once the line is complete). Writes any maths question in it that she did not write herself. */
    heard(lineId: string, textSoFar: string, final: boolean) {
      const { done, rest } = completeSentences(textSoFar);
      const sentences = final && rest ? [...done, rest] : done;
      const from = handled.get(lineId) ?? 0;
      if (final) handled.delete(lineId);
      else handled.set(lineId, sentences.length);
      for (const sentence of sentences.slice(from)) {
        if (!isQuestion(sentence)) continue;
        if (!isBoardQuestion(sentence)) {
          last = Promise.resolve(sentence);
          continue;
        }
        const question = typeset(boardText(sentence));
        last = question.then((q) => q.content);
        // She called the tool for this turn: the question is already being written.
        if (now() - toolAt < TOOL_WINDOW_MS) continue;
        void question.then((q) => {
          // Words only (no typesetting available) could not be matched against a tool call made meanwhile.
          if (!q.typeset && now() - toolAt < TOOL_WINDOW_MS) return;
          put({ content: q.content, kind: "math" });
        });
      }
    },

    /** Something the student said or typed. "Can you write it down?" puts Sam's last question on the board at once. */
    studentSaid(text: string) {
      if (!asksToWrite(text)) return;
      askedAt = now();
      void last?.then((content) => put({ content, kind: "math" }));
    },

    /** Sam called write_on_board. Returns what to tell her. */
    async tool(input: NoteInput): Promise<string> {
      const asked = now() - askedAt < ASKED_WINDOW_MS;
      const picked = pickQuestion(input.content, asked && last ? await last : null, asked);
      askedAt = -Infinity;
      toolAt = now();
      const note = picked.rewritten ? { content: picked.content, kind: "math" as const } : input;
      last = Promise.resolve(note.content);
      const out = put(note);
      if (out.status === "refused") return out.reason === "limit" ? `Nothing was written: the board already holds ${MAX_NOTES_PER_SESSION} questions.` : "Nothing was written: the board could not show that text.";
      const what = picked.rewritten ? `Wrote your last question: ${picked.content}` : "Your question is being written on the board";
      if (out.status === "already") return `${picked.rewritten ? "Your last question" : "That question"} is already on the board, ${out.where}; the board now shows it.`;
      if (out.status === "written") return `${what}, ${out.where}.`;
      return `${what}; it appears as soon as the student pauses or the board is back in view.`;
    },
  };
}

export type QuestionWriter = ReturnType<typeof createQuestionWriter>;
