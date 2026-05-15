import type {
  SongInput,
  Idea,
  ShotGroup,
  ShotEntry,
  ShotMode,
  ShotStub,
  ShotlistOutline,
  LyricSection,
  Character,
  Location,
} from "@/types";
import {
  IDEA_SYS,
  SHOTLIST_SYS,
  DETAILED_SHOTLIST_SYS,
  OUTLINE_SYS,
  EXPAND_SYS,
  KLING_MAX_SHOT_PROMPT_CHARS,
} from "@/lib/prompts";
import { parseLyrics } from "@/lib/lyrics";

function clampKlingShotPrompt(raw: string): string {
  const t = raw.trim();
  const chars = [...t];
  if (chars.length <= KLING_MAX_SHOT_PROMPT_CHARS) return t;
  return chars.slice(0, KLING_MAX_SHOT_PROMPT_CHARS).join("");
}

function nonce() {
  return Math.random().toString(36).slice(2, 8);
}

async function callClaude(
  prompt: string,
  system: string,
  jsonMode: boolean = false
): Promise<unknown> {
  const res = await fetch("/api/claude", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, system, jsonMode }),
  });

  let data: { result?: unknown; error?: string };
  try {
    data = await res.json();
  } catch {
    throw new Error(`Unexpected response (${res.status}) from /api/claude`);
  }
  if (data.error) throw new Error(data.error);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return data.result;
}

// Streaming counterpart to callClaude. The server emits one SSE event per
// line with either {delta} (incremental text), {done,result,text} (final
// parsed JSON when jsonMode is on), or {error}. onDelta receives each text
// chunk live so the UI can render Claude's output as it arrives.
async function callClaudeStream(
  prompt: string,
  system: string,
  jsonMode: boolean,
  onDelta: (chunk: string) => void,
  signal?: AbortSignal
): Promise<unknown> {
  const res = await fetch("/api/claude", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, system, jsonMode, stream: true }),
    signal,
  });

  // Server short-circuits to a JSON error (no stream body) on rate-limit
  // or upstream failure. Detect by content-type.
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("text/event-stream")) {
    let data: { error?: string };
    try {
      data = await res.json();
    } catch {
      throw new Error(`Unexpected response (${res.status}) from /api/claude`);
    }
    if (data.error) throw new Error(data.error);
    throw new Error(`Request failed (${res.status})`);
  }

  if (!res.body) throw new Error("Empty stream from /api/claude");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult: unknown = undefined;
  let finalText = "";
  let errorMessage: string | null = null;
  let sawDone = false;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sepIdx: number;
      while ((sepIdx = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, sepIdx);
        buffer = buffer.slice(sepIdx + 2);

        let dataLine = "";
        for (const line of rawEvent.split("\n")) {
          if (line.startsWith("data:")) {
            dataLine = line.slice(line.startsWith("data: ") ? 6 : 5);
          }
        }
        if (!dataLine) continue;

        let evt: {
          delta?: string;
          done?: boolean;
          result?: unknown;
          text?: string;
          error?: string;
        };
        try {
          evt = JSON.parse(dataLine);
        } catch {
          continue;
        }

        if (evt.error) {
          errorMessage = evt.error;
          continue;
        }
        if (typeof evt.delta === "string") {
          onDelta(evt.delta);
          continue;
        }
        if (evt.done) {
          sawDone = true;
          if (evt.result !== undefined) finalResult = evt.result;
          if (typeof evt.text === "string") finalText = evt.text;
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }

  if (errorMessage) throw new Error(errorMessage);
  if (!sawDone) throw new Error("Stream ended before completion");
  return jsonMode ? finalResult : finalText;
}

const PRIOR_PITCH_SNIPPET_CHARS = 320;

