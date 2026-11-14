// Anam client tools (T2). Shared by the session-token route (declares them to the persona)
// and the browser bridge (handles them with registerToolCallHandler).
// Shape verified against https://anam.ai/docs/personas/tools/client-tools.md

export const TOOL = {
  captureWhiteboard: "capture_whiteboard",
  openGapReport: "open_gap_report",
  generateVisualExplainer: "generate_visual_explainer",
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
      "Generate a short visual explainer (video or image) for one knowledge gap and show it in the report. Use after a report exists, when the student asks to see it, or for the most important misconception. Starts in the background and appears on screen in a few seconds.",
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
    toolTimeoutSeconds: 10,
  },
];
