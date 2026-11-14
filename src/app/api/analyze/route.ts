import { NextResponse } from "next/server";
import type { GapReport } from "@/types/session";

// T3 (PDF/vision): replace this stub. Body is AnalyzeRequest { transcript, curriculumText, whiteboard? }.
// Call a multimodal model server-side and return strict JSON matching GapReport.
export async function POST() {
  const body: GapReport = {
    strengths: ["Stub strength"],
    gaps: [
      {
        id: "gap-1",
        concept: "Stub concept",
        misconception: "Stub misconception",
        correction: "Stub correction from the notes",
        severity: "major",
      },
    ],
    studyPlan: [
      { id: "step-1", title: "Stub step", detail: "Review the stub concept", estimatedMinutes: 10, gapId: "gap-1" },
    ],
    score: 50,
    summary: "Stub report. Replace with a real analysis.",
  };
  return NextResponse.json(body);
}
