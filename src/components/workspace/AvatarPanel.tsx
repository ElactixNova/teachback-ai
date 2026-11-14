"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Mic, MicOff, Send, Video, VideoOff } from "lucide-react";
import type { Cue } from "@/types/session";
import { ANAM_VIDEO_ID, type AvatarStatus, type TranscriptLine } from "./types";

const CUE_STYLE: Record<Cue, { label: string; emoji: string; className: string }> = {
  happy: { label: "Following you", emoji: "😊", className: "bg-emerald-500/90 text-white" },
  curious: { label: "Curious", emoji: "🤔", className: "bg-sky-500/90 text-white" },
  concerned: { label: "Not sure about that", emoji: "😟", className: "bg-amber-500/90 text-stone-950" },
  surprised: { label: "Surprised", emoji: "😮", className: "bg-violet-500/90 text-white" },
};

interface Props {
  status: AvatarStatus;
  statusDetail?: string;
  cue: Cue | null;
  transcript: TranscriptLine[];
  onConnect: () => void;
  onDisconnect: () => void;
  /** Typed fallback: lets the demo work without a mic or live avatar. */
  onTypedLine: (text: string) => void;
}

export function AvatarPanel({ status, statusDetail, cue, transcript, onConnect, onDisconnect, onTypedLine }: Props) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const live = status === "live";

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [transcript.length]);

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    onTypedLine(text);
    setDraft("");
  };

  const cueStyle = cue ? CUE_STYLE[cue] : null;

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Avatar stage */}
      <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-stone-900 shadow-sm">
        <video
          id={ANAM_VIDEO_ID}
          autoPlay
          playsInline
          className={`h-full w-full object-cover transition-opacity ${live ? "opacity-100" : "opacity-0"}`}
        />

        {!live && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-stone-800 text-3xl">🧑‍🎓</div>
            <p className="max-w-xs text-sm text-stone-300">
              {status === "connecting"
                ? "Waking up your student…"
                : status === "error"
                  ? statusDetail || "Could not connect to the avatar."
                  : "Your AI student is ready to learn. Teach it the topic out loud."}
            </p>
            <button
              type="button"
              onClick={onConnect}
              disabled={status === "connecting"}
              className="inline-flex items-center gap-2 rounded-full bg-amber-500 px-4 py-2 text-sm font-semibold text-stone-950 transition hover:bg-amber-400 disabled:opacity-70"
            >
              {status === "connecting" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />}
              {status === "error" ? "Try again" : "Start session"}
            </button>
          </div>
        )}

        {/* Status chips */}
        <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium backdrop-blur ${
              live ? "bg-red-500/90 text-white" : "bg-white/15 text-stone-200"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${live ? "animate-pulse bg-white" : "bg-stone-400"}`} />
            {live ? "LIVE" : status === "connecting" ? "Connecting" : "Offline"}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-xs font-medium text-stone-200 backdrop-blur">
            {live ? <Mic className="h-3 w-3" /> : <MicOff className="h-3 w-3" />}
            {live ? "Listening" : "Mic off"}
          </span>
        </div>

        {cueStyle && (
          <span
            key={cue}
            className={`absolute right-3 top-3 inline-flex animate-[pulse_1s_ease-out_1] items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold shadow ${cueStyle.className}`}
            aria-live="polite"
          >
            <span aria-hidden>{cueStyle.emoji}</span>
            {cueStyle.label}
          </span>
        )}

        {live && (
          <button
            type="button"
            onClick={onDisconnect}
            className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-xs font-medium text-white backdrop-blur hover:bg-white/25"
          >
            <VideoOff className="h-3.5 w-3.5" /> End
          </button>
        )}
      </div>

      {/* Transcript */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-stone-200 px-4 py-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-500">Transcript</h2>
          <span className="text-xs text-stone-400">{transcript.length} lines</span>
        </div>
        <div ref={listRef} className="min-h-24 flex-1 space-y-2 overflow-y-auto px-4 py-3">
          {transcript.length === 0 ? (
            <p className="text-sm text-stone-400">
              What you say appears here. No mic? Type your explanation below.
            </p>
          ) : (
            transcript.map((l) => (
              <div key={l.id} className={`flex ${l.speaker === "student" ? "justify-end" : "justify-start"}`}>
                <p
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                    l.speaker === "student"
                      ? "rounded-br-sm bg-stone-900 text-white"
                      : "rounded-bl-sm bg-stone-100 text-stone-800"
                  }`}
                >
                  {l.text}
                </p>
              </div>
            ))
          )}
        </div>
        <form
          className="flex items-end gap-2 border-t border-stone-200 p-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder="Type part of your explanation…"
            className="max-h-28 min-h-9 flex-1 resize-none rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-900 outline-none placeholder:text-stone-400 focus:border-amber-400"
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-stone-900 text-white transition hover:bg-stone-700 disabled:opacity-40"
            aria-label="Add to transcript"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>
    </section>
  );
}
