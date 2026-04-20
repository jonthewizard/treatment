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
      <div className="mb-1.5 font-mono text-sm uppercase tracking-wider text-zinc-500">
        {label}
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full border border-zinc-800 bg-zinc-900 px-3 py-3 font-mono text-base text-zinc-100 outline-none focus:border-zinc-100 transition-colors"
      />
    </label>
  );
}
