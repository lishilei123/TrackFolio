interface GlassLoaderProps {
  label?: string;
  className?: string;
  heightClass?: string;
  density?: "default" | "compact";
}

export function GlassLoader({
  label = "加载中",
  className = "",
  heightClass = "min-h-[220px]",
  density = "default",
}: GlassLoaderProps) {
  const bars = density === "compact" ? [34, 68, 48, 82] : [34, 60, 45, 84, 54, 72];

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className={`glass-loader ${heightClass} ${className}`}
      data-density={density}
    >
      <div className="glass-loader-core" aria-hidden>
        <span className="glass-loader-line" />
        <span className="glass-loader-line glass-loader-line-alt" />
        <span className="glass-loader-pulse" />
        <span className="glass-loader-bars">
          {bars.map((height, index) => (
            <span
              key={index}
              style={{
                height: `${height}%`,
                animationDelay: `${index * 90}ms`,
              }}
            />
          ))}
        </span>
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}
