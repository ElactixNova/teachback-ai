"use client";

import { ArrowLeft, ArrowRight, Download, LoaderCircle, RefreshCw } from "lucide-react";
import type { GapReport, MarkScheme, RevisionNote } from "@/types/session";
import { svgDataUri } from "./api";
import { gapsOf, VisualSlot, type Gap } from "./GapNotesPanel";
import { MarksPill, STATUS_LABEL, SourceChip, StatusIcon, displayStatus } from "./status";
import type { Async, VisualState } from "./types";
import { ZoomableImage } from "./ZoomableImage";
import { MissedCallout } from "./callouts";
import { MathText } from "./MathText";
import { plainMath } from "./math";

/** At most this many fal images on the end screen (one per gap, worst first). */
export const MAX_LEARN_IMAGES = 4;

interface Props {
  scheme: MarkScheme;
  report: GapReport;
  notes: Async<RevisionNote[]>;
  visuals: Record<string, VisualState>;
  onRetryNotes?: () => void;
  onRetryVisual: (criterionId: string) => void;
  onTeachBack: (criterionIds: string[]) => void;
  onBack: () => void;
  /** Save the raw transcript as a .txt. */
  onDownloadTranscript?: () => void;
}

function Diagram({ note, visual, title, onRetry }: { note: RevisionNote; visual?: VisualState; title: string; onRetry: () => void }) {
  if (note.diagram.kind === "svg" && note.diagram.svg) {
    // Inline SVG rendered as an image on purpose (no DOM injection).
    return <ZoomableImage src={svgDataUri(note.diagram.svg)} alt={`Diagram: ${plainMath(title)}`} className="w-full rounded-xl border border-line bg-white object-contain" />;
  }
  return <VisualSlot state={visual} alt={`Diagram: ${plainMath(title)}`} onRetry={onRetry} compact />;
}

