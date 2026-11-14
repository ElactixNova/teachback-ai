// UI-local types for the workspace (T1). Not part of the shared contract in src/types/session.ts.
import type { Cue, LegacyGapReport, LegacyKnowledgeGap, VisualExplainer, WhiteboardSnapshot } from "@/types/session";

/** DOM id of the <video> element the Anam SDK streams into (T2 calls streamToVideoElement with it). */
export const ANAM_VIDEO_ID = "anam-video";

export type Speaker = "student" | "avatar";

export interface TranscriptLine {
  id: string;
  speaker: Speaker;
  text: string;
  at: string; // ISO timestamp
}

export type AvatarStatus = "idle" | "connecting" | "live" | "error";

/**
 * Actions the workspace exposes to the avatar's client tools (T2 maps them in registerToolCallHandler):
 *   capture_whiteboard        -> captureWhiteboard()
 *   open_gap_report           -> checkExplanation() / openGapReport()
 *   generate_visual_explainer -> generateVisualExplainer()
 */
export interface WorkspaceActions {
  /** Snapshot of the whiteboard, or null when it is empty. */
  captureWhiteboard: () => WhiteboardSnapshot | null;
  /** Run Snap & Check: analyse transcript + whiteboard against the notes, open the drawer. */
  checkExplanation: () => Promise<LegacyGapReport | null>;
  /** Open the report drawer (no new analysis). */
  openGapReport: () => void;
  /** Generate a fal visual for a gap (default: the most severe gap of the latest report). */
  generateVisualExplainer: (gapId?: string) => Promise<VisualExplainer | null>;
  /** The report currently shown (from Snap & Check or the avatar), or null. Read this; don't cache it. */
  getReport: () => LegacyGapReport | null;
}

/** A live avatar session returned by AvatarBridge.connect. */
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

/**
 * Integration seam for T2. Implement this in src/lib/anam (create the session token via
 * /api/anam-session, stream into ANAM_VIDEO_ID, register the 3 client tools against `actions`,
 * forward transcript and Director Notes cues through `handlers`), then swap the import in Workspace.tsx.
 */
export interface AvatarBridge {
  connect: (opts: {
    videoElementId: string;
    actions: WorkspaceActions;
    handlers: AvatarHandlers;
  }) => Promise<AvatarSession>;
}

export type VisualState =
  | { status: "loading" }
  | { status: "ready"; visual: VisualExplainer }
  | { status: "error"; error: string };

export type CheckStatus = "idle" | "checking" | "error";

export const SEVERITY_RANK: Record<LegacyKnowledgeGap["severity"], number> = { critical: 3, major: 2, minor: 1 };
