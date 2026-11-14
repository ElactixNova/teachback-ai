"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Flag, LoaderCircle, Sparkles } from "lucide-react";
import type { Cue, CurriculumContext, MarkScheme, TimedLine } from "@/types/session";
import { anamRailBridge } from "@/lib/anam/rail-bridge";
import type { AnamSession } from "@/lib/anam/connect";
import { useRail, type Async } from "@/lib/rail/useRail";
import { AvatarPanel } from "./AvatarPanel";
import { CentrePanel } from "./CentrePanel";
import { GapNotesPanel, gapsOf, type CheckState } from "./GapNotesPanel";
import { MarkSchemeRail } from "./MarkSchemeRail";
import { MAX_LEARN_IMAGES, SummaryView } from "./SummaryView";
import { WhiteboardCanvas, type WhiteboardHandle } from "./WhiteboardCanvas";
import { fetchMarkScheme } from "./api";
import { ANAM_VIDEO_ID, type AvatarHandlers, type AvatarStatus, type CentreView, type Speaker, type TranscriptLine } from "./types";

/** How long a Director Notes cue badge stays visible. */
const CUE_TTL_MS = 4000;
/** Lecture text sent to the avatar persona (topic-aware questions). */
const NOTES_EXCERPT_CHARS = 4000;

let lineSeq = 0;
const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/** Transcript for the examiner: student and avatar lines only, with their "mm:ss". */
const timed = (lines: TranscriptLine[]): TimedLine[] =>
  lines.filter((l): l is TranscriptLine & { speaker: Speaker } => l.speaker !== "system").map(({ speaker, text, t }) => ({ speaker, text, t }));

