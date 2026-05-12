import { useCallback, useEffect, useRef, useState } from "react";

export type MediaStatus =
  | "idle"
  | "starting"
  | "processing"
  | "succeeded"
  | "failed";

// Back-compat alias.
export type VideoStatus = MediaStatus;

export interface MediaState {
  url: string;
  predictionId: string;
}

interface StartResponse {
  id: string;
  status: MediaStatus;
}

interface PollResponse {
  id: string;
  status: MediaStatus;
  output: string | null;
  error: string | null;
}

const POLL_INTERVAL_MS = 3000;
// 15 minutes hard cap. Catches runaway cases where Replicate never returns
// a terminal state.
const POLL_MAX_ATTEMPTS = (15 * 60_000) / POLL_INTERVAL_MS;

interface StartOpts {
  endpoint: string;
  body: Record<string, unknown>;
}

async function startPrediction({
  endpoint,
  body,
}: StartOpts): Promise<StartResponse> {
  const res = await fetch(endpoint, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

async function getPrediction(
  endpoint: string,
  id: string
): Promise<PollResponse> {
  const res = await fetch(`${endpoint}?id=${encodeURIComponent(id)}`, {
    method: "GET",
    cache: "no-store",
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

interface UsePredictionOptions {
  endpoint: string;
  initial?: MediaState | null;
  onPersist?: (state: MediaState | null) => void;
  onProcessing?: (predictionId: string) => void;
}

// Generic Replicate prediction lifecycle: hold the latest output, expose
// generate/reset, and poll until terminal. The caller controls the request
// shape via the `body` argument to `generate`, so the same hook backs both
// Nano Banana 2 stills and Kling Video 3.0 Omni generations.
function usePrediction({
  endpoint,
  initial,
  onPersist,
  onProcessing,
}: UsePredictionOptions) {
  const [status, setStatus] = useState<MediaStatus>(
    initial ? "succeeded" : "idle"
  );
  const [url, setUrl] = useState<string | null>(initial?.url ?? null);
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
        const res = await getPrediction(endpoint, id);
        if (cancelledRef.current) return;

        if (res.status === "succeeded" && res.output) {
          setStatus("succeeded");
          setUrl(res.output);
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
    [endpoint, onPersist]
  );

  const generate = useCallback(
    async (body: Record<string, unknown>) => {
      clearTimer();
      cancelledRef.current = false;
      setStatus("starting");
      setError(null);
      setUrl(null);
      try {
        const res = await startPrediction({ endpoint, body });
        onProcessing?.(res.id);
        poll(res.id, 0);
      } catch (e) {
        setStatus("failed");
        setError((e as Error).message);
      }
    },
    [endpoint, onProcessing, poll]
  );

  const reset = useCallback(() => {
    clearTimer();
    cancelledRef.current = true;
    setStatus("idle");
    setUrl(null);
    setError(null);
    onPersist?.(null);
    cancelledRef.current = false;
  }, [onPersist]);

  return { status, url, error, generate, reset };
}

interface UseGroupVideoOptions {
  initial?: MediaState | null;
  onPersist?: (state: MediaState | null) => void;
  onProcessing?: (predictionId: string) => void;
}

export interface KlingShot {
  prompt: string;
  duration: number;
}

// One Kling Video 3.0 Omni generation lifecycle per group.
// - `shots`: array of per-shot {prompt, duration} for multi-shot mode (≤6).
//   When provided the API sends them as Kling's `multi_prompt` JSON array.
// - `prompt`: fallback single prose prompt used when shots > 6 or omitted.
// - `startImageUrl`: first frame (Kling `start_image`). Can be used alongside
//   reference_images (unlike Seedance where they were mutually exclusive).
// - `referenceImages`: portrait URLs. Kling binds them via <<<image_N>>>
//   markers in the prompt/shots text.
export function useGroupVideo(opts: UseGroupVideoOptions = {}) {
  const { status, url, error, generate, reset } = usePrediction({
    endpoint: "/api/replicate/video",
    ...opts,
  });

  const generateVideo = useCallback(
    (
      prompt: string,
      shots?: KlingShot[] | null,
      startImageUrl?: string | null,
      referenceImages?: string[] | null
    ) => {
      const body: Record<string, unknown> = { prompt };
      if (shots && shots.length > 0) {
        body.shots = shots;
      }
      if (referenceImages && referenceImages.length > 0) {
        body.reference_images = referenceImages;
      }
      if (startImageUrl) {
        body.start_image = startImageUrl;
      }
      return generate(body);
    },
    [generate]
  );

  return {
    status,
    videoUrl: url,
    error,
    generate: generateVideo,
    reset,
  };
}

interface UseGroupImageOptions {
  initial?: MediaState | null;
  onPersist?: (state: MediaState | null) => void;
  onProcessing?: (predictionId: string) => void;
}

// One Nano Banana 2 still generation lifecycle. Backs both per-group first
// frames (16:9, the API default) and character portraits (caller passes
// "9:16" so the reference captures wardrobe head-to-knee). The supported
// aspect ratio enum is enforced server-side in /api/replicate/image.
export function useGroupImage(opts: UseGroupImageOptions = {}) {
  const { status, url, error, generate, reset } = usePrediction({
    endpoint: "/api/replicate/image",
    ...opts,
  });

  const generateImage = useCallback(
    (prompt: string, aspectRatio?: string, referenceImages?: string[] | null) => {
      const body: Record<string, unknown> = { prompt };
      if (aspectRatio) body.aspectRatio = aspectRatio;
      if (referenceImages && referenceImages.length > 0)
        body.referenceImages = referenceImages;
      return generate(body);
    },
    [generate]
  );

  return {
    status,
    imageUrl: url,
    error,
    generate: generateImage,
    reset,
  };
}
