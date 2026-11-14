// Mark Scheme Rail live state (T11). Pure functions, no runtime imports, so node --test can load them.
//
// The server marks each live snapshot from scratch (attempts 0, parked false). This module turns those
// snapshots into a stable rail: marks never go down during a session, attempts are counted per new
// student quote that still loses marks, and a criterion is parked after its second failed attempt.
import type { CriterionResult, CriterionStatus, GapReport, MarkScheme, TimedLine } from "@/types/session";

/** A criterion is parked once the student has addressed it this many times and still lost marks. */
export const MAX_ATTEMPTS = 2;
/** Without a transcript, a new quote counts as a new attempt only this long after the last one. */
export const ATTEMPT_GAP_S = 20;

export interface RailState {
  /** One result per criterion, in mark-scheme order. */
  results: CriterionResult[];
  /** Per criterion: the attempts counted so far (normalised quote + transcript second). */
  counted: Record<string, { q: string; s: number }[]>;
  /** The criterion the student is explaining right now, or null. */
  activeId: string | null;
}

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const LOST: CriterionStatus[] = ["partial", "missed"];

export function initialRail(scheme: MarkScheme): RailState {
  return {
    results: scheme.criteria.map((c) => ({
      criterionId: c.id,
      status: "not_covered",
      awarded: 0,
      missingSteps: [...c.expected],
      attempts: 0,
      parked: false,
    })),
    counted: {},
    activeId: null,
  };
}

