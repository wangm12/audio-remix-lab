import { cn } from "@/lib/cn";

interface EngineConfigProps {
  coverStrength: number;
  onCoverStrengthChange: (v: number) => void;
  vocalGender: string;
  onVocalGenderChange: (v: string) => void;
  vocalLanguage: string;
  onVocalLanguageChange: (v: string) => void;
}

const LANGUAGES = [
  { value: "zh", label: "中文" },
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
];

const VOCAL_STYLES = [
  { value: "auto", label: "Auto" },
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
];

export function EngineConfig({
  coverStrength,
  onCoverStrengthChange,
  vocalGender,
  onVocalGenderChange,
  vocalLanguage,
  onVocalLanguageChange,
}: EngineConfigProps) {
  return (
    <div className="space-y-5">
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
        <span id="song-language-label" className="block text-sm font-medium mb-1.5">
          Song language
        </span>
        <div role="group" aria-labelledby="song-language-label" className="flex gap-2">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.value}
              type="button"
              aria-pressed={vocalLanguage === lang.value}
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
        <span id="vocal-style-label" className="block text-sm font-medium mb-1.5">
          Vocal style
        </span>
        <div role="group" aria-labelledby="vocal-style-label" className="flex gap-2">
          {VOCAL_STYLES.map((g) => (
            <button
              key={g.value}
              type="button"
              aria-pressed={vocalGender === g.value}
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
