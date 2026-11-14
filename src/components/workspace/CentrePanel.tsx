"use client";

import type { ReactNode } from "react";
import type { WorkspaceView } from "./types";

/**
 * The centre column: the whiteboard, or the gap notes / end screen in its place.
 * The whiteboard is never unmounted (only hidden), so the drawing survives "Back to whiteboard".
 */
export function CentrePanel({ view, board, notes, summary }: { view: WorkspaceView; board: ReactNode; notes: ReactNode; summary: ReactNode }) {
  return (
    <div className="min-h-[480px] lg:h-full lg:min-h-0">
      <div className={view === "board" ? "h-[480px] lg:h-full" : "hidden"}>{board}</div>
      {view === "notes" && <div className="h-[80dvh] lg:h-full">{notes}</div>}
      {view === "summary" && <div className="h-[85dvh] lg:h-full">{summary}</div>}
    </div>
  );
}
