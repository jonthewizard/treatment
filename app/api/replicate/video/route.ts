import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Kling Video 3.0 Omni — unified multimodal video model with reference-image
// support and native multi-shot control.
// https://replicate.com/kwaivgi/kling-v3-omni-video
const KLING_MODEL = "kwaivgi/kling-v3-omni-video";

// Kling multi-shot: each group's shots are sent as a JSON array in
// `multi_prompt` (≤6 shots). For groups with >6 shots we fall back to a
// single prose `prompt` + explicit `duration`. The per-shot duration values
// are pulled from each Shot's `duration` field (clamped ≥1s).
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

  if (shots && shots.length > 0) {
    input.multi_prompt = JSON.stringify(shots);
    // Kling requires a top-level duration ≥ every individual shot duration.
    // Sum the shot durations (group total) and clamp to Kling's 5–15s range.
    const shotTotal = shots.reduce((s, sh) => s + sh.duration, 0);
    input.duration = Math.max(5, Math.min(15, shotTotal));
    // Include the fallback prompt as scene context — omit if not provided.
    if (prompt && prompt.trim()) {
      input.prompt = prompt.trim();
    }
  } else {
    // Single-prompt mode: fall back to full 15s clip.
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