/** "mm:ss" -> seconds (NaN-safe: unknown sorts first). */
export function toSeconds(t: string | undefined): number {
  const m = /^(\d+):(\d{2})$/.exec(t ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : -1;
}

/** Milliseconds since the session start -> "mm:ss". */
export function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Transcript lines with ISO timestamps -> TimedLine[] relative to `startedAt` (ms epoch). */
export function toTimedLines(lines: { speaker: "student" | "avatar"; text: string; at: string }[], startedAt: number): TimedLine[] {
  return lines
    .filter((l) => l.text.trim())
    .map((l) => ({ speaker: l.speaker, text: l.text, t: mmss(Date.parse(l.at) - startedAt) }));
}

function settle(r: CriterionResult, marks: number): CriterionResult {
  if (r.awarded >= marks) return { ...r, awarded: marks, status: "full", parked: false, missingSteps: [] };
  if (r.parked) return { ...r, status: "parked" };
  return r;
}

/**
 * Merge one live analysis into the rail.
 * - Marks only go up: a criterion keeps its best awarded result (and that result's evidence/missing steps).
 * - An attempt is counted when a criterion comes back partial/missed with a new quote, and (after the
 *   first) only if the avatar spoke since the last counted quote: several sentences in one go are one attempt.
 * - After MAX_ATTEMPTS failed attempts the criterion is parked; full marks later un-park it.
 * - activeId: the model's in_progress criterion, else the not-yet-full one with the newest quote.
 */
export function mergeLive(scheme: MarkScheme, state: RailState, incoming: CriterionResult[], transcript?: TimedLine[]): RailState {
  // A retry is a new student quote after the avatar has spoken (it probed, the student tried again).
  const avatarSpokeBetween = (from: number, to: number) =>
    transcript ? transcript.some((l) => l.speaker === "avatar" && toSeconds(l.t) > from && toSeconds(l.t) < to) : to - from >= ATTEMPT_GAP_S;
  const byId = new Map(incoming.map((r) => [r.criterionId, r]));
  const counted: RailState["counted"] = { ...state.counted };

  const results = scheme.criteria.map((c) => {
    const prev = state.results.find((r) => r.criterionId === c.id) ?? initialRail({ ...scheme, criteria: [c] }).results[0];
    const next = byId.get(c.id);
    if (!next || prev.status === "full") return prev;

    let attempts = prev.attempts;
    const quote = next.evidence?.quote ? norm(next.evidence.quote) : "";
    const at = toSeconds(next.evidence?.timestamp);
    const past = counted[c.id] ?? [];
    const last = past[past.length - 1];
    const isNew = quote && !past.some((p) => p.q === quote) && (!last || at < 0 || avatarSpokeBetween(last.s, at));
    if (isNew && LOST.includes(next.status) && next.awarded < c.marks) {
      counted[c.id] = [...past, { q: quote, s: at }];
      attempts += 1;
    }

    const better = next.awarded > prev.awarded || (next.awarded === prev.awarded && prev.status === "not_covered" && next.status !== "not_covered");
    const base: CriterionResult = better
      ? { ...next, awarded: Math.min(next.awarded, c.marks) }
      : { ...prev, boardObservation: next.boardObservation ?? prev.boardObservation };
    // Live "in_progress" is not a stored status: it is reported through activeId.
    if (base.status === "in_progress") base.status = base.awarded > 0 ? "partial" : prev.status === "not_covered" ? "not_covered" : prev.status;

    return settle({ ...base, attempts, parked: prev.parked || attempts >= MAX_ATTEMPTS }, c.marks);
  });

  const open = (id: string) => {
    const r = results.find((x) => x.criterionId === id);
    return !!r && r.status !== "full" && r.status !== "parked";
  };
  const modelActive = incoming.find((r) => r.status === "in_progress" && open(r.criterionId))?.criterionId;
  const newest = incoming
    .filter((r) => r.evidence && open(r.criterionId))
    .sort((a, b) => toSeconds(b.evidence?.timestamp) - toSeconds(a.evidence?.timestamp))[0]?.criterionId;

  return { results, counted, activeId: modelActive ?? newest ?? (state.activeId && open(state.activeId) ? state.activeId : null) };
}

/** Find a criterion by id or by (part of) its title, as the avatar may say either. */
export function findCriterion(scheme: MarkScheme, ref: string): MarkScheme["criteria"][number] | undefined {
  const q = norm(ref);
  if (!q) return undefined;
  return (
    scheme.criteria.find((c) => c.id.toLowerCase() === q) ??
    scheme.criteria.find((c) => norm(c.title) === q) ??
    scheme.criteria.find((c) => norm(c.title).includes(q) || q.includes(norm(c.title)))
  );
}

export function railScore(scheme: MarkScheme, results: CriterionResult[]): { awarded: number; total: number } {
  return { awarded: results.reduce((n, r) => n + r.awarded, 0), total: scheme.totalMarks };
}

/**
 * Combine the final report with the live rail: per criterion keep the better mark (the rail never
 * shows marks the end screen then takes away), carry attempts, and keep parked criteria parked.
 * Totals and the primary gap are recomputed to match.
 */
export function finalizeReport(scheme: MarkScheme, report: GapReport, live: CriterionResult[]): GapReport {
  const results = scheme.criteria.map((c) => {
    const fin = report.results.find((r) => r.criterionId === c.id);
    const lv = live.find((r) => r.criterionId === c.id);
    const best = lv && (!fin || lv.awarded > fin.awarded) ? lv : (fin ?? lv)!;
    const parked = !!lv?.parked && best.awarded < c.marks;
    const status: CriterionStatus =
      best.awarded >= c.marks ? "full" : parked ? "parked" : best.status === "in_progress" ? (best.awarded > 0 ? "partial" : "missed") : best.status;
    return { ...best, status, parked, attempts: lv?.attempts ?? 0 };
  });

  // Same rule as grade.ts primaryGap (kept local so this file stays free of server imports): the attempted
  // criterion that lost the most marks; never-covered ones only count when nothing was attempted.
  const biggest = (attemptedOnly: boolean) => {
    let best: string | null = null;
    let worst = 0;
    for (const c of scheme.criteria) {
      const r = results.find((x) => x.criterionId === c.id);
      if (attemptedOnly && (!r || r.status === "not_covered")) continue;
      const lost = c.marks - (r?.awarded ?? 0);
      if (lost > worst) [best, worst] = [c.id, lost];
    }
    return best;
  };
  const primary = biggest(true) ?? biggest(false);
  const keepPrimary = report.primaryGapId && results.find((r) => r.criterionId === report.primaryGapId)?.status !== "full";
  return {
    ...report,
    results,
    awarded: results.reduce((n, r) => n + r.awarded, 0),
    total: scheme.totalMarks,
    primaryGapId: keepPrimary ? report.primaryGapId : primary,
  };
}

/** The criterion being explained right now (status "in_progress"), or null. */
export function liveFocusId(results: CriterionResult[]): string | null {
  return results.find((r) => r.status === "in_progress")?.criterionId ?? null;
}

const MAX_BOARD_CHARS = 600;

/**
 * What the examiner saw on the whiteboard, so the avatar knows what is already drawn or written.
 * Empty string when the board has been empty. Truncated: it goes into the avatar's context.
 */
export function boardNote(scheme: MarkScheme, results: CriterionResult[]): string {
  const title = (id: string) => scheme.criteria.find((c) => c.id === id)?.title ?? id;
  const seen = results
    .filter((r) => r.boardObservation?.trim())
    .map((r) => `${title(r.criterionId)}: ${r.boardObservation!.trim()}`)
    .join(" | ");
  if (!seen) return "";
  return `On their whiteboard (you can see it through the examiner, so never ask them to say aloud what is already written or drawn there): ${seen.slice(0, MAX_BOARD_CHARS)}.`;
}

/** What the avatar gets back from get_rail_status: short, factual, no answers. */
export function railStatusText(scheme: MarkScheme, results: CriterionResult[], focusIds: string[] = []): string {
  const { awarded, total } = railScore(scheme, results);
  const title = (id: string) => scheme.criteria.find((c) => c.id === id)?.title ?? id;
  const pick = (s: CriterionStatus[]) => results.filter((r) => s.includes(r.status)).map((r) => title(r.criterionId));
  const list = (xs: string[]) => (xs.length ? xs.join("; ") : "none");
  const active = liveFocusId(results);
  const open = (r: CriterionResult) => r.status !== "full" && r.status !== "parked";
  const focus = focusIds.map((id) => results.find((r) => r.criterionId === id)).filter((r): r is CriterionResult => !!r && open(r));
  const nextUp = focus[0] ?? results.find((r) => r.status === "not_covered") ?? results.find((r) => open(r) && r.status !== "in_progress");
  const board = boardNote(scheme, results);
  // Before moving on, probe the point they just explained if part of it is still missing (the active
  // point first, else any other partly explained one that has not used its two tries).
  const partly = (r: CriterionResult) => open(r) && r.missingSteps.length > 0 && r.attempts < 2 && r.status !== "not_covered" && (r.awarded > 0 || r.status === "in_progress");
  const followUp = results.find((r) => r.criterionId === active && partly(r)) ?? results.find(partly);
  const next = nextUp ? scheme.criteria.find((c) => c.id === nextUp.criterionId) : undefined;
  const nextAsk = next?.probe
    ? ` Ask it in your own words, keeping its specifics: "${next.probe}"${next.ask && next.ask !== "say" ? `, and have them ${next.ask} it on the board, then wait quietly` : ""}.`
    : "";
  return [
    `Rail: ${awarded}/${total} marks so far.`,
    board,
    `Fully explained: ${list(pick(["full"]))}.`,
    `Partly explained: ${list(pick(["partial", "missed"]))}.`,
    `Parked (do not ask about these again): ${list(pick(["parked"]))}.`,
    `Not covered yet: ${list(pick(["not_covered"]))}.`,
    active ? `They are explaining now: ${title(active)}.` : "",
    focus.length ? `They chose to work on: ${focus.map((r) => title(r.criterionId)).join("; ")}.` : "",
    followUp
      ? `FIRST, before moving on, follow up on "${title(followUp.criterionId)}": they have not yet made this point: "${followUp.missingSteps[0]}". Ask ONE short curious question that leads them towards it. Never state it. If they cannot, move on.`
      : "",
    nextUp
      ? `${followUp ? "After that" : "If they pause"}, move to "${title(nextUp.criterionId)}".${nextAsk} Never give the answer.`
      : "Everything has been addressed. Suggest they say they are finished so you can open their report.",
    "Start your reply by reacting in a few words to what they just said.",
  ]
    .filter(Boolean)
    .join(" ");
}

const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? []);

