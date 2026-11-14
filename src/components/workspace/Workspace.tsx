"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Flag, LoaderCircle, Sparkles } from "lucide-react";
import type { CriterionResult, Cue, CurriculumContext, GapReport, MarkScheme, TimedLine, VisualExplainer } from "@/types/session";
import { createAnamAvatarBridge } from "@/lib/anam/bridge";
import { visualRequestForCriterion } from "@/lib/fal/request";
import { AvatarPanel } from "./AvatarPanel";
import { CentrePanel } from "./CentrePanel";
import { GapNotesPanel, gapsOf, type CheckState } from "./GapNotesPanel";
import { MarkSchemeRail } from "./MarkSchemeRail";
import { MAX_LEARN_IMAGES, SummaryView } from "./SummaryView";
import { WhiteboardCanvas, type WhiteboardHandle } from "./WhiteboardCanvas";
import { analyzeFinal, analyzeLive, fetchMarkScheme, fetchRevisionNotes, generateVisual } from "./api";
// TEMPORARY until T11's src/lib/rail lands.
import { carryParking, emptyResults, mergeLiveResults } from "./rail-temp";
import {
  ANAM_VIDEO_ID,
  type AsyncState,
  type AvatarHandlers,
  type AvatarSession,
  type AvatarStatus,
  type RevisionNotesState,
  type Speaker,
  type TranscriptLine,
  type VisualState,
  type WorkspaceActions,
  type WorkspaceView,
} from "./types";

/** How long a Director Notes cue badge stays visible. */
const CUE_TTL_MS = 4000;
/** Live marking runs at most this often while the student keeps teaching. */
const LIVE_INTERVAL_MS = 20_000;
/** ...and waits this long after the latest change, so it marks whole sentences. */
const LIVE_SETTLE_MS = 4_000;
/** Lecture text sent to the avatar persona (topic-aware questions). */
const NOTES_EXCERPT_CHARS = 4000;

let lineSeq = 0;
const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

const timed = (lines: TranscriptLine[]): TimedLine[] =>
  lines.filter((l): l is TranscriptLine & { speaker: Speaker } => l.speaker !== "system").map(({ speaker, text, t }) => ({ speaker, text, t }));

/** The criterion being explained now: the model's in_progress, else the newest student quote that hasn't earned full marks. */
function liveCriterion(results: CriterionResult[]): string | null {
  const explicit = results.find((r) => r.status === "in_progress" && !r.parked);
  if (explicit) return explicit.criterionId;
  let best: CriterionResult | null = null;
  for (const r of results) {
    if (!r.evidence || r.status === "full" || r.parked) continue;
    if (!best || r.evidence.timestamp > (best.evidence?.timestamp ?? "")) best = r;
  }
  return best?.criterionId ?? null;
}

