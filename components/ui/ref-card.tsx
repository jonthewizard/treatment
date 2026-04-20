import { Frame } from "./frame";

interface RefCardProps {
  title: string;
  subtitle: string;
  description: string;
  meta?: string;
  metaLabel?: string;
  seed: string;
  palette: string[];
  aspect: string;
}

export function RefCard({
  title,
  subtitle,
  description,
  meta,
  metaLabel,
  seed,
  palette,
  aspect,
}: RefCardProps) {
  return (
    <div className="border border-zinc-800 bg-zinc-900">
      <Frame seed={seed} palette={palette} aspect={aspect} />
      <div className="p-3">
        <div className="font-mono text-[9px] uppercase tracking-wider text-zinc-500">
          {subtitle}
        </div>
        <div className="font-serif text-lg text-zinc-100">{title}</div>
        <p className="mt-1.5 font-serif text-sm leading-snug text-zinc-300">
          {description}
        </p>
        {meta && (
          <div className="mt-2 border-t border-zinc-800 pt-2">
            <div className="font-mono text-[9px] uppercase tracking-wider text-zinc-500">
              {metaLabel}
            </div>
            <div className="font-serif text-xs italic text-zinc-300">{meta}</div>
          </div>
        )}
      </div>
    </div>
  );
}
