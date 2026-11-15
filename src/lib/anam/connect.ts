// Shared Anam session plumbing (T2/T11): session token, video stream, transcript + cues, lifecycle.
// The legacy bridge (./bridge.ts) and the rail bridge (./rail-bridge.ts) differ only in their tools.
import { diag } from "./diag";
import type { AnamClient, MessageStreamEvent } from "@anam-ai/js-sdk";
import type { AnamSessionResponse, ApiError } from "@/types/session";
import type { AvatarHandlers, AvatarSession, Speaker } from "@/components/workspace/types";
import type { PersonaContext } from "./persona";
import { extractCues, stripBrackets, toUiCue } from "./cues";

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
function createTranscriptCollector(handlers: AvatarHandlers, typed: Set<string>, onPersonaSpeech?: (chars: number, done: boolean) => void, onSpeaking?: (speaking: boolean) => void) {
  const buffers = new Map<string, { speaker: Speaker; text: string; shown: boolean }>();
  return (e: MessageStreamEvent) => {
    const speaker: Speaker = String(e.role) === "user" ? "student" : "avatar";
    diag(speaker === "avatar" ? "sam" : "you", `${e.content ?? ""}${e.interrupted ? " [INTERRUPTED]" : ""}${e.endOfSpeech ? " [END]" : ""}`);
    const cue = toUiCue(e.cueTag);
    if (cue) handlers.onCue(cue);

    // Sam's words as they stream: the pen writing a question on the board keeps pace with them.
    if (speaker === "avatar") {
      onPersonaSpeech?.((e.content ?? "").length, !!(e.endOfSpeech || e.interrupted));
      onSpeaking?.(!(e.endOfSpeech || e.interrupted));
    }

    const buf = buffers.get(e.id) ?? { speaker, text: "", shown: false };
    buf.text += e.content ?? "";
    buffers.set(e.id, buf);

    if (e.endOfSpeech || e.interrupted) {
      buffers.delete(e.id);
      const { clean: untagged, cues } = extractCues(buf.text);
      cues.forEach(handlers.onCue);
      const clean = cleanLine(buf.speaker, untagged);
      const echo = buf.speaker === "student" && typed.delete(norm(clean));
      if (clean && !echo) handlers.onTranscript(buf.speaker, clean, e.id);
      else if (buf.shown) handlers.onTranscriptPartial?.(e.id, buf.speaker, "");
      return;
    }

    // The line so far, for the live bubble. A typed line's echo is never shown.
    if (!handlers.onTranscriptPartial) return;
    const soFar = cleanLine(buf.speaker, extractCues(buf.text).clean);
    if (!soFar || (buf.speaker === "student" && isTypedPrefix(typed, soFar))) return;
    buf.shown = true;
    handlers.onTranscriptPartial(e.id, buf.speaker, soFar);
  };
}

/** Sam's lines only lose [...] segments: the student may type real brackets (an interval, a matrix). */
const cleanLine = (speaker: Speaker, text: string) => (speaker === "avatar" ? stripBrackets(text) : text);

/** Is this partial student line the start of a line they typed (whose echo we skip)? */
function isTypedPrefix(typed: Set<string>, soFar: string): boolean {
  const n = norm(soFar);
  for (const t of typed) if (t.startsWith(n)) return true;
  return false;
}

export interface AnamSession extends AvatarSession {
  /** Private context for the persona's LLM (Anam addContext); not spoken, not shown. */
  addContext: (text: string) => void;
}

export async function connectAnam(opts: {
  videoElementId: string;
  handlers: AvatarHandlers;
  context: PersonaContext;
  /** Called for every streamed chunk of Sam's speech: its length, and whether Sam's turn ended or was interrupted. */
  onPersonaSpeech?: (chars: number, done: boolean) => void;
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

  // Private notes are never pushed into the avatar's pipeline while Sam is mid-sentence (T35): a context
  // update during speech may disturb the voice. They wait and arrive, in order, right after she stops, which is
  // still before her next reply. A safety timer flushes them if the end-of-speech event never comes.
  let speaking = false;
  let speakingTimer: ReturnType<typeof setTimeout> | null = null;
  const waiting: string[] = [];
  const push = (text: string) => {
    if (!client?.isStreaming()) return;
    try {
      client.addContext(text);
    } catch (e) {
      console.warn("[anam] addContext failed", e);
    }
  };
  // Noise guard (T53): Anam interrupts Sam the moment its voice detection hears anything, so in a loud room (a pitch,
  // a hall) a cough or a neighbour cuts her off. While she is talking the microphone is muted, and it comes back a
  // beat after she stops. The same timer that releases held notes also releases the mic, so it can never stay off.
  // NEXT_PUBLIC_MIC_GUARD=off turns it off (full barge-in again).
  const guard = process.env.NEXT_PUBLIC_MIC_GUARD !== "off";
  let unmuteTimer: ReturnType<typeof setTimeout> | null = null;
  const mic = (mute: boolean) => {
    if (!guard || !client?.isStreaming()) return;
    try {
      if (mute) client.muteInputAudio();
      else client.unmuteInputAudio();
    } catch (e) {
      console.warn("[anam] mic mute failed", e);
    }
  };
  const flush = () => {
    if (speakingTimer) clearTimeout(speakingTimer);
    speakingTimer = null;
    speaking = false;
    for (const note of waiting.splice(0)) push(note);
    // A short tail so the end of her own voice is not picked up as the student starting to talk.
    if (unmuteTimer) clearTimeout(unmuteTimer);
    unmuteTimer = setTimeout(() => mic(false), 350);
  };
  const setSpeaking = (now: boolean) => {
    if (!now) return flush();
    if (!speaking) mic(true);
    if (unmuteTimer) clearTimeout(unmuteTimer);
    speaking = true;
    if (speakingTimer) clearTimeout(speakingTimer);
    speakingTimer = setTimeout(flush, 15_000);
  };

  const disconnect = () => {
    closedByUs = true;
    window.removeEventListener("pagehide", onPageHide);
    cleanupTools();
    if (unmuteTimer) clearTimeout(unmuteTimer);
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
    c.addListener(AnamEvent.MESSAGE_STREAM_EVENT_RECEIVED, createTranscriptCollector(handlers, typed, opts.onPersonaSpeech, setSpeaking));
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
    diag("note", text);
    if (!speaking) return push(text);
    waiting.push(text);
    if (waiting.length > 4) waiting.shift();
  };

  return { disconnect, sendText, addContext };
}
