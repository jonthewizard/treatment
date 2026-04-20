"use client";

import type { SongInput, Concept, Shot } from "@/types";
import { Block } from "@/components/ui/block";
import { RefCard } from "@/components/ui/ref-card";
import { ShotCard } from "@/components/ui/shot-card";
import { Btn } from "@/components/ui/btn";

interface ExportStageProps {
  input: SongInput;
  concept: Concept;
  shots: Shot[];
  onBack: () => void;
}

export function ExportStage({ input, concept, shots, onBack }: ExportStageProps) {
  return (
    <div>
      <div className="sticky top-0 z-20 border-b border-zinc-800 bg-black print:hidden">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
            06 · Export · {input.artist} — {concept.title}
          </div>
          <div className="flex gap-3">
            <Btn small onClick={onBack}>
              ← Back
            </Btn>
            <Btn small primary onClick={() => window.print()}>
              Print / PDF
            </Btn>
          </div>
        </div>
      </div>

      {/* Cover */}
      <section className="flex min-h-screen flex-col justify-between bg-zinc-950 p-12 print:break-after-page">
        <div className="font-mono text-[10px] uppercase tracking-widest text-zinc-400">
          Music Video Treatment
        </div>
        <div>
          <div className="font-mono text-xs uppercase tracking-wider text-zinc-400">
            {input.artist}
          </div>
          <div className="mt-3 font-serif text-7xl text-zinc-100">
            {concept.title}
          </div>
          <div className="mt-5 max-w-2xl border-l-2 border-zinc-100 pl-5 font-serif text-xl italic text-zinc-300">
            {concept.logline}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-6 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          <div>
            <div className="text-zinc-500">Song</div>
            <div className="mt-1 text-zinc-100">{input.title}</div>
          </div>
          <div>
            <div className="text-zinc-500">Genre</div>
            <div className="mt-1 text-zinc-100">{input.genre || "—"}</div>
          </div>
          <div>
            <div className="text-zinc-500">Runtime</div>
            <div className="mt-1 text-zinc-100">{input.runtime || "—"}</div>
          </div>
        </div>
      </section>

      {/* Treatment */}
      <section className="bg-zinc-900 p-12 print:break-after-page">
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
          <div className="flex h-12 w-full">
            {concept.palette.map((c, i) => (
              <div key={i} className="flex-1" style={{ background: c }} />
            ))}
          </div>
        </Block>
      </section>

      {/* Characters */}
      <section className="bg-black p-12 print:break-after-page">
        <Block label="Characters">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            {concept.characters.map((ch, i) => (
              <RefCard
                key={i}
                title={ch.name}
                subtitle={ch.role}
                description={ch.description}
                meta={ch.wardrobe}
                metaLabel="Wardrobe"
                seed={ch.name + ch.description}
                palette={concept.palette}
                aspect="3/4"
              />
            ))}
          </div>
        </Block>
      </section>

      {/* Locations */}
      <section className="bg-zinc-900 p-12 print:break-after-page">
        <Block label="Locations">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {concept.locations.map((loc, i) => (
              <RefCard
                key={i}
                title={loc.name}
                subtitle="Location"
                description={loc.description}
                meta={loc.lighting}
                metaLabel="Lighting"
                seed={loc.name + loc.description}
                palette={concept.palette}
                aspect="16/9"
              />
            ))}
          </div>
        </Block>
      </section>

      {/* Section Beats */}
      <section className="bg-black p-12 print:break-after-page">
        <Block label="Section Beats">
          {concept.sectionBeats.map((b, i) => (
            <div
              key={i}
              className="grid grid-cols-[140px_1fr] gap-4 border-t border-zinc-800 py-2"
            >
              <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                {b.section}
              </div>
              <div className="font-serif text-sm text-zinc-200">{b.visual}</div>
            </div>
          ))}
        </Block>
      </section>

      {/* Storyboard */}
      <section className="bg-zinc-900 p-12">
        <Block label="Storyboard">
          <div className="grid grid-cols-2 gap-4">
            {shots.map((s, i) => (
              <ShotCard key={i} shot={s} palette={concept.palette} />
            ))}
          </div>
        </Block>
      </section>

      <style>{`@media print { @page { margin: 0; size: A4; } }`}</style>
    </div>
  );
}
