"use client";

import { useState, useEffect, useRef } from "react";
import type {
  SongInput,
  Idea,
  ShotGroup,
  ShotMode,
  GroupVideo,
  GroupImage,
  Character,
  CharacterPortrait,
  Location,
  LocationPortrait,
} from "@/types";
import { saveProject, loadProject } from "@/lib/storage";
import { genShotlistTwoPhase } from "@/lib/claude";
import { InputStage } from "@/components/stages/input-stage";
import { IdeasStage } from "@/components/stages/ideas-stage";
import { ShotlistStage } from "@/components/stages/shotlist-stage";

const EMPTY: SongInput = {
  artist: "",
  title: "",
  genre: "",
  runtime: "",
  lyrics: "",
  concept: "",
};

const STAGE_LABELS = ["Song Details", "Treatments", "Storyboard"];

export default function Home() {
  const [stage, setStage] = useState(0);
  const [input, setInput] = useState<SongInput>(EMPTY);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [angle, setAngle] = useState<Idea | null>(null);
  const [shotMode, setShotMode] = useState<ShotMode>("detailed");
  const [groups, setGroups] = useState<ShotGroup[]>([]);
  const [look, setLook] = useState<string>("");
  const [characters, setCharacters] = useState<Character[]>([]);
  const [portraits, setPortraits] = useState<
    Record<string, CharacterPortrait>
  >({});
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationPortraits, setLocationPortraits] = useState<
    Record<string, LocationPortrait>
  >({});
  const [videos, setVideos] = useState<Record<number, GroupVideo>>({});
  const [images, setImages] = useState<Record<number, GroupImage>>({});
  const [shotsLoading, setShotsLoading] = useState(false);
  const [shotsError, setShotsError] = useState<string | null>(null);
  // Live text accumulator for the streaming PHASE 1 (outline) call. Reset
  // to "" at the start of each generation and cleared on success. Rendered
  // as a monospace preview on the shotlist stage while shotsLoading is true
  // and the outline hasn't completed yet.
  const [streamPreview, setStreamPreview] = useState("");
  // PHASE 2 progress: number of expansion calls completed and total
  // expected (set once phase 1 finishes). Drives the "Generating N of M
  // shots..." label in the loader overlay.
  const [phaseProgress, setPhaseProgress] = useState<{
    done: number;
    total: number;
  }>({ done: 0, total: 0 });
  const [hydrated, setHydrated] = useState(false);
  const runIdRef = useRef(0);

  async function generateShots(forAngle: Idea | null, _mode: ShotMode) {
    // _mode is preserved on the signature so the rest of the app keeps
    // compiling, but the two-phase pipeline only operates in detailed mode
    // (the legacy single-call multi-shot path is unused).
    void _mode;
    const myId = ++runIdRef.current;
    setShotsLoading(true);
    setShotsError(null);
    setStreamPreview("");
    setPhaseProgress({ done: 0, total: 0 });
    setGroups([]);
    setLook("");
    setCharacters([]);
    setPortraits({});
    setLocations([]);
    setLocationPortraits({});
    setVideos({});
    setImages({});
    try {
      const {
        groups: nextGroups,
        look: nextLook,
        characters: nextCharacters,
        locations: nextLocations,
      } = await genShotlistTwoPhase(input, forAngle, {
        onDelta: (chunk) => {
          if (myId !== runIdRef.current) return;
          setStreamPreview((s) => s + chunk);
        },
        onOutline: (outline) => {
          if (myId !== runIdRef.current) return;
          // Phase 1 done — the bible is now canonical. Surface it to the
          // UI immediately so the user sees "Generating N of M shots..."
          // progress on the loader, and so persistence captures the
          // cast/locations even if some expansions fail.
          setLook(outline.look);
          setCharacters(outline.characters);
          setLocations(outline.locations);
          setPhaseProgress({ done: 0, total: outline.outline.length });
        },
        onShotComplete: (_index) => {
          if (myId !== runIdRef.current) return;
          setPhaseProgress((p) => ({ ...p, done: p.done + 1 }));
        },
      });
      if (myId !== runIdRef.current) return;
      setGroups(nextGroups);
      setLook(nextLook);
      setCharacters(nextCharacters);
      setLocations(nextLocations);
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
      const loadedInput: SongInput = { ...EMPTY, ...(p.input ?? {}) };
      const legacySingle = (p as unknown as { idea?: Idea | null }).idea;
      const isValidIdea = (v: unknown): v is Idea =>
        !!v &&
        typeof (v as Idea).angle === "string" &&
        typeof (v as Idea).pitch === "string";
      const loadedIdeas: Idea[] = Array.isArray(p.ideas)
        ? p.ideas.filter(isValidIdea)
        : isValidIdea(legacySingle)
        ? [legacySingle]
        : [];
      const loadedAngle = p.angle || null;
      // The "Use multi shot" toggle always starts off on page load — the user
      // has to opt back in each session. Saved value is intentionally ignored.
      const loadedShotMode: ShotMode = "detailed";
      const loadedGroups: ShotGroup[] = Array.isArray(p.groups)
        ? p.groups.filter(
            (g): g is ShotGroup =>
              !!g &&
              typeof (g as ShotGroup).prompt === "string" &&
              Array.isArray((g as ShotGroup).shots)
          )
        : [];
      const loadedVideos =
        p.videos && typeof p.videos === "object" ? p.videos : {};
      const loadedImages =
        p.images && typeof p.images === "object" ? p.images : {};
      const loadedLook = typeof p.look === "string" ? p.look : "";
      const loadedCharacters: Character[] = Array.isArray(p.characters)
        ? p.characters.filter(
            (c): c is Character =>
              !!c &&
              typeof (c as Character).tag === "string" &&
              typeof (c as Character).description === "string"
          )
        : [];
      const loadedPortraits: Record<string, CharacterPortrait> =
        p.portraits && typeof p.portraits === "object"
          ? Object.fromEntries(
              Object.entries(p.portraits).filter(
                (entry): entry is [string, CharacterPortrait] => {
                  const v = entry[1];
                  return (
                    !!v &&
                    typeof (v as CharacterPortrait).url === "string" &&
                    typeof (v as CharacterPortrait).predictionId === "string"
                  );
                }
              )
            )
          : {};
      const loadedLocations: Location[] = Array.isArray(p.locations)
        ? p.locations.filter(
            (l): l is Location =>
              !!l &&
              typeof (l as Location).tag === "string" &&
              typeof (l as Location).description === "string"
          )
        : [];
      const loadedLocationPortraits: Record<string, LocationPortrait> =
        p.locationPortraits && typeof p.locationPortraits === "object"
          ? Object.fromEntries(
              Object.entries(p.locationPortraits).filter(
                (entry): entry is [string, LocationPortrait] => {
                  const v = entry[1];
                  return (
                    !!v &&
                    typeof (v as LocationPortrait).url === "string" &&
                    typeof (v as LocationPortrait).predictionId === "string"
                  );
                }
              )
            )
          : {};

      setInput(loadedInput);
      setIdeas(loadedIdeas);
      setAngle(loadedAngle);
      setShotMode(loadedShotMode);
      setGroups(loadedGroups);
      setLook(loadedGroups.length ? loadedLook : "");
      setCharacters(loadedGroups.length ? loadedCharacters : []);
      setPortraits(loadedGroups.length ? loadedPortraits : {});
      setLocations(loadedGroups.length ? loadedLocations : []);
      setLocationPortraits(
        loadedGroups.length ? loadedLocationPortraits : {}
      );
      setVideos(loadedGroups.length ? loadedVideos : {});
      setImages(loadedGroups.length ? loadedImages : {});
      setStage(0);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveProject({
      input,
      ideas,
      angle,
      shotMode,
      groups,
      look,
      characters,
      portraits,
      locations,
      locationPortraits,
      videos,
      images,
      stage,
    });
  }, [
    input,
    ideas,
    angle,
    shotMode,
    groups,
    look,
    characters,
    portraits,
    locations,
    locationPortraits,
    videos,
    images,
    stage,
    hydrated,
  ]);

  function canJump(i: number): boolean {
    if (i === 0) return true;
    if (i === 1) return !!input.lyrics.trim() || !!input.concept.trim();
    if (i === 2) return !!angle && !!input.lyrics.trim();
    return false;
  }

  function reset() {
    if (!confirm("Reset everything?")) return;
    setInput(EMPTY);
    setIdeas([]);
    setAngle(null);
    setShotMode("groups");
    setGroups([]);
    setLook("");
    setCharacters([]);
    setPortraits({});
    setLocations([]);
    setLocationPortraits({});
    setVideos({});
    setImages({});
    setShotsError(null);
    setStage(0);
  }

  function chooseAngle(a: Idea | null) {
    setAngle(a);
    setStage(2);
    // Hardcoded "detailed" — multi-shot is currently hidden from the UI.
    // Even though `shotMode` state and `genShotlist`'s mode param still
    // exist, we never pass anything else from here. Restore the original
    // `generateShots(a, shotMode)` if multi-shot is brought back.
    generateShots(a, "detailed");
  }

  return (
    <div className="min-h-screen text-white selection:bg-white/20" style={{ background: "linear-gradient(179.59deg, #1e1e1e 1.64%, #1a1a24 92.37%)" }}>
      <header className="print:hidden">
        <div className="flex items-center gap-6 px-12 py-4">
          <div className="shrink-0 font-serif text-sm tracking-wide text-white/40">
            Treatment Studio
          </div>
          <div className="flex flex-1 justify-center">
            <nav
              role="tablist"
              aria-label="Treatment stages"
              className="flex gap-1 rounded-full border border-white/10 bg-white/5 p-1"
            >
              {STAGE_LABELS.map((s, i) => {
                const active = i === stage;
                const jumpable = canJump(i);
                return (
                  <button
                    key={s}
                    role="tab"
                    aria-selected={active}
                    onClick={() => jumpable && setStage(i)}
                    disabled={!jumpable}
                    className={`cursor-pointer rounded-full px-5 py-1.5 font-serif text-base transition disabled:cursor-not-allowed ${
                      active
                        ? "bg-white text-black shadow-sm"
                        : jumpable
                        ? "text-white/60 hover:bg-white/5 hover:text-white/90"
                        : "text-white/20"
                    }`}
                  >
                    {s}
                  </button>
                );
              })}
            </nav>
          </div>
          <button
            onClick={reset}
            className="shrink-0 cursor-pointer font-sans text-sm text-white/30 transition hover:text-white/60"
          >
            Reset
          </button>
        </div>
      </header>

      {stage === 0 && (
        <InputStage
          input={input}
          setInput={setInput}
          onNext={() => {
            setIdeas([]);
            setStage(1);
          }}
        />
      )}
      {stage === 1 && (
        <IdeasStage
          input={input}
          ideas={ideas}
          setIdeas={setIdeas}
          shotMode={shotMode}
          setShotMode={setShotMode}
          onChoose={chooseAngle}
          onBack={() => setStage(0)}
        />
      )}
      {/*
        ShotlistStage is mounted at all times so the per-card usePrediction
        hooks keep polling Replicate when the user switches to Song Details
        or Treatments. Without this, switching tabs unmounts every shot /
        character / location card and any in-flight image/video generation
        is silently dropped. InputStage and IdeasStage stay conditionally
        rendered — IdeasStage auto-fires genIdeas on first mount, so eager
        mounting would kick off a Claude call before the user is ready.
      */}
      <div className={stage === 2 ? undefined : "hidden"}>
        <ShotlistStage
          input={input}
          angle={angle}
          groups={groups}
          look={look}
          characters={characters}
          portraits={portraits}
          setPortraits={setPortraits}
          locations={locations}
          locationPortraits={locationPortraits}
          setLocationPortraits={setLocationPortraits}
          videos={videos}
          setVideos={setVideos}
          images={images}
          setImages={setImages}
          loading={shotsLoading}
          error={shotsError}
          streamPreview={streamPreview}
          phaseProgress={phaseProgress}
          onGenerate={() => generateShots(angle, "detailed")}
          onBack={() => setStage(1)}
        />
      </div>
    </div>
  );
}
