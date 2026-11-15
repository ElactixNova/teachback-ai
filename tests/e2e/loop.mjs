// Training loop for Sam: a Haiku "teacher" teaches the real avatar, a Haiku judge scores the transcript.
// Sam's own LLM is Anam's, so this measures the real prompt + notes, not a stand-in.
//
//   npm run dev                                               # repo root
//   cd tests/e2e && node --env-file=../../.env loop.mjs [explainer|terse|mixed] [turns]
//
// Prints the transcript, the judge's findings and writes out/loop-<style>.txt. One Anam session and a few
// small Haiku calls per run (a few cents). Env: BASE_URL, PDF, CHROMIUM_PATH, HEADED=1.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const { chromiumPath } = require("./chromium-path.cjs");
const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL || "http://localhost:3000";
const STYLE = process.argv[2] || "mixed";
const TURNS = Number(process.argv[3]) || 9;
const PDF = process.env.PDF || "Quadratic_Equations_GCSE_AQA_Notes.pdf";
const HAIKU = process.env.LOOP_MODEL || "claude-haiku-5-5";

async function ask(system, user, max = 2500) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: HAIKU, max_tokens: max, system, messages: [{ role: "user", content: user }] }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`LLM ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
  const out = body.content.map((c) => c.text ?? "").join("").trim();
  if (!out) throw new Error(`LLM returned nothing (${body.stop_reason})`);
  return out;
}

const STYLES = {
  explainer: "You explain freely: 2 to 4 sentences, covering a whole idea, with an example, in natural spoken English.",
  terse: "You are a lazy, terse student: answer in 3 to 8 words, often a fragment (\"the 2\", \"you factorise it\"), never elaborating unless pushed.",
  offers: "Every second message, instead of explaining, ask Sam whether she wants you to demonstrate something, e.g. \"Do you want me to draw that?\" or \"Shall I show you an example?\". When Sam says yes or asks you to, reply BOARD (for a drawing) or give the example in 2 sentences.",
  mixed: "Mix it up: usually 1 to 3 sentences, sometimes a fragment, once or twice go off on a tangent you find interesting, and once make a small mistake.",
};

/** The passive teacher (no model): only answers what it is asked, and says "What now?" when Sam gave it nothing to answer. */
function passiveTeacher(transcript) {
  const last = [...transcript].reverse().find((l) => l.speaker === "avatar")?.text ?? "";
  if (/\b(draw|sketch|write|show me|on the board)\b/i.test(last)) return "BOARD";
  if (/\?/.test(last)) return ["Yes.", "I think so.", "Okay, it is the one you drew.", "Yeah, because of how it works."][transcript.length % 4];
  return "What now?";
}

async function teacherSays(topic, transcript, style) {
  if (style === "passive") return passiveTeacher(transcript);
  // The finisher teaches for three turns, then only says it is done (Sam must not ask "anything to add?" more than once).
  if (style === "finisher") {
    const mine = transcript.filter((l) => l.speaker === "student").length;
    if (mine >= 4) return ["No, that should be all.", "That's all.", "Nope, finished."][(mine - 4) % 3];
    style = "explainer";
  }
  const convo = transcript.map((l) => `${l.speaker === "avatar" ? "Sam" : "You"}: ${l.text}`).join("\n");
  const out = await ask(
    `You are a GCSE student who is TEACHING the topic "${topic}" to a classmate called Sam, typing your messages. ${STYLES[style]} You know the topic well. If Sam asks you to write something on the whiteboard, reply with exactly: BOARD. Never ask Sam questions about the topic more than rarely. Reply with only your next message.`,
    convo ? `Conversation so far:\n${convo}\n\nYour next message:` : `Start the lesson: introduce the topic to Sam.`,
  );
  return out.replace(/^You:\s*/i, "");
}

const browser = await chromium.launch({
  executablePath: chromiumPath(),
  headless: !process.env.HEADED,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});
const page = await (await browser.newContext({ permissions: ["microphone", "camera"], viewport: { width: 1440, height: 900 } })).newPage();
await page.goto(BASE, { waitUntil: "networkidle" });
await page.locator('input[type="file"]').setInputFiles(path.resolve(here, "../../fixtures", PDF));
await page.getByLabel("Marks awarded").first().waitFor({ timeout: 90000 });
const topic = process.env.TOPIC || "solving quadratic equations";
await page.getByRole("button", { name: /start session/i }).click();
await page.getByText("LIVE", { exact: true }).waitFor({ timeout: 30000 });
await page.waitForTimeout(7000);

const box = page.getByPlaceholder(/type part of your explanation/i);
const board = await page.getByLabel("Whiteboard drawing area").boundingBox();
const getLines = () => page.evaluate(() => window.__feynmanActions.getRail().transcript);
const samCount = async () => (await getLines()).filter((l) => l.speaker === "avatar").length;
let row = 0;
let waited = [];
for (let turn = 0; turn < TURNS; turn++) {
  const lines = await getLines();
  const style = STYLE === "mixed" ? "mixed" : STYLE;
  let say = await teacherSays(topic, lines, style);
  const before = await samCount();
  if (/^BOARD\b/i.test(say)) {
    for (let i = 0; i < 3; i++) {
      const y = board.y + 150 + (row++ % 12) * 34;
      await page.mouse.move(board.x + 60, y);
      await page.mouse.down();
      await page.mouse.move(board.x + 380, y + 6, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(500);
    }
    await page.waitForTimeout(3000);
    say = "Done.";
  }
  const sent = Date.now();
  await box.fill(say);
  await box.press("Enter");
  for (let i = 0; i < 60 && (await samCount()) <= before; i++) await page.waitForTimeout(500);
  waited.push(((Date.now() - sent) / 1000).toFixed(1));
  await page.waitForTimeout(2500);
}
const lines = await getLines();
await page.getByRole("button", { name: /^end$/i }).click({ timeout: 2000 }).catch(() => {});
await page.waitForTimeout(1000);
await browser.close();

const samLinesOut = lines.filter((l) => l.speaker === "avatar");
const flat = samLinesOut.filter((l) => !/\?|\b(go on|carry on|keep going|continue|tell me more|what happens next)\b/i.test(l.text));
const whatNow = lines.filter((l) => l.speaker === "student" && /^\W*what now\??\W*$/i.test(l.text)).length;
const anything = samLinesOut.filter((l) => /anything to add/i.test(l.text)).length;
console.log(`
METRICS: ${flat.length} flat Sam lines (no question or invitation) of ${samLinesOut.length}; teacher had to say "What now?" ${whatNow} times; "anything to add" asked ${anything} times`);
const text = lines.map((l) => `${l.t} ${l.speaker === "avatar" ? "Sam" : "Teacher"}: ${l.text}`).join("\n");
fs.mkdirSync(path.join(here, "out"), { recursive: true });
console.log(text);
console.log(`\nSam's reply delay (s) per turn: ${waited.join(", ")}`);

