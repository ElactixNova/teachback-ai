// Run: node --test src/lib/board/questions.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { NOTE_PACE_MS, asksToWrite, boardText, completeSentences, createQuestionWriter, hasMaths, isBoardQuestion, isQuestion, mathKey, pickQuestion } from "./questions.ts";

const SPOKEN = "Can you solve x squared plus five x plus six equals zero?";
const TEX = "Solve x^2 + 5x + 6 = 0";
const tick = () => new Promise((r) => setTimeout(r, 0));

/** A writer over a fake board and clock. `latex: false` simulates no typesetting being available. */
function setup({ latex = true } = {}) {
  const board = [];
  const timers = [];
  let now = 0;
  const writer = createQuestionWriter(
    (note) => {
      const key = mathKey(note.content);
      if (board.some((n) => mathKey(n.content) === key)) return { status: "already", where: "where it was written" };
      board.push(note);
      return { status: "written", where: "top-left" };
    },
    {
      toLatex: async (spoken) => (latex && /x squared plus five x plus six equals zero/i.test(spoken) ? spoken.replace(/x squared plus five x plus six equals zero/i, "$x^2 + 5x + 6 = 0$") : null),
      now: () => now,
      later: (fn, ms) => timers.push({ fn, at: now + ms }),
    },
  );
  const advance = (ms) => {
    now += ms;
    for (const t of timers.splice(0).sort((a, b) => a.at - b.at)) {
      if (t.at <= now) t.fn();
      else timers.push(t);
    }
  };
  return { writer, board, advance };
}

test("sentences: split at . ? ! but not inside a decimal; the unfinished rest is kept apart", () => {
  assert.deepEqual(completeSentences("Got it. Can you solve x plus 1.5 equals 3? And then"), { done: ["Got it.", "Can you solve x plus 1.5 equals 3?"], rest: "And then" });
  assert.deepEqual(completeSentences("no end yet"), { done: [], rest: "no end yet" });
});

test("which sentences go on the board: an instruction with maths in it, nothing else", () => {
  assert.ok(isBoardQuestion(SPOKEN));
  assert.ok(isBoardQuestion("Work out three over four plus one over two."));
  assert.ok(isBoardQuestion("What is 12 times 7?"));
  assert.ok(!isBoardQuestion("Okay, so x squared plus five x plus six equals zero gives minus two and minus three."), "repeating their answer is not a question");
  assert.ok(!isBoardQuestion("Could you write the balanced symbol equation for photosynthesis?"), "no maths to write");
  assert.ok(!isBoardQuestion("What is photosynthesis?"));
  assert.ok(isQuestion("What is photosynthesis?") && isQuestion("Solve it for me.") && !isQuestion("Got it."));
  assert.ok(hasMaths("x^2 = 4") && hasMaths("two plus two equals four") && !hasMaths("plants make glucose"));
  assert.equal(boardText("Okay, so can you solve x squared plus five x plus six equals zero for me?"), "Solve x squared plus five x plus six equals zero?");
});

test("mathKey: the same question compares equal however it was worded or typeset", () => {
  assert.equal(mathKey("Solve x^2 + 5x + 6 = 0"), mathKey("Can you solve $x^{2}+5x+6=0$?"));
  assert.notEqual(mathKey("Solve x^2 + 5x + 6 = 0"), mathKey("Solve x^2 + 7x + 10 = 0"));
  assert.equal(mathKey("What is photosynthesis?"), "what is photosynthesis");
});

test("the student asking to see the question", () => {
  for (const yes of ["Can you write it down?", "could you put that on the board", "Say that again please", "what was the question?", "write that down for me"]) assert.ok(asksToWrite(yes), yes);
  for (const no of ["I think it is minus two", "plants take in water", "x equals three"]) assert.ok(!asksToWrite(no), no);
});

