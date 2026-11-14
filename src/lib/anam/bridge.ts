// Browser-side Anam integration (T2). Implements the AvatarBridge seam from
// src/components/workspace/types.ts: session token from /api/anam-session, stream into the
// <video>, register the 3 client tools against WorkspaceActions, forward transcript and
// Director Notes cues through AvatarHandlers.
import type { AnamClient, MessageStreamEvent } from "@anam-ai/js-sdk";
import type { AnamSessionResponse, ApiError, GapReport } from "@/types/session";
import type { AvatarBridge, AvatarHandlers, AvatarSession, Speaker, WorkspaceActions } from "@/components/workspace/types";
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

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Turn streamed message chunks into whole transcript lines, and surface cues as they arrive.
 * `typed` holds lines sent with sendText: the workspace already shows them, so their echo is skipped.
 */
function createTranscriptCollector(handlers: AvatarHandlers, typed: Set<string>) {
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
      if (buf.speaker === "student" && typed.delete(norm(clean))) return;
      if (clean) handlers.onTranscript(buf.speaker, clean);
    }
  };
}

function registerTools(client: AnamClient, actions: WorkspaceActions) {
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
        const last = actions.getReport();
        if (p.arguments?.reuse_last && last) {
          actions.openGapReport();
          return summariseReport(last);
        }
        const report = await actions.checkExplanation();
        if (!report) return "The check could not run: the student has not explained anything yet, or the check failed. Ask them to explain a bit more first.";
        return summariseReport(report);
      },
    }),
    client.registerToolCallHandler(TOOL.generateVisualExplainer, {
      onStart: async (p) => {
        let r = actions.getReport();
        if (!r) {
          // No report yet: run the check; the workspace then starts the visual for the top gap itself.
          r = await actions.checkExplanation();
          if (!r) return "The check could not run: the student has not explained anything yet. Ask them to explain a bit first.";
          if (r.gaps.length === 0) return `${summariseReport(r)} There are no gaps, so no visual is needed.`;
          return `${summariseReport(r)} A visual for the most important gap is being generated and will appear in the report in a few seconds.`;
        }
        if (r.gaps.length === 0) return "The latest report has no gaps, so there is nothing to illustrate. Tell the student they did well.";
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
    async connect({ videoElementId, actions, handlers }): Promise<AvatarSession> {
      handlers.onStatus("connecting");
      let client: AnamClient | null = null;
      let closedByUs = false;
      let cleanupTools = () => {};
      const typed = new Set<string>();

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
        c.addListener(AnamEvent.MESSAGE_STREAM_EVENT_RECEIVED, createTranscriptCollector(handlers, typed));
        c.addListener(AnamEvent.DIRECTOR_NOTE_CUE_APPLIED, (ev) => {
          const cue = toUiCue(ev.cueTag);
          if (cue) handlers.onCue(cue);
        });
        c.addListener(AnamEvent.VIDEO_PLAY_STARTED, () => handlers.onStatus("live"));
        // Stay live without a mic: the video keeps playing and typed lines still reach the avatar.
        c.addListener(AnamEvent.MIC_PERMISSION_DENIED, () =>
          handlers.onStatus("live", "Microphone blocked. Type your explanation below."),
        );
        c.addListener(AnamEvent.CONNECTION_CLOSED, (reason, details) => {
          cleanupTools();
          if (closedByUs) return;
          handlers.onStatus("error", `Session ended${details ? `: ${details}` : ` (${reason})`}.`);
        });
        c.addListener(AnamEvent.TOOL_CALL_FAILED, (ev) => console.warn("[anam] tool failed", ev.toolName, ev.errorMessage));

        cleanupTools = registerTools(c, actions);

        await c.streamToVideoElement(videoElementId);
        if (!closedByUs) handlers.onStatus("live");
      } catch (e) {
        cleanupTools();
        void client?.stopStreaming().catch(() => {});
        client = null;
        handlers.onStatus("error", e instanceof Error ? e.message : "Could not start the avatar.");
      }

      const sendText = (text: string) => {
        if (!client?.isStreaming()) return;
        typed.add(norm(text));
        try {
          client.sendUserMessage(text);
        } catch (e) {
          typed.delete(norm(text));
          console.warn("[anam] sendUserMessage failed", e);
        }
      };

      return { disconnect, sendText };
    },
  };
}

/** Default bridge with a generic persona (no topic). */
export const anamAvatarBridge = createAnamAvatarBridge();
