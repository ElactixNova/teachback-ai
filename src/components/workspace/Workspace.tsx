"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Flag, LoaderCircle, Sparkles } from "lucide-react";
import type { CriterionResult, Cue, CurriculumContext, GapReport, MarkScheme, TimedLine, VisualExplainer } from "@/types/session";
import { createAnamAvatarBridge } from "@/lib/anam/bridge";
import { visualRequestForCriterion } from "@/lib/fal/request";
import { emptyResults, finalizeReport, liveFocusId, mergeLiveResults, parkResult } from "@/lib/rail/state";
import { useLiveAnalysis } from "@/lib/rail/useLiveAnalysis";
import { AvatarPanel, type LiveLine } from "./AvatarPanel";
import { CentrePanel } from "./CentrePanel";
import { GapNotesPanel, gapsOf, type CheckState } from "./GapNotesPanel";
import { MarkSchemeRail } from "./MarkSchemeRail";
import { MAX_LEARN_IMAGES, SummaryView } from "./SummaryView";
import { createQuestionWriter, remoteLatex, type QuestionWriter } from "@/lib/board/questions";
import { spokenToLatex } from "@/lib/math/spoken";
import { WhiteboardCanvas, type WhiteboardHandle } from "./WhiteboardCanvas";
import { downloadText, formatTranscript, transcriptFileName } from "./transcriptExport";
import { diagLines } from "@/lib/anam/diag";
import { analyzeFinal, readBoard, fetchMarkScheme, fetchRevisionNotes, generateVisual } from "./api";
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
/** Transcript key of a streamed line (live bubble and its finished line share it). */
const liveKey = (streamId: string) => `s-${streamId}`;
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
  // T28: lines still being spoken (display only; the examiner reads `transcript`, built from finished lines).
  const [liveLines, setLiveLines] = useState<LiveLine[]>([]);
  const liveStart = useRef(new Map<string, number>());
  const [boardEmpty, setBoardEmpty] = useState(true);
  const [boardVersion, setBoardVersion] = useState(0);
  // "Sam is waiting while you write": true while strokes keep coming, false 3s after the last one.
  const [writing, setWriting] = useState(false);
  const writingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onBoardChange = useCallback((version: number) => {
    setBoardVersion(version);
    setWriting(true);
    if (writingTimer.current) clearTimeout(writingTimer.current);
    writingTimer.current = setTimeout(() => setWriting(false), 3000);
  }, []);
  useEffect(() => () => {
    if (writingTimer.current) clearTimeout(writingTimer.current);
  }, []);
  const sessionStart = useRef<number | null>(null);

  const [avatarStatus, setAvatarStatus] = useState<AvatarStatus>("idle");
  const [avatarDetail, setAvatarDetail] = useState<string | undefined>();
  const [cue, setCue] = useState<Cue | null>(null);
  const sessionRef = useRef<AvatarSession | null>(null);
  // Tell the avatar (private context) when the student starts and stops writing; never on first render.
  const wroteBefore = useRef(false);
  useEffect(() => {
    if (writing) wroteBefore.current = true;
    else if (!wroteBefore.current) return;
    sessionRef.current?.notifyBoard?.(writing ? "writing" : "idle");
  }, [writing]);
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

  /** `streamId`: a line that was shown live keeps that bubble's key and start time, so it does not jump or flicker. */
  const addLine = useCallback((speaker: TranscriptLine["speaker"], text: string, streamId?: string) => {
    const started = streamId ? liveStart.current.get(streamId) : undefined;
    if (streamId) liveStart.current.delete(streamId);
    const now = started ?? Date.now();
    sessionStart.current ??= now;
    const id = streamId && started !== undefined ? liveKey(streamId) : `l${now}-${lineSeq++}`;
    const line: TranscriptLine = { id, speaker, text, at: new Date(now).toISOString(), t: mmss(Math.max(0, now - sessionStart.current)) };
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
      // No topic here: the examiner names it from the notes. The PDF title is a file name, not a topic.
      void buildScheme(cur, fileName, cur.topic ?? "");
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
  // Each final check bumps the epoch; a live result from a request sent before it is dropped (it would overwrite the final marks).
  const finalEpoch = useRef(0);
  const liveReqEpoch = useRef(new WeakMap<object, number>());
  // What the last live result covered (student lines + board version), so refreshRail knows if anything is new.
  const stateKey = () => `${latest.current.transcript.filter((l) => l.speaker === "student").length}:${latest.current.boardVersion}`;
  const liveReqKey = useRef(new WeakMap<object, string>());
  const markedKey = useRef("0:0");
  const boardReadRef = useRef<{ version: number; promise: Promise<string> } | null>(null);
  const live = useLiveAnalysis({
    enabled: !!markScheme && view === "board" && check.status !== "checking",
    getInput: () => {
      const { markScheme: s, transcript: lines } = latest.current;
      if (!s) return null;
      const req = { markScheme: s, transcript: timed(lines), whiteboardBase64: boardRef.current?.exportSnapshotBase64() ?? undefined, mode: "live" as const };
      // useLiveAnalysis copies the request, so key on its transcript array (passed through by reference).
      liveReqEpoch.current.set(req.transcript, finalEpoch.current);
      liveReqKey.current.set(req.transcript, stateKey());
      return req;
    },
    onResults: (incoming, req) => {
      const s = latest.current.markScheme;
      if (!s || req.markScheme !== s || latest.current.view !== "board") return;
      if (liveReqEpoch.current.get(req.transcript) !== finalEpoch.current) return;
      updateResults((prev) => mergeLiveResults(s, prev, incoming, req.transcript));
      markedKey.current = liveReqKey.current.get(req.transcript) ?? markedKey.current;
    },
    changeKey: `${studentLines}:${boardVersion}`,
  });

  const flushLive = live.flush;

  // (T24) Parked points used to add a "Parked: ... Back to it later." line to the chat. The chat is the
  // conversation only: parking shows on the rail (Parked status) and the end screen, never in the feed.

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
    finalEpoch.current++;
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
    // Every gap card in the review gets its picture without being asked (primary gap first), same as the end screen.
    const s = latest.current.markScheme;
    if (r && s) for (const g of gapsOf(s, r).slice(0, MAX_LEARN_IMAGES)) void generateVisualExplainer(g.criterion.id);
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
      readBoard: () => {
        const v = latest.current.boardVersion;
        if (boardReadRef.current?.version === v) return boardReadRef.current.promise;
        const png = boardRef.current?.exportSnapshotBase64();
        const promise = png ? readBoard(png, timed(latest.current.transcript).slice(-6).map((l) => `${l.speaker === "avatar" ? "Sam" : "Student"}: ${l.text}`).join("\n")).catch(() => "") : Promise.resolve("");
        boardReadRef.current = { version: v, promise };
        return promise;
      },
      refreshRail: async () => {
        // A run already in flight started before the latest line or stroke, so one more may be needed.
        for (let i = 0; i < 2 && stateKey() !== markedKey.current; i++) await flushLive();
      },
      parkCriterion,
      checkExplanation,
      openGapReport: () => {
        if (latest.current.report) setView("notes");
      },
      finishSession,
      getReport: () => latest.current.report,
      generateVisualExplainer: (id?: string) => generateVisualExplainer(id),
      writeOnBoard: (note) => boardRef.current?.addNote(note) ?? { status: "hidden" },
      speechProgress: (chars, done) => boardRef.current?.speech(chars, done),
    }),
    [parkCriterion, checkExplanation, finishSession, generateVisualExplainer, flushLive],
  );

  // Dev only: lets the headless board-notes test drive the avatar's actions without an Anam session.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const dev = window as unknown as { __feynmanActions?: WorkspaceActions; __feynmanQuestions?: QuestionWriter };
    dev.__feynmanActions = actions;
    // The same writer the avatar bridge uses, so a test can play Sam's speech and the student's requests into it.
    dev.__feynmanQuestions = createQuestionWriter((note) => actions.writeOnBoard(note), {
      toLatex: async (spoken) => spokenToLatex(spoken) ?? (await remoteLatex(spoken).catch(() => null)),
    });
  }, [actions]);

  const handlers: AvatarHandlers = useMemo(
    () => ({
      onTranscript: (speaker, text, id) => {
        // The finished line replaces its live bubble in the same render (React batches both updates).
        if (id) setLiveLines((prev) => prev.filter((l) => l.id !== liveKey(id)));
        if (text.trim()) addLine(speaker, text.trim(), id);
        else if (id) liveStart.current.delete(id);
      },
      onTranscriptPartial: (id, speaker, textSoFar) => {
        const key = liveKey(id);
        if (!textSoFar.trim()) {
          liveStart.current.delete(id);
          setLiveLines((prev) => prev.filter((l) => l.id !== key));
          return;
        }
        const now = Date.now();
        sessionStart.current ??= now;
        if (!liveStart.current.has(id)) liveStart.current.set(id, now);
        const t = mmss(Math.max(0, liveStart.current.get(id)! - sessionStart.current));
        setLiveLines((prev) => {
          const i = prev.findIndex((l) => l.id === key);
          if (i < 0) return [...prev, { id: key, speaker, text: textSoFar, t }];
          if (prev[i].text === textSoFar) return prev;
          const next = prev.slice();
          next[i] = { ...prev[i], text: textSoFar };
          return next;
        });
      },
      onCue: (c) => {
        setCue(c);
        if (cueTimer.current) clearTimeout(cueTimer.current);
        cueTimer.current = setTimeout(() => setCue(null), CUE_TTL_MS);
      },
      onStatus: (status, detail) => {
        // A session that stops mid-sentence leaves no half-finished bubble behind.
        if (status !== "live" && status !== "connecting") {
          liveStart.current.clear();
          setLiveLines([]);
        }
        setAvatarStatus(status);
        setAvatarDetail(detail);
      },
    }),
    [addLine],
  );

  // Dev only: lets headless tests stream fake avatar lines (onTranscriptPartial) without an Anam session.
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") (window as unknown as { __feynmanHandlers?: AvatarHandlers }).__feynmanHandlers = handlers;
  }, [handlers]);

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

  /** T28: the raw transcript as a .txt (topic, date, final mark when there is one). */
  const downloadTranscript = useCallback(() => {
    const { transcript: lines, markScheme: s, report: r, curriculum: cur, view: v } = latest.current;
    const date = new Date(sessionStart.current ?? Date.now());
    const topic = s?.topic || cur?.topic || cur?.title;
    const text = formatTranscript({ topic, date, mark: r ? { awarded: r.awarded, total: r.total, final: v === "summary" } : undefined, lines, debug: diagLines() });
    downloadText(transcriptFileName(topic, date), text);
  }, []);

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
            <span className="hidden sm:inline">Finish &amp; final report</span>
            <span className="sm:hidden">Finish</span>
          </button>
        </div>
      </header>

      {/* Phones: one scrolling column (mark scheme, avatar, centre). lg+: three fixed-height columns. */}
      <main className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-6 pt-5 sm:px-6 lg:grid lg:grid-cols-[minmax(240px,0.85fr)_minmax(0,2fr)_minmax(340px,1.25fr)] lg:overflow-hidden">
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
                onChange={onBoardChange}
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
                  onDownloadTranscript={downloadTranscript}
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
            waiting={writing}
            cue={cue}
            transcript={transcript}
            liveLines={liveLines}
            onDownloadTranscript={downloadTranscript}
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
