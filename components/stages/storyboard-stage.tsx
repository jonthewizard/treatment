"use client";

import { useState, useEffect } from "react";
import type { SongInput, Concept, Shot } from "@/types";
import { genStoryboard } from "@/lib/claude";
import { parseLyrics } from "@/lib/lyrics";
import { Loader } from "@/components/ui/loader";
import { ShotCard } from "@/components/ui/shot-card";
import { Btn } from "@/components/ui/btn";

interface StoryboardStageProps {
  input: SongInput;
  concept: Concept;
  shots: Shot[];
  setShots: (v: Shot[]) => void;
  onNext: () => void;
  onBack: () => void;
}

export function StoryboardStage({
  input,
  concept,
  shots,
  setShots,
  onNext,
  onBack,
}: StoryboardStageProps) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const sections = parseLyrics(input.lyrics);

  async function run() {
    setLoading(true);
    setErr(null);
    try {
      setShots(await genStoryboard(concept, sections));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!shots?.length && !loading) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return <Loader text="breaking into shots" />;
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

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <div className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
          05 · Storyboard · {shots.length} shots
        </div>
        <Btn small onClick={run}>
          Regenerate
        </Btn>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {shots.map((s, i) => (
          <ShotCard key={i} shot={s} palette={concept.palette} />
        ))}
      </div>

      <div className="mt-8 flex justify-between">
        <Btn onClick={onBack}>← Back</Btn>
        <Btn primary onClick={onNext}>
          Export →
        </Btn>
      </div>
    </div>
  );
}
