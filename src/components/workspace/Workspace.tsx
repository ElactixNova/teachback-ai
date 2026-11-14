"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GraduationCap, PanelRightOpen } from "lucide-react";
import type { Cue, CurriculumContext, GapReport, VisualExplainer } from "@/types/session";
import { AvatarPanel } from "./AvatarPanel";
import { CurriculumUploader } from "./CurriculumUploader";
import { ReportDrawer } from "./ReportDrawer";
import { WhiteboardCanvas, type WhiteboardHandle } from "./WhiteboardCanvas";
import { analyze, generateVisual, visualRequestFor } from "./api";
// T2: real Anam bridge (src/lib/anam/bridge.ts).
import { anamAvatarBridge as avatarBridge } from "@/lib/anam/bridge";
import {
  ANAM_VIDEO_ID,
  SEVERITY_RANK,
  type AvatarHandlers,
  type AvatarSession,
  type AvatarStatus,
  type CheckStatus,
  type Speaker,
  type TranscriptLine,
  type VisualState,
  type WorkspaceActions,
} from "./types";

let lineSeq = 0;
const newLine = (speaker: Speaker, text: string): TranscriptLine => ({
  id: `l${Date.now()}-${lineSeq++}`,
  speaker,
  text,
  at: new Date().toISOString(),
});

/** How long a Director Notes cue badge stays visible. */
const CUE_TTL_MS = 4000;

