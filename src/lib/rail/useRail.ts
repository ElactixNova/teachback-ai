"use client";
// Mark Scheme Rail session state for the T10 UI (T11). One hook owns: live marking while the student
// talks, attempts/parking, the switch to the end view, the final report, revision notes and gap visuals.
// It also provides the actions the Anam avatar's client tools call (see src/lib/anam/rail-bridge.ts).
//
//   const rail = useRail({ markScheme, curriculumText, getTranscript, getWhiteboard });
//   rail.state.results / rail.state.activeId / rail.score   -> MarkSchemeRail
//   rail.notifyStudentLine()                                -> call after each new student transcript line
//   rail.view === "end"                                     -> show the end screen (rail.final, rail.notes, rail.visuals)
//   anamRailBridge.connect({ ..., actions: rail.avatarActions, handlers }) then rail.attachAvatar(session)
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ApiError,
  CriterionResult,
  GapReport,
  LiveAnalyzeResponse,
  MarkScheme,
  RevisionNote,
  TimedLine,
  VisualExplainer,
} from "@/types/session";
import { visualRequestForCriterion } from "@/lib/fal/request";
import { createLiveLoop, type LiveLoop } from "./loop";
import {
  findCriterion,
  finalizeReport,
  initialRail,
  mergeLive,
  parkCriterion,
  railChangeNote,
  railScore,
  railStatusText,
  type RailState,
} from "./state";

export type RailView = "session" | "end";

export type Async<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; error: string };

/** What the avatar's client tools call. Return strings are read by the avatar's LLM, not shown. */
export interface RailAvatarActions {
  /** get_rail_status */
  getStatus: () => Promise<string>;
  /** park_criterion: by id or title. */
  park: (ref: string) => string;
  /** open_gap_report: final marking, switches to the end view. Null when there is nothing to mark. */
  finish: () => Promise<GapReport | null>;
  /** The scheme, so the bridge can name criteria in what it tells the avatar. */
  getMarkScheme: () => MarkScheme | null;
  /** capture_whiteboard: null when empty. */
  captureWhiteboard: () => { width: number; height: number } | null;
  /** generate_visual_explainer: starts a fal visual for a criterion (default: the primary gap). */
  requestVisual: (ref?: string) => string;
}

/** Push-only link to the live avatar (Anam addContext). */
export interface RailAvatarLink {
  addContext?: (text: string) => void;
}

