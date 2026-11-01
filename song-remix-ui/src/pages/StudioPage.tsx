import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { SongSetup } from "@/components/studio/SongSetup";
import { StylePicker } from "@/components/studio/StylePicker";
import { EngineConfig } from "@/components/studio/EngineConfig";
import { GeneratePanel } from "@/components/studio/GeneratePanel";
import type { Preset, GenerateRequest } from "@/lib/types";

export function StudioPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<"setup" | "configure">("setup");
  const [songId, setSongId] = useState<string | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<Preset | null>(null);
  const [customPrompt, setCustomPrompt] = useState("");
  const [coverStrength, setCoverStrength] = useState(0.5);
  const [vocalGender, setVocalGender] = useState("auto");
  const [vocalLanguage, setVocalLanguage] = useState("zh");

  const handleSongCreated = (id: string) => {
    setSongId(id);
    setStep("configure");
    navigate({ to: "/studio/$songId", params: { songId: id } });
  };

  const hasStyle = selectedPreset || customPrompt.trim();
  const generateRequest: GenerateRequest | null =
    songId && hasStyle
      ? {
          ...(selectedPreset
            ? { style_preset_id: selectedPreset.id }
            : { style_prompt: customPrompt.trim() }),
          vocal_gender: vocalGender,
          engine_params: { cover_strength: coverStrength, vocal_language: vocalLanguage },
        }
      : null;

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <h1 className="font-display text-3xl font-bold mb-2">Studio</h1>
      <p className="text-text-secondary mb-8">
        Transform any song into a smooth R&B remix
      </p>

      {step === "setup" && <SongSetup onSongCreated={handleSongCreated} />}

      {step === "configure" && (
        <div className="space-y-8">
          <StylePicker
            selected={selectedPreset?.id ?? null}
            customPrompt={customPrompt}
            onSelect={(p) => { setSelectedPreset(p); setCustomPrompt(""); }}
            onCustom={(p) => { setCustomPrompt(p); setSelectedPreset(null); }}
          />
          <EngineConfig
            coverStrength={coverStrength}
            onCoverStrengthChange={setCoverStrength}
            vocalGender={vocalGender}
            onVocalGenderChange={setVocalGender}
            vocalLanguage={vocalLanguage}
            onVocalLanguageChange={setVocalLanguage}
          />
          <GeneratePanel
            songId={songId}
            request={generateRequest}
            disabled={!hasStyle}
          />
        </div>
      )}
    </div>
  );
}
