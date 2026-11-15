// Run: node --test src/lib/rail/state.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyResults, finalizeReport, findCriterion, initialRail, liveFocusId, mergeLive, mergeLiveResults, mmss, parkResult, railChangeNote, railStatusText, toTimedLines, askLine, askedCounts, planNext, planNote, singleAsk } from "./state.ts";

const scheme = {
  topic: "Photosynthesis",
  sourceFile: "n.pdf",
  pages: "pp. 1-2",
  totalMarks: 5,
  criteria: [
    { id: "c1", title: "Inputs and outputs", expected: ["CO2", "water", "glucose"], marks: 3, source: { page: 1 } },
    { id: "c2", title: "Where it happens", expected: ["leaves", "chloroplasts"], marks: 2, source: { page: 1 } },
  ],
};
const r = (criterionId, status, awarded, quote, timestamp) => ({
  criterionId, status, awarded, missingSteps: [], attempts: 0, parked: false,
  ...(quote ? { evidence: { quote, timestamp } } : {}),
});

test("initial rail is all not_covered", () => {
  const s = initialRail(scheme);
  assert.deepEqual(s.results.map((x) => x.status), ["not_covered", "not_covered"]);
  assert.equal(s.results[1].missingSteps.length, 2);
});

test("marks never go down and full sticks", () => {
  let s = initialRail(scheme);
  s = mergeLive(scheme, s, [r("c1", "partial", 2, "carbon dioxide and water", "00:10")]);
  s = mergeLive(scheme, s, [r("c1", "partial", 1, "carbon dioxide and water", "00:10")]);
  assert.equal(s.results[0].awarded, 2);
  s = mergeLive(scheme, s, [r("c1", "full", 3, "and it makes glucose", "00:40")]);
  s = mergeLive(scheme, s, [r("c1", "missed", 0, "something", "00:50")]);
  assert.equal(s.results[0].status, "full");
  assert.equal(s.results[0].awarded, 3);
});

test("one explanation over several sentences is one attempt; two spaced failures park", () => {
  let s = initialRail(scheme);
  s = mergeLive(scheme, s, [r("c2", "missed", 0, "glucose is made in the roots", "00:20")]);
  s = mergeLive(scheme, s, [r("c2", "missed", 0, "the light goes to the roots", "00:25")]);
  assert.equal(s.results[1].attempts, 1);
  assert.equal(s.results[1].parked, false);
  s = mergeLive(scheme, s, [r("c2", "partial", 1, "maybe in the stem and leaves", "01:10")]);
  assert.equal(s.results[1].attempts, 2);
  assert.equal(s.results[1].status, "parked");
  assert.equal(s.results[1].awarded, 1);
  // Getting it right later un-parks it.
  s = mergeLive(scheme, s, [r("c2", "full", 2, "in chloroplasts in the leaves", "02:00")]);
  assert.equal(s.results[1].status, "full");
  assert.equal(s.results[1].parked, false);
});

test("activeId: model's in_progress, else newest open quote; in_progress is not stored", () => {
  let s = initialRail(scheme);
  s = mergeLive(scheme, s, [r("c1", "partial", 1, "co2", "00:10"), r("c2", "in_progress", 0, "it happens in", "00:30")]);
  assert.equal(s.activeId, "c2");
  assert.equal(s.results[1].status, "not_covered");
  s = mergeLive(scheme, s, [r("c1", "partial", 1, "co2 and water", "00:50"), r("c2", "missed", 0, "it happens in", "00:30")], []);
  assert.equal(s.activeId, "c1");
  assert.equal(s.results[0].attempts, 1); // no avatar turn in between: still the same attempt
});

test("park, find by title, status text and change note", () => {
  const before = emptyResults(scheme);
  assert.equal(findCriterion(scheme, "where it happens")?.id, "c2");
  assert.equal(findCriterion(scheme, "C1")?.id, "c1");
  assert.equal(findCriterion(scheme, "nonsense"), undefined);
  const after = parkResult(before, "c2");
  assert.equal(after[1].status, "parked");
  assert.match(railChangeNote(scheme, before, after), /Parked: Where it happens/);
  assert.equal(railChangeNote(scheme, after, after), null);
  const text = railStatusText(scheme, after);
  assert.match(text, /0\/5 marks/);
  assert.match(text, /Parked \(do not ask about these again\): Where it happens/);
  assert.match(text, /move to "Inputs and outputs"/);
  assert.match(railStatusText(scheme, before, ["c2"]), /chose to work on: Where it happens.*move to "Where it happens"/);
});

