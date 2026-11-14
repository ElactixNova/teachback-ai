"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Eraser, LoaderCircle, Pen, ScanSearch, Trash2, Undo2 } from "lucide-react";
import type { WhiteboardSnapshot } from "@/types/session";

type Point = [number, number];
interface Stroke {
  color: string;
  width: number;
  erase: boolean;
  points: Point[];
}

export interface WhiteboardHandle {
  /** Base64 PNG (no data: prefix) on a white background, or null when the board is empty. */
  exportSnapshotBase64: () => string | null;
  /** Full snapshot for /api/analyze, or null when the board is empty. */
  exportSnapshot: () => WhiteboardSnapshot | null;
  clear: () => void;
  isEmpty: () => boolean;
}

const INKS = [
  { name: "Ink", value: "#12201f" },
  { name: "Blue", value: "#2563eb" },
  { name: "Red", value: "#dc2626" },
  { name: "Green", value: "#15803d" },
];
const ERASER_WIDTH = 28;
/** Longest edge of the exported PNG, to keep the analyze payload small. */
const MAX_EXPORT_EDGE = 1280;

function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke) {
  if (s.points.length === 0) return;
  ctx.save();
  ctx.globalCompositeOperation = s.erase ? "destination-out" : "source-over";
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = s.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (s.points.length === 1) {
    const [x, y] = s.points[0];
    ctx.beginPath();
    ctx.arc(x, y, s.width / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(s.points[0][0], s.points[0][1]);
    // Quadratic smoothing through midpoints.
    for (let i = 1; i < s.points.length - 1; i++) {
      const [x0, y0] = s.points[i];
      const [x1, y1] = s.points[i + 1];
      ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
    }
    const last = s.points[s.points.length - 1];
    ctx.lineTo(last[0], last[1]);
    ctx.stroke();
  }
  ctx.restore();
}

interface Props {
  onSnapAndCheck: () => void;
  checking: boolean;
  /** Called whenever the board goes from empty to non-empty or back. */
  onEmptyChange?: (empty: boolean) => void;
  /** Called after every committed change (stroke, undo, clear) with a counter, so callers can re-mark. */
  onChange?: (version: number) => void;
}

export const WhiteboardCanvas = forwardRef<WhiteboardHandle, Props>(function WhiteboardCanvas(
  { onSnapAndCheck, checking, onEmptyChange, onChange },
  ref,
) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const current = useRef<Stroke | null>(null);
  const size = useRef({ w: 0, h: 0, dpr: 1 });

  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const [ink, setInk] = useState(INKS[0].value);
  const [penWidth, setPenWidth] = useState(3);
  const [count, setCount] = useState(0); // number of committed strokes, drives UI state
  const [version, setVersion] = useState(0); // bumps on every committed change

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { dpr } = size.current;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const s of strokes.current) drawStroke(ctx, s);
    if (current.current) drawStroke(ctx, current.current);
  }, []);

  // Keep the backing store matched to the element size and device pixel ratio.
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ro = new ResizeObserver(() => {
      const rect = wrap.getBoundingClientRect();
      // Hidden (display:none while the notes are shown): keep the backing store and strokes as they are.
      if (rect.width < 1 || rect.height < 1) return;
      const dpr = window.devicePixelRatio || 1;
      size.current = { w: rect.width, h: rect.height, dpr };
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      redraw();
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [redraw]);

  const hasInk = count > 0;
  useEffect(() => {
    onEmptyChange?.(!hasInk);
  }, [hasInk, onEmptyChange]);

  const commit = () => {
    setCount(strokes.current.length);
    setVersion((v) => v + 1);
  };

  useEffect(() => {
    if (version > 0) onChange?.(version);
  }, [version, onChange]);

  const pointFrom = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = e.currentTarget.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const erase = tool === "eraser";
    current.current = {
      color: ink,
      width: erase ? ERASER_WIDTH : penWidth,
      erase,
      points: [pointFrom(e)],
    };
    redraw();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = current.current;
    if (!s) return;
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
    const rect = e.currentTarget.getBoundingClientRect();
    for (const ev of events) s.points.push([ev.clientX - rect.left, ev.clientY - rect.top]);
    redraw();
  };

  const endStroke = () => {
    const s = current.current;
    if (!s) return;
    current.current = null;
    strokes.current.push(s);
    commit();
    redraw();
  };

  const undo = useCallback(() => {
    strokes.current.pop();
    commit();
    redraw();
  }, [redraw]);

  const clear = useCallback(() => {
    strokes.current = [];
    current.current = null;
    commit();
    redraw();
  }, [redraw]);

  // Ctrl/Cmd+Z undo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);

  const exportSnapshot = useCallback((): WhiteboardSnapshot | null => {
    const canvas = canvasRef.current;
    if (!canvas || strokes.current.length === 0) return null;
    const { w, h } = size.current;
    // Output pixels per CSS pixel: use the screen's density (max 2x), but never exceed MAX_EXPORT_EDGE.
    const scale = Math.min(size.current.dpr, 2, MAX_EXPORT_EDGE / Math.max(w, h));
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(w * scale));
    out.height = Math.max(1, Math.round(h * scale));
    const ctx = out.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(canvas, 0, 0, out.width, out.height);
    const dataUrl = out.toDataURL("image/png");
    return {
      pngBase64: dataUrl.slice(dataUrl.indexOf(",") + 1),
      width: out.width,
      height: out.height,
      capturedAt: new Date().toISOString(),
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      exportSnapshot,
      exportSnapshotBase64: () => exportSnapshot()?.pngBase64 ?? null,
      clear,
      isEmpty: () => strokes.current.length === 0,
    }),
    [exportSnapshot, clear],
  );

  const toolBtn = (active: boolean) =>
    `inline-flex h-11 w-11 items-center justify-center rounded-lg transition-colors ${
      active ? "bg-accent text-white" : "text-muted hover:bg-canvas"
    }`;

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-1.5">
        <div className="flex items-center gap-1" role="toolbar" aria-label="Whiteboard tools">
          <button type="button" className={toolBtn(tool === "pen")} onClick={() => setTool("pen")} title="Pen" aria-pressed={tool === "pen"}>
            <Pen className="h-4 w-4" />
          </button>
          <button
            type="button"
            className={toolBtn(tool === "eraser")}
            onClick={() => setTool("eraser")}
            title="Eraser"
            aria-pressed={tool === "eraser"}
          >
            <Eraser className="h-4 w-4" />
          </button>
        </div>

        <div className="mx-1 h-6 w-px bg-line" />

        <div className="flex items-center gap-1.5">
          {INKS.map((c) => (
            <button
              key={c.value}
              type="button"
              title={c.name}
              aria-label={`${c.name} ink`}
              aria-pressed={ink === c.value && tool === "pen"}
              onClick={() => {
                setInk(c.value);
                setTool("pen");
              }}
              className={`h-6 w-6 rounded-full ring-offset-2 transition ${
                ink === c.value && tool === "pen" ? "ring-2 ring-accent" : "hover:scale-110"
              }`}
              style={{ backgroundColor: c.value }}
            />
          ))}
        </div>

        <div className="mx-1 h-6 w-px bg-line" />

        <div className="flex items-center gap-1">
          {[2, 4, 7].map((w) => (
            <button
              key={w}
              type="button"
              title={`Stroke ${w}px`}
              aria-pressed={penWidth === w}
              onClick={() => {
                setPenWidth(w);
                setTool("pen");
              }}
              className={toolBtn(penWidth === w && tool === "pen")}
            >
              <span className="rounded-full bg-current" style={{ width: w + 2, height: w + 2 }} />
            </button>
          ))}
        </div>

        <div className="mx-1 h-6 w-px bg-line" />

        <button type="button" className={toolBtn(false)} onClick={undo} disabled={!hasInk} title="Undo (Ctrl+Z)">
          <Undo2 className="h-4 w-4" />
        </button>
        <button type="button" className={toolBtn(false)} onClick={clear} disabled={!hasInk} title="Clear board">
          <Trash2 className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={onSnapAndCheck}
          disabled={checking}
          className="ml-auto inline-flex h-11 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-bold text-white transition hover:bg-accent-strong disabled:cursor-wait disabled:opacity-70"
        >
          {checking ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
          {checking ? "Checking…" : "Snap & Check"}
        </button>
      </div>

      <div
        ref={wrapRef}
        className="relative min-h-0 flex-1 bg-white"
        style={{
          backgroundImage: "radial-gradient(circle, #dde5e4 1px, transparent 1px)",
          backgroundSize: "22px 22px",
        }}
      >
        <canvas
          ref={canvasRef}
          className={`absolute inset-0 h-full w-full touch-none ${tool === "eraser" ? "cursor-cell" : "cursor-crosshair"}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
          aria-label="Whiteboard drawing area"
        />
        {!hasInk && (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-faint">
            Sketch your diagram or equations here while you explain.
          </p>
        )}
      </div>
    </section>
  );
});