function truncateForPrompt(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function formatPriorIdeasBlock(prior: Idea[]): string {
  return prior
    .map(
      (idea, i) =>
        `${i + 1}. **${idea.angle}** — ${truncateForPrompt(
          idea.pitch,
          PRIOR_PITCH_SNIPPET_CHARS
        )}`
    )
    .join("\n");
}

function sanitizeSingleIdea(raw: unknown): Idea | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw))
    return null;
  const o = raw as Record<string, unknown>;
  if (Array.isArray(o.ideas) && o.ideas.length > 0) {
    return sanitizeSingleIdea(o.ideas[0]);
  }
  const angleRaw = o.angle;
  const pitchRaw = o.pitch;
  if (typeof angleRaw !== "string" || typeof pitchRaw !== "string")
    return null;
  const angle = angleRaw.replace(/\s+/g, " ").trim();
  const pitch = pitchRaw.replace(/\s+/g, " ").trim();
  if (!angle || !pitch) return null;
  return { angle, pitch };
}

/** Three sequential API calls — one idea each so each generation is independent; later calls see prior ideas to stay distinct. */
export async function genIdeas(input: SongInput): Promise<Idea[]> {
  const concept = input.concept?.trim() ?? "";
  const lyrics = input.lyrics?.trim() ?? "";
  if (!concept && !lyrics) {
    throw new Error(
      "Add lyrics or a concept (or both) before generating ideas."
    );
  }

  const ideas: Idea[] = [];

  for (let slot = 1; slot <= 3; slot++) {
    const sections: string[] = [
      `Artist: ${input.artist}\nSong: ${input.title}\nGenre: ${input.genre || "n/a"}`,
    ];
    if (lyrics) sections.push(`LYRICS:\n${lyrics}`);
    if (concept) {
      sections.push(
        lyrics
          ? `CONCEPT (the director's intent — develop this idea around this while staying grounded in the lyrics):\n${concept}`
          : `CONCEPT (the director's intent — build this idea directly on this; no lyrics were supplied):\n${concept}`
      );
    }

    sections.push(
      `PITCH LEVEL — TREATMENT ONLY\nWrite a high-level creative direction (conceit, governing rule, world, emotional thesis). Do not write shots: no scene beats, no camera scale, lens, blocking, or lighting micromanagement. If you state one formal constraint, state it once as the idea of the film — not as a list of frames.`
    );

    if (slot === 1) {
      sections.push(
        `GENERATION CONTEXT\nYou are proposing idea 1 of 3 for this song. Two more ideas will be generated in separate calls — commit fully to ONE bold direction here.`
      );
    } else {
      sections.push(
        `GENERATION CONTEXT\nYou are proposing idea ${slot} of 3.\n\nPRIOR IDEAS (locked — your new angle and pitch must be substantially different from each):\n${formatPriorIdeasBlock(ideas)}`
      );
    }

    sections.push(`[${nonce()}]`);

    const raw = await callClaude(sections.join("\n\n"), IDEA_SYS, true);
    const idea = sanitizeSingleIdea(raw);
    if (!idea) {
      throw new Error(
        `Could not parse idea ${slot} of 3 from the model response. Try again.`
      );
    }
    ideas.push(idea);
  }

  return ideas;
}

// Accepts a handful of common shorthand formats so a typo in the Runtime
// field doesn't silently drop the runtime instruction from the prompt:
//   "4:34"  -> 274s   (M:SS or MM:SS — minutes + seconds)
//   "0:10"  -> 10s    (same)
//   ":10"   -> 10s    (leading-colon seconds shorthand)
//   "10s"   -> 10s    ("Ns" / "Nsec" / "Nsecs" — explicit seconds suffix)
//   "10"    -> 10s    (bare digits, treated as seconds for clarity)
function runtimeToSeconds(runtime: string): number | null {
  const trimmed = runtime.trim().toLowerCase();
  if (!trimmed) return null;

  const mmss = trimmed.match(/^(\d+):(\d{1,2})$/);
  if (mmss) return parseInt(mmss[1]!, 10) * 60 + parseInt(mmss[2]!, 10);

  const seconds = trimmed.match(/^:?(\d+)\s*(?:s|sec|secs|seconds)?$/);
  if (seconds) return parseInt(seconds[1]!, 10);

  return null;
}

export interface ShotlistResult {
  groups: ShotGroup[];
  look: string;
  characters: Character[];
  locations: Location[];
}

