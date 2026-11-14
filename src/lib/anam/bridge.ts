// Browser-side Anam integration for the Mark Scheme Rail workspace (T2, T11).
// Implements AvatarBridge from src/components/workspace/types.ts: the persona knows the mark-scheme
// titles (never the answers), its client tools read and steer the live rail through WorkspaceActions,
// and rail changes (full marks, parked) reach it as private context through Anam addContext.
import type { AnamClient } from "@anam-ai/js-sdk";
import type { CriterionResult, GapReport, MarkScheme } from "@/types/session";
import type { AvatarBridge, AvatarSession, WorkspaceActions } from "@/components/workspace/types";
import { boardNote, findCriterion, railChangeNote, railStatusText } from "@/lib/rail/state";
import type { PersonaContext } from "./persona";
import { admitNote, type NoteRefusal } from "@/lib/board/notes";
import { connectAnam } from "./connect";
import { TOOL } from "./tools";

const arg = (p: { arguments?: Record<string, unknown> }, key: string) =>
  typeof p.arguments?.[key] === "string" ? (p.arguments[key] as string).trim() : "";

/** What the avatar is told about the final marking. Short, so it summarises instead of reading out. */
export function summariseFinal(scheme: MarkScheme | null, r: GapReport): string {
  const title = (id: string) => scheme?.criteria.find((c) => c.id === id)?.title ?? id;
  const primary = r.results.find((x) => x.criterionId === r.primaryGapId);
  const full = r.results.filter((x) => x.status === "full").map((x) => title(x.criterionId));
  return [
    `Their marked results are on screen now: ${r.awarded} out of ${r.total} marks.`,
    full.length ? `Fully explained: ${full.join("; ")}.` : "",
    primary
      ? `Main point to work on: "${title(primary.criterionId)}"${
          primary.missingSteps.length ? `; they missed: ${primary.missingSteps.slice(0, 3).join("; ")}` : ""
        }.`
      : "Nothing lost marks.",
    "Tell them their mark and that one point in two short sentences, warmly, as their student. Do not read this out or add corrections of your own.",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Why a note was not written. Plain facts: the avatar must be able to carry on without reading them out. */
const NOTE_REFUSED: Record<NoteRefusal, string> = {
  empty: "Nothing was written: the note had no content.",
  too_long: "Nothing was written: the note was longer than 200 characters. A shorter version of the question fits.",
  unsafe: "Nothing was written: the note contained a command the board cannot show.",
  duplicate: "Nothing new was written: the same question is already on the board.",
  too_soon: "Nothing was written: another note went on the board a few seconds ago.",
  limit: "Nothing was written: the board already holds the six notes allowed in one session.",
};

/** A check that finished this recently is reused instead of marking again. */
const RECENT_CHECK_MS = 20_000;

function registerTools(client: AnamClient, actions: WorkspaceActions): () => void {
  // The LLM sometimes calls the check twice in a row ("I'm finished" ... "check me").
  // Share one in-flight final marking and reuse a fresh result, so we never pay twice.
  let inflight: Promise<GapReport | null> | null = null;
  let lastCheckAt = 0;
  const check = (): Promise<GapReport | null> => {
    const fresh = actions.getReport();
    if (fresh && Date.now() - lastCheckAt < RECENT_CHECK_MS) {
      actions.openGapReport();
      return Promise.resolve(fresh);
    }
    inflight ??= actions.checkExplanation().finally(() => {
      lastCheckAt = Date.now();
      inflight = null;
    });
    return inflight;
  };

  // Notes written in this session, for the pace, repeat and session limits.
  const written: { content: string; at: number }[] = [];

  const unregister = [
    client.registerToolCallHandler(TOOL.writeOnBoard, {
      onStart: async (p) => {
        const verdict = admitNote({ content: arg(p, "content"), kind: arg(p, "kind") === "text" ? "text" : "math", label: arg(p, "label") || undefined }, written, Date.now());
        if (!verdict.ok) return NOTE_REFUSED[verdict.reason];
        written.push({ content: verdict.note.content, at: Date.now() });
        const out = actions.writeOnBoard(verdict.note);
        if (out.status === "written") return `The question is now on the board, ${out.where}, where the student can read it.`;
        if (out.status === "queued") return "The student is drawing right now, so the question is queued and will appear on the board when they pause.";
        return "The board is not visible right now (the student is looking at their results); the question will appear when they return to the board.";
      },
    }),
    client.registerToolCallHandler(TOOL.getRailStatus, {
      onStart: async () => {
        const { markScheme, results, focusIds } = actions.getRail();
        if (!markScheme) return "There is no mark scheme yet. Ask the student what they want to teach you.";
        return railStatusText(markScheme, results, focusIds);
      },
    }),
    client.registerToolCallHandler(TOOL.parkCriterion, {
      onStart: async (p) => {
        const { markScheme } = actions.getRail();
        const ref = arg(p, "criterion");
        const c = markScheme && ref ? findCriterion(markScheme, ref) : undefined;
        if (!c) return `There is no point called "${ref}" on the mark scheme. Carry on without parking.`;
        actions.parkCriterion(c.id);
        return `Parked "${c.title}". It will be in their report. Do not ask about it again; move on to another part of the topic.`;
      },
    }),
    client.registerToolCallHandler(TOOL.openGapReport, {
      onStart: async (p) => {
        const last = actions.getReport();
        if (p.arguments?.reuse_last === true && last) {
          actions.openGapReport();
          return summariseFinal(actions.getRail().markScheme, last);
        }
        const report = await check();
        if (!report) return "There is nothing to mark yet: they have not explained or drawn anything, or marking failed. Ask them to explain a bit more first.";
        return summariseFinal(actions.getRail().markScheme, report);
      },
    }),
    client.registerToolCallHandler(TOOL.captureWhiteboard, {
      onStart: async () => {
        const snap = actions.captureWhiteboard();
        if (!snap) return "The whiteboard is empty. Ask them to sketch what they mean.";
        const { markScheme, results } = actions.getRail();
        const seen = markScheme ? boardNote(markScheme, results) : "";
        return seen
          ? `They have drawn on the whiteboard. ${seen} Treat it as part of their answer.`
          : "They have drawn on the whiteboard and the examiner is reading it now (within about 20 seconds). Acknowledge it in a few words, never ask them to repeat it aloud, and carry on.";
      },
    }),
    client.registerToolCallHandler(TOOL.generateVisualExplainer, {
      onStart: async (p) => {
        const { markScheme } = actions.getRail();
        const ref = arg(p, "criterion");
        const c = markScheme && ref ? findCriterion(markScheme, ref) : undefined;
        if (!actions.getReport() && !c) {
          return "Pictures come with their results. Encourage them to keep explaining, or to say they are finished.";
        }
        // Fire and forget: fal takes ~20 s, longer than the tool should block the conversation.
        void actions.generateVisualExplainer(c?.id).catch(() => null);
        return `A labelled diagram${c ? ` for "${c.title}"` : " for their main gap"} is being drawn and will appear on screen in about 20 seconds. Keep talking meanwhile.`;
      },
    }),
  ];
  return () => unregister.forEach((u) => u());
}

/** How often the bridge looks at the rail for changes worth telling the avatar about. */
const WATCH_MS = 1500;

/** Push full-marks/parked changes to the avatar as private context. */
function watchRail(actions: WorkspaceActions, addContext: (text: string) => void): () => void {
  let before: CriterionResult[] = actions.getRail().results;
  const id = setInterval(() => {
    const { markScheme, results, focusIds, view } = actions.getRail();
    if (results === before) return;
    const note = markScheme && view !== "summary" ? railChangeNote(markScheme, before, results, focusIds) : null;
    before = results;
    if (note) addContext(note);
  }, WATCH_MS);
  return () => clearInterval(id);
}

/** Create a bridge. `getContext` adds the topic and a notes excerpt; the mark-scheme titles come from the rail. */
export function createAnamAvatarBridge(getContext: () => Omit<PersonaContext, "criteria"> = () => ({})): AvatarBridge {
  return {
    async connect({ videoElementId, actions, handlers }): Promise<AvatarSession> {
      const { markScheme } = actions.getRail();
      const ctx = getContext();
      let stopWatch = () => {};
      const session = await connectAnam({
        videoElementId,
        handlers,
        context: {
          topic: ctx.topic ?? markScheme?.topic,
          notesExcerpt: ctx.notesExcerpt,
          criteria: markScheme?.criteria.map((c) => ({ id: c.id, title: c.title, probe: c.probe, ask: c.ask })),
        },
        registerTools: (c) => {
          const unregister = registerTools(c, actions);
          return () => {
            stopWatch();
            unregister();
          };
        },
      });
      stopWatch = watchRail(actions, session.addContext);

      return {
        disconnect: () => {
          stopWatch();
          session.disconnect();
        },
        sendText: session.sendText,
        notifyBoard: (state) =>
          session.addContext(
            state === "writing"
              ? "[BOARD, private, do not read out] The student is writing or drawing on the board right now. Say nothing until they speak to you."
              : "[BOARD, private, do not read out] The student stopped writing on the board a few seconds ago. Look at the board notes: if it looks unfinished or they are thinking, keep waiting; if they have been quiet for a while, you may ask once whether they are finished.",
          ),
        setFocus: (criteria) => {
          if (!criteria.length) {
            session.addContext("[RAIL UPDATE, private, do not read out] The student wants to continue with the whole topic again.");
            return;
          }
          const list = criteria
            .map((c) => `"${c.title}"${c.missingSteps.length ? ` (still missing: ${c.missingSteps.slice(0, 3).join("; ")})` : ""}`)
            .join("; ");
          session.addContext(
            `[RAIL UPDATE, private, do not read out] The student chose to work on: ${list}. Ask about these first, one at a time, with curious questions; never give the missing points away. Parked points are open again for this.`,
          );
        },
      };
    },
  };
}

/** Default bridge (topic from the mark scheme, no notes excerpt). */
export const anamAvatarBridge = createAnamAvatarBridge();
