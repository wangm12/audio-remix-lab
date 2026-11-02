import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { Preset } from "@/lib/types";

export type StyleSelection =
  | { type: "preset"; preset: Preset }
  | { type: "custom"; prompt: string };

interface StylePickerProps {
  selected: string | null;
  customPrompt: string;
  onSelect: (preset: Preset) => void;
  onCustom: (prompt: string) => void;
}

export function StylePicker({ selected, customPrompt, onSelect, onCustom }: StylePickerProps) {
  const [isCustom, setIsCustom] = useState(false);
  const presetsQuery = useQuery({
    queryKey: ["presets"],
    queryFn: api.presets.list,
  });
  const { data: presets, isPending, isError, isFetching, refetch } = presetsQuery;

  const handlePresetClick = (preset: Preset) => {
    setIsCustom(false);
    onSelect(preset);
  };

  const handleCustomClick = () => {
    setIsCustom(true);
    onCustom(customPrompt);
  };

  if (isPending && !presets) {
    return (
      <div role="status" aria-label="Loading styles" className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <span className="sr-only">Loading styles…</span>
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="h-28 bg-surface-1 rounded-xl animate-pulse"
          />
        ))}
      </div>
    );
  }

  return (
    <div>
      <h3 className="font-display text-lg font-semibold mb-3">
        Choose a style
      </h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {presets?.map((preset, i) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => handlePresetClick(preset)}
            aria-pressed={!isCustom && selected === preset.id}
            className={cn(
              "flex flex-col items-start p-4 rounded-xl border transition-all text-left animate-fade-in-up",
              !isCustom && selected === preset.id
                ? "border-brand bg-brand/10 ring-1 ring-brand"
                : "border-surface-3 bg-surface-1 hover:border-surface-3 hover:bg-surface-2"
            )}
            style={{ animationDelay: `${i * 50}ms` }}
          >
            <span className="text-2xl mb-2">{preset.cover_art_emoji}</span>
            <span className="text-sm font-semibold">{preset.name}</span>
            <span className="text-xs text-text-muted mt-1 line-clamp-2">
              {preset.description}
            </span>
          </button>
        ))}
        <button
          type="button"
          onClick={handleCustomClick}
          aria-pressed={isCustom}
          className={cn(
            "flex flex-col items-start p-4 rounded-xl border transition-all text-left animate-fade-in-up border-dashed",
            isCustom
              ? "border-brand bg-brand/10 ring-1 ring-brand"
              : "border-surface-3 bg-surface-1 hover:border-brand/50 hover:bg-surface-2"
          )}
          style={{ animationDelay: `${(presets?.length ?? 8) * 50}ms` }}
        >
          <span className="text-2xl mb-2"><Pencil className="w-5 h-5 text-text-muted" /></span>
          <span className="text-sm font-semibold">Custom</span>
          <span className="text-xs text-text-muted mt-1 line-clamp-2">
            Write your own style prompt
          </span>
        </button>
      </div>

      {isError && !presets && <div role="alert" className="mt-3 text-sm text-error">Unable to load styles. <button type="button" onClick={() => void refetch()} disabled={isFetching} className="underline disabled:opacity-50">{isFetching ? "Retrying…" : "Retry"}</button></div>}
      {isError && presets && <p role="alert" className="mt-3 text-sm text-error">Styles could not be refreshed. <button type="button" onClick={() => void refetch()} disabled={isFetching} className="underline disabled:opacity-50">{isFetching ? "Retrying…" : "Retry"}</button></p>}
      {presets && !presets.length && <p className="mt-3 text-sm text-text-muted">No presets available. You can still use Custom.</p>}

      {isCustom && (
        <div className="mt-4 animate-fade-in-up">
          <label htmlFor="custom-prompt" className="block text-sm font-medium mb-1.5">
            Describe the style you want
          </label>
          <textarea
            id="custom-prompt"
            rows={3}
            value={customPrompt}
            onChange={(e) => onCustom(e.target.value)}
            className="w-full px-3 py-2.5 bg-surface-1 border border-surface-3 rounded-lg text-sm focus:border-brand focus:ring-1 focus:ring-brand outline-none transition-colors resize-none"
            placeholder="e.g. lo-fi R&B with soft piano, vinyl crackle, whispered vocals, rainy night atmosphere"
          />
          <p className="text-xs text-text-muted mt-1.5">
            Tip: describe instruments, mood, tempo, and vocal style for best results.
          </p>
        </div>
      )}
    </div>
  );
}
