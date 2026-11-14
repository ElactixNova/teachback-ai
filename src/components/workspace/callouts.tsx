// T14: "write it / draw it" chips and the "What you missed" callout, shared by the rail, gap notes and end screen.
import { PenLine, Shapes } from "lucide-react";
import type { AskMode, Criterion, CriterionResult } from "@/types/session";
import { MathText, SpokenMath } from "./MathText";
import { plainMath } from "./math";

const ASK: Record<Exclude<AskMode, "say">, { label: string; Icon: typeof PenLine }> = {
  write: { label: "Write it", Icon: PenLine },
  draw: { label: "Draw it", Icon: Shapes },
};

/** Shows when the mark scheme wants this point written or drawn on the board. Nothing for "say" (the default). */
export function AskChip({ ask, className = "" }: { ask?: AskMode; className?: string }) {
  if (!ask || ask === "say") return null;
  const { label, Icon } = ASK[ask];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border border-accent/40 bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent ${className}`}
      title={ask === "write" ? "Write this on the whiteboard: it is marked from the board" : "Draw this on the whiteboard: it is marked from the board"}
    >
      <Icon className="h-3 w-3" aria-hidden /> {label}
    </span>
  );
}

/**
 * "What you missed": the mark-scheme steps this student did not earn, next to the illustration of them.
 * A wrong claim (status missed, with a quote) is shown crossed out, so the correction reads against it.
 */
export function MissedCallout({ criterion, result, className = "" }: { criterion: Criterion; result: CriterionResult; className?: string }) {
  const missing = result.missingSteps.filter((s) => s.trim());
  if (missing.length === 0) return null;
  const wrong = result.status === "missed" && result.evidence?.quote;
  return (
    <aside aria-label={`What you missed: ${plainMath(criterion.title)}`} className={`rounded-xl border border-missed/30 bg-missed-soft p-3 text-sm ${className}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-missed">What you missed</p>
      <ul className="mt-1.5 space-y-1 leading-snug">
        {missing.map((s) => (
          <li key={s} className="flex gap-2">
            <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-missed" aria-hidden />
            <MathText text={s} className="font-semibold text-ink" />
          </li>
        ))}
      </ul>
      {wrong && (
        <p className="mt-2 text-xs text-muted">
          You said: <s className="decoration-missed decoration-2"><SpokenMath text={result.evidence!.quote} /></s>
        </p>
      )}
    </aside>
  );
}
