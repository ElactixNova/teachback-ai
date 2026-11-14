"use client";

import { Download, ExternalLink, Maximize2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface Props {
  src: string;
  alt: string;
  /** Classes for the thumbnail <img>. */
  className?: string;
}

/** File name for a download: the alt text without the "Diagram: " style prefix, safe for file systems. */
function fileName(alt: string, src: string): string {
  const ext = src.startsWith("data:image/svg") ? "svg" : /\.(png|jpe?g|webp|gif)(\?|$)/i.exec(src)?.[1]?.toLowerCase().replace("jpeg", "jpg") ?? "png";
  const base = alt.replace(/^[A-Za-z]+:\s*/, "").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "feynman-diagram";
  return `${base}.${ext}`;
}

/**
 * A thumbnail that opens full size in a native <dialog> (Esc or backdrop click closes it), with
 * Download and Open in new tab. Works for data: URIs (inline SVG) and remote fal image URLs.
 */
export function ZoomableImage({ src, alt, className = "" }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  async function download() {
    setBusy(true);
    try {
      // fal URLs are cross-origin, where <a download> is ignored: fetch the bytes and save a blob.
      const blob = await (await fetch(src)).blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName(alt, src);
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      window.open(src, "_blank", "noopener,noreferrer");
    } finally {
      setBusy(false);
    }
  }

  const btn = "inline-flex h-11 items-center gap-1.5 rounded-xl border border-white/30 bg-white/10 px-3.5 text-sm font-bold text-white hover:bg-white/20 disabled:opacity-60";

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={`Expand: ${alt}`} className="group relative block w-full cursor-zoom-in text-left">
        {/* eslint-disable-next-line @next/next/no-img-element -- remote fal URL or inline SVG data URI */}
        <img src={src} alt={alt} className={className} />
        <span className="pointer-events-none absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-card/90 px-2 py-1 text-[11px] font-bold text-muted opacity-90 shadow-sm group-hover:text-ink">
          <Maximize2 className="h-3 w-3" /> Expand
        </span>
      </button>
      <dialog
        ref={dialog}
        onClose={() => setOpen(false)}
        onClick={(e) => e.target === dialog.current && setOpen(false)}
        aria-label={alt}
        className="m-auto h-[92vh] w-[96vw] max-w-none rounded-2xl border-0 bg-black/90 p-0 backdrop:bg-black/70"
      >
        {open && (
          <div className="flex h-full flex-col gap-3 p-3 sm:p-4">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button type="button" onClick={download} disabled={busy} className={btn}>
                <Download className="h-4 w-4" /> {busy ? "Saving…" : "Download"}
              </button>
              <a href={src} target="_blank" rel="noopener noreferrer" className={btn}>
                <ExternalLink className="h-4 w-4" /> Open in new tab
              </a>
              <button type="button" onClick={() => setOpen(false)} className={btn} aria-label="Close">
                <X className="h-4 w-4" /> Close
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
            <img src={src} alt={alt} className="min-h-0 flex-1 rounded-xl bg-white object-contain" />
          </div>
        )}
      </dialog>
    </>
  );
}