test("finalizeReport keeps the better mark, attempts and parking, and recomputes totals", () => {
  let live = mergeLiveResults(scheme, emptyResults(scheme), [r("c1", "partial", 2, "co2 and water", "00:10")], []);
  live = parkResult(live, "c2");
  const report = {
    awarded: 1, total: 5, primaryGapId: "c1", studyPlan: [],
    results: [r("c1", "partial", 1, "co2", "00:10"), r("c2", "missed", 0, "roots", "00:30")],
  };
  const out = finalizeReport(scheme, report, live);
  assert.equal(out.awarded, 2);
  assert.equal(out.results[0].awarded, 2);
  assert.equal(out.results[0].status, "partial");
  assert.equal(out.results[1].status, "parked");
  assert.equal(out.results[1].parked, true);
  assert.equal(out.results[1].attempts, 1);
  assert.equal(out.primaryGapId, "c1");
});

test("mergeLiveResults: in_progress shown, history kept across calls, manual park respected", () => {
  const t = [
    { speaker: "student", text: "glucose is made in the roots", t: "00:20" },
    { speaker: "avatar", text: "Where does the light land?", t: "00:30" },
    { speaker: "student", text: "in the stem", t: "00:40" },
  ];
  let res = mergeLiveResults(scheme, emptyResults(scheme), [r("c2", "missed", 0, "glucose is made in the roots", "00:20")], t.slice(0, 1));
  assert.equal(liveFocusId(res), "c2");
  assert.equal(res[1].status, "in_progress");
  assert.equal(res[1].attempts, 1);
  // The UI keeps the array; a new analysis with the retry parks it.
  res = mergeLiveResults(scheme, res, [r("c2", "missed", 0, "in the stem", "00:40")], t);
  assert.equal(res[1].status, "parked");
  assert.equal(liveFocusId(res), null);
  // A manual park made by the UI survives the next merge.
  res = parkResult(res, "c1");
  res = mergeLiveResults(scheme, res, [r("c1", "partial", 1, "co2", "00:50")], t);
  assert.equal(res[0].status, "parked");
  assert.equal(res[0].awarded, 1);
  // A reset (empty results) starts the history again.
  res = mergeLiveResults(scheme, emptyResults(scheme), [r("c2", "missed", 0, "in the stem", "00:40")], t);
  assert.equal(res[1].attempts, 1);
});

test("with a transcript, a retry needs an avatar turn in between", () => {
  const t = [
    { speaker: "student", text: "glucose is made in the roots", t: "00:20" },
    { speaker: "student", text: "the light goes to the roots", t: "00:25" },
    { speaker: "avatar", text: "Hmm, where do you think the light lands?", t: "00:30" },
    { speaker: "student", text: "maybe the stem", t: "00:35" },
  ];
  let s = initialRail(scheme);
  s = mergeLive(scheme, s, [r("c2", "missed", 0, "glucose is made in the roots", "00:20")], t.slice(0, 1));
  s = mergeLive(scheme, s, [r("c2", "missed", 0, "the light goes to the roots", "00:25")], t.slice(0, 2));
  assert.equal(s.results[1].attempts, 1);
  s = mergeLive(scheme, s, [r("c2", "missed", 0, "maybe the stem", "00:35")], t);
  assert.equal(s.results[1].attempts, 2);
  assert.equal(s.results[1].status, "parked");
});

test("time helpers", () => {
  assert.equal(mmss(65_400), "01:05");
  const start = Date.parse("2026-11-14T18:00:00Z");
  assert.deepEqual(
    toTimedLines([{ speaker: "student", text: "hi", at: "2026-11-14T18:01:02Z" }, { speaker: "avatar", text: " ", at: "2026-11-14T18:01:03Z" }], start),
    [{ speaker: "student", text: "hi", t: "01:02" }],
  );
});

