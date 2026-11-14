// Placeholder AvatarBridge used until T2 ships the real Anam integration in src/lib/anam.
// It only checks that /api/anam-session answers, then reports that the avatar is not wired yet.
import type { AnamSessionResponse } from "@/types/session";
import type { AvatarBridge } from "./types";

export const stubAvatarBridge: AvatarBridge = {
  async connect({ handlers }) {
    handlers.onStatus("connecting");
    try {
      const res = await fetch("/api/anam-session", { method: "POST" });
      if (!res.ok) throw new Error(`Session route failed (${res.status})`);
      const { sessionToken } = (await res.json()) as AnamSessionResponse;
      if (!sessionToken) throw new Error("No session token");
      handlers.onStatus("error", "Avatar not wired yet (T2). Type your explanation below.");
    } catch (e) {
      handlers.onStatus("error", e instanceof Error ? e.message : "Could not reach the avatar");
    }
    return { disconnect: () => handlers.onStatus("idle") };
  },
};
