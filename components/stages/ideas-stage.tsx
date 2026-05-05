"use client";

import { useState, useEffect, useRef } from "react";
import type { SongInput, Idea } from "@/types";
import { genIdeas } from "@/lib/claude";
import { Loader } from "@/components/ui/loader";
import { Btn } from "@/components/ui/btn";

interface IdeasStageProps {
  input: SongInput;
  idea: Idea | null;
  setIdea: (v: Idea) => void;
  onChoose: (idea: Idea | null) => void;
  onBack: () => void;
}

export function IdeasStage({
  input,
  idea,
  setIdea,
  onChoose,
  onBack,
}: IdeasStageProps) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Monotonically increasing id; only the latest run can commit its result.
  // Guards against StrictMode double-invoke and rapid clicks on "Generate new idea".
  const runIdRef = useRef(0);
  const didInitRef = useRef(false);

  async function run() {
    const myId = ++runIdRef.current;
    setLoading(true);
    setErr(null);
    try {
      const result = await genIdeas(input);
      if (myId !== runIdRef.current) return;
      setIdea(result);
    } catch (e) {
      if (myId !== runIdRef.current) return;
      setErr((e as Error).message);
    } finally {
      if (myId === runIdRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;
    if (!idea) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <div className="font-mono text-xs uppercase tracking-widest text-zinc-500">
          02 · Directional Idea
        </div>
        <Btn small onClick={run} disabled={loading}>
          Generate new idea
        </Btn>
      </div>

      {loading && <Loader text="reading lyrics · finding an angle" />}
      {err && !loading && (
        <div className="font-mono text-xs text-red-400 py-4">
          {err}
          <button
            onClick={run}
            className="ml-4 underline hover:text-red-300 cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {idea && !loading && (
        <div className="border border-zinc-800 bg-zinc-900 p-8">
          <div className="font-serif text-4xl text-zinc-100">
            {idea.angle}
          </div>
          <p className="mt-4 font-serif text-lg leading-snug text-zinc-300">
            {idea.pitch}
          </p>
        </div>
      )}

      <div className="mt-6 flex justify-between">
        <Btn onClick={onBack}>← Back</Btn>
        {idea && !loading && (
          <Btn primary onClick={() => onChoose(idea)}>
            Use this angle →
          </Btn>
        )}
      </div>
    </div>
  );
}
