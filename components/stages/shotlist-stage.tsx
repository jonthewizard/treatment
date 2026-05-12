"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { parseDurationSeconds } from "@/lib/claude";
import { useGroupVideo, useGroupImage, type KlingShot } from "@/lib/replicate";
import { Loader } from "@/components/ui/loader";
import { Block } from "@/components/ui/block";
import { Btn } from "@/components/ui/btn";

// Kling caps reference_images at 7. We pack characters first, then
// locations, so a treatment with many of each still keeps every face.
const REFERENCE_IMAGE_CAP = 7;

// Inject <<<image_N>>> markers into a prompt string for every TAG that has
// a generated reference image. Characters take indices 1..C, then locations
// follow at C+1..C+L. The N value MUST match the position of the image in
// the reference_images array sent to Kling/Nano Banana 2.
function injectReferenceMarkers(
  text: string,
  refs: { tag: string; hasImage: boolean }[]
): string {
  const active = refs.filter((r) => r.hasImage).slice(0, REFERENCE_IMAGE_CAP);
  if (!active.length) return text;
  let result = text;
  active.forEach((r, i) => {
    result = result.replace(
      new RegExp(`\\b${r.tag}\\b`, "g"),
      `${r.tag} <<<image_${i + 1}>>`
    );
  });
  return result;
}

interface ShotlistStageProps {
  input: SongInput;
  angle: Idea | null;
  groups: ShotGroup[];
  look: string;
  characters: Character[];
  portraits: Record<string, CharacterPortrait>;
  setPortraits: React.Dispatch<
    React.SetStateAction<Record<string, CharacterPortrait>>
  >;
  locations: Location[];
  locationPortraits: Record<string, LocationPortrait>;
  setLocationPortraits: React.Dispatch<
    React.SetStateAction<Record<string, LocationPortrait>>
  >;
  videos: Record<number, GroupVideo>;
  setVideos: React.Dispatch<React.SetStateAction<Record<number, GroupVideo>>>;
  images: Record<number, GroupImage>;
  setImages: React.Dispatch<React.SetStateAction<Record<number, GroupImage>>>;
  loading: boolean;
  error: string | null;
  onGenerate: () => void;
  onBack: () => void;
}

function shotlistTitle(input: SongInput, angle: Idea | null): string {
  if (angle?.angle) return angle.angle;
  if (input.title) return input.title;
  return "Shot List";
}

