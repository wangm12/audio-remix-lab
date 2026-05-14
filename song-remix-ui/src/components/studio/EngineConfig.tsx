import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Cpu, Cloud, AlertCircle } from "lucide-react";

interface EngineConfigProps {
  engine: string;
  onEngineChange: (engine: string) => void;
  coverStrength: number;
  onCoverStrengthChange: (v: number) => void;
  vocalGender: string;
  onVocalGenderChange: (v: string) => void;
  vocalLanguage: string;
  onVocalLanguageChange: (v: string) => void;
}

const ENGINE_INFO: Record<string, { label: string; icon: typeof Cpu; desc: string }> = {
  acestep: {
    label: "ACE-Step",
    icon: Cpu,
    desc: "Local AI engine — free, private, offline",
  },
  suno: {
    label: "Suno",
    icon: Cloud,
    desc: "Cloud engine — stable, fast, needs account",
  },
};

const LANGUAGES = [
  { value: "zh", label: "中文" },
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
];

export function EngineConfig({
  engine,
  onEngineChange,
  coverStrength,
  onCoverStrengthChange,
  vocalGender,
  onVocalGenderChange,
  vocalLanguage,
  onVocalLanguageChange,
}: EngineConfigProps) {
  const { data: status } = useQuery({
    queryKey: ["engines"],
    queryFn: api.engines.status,
  });

  const available = status?.available_engines ?? [];

  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-display text-lg font-semibold mb-3">Engine</h3>
        <div className="grid grid-cols-2 gap-3">
          {Object.entries(ENGINE_INFO).map(([key, info]) => {
            const isAvailable = available.includes(key);
            const health = status?.health.find((h) => h.engine === key);
            const Icon = info.icon;
            return (
              <button
                key={key}
                onClick={() => isAvailable && onEngineChange(key)}
                disabled={!isAvailable}
                className={cn(
                  "flex flex-col p-4 rounded-xl border transition-all text-left",
                  engine === key
                    ? "border-brand bg-brand/10 ring-1 ring-brand"
                    : isAvailable
                      ? "border-surface-3 bg-surface-1 hover:bg-surface-2"
                      : "border-surface-3 bg-surface-1 opacity-50 cursor-not-allowed"
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Icon className="w-4 h-4" />
                  <span className="text-sm font-semibold">{info.label}</span>
                  {health && !health.healthy && isAvailable && (
                    <AlertCircle className="w-3.5 h-3.5 text-error" />
                  )}
                </div>
                <span className="text-xs text-text-muted">{info.desc}</span>
                {!isAvailable && (
                  <span className="text-xs text-text-muted mt-1">
                    Not configured
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label htmlFor="cover-strength" className="block text-sm font-medium mb-1.5">
          Original preservation:{" "}
          <span className="text-brand font-mono">
            {coverStrength.toFixed(2)}
          </span>
        </label>
        <input
          id="cover-strength"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={coverStrength}
          onChange={(e) => onCoverStrengthChange(parseFloat(e.target.value))}
          className="w-full accent-brand"
        />
        <div className="flex justify-between text-xs text-text-muted mt-1">
          <span>Full R&B transformation</span>
          <span>Keep original melody</span>
        </div>
        <p className="text-xs text-text-muted mt-1.5">
          Higher = preserves more of the original song's melody and structure.
          Lower = gives the AI more freedom for creative R&B reinterpretation.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1.5">Song language</label>
        <div className="flex gap-2">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.value}
              onClick={() => onVocalLanguageChange(lang.value)}
              className={cn(
                "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                vocalLanguage === lang.value
                  ? "bg-brand text-surface-0"
                  : "bg-surface-1 text-text-secondary hover:bg-surface-2"
              )}
            >
              {lang.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1.5">Vocal style</label>
        <div className="flex gap-2">
          {[
            { value: "auto", label: "Auto" },
            { value: "female", label: "Female" },
            { value: "male", label: "Male" },
          ].map((g) => (
            <button
              key={g.value}
              onClick={() => onVocalGenderChange(g.value)}
              className={cn(
                "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                vocalGender === g.value
                  ? "bg-brand text-surface-0"
                  : "bg-surface-1 text-text-secondary hover:bg-surface-2"
              )}
            >
              {g.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-text-muted mt-1.5">
          Guides the AI toward a specific vocal tone. "Auto" follows the source audio.
        </p>
      </div>

    </div>
  );
}
