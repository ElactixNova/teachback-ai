import type { LegacyGapReport, StudyStep } from "@/types/session";

/** LegacyGapReport as the model returns it: the schema forces gapId to be present, so "none" arrives as null. */
export type RawGapReport = Omit<LegacyGapReport, "studyPlan"> & {
  studyPlan: (Omit<StudyStep, "gapId"> & { gapId?: string | null })[];
};

/** Enforces what the JSON schema cannot: the score range and that every gapId points at a real gap. */
export function normalizeReport(raw: RawGapReport): LegacyGapReport {
  const gapIds = new Set(raw.gaps.map((gap) => gap.id));
  return {
    ...raw,
    score: Math.min(100, Math.max(0, Math.round(raw.score))),
    studyPlan: raw.studyPlan.map(({ gapId, ...step }) => (gapId && gapIds.has(gapId) ? { ...step, gapId } : step)),
  };
}
