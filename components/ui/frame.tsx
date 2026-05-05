function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

interface FrameProps {
  seed?: string;
  palette?: string[];
  aspect?: string;
  label?: string;
}

export function Frame({
  seed,
  palette,
  aspect = "16/9",
  label,
}: FrameProps) {
  const h = hash(seed || "x");
  const colors = palette?.length
    ? palette
    : ["#1a1412", "#3d2817", "#8b6f47", "#c9a876", "#e8dcc4"];

  const bands = Array.from({ length: 6 }, (_, i) => ({
    y: (h + i * 37) % 100,
    height: 8 + ((h + i * 13) % 30),
    color: colors[(h + i) % colors.length],
  }));

  const shapes = Array.from({ length: 3 }, (_, i) => ({
    cx: 10 + ((h + i * 53) % 80),
    cy: 20 + ((h + i * 71) % 60),
    r: 8 + ((h + i * 19) % 18),
    color: colors[(h + i + 2) % colors.length],
  }));

  return (
    <div
      style={{ aspectRatio: aspect }}
      className="relative w-full overflow-hidden bg-black"
    >
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full"
      >
        <rect width="100" height="100" fill={colors[h % colors.length]} />
        {bands.map((b, i) => (
          <rect
            key={i}
            x="0"
            y={b.y}
            width="100"
            height={b.height}
            fill={b.color}
            opacity="0.55"
          />
        ))}
        {shapes.map((s, i) => (
          <circle
            key={i}
            cx={s.cx}
            cy={s.cy}
            r={s.r}
            fill={s.color}
            opacity="0.5"
          />
        ))}
      </svg>
      <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
      {label && (
        <div className="absolute bottom-1.5 left-2 right-2 font-mono text-[9px] uppercase tracking-wider text-white/90">
          {label}
        </div>
      )}
    </div>
  );
}
