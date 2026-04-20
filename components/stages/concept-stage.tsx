"use client";

import { useState, useEffect } from "react";
import type { SongInput, Idea, Concept, Shot } from "@/types";
import { genConcept, genStoryboard } from "@/lib/claude";
import { parseLyrics } from "@/lib/lyrics";
import { Loader } from "@/components/ui/loader";
import { Block } from "@/components/ui/block";
import { Btn } from "@/components/ui/btn";

interface ConceptStageProps {
  input: SongInput;
  angle: Idea | null;
  concept: Concept | null;
  setConcept: (v: Concept) => void;
  onBack: () => void;
}

function toMarkdown(input: SongInput, concept: Concept, shots: Shot[]): string {
  const lines: string[] = [];

  lines.push(`# ${concept.title}`);
  lines.push("");
  lines.push(`**${input.artist} — ${input.title}**`);
  if (input.genre) lines.push(`*Genre: ${input.genre}*`);
  if (input.runtime) lines.push(`*Runtime: ${input.runtime}*`);
  lines.push("");
  lines.push(`> ${concept.logline}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  lines.push("## What the Lyrics Give Us");
  lines.push("");
  lines.push(concept.lyricReading);
  lines.push("");

  lines.push("## Synopsis");
  lines.push("");
  lines.push(concept.synopsis);
  lines.push("");

  lines.push("## Tone");
  lines.push("");
  lines.push(concept.tone.map((t) => `\`${t}\``).join("  "));
  lines.push("");

  lines.push("## Visual Style");
  lines.push("");
  lines.push(concept.visualStyle);
  lines.push("");

  lines.push("## Colour Palette");
  lines.push("");
  lines.push(concept.palette.join("  ·  "));
  lines.push("");

  if (concept.characters.length) {
    lines.push("## Characters");
    lines.push("");
    for (const c of concept.characters) {
      lines.push(`### ${c.name}`);
      lines.push(`**Role:** ${c.role}`);
      lines.push("");
      lines.push(c.description);
      lines.push("");
      lines.push(`**Wardrobe:** ${c.wardrobe}`);
      lines.push("");
    }
  }

  if (concept.locations.length) {
    lines.push("## Locations");
    lines.push("");
    for (const l of concept.locations) {
      lines.push(`### ${l.name}`);
      lines.push(l.description);
      lines.push("");
      lines.push(`**Lighting:** ${l.lighting}`);
      lines.push("");
    }
  }

  if (concept.sectionBeats.length) {
    lines.push("## Section Beats");
    lines.push("");
    lines.push("| Section | Visual |");
    lines.push("|---------|--------|");
    for (const b of concept.sectionBeats) {
      lines.push(`| ${b.section} | ${b.visual} |`);
    }
    lines.push("");
  }

  if (shots.length) {
    lines.push("## Storyboard");
    lines.push("");
    for (const s of shots) {
      const num = String(s.shotNumber).padStart(2, "0");
      lines.push(`### Shot ${num} — ${s.shotType} · ${s.cameraMovement} · ${s.duration}`);
      lines.push(`**${s.section}**`);
      if (s.lyricLine) lines.push(`*"${s.lyricLine}"*`);
      lines.push("");
      lines.push(s.description);
      lines.push("");
      const meta = [`Location: ${s.location}`];
      if (s.characters?.length) meta.push(`Characters: ${s.characters.join(", ")}`);
      lines.push(meta.join("  ·  "));
      lines.push("");
    }
  }

  return lines.join("\n");
}

