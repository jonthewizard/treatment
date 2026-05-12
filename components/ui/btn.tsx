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
  const size = small ? "px-4 py-1 text-sm" : "px-5 py-2.5 text-base";
  const radius = small ? "rounded-full" : "rounded-2xl";
  const weight = small ? "font-medium" : "font-sans";
  const style = primary
    ? "bg-white/90 text-black hover:bg-white disabled:bg-white/20 disabled:text-white/30"
    : "bg-white/10 border border-white/10 text-white/80 hover:bg-white/20 hover:text-white";

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${size} ${radius} ${weight} ${style} transition cursor-pointer disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  );
}
