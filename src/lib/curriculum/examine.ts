// The examiner (T9): marks a spoken explanation against a mark scheme, and drafts mark schemes from notes.
import { z } from "zod";
import type { AnalyzeRequest, GapReport, LiveAnalyzeResponse, MarkScheme, MarkSchemeRequest, TimedLine } from "@/types/session";
import { buildMarkScheme, buildReport, gradeAll } from "./grade";
import { LIVE_MODEL, MODEL, generateJson } from "./llm";

// ---------- marking ----------

const RawResultSchema = z.object({
  criterionId: z.string(),
  status: z.enum(["full", "partial", "missed", "not_covered", "in_progress"]),
  awarded: z.number(),
  evidence: z.object({ quote: z.string() }).nullable(),
  boardObservation: z.string().nullable(),
  said: z.string().nullable(),
  boardUnfinished: z.boolean().nullable(),
  missingSteps: z.array(z.string()),
  fix: z.string().nullable(),
});
const LiveSchema = z.object({ results: z.array(RawResultSchema) });
const FinalSchema = LiveSchema.extend({
  studyPlan: z.array(
    z.object({
      title: z.string(),
      detail: z.string(),
      estimatedMinutes: z.number(),
      criterionId: z.string().nullable(),
    }),
  ),
});

const EXAMINER_PROMPT = `You are a fair, encouraging examiner (think GCSE/A-level mark scheme with benefit of the doubt) marking a student's spoken explanation against a mark scheme.
Inputs: MARK_SCHEME (JSON), TRANSCRIPT (timestamped), WHITEBOARD (image), MODE.
Rules:
- Award a mark for an \`expected\` step only if the student stated it, or the whiteboard shows it, explicitly and correctly. Do not give credit for an implied step or a correct final answer without the reasoning.
- If the student corrected themselves, mark their best final version, but mention the earlier error in \`fix\`.
- status: full = all marks; partial = some; missed = they addressed the criterion but earned 0; not_covered = never addressed; in_progress = currently being explained (MODE=live only).
- evidence.quote must be copied verbatim from a Student line in TRANSCRIPT. Never invent quotes. It must be the line where the student ACTUALLY MADE the point (the clearest, usually the earliest, statement of it), never a later line that only refers back to it ("I already did that", "as I said", "like I just said"). If the only relevant line is a back-reference, find the earlier line it refers to. If there is no line that really makes the point, omit evidence.
- Read the WHOLE transcript before deciding a step is missing: if the student says they already covered something, search the earlier lines and the whiteboard for it and award it if it was clearly made. Never set a fix that asks the student to do something they already did.
- boardObservation: describe only what is visibly on the whiteboard, including steps that are missing between lines. Transcribe equations and formulas exactly as written (for example "CO2 + H2O -> C6H12O6 + O2"), do not silently correct them.
- Indigo-outlined cards labelled "Sam" on the whiteboard are the question Sam wrote for the student. They are never the student's work: never award marks for them, never quote them, and never describe them in boardObservation or boardUnfinished as something the student wrote or drew. Judge only the student's own ink (black, blue, red or green strokes).
- Check the correctness of anything written, not just its presence. For a chemical equation, count the atoms of every element on each side: if they differ it is NOT balanced, so it earns no mark for a step that needs a balanced or correct equation, and \`fix\` must say which element is unbalanced. The same goes for wrong coefficients, units, signs or arithmetic. A step whose wording is only "states the equation" still needs the equation to be correct. If the handwriting is too unclear to check, say so in boardObservation and do not award the mark.
- If the student made a claim about a criterion that contradicts or misstates it (for example saying glucose is made in the roots when the criterion is about where photosynthesis happens), that criterion was addressed: status is missed (or partial if some steps were right), never not_covered. Quote the wrong claim as evidence and say in \`fix\` what was wrong.
- said: a short summary (one to three sentences, second person, past tense: "You said that...") of EVERYTHING the student said or wrote about this criterion across the WHOLE transcript and the whiteboard, not one sentence: include their correct points, their mistakes, any self-correction (say that they corrected themselves) and anything they left half-finished. Report only what they actually said or wrote: never invent, never add what they should have said (that goes in fix), never quote Sam. Write maths as $...$ LaTeX. Use null when they never addressed the criterion (not_covered).
- boardUnfinished: true when what is on the whiteboard looks unfinished or cut off, so the student is probably midway or thinking (an equation with no right-hand side or a trailing operator, a half-drawn diagram, a label with no arrow, a formula missing its last term); false when the board is empty or looks complete. Use the same value on every result.
- missingSteps: copy them verbatim from \`expected\`.
- fix: one or two sentences the student could say out loud to earn the missing marks. Don't lecture.
- Write every mathematical expression, equation, formula or chemical formula inside boardObservation and fix as LaTeX between single dollar signs, for example $x^2 + 5x + 6 = 0$ or $6CO_2 + 6H_2O \\to C_6H_{12}O_6 + 6O_2$. Use dollar signs for nothing else. Quotes in evidence and the steps in missingSteps stay exactly as given (no dollar signs added or removed).
- primaryGapId: the criterion with the most marks lost (ties: the earliest in the scheme).
- studyPlan: 3 steps, the first one tied to primaryGapId.
Return JSON only, matching the provided schema.

Additional details:
- Return exactly one result per criterion, using the criterion's id as criterionId, in mark-scheme order.
- \`awarded\` is the number of expected steps earned (each step is one mark). Use null for evidence, boardObservation and fix when they do not apply.
- Only the student's lines (marked "Student:") can earn marks. Avatar lines are context only.
- Marking standard: award the mark when the student's meaning is clearly right, even if the wording is informal, incomplete or uses different vocabulary ("sugar" for glucose, "gets energy from the sun" for absorbing light energy). Do not demand the exact phrasing of the mark scheme. Give the benefit of the doubt on a near-miss that shows the right idea; only withhold a mark when the idea is absent, wrong, or contradicts the scheme. Exceptions that stay strict: an equation must really be balanced and a number, unit or formula must really be correct.
- A step counts when it is said OR written/drawn on the board; a spoken equation counts if the student gives the formulas and the coefficients aloud.
- Be fair: a step is earned when the student's words or drawing clearly make that point, even if phrased differently from the mark scheme. Mark each step separately, so a criterion the student partly explained earns the marks for the steps they did make; do not award 0 to a criterion where some steps were clearly stated.
- In MODE=live, be generous: do not use "missed" for a criterion the student has only just started or may still return to; use "in_progress" or "not_covered" and keep any marks earned. Only MODE=final may conclude that a criterion was missed.
- In MODE=live, use "in_progress" for at most ONE criterion: the one the student is explaining in their most recent lines. Mark criteria they have already moved past as full or partial (missed only if they clearly gave a wrong answer), and give "in_progress" its marks earned so far. Criteria not yet discussed are "not_covered".
- In the studyPlan, set criterionId to the criterion each step addresses (null for a general step). In MODE=live return an empty studyPlan.`;

