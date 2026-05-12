"use client";

import type { SongInput } from "@/types";
import { Field } from "@/components/ui/field";
import { Btn } from "@/components/ui/btn";

const EXAMPLE: SongInput = {
  artist: "Tame Impala",
  title: "Borderline",
  genre: "Psychedelic Pop",
  runtime: "4:34",
  concept:
    "Sun-drenched odyssey through golden hour Los Angeles — empty highways, heat shimmer, anamorphic flares. A figure in motion, spinning and running, caught between euphoria and introspection. Warm Kodachrome tones, kinetic handheld camera, always chasing the light.",
  lyrics: `[Verse 1]
Gone a little far
Gone a little far this time with something
How was I to know?
How was I to know this high came rushing?

[Chorus]
We're on the borderline
Dangerously fine and unforgiving
Possibly a sign
I'm gonna have the strangest night on Sunday

[Verse 2]
Here I go
Quite a show for a loner in L.A.​
I wonder how I managed to end up in this place
Where I couldn't get away

[Chorus]
We're on the borderline (Ooh)
Caught between the tides of pain and rapture
Then I saw the time
Watched it speedin' by like a train
Like a train

[Post-Chorus]
Will I be known and loved?
Is there one that I trust?
Starting to sober up
Has it been long enough?
Will I be known and loved?
Little closer, close enough
I'm a loser, loosen up
Setting free, must be tough
Will I be known and loved?
Is there one that I trust?
Starting to sober up
Has it been long enough?
Will I be so in love?
Any closer? Close enough
Shout out to what is done
R.I.P., here comes the sun
(Here comes the sun)
See Tame Impala Live
Get tickets as low as $101

You might also like
Family Matters
Drake
The Tortured Poets Department
Taylor Swift
6:16 in LA
Kendrick Lamar

[Verse 3]
Gone a little far
Gone a little far this time with something
Rudi said it's fine
They used to do this all the time in college (If you and I get comfortable)

[Chorus]
And we're on the borderline (Ooh)
Caught between the tides of pain and rapture
Then I saw the time
Watched it speedin' by like a train

[Post-Chorus]
Will I be known and loved?
Is there one that I trust?
Starting to sober up
Has it been long enough?
Will I be known and loved?
Little closer, close enough
I'm a loser, loosen up
Setting free, must be tough
Will I be known and loved?
Is there one that I trust?
Starting to sober up
Has it been long enough?
Will I be so in love?
Any closer? Close enough
Shout out to what is done
R.I.P., here comes the sun
(Here comes the sun)`,
};

interface InputStageProps {
  input: SongInput;
  setInput: (v: SongInput) => void;
  onNext: () => void;
}

export function InputStage({ input, setInput, onNext }: InputStageProps) {
  // Idea generation only needs SOMETHING to anchor on — lyrics, a concept,
  // or both. The shotlist stage still requires lyrics to map shots to
  // sections; that gate is enforced separately when leaving Ideas.
  const hasLyrics = input.lyrics.trim().length > 20;
  const hasConcept = input.concept.trim().length > 20;
  const ready = hasLyrics || hasConcept;
  const conceptOnly = hasConcept && !hasLyrics;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="text-xs font-medium text-white/50">
          Song details
        </div>
        <button
          onClick={() => setInput(EXAMPLE)}
          className="text-xs text-white/40 hover:text-white/70 transition cursor-pointer"
        >
          Try an example
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
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
      <div className="mt-3 grid grid-cols-2 gap-3">
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
      <div className="mt-5">
        <div className="mb-2 flex items-baseline justify-between">
          <div className="text-xs font-medium text-white/60">
            Lyrics
          </div>
          <div className="text-xs text-white/30">
            Use [Verse 1], [Chorus] to label sections
          </div>
        </div>
        <textarea
          value={input.lyrics}
          onChange={(e) => setInput({ ...input, lyrics: e.target.value })}
          placeholder={"[Verse 1]\nPaste full lyrics\n\n[Chorus]\nWith section labels"}
          rows={18}
          className="w-full resize-none bg-white/[0.13] border border-white/10 rounded-2xl p-4 text-sm leading-relaxed text-white placeholder:text-white/30 outline-none focus:border-white/30 transition-colors shadow-[0px_4px_24px_rgba(0,0,0,0.08)]"
        />
      </div>
      <div className="mt-5">
        <div className="mb-2 flex items-baseline justify-between">
          <div className="text-xs font-medium text-white/60">
            Concept
          </div>
          <div className="text-xs text-white/30">
            Optional — your direction for the video
          </div>
        </div>
        <textarea
          value={input.concept}
          onChange={(e) => setInput({ ...input, concept: e.target.value })}
          placeholder="e.g. a slow-motion descent through neon-lit corridors, ending in a single static portrait"
          rows={4}
          className="w-full resize-none bg-white/[0.13] border border-white/10 rounded-2xl p-4 text-sm leading-relaxed text-white placeholder:text-white/30 outline-none focus:border-white/30 transition-colors shadow-[0px_4px_24px_rgba(0,0,0,0.08)]"
        />
      </div>
      <div className="mt-6 flex items-center justify-end gap-4">
        {conceptOnly && (
          <div className="text-xs text-white/40">
            No lyrics — ideas will be built from the concept. Lyrics are required for the shot list.
          </div>
        )}
        <Btn primary disabled={!ready} onClick={onNext}>
          Generate Ideas →
        </Btn>
      </div>
    </div>
  );
}