export function ShotlistStage({
  input,
  angle,
  groups,
  look: _look,
  characters,
  portraits,
  setPortraits,
  locations,
  locationPortraits,
  setLocationPortraits,
  videos,
  setVideos,
  images,
  setImages,
  loading,
  error,
  onGenerate,
  onBack,
}: ShotlistStageProps) {
  void _look;
  const [copiedGroup, setCopiedGroup] = useState<number | null>(null);
  const [edited, setEdited] = useState<Record<number, string>>({});
  const [playerOpen, setPlayerOpen] = useState(false);

  // Build the reference image list (characters first, then locations) and
  // inject matching <<<image_N>>> markers into every Kling prompt. Order
  // here is the source of truth — Kling matches the Nth image to <<<image_N>>>.
  const groupsWithPrompts = useMemo(() => {
    const charRefs = characters.map((c) => ({
      tag: c.tag,
      hasImage: !!portraits[c.tag]?.url,
      url: portraits[c.tag]?.url,
    }));
    const locRefs = locations.map((l) => ({
      tag: l.tag,
      hasImage: !!locationPortraits[l.tag]?.url,
      url: locationPortraits[l.tag]?.url,
    }));
    const orderedRefs = [...charRefs, ...locRefs];
    const referenceImages = orderedRefs
      .filter((r) => r.hasImage && r.url)
      .slice(0, REFERENCE_IMAGE_CAP)
      .map((r) => r.url as string);
    const markerRefs = orderedRefs.map((r) => ({
      tag: r.tag,
      hasImage: r.hasImage,
    }));

    return groups.map((g) => {
      const prompt = injectReferenceMarkers(g.prompt, markerRefs);
      const klingShots: KlingShot[] | null =
        g.shots.length > 0 && g.shots.length <= 6
          ? g.shots.map((s) => ({
              prompt: injectReferenceMarkers(s.prompt, markerRefs),
              duration: Math.max(
                1,
                Math.round(parseDurationSeconds(s.duration) || 1)
              ),
            }))
          : null;
      return {
        group: g,
        prompt,
        klingShots,
        referenceImages,
        imagePrompt: g.imagePrompt,
      };
    });
  }, [groups, characters, portraits, locations, locationPortraits]);

  // Reset local edits whenever groups regenerate.
  useEffect(() => {
    setEdited({});
  }, [groups]);

  function promptFor(groupNumber: number, source: string): string {
    return edited[groupNumber] ?? source;
  }

  const totalSeconds = useMemo(
    () => groups.reduce((a, g) => a + g.totalSeconds, 0),
    [groups]
  );

  // Ordered list of generated videos for the "Play All" modal. Walks the
  // groups in shot-list order and pulls each one's video if present, so any
  // ungenerated group is just skipped rather than blocking playback.
  const playableVideos = useMemo(
    () =>
      groupsWithPrompts
        .map(({ group }) => {
          const v = videos[group.groupNumber];
          return v ? { groupNumber: group.groupNumber, url: v.url } : null;
        })
        .filter((x): x is { groupNumber: number; url: string } => x !== null),
    [groupsWithPrompts, videos]
  );

  const title = shotlistTitle(input, angle);

  if (loading) return <Loader text="building shot list" />;

  if (error && !groups.length)
    return (
      <div className="mx-auto max-w-3xl px-6 py-10 text-xs text-red-400/80">
        {error}
        <button
          onClick={onGenerate}
          className="ml-4 underline hover:text-red-300 cursor-pointer"
        >
          Retry
        </button>
      </div>
    );

  function copyAll(): string {
    return groupsWithPrompts
      .map((g) => promptFor(g.group.groupNumber, g.prompt))
      .join("\n\n---\n\n");
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      {groups.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center justify-end gap-3">
          <Btn
            small
            onClick={() => setPlayerOpen(true)}
            disabled={playableVideos.length === 0}
          >
            <span className="inline-flex items-center gap-2">
              <PlayIcon />
              {playableVideos.length
                ? `Play All (${playableVideos.length})`
                : "Play All"}
            </span>
          </Btn>
          <Btn
            small
            onClick={() => {
              const text = copyAll();
              const blob = new Blob([text], { type: "text/plain" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `${input.artist} - ${input.title} - Kling Prompts.txt`
                .replace(/[^\w\s.-]/g, "")
                .replace(/\s+/g, "-");
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            <span className="inline-flex items-center gap-2">
              <DownloadIcon />
              Download .txt
            </span>
          </Btn>
        </div>
      )}

      <h1 className="font-serif text-5xl text-white">{title}</h1>
      <p className="mt-3 text-xs text-white/40">
        {input.artist} · {input.title}
        {input.runtime ? ` · ${input.runtime}` : ""}
      </p>
      {angle && (
        <p className="mt-3 text-base text-white/70">
          {angle.pitch}
        </p>
      )}

      {error && groups.length > 0 && (
        <div className="mt-4 text-xs text-red-400/80">
          {error}
          <button
            onClick={onGenerate}
            className="ml-3 underline hover:text-red-300 cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {characters.length > 0 && (
        <Block
          label={`Cast · ${characters.length} character${
            characters.length === 1 ? "" : "s"
          }`}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {characters.map((c) => (
              <CharacterCard
                key={c.tag}
                character={c}
                look=""
                initialPortrait={portraits[c.tag] ?? null}
                onPersist={(next) =>
                  setPortraits((ps) => {
                    if (!next) {
                      const copy = { ...ps };
                      delete copy[c.tag];
                      return copy;
                    }
                    return { ...ps, [c.tag]: next };
                  })
                }
              />
            ))}
          </div>
        </Block>
      )}

      {locations.length > 0 && (
        <Block
          label={`Locations · ${locations.length} place${
            locations.length === 1 ? "" : "s"
          }`}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {locations.map((l) => (
              <LocationCard
                key={l.tag}
                location={l}
                initialPortrait={locationPortraits[l.tag] ?? null}
                onPersist={(next) =>
                  setLocationPortraits((ps) => {
                    if (!next) {
                      const copy = { ...ps };
                      delete copy[l.tag];
                      return copy;
                    }
                    return { ...ps, [l.tag]: next };
                  })
                }
              />
            ))}
          </div>
        </Block>
      )}

      <Block
        label={
          groupsWithPrompts.length
            ? `${groupsWithPrompts.length} prompt${
                groupsWithPrompts.length === 1 ? "" : "s"
              } · ${totalSeconds}s`
            : "Prompts"
        }
      >
        {groupsWithPrompts.length === 0 && !loading && (
          <button
            onClick={onGenerate}
            className="text-xs text-white/40 hover:text-white/70 transition cursor-pointer py-2"
          >
            Generate Shot List
          </button>
        )}
        <div className="divide-y divide-white/10">
          {groupsWithPrompts.map(({ group, prompt, klingShots, imagePrompt, referenceImages }) => {
            const value = promptFor(group.groupNumber, prompt);
            return (
              <div
                key={group.groupNumber}
                className="grid grid-cols-1 gap-4 py-6 first:pt-0 last:pb-0 md:grid-cols-[1fr_480px]"
              >
                <div className="min-w-0 bg-white/[0.08] border border-white/10 rounded-2xl p-4">
                  {/* Editable Kling prompt */}
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-medium text-white/40">
                        {klingShots ? `Kling multi-shot (${group.shots.length})` : "Kling prompt"}
                      </span>
                      <div className="flex items-center gap-3">
                        {edited[group.groupNumber] !== undefined &&
                          edited[group.groupNumber] !== prompt && (
                            <button
                              onClick={() =>
                                setEdited((e) => {
                                  const next = { ...e };
                                  delete next[group.groupNumber];
                                  return next;
                                })
                              }
                              className="text-xs text-white/40 hover:text-white/70 transition cursor-pointer"
                            >
                              Reset
                            </button>
                          )}
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(value).then(() => {
                              setCopiedGroup(group.groupNumber);
                              setTimeout(() => setCopiedGroup(null), 1500);
                            });
                          }}
                          className="text-xs text-white/40 hover:text-white/70 transition cursor-pointer"
                        >
                          {copiedGroup === group.groupNumber ? "Copied" : "Copy"}
                        </button>
                      </div>
                    </div>
                    <EditablePrompt
                      value={value}
                      onChange={(next) =>
                        setEdited((e) => ({ ...e, [group.groupNumber]: next }))
                      }
                    />
                  </div>
                </div>
                <MediaPanel
                  videoPrompt={value}
                  klingShots={klingShots}
                  imagePrompt={imagePrompt}
                  referenceImages={referenceImages}
                  initialVideo={videos[group.groupNumber] ?? null}
                  initialImage={images[group.groupNumber] ?? null}
                  onPersistVideo={(next) =>
                    setVideos((vs) => {
                      if (!next) {
                        const copy = { ...vs };
                        delete copy[group.groupNumber];
                        return copy;
                      }
                      return { ...vs, [group.groupNumber]: next };
                    })
                  }
                  onPersistImage={(next) =>
                    setImages((is) => {
                      if (!next) {
                        const copy = { ...is };
                        delete copy[group.groupNumber];
                        return copy;
                      }
                      return { ...is, [group.groupNumber]: next };
                    })
                  }
                />
              </div>
            );
          })}
        </div>
      </Block>

      <div className="mt-8">
        <Btn onClick={onBack}>← Back</Btn>
      </div>

      {playerOpen && playableVideos.length > 0 && (
        <PlayerModal
          videos={playableVideos}
          onClose={() => setPlayerOpen(false)}
        />
      )}
    </div>
  );
}

function EditablePrompt({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  // Resize to fit content. useLayoutEffect avoids a flicker on mount/value swap.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      spellCheck={false}
      rows={1}
      className="block w-full resize-none border-0 bg-transparent p-0 text-xs leading-relaxed text-white/70 whitespace-pre-wrap break-words outline-none focus:ring-0"
    />
  );
}

// Derive a Nano Banana 2 portrait prompt for a character: a clean full-body
// studio photograph used as a Kling reference image for appearance consistency.
function derivePortraitPrompt(c: Character): string {
  const scrub = (t: string) =>
    t
      .replace(/\bcharacters?\b/gi, "person")
      .replace(/\bfictional\b/gi, "invented")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[.!?]+$/, "");
  return (
    `Full-body studio portrait photograph. ${scrub(c.description)}. ` +
    `Standing facing camera, three-quarter pose, visible from head to mid-thigh, ` +
    `arms relaxed at sides, neutral expression, eyes open and looking at lens. ` +
    `Plain light grey seamless backdrop, no props, no scenery. ` +
    `Flat even frontal lighting, no harsh shadows, face and wardrobe sharply in focus throughout. ` +
    `50mm lens, clean photorealistic photography.`
  );
}

