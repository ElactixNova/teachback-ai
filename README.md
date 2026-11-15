# Feynman AI

**Don't just learn it. Teach it.**

Feynman AI is a reverse AI tutor. Instead of an AI lecturing you, *you* teach a live video avatar called **Sam**, out loud and on a whiteboard, and an examiner quietly marks you against a mark scheme built from your own lecture notes. When you are done you get a marked report, revision notes written from your notes, and an AI-drawn diagram for every gap.

Built for the Imperial AI Hackathon (Track 02: Voice, Vision & Generative Media) with Anam, fal and Anthropic.

## The problem

Re-reading notes feels productive but is not. The Feynman technique (explain a topic simply, to someone who does not know it, and notice where you get stuck) is one of the best ways to learn, but it needs a patient listener and an honest marker. Most students have neither the night before an exam, and an AI that simply lectures them gives them the same passive experience they were trying to escape.

## What it does

1. **Upload your lecture notes (PDF).** The app reads them and drafts a **mark scheme**: the points an examiner would expect, each worth marks, shown as plain labels (never the answers).
2. **Teach Sam.** Sam is a curious student on a real-time video avatar. She asks a question, reacts, asks you to draw things, and invites you to carry on. She never gives the answers away.
3. **Use the whiteboard.** Draw, write and do worked examples by hand. Sam reads what you drew, and writes her own questions on the board in handwriting.
4. **Be marked live.** The mark scheme rail fills in as you cover each point (full, partial, missed), with an examiner checking arithmetic, units and what is actually on the board.
5. **Get your report.** Sam opens a review with marks, what you said, what you missed, revision notes taken from your own lecture notes (with diagrams), and an AI-generated visual explainer for each gap. Pictures and the final marking are prepared while you teach, so the wait is short.

## Features

- **Live avatar tutor** (Anam `cara-4.1-express`) with expression cues, client tool calling, and a persona that behaves like a student, not an examiner: one question at a time, plain invitations in between, no repeated questions, short spoken sentences.
- **Mark scheme from your notes** (Claude Opus 5.5), with answer-free titles, a result-checking step for calculations, a probe question per point, and an editable scheme.
- **Live marking and final marking** that recompute every worked calculation, give no credit for agreeing with Sam, and read handwriting from a whiteboard image.
- **Whiteboard** with pen, eraser, undo, zoom and pan, touch support, and a handwriting font for Sam's questions. Her questions are written in step with her speech and dropped if you have already started.
- **Fast board reading** (Claude Haiku 5.5) so Sam can say what she sees, using the conversation to settle ambiguous handwriting (`b` or `6`).
- **Maths done properly**: spoken maths is converted to LaTeX and rendered with KaTeX; Sam speaks maths as words and writes it as symbols.
- **Report**: knowledge-gap results per mark scheme point, revision notes with inline SVG diagrams (Claude Sonnet 5.5), and one **fal Nano Banana Pro** picture per gap, generated once and reused.
- **Skip this point**, **Teach these back** and **Review** screens, plus a downloadable session transcript that includes the raw avatar stream for debugging.
- **Live-demo hardening**: a noise guard (microphone muted while Sam speaks, maximum noise reduction), the start button disabled until notes are uploaded and the mark scheme has loaded, typed input as a fallback, and an optional voice-model switch.

## Architecture

```
Browser (Next.js App Router, React 19, Tailwind 4)
 ├─ Workspace: Mark Scheme Rail · Whiteboard canvas · Avatar panel · Review screen
 ├─ Anam bridge (src/lib/anam): WebRTC avatar via @anam-ai/js-sdk
 │    ├─ private notes: pacing, next question, board reads, rail changes
 │    ├─ client tools: capture_whiteboard, get_rail_status, park_criterion,
 │    │                write_on_board, open_gap_report, generate_visual_explainer
 │    └─ question writer: Sam's maths questions reach the board deterministically
 └─ Live loop (src/lib/rail): marks about every 20 s while you teach
            │ fetch
Next.js API routes (server only: all keys stay here)
 ├─ /api/parse-pdf        PDF to text (unpdf)
 ├─ /api/mark-scheme      notes to mark scheme                (Claude Opus 5.5)
 ├─ /api/analyze          live + final marking, board image   (Sonnet 5.5 / Opus 5.5)
 ├─ /api/board-read       fast plain-words board read         (Claude Haiku 5.5)
 ├─ /api/revision-notes   corrected notes + SVG diagrams      (Claude Sonnet 5.5)
 ├─ /api/to-latex         spoken maths to LaTeX               (Claude Sonnet 5.5)
 ├─ /api/generate-visual  gap diagram                         (fal nano-banana-pro)
 └─ /api/anam-session     builds the persona, returns a session token (Anam REST)
```

