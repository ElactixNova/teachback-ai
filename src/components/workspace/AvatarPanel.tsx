"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Clock3, Download, Frown, LoaderCircle, Mic, MicOff, PenLine, Smile, Sparkle, Video, VideoOff, type LucideIcon } from "lucide-react";
import type { Cue } from "@/types/session";
import { ANAM_VIDEO_ID, type AvatarStatus, type Speaker, type TranscriptLine } from "./types";
import { SpokenMath } from "./MathText";
import { cleanSamLine } from "./transcriptClean";

/** Sam's mood badge (Figma: Mood Badge 5:77): always icon + words, never colour alone. */
const CUE_STYLE: Record<Cue, { label: string; className: string; Icon: LucideIcon }> = {
  happy: { label: "Following you", className: "text-good", Icon: Smile },
  curious: { label: "Curious", className: "text-[#1f6fd1]", Icon: Sparkle },
  concerned: { label: "Not sure about that", className: "text-partial", Icon: Frown },
  surprised: { label: "Surprised", className: "text-[#7a3fd1]", Icon: Sparkle },
};

/** Tallest the composer grows before it scrolls (about four lines). */
const COMPOSER_MAX_PX = 112;

/** A line still being spoken (T28): shown as one bubble updated in place, then replaced by the finished line. */
export interface LiveLine {
  id: string;
  speaker: Speaker;
  /** The whole line so far (raw). */
  text: string;
  t: string;
}

/** How close to the bottom (px) still counts as "reading the latest line", so new text scrolls into view. */
const STICK_PX = 48;

/** Detail strings from the bridge that mean "live, but the mic is blocked". */
const MIC_BLOCKED = /microphone/i;

interface Props {
  status: AvatarStatus;
  statusDetail?: string;
  cue: Cue | null;
  transcript: TranscriptLine[];
  /** Lines still being spoken (display only). */
  liveLines?: LiveLine[];
  /** Save the raw transcript as a .txt. */
  onDownloadTranscript?: () => void;
  onConnect: () => void;
  /** Why Sam cannot join yet (no lecture notes or no mark scheme): the start button is off and says so. */
  startBlockedReason?: string;
  onDisconnect: () => void;
  /** Typed fallback: lets the demo work without a mic or live avatar. */
  onTypedLine: (text: string) => void;
  /** Extra content under the video (e.g. the end-screen "Try it now" card). */
  children?: React.ReactNode;
  /** The student is writing or drawing on the board right now: Sam waits quietly (persona rule), and the UI says so. */
  waiting?: boolean;
}

