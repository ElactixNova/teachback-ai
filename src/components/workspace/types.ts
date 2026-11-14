// UI-local types for the workspace. Not part of the shared contract in src/types/session.ts.
import type {
  Cue,
  CriterionResult,
  GapReport,
  MarkScheme,
  RevisionNote,
  TimedLine,
  VisualExplainer,
  WhiteboardSnapshot,
} from "@/types/session";
import type { NoteInput, NoteOutcome } from "@/lib/board/notes";

/** DOM id of the <video> element the Anam SDK streams into (the bridge calls streamToVideoElement with it). */
export const ANAM_VIDEO_ID = "anam-video";

export type Speaker = "student" | "avatar";

export interface TranscriptLine {
  id: string;
  /** "system" lines (e.g. "Parked: ...") are shown in the feed only: never sent to the examiner or the bridge. */
  speaker: Speaker | "system";
  text: string;
  at: string; // ISO timestamp
  /** "mm:ss" from the start of the session (what the examiner cites). */
  t: string;
}

export type AvatarStatus = "idle" | "connecting" | "live" | "error";

/**
 * What the workspace shows. "board" and "notes" swap the centre column (the whiteboard stays mounted);
 * "summary" is the end screen, an in-page view so the single Anam session survives.
 */
export type WorkspaceView = "board" | "notes" | "summary";

/** What the rail knows right now (for the avatar's get_rail_status tool). */
export interface RailSnapshot {
  markScheme: MarkScheme | null;
  results: CriterionResult[];
  transcript: TimedLine[];
  /** Criteria the student chose to work on next ("Teach these next" / "Try it now"); empty = all. */
  focusIds: string[];
  view: WorkspaceView;
}

/**
 * Actions the workspace exposes to the avatar's client tools (the bridge maps them in registerToolCallHandler).
 *   capture_whiteboard        -> captureWhiteboard()
 *   get_rail_status           -> getRail()
 *   park_criterion            -> parkCriterion(id)
 *   open_gap_report           -> checkExplanation() (or openGapReport() to reuse the last report)
 *   generate_visual_explainer -> generateVisualExplainer(criterionId?)
 *   write_on_board            -> writeOnBoard(note)
 */
export interface WorkspaceActions {
  /** Snapshot of the whiteboard, or null when it is empty. */
  captureWhiteboard: () => WhiteboardSnapshot | null;
  /** Mark scheme, live results (with attempts/parked) and the timed transcript. Read it; don't cache it. */
  getRail: () => RailSnapshot;
  /** Park a criterion (stop probing it; it is revisited on the end screen). No-op for unknown ids. */
  parkCriterion: (criterionId: string) => void;
  /** "Check my progress" (was Snap & Check): final marking (mode "final"), then show the gap notes in the centre column. */
  checkExplanation: () => Promise<GapReport | null>;
  /** Show the gap notes without re-marking (no-op when there is no report). */
  openGapReport: () => void;
  /** "Finish & final report": final marking, then the end screen (revision notes, images). */
  finishSession: () => Promise<GapReport | null>;
  /** The final report currently shown, or null. */
  getReport: () => GapReport | null;
  /** fal image for a criterion that lost marks (default: the report's primary gap). */
  generateVisualExplainer: (criterionId?: string) => Promise<VisualExplainer | null>;
  /** Sam writes its question on the whiteboard as a card in free space; says whether it was written or queued. */
  writeOnBoard: (note: NoteInput) => NoteOutcome;
  /** Sam's speech as it streams (characters just spoken, turn ended): the pen writing a question follows it. */
  speechProgress: (chars: number, done: boolean) => void;
}

/** A live avatar session returned by AvatarBridge.connect. */
export interface AvatarSession {
  disconnect: () => void;
  /**
   * Send typed text to the avatar as if the student said it (Anam: client.sendUserMessage).
   * The workspace already adds the line to the transcript, so the bridge must not echo it via onTranscript.
   */
  sendText?: (text: string) => void;
  /** Optional: tell the avatar which criteria to work on next. Empty = the whole scheme. */
  setFocus?: (criteria: { id: string; title: string; missingSteps: string[] }[]) => void;
  /** Optional: tell the avatar the student is writing/drawing now, or has stopped (private context, never spoken). */
  notifyBoard?: (state: "writing" | "idle") => void;
}

/** Callbacks the avatar integration uses to push state into the UI. */
export interface AvatarHandlers {
  /** A finished line. `id` matches the earlier onTranscriptPartial calls for it, so the live bubble can be replaced. */
  onTranscript: (speaker: Speaker, text: string, id?: string) => void;
  /**
   * T28/T29: a line while it is still being spoken (fires on every streamed chunk, cue tags and [...] already
   * removed). `textSoFar` is the whole line so far, not the new chunk. An empty `textSoFar` means "drop this
   * live line": it ended with nothing to show (e.g. the echo of a typed line), and no onTranscript follows.
   * Display only: the examiner transcript is built from onTranscript.
   */
  onTranscriptPartial?: (id: string, speaker: Speaker, textSoFar: string) => void;
  onCue: (cue: Cue) => void;
  onStatus: (status: AvatarStatus, detail?: string) => void;
}

/** Integration seam implemented in src/lib/anam/bridge.ts. */
export interface AvatarBridge {
  connect: (opts: {
    videoElementId: string;
    actions: WorkspaceActions;
    handlers: AvatarHandlers;
  }) => Promise<AvatarSession>;
}

export type Async<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; error: string };

export type VisualState = Async<VisualExplainer>;
export type RevisionNotesState = Async<RevisionNote[]>;
