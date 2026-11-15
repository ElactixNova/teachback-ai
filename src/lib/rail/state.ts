// Mark Scheme Rail live state (T11). Pure functions, no runtime imports, so node --test can load them.
//
// The server marks each live snapshot from scratch (attempts 0, parked false). This module turns those
// snapshots into a stable rail: marks never go down during a session, attempts are counted per new
// student quote that still loses marks, and a criterion is parked after its second failed attempt.
import type { CriterionResult, CriterionStatus, GapReport, MarkScheme, TimedLine } from "@/types/session";
import { mathKey } from "../board/questions.ts";
import { spokenToLatex } from "../math/spoken.ts";

/** A criterion is parked once the student has addressed it this many times and still lost marks. */
export const MAX_ATTEMPTS = 2;
/**
 * Prefix of every private context note sent to the avatar (rail changes, board status). Plain words on
 * purpose: the model echoes square-bracket markup into what it says and writes, so there is none.
 */
export const PRIVATE_NOTE = "PRIVATE NOTE (never say or write this):";
/** Without a transcript, a new quote counts as a new attempt only this long after the last one. */
export const ATTEMPT_GAP_S = 20;

export interface RailState {
  /** One result per criterion, in mark-scheme order. */
  results: CriterionResult[];
  /** Per criterion: the attempts counted so far (normalised quote + transcript second). */
  counted: Record<string, { q: string; s: number }[]>;
  /** The criterion the student is explaining right now, or null. */
  activeId: string | null;
}

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const LOST: CriterionStatus[] = ["partial", "missed"];

export function initialRail(scheme: MarkScheme): RailState {
  return {
    results: scheme.criteria.map((c) => ({
      criterionId: c.id,
      status: "not_covered",
      awarded: 0,
      missingSteps: [...c.expected],
      attempts: 0,
      parked: false,
    })),
    counted: {},
    activeId: null,
  };
}