test("the avatar is told what is on the board, so it never asks to repeat it", () => {
  const before = [r("c1", "partial", 1), r("c2", "not_covered", 0)];
  const after = [{ ...r("c1", "partial", 1), boardObservation: "CO2 + H2O -> C6H12O6 + O2, not balanced" }, r("c2", "not_covered", 0)];
  const note = railChangeNote(scheme, before, after);
  assert.match(note, /On their whiteboard .*never ask them to say aloud.*Inputs and outputs: CO2 \+ H2O/);
  assert.equal(railChangeNote(scheme, after, after), null);
  assert.match(railStatusText(scheme, after), /On their whiteboard/);
  assert.doesNotMatch(railStatusText(scheme, before), /whiteboard/);
});

test("board note: first sighting fires, rewording the same drawing does not, a new drawing does", () => {
  const withBoard = (text) => [{ ...r("c1", "partial", 1), boardObservation: text }, r("c2", "not_covered", 0)];
  const none = [r("c1", "partial", 1), r("c2", "not_covered", 0)];
  assert.ok(railChangeNote(scheme, none, withBoard("Written: CO2 + H2O -> C6H12O6 + O2, not balanced.")));
  assert.equal(railChangeNote(scheme, withBoard("Written: CO2 + H2O -> C6H12O6 + O2, not balanced."), withBoard("The board shows CO2 + H2O -> C6H12O6 + O2 which is not balanced.")), null);
  assert.ok(railChangeNote(scheme, withBoard("Written: CO2 + H2O -> C6H12O6 + O2, not balanced."), withBoard("A leaf diagram with arrows showing sunlight and chloroplasts.")));
});

test("rail status: follow up a partly explained point first, then ask the next point's probe", () => {
  const sch = {
    ...scheme,
    criteria: [
      { ...scheme.criteria[0], probe: "Can you write the balanced symbol equation?", ask: "write" },
      { ...scheme.criteria[1], probe: "Where exactly in the plant does it happen?", ask: "say" },
    ],
  };
  const partial = { ...r("c1", "in_progress", 1), missingSteps: ["glucose"], attempts: 0 };
  const text = railStatusText(sch, [partial, r("c2", "not_covered", 0)]);
  assert.match(text, /FIRST, before moving on, follow up on "Inputs and outputs".*"glucose"/);
  assert.match(text, /LATER turn.*move to "Where it happens"\. Ask it in your own words.*Where exactly in the plant/);
  assert.match(text, /reacting in a few words/);
  // A point with both tries used is not chased again; a write point asks them to write.
  const used = { ...partial, attempts: 2 };
  assert.doesNotMatch(railStatusText(sch, [used, r("c2", "not_covered", 0)]), /FIRST/);
  assert.match(railStatusText({ ...sch, criteria: [sch.criteria[0], sch.criteria[1]] }, [r("c1", "not_covered", 0), r("c2", "full", 2)]), /ask them to write it on the board inside that one sentence/);
});

test("an unfinished board tells the avatar to give time, and a flip fires a note", () => {
  const mk = (unfinished) => [{ ...r("c1", "partial", 1), boardObservation: "6CO2 + 6H2O ->", boardUnfinished: unfinished }, r("c2", "not_covered", 0)];
  assert.match(railStatusText(scheme, mk(true)), /Board status: UNFINISHED/);
  assert.doesNotMatch(railStatusText(scheme, mk(false)), /UNFINISHED/);
  assert.ok(railChangeNote(scheme, mk(true), mk(false)), "unfinished -> finished is worth a note");
  assert.equal(railChangeNote(scheme, mk(true), mk(true)), null);
});

test("sweep: once every point is touched, missed and partly explained points each get one nudge", () => {
  const touched = mergeLive(scheme, initialRail(scheme), [
    { ...r("c1", "partial", 1, "it uses water", "00:05"), missingSteps: ["CO2", "glucose"] },
    { ...r("c2", "missed", 0, "in the roots", "00:20"), missingSteps: ["leaves", "chloroplasts"] },
  ]).results;
  const text = railStatusText(scheme, touched);
  assert.match(text, /SWEEP: .*"Inputs and outputs" \(not yet said: "CO2"\); "Where it happens" \(not yet said: "leaves"\).*only once/);
  assert.doesNotMatch(text, /FIRST, before moving on|Everything has been addressed/);
  // A point still not covered comes first: no sweep yet.
  assert.doesNotMatch(railStatusText(scheme, mergeLive(scheme, initialRail(scheme), [r("c1", "partial", 1, "it uses water", "00:05")]).results), /SWEEP/);
  // Parked points are never swept.
  assert.doesNotMatch(railStatusText(scheme, parkResult(parkResult(touched, "c1"), "c2")), /SWEEP/);
});