/**
 * True when the board observation appeared for the first time or changed substantially. The examiner
 * rewords the same drawing on nearly every live tick, so a plain "!==" would fire a note each time and
 * make the avatar chatty; get_rail_status always carries the latest observation anyway.
 */
function boardMoved(prev: string | undefined, next: string | undefined): boolean {
  if (!next?.trim()) return false;
  if (!prev?.trim()) return true;
  const a = words(prev);
  const b = words(next);
  const shared = [...a].filter((w) => b.has(w)).length;
  return shared / Math.max(a.size, b.size, 1) < 0.5;
}

/**
 * A private context note for the avatar (Anam addContext) when the rail changed in a way that should
 * steer it: a criterion got full marks or was parked. Null when nothing worth saying changed.
 */
export function railChangeNote(scheme: MarkScheme, before: CriterionResult[], after: CriterionResult[], focusIds: string[] = []): string | null {
  const title = (id: string) => scheme.criteria.find((c) => c.id === id)?.title ?? id;
  const was = (id: string) => before.find((r) => r.criterionId === id)?.status;
  const nowFull = after.filter((r) => r.status === "full" && was(r.criterionId) !== "full").map((r) => title(r.criterionId));
  const nowParked = after.filter((r) => r.status === "parked" && was(r.criterionId) !== "parked").map((r) => title(r.criterionId));
  const boardChanged = after.some((r) => boardMoved(before.find((b) => b.criterionId === r.criterionId)?.boardObservation, r.boardObservation));
  if (!nowFull.length && !nowParked.length && !boardChanged) return null;
  return [
    "[RAIL UPDATE, private, do not read out]",
    nowFull.length ? `Now fully explained: ${nowFull.join("; ")}. Do not ask about these again.` : "",
    nowParked.length
      ? `Parked: ${nowParked.join("; ")}. Do not ask about these again; if it fits, say warmly that you will park it for the report and move on.`
      : "",
    railStatusText(scheme, after, focusIds),
  ]
    .filter(Boolean)
    .join(" ");
}