export function Workspace() {
  const boardRef = useRef<WhiteboardHandle>(null);

  const [curriculum, setCurriculum] = useState<CurriculumContext | null>(null);
  const [sourceFile, setSourceFile] = useState("notes.pdf");
  const [scheme, setScheme] = useState<Async<MarkScheme>>({ status: "idle" });
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [boardEmpty, setBoardEmpty] = useState(true);
  const sessionStart = useRef<number | null>(null);

  const [avatarStatus, setAvatarStatus] = useState<AvatarStatus>("idle");
  const [avatarDetail, setAvatarDetail] = useState<string | undefined>();
  const [cue, setCue] = useState<Cue | null>(null);
  const sessionRef = useRef<AnamSession | null>(null);
  const cueTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Centre column while in session; the end screen is rail.view === "end". */
  const [centre, setCentre] = useState<CentreView>("board");

  const markScheme = scheme.status === "ready" ? scheme.data : null;

  const transcriptRef = useRef(transcript);
  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  const rail = useRail({
    markScheme,
    curriculumText: curriculum?.text ?? "",
    getTranscript: () => timed(transcriptRef.current),
    getWhiteboard: () => boardRef.current?.exportSnapshotBase64() ?? undefined,
    getWhiteboardSize: () => {
      const s = boardRef.current?.exportSnapshot();
      return s ? { width: s.width, height: s.height } : null;
    },
  });

  const addLine = useCallback((speaker: TranscriptLine["speaker"], text: string) => {
    const now = Date.now();
    sessionStart.current ??= now;
    const line: TranscriptLine = { id: `l${now}-${lineSeq++}`, speaker, text, at: new Date(now).toISOString(), t: mmss(now - sessionStart.current) };
    // Keep the ref current at once, so live marking poked below already sees this line.
    transcriptRef.current = [...transcriptRef.current, line];
    setTranscript(transcriptRef.current);
  }, []);

  const { notifyStudentLine } = rail;
  const onLine = useCallback(
    (speaker: Speaker, text: string) => {
      const clean = text.trim();
      if (!clean) return;
      addLine(speaker, clean);
      if (speaker === "student") notifyStudentLine();
    },
    [addLine, notifyStudentLine],
  );

  // ---- Mark scheme ----------------------------------------------------------------------------
  const schemeSeq = useRef(0);
  const buildScheme = useCallback(async (cur: CurriculumContext, file: string, topic: string) => {
    const seq = ++schemeSeq.current;
    setScheme({ status: "loading" });
    try {
      const s = await fetchMarkScheme({ curriculumText: cur.text, topic, sourceFile: file });
      if (seq === schemeSeq.current) setScheme({ status: "ready", data: s });
    } catch (e) {
      if (seq === schemeSeq.current) setScheme({ status: "error", error: e instanceof Error ? e.message : "Could not draft a mark scheme." });
    }
  }, []);

  const onCurriculumChange = (cur: CurriculumContext | null, fileName?: string) => {
    setCurriculum(cur);
    setCentre("board");
    if (!cur) {
      schemeSeq.current++;
      setScheme({ status: "idle" });
      return;
    }
    if (fileName) {
      setSourceFile(fileName);
      void buildScheme(cur, fileName, cur.topic ?? cur.title);
    }
  };

  // ---- Parked points show up in the conversation feed ------------------------------------------
  const parkedSeen = useRef(new Set<string>());
  const results = rail.state?.results;
  useEffect(() => {
    if (!markScheme || !results) {
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

  // ---- Checking and the end screen --------------------------------------------------------------
  // Study-plan ticks are local to the UI; the report itself comes from the rail.
  const [doneSteps, setDoneSteps] = useState<Set<string>>(new Set());
  const finalReport = rail.final.status === "ready" ? rail.final.data : null;
  const report = useMemo(
    () => (finalReport ? { ...finalReport, studyPlan: finalReport.studyPlan.map((s) => ({ ...s, done: doneSteps.has(s.id) })) } : null),
    [finalReport, doneSteps],
  );
  const toggleStep = (id: string) =>
    setDoneSteps((d) => {
      const next = new Set(d);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const ended = rail.view === "end";

  /** Snap & Check: mark now, and show the gap notes in place of the whiteboard (not the end screen). */
  const snapAndCheck = () => {
    setCentre("notes");
    void rail.finish();
    rail.setView("session");
  };

  // On the end screen, draw up to MAX_LEARN_IMAGES gaps, worst first (the primary gap is already started).
  const { requestVisual } = rail;
  useEffect(() => {
    if (!ended || !report || !markScheme) return;
    for (const g of gapsOf(markScheme, report).slice(0, MAX_LEARN_IMAGES)) requestVisual(g.criterion.id);
  }, [ended, report, markScheme, requestVisual]);

  const teachNext = (ids: string[]) => {
    if (!markScheme) return;
    const picked = markScheme.criteria.filter((c) => ids.includes(c.id));
    const r = rail as typeof rail & { resume?: (ids?: string[]) => void };
    if (r.resume) r.resume(ids);
    else rail.setView("session");
    setCentre("board");
    addLine("system", `Next up: ${picked.map((c) => c.title).join(", ")}`);
  };

  const check: CheckState =
    rail.final.status === "loading"
      ? { status: "checking" }
      : rail.final.status === "error"
        ? { status: "error", error: rail.final.error }
        : { status: "idle" };
  const checking = check.status === "checking";

  // ---- Avatar ---------------------------------------------------------------------------------
  const handlers: AvatarHandlers = useMemo(
    () => ({
      onTranscript: onLine,
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
    [onLine],
  );

  const { attachAvatar, avatarActions } = rail;
  const disconnect = useCallback(() => {
    attachAvatar(null);
    sessionRef.current?.disconnect();
    sessionRef.current = null;
    setCue(null);
  }, [attachAvatar]);

  const connect = useCallback(async () => {
    disconnect();
    sessionStart.current ??= Date.now();
    try {
      const session = await anamRailBridge.connect({
        videoElementId: ANAM_VIDEO_ID,
        rail: avatarActions,
        handlers,
        context: { topic: markScheme?.topic || curriculum?.topic || curriculum?.title, notesExcerpt: curriculum?.text.slice(0, NOTES_EXCERPT_CHARS) },
      });
      sessionRef.current = session;
      attachAvatar(session);
    } catch (e) {
      handlers.onStatus("error", e instanceof Error ? e.message : "Could not connect to the avatar.");
    }
  }, [disconnect, avatarActions, handlers, attachAvatar, markScheme, curriculum]);

  useEffect(
    () => () => {
      sessionRef.current?.disconnect();
      if (cueTimer.current) clearTimeout(cueTimer.current);
    },
    [],
  );

  const studentLines = transcript.filter((l) => l.speaker === "student").length;
  const railResults = ended && report ? report.results : (rail.state?.results ?? []);
  const parkedIds = railResults.filter((r) => r.parked).map((r) => r.criterionId);
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
          {report && (ended || centre !== "notes") && (
            <button
              type="button"
              onClick={() => {
                rail.setView("session");
                setCentre("notes");
              }}
              className="hidden h-11 items-center rounded-xl px-3 text-sm font-bold text-muted hover:bg-canvas sm:inline-flex"
            >
              Gap notes
            </button>
          )}
          <button
            type="button"
            onClick={() => void rail.finish()}
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
            results={railResults}
            liveId={ended ? null : (rail.state?.activeId ?? null)}
            analysing={rail.live.running}
            onRebuild={(topic) => curriculum && void buildScheme({ ...curriculum, topic }, sourceFile, topic)}
            onEdit={(s) => setScheme({ status: "ready", data: s })}
            final={ended}
          />
        </div>

        <div className="order-3 shrink-0 lg:order-none lg:min-h-0">
          <CentrePanel
            view={ended ? "summary" : centre}
            board={
              <WhiteboardCanvas
                ref={boardRef}
                checking={checking}
                onSnapAndCheck={snapAndCheck}
                onEmptyChange={setBoardEmpty}
                onChange={notifyStudentLine}
              />
            }
            notes={
              <GapNotesPanel
                scheme={markScheme}
                report={report}
                check={check}
                visuals={rail.visuals}
                onBack={() => setCentre("board")}
                onRecheck={snapAndCheck}
                onTeachNext={teachNext}
                onRetryVisual={(id) => rail.requestVisual(id)}
                onToggleStep={toggleStep}
              />
            }
            summary={
              markScheme && report ? (
                <SummaryView
                  scheme={markScheme}
                  report={report}
                  notes={rail.notes}
                  visuals={rail.visuals}
                  onRetryVisual={(id) => rail.requestVisual(id)}
                  onTeachBack={teachNext}
                  onBack={() => {
                    rail.setView("session");
                    setCentre("board");
                  }}
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 rounded-2xl border border-line bg-card p-6 text-center text-sm font-semibold text-muted" role="status">
                  {check.status === "error" ? (
                    <>
                      <p className="font-bold text-missed">The final marking didn’t finish</p>
                      <p>{check.error}</p>
                      <button type="button" onClick={() => void rail.finish()} className="inline-flex h-11 items-center rounded-xl border border-line px-4 font-bold text-ink hover:bg-canvas">
                        Try again
                      </button>
                    </>
                  ) : (
                    <>
                      <LoaderCircle className="h-6 w-6 animate-spin text-accent" />
                      Marking your session against the mark scheme… about 15 seconds
                    </>
                  )}
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
              onLine("student", text);
              // When the avatar is live, it hears typed lines too.
              if (avatarStatus === "live") sessionRef.current?.sendText?.(text);
            }}
          >
            {ended && report && retryIds.length > 0 && (
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
