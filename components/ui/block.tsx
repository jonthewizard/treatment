interface BlockProps {
  label: string;
  children: React.ReactNode;
}

export function Block({ label, children }: BlockProps) {
  return (
    <div className="mt-8">
      <div className="mb-3 flex items-baseline gap-3">
        <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500 shrink-0">
          {label}
        </span>
        <div className="h-px flex-1 bg-zinc-800" />
      </div>
      {children}
    </div>
  );
}
