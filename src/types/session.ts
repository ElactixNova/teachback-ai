// Shared contract for TeachBack AI. HOT FILE: change only after posting `CONTRACT src/types/session.ts: ...` in the hub main room.

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

export interface KnowledgeGap {
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

export interface GapReport {
  /** Concepts the student explained correctly. */
  strengths: string[];
  gaps: KnowledgeGap[];
  studyPlan: StudyStep[];
  /** 0 to 100 overall understanding. */
  score: number;
  summary: string;
}

/** Input to POST /api/analyze */
export interface AnalyzeRequest {
  transcript: string;
  curriculumText: string;
  whiteboard?: WhiteboardSnapshot;
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
