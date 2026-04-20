"use client";

import type { Concept } from "@/types";
import { Block } from "@/components/ui/block";
import { RefCard } from "@/components/ui/ref-card";
import { Btn } from "@/components/ui/btn";

interface RefsStageProps {
  concept: Concept;
  onNext: () => void;
  onBack: () => void;
}

export function RefsStage({ concept, onNext, onBack }: RefsStageProps) {
  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
        04 · References
      </div>

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

      <div className="mt-8 flex justify-between">
        <Btn onClick={onBack}>← Back</Btn>
        <Btn primary onClick={onNext}>
          Storyboard →
        </Btn>
      </div>
    </div>
  );
}
