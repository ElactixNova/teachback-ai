"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Eraser, LoaderCircle, Maximize, Minus, Move, Pen, Plus, ScanSearch, Trash2, Undo2 } from "lucide-react";
import type { WhiteboardSnapshot } from "@/types/session";

/**
 * An infinite whiteboard. Strokes are stored in WORLD coordinates; the view (pan x/y in CSS px, zoom scale)
 * maps world -> screen as screen = world * scale + offset. The export renders every stroke (fitted to their
 * bounds), not just what is on screen, so the examiner sees the whole board.
 */

type Point = [number, number];
interface Stroke {
  color: string;
  width: number;
  erase: boolean;
  points: Point[];
}
/** Undo history: a stroke was added, or the board was cleared (with what it held, so Clear can be undone). */
type Action = { kind: "stroke" } | { kind: "clear"; strokes: Stroke[] };
type Tool = "pen" | "eraser" | "hand";
interface View {
  x: number;
  y: number;
  scale: number;
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
  { name: "Black", value: "#111827" },
  { name: "Blue", value: "#2563eb" },
  { name: "Red", value: "#dc2626" },
  { name: "Green", value: "#16a34a" },
];
const ERASER_WIDTH = 28;
/** Longest edge of the exported PNG, to keep the analyze payload small. */
const MAX_EXPORT_EDGE = 1280;
/** White margin around the strokes in the export, in world px. */
const EXPORT_PAD = 32;
/** How far you can zoom out: half size keeps handwriting readable on screen. */
const MIN_SCALE = 0.5;
const MAX_SCALE = 4;
const GRID = 24;
const CLEAR_TOAST_MS = 6000;

const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

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

/** World-space bounds of the ink (eraser strokes don't add ink), or null when there is none. */
function inkBounds(strokes: Stroke[]): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) {
    if (s.erase) continue;
    const r = s.width / 2;
    for (const [x, y] of s.points) {
      x0 = Math.min(x0, x - r);
      y0 = Math.min(y0, y - r);
      x1 = Math.max(x1, x + r);
      y1 = Math.max(y1, y + r);
    }
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
}

interface Props {
  onSnapAndCheck: () => void;
  checking: boolean;
  /** Called whenever the board goes from empty to non-empty or back. */
  onEmptyChange?: (empty: boolean) => void;
  /** Called after every committed change (stroke, undo, clear) with a counter, so callers can re-mark. Not on pan/zoom. */
  onChange?: (version: number) => void;
}

