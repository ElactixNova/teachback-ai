// How each criterion state looks (spec "Rail item states"), shared by the rail, notes and end screen.
import { Check, Clock3 } from "lucide-react";
import type { Criterion, CriterionResult, CriterionStatus } from "@/types/session";

export type DisplayStatus = CriterionStatus;

/** Parked wins over the marking status; "live" marks the criterion being explained right now. */
export function displayStatus(r: CriterionResult | undefined, live = false): DisplayStatus {
  if (!r) return "not_covered";
  if (r.parked || r.status === "parked") return "parked";
  if (live && r.status !== "full") return "in_progress";
  return r.status;
}

export const STATUS_LABEL: Record<DisplayStatus, string> = {
  full: "Full marks",
  partial: "Partial",
  missed: "Missed",
  in_progress: "Explaining now",
  not_covered: "Not covered",
  parked: "Parked",
};

/** Rank for "worst first": missed, parked, partial, not covered, in progress, full. */
export const WORST_FIRST: Record<DisplayStatus, number> = {
  missed: 0,
  parked: 1,
  partial: 2,
  not_covered: 3,
  in_progress: 4,
  full: 5,
};

export function StatusIcon({ status, className = "" }: { status: DisplayStatus; className?: string }) {
  const base = `inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${className}`;
  switch (status) {
    case "full":
      return (
        <span className={`${base} bg-good text-white`} aria-hidden>
          <Check className="h-3 w-3" strokeWidth={3} />
        </span>
      );
    case "partial":
      return (
        <span
          className={`${base} border-2 border-partial`}
          style={{ background: "linear-gradient(90deg, var(--color-partial) 50%, transparent 50%)" }}
          aria-hidden
        />
      );
    case "missed":
      return (
        <span className={`${base} bg-missed text-[11px] font-semibold text-white`} aria-hidden>
          !
        </span>
      );
    case "in_progress":
      return (
        <span className={`${base} border-2 border-accent`} aria-hidden>
          <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
        </span>
      );
    case "parked":
      return (
        <span className={`${base} text-parked`} aria-hidden>
          <Clock3 className="h-5 w-5" />
        </span>
      );
    default:
      return <span className={`${base} border-2 border-line`} aria-hidden />;
  }
}

/** Marks pill: orange for missed, amber for partial, teal for full, grey otherwise. */
export function MarksPill({ result, criterion }: { result?: CriterionResult; criterion: Criterion }) {
  const s = displayStatus(result);
  const tone =
    s === "missed"
      ? "bg-missed-soft text-missed"
      : s === "partial"
        ? "bg-partial-soft text-partial"
        : s === "full"
          ? "bg-good-soft text-good"
          : "bg-parked-soft text-parked";
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums ${tone}`}>
      {result?.awarded ?? 0} / {criterion.marks}
    </span>
  );
}

export function SourceChip({ source, file }: { source: Criterion["source"]; file?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-line bg-canvas px-2 py-0.5 text-[11px] font-semibold text-muted">
      {source.label ? `${source.label} · ` : file ? `${file.replace(/\.pdf$/i, "")} · ` : ""}p.{source.page}
    </span>
  );
}

/** Figma "Severity Tag" (5:84), mapped onto marking states. Words, never colour alone. */
export const SEVERITY: Partial<Record<DisplayStatus, { label: string; tag: string; bar: string }>> = {
  missed: { label: "Critical", tag: "bg-missed-soft text-missed", bar: "bg-missed" },
  partial: { label: "Major", tag: "bg-partial-soft text-partial", bar: "bg-partial" },
  parked: { label: "Parked", tag: "bg-parked-soft text-parked", bar: "bg-parked" },
  not_covered: { label: "Not covered", tag: "bg-parked-soft text-parked", bar: "bg-line-strong" },
};

export function SeverityTag({ status }: { status: DisplayStatus }) {
  const s = SEVERITY[status];
  if (!s) return null;
  return <span className={`inline-flex shrink-0 items-center rounded-[4px] px-2 py-0.5 text-xs font-semibold ${s.tag}`}>{s.label}</span>;
}

/** Figma "Score Ring" (6:117): an arc for the percentage and the marks in the middle. */
export function ScoreRing({ awarded, total }: { awarded: number; total: number }) {
  const pct = total > 0 ? Math.max(0, Math.min(1, awarded / total)) : 0;
  const r = 46;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative h-28 w-28 shrink-0" role="img" aria-label={`${awarded} of ${total} marks`}>
      <svg viewBox="0 0 112 112" className="h-full w-full -rotate-90">
        <circle cx="56" cy="56" r={r} fill="none" stroke="var(--color-accent-soft)" strokeWidth="8" />
        <circle
          cx="56"
          cy="56"
          r={r}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          className="score-arc"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="tabular text-[40px] font-semibold leading-[44px] tracking-[-0.03em]">{awarded}</span>
        <span className="text-xs text-faint">of {total} marks</span>
      </div>
    </div>
  );
}

/** One-word verdict for a score (Figma: "Getting there"). */
export function verdict(awarded: number, total: number): string {
  const p = total > 0 ? awarded / total : 0;
  if (p >= 0.9) return "You could teach this";
  if (p >= 0.6) return "Nearly there";
  if (p >= 0.3) return "Getting there";
  return "Just getting started";
}
