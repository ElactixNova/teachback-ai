"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ImageOff, LoaderCircle, RefreshCw, Sparkles } from "lucide-react";
import type { Criterion, CriterionResult, GapReport, MarkScheme, StudyStep } from "@/types/session";
import { SEVERITY, ScoreRing, SeverityTag, StatusIcon, WORST_FIRST, displayStatus, verdict } from "./status";
import type { VisualState } from "./types";
import { ZoomableImage } from "./ZoomableImage";
import { AskChip } from "./callouts";
import { MathText } from "./MathText";
import { WhatYouSaid } from "./WhatYouSaid";
import { plainMath } from "./math";

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
        <button type="button" onClick={onRetry} className="inline-flex h-11 items-center gap-1.5 rounded-full border border-line bg-card px-3 font-semibold text-ink hover:bg-canvas">
          <RefreshCw className="h-3.5 w-3.5" /> Try again
        </button>
      </div>
    );
  }
  const v = state.data;
  return v.kind === "video" ? (
    <video src={v.url} controls autoPlay muted loop playsInline className="w-full rounded-xl border border-line bg-black" />
  ) : (
    <ZoomableImage src={v.url} alt={alt} className="max-h-[60vh] w-full rounded-xl border border-line bg-white object-contain" />
  );
}

/** Figma Button (4:59): primary = the one main action, quiet = low emphasis. 36px tall, 44 on phone. */
const BTN = "inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold tracking-[-0.005em] transition disabled:opacity-50 sm:h-9";
const PRIMARY = `${BTN} bg-accent text-white hover:bg-accent-strong`;
const QUIET = `${BTN} text-muted hover:bg-canvas hover:text-ink`;
const OUTLINE = `${BTN} border border-line-strong bg-card text-ink hover:bg-sunk`;
/** Figma Meta/SemiBold section label. */
const LABEL = "text-xs font-semibold leading-4 text-faint";

/** A mark-scheme step as a plain sentence. */
const sentence = (t: string) => (/[.!?:$)]$/.test(t) ? t : `${t}.`);

/**
 * Figma Visual Explainer (11:150) inside a gap card: Idle ("Show me visually") -> Loading -> Image or Video; Error
 * offers Retry. Every gap starts loading on its own when the review opens; this button is the fallback (idle) and Retry.
 */
function SeeIt({ state, title, onRequest }: { state: VisualState | undefined; title: string; onRequest: () => void }) {
  const box = "flex min-h-[243px] w-full flex-col items-center justify-center gap-2 rounded-[4px] border-[1.5px] border-dashed border-line-strong bg-canvas p-4 text-center";
  if (!state || state.status === "idle") {
    return (
      <div className={box}>
        <button type="button" onClick={onRequest} className={OUTLINE}>
          {/* eslint-disable-next-line @next/next/no-img-element -- Figma Icon/spark (3:68), a static 16px SVG */}
          <img src="/icons/spark.svg" alt="" width={16} height={16} className="h-4 w-4" />
          Show me visually
        </button>
        <p className="text-sm text-faint">A short image or video built from your notes</p>
      </div>
    );
  }
  if (state.status === "loading") {
    return (
      <div className={box} aria-busy>
        <LoaderCircle className="h-5 w-5 animate-spin text-accent" aria-hidden />
        <p className="text-sm font-semibold text-muted">Drawing an accurate diagram… about 20 seconds</p>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className={box}>
        <ImageOff className="h-5 w-5 text-faint" aria-hidden />
        <p className="text-sm text-muted">{state.error}</p>
        <button type="button" onClick={onRequest} className={OUTLINE}>
          <RefreshCw className="h-4 w-4" aria-hidden /> Retry
        </button>
      </div>
    );
  }
  return (
    <figure className="w-full">
      {state.data.kind === "video" ? (
        <video src={state.data.url} controls autoPlay muted loop playsInline className="max-h-[360px] w-full rounded-[4px] bg-black outline outline-1 -outline-offset-1 outline-black/10" />
      ) : (
        <ZoomableImage src={state.data.url} alt={`Diagram: ${plainMath(title)}`} className="max-h-[360px] w-full rounded-[4px] bg-white object-contain outline outline-1 -outline-offset-1 outline-black/10" />
      )}
      <figcaption className="mt-1.5 text-xs text-faint">
        {state.data.kind === "video" ? "Video" : "Image"} · {state.data.model}
      </figcaption>
    </figure>
  );
}

/**
 * Figma Gap Card (11:245, as used in "D · One gap at a time" 84:805). Anatomy, always in this order: number + title
 * + severity · You said · The fix · See it · Practise it, with the severity stripe on the left.
 */