export async function genShotlist(
  input: SongInput,
  angle: Idea | null,
  mode: ShotMode = "detailed",
  onDelta?: (chunk: string) => void,
  signal?: AbortSignal
): Promise<ShotlistResult> {
  const sections: LyricSection[] = parseLyrics(input.lyrics);
  const totalSeconds = input.runtime ? runtimeToSeconds(input.runtime) : null;

  // The two modes share the cast/location/safety/JSON rules but differ on
  // pacing. In "groups" mode we fast-cut inside ≤15s bundles. In "detailed"
  // mode each shot is its own 5–15s Kling generation with a dense
  // cinematographic prompt.
  const pacingBlock =
    mode === "detailed"
      ? `Pacing reminder — every shot is its own Kling clip, so each one must justify its own duration. BIAS HARD TOWARD SHORT SHOTS:
- EVERY group contains exactly ONE shot. Allowed range is 3–15 seconds, but the vast majority should be 3–6 seconds.
- Default to 3–6s. Only go longer (7–9s) when a specific camera move or piece of choreography genuinely needs the time. 10–15s is rare — reserve for the climactic long take only.
- Target average shot length across the whole song: ~4–5 seconds. If your average drifts above 6s, cut some shots down.
- Each shot prompt should be DENSE: lens choice, camera position and movement, character blocking inside the frame, light direction, composition, and any optical effect — even at 3–4 seconds.`
      : `Pacing reminder — let the song lead, but bias toward fast cutting:
- Default to 1-4 second shots.
- Reserve 5-15s shots for genuinely sustained moments only.
- Vary durations — fast cutting in choruses and drops, more held shots in bridges.
- No single shot may exceed 15 seconds.`;

  const runtimeBlock = totalSeconds
    ? mode === "detailed"
      ? `RUNTIME — MANDATORY:
- The sum of ALL shot durations across ALL groups MUST equal exactly ${totalSeconds} seconds.
- Each shot's duration must be in the 3–15 second range.
- Satisfy the total by adjusting the NUMBER OF SHOTS, never by stretching beyond 15s or shrinking below 3s.
- Verify the total before returning.

`
      : `RUNTIME — MANDATORY:
- The sum of ALL shot durations across ALL groups MUST equal exactly ${totalSeconds} seconds.
- Satisfy this by adjusting the NUMBER OF SHOTS, never by padding individual durations.
- Verify the total before returning.

`
    : "";

  const prompt = `Artist: ${input.artist}
Song: ${input.title}
Genre: ${input.genre || "n/a"}
${totalSeconds ? `TOTAL SECONDS: ${totalSeconds}` : ""}
${angle ? `\nDirectional angle: ${angle.angle} — ${angle.pitch}\n` : ""}
LYRIC SECTIONS:
${sections.map((s) => `[${s.label}]\n${s.lines.join("\n")}`).join("\n\n")}

Build the shot list for this song now. Tie each shot to a lyric section and a specific lyric line.

${runtimeBlock}${pacingBlock}

Safety reminder — every prompt feeds a downstream content filter.
- Density beats sparseness: establish setting + atmosphere + framing + production register.
- Visual facts only — no motivations, no backstory, no emotional explanations.
- Use TAG not generic descriptors ("a figure", "the couple", "the friends") for named cast.
- Hard blocks: real names, depicted weapons-on-people, blood/gore, undress language, drug imagery, self-harm, sexualised framing.

[${nonce()}]`;

  const system = mode === "detailed" ? DETAILED_SHOTLIST_SYS : SHOTLIST_SYS;
  // Shotlist generation is the slow call (60–120s on long songs). Stream
  // it so the UI can show progress and so intermediate proxies don't
  // 504 an idle connection. Final JSON is parsed server-side and returned
  // on the terminal "done" event, so the consumer still gets a parsed
  // object exactly like the non-streaming callClaude path.
  const result = (await callClaudeStream(
    prompt,
    system,
    true,
    onDelta ?? (() => {}),
    signal
  )) as {
    look?: string;
    characters?: unknown;
    locations?: unknown;
    groups?: unknown[];
  };

  const look =
    typeof result?.look === "string" ? result.look.trim() : "";

  const characters = sanitizeCharacters(result?.characters);

  const locations = sanitizeLocations(result?.locations);

  const rawGroups = sanitizeGroups(result?.groups);

  // Detailed mode is "one shot per group". The system prompt asks for that
  // explicitly, but Claude sometimes returns multi-shot groups anyway —
  // especially on long songs. Split them in place so the UI only ever sees
  // single-shot groups, which is the only thing the detailed pipeline (one
  // Kling clip per shot, per-shot durations) is wired to handle.
  const groups =
    mode === "detailed" ? splitGroupsToSingleShots(rawGroups) : rawGroups;

  return { groups, look, characters, locations };
}

