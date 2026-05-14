"""
Vocal detection service: extracts vocals via Demucs-MLX, detects instrumental
gaps (interludes) via RMS energy analysis, and inserts [Interlude] markers
into user-provided lyrics at the correct positions.
"""

from __future__ import annotations

import asyncio
import logging
import re
from functools import lru_cache

import numpy as np

logger = logging.getLogger(__name__)

WINDOW_SEC = 0.5
MIN_GAP_SEC = 3.0
ENERGY_THRESHOLD_RATIO = 0.05
SAMPLE_RATE = 44100

MARKER_RE = re.compile(
    r"^\s*\[(?:Interlude|Intro|Outro|Bridge|Solo|Instrumental)\]\s*$",
    re.IGNORECASE,
)


@lru_cache(maxsize=1)
def _get_separator():
    from demucs_mlx import Separator

    return Separator()


def _extract_vocals_sync(audio_path: str) -> tuple[np.ndarray, int]:
    """Run Demucs separation and return the vocals stem as a numpy array."""
    separator = _get_separator()
    _origin, stems = separator.separate_audio_file(audio_path)
    vocals = stems["vocals"]
    if hasattr(vocals, "__array__"):
        vocals = np.array(vocals)
    if vocals.ndim == 2:
        vocals = vocals.mean(axis=0)
    return vocals, SAMPLE_RATE


def _compute_rms(audio: np.ndarray, sr: int, window_sec: float) -> np.ndarray:
    """Compute RMS energy in fixed-size windows."""
    window_samples = int(sr * window_sec)
    n_windows = len(audio) // window_samples
    if n_windows == 0:
        return np.array([np.sqrt(np.mean(audio**2))])
    trimmed = audio[: n_windows * window_samples]
    frames = trimmed.reshape(n_windows, window_samples)
    return np.sqrt(np.mean(frames**2, axis=1))


def _find_gaps(
    rms: np.ndarray,
    window_sec: float,
    min_gap_sec: float,
    threshold_ratio: float,
) -> list[tuple[float, float]]:
    """Find contiguous regions where vocal energy is below threshold."""
    threshold = np.max(rms) * threshold_ratio
    below = rms < threshold
    gaps: list[tuple[float, float]] = []
    start = None
    for i, is_low in enumerate(below):
        if is_low and start is None:
            start = i
        elif not is_low and start is not None:
            duration = (i - start) * window_sec
            if duration >= min_gap_sec:
                gaps.append((start * window_sec, i * window_sec))
            start = None
    if start is not None:
        duration = (len(rms) - start) * window_sec
        if duration >= min_gap_sec:
            gaps.append((start * window_sec, len(rms) * window_sec))
    return gaps


async def detect_interludes(
    audio_path: str,
    min_gap_sec: float = MIN_GAP_SEC,
) -> tuple[list[tuple[float, float]], float]:
    """
    Detect instrumental gaps in the audio.
    Returns (list of (start_sec, end_sec) gaps, total_duration_sec).
    """
    loop = asyncio.get_event_loop()
    vocals, sr = await loop.run_in_executor(None, _extract_vocals_sync, audio_path)
    total_duration = len(vocals) / sr
    rms = _compute_rms(vocals, sr, WINDOW_SEC)
    gaps = _find_gaps(rms, WINDOW_SEC, min_gap_sec, ENERGY_THRESHOLD_RATIO)
    logger.info(
        "Detected %d interludes in %.1fs audio: %s",
        len(gaps),
        total_duration,
        [(f"{s:.1f}", f"{e:.1f}") for s, e in gaps],
    )
    return gaps, total_duration


def insert_interlude_markers(
    lyrics: str,
    interludes: list[tuple[float, float]],
    total_duration: float,
) -> str:
    """
    Insert [Interlude] / [Intro] / [Outro] markers into lyrics at positions
    corresponding to detected instrumental gaps.

    Line timing is estimated proportionally by character count within the
    vocal (non-interlude) portions of the audio.
    """
    raw_lines = lyrics.split("\n")

    content_lines: list[tuple[int, str]] = []
    for i, line in enumerate(raw_lines):
        stripped = line.strip()
        if stripped and not MARKER_RE.match(stripped):
            content_lines.append((i, stripped))

    if not content_lines or not interludes:
        return lyrics

    total_chars = sum(len(text) for _, text in content_lines)
    if total_chars == 0:
        return lyrics

    vocal_duration = total_duration - sum(end - start for start, end in interludes)
    if vocal_duration <= 0:
        vocal_duration = total_duration

    sorted_interludes = sorted(interludes, key=lambda x: x[0])

    line_end_times: list[float] = []
    accumulated_time = 0.0
    interlude_idx = 0

    if sorted_interludes and sorted_interludes[0][0] < 1.0:
        accumulated_time = sorted_interludes[0][1]
        interlude_idx = 1

    for _, text in content_lines:
        char_fraction = len(text) / total_chars
        line_dur = char_fraction * vocal_duration
        accumulated_time += line_dur

        while interlude_idx < len(sorted_interludes):
            gap_start, gap_end = sorted_interludes[interlude_idx]
            if accumulated_time >= gap_start - 1.0:
                accumulated_time = gap_end
                interlude_idx += 1
            else:
                break

        line_end_times.append(accumulated_time)

    first_gap_is_intro = bool(
        sorted_interludes and sorted_interludes[0][0] < 1.0
    )

    insert_after: dict[int, tuple[float, float]] = {}
    for idx, (gap_start, gap_end) in enumerate(sorted_interludes):
        if idx == 0 and first_gap_is_intro:
            continue
        best_line = None
        best_dist = float("inf")
        for j, end_t in enumerate(line_end_times):
            dist = abs(end_t - gap_start)
            if dist < best_dist:
                best_dist = dist
                best_line = j
        if best_line is not None:
            original_idx = content_lines[best_line][0]
            insert_after[original_idx] = (gap_start, gap_end)

    result_lines: list[str] = []
    if first_gap_is_intro:
        result_lines.append("[Intro]")
        result_lines.append("")

    last_content_idx = content_lines[-1][0]
    for i, line in enumerate(raw_lines):
        result_lines.append(line)
        if i in insert_after:
            gap_start, gap_end = insert_after[i]
            is_outro = i == last_content_idx and gap_end >= total_duration - 2.0
            marker = "[Outro]" if is_outro else "[Interlude]"
            result_lines.append("")
            result_lines.append(marker)
            result_lines.append("")

    return "\n".join(result_lines)
