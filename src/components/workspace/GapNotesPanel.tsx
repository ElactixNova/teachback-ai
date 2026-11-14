"use client";

import { ArrowLeft, CircleCheck, ImageOff, LoaderCircle, RefreshCw, Sparkles, Square, SquareCheck } from "lucide-react";
import type { Criterion, CriterionResult, GapReport, MarkScheme } from "@/types/session";
import { MarksPill, SourceChip, StatusIcon, WORST_FIRST, displayStatus } from "./status";
import type { VisualState } from "./types";

export type CheckState = { status: "idle" } | { status: "checking" } | { status: "error"; error: string };

interface Props {
  scheme: MarkScheme | null;
  report: GapReport | null;
  check: CheckState;
  visuals: Record<string, VisualState>;
  onBack: () => void;
  onRecheck: () => void;
  onTeachNext: (criterionIds: string[]) => void;
  onRetryVisual: (criterionId: string) => void;
  onToggleStep: (stepId: string) => void;
}

/** A criterion that lost marks, with its result. */
export interface Gap {
  criterion: Criterion;
  result: CriterionResult;
}

/** Partial, missed and parked criteria, worst first (primary gap always first). */
export function gapsOf(scheme: MarkScheme, report: GapReport): Gap[] {
  const byId = new Map(report.results.map((r) => [r.criterionId, r]));
  return scheme.criteria
    .map((criterion) => ({ criterion, result: byId.get(criterion.id) }))
    .filter((g): g is Gap => {
      const s = displayStatus(g.result);
      return s === "partial" || s === "missed" || s === "parked";
    })
    .sort((a, b) => {
      if (a.criterion.id === report.primaryGapId) return -1;
      if (b.criterion.id === report.primaryGapId) return 1;
      const lost = (g: Gap) => g.criterion.marks - g.result.awarded;
      return WORST_FIRST[displayStatus(a.result)] - WORST_FIRST[displayStatus(b.result)] || lost(b) - lost(a);
    });
}

export function VisualSlot({ state, alt, onRetry, compact }: { state: VisualState | undefined; alt: string; onRetry: () => void; compact?: boolean }) {
  const box = `flex ${compact ? "aspect-[4/3]" : "aspect-video"} w-full flex-col items-center justify-center gap-2 rounded-xl border border-line bg-canvas p-4 text-center text-xs text-muted`;
  if (!state || state.status === "loading" || state.status === "idle") {
    return (
      <div className={box} aria-busy>
        <LoaderCircle className="h-5 w-5 animate-spin text-accent" />
        <span className="font-semibold">Drawing an accurate diagram… about 20 seconds</span>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className={box}>
        <ImageOff className="h-5 w-5" />
        <span>{state.error}</span>
        <button type="button" onClick={onRetry} className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-line bg-card px-3 font-bold text-ink hover:bg-canvas">
          <RefreshCw className="h-3.5 w-3.5" /> Try again
        </button>
      </div>
    );
  }
  const v = state.data;
  return v.kind === "video" ? (
    <video src={v.url} controls autoPlay muted loop playsInline className="w-full rounded-xl border border-line bg-black" />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element -- remote fal URL, not worth next/image config
    <img src={v.url} alt={alt} className="w-full rounded-xl border border-line bg-white object-contain" />
  );
}