function splitGroupsToSingleShots(groups: ShotGroup[]): ShotGroup[] {
  const out: ShotGroup[] = [];
  let nextNumber = 1;
  for (const g of groups) {
    if (g.shots.length <= 1) {
      out.push({ ...g, groupNumber: nextNumber++ });
      continue;
    }
    for (const shot of g.shots) {
      const seconds = parseDurationSeconds(shot.duration) || g.totalSeconds;
      out.push({
        groupNumber: nextNumber++,
        totalSeconds: seconds,
        // The group "prompt" is what Kling sees in single-shot mode. Re-use
        // the per-shot prompt as the group prompt; the original group
        // prompt may reference other shots in the bundle.
        prompt: shot.prompt,
        imagePrompt: g.imagePrompt,
        shots: [shot],
      });
    }
  }
  return out;
}

function sanitizeCharacters(raw: unknown): Character[] {
  if (!Array.isArray(raw)) return [];
  const out: Character[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const tagRaw = (item as { tag?: unknown }).tag;
    const descRaw = (item as { description?: unknown }).description;
    if (typeof tagRaw !== "string" || typeof descRaw !== "string") continue;
    const tag = tagRaw
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, "")
      .slice(0, 32);
    const description = descRaw.replace(/\s+/g, " ").trim();
    if (!tag || !description) continue;
    out.push({ tag, description });
  }
  return out;
}

// Mirrors sanitizeCharacters but for location TAGs. Same TAG rules apply
// (ALL_CAPS, alphanumerics + underscores) since locations bind to Kling /
// Nano Banana 2 reference images via <<<image_N>>> markers the same way.
function sanitizeLocations(raw: unknown): Location[] {
  if (!Array.isArray(raw)) return [];
  const out: Location[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const tagRaw = (item as { tag?: unknown }).tag;
    const descRaw = (item as { description?: unknown }).description;
    if (typeof tagRaw !== "string" || typeof descRaw !== "string") continue;
    const tag = tagRaw
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, "")
      .slice(0, 32);
    const description = descRaw.replace(/\s+/g, " ").trim();
    if (!tag || !description) continue;
    out.push({ tag, description });
  }
  return out;
}

function sanitizeGroups(raw: unknown): ShotGroup[] {
  if (!Array.isArray(raw)) return [];
  const out: ShotGroup[] = [];
  let groupNumber = 1;
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const g = item as Record<string, unknown>;
    const prompt = typeof g.prompt === "string" ? g.prompt.trim() : "";
    const imagePrompt =
      typeof g.imagePrompt === "string" ? g.imagePrompt.trim() : prompt;
    const seconds =
      typeof g.seconds === "number" && g.seconds > 0
        ? Math.round(g.seconds)
        : 0;
    if (!prompt || !seconds) continue;
    const shots = sanitizeShots(g.shots);
    out.push({ groupNumber: groupNumber++, totalSeconds: seconds, prompt, imagePrompt, shots });
  }
  return out;
}

function sanitizeShots(raw: unknown): ShotEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ShotEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    const promptRaw = typeof s.prompt === "string" ? s.prompt.trim() : "";
    const prompt = clampKlingShotPrompt(promptRaw);
    const duration = typeof s.duration === "string" ? s.duration.trim() : "";
    if (!prompt || !duration) continue;
    out.push({ prompt, duration });
  }
  return out;
}

