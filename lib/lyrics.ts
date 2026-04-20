import type { LyricSection } from "@/types";

export function parseLyrics(raw: string): LyricSection[] {
  const lines = raw.split("\n");
  const sections: LyricSection[] = [];
  let current: LyricSection = { label: "Intro", lines: [] };

  for (const line of lines) {
    const trimmed = line.trim();
    const header = trimmed.match(/^\[(.+?)\]$/);
    if (header) {
      if (current.lines.length) sections.push(current);
      current = { label: header[1], lines: [] };
    } else if (trimmed) {
      current.lines.push(trimmed);
    }
  }

  if (current.lines.length) sections.push(current);
  return sections.length
    ? sections
    : [{ label: "Lyrics", lines: lines.filter((l) => l.trim()) }];
}