export const WhiteboardCanvas = forwardRef<WhiteboardHandle, Props>(function WhiteboardCanvas(
  { onSnapAndCheck, checking, onEmptyChange, onChange },
  ref,
) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const history = useRef<Action[]>([]);
  const current = useRef<Stroke | null>(null);
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const viewRef = useRef<View>({ x: 0, y: 0, scale: 1 });
  /** Active pointers (for two-finger pinch/pan) and the pan/pinch gesture in progress. */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ kind: "pan"; lastX: number; lastY: number } | { kind: "pinch"; dist: number; midX: number; midY: number } | null>(null);
  const spaceHeld = useRef(false);

  const [tool, setTool] = useState<Tool>("pen");
  const [ink, setInk] = useState(INKS[0].value);
  const [penWidth, setPenWidth] = useState(4); // one of the three width buttons (2, 4, 7), so one is shown as selected
  const [count, setCount] = useState(0); // committed strokes, drives UI state
  const [canUndo, setCanUndo] = useState(false);
  const [version, setVersion] = useState(0); // bumps on every committed change
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 }); // mirrors viewRef for rendering
  const [panning, setPanning] = useState(false);
  const [spaceDown, setSpaceDown] = useState(false);
  const [clearedToast, setClearedToast] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { dpr } = size.current;
    const { x, y, scale } = viewRef.current;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * x, dpr * y);
    for (const s of strokes.current) drawStroke(ctx, s);
    if (current.current) drawStroke(ctx, current.current);
  }, []);

  const applyView = useCallback(
    (v: View) => {
      viewRef.current = v;
      setView(v);
      redraw();
    },
    [redraw],
  );

  /** Zoom by `factor` keeping the screen point (sx, sy) fixed. */
  const zoomAt = useCallback(
    (factor: number, sx: number, sy: number) => {
      const v = viewRef.current;
      const scale = clampScale(v.scale * factor);
      const k = scale / v.scale;
      applyView({ scale, x: sx - (sx - v.x) * k, y: sy - (sy - v.y) * k });
    },
    [applyView],
  );

  const fit = useCallback(() => {
    const b = inkBounds(strokes.current);
    const { w, h } = size.current;
    if (!b || w < 1 || h < 1) return applyView({ x: 0, y: 0, scale: 1 });
    // Leave room for the tool dock (top) and Snap button (bottom).
    const padX = 48, padTop = 72, padBottom = 88;
    const scale = clampScale(Math.min((w - 2 * padX) / Math.max(1, b.x1 - b.x0), (h - padTop - padBottom) / Math.max(1, b.y1 - b.y0), 1.5));
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    applyView({ scale, x: w / 2 - cx * scale, y: padTop + (h - padTop - padBottom) / 2 - cy * scale });
  }, [applyView]);

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
    setCanUndo(history.current.length > 0);
    setVersion((v) => v + 1);
  };

  useEffect(() => {
    if (version > 0) onChange?.(version);
  }, [version, onChange]);

  const local = (clientX: number, clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  };
  const toWorld = (sx: number, sy: number): Point => {
    const v = viewRef.current;
    return [(sx - v.x) / v.scale, (sy - v.y) / v.scale];
  };

  const panMode = tool === "hand" || spaceDown;

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = local(e.clientX, e.clientY);
    pointers.current.set(e.pointerId, p);
    e.currentTarget.setPointerCapture(e.pointerId);

    // Second finger: drop the stroke just started and switch to pinch-zoom + two-finger pan.
    if (pointers.current.size === 2) {
      current.current = null;
      const [a, b] = [...pointers.current.values()];
      gesture.current = { kind: "pinch", dist: Math.hypot(a.x - b.x, a.y - b.y), midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2 };
      setPanning(true);
      redraw();
      return;
    }
    if (pointers.current.size > 2) return;

    const middle = e.pointerType === "mouse" && e.button === 1;
    if (panMode || middle) {
      gesture.current = { kind: "pan", lastX: p.x, lastY: p.y };
      setPanning(true);
      return;
    }
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const erase = tool === "eraser";
    const scale = viewRef.current.scale;
    current.current = {
      color: ink,
      // Widths are what you see at the current zoom.
      width: (erase ? ERASER_WIDTH : penWidth) / scale,
      erase,
      points: [toWorld(p.x, p.y)],
    };
    redraw();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = local(e.clientX, e.clientY);
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    if (g?.kind === "pinch" && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
      const v = viewRef.current;
      const scale = clampScale(v.scale * (g.dist > 0 ? dist / g.dist : 1));
      const k = scale / v.scale;
      // Zoom about the previous midpoint, then follow the midpoint (two-finger pan).
      applyView({ scale, x: midX - (g.midX - v.x) * k, y: midY - (g.midY - v.y) * k });
      gesture.current = { kind: "pinch", dist, midX, midY };
      return;
    }
    if (g?.kind === "pan") {
      const v = viewRef.current;
      applyView({ ...v, x: v.x + p.x - g.lastX, y: v.y + p.y - g.lastY });
      gesture.current = { kind: "pan", lastX: p.x, lastY: p.y };
      return;
    }
    const s = current.current;
    if (!s) return;
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
    for (const ev of events) {
      const q = local(ev.clientX, ev.clientY);
      s.points.push(toWorld(q.x, q.y));
    }
    redraw();
  };

  const onPointerEnd = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointers.current.delete(e.pointerId);
    if (gesture.current) {
      // A pinch ends when fewer than two fingers remain; a pan when its pointer lifts.
      if (gesture.current.kind === "pan" || pointers.current.size < 2) {
        gesture.current = null;
        setPanning(false);
        pointers.current.clear();
      }
      return;
    }
    const s = current.current;
    if (!s) return;
    current.current = null;
    strokes.current.push(s);
    history.current.push({ kind: "stroke" });
    commit();
    redraw();
  };

  const undo = useCallback(() => {
    const last = history.current.pop();
    if (!last) return;
    if (last.kind === "stroke") strokes.current.pop();
    else strokes.current = last.strokes;
    setClearedToast(false);
    commit();
    redraw();
  }, [redraw]);

  const clear = useCallback(() => {
    if (strokes.current.length === 0) return;
    history.current.push({ kind: "clear", strokes: strokes.current });
    strokes.current = [];
    current.current = null;
    commit();
    redraw();
    // "Board cleared · Undo" for a few seconds instead of a confirm dialog.
    setClearedToast(true);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setClearedToast(false), CLEAR_TOAST_MS);
  }, [redraw]);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  // Keyboard: Ctrl/Cmd+Z undo, P pen, E eraser, H hand, hold Space to pan, Shift+1 fit.
  useEffect(() => {
    const typing = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    };
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === "Space") {
        if (!spaceHeld.current) {
          spaceHeld.current = true;
          setSpaceDown(true);
        }
        e.preventDefault();
        return;
      }
      const k = e.key.toLowerCase();
      if (k === "p") setTool("pen");
      else if (k === "e") setTool("eraser");
      else if (k === "h") setTool("hand");
      else if (e.key === "!" && e.shiftKey) fit();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceHeld.current = false;
        setSpaceDown(false);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [undo, fit]);

  // Wheel: Ctrl/Cmd+wheel (and trackpad pinch, which sends ctrlKey) zooms at the cursor; plain wheel / two-finger
  // trackpad scroll pans. Non-passive so the page doesn't scroll or zoom instead.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        // Mouse wheel notches are ~100 per event; trackpad pinch sends small deltas. Aim for ~10% per notch.
        const k = Math.abs(e.deltaY) >= 50 ? 0.001 : 0.01;
        zoomAt(Math.min(1.5, Math.max(1 / 1.5, Math.exp(-e.deltaY * k))), e.clientX - rect.left, e.clientY - rect.top);
      } else {
        const v = viewRef.current;
        applyView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
      }
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [zoomAt, applyView]);

  /** Renders EVERY stroke (fitted to the ink bounds), regardless of the current pan/zoom. */
  const exportSnapshot = useCallback((): WhiteboardSnapshot | null => {
    const b = inkBounds(strokes.current);
    if (!b) return null;
    const x0 = b.x0 - EXPORT_PAD, y0 = b.y0 - EXPORT_PAD;
    const w = b.x1 - b.x0 + 2 * EXPORT_PAD, h = b.y1 - b.y0 + 2 * EXPORT_PAD;
    // Output pixels per world px: up to 2x for sharp handwriting, but never past MAX_EXPORT_EDGE.
    const scale = Math.min(2, MAX_EXPORT_EDGE / Math.max(w, h));
    const width = Math.max(1, Math.round(w * scale));
    const height = Math.max(1, Math.round(h * scale));
    // Strokes first on a transparent layer (eraser strokes cut through ink only), then onto white.
    const ink = document.createElement("canvas");
    ink.width = width;
    ink.height = height;
    const ictx = ink.getContext("2d");
    const out = document.createElement("canvas");
    out.width = width;
    out.height = height;
    const ctx = out.getContext("2d");
    if (!ictx || !ctx) return null;
    ictx.setTransform(scale, 0, 0, scale, -x0 * scale, -y0 * scale);
    for (const s of strokes.current) drawStroke(ictx, s);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(ink, 0, 0);
    const dataUrl = out.toDataURL("image/png");
    return {
      pngBase64: dataUrl.slice(dataUrl.indexOf(",") + 1),
      width,
      height,
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
    `inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors disabled:opacity-40 ${
      active ? "bg-card text-ink shadow-[var(--shadow-1)] ring-1 ring-line" : "text-muted hover:bg-accent-soft hover:text-ink"
    }`;
  const divider = <div className="mx-0.5 h-6 w-px shrink-0 bg-line" aria-hidden />;
  const centre = () => ({ x: size.current.w / 2, y: size.current.h / 2 });
  const cursor = panning ? "cursor-grabbing" : panMode ? "cursor-grab" : tool === "eraser" ? "cursor-cell" : "cursor-crosshair";

  return (
    <section aria-label="Whiteboard" className="sheet relative flex h-full min-h-0 flex-col overflow-hidden">
      <div
        ref={wrapRef}
        className="relative min-h-0 flex-1 overflow-hidden bg-white"
        style={{
          backgroundImage: "radial-gradient(circle, #a9abd9 1px, transparent 1.2px)",
          backgroundSize: `${GRID * view.scale}px ${GRID * view.scale}px`,
          backgroundPosition: `${view.x}px ${view.y}px`,
        }}
      >
        <canvas
          ref={canvasRef}
          className={`absolute inset-0 h-full w-full touch-none ${cursor}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onAuxClick={(e) => e.preventDefault()}
          aria-label="Whiteboard drawing area"
        />
        {!hasInk && !clearedToast && (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-faint">
            Sketch your diagram or equations here while you explain. Use the move tool (or hold Space) to drag the board around.
          </p>
        )}

        {/* Tool Dock (Figma 29:509): floating pill, top centre. */}
        {/* Uniform 4px padding: the end buttons (h-9, rounded-full) sit concentric with the pill's rounded ends. */}
        <div className="absolute left-1/2 top-3 flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-0.5 overflow-x-auto rounded-full border border-line bg-card/95 p-1 shadow-[var(--shadow-1)]" role="toolbar" aria-label="Whiteboard tools">
          <button type="button" className={toolBtn(tool === "pen")} onClick={() => setTool("pen")} title="Pen (P)" aria-label="Pen" aria-pressed={tool === "pen"}>
            <Pen className="h-4 w-4" />
          </button>
          <button type="button" className={toolBtn(tool === "eraser")} onClick={() => setTool("eraser")} title="Eraser (E)" aria-label="Eraser" aria-pressed={tool === "eraser"}>
            <Eraser className="h-4 w-4" />
          </button>
          <button type="button" className={toolBtn(tool === "hand")} onClick={() => setTool("hand")} title="Move the board (H, or hold Space)" aria-label="Move the board" aria-pressed={tool === "hand"}>
            <Move className="h-4 w-4" />
          </button>
          {divider}
          {INKS.map((c) => (
            <button
              key={c.value}
              type="button"
              title={`${c.name} ink`}
              aria-label={`${c.name} ink`}
              aria-pressed={ink === c.value && tool === "pen"}
              onClick={() => {
                setInk(c.value);
                setTool("pen");
              }}
              className="inline-flex h-9 w-8 shrink-0 items-center justify-center rounded-full hover:bg-accent-soft"
            >
              <span
                className={`h-5 w-5 rounded-full transition ${ink === c.value && tool === "pen" ? "ring-2 ring-ink ring-offset-2" : ""}`}
                style={{ backgroundColor: c.value }}
              />
            </button>
          ))}
          {divider}
          {[2, 4, 7].map((w) => (
            <button
              key={w}
              type="button"
              title={`Stroke ${w}px`}
              aria-label={`Stroke width ${w}`}
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
          {divider}
          <button type="button" className={toolBtn(false)} onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
            <Undo2 className="h-4 w-4" />
          </button>
          <button type="button" className={toolBtn(false)} onClick={clear} disabled={!hasInk} title="Clear board (undoable)" aria-label="Clear board">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        {/* Bottom row: zoom controls on the left, Check my progress (Figma 29:508) on the right. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-4">
          <div className="pointer-events-auto inline-flex items-center gap-0.5 rounded-full border border-line bg-card/95 p-0.5 shadow-[var(--shadow-1)]" role="group" aria-label="Zoom">
            <button type="button" className={toolBtn(false)} onClick={() => zoomAt(1 / 1.25, centre().x, centre().y)} title="Zoom out (Ctrl+scroll)" aria-label="Zoom out">
              <Minus className="h-4 w-4" />
            </button>
            <span className="w-11 text-center text-xs font-semibold tabular-nums text-muted" aria-live="polite">
              {Math.round(view.scale * 100)}%
            </span>
            <button type="button" className={toolBtn(false)} onClick={() => zoomAt(1.25, centre().x, centre().y)} title="Zoom in (Ctrl+scroll)" aria-label="Zoom in">
              <Plus className="h-4 w-4" />
            </button>
            <button type="button" className={`${toolBtn(false)} w-auto gap-1 px-2.5 text-xs font-semibold`} onClick={fit} title="Fit everything on screen (Shift+1)" aria-label="Fit board to screen">
              <Maximize className="h-3.5 w-3.5" /> Fit
            </button>
          </div>
          <button
            type="button"
            onClick={onSnapAndCheck}
            disabled={checking}
            className="action pointer-events-auto inline-flex min-h-12 items-center gap-3 rounded-full bg-accent px-5 py-1.5 text-left text-white transition hover:bg-accent-strong disabled:cursor-wait disabled:opacity-80"
          >
            {checking ? <LoaderCircle className="h-5 w-5 shrink-0 animate-spin" /> : <ScanSearch className="h-5 w-5 shrink-0" />}
            <span className="leading-tight">
              <span className="block whitespace-nowrap text-base font-semibold">{checking ? "Checking…" : "Check my progress"}</span>
              <span className="block whitespace-nowrap text-xs text-white/80">{checking ? "Comparing with your mark scheme" : "Marks so far, then keep teaching"}</span>
            </span>
          </button>
        </div>

        {clearedToast && (
          <div role="status" className="absolute left-1/2 top-16 flex -translate-x-1/2 items-center gap-3 rounded-full bg-ink px-4 py-2 text-sm text-white shadow-[var(--shadow-1)]">
            Board cleared
            <button type="button" onClick={undo} className="font-semibold text-accent-soft underline-offset-2 hover:underline">
              Undo
            </button>
          </div>
        )}
      </div>
    </section>
  );
});
