import asyncio
import json
import shutil
from dataclasses import dataclass
from pathlib import Path

PROBE_TIMEOUT_SECONDS = 30.0

FORMAT_EXTENSIONS = {
    "mp3": "mp3",
    "wav": "wav",
    "flac": "flac",
    "ogg": "ogg",
    "mov,mp4,m4a,3gp,3g2,mj2": "m4a",
}


class AudioProbeError(ValueError):
    """The file is not audio the app accepts."""


@dataclass(frozen=True)
class AudioProbe:
    duration: float
    format_name: str
    codec_name: str
    extension: str


async def probe_audio(path: Path) -> AudioProbe:
    ffprobe = shutil.which("ffprobe")
    if ffprobe is None:
        raise RuntimeError("ffprobe is not installed; install FFmpeg (brew install ffmpeg)")
    process = await asyncio.create_subprocess_exec(
        ffprobe,
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        "-i",
        str(path),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, _ = await asyncio.wait_for(process.communicate(), timeout=PROBE_TIMEOUT_SECONDS)
    except TimeoutError:
        raise AudioProbeError("Timed out while inspecting the audio file") from None
    finally:
        if process.returncode is None:
            process.kill()
            await asyncio.shield(process.wait())
    if process.returncode != 0:
        raise AudioProbeError("The file is not a readable audio file")
    try:
        info = json.loads(stdout or b"{}")
    except json.JSONDecodeError:
        raise AudioProbeError("The file is not a readable audio file") from None

    streams = [stream for stream in info.get("streams", []) if stream.get("codec_type") == "audio"]
    if not streams:
        raise AudioProbeError("The file has no audio stream")
    container = info.get("format", {})
    format_name = container.get("format_name", "")
    extension = FORMAT_EXTENSIONS.get(format_name)
    if extension is None:
        raise AudioProbeError(f"Unsupported audio container: {format_name or 'unknown'}")
    try:
        duration = float(container.get("duration") or streams[0].get("duration") or 0)
    except (TypeError, ValueError):
        duration = 0.0
    if duration <= 0:
        raise AudioProbeError("Could not determine the audio duration")
    return AudioProbe(
        duration=duration,
        format_name=format_name,
        codec_name=streams[0].get("codec_name", ""),
        extension=extension,
    )
