// Pure post-processing of the examiner's output (T9). No SDK imports so it can be unit-tested.
// The model proposes marks; this code enforces what a schema cannot: marks within bounds, verbatim
// quotes and missing steps, consistent statuses, and a deterministic total and primary gap.
import type { AnalyzeMode, Criterion, CriterionResult, CriterionStatus, GapReport, MarkScheme, StudyStep, TimedLine } from "@/types/session";

export interface RawResult {
  criterionId: string;
  status: "full" | "partial" | "missed" | "not_covered" | "in_progress";
  awarded: number;
  evidence: { quote: string } | null;
  boardObservation: string | null;
  missingSteps: string[];
  fix: string | null;
}

export interface RawStudyStep {
  title: string;
  detail: string;
  estimatedMinutes: number;
  criterionId: string | null;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Finds the student line that contains `quote` verbatim (case and spacing insensitive). */
export function findQuote(quote: string, transcript: TimedLine[]): { quote: string; timestamp: string } | null {
  const q = norm(quote);
  if (q.length < 3) return null;
  for (const line of transcript) {
    if (line.speaker !== "student") continue;
    const text = norm(line.text);
    const at = text.indexOf(q);
    if (at >= 0) {
      // Return the student's own wording (original casing), not the model's copy.
      const original = line.text.replace(/\s+/g, " ").trim();
      const start = norm(original).indexOf(q);
      return { quote: start >= 0 ? original.slice(start, start + q.length) : quote.trim(), timestamp: line.t };
    }
  }
  return null;
}

function grade(c: Criterion, raw: RawResult | undefined, transcript: TimedLine[], mode: AnalyzeMode): CriterionResult {
  const base = { criterionId: c.id, attempts: 0, parked: false };
  if (!raw) return { ...base, status: "not_covered", awarded: 0, missingSteps: [...c.expected] };

  const valid = [...new Set(raw.missingSteps.filter((s) => c.expected.includes(s)))];
  let awarded = Math.max(0, Math.min(c.marks, Math.round(raw.awarded)));
  let status: CriterionStatus = raw.status;
  let missing: string[];

  if (raw.status === "not_covered" || (raw.status === "missed" && awarded === 0)) {
    status = raw.status;
    awarded = 0;
    missing = [...c.expected];
  } else if (raw.status === "in_progress" && mode === "live") {
    status = "in_progress";
    missing = valid.length ? valid : c.expected.slice(awarded);
  } else {
    // full / partial / missed / (in_progress in final): trust what is verifiable.
    if (valid.length > 0 && valid.length < c.marks) awarded = c.marks - valid.length;
    else if (valid.length === 0 && raw.status === "full") awarded = c.marks;
    if (awarded >= c.marks) {
      status = "full";
      missing = [];
    } else if (awarded > 0) {
      status = "partial";
      missing = valid.length === c.marks - awarded ? valid : c.expected.slice(awarded);
    } else {
      status = raw.status === "in_progress" ? "not_covered" : "missed";
      missing = [...c.expected];
    }
  }

  const evidence = raw.evidence ? findQuote(raw.evidence.quote, transcript) : null;
  return {
    ...base,
    status,
    awarded,
    missingSteps: missing,
    ...(evidence ? { evidence } : {}),
    ...(raw.boardObservation ? { boardObservation: raw.boardObservation } : {}),
    ...(raw.fix && status !== "full" ? { fix: raw.fix } : {}),
  };
}

/** One result per criterion, in mark-scheme order. */
export function gradeAll(scheme: MarkScheme, raws: RawResult[], transcript: TimedLine[], mode: AnalyzeMode): CriterionResult[] {
  const byId = new Map(raws.map((r) => [r.criterionId, r]));
  return scheme.criteria.map((c) => grade(c, byId.get(c.id), transcript, mode));
}

/** The criterion with the most marks lost; ties go to the earliest in the scheme. */
export function primaryGap(scheme: MarkScheme, results: CriterionResult[]): string | null {
  let best: { id: string; lost: number } | null = null;
  for (const c of scheme.criteria) {
    const r = results.find((x) => x.criterionId === c.id);
    const lost = c.marks - (r?.awarded ?? 0);
    if (lost > 0 && (!best || lost > best.lost)) best = { id: c.id, lost };
  }
  return best?.id ?? null;
}

export function buildReport(scheme: MarkScheme, results: CriterionResult[], rawPlan: RawStudyStep[]): GapReport {
  const primary = primaryGap(scheme, results);
  const ids = new Set(scheme.criteria.map((c) => c.id));
  let plan: StudyStep[] = rawPlan.slice(0, 3).map((s, i) => ({
    id: `step-${i + 1}`,
    title: s.title,
    detail: s.detail,
    estimatedMinutes: Math.max(1, Math.min(90, Math.round(s.estimatedMinutes))),
    ...(s.criterionId && ids.has(s.criterionId) ? { gapId: s.criterionId } : {}),
  }));
  if (primary && plan.length > 0) {
    // The first step must be tied to the primary gap.
    const at = plan.findIndex((s) => s.gapId === primary);
    if (at > 0) plan = [plan[at], ...plan.filter((_, i) => i !== at)];
    else if (at < 0) plan[0] = { ...plan[0], gapId: primary };
    plan = plan.map((s, i) => ({ ...s, id: `step-${i + 1}` }));
  }
  return {
    awarded: results.reduce((n, r) => n + r.awarded, 0),
    total: scheme.totalMarks,
    results,
    primaryGapId: primary,
    studyPlan: plan,
  };
}

/** Builds a MarkScheme from the model's draft: ids, marks (1 per step), totals and the page range are computed here. */
export function buildMarkScheme(
  draft: { topic: string; criteria: { title: string; expected: string[]; page: number; label: string | null }[] },
  meta: { sourceFile: string; topic: string; maxPage: number },
): MarkScheme {
  const criteria: Criterion[] = draft.criteria
    .map((c) => ({ ...c, expected: c.expected.map((s) => s.trim()).filter(Boolean) }))
    .filter((c) => c.title.trim() && c.expected.length > 0)
    .slice(0, 8)
    .map((c, i) => {
      const page = Math.max(1, Math.min(meta.maxPage, Math.round(c.page) || 1));
      return {
        id: `c${i + 1}`,
        title: c.title.trim(),
        expected: c.expected,
        marks: c.expected.length,
        source: { page, ...(c.label ? { label: c.label } : {}) },
      };
    });
  const pages = criteria.map((c) => c.source.page);
  const lo = Math.min(...pages);
  const hi = Math.max(...pages);
  return {
    topic: meta.topic.trim() || draft.topic.trim(),
    sourceFile: meta.sourceFile,
    pages: criteria.length === 0 ? "" : lo === hi ? `p. ${lo}` : `pp. ${lo}-${hi}`,
    criteria,
    totalMarks: criteria.reduce((n, c) => n + c.marks, 0),
  };
}
