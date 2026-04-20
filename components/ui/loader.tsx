interface LoaderProps {
  text: string;
}

export function Loader({ text }: LoaderProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black">
      <div className="animate-pulse font-mono text-xs uppercase tracking-widest text-zinc-500">
        {text}
      </div>
    </div>
  );
}
