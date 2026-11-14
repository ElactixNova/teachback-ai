import Anthropic from "@anthropic-ai/sdk";
import type { LegacyAnalyzeRequest, LegacyGapReport } from "@/types/session";
import { normalizeReport, type RawGapReport } from "./report";

const MODEL = process.env.ANALYZE_MODEL ?? "claude-opus-5-5";

const INSTRUCTIONS = `You are the evaluator inside TeachBack AI, a study app built on the Feynman technique. A student uploaded their lecture notes, then explained one topic from them out loud to an avatar while sketching on a whiteboard. Your job is to compare what the student said and drew against the notes and report where their understanding is solid and where it has gaps.

What you receive:
- The lecture notes, inside <lecture_notes>. They are the only ground truth. Judge the student against what the notes say, not against outside knowledge, and base every correction on the notes.
- A speech-to-text transcript of the session. It can contain transcription errors and may include the avatar's turns as well as the student's. Evaluate only what the student said, and read obvious mis-transcriptions charitably.
- Optionally a PNG of the whiteboard. It is handwriting and may be messy. Use what you can read with confidence; never report a gap because something was illegible.

The notes usually cover more than the student set out to explain. Work out which topic the student was teaching and assess that topic only. Something the student left out counts as a gap only if the topic cannot be understood without it.

Report only gaps you can point to: a statement or drawing that contradicts the notes, or one too vague to show understanding. If the explanation is correct, return no gaps; an invented gap does more harm than a short report. If the student said too little to assess, say so in the summary and return no gaps.

Your output is shown directly to the student in a report panel, and the concept and misconception of each gap are also used to generate a visual explainer. So write to the student as "you", keep each field to one or two plain sentences, and name each concept the way the notes do.

Fields:
- strengths: concepts the student explained correctly, one short phrase each.
- gaps: for each one, the concept, the misconception (what the student said or drew), the correction (what the notes say instead, quoting or pointing to the relevant part), and a severity: "minor" for an imprecision, "major" for a wrong idea about one concept, "critical" for an error that breaks understanding of the whole topic. Give gaps the ids "gap-1", "gap-2", and so on, most severe first.
- studyPlan: concrete steps that would close the gaps, each with a realistic estimate in minutes and the gapId it addresses (null for a general step). Ids "step-1", "step-2", and so on.
- score: 0 to 100 for how well the student understands the topic they explained.
- summary: two or three sentences on where the student stands.`;

const NO_NOTES = `The student has not uploaded lecture notes for this session, so there is no <lecture_notes> block and the instructions about the notes do not apply. Judge the explanation against well-established knowledge of the subject instead, base each correction on that, and report only gaps you are confident about. Say in the summary that the explanation was checked against general knowledge because no notes were uploaded.`;

const str = { type: "string" } as const;
const GAP_REPORT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["strengths", "gaps", "studyPlan", "score", "summary"],
  properties: {
    strengths: { type: "array", items: str },
    gaps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "concept", "misconception", "correction", "severity"],
        properties: {
          id: str,
          concept: str,
          misconception: str,
          correction: str,
          severity: { type: "string", enum: ["minor", "major", "critical"] },
        },
      },
    },
    studyPlan: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "detail", "estimatedMinutes", "gapId"],
        properties: {
          id: str,
          title: str,
          detail: str,
          estimatedMinutes: { type: "integer" },
          gapId: { anyOf: [str, { type: "null" }] },
        },
      },
    },
    score: { type: "integer" },
    summary: str,
  },
} as const;

/** Compares the student's explanation (transcript + optional whiteboard) with the lecture notes. */
export async function analyzeExplanation({ transcript, curriculumText, whiteboard }: LegacyAnalyzeRequest): Promise<LegacyGapReport> {
  const client = new Anthropic();
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    // Low effort: the student waits on this during a live demo. Raise it if reports miss real gaps.
    output_config: { effort: "low", format: { type: "json_schema", schema: GAP_REPORT_SCHEMA } },
    // If a safety classifier declines the request, the API re-runs it on a fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [
      { type: "text", text: INSTRUCTIONS },
      curriculumText
        ? // Cached: the notes stay the same across every check in a session.
          { type: "text", text: `<lecture_notes>\n${curriculumText}\n</lecture_notes>`, cache_control: { type: "ephemeral" } }
        : { type: "text", text: NO_NOTES },
    ],
    messages: [
      {
        role: "user",
        content: [
          ...(whiteboard?.pngBase64
            ? [
                {
                  type: "image" as const,
                  source: {
                    type: "base64" as const,
                    media_type: "image/png" as const,
                    data: whiteboard.pngBase64.replace(/^data:image\/png;base64,/, ""),
                  },
                },
              ]
            : []),
          {
            type: "text" as const,
            text: `<transcript>\n${transcript || "(the student said nothing)"}\n</transcript>\n\n${
              whiteboard?.pngBase64 ? "The image above is the student's whiteboard." : "The student drew nothing on the whiteboard."
            }`,
          },
        ],
      },
    ],
  });

  if (response.stop_reason !== "end_turn") throw new Error(`Analysis did not finish (${response.stop_reason}).`);
  const text = response.content.find((block) => block.type === "text")?.text;
  if (!text) throw new Error("Analysis returned no report.");
  return normalizeReport(JSON.parse(text) as RawGapReport);
}