test("pickQuestion: after 'write it down' the last question wins over whatever the LLM sent", () => {
  assert.deepEqual(pickQuestion("Solve x^2 + 7x + 10 = 0", TEX, true), { content: TEX, rewritten: true });
  assert.deepEqual(pickQuestion("Solve $x^{2}+5x+6=0$", TEX, true), { content: "Solve $x^{2}+5x+6=0$", rewritten: false });
  assert.deepEqual(pickQuestion("Solve x^2 + 7x + 10 = 0", TEX, false), { content: "Solve x^2 + 7x + 10 = 0", rewritten: false });
  assert.deepEqual(pickQuestion("Solve x^2 = 4", null, true), { content: "Solve x^2 = 4", rewritten: false });
});

test("chunk stream with NO tool call: the question is still written, once, when its sentence completes", async () => {
  const { writer, board } = setup();
  const chunks = ["Got it.", "Got it. Can you solve", "Got it. Can you solve x squared plus five x", `Got it. ${SPOKEN}`, `Got it. ${SPOKEN} Take your time.`];
  for (const soFar of chunks) {
    writer.heard("m1", soFar, false);
    await tick();
    if (!soFar.includes("?")) assert.equal(board.length, 0, "nothing before the question is complete");
  }
  assert.deepEqual(board, [{ content: TEX + "?", kind: "math" }]);
  writer.heard("m1", `Got it. ${SPOKEN} Take your time.`, true);
  await tick();
  assert.equal(board.length, 1, "the finished line does not write it again");
});

test("dedupe with tool calls: Sam wrote it herself, before or after saying it", async () => {
  // Tool first (the usual order), then the speech: the safety net stays out of it.
  const a = setup();
  await a.writer.tool({ content: TEX, kind: "math" });
  a.writer.heard("m1", SPOKEN, true);
  await tick();
  assert.equal(a.board.length, 1);
  // Speech first, tool afterwards: the board already has that maths.
  const b = setup();
  b.writer.heard("m1", SPOKEN, true);
  await tick();
  const said = await b.writer.tool({ content: "Solve $x^{2} + 5x + 6 = 0$", kind: "math" });
  assert.equal(b.board.length, 1);
  assert.match(said, /already on the board/);
  // No typesetting available: the spoken words are written, unless she called the tool meanwhile.
  const c = setup({ latex: false });
  c.writer.heard("m1", SPOKEN, true);
  await tick();
  assert.deepEqual(c.board.map((n) => n.content), ["Solve x squared plus five x plus six equals zero?"]);
});

test("'write it down' writes her LAST question, not the new one the LLM invents", async () => {
  // She asked it aloud without writing it (no maths cue, so the safety net did not write it either).
  const { writer, board } = setup();
  writer.heard("m1", "Which value of x makes the bracket zero?", true);
  writer.studentSaid("Can you write it down?");
  await tick();
  assert.deepEqual(board.map((n) => n.content), ["Which value of x makes the bracket zero?"], "written at once, without waiting for the LLM");
  // The LLM then calls the tool with a different question: the last question is kept.
  const said = await writer.tool({ content: "Solve x^2 + 7x + 10 = 0", kind: "math" });
  assert.equal(board.length, 1);
  assert.match(said, /last question.*already on the board/i);
  // With a maths question that the student removed from the board, the tool call writes it again.
  const b = setup();
  b.writer.heard("m1", SPOKEN, true);
  await tick();
  b.board.length = 0; // the student removed it
  b.writer.studentSaid("what was the question?");
  b.advance(NOTE_PACE_MS);
  await tick();
  assert.deepEqual(b.board.map((n) => n.content), [TEX + "?"]);
});

test("pace: a note that comes too soon is queued, never dropped; the cap is far away", async () => {
  const { writer, board, advance } = setup();
  for (let i = 1; i <= 5; i++) await writer.tool({ content: `x^2 = ${i}`, kind: "math" });
  assert.equal(board.length, 1, "one at once, the rest wait");
  advance(NOTE_PACE_MS);
  assert.equal(board.length, 2);
  advance(NOTE_PACE_MS * 4);
  assert.deepEqual(board.map((n) => n.content), ["x^2 = 1", "x^2 = 2", "x^2 = 3", "x^2 = 4", "x^2 = 5"]);
  assert.match(await writer.tool({ content: "x^2 = 6", kind: "math" }), /being written|appears/);
});
