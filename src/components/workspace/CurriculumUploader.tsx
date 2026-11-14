"use client";

import { useRef, useState } from "react";
import { FileText, LoaderCircle, Upload, X } from "lucide-react";
import type { CurriculumContext } from "@/types/session";
import { parsePdf } from "./api";

interface Props {
  curriculum: CurriculumContext | null;
  onChange: (curriculum: CurriculumContext | null) => void;
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
      onChange({ ...parsed, title: parsed.title || file.name.replace(/\.pdf$/i, "") });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that PDF.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  if (curriculum) {
    return (
      <div className="rounded-2xl border border-stone-200 bg-white p-3 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
            <FileText className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-stone-900" title={curriculum.title}>
              {curriculum.title}
            </p>
            <p className="text-xs text-stone-500">
              {curriculum.pageCount} {curriculum.pageCount === 1 ? "page" : "pages"} ·{" "}
              {curriculum.text.length.toLocaleString()} characters
            </p>
          </div>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="rounded-md p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
            title="Remove notes"
            aria-label="Remove lecture notes"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <label className="mt-3 flex items-center gap-2 rounded-full border border-stone-200 bg-stone-50 py-1 pl-3 pr-1 text-xs text-stone-500 focus-within:border-amber-400">
          <span className="shrink-0 font-medium text-stone-600">Topic</span>
          <input
            value={curriculum.topic ?? ""}
            onChange={(e) => onChange({ ...curriculum, topic: e.target.value || undefined })}
            placeholder="e.g. Bayes' theorem"
            className="min-w-0 flex-1 rounded-full bg-transparent py-1 text-sm text-stone-900 outline-none placeholder:text-stone-400"
          />
        </label>
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
          dragging ? "border-amber-500 bg-amber-50" : "border-stone-300 bg-white hover:border-amber-400 hover:bg-amber-50/50"
        }`}
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-stone-600">
          {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        </div>
        <div>
          <p className="text-sm font-semibold text-stone-900">{busy ? "Reading your notes…" : "Upload lecture notes"}</p>
          <p className="text-xs text-stone-500">PDF, drop it here or click to browse</p>
        </div>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => void upload(e.target.files?.[0])}
      />
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
