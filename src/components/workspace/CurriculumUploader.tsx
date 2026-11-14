"use client";

import { useRef, useState } from "react";
import { FileText, LoaderCircle, Upload, X } from "lucide-react";
import type { CurriculumContext } from "@/types/session";
import { parsePdf } from "./api";

interface Props {
  curriculum: CurriculumContext | null;
  /** `fileName` is set on a fresh upload (it names the mark scheme's source). */
  onChange: (curriculum: CurriculumContext | null, fileName?: string) => void;
}

const MAX_MB = 20;

export function CurriculumUploader({ curriculum, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setError("Please choose a PDF file.");
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`PDF is larger than ${MAX_MB} MB.`);
      return;
    }
    setBusy(true);
    try {
      const parsed = await parsePdf(file);
      onChange({ ...parsed, title: parsed.title || file.name.replace(/\.pdf$/i, "") }, file.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that PDF.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  if (curriculum) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-line bg-card p-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <FileText className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold" title={curriculum.title}>
            {curriculum.title}
          </p>
          <p className="text-xs text-muted">
            {curriculum.pageCount} {curriculum.pageCount === 1 ? "page" : "pages"} of lecture notes
          </p>
        </div>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-faint hover:bg-canvas hover:text-ink"
          aria-label="Remove lecture notes"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void upload(e.dataTransfer.files[0]);
        }}
        disabled={busy}
        className={`flex w-full items-center gap-3 rounded-2xl border-2 border-dashed p-3 text-left transition ${
          dragging ? "border-accent bg-accent-soft" : "border-line bg-card hover:border-accent hover:bg-accent-soft/50"
        }`}
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
          {busy ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
        </div>
        <div>
          <p className="text-sm font-bold">{busy ? "Reading your notes…" : "Upload lecture notes"}</p>
          <p className="text-xs text-muted">PDF. Drop it here or click to browse</p>
        </div>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => void upload(e.target.files?.[0])}
      />
      {error && <p className="mt-2 text-xs font-medium text-missed">{error}</p>}
    </div>
  );
}