test("said: live merges keep the summary, and the final report's summary wins", () => {
  const withSaid = (said) => ({ ...r("c1", "partial", 1), said });
  const merged = mergeLiveResults(scheme, [withSaid("You said A.")], [r("c1", "partial", 1)], []);
  assert.equal(merged.find((x) => x.criterionId === "c1").said, "You said A.");
  const report = { awarded: 1, total: 5, primaryGapId: "c1", results: [withSaid("You said A and then B."), r("c2", "not_covered", 0)], studyPlan: [] };
  const fin = finalizeReport(scheme, report, [withSaid("You said A."), r("c2", "not_covered", 0)]);
  assert.equal(fin.results.find((x) => x.criterionId === "c1").said, "You said A and then B.");
});

test("rail status always names a next question while a point is open", () => {
  // Only one open point and it is in progress: Sam must still be told what to ask, never "everything addressed".
  // (No missing steps listed yet, so neither a follow-up nor a sweep applies: this used to say "Everything has been addressed".)
  const inProgress = r("c1", "in_progress", 1, "carbon dioxide", "00:10");
  const text = railStatusText(scheme, [inProgress, r("c2", "full", 2)]);
  assert.match(text, /Next question: keep going on "Inputs and outputs"/);
  assert.doesNotMatch(text, /Everything has been addressed/);
  assert.match(railStatusText(scheme, [r("c1", "full", 3), r("c2", "not_covered", 0)]), /Next question: .*move to "Where it happens"/);
  assert.match(railStatusText(scheme, [r("c1", "full", 3), r("c2", "full", 2)]), /Everything has been addressed/);
  assert.doesNotMatch(text, /unsure|not sure/i);
});

test("askedNote lists Sam's recent questions and the answer since", async () => {
  const { askedNote } = await import("./state.ts");
  const t = [
    { t: "0:01", speaker: "avatar", text: "Okay. Can you write down the quadratic formula?" },
    { t: "0:09", speaker: "student", text: "x equals minus b plus or minus root b squared minus four a c over two a" },
  ];
  const n = askedNote(t);
  assert.match(n, /never ask these again/);
  assert.match(n, /quadratic formula/);
  assert.match(n, /Since your last turn they said/);
  assert.equal(askedNote([]), "");
});