export function AvatarPanel({ status, statusDetail, cue, transcript, liveLines = [], onDownloadTranscript, onConnect, startBlockedReason, onDisconnect, onTypedLine, children, waiting = false }: Props) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Grow the composer with wrapped text (up to COMPOSER_MAX_PX), so the first line never scrolls out of view.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    // border-box: the height includes the border, scrollHeight does not.
    const full = el.scrollHeight + el.offsetHeight - el.clientHeight;
    el.style.height = `${Math.min(full, COMPOSER_MAX_PX)}px`;
    el.style.overflowY = full > COMPOSER_MAX_PX ? "auto" : "hidden";
  }, [draft]);
  const isLive = status === "live";
  const micBlocked = isLive && !!statusDetail && MIC_BLOCKED.test(statusDetail);


  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    onTypedLine(text);
    setDraft("");
  };

  const cueStyle = cue ? CUE_STYLE[cue] : null;
  // What the chat shows: Sam's lines without prompt markers or talk of the machinery (display only, the raw
  // transcript is unchanged); a Sam line with nothing conversational left is hidden. Student lines as said.
  const shown = useMemo(
    () =>
      transcript.flatMap((l) => {
        if (l.speaker !== "avatar") return [{ ...l, display: l.text }];
        const display = cleanSamLine(l.text);
        return display ? [{ ...l, display }] : [];
      }),
    [transcript],
  );
  // Live lines go through the same filter. A live line whose finished version is already in the list is skipped.
  const live = useMemo(() => {
    const done = new Set(transcript.map((l) => l.id));
    return liveLines.flatMap((l) => {
      if (done.has(l.id)) return [];
      const display = l.speaker === "avatar" ? cleanSamLine(l.text) : l.text.trim();
      return display ? [{ ...l, display }] : [];
    });
  }, [liveLines, transcript]);

  // Follow new text only while the reader is at the bottom: scrolling up to reread is never yanked back.
  const atBottom = useRef(true);
  const liveText = live.map((l) => l.display).join("\n");
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [shown.length, liveText]);
  const lineCount = shown.filter((l) => l.speaker !== "system").length;
  // One list, so a live bubble and its finished line share a key and React updates it in place (no remount, no flicker).
  const items = useMemo(() => [...shown.map((l) => ({ ...l, streaming: false })), ...live.map((l) => ({ ...l, streaming: true }))], [shown, live]);

  return (
    <section aria-label="Your AI student" className="sheet flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className="relative aspect-[4/3] w-full shrink-0 overflow-hidden rounded-lg bg-stage lg:aspect-video">
        <video
          id={ANAM_VIDEO_ID}
          autoPlay
          playsInline
          className={`h-full w-full object-cover transition-opacity ${isLive ? "opacity-100" : "opacity-0"}`}
        />

        {!isLive && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 pt-6 text-center">
            <p className="max-w-xs text-sm text-white/80">
              {status === "connecting"
                ? "Waking up Sam, your student…"
                : status === "error"
                  ? statusDetail || "Could not connect to the avatar."
                  : startBlockedReason ?? "Sam joins when you start the session."}
            </p>
            <button
              type="button"
              onClick={onConnect}
              disabled={status === "connecting" || !!startBlockedReason}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-white transition hover:bg-accent-strong disabled:opacity-50"
            >
              {status === "connecting" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />}
              {status === "error" ? "Try again" : "Start session"}
            </button>
          </div>
        )}

        <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold backdrop-blur ${
              isLive ? "bg-live text-white" : "bg-white/15 text-white/80"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${isLive ? "animate-pulse bg-white" : "bg-white/50"}`} />
            {isLive ? "LIVE" : status === "connecting" ? "Connecting" : "Offline"}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold text-white/90 backdrop-blur">
            {isLive && waiting ? <PenLine className="h-3 w-3" /> : isLive && !micBlocked ? <Mic className="h-3 w-3" /> : <MicOff className="h-3 w-3" />}
            {isLive && waiting ? "Waiting while you write" : isLive && !micBlocked ? "Listening" : "Mic off"}
          </span>
        </div>

        {cueStyle && (
          <span
            key={cue}
            className={`absolute right-3 top-3 inline-flex animate-[pulse_1s_ease-out_1] items-center gap-1.5 rounded-full bg-card px-3 py-1 text-sm font-semibold shadow-[var(--shadow-1)] ${cueStyle.className}`}
            aria-live="polite"
          >
            <cueStyle.Icon className="h-4 w-4" aria-hidden />
            {cueStyle.label}
          </span>
        )}

        <p className="pointer-events-none absolute bottom-3 left-3 text-sm text-white/85">
          <span className="font-semibold text-white">Sam</span> · AI student
        </p>

        {isLive && (
          <button
            type="button"
            onClick={onDisconnect}
            className="absolute bottom-3 right-3 inline-flex h-9 items-center gap-1.5 rounded-full border border-white/40 bg-black/30 px-3.5 text-sm font-semibold text-white backdrop-blur hover:bg-black/50"
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

      <div className="flex min-h-64 flex-1 flex-col overflow-hidden lg:min-h-0">
        <div className="flex items-center gap-2 px-2 pb-1">
          <h2 className="text-base font-semibold tracking-[-0.01em]">Transcript</h2>
          <span className="ml-auto text-xs text-faint">{isLive ? "Sam is listening" : transcript.length ? `${lineCount} ${lineCount === 1 ? "line" : "lines"}` : "Not started"}</span>
          {onDownloadTranscript && lineCount > 0 && (
            <button
              type="button"
              onClick={onDownloadTranscript}
              className="-mr-1 inline-flex h-8 w-8 items-center justify-center rounded-full text-faint transition hover:bg-sunk hover:text-ink"
              aria-label="Download transcript (.txt)"
              title="Download transcript (.txt)"
            >
              <Download className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>
        <div
          ref={listRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_PX;
          }}
          className="min-h-24 flex-1 space-y-2 overflow-y-auto px-2 py-2"
          aria-live="polite"
        >
          {items.length === 0 ? (
            <p className="text-sm text-muted">Start the session and explain the idea to Sam in your own words. You can also type here.</p>
          ) : (
            items.map((l) =>
              l.speaker === "system" ? (
                <p key={l.id} className="flex items-center justify-center gap-1.5 text-center text-[11px] font-semibold text-parked">
                  <Clock3 className="h-3 w-3" /> {l.text}
                </p>
              ) : (
                // A line still being spoken is hidden from screen readers: they hear it once, when it is finished.
                <div key={l.id} className={`flex flex-col ${l.speaker === "student" ? "items-end" : "items-start"}`} aria-hidden={l.streaming || undefined} data-streaming={l.streaming || undefined}>
                  <span className="px-1 pb-1 text-xs text-faint">{l.speaker === "student" ? "You" : "Sam"}</span>
                  <p
                    className={`max-w-[88%] rounded-lg px-3.5 py-2.5 text-[15px] leading-6 ${
                      l.speaker === "student" ? "bg-ink text-white" : "bg-sunk text-ink"
                    }`}
                  >
                    <span className={`mr-1.5 text-[10px] font-semibold tabular-nums ${l.speaker === "student" ? "text-white/70" : "text-faint"}`}>{l.t}</span>
                    <SpokenMath text={l.display} streaming={l.streaming} />
                    {l.streaming && <span className="ml-1 inline-block h-3.5 w-[3px] translate-y-0.5 animate-pulse rounded-full bg-current opacity-50" aria-hidden />}
                  </p>
                </div>
              ),
            )
          )}
        </div>
        <form
          className="flex items-end gap-2 px-1 pb-1 pt-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label className="min-w-0 flex-1">
            <span className="sr-only">Type part of your explanation</span>
            <textarea
              ref={inputRef}
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
              className="block min-h-11 w-full resize-none overflow-y-hidden rounded-[22px] border border-line-strong bg-card px-4 py-2.5 text-sm leading-5 outline-none placeholder:text-faint"
            />
          </label>
          <button
            type="submit"
            disabled={!draft.trim()}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-accent text-white transition hover:bg-accent-strong disabled:opacity-40"
            aria-label="Send to Sam"
          >
            <ArrowRight className="h-4 w-4" />
          </button>
        </form>
      </div>
    </section>
  );
}
