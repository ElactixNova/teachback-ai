// Anam client tools (T2). Shared by the session-token route (declares them to the persona)
// and the browser bridge (handles them with registerToolCallHandler).
// Shape verified against https://anam.ai/docs/personas/tools/client-tools.md

export const TOOL = {
  captureWhiteboard: "capture_whiteboard",
  openGapReport: "open_gap_report",
  generateVisualExplainer: "generate_visual_explainer",
  getRailStatus: "get_rail_status",
  parkCriterion: "park_criterion",
} as const;

export type ToolName = (typeof TOOL)[keyof typeof TOOL];

/** Inline client tool definition for personaConfig.tools on POST /v1/auth/session-token. */
export interface AnamClientToolDefinition {
  type: "client";
  name: ToolName;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
  /** When true the handler's return value is sent back to the LLM. */
  awaitResult: boolean;
  toolTimeoutSeconds: number;
}

export const CLIENT_TOOLS: AnamClientToolDefinition[] = [
  {
    type: "client",
    name: TOOL.captureWhiteboard,
    description:
      "Look at the student's whiteboard. Use when the student says they drew something, points at the board, or you want to know what is on it. Returns whether the board has content.",
    parameters: { type: "object", properties: {} },
    awaitResult: true,
    toolTimeoutSeconds: 5,
  },
  {
    type: "client",
    name: TOOL.openGapReport,
    description:
      "Check the student's explanation (what they said plus the whiteboard) against their lecture notes and open the Knowledge Gap Report on screen. Use when the student asks you to check them, asks how they did, says they are finished, or says 'snap and check'. Returns the score, strengths and gaps so you can talk about them.",
    parameters: {
      type: "object",
      properties: {
        reuse_last: {
          type: "boolean",
          description: "True to just reopen the last report without a new check. Default false.",
        },
      },
    },
    awaitResult: true,
    toolTimeoutSeconds: 60,
  },
  {
    type: "client",
    name: TOOL.generateVisualExplainer,
    description:
      "Generate a short visual explainer (video or image) for a knowledge gap and show it in the report. Call this directly whenever the student asks for a visual, picture, diagram or video, or after a report when a visual would help. If no report exists yet it checks their explanation first. Appears on screen in a few seconds.",
    parameters: {
      type: "object",
      properties: {
        concept: {
          type: "string",
          description: "The concept of the gap to illustrate, as named in the report. Omit for the most severe gap.",
        },
      },
    },
    awaitResult: true,
    toolTimeoutSeconds: 60,
  },
];

// ---- Mark Scheme Rail (T11) -------------------------------------------------------------------

const railTool = (name: ToolName, description: string, properties: AnamClientToolDefinition["parameters"]["properties"] = {}, required?: string[], timeout = 10): AnamClientToolDefinition => ({
  type: "client",
  name,
  description,
  parameters: { type: "object", properties, ...(required ? { required } : {}) },
  awaitResult: true,
  toolTimeoutSeconds: timeout,
});

/** Tools for the rail persona: the live mark scheme drives what the avatar asks about. */
export const RAIL_TOOLS: AnamClientToolDefinition[] = [
  railTool(
    TOOL.getRailStatus,
    "See the live mark scheme: which points the student has explained fully, partly, parked or not covered yet, and which point to steer to next. Call it when the student pauses or asks what is left, and before choosing your next question.",
  ),
  railTool(
    TOOL.parkCriterion,
    "Park one mark-scheme point after the student has tried it twice and still cannot explain it (or says they don't know). It goes into their report and you must not ask about it again.",
    { criterion: { type: "string", description: "The point's title as given in the mark scheme (or its id, e.g. c2)." } },
    ["criterion"],
  ),
  railTool(
    TOOL.openGapReport,
    "End the teaching session: mark the whole explanation against the mark scheme and switch the screen to their results. Use when the student says they are finished, asks how they did, or asks you to check them. Returns their mark and the main gap.",
    {},
    undefined,
    45,
  ),
  railTool(
    TOOL.captureWhiteboard,
    "Check whether the student has drawn on the whiteboard. Use when they mention the board or a drawing.",
    {},
    undefined,
    5,
  ),
  railTool(
    TOOL.generateVisualExplainer,
    "Draw an accurate labelled diagram of one mark-scheme point the student lost marks on and show it on screen (takes about 20 seconds; keep talking). Use when they ask for a picture or diagram.",
    { criterion: { type: "string", description: "The point's title or id. Omit for the point with the most marks lost." } },
    undefined,
    10,
  ),
];
