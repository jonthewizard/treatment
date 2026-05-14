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
  // Streaming text from Claude while the shotlist is being generated. Empty
  // string when idle. Rendered live in a monospace preview block so the
  // user can watch the model think instead of staring at a spinner.
  streamPreview?: string;
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
  streamPreview,
  onGenerate,
  onBack,
}: ShotlistStageProps) {
  void _look;
  const [copiedGroup, setCopiedGroup] = useState<number | null>(null);
  const [copiedCharacter, setCopiedCharacter] = useState<string | null>(null);
  const [copiedLocation, setCopiedLocation] = useState<string | null>(null);
  const [edited, setEdited] = useState<Record<number, string>>({});
  const [editedCharacters, setEditedCharacters] = useState<Record<string, string>>({});
  const [editedLocations, setEditedLocations] = useState<Record<string, string>>({});
  const [playerOpen, setPlayerOpen] = useState(false);
  const [referenceTab, setReferenceTab] = useState<"shots" | "characters" | "locations">("shots");

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

  if (loading)
    return <StreamingLoaderOverlay text={streamPreview ?? ""} />;

  if (error && !groups.length)
    return (
      <div className="mx-auto max-w-3xl px-6 py-10 text-sm text-red-400/80">
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
    <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-[1200px] flex-col px-12 py-6">
      <div className="shrink-0">
        <h1 className="font-serif text-3xl text-white">{title}</h1>
        <p className="mt-3 text-sm text-white/40">
          {input.artist} · {input.title}
          {input.runtime ? ` · ${input.runtime}` : ""}
        </p>
        {angle && (
          <p className="mt-3 text-sm text-white/70">
            {angle.pitch}
          </p>
        )}

        {error && groups.length > 0 && (
          <div className="mt-4 text-sm text-red-400/80">
            {error}
            <button
              onClick={onGenerate}
              className="ml-3 underline hover:text-red-300 cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}
      </div>

      <div className="mt-6 flex min-h-0 flex-1 flex-col">
        <div className="mb-3 flex shrink-0 items-center gap-3">
          <div className="flex gap-1 rounded-full border border-white/10 bg-white/5 p-1">
            <button
              onClick={() => setReferenceTab("shots")}
              className={`cursor-pointer rounded-full px-4 py-1 text-sm font-medium transition ${
                referenceTab === "shots"
                  ? "bg-white text-black shadow-sm"
                  : "text-white/60 hover:bg-white/5 hover:text-white/90"
              }`}
            >
              Shots · {groupsWithPrompts.length}
            </button>
            <button
              onClick={() => setReferenceTab("characters")}
              className={`cursor-pointer rounded-full px-4 py-1 text-sm font-medium transition ${
                referenceTab === "characters"
                  ? "bg-white text-black shadow-sm"
                  : "text-white/60 hover:bg-white/5 hover:text-white/90"
              }`}
            >
              Cast · {characters.length}
            </button>
            <button
              onClick={() => setReferenceTab("locations")}
              className={`cursor-pointer rounded-full px-4 py-1 text-sm font-medium transition ${
                referenceTab === "locations"
                  ? "bg-white text-black shadow-sm"
                  : "text-white/60 hover:bg-white/5 hover:text-white/90"
              }`}
            >
              Locations · {locations.length}
            </button>
          </div>
          <div className="flex-1" />
          {groups.length > 0 && (
            <div className="flex items-center gap-3">
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
        </div>
        {/*
          All three tab panes stay mounted at all times — only visibility
          toggles. This keeps every card's usePrediction hook alive across
          tab switches so in-flight Replicate generations continue polling
          in the background instead of being cancelled and lost.
        */}
        <div
          className={
            referenceTab === "shots"
              ? "flex flex-col"
              : "hidden"
          }
        >
            {groupsWithPrompts.length === 0 && !loading && (
              <button
                onClick={onGenerate}
                className="text-sm text-white/40 hover:text-white/70 transition cursor-pointer py-2"
              >
                Generate Shot List
              </button>
            )}
            <div className="flex flex-col gap-4 pb-4">
              {groupsWithPrompts.map(({ group, prompt, klingShots, imagePrompt, referenceImages }, idx) => {
                const value = promptFor(group.groupNumber, prompt);
                // Absolute shot range across the whole sequence (1-indexed):
                // a single-shot group renders "Shot N", a multi-shot group "Shot X-Y".
                const shotStart =
                  groupsWithPrompts
                    .slice(0, idx)
                    .reduce((sum, g) => sum + g.group.shots.length, 0) + 1;
                const shotEnd = shotStart + group.shots.length - 1;
                const shotLabel =
                  shotStart === shotEnd
                    ? `Shot ${shotStart}`
                    : `Shot ${shotStart}-${shotEnd}`;
                return (
                  <div
                    key={group.groupNumber}
                    className="flex shrink-0 flex-row gap-10 bg-white/[0.04] rounded-2xl p-4"
                  >
                    <div className="flex min-w-0 flex-1 basis-1/2 flex-col">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-sm font-medium text-white/40">
                          {shotLabel}
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
                                className="text-sm text-white/40 hover:text-white/70 transition cursor-pointer"
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
                            className="text-sm text-white/40 hover:text-white/70 transition cursor-pointer"
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
                    <div className="min-w-0 flex-1 basis-1/2">
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
                  </div>
                );
              })}
            </div>
          </div>
        {characters.length > 0 && (
            <div
              className={
                referenceTab === "characters"
                  ? "flex flex-col gap-4 pb-4"
                  : "hidden"
              }
            >
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
                  editedDescription={editedCharacters[c.tag]}
                  onDescriptionChange={(description) =>
                    setEditedCharacters((prev) => ({ ...prev, [c.tag]: description }))
                  }
                  copied={copiedCharacter === c.tag}
                  onCopy={() => {
                    const currentDescription = editedCharacters[c.tag] ?? c.description;
                    navigator.clipboard.writeText(currentDescription).then(() => {
                      setCopiedCharacter(c.tag);
                      setTimeout(() => setCopiedCharacter(null), 1500);
                    });
                  }}
                />
              ))}
            </div>
          )}
          {locations.length > 0 && (
            <div
              className={
                referenceTab === "locations"
                  ? "flex flex-col gap-4 pb-4"
                  : "hidden"
              }
            >
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
                  editedDescription={editedLocations[l.tag]}
                  onDescriptionChange={(description) =>
                    setEditedLocations((prev) => ({ ...prev, [l.tag]: description }))
                  }
                  copied={copiedLocation === l.tag}
                  onCopy={() => {
                    const currentDescription = editedLocations[l.tag] ?? l.description;
                    navigator.clipboard.writeText(currentDescription).then(() => {
                      setCopiedLocation(l.tag);
                      setTimeout(() => setCopiedLocation(null), 1500);
                    });
                  }}
                />
              ))}
            </div>
          )}
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

