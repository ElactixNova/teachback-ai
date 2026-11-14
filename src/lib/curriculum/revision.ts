// Revision notes for the end screen (T9): one note per criterion that lost marks, grounded in the lecture text.
import { z } from "zod";
import type { GapReport, MarkScheme, RevisionNote } from "@/types/session";
import { gapsWorstFirst, safeSvg } from "./gaps";
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
The diagram must be about THIS student's answer, not a generic textbook figure. For each criterion you also get earnedSteps (what they got right), missingSteps (what they left out), studentSaid (their exact words, may be wrong) and onTheirBoard (what the examiner saw on their whiteboard).
- Show earnedSteps in a calm colour with a tick, and draw missingSteps in a strong highlight colour with the tag "You missed this" so the gap jumps out.
- If studentSaid or onTheirBoard contains a mistake (a wrong formula, an unbalanced equation, a wrong place or order), show it small and crossed out as "You said: ..." next to the corrected version.
- Fill the whole 600x340 canvas: a few big shapes, labels at 18px or more, a 24px title. No tiny text; if it does not fit, cut detail, not font size.
- For an image prompt, describe the correct figure and say which parts must be highlighted as the missing ones.
- The first step of "steps" must name the specific thing they missed or got wrong, in plain words addressed to the student ("You left out...", "You wrote ... but ...").
Return one note per listed criterion, using its criterionId. JSON only.`;

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
          earnedSteps: criterion.expected.filter((s) => !result.missingSteps.includes(s)),
          missingSteps: result.missingSteps,
          studentSaid: result.evidence?.quote ?? null,
          onTheirBoard: result.boardObservation ?? null,
          examinerFix: result.fix ?? null,
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
