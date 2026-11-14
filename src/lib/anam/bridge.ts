// Browser-side Anam integration (T2). Implements the AvatarBridge seam from
// src/components/workspace/types.ts: session token from /api/anam-session, stream into the
// <video>, register the 3 client tools against WorkspaceActions, forward transcript and
// Director Notes cues through AvatarHandlers.
import type { AnamClient, MessageStreamEvent } from "@anam-ai/js-sdk";
import type { AnamSessionResponse, ApiError, GapReport } from "@/types/session";
import type { AvatarBridge, AvatarHandlers, Speaker, WorkspaceActions } from "@/components/workspace/types";
import type { PersonaContext } from "./persona";
import { extractCues, toUiCue } from "./cues";
import { TOOL } from "./tools";

async function fetchSessionToken(ctx: PersonaContext): Promise<string> {
  const res = await fetch("/api/anam-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ctx),
  });
  const body = (await res.json().catch(() => null)) as AnamSessionResponse | ApiError | null;
  if (!res.ok || !body || !("sessionToken" in body)) {
    throw new Error(body && "error" in body ? body.error : `Session route failed (${res.status})`);
  }
  return body.sessionToken;
}

function summariseReport(r: GapReport): string {
  const gaps = r.gaps.length
    ? r.gaps.map((g) => `${g.concept} (${g.severity}): they said "${g.misconception}"; the notes say "${g.correction}"`).join("; ")
    : "none";
  return `Report is open on screen. Score ${r.score}/100. Summary: ${r.summary} Strengths: ${
    r.strengths.join(", ") || "none"
  }. Gaps: ${gaps}. Tell the student their score and the most important gap in one or two sentences, as a curious student would, without reading this out. Only talk about the gaps listed here; do not add corrections of your own.`;
}

/** Turn streamed message chunks into whole transcript lines, and surface cues as they arrive. */
function createTranscriptCollector(handlers: AvatarHandlers) {
  const buffers = new Map<string, { speaker: Speaker; text: string }>();
  return (e: MessageStreamEvent) => {
    const speaker: Speaker = String(e.role) === "user" ? "student" : "avatar";
    const cue = toUiCue(e.cueTag);
    if (cue) handlers.onCue(cue);

    const buf = buffers.get(e.id) ?? { speaker, text: "" };
    buf.text += e.content ?? "";
    buffers.set(e.id, buf);

    if (e.endOfSpeech || e.interrupted) {
      buffers.delete(e.id);
      const { clean, cues } = extractCues(buf.text);
      cues.forEach(handlers.onCue);
      if (clean) handlers.onTranscript(buf.speaker, clean);
    }
  };
}

function registerTools(client: AnamClient, actions: WorkspaceActions, state: { report: GapReport | null }) {
  const unregister = [
    client.registerToolCallHandler(TOOL.captureWhiteboard, {
      onStart: async () => {
        const snap = actions.captureWhiteboard();
        if (!snap) return "The whiteboard is empty. Ask the student to sketch what they mean.";
        return `The student has drawn on the whiteboard (${snap.width}x${snap.height}). You cannot see details yet; it will be checked with ${TOOL.openGapReport}. Ask them to talk you through the drawing.`;
      },
    }),
    client.registerToolCallHandler(TOOL.openGapReport, {
      onStart: async (p) => {
        if (p.arguments?.reuse_last && state.report) {
          actions.openGapReport();
          return summariseReport(state.report);
        }
        const report = await actions.checkExplanation();
        if (!report) return "The check could not run: the student has not explained anything yet, or the check failed. Ask them to explain a bit more first.";
        state.report = report;
        return summariseReport(report);
      },
    }),
    client.registerToolCallHandler(TOOL.generateVisualExplainer, {
      onStart: async (p) => {
        const r = state.report;
        if (!r || r.gaps.length === 0) {
          return `There is no report with gaps yet. Offer to check their explanation with ${TOOL.openGapReport} first.`;
        }
        const wanted = typeof p.arguments?.concept === "string" ? p.arguments.concept.toLowerCase().trim() : "";
        const gap = wanted
          ? r.gaps.find((g) => g.concept.toLowerCase().includes(wanted) || wanted.includes(g.concept.toLowerCase()))
          : undefined;
        // Fire and forget: fal can take longer than the tool timeout; the drawer shows progress.
        void actions.generateVisualExplainer(gap?.id);
        return `Generating a visual for "${gap?.concept ?? "the most important gap"}". It will appear in the report in a few seconds. Tell the student to watch for it.`;
      },
    }),
  ];
  return () => unregister.forEach((u) => u());
}

/** Create a bridge. `getContext` scopes the persona (topic + notes) at connect time. */
export function createAnamAvatarBridge(getContext: () => PersonaContext = () => ({})): AvatarBridge {
  return {
    async connect({ videoElementId, actions, handlers }) {
      handlers.onStatus("connecting");
      let client: AnamClient | null = null;
      let closedByUs = false;
      let cleanupTools = () => {};

      const disconnect = () => {
        closedByUs = true;
        cleanupTools();
        void client?.stopStreaming().catch(() => {});
        client = null;
        handlers.onStatus("idle");
      };

      try {
        // Load the SDK in the browser only (it touches WebRTC and window at import time).
        const { createClient, AnamEvent } = await import("@anam-ai/js-sdk");
        const token = await fetchSessionToken(getContext());
        const c = createClient(token);
        client = c;

        // Register listeners and tool handlers before streaming so nothing is missed.
        c.addListener(AnamEvent.MESSAGE_STREAM_EVENT_RECEIVED, createTranscriptCollector(handlers));
        c.addListener(AnamEvent.DIRECTOR_NOTE_CUE_APPLIED, (ev) => {
          const cue = toUiCue(ev.cueTag);
          if (cue) handlers.onCue(cue);
        });
        c.addListener(AnamEvent.VIDEO_PLAY_STARTED, () => handlers.onStatus("live"));
        c.addListener(AnamEvent.MIC_PERMISSION_DENIED, () =>
          handlers.onStatus("error", "Microphone blocked. Allow mic access, or type your explanation below."),
        );
        c.addListener(AnamEvent.CONNECTION_CLOSED, (reason, details) => {
          cleanupTools();
          if (closedByUs) return;
          handlers.onStatus("error", `Session ended${details ? `: ${details}` : ` (${reason})`}.`);
        });
        c.addListener(AnamEvent.TOOL_CALL_FAILED, (ev) => console.warn("[anam] tool failed", ev.toolName, ev.errorMessage));

        cleanupTools = registerTools(c, actions, { report: null });

        await c.streamToVideoElement(videoElementId);
        if (!closedByUs) handlers.onStatus("live");
      } catch (e) {
        cleanupTools();
        void client?.stopStreaming().catch(() => {});
        client = null;
        handlers.onStatus("error", e instanceof Error ? e.message : "Could not start the avatar.");
      }

      return { disconnect };
    },
  };
}

/** Default bridge with a generic persona (no topic). */
export const anamAvatarBridge = createAnamAvatarBridge();