export function parseDurationSeconds(d: string | undefined): number {
  if (!d) return 0;
  const n = parseFloat(String(d).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// -------- Two-phase shotlist generation -----------------------------------
//
// On Vercel Hobby a single 300s function isn't long enough to produce a
// dense, multi-shot detailed treatment (each shot's prose is ~600-1000
// tokens; 24 shots × that + bible + storyboards saturates the wall).
//
// The two-phase pipeline splits the work into:
//
//   PHASE 1 (OUTLINE_SYS) — one streaming call that emits the canonical
//   bible (look, cast, locations) plus N lightweight stubs. Small output
//   (~5-10k tokens), fast (~30-60s), well under 300s.
//
//   PHASE 2 (EXPAND_SYS) — N small parallel calls, one per stub. Each
//   sees the full bible + full outline and expands ONE stub into the
//   dense ShotGroup shape used everywhere else. Each call finishes in
//   ~10-40s. Bounded concurrency keeps us under browser per-origin
//   connection caps and Anthropic rate limits.
//
// The merged result is identical in shape to the legacy single-call
// genShotlist, so storyboards / references / persistence are unchanged.

// Sanitize the OUTLINE_SYS response into a typed ShotlistOutline. Drops
// stubs missing required fields. Renumbers shotNumber so the array is
// 1-indexed and dense regardless of what the model returned.
function sanitizeOutline(raw: unknown): ShotStub[] {
  if (!Array.isArray(raw)) return [];
  const out: ShotStub[] = [];
  let n = 1;
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const seconds =
      typeof o.seconds === "number" && o.seconds > 0
        ? Math.round(o.seconds)
        : 0;
    const summary =
      typeof o.summary === "string" ? o.summary.replace(/\s+/g, " ").trim() : "";
    if (!seconds || !summary) continue;
    out.push({
      shotNumber: n++,
      seconds,
      lyricSection:
        typeof o.lyricSection === "string" ? o.lyricSection.trim() : "",
      lyricLine:
        typeof o.lyricLine === "string" ? o.lyricLine.trim() : "",
      framing: typeof o.framing === "string" ? o.framing.trim() : "",
      subject: typeof o.subject === "string" ? o.subject.toUpperCase().trim() : "",
      location: typeof o.location === "string" ? o.location.toUpperCase().trim() : "",
      summary,
    });
  }
  return out.slice(0, 24);
}

function buildOutlineUserPrompt(
  input: SongInput,
  angle: Idea | null,
  totalSeconds: number | null
): string {
  const sections: LyricSection[] = parseLyrics(input.lyrics);
  const runtimeBlock = totalSeconds
    ? `RUNTIME — MANDATORY:
- The sum of ALL stub durations in "outline" MUST equal exactly ${totalSeconds} seconds.
- Each stub's "seconds" must be in the 3–15 range.
- Satisfy the total by adjusting the NUMBER OF STUBS (up to 24 max), never by stretching beyond 15s or shrinking below 3s.
- Verify the total before returning.

`
    : "";

  return `Artist: ${input.artist}
Song: ${input.title}
Genre: ${input.genre || "n/a"}
${totalSeconds ? `TOTAL SECONDS: ${totalSeconds}` : ""}
${angle ? `\nDirectional angle: ${angle.angle} — ${angle.pitch}\n` : ""}
LYRIC SECTIONS:
${sections.map((s) => `[${s.label}]\n${s.lines.join("\n")}`).join("\n\n")}

Plan the shotlist for this song now. Emit the canonical bible (look, characters, locations) and a tight ordered outline of stubs. Tie each stub to a specific lyric section and line where possible.

${runtimeBlock}Safety reminder — every downstream prompt feeds a content filter.
- Use TAG not generic descriptors for named cast.
- Hard blocks: real names, depicted weapons-on-people, blood/gore, undress language, drug imagery, self-harm, sexualised framing.

[${nonce()}]`;
}

export async function genShotlistOutline(
  input: SongInput,
  angle: Idea | null,
  onDelta?: (chunk: string) => void,
  signal?: AbortSignal
): Promise<ShotlistOutline> {
  const totalSeconds = input.runtime ? runtimeToSeconds(input.runtime) : null;
  const prompt = buildOutlineUserPrompt(input, angle, totalSeconds);

  const result = (await callClaudeStream(
    prompt,
    OUTLINE_SYS,
    true,
    onDelta ?? (() => {}),
    signal
  )) as {
    look?: string;
    characters?: unknown;
    locations?: unknown;
    outline?: unknown;
    shotCount?: number;
  };

  const look = typeof result?.look === "string" ? result.look.trim() : "";
  const characters = sanitizeCharacters(result?.characters);
  const locations = sanitizeLocations(result?.locations);
  const outline = sanitizeOutline(result?.outline);

  return {
    shotCount: outline.length,
    look,
    characters,
    locations,
    outline,
  };
}

// Build the per-shot expansion user prompt. The bible + full outline are
// included verbatim so the expansion model has total context for visual
// grammar continuity. The TARGET STUB is called out clearly so the model
// expands the right one.
function buildExpandUserPrompt(
  stub: ShotStub,
  outline: ShotlistOutline,
  input: SongInput,
  angle: Idea | null
): string {
  const totalSeconds = input.runtime ? runtimeToSeconds(input.runtime) : null;
  const castBlock = outline.characters
    .map((c) => `- ${c.tag}: ${c.description}`)
    .join("\n");
  const locBlock = outline.locations
    .map((l) => `- ${l.tag}: ${l.description}`)
    .join("\n");
  const outlineBlock = outline.outline
    .map(
      (s) =>
        `${s.shotNumber}. [${s.seconds}s] ${s.framing}${s.subject ? ` · ${s.subject}` : ""} @ ${s.location}${s.lyricSection ? ` (${s.lyricSection}${s.lyricLine ? `: "${s.lyricLine.replace(/"/g, "'")}"` : ""})` : ""} — ${s.summary}`
    )
    .join("\n");

  return `Artist: ${input.artist}
Song: ${input.title}
Genre: ${input.genre || "n/a"}
${totalSeconds ? `TOTAL SECONDS: ${totalSeconds}` : ""}
${angle ? `Directional angle: ${angle.angle} — ${angle.pitch}` : ""}

CANONICAL BIBLE (LOCKED — do not redefine, do not invent new cast or locations):
look: ${outline.look}
characters:
${castBlock}
locations:
${locBlock}

FULL ORDERED OUTLINE (use for visual-grammar continuity; do NOT expand these — only the TARGET STUB below):
${outlineBlock}

TARGET STUB — expand this one shot:
shotNumber: ${stub.shotNumber}
seconds: ${stub.seconds}
framing: ${stub.framing}
subject: ${stub.subject || "(no named cast)"}
location: ${stub.location}
${stub.lyricSection ? `lyricSection: ${stub.lyricSection}` : ""}
${stub.lyricLine ? `lyricLine: "${stub.lyricLine.replace(/"/g, "'")}"` : ""}
summary: ${stub.summary}

