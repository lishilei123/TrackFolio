export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<[T, string]>;
  value: T;
  onChange: (v: T) => void;
}) {
  const activeIndex = options.findIndex(([val]) => val === value);

  return (
    <div
      className="relative grid rounded-[5px] border border-white/[0.08] bg-white/[0.02] p-0.5"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {activeIndex >= 0 && (
        <span
          aria-hidden
          className="segment-indicator absolute bottom-0.5 left-0.5 top-0.5 rounded-[3px] bg-[var(--accent)]"
          style={{
            width: `calc((100% - 4px) / ${options.length})`,
            transform: `translateX(${activeIndex * 100}%)`,
          }}
        />
      )}
      {options.map(([val, label]) => (
        <button
          key={val}
          onClick={() => onChange(val)}
          className={`relative z-10 whitespace-nowrap rounded-[3px] px-2 py-1 text-xs tracking-wide transition-colors sm:px-2.5 ${
            value === val
              ? "font-medium text-[var(--accent-contrast)]"
              : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