/** "mm:ss" -> seconds (NaN-safe: unknown sorts first). */
export function toSeconds(t: string | undefined): number {
  const m = /^(\d+):(\d{2})$/.exec(t ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : -1;
}

/** Milliseconds since the session start -> "mm:ss". */
export function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Transcript lines with ISO timestamps -> TimedLine[] relative to `startedAt` (ms epoch). */
export function toTimedLines(lines: { speaker: "student" | "avatar"; text: string; at: string }[], startedAt: number): TimedLine[] {
  return lines
    .filter((l) => l.text.trim())
    .map((l) => ({ speaker: l.speaker, text: l.text, t: mmss(Date.parse(l.at) - startedAt) }));
}

function settle(r: CriterionResult, marks: number): CriterionResult {
  if (r.awarded >= marks) return { ...r, awarded: marks, status: "full", parked: false, missingSteps: [] };
  if (r.parked) return { ...r, status: "parked" };
  return r;
}

/**
 * Merge one live analysis into the rail.
 * - Marks only go up: a criterion keeps its best awarded result (and that result's evidence/missing steps).
 * - An attempt is counted when a criterion comes back partial/missed with a new quote, and (after the
 *   first) only if the avatar spoke since the last counted quote: several sentences in one go are one attempt.
 * - After MAX_ATTEMPTS failed attempts the criterion is parked; full marks later un-park it.
 * - activeId: the model's in_progress criterion, else the not-yet-full one with the newest quote.
 */
export function mergeLive(scheme: MarkScheme, state: RailState, incoming: CriterionResult[], transcript?: TimedLine[]): RailState {
  // A retry is a new student quote after the avatar has spoken (it probed, the student tried again).
  const avatarSpokeBetween = (from: number, to: number) =>
    transcript ? transcript.some((l) => l.speaker === "avatar" && toSeconds(l.t) > from && toSeconds(l.t) < to) : to - from >= ATTEMPT_GAP_S;
  const byId = new Map(incoming.map((r) => [r.criterionId, r]));
  const counted: RailState["counted"] = { ...state.counted };

  const results = scheme.criteria.map((c) => {
    const prev = state.results.find((r) => r.criterionId === c.id) ?? initialRail({ ...scheme, criteria: [c] }).results[0];
    const next = byId.get(c.id);
    if (!next || prev.status === "full") return prev;

    let attempts = prev.attempts;
    const quote = next.evidence?.quote ? norm(next.evidence.quote) : "";
    const at = toSeconds(next.evidence?.timestamp);
    const past = counted[c.id] ?? [];
    const last = past[past.length - 1];
    const isNew = quote && !past.some((p) => p.q === quote) && (!last || at < 0 || avatarSpokeBetween(last.s, at));
    if (isNew && LOST.includes(next.status) && next.awarded < c.marks) {
      counted[c.id] = [...past, { q: quote, s: at }];
      attempts += 1;
    }

    const better = next.awarded > prev.awarded || (next.awarded === prev.awarded && prev.status === "not_covered" && next.status !== "not_covered");
    const base: CriterionResult = better
      ? { ...next, awarded: Math.min(next.awarded, c.marks), said: next.said ?? prev.said }
      : { ...prev, boardObservation: next.boardObservation ?? prev.boardObservation, boardUnfinished: next.boardUnfinished ?? prev.boardUnfinished, said: next.said ?? prev.said };
    // Live "in_progress" is not a stored status: it is reported through activeId.
    if (base.status === "in_progress") base.status = base.awarded > 0 ? "partial" : prev.status === "not_covered" ? "not_covered" : prev.status;

    return settle({ ...base, attempts, parked: prev.parked || attempts >= MAX_ATTEMPTS }, c.marks);
  });

  const open = (id: string) => {
    const r = results.find((x) => x.criterionId === id);
    return !!r && r.status !== "full" && r.status !== "parked";
  };
  const modelActive = incoming.find((r) => r.status === "in_progress" && open(r.criterionId))?.criterionId;
  const newest = incoming
    .filter((r) => r.evidence && open(r.criterionId))
    .sort((a, b) => toSeconds(b.evidence?.timestamp) - toSeconds(a.evidence?.timestamp))[0]?.criterionId;

  return { results, counted, activeId: modelActive ?? newest ?? (state.activeId && open(state.activeId) ? state.activeId : null) };
}

/** Find a criterion by id or by (part of) its title, as the avatar may say either. */
export function findCriterion(scheme: MarkScheme, ref: string): MarkScheme["criteria"][number] | undefined {
  const q = norm(ref);
  if (!q) return undefined;
  return (
    scheme.criteria.find((c) => c.id.toLowerCase() === q) ??
    scheme.criteria.find((c) => norm(c.title) === q) ??
    scheme.criteria.find((c) => norm(c.title).includes(q) || q.includes(norm(c.title)))
  );
}

export function railScore(scheme: MarkScheme, results: CriterionResult[]): { awarded: number; total: number } {
  return { awarded: results.reduce((n, r) => n + r.awarded, 0), total: scheme.totalMarks };
}

/**
 * Combine the final report with the live rail: per criterion keep the better mark (the rail never
 * shows marks the end screen then takes away), carry attempts, and keep parked criteria parked.
 * Totals and the primary gap are recomputed to match.
 */
export function finalizeReport(scheme: MarkScheme, report: GapReport, live: CriterionResult[]): GapReport {
  const results = scheme.criteria.map((c) => {
    const fin = report.results.find((r) => r.criterionId === c.id);
    const lv = live.find((r) => r.criterionId === c.id);
    const best = lv && (!fin || lv.awarded > fin.awarded) ? lv : (fin ?? lv)!;
    const parked = !!lv?.parked && best.awarded < c.marks;
    const status: CriterionStatus =
      best.awarded >= c.marks ? "full" : parked ? "parked" : best.status === "in_progress" ? (best.awarded > 0 ? "partial" : "missed") : best.status;
    // The final marking reads the whole transcript, so its summary of what the student said wins.
    const said = fin?.said ?? lv?.said;
    return { ...best, status, parked, attempts: lv?.attempts ?? 0, ...(said ? { said } : {}) };
  });

  // Same rule as grade.ts primaryGap (kept local so this file stays free of server imports): the attempted
  // criterion that lost the most marks; never-covered ones only count when nothing was attempted.
  const biggest = (attemptedOnly: boolean) => {
    let best: string | null = null;
    let worst = 0;
    for (const c of scheme.criteria) {
      const r = results.find((x) => x.criterionId === c.id);
      if (attemptedOnly && (!r || r.status === "not_covered")) continue;
      const lost = c.marks - (r?.awarded ?? 0);
      if (lost > worst) [best, worst] = [c.id, lost];
    }
    return best;
  };
  const primary = biggest(true) ?? biggest(false);
  const keepPrimary = report.primaryGapId && results.find((r) => r.criterionId === report.primaryGapId)?.status !== "full";
  return {
    ...report,
    results,
    awarded: results.reduce((n, r) => n + r.awarded, 0),
    total: scheme.totalMarks,
    primaryGapId: keepPrimary ? report.primaryGapId : primary,
  };
}

/** The criterion being explained right now (status "in_progress"), or null. */
export function liveFocusId(results: CriterionResult[]): string | null {
  return results.find((r) => r.status === "in_progress")?.criterionId ?? null;
}

const MAX_BOARD_CHARS = 600;

/**
 * What the examiner saw on the whiteboard, so the avatar knows what is already drawn or written.
 * Empty string when the board has been empty. Truncated: it goes into the avatar's context.
 */
export function boardNote(scheme: MarkScheme, results: CriterionResult[]): string {
  const title = (id: string) => scheme.criteria.find((c) => c.id === id)?.title ?? id;
  const seen = results
    .filter((r) => r.boardObservation?.trim())
    .map((r) => `${title(r.criterionId)}: ${r.boardObservation!.trim()}`)
    .join(" | ");
  if (!seen) return "";
  const unfinished = results.some((r) => r.boardUnfinished)
    ? " Board status: UNFINISHED (cut off or midway, so they are probably still working it out)."
    : "";
  return `On their whiteboard (you can see it through the examiner, so never ask them to say aloud what is already written or drawn there): ${seen.slice(0, MAX_BOARD_CHARS)}.${unfinished}`;
}

/** Sam's most recent questions (sentences ending in "?") and what the student said since, so she never repeats herself. */
// ---- What Sam has asked, and what she asks next (T32) -------------------------------------------
// Sam answers about a second after the student stops, so she cannot wait for marking or a tool call
// before every question. Instead the bridge hands her the next question BEFORE she needs it: after
// each question she asks, a private note names the one new question that may follow. What counts as
// "already asked" is read from her own lines, so it is instant and does not depend on the examiner.

const FILLER = new Set(
  "a an and are as at be been both but by can could did do does each either else ever for from get give had has have her here how if in into is it its just let like may me might more most much must my no nor not now of off on once one only or other our out over own please same say see shall she should show so some such tell than that the their them then there these they thing this those to too up us use very was we were what when where which while who why will with would you your about above after again also am any before being below between during further having he him his i im ive me myself than through under until whom yours write draw sketch board label explain look help call something way actually really exactly".split(" "),
);
// Numbers and spoken maths are left out: "x squared plus six x minus seven" and "$x^2 + 6x - 7$" share no words.
const MATHS = new Set("zero one two three four five six seven eight nine ten eleven twelve plus minus times equals equal squared cubed over divided multiplied power root".split(" "));

/** The meaningful words of a question, crudely stemmed (first five letters), without filler, numbers or single letters. */
function keyWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().replace(/\$[^$]*\$/g, " ").match(/[a-z]+/g) ?? []) {
    if (w.length < 3 || FILLER.has(w) || MATHS.has(w)) continue;
    out.add(w.slice(0, 5));
  }
  return out;
}