// ---- Results-in, results-out API for the workspace (T10 owns the state) ------------------------

/** All criteria not_covered, attempts 0. */
export function emptyResults(scheme: MarkScheme): CriterionResult[] {
  return initialRail(scheme).results;
}

/** The rail with the live focus shown as status "in_progress" (what the UI renders). */
function present(state: RailState): CriterionResult[] {
  return state.results.map((r) =>
    r.criterionId === state.activeId && r.status !== "full" && r.status !== "parked" ? { ...r, status: "in_progress" as const } : r,
  );
}

// Per scheme: the internal state behind the last results we returned (attempt history, real statuses).
const memory = new WeakMap<MarkScheme, { state: RailState; shown: CriterionResult[] }>();

const key = (r: CriterionResult) => `${r.criterionId}|${r.status}|${r.awarded}|${r.parked}|${r.attempts}`;

/** Rebuild the internal state from results the UI may have changed (manual park, reset). */
function fromResults(scheme: MarkScheme, results: CriterionResult[], old?: RailState): RailState {
  const merged = emptyResults(scheme).map((b): CriterionResult => {
    const r = results.find((x) => x.criterionId === b.criterionId);
    if (!r) return b;
    if (r.status !== "in_progress") return r;
    const was = old?.results.find((x) => x.criterionId === b.criterionId);
    return { ...r, status: was ? was.status : r.awarded > 0 ? "partial" : "not_covered" };
  });
  const fresh = results.every((r) => r.status === "not_covered" && r.attempts === 0);
  return { results: merged, counted: fresh ? {} : (old?.counted ?? {}), activeId: liveFocusId(results) };
}

/**
 * Merge one live analysis (POST /api/analyze mode "live") into the rail results.
 * Marks never go down; attempts count a retry after the avatar spoke; a criterion is parked after its
 * second failed attempt (and un-parked if it later earns full marks); the criterion being explained
 * now is returned as "in_progress" (the model's pick, else the open one with the newest student quote).
 */
export function mergeLiveResults(scheme: MarkScheme, prev: CriterionResult[], incoming: CriterionResult[], transcript: TimedLine[]): CriterionResult[] {
  const mem = memory.get(scheme);
  const unchanged = !!mem && mem.shown.length === prev.length && mem.shown.every((r, i) => key(r) === key(prev[i]));
  const state = unchanged ? mem!.state : fromResults(scheme, prev, mem?.state);
  const next = mergeLive(scheme, state, incoming, transcript);
  const shown = present(next);
  memory.set(scheme, { state: next, shown });
  return shown;
}

/** Park a criterion in a results array (the UI's park button or the avatar's park_criterion). Full ones stay full. */
export function parkResult(results: CriterionResult[], criterionId: string): CriterionResult[] {
  return results.map((r) =>
    r.criterionId === criterionId && r.status !== "full" ? { ...r, parked: true, status: "parked" as const, attempts: Math.max(r.attempts, 1) } : r,
  );
}
