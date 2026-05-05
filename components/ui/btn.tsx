"use client";

interface BtnProps {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  primary?: boolean;
  small?: boolean;
  type?: "button" | "submit" | "reset";
}

export function Btn({
  children,
  onClick,
  disabled,
  primary,
  small,
  type = "button",
}: BtnProps) {
  const size = small ? "px-4 py-2 text-xs" : "px-6 py-3 text-sm";
  const style = primary
    ? "bg-zinc-100 text-black hover:bg-white disabled:bg-zinc-800 disabled:text-zinc-600"
    : "border border-zinc-700 text-zinc-300 hover:border-zinc-100 hover:text-zinc-100";

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${size} ${style} font-mono uppercase tracking-wider transition cursor-pointer disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  );
}
