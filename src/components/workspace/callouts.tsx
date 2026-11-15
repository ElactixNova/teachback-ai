// T14/T28: "write it / draw it" chips and the "What you missed" callout, shared by the rail, gap notes and end screen.
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

/** A mark-scheme step as a plain sentence: ends with a full stop unless it already ends a sentence (or in maths). */
const sentence = (s: string) => (/[.!?:$)]$/.test(s) ? s : `${s}.`);

/**
 * T28 "What you missed", written like a teacher's margin note: one short heading, then what you said next to what
 * the full answer needs (stacked when narrow), in calm colours. Shown next to the illustration of the point.
 * `showSaid={false}` where the same card already has the "What you said" box (gap notes), so it is not said twice.
 */
export function MissedCallout({
  criterion,
  result,
  className = "",
  showSaid = true,
}: {
  criterion: Criterion;
  result: CriterionResult;
  className?: string;
  showSaid?: boolean;
}) {
  const missing = result.missingSteps.map((s) => s.trim()).filter(Boolean);
  if (missing.length === 0) return null;
  const said = result.said?.trim();
  const quote = result.evidence?.quote?.trim();

  return (
    <aside aria-label={`What you missed: ${plainMath(criterion.title)}`} className={`@container rounded-xl border border-line bg-card p-3 text-sm ${className}`}>
      <h4 className="text-sm font-semibold text-ink">What you missed</h4>
      <div className={`mt-2 grid gap-2 ${showSaid ? "@md:grid-cols-2" : ""}`}>
        {showSaid && (
          <div className="min-w-0 rounded-lg bg-canvas px-3 py-2">
            <p className="text-xs font-semibold text-faint">Your answer</p>
            <p className="mt-0.5 line-clamp-4 leading-relaxed text-muted">
              {said ? (
                <MathText text={said} />
              ) : quote ? (
                <>
                  “<SpokenMath text={quote} />”
                </>
              ) : (
                "Nothing about this point yet."
              )}
            </p>
          </div>
        )}
        <div className="min-w-0 rounded-lg border-l-[3px] border-accent bg-accent-soft/60 px-3 py-2">
          <p className="text-xs font-semibold text-accent">The full answer also needs</p>
          <p className="mt-0.5 leading-relaxed text-ink">
            {missing.map((s, i) => (
              <span key={s}>
                {i > 0 && " "}
                <MathText text={sentence(s)} />
              </span>
            ))}
          </p>
        </div>
      </div>
    </aside>
  );
}
