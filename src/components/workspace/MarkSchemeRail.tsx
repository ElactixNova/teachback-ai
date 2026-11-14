"use client";

import { useState } from "react";
import { LoaderCircle, Pencil, RefreshCw, Trash2, Plus } from "lucide-react";
import type { CriterionResult, CurriculumContext, MarkScheme } from "@/types/session";
import { CurriculumUploader } from "./CurriculumUploader";
import { MAX_ATTEMPTS } from "@/lib/rail/state";
import { STATUS_LABEL, SourceChip, StatusIcon, displayStatus } from "./status";
import type { Async } from "./types";

interface Props {
  curriculum: CurriculumContext | null;
  onCurriculumChange: (c: CurriculumContext | null, fileName?: string) => void;
  scheme: Async<MarkScheme>;
  results: CriterionResult[];
  /** Criterion being explained right now (from live marking), if any. */
  liveId: string | null;
  analysing: boolean;
  onRebuild: (topic: string) => void;
  onEdit: (scheme: MarkScheme) => void;
  /** Final-report mode: no "explaining now", rows say how it was marked. */
  final?: boolean;
}

export function MarkSchemeRail({ curriculum, onCurriculumChange, scheme, results, liveId, analysing, onRebuild, onEdit, final }: Props) {
  const [editing, setEditing] = useState<MarkScheme | null>(null);
  const ready = scheme.status === "ready" ? scheme.data : null;
  const byId = new Map(results.map((r) => [r.criterionId, r]));
  const awarded = results.reduce((n, r) => n + r.awarded, 0);
  const total = ready?.totalMarks ?? 0;

  return (
    <section aria-label="Mark scheme" className="flex min-h-0 flex-col gap-3">
      <CurriculumUploader curriculum={curriculum} onChange={onCurriculumChange} />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-card">
        <header className="border-b border-line px-4 pb-3 pt-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-wider text-accent">Mark scheme</p>
              <h2 className="truncate text-base font-extrabold" title={ready?.topic}>
                {ready?.topic || (curriculum ? "Building…" : "No notes yet")}
              </h2>
              {ready && (
                <p className="truncate text-xs text-muted">
                  {ready.sourceFile} · {ready.pages} · {ready.criteria.length} points
                </p>
              )}
            </div>
            {ready && !editing && !final && (
              <button
                type="button"
                onClick={() => setEditing(structuredClone(ready))}
                className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl px-3 text-xs font-bold text-muted hover:bg-canvas hover:text-ink"
              >
                <Pencil className="h-3.5 w-3.5" /> Edit
              </button>
            )}
          </div>

          {ready && (
            <div className="mt-3">
              <div className="flex items-baseline justify-between text-xs">
                <span className="font-semibold text-muted">
                  {analysing ? (
                    <span className="inline-flex items-center gap-1">
                      <LoaderCircle className="h-3 w-3 animate-spin" /> Marking as you teach…
                    </span>
                  ) : final ? (
                    "Final mark"
                  ) : (
                    "Running total"
                  )}
                </span>
                <span className="font-extrabold tabular-nums">
                  {awarded} / {total}
                </span>
              </div>
              <div
                className="mt-1.5 h-2 overflow-hidden rounded-full bg-canvas"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={total}
                aria-valuenow={awarded}
                aria-label="Marks awarded"
              >
                <div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${total ? (awarded / total) * 100 : 0}%` }} />
              </div>
            </div>
          )}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {!curriculum && <p className="px-4 py-6 text-sm text-muted">Upload your lecture notes and Feynman AI drafts the mark scheme it will grade you against.</p>}

          {curriculum && scheme.status === "loading" && (
            <div className="space-y-2 px-4 py-4" aria-busy>
              <p className="flex items-center gap-2 text-sm font-semibold text-muted">
                <LoaderCircle className="h-4 w-4 animate-spin text-accent" /> Drafting the mark scheme from your notes…
              </p>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-11 animate-pulse rounded-xl bg-canvas" />
              ))}
            </div>
          )}

          {curriculum && scheme.status === "error" && (
            <div className="px-4 py-4 text-sm">
              <p className="font-semibold text-missed">{scheme.error}</p>
              <button
                type="button"
                onClick={() => onRebuild(curriculum.topic ?? curriculum.title)}
                className="mt-2 inline-flex h-11 items-center gap-1.5 rounded-xl border border-line px-3 text-xs font-bold hover:bg-canvas"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Try again
              </button>
            </div>
          )}

          {editing && <SchemeEditor draft={editing} onChange={setEditing} onCancel={() => setEditing(null)} onSave={(s) => { onEdit(s); setEditing(null); }} onRebuild={(t) => { setEditing(null); onRebuild(t); }} />}

          {ready && !editing && (
            <ol className="divide-y divide-line">
              {ready.criteria.map((c, i) => {
                const r = byId.get(c.id);
                const s = displayStatus(r, !final && c.id === liveId);
                const tint =
                  s === "missed" ? "bg-missed-soft" : s === "parked" ? "bg-parked-soft" : s === "in_progress" ? "bg-accent-soft/60" : "";
                const sub =
                  s === "parked"
                    ? `Parked after ${MAX_ATTEMPTS} tries, back to it later`
                    : s === "in_progress" && r && r.attempts > 0
                      ? `Explaining now · try ${Math.min(r.attempts + 1, MAX_ATTEMPTS)} of ${MAX_ATTEMPTS}`
                      : STATUS_LABEL[s];
                return (
                  <li key={c.id} className={`flex min-h-14 items-center gap-3 px-4 py-2.5 transition-colors ${tint}`}>
                    <StatusIcon status={s} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold leading-snug">
                        <span className="mr-1 text-faint">{i + 1}.</span>
                        {c.title}
                      </p>
                      <p className={`text-xs ${s === "missed" ? "font-semibold text-missed" : s === "in_progress" ? "font-semibold text-accent" : "text-muted"}`}>
                        {sub}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-extrabold tabular-nums">
                      {r?.awarded ?? 0}
                      <span className="font-semibold text-faint"> / {c.marks}</span>
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </section>
  );
}

function SchemeEditor({
  draft,
  onChange,
  onCancel,
  onSave,
  onRebuild,
}: {
  draft: MarkScheme;
  onChange: (s: MarkScheme) => void;
  onCancel: () => void;
  onSave: (s: MarkScheme) => void;
  onRebuild: (topic: string) => void;
}) {
  const setCriterion = (i: number, patch: Partial<MarkScheme["criteria"][number]>) =>
    onChange({ ...draft, criteria: draft.criteria.map((c, j) => (j === i ? { ...c, ...patch } : c)) });

  const save = () => {
    const criteria = draft.criteria
      .map((c) => {
        const expected = c.expected.map((e) => e.trim()).filter(Boolean);
        return { ...c, title: c.title.trim(), expected, marks: expected.length };
      })
      .filter((c) => c.title && c.marks > 0);
    if (criteria.length === 0) return;
    onSave({ ...draft, topic: draft.topic.trim() || draft.topic, criteria, totalMarks: criteria.reduce((n, c) => n + c.marks, 0) });
  };

  return (
    <div className="space-y-4 px-4 py-4">
      <label className="block">
        <span className="text-xs font-bold text-muted">Topic</span>
        <div className="mt-1 flex gap-2">
          <input
            value={draft.topic}
            onChange={(e) => onChange({ ...draft, topic: e.target.value })}
            className="h-11 min-w-0 flex-1 rounded-xl border border-line px-3 text-sm outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={() => onRebuild(draft.topic)}
            className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl border border-line px-3 text-xs font-bold hover:bg-canvas"
            title="Draft a new mark scheme for this topic"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Redraft
          </button>
        </div>
      </label>

      {draft.criteria.map((c, i) => (
        <fieldset key={c.id} className="rounded-xl border border-line p-3">
          <div className="flex items-center gap-2">
            <label className="min-w-0 flex-1">
              <span className="sr-only">Point {i + 1} title</span>
              <input
                value={c.title}
                onChange={(e) => setCriterion(i, { title: e.target.value })}
                className="h-10 w-full rounded-lg border border-line px-2.5 text-sm font-bold outline-none focus:border-accent"
              />
            </label>
            <button
              type="button"
              onClick={() => onChange({ ...draft, criteria: draft.criteria.filter((_, j) => j !== i) })}
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-faint hover:bg-missed-soft hover:text-missed"
              aria-label={`Delete point ${i + 1}`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <label className="mt-2 block">
            <span className="text-[11px] font-semibold text-muted">Mark-bearing steps (one per line, 1 mark each)</span>
            <textarea
              value={c.expected.join("\n")}
              onChange={(e) => setCriterion(i, { expected: e.target.value.split("\n") })}
              rows={Math.max(2, c.expected.length)}
              className="mt-1 w-full resize-y rounded-lg border border-line px-2.5 py-2 text-xs leading-relaxed outline-none focus:border-accent"
            />
          </label>
          <SourceChip source={c.source} />
        </fieldset>
      ))}

      <button
        type="button"
        onClick={() =>
          onChange({
            ...draft,
            criteria: [
              ...draft.criteria,
              { id: `c${Date.now()}`, title: "New point", expected: ["What earns the mark"], marks: 1, source: { page: 1 } },
            ],
          })
        }
        className="inline-flex h-11 items-center gap-1.5 rounded-xl px-3 text-xs font-bold text-accent hover:bg-accent-soft"
      >
        <Plus className="h-4 w-4" /> Add a point
      </button>

      <div className="flex gap-2">
        <button type="button" onClick={save} className="h-11 flex-1 rounded-xl bg-accent text-sm font-bold text-white hover:bg-accent-strong">
          Save mark scheme
        </button>
        <button type="button" onClick={onCancel} className="h-11 rounded-xl border border-line px-4 text-sm font-bold hover:bg-canvas">
          Cancel
        </button>
      </div>
    </div>
  );
}
