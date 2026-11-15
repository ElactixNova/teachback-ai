// T28: "Download transcript": the RAW session transcript as plain text, so a tester can paste it back to the team.
// Pure formatting (unit-tested in transcriptExport.test.mjs) plus a tiny browser download helper.

export interface ExportLine {
  speaker: "student" | "avatar" | "system";
  /** The raw text as it was said or typed (never the cleaned or LaTeX display form). */
  text: string;
  /** "mm:ss" from the start of the session. */
  t: string;
}

export interface TranscriptExport {
  topic?: string;
  date: Date;
  /** The latest mark, when the session has one. `final: false` = from a mid-session "Check my progress". */
  mark?: { awarded: number; total: number; final?: boolean };
  lines: ExportLine[];
  /** Raw avatar stream and private notes (see lib/anam/diag), appended after the transcript for debugging. */
  debug?: string[];
}

const pad = (n: number) => String(n).padStart(2, "0");
/** Local "yyyy-mm-dd" and "hh:mm". */
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** feynman-<topic>-<yyyy-mm-dd-hhmm>.txt, with the topic as a short ASCII slug ("session" when there is none). */
export function transcriptFileName(topic: string | undefined, date: Date): string {
  const slug =
    (topic ?? "")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 40)
      .replace(/^-+|-+$/g, "") || "session";
  return `feynman-${slug}-${ymd(date)}-${hm(date).replace(":", "")}.txt`;
}

/** Header, a blank line, then one line per turn: "[mm:ss] Sam: ..." / "[mm:ss] You: ...". System lines are left out. */
export function formatTranscript({ topic, date, mark, lines, debug }: TranscriptExport): string {
  const head = ["Feynman AI session transcript", `Topic: ${topic?.trim() || "(none)"}`, `Date: ${ymd(date)} ${hm(date)}`];
  if (mark) {
    const pct = mark.total ? ` (${Math.round((mark.awarded / mark.total) * 100)}%)` : "";
    head.push(`${mark.final === false ? "Mark at last check" : "Final mark"}: ${mark.awarded} / ${mark.total}${pct}`);
  }
  const turns = lines
    .filter((l) => l.speaker !== "system")
    .map((l) => ({ ...l, text: l.text.replace(/\s+/g, " ").trim() }))
    .filter((l) => l.text)
    .map((l) => `[${l.t}] ${l.speaker === "student" ? "You" : "Sam"}: ${l.text}`);
  const raw = debug?.length ? ["", "--- Debug: raw avatar stream and private notes (time since the session began) ---", ...debug, ""] : [];
  return [...head, "", ...(turns.length ? turns : ["(no lines yet)"]), "", ...raw].join("\n");
}

/** Browser only: save `text` as a UTF-8 .txt file. */
export function downloadText(fileName: string, text: string) {
  const url = URL.createObjectURL(new Blob(["﻿", text], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