export function Workspace() {
  const boardRef = useRef<WhiteboardHandle>(null);

  const [curriculum, setCurriculum] = useState<CurriculumContext | null>(null);
  const [sourceFile, setSourceFile] = useState("notes.pdf");
  const [scheme, setScheme] = useState<AsyncState<MarkScheme>>({ status: "idle" });
  const [results, setResults] = useState<CriterionResult[]>([]);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [boardEmpty, setBoardEmpty] = useState(true);
  const [boardVersion, setBoardVersion] = useState(0);
  const sessionStart = useRef<number | null>(null);

  const [avatarStatus, setAvatarStatus] = useState<AvatarStatus>("idle");
  const [avatarDetail, setAvatarDetail] = useState<string | undefined>();
  const [cue, setCue] = useState<Cue | null>(null);
  const sessionRef = useRef<AvatarSession | null>(null);
  const cueTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [view, setView] = useState<WorkspaceView>("board");
  const [focusIds, setFocusIds] = useState<string[]>([]);
  const [analysing, setAnalysing] = useState(false);
  const [report, setReport] = useState<GapReport | null>(null);
  const [check, setCheck] = useState<CheckState>({ status: "idle" });
  const [visuals, setVisuals] = useState<Record<string, VisualState>>({});
  const [notes, setNotes] = useState<RevisionNotesState>({ status: "idle" });

  const markScheme = scheme.status === "ready" ? scheme.value : null;

  // Avatar tool calls and timers run outside React render; read the latest state through a ref.
  const latest = useRef({ curriculum, markScheme, results, transcript, report, view, focusIds, boardVersion, notes });
  useEffect(() => {
    latest.current = { curriculum, markScheme, results, transcript, report, view, focusIds, boardVersion, notes };
  }, [curriculum, markScheme, results, transcript, report, view, focusIds, boardVersion, notes]);

  const addLine = useCallback((speaker: TranscriptLine["speaker"], text: string) => {
    const now = Date.now();
    sessionStart.current ??= now;
    const line: TranscriptLine = { id: `l${now}-${lineSeq++}`, speaker, text, at: new Date(now).toISOString(), t: mmss(now - sessionStart.current) };
    setTranscript((t) => [...t, line]);
  }, []);

  // ---- Mark scheme ----------------------------------------------------------------------------
  const schemeSeq = useRef(0);
  const buildScheme = useCallback(async (cur: CurriculumContext, file: string, topic: string) => {
    const seq = ++schemeSeq.current;
    setScheme({ status: "loading" });
    try {
      const s = await fetchMarkScheme({ curriculumText: cur.text, topic, sourceFile: file });
      if (seq !== schemeSeq.current) return;
      setScheme({ status: "ready", value: s });
      setResults(emptyResults(s));
      setReport(null);
      setVisuals({});
      setNotes({ status: "idle" });
    } catch (e) {
      if (seq === schemeSeq.current) setScheme({ status: "error", error: e instanceof Error ? e.message : "Could not draft a mark scheme." });
    }
  }, []);

  const onCurriculumChange = (cur: CurriculumContext | null, fileName?: string) => {
    setCurriculum(cur);
    if (!cur) {
      schemeSeq.current++;
      setScheme({ status: "idle" });
      setResults([]);
      setReport(null);
      setView("board");
      return;
    }
    if (fileName) {
      setSourceFile(fileName);
      void buildScheme(cur, fileName, cur.topic ?? cur.title);
    }
  };

  const editScheme = (s: MarkScheme) => {
    setScheme({ status: "ready", value: s });
    // Keep progress for criteria that still exist; new ones start empty.
    setResults((prev) => {
      const byId = new Map(prev.map((r) => [r.criterionId, r]));
      return emptyResults(s).map((e) => byId.get(e.criterionId) ?? e);
    });
  };

  // ---- Live marking ---------------------------------------------------------------------------
  const studentLines = transcript.filter((l) => l.speaker === "student").length;
  const liveSeq = useRef(0);
  const lastLiveAt = useRef(0);
  const lastLiveKey = useRef("");
  const liveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runLive = useCallback(async () => {
    const { markScheme: s, transcript: lines, boardVersion: bv } = latest.current;
    if (!s) return;
    const key = `${lines.length}:${bv}`;
    if (key === lastLiveKey.current) return;
    const student = lines.some((l) => l.speaker === "student");
    const board = boardRef.current?.exportSnapshotBase64() ?? undefined;
    if (!student && !board) return;
    lastLiveKey.current = key;
    lastLiveAt.current = Date.now();
    const seq = ++liveSeq.current;
    setAnalysing(true);
    try {
      const res = await analyzeLive({ markScheme: s, transcript: timed(lines), whiteboardBase64: board });
      if (seq !== liveSeq.current || latest.current.markScheme !== s) return;
      const prev = latest.current.results;
      const next = mergeLiveResults(s, prev, res.results);
      setResults(next);
      // Announce newly parked points in the feed.
      for (const r of next) {
        if (r.parked && !prev.find((p) => p.criterionId === r.criterionId)?.parked) {
          const title = s.criteria.find((c) => c.id === r.criterionId)?.title ?? r.criterionId;
          addLine("system", `Parked: ${title}. We'll come back to it.`);
        }
      }
    } catch (e) {
      console.warn("[rail] live marking failed", e);
    } finally {
      if (seq === liveSeq.current) setAnalysing(false);
    }
  }, [addLine]);

  // Re-mark after the student says or draws something new: settle briefly, at most every LIVE_INTERVAL_MS.
  useEffect(() => {
    if (!markScheme || view !== "board" || (studentLines === 0 && boardVersion === 0)) return;
    const wait = Math.max(LIVE_SETTLE_MS, lastLiveAt.current + LIVE_INTERVAL_MS - Date.now());
    const timer = setTimeout(() => void runLive(), wait);
    liveTimer.current = timer;
    return () => clearTimeout(timer);
  }, [markScheme, view, studentLines, boardVersion, runLive]);

  const parkCriterion = useCallback(
    (id: string) => {
      const s = latest.current.markScheme;
      const c = s?.criteria.find((x) => x.id === id);
      const r = latest.current.results.find((x) => x.criterionId === id);
      if (!c || !r || r.parked || r.status === "full") return;
      setResults((prev) => prev.map((x) => (x.criterionId === id ? { ...x, parked: true, status: "parked" } : x)));
      addLine("system", `Parked: ${c.title}. We'll come back to it.`);
    },
    [addLine],
  );

  // ---- Final marking --------------------------------------------------------------------------
  const finalRun = useRef<{ key: string; promise: Promise<GapReport | null> } | null>(null);
  const reportKey = useRef("");
  /** "<reportKey>:<criterionId>" of every visual already requested, so the same image is never paid for twice. */
  const inflightVisuals = useRef(new Set<string>());

  const generateVisualExplainer = useCallback(async (criterionId?: string, force = false): Promise<VisualExplainer | null> => {
    const { report: r, markScheme: s } = latest.current;
    const id = criterionId ?? r?.primaryGapId;
    const c = s?.criteria.find((x) => x.id === id);
    const res = r?.results.find((x) => x.criterionId === id);
    if (!r || !s || !c || !res) return null;
    if (!force && inflightVisuals.current.has(`${reportKey.current}:${c.id}`)) return null;
    inflightVisuals.current.add(`${reportKey.current}:${c.id}`);
    setVisuals((v) => ({ ...v, [c.id]: { status: "loading" } }));
    // Ignore results that arrive after a newer report replaced this one.
    const setForThisReport = (state: VisualState) => {
      if (latest.current.report === r) setVisuals((v) => ({ ...v, [c.id]: state }));
    };
    try {
      const visual = await generateVisual(visualRequestForCriterion(c, res, s.topic));
      setForThisReport({ status: "ready", visual });
      return visual;
    } catch (e) {
      setForThisReport({ status: "error", error: e instanceof Error ? e.message : "Could not draw this one." });
      return null;
    }
  }, []);

  /** Final marking, shared between callers; reuses the last report if nothing changed since. */
  const runFinal = useCallback((): Promise<GapReport | null> => {
    const { markScheme: s, transcript: lines, boardVersion: bv, report: last } = latest.current;
    if (!s) {
      setCheck({ status: "error", error: "Upload your lecture notes first, so there is a mark scheme to grade against." });
      return Promise.resolve(null);
    }
    const key = `${timed(lines).length}:${bv}:${s.criteria.length}:${s.totalMarks}`;
    if (last && reportKey.current === key) return Promise.resolve(last);
    if (finalRun.current?.key === key) return finalRun.current.promise;

    const board = boardRef.current?.exportSnapshotBase64() ?? undefined;
    if (!lines.some((l) => l.speaker === "student") && !board) {
      setCheck({ status: "error", error: "Explain something first: talk to Sam, type below the video, or sketch on the whiteboard." });
      return Promise.resolve(null);
    }
    liveSeq.current++; // drop any in-flight live result
    setAnalysing(false);
    setCheck({ status: "checking" });
    const promise = (async () => {
      try {
        const raw = await analyzeFinal({ markScheme: s, transcript: timed(lines), whiteboardBase64: board });
        const r: GapReport = { ...raw, results: carryParking(latest.current.results, raw.results) };
        reportKey.current = key;
        latest.current.report = r;
        setReport(r);
        setResults(r.results);
        setVisuals({});
        setNotes({ status: "idle" });
        setCheck({ status: "idle" });
        return r;
      } catch (e) {
        setCheck({ status: "error", error: e instanceof Error ? e.message : "The check failed. Try again." });
        return null;
      } finally {
        if (finalRun.current?.key === key) finalRun.current = null;
      }
    })();
    finalRun.current = { key, promise };
    return promise;
  }, []);

  const checkExplanation = useCallback(async () => {
    setView("notes");
    const r = await runFinal();
    if (r?.primaryGapId) void generateVisualExplainer(r.primaryGapId);
    return r;
  }, [runFinal, generateVisualExplainer]);

  const loadNotes = useCallback(async (r: GapReport) => {
    const { markScheme: s, curriculum: cur } = latest.current;
    if (!s || !cur || gapsOf(s, r).length === 0) return;
    setNotes({ status: "loading" });
    try {
      const value = await fetchRevisionNotes({ markScheme: s, report: r, curriculumText: cur.text });
      if (latest.current.report === r) setNotes({ status: "ready", value });
    } catch (e) {
      if (latest.current.report === r) setNotes({ status: "error", error: e instanceof Error ? e.message : "Could not write revision notes." });
    }
  }, []);

  const finishSession = useCallback(async () => {
    setView("summary");
    const r = await runFinal();
    const s = latest.current.markScheme;
    if (!r || !s) {
      setView("notes"); // shows the error / empty state
      return r;
    }
    if (latest.current.notes.status === "idle" || latest.current.notes.status === "error") void loadNotes(r);
    // Primary gap first, then the next worst; at most MAX_LEARN_IMAGES in parallel.
    for (const g of gapsOf(s, r).slice(0, MAX_LEARN_IMAGES)) void generateVisualExplainer(g.criterion.id);
    return r;
  }, [runFinal, loadNotes, generateVisualExplainer]);

  const teachNext = (ids: string[]) => {
    const s = latest.current.markScheme;
    if (!s) return;
    const picked = s.criteria.filter((c) => ids.includes(c.id));
    setFocusIds(ids);
    // A second chance: un-park these and reset their attempts.
    setResults((prev) =>
      prev.map((r) =>
        ids.includes(r.criterionId) && r.parked ? { ...r, parked: false, attempts: 0, status: r.awarded > 0 ? "partial" : "missed" } : r,
      ),
    );
    setView("board");
    addLine("system", `Next up: ${picked.map((c) => c.title).join(", ")}`);
    sessionRef.current?.setFocus?.(
      picked.map((c) => ({ id: c.id, title: c.title, missingSteps: results.find((r) => r.criterionId === c.id)?.missingSteps ?? c.expected })),
    );
  };

  // ---- Avatar ---------------------------------------------------------------------------------
  const actions: WorkspaceActions = useMemo(
    () => ({
      captureWhiteboard: () => boardRef.current?.exportSnapshot() ?? null,
      getRail: () => {
        const l = latest.current;
        return { markScheme: l.markScheme, results: l.results, transcript: timed(l.transcript), focusIds: l.focusIds, view: l.view };
      },
      parkCriterion,
      checkExplanation,
      openGapReport: () => {
        if (latest.current.report) setView("notes");
      },
      finishSession,
      getReport: () => latest.current.report,
      generateVisualExplainer: (id?: string) => generateVisualExplainer(id),
    }),
    [parkCriterion, checkExplanation, finishSession, generateVisualExplainer],
  );

  const handlers: AvatarHandlers = useMemo(
    () => ({
      onTranscript: (speaker, text) => {
        if (text.trim()) addLine(speaker, text.trim());
      },
      onCue: (c) => {
        setCue(c);
        if (cueTimer.current) clearTimeout(cueTimer.current);
        cueTimer.current = setTimeout(() => setCue(null), CUE_TTL_MS);
      },
      onStatus: (status, detail) => {
        setAvatarStatus(status);
        setAvatarDetail(detail);
      },
    }),
    [addLine],
  );

  const bridge = useMemo(
    () =>
      createAnamAvatarBridge(() => {
        const { curriculum: cur, markScheme: s } = latest.current;
        return { topic: s?.topic || cur?.topic || cur?.title, notesExcerpt: cur?.text.slice(0, NOTES_EXCERPT_CHARS) };
      }),
    [],
  );

  const connect = useCallback(async () => {
    sessionRef.current?.disconnect();
    sessionRef.current = null;
    sessionStart.current ??= Date.now();
    try {
      sessionRef.current = await bridge.connect({ videoElementId: ANAM_VIDEO_ID, actions, handlers });
    } catch (e) {
      handlers.onStatus("error", e instanceof Error ? e.message : "Could not connect to the avatar.");
    }
  }, [bridge, actions, handlers]);

  const disconnect = useCallback(() => {
    sessionRef.current?.disconnect();
    sessionRef.current = null;
    setCue(null);
  }, []);

  useEffect(
    () => () => {
      sessionRef.current?.disconnect();
      if (cueTimer.current) clearTimeout(cueTimer.current);
      if (liveTimer.current) clearTimeout(liveTimer.current);
    },
    [],
  );

  const toggleStep = (stepId: string) =>
    setReport((r) => (r ? { ...r, studyPlan: r.studyPlan.map((s) => (s.id === stepId ? { ...s, done: !s.done } : s)) } : r));

  const liveId = view === "board" ? liveCriterion(results) : null;
  const checking = check.status === "checking";
  const parkedIds = results.filter((r) => r.parked).map((r) => r.criterionId);
  const retryIds = parkedIds.length > 0 ? parkedIds : report && markScheme ? gapsOf(markScheme, report).map((g) => g.criterion.id) : [];

  return (
    <div className="flex h-dvh flex-col bg-canvas text-ink">
      <header className="flex items-center gap-3 border-b border-line bg-card px-4 py-2 sm:px-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-base font-extrabold text-white" aria-hidden>
            F
          </div>
          <div className="leading-tight">
            <p className="text-sm font-extrabold tracking-tight">Feynman AI</p>
            <p className="hidden text-[11px] font-medium text-muted sm:block">Learn it by teaching it</p>
          </div>
        </div>

        {markScheme && (
          <span className="ml-2 hidden truncate rounded-full bg-accent-soft px-3 py-1 text-xs font-bold text-accent md:inline">
            Teaching: {markScheme.topic}
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-xs font-medium text-muted xl:inline">
            {studentLines} {studentLines === 1 ? "line" : "lines"} explained · {boardEmpty ? "board empty" : "board in use"}
          </span>
          {report && view !== "notes" && (
            <button type="button" onClick={() => setView("notes")} className="hidden h-11 items-center rounded-xl px-3 text-sm font-bold text-muted hover:bg-canvas sm:inline-flex">
              Gap notes
            </button>
          )}
          <button
            type="button"
            onClick={() => void finishSession()}
            disabled={!markScheme || checking}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-ink px-4 text-sm font-bold text-white transition hover:bg-accent-strong disabled:opacity-40"
          >
            {checking ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Flag className="h-4 w-4" />}
            <span className="hidden sm:inline">Finish &amp; get report</span>
            <span className="sm:hidden">Finish</span>
          </button>
        </div>
      </header>

      {/* Phones: one scrolling column (mark scheme, avatar, centre). lg+: three fixed-height columns. */}
      <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 sm:p-5 lg:grid lg:grid-cols-[minmax(250px,1fr)_minmax(0,2.2fr)_minmax(280px,1.1fr)] lg:overflow-hidden">
        <div className="order-1 flex shrink-0 flex-col lg:order-none lg:min-h-0">
          <MarkSchemeRail
            curriculum={curriculum}
            onCurriculumChange={onCurriculumChange}
            scheme={scheme}
            results={results}
            liveId={liveId}
            analysing={analysing}
            onRebuild={(topic) => curriculum && void buildScheme({ ...curriculum, topic }, sourceFile, topic)}
            onEdit={editScheme}
            final={view === "summary"}
          />
        </div>

        <div className="order-3 shrink-0 lg:order-none lg:min-h-0">
          <CentrePanel
            view={view}
            board={
              <WhiteboardCanvas
                ref={boardRef}
                checking={checking}
                onSnapAndCheck={() => void checkExplanation()}
                onEmptyChange={setBoardEmpty}
                onChange={setBoardVersion}
              />
            }
            notes={
              <GapNotesPanel
                scheme={markScheme}
                report={report}
                check={check}
                visuals={visuals}
                onBack={() => setView("board")}
                onRecheck={() => void checkExplanation()}
                onTeachNext={teachNext}
                onRetryVisual={(id) => void generateVisualExplainer(id, true)}
                onToggleStep={toggleStep}
              />
            }
            summary={
              markScheme && report ? (
                <SummaryView
                  scheme={markScheme}
                  report={report}
                  notes={notes}
                  visuals={visuals}
                  onRetryNotes={() => void loadNotes(report)}
                  onRetryVisual={(id) => void generateVisualExplainer(id, true)}
                  onTeachBack={teachNext}
                  onBack={() => setView("board")}
                />
              ) : (
                <div className="flex h-full items-center justify-center gap-3 rounded-2xl border border-line bg-card p-6 text-sm font-semibold text-muted" role="status">
                  <LoaderCircle className="h-5 w-5 animate-spin text-accent" /> Marking your session against the mark scheme… about 15 seconds
                </div>
              )
            }
          />
        </div>

        <div className="order-2 flex shrink-0 flex-col lg:order-none lg:min-h-0">
          <AvatarPanel
            status={avatarStatus}
            statusDetail={avatarDetail}
            cue={cue}
            transcript={transcript}
            onConnect={() => void connect()}
            onDisconnect={disconnect}
            onTypedLine={(text) => {
              addLine("student", text);
              // When the avatar is live, it hears typed lines too.
              if (avatarStatus === "live") sessionRef.current?.sendText?.(text);
            }}
          >
            {view === "summary" && report && retryIds.length > 0 && (
              <div className="rounded-2xl border border-accent bg-accent-soft p-3">
                <p className="text-sm font-bold">
                  {parkedIds.length > 0 ? `${parkedIds.length} parked ${parkedIds.length === 1 ? "point" : "points"} to try again` : "Have another go at your gaps"}
                </p>
                <p className="text-xs text-muted">Sam will ask only about these.</p>
                <button
                  type="button"
                  onClick={() => teachNext(retryIds)}
                  className="mt-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent text-sm font-bold text-white hover:bg-accent-strong"
                >
                  <Sparkles className="h-4 w-4" /> Try it now
                </button>
              </div>
            )}
          </AvatarPanel>
        </div>
      </main>
    </div>
  );
}
