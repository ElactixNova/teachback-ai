"use client";

import { useEffect, useRef, useState } from "react";
import { Clock3, LoaderCircle, Mic, MicOff, Send, Video, VideoOff } from "lucide-react";
import type { Cue } from "@/types/session";
import { ANAM_VIDEO_ID, type AvatarStatus, type TranscriptLine } from "./types";

const CUE_STYLE: Record<Cue, { label: string; className: string }> = {
  happy: { label: "Following you", className: "bg-accent text-white" },
  curious: { label: "Curious", className: "bg-sky-600 text-white" },
  concerned: { label: "Not sure about that", className: "bg-partial text-white" },
  surprised: { label: "Surprised", className: "bg-violet-600 text-white" },
};

/** Detail strings from the bridge that mean "live, but the mic is blocked". */
const MIC_BLOCKED = /microphone/i;

interface Props {
  status: AvatarStatus;
  statusDetail?: string;
  cue: Cue | null;
  transcript: TranscriptLine[];
  onConnect: () => void;
  onDisconnect: () => void;
  /** Typed fallback: lets the demo work without a mic or live avatar. */
  onTypedLine: (text: string) => void;
  /** Extra content under the video (e.g. the end-screen "Try it now" card). */
  children?: React.ReactNode;
}

export function AvatarPanel({ status, statusDetail, cue, transcript, onConnect, onDisconnect, onTypedLine, children }: Props) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const live = status === "live";
  const micBlocked = live && !!statusDetail && MIC_BLOCKED.test(statusDetail);

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
    <section aria-label="Your AI student" className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="relative aspect-[4/3] w-full shrink-0 overflow-hidden rounded-2xl bg-[#0d1b1a] lg:aspect-video">
        <video
          id={ANAM_VIDEO_ID}
          autoPlay
          playsInline
          className={`h-full w-full object-cover transition-opacity ${live ? "opacity-100" : "opacity-0"}`}
        />

        {!live && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="max-w-xs text-sm text-white/80">
              {status === "connecting"
                ? "Waking up Sam, your student…"
                : status === "error"
                  ? statusDetail || "Could not connect to the avatar."
                  : "Sam is ready to learn. Teach the topic out loud."}
            </p>
            <button
              type="button"
              onClick={onConnect}
              disabled={status === "connecting"}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-5 text-sm font-bold text-white transition hover:bg-accent-strong disabled:opacity-70"
            >
              {status === "connecting" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />}
              {status === "error" ? "Try again" : "Start session"}
            </button>
          </div>
        )}

        <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold backdrop-blur ${
              live ? "bg-red-600/90 text-white" : "bg-white/15 text-white/80"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${live ? "animate-pulse bg-white" : "bg-white/50"}`} />
            {live ? "LIVE" : status === "connecting" ? "Connecting" : "Offline"}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-xs font-bold text-white/90 backdrop-blur">
            {live && !micBlocked ? <Mic className="h-3 w-3" /> : <MicOff className="h-3 w-3" />}
            {live && !micBlocked ? "Listening" : "Mic off"}
          </span>
        </div>

        {cueStyle && (
          <span
            key={cue}
            className={`absolute right-3 top-3 inline-flex animate-[pulse_1s_ease-out_1] items-center rounded-full px-3 py-1 text-xs font-bold shadow ${cueStyle.className}`}
            aria-live="polite"
          >
            {cueStyle.label}
          </span>
        )}

        {live && (
          <button
            type="button"
            onClick={onDisconnect}
            className="absolute bottom-3 right-3 inline-flex h-9 items-center gap-1.5 rounded-full bg-white/15 px-3 text-xs font-bold text-white backdrop-blur hover:bg-white/25"
          >
            <VideoOff className="h-3.5 w-3.5" /> End
          </button>
        )}
      </div>

      {micBlocked && (
        <p className="rounded-xl bg-partial-soft px-3 py-2 text-xs font-semibold text-partial" role="status">
          {statusDetail}
        </p>
      )}

      {children}

      <div className="flex min-h-64 flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-card lg:min-h-0">
        <div className="flex items-center justify-between border-b border-line px-4 py-2">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted">Conversation</h2>
          <span className="text-xs text-faint">{transcript.filter((l) => l.speaker !== "system").length} lines</span>
        </div>
        <div ref={listRef} className="min-h-24 flex-1 space-y-2 overflow-y-auto px-3 py-3" aria-live="polite">
          {transcript.length === 0 ? (
            <p className="text-sm text-muted">What you say appears here. No mic? Type your explanation below.</p>
          ) : (
            transcript.map((l) =>
              l.speaker === "system" ? (
                <p key={l.id} className="flex items-center justify-center gap-1.5 text-center text-[11px] font-bold text-parked">
                  <Clock3 className="h-3 w-3" /> {l.text}
                </p>
              ) : (
                <div key={l.id} className={`flex ${l.speaker === "student" ? "justify-end" : "justify-start"}`}>
                  <p
                    className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                      l.speaker === "student" ? "rounded-br-sm bg-accent text-white" : "rounded-bl-sm bg-canvas text-ink"
                    }`}
                  >
                    <span className={`mr-1.5 text-[10px] font-bold tabular-nums ${l.speaker === "student" ? "text-white/70" : "text-faint"}`}>{l.t}</span>
                    {l.text}
                  </p>
                </div>
              ),
            )
          )}
        </div>
        <form
          className="flex items-end gap-2 border-t border-line p-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label className="min-w-0 flex-1">
            <span className="sr-only">Type part of your explanation</span>
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
              className="block max-h-28 min-h-11 w-full resize-none rounded-xl border border-line bg-canvas px-3 py-2.5 text-sm outline-none placeholder:text-faint focus:border-accent"
            />
          </label>
          <button
            type="submit"
            disabled={!draft.trim()}
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-white transition hover:bg-accent-strong disabled:opacity-40"
            aria-label="Send"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>
    </section>
  );
}