/** The maths in a line, normalised, whether it was spoken ("x squared minus four x") or typeset ($x^2 - 4x$); "" when there is none. */
function mathsOf(text: string): string {
  const key = mathKey(spokenToLatex(text) ?? text);
  return /[\d=^+\-*/×÷√]/.test(key) && !/\s/.test(key) && key.length >= 4 ? key : "";
}

/** How much two questions are about the same thing: shared key words over the smaller set (0..1). */
function alike(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared >= 2 || Math.min(a.size, b.size) === 1 ? shared / Math.min(a.size, b.size) : 0;
}

/**
 * A probe cut down to the first thing it asks for. Probes like "Could you write the quadratic formula and
 * tell me when you would use it?" made Sam ask two things in one turn; the second part is a follow-up.
 */
export function singleAsk(probe: string): string {
  const first = probe.match(/^[^?]*\?/)?.[0] ?? probe;
  const cut = first.replace(/,?\s+and\s+(?:then\s+)?(?:tell|explain|say|find|state|label|describe|give|show|mark|why|what|when|how|where|which)\b[^?]*/i, "");
  return cut.trim();
}

/** True when a line of Sam's asks the student for something (a question, or "write/solve/sketch ..."). */
const asks = (line: string) => /\?|\b(?:write|draw|sketch|solve|show me|tell me|work out|explain)\b/i.test(line);

