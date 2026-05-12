"use client";

import { useState, useEffect, useRef } from "react";
import type {
  SongInput,
  Idea,
  ShotGroup,
  GroupVideo,
  GroupImage,
  Character,
  CharacterPortrait,
  Location,
  LocationPortrait,
} from "@/types";
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
  concept: "",
};

const STAGE_LABELS = ["Input", "Ideas", "Shot List"];

export default function Home() {
  const [stage, setStage] = useState(0);
  const [input, setInput] = useState<SongInput>(EMPTY);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [angle, setAngle] = useState<Idea | null>(null);
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
  const [hydrated, setHydrated] = useState(false);
  const runIdRef = useRef(0);

  async function generateShots(forAngle: Idea | null) {
    const myId = ++runIdRef.current;
    setShotsLoading(true);
    setShotsError(null);
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
      } = await genShotlist(input, forAngle);
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
                ([, v]): v is CharacterPortrait =>
                  !!v &&
                  typeof (v as CharacterPortrait).url === "string" &&
                  typeof (v as CharacterPortrait).predictionId === "string"
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
                ([, v]): v is LocationPortrait =>
                  !!v &&
                  typeof (v as LocationPortrait).url === "string" &&
                  typeof (v as LocationPortrait).predictionId === "string"
              )
            )
          : {};

      setInput(loadedInput);
      setIdeas(loadedIdeas);
      setAngle(loadedAngle);
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
    generateShots(a);
  }

  return (
    <div className="min-h-screen text-white selection:bg-white/20" style={{ background: "linear-gradient(179.59deg, #1e1e1e 1.64%, #1a1828 92.37%)" }}>
      <header className="print:hidden">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="font-serif text-sm text-white/40 tracking-wide">
            Treatment Studio
          </div>
          <div className="flex items-center gap-6">
            <nav className="flex gap-5">
              {STAGE_LABELS.map((s, i) => (
                <button
                  key={s}
                  onClick={() => canJump(i) && setStage(i)}
                  disabled={!canJump(i)}
                  className={`font-serif text-base transition cursor-pointer disabled:cursor-not-allowed ${
                    i === stage
                      ? "text-white"
                      : canJump(i)
                      ? "text-white/40 hover:text-white/70"
                      : "text-white/20"
                  }`}
                >
                  {s}
                </button>
              ))}
            </nav>
            <button
              onClick={reset}
              className="font-sans text-xs text-white/30 hover:text-white/60 transition cursor-pointer"
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
          onChoose={chooseAngle}
          onBack={() => setStage(0)}
        />
      )}
      {stage === 2 && (
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
          onGenerate={() => generateShots(angle)}
          onBack={() => setStage(1)}
        />
      )}
    </div>
  );
}
