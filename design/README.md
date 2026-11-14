# Feynman AI: design

**Figma file:** https://www.figma.com/design/pcLmbUZJM83G00A1nuyXfm/TeachBack-%E2%80%94-UI-design

The Figma file is the source of truth for the visuals. The app takes its tokens, type and components from it.

| Page | What's there |
|---|---|
| Design language | Type, the highlighter, colour roles, shape, voice |
| Foundations | Every colour, type style, radius, spacing step and shadow (Figma variables carry their CSS names) |
| Components | Every component with all its variants and states, with behaviour notes |
| Desktop | Full screens wired as a clickable prototype |
| Spec | Layout, triggers, timings, accessibility, copy rules |

## How the code follows it

- **Tokens:** `src/app/globals.css` maps every Figma variable (`--paper`, `--ink`, `--accent`, `--highlight`, severity colours, radii, `Elevation/1-3` shadows) to Tailwind theme tokens.
- **Type:** Inter for all interface text. Caveat (Figma `Hand/Board`) is reserved for whiteboard handwriting.
- **Logo:** `public/brand-mark.svg`, exported from `Brand/Mark` (3:98).
- **Shape and depth:** the main sheets use a 1.25px ink outline with a hard 3px offset shadow (`.sheet`). Snap & Check and Finish use a 1px outline with a 2px hard shadow (`.action`). There are no gradients.
- **The highlighter (`.hl`)** marks only the current topic.
- **Components:** Tool Dock, Snap Button, Avatar Stage (chips, mood badge with icon + words), Transcript bubbles, Score Ring, Severity Tag, Strength Chip and Gap Card are built in `src/components/workspace/`.
- **Layout:** the shipped app adds the **Mark Scheme Rail** (a left column of marking criteria) to the Figma two-column workspace. The report renders in the centre column instead of a drawer, so the whiteboard never gets covered.

## The rail layout in Figma

- **Screen:** [Desktop / Workspace / Live — Mark Scheme Rail](https://www.figma.com/design/pcLmbUZJM83G00A1nuyXfm/TeachBack-%E2%80%94-UI-design?node-id=70-2450) (Desktop page, below the original row). It has three columns:
  - the notes card and Mark Scheme Rail,
  - the whiteboard,
  - the session panel (avatar and transcript).
- **Component:** `Rail Item` (Components page, node 70:761). It has six `Status` variants (Full, Partial, Missed, In progress, Not covered, Parked) and `Title` / `Marks` text properties. All colours, spacing and type use the file's variables and text styles.
