// T29 CONTRACT: instant, synchronous spoken maths -> LaTeX for display (no network). Safe in the browser.
// Returns the same text with maths wrapped in $...$, or null when there is no maths it can convert with
// confidence (callers then show the raw text and may fall back to POST /api/to-latex).
// The real converter lands in a follow-up PR (Ali, T29); this signature is stable, build on it now.

export function spokenToLatex(text: string): string | null {
  void text;
  return null;
}
