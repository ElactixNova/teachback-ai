"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Flag, LoaderCircle, Sparkles } from "lucide-react";
import type { CriterionResult, Cue, CurriculumContext, GapReport, MarkScheme, TimedLine, VisualExplainer } from "@/types/session";
import { createAnamAvatarBridge } from "@/lib/anam/bridge";
import { visualRequestForCriterion } from "@/lib/fal/request";
import { emptyResults, finalizeReport, liveFocusId, mergeLiveResults, parkResult } from "@/lib/rail/state";
import { useLiveAnalysis } from "@/lib/rail/useLiveAnalysis";
import { AvatarPanel } from "./AvatarPanel";
import { CentrePanel } from "./CentrePanel";
import { GapNotesPanel, gapsOf, type CheckState } from "./GapNotesPanel";
import { MarkSchemeRail } from "./MarkSchemeRail";
import { MAX_LEARN_IMAGES, SummaryView } from "./SummaryView";
import { WhiteboardCanvas, type WhiteboardHandle } from "./WhiteboardCanvas";
import { analyzeFinal, fetchMarkScheme, fetchRevisionNotes, generateVisual } from "./api";
import {
  ANAM_VIDEO_ID,
  type Async,
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
/** Lecture text sent to the avatar persona (topic-aware questions). */
const NOTES_EXCERPT_CHARS = 4000;

let lineSeq = 0;
const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/** Transcript for the examiner and the avatar: student and avatar lines only, with their "mm:ss". */
const timed = (lines: TranscriptLine[]): TimedLine[] =>
  lines.filter((l): l is TranscriptLine & { speaker: Speaker } => l.speaker !== "system").map(({ speaker, text, t }) => ({ speaker, text, t }));

export function Workspace() {
  const boardRef = useRef<WhiteboardHandle>(null);

  const [curriculum, setCurriculum] = useState<CurriculumContext | null>(null);
  const [sourceFile, setSourceFile] = useState("notes.pdf");
  const [scheme, setScheme] = useState<Async<MarkScheme>>({ status: "idle" });
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
  const [report, setReport] = useState<GapReport | null>(null);
  const [check, setCheck] = useState<CheckState>({ status: "idle" });
  const [visuals, setVisuals] = useState<Record<string, VisualState>>({});
  const [notes, setNotes] = useState<RevisionNotesState>({ status: "idle" });

  const markScheme = scheme.status === "ready" ? scheme.data : null;

  // Avatar tool calls and timers run outside React render; read the latest state through a ref.
  const latest = useRef({ curriculum, markScheme, results, transcript, report, view, focusIds, boardVersion, notes });
  useEffect(() => {
    latest.current = { curriculum, markScheme, results, transcript, report, view, focusIds, boardVersion, notes };
  }, [curriculum, markScheme, results, transcript, report, view, focusIds, boardVersion, notes]);

  const addLine = useCallback((speaker: TranscriptLine["speaker"], text: string) => {
    const now = Date.now();
    sessionStart.current ??= now;
    const line: TranscriptLine = { id: `l${now}-${lineSeq++}`, speaker, text, at: new Date(now).toISOString(), t: mmss(now - sessionStart.current) };
    latest.current.transcript = [...latest.current.transcript, line];
    setTranscript(latest.current.transcript);
  }, []);

  /** Results change: keep the ref in step at once (tool calls may read it before the next render). */
  const updateResults = useCallback((fn: (prev: CriterionResult[]) => CriterionResult[]) => {
    const next = fn(latest.current.results);
    latest.current.results = next;
    setResults(next);
  }, []);

  // ---- Mark scheme ----------------------------------------------------------------------------
  const schemeSeq = useRef(0);
  const resetSession = useCallback((s: MarkScheme | null) => {
    updateResults(() => (s ? emptyResults(s) : []));
    latest.current.report = null;
    setReport(null);
    setVisuals({});
    setNotes({ status: "idle" });
    setCheck({ status: "idle" });
    setFocusIds([]);
    setView("board");
  }, [updateResults]);

  const buildScheme = useCallback(
    async (cur: CurriculumContext, file: string, topic: string) => {
      const seq = ++schemeSeq.current;
      setScheme({ status: "loading" });
      try {
        const s = await fetchMarkScheme({ curriculumText: cur.text, topic, sourceFile: file });
        if (seq !== schemeSeq.current) return;
        latest.current.markScheme = s;
        setScheme({ status: "ready", data: s });
        resetSession(s);
      } catch (e) {
        if (seq === schemeSeq.current) setScheme({ status: "error", error: e instanceof Error ? e.message : "Could not draft a mark scheme." });
      }
    },
    [resetSession],
  );

  const onCurriculumChange = (cur: CurriculumContext | null, fileName?: string) => {
    setCurriculum(cur);
    if (!cur) {
      schemeSeq.current++;
      setScheme({ status: "idle" });
      resetSession(null);
      return;
    }
    if (fileName) {
      setSourceFile(fileName);
      void buildScheme(cur, fileName, cur.topic ?? cur.title);
    }
  };

  const editScheme = (s: MarkScheme) => {
    latest.current.markScheme = s;
    setScheme({ status: "ready", data: s });
    // Keep progress for criteria that still exist; new ones start empty.
    updateResults((prev) => {
      const byId = new Map(prev.map((r) => [r.criterionId, r]));
      return emptyResults(s).map((e) => byId.get(e.criterionId) ?? e);
    });
  };

  // ---- Live marking (T11 decides when; we own the results) ---------------------------------------
  const studentLines = transcript.filter((l) => l.speaker === "student").length;
  const live = useLiveAnalysis({
    enabled: !!markScheme && view === "board",
    getInput: () => {
      const { markScheme: s, transcript: lines } = latest.current;
      if (!s) return null;
      return { markScheme: s, transcript: timed(lines), whiteboardBase64: boardRef.current?.exportSnapshotBase64() ?? undefined, mode: "live" };
    },
    onResults: (incoming, req) => {
      const s = latest.current.markScheme;
      if (!s || req.markScheme !== s || latest.current.view !== "board") return;
      updateResults((prev) => mergeLiveResults(s, prev, incoming, req.transcript));
    },
    changeKey: `${studentLines}:${boardVersion}`,
  });

  // Parked points show up in the conversation feed.
  const parkedSeen = useRef(new Set<string>());
  useEffect(() => {
    if (!markScheme) {
      parkedSeen.current = new Set();
      return;
    }
    for (const r of results) {
      if (r.parked && !parkedSeen.current.has(r.criterionId)) {
        parkedSeen.current.add(r.criterionId);
        const title = markScheme.criteria.find((c) => c.id === r.criterionId)?.title ?? r.criterionId;
        addLine("system", `Parked: ${title}. Back to it later.`);
      } else if (!r.parked) parkedSeen.current.delete(r.criterionId);
    }
  }, [results, markScheme, addLine]);

  const parkCriterion = useCallback((id: string) => updateResults((prev) => parkResult(prev, id)), [updateResults]);

  // ---- Final marking --------------------------------------------------------------------------
  const finalRun = useRef<{ key: string; promise: Promise<GapReport | null> } | null>(null);
  const reportKey = useRef("");
  /** "<reportKey>:<criterionId>" of every visual already requested, so the same image is never paid for twice. */
  const requestedVisuals = useRef(new Set<string>());

  const generateVisualExplainer = useCallback(async (criterionId?: string, force = false): Promise<VisualExplainer | null> => {
    const { report: r, markScheme: s } = latest.current;
    const id = criterionId ?? r?.primaryGapId;
    const c = s?.criteria.find((x) => x.id === id);
    const res = r?.results.find((x) => x.criterionId === id);
    if (!r || !s || !c || !res) return null;
    const tag = `${reportKey.current}:${c.id}`;
    if (!force && requestedVisuals.current.has(tag)) return null;
    requestedVisuals.current.add(tag);
    setVisuals((v) => ({ ...v, [c.id]: { status: "loading" } }));
    // Ignore results that arrive after a newer report replaced this one.
    const setForThisReport = (state: VisualState) => {
      if (latest.current.report === r) setVisuals((v) => ({ ...v, [c.id]: state }));
    };
    try {
      const visual = await generateVisual(visualRequestForCriterion(c, res, s.topic));
      setForThisReport({ status: "ready", data: visual });
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
    if (last && reportKey.current === key) {
      setCheck({ status: "idle" });
      return Promise.resolve(last);
    }
    if (finalRun.current?.key === key) return finalRun.current.promise;

    const board = boardRef.current?.exportSnapshotBase64() ?? undefined;
    if (!lines.some((l) => l.speaker === "student") && !board) {
      setCheck({ status: "error", error: "Explain something first: talk to Sam, type below the video, or sketch on the whiteboard." });
      return Promise.resolve(null);
    }
    setCheck({ status: "checking" });
    const promise = (async () => {
      try {
        const raw = await analyzeFinal({ markScheme: s, transcript: timed(lines), whiteboardBase64: board });
        if (latest.current.markScheme !== s) return null;
        const r = finalizeReport(s, raw, latest.current.results);
        reportKey.current = key;
        latest.current.report = r;
        setReport(r);
        updateResults(() => r.results);
        setVisuals({});
        setNotes({ status: "idle" });
        latest.current.notes = { status: "idle" };
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
  }, [updateResults]);

  const checkExplanation = useCallback(async () => {
    setView("notes");
    const r = await runFinal();
    if (r?.primaryGapId) void generateVisualExplainer(r.primaryGapId);
    return r;
  }, [runFinal, generateVisualExplainer]);

  const loadNotes = useCallback(async (r: GapReport) => {
    const { markScheme: s, curriculum: cur } = latest.current;
    if (!s || !cur || gapsOf(s, r).length === 0) return;
    latest.current.notes = { status: "loading" };
    setNotes({ status: "loading" });
    try {
      const data = await fetchRevisionNotes({ markScheme: s, report: r, curriculumText: cur.text });
      if (latest.current.report === r) setNotes({ status: "ready", data });
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
    latest.current.focusIds = ids;
    // A second chance: un-park these and reset their attempts.
    updateResults((prev) =>
      prev.map((r) =>
        ids.includes(r.criterionId) && r.parked ? { ...r, parked: false, attempts: 0, status: r.awarded > 0 ? "partial" : "missed" } : r,
      ),
    );
    setView("board");
    addLine("system", `Next up: ${picked.map((c) => c.title).join(", ")}`);
    sessionRef.current?.setFocus?.(
      picked.map((c) => ({
        id: c.id,
        title: c.title,
        missingSteps: latest.current.results.find((r) => r.criterionId === c.id)?.missingSteps ?? c.expected,
      })),
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

  const connect = useCallback(async () => {
    sessionRef.current?.disconnect();
    sessionRef.current = null;
    sessionStart.current ??= Date.now();
    // The persona is scoped to the topic and notes at connect time.
    const bridge = createAnamAvatarBridge(() => {
      const { curriculum: cur, markScheme: s } = latest.current;
      return { topic: s?.topic || cur?.topic || cur?.title, notesExcerpt: cur?.text.slice(0, NOTES_EXCERPT_CHARS) };
    });
    try {
      sessionRef.current = await bridge.connect({ videoElementId: ANAM_VIDEO_ID, actions, handlers });
    } catch (e) {
      handlers.onStatus("error", e instanceof Error ? e.message : "Could not connect to the avatar.");
    }
  }, [actions, handlers]);

  const disconnect = useCallback(() => {
    sessionRef.current?.disconnect();
    sessionRef.current = null;
    setCue(null);
  }, []);

  useEffect(
    () => () => {
      sessionRef.current?.disconnect();
      if (cueTimer.current) clearTimeout(cueTimer.current);
    },
    [],
  );

  const toggleStep = (stepId: string) =>
    setReport((r) => (r ? { ...r, studyPlan: r.studyPlan.map((s) => (s.id === stepId ? { ...s, done: !s.done } : s)) } : r));

  const checking = check.status === "checking";
  const parkedIds = results.filter((r) => r.parked).map((r) => r.criterionId);
  const retryIds = parkedIds.length > 0 ? parkedIds : report && markScheme ? gapsOf(markScheme, report).map((g) => g.criterion.id) : [];

  return (
    <div className="flex h-dvh flex-col bg-canvas text-ink">
      <header className="topbar sticky top-0 z-10 flex min-h-[60px] items-center gap-3 px-4 py-2 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- static brand SVG exported from Figma (Brand/Mark 3:98) */}
          <img src="/brand-mark.svg" alt="" width={30} height={30} className="h-[30px] w-[30px] shrink-0" />
          <p className="text-xl font-semibold tracking-[-0.015em]">Feynman AI</p>
          <span className="hidden h-5 w-px bg-line sm:block" aria-hidden />
          <p className="hidden text-base font-medium text-muted sm:block">Learn it by teaching it</p>
        </div>

        <div className="ml-auto flex min-w-0 items-center gap-4">
          {markScheme && (
            <p className="hidden min-w-0 items-baseline gap-2 truncate md:flex">
              <span className="text-sm text-faint">Teaching</span>
              <span className="hl truncate text-xl font-semibold tracking-[-0.015em]" title={markScheme.topic}>
                {markScheme.topic}
              </span>
            </p>
          )}
          <span className="hidden text-sm text-faint xl:inline">
            {studentLines} {studentLines === 1 ? "line" : "lines"} explained · {boardEmpty ? "board empty" : "board in use"}
          </span>
          {report && view !== "notes" && (
            <button type="button" onClick={() => setView("notes")} className="hidden h-11 items-center rounded-full px-3 text-sm font-semibold text-muted hover:bg-accent-soft sm:inline-flex">
              Gap notes
            </button>
          )}
          <button
            type="button"
            onClick={() => void finishSession()}
            disabled={!markScheme || checking}
            className="action inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-card px-4 text-sm font-semibold text-ink transition hover:bg-accent-soft disabled:opacity-40"
          >
            {checking ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Flag className="h-4 w-4" />}
            <span className="hidden sm:inline">Finish &amp; get report</span>
            <span className="sm:hidden">Finish</span>
          </button>
        </div>
      </header>

      {/* Phones: one scrolling column (mark scheme, avatar, centre). lg+: three fixed-height columns. */}
      <main className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-6 pt-5 sm:px-6 lg:grid lg:grid-cols-[minmax(250px,1fr)_minmax(0,2.2fr)_minmax(280px,1.1fr)] lg:overflow-hidden">
        <div className="order-1 flex shrink-0 flex-col lg:order-none lg:min-h-0">
          <MarkSchemeRail
            curriculum={curriculum}
            onCurriculumChange={onCurriculumChange}
            scheme={scheme}
            results={results}
            liveId={view === "board" ? liveFocusId(results) : null}
            analysing={live.analysing}
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
                <p className="text-sm font-semibold">
                  {parkedIds.length > 0 ? `${parkedIds.length} parked ${parkedIds.length === 1 ? "point" : "points"} to try again` : "Have another go at your gaps"}
                </p>
                <p className="text-xs text-muted">Sam will ask only about these.</p>
                <button
                  type="button"
                  onClick={() => teachNext(retryIds)}
                  className="mt-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-accent text-sm font-semibold text-white hover:bg-accent-strong"
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
