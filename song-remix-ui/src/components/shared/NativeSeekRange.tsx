interface NativeSeekRangeProps {
  label: string;
  value: number;
  duration: number;
  onSeek: (seconds: number) => void;
  formatTime: (seconds: number) => string;
  className?: string;
}

export function NativeSeekRange({ label, value, duration, onSeek, formatTime, className = "" }: NativeSeekRangeProps) {
  const available = Number.isFinite(duration) && duration > 0;
  const safeDuration = available ? duration : 0;
  const safeValue = available && Number.isFinite(value) ? Math.min(safeDuration, Math.max(0, value)) : 0;
  const percent = available ? `${(safeValue / safeDuration) * 100}%` : "0%";

  return (
    <div className={`seek-range-wrap ${className}`}>
      <div aria-hidden="true" className="seek-range-track">
        <div className="seek-range-progress" style={{ width: percent }} />
      </div>
      <input
        type="range"
        min={0}
        max={safeDuration}
        step="any"
        value={safeValue}
        disabled={!available}
        aria-label={label}
        aria-valuetext={`${formatTime(safeValue)} of ${available ? formatTime(safeDuration) : "duration unavailable"}`}
        className="seek-range"
        onChange={(event) => {
          const next = Number(event.currentTarget.value);
          if (available && Number.isFinite(next)) onSeek(Math.min(safeDuration, Math.max(0, next)));
        }}
      />
    </div>
  );
}
