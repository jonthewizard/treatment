interface LoaderProps {
  text: string;
}

export function Loader({ text }: LoaderProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#454545]/80 backdrop-blur-sm">
      <div className="animate-pulse text-sm font-medium text-white/50 tracking-wide">
        {text}
      </div>
    </div>
  );
}
