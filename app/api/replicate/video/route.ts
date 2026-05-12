import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Kling Video 3.0 Omni — unified multimodal video model with reference-image
// support and native multi-shot control.
// https://replicate.com/kwaivgi/kling-v3-omni-video
const KLING_MODEL = "kwaivgi/kling-v3-omni-video";

// Kling routing:
// - 2–6 shots: send as JSON array in `multi_prompt`. Top-level `duration` is
//   the sum of per-shot durations (clamped 3–15s). Each per-shot prompt
//   string is capped at 512 chars by Kling, so this path is reserved for the
//   shorter "groups" mode prompts.
// - 1 shot (detailed mode, or any single-shot group): use single-prompt mode
//   with the shot's own duration (3–15s). Single `prompt` accepts the much
//   longer dense cinematographic prose without the 512-char per-shot cap.
// - 0 shots / >6 shots: fall back to the prose `prompt` + fixed 15s clip.
// Reference images use the <<<image_N>>> syntax in prompt text — Kling
// matches the Nth image in the `reference_images` array to each marker.
const KLING_DEFAULTS = {
  mode: "standard", // 720p — sufficient for treatment previews
  aspect_ratio: "16:9",
  generate_audio: false,
} as const;

interface KlingShot {
  prompt: string;
  duration: number;
}

interface ReplicatePrediction {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output?: string | string[] | null;
  error?: string | null;
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function pickOutputUrl(output: ReplicatePrediction["output"]): string | null {
  if (!output) return null;
  if (typeof output === "string") return output;
  if (Array.isArray(output) && typeof output[0] === "string") return output[0];
  return null;
}

export async function POST(req: NextRequest) {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "REPLICATE_API_TOKEN is not configured" },
      { status: 500 }
    );
  }

  let prompt: string | undefined;
  let shots: KlingShot[] | undefined;
  let startImage: string | undefined;
  let referenceImages: string[] = [];

  try {
    const body = await req.json();
    prompt = body?.prompt;
    if (Array.isArray(body?.shots)) {
      shots = (body.shots as unknown[])
        .filter(
          (s): s is KlingShot =>
            s !== null &&
            typeof s === "object" &&
            typeof (s as KlingShot).prompt === "string" &&
            typeof (s as KlingShot).duration === "number"
        )
        .slice(0, 6); // Kling multi-shot cap
    }
    if (typeof body?.start_image === "string" && body.start_image.trim()) {
      startImage = body.start_image.trim();
    }
    if (Array.isArray(body?.reference_images)) {
      referenceImages = (body.reference_images as unknown[])
        .filter((u): u is string => typeof u === "string" && !!u.trim())
        .map((u) => u.trim())
        .slice(0, 7); // Kling reference_images cap
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // At least one of prompt or shots is required
  if (
    (!prompt || typeof prompt !== "string" || !prompt.trim()) &&
    (!shots || shots.length === 0)
  ) {
    return NextResponse.json(
      { error: "prompt or shots is required" },
      { status: 400 }
    );
  }

  const input: Record<string, unknown> = { ...KLING_DEFAULTS };

  const clampDuration = (n: number) => Math.max(3, Math.min(15, n));

  if (shots && shots.length === 1) {
    // Detailed-shot mode (or any single-shot group). Use single-prompt mode
    // so the dense cinematographic prose isn't capped at Kling's 512-char
    // per-shot limit. Prefer the group prompt (it wraps the shot with the
    // CAST/LOCATIONS block) but fall back to the shot prompt itself.
    const groupPrompt = prompt && prompt.trim() ? prompt.trim() : "";
    input.prompt = groupPrompt || shots[0].prompt;
    input.duration = clampDuration(shots[0].duration);
  } else if (shots && shots.length > 1) {
    // True multi-shot group: use Kling's multi_prompt array.
    input.multi_prompt = JSON.stringify(shots);
    const shotTotal = shots.reduce((s, sh) => s + sh.duration, 0);
    input.duration = clampDuration(shotTotal);
    if (prompt && prompt.trim()) {
      input.prompt = prompt.trim();
    }
  } else {
    // Plain prose prompt with no shot breakdown — default to a 15s clip.
    input.prompt = (prompt as string).trim();
    input.duration = 15;
  }

  if (referenceImages.length > 0) {
    input.reference_images = referenceImages;
  }

  if (startImage) {
    input.start_image = startImage;
  }

  const res = await fetch(
    `https://api.replicate.com/v1/models/${KLING_MODEL}/predictions`,
    {
      method: "POST",
      cache: "no-store",
      headers: authHeaders(token),
      body: JSON.stringify({ input }),
    }
  );

  const text = await res.text();
  if (!res.ok) {
    return NextResponse.json(
      { error: `Replicate ${res.status}: ${text.slice(0, 300)}` },
      { status: 500 }
    );
  }

  let data: ReplicatePrediction;
  try {
    data = JSON.parse(text);
  } catch {
    return NextResponse.json(
      { error: `Unexpected response from Replicate: ${text.slice(0, 200)}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ id: data.id, status: data.status });
}

export async function GET(req: NextRequest) {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "REPLICATE_API_TOKEN is not configured" },
      { status: 500 }
    );
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json(
      { error: "id query parameter is required" },
      { status: 400 }
    );
  }

  const res = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
    method: "GET",
    cache: "no-store",
    headers: authHeaders(token),
  });

  const text = await res.text();
  if (!res.ok) {
    return NextResponse.json(
      { error: `Replicate ${res.status}: ${text.slice(0, 300)}` },
      { status: 500 }
    );
  }

  let data: ReplicatePrediction;
  try {
    data = JSON.parse(text);
  } catch {
    return NextResponse.json(
      { error: `Unexpected response from Replicate: ${text.slice(0, 200)}` },
      { status: 500 }
    );
  }

  return NextResponse.json({
    id: data.id,
    status: data.status,
    output: pickOutputUrl(data.output),
    error: data.error ?? null,
  });
}
