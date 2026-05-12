interface BlockProps {
  label: string;
  children: React.ReactNode;
}

export function Block({ label, children }: BlockProps) {
  return (
    <div className="mt-8">
      <div className="mb-3 flex items-center gap-3">
        <span className="text-sm font-medium text-white/60 shrink-0">
          {label}
        </span>
        <div className="h-px flex-1 bg-white/10" />
      </div>
      {children}
    </div>
  );
}