// ---- T32: the 15 Nov 00:56 session (docs/research/session-2026-11-15-transcript.txt) --------------
// The scheme is rebuilt from the questions Sam asked first time round; the lines are the transcript's.
const quad = {
  topic: "Solving quadratic equations",
  sourceFile: "q.pdf",
  pages: "pp. 1-4",
  totalMarks: 25,
  criteria: [
    ["c1", "What solving a quadratic means", "What does solving a quadratic actually mean, and what must you do before anything else?", "say"],
    ["c2", "Solving by factorising", "Can you show me how to solve $x^2 + 5x + 6 = 0$ by factorising?", "write"],
    ["c3", "Standard form", "What do we call the form where a quadratic is written as $ax^2 + bx + c = 0$, and why is that useful?", "say"],
    ["c4", "Factor pairs", "When the coefficient of $x^2$ is one, what two numbers do we look for to help factorise the expression?", "say"],
    ["c5", "A common factor", "How would you handle $x^2 - 4x = 0$?", "write"],
    ["c6", "The quadratic formula", "Could you write the quadratic formula and tell me when you would choose to use it?", "write"],
    ["c7", "The discriminant", "How can you tell how many real roots a quadratic has just by looking at the discriminant?", "say"],
    ["c8", "Completing the square", "Can you complete the square on $x^2 + 6x - 7$ and find its turning point?", "write"],
    ["c9", "Choosing a method", "In what situations would you choose to reach for the quadratic formula rather than factorising?", "say"],
    ["c10", "Sketching the graph", "Could you sketch the graph of $y = x^2 - 2x - 3$ and label its key points?", "draw"],
    ["c11", "Shape of the parabola", "How does the sign of the leading coefficient affect whether the parabola opens up or down?", "say"],
  ].map(([id, title, probe, ask]) => ({ id, title, probe, ask, expected: ["step one", "step two"], marks: 2, source: { page: 1 } })),
};
const said = (t, speaker, text) => ({ t, speaker, text });
const session = [
  said("00:01", "avatar", "Hi! I'm Sam. Let's do Solving quadratic equations. What does solving a quadratic actually mean, and what must you do before anything else?"),
  said("00:21", "student", "You must set the quadratic equal to 0 before solving it and solving a quadratic means finding the values of x that make the equation true."),
  said("00:23", "avatar", "Can you show me how to solve x squared plus five x plus six equals zero by factorising? Could you write it on the board for me?"),
  said("00:48", "student", "Done."),
  said("00:49", "avatar", "Got it. What do we call the form where a quadratic is written as a times x squared plus b times x plus c equals zero, and why is that useful?"),
  said("01:08", "student", "I don't know."),
  said("01:09", "avatar", "Okay. When the coefficient of x squared is one, what two numbers do we look for to help factor the expression?"),
  said("01:20", "student", "the coefficient of X and the constant term."),
  said("01:21", "avatar", "Right, so which two numbers should multiply to the constant term and also add up to the coefficient of x?"),
  said("01:41", "student", "2 and 3."),
  said("01:41", "avatar", "Great. How would you handle x squared minus four x equals zero? Could you write that on the board for me?"),
  said("02:08", "student", "Done."),
  said("02:09", "avatar", "Nice. Could you write the quadratic formula on the board and tell me when you would choose to use it?"),
  said("02:37", "student", "I've written it on the board. I'll use it when the quadratic isn't factorizable."),
  said("02:37", "avatar", "Got it. How can you tell how many real roots a quadratic has just by looking at the discriminant?"),
  said("02:54", "student", "If it is greater than 0 there are 2 real roots, equal to 0 there is 1, less than 0 there are none."),
  said("02:54", "avatar", "Got it. Can you complete the square on x squared plus six x minus seven and find its turning point? Please write it on the board."),
  said("03:45", "student", "Done."),
];
const untouched = (scheme) => emptyResults(scheme);

