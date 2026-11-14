# Project: Feynman AI (Imperial AI Hackathon — Track 02: Voice, Vision & Generative Media)

## Core Concept
A Feynman-technique "Reverse AI Tutor" web app. Instead of the AI lecturing the user, the user:
1. Uploads a PDF of their lecture notes / curriculum to scope the session.
2. Explains a topic out loud to a real-time **Anam AI** video avatar while sketching equations/diagrams on an interactive whiteboard canvas.
3. Watches the avatar react non-verbally in real time (nodding/encouraging when accurate; looking `[curious]` or `[concerned]` when explanations are vague or flawed).
4. Triggers (via voice or button) a multimodal evaluation of their spoken transcript + whiteboard snapshot against the uploaded PDF.
5. Receives a structured **Knowledge Gap Report**, a **Personalized Study Plan**, and an auto-generated **`fal.ai` visual explainer** (video/diagram) illustrating the exact concept they got stuck on.

## Target Hackathon Bounties (Do Not Deviate From Stack)
- **Main Track:** Voice, Vision & Generative Media
- **Anam Sub-Bounty:** Must use `@anam-ai/js-sdk` with `avatarModel: "cara-4.1-express"`, **Director Notes** (inline expression cues `[happy]`, `[curious]`, `[concerned]`, `[surprised]`), and **Client Tool Calling** (`registerToolCallHandler`).
- **fal.ai Sub-Bounty:** Must use `@fal-ai/client` (fast video/image models like `H3Max` / `Flux3Max` or `fal-ai/flux/dev`) to generate visual explainers for knowledge gaps.
- **Figma Cross-Cutting:** Clean, modern split-screen UI matching our Figma design system.

## Tech Stack
- **Framework:** Next.js 14+ (App Router), TypeScript, Tailwind CSS, Lucide Icons
- **Avatar & Voice:** `@anam-ai/js-sdk` (server-side session token route `/api/anam-session`)
- **Generative Media:** `@fal-ai/client` (server-side route `/api/generate-visual`)
- **Multimodal Vision & Curriculum Analysis:** Multimodal LLM API (e.g., Anthropic Claude / OpenAI / Gemini via server route `/api/analyze`) accepting PDF text context + base64 PNG whiteboard snapshot + conversation transcript.
- **Whiteboard:** Lightweight HTML5 Canvas / `tldraw` or `react-sketch-canvas` supporting `.toDataURL("image/png")` export.

## Directory Structure & 4-Developer Ownership Boundaries
To prevent Git merge conflicts across 4 team members, strictly isolate logic into these modules:
- `src/types/session.ts` — Shared TypeScript interfaces (`CurriculumContext`, `WhiteboardSnapshot`, `GapReport`, `StudyStep`, `VisualExplainer`).
- `src/components/workspace/` — **[Dev 1: Frontend/UI]** Split-screen layout:
  - `AvatarPanel.tsx` (renders `<video id="anam-video">` + live expression/cue badge + mic status)
  - `WhiteboardCanvas.tsx` (pen, eraser, clear, "Snap & Check" button, exposes `exportSnapshotBase64()`)
  - `CurriculumUploader.tsx` (PDF upload & topic scope pill)
  - `ReportDrawer.tsx` (renders Knowledge Gap Report, Study Plan checklist, and embedded `fal.ai` visual explainer player)
- `src/lib/anam/` & `src/app/api/anam-session/route.ts` — **[Dev 2: Anam Integration]**
  - Creates session token with `avatarModel: "cara-4.1-express"` and `directorNotes: { presetStyle: "warm", expressivity: 0.6 }`.
  - System prompt instructs the persona to act as an attentive peer/tutor who listens while the student teaches, uses inline cues (`[happy]`, `[curious]`, `[concerned]`) sparingly to reflect understanding vs. confusion, never dumps full answers prematurely, and invokes client tools.
  - Registers 3 client tool handlers via `anamClient.registerToolCallHandler`:
    1. `capture_whiteboard`: grabs current PNG from `WhiteboardCanvas` and sends it to `/api/analyze`.
    2. `open_gap_report`: populates `ReportDrawer` with structured gaps & study plan.
    3. `generate_visual_explainer`: calls `/api/generate-visual` with a tailored visual prompt for the user's primary misconception and displays the resulting video/image.
- `src/app/api/parse-pdf/route.ts` & `src/app/api/analyze/route.ts` — **[Dev 3: Vision & Curriculum Backend]**
  - Extracts text from uploaded PDF lecture notes (`pdf-parse` or `unpdf`).
  - Evaluates `{ transcript, whiteboardBase64, curriculumText }` to return strict JSON matching `GapReport`.
- `src/app/api/generate-visual/route.ts` — **[Dev 4: fal.ai Media Pipeline]**
  - Takes `{ concept, misconception, visualPrompt }` and calls `@fal-ai/client` (`fal.subscribe(...)`) to return a fast explainer video/image URL with graceful fallback to fast image generation if video queue latency exceeds 10s.

## Immediate Next Step
Scaffold this Next.js TypeScript project structure now, create `src/types/session.ts` with complete interfaces, and implement working boilerplate for all 4 routes and components so all 4 teammates can `git pull` and develop in parallel.