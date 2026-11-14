import { NextResponse } from "next/server";
import { extractText } from "unpdf";
import type { ApiError, CurriculumContext } from "@/types/session";

const MAX_BYTES = 20 * 1024 * 1024;

const fail = (status: number, error: string) => NextResponse.json<ApiError>({ error }, { status });

/** multipart/form-data with a "file" PDF -> CurriculumContext. */
export async function POST(req: Request) {
  const file = (await req.formData().catch(() => null))?.get("file");
  if (!(file instanceof File)) return fail(400, 'Upload a PDF in the "file" field.');
  if (file.size > MAX_BYTES) return fail(413, "That PDF is larger than 20 MB.");

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") return fail(400, "That file is not a PDF.");

  let extracted: { text: string; totalPages: number };
  try {
    extracted = await extractText(bytes, { mergePages: true });
  } catch (err) {
    console.error("parse-pdf failed", err);
    return fail(422, "Could not read that PDF.");
  }

  const text = extracted.text.trim();
  // shortcut: no OCR, so scanned or handwritten PDFs are rejected; add OCR if real notes need it.
  if (!text) return fail(422, "No text found in that PDF. Scanned notes are not supported, upload a text PDF.");

  return NextResponse.json<CurriculumContext>({
    title: file.name.replace(/\.pdf$/i, ""),
    text,
    pageCount: extracted.totalPages,
  });
}
