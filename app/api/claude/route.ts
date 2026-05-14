import { NextRequest, NextResponse } from "next/server";
import { jsonrepair } from "jsonrepair";

export const dynamic = "force-dynamic";
// 300s is the hard ceiling on Vercel Hobby (Pro allows 800s, Enterprise
// 900s — bump this when upgrading the plan). To keep generations inside
// the cap we rely on (a) an explicit Runtime in the input which Claude
// uses to bound shot count, (b) max_tokens: 32000 below as a hard output
// cap, and (c) a SHOT COUNT CEILING in the system prompt. Streaming
// keeps bytes flowing so proxy idle-timeouts are not a concern; this
// duration cap exists purely to bound long generations.
export const maxDuration = 300;

const CLAUDE_MODEL = "claude-sonnet-4-6";

// Parse pipeline (each step only runs if the previous one failed):
//  1) strip code-fence markers and any leading non-JSON prose; try parse.
//  2) light hand-rolled cleanup (smart quotes, trailing commas, control chars); try parse.
//  3) jsonrepair — handles bracket-type swaps, missing closers, unescaped quotes,
//     single-quoted strings, comments, unquoted keys, and most other LLM JSON quirks.
//  4) hand-rolled inner-quote escaper as a last resort.
//  5) truncated-array recovery — finds the last fully-closed object and seals the array.
function tryParseJson(raw: string): unknown {
  let s = raw.replace(/```json\s*|\s*```/g, "").trim();
  const objStart = s.indexOf("{");
  const arrStart = s.indexOf("[");
  if (arrStart !== -1 && (objStart === -1 || arrStart < objStart)) {
    s = s.slice(arrStart);
  } else if (objStart !== -1) {
    s = s.slice(objStart);
  }

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
    return JSON.parse(jsonrepair(repaired));
  } catch {}

  try {
    return JSON.parse(escapeInnerQuotes(repaired));
  } catch {}

  const truncated = repairTruncatedArray(repaired);
  if (truncated) {
    try {
      return JSON.parse(truncated);
    } catch {}
    try {
      return JSON.parse(jsonrepair(truncated));
    } catch {}
    try {
      return JSON.parse(escapeInnerQuotes(truncated));
    } catch {}
  }

  try {
    return JSON.parse(jsonrepair(s));
  } catch (e) {
    const err = e as Error;
    const pos = (err.message.match(/position (\d+)/) || [])[1];
    const snippet = pos
      ? repaired.slice(Math.max(0, +pos - 60), +pos + 60)
      : repaired.slice(0, 300);
    throw new Error(`JSON parse failed: ${err.message}\n...${snippet}...`);
  }
}

function repairTruncatedArray(s: string): string | null {
  const trimmed = s.trim();
  if (!trimmed.startsWith("[")) return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  let lastTopLevelClose = -1;

  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (c === "\\") {
        escape = true;
        continue;
      }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "{" || c === "[") {
      depth++;
    } else if (c === "}" || c === "]") {
      depth--;
      if (c === "}" && depth === 1) {
        lastTopLevelClose = i;
      }
      if (depth === 0 && c === "]") {
        return trimmed.slice(0, i + 1);
      }
    }
  }

  if (lastTopLevelClose > 0) {
    return trimmed.slice(0, lastTopLevelClose + 1) + "]";
  }
  return null;
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

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const n = parseInt(header, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(n, 90);
}

async function callWithRetry(
  headers: Record<string, string>,
  body: Record<string, unknown>
): Promise<{ res: Response; rawText: string }> {
  let attempt = 0;
  const maxAttempts = 2;
  while (true) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      cache: "no-store",
      headers,
      body: JSON.stringify(body),
    });
    const rawText = await res.text();

    if (res.status === 429 && attempt < maxAttempts) {
      const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
      const waitMs = retryAfter != null ? retryAfter * 1000 : 8000;
      await new Promise((r) => setTimeout(r, waitMs));
      attempt++;
      continue;
    }

    return { res, rawText };
  }
}

// Streaming variant: does NOT await the response body so we can pipe it
// through to the client. 429s are still retried once with backoff.
async function callStreamWithRetry(
  headers: Record<string, string>,
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<Response> {
  let attempt = 0;
  const maxAttempts = 2;
  while (true) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      cache: "no-store",
      headers,
      body: JSON.stringify({ ...body, stream: true }),
      signal,
    });

    if (res.status === 429 && attempt < maxAttempts) {
      const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
      const waitMs = retryAfter != null ? retryAfter * 1000 : 8000;
      // Drain & discard so the connection can be reused.
      try {
        await res.body?.cancel();
      } catch {}
      await new Promise((r) => setTimeout(r, waitMs));
      attempt++;
      continue;
    }

    return res;
  }
}

