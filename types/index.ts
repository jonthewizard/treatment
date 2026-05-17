export interface SongInput {
  artist: string;
  title: string;
  genre: string;
  runtime: string;
  lyrics: string;
  concept: string;
}

export interface Idea {
  /** Short slide-style title for this director pitch */
  treatmentTitle: string;
  /** Single paragraph pitch (~150–220 words) */
  pitch: string;
}

// "groups" — multi-shot groups of up to 15s each (Kling multi_prompt mode).
//   Optimised for fast cutting across many short shots.
// "detailed" — each shot is its own single-prompt Kling generation with a
//   per-shot duration (5–15s) and a much denser, more cinematographic prompt.
export type ShotMode = "groups" | "detailed";

// Per-shot entry for Kling multi-shot mode (≤6 shots per group)
export interface ShotEntry {
  // Complete Kling per-shot prompt (look + description + camera + timing + effect)
  prompt: string;
  duration: string; // "Ns"
}

// One Kling generation: a ≤15s bundle of shots with ready-to-use prompts
// generated directly by the LLM — no reformatting applied.
export interface ShotGroup {
  groupNumber: number;
  totalSeconds: number;
  // Complete Kling single-prompt. Character tags are plain ALL-CAPS tokens;
  // <<<image_N>>> reference markers are injected at runtime when portraits exist.
  prompt: string;
  // Still image prompt for Nano Banana 2 first-frame reference.
  imagePrompt: string;
  // Per-shot prompts for Kling multi-shot mode (used when ≤6 shots).
  shots: ShotEntry[];
}

export interface LyricSection {
  label: string;
  lines: string[];
}

// Two-phase generation: a ShotStub is the lightweight planning record
// emitted by OUTLINE_SYS (phase 1). Each stub locks the shot's framing,
// subject, location, duration, and a one-line summary so that the parallel
// expansion pass (phase 2, EXPAND_SYS) produces dense Kling prose against
// a fixed plan. Stubs are NEVER sent to Kling directly — they always go
// through expansion first.
export interface ShotStub {
  shotNumber: number;
  seconds: number;
  lyricSection: string;
  lyricLine: string;
  framing: string;
  subject: string;
  location: string;
  summary: string;
}

// Output of phase 1 (OUTLINE_SYS). Carries the canonical bible (look,
// cast, locations) that phase 2 expansions inherit verbatim, plus the
// ordered shot stubs. shotCount mirrors outline.length and is emitted as
// the FIRST JSON field so a UI can show "N of M" progress live as the
// stream arrives.
export interface ShotlistOutline {
  shotCount: number;
  look: string;
  characters: Character[];
  locations: Location[];
  outline: ShotStub[];
}

export interface GroupVideo {
  url: string;
  predictionId: string;
}

export interface GroupImage {
  url: string;
  predictionId: string;
}

export interface Character {
  tag: string;
  description: string;
}

export interface CharacterPortrait {
  url: string;
  predictionId: string;
}

export interface Location {
  tag: string;
  description: string;
}

export interface LocationPortrait {
  url: string;
  predictionId: string;
}

export interface ProjectState {
  input: SongInput;
  ideas: Idea[];
  angle: Idea | null;
  shotMode?: ShotMode | null;
  groups: ShotGroup[];
  look?: string | null;
  characters?: Character[] | null;
  portraits?: Record<string, CharacterPortrait> | null;
  locations?: Location[] | null;
  locationPortraits?: Record<string, LocationPortrait> | null;
  videos?: Record<number, GroupVideo> | null;
  images?: Record<number, GroupImage> | null;
  stage: number;
}