const verdict = await ask(
  `You review a transcript of "Sam", an AI who must act as a curious STUDENT being taught by the user (the Feynman technique), while an examiner quietly marks the teacher. Judge Sam's lines only. Reply with JSON only: {"scores":{"student_not_interviewer":1-5,"interprets_input":1-5,"no_repeats":1-5,"natural_acknowledgement":1-5,"welcomes_explaining":1-5},"problems":["<time> <quote> -> <why it is wrong>", ...up to 6],"fixes":["<one concrete change to Sam's instructions>", ...up to 4]}.
Criteria: student_not_interviewer: Sam should mostly let the teacher teach, asking at most one question every turn or two, not firing a quiz question after every answer. interprets_input: Sam shows she understood what the teacher actually said (says it back in her own words, asks about something specific they said) instead of ignoring it for the next scripted question. no_repeats: never asks about the same thing twice, in any wording. natural_acknowledgement: reacts like a real classmate; no praise-judging ("Right", "Great") of answers she cannot know are right. welcomes_explaining: invites the teacher to continue and explain, and does not interrupt or cut off.`,
  `Transcript:
${text}`,
  4000,
);
console.log(`\nJUDGE:\n${verdict}`);
fs.writeFileSync(path.join(here, "out", `loop-${STYLE}.txt`), `${text}\n\nDelays: ${waited.join(", ")}\n\n${verdict}\n`);