// Fullscreen loading overlay shown while Claude streams the shotlist. We
// render a hint of the live JSON output (anchored to the bottom of a fixed
// box so newest tokens push older lines up and out of view) under a soft
// fade mask — the last line fades out into nothing as it arrives, giving
// a "thinking" feel without dumping the raw JSON on the user.
function StreamingLoaderOverlay({ text }: { text: string }) {
  // Decode Claude's JSON-escaped newlines/quotes so the hint reads more
  // like prose than a single un-wrapped JSON line.
  const display = useMemo(
    () => text.replace(/\\n/g, "\n").replace(/\\"/g, '"'),
    [text]
  );
  const hasText = display.trim().length > 0;

  // Progress is parsed live from the stream. The system prompt asks Claude
  // to emit "shotCount": N as the very first field of the JSON, so that
  // total is available within the first few tokens. The running count is
  // the number of "duration": occurrences seen so far (one per shot, in
  // both single-shot and multi-shot modes). We cap the running count at
  // the declared total because the model occasionally over- or under-shoots
  // the plan, and a "32 of 30" reading would just look broken.
  const { current, total } = useMemo(() => {
    const totalMatch = text.match(/"shotCount"\s*:\s*(\d+)/);
    const totalParsed = totalMatch ? parseInt(totalMatch[1]!, 10) : null;
    const durationMatches = text.match(/"duration"\s*:/g);
    const currentParsed = durationMatches?.length ?? 0;
    return {
      current: totalParsed
        ? Math.min(currentParsed, totalParsed)
        : currentParsed,
      total: totalParsed,
    };
  }, [text]);

  let label = "Generating shots...";
  if (total && current > 0) {
    label = `Generating ${current} of ${total} shots...`;
  } else if (total) {
    label = `Generating ${total} shots...`;
  } else if (current > 0) {
    label = `Generating shot ${current}...`;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#454545]/80 backdrop-blur-sm">
      <div className="flex w-full max-w-xl flex-col px-8">
        <div className="mb-3 flex items-center gap-2 px-2 text-sm font-medium tracking-wide text-white/60">
          <svg
            className="h-4 w-4 animate-spin text-white/60"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden
          >
            <circle
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="3"
              opacity="0.25"
            />
            <circle
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray="60"
              strokeDashoffset="35"
            />
          </svg>
          {label}
        </div>
        <div
          className="relative h-44 w-full overflow-hidden"
          style={{
            WebkitMaskImage:
              "linear-gradient(to bottom, transparent 0%, black 35%, black 65%, transparent 100%)",
            maskImage:
              "linear-gradient(to bottom, transparent 0%, black 35%, black 65%, transparent 100%)",
          }}
        >
          {hasText ? (
            <div className="absolute right-0 bottom-0 left-0 px-2 text-left font-mono text-sm leading-relaxed whitespace-pre-wrap break-words text-white/70">
              {display}
            </div>
          ) : null}
        </div>
      </div>
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

  // Cast/Locations panes mount while hidden (display: none) so their
  // generations can poll in the background. While hidden, scrollHeight is 0
  // and the textarea collapses to a 0px height. When the user switches to
  // that tab the textarea becomes visible — we need to re-measure then.
  // Observing the textarea's width covers both "pane became visible"
  // (width 0 -> real width) and any container resize cases.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let prevWidth = el.offsetWidth;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w === prevWidth) return;
      prevWidth = w;
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      spellCheck={false}
      rows={1}
      className="block w-full resize-none rounded-md border border-white/10 bg-transparent px-3 py-2 text-sm leading-relaxed text-white/70 whitespace-pre-wrap break-words outline-none transition hover:border-white/20 focus:border-white/40 focus:ring-0"
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
  editedDescription?: string;
  onDescriptionChange: (description: string) => void;
  copied: boolean;
  onCopy: () => void;
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
  editedDescription,
  onDescriptionChange,
  copied,
  onCopy,
}: CharacterCardProps) {
  void _look;
  const portrait = useGroupImage({
    initial: initialPortrait,
    onPersist,
  });
  const busy =
    portrait.status === "starting" || portrait.status === "processing";
  const currentDescription = editedDescription ?? character.description;
  const prompt = useMemo(() => derivePortraitPrompt({ ...character, description: currentDescription }), [character, currentDescription]);
  return (
    <div className="flex shrink-0 flex-row gap-10 bg-white/[0.04] rounded-2xl p-4">
      <div className="flex min-w-0 flex-1 basis-1/2 flex-col">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-white">
            {character.tag}
          </span>
          <button
            onClick={onCopy}
            className="text-sm text-white/40 hover:text-white/70 transition cursor-pointer"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <EditablePrompt
          value={currentDescription}
          onChange={onDescriptionChange}
        />
      </div>

      <div className="flex min-w-0 flex-1 basis-1/2 flex-col gap-2">
        <div className="flex h-5 items-center justify-end">
          {portrait.status === "succeeded" && portrait.imageUrl && (
            <span className="text-sm font-medium text-emerald-400/80">
              Anchored
            </span>
          )}
        </div>

        <div className="relative aspect-[3/4] w-full overflow-hidden rounded-xl border border-white/10 bg-white/5">
          {portrait.status === "succeeded" && portrait.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={portrait.imageUrl}
              src={portrait.imageUrl}
              alt={`Portrait reference for ${character.tag}`}
              className="h-full w-full object-cover"
            />
          ) : busy ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-sm text-white/40">
              <div className="h-3 w-3 animate-spin rounded-full border border-white/20 border-t-white/70" />
              <span>{portrait.status === "starting" ? "queued" : "rendering"}</span>
            </div>
          ) : portrait.status === "failed" ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-3 text-center text-sm text-red-400/80">
              <span className="break-words">
                {portrait.error || "Generation failed"}
              </span>
              <button
                onClick={() => portrait.generate(prompt, "3:4")}
                className="underline hover:text-red-300 cursor-pointer"
              >
                Retry
              </button>
            </div>
          ) : (
            <button
              onClick={() => portrait.generate(prompt, "3:4")}
              className="flex h-full w-full items-center justify-center text-sm text-white/40 hover:text-white/70 transition cursor-pointer"
            >
              Generate Portrait
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {portrait.status === "succeeded" && portrait.imageUrl && (
            <>
              <a
                href={portrait.imageUrl}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-white/40 hover:text-white/70 transition cursor-pointer"
              >
                Open
              </a>
              <button
                onClick={() => portrait.generate(prompt, "3:4")}
                className="text-sm text-white/40 hover:text-white/70 transition cursor-pointer"
              >
                Regenerate
              </button>
              <button
                onClick={portrait.reset}
                title="Drop this portrait so videos no longer use it as a reference"
                className="text-sm text-white/40 hover:text-red-400/70 transition cursor-pointer"
              >
                Clear
              </button>
            </>
          )}
          {busy && (
            <button
              onClick={portrait.reset}
              className="text-sm text-white/40 hover:text-white/70 transition cursor-pointer"
            >
              Cancel
            </button>
          )}
        </div>
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
  editedDescription?: string;
  onDescriptionChange: (description: string) => void;
  copied: boolean;
  onCopy: () => void;
}

// One row in the Locations section: tag, anchor description, and a 16:9
// empty-environment reference slot wired to its own Nano Banana 2 lifecycle.
// Horizontal framing matches video output aspect and gives Kling a clean
// architectural reference via <<<image_N>>> markers.
function LocationCard({
  location,
  initialPortrait,
  onPersist,
  editedDescription,
  onDescriptionChange,
  copied,
  onCopy,
}: LocationCardProps) {
  const portrait = useGroupImage({
    initial: initialPortrait,
    onPersist,
  });
  const busy =
    portrait.status === "starting" || portrait.status === "processing";
  const currentDescription = editedDescription ?? location.description;
  const prompt = useMemo(() => deriveLocationPrompt({ ...location, description: currentDescription }), [location, currentDescription]);
  return (
    <div className="flex shrink-0 flex-row gap-10 bg-white/[0.04] rounded-2xl p-4">
      <div className="flex min-w-0 flex-1 basis-1/2 flex-col">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-white">
            {location.tag}
          </span>
          <button
            onClick={onCopy}
            className="text-sm text-white/40 hover:text-white/70 transition cursor-pointer"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <EditablePrompt
          value={currentDescription}
          onChange={onDescriptionChange}
        />
      </div>

      <div className="flex min-w-0 flex-1 basis-1/2 flex-col gap-2">
        <div className="flex h-5 items-center justify-end">
          {portrait.status === "succeeded" && portrait.imageUrl && (
            <span className="text-sm font-medium text-emerald-400/80">
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
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-sm text-white/40">
              <div className="h-3 w-3 animate-spin rounded-full border border-white/20 border-t-white/70" />
              <span>{portrait.status === "starting" ? "queued" : "rendering"}</span>
            </div>
          ) : portrait.status === "failed" ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-3 text-center text-sm text-red-400/80">
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
              className="flex h-full w-full items-center justify-center text-sm text-white/40 hover:text-white/70 transition cursor-pointer"
            >
              Generate Reference
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {portrait.status === "succeeded" && portrait.imageUrl && (
            <>
              <a
                href={portrait.imageUrl}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-white/40 hover:text-white/70 transition cursor-pointer"
              >
                Open
              </a>
              <button
                onClick={() => portrait.generate(prompt, "16:9")}
                className="text-sm text-white/40 hover:text-white/70 transition cursor-pointer"
              >
                Regenerate
              </button>
              <button
                onClick={portrait.reset}
                title="Drop this location reference so videos no longer use it as a reference"
                className="text-sm text-white/40 hover:text-red-400/70 transition cursor-pointer"
              >
                Clear
              </button>
            </>
          )}
          {busy && (
            <button
              onClick={portrait.reset}
              className="text-sm text-white/40 hover:text-white/70 transition cursor-pointer"
            >
              Cancel
            </button>
          )}
        </div>
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
    <div className="flex w-full flex-col gap-2">
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
        <div className="text-sm text-white/30">
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
                    className="text-sm text-white/40 hover:text-white/70 transition cursor-pointer"
                  >
                    Open
                  </a>
                  <button
                    onClick={() => image.generate(imagePrompt, undefined, referenceImages)}
                    className="text-sm text-white/40 hover:text-white/70 transition cursor-pointer"
                  >
                    Regenerate
                  </button>
                  <button
                    onClick={image.reset}
                    title="Discard this storyboard image"
                    className="text-sm text-white/40 hover:text-red-400/70 transition cursor-pointer"
                  >
                    Clear
                  </button>
                </>
              )}
              {imageBusy && (
                <button
                  onClick={image.reset}
                  className="text-sm text-white/40 hover:text-white/70 transition cursor-pointer"
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
                    className="text-sm text-white/40 hover:text-white/70 transition cursor-pointer"
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
                    className="text-sm text-white/40 hover:text-white/70 transition cursor-pointer"
                  >
                    Regenerate
                  </button>
                </>
              )}
              {videoBusy && (
                <button
                  onClick={video.reset}
                  className="text-sm text-white/40 hover:text-white/70 transition cursor-pointer"
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
      className={`flex items-center gap-2 border px-3 py-1.5 text-sm rounded-xl transition cursor-pointer ${
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
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-sm text-white/40">
        <div className="h-3 w-3 animate-spin rounded-full border border-white/20 border-t-white/70" />
        <span>{status === "starting" ? "queued" : "rendering"}</span>
      </div>
    );
  }
  if (status === "failed") {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-3 text-center text-sm text-red-400/80">
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
      className="flex h-full w-full items-center justify-center text-sm text-white/40 hover:text-white/70 transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
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
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-sm text-white/40">
        <div className="h-3 w-3 animate-spin rounded-full border border-white/20 border-t-white/70" />
        <span>{status === "starting" ? "queued" : "rendering"}</span>
      </div>
    );
  }
  if (status === "failed") {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-3 text-center text-sm text-red-400/80">
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
      className="flex h-full w-full flex-col items-center justify-center gap-1 text-sm text-white/40 hover:text-white/70 transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span>Generate Video</span>
      <span className="text-sm text-white/20">
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
      <div className="flex items-center justify-between border-b border-white/10 px-6 py-3 text-sm text-white/40">
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
          <div className="text-sm text-red-400/80">
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
