import { useCallback, useEffect, useRef, useState } from "react";

export type VideoStatus =
  | "idle"
  | "starting"
  | "processing"
  | "succeeded"
  | "failed";

export interface VideoState {
  url: string;
  predictionId: string;
}

interface StartResponse {
  id: string;
  status: VideoStatus;
}

interface PollResponse {
  id: string;
  status: VideoStatus;
  output: string | null;
  error: string | null;
}

async function startSeedanceVideo(prompt: string): Promise<StartResponse> {
  const res = await fetch("/api/replicate/video", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

async function getSeedanceVideo(id: string): Promise<PollResponse> {
  const res = await fetch(
    `/api/replicate/video?id=${encodeURIComponent(id)}`,
    { method: "GET", cache: "no-store" }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

const POLL_INTERVAL_MS = 3000;
// 15 minutes hard cap. Seedance 2.0 480p/15s typically completes in 1-3 min;
// this catches runaway cases where Replicate never returns a terminal state.
const POLL_MAX_ATTEMPTS = (15 * 60_000) / POLL_INTERVAL_MS;

interface UseGroupVideoOptions {
  initial?: VideoState | null;
  onPersist?: (state: VideoState | null) => void;
  onProcessing?: (predictionId: string) => void;
}

// One generation lifecycle per group: hold the current prompt, expose start
// and reset, and poll Replicate until a terminal status is reached. Caller
// supplies the latest prompt at call time so user edits propagate.
export function useGroupVideo({
  initial,
  onPersist,
  onProcessing,
}: UseGroupVideoOptions = {}) {
  const [status, setStatus] = useState<VideoStatus>(
    initial ? "succeeded" : "idle"
  );
  const [videoUrl, setVideoUrl] = useState<string | null>(initial?.url ?? null);
  const [error, setError] = useState<string | null>(null);

  const cancelledRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      clearTimer();
    };
  }, []);

  const poll = useCallback(
    async (id: string, attempt: number) => {
      if (cancelledRef.current) return;
      if (attempt > POLL_MAX_ATTEMPTS) {
        setStatus("failed");
        setError("Timed out waiting for Replicate (15 min cap)");
        return;
      }
      try {
        const res = await getSeedanceVideo(id);
        if (cancelledRef.current) return;

        if (res.status === "succeeded" && res.output) {
          setStatus("succeeded");
          setVideoUrl(res.output);
          setError(null);
          onPersist?.({ url: res.output, predictionId: id });
          return;
        }
        if (res.status === "failed") {
          setStatus("failed");
          setError(res.error || "Generation failed");
          return;
        }

        setStatus(res.status === "starting" ? "starting" : "processing");
        timerRef.current = setTimeout(
          () => poll(id, attempt + 1),
          POLL_INTERVAL_MS
        );
      } catch (e) {
        if (cancelledRef.current) return;
        setStatus("failed");
        setError((e as Error).message);
      }
    },
    [onPersist]
  );

  const generate = useCallback(
    async (prompt: string) => {
      clearTimer();
      cancelledRef.current = false;
      setStatus("starting");
      setError(null);
      setVideoUrl(null);
      try {
        const res = await startSeedanceVideo(prompt);
        onProcessing?.(res.id);
        poll(res.id, 0);
      } catch (e) {
        setStatus("failed");
        setError((e as Error).message);
      }
    },
    [onProcessing, poll]
  );

  const reset = useCallback(() => {
    clearTimer();
    cancelledRef.current = true;
    setStatus("idle");
    setVideoUrl(null);
    setError(null);
    onPersist?.(null);
    cancelledRef.current = false;
  }, [onPersist]);

  return { status, videoUrl, error, generate, reset };
}
