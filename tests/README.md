# Tests and demo fixtures (T6)

## End-to-end smoke test
Drives the real app in headless Chromium, using real Anam, Claude and fal.

```bash
# 1. App: put ANAM_API_KEY, ANTHROPIC_API_KEY and FAL_KEY in .env, then
npm run dev
# 2. Test (separate deps, kept out of the app's package.json)
cd tests/e2e && npm install
npx playwright install chromium   # once, if no Chromium is found (or set CHROMIUM_PATH)
BASE_URL=http://localhost:3000 npm run smoke             # voice: fake mic plays fixtures/student-speech.wav
BASE_URL=http://localhost:3000 npm run smoke -- --typed  # typed lines + Snap & Check button
BASE_URL=http://localhost:3000 npm run smoke -- --no-avatar
```

**What it checks:**
- **Notes:** the PDF uploads and is parsed.
- **Whiteboard:** the sketch registers.
- **Avatar:** the session token comes back and video frames arrive.
- **Check:**
  - The spoken "check my explanation" makes the avatar call `open_gap_report`.
  - Exactly one `/api/analyze` runs.
  - The drawer shows a score and the "roots" misconception.
- **Visual:** the fal visual renders.
- **Transcript:** student and avatar lines appear.
- **Page errors:** none.

Screenshots and the transcript go to `tests/e2e/out/`. The test takes about 90 s in voice mode and 50 s in typed mode. Exit code 0 means everything passed.

**Anam concurrency:** the hackathon key allows **one** live session at a time. The test clicks End and waits before closing. If a session is still held, the UI shows "Concurrency limit reached"; wait about a minute and retry.

## Fixtures (`fixtures/`)
| File | What |
|---|---|
| `photosynthesis-notes.pdf` | Clean 2-page lecture notes (BIO 101 Lecture 4). This is the demo PDF. |
| `whiteboard-sample.png` | A neat student sketch with the demo misconceptions (glucose made in the roots, O2 taken in). Use it as the reference for what to draw live. |
| `student-speech.wav` | Spoken explanation containing both misconceptions, then "check my explanation" |
| `photosynthesis-notes.html`, `render-fixtures.mjs` | Sources for the PDF and PNG. Rebuild with `cd tests/e2e && npm run fixtures` |
| `make-speech.ps1` | Rebuilds the WAV with Windows text-to-speech |