export function Workspace() {
  const boardRef = useRef<WhiteboardHandle>(null);

  const [curriculum, setCurriculum] = useState<CurriculumContext | null>(null);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [boardEmpty, setBoardEmpty] = useState(true);

  const [avatarStatus, setAvatarStatus] = useState<AvatarStatus>("idle");
  const [avatarDetail, setAvatarDetail] = useState<string | undefined>();
  const [cue, setCue] = useState<Cue | null>(null);
  const sessionRef = useRef<AvatarSession | null>(null);
  const cueTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [report, setReport] = useState<GapReport | null>(null);
  const [checkStatus, setCheckStatus] = useState<CheckStatus>("idle");
  const [checkError, setCheckError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [visuals, setVisuals] = useState<Record<string, VisualState>>({});
  const [hint, setHint] = useState<string | null>(null);

  // Avatar tool calls run outside React render; read the latest state through refs.
  const latest = useRef({ curriculum, transcript, report });
  useEffect(() => {
    latest.current = { curriculum, transcript, report };
  }, [curriculum, transcript, report]);

  const generateVisualExplainer = useCallback(async (gapId?: string): Promise<VisualExplainer | null> => {
    const r = latest.current.report;
    if (!r || r.gaps.length === 0) return null;
    const gap = gapId
      ? r.gaps.find((g) => g.id === gapId)
      : [...r.gaps].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])[0];
    if (!gap) return null;
    setDrawerOpen(true);
    // Ignore results that arrive after a Re-check replaced this report.
    const setForThisReport = (state: VisualState) => {
      if (latest.current.report === r) setVisuals((v) => ({ ...v, [gap.id]: state }));
    };
    setForThisReport({ status: "loading" });
    try {
      const visual = await generateVisual(visualRequestFor(gap, latest.current.curriculum?.topic));
      setForThisReport({ status: "ready", visual });
      return visual;
    } catch (e) {
      setForThisReport({ status: "error", error: e instanceof Error ? e.message : "Could not generate a visual." });
      return null;
    }
  }, []);

  const checkExplanation = useCallback(async (): Promise<GapReport | null> => {
    const { curriculum: cur, transcript: lines } = latest.current;
    const whiteboard = boardRef.current?.exportSnapshot() ?? undefined;
    const text = lines.map((l) => `${l.speaker === "student" ? "Student" : "AI student"}: ${l.text}`).join("\n");

    if (!lines.some((l) => l.speaker === "student") && !whiteboard) {
      setHint("Explain something first: talk to the avatar, type below, or sketch on the whiteboard.");
      return null;
    }
    setHint(null);
    setCheckError(null);
    setCheckStatus("checking");
    setDrawerOpen(true);
    try {
      const r = await analyze({ transcript: text, curriculumText: cur?.text ?? "", whiteboard });
      setReport(r);
      setVisuals({});
      latest.current.report = r;
      setCheckStatus("idle");
      // Kick off the fal visual for the most severe gap right away.
      if (r.gaps.length > 0) void generateVisualExplainer();
      return r;
    } catch (e) {
      setCheckError(e instanceof Error ? e.message : "The check failed. Try again.");
      setCheckStatus("error");
      return null;
    }
  }, [generateVisualExplainer]);

  const actions: WorkspaceActions = useMemo(
    () => ({
      captureWhiteboard: () => boardRef.current?.exportSnapshot() ?? null,
      checkExplanation,
      openGapReport: () => setDrawerOpen(true),
      generateVisualExplainer,
      getReport: () => latest.current.report,
    }),
    [checkExplanation, generateVisualExplainer],
  );

  const handlers: AvatarHandlers = useMemo(
    () => ({
      onTranscript: (speaker, text) => {
        if (text.trim()) setTranscript((t) => [...t, newLine(speaker, text.trim())]);
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
    [],
  );

  const connect = useCallback(async () => {
    sessionRef.current?.disconnect();
    sessionRef.current = null;
    try {
      sessionRef.current = await avatarBridge.connect({ videoElementId: ANAM_VIDEO_ID, actions, handlers });
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
    setReport((r) =>
      r ? { ...r, studyPlan: r.studyPlan.map((s) => (s.id === stepId ? { ...s, done: !s.done } : s)) } : r,
    );

  const studentLines = transcript.filter((l) => l.speaker === "student").length;

  return (
    <div className="flex h-dvh flex-col bg-stone-100 font-sans text-stone-900">
      <header className="flex items-center gap-3 border-b border-stone-200 bg-white px-4 py-2.5 sm:px-6">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-stone-900 text-amber-400">
            <GraduationCap className="h-4.5 w-4.5" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-bold tracking-tight">Feynman AI</p>
            <p className="hidden text-[11px] text-stone-500 sm:block">Learn it by teaching it</p>
          </div>
        </div>

        {curriculum?.topic && (
          <span className="ml-2 hidden truncate rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900 md:inline">
            Teaching: {curriculum.topic}
          </span>
        )}

        <div className="ml-auto flex items-center gap-3">
          <span className="hidden text-xs text-stone-500 sm:inline">
            {studentLines} {studentLines === 1 ? "line" : "lines"} explained · {boardEmpty ? "board empty" : "board in use"}
          </span>
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="relative inline-flex items-center gap-1.5 rounded-lg border border-stone-200 px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50"
          >
            <PanelRightOpen className="h-4 w-4" /> Report
            {report && (
              <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-stone-950">
                {report.gaps.length}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* The hint disappears as soon as there is something to check. */}
      {hint && transcript.length === 0 && boardEmpty && (
        <div className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm text-amber-900" role="status">
          {hint}
        </div>
      )}

      {/* Phones: one scrolling column. lg+: fixed-height split screen. */}
      <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 sm:p-6 lg:grid lg:grid-cols-[minmax(340px,2fr)_3fr] lg:overflow-hidden">
        <div className="flex shrink-0 flex-col gap-3 lg:min-h-0 lg:shrink">
          <CurriculumUploader curriculum={curriculum} onChange={setCurriculum} />
          <AvatarPanel
            status={avatarStatus}
            statusDetail={avatarDetail}
            cue={cue}
            transcript={transcript}
            onConnect={() => void connect()}
            onDisconnect={disconnect}
            onTypedLine={(text) => {
              handlers.onTranscript("student", text);
              // When the avatar is live, it hears typed lines too.
              if (avatarStatus === "live") sessionRef.current?.sendText?.(text);
            }}
          />
        </div>
        <div className="h-[480px] shrink-0 lg:h-auto lg:min-h-0 lg:shrink">
          <WhiteboardCanvas
            ref={boardRef}
            checking={checkStatus === "checking"}
            onSnapAndCheck={() => void checkExplanation()}
            onEmptyChange={setBoardEmpty}
          />
        </div>
      </main>

      <ReportDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        report={report}
        checkStatus={checkStatus}
        checkError={checkError}
        visuals={visuals}
        onGenerateVisual={(id) => void generateVisualExplainer(id)}
        onToggleStep={toggleStep}
        onRecheck={() => void checkExplanation()}
      />
    </div>
  );
}
