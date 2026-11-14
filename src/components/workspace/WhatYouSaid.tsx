"use client";

// T25: "What you said" = the examiner's summary of everything the student said about a point (result.said),
// with their exact words and the mm:ss tucked into a small disclosure. Older reports (no `said`) show the quote.
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import type { CriterionResult } from "@/types/session";
import { MathText, SpokenMath } from "./MathText";

/** Summaries longer than this start clamped to four lines, with "Show more". */
const CLAMP_CHARS = 220;

export function WhatYouSaid({ result }: { result: CriterionResult }) {
  const [expanded, setExpanded] = useState(false);
  const said = result.said?.trim();
  const quote = result.evidence?.quote?.trim() ? result.evidence : undefined;
  const long = !!said && said.length > CLAMP_CHARS;

  return (
    <div className="min-w-0 rounded-xl bg-canvas p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
        What you said{!said && quote ? ` · ${quote.timestamp}` : ""}
      </p>

      {said ? (
        <>
          <p className={`mt-1.5 text-[15px] leading-6 ${long && !expanded ? "line-clamp-4" : ""}`}>
            <MathText text={said} />
          </p>
          {long && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className="mt-1 text-xs font-semibold text-accent hover:underline"
            >
              {expanded ? "Show less" : "Show more"}
            </button>
          )}
          {quote && (
            <details className="group mt-2 text-xs text-muted">
              <summary className="inline-flex cursor-pointer list-none items-center gap-1 font-semibold hover:text-ink [&::-webkit-details-marker]:hidden">
                <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" aria-hidden />
                Your exact words · <span className="tabular-nums">{quote.timestamp}</span>
              </summary>
              <blockquote className="mt-1 border-l-2 border-line pl-2 italic text-ink">
                “<SpokenMath text={quote.quote} />”
              </blockquote>
            </details>
          )}
        </>
      ) : quote ? (
        <blockquote className="mt-1.5 text-[15px] italic leading-6">
          “<SpokenMath text={quote.quote} />”
        </blockquote>
      ) : (
        <p className="mt-1.5 text-sm italic text-muted">You didn’t say anything about this yet.</p>
      )}
    </div>
  );
}
