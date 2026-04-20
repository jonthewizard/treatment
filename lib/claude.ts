import type { SongInput, Idea, Concept, Shot, LyricSection } from "@/types";
import { IDEAS_SYS, CONCEPT_SYS, STORYBOARD_SYS } from "@/lib/prompts";

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

  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}

export async function genIdeas(input: SongInput): Promise<Idea[]> {
  const prompt = `Artist: ${input.artist}\nSong: ${input.title}\nGenre: ${input.genre || "n/a"}\n\nLYRICS:\n${input.lyrics}\n\n[${nonce()}]`;
  return callClaude(prompt, IDEAS_SYS, true) as Promise<Idea[]>;
}

export async function genConcept(
  input: SongInput,
  angle: Idea | null
): Promise<Concept> {
  const prompt = `Artist: ${input.artist}\nSong: ${input.title}\nGenre: ${input.genre || "n/a"}\n${
    angle ? `\nDirectional angle: ${angle.angle} — ${angle.pitch}\n` : ""
  }\nLYRICS:\n${input.lyrics}\n\nTie sectionBeats to the lyric section labels.\n\n[${nonce()}]`;
  return callClaude(prompt, CONCEPT_SYS, true) as Promise<Concept>;
}

export async function genStoryboard(
  concept: Concept,
  lyricSections: LyricSection[],
  runtime?: string
): Promise<Shot[]> {
  const prompt = `TREATMENT: ${concept.title} — ${concept.logline}
VISUAL STYLE: ${concept.visualStyle}
${runtime ? `SONG RUNTIME: ${runtime}` : ""}
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
  return Array.isArray(arr) ? arr : (arr as { shots: Shot[] }).shots || [];
}
