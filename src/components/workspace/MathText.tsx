"use client";

// T19: render text with $...$ / $$...$$ LaTeX spans via KaTeX. Display only: callers keep the raw text as the
// source of truth (evidence quotes and the transcript stay verbatim spoken words).
import "katex/dist/katex.min.css";
import katex from "katex";
import { Fragment, memo, useEffect, useMemo, useSyncExternalStore } from "react";
import { spokenToLatex } from "@/lib/math/spoken";
import { hasMath, looksMathy, parseMath } from "./math";

// trust:false blocks \href, \url, \includegraphics and friends; strict:"ignore" accepts loose LaTeX quietly.
// throwOnError is true on purpose, inside try/catch: with false KaTeX shows a red error box, and the spec wants a
// failed span to fall back to its raw text.
const OPTIONS = { throwOnError: true, trust: false, strict: "ignore", output: "htmlAndMathml" } as const;

const rendered = new Map<string, string | null>();
function renderTex(tex: string, display: boolean): string | null {
  const key = `${display ? "D" : "I"}${tex}`;
  if (!rendered.has(key)) {
    let html: string | null = null;
    try {
      html = katex.renderToString(tex, { ...OPTIONS, displayMode: display });
    } catch {
      html = null;
    }
    rendered.set(key, html);
  }
  return rendered.get(key) ?? null;
}

interface Props {
  text: string;
  className?: string;
  /** Plain spoken form for screen readers (e.g. the raw transcript line). Defaults to KaTeX's own MathML. */
  spoken?: string;
}

/** Text with inline ($...$) and display ($$...$$) maths. Prose is rendered as text (React escapes it). */
export const MathText = memo(function MathText({ text, className, spoken }: Props) {
  const segments = useMemo(() => parseMath(text), [text]);
  if (!segments.some((s) => s.kind !== "text")) return <span className={className}>{text}</span>;
  const body = segments.map((s, i) => {
    if (s.kind === "text") return <Fragment key={i}>{s.value}</Fragment>;
    const html = renderTex(s.value, s.kind === "display");
    if (html === null) return <Fragment key={i}>{s.kind === "display" ? `$$${s.value}$$` : `$${s.value}$`}</Fragment>;
    return (
      <span
        key={i}
        // Long equations scroll inside their own box, never the page.
        className={
          s.kind === "display"
            ? "my-1 block max-w-full overflow-x-auto overflow-y-hidden py-1"
            : "inline-block max-w-full overflow-x-auto overflow-y-hidden align-middle"
        }
        // KaTeX output from trust:false rendering; prose never reaches this path.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  });
  if (!spoken) return <span className={className}>{body}</span>;
  return (
    <span className={className}>
      <span aria-hidden="true">{body}</span>
      <span className="sr-only">{spoken}</span>
    </span>
  );
});

// ---- Spoken maths -> LaTeX for display (POST /api/to-latex, Ali's T21) ---------------------------------

/** text -> LaTeX version, or null when there is none (no maths, failed, or the endpoint is missing). */
const latexCache = new Map<string, string | null>();
const requested = new Set<string>();
const listeners = new Set<() => void>();
const queue: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
// Matches POST /api/to-latex limits (src/lib/math/tolatex.ts: MAX_TEXTS 20, MAX_TEXT_CHARS 600). One over-long
// text would fail the whole batch with a 400, so longer lines are never sent.
const BATCH = 20;
const MAX_CHARS = 600;

function notify() {
  for (const l of listeners) l();
}

async function flush() {
  timer = null;
  const batch = queue.splice(0, BATCH);
  if (queue.length) timer = setTimeout(flush, 0);
  if (batch.length === 0) return;
  try {
    const res = await fetch("/api/to-latex", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts: batch }),
    });
    // The route answers { texts: string[] } (same order); accept { latex } too.
    const data = (await res.json().catch(() => null)) as { texts?: unknown; latex?: unknown } | null;
    const list = data?.texts ?? data?.latex;
    const out = res.ok && Array.isArray(list) ? (list as unknown[]) : [];
    batch.forEach((t, i) => {
      const l = out[i];
      latexCache.set(t, typeof l === "string" && l !== t && hasMath(l) ? l : null);
    });
  } catch {
    for (const t of batch) latexCache.set(t, null);
  }
  notify();
}

/** Ask for a LaTeX version of a spoken line, at most once per distinct text, batched. */
function requestLatex(text: string) {
  if (requested.has(text) || text.length > MAX_CHARS) return;
  requested.add(text);
  queue.push(text);
  if (!timer) timer = setTimeout(flush, 300);
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

/** T28: the instant local converter (Ali, T29), when it has a confident answer with real maths in it. */
function instantLatex(text: string): string | null {
  try {
    const l = spokenToLatex(text);
    return l && l !== text && hasMath(l) ? l : null;
  } catch {
    return null;
  }
}

/**
 * A spoken line (transcript, quote) shown with its maths typeset. The local converter answers at once; for what it
 * cannot handle, /api/to-latex is asked once per distinct text and the raw text shows until it answers. The raw
 * text stays the screen-reader text. Never blocks.
 *
 * `streaming`: the line is still being spoken (it changes on every chunk), so only the local converter is used:
 * sending every partial to the API would flood it.
 */
export function SpokenMath({ text, className, streaming = false }: { text: string; className?: string; streaming?: boolean }) {
  const mathy = useMemo(() => looksMathy(text), [text]);
  const instant = useMemo(() => (mathy ? instantLatex(text) : null), [mathy, text]);
  const remote = mathy && !instant && !streaming;
  useEffect(() => {
    if (remote) requestLatex(text);
  }, [remote, text]);
  const fetched = useSyncExternalStore(
    subscribe,
    () => (remote ? (latexCache.get(text) ?? null) : null),
    () => null,
  );
  const latex = instant ?? fetched;
  return <MathText text={latex ?? text} spoken={latex ? text : undefined} className={className} />;
}
