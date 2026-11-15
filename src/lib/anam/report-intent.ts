// Opening the report must not depend on the avatar's LLM remembering to call open_gap_report (T45).
// When Sam says she is opening it, the workspace opens it, so the screen follows her words.
import { completeSentences } from "../board/questions.ts";

const ASKING = /\b(would you|do you|shall i|should i|can i|may i|want me|like me|want to|like to|ready to|ready for)\b/i;
const OPENING = /\b(open|opening|pull(?:ing)? up|put(?:ting)? up|bring(?:ing)? up|show(?:ing)?|check(?:ing)?|get(?:ting)?)\b[^.?!]{0,30}\b(report|results|marks)\b/i;

/** True when one finished sentence of Sam's says she is opening the report now (a question about it does not count). */
export function announcesReport(sentence: string): boolean {
  const s = sentence.trim();
  return !/\?\s*$/.test(s) && !ASKING.test(s) && OPENING.test(s);
}

/** True when any finished sentence in Sam's line so far announces it (`final`: the unfinished tail counts too). */
export function lineAnnouncesReport(text: string, final: boolean): boolean {
  const { done, rest } = completeSentences(text);
  return (final && rest ? [...done, rest] : done).some(announcesReport);
}
