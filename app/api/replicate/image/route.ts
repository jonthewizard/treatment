import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Nano Banana 2 — Google's Gemini 3.1 Flash Image model.
// Fast, high-quality text-to-image with multi-image reference support.
// https://replicate.com/google/nano-banana-2
const NANO_BANANA_MODEL = "google/nano-banana-2";

// Locked defaults for treatment stills (portrait references and per-group
// first frames). 2K resolution balances quality and generation speed.
const NANO_BANANA_DEFAULTS = {
  resolution: "2K",
  output_format: "jpg",
} as const;

// Valid aspect_ratio values for Nano Banana 2.
const SUPPORTED_ASPECT_RATIOS = new Set([
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "9:16",
  "16:9",
  "21:9",
]);
const DEFAULT_ASPECT_RATIO = "16:9";

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
  let aspectRatioRaw: unknown;
  let referenceImages: string[] | undefined;
  try {
    const body = await req.json();
    prompt = body?.prompt;
    aspectRatioRaw = body?.aspectRatio;
    referenceImages = Array.isArray(body?.referenceImages)
      ? body.referenceImages.filter((u: unknown) => typeof u === "string")
      : undefined;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }

  let aspect_ratio = DEFAULT_ASPECT_RATIO;
  if (aspectRatioRaw !== undefined && aspectRatioRaw !== null) {
    if (
      typeof aspectRatioRaw !== "string" ||
      !SUPPORTED_ASPECT_RATIOS.has(aspectRatioRaw)
    ) {
      return NextResponse.json(
        {
          error: `aspectRatio must be one of: ${Array.from(
            SUPPORTED_ASPECT_RATIOS
          ).join(", ")}`,
        },
        { status: 400 }
      );
    }
    aspect_ratio = aspectRatioRaw;
  }

  const res = await fetch(
    `https://api.replicate.com/v1/models/${NANO_BANANA_MODEL}/predictions`,
    {
      method: "POST",
      cache: "no-store",
      headers: authHeaders(token),
      body: JSON.stringify({
        input: {
          prompt,
          aspect_ratio,
          ...NANO_BANANA_DEFAULTS,
          ...(referenceImages && referenceImages.length > 0
            ? { image_input: referenceImages.slice(0, 14) }
            : {}),
        },
      }),
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
