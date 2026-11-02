import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { SongSetup } from "@/components/studio/SongSetup";
import { StylePicker } from "@/components/studio/StylePicker";
import { EngineConfig } from "@/components/studio/EngineConfig";
import { GeneratePanel } from "@/components/studio/GeneratePanel";
import type { Preset, GenerateRequest, Song } from "@/lib/types";
import { useTaskMonitor } from "@/components/layout/TaskMonitorContext";
import { isAuthSessionCurrent, type AuthSessionLease } from "@/lib/auth";

export function StudioPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const monitor = useTaskMonitor();
  const [step, setStep] = useState<"setup" | "configure">("setup");
  const [songId, setSongId] = useState<string | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<Preset | null>(null);
  const [customPrompt, setCustomPrompt] = useState("");
  const [coverStrength, setCoverStrength] = useState(0.5);
  const [vocalGender, setVocalGender] = useState("auto");
  const [vocalLanguage, setVocalLanguage] = useState("zh");

  const handleSongCreated = (id: string, song: Song, session: AuthSessionLease, generation?: number) => {
    if (generation === undefined || !monitor.isGenerationCurrent(generation) || !isAuthSessionCurrent(session)) return;
    const visibleSong = monitor.visibleSong(song, generation);
    if (!visibleSong || !monitor.isGenerationCurrent(generation) || !isAuthSessionCurrent(session)) return;
    queryClient.setQueryData<Song[]>(["songs"], (songs) => {
      if (!songs) return songs;
      const existing = songs.find((item) => item.id === visibleSong.id);
      if (!existing) return [visibleSong, ...songs];
      const merged = { ...existing, ...visibleSong };
      if (existing.lyrics_revision > visibleSong.lyrics_revision) {
        merged.lyrics = existing.lyrics;
        merged.lyrics_revision = existing.lyrics_revision;
      }
      return songs.map((item) => item.id === visibleSong.id ? merged : item);
    });
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

      {step === "setup" && <SongSetup
        onSongCreated={handleSongCreated}
        captureGeneration={monitor.captureGeneration}
        isGenerationCurrent={monitor.isGenerationCurrent}
      />}

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
