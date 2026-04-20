"use client";

import type { SongInput } from "@/types";
import { Field } from "@/components/ui/field";
import { Btn } from "@/components/ui/btn";

const EXAMPLE: SongInput = {
  artist: "Radiohead",
  title: "Creep",
  genre: "Alternative Rock",
  runtime: "3:56",
  lyrics: `[Verse 1]
When you were here before
Couldn't look you in the eye
You're just like an angel
Your skin makes me cry
You float like a feather
In a beautiful world
I wish I was special
You're so fuckin' special

[Chorus]
But I'm a creep
I'm a weirdo
What the hell am I doin' here?
I don't belong here

[Verse 2]
I don't care if it hurts
I wanna have control
I want a perfect body
I want a perfect soul
I want you to notice
When I'm not around
You're so fuckin' special
I wish I was special

[Chorus]
But I'm a creep
I'm a weirdo
What the hell am I doin' here?
I don't belong here
Oh-oh, oh-oh

[Bridge]
She's runnin' out the door
She's runnin' out
She run, run, run, run
Run

[Verse 3]
Whatever makes you happy
Whatever you want
You're so fuckin' special
I wish I was special

[Chorus]
But I'm a creep
I'm a weirdo
What the hell am I doin' here?
I don't belong here
I don't belong here`,
};

interface InputStageProps {
  input: SongInput;
  setInput: (v: SongInput) => void;
  onNext: () => void;
}

export function InputStage({ input, setInput, onNext }: InputStageProps) {
  const ready = input.lyrics.trim().length > 20;

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <div className="font-mono text-sm uppercase tracking-widest text-zinc-500">
          01 · Input
        </div>
        <button
          onClick={() => setInput(EXAMPLE)}
          className="font-mono text-sm uppercase tracking-wider text-zinc-600 hover:text-zinc-300 transition cursor-pointer"
        >
          Try an example
        </button>
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
          <div className="font-mono text-sm uppercase tracking-wider text-zinc-500">
            Lyrics
          </div>
          <div className="font-mono text-sm text-zinc-600">
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
          className="w-full resize-none border border-zinc-800 bg-zinc-900 p-4 font-mono text-base leading-relaxed text-zinc-100 outline-none focus:border-zinc-100 transition-colors"
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
