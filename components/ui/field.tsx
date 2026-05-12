"use client";

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}

export function Field({ label, value, onChange, placeholder }: FieldProps) {
  return (
    <label className="block">
      <div className="mb-1.5 text-xs font-medium text-white/60">
        {label}
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-14 bg-white/[0.13] border border-white/10 rounded-2xl px-4 text-sm text-white placeholder:text-white/30 outline-none focus:border-white/30 transition-colors shadow-[0px_4px_24px_rgba(0,0,0,0.08)]"
      />
    </label>
  );
}
