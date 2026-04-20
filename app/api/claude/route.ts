import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const CLAUDE_MODEL = "claude-sonnet-4-20250514";

function tryParseJson(raw: string): unknown {
  let s = raw.replace(/```json\s*|\s*```/g, "").trim();
  const match = s.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (match) s = match[0];

  try {
    return JSON.parse(s);
  } catch {}

  const repaired = s
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/,(\s*[}\]])/g, "$1")
    .replace(/[\u0000-\u0008\u000B-\u001F]/g, " ");

  try {
    return JSON.parse(repaired);
  } catch {}

  try {
    return JSON.parse(escapeInnerQuotes(repaired));
  } catch (e) {
    const err = e as Error;
    const pos = (err.message.match(/position (\d+)/) || [])[1];
    const snippet = pos
      ? repaired.slice(Math.max(0, +pos - 60), +pos + 60)
      : repaired.slice(0, 300);
    throw new Error(`JSON parse failed: ${err.message}\n...${snippet}...`);
  }
}

function escapeInnerQuotes(s: string): string {
  let out = "";
  let inString = false;
  let escape = false;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escape) {
      out += c;
      escape = false;
      continue;
    }
    if (c === "\\") {
      out += c;
      escape = true;
      continue;
    }
    if (c === '"') {
      if (!inString) {
        inString = true;
        out += c;
        continue;
      }
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j])) j++;
      const next = s[j] as string | undefined;
      if (
        next === "," ||
        next === "}" ||
        next === "]" ||
        next === ":" ||
        next === undefined
      ) {
        inString = false;
        out += c;
      } else {
        out += '\\"';
      }
      continue;
    }
    out += c;
  }
  return out;
}

export async function POST(req: NextRequest) {
  try {
    const { prompt, system, jsonMode } = await req.json();

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY is not configured" },
        { status: 500 }
      );
    }

    const body: Record<string, unknown> = {
      model: CLAUDE_MODEL,
      max_tokens: 4000,
      temperature: 1,
      top_p: 0.95,
      messages: [{ role: "user", content: prompt }],
    };
    if (system) body.system = system;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    const rawText = await res.text();
    if (!res.ok) {
      return NextResponse.json(
        { error: `Anthropic API error ${res.status}: ${rawText.slice(0, 200)}` },
        { status: 500 }
      );
    }

    let data: {
      error?: { message?: string };
      content?: { type: string; text: string }[];
    };
    try {
      data = JSON.parse(rawText);
    } catch {
      return NextResponse.json(
        { error: `Unexpected response from Anthropic: ${rawText.slice(0, 200)}` },
        { status: 500 }
      );
    }

    if (data.error) {
      return NextResponse.json(
        { error: data.error.message || JSON.stringify(data.error) },
        { status: 500 }
      );
    }

    const text = (data.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    if (jsonMode) {
      const parsed = tryParseJson(text);
      return NextResponse.json({ result: parsed });
    }

    return NextResponse.json({ result: text });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
