import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SEEDANCE_MODEL = "bytedance/seedance-2.0";

// Locked Seedance 2.0 inputs for treatment scratch videos. Exported via the
// request shape rather than configured per call so the UI can't drift.
const SEEDANCE_DEFAULTS = {
  duration: 15,
  resolution: "480p",
  aspect_ratio: "16:9",
  generate_audio: false,
} as const;

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
  try {
    const body = await req.json();
    prompt = body?.prompt;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    return NextResponse.json(
      { error: "prompt is required" },
      { status: 400 }
    );
  }

  const res = await fetch(
    `https://api.replicate.com/v1/models/${SEEDANCE_MODEL}/predictions`,
    {
      method: "POST",
      cache: "no-store",
      headers: authHeaders(token),
      body: JSON.stringify({
        input: {
          prompt,
          ...SEEDANCE_DEFAULTS,
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