export function SummaryView({ scheme, report, notes, visuals, onRetryNotes, onRetryVisual, onTeachBack, onBack, onDownloadTranscript }: Props) {
  const gaps = gapsOf(scheme, report);
  const status = (id: string) => displayStatus(report.results.find((r) => r.criterionId === id));
  const count = (s: string) => scheme.criteria.filter((c) => status(c.id) === s).length;
  const pct = report.total ? Math.round((report.awarded / report.total) * 100) : 0;
  const notesById = new Map(notes.status === "ready" ? notes.data.map((n) => [n.criterionId, n]) : []);
  const ordered = notes.status === "ready" ? gaps.filter((g) => notesById.has(g.criterion.id)) : [];
  const learn = gaps.slice(0, MAX_LEARN_IMAGES);

  return (
    <section aria-label="Session summary" className="sheet flex h-full min-h-0 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">
        <header className="flex flex-wrap items-end gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">Final mark · {scheme.topic}</p>
            <p className="mt-1 text-4xl font-semibold tabular-nums leading-none">
              {report.awarded}
              <span className="text-2xl text-faint"> / {report.total}</span>
              <span className="ml-3 text-base font-semibold text-muted">{pct}%</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {onDownloadTranscript && (
              <button type="button" onClick={onDownloadTranscript} className="inline-flex h-11 items-center gap-1.5 rounded-full border border-line px-3.5 text-sm font-semibold hover:bg-canvas">
                <Download className="h-4 w-4" aria-hidden /> Download transcript
              </button>
            )}
            <button type="button" onClick={onBack} className="inline-flex h-11 items-center gap-1.5 rounded-full border border-line px-3.5 text-sm font-semibold hover:bg-canvas">
              <ArrowLeft className="h-4 w-4" /> Back to session
            </button>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-canvas" role="progressbar" aria-valuemin={0} aria-valuemax={report.total} aria-valuenow={report.awarded} aria-label="Final mark">
            <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
          </div>
          <ul className="flex flex-wrap gap-2">
            {(["full", "partial", "missed", "parked", "not_covered"] as const).map((s) =>
              count(s) > 0 ? (
                <li key={s} className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-xs font-semibold">
                  <StatusIcon status={s} className="!h-4 !w-4" /> {count(s)} {STATUS_LABEL[s].toLowerCase()}
                </li>
              ) : null,
            )}
          </ul>
        </header>

        <section aria-label="Revision notes" className="space-y-3">
          <h2 className="text-lg font-semibold">Revision notes</h2>
          {gaps.length === 0 && (
            <p className="text-sm text-muted">
              {report.awarded >= report.total ? "Full marks on every point. Nothing to revise." : report.awarded === 0 ? "No marks yet: nothing was explained, so there is nothing to revise. Go back to the session and teach Sam." : "No explanations to revise yet. Teach the points you have not covered, then check again."}
            </p>
          )}
          {gaps.length > 0 && notes.status === "loading" && (
            <div className="flex items-center gap-3 rounded-2xl border border-line p-4" role="status">
              <LoaderCircle className="h-5 w-5 animate-spin text-accent" />
              <p className="text-sm font-semibold">Writing corrected notes from your lecture… about 15 seconds</p>
            </div>
          )}
          {notes.status === "error" && (
            <div className="rounded-2xl border border-missed/30 bg-missed-soft p-4 text-sm" role="alert">
              <p className="font-semibold text-missed">Couldn’t write the revision notes</p>
              <p>{notes.error}</p>
              {onRetryNotes && <button type="button" onClick={onRetryNotes} className="mt-2 inline-flex h-11 items-center gap-1.5 rounded-full border border-line bg-card px-3 text-xs font-semibold">
                <RefreshCw className="h-3.5 w-3.5" /> Try again
              </button>}
            </div>
          )}
          {ordered.map(({ criterion: c, result: r }) => {
            const note = notesById.get(c.id)!;
            return (
              <article key={c.id} className="grid gap-4 rounded-2xl border border-line p-4 sm:p-5 md:grid-cols-[1fr_minmax(200px,40%)]">
                <div className="min-w-0">
                  <header className="flex items-start gap-3">
                    <StatusIcon status={displayStatus(r)} className="mt-0.5" />
                    <h3 className="min-w-0 flex-1 font-semibold leading-snug"><MathText text={c.title} /></h3>
                    <MarksPill result={r} criterion={c} />
                  </header>
                  <p className="mt-2 text-sm font-semibold text-accent"><MathText text={note.oneLiner} /></p>
                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-relaxed marker:font-semibold marker:text-faint">
                    {note.steps.map((s, i) => (
                      <li key={i}><MathText text={s} /></li>
                    ))}
                  </ol>
                  <div className="mt-3">
                    <SourceChip source={note.source} file={scheme.sourceFile} />
                  </div>
                </div>
                <Diagram note={note} visual={visuals[c.id]} title={c.title} onRetry={() => onRetryVisual(c.id)} />
              </article>
            );
          })}
        </section>

        {learn.length > 0 && (
          <section aria-label="Learn it visually">
            <h2 className="text-lg font-semibold">See it, then teach it back</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {learn.map((g: Gap) => {
                const s = displayStatus(g.result);
                const note = notesById.get(g.criterion.id);
                const v = visuals[g.criterion.id];
                const svgFallback = v?.status !== "ready" && note?.diagram.kind === "svg" && note.diagram.svg;
                return (
                  <article key={g.criterion.id} className="flex flex-col overflow-hidden rounded-2xl border border-line">
                    {svgFallback ? (
                      <div className="relative">
                        <ZoomableImage src={svgDataUri(note.diagram.svg!)} alt={`Diagram: ${plainMath(g.criterion.title)}`} className="aspect-[4/3] w-full bg-white object-contain" />
                        {v?.status === "loading" && (
                          <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-card/90 px-2 py-0.5 text-[11px] font-semibold text-muted">
                            <LoaderCircle className="h-3 w-3 animate-spin" /> Generating…
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="p-2 pb-0">
                        <VisualSlot state={v} alt={`Illustration: ${plainMath(g.criterion.title)}`} onRetry={() => onRetryVisual(g.criterion.id)} compact />
                      </div>
                    )}
                    <div className="flex flex-1 items-center gap-3 p-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold"><MathText text={g.criterion.title} /></p>
                        <p className="text-xs font-semibold text-muted">
                          {STATUS_LABEL[s]} · {g.criterion.marks - g.result.awarded} marks at stake
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => onTeachBack([g.criterion.id])}
                        className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-accent hover:bg-accent-soft"
                      >
                        Teach it back <ArrowRight className="h-4 w-4" />
                      </button>
                    </div>
                    <MissedCallout criterion={g.criterion} result={g.result} className="mx-3 mb-3" />
                  </article>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </section>
  );
}
