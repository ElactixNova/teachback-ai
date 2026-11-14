// Browser-side Anam integration for the legacy workspace (T2). Implements the AvatarBridge seam from
// src/components/workspace/types.ts with the 3 original client tools. The Mark Scheme Rail UI uses
// ./rail-bridge.ts instead; this file goes when the legacy UI is deleted.
import type { AnamClient } from "@anam-ai/js-sdk";
import type { LegacyGapReport } from "@/types/session";
import type { AvatarBridge, WorkspaceActions } from "@/components/workspace/types";
import type { PersonaContext } from "./persona";
import { connectAnam } from "./connect";
import { TOOL } from "./tools";

function summariseReport(r: LegacyGapReport): string {
  const gaps = r.gaps.length
    ? r.gaps.map((g) => `${g.concept} (${g.severity}): they said "${g.misconception}"; the notes say "${g.correction}"`).join("; ")
    : "none";
  return `Report is open on screen. Score ${r.score}/100. Summary: ${r.summary} Strengths: ${
    r.strengths.join(", ") || "none"
  }. Gaps: ${gaps}. Tell the student their score and the most important gap in one or two sentences, as a curious student would, without reading this out. Only talk about the gaps listed here; do not add corrections of your own.`;
}

/** A check that finished this recently is reused instead of re-running the analysis. */
const RECENT_CHECK_MS = 20_000;

function registerTools(client: AnamClient, actions: WorkspaceActions) {
  // The LLM sometimes calls the check twice in a row ("I'm finished" ... "check my explanation").
  // Share one in-flight check and reuse a fresh result, so we never pay for two analyses + visuals.
  let inflight: Promise<LegacyGapReport | null> | null = null;
  let lastCheckAt = 0;
  const check = (): Promise<LegacyGapReport | null> => {
    const fresh = actions.getReport();
    if (fresh && Date.now() - lastCheckAt < RECENT_CHECK_MS) {
      actions.openGapReport();
      return Promise.resolve(fresh);
    }
    inflight ??= actions.checkExplanation().finally(() => {
      lastCheckAt = Date.now();
      inflight = null;
    });
    return inflight;
  };

  const unregister = [
    client.registerToolCallHandler(TOOL.captureWhiteboard, {
      onStart: async () => {
        const snap = actions.captureWhiteboard();
        if (!snap) return "The whiteboard is empty. Ask the student to sketch what they mean.";
        return `The student has drawn on the whiteboard (${snap.width}x${snap.height}). You cannot see details yet; it will be checked with ${TOOL.openGapReport}. Ask them to talk you through the drawing.`;
      },
    }),
    client.registerToolCallHandler(TOOL.openGapReport, {
      onStart: async (p) => {
        const last = actions.getReport();
        if (p.arguments?.reuse_last && last) {
          actions.openGapReport();
          return summariseReport(last);
        }
        const report = await check();
        if (!report) return "The check could not run: the student has not explained anything yet, or the check failed. Ask them to explain a bit more first.";
        return summariseReport(report);
      },
    }),
    client.registerToolCallHandler(TOOL.generateVisualExplainer, {
      onStart: async (p) => {
        let r = actions.getReport();
        if (!r) {
          // No report yet: run the check; the workspace then starts the visual for the top gap itself.
          r = await check();
          if (!r) return "The check could not run: the student has not explained anything yet. Ask them to explain a bit first.";
          if (r.gaps.length === 0) return `${summariseReport(r)} There are no gaps, so no visual is needed.`;
          return `${summariseReport(r)} A visual for the most important gap is being generated and will appear in the report in a few seconds.`;
        }
        if (r.gaps.length === 0) return "The latest report has no gaps, so there is nothing to illustrate. Tell the student they did well.";
        const wanted = typeof p.arguments?.concept === "string" ? p.arguments.concept.toLowerCase().trim() : "";
        const gap = wanted
          ? r.gaps.find((g) => g.concept.toLowerCase().includes(wanted) || wanted.includes(g.concept.toLowerCase()))
          : undefined;
        // Fire and forget: fal can take longer than the tool timeout; the drawer shows progress.
        void actions.generateVisualExplainer(gap?.id);
        return `Generating a visual for "${gap?.concept ?? "the most important gap"}". It will appear in the report in a few seconds. Tell the student to watch for it.`;
      },
    }),
  ];
  return () => unregister.forEach((u) => u());
}

/** Create a bridge. `getContext` scopes the persona (topic + notes) at connect time. */
export function createAnamAvatarBridge(getContext: () => PersonaContext = () => ({})): AvatarBridge {
  return {
    connect: ({ videoElementId, actions, handlers }) =>
      connectAnam({ videoElementId, handlers, context: getContext(), registerTools: (c) => registerTools(c, actions) }),
  };
}

/** Default bridge with a generic persona (no topic). */
export const anamAvatarBridge = createAnamAvatarBridge();
