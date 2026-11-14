// Shared contract for Feynman AI. HOT FILE: change only after posting `CONTRACT src/types/session.ts: ...` in the hub main room.

/** Avatar expression cues (Anam Director Notes). */
export type Cue = "happy" | "curious" | "concerned" | "surprised";

/** Parsed lecture notes that scope a session. */
export interface CurriculumContext {
  title: string;
  /** Full extracted text of the uploaded PDF. */
  text: string;
  pageCount: number;
  /** Optional topic the student chose to explain. */
  topic?: string;
}

/** PNG snapshot of the whiteboard. */
export interface WhiteboardSnapshot {
  /** Base64 PNG, without the data: prefix. */
  pngBase64: string;
  width: number;
  height: number;
  capturedAt: string; // ISO timestamp
}

export type GapSeverity = "minor" | "major" | "critical";

/** @deprecated Old single-score report. Removed once the Mark Scheme Rail UI replaces it. */
export interface LegacyKnowledgeGap {
  id: string;
  concept: string;
  /** What the student said or drew that was wrong or vague. */
  misconception: string;
  /** What the notes say instead (cite the notes). */
  correction: string;
  severity: GapSeverity;
}

export interface StudyStep {
  id: string;
  title: string;
  detail: string;
  /** Minutes, rough estimate. */
  estimatedMinutes: number;
  gapId?: string;
  done?: boolean;
}

/** @deprecated Old report shape; replaced by GapReport below. */
export interface LegacyGapReport {
  /** Concepts the student explained correctly. */
  strengths: string[];
  gaps: LegacyKnowledgeGap[];
  studyPlan: StudyStep[];
  /** 0 to 100 overall understanding. */
  score: number;
  summary: string;
}

/** @deprecated Old input to POST /api/analyze; replaced by AnalyzeRequest below. */
export interface LegacyAnalyzeRequest {
  transcript: string;
  curriculumText: string;
  whiteboard?: WhiteboardSnapshot;
}

// ---------------------------------------------------------------------------------------------
// Mark Scheme Rail contract (Feynman AI). The mark scheme is what the AI examiner grades against.
// ---------------------------------------------------------------------------------------------

/** full = all marks; partial = some; missed = addressed but 0; not_covered = never addressed;
 *  in_progress = being explained now (live mode only); parked = two tries failed, come back later. */
export type CriterionStatus = "full" | "partial" | "missed" | "in_progress" | "not_covered" | "parked";

export interface Criterion {
  id: string;
  title: string;
  /** Mark-bearing steps. Each step is worth 1 mark, so `marks === expected.length`. */
  expected: string[];
  marks: number;
  source: { page: number; label?: string };
  /**
   * The question Sam asks to draw this criterion out of the student: specific to the steps in `expected`
   * but never containing the answer (e.g. "Can you write the balanced symbol equation for photosynthesis?").
   */
  probe?: string;
  /** How the student best shows this criterion: say it, write it on the board (equations, formulas) or draw it. */
  ask?: AskMode;
}

export type AskMode = "say" | "write" | "draw";

export interface MarkScheme {
  topic: string;
  sourceFile: string;
  /** Human-readable page range, e.g. "pp. 2-4". */
  pages: string;
  criteria: Criterion[];
  totalMarks: number;
}

export interface CriterionResult {
  criterionId: string;
  status: CriterionStatus;
  awarded: number;
  /** The student's exact words from the transcript. Never invented. */
  evidence?: { quote: string; timestamp: string };
  /** What the whiteboard snapshot shows or lacks. */
  boardObservation?: string;
  /** True when the board looks unfinished (cut-off equation, half-drawn diagram): the student is probably midway or thinking. */
  boardUnfinished?: boolean;
  /** Items from the criterion's `expected` that were not earned (verbatim). */
  missingSteps: string[];
  /** One or two sentences, phrased as the next thing to say out loud. */
  fix?: string;
  /** Times the student addressed this criterion and still lost marks. Counted client-side. */
  attempts: number;
  /** True after the second failed attempt: the avatar stops probing it. Kept in final mode. */
  parked: boolean;
}

export interface GapReport {
  awarded: number;
  total: number;
  results: CriterionResult[];
  primaryGapId: string | null;
  studyPlan: StudyStep[];
  visual?: VisualExplainer;
}

/** One transcript line with a time offset from the session start. */
export interface TimedLine {
  speaker: "student" | "avatar";
  text: string;
  /** "mm:ss" from the start of the session. */
  t: string;
}

export type AnalyzeMode = "live" | "final";

/** Input to POST /api/analyze */
export interface AnalyzeRequest {
  markScheme: MarkScheme;
  transcript: TimedLine[];
  /** Base64 PNG without the data: prefix. */
  whiteboardBase64?: string;
  mode: AnalyzeMode;
}

/** Response of POST /api/analyze with mode "live" (may contain "in_progress"). */
export interface LiveAnalyzeResponse {
  results: CriterionResult[];
}
/** Response of POST /api/analyze with mode "final" is a GapReport (never "in_progress"). */

/** Input to POST /api/mark-scheme */
export interface MarkSchemeRequest {
  curriculumText: string;
  topic: string;
  sourceFile: string;
}

// ---- Phase B: end screen ----

export interface RevisionDiagram {
  kind: "svg" | "image";
  /** Inline SVG markup when kind === "svg". */
  svg?: string;
  /** Image prompt (sent to fal) when kind === "image". */
  prompt?: string;
  /** Resolved image URL once generated. */
  url?: string;
}

export interface RevisionNote {
  criterionId: string;
  /** Numbered corrected steps, grounded in the lecture text. */
  steps: string[];
  oneLiner: string;
  diagram: RevisionDiagram;
  source: { page: number; label?: string };
}

/** Input to POST /api/revision-notes */
export interface RevisionNotesRequest {
  markScheme: MarkScheme;
  report: GapReport;
  curriculumText: string;
}

/** Input to POST /api/generate-visual */
export interface VisualRequest {
  concept: string;
  misconception: string;
  visualPrompt: string;
}

export interface VisualExplainer {
  kind: "video" | "image";
  url: string;
  /** Model id that produced it, e.g. a fal model path. */
  model: string;
  prompt: string;
  /** True when we fell back from video to image. */
  fallback?: boolean;
}

/** Response of POST /api/anam-session */
export interface AnamSessionResponse {
  sessionToken: string;
}

export interface ApiError {
  error: string;
}
