"use client";

import { useEffect } from "react";
import {
  CircleAlert,
  CircleCheck,
  ClipboardList,
  Clock,
  Lightbulb,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import type { GapReport, KnowledgeGap } from "@/types/session";
import type { CheckStatus, VisualState } from "./types";

const SEVERITY: Record<KnowledgeGap["severity"], { label: string; className: string }> = {
  critical: { label: "Critical", className: "bg-red-100 text-red-700 ring-red-200" },
  major: { label: "Major", className: "bg-amber-100 text-amber-800 ring-amber-200" },
  minor: { label: "Minor", className: "bg-stone-100 text-stone-600 ring-stone-200" },
};

function ScoreRing({ score }: { score: number }) {
  const s = Math.max(0, Math.min(100, Math.round(score)));
  const r = 30;
  const c = 2 * Math.PI * r;
  const color = s >= 75 ? "#059669" : s >= 50 ? "#d97706" : "#dc2626";
  return (
    <div className="relative h-20 w-20 shrink-0" role="img" aria-label={`Understanding score ${s} out of 100`}>
      <svg viewBox="0 0 72 72" className="h-full w-full -rotate-90">
        <circle cx="36" cy="36" r={r} fill="none" stroke="#e7e5e4" strokeWidth="7" />
        <circle
          cx="36"
          cy="36"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - s / 100)}
          style={{ transition: "stroke-dashoffset 700ms ease-out" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-bold text-stone-900">{s}</span>
        <span className="-mt-1 text-[10px] uppercase tracking-wide text-stone-400">/ 100</span>
      </div>
    </div>
  );
}

function VisualPlayer({ state, onRetry }: { state: VisualState | undefined; onRetry: () => void }) {
  if (!state) return null;
  if (state.status === "loading") {
    return (
      <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-stone-100 to-amber-50 text-stone-500">
        <LoaderCircle className="h-5 w-5 animate-spin" />
        <p className="text-xs">Generating a visual explainer with fal…</p>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">
        <span>{state.error}</span>
        <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 font-semibold hover:underline">
          <RefreshCw className="h-3 w-3" /> Retry
        </button>
      </div>
    );
  }
  const v = state.visual;
  return (
    <figure className="overflow-hidden rounded-xl border border-stone-200 bg-stone-50">
      {v.kind === "video" ? (
        <video src={v.url} controls autoPlay loop muted playsInline className="aspect-video w-full bg-black object-contain" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- fal URLs are remote and arbitrary
        <img src={v.url} alt="Visual explainer" className="aspect-video w-full object-contain" />
      )}
      <figcaption className="flex items-center justify-between gap-2 px-3 py-1.5 text-[11px] text-stone-500">
        <span className="truncate">
          {v.kind === "video" ? "Video" : "Image"} · {v.model}
          {v.fallback ? " · fast fallback" : ""}
        </span>
        <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 hover:text-stone-800" title="Regenerate">
          <RefreshCw className="h-3 w-3" />
        </button>
      </figcaption>
    </figure>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
  report: GapReport | null;
  checkStatus: CheckStatus;
  checkError: string | null;
  visuals: Record<string, VisualState>;
  onGenerateVisual: (gapId: string) => void;
  onToggleStep: (stepId: string) => void;
  onRecheck: () => void;
}

export function ReportDrawer({
  open,
  onClose,
  report,
  checkStatus,
  checkError,
  visuals,
  onGenerateVisual,
  onToggleStep,
  onRecheck,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const totalMinutes = report?.studyPlan.reduce((n, s) => n + (s.done ? 0 : s.estimatedMinutes), 0) ?? 0;

  return (
    <>
      <div
        className={`fixed inset-0 z-30 bg-stone-950/30 backdrop-blur-[2px] transition-opacity ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
        aria-hidden
      />
      <aside
        className={`fixed inset-y-0 right-0 z-40 flex w-full max-w-[520px] flex-col bg-stone-50 shadow-2xl transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="Knowledge Gap Report"
        aria-hidden={!open}
        inert={!open}
      >
        <header className="flex items-center justify-between border-b border-stone-200 bg-white px-5 py-3">
          <div>
            <h2 className="text-base font-semibold text-stone-900">Knowledge Gap Report</h2>
            <p className="text-xs text-stone-500">Your explanation, checked against your notes</p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onRecheck}
              disabled={checkStatus === "checking"}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-100 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${checkStatus === "checking" ? "animate-spin" : ""}`} /> Re-check
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-stone-500 hover:bg-stone-100 hover:text-stone-900"
              aria-label="Close report"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {checkStatus === "checking" && !report && (
            <div className="flex flex-col items-center gap-3 py-16 text-center text-stone-500">
              <LoaderCircle className="h-6 w-6 animate-spin" />
              <p className="text-sm">Comparing your explanation and whiteboard with the notes…</p>
            </div>
          )}

          {checkError && (
            <div className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{checkError}</span>
            </div>
          )}

          {!report && checkStatus !== "checking" && !checkError && (
            <p className="py-16 text-center text-sm text-stone-500">
              Explain a topic, sketch on the whiteboard, then hit <strong>Snap &amp; Check</strong>.
            </p>
          )}

          {report && (
            <>
              {/* Summary */}
              <section className={`flex items-center gap-4 rounded-2xl bg-white p-4 shadow-sm ${checkStatus === "checking" ? "opacity-60" : ""}`}>
                <ScoreRing score={report.score} />
                <p className="text-sm leading-relaxed text-stone-700">{report.summary}</p>
              </section>

              {/* Strengths */}
              {report.strengths.length > 0 && (
                <section>
                  <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-700">
                    <CircleCheck className="h-3.5 w-3.5" /> You nailed
                  </h3>
                  <ul className="flex flex-wrap gap-1.5">
                    {report.strengths.map((s, i) => (
                      <li key={i} className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200">
                        {s}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Gaps */}
              <section>
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber-700">
                  <TriangleAlert className="h-3.5 w-3.5" /> Knowledge gaps ({report.gaps.length})
                </h3>
                {report.gaps.length === 0 ? (
                  <p className="rounded-xl bg-white p-3 text-sm text-stone-600 shadow-sm">No gaps found. Great teaching!</p>
                ) : (
                  <ol className="space-y-3">
                    {report.gaps.map((g) => {
                      const sev = SEVERITY[g.severity] ?? SEVERITY.minor;
                      const visual = visuals[g.id];
                      return (
                        <li key={g.id} className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
                          <div className="flex items-start justify-between gap-2">
                            <h4 className="font-semibold text-stone-900">{g.concept}</h4>
                            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${sev.className}`}>
                              {sev.label}
                            </span>
                          </div>
                          <div className="space-y-2 text-sm">
                            <p className="text-stone-600">
                              <span className="font-medium text-red-700">You said: </span>
                              {g.misconception}
                            </p>
                            <p className="flex gap-1.5 text-stone-700">
                              <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                              <span>{g.correction}</span>
                            </p>
                          </div>
                          {visual ? (
                            <VisualPlayer state={visual} onRetry={() => onGenerateVisual(g.id)} />
                          ) : (
                            <button
                              type="button"
                              onClick={() => onGenerateVisual(g.id)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 px-2.5 py-1.5 text-xs font-medium text-stone-700 hover:border-amber-400 hover:bg-amber-50"
                            >
                              <Sparkles className="h-3.5 w-3.5 text-amber-500" /> Show me visually
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </section>

              {/* Study plan */}
              {report.studyPlan.length > 0 && (
                <section>
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-stone-600">
                      <ClipboardList className="h-3.5 w-3.5" /> Study plan
                    </h3>
                    <span className="inline-flex items-center gap-1 text-xs text-stone-500">
                      <Clock className="h-3 w-3" /> {totalMinutes} min left
                    </span>
                  </div>
                  <ul className="divide-y divide-stone-100 overflow-hidden rounded-2xl bg-white shadow-sm">
                    {report.studyPlan.map((s) => (
                      <li key={s.id}>
                        <label className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-stone-50">
                          <input
                            type="checkbox"
                            checked={!!s.done}
                            onChange={() => onToggleStep(s.id)}
                            className="mt-0.5 h-4 w-4 shrink-0 accent-amber-500"
                          />
                          <div className="min-w-0 flex-1">
                            <p className={`text-sm font-medium ${s.done ? "text-stone-400 line-through" : "text-stone-900"}`}>{s.title}</p>
                            <p className={`text-xs ${s.done ? "text-stone-300" : "text-stone-500"}`}>{s.detail}</p>
                          </div>
                          <span className="shrink-0 text-xs text-stone-400">{s.estimatedMinutes}m</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  );
}
