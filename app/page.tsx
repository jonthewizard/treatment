"use client";

import { useState, useEffect } from "react";
import type { SongInput, Idea, Concept } from "@/types";
import { saveProject, loadProject } from "@/lib/storage";
import { InputStage } from "@/components/stages/input-stage";
import { IdeasStage } from "@/components/stages/ideas-stage";
import { ConceptStage } from "@/components/stages/concept-stage";

const EMPTY: SongInput = {
  artist: "",
  title: "",
  genre: "",
  runtime: "",
  lyrics: "",
};

const STAGE_LABELS = ["Input", "Ideas", "Treatment"];

export default function Home() {
  const [stage, setStage] = useState(0);
  const [input, setInput] = useState<SongInput>(EMPTY);
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [angle, setAngle] = useState<Idea | null>(null);
  const [concept, setConcept] = useState<Concept | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const p = loadProject();
    if (p) {
      setInput(p.input || EMPTY);
      setIdeas(p.ideas || null);
      setAngle(p.angle || null);
      setConcept(p.concept || null);
      setStage(Math.min(p.stage || 0, 2));
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveProject({ input, ideas, angle, concept, shots: [], stage });
  }, [input, ideas, angle, concept, stage, hydrated]);

  function canJump(i: number): boolean {
    if (i === 0) return true;
    if (i === 1) return !!input.lyrics.trim();
    if (i === 2) return !!concept;
    return false;
  }

  function reset() {
    if (!confirm("Reset everything?")) return;
    setInput(EMPTY);
    setIdeas(null);
    setAngle(null);
    setConcept(null);
    setStage(0);
  }

  function chooseAngle(a: Idea | null) {
    setAngle(a);
    setConcept(null);
    setStage(2);
  }

  return (
    <div className="min-h-screen bg-black text-zinc-100">
      <header className="border-b border-zinc-800 bg-black print:hidden">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="font-mono text-[10px] uppercase tracking-widest text-zinc-300">
            Music Video Treatment
          </div>
          <div className="flex items-center gap-6">
            <nav className="flex gap-4">
              {STAGE_LABELS.map((s, i) => (
                <button
                  key={s}
                  onClick={() => canJump(i) && setStage(i)}
                  disabled={!canJump(i)}
                  className={`font-mono text-[10px] uppercase tracking-wider transition cursor-pointer disabled:cursor-not-allowed ${
                    i === stage
                      ? "text-zinc-100"
                      : canJump(i)
                      ? "text-zinc-600 hover:text-zinc-300"
                      : "text-zinc-700"
                  }`}
                >
                  0{i + 1} {s}
                </button>
              ))}
            </nav>
            <button
              onClick={reset}
              className="font-mono text-[10px] uppercase tracking-wider text-zinc-600 hover:text-red-400 transition cursor-pointer"
            >
              Reset
            </button>
          </div>
        </div>
      </header>

      {stage === 0 && (
        <InputStage
          input={input}
          setInput={setInput}
          onNext={() => {
            setIdeas(null);
            setStage(1);
          }}
        />
      )}
      {stage === 1 && (
        <IdeasStage
          input={input}
          ideas={ideas}
          setIdeas={setIdeas}
          onChoose={chooseAngle}
          onBack={() => setStage(0)}
        />
      )}
      {stage === 2 && (
        <ConceptStage
          input={input}
          angle={angle}
          concept={concept}
          setConcept={setConcept}
          onBack={() => setStage(1)}
        />
      )}
    </div>
  );
}
