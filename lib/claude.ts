import type {
  SongInput,
  Idea,
  ShotGroup,
  ShotEntry,
  LyricSection,
  Character,
  Location,
} from "@/types";
import { IDEAS_SYS, SHOTLIST_SYS } from "@/lib/prompts";
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
  angle: Idea | null
): Promise<ShotlistResult> {
  const sections: LyricSection[] = parseLyrics(input.lyrics);
  const totalSeconds = input.runtime ? runtimeToSeconds(input.runtime) : null;

  const prompt = `Artist: ${input.artist}
Song: ${input.title}
Genre: ${input.genre || "n/a"}
${totalSeconds ? `TOTAL SECONDS: ${totalSeconds}` : ""}
${angle ? `\nDirectional angle: ${angle.angle} — ${angle.pitch}\n` : ""}
LYRIC SECTIONS:
${sections.map((s) => `[${s.label}]\n${s.lines.join("\n")}`).join("\n\n")}

Build the shot list for this song now. Tie each shot to a lyric section and a specific lyric line.

${
    totalSeconds
      ? `RUNTIME — MANDATORY:
- The sum of ALL shot durations across ALL groups MUST equal exactly ${totalSeconds} seconds.
- Satisfy this by adjusting the NUMBER OF SHOTS, never by padding individual durations.
- Verify the total before returning.

`
      : ""
  }Pacing reminder — let the song lead, but bias toward fast cutting:
- Default to 1-4 second shots.
- Reserve 5-15s shots for genuinely sustained moments only.
- Vary durations — fast cutting in choruses and drops, more held shots in bridges.
- No single shot may exceed 15 seconds.

Safety reminder — every prompt feeds a downstream content filter.
- Density beats sparseness: establish setting + atmosphere + framing + production register.
- Visual facts only — no motivations, no backstory, no emotional explanations.
- Use TAG not generic descriptors ("a figure", "the couple", "the friends") for named cast.
- Hard blocks: real names, depicted weapons-on-people, blood/gore, undress language, drug imagery, self-harm, sexualised framing.

[${nonce()}]`;

  const result = (await callClaude(prompt, SHOTLIST_SYS, true)) as {
    look?: string;
    characters?: unknown;
    locations?: unknown;
    groups?: unknown[];
  };

  const look =
    typeof result?.look === "string" ? result.look.trim() : "";

  const characters = sanitizeCharacters(result?.characters);

  const locations = sanitizeLocations(result?.locations);

  const groups = sanitizeGroups(result?.groups);

  return { groups, look, characters, locations };
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
