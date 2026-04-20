"use client";

import type { SongInput } from "@/types";
import { Field } from "@/components/ui/field";
import { Btn } from "@/components/ui/btn";

interface InputStageProps {
  input: SongInput;
  setInput: (v: SongInput) => void;
  onNext: () => void;
}

export function InputStage({ input, setInput, onNext }: InputStageProps) {
  const ready = input.lyrics.trim().length > 20;

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-6 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
        01 · Input
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field
          label="Artist"
          value={input.artist}
          onChange={(v) => setInput({ ...input, artist: v })}
          placeholder="optional"
        />
        <Field
          label="Song Title"
          value={input.title}
          onChange={(v) => setInput({ ...input, title: v })}
          placeholder="optional"
        />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4">
        <Field
          label="Genre"
          value={input.genre}
          onChange={(v) => setInput({ ...input, genre: v })}
          placeholder="optional"
        />
        <Field
          label="Runtime"
          value={input.runtime}
          onChange={(v) => setInput({ ...input, runtime: v })}
          placeholder="optional"
        />
      </div>
      <div className="mt-6">
        <div className="mb-1.5 flex items-baseline justify-between">
          <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            Lyrics
          </div>
          <div className="font-mono text-[10px] text-zinc-600">
            Use [Verse 1], [Chorus] to label sections
          </div>
        </div>
        <textarea
          value={input.lyrics}
          onChange={(e) => setInput({ ...input, lyrics: e.target.value })}
          placeholder={
            "[Verse 1]\nPaste full lyrics\n\n[Chorus]\nWith section labels"
          }
          rows={18}
          className="w-full resize-none border border-zinc-800 bg-zinc-900 p-4 font-mono text-sm leading-relaxed text-zinc-100 outline-none focus:border-zinc-100 transition-colors"
        />
      </div>
      <div className="mt-6 flex justify-end">
        <Btn primary disabled={!ready} onClick={onNext}>
          Generate Ideas →
        </Btn>
      </div>
    </div>
  );
}
