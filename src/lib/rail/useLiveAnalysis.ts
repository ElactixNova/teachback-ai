"use client";
// Live marking while the student teaches (T11). The workspace (T10) owns the rail results; this hook
// only decides when to call POST /api/analyze (mode "live") and hands the results back.
//
//   const live = useLiveAnalysis({
//     enabled: avatarLive && view === "board",
//     getInput: () => (markScheme ? { markScheme, transcript, whiteboardBase64, mode: "live" } : null),
//     onResults: (incoming, req) => setResults((prev) => mergeLiveResults(markScheme, prev, incoming, req.transcript)),
//     changeKey: `${transcript.length}:${boardVersion}`,   // a change schedules a run
//   });
import { useCallback, useEffect, useRef, useState } from "react";
import type { AnalyzeRequest, ApiError, CriterionResult, LiveAnalyzeResponse } from "@/types/session";
import { createLiveLoop, type LiveLoop } from "./loop";

export interface UseLiveAnalysisOptions {
  enabled: boolean;
  /** Read fresh on every run; null skips the run. `mode` is forced to "live". */
  getInput: () => AnalyzeRequest | null;
  /** Called with each live result set (stale or cancelled responses are dropped). */
  onResults: (results: CriterionResult[], request: AnalyzeRequest) => void;
  /** Minimum time between two runs (each run costs a model call). Default 20 s. */
  debounceMs?: number;
  /** Quiet time after the last change before a run, so we don't mark half a sentence. Default 2.5 s. */
  quietMs?: number;
  /** Any value that changes when the transcript or the board changes; each change schedules a run. */
  changeKey?: unknown;
}

export function useLiveAnalysis({ enabled, getInput, onResults, debounceMs = 20_000, quietMs = 2_500, changeKey }: UseLiveAnalysisOptions) {
  const [analysing, setAnalysing] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const loopRef = useRef<LiveLoop | null>(null);
  const cb = useRef({ getInput, onResults });
  useEffect(() => {
    cb.current = { getInput, onResults };
  });

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const loop = createLiveLoop({
      quietMs,
      minIntervalMs: debounceMs,
      run: async (signal) => {
        const input = cb.current.getInput();
        // Something to mark: the student said something, or (T30) wrote on the board without speaking.
        if (!input || (!input.whiteboardBase64 && !input.transcript.some((l) => l.speaker === "student" && l.text.trim()))) return;
        const request: AnalyzeRequest = { ...input, mode: "live" };
        setAnalysing(true);
        try {
          const res = await fetch("/api/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(request),
            signal,
          });
          const data = (await res.json().catch(() => null)) as LiveAnalyzeResponse | ApiError | null;
          if (!res.ok || !data || !("results" in data)) {
            throw new Error(data && "error" in data ? data.error : `Live marking failed (${res.status})`);
          }
          if (!alive || signal.aborted) return;
          setLastError(null);
          cb.current.onResults(data.results, request);
        } catch (e) {
          if (alive && !signal.aborted) setLastError(e instanceof Error ? e.message : String(e));
          throw e;
        } finally {
          if (alive) setAnalysing(false);
        }
      },
      onError: (e) => console.warn("[rail] live analysis failed", e),
    });
    loopRef.current = loop;
    return () => {
      alive = false;
      loop.stop();
      if (loopRef.current === loop) loopRef.current = null;
    };
  }, [enabled, debounceMs, quietMs]);

  // Each transcript/board change schedules a run (debounced inside the loop).
  useEffect(() => {
    if (changeKey !== undefined) loopRef.current?.poke();
  }, [changeKey]);

  /** Schedule a run (same as a changeKey change). */
  const trigger = useCallback(() => loopRef.current?.poke(), []);
  /** Run now if allowed (e.g. the avatar asked for the rail status); resolves when that run ends. */
  const flush = useCallback(() => loopRef.current?.flush() ?? Promise.resolve(), []);

  return { analysing, lastError, trigger, flush };
}
