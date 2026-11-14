// Pure helpers for revision notes (T9). No SDK imports so they can be unit-tested.
import type { Criterion, CriterionResult, MarkScheme } from "@/types/session";

const BAD_SVG = /<script|<foreignObject|\son\w+\s*=|javascript:|<iframe|<image|<use|xlink:href|href\s*=\s*["'](?!#)/i;

/** An SVG we are willing to ship to the browser; anything else falls back to an image prompt. */
export function safeSvg(svg: string | null): string | null {
  if (!svg) return null;
  const s = svg.trim();
  if (!/^<svg[\s>]/i.test(s) || !/<\/svg>\s*$/i.test(s)) return null;
  if (s.length > 20_000 || BAD_SVG.test(s)) return null;
  return s;
}

/** Criteria that lost marks (partial, missed or parked), worst first; ties keep mark-scheme order. */
export function gapsWorstFirst(scheme: MarkScheme, results: CriterionResult[]): { criterion: Criterion; result: CriterionResult }[] {
  return scheme.criteria
    .map((criterion) => ({ criterion, result: results.find((r) => r.criterionId === criterion.id) }))
    .filter((x): x is { criterion: Criterion; result: CriterionResult } => !!x.result && x.result.status !== "not_covered" && x.criterion.marks - x.result.awarded > 0)
    .map((x, i) => ({ ...x, i, lost: x.criterion.marks - x.result.awarded }))
    .sort((a, b) => b.lost - a.lost || a.i - b.i)
    .map(({ criterion, result }) => ({ criterion, result }));
}