function formatTranscript(lines: TimedLine[]): string {
  if (lines.length === 0) return "(the student has said nothing yet)";
  return lines.map((l) => `[${l.t}] ${l.speaker === "student" ? "Student" : "Avatar"}: ${l.text}`).join("\n");
}

async function mark(req: AnalyzeRequest, model: string) {
  const final = req.mode === "final";
  return generateJson({
    model,
    system: EXAMINER_PROMPT,
    userText:
      `MODE: ${req.mode}\n\nMARK_SCHEME:\n${JSON.stringify({
        topic: req.markScheme.topic,
        criteria: req.markScheme.criteria.map(({ id, title, expected, marks }) => ({ id, title, expected, marks })),
      })}\n\nTRANSCRIPT:\n${formatTranscript(req.transcript)}\n\n` +
      (req.whiteboardBase64 ? "WHITEBOARD: the image above." : "WHITEBOARD: the student has drawn nothing."),
    image: req.whiteboardBase64 ? { pngBase64: req.whiteboardBase64 } : undefined,
    schema: final ? FinalSchema : LiveSchema,
    maxTokens: 6000,
  });
}

/** Live marking (every ~20s of new transcript): fast model, may return "in_progress". */
export async function examineLive(req: AnalyzeRequest): Promise<LiveAnalyzeResponse> {
  const raw = await mark(req, LIVE_MODEL);
  return { results: gradeAll(req.markScheme, raw.results, req.transcript, "live") };
}

