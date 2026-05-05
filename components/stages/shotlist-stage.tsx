"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { SongInput, Idea, Shot, TreatmentSpecs } from "@/types";
import { groupShots, formatGroupPrompt } from "@/lib/claude";
import { Loader } from "@/components/ui/loader";
import { Block } from "@/components/ui/block";
import { Btn } from "@/components/ui/btn";

interface ShotlistStageProps {
  input: SongInput;
  angle: Idea | null;
  shots: Shot[];
  specs: TreatmentSpecs[] | null;
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
  loading,
  error,
  onGenerate,
  onBack,
}: ShotlistStageProps) {
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedGroup, setCopiedGroup] = useState<number | null>(null);
  const [edited, setEdited] = useState<Record<number, string>>({});

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
    <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <div className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
          03 · Shot List · Seedance 2.0
        </div>
        <Btn small onClick={onGenerate}>
          {shots.length ? "Regenerate" : "Generate"}
        </Btn>
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
                className="border border-zinc-800 bg-zinc-950 p-4"
              >
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
            );
          })}
        </div>
      </Block>

      <div className="mt-8 flex justify-between">
        <Btn onClick={onBack}>← Back</Btn>
        <div className="flex gap-3">
          <Btn
            small
            onClick={() => {
              navigator.clipboard.writeText(copyAll()).then(() => {
                setCopiedAll(true);
                setTimeout(() => setCopiedAll(false), 2000);
              });
            }}
          >
            {copiedAll ? "Copied!" : "Copy All"}
          </Btn>
          <Btn
            primary
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
            Download .txt
          </Btn>
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
