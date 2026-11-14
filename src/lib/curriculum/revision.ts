// Revision notes for the end screen (T9): one note per criterion that lost marks, grounded in the lecture text.
import { z } from "zod";
import type { Criterion, CriterionResult, GapReport, MarkScheme, RevisionNote } from "@/types/session";
import { LIVE_MODEL, generateJson } from "./llm";

/** Notes use the faster model: the end screen should appear in about 10-15s. */
const NOTES_MODEL = process.env.REVISION_MODEL ?? LIVE_MODEL;

const NoteSchema = z.object({
  notes: z.array(
    z.object({
      criterionId: z.string(),
      steps: z.array(z.string()),
      oneLiner: z.string(),
      diagramKind: z.enum(["svg", "image"]),
      svg: z.string().nullable(),
      imagePrompt: z.string().nullable(),
    }),
  ),
});

const PROMPT = `You write short revision notes for a student who just taught a topic back and lost marks.
You get the lecture notes (with [Page N] markers), the mark scheme, and the marking results.
For each listed criterion write:
- steps: 3 to 6 short numbered-style steps (plain sentences, no numbering) that correct what was missed. Base every step on the lecture notes only; do not add outside facts.
- oneLiner: one sentence summarising the idea.
- diagram: prefer an inline SVG for maths, equations, flows and labelled diagrams (diagramKind "svg"): a self-contained <svg> with a viewBox of 0 0 600 340, white background rect, sharp text of at least 16px, labelled arrows, a few colours, no scripts, no external images or fonts, under 6000 characters. If an SVG does not fit the concept (for example a physical scene), use diagramKind "image" with a concise imagePrompt for an image model, and set svg to null. When diagramKind is "svg", set imagePrompt to null.
Return one note per listed criterion, using its criterionId. JSON only.`;

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

export async function writeRevisionNotes(scheme: MarkScheme, report: GapReport, curriculumText: string): Promise<RevisionNote[]> {
  const gaps = gapsWorstFirst(scheme, report.results);
  if (gaps.length === 0) return [];

  const out = await generateJson({
    model: NOTES_MODEL,
    system: PROMPT,
    cachedContext: `<lecture_notes>\n${curriculumText}\n</lecture_notes>`,
    userText:
      "Criteria to write notes for (worst first):\n" +
      JSON.stringify(
        gaps.map(({ criterion, result }) => ({
          criterionId: criterion.id,
          title: criterion.title,
          expected: criterion.expected,
          missingSteps: result.missingSteps,
          studentSaid: result.evidence?.quote ?? null,
          sourcePage: criterion.source.page,
        })),
      ),
    schema: NoteSchema,
    maxTokens: 12000,
  });

  const byId = new Map(out.notes.map((n) => [n.criterionId, n]));
  return gaps.map(({ criterion }) => {
    const n = byId.get(criterion.id);
    const svg = n?.diagramKind === "svg" ? safeSvg(n.svg) : null;
    const steps = (n?.steps ?? []).map((s) => s.trim()).filter(Boolean);
    return {
      criterionId: criterion.id,
      // If the model skipped a criterion, fall back to the mark scheme's own steps (they come from the notes).
      steps: steps.length > 0 ? steps : criterion.expected,
      oneLiner: n?.oneLiner?.trim() || criterion.title,
      diagram: svg
        ? { kind: "svg" as const, svg }
        : { kind: "image" as const, prompt: n?.imagePrompt?.trim() || `Clean labelled educational diagram of: ${criterion.title}. ${criterion.expected.join(". ")}` },
      source: criterion.source,
    };
  });
}
