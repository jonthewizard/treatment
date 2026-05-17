import { NextRequest, NextResponse } from "next/server";
import { tryParseJson } from "@/lib/parse-llm-json";

export const dynamic = "force-dynamic";
// 300s is the hard ceiling on Vercel Hobby (Pro allows 800s, Enterprise
// 900s — bump this when upgrading the plan). To keep generations inside
// the cap we rely on (a) an explicit Runtime in the input which Claude
// uses to bound shot count, (b) max_tokens: 32000 below as a hard output
// cap, and (c) a SHOT COUNT CEILING in the system prompt. Streaming
// keeps bytes flowing so proxy idle-timeouts are not a concern; this
// duration cap exists purely to bound long generations.
export const maxDuration = 300;

/** Default snapshot; override with ANTHROPIC_MODEL or CLAUDE_MODEL if a model misbehaves. */
const DEFAULT_CLAUDE_MODEL = "claude-opus-4-7";

function getClaudeModel(): string {
  return (
    process.env.ANTHROPIC_MODEL?.trim() ||
    process.env.CLAUDE_MODEL?.trim() ||
    DEFAULT_CLAUDE_MODEL
  );
}

function isAnthropicTransientStatus(code: number): boolean {
  return code === 500 || code === 502 || code === 503 || code === 529;
}

/** Pull nested message + request_id from Anthropic JSON error bodies. */
function formatAnthropicHttpError(rawText: string): string {
  const normalized = rawText.replace(/^\ufeff/, "").trim();
  const truncated = normalized.slice(0, 800);
  const brace = normalized.indexOf("{");
  const jsonSlice = brace >= 0 ? normalized.slice(brace) : normalized;

  const parseShape = (
    raw: unknown
  ): {
    msg: string;
    rid: string;
  } => {
    if (!raw || typeof raw !== "object") return { msg: "", rid: "" };
    const j = raw as {
      error?: { type?: string; message?: string };
      message?: string;
      request_id?: string;
    };
    const msg =
      typeof j?.error?.message === "string"
        ? j.error.message
        : typeof j?.message === "string"
          ? j.message
          : "";
    const rid =
      typeof j?.request_id === "string"
        ? j.request_id
        : "";
    return { msg, rid };
  };

  try {
    const { msg, rid } = parseShape(JSON.parse(jsonSlice));
    if (msg) return rid ? `${msg} (request_id: ${rid})` : msg;
  } catch {
    /* fall through — body may include non-JSON prefix or chunked noise */
  }

  try {
    const { msg, rid } = parseShape(JSON.parse(normalized));
    if (msg) return rid ? `${msg} (request_id: ${rid})` : msg;
  } catch {
    /* continue to regex heuristic */
  }

  let msgMatch = normalized.match(
    /"message"\s*:\s*"((?:[^"\\]|\\.)*)"/
  );
  const ridMatch = normalized.match(/"request_id"\s*:\s*"([^"]+)"/);
  if (!msgMatch) {
    msgMatch = normalized.match(
      /"type"\s*:\s*"[^"]*",\s*"message"\s*:\s*"((?:[^"\\]|\\.)*)"/
    );
  }
  let msg =
    typeof msgMatch?.[1] === "string"
      ? msgMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\")
      : "";
  const rid = typeof ridMatch?.[1] === "string" ? ridMatch[1] : "";
  if (!msg && !rid) return truncated || "Unknown error";
  msg = msg || "Upstream error";
  return rid ? `${msg} (request_id: ${rid})` : msg;
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
  let rateAttempt = 0;
  const maxRateRetries = 2;
  let transientAttempt = 0;
  while (true) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      cache: "no-store",
      headers,
      body: JSON.stringify(body),
    });
    const rawText = await res.text();

    if (res.status === 429 && rateAttempt < maxRateRetries) {
      const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
      const waitMs = retryAfter != null ? retryAfter * 1000 : 8000;
      await new Promise((r) => setTimeout(r, waitMs));
      rateAttempt++;
      continue;
    }

    if (
      isAnthropicTransientStatus(res.status) &&
      transientAttempt < 2
    ) {
      transientAttempt++;
      const waitMs = transientAttempt === 1 ? 3200 : 8500;
      await new Promise((r) => setTimeout(r, waitMs));
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
  let rateAttempt = 0;
  const maxRateRetries = 2;
  let transientAttempt = 0;
  while (true) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      cache: "no-store",
      headers,
      body: JSON.stringify({ ...body, stream: true }),
      signal,
    });

    if (res.status === 429 && rateAttempt < maxRateRetries) {
      const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
      const waitMs = retryAfter != null ? retryAfter * 1000 : 8000;
      // Drain & discard so the connection can be reused.
      try {
        await res.body?.cancel();
      } catch {}
      await new Promise((r) => setTimeout(r, waitMs));
      rateAttempt++;
      continue;
    }

    if (isAnthropicTransientStatus(res.status) && transientAttempt < 2) {
      try {
        await res.body?.cancel();
      } catch {}
      transientAttempt++;
      const waitMs = transientAttempt === 1 ? 3200 : 8500;
      await new Promise((r) => setTimeout(r, waitMs));
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

    // Claude 4.x models support large output ceilings, but on Vercel Hobby
    // we are capped at a 300s function wall and at ~50-80 tok/s output
    // a 32k cap is the realistic upper bound that can finish before the
    // function gets killed. Shotlist responses are verbose by design
    // (each shot's prose appears in three places: the group prompt, the
    // imagePrompt panels, and the shots[] array) but a well-runtimed
    // request typically lands at ~10-18k tokens, so 32k leaves comfortable
    // headroom without inviting runaway generations.
    //
    // Claude 4.x rejects requests that set both `temperature` and `top_p`.
    // Keep temperature only — it is also the knob required for extended
    // thinking compatibility on this model family (must be exactly 1).
    const body: Record<string, unknown> = {
      model: getClaudeModel(),
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
      const detail = formatAnthropicHttpError(rawText);
      return NextResponse.json(
        {
          error: `Anthropic API error ${res.status}: ${detail}`,
        },
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
    const detail = formatAnthropicHttpError(errText);
    return NextResponse.json(
      {
        error: `Anthropic API error ${upstream.status}: ${detail}`,
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