/** Final marking when the student finishes: strongest model, never "in_progress". */
export async function examineFinal(req: AnalyzeRequest): Promise<GapReport> {
  const raw = (await mark(req, MODEL)) as z.infer<typeof FinalSchema>;
  const results = gradeAll(req.markScheme, raw.results, req.transcript, "final");
  return buildReport(req.markScheme, results, raw.studyPlan ?? []);
}

// ---------- mark scheme ----------

const SchemeSchema = z.object({
  topic: z.string(),
  criteria: z.array(
    z.object({
      title: z.string(),
      expected: z.array(z.string()),
      page: z.number(),
      label: z.string().nullable(),
      probe: z.string(),
      ask: z.enum(["say", "write", "draw"]),
    }),
  ),
});

const SCHEME_PROMPT = `You are an examiner writing a mark scheme from a student's lecture notes, for the topic they will teach back.
The notes contain page markers like [Page 2]. Use only what the notes say.
Rules:
- topic: a short descriptive title of what these notes actually teach (2 to 6 words, for example "Photosynthesis" or "Solving quadratic equations"), written from the content. Never use the file name or a lecture code.
- Write 4 to 7 criteria for the topic. Each criterion is one idea a student must explain, with a short title.
- \`expected\` lists the 2 to 5 mark-bearing steps for that criterion. Each step is one short, checkable statement of what a student must say or show, and is worth exactly 1 mark. No step may overlap another.
- When a step is an equation or formula, write the full correct form in the step and say "balanced" or "correct" explicitly, so it can be checked.
- Write every mathematical expression, equation or chemical formula in a title or step as LaTeX between single dollar signs (for example $ax^2 + bx + c = 0$), nothing else in dollar signs.
- Base every step on the notes. Do not add outside facts.
- \`page\` is the [Page N] number where the notes teach that criterion. Never invent a page number.
- \`label\` is a short section or lecture label from the notes (for example "Lecture 4"), or null.
- \`probe\` is the one question a curious student would ask to draw this criterion out of the teacher. It must point at the specific steps (name the thing to produce: "Can you write the balanced symbol equation for photosynthesis?", "Where exactly does the light reaction happen, and what goes in and out?") but must NEVER contain the answer or any expected step's content. Spoken style, ONE question about ONE thing, at most 18 words, no lists of sub-questions, in plain words only: no symbols, no dollar signs, no LaTeX (it is read aloud by a voice, so write 'x squared', never 'x^2'). Do not hint at common mistakes or wrong answers (never "why can not X do it?").
- \`ask\` is "write" when the best evidence is something written (an equation, formula, definition to copy, calculation), "draw" when it is a diagram or process (stages, cycle, apparatus), otherwise "say". Use "write" or "draw" for roughly a third of the criteria, never all.
- Order criteria in the order a good explanation would present them.
Return JSON only, matching the schema.`;

/** Drafts a mark scheme from the lecture text (right after upload). */
export async function draftMarkScheme(req: MarkSchemeRequest): Promise<MarkScheme> {
  const maxPage = Math.max(1, ...[...req.curriculumText.matchAll(/\[Page (\d+)\]/g)].map((m) => Number(m[1])));
  const draft = await generateJson({
    model: MODEL,
    system: SCHEME_PROMPT,
    cachedContext: `<lecture_notes>\n${req.curriculumText}\n</lecture_notes>`,
    userText: `Write the mark scheme for this topic: ${req.topic.trim() || "(choose the main topic of the notes)"}.`,
    schema: SchemeSchema,
    maxTokens: 6000,
  });
  const scheme = buildMarkScheme(draft, { sourceFile: req.sourceFile, topic: req.topic, maxPage });
  if (scheme.criteria.length === 0) throw new Error("Could not build a mark scheme from these notes.");
  return scheme;
}
