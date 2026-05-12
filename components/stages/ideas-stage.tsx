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
    <div className="mx-auto max-w-4xl px-6 py-8">
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
              ? "reading lyrics · finding 3 angles"
              : "reading concept · finding 3 angles"
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
          {hasLyrics && (
            <div className="mb-5 flex flex-col gap-2">
              <div className="text-sm font-medium text-white/60">
                Shot list mode
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex gap-1 rounded-full border border-white/10 bg-white/5 p-1">
                  <button
                    onClick={() => setShotMode("groups")}
                    className={`cursor-pointer rounded-full px-4 py-1 text-sm font-medium transition ${
                      shotMode === "groups"
                        ? "bg-white text-black shadow-sm"
                        : "text-white/60 hover:bg-white/5 hover:text-white/90"
                    }`}
                  >
                    Multi-shot groups
                  </button>
                  <button
                    onClick={() => setShotMode("detailed")}
                    className={`cursor-pointer rounded-full px-4 py-1 text-sm font-medium transition ${
                      shotMode === "detailed"
                        ? "bg-white text-black shadow-sm"
                        : "text-white/60 hover:bg-white/5 hover:text-white/90"
                    }`}
                  >
                    Individual detailed shots
                  </button>
                </div>
                <p className="text-sm text-white/40">
                  {shotMode === "groups"
                    ? "Fast-cut groups up to 15 seconds each."
                    : "Each shot is its own clip, 3–15s, with denser cinematography prompts."}
                </p>
              </div>
            </div>
          )}
          <div className="flex flex-col gap-4">
            {ideas.map((idea, i) => (
              <IdeaCard
                key={`${idea.angle}-${i}`}
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
            {idea.angle}
          </div>
          <p className="mt-3 text-sm leading-relaxed text-white/70">
            {idea.pitch}
          </p>
        </div>
        {canChoose && (
          <div className="shrink-0">
            <Btn primary small onClick={onChoose}>
              Use this angle →
            </Btn>
          </div>
        )}
      </div>
    </div>
  );
}
