"use client";

import { useState, useEffect, useRef } from "react";
import type { SongInput, Idea, ShotMode } from "@/types";
import { genIdeas } from "@/lib/claude";
import { Loader } from "@/components/ui/loader";
import { Btn } from "@/components/ui/btn";

interface IdeasStageProps {
  input: SongInput;
  ideas: Idea[];
  setIdeas: (v: Idea[]) => void;
  shotMode: ShotMode;
  setShotMode: (m: ShotMode) => void;
  onChoose: (idea: Idea | null) => void;
  onBack: () => void;
}

export function IdeasStage({
  input,
  ideas,
  setIdeas,
  shotMode,
  setShotMode,
  onChoose,
  onBack,
}: IdeasStageProps) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Monotonically increasing id; only the latest run can commit its result.
  // Guards against StrictMode double-invoke and rapid clicks on "Generate new ideas".
  const runIdRef = useRef(0);
  const didInitRef = useRef(false);

  async function run() {
    const myId = ++runIdRef.current;
    setLoading(true);
    setErr(null);
    try {
      const result = await genIdeas(input);
      if (myId !== runIdRef.current) return;
      setIdeas(result);
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
    if (!ideas.length) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasLyrics = input.lyrics.trim().length > 20;

  return (
    <div className="mx-auto w-full max-w-[1200px] px-12 py-6">
      <div className="mb-6 flex items-center justify-between">
        <div className="text-xs font-medium text-white/50">
          {ideas.length
            ? `${ideas.length} directional ${
                ideas.length === 1 ? "idea" : "ideas"
              }`
            : "Directional ideas"}
        </div>
        <Btn small onClick={run} disabled={loading}>
          Generate new ideas
        </Btn>
      </div>

      {loading && (
        <Loader
          text={
            hasLyrics
              ? "reading lyrics · finding 3 treatments"
              : "reading concept · finding 3 treatments"
          }
        />
      )}
      {err && !loading && (
        <div className="text-xs text-red-400/80 py-4">
          {err}
          <button
            onClick={run}
            className="ml-4 underline hover:text-red-300 cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {ideas.length > 0 && !loading && (
        <>
          {/*
            Multi-shot mode is intentionally hidden from the UI for now —
            the app generates single detailed shots by default. The toggle,
            state plumbing (shotMode / setShotMode), and the multi-shot
            system prompt (SHOTLIST_SYS) are all preserved so we can bring
            it back later by re-rendering this label.
          */}
          {false && hasLyrics && (
            <label className="group/toggle mb-5 inline-flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={shotMode === "groups"}
                onChange={(e) =>
                  setShotMode(e.target.checked ? "groups" : "detailed")
                }
                className="sr-only"
              />
              <span
                aria-hidden
                className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-white/15 transition group-has-[:checked]/toggle:bg-white"
              >
                <span className="absolute left-0.5 inline-block h-4 w-4 rounded-full bg-white shadow-sm transition group-has-[:checked]/toggle:translate-x-4 group-has-[:checked]/toggle:bg-black" />
              </span>
              <span className="text-sm font-medium text-white/70">
                Use multi shot
              </span>
            </label>
          )}
          <div className="flex flex-col gap-4">
            {ideas.map((idea, i) => (
              <IdeaCard
                key={`${idea.treatmentTitle}-${i}`}
                idea={idea}
                canChoose={hasLyrics}
                onChoose={() => onChoose(idea)}
              />
            ))}
          </div>
        </>
      )}

      <div className="mt-8 flex items-center justify-between gap-4">
        <Btn onClick={onBack}>← Back</Btn>
        {ideas.length > 0 && !loading && !hasLyrics && (
          <div className="flex items-center gap-4">
            <div className="text-xs text-white/40">
              Add lyrics to generate the shot list.
            </div>
            <Btn primary onClick={onBack}>
              ← Add lyrics
            </Btn>
          </div>
        )}
      </div>
    </div>
  );
}

interface IdeaCardProps {
  idea: Idea;
  canChoose: boolean;
  onChoose: () => void;
}

function IdeaCard({ idea, canChoose, onChoose }: IdeaCardProps) {
  return (
    <div className="bg-white/[0.08] hover:bg-white/[0.12] border border-white/10 rounded-2xl p-6 transition">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0 flex-1">
          <div className="font-serif text-2xl text-white leading-tight">
            {idea.treatmentTitle}
          </div>
          <p className="mt-3 text-sm leading-relaxed text-white/70">
            {idea.pitch}
          </p>
        </div>
        {canChoose && (
          <div className="shrink-0">
            <Btn primary small onClick={onChoose}>
              Use this treatment →
            </Btn>
          </div>
        )}
      </div>
    </div>
  );
}