/**
 * How many of Sam's turns asked about each criterion, read from her own lines. A question counts for
 * every criterion whose probe it resembles (probes overlap: "when would you use the formula" belongs to
 * two points), and a question that resembles none is a follow-up on the point she asked about last.
 */
export function askedCounts(scheme: MarkScheme, transcript: TimedLine[] = []): { counts: Record<string, number>; current: string | null } {
  const probes = scheme.criteria.map((c) => ({ id: c.id, words: keyWords(`${c.probe ?? ""} ${c.title}`), maths: mathsOf(c.probe ?? "") }));
  const counts: Record<string, number> = {};
  let current: string | null = null;
  for (const line of transcript) {
    if (line.speaker !== "avatar" || !asks(line.text)) continue;
    const words = keyWords(line.text);
    const maths = mathsOf(line.text);
    // The same expression is the same question ("How would you handle x squared minus four x equals zero?" has few words to go on).
    const sameMaths = (m: string) => !!m && !!maths && (m === maths || m.includes(maths) || maths.includes(m));
    const scored = probes.map((p) => ({ id: p.id, score: sameMaths(p.maths) ? 1 : alike(words, p.words) })).filter((x) => x.score >= 0.5);
    if (scored.length === 0) {
      if (current) counts[current] = (counts[current] ?? 0) + 1;
      continue;
    }
    for (const x of scored) counts[x.id] = (counts[x.id] ?? 0) + 1;
    current = scored.sort((a, b) => b.score - a.score)[0].id;
  }
  return { counts, current };
}

export interface NextPlan {
  /** Points Sam has asked about at least once. */
  asked: string[];
  /** The point her last question was about. */
  current: string | null;
  /** One follow-up she may still ask on the current point (it lost marks and was asked only once). */
  followUp: { id: string; missing: string } | null;
  /** The next NEW point: never asked, not already fully explained or parked. Null when every point has been asked. */
  next: MarkScheme["criteria"][number] | null;
  /** Points not asked yet (including `next`). */
  left: number;
}

/** What Sam may ask after her current question: at most one follow-up on it, then one new point. Never an old one. */
export function planNext(scheme: MarkScheme, results: CriterionResult[], transcript: TimedLine[] = [], told: Iterable<string> = []): NextPlan {
  const { counts, current } = askedCounts(scheme, transcript);
  // Points the plan told her to ask and she then asked something: counted even if she reworded it past recognition (T33).
  for (const id of told) counts[id] = Math.max(counts[id] ?? 0, 1);
  const result = (id: string) => results.find((r) => r.criterionId === id);
  const settled = (id: string) => ["full", "parked"].includes(result(id)?.status ?? "");
  const fresh = scheme.criteria.filter((c) => !counts[c.id] && !settled(c.id));
  const cur = current ? result(current) : undefined;
  const followUp =
    cur && (counts[cur.criterionId] ?? 0) < MAX_ATTEMPTS && ["partial", "missed"].includes(cur.status) && cur.missingSteps.length > 0
      ? { id: cur.criterionId, missing: cur.missingSteps[0] }
      : null;
  return { asked: scheme.criteria.filter((c) => counts[c.id]).map((c) => c.id), current, followUp, next: fresh[0] ?? null, left: fresh.length };
}

/** How a point is put to the student: one ask, and for a board task the board is named inside the same sentence. */
export function askLine(c: { title: string; probe?: string; ask?: "say" | "write" | "draw" }): string {
  const q = singleAsk(c.probe ?? `Can you explain ${c.title}?`);
  return c.ask === "write" || c.ask === "draw" ? `"${q}" (a board task: ask them to ${c.ask} it on the board inside that one sentence, never as a second sentence)` : `"${q}"`;
}

/**
 * The private note Sam gets right after she asks a question: what is off limits, and the single new
 * question that may follow. Facts and one instruction, short enough to be followed.
 */
