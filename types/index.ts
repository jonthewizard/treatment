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

export interface Character {
  name: string;
  role: string;
  description: string;
  wardrobe: string;
}

export interface Location {
  name: string;
  description: string;
  lighting: string;
}

export interface SectionBeat {
  section: string;
  visual: string;
}

export interface Concept {
  title: string;
  logline: string;
  lyricReading: string;
  synopsis: string;
  tone: string[];
  visualStyle: string;
  palette: string[];
  characters: Character[];
  locations: Location[];
  sectionBeats: SectionBeat[];
}

export interface Shot {
  shotNumber: number;
  section: string;
  lyricLine: string;
  shotType: string;
  cameraMovement: string;
  description: string;
  location: string;
  characters: string[];
  duration: string;
}

export interface LyricSection {
  label: string;
  lines: string[];
}

export interface ProjectState {
  input: SongInput;
  ideas: Idea[] | null;
  angle: Idea | null;
  concept: Concept | null;
  shots: Shot[];
  stage: number;
}
