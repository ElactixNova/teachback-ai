// Thin typed fetch helpers for the workspace UI. All keys stay in the server routes.
import type { ApiError, CurriculumContext, MarkScheme, MarkSchemeRequest } from "@/types/session";

async function readJson<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => null)) as T | ApiError | null;
  if (!res.ok) {
    const msg = body && typeof body === "object" && "error" in body ? body.error : `Request failed (${res.status})`;
    throw new Error(msg);
  }
  if (body === null) throw new Error("Empty response from server");
  return body as T;
}

const postJson = async <T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> =>
  readJson<T>(
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    }),
  );

export async function parsePdf(file: File): Promise<CurriculumContext> {
  const form = new FormData();
  form.append("file", file);
  return readJson<CurriculumContext>(await fetch("/api/parse-pdf", { method: "POST", body: form }));
}

export const fetchMarkScheme = (req: MarkSchemeRequest) => postJson<MarkScheme>("/api/mark-scheme", req);

/** SVG markup as an <img> source (never inject it into the DOM). */
export function svgDataUri(svg: string): string {
  const bytes = new TextEncoder().encode(svg);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `data:image/svg+xml;base64,${btoa(bin)}`;
}