export interface UseRailOptions {
  markScheme: MarkScheme | null;
  curriculumText: string;
  /** Current transcript with "mm:ss" offsets (see toTimedLines in ./state). Read fresh on every call. */
  getTranscript: () => TimedLine[];
  /** Whiteboard PNG (base64, no data: prefix), or undefined when empty. */
  getWhiteboard: () => string | undefined;
  /** Whiteboard size for capture_whiteboard (optional). */
  getWhiteboardSize?: () => { width: number; height: number } | null;
}

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  const data = (await res.json().catch(() => null)) as T | ApiError | null;
  if (!res.ok || !data) throw new Error(data && typeof data === "object" && "error" in data ? data.error : `${url} failed (${res.status})`);
  return data as T;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function useRail({ markScheme, curriculumText, getTranscript, getWhiteboard, getWhiteboardSize }: UseRailOptions) {
  const [state, setState] = useState<RailState | null>(() => (markScheme ? initialRail(markScheme) : null));
  const [view, setView] = useState<RailView>("session");
  const [live, setLive] = useState<{ running: boolean; error?: string }>({ running: false });
  const [final, setFinal] = useState<Async<GapReport>>({ status: "idle" });
  const [notes, setNotes] = useState<Async<RevisionNote[]>>({ status: "idle" });
  const [visuals, setVisuals] = useState<Record<string, Async<VisualExplainer>>>({});

  // Refs so tool handlers and the loop always read the latest values.
  const schemeRef = useRef(markScheme);
  const stateRef = useRef(state);
  const finalRef = useRef(final);
  const visualsRef = useRef(visuals);
  const inputRef = useRef({ curriculumText, getTranscript, getWhiteboard, getWhiteboardSize });
  const avatarRef = useRef<RailAvatarLink | null>(null);
  const finishing = useRef<Promise<GapReport | null> | null>(null);
  const loopRef = useRef<LiveLoop | null>(null);
  useEffect(() => {
    inputRef.current = { curriculumText, getTranscript, getWhiteboard, getWhiteboardSize };
  });
  useEffect(() => {
    finalRef.current = final;
    visualsRef.current = visuals;
  }, [final, visuals]);

  const commit = useCallback((next: RailState) => {
    const scheme = schemeRef.current;
    const before = stateRef.current;
    stateRef.current = next;
    setState(next);
    if (scheme && before) {
      const note = railChangeNote(scheme, before, next);
      if (note) avatarRef.current?.addContext?.(note);
    }
  }, []);

  // New mark scheme -> fresh rail and session (state reset during render, refs in the effect).
  const [schemeSeen, setSchemeSeen] = useState(markScheme);
  if (schemeSeen !== markScheme) {
    setSchemeSeen(markScheme);
    setState(markScheme ? initialRail(markScheme) : null);
    setView("session");
    setFinal({ status: "idle" });
    setNotes({ status: "idle" });
    setVisuals({});
  }
  useEffect(() => {
    if (schemeRef.current === markScheme) return;
    schemeRef.current = markScheme;
    stateRef.current = markScheme ? initialRail(markScheme) : null;
    finishing.current = null;
  }, [markScheme]);

  // Live marking loop.
  useEffect(() => {
    if (!markScheme) return;
    const loop = createLiveLoop({
      run: async (signal) => {
        const { getTranscript: gt, getWhiteboard: gw } = inputRef.current;
        const transcript = gt();
        if (!transcript.some((l) => l.speaker === "student")) return;
        setLive({ running: true });
        try {
          const res = await postJson<LiveAnalyzeResponse>(
            "/api/analyze",
            { markScheme, transcript, whiteboardBase64: gw(), mode: "live" },
            signal,
          );
          if (schemeRef.current !== markScheme || !stateRef.current || finishing.current) return;
          commit(mergeLive(markScheme, stateRef.current, res.results, transcript));
          setLive({ running: false });
        } catch (e) {
          setLive({ running: false, error: errText(e) });
          throw e;
        }
      },
      onError: (e) => console.warn("[rail] live analysis failed", e),
    });
    loopRef.current = loop;
    return () => {
      loop.stop();
      if (loopRef.current === loop) loopRef.current = null;
    };
  }, [markScheme, commit]);

  const notifyStudentLine = useCallback(() => {
    if (!finishing.current) loopRef.current?.poke();
  }, []);

  const park = useCallback(
    (criterionId: string) => {
      const scheme = schemeRef.current;
      if (scheme && stateRef.current) commit(parkCriterion(scheme, stateRef.current, criterionId));
    },
    [commit],
  );

  const requestVisualFor = useCallback((criterionId: string, report?: GapReport | null) => {
    const scheme = schemeRef.current;
    const criterion = scheme?.criteria.find((c) => c.id === criterionId);
    const result: CriterionResult | undefined =
      (report ?? (finalRef.current.status === "ready" ? finalRef.current.data : null))?.results.find((r) => r.criterionId === criterionId) ??
      stateRef.current?.results.find((r) => r.criterionId === criterionId);
    if (!scheme || !criterion || !result) return false;
    const current = visualsRef.current[criterionId];
    if (current?.status === "loading" || current?.status === "ready") return true;
    const loading = { ...visualsRef.current, [criterionId]: { status: "loading" } as const };
    visualsRef.current = loading;
    setVisuals(loading);
    postJson<VisualExplainer>("/api/generate-visual", visualRequestForCriterion(criterion, result, scheme.topic))
      .then((v) => setVisuals((m) => ({ ...m, [criterionId]: { status: "ready", data: v } })))
      .catch((e) => setVisuals((m) => ({ ...m, [criterionId]: { status: "error", error: errText(e) } })));
    return true;
  }, []);

  /** Final marking: switch to the end view at once, then fill in the report, revision notes and the primary visual. */
  const finish = useCallback((): Promise<GapReport | null> => {
    const scheme = schemeRef.current;
    if (!scheme) return Promise.resolve(null);
    if (finishing.current) return finishing.current;
    if (finalRef.current.status === "ready") {
      setView("end");
      return Promise.resolve(finalRef.current.data);
    }
    const { curriculumText: text, getTranscript: gt, getWhiteboard: gw } = inputRef.current;
    const transcript = gt();
    const board = gw();
    if (!transcript.some((l) => l.speaker === "student" && l.text.trim()) && !board) return Promise.resolve(null);

    loopRef.current?.stop();
    setView("end");
    setFinal({ status: "loading" });
    const p = postJson<GapReport>("/api/analyze", { markScheme: scheme, transcript, whiteboardBase64: board, mode: "final" })
      .then((raw) => {
        const report = stateRef.current ? finalizeReport(scheme, raw, stateRef.current) : raw;
        setFinal({ status: "ready", data: report });
        if (report.primaryGapId) requestVisualFor(report.primaryGapId, report);
        if (report.results.some((r) => r.status !== "full" && r.status !== "not_covered") && text) {
          setNotes({ status: "loading" });
          postJson<RevisionNote[]>("/api/revision-notes", { markScheme: scheme, report, curriculumText: text })
            .then((n) => setNotes({ status: "ready", data: n }))
            .catch((e) => setNotes({ status: "error", error: errText(e) }));
        }
        return report;
      })
      .catch((e) => {
        setFinal({ status: "error", error: errText(e) });
        finishing.current = null;
        return null;
      });
    finishing.current = p;
    return p;
  }, [requestVisualFor]);

  const avatarActions = useMemo<RailAvatarActions>(
    () => ({
      async getStatus() {
        const scheme = schemeRef.current;
        if (!scheme || !stateRef.current) return "There is no mark scheme yet. Ask the student what they want to teach.";
        // Fold in what was just said, but don't keep the avatar waiting long.
        await Promise.race([loopRef.current?.flush(), new Promise((r) => setTimeout(r, 4000))]);
        return railStatusText(scheme, stateRef.current!);
      },
      park(ref) {
        const scheme = schemeRef.current;
        const c = scheme && findCriterion(scheme, ref);
        if (!c) return `No point called "${ref}" on the mark scheme. Carry on without parking.`;
        park(c.id);
        return `Parked "${c.title}". It will be in their report. Do not ask about it again; move on to another part of the topic.`;
      },
      finish,
      getMarkScheme: () => schemeRef.current,
      captureWhiteboard() {
        const { getWhiteboard: gw, getWhiteboardSize: gs } = inputRef.current;
        if (!gw()) return null;
        return gs?.() ?? { width: 0, height: 0 };
      },
      requestVisual(ref) {
        const scheme = schemeRef.current;
        if (!scheme) return "There is nothing to illustrate yet.";
        const report = finalRef.current.status === "ready" ? finalRef.current.data : null;
        const c = ref ? findCriterion(scheme, ref) : undefined;
        const id = c?.id ?? report?.primaryGapId ?? stateRef.current?.results.find((r) => r.status === "partial" || r.status === "missed" || r.status === "parked")?.criterionId;
        if (!id) return "Nothing has lost marks yet, so there is nothing to illustrate. Encourage them to keep going.";
        const title = scheme.criteria.find((x) => x.id === id)?.title ?? id;
        return requestVisualFor(id, report)
          ? `A labelled diagram for "${title}" is being drawn and will appear on screen in about 20 seconds. Keep talking meanwhile.`
          : "Could not start a visual for that point.";
      },
    }),
    [finish, park, requestVisualFor],
  );

  const attachAvatar = useCallback((link: RailAvatarLink | null) => {
    avatarRef.current = link;
  }, []);

  const score = markScheme && state ? railScore(markScheme, state) : { awarded: 0, total: 0 };

  return {
    state,
    score,
    view,
    setView,
    live,
    final,
    notes,
    visuals,
    notifyStudentLine,
    park,
    finish,
    requestVisual: (criterionId: string) => requestVisualFor(criterionId),
    avatarActions,
    attachAvatar,
  };
}

export type RailController = ReturnType<typeof useRail>;
