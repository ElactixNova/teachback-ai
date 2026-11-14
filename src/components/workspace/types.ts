// UI-local types for the workspace. Not part of the shared contract in src/types/session.ts.
// Rail state (results, final report, revision notes, visuals) lives in src/lib/rail/useRail.ts (T11).
import type { Cue } from "@/types/session";
import type { Async } from "@/lib/rail/useRail";
import type { VisualExplainer } from "@/types/session";

/** DOM id of the <video> element the Anam SDK streams into (connectAnam calls streamToVideoElement with it). */
export const ANAM_VIDEO_ID = "anam-video";

export type Speaker = "student" | "avatar";

export interface TranscriptLine {
  id: string;
  /** "system" lines (e.g. "Parked: …") are shown in the feed but never sent to the examiner. */
  speaker: Speaker | "system";
  text: string;
  at: string; // ISO timestamp
  /** "mm:ss" from the start of the session (what the examiner cites). */
  t: string;
}

export type AvatarStatus = "idle" | "connecting" | "live" | "error";

/** A live avatar session (see src/lib/anam/connect.ts). */
export interface AvatarSession {
  disconnect: () => void;
  /**
   * Send typed text to the avatar as if the student said it (Anam: client.sendUserMessage).
   * The workspace already adds the line to the transcript, so the bridge must not echo it via onTranscript.
   */
  sendText?: (text: string) => void;
}

/** Callbacks the avatar integration uses to push state into the UI. */
export interface AvatarHandlers {
  onTranscript: (speaker: Speaker, text: string) => void;
  onCue: (cue: Cue) => void;
  onStatus: (status: AvatarStatus, detail?: string) => void;
}

/** The centre column during a session: the whiteboard or the gap notes (the board stays mounted). */
export type CentreView = "board" | "notes";

export type VisualState = Async<VisualExplainer>;
export type { Async };
