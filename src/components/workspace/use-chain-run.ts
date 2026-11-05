"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { advanceRun, startRun } from "@/lib/runs/actions";
import { applyAdvance, failLiveRun, markIncomplete, markStarted, startLiveRun, type LiveRun } from "@/lib/runs/live-run";
import type { PreparedImage } from "@/lib/runs/prepare-image";

const BUSY_RETRY_MS = 1_500;
const BUSY_GIVE_UP_MS = 90_000;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type RunRequest = { image: PreparedImage | null; text: string };

export function useChainRun(chainId: string, stepCount: number) {
  const router = useRouter();
  const [live, setLive] = useState<LiveRun | null>(null);
  const inFlight = useRef(false);

  async function loop(runId: string) {
    let busySince: number | null = null;
    for (;;) {
      const response = await advanceRun(runId);
      if (!response.ok) return setLive((l) => l && failLiveRun(l, response.error));
      const result = response.data;
      if (result.state === "busy") {
        busySince ??= Date.now();
        if (Date.now() - busySince > BUSY_GIVE_UP_MS) return setLive((l) => l && markIncomplete(l));
        await wait(BUSY_RETRY_MS);
        continue;
      }
      busySince = null;
      setLive((l) => l && applyAdvance(l, result));
      if (result.state !== "running") return;
    }
  }

  async function start({ image, text }: RunRequest) {
    if (inFlight.current) return;
    inFlight.current = true;
    setLive(startLiveRun(stepCount, {
      text: text.trim() || null, previewUrl: image?.previewUrl ?? null, width: image?.width ?? null, height: image?.height ?? null,
    }));
    try {
      const formData = new FormData();
      formData.set("text", text);
      if (image) {
        formData.set("image", image.blob, "input.jpg");
        formData.set("width", String(image.width));
        formData.set("height", String(image.height));
      }
      const started = await startRun(chainId, formData);
      if (!started.ok) return setLive((l) => l && failLiveRun(l, started.error));
      setLive((l) => l && markStarted(l, started.data.runId));
      await loop(started.data.runId);
      router.refresh();
    } catch (error) {
      console.error("[run] client loop failed", error);
      setLive((l) => l && failLiveRun(l, "The connection dropped. Check the media page for this run's state."));
    } finally {
      inFlight.current = false;
    }
  }

  const running = live?.state === "starting" || live?.state === "running";
  return { live, running, start, clear: () => setLive(null) };
}
