import pytest

from app.utils import audio_probe
from app.utils.audio_probe import AudioProbeError, probe_audio
from tests.helpers import convert_audio, write_sine_wav


async def test_probe_reads_wav_duration_and_extension(tmp_path):
    probe = await probe_audio(write_sine_wav(tmp_path / "tone.wav", seconds=1.5))
    assert probe.extension == "wav"
    assert probe.duration == pytest.approx(1.5, abs=0.05)
    assert probe.codec_name.startswith("pcm_")


async def test_probe_maps_flac_by_content_not_file_name(tmp_path):
    flac = convert_audio(write_sine_wav(tmp_path / "tone.wav"), tmp_path / "tone.flac")
    disguised = flac.rename(tmp_path / "tone.mp3")
    assert (await probe_audio(disguised)).extension == "flac"


async def test_probe_rejects_text_pretending_to_be_mp3(tmp_path):
    fake = tmp_path / "fake.mp3"
    fake.write_text("definitely not audio")
    with pytest.raises(AudioProbeError):
        await probe_audio(fake)


async def test_probe_requires_ffprobe(monkeypatch, tmp_path):
    monkeypatch.setattr(audio_probe.shutil, "which", lambda name: None)
    with pytest.raises(RuntimeError, match="ffprobe"):
        await probe_audio(tmp_path / "missing.wav")


async def test_cancelling_the_probe_kills_ffprobe(monkeypatch, tmp_path):
    import asyncio
    import os
    import stat

    pidfile = tmp_path / "pid"
    script = tmp_path / "ffprobe"
    script.write_text(f'#!/bin/sh\necho $$ > "{pidfile}"\nexec sleep 30\n')
    script.chmod(script.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setattr(audio_probe.shutil, "which", lambda name: str(script))

    task = asyncio.create_task(probe_audio(tmp_path / "x.wav"))
    for _ in range(100):
        if pidfile.exists() and pidfile.read_text().strip():
            break
        await asyncio.sleep(0.02)
    pid = int(pidfile.read_text())
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    with pytest.raises(ProcessLookupError):
        os.kill(pid, 0)