export async function POST(req: NextRequest) {
  try {
    const { prompt, system, jsonMode, stream } = await req.json();

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY is not configured" },
        { status: 500 }
      );
    }

    // Sonnet 4.6 supports up to 64k output tokens, but on Vercel Hobby
    // we are capped at a 300s function wall and at ~50-80 tok/s output
    // a 32k cap is the realistic upper bound that can finish before the
    // function gets killed. Shotlist responses are verbose by design
    // (each shot's prose appears in three places: the group prompt, the
    // imagePrompt panels, and the shots[] array) but a well-runtimed
    // request typically lands at ~10-18k tokens, so 32k leaves comfortable
    // headroom without inviting runaway generations.
    //
    // Sonnet 4.6+ rejects requests that set both `temperature` and `top_p`.
    // Keep temperature only — it is also the knob required for extended
    // thinking compatibility on this model family (must be exactly 1).
    const body: Record<string, unknown> = {
      model: CLAUDE_MODEL,
      max_tokens: 32000,
      temperature: 1,
      messages: [{ role: "user", content: prompt }],
    };
    if (system) body.system = system;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    };

    if (stream) {
      return streamingResponse({
        headers,
        body,
        jsonMode: !!jsonMode,
        signal: req.signal,
      });
    }

    const { res, rawText } = await callWithRetry(headers, body);

    if (!res.ok) {
      if (res.status === 429) {
        const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
        const waitMsg = retryAfter
          ? ` Try again in about ${retryAfter}s.`
          : " Try again in a minute.";
        return NextResponse.json(
          {
            error: `Rate limited by Anthropic (input tokens per minute exceeded).${waitMsg}`,
          },
          { status: 429 }
        );
      }
      return NextResponse.json(
        { error: `Anthropic API error ${res.status}: ${rawText.slice(0, 300)}` },
        { status: 500 }
      );
    }

    let data: {
      error?: { message?: string };
      content?: { type: string; text?: string }[];
      stop_reason?: string;
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
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join("\n");

    if (jsonMode) {
      try {
        const parsed = tryParseJson(text);
        return NextResponse.json({ result: parsed });
      } catch (e) {
        const baseMsg = (e as Error).message;
        const hint =
          data.stop_reason === "max_tokens"
            ? " (response was truncated by max_tokens limit)"
            : "";
        return NextResponse.json(
          { error: `${baseMsg}${hint}` },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ result: text });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// SSE wire format emitted to the client:
//   data: {"delta":"chunk"}      // each text_delta from Anthropic
//   data: {"done":true,"result":<parsed>,"text":"...","stopReason":"..."}
//   data: {"error":"..."}        // terminal error
// One event per "data:" line, blank line as separator. We forward only
// text deltas; everything else (ping, message_start, etc.) is dropped.
async function streamingResponse(opts: {
  headers: Record<string, string>;
  body: Record<string, unknown>;
  jsonMode: boolean;
  signal?: AbortSignal;
}): Promise<Response> {
  const { headers, body, jsonMode, signal } = opts;

  let upstream: Response;
  try {
    upstream = await callStreamWithRetry(headers, body, signal);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message || "Upstream request failed" },
      { status: 500 }
    );
  }

  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => "");
    if (upstream.status === 429) {
      const retryAfter = parseRetryAfter(upstream.headers.get("retry-after"));
      const waitMsg = retryAfter
        ? ` Try again in about ${retryAfter}s.`
        : " Try again in a minute.";
      return NextResponse.json(
        {
          error: `Rate limited by Anthropic (input tokens per minute exceeded).${waitMsg}`,
        },
        { status: 429 }
      );
    }
    return NextResponse.json(
      {
        error: `Anthropic API error ${upstream.status}: ${errText.slice(0, 300)}`,
      },
      { status: 500 }
    );
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const out = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.body!.getReader();
      let buffer = "";
      let fullText = "";
      let stopReason: string | undefined;

      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let sepIdx: number;
          while ((sepIdx = buffer.indexOf("\n\n")) !== -1) {
            const rawEvent = buffer.slice(0, sepIdx);
            buffer = buffer.slice(sepIdx + 2);

            // Anthropic SSE events have shape:
            //   event: <type>
            //   data: <json>
            // Only the data line is meaningful for parsing.
            let dataLine = "";
            for (const line of rawEvent.split("\n")) {
              if (line.startsWith("data:")) {
                dataLine = line.slice(line.startsWith("data: ") ? 6 : 5);
              }
            }
            if (!dataLine || dataLine === "[DONE]") continue;

            try {
              const parsed = JSON.parse(dataLine) as {
                type?: string;
                delta?: { type?: string; text?: string; stop_reason?: string };
              };
              if (
                parsed.type === "content_block_delta" &&
                parsed.delta?.type === "text_delta" &&
                typeof parsed.delta.text === "string"
              ) {
                fullText += parsed.delta.text;
                send({ delta: parsed.delta.text });
              } else if (parsed.type === "message_delta") {
                if (parsed.delta?.stop_reason) {
                  stopReason = parsed.delta.stop_reason;
                }
              }
            } catch {
              // Skip malformed individual events; the stream as a whole
              // can still complete successfully.
            }
          }
        }

        if (jsonMode) {
          try {
            const result = tryParseJson(fullText);
            send({ done: true, result, text: fullText, stopReason });
          } catch (e) {
            const baseMsg = (e as Error).message;
            const hint =
              stopReason === "max_tokens"
                ? " (response was truncated by max_tokens limit)"
                : "";
            send({ error: `${baseMsg}${hint}` });
          }
        } else {
          send({ done: true, text: fullText, stopReason });
        }
      } catch (e) {
        send({ error: (e as Error).message || "Stream interrupted" });
      } finally {
        try {
          reader.releaseLock();
        } catch {}
        controller.close();
      }
    },
  });

  return new Response(out, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disables nginx-style proxy buffering so deltas reach the browser
      // as soon as they're emitted, not in 4–8KB chunks.
      "X-Accel-Buffering": "no",
    },
  });
}