interface CharacterCardProps {
  character: Character;
  // Reserved for surfacing the song's look in the UI (not yet used in the
  // portrait prompt — kept on the prop surface so we can opt in later).
  look: string;
  initialPortrait: CharacterPortrait | null;
  onPersist: (next: CharacterPortrait | null) => void;
}

// One row in the Cast section: tag, truncated anchor description, and a
// 9:16 portrait slot wired to its own Nano Banana 2 lifecycle. Vertical
// framing captures both face and full wardrobe head-to-mid-thigh — Kling
// references these as <<<image_N>>> for appearance consistency.
function CharacterCard({
  character,
  look: _look,
  initialPortrait,
  onPersist,
}: CharacterCardProps) {
  void _look;
  const portrait = useGroupImage({
    initial: initialPortrait,
    onPersist,
  });
  const busy =
    portrait.status === "starting" || portrait.status === "processing";
  const prompt = useMemo(() => derivePortraitPrompt(character), [character]);
  return (
    <div className="flex flex-col gap-2 bg-white/[0.08] border border-white/10 rounded-2xl p-3">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-white">
          {character.tag}
        </span>
        {portrait.status === "succeeded" && portrait.imageUrl && (
          <span className="text-[10px] font-medium text-emerald-400/80">
            Anchored
          </span>
        )}
      </div>

      <div className="relative aspect-[9/16] w-full overflow-hidden rounded-xl border border-white/10 bg-white/5">
        {portrait.status === "succeeded" && portrait.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={portrait.imageUrl}
            src={portrait.imageUrl}
            alt={`Portrait reference for ${character.tag}`}
            className="h-full w-full object-cover"
          />
        ) : busy ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-xs text-white/40">
            <div className="h-3 w-3 animate-spin rounded-full border border-white/20 border-t-white/70" />
            <span>{portrait.status === "starting" ? "queued" : "rendering"}</span>
          </div>
        ) : portrait.status === "failed" ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-3 text-center text-xs text-red-400/80">
            <span className="break-words">
              {portrait.error || "Generation failed"}
            </span>
            <button
              onClick={() => portrait.generate(prompt, "9:16")}
              className="underline hover:text-red-300 cursor-pointer"
            >
              Retry
            </button>
          </div>
        ) : (
          <button
            onClick={() => portrait.generate(prompt, "9:16")}
            className="flex h-full w-full items-center justify-center text-xs text-white/40 hover:text-white/70 transition cursor-pointer"
          >
            Generate Portrait
          </button>
        )}
      </div>

      <p className="text-[11px] leading-snug text-white/50">
        {character.description}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        {portrait.status === "succeeded" && portrait.imageUrl && (
          <>
            <a
              href={portrait.imageUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-white/40 hover:text-white/70 transition cursor-pointer"
            >
              Open
            </a>
            <button
              onClick={() => portrait.generate(prompt, "9:16")}
              className="text-xs text-white/40 hover:text-white/70 transition cursor-pointer"
            >
              Regenerate
            </button>
            <button
              onClick={portrait.reset}
              title="Drop this portrait so videos no longer use it as a reference"
              className="text-xs text-white/40 hover:text-red-400/70 transition cursor-pointer"
            >
              Clear
            </button>
          </>
        )}
        {busy && (
          <button
            onClick={portrait.reset}
            className="text-xs text-white/40 hover:text-white/70 transition cursor-pointer"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

// Derive a Nano Banana 2 location-reference prompt: a wide empty-environment
// photograph used as a Kling reference image for location consistency.
function deriveLocationPrompt(l: Location): string {
  const scrub = (t: string) =>
    t
      .replace(/\bcharacters?\b/gi, "person")
      .replace(/\bfictional\b/gi, "invented")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[.!?]+$/, "");
  return (
    `Wide establishing photograph of an empty location. ${scrub(l.description)}. ` +
    `No people anywhere in frame. Cinematic wide shot, eye-level, the full setting visible. ` +
    `Natural light appropriate to the location, sharp focus throughout, clean photoreal photography, ` +
    `35mm lens, neutral grade. No props or actors that aren't permanent fixtures of the place.`
  );
}

interface LocationCardProps {
  location: Location;
  initialPortrait: LocationPortrait | null;
  onPersist: (next: LocationPortrait | null) => void;
}

// One row in the Locations section: tag, anchor description, and a 16:9
// empty-environment reference slot wired to its own Nano Banana 2 lifecycle.
// Horizontal framing matches video output aspect and gives Kling a clean
// architectural reference via <<<image_N>>> markers.
function LocationCard({
  location,
  initialPortrait,
  onPersist,
}: LocationCardProps) {
  const portrait = useGroupImage({
    initial: initialPortrait,
    onPersist,
  });
  const busy =
    portrait.status === "starting" || portrait.status === "processing";
  const prompt = useMemo(() => deriveLocationPrompt(location), [location]);
  return (
    <div className="flex flex-col gap-2 bg-white/[0.08] border border-white/10 rounded-2xl p-3">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-white">
          {location.tag}
        </span>
        {portrait.status === "succeeded" && portrait.imageUrl && (
          <span className="text-[10px] font-medium text-emerald-400/80">
            Anchored
          </span>
        )}
      </div>

      <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-white/10 bg-white/5">
        {portrait.status === "succeeded" && portrait.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={portrait.imageUrl}
            src={portrait.imageUrl}
            alt={`Location reference for ${location.tag}`}
            className="h-full w-full object-cover"
          />
        ) : busy ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-xs text-white/40">
            <div className="h-3 w-3 animate-spin rounded-full border border-white/20 border-t-white/70" />
            <span>{portrait.status === "starting" ? "queued" : "rendering"}</span>
          </div>
        ) : portrait.status === "failed" ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-3 text-center text-xs text-red-400/80">
            <span className="break-words">
              {portrait.error || "Generation failed"}
            </span>
            <button
              onClick={() => portrait.generate(prompt, "16:9")}
              className="underline hover:text-red-300 cursor-pointer"
            >
              Retry
            </button>
          </div>
        ) : (
          <button
            onClick={() => portrait.generate(prompt, "16:9")}
            className="flex h-full w-full items-center justify-center text-xs text-white/40 hover:text-white/70 transition cursor-pointer"
          >
            Generate Reference
          </button>
        )}
      </div>

      <p className="text-[11px] leading-snug text-white/50">
        {location.description}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        {portrait.status === "succeeded" && portrait.imageUrl && (
          <>
            <a
              href={portrait.imageUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-white/40 hover:text-white/70 transition cursor-pointer"
            >
              Open
            </a>
            <button
              onClick={() => portrait.generate(prompt, "16:9")}
              className="text-xs text-white/40 hover:text-white/70 transition cursor-pointer"
            >
              Regenerate
            </button>
            <button
              onClick={portrait.reset}
              title="Drop this location reference so videos no longer use it as a reference"
              className="text-xs text-white/40 hover:text-red-400/70 transition cursor-pointer"
            >
              Clear
            </button>
          </>
        )}
        {busy && (
          <button
            onClick={portrait.reset}
            className="text-xs text-white/40 hover:text-white/70 transition cursor-pointer"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

interface MediaPanelProps {
  videoPrompt: string;
  // Per-shot array for Kling multi-shot mode (groups ≤6 shots).
  // Null falls back to single videoPrompt.
  klingShots?: KlingShot[] | null;
  imagePrompt: string;
  // Portrait URLs sent as reference images to both Nano Banana 2 (still) and
  // Kling (video). Kling binds them via <<<image_N>>> markers in the prompts.
  referenceImages: string[];
  initialVideo: GroupVideo | null;
  initialImage: GroupImage | null;
  onPersistVideo: (next: GroupVideo | null) => void;
  onPersistImage: (next: GroupImage | null) => void;
}

type MediaTab = "image" | "video";

// 480x270 (16:9) frame to the right of each prompt, with two tabs:
// IMAGE — Nano Banana 2 storyboard (16:9, 2K). Photoreal multi-panel grid
//         showing every shot in the group as a labelled still. Planning
//         visual only — never used as Kling's start_image.
// VIDEO — Kling Video 3.0 Omni. Multi-shot when group ≤6 shots; single
//         prompt fallback otherwise. Character portraits flow as
//         reference_images via the <<<image_N>>> markers in the prompt.
function MediaPanel({
  videoPrompt,
  klingShots,
  imagePrompt,
  referenceImages,
  initialVideo,
  initialImage,
  onPersistVideo,
  onPersistImage,
}: MediaPanelProps) {
  const image = useGroupImage({
    initial: initialImage,
    onPersist: onPersistImage,
  });
  const video = useGroupVideo({
    initial: initialVideo,
    onPersist: onPersistVideo,
  });

  // Default tab: prefer Image when both empty (it's step 1 of the flow);
  // otherwise show whichever already has content, biased to Image since the
  // user typically inspects the still before regenerating the video.
  const [tab, setTab] = useState<MediaTab>(() => {
    if (initialImage) return "image";
    if (initialVideo) return "video";
    return "image";
  });

  const imageBusy =
    image.status === "starting" || image.status === "processing";
  const videoBusy =
    video.status === "starting" || video.status === "processing";

  return (
    <div className="flex w-full flex-col gap-2 md:w-[480px]">
      <div className="flex items-center gap-1">
        <TabButton
          active={tab === "image"}
          onClick={() => setTab("image")}
          busy={imageBusy}
          done={image.status === "succeeded" && !!image.imageUrl}
        >
          Image
        </TabButton>
        <TabButton
          active={tab === "video"}
          onClick={() => setTab("video")}
          busy={videoBusy}
          done={video.status === "succeeded" && !!video.videoUrl}
        >
          Video
        </TabButton>
      </div>

      <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-white/10 bg-white/5">
        {tab === "image" ? (
          <ImageTab
            status={image.status}
            url={image.imageUrl}
            error={image.error}
            prompt={imagePrompt}
            onGenerate={() => image.generate(imagePrompt, undefined, referenceImages)}
          />
        ) : (
          <VideoTab
            status={video.status}
            url={video.videoUrl}
            error={video.error}
            prompt={videoPrompt}
            hasReferences={referenceImages.length > 0}
            onGenerate={() =>
              video.generate(
                videoPrompt,
                klingShots ?? null,
                null,
                referenceImages
              )
            }
          />
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-white/30">
          {tab === "image"
            ? "16:9 · 2K storyboard · preview only"
            : referenceImages.length > 0
            ? `16:9 · 720p · 15s · ref-to-video (${referenceImages.length})`
            : "16:9 · 720p · 15s · text-to-video"}
        </div>
        <div className="flex items-center gap-3">
          {tab === "image" && (
            <>
              {image.status === "succeeded" && image.imageUrl && (
                <>
                  <a
                    href={image.imageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-white/40 hover:text-white/70 transition cursor-pointer"
                  >
                    Open
                  </a>
                  <button
                    onClick={() => image.generate(imagePrompt, undefined, referenceImages)}
                    className="text-xs text-white/40 hover:text-white/70 transition cursor-pointer"
                  >
                    Regenerate
                  </button>
                  <button
                    onClick={image.reset}
                    title="Discard this storyboard image"
                    className="text-xs text-white/40 hover:text-red-400/70 transition cursor-pointer"
                  >
                    Clear
                  </button>
                </>
              )}
              {imageBusy && (
                <button
                  onClick={image.reset}
                  className="text-xs text-white/40 hover:text-white/70 transition cursor-pointer"
                >
                  Cancel
                </button>
              )}
            </>
          )}
          {tab === "video" && (
            <>
              {video.status === "succeeded" && video.videoUrl && (
                <>
                  <a
                    href={video.videoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-white/40 hover:text-white/70 transition cursor-pointer"
                  >
                    Open
                  </a>
                  <button
                    onClick={() =>
                      video.generate(
                        videoPrompt,
                        klingShots ?? null,
                        null,
                        referenceImages
                      )
                    }
                    className="text-xs text-white/40 hover:text-white/70 transition cursor-pointer"
                  >
                    Regenerate
                  </button>
                </>
              )}
              {videoBusy && (
                <button
                  onClick={video.reset}
                  className="text-xs text-white/40 hover:text-white/70 transition cursor-pointer"
                >
                  Cancel
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  busy,
  done,
  children,
}: {
  active: boolean;
  onClick: () => void;
  busy: boolean;
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 border px-3 py-1.5 text-xs rounded-xl transition cursor-pointer ${
        active
          ? "border-white/20 bg-white/[0.15] text-white"
          : "border-white/10 bg-transparent text-white/40 hover:text-white/70"
      }`}
    >
      <span>{children}</span>
      {busy && (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
      )}
      {!busy && done && (
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
      )}
    </button>
  );
}

function ImageTab({
  status,
  url,
  error,
  prompt,
  onGenerate,
}: {
  status: ReturnType<typeof useGroupImage>["status"];
  url: string | null;
  error: string | null;
  prompt: string;
  onGenerate: () => void;
}) {
  const busy = status === "starting" || status === "processing";

  if (status === "succeeded" && url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        key={url}
        src={url}
        alt="First-frame reference still"
        className="h-full w-full object-cover"
      />
    );
  }
  if (busy) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-xs text-white/40">
        <div className="h-3 w-3 animate-spin rounded-full border border-white/20 border-t-white/70" />
        <span>{status === "starting" ? "queued" : "rendering"}</span>
      </div>
    );
  }
  if (status === "failed") {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-3 text-center text-xs text-red-400/80">
        <span className="break-words">
          {error || "Generation failed"}
        </span>
        <button
          onClick={onGenerate}
          className="underline hover:text-red-300 cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }
  return (
    <button
      onClick={onGenerate}
      disabled={!prompt.trim()}
      className="flex h-full w-full items-center justify-center text-xs text-white/40 hover:text-white/70 transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
    >
      Generate Image
    </button>
  );
}

function VideoTab({
  status,
  url,
  error,
  prompt,
  hasReferences,
  onGenerate,
}: {
  status: ReturnType<typeof useGroupVideo>["status"];
  url: string | null;
  error: string | null;
  prompt: string;
  hasReferences: boolean;
  onGenerate: () => void;
}) {
  const busy = status === "starting" || status === "processing";

  if (status === "succeeded" && url) {
    return (
      <video
        key={url}
        src={url}
        controls
        playsInline
        preload="metadata"
        className="h-full w-full object-cover"
      />
    );
  }
  if (busy) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-xs text-white/40">
        <div className="h-3 w-3 animate-spin rounded-full border border-white/20 border-t-white/70" />
        <span>{status === "starting" ? "queued" : "rendering"}</span>
      </div>
    );
  }
  if (status === "failed") {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-3 text-center text-xs text-red-400/80">
        <span className="break-words">
          {error || "Generation failed"}
        </span>
        <button
          onClick={onGenerate}
          className="underline hover:text-red-300 cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }
  return (
    <button
      onClick={onGenerate}
      disabled={!prompt.trim()}
      className="flex h-full w-full flex-col items-center justify-center gap-1 text-xs text-white/40 hover:text-white/70 transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span>Generate Video</span>
      <span className="text-[10px] text-white/20">
        {hasReferences ? "with character refs" : "text only"}
      </span>
    </button>
  );
}

interface PlayerModalProps {
  videos: { groupNumber: number; url: string }[];
  onClose: () => void;
}

// Fullscreen sequential player. Walks the supplied videos in order, advancing
// on `ended` and on user click. Shows a small overlay with the current group
// and Prev/Next/Close controls. ESC closes. Errors auto-skip after 1.5s so an
// expired Replicate URL doesn't strand the user mid-sequence.
function PlayerModal({ videos, onClose }: PlayerModalProps) {
  const [index, setIndex] = useState(0);
  const [errored, setErrored] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const skipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const current = videos[index];

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight")
        setIndex((i) => Math.min(i + 1, videos.length - 1));
      else if (e.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, videos.length]);

  // Re-load the video on index change and clear any pending error skip.
  useEffect(() => {
    setErrored(false);
    if (skipTimer.current) {
      clearTimeout(skipTimer.current);
      skipTimer.current = null;
    }
    const el = videoRef.current;
    if (el) {
      el.currentTime = 0;
      el.play().catch(() => {});
    }
    return () => {
      if (skipTimer.current) clearTimeout(skipTimer.current);
    };
  }, [index]);

  function next() {
    if (index >= videos.length - 1) {
      onClose();
      return;
    }
    setIndex(index + 1);
  }

  function prev() {
    setIndex((i) => Math.max(i - 1, 0));
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-[#2a2a35]"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex items-center justify-between border-b border-white/10 px-6 py-3 text-xs text-white/40">
        <div>
          Playing {index + 1} of {videos.length} · group {current.groupNumber}
        </div>
        <div className="flex items-center gap-5">
          <button
            onClick={prev}
            disabled={index === 0}
            className="hover:text-white transition cursor-pointer disabled:cursor-not-allowed disabled:text-white/20"
          >
            ← Prev
          </button>
          <button
            onClick={next}
            className="hover:text-white transition cursor-pointer"
          >
            {index >= videos.length - 1 ? "Finish" : "Next →"}
          </button>
          <button
            onClick={onClose}
            className="hover:text-white transition cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center p-6">
        {errored ? (
          <div className="text-xs text-red-400/80">
            Failed to load video. Skipping…
          </div>
        ) : (
          <video
            key={current.url}
            ref={videoRef}
            src={current.url}
            autoPlay
            playsInline
            onEnded={next}
            onClick={() => {
              const el = videoRef.current;
              if (!el) return;
              if (el.paused) el.play().catch(() => {});
              else el.pause();
            }}
            onError={() => {
              setErrored(true);
              skipTimer.current = setTimeout(next, 1500);
            }}
            className="max-h-full max-w-full cursor-pointer"
          />
        )}
      </div>
    </div>
  );
}

function PlayIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}
