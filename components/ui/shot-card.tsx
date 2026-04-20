import type { Shot } from "@/types";
import { Frame } from "./frame";

interface ShotCardProps {
  shot: Shot;
  palette: string[];
}

export function ShotCard({ shot, palette }: ShotCardProps) {
  return (
    <div className="border border-zinc-800 bg-zinc-900">
      <div className="relative">
        <Frame
          seed={`${shot.shotType} ${shot.description} ${shot.location}`}
          palette={palette}
          aspect="16/9"
          label={`${shot.shotType} · ${shot.cameraMovement}`}
        />
        <div className="absolute left-0 top-0 bg-zinc-100 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-black">
          {String(shot.shotNumber).padStart(2, "0")}
        </div>
      </div>
      <div className="p-3">
        <div className="font-mono text-[9px] uppercase tracking-wider text-zinc-500">
          {shot.section} · {shot.duration}
        </div>
        {shot.lyricLine && (
          <div className="mt-1 font-serif text-xs italic text-zinc-400">
            &ldquo;{shot.lyricLine}&rdquo;
          </div>
        )}
        <p className="mt-2 font-serif text-sm leading-snug text-zinc-200">
          {shot.description}
        </p>
        <div className="mt-2 border-t border-zinc-800 pt-2 font-mono text-[9px] uppercase tracking-wider text-zinc-400">
          <span className="text-zinc-500">loc:</span> {shot.location}
          {shot.characters?.length > 0 && (
            <>
              {" "}
              · <span className="text-zinc-500">in:</span>{" "}
              {Array.isArray(shot.characters)
                ? shot.characters.join(", ")
                : shot.characters}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
