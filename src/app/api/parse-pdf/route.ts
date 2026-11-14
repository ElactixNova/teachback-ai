import { NextResponse } from "next/server";
import type { CurriculumContext } from "@/types/session";

// T3 (PDF/vision): replace this stub. Accept multipart/form-data with a "file" PDF, extract text
// (unpdf or pdf-parse), return CurriculumContext.
export async function POST() {
  const body: CurriculumContext = {
    title: "Stub lecture notes",
    text: "Stub curriculum text. Replace with extracted PDF text.",
    pageCount: 1,
  };
  return NextResponse.json(body);
}