function GapCard({
  gap,
  index,
  step,
  stepNo,
  visual,
  onRequestVisual,
  onPractise,
}: {
  gap: Gap;
  index: number;
  step?: StudyStep;
  stepNo: number;
  visual?: VisualState;
  onRequestVisual: () => void;
  onPractise: () => void;
}) {
  const { criterion: c, result: r } = gap;
  const s = displayStatus(r);
  const missing = r.missingSteps.map((m) => m.trim()).filter(Boolean);
  return (
    <article aria-label={`Gap ${index + 1}: ${plainMath(c.title)}`} className="relative flex w-full flex-col gap-6 rounded-[14px] border border-line bg-card px-5 py-6 sm:px-8 sm:py-7">
      <span className={`absolute inset-y-[17px] -left-px w-[3px] rounded-r-[3px] ${SEVERITY[s]?.bar ?? "bg-line"}`} aria-hidden />
      <header className="flex items-center gap-2.5">
        <span className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-sunk text-xs font-semibold text-muted">{index + 1}</span>
        <h3 className="min-w-0 flex-1 text-base font-semibold leading-[22px] tracking-[-0.01em] text-ink">
          <MathText text={c.title} />
        </h3>
        <AskChip ask={c.ask} />
        <SeverityTag status={s} />
      </header>

      <WhatYouSaid result={r} />

      {r.boardObservation && (
        <section>
          <p className={LABEL}>On your board</p>
          <p className="mt-1.5 text-base leading-6 text-ink">
            <MathText text={r.boardObservation} />
          </p>
        </section>
      )}

      {(r.fix || missing.length > 0) && (
        <section>
          <p className={LABEL}>{r.fix ? "The fix" : "What the full answer needs"}</p>
          <p className="mt-1.5 text-base leading-6 tracking-[-0.005em] text-ink">
            {r.fix ? (
              <MathText text={r.fix} />
            ) : (
              missing.map((m, i) => (
                <span key={m}>
                  {i > 0 && " "}
                  <MathText text={sentence(m)} />
                </span>
              ))
            )}
          </p>
        </section>
      )}

      <section>
        <p className={LABEL}>See it</p>
        <div className="mt-1.5">
          <SeeIt state={visual} title={c.title} onRequest={onRequestVisual} />
        </div>
      </section>

      <section>
        <p className={LABEL}>Practise it</p>
        <button type="button" onClick={onPractise} className="mt-1.5 text-left text-sm font-medium leading-5 tracking-[-0.005em] text-accent hover:underline">
          {step ? (
            <>
              Step {stepNo} · <MathText text={step.title} /> · {step.estimatedMinutes} min
            </>
          ) : (
            "Teach this back to Sam"
          )}
        </button>
      </section>
    </article>
  );
}

