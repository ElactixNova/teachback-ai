// Shared Anam session plumbing (T2/T11): session token, video stream, transcript + cues, lifecycle.
// The legacy bridge (./bridge.ts) and the rail bridge (./rail-bridge.ts) differ only in their tools.
import type { AnamClient, MessageStreamEvent } from "@anam-ai/js-sdk";
import type { AnamSessionResponse, ApiError } from "@/types/session";
import type { AvatarHandlers, AvatarSession, Speaker } from "@/components/workspace/types";
import type { PersonaContext } from "./persona";
import { extractCues, toUiCue } from "./cues";

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

export interface AnamSession extends AvatarSession {
  /** Private context for the persona's LLM (Anam addContext); not spoken, not shown. */
  addContext: (text: string) => void;
}

export async function connectAnam(opts: {
  videoElementId: string;
  handlers: AvatarHandlers;
  context: PersonaContext;
  /** Register client tool handlers; return a cleanup. Called before streaming starts. */
  registerTools: (client: AnamClient) => () => void;
}): Promise<AnamSession> {
  const { videoElementId, handlers, context } = opts;
  handlers.onStatus("connecting");
  let client: AnamClient | null = null;
  let closedByUs = false;
  let cleanupTools = () => {};
  const typed = new Set<string>();

  // Anam keys allow few concurrent sessions: end ours when the tab closes or reloads,
  // otherwise the next "Start session" hits "Concurrency limit reached" until it times out.
  const onPageHide = () => void client?.stopStreaming().catch(() => {});
  window.addEventListener("pagehide", onPageHide);

  const disconnect = () => {
    closedByUs = true;
    window.removeEventListener("pagehide", onPageHide);
    cleanupTools();
    void client?.stopStreaming().catch(() => {});
    client = null;
    handlers.onStatus("idle");
  };

  try {
    // Load the SDK in the browser only (it touches WebRTC and window at import time).
    const { createClient, AnamEvent } = await import("@anam-ai/js-sdk");
    const token = await fetchSessionToken(context);
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
    c.addListener(AnamEvent.MIC_PERMISSION_DENIED, () => handlers.onStatus("live", "Microphone blocked. Type your explanation below."));
    c.addListener(AnamEvent.CONNECTION_CLOSED, (reason, details) => {
      cleanupTools();
      if (closedByUs) return;
      handlers.onStatus("error", `Session ended${details ? `: ${details}` : ` (${reason})`}.`);
    });
    c.addListener(AnamEvent.TOOL_CALL_FAILED, (ev) => console.warn("[anam] tool failed", ev.toolName, ev.errorMessage));

    cleanupTools = opts.registerTools(c);

    await c.streamToVideoElement(videoElementId);
    if (!closedByUs) handlers.onStatus("live");
  } catch (e) {
    window.removeEventListener("pagehide", onPageHide);
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

  const addContext = (text: string) => {
    if (!client?.isStreaming()) return;
    try {
      client.addContext(text);
    } catch (e) {
      console.warn("[anam] addContext failed", e);
    }
  };

  return { disconnect, sendText, addContext };
}
