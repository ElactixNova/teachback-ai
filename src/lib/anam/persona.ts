// Server-only: the ephemeral persona config sent to POST https://api.anam.ai/v1/auth/session-token.
// Field names verified against https://anam.ai/docs/api-reference/sessions/create-session-token.md
import { CLIENT_TOOLS, TOOL, type AnamClientToolDefinition } from "./tools";

/** Defaults from Anam's docs; override with env vars once we pick a face/voice in Anam Lab. */
const DEFAULTS = {
  avatarId: "071b0286-4cce-4808-bee2-e642f1062de3",
  voiceId: "de23e340-1416-4dd8-977d-065a7ca11697",
  // GPT OSS 120B: "Recommended for most projects ... handles tools reliably."
  llmId: "a7cf662c-2ace-4de1-a21e-ef0fbf144bb7",
  // "For new integrations, use Cara-4.1 Express"
  avatarModel: "cara-4.1-express",
};

export interface PersonaContext {
  topic?: string;
  /** Short excerpt of the lecture notes so the persona can ask sensible questions. */
  notesExcerpt?: string;
}

export interface AnamPersonaConfig {
  name: string;
  avatarId: string;
  avatarModel: string;
  voiceId: string;
  llmId: string;
  systemPrompt: string;
  maxSessionLengthSeconds: number;
  initialMessage: string;
  directorNotes: { presetStyle: "warm"; expressivity: number };
  tools: AnamClientToolDefinition[];
}

const MAX_EXCERPT = 4000;

export function buildSystemPrompt(ctx: PersonaContext = {}): string {
  const topic = ctx.topic?.trim();
  const excerpt = ctx.notesExcerpt?.trim().slice(0, MAX_EXCERPT);
  return [
    "[ROLE] You are Sam, a bright, friendly student. The user is your teacher: they are explaining a topic to you out loud and may sketch on a whiteboard. This is the Feynman technique, so they learn by teaching you.",
    topic ? `[TOPIC] Today they are teaching you: ${topic}.` : "[TOPIC] Ask what they want to teach you today if they have not said.",
    "[BEHAVIOUR] Listen more than you talk. Keep replies to one or two short spoken sentences. Ask one simple follow-up question at a time, like a curious learner who wants to understand why. Never lecture, never give the full correct answer, and never correct them directly: if something sounds wrong or vague, say what confuses you and ask them to explain it again. Reply in natural speech without lists, markdown or emojis.",
    "[EXPRESSION] Use Anam cue tags sparingly and naturally to show how well you are following. Available cue tags: [happy], [curious], [concerned], [surprised]. Use [happy] when an explanation clearly makes sense, [curious] when you want to know more or something is vague, [concerned] when something sounds wrong or contradicts itself, [surprised] for a surprising fact. Place one tag at the start of a sentence, before the words it affects. Only use a tag when your feeling noticeably changes. Never say or explain the tags.",
    `[TOOLS] Call ${TOOL.captureWhiteboard} when they mention the board or a drawing. Call ${TOOL.openGapReport} when they ask you to check their explanation, ask how they did, or say they are finished; then tell them their score and the one gap that matters most, in your own words, without reading the report out. Call ${TOOL.generateVisualExplainer} after a report when a visual would help, or when they ask to see one. Say a few words like "let me look" before a tool runs.`,
    excerpt
      ? `[NOTES] Their lecture notes say (for your private reference only, do not quote them or reveal answers):\n${excerpt}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildPersonaConfig(ctx: PersonaContext = {}): AnamPersonaConfig {
  const env = process.env;
  return {
    name: "Sam",
    avatarId: env.ANAM_AVATAR_ID || DEFAULTS.avatarId,
    avatarModel: env.ANAM_AVATAR_MODEL || DEFAULTS.avatarModel,
    voiceId: env.ANAM_VOICE_ID || DEFAULTS.voiceId,
    llmId: env.ANAM_LLM_ID || DEFAULTS.llmId,
    systemPrompt: buildSystemPrompt(ctx),
    maxSessionLengthSeconds: 900,
    initialMessage: ctx.topic
      ? `[happy] Hi! I'm ready to learn about ${ctx.topic}. Teach me, I'm all ears.`
      : "[happy] Hi! I'm Sam, your student today. What are you going to teach me?",
    directorNotes: { presetStyle: "warm", expressivity: 0.6 },
    tools: CLIENT_TOOLS,
  };
}
