// Anam avatar for the Mark Scheme Rail UI (T11). Same session plumbing as the legacy bridge, but the
// persona knows the mark-scheme titles and its tools read and steer the live rail (src/lib/rail).
//
//   const session = await anamRailBridge.connect({ videoElementId: ANAM_VIDEO_ID, rail: rail.avatarActions, handlers,
//                                                  context: { topic, notesExcerpt } });
//   rail.attachAvatar(session);           // rail changes (full marks, parked) reach the avatar as private context
//   ... on End: rail.attachAvatar(null); session.disconnect();
import type { AnamClient } from "@anam-ai/js-sdk";
import type { GapReport, MarkScheme } from "@/types/session";
import type { AvatarHandlers } from "@/components/workspace/types";
import type { RailAvatarActions } from "@/lib/rail/useRail";
import type { PersonaContext } from "./persona";
import { connectAnam, type AnamSession } from "./connect";
import { TOOL } from "./tools";

const arg = (p: { arguments?: Record<string, unknown> }, key: string) =>
  typeof p.arguments?.[key] === "string" ? (p.arguments[key] as string).trim() : "";

/** What the avatar is told after the final marking. Short, so it summarises instead of reading out. */
export function summariseFinal(scheme: MarkScheme | null, r: GapReport): string {
  const title = (id: string) => scheme?.criteria.find((c) => c.id === id)?.title ?? id;
  const primary = r.results.find((x) => x.criterionId === r.primaryGapId);
  const full = r.results.filter((x) => x.status === "full").map((x) => title(x.criterionId));
  return [
    `Their results are on screen now: ${r.awarded} out of ${r.total} marks.`,
    full.length ? `Fully explained: ${full.join("; ")}.` : "",
    primary
      ? `Main point to work on: "${title(primary.criterionId)}"${primary.missingSteps.length ? `, they missed: ${primary.missingSteps.slice(0, 3).join("; ")}` : ""}.`
      : "Nothing lost marks.",
    "Tell them their mark and that one point in two short sentences, warmly, as their student. Do not read this out or add corrections of your own.",
  ]
    .filter(Boolean)
    .join(" ");
}

function registerRailTools(client: AnamClient, rail: RailAvatarActions): () => void {
  const unregister = [
    client.registerToolCallHandler(TOOL.getRailStatus, { onStart: () => rail.getStatus() }),
    client.registerToolCallHandler(TOOL.parkCriterion, {
      onStart: async (p) => {
        const ref = arg(p, "criterion");
        return ref ? rail.park(ref) : "Say which point to park (its title).";
      },
    }),
    client.registerToolCallHandler(TOOL.openGapReport, {
      onStart: async () => {
        const report = await rail.finish();
        if (!report) return "There is nothing to mark yet: they have not explained or drawn anything. Ask them to start explaining.";
        return summariseFinal(rail.getMarkScheme(), report);
      },
    }),
    client.registerToolCallHandler(TOOL.captureWhiteboard, {
      onStart: async () => {
        const snap = rail.captureWhiteboard();
        if (!snap) return "The whiteboard is empty. Ask them to sketch what they mean.";
        return "They have drawn on the whiteboard; the examiner reads it with their explanation. Ask them to talk you through the drawing.";
      },
    }),
    client.registerToolCallHandler(TOOL.generateVisualExplainer, {
      onStart: async (p) => rail.requestVisual(arg(p, "criterion") || undefined),
    }),
  ];
  return () => unregister.forEach((u) => u());
}

export interface RailBridge {
  connect: (opts: {
    videoElementId: string;
    rail: RailAvatarActions;
    handlers: AvatarHandlers;
    /** Topic and a notes excerpt; the mark-scheme titles are added from `rail`. */
    context?: Omit<PersonaContext, "criteria">;
  }) => Promise<AnamSession>;
}

export const anamRailBridge: RailBridge = {
  connect({ videoElementId, rail, handlers, context = {} }) {
    const scheme = rail.getMarkScheme();
    return connectAnam({
      videoElementId,
      handlers,
      context: {
        topic: context.topic ?? scheme?.topic,
        notesExcerpt: context.notesExcerpt,
        criteria: scheme?.criteria.map((c) => ({ id: c.id, title: c.title })),
      },
      registerTools: (c) => registerRailTools(c, rail),
    });
  },
};
