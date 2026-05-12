export interface SongInput {
  artist: string;
  title: string;
  genre: string;
  runtime: string;
  lyrics: string;
  concept: string;
}

export interface Idea {
  angle: string;
  pitch: string;
}

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
