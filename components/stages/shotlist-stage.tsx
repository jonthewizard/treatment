"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { SongInput, Idea, Shot, TreatmentSpecs, GroupVideo } from "@/types";
import { groupShots, formatGroupPrompt } from "@/lib/claude";
import { useGroupVideo } from "@/lib/replicate";
import { Loader } from "@/components/ui/loader";
import { Block } from "@/components/ui/block";
import { Btn } from "@/components/ui/btn";

interface ShotlistStageProps {
  input: SongInput;
  angle: Idea | null;
  shots: Shot[];
  specs: TreatmentSpecs[] | null;
  videos: Record<number, GroupVideo>;
  setVideos: React.Dispatch<React.SetStateAction<Record<number, GroupVideo>>>;
  loading: boolean;
  error: string | null;
  onGenerate: () => void;
  onBack: () => void;
}

function parseDurationSeconds(d: string | undefined): number {
  if (!d) return 0;
  const n = parseFloat(String(d).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function shotlistTitle(input: SongInput, angle: Idea | null): string {
  if (angle?.angle) return angle.angle;
  if (input.title) return input.title;
  return "Shot List";
}

export function ShotlistStage({
  input,
  angle,
  shots,
  specs,
  videos,
  setVideos,
  loading,
  error,
  onGenerate,
  onBack,
}: ShotlistStageProps) {
  const [copiedGroup, setCopiedGroup] = useState<number | null>(null);
  const [edited, setEdited] = useState<Record<number, string>>({});
  const [playerOpen, setPlayerOpen] = useState(false);

  // Group shots into <=15s bundles and pre-compute each group's prompt with
  // its own per-group specs slot. Specs[i] aligns to groups[i]; spec edits
  // for an unedited group ripple into its prompt automatically.
  const groupsWithPrompts = useMemo(() => {
    const groups = groupShots(shots);
    return groups.reduce<
      {
        group: (typeof groups)[number];
        prompt: string;
        start: number;
        index: number;
      }[]
    >((acc, g, i) => {
      const start = acc.length
        ? acc[acc.length - 1].start + acc[acc.length - 1].group.totalSeconds
        : 0;
      const groupSpec = specs?.[i] ?? null;
      acc.push({
        group: g,
        prompt: formatGroupPrompt(g, start, groupSpec),
        start,
        index: i,
      });
      return acc;
    }, []);
  }, [shots, specs]);

  // Reset local edits whenever the underlying shots change (regenerate).
  useEffect(() => {
    setEdited({});
  }, [shots]);

  function promptFor(groupNumber: number, source: string): string {
    return edited[groupNumber] ?? source;
  }

  const totalSeconds = useMemo(
    () => shots.reduce((a, s) => a + parseDurationSeconds(s.duration), 0),
    [shots]
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

  if (loading) return <Loader text="building Seedance shot list" />;

  if (error && !shots.length)
    return (
      <div className="mx-auto max-w-3xl px-6 py-10 font-mono text-xs text-red-400">
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
      <div className="mb-6 flex items-center justify-between gap-4">
        <div className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
          03 · Shot List · Seedance 2.0
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          {shots.length > 0 && (
            <>
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
                  a.download = `${input.artist} - ${input.title} - Seedance Prompts.txt`
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
            </>
          )}
        </div>
      </div>

      <h1 className="font-serif text-5xl text-zinc-100">{title}</h1>
      <p className="mt-3 font-mono text-[11px] uppercase tracking-widest text-zinc-500">
        {input.artist} · {input.title}
        {input.runtime ? ` · ${input.runtime}` : ""}
      </p>
      {angle && (
        <p className="mt-3 border-l-2 border-zinc-100 pl-4 font-serif text-lg italic text-zinc-300">
          {angle.pitch}
        </p>
      )}

      {error && shots.length > 0 && (
        <div className="mt-4 font-mono text-xs text-red-400">
          {error}
          <button
            onClick={onGenerate}
            className="ml-3 underline hover:text-red-300 cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      <Block
        label={
          groupsWithPrompts.length
            ? `${groupsWithPrompts.length} prompt${
                groupsWithPrompts.length === 1 ? "" : "s"
              } · ${shots.length} shot${shots.length === 1 ? "" : "s"} · ${totalSeconds}s`
            : "Prompts"
        }
      >
        {groupsWithPrompts.length === 0 && !loading && (
          <button
            onClick={onGenerate}
            className="font-mono text-[10px] uppercase tracking-wider text-zinc-600 hover:text-zinc-300 transition cursor-pointer py-2"
          >
            Generate Shot List
          </button>
        )}
        <div className="space-y-3">
          {groupsWithPrompts.map(({ group, prompt }) => {
            const value = promptFor(group.groupNumber, prompt);
            return (
              <div
                key={group.groupNumber}
                className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_480px]"
              >
                <div className="min-w-0 border border-zinc-800 bg-zinc-950 p-4">
                  <div className="mb-2 flex items-center justify-end gap-3">
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
                          className="font-mono text-[9px] uppercase tracking-wider text-zinc-500 hover:text-zinc-200 transition cursor-pointer"
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
                      className="font-mono text-[9px] uppercase tracking-wider text-zinc-500 hover:text-zinc-200 transition cursor-pointer"
                    >
                      {copiedGroup === group.groupNumber ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <EditablePrompt
                    value={value}
                    onChange={(next) =>
                      setEdited((e) => ({ ...e, [group.groupNumber]: next }))
                    }
                  />
                </div>
                <VideoPanel
                  groupNumber={group.groupNumber}
                  prompt={value}
                  initial={videos[group.groupNumber] ?? null}
                  onPersist={(next) =>
                    setVideos((vs) => {
                      if (!next) {
                        const copy = { ...vs };
                        delete copy[group.groupNumber];
                        return copy;
                      }
                      return { ...vs, [group.groupNumber]: next };
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
      className="block w-full resize-none border-0 bg-transparent p-0 font-mono text-[11px] leading-relaxed text-zinc-200 whitespace-pre-wrap break-words outline-none focus:ring-0"
    />
  );
}

interface VideoPanelProps {
  groupNumber: number;
  prompt: string;
  initial: GroupVideo | null;
  onPersist: (next: GroupVideo | null) => void;
}

// 320x180 (16:9) frame to the right of each prompt. Generation is fully
// manual: nothing fires until the user clicks Generate. Polling lives in the
// hook and is capped at 15 minutes.
function VideoPanel({
  groupNumber,
  prompt,
  initial,
  onPersist,
}: VideoPanelProps) {
  const { status, videoUrl, error, generate, reset } = useGroupVideo({
    initial,
    onPersist,
  });

  const busy = status === "starting" || status === "processing";

  return (
    <div className="flex w-full flex-col gap-2 md:w-[480px]">
      <div className="relative aspect-video w-full overflow-hidden border border-zinc-800 bg-black">
        {status === "succeeded" && videoUrl && (
          <video
            key={videoUrl}
            src={videoUrl}
            controls
            playsInline
            preload="metadata"
            className="h-full w-full object-cover"
          />
        )}

        {status === "idle" && (
          <button
            onClick={() => generate(prompt)}
            disabled={!prompt.trim()}
            className="flex h-full w-full items-center justify-center font-mono text-[10px] uppercase tracking-wider text-zinc-500 hover:text-zinc-200 transition cursor-pointer disabled:cursor-not-allowed disabled:hover:text-zinc-500"
          >
            Generate Video
          </button>
        )}

        {busy && (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            <div className="h-3 w-3 animate-spin rounded-full border border-zinc-600 border-t-zinc-200" />
            <span>
              {status === "starting" ? "queued" : "rendering"}
            </span>
          </div>
        )}

        {status === "failed" && (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-3 text-center font-mono text-[10px] uppercase tracking-wider text-red-400">
            <span className="break-words normal-case tracking-normal text-[10px]">
              {error || "Generation failed"}
            </span>
            <button
              onClick={() => generate(prompt)}
              className="underline hover:text-red-300 cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="font-mono text-[9px] uppercase tracking-wider text-zinc-600">
          group {groupNumber} · 16:9 · 480p · 15s
        </div>
        <div className="flex items-center gap-3">
          {status === "succeeded" && videoUrl && (
            <>
              <a
                href={videoUrl}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[9px] uppercase tracking-wider text-zinc-500 hover:text-zinc-200 transition cursor-pointer"
              >
                Open
              </a>
              <button
                onClick={() => generate(prompt)}
                className="font-mono text-[9px] uppercase tracking-wider text-zinc-500 hover:text-zinc-200 transition cursor-pointer"
              >
                Regenerate
              </button>
            </>
          )}
          {busy && (
            <button
              onClick={reset}
              className="font-mono text-[9px] uppercase tracking-wider text-zinc-500 hover:text-zinc-200 transition cursor-pointer"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
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
      className="fixed inset-0 z-50 flex flex-col bg-black"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex items-center justify-between border-b border-zinc-900 px-6 py-3 font-mono text-[10px] uppercase tracking-widest text-zinc-400">
        <div>
          Playing {index + 1} of {videos.length} · group {current.groupNumber}
        </div>
        <div className="flex items-center gap-5">
          <button
            onClick={prev}
            disabled={index === 0}
            className="hover:text-zinc-100 transition cursor-pointer disabled:cursor-not-allowed disabled:text-zinc-700"
          >
            ← Prev
          </button>
          <button
            onClick={next}
            className="hover:text-zinc-100 transition cursor-pointer"
          >
            {index >= videos.length - 1 ? "Finish" : "Next →"}
          </button>
          <button
            onClick={onClose}
            className="hover:text-zinc-100 transition cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center p-6">
        {errored ? (
          <div className="font-mono text-xs text-red-400">
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
