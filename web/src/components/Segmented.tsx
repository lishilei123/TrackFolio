export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<[T, string]>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-0.5 rounded-[5px] border border-white/[0.08] bg-white/[0.02] p-0.5">
      {options.map(([val, label]) => (
        <button
          key={val}
          onClick={() => onChange(val)}
          className={`rounded-[3px] px-2.5 py-1 text-xs tracking-wide transition-colors ${
            value === val
              ? "bg-[var(--accent)] font-medium text-[#04201c]"
              : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
