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
        <span className={`${base} bg-accent text-white`} aria-hidden>
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
        <span className={`${base} bg-missed text-[11px] font-extrabold text-white`} aria-hidden>
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
          ? "bg-accent-soft text-accent"
          : "bg-parked-soft text-parked";
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums ${tone}`}>
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