function GapCard({ gap, primary, file, visual, onRetryVisual }: { gap: Gap; primary: boolean; file?: string; visual?: VisualState; onRetryVisual: () => void }) {
  const { criterion: c, result: r } = gap;
  const s = displayStatus(r);
  const missing = new Set(r.missingSteps);
  return (
    <article className={`rounded-2xl border bg-card p-4 sm:p-5 ${primary ? "border-accent ring-1 ring-accent" : "border-line"}`}>
      <header className="flex items-start gap-3">
        <StatusIcon status={s} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          {primary && <p className="text-[11px] font-bold uppercase tracking-wider text-accent">Biggest gap</p>}
          <h3 className="font-extrabold leading-snug">{c.title}</h3>
          {s === "parked" && <p className="text-xs font-semibold text-parked">Parked after 2 tries</p>}
        </div>
        <MarksPill result={r} criterion={c} />
      </header>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-xl bg-canvas p-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted">
            What you said{r.evidence ? ` · ${r.evidence.timestamp}` : ""}
          </p>
          {r.evidence ? (
            <blockquote className="mt-1.5 text-sm leading-relaxed">“{r.evidence.quote}”</blockquote>
          ) : (
            <p className="mt-1.5 text-sm italic text-muted">You didn’t say anything about this.</p>
          )}
        </div>
        <div className="rounded-xl bg-canvas p-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted">What the mark scheme wants</p>
          <ul className="mt-1.5 space-y-1 text-sm leading-relaxed">
            {c.expected.map((e) => (
              <li key={e} className="flex gap-2">
                {missing.has(e) ? (
                  <Square className="mt-1 h-3.5 w-3.5 shrink-0 text-missed" aria-label="Not earned" />
                ) : (
                  <SquareCheck className="mt-1 h-3.5 w-3.5 shrink-0 text-accent" aria-label="Earned" />
                )}
                <span className={missing.has(e) ? "" : "text-muted"}>{e}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {(r.boardObservation || r.fix) && (
        <dl className="mt-3 space-y-2 text-sm leading-relaxed">
          {r.boardObservation && (
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-wider text-muted">On your board</dt>
              <dd>{r.boardObservation}</dd>
            </div>
          )}
          {r.fix && (
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-wider text-accent">How to close it</dt>
              <dd className="font-semibold">{r.fix}</dd>
            </div>
          )}
        </dl>
      )}

      <div className="mt-3">
        <SourceChip source={c.source} file={file} />
      </div>

      {primary && (
        <div className="mt-4">
          <VisualSlot state={visual} alt={`Diagram: ${c.title}`} onRetry={onRetryVisual} />
        </div>
      )}
    </article>
  );
}

export function GapNotesPanel({ scheme, report, check, visuals, onBack, onRecheck, onTeachNext, onRetryVisual, onToggleStep }: Props) {
  const checking = check.status === "checking";
  const gaps = scheme && report ? gapsOf(scheme, report) : [];
  const notCovered = scheme && report ? scheme.criteria.filter((c) => displayStatus(report.results.find((r) => r.criterionId === c.id)) === "not_covered") : [];
  const fullMarks = scheme && report ? scheme.criteria.filter((c) => report.results.find((r) => r.criterionId === c.id)?.status === "full") : [];
  const minutesLeft = report?.studyPlan.reduce((n, s) => n + (s.done ? 0 : s.estimatedMinutes), 0) ?? 0;

  return (
    <section aria-label="Gap notes" className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-card">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 sm:px-5">
        <div className="min-w-0 flex-1">
          {report ? (
            <>
              <p className="text-lg font-extrabold leading-tight tabular-nums">
                {report.awarded} / {report.total} marks
              </p>
              <p className="text-xs font-semibold text-muted">
                {gaps.length + notCovered.length === 0 ? "Nothing left to close" : `${gaps.length + notCovered.length} gaps to close`}
              </p>
            </>
          ) : (
            <p className="text-lg font-extrabold">Gap notes</p>
          )}
        </div>
        {report && (
          <button
            type="button"
            onClick={onRecheck}
            disabled={checking}
            className="inline-flex h-11 items-center gap-1.5 rounded-xl px-3 text-xs font-bold text-muted hover:bg-canvas hover:text-ink disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${checking ? "animate-spin" : ""}`} /> Re-check
          </button>
        )}
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-line px-3.5 text-sm font-bold hover:bg-canvas"
        >
          <ArrowLeft className="h-4 w-4" /> Back to whiteboard
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-canvas/60 p-4 sm:p-5">
        {checking && (
          <div className="flex items-center gap-3 rounded-2xl border border-line bg-card p-4" role="status">
            <LoaderCircle className="h-5 w-5 animate-spin text-accent" />
            <div>
              <p className="text-sm font-bold">Marking against your mark scheme…</p>
              <p className="text-xs text-muted">Checking every point with quotes from what you said. About 15 seconds.</p>
            </div>
          </div>
        )}

        {check.status === "error" && (
          <div className="rounded-2xl border border-missed/30 bg-missed-soft p-4 text-sm" role="alert">
            <p className="font-bold text-missed">The check didn’t finish</p>
            <p className="mt-0.5">{check.error}</p>
            <button type="button" onClick={onRecheck} className="mt-2 inline-flex h-11 items-center gap-1.5 rounded-xl border border-line bg-card px-3 text-xs font-bold hover:bg-canvas">
              <RefreshCw className="h-3.5 w-3.5" /> Try again
            </button>
          </div>
        )}

        {!report && !checking && check.status !== "error" && (
          <p className="text-sm text-muted">Explain the topic, then press Snap &amp; Check to see your marks point by point.</p>
        )}

        {report &&
          scheme &&
          gaps.map((g) => (
            <GapCard
              key={g.criterion.id}
              gap={g}
              primary={g.criterion.id === report.primaryGapId}
              file={scheme.sourceFile}
              visual={visuals[g.criterion.id]}
              onRetryVisual={() => onRetryVisual(g.criterion.id)}
            />
          ))}

        {report && notCovered.length > 0 && (
          <article className="rounded-2xl border border-dashed border-line bg-card p-4 sm:p-5">
            <h3 className="font-extrabold">Not covered yet</h3>
            <ul className="mt-2 space-y-1.5 text-sm">
              {notCovered.map((c) => (
                <li key={c.id} className="flex items-center gap-2">
                  <StatusIcon status="not_covered" />
                  <span className="flex-1">{c.title}</span>
                  <span className="text-xs font-bold text-faint">{c.marks} marks</span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => onTeachNext(notCovered.map((c) => c.id))}
              className="mt-3 inline-flex h-11 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-bold text-white hover:bg-accent-strong"
            >
              <Sparkles className="h-4 w-4" /> Teach these next
            </button>
          </article>
        )}

        {report && report.studyPlan.length > 0 && (
          <article className="rounded-2xl border border-line bg-card p-4 sm:p-5">
            <div className="flex items-baseline justify-between">
              <h3 className="font-extrabold">Study plan</h3>
              <span className="text-xs font-semibold text-muted">{minutesLeft} min left</span>
            </div>
            <ul className="mt-2 space-y-1">
              {report.studyPlan.map((s) => (
                <li key={s.id}>
                  <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl p-2 hover:bg-canvas">
                    <input type="checkbox" checked={!!s.done} onChange={() => onToggleStep(s.id)} className="mt-1 h-4 w-4 accent-[var(--color-accent)]" />
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm font-bold ${s.done ? "text-faint line-through" : ""}`}>{s.title}</span>
                      <span className="block text-xs text-muted">{s.detail}</span>
                    </span>
                    <span className="shrink-0 text-xs font-semibold text-faint">{s.estimatedMinutes} min</span>
                  </label>
                </li>
              ))}
            </ul>
          </article>
        )}

        {report && fullMarks.length > 0 && (
          <p className="flex items-start gap-2 px-1 text-sm text-muted">
            <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <span>
              <span className="font-bold text-ink">Full marks:</span> {fullMarks.map((c) => c.title).join(" · ")}
            </span>
          </p>
        )}
      </div>
    </section>
  );
}
