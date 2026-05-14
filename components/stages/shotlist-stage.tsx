"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
// locations for portrait refs. Optionally the generated storyboard for a
// group appends onto that list as <<<image_K>>> (REFERENCE ONLY via prompt
// cues — never wired to `start_image`, which anchors the literal first frame).
const REFERENCE_IMAGE_CAP = 7;

/** Max concurrent Nano Banana still generations for “generate all stills”. */
const BULK_STORYBOARD_CONCURRENCY = 3;
const STORYBOARD_OUTCOME_POLL_MS = 400;
const STORYBOARD_OUTCOME_MAX_MS = 20 * 60_000;

// Inject <<<image_N>>> markers into a prompt string for every TAG that has
// a generated reference image. Characters take indices 1..C, then locations
// follow at C+1..C+L. The N value MUST match the position of the image in
// the reference_images array sent to Kling/Nano Banana 2.
// `maxActiveTags` limits how many tags get markers (use 6 when a storyboard
// reference image steals the seventh Kling slot).
function injectReferenceMarkers(
  text: string,
  refs: { tag: string; hasImage: boolean }[],
  maxActiveTags: number = REFERENCE_IMAGE_CAP
): string {
  const cap = Math.min(maxActiveTags, REFERENCE_IMAGE_CAP);
  const active = refs.filter((r) => r.hasImage).slice(0, cap);
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

// Appends <<<image_storyIndex>>> so Kling binds the group's generated
// storyboard board as staging / composition reference only — never paired with
// `start_image`.
function appendStoryboardReferenceCue(
  prompt: string,
  storyIndex: number
): string {
  if (storyIndex <= 0) return prompt;
  return `${prompt}\nREFERENCE STAGING BOARD ONLY — <<<image_${storyIndex}>> — cinematography framing layout colour blocking cue ONLY beside the prose; do NOT match this freeze as the obligatory opening video frame.`;
}

type MediaPanelSurface = {
  imageBusy: boolean;
  videoBusy: boolean;
  /** Snapshot of the Nano Banana lifecycle for Grid parity with Image tab. */
  imageStatus: ReturnType<typeof useGroupImage>["status"];
  imageError: string | null;
  transientImageUrl: string | null;
};

type MediaPanelHandle = {
  generateImage: () => void;
  generateVideo: () => void;
};

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
  // user can watch the model think instead of staring at a spinner. Filled
  // during PHASE 1 (outline) only — phase 2 is N parallel non-streaming
  // expansions whose progress is conveyed via phaseProgress instead.
  streamPreview?: string;
  // PHASE 2 progress for the two-phase pipeline. total is 0 until phase 1
  // completes; once total > 0 the overlay switches from a streaming
  // outline preview to a "Generating N of M shots..." count-up.
  phaseProgress?: { done: number; total: number };
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
  phaseProgress,
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
  const [shotsView, setShotsView] = useState<"list" | "grid">("list");
  /** Mirrors each group's media hook state into Grid (still frames only there). */
  const [panelSurfaceByGroup, setPanelSurfaceByGroup] = useState<
    Record<number, MediaPanelSurface>
  >({});

  const registerPanelSurface = useCallback((groupNumber: number, s: MediaPanelSurface) => {
    setPanelSurfaceByGroup((prev) => {
      const p = prev[groupNumber];
      if (
        p &&
        p.imageBusy === s.imageBusy &&
        p.videoBusy === s.videoBusy &&
        p.imageStatus === s.imageStatus &&
        p.imageError === s.imageError &&
        p.transientImageUrl === s.transientImageUrl
      )
        return prev;
      return { ...prev, [groupNumber]: s };
    });
  }, []);

  const mediaApisRef = useRef<Map<number, MediaPanelHandle>>(new Map());
  const panelSurfaceRef = useRef(panelSurfaceByGroup);
  panelSurfaceRef.current = panelSurfaceByGroup;
  const imagesBulkRef = useRef(images);
  imagesBulkRef.current = images;
  const [bulkStoryboardRunning, setBulkStoryboardRunning] = useState(false);

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

    const portraitReferenceImages = orderedRefs
      .filter((r) => r.hasImage && r.url)
      .slice(0, REFERENCE_IMAGE_CAP)
      .map((r) => r.url as string);

    const markerRefs = orderedRefs.map((r) => ({
      tag: r.tag,
      hasImage: r.hasImage,
    }));

    return groups.map((g) => {
      const storyUrl = images[g.groupNumber]?.url?.trim() || "";

      const maxTagSlots = storyUrl
        ? REFERENCE_IMAGE_CAP - 1
        : REFERENCE_IMAGE_CAP;

      let prompt = injectReferenceMarkers(g.prompt, markerRefs, maxTagSlots);
      const tagSlice = orderedRefs
        .filter((r) => r.hasImage && r.url)
        .slice(0, maxTagSlots);
      let videoReferenceImages = tagSlice.map((r) => r.url as string);

      if (storyUrl) {
        const cueIndex = tagSlice.length + 1;
        prompt = appendStoryboardReferenceCue(prompt, cueIndex);
        videoReferenceImages = [...videoReferenceImages, storyUrl];
      }

      const klingShots: KlingShot[] | null =
        g.shots.length > 0 && g.shots.length <= 6
          ? g.shots.map((s) => ({
              prompt: injectReferenceMarkers(s.prompt, markerRefs, maxTagSlots),
              duration: Math.max(
                1,
                Math.round(parseDurationSeconds(s.duration) || 1)
              ),
            }))
          : null;

      if (storyUrl && klingShots) {
        const idx = tagSlice.length + 1;
        klingShots.forEach((row, si) => {
          klingShots[si] = {
            ...row,
            prompt: appendStoryboardReferenceCue(row.prompt, idx),
          };
        });
      }

      return {
        group: g,
        prompt,
        klingShots,
        referenceImages: portraitReferenceImages,
        videoReferenceImages,
        imagePrompt: g.imagePrompt,
      };
    });
  }, [
    groups,
    characters,
    portraits,
    locations,
    locationPortraits,
    images,
  ]);

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

  /** Groups missing a storyboard still but with a non-empty image prompt. */
  const bulkPendingStoryboardTargets = useMemo(() => {
    const targets: number[] = [];
    for (const row of groupsWithPrompts) {
      const gn = row.group.groupNumber;
      if (!row.imagePrompt.trim()) continue;
      if (images[gn]?.url) continue;
      targets.push(gn);
    }
    return targets;
  }, [groupsWithPrompts, images]);

  const runBulkStoryboardGeneration = useCallback(async () => {
    const surfaces = panelSurfaceRef;
    const imgs = imagesBulkRef;

    function imageGenBusy(gn: number): boolean {
      const s = surfaces.current[gn];
      return !!(
        s &&
        (s.imageBusy ||
          s.imageStatus === "starting" ||
          s.imageStatus === "processing")
      );
    }

    async function waitStoryboardOutcome(gn: number): Promise<void> {
      const t0 = Date.now();
      let sawBusy = false;

      await new Promise<void>((resolve) => {
        const iv = setInterval(() => {
          if (Date.now() - t0 > STORYBOARD_OUTCOME_MAX_MS) {
            clearInterval(iv);
            resolve();
            return;
          }
          const s = surfaces.current[gn];
          const persisted = imgs.current[gn]?.url;
          const busy = !!(
            s &&
            (s.imageBusy ||
              s.imageStatus === "starting" ||
              s.imageStatus === "processing")
          );
          if (busy) sawBusy = true;

          if (persisted) {
            clearInterval(iv);
            resolve();
            return;
          }
          if (s?.imageStatus === "failed") {
            clearInterval(iv);
            resolve();
            return;
          }
          if (s?.imageStatus === "succeeded") {
            if (s.transientImageUrl || !busy) {
              clearInterval(iv);
              resolve();
              return;
            }
          }
          if (sawBusy && !busy && s?.imageStatus === "idle") {
            clearInterval(iv);
            resolve();
          }
        }, STORYBOARD_OUTCOME_POLL_MS);
      });
    }

    const q = bulkPendingStoryboardTargets.filter((gn) => !imageGenBusy(gn));

    if (q.length === 0) return;

    setBulkStoryboardRunning(true);
    try {
      await Promise.all(
        Array.from(
          {
            length: Math.min(BULK_STORYBOARD_CONCURRENCY, q.length),
          },
          async () => {
            while (q.length > 0) {
              const gn = q.shift();
              if (gn === undefined) break;
              const api = mediaApisRef.current.get(gn);
              if (!api) continue;
              api.generateImage();
              await waitStoryboardOutcome(gn);
            }
          }
        )
      );
    } finally {
      setBulkStoryboardRunning(false);
    }
  }, [bulkPendingStoryboardTargets]);

  const title = shotlistTitle(input, angle);

  if (loading)
    return (
      <StreamingLoaderOverlay
        text={streamPreview ?? ""}
        phaseProgress={phaseProgress}
      />
    );

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
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <h1 className="min-w-0 max-w-[min(100%,42rem)] font-serif text-3xl text-white">
            {title}
          </h1>
          {groups.length > 0 && (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Btn
                small
                iconOnly
                ariaLabel={
                  playableVideos.length
                    ? `Play all ${playableVideos.length} videos`
                    : "Play all videos"
                }
                title={
                  playableVideos.length
                    ? `Play all (${playableVideos.length})`
                    : "Play all"
                }
                onClick={() => setPlayerOpen(true)}
                disabled={playableVideos.length === 0}
              >
                <PlayIcon />
              </Btn>
              <Btn
                small
                iconOnly
                ariaLabel="Download Kling prompts as a text file"
                title="Download .txt"
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
                <DownloadIcon />
              </Btn>
            </div>
          )}
        </div>
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
          {referenceTab === "shots" &&
            groupsWithPrompts.length > 0 && (
              <button
                type="button"
                title="Runs up to 3 Nano Banana stills in parallel. Skips shots that already have a storyboard image."
                disabled={
                  bulkStoryboardRunning ||
                  bulkPendingStoryboardTargets.length === 0
                }
                onClick={() => void runBulkStoryboardGeneration()}
                className="shrink-0 text-sm font-medium transition cursor-pointer text-white/40 hover:text-white/85 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {bulkStoryboardRunning
                  ? "Generating stills…"
                  : bulkPendingStoryboardTargets.length === 0
                    ? "All stills generated"
                    : `Generate missing stills (${bulkPendingStoryboardTargets.length})`}
              </button>
            )}
          {referenceTab === "shots" &&
            groupsWithPrompts.length > 0 && (
              <div className="flex gap-1 rounded-full border border-white/10 bg-white/5 p-1">
                <button
                  type="button"
                  onClick={() => setShotsView("list")}
                  className={`cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition sm:text-sm ${
                    shotsView === "list"
                      ? "bg-white text-black shadow-sm"
                      : "text-white/60 hover:bg-white/5 hover:text-white/90"
                  }`}
                >
                  List
                </button>
                <button
                  type="button"
                  onClick={() => setShotsView("grid")}
                  className={`cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition sm:text-sm ${
                    shotsView === "grid"
                      ? "bg-white text-black shadow-sm"
                      : "text-white/60 hover:bg-white/5 hover:text-white/90"
                  }`}
                >
                  Grid
                </button>
              </div>
            )}
        </div>
        {/*
          Tab panes and Shots List/Grid stay mounted — only visibility toggles.
          That keeps MediaPanel usePrediction hooks alive so in-flight
          Replicate generations keep polling instead of cancelling.
        */}
        <div
          className={
            referenceTab === "shots"
              ? "flex min-h-0 flex-1 flex-col"
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
            <div
              className={`min-h-0 flex-1 flex-col gap-4 pb-4 ${
                shotsView === "list" ? "flex" : "hidden"
              }`}
            >
              {groupsWithPrompts.map(
                (
                  {
                    group,
                    prompt,
                    klingShots,
                    imagePrompt,
                    referenceImages,
                    videoReferenceImages,
                  },
                  idx
                ) => {
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
                        groupNumber={group.groupNumber}
                        mediaApisSink={mediaApisRef}
                        reportPanelSurface={registerPanelSurface}
                        videoPrompt={value}
                        klingShots={klingShots}
                        imagePrompt={imagePrompt}
                        referenceImages={referenceImages}
                        videoReferenceImages={videoReferenceImages}
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

            {/* Grid stays mounted alongside list so list MediaPanels keep polling. */}
            <div
              className={`min-h-0 flex-1 overflow-auto pb-4 ${
                shotsView === "grid" ? "grid" : "hidden"
              } grid-cols-3 gap-3`}
            >
              {groupsWithPrompts.map(({ group, imagePrompt }, idx) => {
                const shotStart =
                  groupsWithPrompts
                    .slice(0, idx)
                    .reduce((sum, g) => sum + g.group.shots.length, 0) + 1;
                const shotEnd = shotStart + group.shots.length - 1;
                const shotLabel =
                  shotStart === shotEnd
                    ? `Shot ${shotStart}`
                    : `Shot ${shotStart}-${shotEnd}`;
                const gn = group.groupNumber;
                const snap = panelSurfaceByGroup[gn];
                const persistedUrl = images[gn]?.url ?? null;

                let frameInner: React.ReactNode;

                if (!snap && persistedUrl) {
                  frameInner = (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={persistedUrl}
                      alt={`${shotLabel} storyboard`}
                      className="h-full w-full object-cover"
                    />
                  );
                } else if (!snap) {
                  frameInner = (
                    <button
                      type="button"
                      onClick={() =>
                        mediaApisRef.current.get(gn)?.generateImage()
                      }
                      disabled={!imagePrompt.trim()}
                      className="flex h-full w-full min-h-[120px] items-center justify-center text-sm text-white/40 hover:text-white/70 transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Generate Image
                    </button>
                  );
                } else {
                  const urlForDisplay =
                    snap.transientImageUrl ?? persistedUrl ?? null;

                  const imageBusyInner =
                    snap.imageBusy ||
                    snap.imageStatus === "starting" ||
                    snap.imageStatus === "processing";

                  if (imageBusyInner) {
                    frameInner = (
                      <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-sm text-white/40">
                        <div className="h-3 w-3 animate-spin rounded-full border border-white/20 border-t-white/70" />
                        <span>
                          {snap.imageStatus === "starting"
                            ? "queued"
                            : "rendering"}
                        </span>
                      </div>
                    );
                  } else if (snap.imageStatus === "failed") {
                    frameInner = (
                      <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-3 text-center text-sm text-red-400/80">
                        <span className="break-words">
                          {snap.imageError || "Generation failed"}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            mediaApisRef.current.get(gn)?.generateImage()
                          }
                          className="underline hover:text-red-300 cursor-pointer"
                        >
                          Retry
                        </button>
                      </div>
                    );
                  } else if (urlForDisplay) {
                    frameInner = (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={urlForDisplay}
                        alt={`${shotLabel} storyboard`}
                        className="h-full w-full object-cover"
                      />
                    );
                  } else {
                    frameInner = (
                      <button
                        type="button"
                        onClick={() =>
                          mediaApisRef.current.get(gn)?.generateImage()
                        }
                        disabled={!imagePrompt.trim()}
                        className="flex h-full w-full min-h-[120px] items-center justify-center text-sm text-white/40 hover:text-white/70 transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Generate Image
                      </button>
                    );
                  }
                }

                return (
                  <div
                    key={`grid-${gn}`}
                    className="flex flex-col gap-1.5"
                  >
                    <div className="aspect-video w-full overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
                      {frameInner}
                    </div>
                    <p className="truncate px-0.5 text-xs font-medium text-white/45">
                      {shotLabel}
                    </p>
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
function StreamingLoaderOverlay({
  text,
  phaseProgress,
}: {
  text: string;
  phaseProgress?: { done: number; total: number };
}) {
  // Decode Claude's JSON-escaped newlines/quotes so the hint reads more
  // like prose than a single un-wrapped JSON line.
  const display = useMemo(
    () => text.replace(/\\n/g, "\n").replace(/\\"/g, '"'),
    [text]
  );
  const hasText = display.trim().length > 0;

  // The pipeline runs in two phases:
  //   Phase 1 — streaming outline call. phaseProgress.total is 0. Show
  //   the live streaming JSON preview underneath a "Planning shotlist..."
  //   label. We can also peek "shotCount" out of the stream as soon as it
  //   appears so the label upgrades to "Planning N shots..." mid-stream.
  //   Phase 2 — N parallel non-streaming expansion calls. phaseProgress
  //   carries authoritative {done,total}; the stream preview becomes stale
  //   (phase 1 ended) so we hide it and show only the count-up.
  const inPhaseTwo = !!(phaseProgress && phaseProgress.total > 0);

  let label = "Planning shotlist...";
  if (inPhaseTwo) {
    label = `Generating ${phaseProgress!.done} of ${phaseProgress!.total} shots...`;
  } else {
    const totalMatch = text.match(/"shotCount"\s*:\s*(\d+)/);
    const totalParsed = totalMatch ? parseInt(totalMatch[1]!, 10) : null;
    if (totalParsed) label = `Planning ${totalParsed} shots...`;
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
        {inPhaseTwo ? (
          <div className="px-2">
            <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-white/70 transition-[width] duration-500 ease-out"
                style={{
                  width: `${Math.min(
                    100,
                    (phaseProgress!.done / Math.max(1, phaseProgress!.total)) *
                      100
                  )}%`,
                }}
              />
            </div>
          </div>
        ) : (
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
              <div className="absolute right-0 bottom-0 left-0 px-2 text-left font-mono text-sm leading-relaxed whitespace-pre-wrap break-words text-white/45">
                {display}
              </div>
            ) : null}
          </div>
        )}
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
  groupNumber: number;
  mediaApisSink: React.MutableRefObject<Map<number, MediaPanelHandle>>;
  reportPanelSurface: (groupNumber: number, surface: MediaPanelSurface) => void;
  videoPrompt: string;
  // Per-shot array for Kling multi-shot mode (groups ≤6 shots).
  // Null falls back to single videoPrompt.
  klingShots?: KlingShot[] | null;
  imagePrompt: string;
  // Portrait URLs only — Nano Banana 2 (still) and Kling image-tab semantics.
  referenceImages: string[];
  // Kling Video: portraits + optional last-slot storyboard (reference_images only).
  videoReferenceImages: string[];
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
//         prompt fallback otherwise. Portraits (+ optional generated storyboard
//         as <<<image_K>>>) flow as reference_images; storyboard never uses start_image.
function MediaPanel({
  groupNumber,
  mediaApisSink,
  reportPanelSurface,
  videoPrompt,
  klingShots,
  imagePrompt,
  referenceImages,
  videoReferenceImages,
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

  const promptsRef = useRef({
    imagePrompt,
    videoPrompt,
    referenceImages,
    videoReferenceImages,
    klingShots,
  });

  promptsRef.current.imagePrompt = imagePrompt;
  promptsRef.current.videoPrompt = videoPrompt;
  promptsRef.current.referenceImages = referenceImages;
  promptsRef.current.videoReferenceImages = videoReferenceImages;
  promptsRef.current.klingShots = klingShots;

  const genRef = useRef({ ig: image.generate, vg: video.generate });
  genRef.current = { ig: image.generate, vg: video.generate };

  /** Stable imperative handle for Grid (and tooling) keyed in `mediaApisSink`. */
  const panelApi = useMemo(
    (): MediaPanelHandle => ({
      generateImage: () => {
        const p = promptsRef.current;
        if (!p.imagePrompt.trim()) return;
        genRef.current.ig(p.imagePrompt, undefined, p.referenceImages);
      },
      generateVideo: () => {
        const p = promptsRef.current;
        if (!p.videoPrompt.trim()) return;
        genRef.current.vg(
          p.videoPrompt,
          p.klingShots ?? null,
          null,
          p.videoReferenceImages
        );
      },
    }),
    []
  );

  useLayoutEffect(() => {
    const sink = mediaApisSink.current;
    sink.set(groupNumber, panelApi);
    return () => {
      sink.delete(groupNumber);
    };
  }, [groupNumber, mediaApisSink, panelApi]);

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

  const reportSurfaceRef = useRef(reportPanelSurface);
  reportSurfaceRef.current = reportPanelSurface;

  useEffect(() => {
    reportSurfaceRef.current(groupNumber, {
      imageBusy,
      videoBusy,
      imageStatus: image.status,
      imageError: image.error,
      transientImageUrl: image.imageUrl ?? null,
    });
  }, [
    groupNumber,
    imageBusy,
    videoBusy,
    image.status,
    image.error,
    image.imageUrl,
  ]);

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
            hasReferences={videoReferenceImages.length > 0}
            onGenerate={() =>
              video.generate(
                videoPrompt,
                klingShots ?? null,
                null,
                videoReferenceImages
              )
            }
          />
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-white/30">
          {tab === "image"
            ? "16:9 · 2K storyboard · preview only"
            : videoReferenceImages.length > 0
            ? `16:9 · 720p · 15s · ref-to-video (${videoReferenceImages.length})`
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
                        videoReferenceImages
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
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className="size-4 shrink-0"
    >
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-4 shrink-0"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}