Produce the dense Kling Video prompt and matching Nano Banana 2 storyboard prompt for THIS shot only, following all rules in the system prompt. Output the single-group JSON object.

[${nonce()}]`;
}

function sanitizeSingleGroup(raw: unknown, fallbackSeconds: number): ShotGroup | null {
  if (!raw || typeof raw !== "object") return null;
  const g = raw as Record<string, unknown>;
  const prompt = typeof g.prompt === "string" ? g.prompt.trim() : "";
  const imagePrompt =
    typeof g.imagePrompt === "string" ? g.imagePrompt.trim() : prompt;
  let seconds =
    typeof g.seconds === "number" && g.seconds > 0
      ? Math.round(g.seconds)
      : 0;
  const shots = sanitizeShots(g.shots);
  if (!seconds && shots.length === 1) {
    seconds = parseDurationSeconds(shots[0]!.duration) || fallbackSeconds;
  }
  if (!seconds) seconds = fallbackSeconds;
  if (!prompt || !seconds) return null;
  return {
    groupNumber: 0, // filled in by caller once the full set is assembled
    totalSeconds: seconds,
    prompt,
    imagePrompt,
    shots,
  };
}

export async function expandShot(
  stub: ShotStub,
  outline: ShotlistOutline,
  input: SongInput,
  angle: Idea | null,
  signal?: AbortSignal
): Promise<ShotGroup> {
  const prompt = buildExpandUserPrompt(stub, outline, input, angle);
  const result = await callClaude(prompt, EXPAND_SYS, true);
  const group = sanitizeSingleGroup(result, stub.seconds);
  if (!group) {
    throw new Error(
      `Expansion failed for shot ${stub.shotNumber} — empty or malformed group`
    );
  }
  return group;
}

export interface TwoPhaseCallbacks {
  // Live stream chunks from the outline (phase 1) call, used to drive a
  // streaming preview in the loader overlay.
  onDelta?: (chunk: string) => void;
  // Fires once phase 1 completes with a fully-parsed outline. The UI can
  // immediately show the bible (look, cast, locations) and the expected
  // shot count.
  onOutline?: (outline: ShotlistOutline) => void;
  // Fires every time a single shot expansion completes (phase 2). The UI
  // can progressively render shot cards as they arrive.
  onShotComplete?: (index: number, group: ShotGroup) => void;
  // Fires when a single shot expansion fails after all retries. The UI
  // can show an error placeholder for that slot and let the user retry.
  onShotError?: (index: number, error: Error) => void;
}

// Run a pool of async tasks with bounded concurrency. Resolves once all
// tasks settle. Used to fan out per-shot expansions while staying under
// the browser per-origin connection cap (~6) and any per-second rate
// limits at the API edge.
async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
  signal?: AbortSignal
): Promise<Array<{ ok: true; value: T } | { ok: false; error: Error }>> {
  const results: Array<{ ok: true; value: T } | { ok: false; error: Error }> = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (true) {
      if (signal?.aborted) return;
      const i = next++;
      if (i >= tasks.length) return;
      try {
        const value = await tasks[i]!();
        results[i] = { ok: true, value };
      } catch (e) {
        results[i] = { ok: false, error: e as Error };
      }
    }
  }
  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

export async function genShotlistTwoPhase(
  input: SongInput,
  angle: Idea | null,
  callbacks: TwoPhaseCallbacks = {},
  signal?: AbortSignal,
  concurrency: number = 6
): Promise<ShotlistResult> {
  // Phase 1: produce the bible + outline. Stream chunks to the UI.
  const outline = await genShotlistOutline(input, angle, callbacks.onDelta, signal);
  callbacks.onOutline?.(outline);

  if (outline.outline.length === 0) {
    return {
      groups: [],
      look: outline.look,
      characters: outline.characters,
      locations: outline.locations,
    };
  }

  // Phase 2: fan out one expansion per stub. Each task retries once on
  // failure (Anthropic occasionally 5xx's a single shot) before reporting
  // an error for that slot — the rest of the shots are unaffected.
  const tasks = outline.outline.map((stub, index) => async () => {
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (signal?.aborted) throw new Error("Aborted");
      try {
        const group = await expandShot(stub, outline, input, angle, signal);
        callbacks.onShotComplete?.(index, group);
        return group;
      } catch (e) {
        lastErr = e as Error;
      }
    }
    if (lastErr) callbacks.onShotError?.(index, lastErr);
    throw lastErr ?? new Error("Expansion failed");
  });

  const settled = await runWithConcurrency(tasks, concurrency, signal);

  // Assemble the final groups in outline order. Skip failed slots — the
  // UI will have already seen onShotError for them. Renumber sequentially
  // so the rest of the pipeline (storyboards, persistence) sees a clean
  // 1..N progression.
  const groups: ShotGroup[] = [];
  let groupNumber = 1;
  for (const r of settled) {
    if (r.ok) groups.push({ ...r.value, groupNumber: groupNumber++ });
  }

  return {
    groups,
    look: outline.look,
    characters: outline.characters,
    locations: outline.locations,
  };
}

// -------- end two-phase ---------------------------------------------------

// Strip the literal word "character" / "fictional" from descriptions before
// they are sent to Kling — both trigger animated/stylised renders.
export function scrubCharacterWord(text: string): string {
  return (
    text
      .replace(
        /\bfictional\s+original\s+characters?\b/gi,
        "an invented person not based on any real individual"
      )
      .replace(
        /\boriginal\s+fictional\s+design\b/gi,
        "an invented design with no real-world counterpart"
      )
      .replace(
        /\boriginal\s+characters?\b/gi,
        "an invented person not based on any real individual"
      )
      .replace(
        /\bfictional\s+characters?\b/gi,
        "an invented person not based on any real individual"
      )
      .replace(/\bcharacters\b/gi, "people")
      .replace(/\bcharacter\b/gi, "person")
      .replace(
        /\bfictional,?\s+not\s+based\s+on\s+any\s+real\s+(?:person|individual)\b/gi,
        "an invented person not based on any real individual"
      )
      .replace(/\bfictional\b/gi, "invented")
  );
}