export function ConceptStage({
  input,
  angle,
  concept,
  setConcept,
  onBack,
}: ConceptStageProps) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [shotsLoading, setShotsLoading] = useState(false);
  const [shotsErr, setShotsErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function run() {
    setLoading(true);
    setErr(null);
    setShots([]);
    try {
      setConcept(await genConcept(input, angle));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function runShots(c: Concept) {
    setShotsLoading(true);
    setShotsErr(null);
    try {
      setShots(await genStoryboard(c, parseLyrics(input.lyrics), input.runtime || undefined));
    } catch (e) {
      setShotsErr((e as Error).message);
    } finally {
      setShotsLoading(false);
    }
  }

  useEffect(() => {
    if (!concept && !loading) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (concept && !shots.length && !shotsLoading) runShots(concept);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [concept]);

  if (loading) return <Loader text="drafting the treatment" />;
  if (err)
    return (
      <div className="mx-auto max-w-3xl px-6 py-10 font-mono text-xs text-red-400">
        {err}
        <button
          onClick={run}
          className="ml-4 underline hover:text-red-300 cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  if (!concept) return null;

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <div className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
          03 · Treatment
        </div>
        <Btn small onClick={run}>
          Regenerate
        </Btn>
      </div>

      <h1 className="font-serif text-5xl text-zinc-100">{concept.title}</h1>
      <p className="mt-3 border-l-2 border-zinc-100 pl-4 font-serif text-xl italic text-zinc-200">
        {concept.logline}
      </p>

      <Block label="What the lyrics gave us">
        <p className="font-serif text-base leading-relaxed text-zinc-200">
          {concept.lyricReading}
        </p>
      </Block>

      <Block label="Synopsis">
        {concept.synopsis.split(/\n\n+/).map((p, i) => (
          <p key={i} className="mb-3 font-serif text-base leading-relaxed text-zinc-200">
            {p}
          </p>
        ))}
      </Block>

      <Block label="Tone">
        <div className="flex flex-wrap gap-2">
          {concept.tone.map((t, i) => (
            <span
              key={i}
              className="border border-zinc-700 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-zinc-300"
            >
              {t}
            </span>
          ))}
        </div>
      </Block>

      <Block label="Visual Style">
        <p className="font-serif text-base leading-relaxed text-zinc-200">
          {concept.visualStyle}
        </p>
      </Block>

      <Block label="Palette">
        <div className="flex h-16 w-full">
          {concept.palette.map((c, i) => (
            <div
              key={i}
              className="relative flex-1 group"
              style={{ background: c }}
            >
              <span className="absolute bottom-1 left-2 font-mono text-[9px] text-white/90 opacity-0 group-hover:opacity-100 transition-opacity">
                {c}
              </span>
            </div>
          ))}
        </div>
      </Block>

      <Block label="Section Beats">
        <div className="space-y-2">
          {concept.sectionBeats.map((b, i) => (
            <div
              key={i}
              className="grid grid-cols-[140px_1fr] gap-4 border-t border-zinc-800 pt-2"
            >
              <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                {b.section}
              </div>
              <div className="font-serif text-sm text-zinc-200">{b.visual}</div>
            </div>
          ))}
        </div>
      </Block>

      <Block label="Storyboard">
        {shotsLoading && <Loader text="building shot list" />}
        {shotsErr && (
          <div className="font-mono text-xs text-red-400 py-2">
            {shotsErr}
            <button
              onClick={() => runShots(concept)}
              className="ml-3 underline hover:text-red-300 cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}
        {shots.length > 0 && (
          <div className="space-y-0">
            {shots.map((s, i) => (
              <div
                key={i}
                className="grid grid-cols-[2rem_1fr] gap-x-4 border-t border-zinc-800 py-3"
              >
                <div className="font-mono text-[10px] text-zinc-600 pt-0.5">
                  {String(s.shotNumber).padStart(2, "0")}
                </div>
                <div>
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">
                      {s.shotType} · {s.cameraMovement} · {s.duration}
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-600">
                      {s.section}
                    </span>
                  </div>
                  {s.lyricLine && (
                    <div className="mt-1 font-serif text-xs italic text-zinc-500">
                      &ldquo;{s.lyricLine}&rdquo;
                    </div>
                  )}
                  <p className="mt-1.5 font-serif text-sm leading-snug text-zinc-200">
                    {s.description}
                  </p>
                  <div className="mt-1.5 font-mono text-[9px] uppercase tracking-wider text-zinc-600">
                    <span className="text-zinc-700">loc:</span> {s.location}
                    {s.characters?.length > 0 && (
                      <>
                        {" · "}
                        <span className="text-zinc-700">in:</span>{" "}
                        {Array.isArray(s.characters)
                          ? s.characters.join(", ")
                          : s.characters}
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        {!shotsLoading && !shotsErr && !shots.length && (
          <button
            onClick={() => runShots(concept)}
            className="font-mono text-[10px] uppercase tracking-wider text-zinc-600 hover:text-zinc-300 transition cursor-pointer py-2"
          >
            Generate Shot List
          </button>
        )}
      </Block>

      <div className="mt-8 flex justify-between">
        <Btn onClick={onBack}>← Back</Btn>
        <div className="flex gap-3">
          <Btn
            small
            onClick={() => {
              const md = toMarkdown(input, concept, shots);
              navigator.clipboard.writeText(md).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              });
            }}
          >
            {copied ? "Copied!" : "Copy Markdown"}
          </Btn>
          <Btn
            primary
            onClick={() => {
              const md = toMarkdown(input, concept, shots);
              const blob = new Blob([md], { type: "text/markdown" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `${input.artist} - ${concept.title}.md`
                .replace(/[^\w\s.-]/g, "")
                .replace(/\s+/g, "-");
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            Download .md
          </Btn>
        </div>
      </div>
    </div>
  );
}
