import type {
  SongInput,
  Idea,
  Shot,
  ShotGroup,
  LyricSection,
  TreatmentSpecs,
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

function randomNudge(): string {
  return `lean ${pick(AESTHETIC_NUDGES)}, ${pick(NARRATIVE_NUDGES)}, ${pick(LENS_NUDGES)}`;
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

export async function genIdeas(input: SongInput): Promise<Idea> {
  const prompt = `Artist: ${input.artist}\nSong: ${input.title}\nGenre: ${input.genre || "n/a"}\n\nLYRICS:\n${input.lyrics}\n\nFor this idea, ${randomNudge()}.\n\n[${nonce()}]`;
  return callClaude(prompt, IDEAS_SYS, true) as Promise<Idea>;
}

function runtimeToSeconds(runtime: string): number | null {
  const match = runtime.trim().match(/^(\d+):(\d{2})$/);
  if (!match) return null;
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

// Seedance 2.0 hard limit: each generation (i.e. each grouped prompt) is at
// most 15s of footage.
const MAX_SHOT_SECONDS = 15;

// Soft cap on individual shot duration after normalization. Keeps groups
// densely packed (3-5 shots per 15s) instead of scaling shots up to fill
// runtime when the LLM undershoots the requested shot count.
const MAX_SHOT_SECONDS_SOFT = 5;

type SectionSpec = TreatmentSpecs & { section: string };

export interface ShotlistResult {
  shots: Shot[];
  // One TreatmentSpecs per group, aligned to groupShots(shots) order.
  specs: TreatmentSpecs[];
}

export async function genShotlist(
  input: SongInput,
  angle: Idea | null
): Promise<ShotlistResult> {
  const sections: LyricSection[] = parseLyrics(input.lyrics);
  const totalSeconds = input.runtime ? runtimeToSeconds(input.runtime) : null;

  // Density per the Duration calibration table: 8-14 shots per 15s segment.
  // Lower bound for min, midpoint for target.
  const minShots = totalSeconds
    ? Math.ceil((totalSeconds * 8) / 15)
    : null;
  const targetShots = totalSeconds
    ? Math.round((totalSeconds * 11) / 15)
    : null;

  const prompt = `Artist: ${input.artist}
Song: ${input.title}
Genre: ${input.genre || "n/a"}
${totalSeconds ? `TOTAL SECONDS: ${totalSeconds} (shot durations must sum to this)` : ""}
${
    totalSeconds
      ? `\n*** SHOT REQUIREMENTS (NON-NEGOTIABLE) ***
1. Return AT LEAST ${minShots} shots. Target ~${targetShots} shots.
2. Shot durations MUST sum to ${totalSeconds} seconds (the song length).
3. EVERY SHOT MUST BE 1-5 SECONDS. No shot may exceed 5 seconds.
4. Density per the Duration calibration table: 8-14 shots per 15-second grouped Seedance generation. Most shots 1-2 seconds.
5. VARY durations: mix 1s, 2s, 3s, 4s, 5s based on what each shot needs.
   - Default to 1-2s. Use 3-4s sparingly for breathing room, 5s only for sustained signature moments.
   - If most of your shots are the same length, you are doing it wrong.
6. If you produce fewer than ${minShots} shots OR all shots are similar lengths, your output is INVALID.
*** END REQUIREMENT ***\n`
      : ""
  }${angle ? `\nDirectional angle: ${angle.angle} — ${angle.pitch}\n` : ""}
LYRIC SECTIONS:
${sections.map((s) => `[${s.label}]\n${s.lines.join("\n")}`).join("\n\n")}

Build the Seedance 2.0–optimised shot list for this song now. Tie each shot to a lyric section and a specific lyric line. Mark exactly one shot as the signature visual. Vary shot durations 1-5s based on each shot's intent. ${
    totalSeconds
      ? `Return at least ${minShots} shots, targeting ${targetShots}, durations summing to ${totalSeconds}s.`
      : ""
  }

[${nonce()}]`;

  const result = (await callClaude(prompt, SHOTLIST_SYS, true)) as
    | Shot[]
    | { shots?: Shot[]; sectionSpecs?: SectionSpec[] };

  let shots: Shot[];
  let sectionSpecs: SectionSpec[];
  if (Array.isArray(result)) {
    shots = result;
    sectionSpecs = [];
  } else {
    shots = result.shots ?? [];
    sectionSpecs = Array.isArray(result.sectionSpecs) ? result.sectionSpecs : [];
  }

  if (shots.length) {
    normalizeDurations(shots);
  }

  shots = capShotDurations(shots);

  const groups = groupShots(shots);
  const specs = mapSpecsToGroups(groups, sectionSpecs);

  return { shots, specs };
}

// For each group, look up the spec belonging to its first shot's section.
// Sections that don't match any sectionSpec entry fall back to empty.
function mapSpecsToGroups(
  groups: ShotGroup[],
  sectionSpecs: SectionSpec[]
): TreatmentSpecs[] {
  if (!groups.length) return [];
  const bySection = new Map<string, TreatmentSpecs>();
  for (const s of sectionSpecs) {
    if (!s || typeof s.section !== "string") continue;
    const { section: _section, ...rest } = s;
    void _section;
    bySection.set(s.section.trim().toLowerCase(), rest);
  }

  return groups.map((g) => {
    const sectionLabel = g.shots[0]?.section?.trim().toLowerCase() ?? "";
    return (
      bySection.get(sectionLabel) ?? {
        subject: "",
        setting: "",
        mood: "",
        effects: "",
        references: "",
        palette: "",
      }
    );
  });
}

// Clamp each shot's duration to [1, MAX_SHOT_SECONDS_SOFT] without rescaling.
// We deliberately do NOT scale up to fit total runtime — that destroys the
// LLM's intentional duration variety (everything ends up flattened at the cap
// when the LLM undershoots the count). Instead the prompt forces the LLM to
// own the count/runtime relationship, and we just enforce per-shot bounds.
function normalizeDurations(shots: Shot[]) {
  shots.forEach((s) => {
    const n = parseFloat(String(s.duration).replace(/[^\d.]/g, ""));
    const safe = Number.isFinite(n) && n > 0 ? Math.round(n) : 3;
    const clamped = Math.max(1, Math.min(MAX_SHOT_SECONDS_SOFT, safe));
    s.duration = `${clamped}s`;
  });
}

function parseDurationSeconds(d: string | undefined): number {
  if (!d) return 0;
  const n = parseFloat(String(d).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Split a duration into chunks of at most maxSeconds.
function splitDuration(seconds: number, maxSeconds: number): number[] {
  if (seconds <= maxSeconds) return [Math.max(1, Math.round(seconds))];
  const out: number[] = [];
  let remaining = Math.round(seconds);
  while (remaining > maxSeconds) {
    out.push(maxSeconds);
    remaining -= maxSeconds;
  }
  if (remaining > 0) out.push(remaining);
  return out;
}

// Cap each shot's duration at 15s by splitting into multiple segments that
// share the same structured fields. Only the first segment keeps
// `signature: true`; intermediate segments swap their transition for a
// continuation note so the final segment still describes the cut to the next
// shot. Renumbers sequentially.
function capShotDurations(shots: Shot[]): Shot[] {
  const out: Shot[] = [];
  let n = 1;
  for (const shot of shots) {
    const seconds = parseDurationSeconds(shot.duration) || 1;
    const segs = splitDuration(seconds, MAX_SHOT_SECONDS);
    segs.forEach((sec, i) => {
      const isLast = i === segs.length - 1;
      out.push({
        ...shot,
        shotNumber: n++,
        duration: `${sec}s`,
        signature: i === 0 ? shot.signature : false,
        transition: isLast
          ? shot.transition
          : "Continues directly into the next segment of this shot.",
      });
    });
  }
  return out;
}

// Build the canonical Seedance shot block from structured fields.
function formatShotBlock(s: Shot, timestamp: string): string {
  const num = String(s.shotNumber).padStart(2, "0");
  const nameSuffix = s.signature
    ? `${s.name} — SIGNATURE VISUAL EFFECT`
    : s.name;
  return [
    `SHOT ${num} (${timestamp}) — ${nameSuffix}`,
    `• EFFECT: ${s.effect}`,
    `• ${s.visual}`,
    `• ${s.camera}`,
    `• ${s.timing}`,
    `• ${s.transition}`,
  ].join("\n");
}

function secondsToTimecode(total: number): string {
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Group consecutive shots into bundles whose combined duration is <= 15s.
// Each bundle is a single Seedance generation. Greedy first-fit: keep adding
// the next shot until it would push the bundle over 15s, then start a new one.
export function groupShots(shots: Shot[]): ShotGroup[] {
  const groups: ShotGroup[] = [];
  let current: Shot[] = [];
  let currentSeconds = 0;

  for (const shot of shots) {
    const sec = parseDurationSeconds(shot.duration) || 1;
    if (current.length > 0 && currentSeconds + sec > MAX_SHOT_SECONDS) {
      groups.push({
        groupNumber: groups.length + 1,
        totalSeconds: currentSeconds,
        shots: current,
      });
      current = [];
      currentSeconds = 0;
    }
    current.push(shot);
    currentSeconds += sec;
  }
  if (current.length > 0) {
    groups.push({
      groupNumber: groups.length + 1,
      totalSeconds: currentSeconds,
      shots: current,
    });
  }
  return groups;
}

// Build the full Seedance prompt for a group: an optional TREATMENT SPECS
// header (repeated for every group to keep generations consistent) followed
// by concatenated SHOT blocks. Cumulative timecodes are seeded so the first
// shot of each group reflects its position in the overall song.
export function formatGroupPrompt(
  group: ShotGroup,
  startSeconds: number,
  specs?: TreatmentSpecs | null
): string {
  let cursor = startSeconds;
  const blocks = group.shots.map((s) => {
    const ts = secondsToTimecode(cursor);
    cursor += parseDurationSeconds(s.duration) || 0;
    return formatShotBlock(s, ts);
  });
  const body = blocks.join("\n\n");

  const header = specs ? formatSpecsHeader(specs, group.totalSeconds) : "";
  return header ? `${header}\n\n${body}` : body;
}

// Header block prepended to every group prompt. Lists treatment-level
// constants (subject, setting, mood, effects, references, palette) plus the
// per-group duration target so each Seedance generation gets full context.
function formatSpecsHeader(
  specs: TreatmentSpecs,
  groupSeconds: number
): string {
  const rows: [string, string | undefined][] = [
    ["Subject", specs.subject],
    ["Setting", specs.setting],
    ["Mood", specs.mood],
    ["Effects/Camera", specs.effects],
    ["References", specs.references],
    ["Palette/Grade", specs.palette],
    ["Duration target", `${groupSeconds}s`],
  ];
  const bullets = rows
    .filter(([, v]) => v && v.trim())
    .map(([k, v]) => `• ${k}: ${v!.trim()}`);
  if (!bullets.length) return "";
  return ["TREATMENT SPECS", ...bullets].join("\n");
}
