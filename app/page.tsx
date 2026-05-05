"use client";

import { useState, useEffect, useRef } from "react";
import type { SongInput, Idea, Shot, TreatmentSpecs, GroupVideo } from "@/types";
import { saveProject, loadProject } from "@/lib/storage";
import { genShotlist } from "@/lib/claude";
import { InputStage } from "@/components/stages/input-stage";
import { IdeasStage } from "@/components/stages/ideas-stage";
import { ShotlistStage } from "@/components/stages/shotlist-stage";

const EMPTY: SongInput = {
  artist: "",
  title: "",
  genre: "",
  runtime: "",
  lyrics: "",
};

const STAGE_LABELS = ["Input", "Ideas", "Shot List"];

export default function Home() {
  const [stage, setStage] = useState(0);
  const [input, setInput] = useState<SongInput>(EMPTY);
  const [idea, setIdea] = useState<Idea | null>(null);
  const [angle, setAngle] = useState<Idea | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [specs, setSpecs] = useState<TreatmentSpecs[] | null>(null);
  const [videos, setVideos] = useState<Record<number, GroupVideo>>({});
  const [shotsLoading, setShotsLoading] = useState(false);
  const [shotsError, setShotsError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const runIdRef = useRef(0);

  async function generateShots(forAngle: Idea | null) {
    const myId = ++runIdRef.current;
    setShotsLoading(true);
    setShotsError(null);
    setShots([]);
    setSpecs(null);
    // Group numbering can shift when shots regenerate, so previously
    // generated videos no longer reliably map to groups. Drop them.
    setVideos({});
    try {
      const { shots: nextShots, specs: nextSpecs } = await genShotlist(
        input,
        forAngle
      );
      if (myId !== runIdRef.current) return;
      setShots(nextShots);
      setSpecs(nextSpecs);
    } catch (e) {
      if (myId !== runIdRef.current) return;
      setShotsError((e as Error).message);
    } finally {
      if (myId === runIdRef.current) setShotsLoading(false);
    }
  }

  useEffect(() => {
    const p = loadProject();
    if (p) {
      const loadedInput = p.input || EMPTY;
      // Back-compat: older projects stored `ideas: Idea[]`; pick the first.
      const legacy = (p as unknown as { ideas?: Idea[] }).ideas;
      const loadedIdea =
        p.idea ?? (Array.isArray(legacy) ? legacy[0] ?? null : null);
      const loadedAngle = p.angle || null;
      const loadedShots = Array.isArray(p.shots) ? p.shots : [];
      // specs is per-group; older projects may have stored a single object —
      // discard those rather than mis-applying them to group 0.
      const loadedSpecs = Array.isArray(p.specs) ? p.specs : null;
      const loadedVideos =
        p.videos && typeof p.videos === "object" ? p.videos : {};

      setInput(loadedInput);
      setIdea(loadedIdea);
      setAngle(loadedAngle);
      setShots(loadedShots);
      setSpecs(loadedSpecs);
      setVideos(loadedVideos);
      // Always land on Input on reload. Saved data is preserved so the user
      // can use the stage nav to jump back to where they left off.
      setStage(0);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveProject({ input, idea, angle, shots, specs, videos, stage });
  }, [input, idea, angle, shots, specs, videos, stage, hydrated]);

  function canJump(i: number): boolean {
    if (i === 0) return true;
    if (i === 1) return !!input.lyrics.trim();
    if (i === 2) return !!angle;
    return false;
  }

  function reset() {
    if (!confirm("Reset everything?")) return;
    setInput(EMPTY);
    setIdea(null);
    setAngle(null);
    setShots([]);
    setSpecs(null);
    setVideos({});
    setShotsError(null);
    setStage(0);
  }

  function chooseAngle(a: Idea | null) {
    setAngle(a);
    setStage(2);
    generateShots(a);
  }

  return (
    <div className="min-h-screen bg-black text-zinc-100">
      <header className="border-b border-zinc-800 bg-black print:hidden">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="font-mono text-xs uppercase tracking-widest text-zinc-300">
            Music Video Treatment
          </div>
          <div className="flex items-center gap-6">
            <nav className="flex gap-4">
              {STAGE_LABELS.map((s, i) => (
                <button
                  key={s}
                  onClick={() => canJump(i) && setStage(i)}
                  disabled={!canJump(i)}
                  className={`font-mono text-xs uppercase tracking-wider transition cursor-pointer disabled:cursor-not-allowed ${
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
              className="font-mono text-xs uppercase tracking-wider text-zinc-600 hover:text-red-400 transition cursor-pointer"
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
            setIdea(null);
            setStage(1);
          }}
        />
      )}
      {stage === 1 && (
        <IdeasStage
          input={input}
          idea={idea}
          setIdea={setIdea}
          onChoose={chooseAngle}
          onBack={() => setStage(0)}
        />
      )}
      {stage === 2 && (
        <ShotlistStage
          input={input}
          angle={angle}
          shots={shots}
          specs={specs}
          videos={videos}
          setVideos={setVideos}
          loading={shotsLoading}
          error={shotsError}
          onGenerate={() => generateShots(angle)}
          onBack={() => setStage(1)}
        />
      )}
    </div>
  );
}
