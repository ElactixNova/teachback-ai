// TEMPORARY rail state helpers until T11 (src/lib/rail) lands; then switch the imports and delete this file.
// Pure functions: attempt counting and parking on top of live /api/analyze results.
import type { CriterionResult, MarkScheme } from "@/types/session";

export const MAX_ATTEMPTS = 2;

export function emptyResults(scheme: MarkScheme): CriterionResult[] {
  return scheme.criteria.map((c) => ({
    criterionId: c.id,
    status: "not_covered",
    awarded: 0,
    missingSteps: [...c.expected],
    attempts: 0,
    parked: false,
  }));
}

const lostMarks = (r: CriterionResult) => r.status === "partial" || r.status === "missed";

/**
 * Merge a live analysis into the previous results.
 * An attempt = the criterion is still partial/missed AND the student said something new about it
 * (its evidence timestamp moved). On attempt MAX_ATTEMPTS it is parked; full marks unpark it.
 */
export function mergeLiveResults(scheme: MarkScheme, prev: CriterionResult[], incoming: CriterionResult[]): CriterionResult[] {
  const before = new Map(prev.map((r) => [r.criterionId, r]));
  const now = new Map(incoming.map((r) => [r.criterionId, r]));
  return scheme.criteria.map((c) => {
    const p = before.get(c.id);
    const n = now.get(c.id);
    if (!n) return p ?? emptyResults({ ...scheme, criteria: [c] })[0];
    let attempts = p?.attempts ?? 0;
    const newEvidence = !!n.evidence && n.evidence.timestamp !== p?.evidence?.timestamp;
    if (lostMarks(n) && newEvidence) attempts += 1;
    const full = n.status === "full";
    const parked = !full && ((p?.parked ?? false) || attempts >= MAX_ATTEMPTS);
    return { ...n, attempts: full ? 0 : attempts, parked, status: parked ? "parked" : n.status };
  });
}

/** Keep the client's attempts/parked on a final report (the server always sends 0/false). */
export function carryParking(prev: CriterionResult[], finalResults: CriterionResult[]): CriterionResult[] {
  const before = new Map(prev.map((r) => [r.criterionId, r]));
  return finalResults.map((r) => {
    const p = before.get(r.criterionId);
    const parked = !!p?.parked && r.status !== "full";
    return { ...r, attempts: p?.attempts ?? 0, parked };
  });
}
