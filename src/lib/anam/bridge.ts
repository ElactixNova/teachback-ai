// Browser-side Anam integration for the Mark Scheme Rail workspace (T2, T11).
// Implements AvatarBridge from src/components/workspace/types.ts: the persona knows the mark-scheme
// titles (never the answers), its client tools read and steer the live rail through WorkspaceActions,
// and rail changes (full marks, parked) reach it as private context through Anam addContext.
import type { AnamClient } from "@anam-ai/js-sdk";
import type { CriterionResult, GapReport, MarkScheme } from "@/types/session";
import type { AvatarBridge, AvatarSession, WorkspaceActions } from "@/components/workspace/types";
import { PRIVATE_NOTE, boardNote, findCriterion, railChangeNote, railStatusText, planNote } from "@/lib/rail/state";
import type { PersonaContext } from "./persona";
import { createQuestionWriter, remoteLatex, type QuestionWriter } from "@/lib/board/questions";
import { spokenToLatex } from "@/lib/math/spoken";
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

/** The longest the avatar waits for a fresh marking before going on with the results it has. */
const FRESH_WAIT_MS = 8000;

/**
 * Brings the rail up to date before the avatar relies on it (T30). Live marking trails the student by
 * up to ~20 s, so a step they have just made still looked missing and Sam asked for it again.
 * Never waits longer than FRESH_WAIT_MS and never fails: the current results are the fallback.
 */
const freshen = (actions: WorkspaceActions): Promise<void> =>
  Promise.race([actions.refreshRail().catch(() => {}), new Promise<void>((done) => setTimeout(done, FRESH_WAIT_MS))]);

/** A tool handler that reads the rail only after it has been brought up to date. */
const afterRefresh = (actions: WorkspaceActions, handler: { onStart: () => Promise<string> }) => ({
  onStart: async () => {
    await freshen(actions);
    return handler.onStart();
  },
});

/** A check that finished this recently is reused instead of marking again. */
const RECENT_CHECK_MS = 20_000;

function registerTools(client: AnamClient, actions: WorkspaceActions, questions: QuestionWriter): () => void {
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

  const unregister = [
    client.registerToolCallHandler(TOOL.writeOnBoard, {
      // The writer decides what goes on the board: her last question when the student asked to see it.
      onStart: async (p) => questions.tool({ content: arg(p, "content"), kind: arg(p, "kind") === "text" ? "text" : "math", label: arg(p, "label") || undefined }),
    }),
    client.registerToolCallHandler(TOOL.getRailStatus, afterRefresh(actions, {
      onStart: async () => {
        const { markScheme, results, focusIds, transcript } = actions.getRail();
        if (!markScheme) return "There is no mark scheme yet. Ask the student what they want to teach you.";
        return railStatusText(markScheme, results, focusIds, transcript);
      },
    })),
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
    client.registerToolCallHandler(TOOL.captureWhiteboard, afterRefresh(actions, {
      // Marked first, so the answer names what is on the board now (T32: Sam said "Got it" to boards she had not seen).
      onStart: async () => {
        const snap = actions.captureWhiteboard();
        if (!snap) return "The whiteboard is empty. Ask them to sketch what they mean.";
        const { markScheme, results } = actions.getRail();
        const seen = markScheme ? boardNote(markScheme, results) : "";
        return seen
          ? `They have drawn on the whiteboard. ${seen} Treat it as part of their answer: mention one specific thing from it in your reply.`
          : "They have drawn on the whiteboard and the examiner is reading it now (within about 20 seconds). Acknowledge it in a few words, never ask them to repeat it aloud, and carry on.";
      },
    })),
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
      let planAhead: (justSaid: string) => void = () => {};
      // Sam's questions reach the board even when the LLM never calls write_on_board (T27): the writer
      // hears every line, writes the maths questions she did not write, and knows her last question.
      const questions = createQuestionWriter((note) => actions.writeOnBoard(note), {
        toLatex: async (spoken) => spokenToLatex(spoken) ?? (await remoteLatex(spoken).catch(() => null)),
      });
      const session = await connectAnam({
        videoElementId,
        handlers: {
          ...handlers,
          onTranscript: (speaker, text, id) => {
            handlers.onTranscript(speaker, text, id);
            if (speaker === "avatar") {
              questions.heard(id ?? text, text, true);
              // Sam replies about a second after the student stops, too soon for marking or a tool call.
              // So right after each thing she says she gets her next question, ready before she needs it.
              planAhead(text);
            } else questions.studentSaid(text);
          },
          onTranscriptPartial: (id, speaker, soFar) => {
            handlers.onTranscriptPartial?.(id, speaker, soFar);
            if (speaker === "avatar" && soFar) questions.heard(id, soFar, false);
          },
        },
        context: {
          topic: ctx.topic ?? markScheme?.topic,
          notesExcerpt: ctx.notesExcerpt,
          criteria: markScheme?.criteria.map((c) => ({ id: c.id, title: c.title, probe: c.probe, ask: c.ask })),
        },
        onPersonaSpeech: (chars, done) => actions.speechProgress(chars, done),
        registerTools: (c) => {
          const unregister = registerTools(c, actions, questions);
          return () => {
            stopWatch();
            unregister();
          };
        },
      });
      stopWatch = watchRail(actions, session.addContext);
      let boardTurn = 0;
      let lastPlan = "";
      planAhead = (justSaid) => {
        const { markScheme, results, transcript, view } = actions.getRail();
        if (!markScheme || view !== "board") return;
        // The line she just said may not be in the workspace's transcript yet (it arrives a render later).
        const lines = transcript.some((l) => l.speaker === "avatar" && l.text === justSaid) ? transcript : [...transcript, { speaker: "avatar" as const, text: justSaid, t: "" }];
        const note = planNote(markScheme, results, lines);
        if (note === lastPlan) return;
        lastPlan = note;
        session.addContext(note);
      };

      return {
        disconnect: () => {
          stopWatch();
          session.disconnect();
        },
        sendText: (text) => {
          // Typed lines never come back through the transcript stream, so the writer hears them here.
          questions.studentSaid(text);
          session.sendText?.(text);
        },
        notifyBoard: (state) => {
          const turn = ++boardTurn;
          if (state === "writing") {
            session.addContext(`${PRIVATE_NOTE} Board status: the student is writing or drawing now.`);
            return;
          }
          // They stopped: read the board first, so Sam hears what is written, not only that something was.
          void freshen(actions).then(() => {
            if (turn !== boardTurn) return; // they picked the pen up again meanwhile
            const { markScheme, results } = actions.getRail();
            const seen = markScheme ? boardNote(markScheme, results) : "";
            session.addContext(`${PRIVATE_NOTE} Board status: the student stopped writing a few seconds ago.${seen ? ` ${seen}` : ""}`);
          });
        },
        setFocus: (criteria) => {
          if (!criteria.length) {
            session.addContext(`${PRIVATE_NOTE} The student wants to continue with the whole topic again.`);
            return;
          }
          const list = criteria
            .map((c) => `"${c.title}"${c.missingSteps.length ? ` (still missing: ${c.missingSteps.slice(0, 3).join("; ")})` : ""}`)
            .join("; ");
          session.addContext(
            `${PRIVATE_NOTE} The student chose to work on: ${list}. Ask about these first, one at a time, with curious questions; never give the missing points away. Parked points are open again for this.`,
          );
        },
      };
    },
  };
}

/** Default bridge (topic from the mark scheme, no notes excerpt). */
export const anamAvatarBridge = createAnamAvatarBridge();