test("T32 singleAsk: a probe is cut to the first thing it asks for; maths with 'and' is left alone", () => {
  assert.equal(singleAsk("Could you write the quadratic formula and tell me when you would choose to use it?"), "Could you write the quadratic formula?");
  assert.equal(singleAsk("What does solving a quadratic actually mean, and what must you do before anything else?"), "What does solving a quadratic actually mean?");
  assert.equal(singleAsk("Can you complete the square on $x^2 + 6x - 7$ and find its turning point?"), "Can you complete the square on $x^2 + 6x - 7$?");
  assert.equal(singleAsk("Which two numbers multiply to six and add to five?"), "Which two numbers multiply to six and add to five?");
  assert.equal(singleAsk("Where does it happen? And what goes in?"), "Where does it happen?");
  assert.match(askLine(quad.criteria[5]), /^"Could you write the quadratic formula\?" \(a board task: ask them to write it on the board inside that one sentence/);
  assert.equal(askLine(quad.criteria[6]), '"How can you tell how many real roots a quadratic has just by looking at the discriminant?"');
});

test("T32 askedCounts: reads what Sam has asked from her own lines, across overlapping probes and follow-ups", () => {
  const { counts, current } = askedCounts(quad, session);
  // Every point she asked about is counted, however she worded it aloud.
  for (const id of ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"]) assert.ok(counts[id] >= 1, id);
  // "which two numbers should multiply to..." resembled no probe: a follow-up on factor pairs, her point at the time.
  assert.equal(counts.c4, 2);
  // "tell me when you would choose to use it" already asked the Choosing-a-method point.
  assert.ok(counts.c9 >= 1, "overlapping probe counts as asked");
  assert.equal(counts.c10, undefined);
  assert.equal(current, "c8");
});

test("T32 planNext: after 'Done.' at 03:45 the next question is a NEW point, not the formula or the square again", () => {
  const plan = planNext(quad, untouched(quad), session);
  // In the real session Sam asked c9 ("when would you reach for the formula", a repeat of 02:09) and then c8 again.
  assert.equal(plan.next.id, "c10");
  assert.ok(!plan.asked.includes("c10") && plan.asked.includes("c9") && plan.asked.includes("c8"));
  assert.equal(plan.left, 2);
  // Never a new point that the examiner already marked full or that is parked.
  const marked = untouched(quad).map((r) => (r.criterionId === "c10" ? { ...r, status: "full" } : r.criterionId === "c11" ? { ...r, status: "parked" } : r));
  assert.equal(planNext(quad, marked, session).next, null);
  // One follow-up on the current point only while it lost marks and was asked once; never on an older point.
  const lost = untouched(quad).map((r) => (r.criterionId === "c8" ? { ...r, status: "partial", missingSteps: ["states the turning point"] } : r.criterionId === "c6" ? { ...r, status: "partial", missingSteps: ["x"] } : r));
  assert.deepEqual(planNext(quad, lost, session).followUp, { id: "c8", missing: "states the turning point" });
  const twice = [...session, said("03:46", "avatar", "And where is the turning point of that curve?"), said("03:50", "student", "Not sure.")];
  assert.equal(planNext(quad, lost, twice).followUp, null);
});

test("T32 planNote: names the one new question, what is off limits, the board read, and holds the report back", () => {
  // After a reaction (no question) she may ask again; right after a question her next turn is a reaction.
  const reacted = [...session, said("03:50", "student", "Done."), said("03:51", "avatar", "Okay, so you wrote it out step by step.")];
  const note = planNote(quad, untouched(quad), reacted);
  assert.match(note, /PACE: your next reply may include ONE question/);
  assert.match(note, /^PRIVATE NOTE/);
  assert.match(note, /Already asked, never ask about these again in any wording: .*The quadratic formula.*Completing the square.*Choosing a method/);
  assert.match(note, /board task: when they say they are done, call capture_whiteboard before you say anything/);
  assert.match(note, /Your next new question, once they have answered: "Could you sketch the graph of \$y = x\^2 - 2x - 3\$\?" \(a board task/);
  assert.match(note, /2 points have not been asked yet, so do not offer or mention their results/);
  assert.doesNotMatch(note, /\[|\]/);
  // When every point has been asked, the report is no longer held back and the sweep takes over.
  const all = [...session, said("03:46", "avatar", quad.criteria[9].probe), said("04:40", "student", "Done."), said("04:41", "avatar", quad.criteria[10].probe), said("04:50", "student", "ok"), said("04:51", "avatar", "Mm, I see.")];
  const end = planNote(quad, untouched(quad), all);
  assert.match(end, /Every point has now been asked.*get_rail_status/);
  assert.doesNotMatch(end, /do not offer/);
});

test("T32 rail status: a point already asked twice is never the next question, and probes are single asks", () => {
  // c4 was asked twice in the session; with everything before it also asked, the status moves to a point not asked yet.
  const text = railStatusText(quad, untouched(quad), [], session);
  assert.match(text, /move to "Sketching the graph"/);
  assert.match(text, /"Could you sketch the graph of \$y = x\^2 - 2x - 3\$\?" \(a board task/);
  assert.doesNotMatch(text, /label its key points|move to "Factor pairs"|move to "Choosing a method"/);
  // A follow-up only on the point she asked about last (c8), never an older one that still lacks a step (c4, c6).
  const lost = untouched(quad).map((r) => (["c4", "c6", "c8"].includes(r.criterionId) ? { ...r, status: "partial", awarded: 1, missingSteps: [`${r.criterionId} missing step`] } : r));
  const chased = railStatusText(quad, lost, [], session);
  assert.match(chased, /FIRST, before moving on, follow up on "Completing the square".*c8 missing step/);
  assert.doesNotMatch(chased, /follow up on "Factor pairs"|follow up on "The quadratic formula"|c4 missing step|c6 missing step/);
  // When her last point is fine, nothing older is chased: straight to the next new point.
  const fine = lost.map((r) => (r.criterionId === "c8" ? { ...r, status: "full", missingSteps: [] } : r));
  assert.doesNotMatch(railStatusText(quad, fine, [], session), /FIRST, before moving on/);
});

test("T33 pacing: right after Sam asked, her next turn is a reaction with no question named", () => {
  const asked = [...session, said("03:50", "student", "x equals minus b")];
  const note = planNote(quad, untouched(quad), [...asked, said("03:51", "avatar", "What does the discriminant tell you?")]);
  assert.match(note, /PACE: .*NO question mark.*answer it at once/);
  assert.doesNotMatch(note, /Your next new question/);
});
