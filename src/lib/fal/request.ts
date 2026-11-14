// Pure helper (safe in client code): builds the /api/generate-visual request for a criterion that lost marks.
import type { Criterion, CriterionResult, VisualRequest } from "@/types/session";

/**
 * Concept = the criterion title; misconception = what the student actually said (a verbatim quote),
 * and the prompt asks for the missing steps to be drawn correctly and labelled.
 */
export function visualRequestForCriterion(criterion: Criterion, result: CriterionResult, topic?: string): VisualRequest {
  const steps = result.missingSteps.length > 0 ? result.missingSteps : criterion.expected;
  const said = result.evidence?.quote;
  const earned = criterion.expected.filter((s) => !result.missingSteps.includes(s));
  return {
    concept: criterion.title,
    misconception: said ? `The student said: "${said}"` : "The student has not explained this yet.",
    visualPrompt:
      `Clean educational diagram${topic ? ` for ${topic}` : ""} about "${criterion.title}". ` +
      `It must correctly show and label these points: ${steps.map((s, i) => `(${i + 1}) ${s}`).join("; ")}.` +
      (earned.length > 0 ? ` Show these as already understood, in a calm colour with a tick: ${earned.join("; ")}.` : "") +
      ` Draw the missing points above in a strong orange highlight so a student sees at a glance what they left out.` +
      (result.boardObservation ? ` The student's own drawing showed: ${result.boardObservation.slice(0, 200)}. Correct whatever was wrong in it.` : ""),
  };
}