export function GapNotesPanel({ scheme, report, check, visuals, onBack, onRecheck, onTeachNext, onRetryVisual, onToggleStep }: Props) {
  const checking = check.status === "checking";
  const gaps = scheme && report ? gapsOf(scheme, report) : [];
  const notCovered = scheme && report ? scheme.criteria.filter((c) => displayStatus(report.results.find((r) => r.criterionId === c.id)) === "not_covered") : [];
  const fullMarks = scheme && report ? scheme.criteria.filter((c) => report.results.find((r) => r.criterionId === c.id)?.status === "full") : [];
  const minutesLeft = report?.studyPlan.reduce((n, s) => n + (s.done ? 0 : s.estimatedMinutes), 0) ?? 0;
  const pct = report && report.total > 0 ? Math.round((report.awarded / report.total) * 100) : 0;

  // One gap at a time; the last page is the overview (score, not covered, study plan). A new report starts at gap 1.
  const [nav, setNav] = useState<{ report: GapReport | null; page: number }>({ report, page: 0 });
  const pages = gaps.length + 1;
  const page = nav.report === report ? Math.min(nav.page, pages - 1) : 0;
  const go = (p: number) => setNav({ report, page: Math.max(0, Math.min(pages - 1, p)) });
  const gap = page < gaps.length ? gaps[page] : null;
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [page]);

  const stepFor = (id: string) => {
    const plan = report?.studyPlan ?? [];
    const i = plan.findIndex((st) => st.gapId === id);
    return i >= 0 ? { step: plan[i], stepNo: i + 1 } : { step: undefined, stepNo: 0 };
  };

  return (
    <section aria-label="Gap notes" className="sheet @container flex h-full min-h-0 flex-col overflow-hidden">
      {/* Figma Report header (84:811): mark + titles, gap progress, actions. */}
      <header className="flex flex-wrap items-center gap-x-3.5 gap-y-2 border-b border-ink/8 bg-card/72 px-4 py-3.5 backdrop-blur-md sm:px-8">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- static brand SVG */}
          <img src="/brand-mark.svg" alt="" width={30} height={30} className="h-[30px] w-[30px] shrink-0" />
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold leading-[22px] tracking-[-0.01em] text-ink">{report ? "Knowledge Gap Report" : "Gap notes"}</h2>
            {scheme?.topic && <p className="truncate text-sm leading-5 text-faint">{scheme.topic}</p>}
          </div>
        </div>
        {gaps.length > 0 && (
          <nav aria-label="Gaps" className="order-last flex w-full items-center justify-center gap-1.5 @4xl:order-none @4xl:w-auto">
            {gaps.map((g, i) => (
              <button
                key={g.criterion.id}
                type="button"
                onClick={() => go(i)}
                aria-label={`Gap ${i + 1}: ${plainMath(g.criterion.title)}`}
                aria-current={i === page ? "step" : undefined}
                className="flex h-6 items-center"
              >
                <span className={`block h-1.5 rounded-full transition-all ${SEVERITY[displayStatus(g.result)]?.bar ?? "bg-line"} ${i === page ? "w-14" : "w-8 opacity-35 hover:opacity-60"}`} />
              </button>
            ))}
          </nav>
        )}
        <div className="flex w-full items-center justify-end gap-2 @lg:w-auto @lg:flex-1">
          {report && (
            <button type="button" onClick={onRecheck} disabled={checking} className={QUIET}>
              {checking ? (
                <>
                  <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> Checking…
                </>
              ) : (
                "Re-check"
              )}
            </button>
          )}
          <button type="button" onClick={onBack} className={PRIMARY}>
            Back to teaching
          </button>
        </div>
      </header>

      <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto bg-canvas">
        <div className="mx-auto flex w-full max-w-[760px] flex-col gap-5 px-4 pb-8 pt-6 sm:pt-10">
          {checking && (
            <div className="flex items-center gap-3 rounded-[14px] border border-line bg-card p-4" role="status">
              <LoaderCircle className="h-5 w-5 animate-spin text-accent" />
              <div>
                <p className="text-sm font-semibold">Marking against your mark scheme…</p>
                <p className="text-xs text-muted">Checking every point with quotes from what you said. About 15 seconds.</p>
              </div>
            </div>
          )}

          {check.status === "error" && (
            <div className="rounded-[14px] border border-missed/30 bg-missed-soft p-4 text-sm" role="alert">
              <p className="font-semibold text-missed">The check didn’t finish</p>
              <p className="mt-0.5">{check.error}</p>
              <button type="button" onClick={onRecheck} className={`${OUTLINE} mt-2`}>
                <RefreshCw className="h-4 w-4" aria-hidden /> Try again
              </button>
            </div>
          )}

          {!report && !checking && check.status !== "error" && (
            <p className="text-sm text-muted">Explain the topic, then press Check my progress to see your marks point by point.</p>
          )}

          {report && scheme && (
            <>
              <div className="flex items-center gap-3 text-sm leading-5 tracking-[-0.005em]">
                <p className="min-w-0 flex-1 font-medium text-faint" aria-live="polite">
                  {gap ? `Gap ${page + 1} of ${gaps.length}` : gaps.length ? "Overview and study plan" : "Overview"}
                </p>
                <p className="shrink-0 whitespace-nowrap" title={`${report.awarded} of ${report.total} marks`}>
                  <span className="font-semibold tabular-nums text-ink">{pct}</span>
                  <span className="text-faint"> · {verdict(report.awarded, report.total)}</span>
                </p>
              </div>

              {gap ? (
                <GapCard
                  key={gap.criterion.id}
                  gap={gap}
                  index={page}
                  {...stepFor(gap.criterion.id)}
                  visual={visuals[gap.criterion.id]}
                  onRequestVisual={() => onRetryVisual(gap.criterion.id)}
                  onPractise={() => onTeachNext([gap.criterion.id])}
                />
              ) : (
                <Overview
                  report={report}
                  gaps={gaps}
                  notCovered={notCovered}
                  nailed={fullMarks.map((c) => c.title)}
                  minutesLeft={minutesLeft}
                  onTeachNext={onTeachNext}
                  onToggleStep={onToggleStep}
                />
              )}

              {/* Figma Pager (84:891). */}
              <div className="flex items-start gap-2">
                <button type="button" onClick={() => go(page - 1)} disabled={page === 0} className={`${QUIET} disabled:invisible`}>
                  Previous
                </button>
                <span className="flex-1" />
                {page < pages - 1 && (
                  <button type="button" onClick={() => go(page + 1)} className={PRIMARY}>
                    {page < gaps.length - 1 ? "Next gap" : "Overview"}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/** The last page: score, what is not covered yet, and the study plan. */
function Overview({
  report,
  gaps,
  notCovered,
  nailed,
  minutesLeft,
  onTeachNext,
  onToggleStep,
}: {
  report: GapReport;
  gaps: Gap[];
  notCovered: Criterion[];
  nailed: string[];
  minutesLeft: number;
  onTeachNext: (ids: string[]) => void;
  onToggleStep: (id: string) => void;
}) {
  const n = (k: string) => gaps.filter((g) => displayStatus(g.result) === k).length;
  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-[14px] border border-line bg-card px-5 py-6 sm:px-8 sm:py-7">
        <ScoreSummary
          awarded={report.awarded}
          total={report.total}
          counts={{ missed: n("missed"), partial: n("partial"), parked: n("parked"), not_covered: notCovered.length }}
          nailed={nailed}
        />
      </div>

      {notCovered.length > 0 && (
        <article className="rounded-[14px] border border-dashed border-line-strong bg-card px-5 py-6 sm:px-8">
          <h3 className="text-base font-semibold">Not covered yet</h3>
          <ul className="mt-2 space-y-1.5 text-sm">
            {notCovered.map((c) => (
              <li key={c.id} className="flex items-center gap-2">
                <StatusIcon status="not_covered" />
                <MathText text={c.title} className="flex-1" />
                <span className="text-xs font-semibold text-faint">{c.marks} marks</span>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => onTeachNext(notCovered.map((c) => c.id))} className={`${PRIMARY} mt-3`}>
            <Sparkles className="h-4 w-4" aria-hidden /> Teach these next
          </button>
        </article>
      )}

      {report.studyPlan.length > 0 && (
        <article className="rounded-[14px] border border-line bg-card px-5 py-6 sm:px-8">
          <div className="flex items-baseline justify-between">
            <h3 className="text-base font-semibold">Study plan</h3>
            <span className="text-xs font-semibold text-muted">{minutesLeft} min left</span>
          </div>
          <ul className="mt-2 space-y-1">
            {report.studyPlan.map((s, i) => (
              <li key={s.id}>
                <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl p-2 hover:bg-canvas">
                  <input type="checkbox" checked={!!s.done} onChange={() => onToggleStep(s.id)} className="mt-1 h-4 w-4 accent-[var(--color-accent)]" />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm font-semibold ${s.done ? "text-faint line-through" : ""}`}>
                      Step {i + 1} · <MathText text={s.title} />
                    </span>
                    <span className="block text-xs text-muted">
                      <MathText text={s.detail} />
                    </span>
                  </span>
                  <span className="shrink-0 text-xs font-semibold text-faint">{s.estimatedMinutes} min</span>
                </label>
              </li>
            ))}
          </ul>
        </article>
      )}
    </div>
  );
}

type Counts = { missed: number; partial: number; parked: number; not_covered: number };

/** Report header (Figma Report / Filled): score ring + verdict, severity breakdown bar, "You nailed" chips. */
function ScoreSummary({ awarded, total, counts, nailed }: { awarded: number; total: number; counts: Counts; nailed: string[] }) {
  const parts = (Object.keys(counts) as (keyof Counts)[]).filter((k) => counts[k] > 0);
  const gapCount = parts.reduce((n, k) => n + counts[k], 0);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-5">
        <ScoreRing awarded={awarded} total={total} />
        <div className="min-w-0">
          <h2 className="text-xl font-semibold">{verdict(awarded, total)}</h2>
          <p className="mt-1 text-[15px] leading-6 text-muted">
            {gapCount === 0 ? "Every point on the mark scheme is covered." : `${gapCount} ${gapCount === 1 ? "point" : "points"} to close. The biggest gap is first, with what you said and how to fix it.`}
          </p>
        </div>
      </div>
      {gapCount > 0 && (
        <div>
          <div className="flex gap-1" aria-hidden>
            {parts.flatMap((k) => Array.from({ length: counts[k] }, (_, i) => <span key={`${k}${i}`} className={`h-1.5 flex-1 rounded-full ${SEVERITY[k]?.bar}`} />))}
          </div>
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
            {parts.map((k) => (
              <span key={k} className="inline-flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${SEVERITY[k]?.bar}`} aria-hidden />
                {counts[k]} {SEVERITY[k]?.label.toLowerCase()}
              </span>
            ))}
          </p>
        </div>
      )}
      {nailed.length > 0 && (
        <div>
          <div className="flex items-baseline justify-between">
            <h3 className="text-base font-semibold">You nailed</h3>
            <span className="text-sm text-faint">{nailed.length}</span>
          </div>
          <ul className="mt-2 flex flex-wrap gap-2">
            {nailed.map((t) => (
              <li key={t} className="inline-flex items-center gap-1.5 rounded-full bg-good-soft px-3 py-1 text-sm font-semibold text-good">
                <Check className="h-3.5 w-3.5" aria-hidden /> {t}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
