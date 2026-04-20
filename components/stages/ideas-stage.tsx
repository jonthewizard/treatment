"use client";

import { useState, useEffect } from "react";
import type { SongInput, Idea } from "@/types";
import { genIdeas } from "@/lib/claude";
import { Loader } from "@/components/ui/loader";
import { Btn } from "@/components/ui/btn";

interface IdeasStageProps {
  input: SongInput;
  ideas: Idea[] | null;
  setIdeas: (v: Idea[]) => void;
  onChoose: (idea: Idea | null) => void;
  onBack: () => void;
}

export function IdeasStage({
  input,
  ideas,
  setIdeas,
  onChoose,
  onBack,
}: IdeasStageProps) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setErr(null);
    try {
      setIdeas(await genIdeas(input));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!ideas && !loading) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <div className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
          02 · Directional Ideas
        </div>
        <Btn small onClick={run}>
          Regenerate
        </Btn>
      </div>

      {loading && <Loader text="reading lyrics · finding angles" />}
      {err && (
        <div className="font-mono text-xs text-red-400 py-4">{err}</div>
      )}

      {ideas && !loading && (
        <div className="grid grid-cols-2 gap-4">
          {ideas.map((idea, i) => (
            <button
              key={i}
              onClick={() => onChoose(idea)}
              className="group border border-zinc-800 bg-zinc-900 p-5 text-left transition hover:border-zinc-100 cursor-pointer"
            >
              <div className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                Angle 0{i + 1}
              </div>
              <div className="mt-1 font-serif text-2xl text-zinc-100">
                {idea.angle}
              </div>
              <p className="mt-3 font-serif text-base leading-snug text-zinc-300">
                {idea.pitch}
              </p>
              <div className="mt-4 font-mono text-[10px] uppercase tracking-widest text-zinc-600 group-hover:text-zinc-100 transition-colors">
                Select →
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="mt-6">
        <Btn onClick={onBack}>← Back</Btn>
      </div>
    </div>
  );
}
