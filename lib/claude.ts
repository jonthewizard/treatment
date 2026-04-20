import type { SongInput, Idea, Concept, Shot, LyricSection } from "@/types";
import { IDEAS_SYS, CONCEPT_SYS, STORYBOARD_SYS } from "@/lib/prompts";

function nonce() {
  return Math.random().toString(36).slice(2, 8);
}

const CREATIVE_NUDGES = [
  "lean surreal and dreamlike, embracing non-literal visuals",
  "lean gritty documentary realism, handheld and unpolished",
  "lean abstract and non-narrative, driven by movement and texture",
  "lean performance-driven, the artist front and centre",
  "lean character-driven narrative, with a clear protagonist arc",
  "lean high-concept — one bold metaphor sustained throughout",
  "lean nostalgic and analog, referencing a specific past era",
  "lean futuristic and synthetic, unfamiliar worlds",
  "lean minimalist — one location, restricted palette, strict constraints",
  "lean epic and world-building, multiple locations and scale",
  "lean kinetic and action-forward, fast motion and chase energy",
  "lean quiet and contemplative, long takes and stillness",
  "lean tactile and bodily, skin and fabric and material close-ups",
  "lean architectural and geometric, symmetry and space",
  "lean chaotic and maximalist, layered imagery and saturation",
];

function randomNudge(): string {
  return CREATIVE_NUDGES[Math.floor(Math.random() * CREATIVE_NUDGES.length)];
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

  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}

export async function genIdeas(input: SongInput): Promise<Idea[]> {
  const prompt = `Artist: ${input.artist}\nSong: ${input.title}\nGenre: ${input.genre || "n/a"}\n\nLYRICS:\n${input.lyrics}\n\nFor this round, ${randomNudge()}. The four angles should still be genuinely different from each other, but use this bias as a starting point.\n\n[${nonce()}]`;
  return callClaude(prompt, IDEAS_SYS, true) as Promise<Idea[]>;
}

export async function genConcept(
  input: SongInput,
  angle: Idea | null
): Promise<Concept> {
  const prompt = `Artist: ${input.artist}\nSong: ${input.title}\nGenre: ${input.genre || "n/a"}\n${
    angle ? `\nDirectional angle: ${angle.angle} — ${angle.pitch}\n` : ""
  }\nLYRICS:\n${input.lyrics}\n\nTie sectionBeats to the lyric section labels.${
    angle ? "" : ` For this treatment, ${randomNudge()}.`
  }\n\n[${nonce()}]`;
  return callClaude(prompt, CONCEPT_SYS, true) as Promise<Concept>;
}

function runtimeToSeconds(runtime: string): number | null {
  const match = runtime.trim().match(/^(\d+):(\d{2})$/);
  if (!match) return null;
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

export async function genStoryboard(
  concept: Concept,
  lyricSections: LyricSection[],
  runtime?: string
): Promise<Shot[]> {
  const totalSeconds = runtime ? runtimeToSeconds(runtime) : null;
  const prompt = `TREATMENT: ${concept.title} — ${concept.logline}
VISUAL STYLE: ${concept.visualStyle}
${totalSeconds ? `TOTAL SECONDS: ${totalSeconds} (shot durations must sum to this)` : ""}
CHARACTERS:
${concept.characters.map((c) => `- ${c.name}: ${c.description}`).join("\n")}

LOCATIONS:
${concept.locations.map((l) => `- ${l.name}: ${l.description}`).join("\n")}

LYRIC SECTIONS:
${lyricSections.map((s) => `[${s.label}]\n${s.lines.join("\n")}`).join("\n\n")}

SECTION BEATS:
${concept.sectionBeats.map((b) => `${b.section}: ${b.visual}`).join("\n")}

[${nonce()}]`;

  const result = await callClaude(prompt, STORYBOARD_SYS, true);
  const arr = result as Shot[] | { shots: Shot[] };
  const shots = Array.isArray(arr) ? arr : (arr as { shots: Shot[] }).shots || [];

  if (totalSeconds && shots.length) {
    normalizeDurations(shots, totalSeconds);
  }

  return shots;
}

function normalizeDurations(shots: Shot[], totalSeconds: number) {
  const raw = shots.map((s) => {
    const n = parseFloat(String(s.duration).replace(/[^\d.]/g, ""));
    return Number.isFinite(n) && n > 0 ? n : 1;
  });
  const sum = raw.reduce((a, b) => a + b, 0);
  if (sum <= 0) return;

  const scale = totalSeconds / sum;
  const scaled = raw.map((n) => Math.max(1, Math.round(n * scale)));

  const drift = totalSeconds - scaled.reduce((a, b) => a + b, 0);
  if (drift !== 0) {
    let idx = 0;
    for (let i = 1; i < scaled.length; i++) {
      if (scaled[i] > scaled[idx]) idx = i;
    }
    scaled[idx] = Math.max(1, scaled[idx] + drift);
  }

  shots.forEach((s, i) => {
    s.duration = `${scaled[i]}s`;
  });
}