export function planNote(scheme: MarkScheme, results: CriterionResult[], transcript: TimedLine[] = [], told: Iterable<string> = []): string {
  const plan = planNext(scheme, results, transcript, told);
  const title = (id: string) => scheme.criteria.find((c) => c.id === id)?.title ?? id;
  const cur = scheme.criteria.find((c) => c.id === plan.current);
  // Pace (T33): a student does not quiz after every answer. After a turn where she asked, her next turn is a
  // reaction (say back one thing they said, invite them to go on); only after a reaction does she ask again.
  const lastSam = [...transcript].reverse().find((l) => l.speaker === "avatar")?.text ?? "";
  const react = lastSam.includes("?");
  return [
    PRIVATE_NOTE,
    react
      ? "PACE: your next reply must have NO question mark. Reflect ONE thing they just said in under twelve words, in fresh wording (not \"Okay, so you said\"), the way a classmate would, and stop. Do not recite their whole answer. If something confuses you, say which part instead."
      : "PACE: your next reply may include ONE question, after a short reaction in fresh wording. If they said what they will cover next, or invited you to choose, follow their lead.",
    plan.asked.length ? `Already asked, never ask about these again in any wording: ${plan.asked.map(title).join("; ")}.` : "",
    cur && (cur.ask === "write" || cur.ask === "draw")
      ? "Your current question is a board task: when they say they are done, call capture_whiteboard before you say anything, then mention one specific thing you can see in what they wrote."
      : "",
    !react && plan.followUp
      ? `If their answer leaves it out, you may ask ONE follow-up on "${title(plan.followUp.id)}" about this, without stating it: "${plan.followUp.missing}".`
      : cur
      ? `Do not ask a second question about "${cur.title}".`
      : "",
    react
      ? ""
      : plan.next
      ? `Your next new question, once they have answered: ${askLine(plan.next)}. Ask only that, unless they have already explained it in their own words earlier: then ask about one specific detail of what they said instead.`
      : "Every point has now been asked. After their answer, call get_rail_status: it lists any point to go back over once.",
    plan.left > 0 ? `${plan.left} point${plan.left === 1 ? " has" : "s have"} not been asked yet, so do not offer or mention their results.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function askedNote(transcript: TimedLine[] = []): string {
  const asked: string[] = [];
  for (const l of transcript.filter((x) => x.speaker !== "student").slice(-8)) {
    for (const s of l.text.match(/[^.?!]*\?/g) ?? []) if (s.trim().length > 8) asked.push(s.trim());
  }
  const lastSam = transcript.map((l) => l.speaker).lastIndexOf("avatar");
  const answered = transcript.slice(lastSam + 1).filter((l) => l.speaker === "student").map((l) => l.text.trim()).join(" ");
  if (!asked.length) return "";
  return [
    `Questions you already asked (never ask these again, in any wording): ${asked.slice(-5).map((q) => `"${q.slice(0, 140)}"`).join("; ")}.`,
    answered ? `Since your last turn they said: "${answered.slice(0, 300)}". Treat that as their answer to your last question: react to it, do not ask it again.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** What the avatar gets back from get_rail_status: short, factual, no answers. */
export function railStatusText(scheme: MarkScheme, results: CriterionResult[], focusIds: string[] = [], transcript: TimedLine[] = []): string {
  const { awarded, total } = railScore(scheme, results);
  const title = (id: string) => scheme.criteria.find((c) => c.id === id)?.title ?? id;
  const pick = (s: CriterionStatus[]) => results.filter((r) => s.includes(r.status)).map((r) => title(r.criterionId));
  const list = (xs: string[]) => (xs.length ? xs.join("; ") : "none");
  const active = liveFocusId(results);
  const open = (r: CriterionResult) => r.status !== "full" && r.status !== "parked";
  const focus = focusIds.map((id) => results.find((r) => r.criterionId === id)).filter((r): r is CriterionResult => !!r && open(r));
  // Always name one point to ask about while any is open (never leave Sam without a next question).
  // Never back to a point she has already asked about twice, and new points before asked ones (T32).
  const { counts, current } = askedCounts(scheme, transcript);
  const times = (r: CriterionResult) => counts[r.criterionId] ?? 0;
  const nextUp =
    focus[0] ??
    results.find((r) => r.status === "not_covered" && times(r) === 0) ??
    results.find((r) => open(r) && r.status !== "in_progress" && times(r) < MAX_ATTEMPTS) ??
    results.find((r) => open(r) && times(r) < MAX_ATTEMPTS);
  const board = boardNote(scheme, results);
  // Before moving on, probe the point they just explained if part of it is still missing (the active
  // point first, else any other partly explained one that has not used its two tries).
  // "missed" counts too: a student who knows the point but forgot to say it can still earn it.
  const partly = (r: CriterionResult) => open(r) && r.missingSteps.length > 0 && r.attempts < 2 && times(r) < MAX_ATTEMPTS && r.status !== "not_covered";
  // Once every point has been touched, sweep back over the ones that still lost marks.
  const sweep = !focus.length && !results.some((r) => r.status === "not_covered") ? results.filter(partly) : [];
  // Once Sam has asked questions, only the point she asked about LAST gets a follow-up: chasing an older
  // point's missing step made her ask again what the student had already done (T32). Older points wait for the sweep.
  const followUp = current
    ? results.find((r) => r.criterionId === current && partly(r))
    : (results.find((r) => r.criterionId === active && partly(r)) ?? results.find(partly));
  const next = nextUp ? scheme.criteria.find((c) => c.id === nextUp.criterionId) : undefined;
  const nextAsk = next?.probe ? ` Ask it in your own words, keeping its specifics, as ONE sentence: ${askLine(next)}.` : "";
  return [
    `Rail: ${awarded}/${total} marks so far.`,
    askedNote(transcript),
    board,
    `Fully explained: ${list(pick(["full"]))}.`,
    `Partly explained: ${list(pick(["partial", "missed"]))}.`,
    `Parked (do not ask about these again): ${list(pick(["parked"]))}.`,
    `Not covered yet: ${list(pick(["not_covered"]))}.`,
    active ? `They are explaining now: ${title(active)}.` : "",
    focus.length ? `They chose to work on: ${focus.map((r) => title(r.criterionId)).join("; ")}.` : "",
    sweep.length
      ? `SWEEP: every point has been touched, but these still lost marks, and they may know it and have just forgotten to say it: ${sweep
          .map((r) => `"${title(r.criterionId)}" (not yet said: "${r.missingSteps[0]}")`)
          .join("; ")}. Take ONE of them per turn, in this order: one short curious nudge towards the missing part, never stating it. Nudge each point only once: skip the ones you have already nudged since this sweep began, and when none are left suggest they say they are finished so you can open their report.`
      : followUp
      ? `FIRST, before moving on, follow up on "${title(followUp.criterionId)}": they have not yet made this point: "${followUp.missingSteps[0]}". Ask ONE short curious question that leads them towards it, and nothing else this turn. Never state it. If they cannot, move on.`
      : "",
    sweep.length
      ? ""
      : nextUp && nextUp.criterionId === active
      ? `Next question: keep going on "${title(nextUp.criterionId)}" with one curious question about what they have not explained yet.${nextAsk} Never give the answer.`
      : nextUp
      ? `Next question: ${followUp ? "only in a LATER turn, once that follow-up is answered or given up, " : "when they have finished their answer, "}move to "${title(nextUp.criterionId)}".${nextAsk} Never give the answer.`
      : "Everything has been addressed. Suggest they say they are finished so you can open their report.",
    "Start your reply by reacting in a few words to what they just said.",
  ]
    .filter(Boolean)
    .join(" ");
}

const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? []);

/**
 * True when the board observation appeared for the first time or changed substantially. The examiner
 * rewords the same drawing on nearly every live tick, so a plain "!==" would fire a note each time and
 * make the avatar chatty; get_rail_status always carries the latest observation anyway.
 */
function boardMoved(prev: string | undefined, next: string | undefined): boolean {
  if (!next?.trim()) return false;
  if (!prev?.trim()) return true;
  const a = words(prev);
  const b = words(next);
  const shared = [...a].filter((w) => b.has(w)).length;
  return shared / Math.max(a.size, b.size, 1) < 0.5;
}

/**
 * A private context note for the avatar (Anam addContext) when the rail changed in a way that should
 * steer it: a criterion got full marks or was parked. Null when nothing worth saying changed.
 */
export function railChangeNote(scheme: MarkScheme, before: CriterionResult[], after: CriterionResult[], focusIds: string[] = []): string | null {
  const title = (id: string) => scheme.criteria.find((c) => c.id === id)?.title ?? id;
  const was = (id: string) => before.find((r) => r.criterionId === id)?.status;
  const nowFull = after.filter((r) => r.status === "full" && was(r.criterionId) !== "full").map((r) => title(r.criterionId));
  const nowParked = after.filter((r) => r.status === "parked" && was(r.criterionId) !== "parked").map((r) => title(r.criterionId));
  const unfinishedFlipped = after.some((r) => r.boardUnfinished !== undefined && r.boardUnfinished !== before.find((b) => b.criterionId === r.criterionId)?.boardUnfinished);
  const boardChanged = unfinishedFlipped || after.some((r) => boardMoved(before.find((b) => b.criterionId === r.criterionId)?.boardObservation, r.boardObservation));
  if (!nowFull.length && !nowParked.length && !boardChanged) return null;
  return [
    PRIVATE_NOTE,
    nowFull.length ? `Now fully explained: ${nowFull.join("; ")}. Do not ask about these again.` : "",
    nowParked.length
      ? `Parked: ${nowParked.join("; ")}. Do not ask about these again; if it fits, say warmly that you will park it for the report and move on.`
      : "",
    railStatusText(scheme, after, focusIds),
  ]
    .filter(Boolean)
    .join(" ");
}

// ---- Results-in, results-out API for the workspace (T10 owns the state) ------------------------

/** All criteria not_covered, attempts 0. */
export function emptyResults(scheme: MarkScheme): CriterionResult[] {
  return initialRail(scheme).results;
}

/** The rail with the live focus shown as status "in_progress" (what the UI renders). */
function present(state: RailState): CriterionResult[] {
  return state.results.map((r) =>
    r.criterionId === state.activeId && r.status !== "full" && r.status !== "parked" ? { ...r, status: "in_progress" as const } : r,
  );
}

// Per scheme: the internal state behind the last results we returned (attempt history, real statuses).
const memory = new WeakMap<MarkScheme, { state: RailState; shown: CriterionResult[] }>();

const key = (r: CriterionResult) => `${r.criterionId}|${r.status}|${r.awarded}|${r.parked}|${r.attempts}`;

/** Rebuild the internal state from results the UI may have changed (manual park, reset). */
function fromResults(scheme: MarkScheme, results: CriterionResult[], old?: RailState): RailState {
  const merged = emptyResults(scheme).map((b): CriterionResult => {
    const r = results.find((x) => x.criterionId === b.criterionId);
    if (!r) return b;
    if (r.status !== "in_progress") return r;
    const was = old?.results.find((x) => x.criterionId === b.criterionId);
    return { ...r, status: was ? was.status : r.awarded > 0 ? "partial" : "not_covered" };
  });
  const fresh = results.every((r) => r.status === "not_covered" && r.attempts === 0);
  return { results: merged, counted: fresh ? {} : (old?.counted ?? {}), activeId: liveFocusId(results) };
}

/**
 * Merge one live analysis (POST /api/analyze mode "live") into the rail results.
 * Marks never go down; attempts count a retry after the avatar spoke; a criterion is parked after its
 * second failed attempt (and un-parked if it later earns full marks); the criterion being explained
 * now is returned as "in_progress" (the model's pick, else the open one with the newest student quote).
 */
export function mergeLiveResults(scheme: MarkScheme, prev: CriterionResult[], incoming: CriterionResult[], transcript: TimedLine[]): CriterionResult[] {
  const mem = memory.get(scheme);
  const unchanged = !!mem && mem.shown.length === prev.length && mem.shown.every((r, i) => key(r) === key(prev[i]));
  const state = unchanged ? mem!.state : fromResults(scheme, prev, mem?.state);
  const next = mergeLive(scheme, state, incoming, transcript);
  const shown = present(next);
  memory.set(scheme, { state: next, shown });
  return shown;
}

/** Park a criterion in a results array (the UI's park button or the avatar's park_criterion). Full ones stay full. */
export function parkResult(results: CriterionResult[], criterionId: string): CriterionResult[] {
  return results.map((r) =>
    r.criterionId === criterionId && r.status !== "full" ? { ...r, parked: true, status: "parked" as const, attempts: Math.max(r.attempts, 1) } : r,
  );
}
