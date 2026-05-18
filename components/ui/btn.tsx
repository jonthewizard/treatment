"use client";

interface BtnProps {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  primary?: boolean;
  /** Softer accent for actions on dark UI (e.g. batch generation). */
  darkGreen?: boolean;
  small?: boolean;
  /** Square padding for icon-only controls (pair with ariaLabel). */
  iconOnly?: boolean;
  ariaLabel?: string;
  title?: string;
  type?: "button" | "submit" | "reset";
}

export function Btn({
  children,
  onClick,
  disabled,
  primary,
  darkGreen,
  small,
  iconOnly,
  ariaLabel,
  title,
  type = "button",
}: BtnProps) {
  const size = small
    ? iconOnly
      ? "p-2.5 text-sm"
      : "px-4 py-1 text-sm"
    : iconOnly
      ? "p-3 text-base"
      : "px-5 py-2.5 text-base";
  const radius = small ? "rounded-full" : "rounded-2xl";
  const weight = small ? "font-medium" : "font-sans";
  const style = darkGreen
    ? "bg-emerald-950 border border-emerald-800/80 text-emerald-100 hover:bg-emerald-900 hover:border-emerald-700 hover:text-emerald-50 disabled:border-emerald-900/55 disabled:bg-emerald-950/35 disabled:text-emerald-900/85"
    : primary
    ? "bg-white/90 text-black hover:bg-white disabled:bg-white/20 disabled:text-white/30"
    : "bg-white/10 border border-white/10 text-white/80 hover:bg-white/20 hover:text-white";

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
      className={`${size} ${radius} ${weight} ${style} transition cursor-pointer disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  );
}