Key ideas:

- **Anam only speaks when spoken to**, so Sam's next question is prepared as a private note right after each thing she says, and notes are held while she is speaking.
- **The examiner and the avatar are separate.** The avatar is a student; a hidden examiner marks. The avatar only ever learns which points are covered, never the answers.
- **Everything shown is real.** The report comes from the live marking pipeline; nothing is canned.

## Tech stack

| Area | Technology |
|---|---|
| App | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4 |
| Avatar and voice | Anam (`@anam-ai/js-sdk`): `cara-4.1-express` avatar, GPT OSS 120B LLM, ElevenLabs voice via Anam, Director Notes, client tools |
| Reasoning and vision | Anthropic Claude (`@anthropic-ai/sdk`): Opus 5.5, Sonnet 5.5, Haiku 5.5, structured output with Zod |
| Generative media | fal (`@fal-ai/client`): `fal-ai/nano-banana-pro` |
| PDF | `unpdf` |
| Maths | KaTeX, an in-house spoken-maths to LaTeX converter |
| Design | Figma design system, Inter and Caveat (Google Fonts), Lucide icons |
| Testing | Node test runner (unit), Playwright (browser and live-avatar loops) |

## Getting started

Requirements: Node 20+, and API keys for Anam, Anthropic and fal.

```bash
npm install
cp .env.example .env        # fill in ANAM_API_KEY, ANTHROPIC_API_KEY, FAL_KEY
npm run dev                 # http://localhost:3000 (localhost only; npm run dev:lan for the network)
```

For a demo, use a production build: `npm run build && npm start`.

Optional settings (see `.env.example`): `ANAM_VOICE_MODEL` (for example `eleven_v4_turbo`), `ANAM_VOICE_SPEED`, `ANALYZE_MODEL`, `ANALYZE_LIVE_MODEL`, `BOARD_READ_MODEL`, `NEXT_PUBLIC_MIC_GUARD=off`.

Try it: upload one of the sample notes in `fixtures/` (for example `Quadratic_Equations_GCSE_AQA_Notes.pdf`, or `photosynthesis-gcse.pdf`), wait for the mark scheme to appear, press **Start session**, and teach Sam. The samples are GCSE-style revision notes written for testing; they follow the AQA topic names but are not AQA material. Any lecture-notes PDF works.

No keys or accounts are needed to watch the demo video; running the app yourself needs your own Anam, Anthropic and fal keys (see above).

## Tests

```bash
node --test src/lib/*/*.test.mjs                 # unit tests: marking state, pacing, maths, board, persona
cd tests/e2e && npm install
node smoke.mjs                                    # browser smoke test
node --env-file=../../.env loop.mjs mixed 9       # drives the real avatar with a simulated teacher and judges Sam
node arith.mjs final                              # the examiner must catch a wrong worked answer
node visuals-once.mjs                             # each gap picture is requested once
```

## Project structure

```
src/app/api/                server routes (keys live here)
src/components/workspace/   UI: rail, whiteboard, avatar panel, review
src/lib/anam/               persona, bridge, session connection, tools, cues
src/lib/rail/               mark scheme state, pacing notes, live marking loop
src/lib/curriculum/         examiner prompts, structured output, limits, revision notes
src/lib/board/              Sam's handwriting, question writer, placement
src/lib/math/               spoken maths, LaTeX
src/lib/fal/                visual explainer requests
tests/e2e/                  Playwright flows and the avatar training loop
fixtures/                   sample lecture notes and whiteboard images
design/                     how the code maps to the Figma file
```

## Design

Designed in Figma: https://www.figma.com/design/pcLmbUZJM83G00A1nuyXfm/TeachBack-%E2%80%94-UI-design (tokens, components, screens and spec). See [design/README.md](design/README.md) for how the code maps to it.

## Team

Built over a weekend by Ali, Jonathan, Vince and Rafay at the Imperial AI Hackathon, with Claude Code.
