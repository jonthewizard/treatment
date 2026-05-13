import type {
  SongInput,
  Idea,
  ShotGroup,
  ShotEntry,
  ShotMode,
  LyricSection,
  Character,
  Location,
} from "@/types";
import {
  IDEAS_SYS,
  SHOTLIST_SYS,
  DETAILED_SHOTLIST_SYS,
} from "@/lib/prompts";
import { parseLyrics } from "@/lib/lyrics";

function nonce() {
  return Math.random().toString(36).slice(2, 8);
}

const AESTHETIC_NUDGES = [
  "surreal and dreamlike, embracing non-literal visuals",
  "gritty documentary realism, handheld and unpolished",
  "abstract and non-narrative, driven by movement and texture",
  "high-concept — one bold metaphor sustained throughout",
  "nostalgic and analog, referencing a specific past era",
  "futuristic and synthetic, unfamiliar worlds",
  "minimalist — one location, restricted palette, strict constraints",
  "epic and world-building, multiple locations and scale",
  "tactile and bodily, skin and fabric and material close-ups",
  "architectural and geometric, symmetry and space",
  "chaotic and maximalist, layered imagery and saturation",
  "noir and shadow-heavy, chiaroscuro lighting",
  "sun-bleached and overexposed, high-key daylight",
  "mythic and folkloric, archetypes and ritual imagery",
  "industrial and brutalist, concrete and raw materials",
];

const NARRATIVE_NUDGES = [
  "performance-driven, the artist front and centre",
  "character-driven narrative with a clear protagonist arc",
  "ensemble-driven, multiple characters whose paths intersect",
  "kinetic and action-forward, fast motion and chase energy",
  "quiet and contemplative, long takes and stillness",
  "structured as a single unbroken journey or procession",
  "structured around a transformation or metamorphosis",
  "built around a ritual, ceremony, or repeated action",
  "anchored to one object or motif that recurs",
  "framed as memory fragments, non-linear vignettes",
  "framed as a waking dream that slowly unravels",
  "built as a hypothetical — 'what if' reality shifted",
];

const LENS_NUDGES = [
  "from the point of view of an outsider observing",
  "from deep inside the protagonist's inner world",
  "from the vantage of someone or something left behind",
  "shot as if the camera itself were a character",
  "with the subject always just out of reach of the frame",
  "with the world reacting to the subject rather than vice versa",
  "emphasising what is absent or unseen",
  "emphasising group dynamics and crowds",
  "emphasising solitude and single figures in space",
  "emphasising hands, gestures, small physical details",
];

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
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

export async function genIdeas(input: SongInput): Promise<Idea[]> {
  const concept = input.concept?.trim() ?? "";
  const lyrics = input.lyrics?.trim() ?? "";
  if (!concept && !lyrics) {
    throw new Error(
      "Add lyrics or a concept (or both) before generating ideas."
    );
  }
  const sections: string[] = [
    `Artist: ${input.artist}\nSong: ${input.title}\nGenre: ${input.genre || "n/a"}`,
  ];
  if (lyrics) sections.push(`LYRICS:\n${lyrics}`);
  if (concept) {
    sections.push(
      lyrics
        ? `CONCEPT (the director's intent — develop each idea around this while staying grounded in the lyrics):\n${concept}`
        : `CONCEPT (the director's intent — build each idea directly on this; no lyrics were supplied):\n${concept}`
    );
  } else {
    sections.push(
      `For these three ideas, vary across:\n- ${pick(AESTHETIC_NUDGES)}\n- ${pick(NARRATIVE_NUDGES)}\n- ${pick(LENS_NUDGES)}`
    );
  }
  sections.push(`[${nonce()}]`);
  const prompt = sections.join("\n\n");
  const result = (await callClaude(prompt, IDEAS_SYS, true)) as {
    ideas?: unknown;
  };
  return sanitizeIdeas(result?.ideas);
}

function sanitizeIdeas(raw: unknown): Idea[] {
  if (!Array.isArray(raw)) return [];
  const out: Idea[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const angleRaw = (item as { angle?: unknown }).angle;
    const pitchRaw = (item as { pitch?: unknown }).pitch;
    if (typeof angleRaw !== "string" || typeof pitchRaw !== "string") continue;
    const angle = angleRaw.replace(/\s+/g, " ").trim();
    const pitch = pitchRaw.replace(/\s+/g, " ").trim();
    if (!angle || !pitch) continue;
    out.push({ angle, pitch });
  }
  return out.slice(0, 3);
}

function runtimeToSeconds(runtime: string): number | null {
  const match = runtime.trim().match(/^(\d+):(\d{2})$/);
  if (!match) return null;
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
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
    const prompt = typeof s.prompt === "string" ? s.prompt.trim() : "";
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
