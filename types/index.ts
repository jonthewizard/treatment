export interface SongInput {
  artist: string;
  title: string;
  genre: string;
  runtime: string;
  lyrics: string;
}

export interface Idea {
  angle: string;
  pitch: string;
}

export interface Shot {
  shotNumber: number;
  section: string;
  lyricLine: string;
  duration: string;
  name: string;
  effect: string;
  visual: string;
  camera: string;
  timing: string;
  transition: string;
  signature?: boolean;
}

// One Seedance generation: a contiguous run of shots whose total duration
// is <= 15s. Each group is rendered as a single concatenated prompt.
export interface ShotGroup {
  groupNumber: number;
  totalSeconds: number;
  shots: Shot[];
}

export interface LyricSection {
  label: string;
  lines: string[];
}

// Per-group production specs prepended to that group's Seedance prompt to
// keep its shots visually consistent within the scene.
export interface TreatmentSpecs {
  subject: string;
  setting: string;
  mood: string;
  effects: string;
  references: string;
  palette: string;
}

// Generated Seedance video for a single shot group, keyed by ShotGroup.groupNumber.
export interface GroupVideo {
  url: string;
  predictionId: string;
}

export interface ProjectState {
  input: SongInput;
  idea: Idea | null;
  angle: Idea | null;
  shots: Shot[];
  // One TreatmentSpecs per group, aligned to groupShots(shots) order.
  specs: TreatmentSpecs[] | null;
  // Keyed by ShotGroup.groupNumber. Cleared when shots regenerate since
  // groupings can shift.
  videos?: Record<number, GroupVideo> | null;
  stage: number;
}
