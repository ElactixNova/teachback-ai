// Live-analysis scheduler (T11). Framework-free so the hook stays thin.
// poke() after each new student line; the loop waits for a short pause, runs at most one analysis at a
// time, spaces runs out, and runs once more afterwards if new lines arrived while it was busy.

export interface LiveLoopOptions {
  /** One live analysis; abort when the signal fires. */
  run: (signal: AbortSignal) => Promise<void>;
  onError?: (e: unknown) => void;
  /** Wait this long after the last poke before running (the student is mid-sentence). */
  quietMs?: number;
  /** At least this long between the starts of two runs. */
  minIntervalMs?: number;
}

export interface LiveLoop {
  poke: () => void;
  /** Run as soon as allowed, ignoring the quiet period (e.g. the avatar asked for the status). */
  flush: () => Promise<void>;
  stop: () => void;
  readonly busy: boolean;
}

export function createLiveLoop({ run, onError, quietMs = 2500, minIntervalMs = 10_000 }: LiveLoopOptions): LiveLoop {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inflight: Promise<void> | null = null;
  let controller: AbortController | null = null;
  let dirty = false;
  let lastStart = 0;
  let stopped = false;

  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const start = (): Promise<void> => {
    clear();
    if (stopped) return Promise.resolve();
    if (inflight) return inflight;
    dirty = false;
    lastStart = Date.now();
    controller = new AbortController();
    inflight = run(controller.signal)
      .catch((e) => {
        if (!(e instanceof DOMException && e.name === "AbortError")) onError?.(e);
      })
      .finally(() => {
        inflight = null;
        controller = null;
        if (dirty && !stopped) schedule(0);
      });
    return inflight;
  };

  const schedule = (wait: number) => {
    clear();
    const spacing = Math.max(0, lastStart + minIntervalMs - Date.now());
    timer = setTimeout(start, Math.max(wait, spacing));
  };

  return {
    poke() {
      if (stopped) return;
      dirty = true;
      if (!inflight) schedule(quietMs);
    },
    flush() {
      if (inflight) return inflight;
      return start();
    },
    stop() {
      stopped = true;
      clear();
      controller?.abort();
    },
    get busy() {
      return !!inflight;
    },
  };
}
