import { useState, useEffect, useRef, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText, Save, Check, Wand2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { captureAuthSession, isAuthSessionCurrent, type AuthSessionLease } from "@/lib/auth";

interface LyricsEditorProps {
  songId: string;
  initialLyrics: string;
  lyrics: string;
  onLyricsChange: (v: string) => void;
  hasSourceAudio?: boolean;
}

export function LyricsEditor({
  songId,
  initialLyrics,
  lyrics,
  onLyricsChange,
  hasSourceAudio = false,
}: LyricsEditorProps) {
  const qc = useQueryClient();
  const [saved, setSaved] = useState(true);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const isDirty = lyrics !== initialLyrics;

  const saveMut = useMutation({
    mutationFn: ({ newLyrics }: { newLyrics: string; session: AuthSessionLease }) =>
      api.songs.update(songId, { lyrics: newLyrics || null }),
    onSuccess: (_data, variables) => {
      if (!isAuthSessionCurrent(variables.session)) return;
      setSaved(true);
      qc.invalidateQueries({ queryKey: ["song", songId] });
    },
  });

  const structureMut = useMutation({
    mutationFn: ({ lyricsText }: { lyricsText: string; session: AuthSessionLease }) =>
      api.songs.structureLyrics(songId, lyricsText),
    onSuccess: (data, variables) => {
      if (!isAuthSessionCurrent(variables.session)) return;
      onLyricsChange(data.lyrics);
      setSaved(false);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveMut.mutate({ newLyrics: data.lyrics, session: variables.session });
      toast.success("Interlude markers added — review and edit as needed");
    },
    onError: (err: Error, variables) => {
      if (isAuthSessionCurrent(variables.session)) toast.error(err.message || "Failed to auto-structure lyrics");
    },
  });

  const debouncedSave = useCallback(
    (value: string) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      const session = captureAuthSession();
      saveTimerRef.current = setTimeout(() => {
        saveMut.mutate({ newLyrics: value, session });
      }, 1500);
    },
    [saveMut],
  );

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const handleChange = (value: string) => {
    onLyricsChange(value);
    setSaved(false);
    debouncedSave(value);
  };

  const handleSaveNow = () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveMut.mutate({ newLyrics: lyrics, session: captureAuthSession() });
  };

  const handleAutoStructure = () => {
    if (!lyrics.trim()) {
      toast.error("Paste your lyrics first, then auto-structure");
      return;
    }
    structureMut.mutate({ lyricsText: lyrics, session: captureAuthSession() });
  };

  const canAutoStructure = hasSourceAudio && lyrics.trim().length > 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-brand" />
          <h3 className="font-display text-lg font-semibold">Lyrics</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleAutoStructure}
            disabled={!canAutoStructure || structureMut.isPending}
            title={
              !hasSourceAudio
                ? "Upload source audio first"
                : !lyrics.trim()
                  ? "Paste lyrics first"
                  : "Detect interludes in the audio and insert markers"
            }
            className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border border-surface-3 bg-surface-1 text-text-secondary hover:bg-surface-2 hover:text-text-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {structureMut.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Wand2 className="w-3 h-3" />
            )}
            {structureMut.isPending ? "Detecting…" : "Auto-structure"}
          </button>
          {isDirty && !saved && (
            <button
              onClick={handleSaveNow}
              disabled={saveMut.isPending}
              className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg bg-brand text-surface-0 hover:bg-brand-bright transition-colors disabled:opacity-50"
            >
              <Save className="w-3 h-3" />
              Save
            </button>
          )}
          {saved && !isDirty && initialLyrics && (
            <span className="flex items-center gap-1 text-xs text-success">
              <Check className="w-3 h-3" />
              Saved
            </span>
          )}
          {saveMut.isPending && (
            <span className="text-xs text-text-muted">Saving…</span>
          )}
        </div>
      </div>
      <textarea
        value={lyrics}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={"爱到心破碎也别去怪谁 只因为相遇太美\n就算流干泪 伤到底 心成灰也无所谓\n\n我破茧成蝶愿和你双飞 最怕你会一去不回\n虽然爱过我 给过我 想过我就是安慰\n\n[Interlude]\n\n我向你飞 雨温柔的坠 像你的拥抱把我包围\n...\n\nPaste the original lyrics here.\nUse [Interlude] to mark instrumental sections.\nWithout lyrics, the AI may hallucinate different vocals."}
        rows={10}
        className="w-full rounded-xl border border-surface-3 bg-surface-1 px-4 py-3 text-sm placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand/40 resize-y font-mono leading-relaxed"
      />
      <p className="text-xs text-text-muted mt-1.5">
        Paste lyrics, then click <strong>Auto-structure</strong> to detect interludes from the audio. Edit freely after.
      </p>
    </div>
  );
}
