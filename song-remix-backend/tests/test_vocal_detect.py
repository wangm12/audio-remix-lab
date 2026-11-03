import importlib
import inspect
import os
import sys
import tempfile
import wave
import unittest
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import patch

import numpy as np

from app.services import vocal_detect


class VocalDetectSeparatorTests(unittest.TestCase):
    def setUp(self):
        vocal_detect._get_separator.cache_clear()

    def tearDown(self):
        vocal_detect._get_separator.cache_clear()

    def test_linux_uses_official_demucs_on_cpu(self):
        demucs_api = importlib.import_module("demucs.api")
        calls = []

        class FakeSeparator:
            def __init__(self, **kwargs):
                calls.append(kwargs)

        with patch.object(vocal_detect, "sys", SimpleNamespace(platform="linux")):
            with patch.object(demucs_api, "Separator", FakeSeparator):
                self.assertIsInstance(vocal_detect._get_separator(), FakeSeparator)

        self.assertEqual(calls, [{"model": "htdemucs", "device": "cpu"}])

    def test_non_linux_keeps_mlx_separator_default(self):
        calls = []

        class FakeSeparator:
            def __init__(self, *args, **kwargs):
                calls.append((args, kwargs))

        fake_mlx = ModuleType("demucs_mlx")
        fake_mlx.Separator = FakeSeparator
        with patch.object(vocal_detect, "sys", SimpleNamespace(platform="darwin")):
            with patch.dict(sys.modules, {"demucs_mlx": fake_mlx}):
                self.assertIsInstance(vocal_detect._get_separator(), FakeSeparator)

        self.assertEqual(calls, [((), {})])

    def test_extract_vocals_converts_stereo_stem_to_numpy(self):
        stereo = np.array([[1.0, 2.0, 3.0], [3.0, 4.0, 5.0]], dtype=np.float32)

        class TensorLike:
            def __array__(self, dtype=None, copy=None):
                return np.asarray(stereo, dtype=dtype)

        class FakeSeparator:
            def separate_audio_file(self, audio_path):
                self.audio_path = audio_path
                return object(), {"vocals": TensorLike()}

        with patch.object(vocal_detect, "_get_separator", return_value=FakeSeparator()):
            vocals, sample_rate = vocal_detect._extract_vocals_sync("song.wav")

        np.testing.assert_array_equal(vocals, np.array([2.0, 3.0, 4.0], dtype=np.float32))
        self.assertEqual(sample_rate, vocal_detect.SAMPLE_RATE)

    def test_official_separator_cpu_audio_path_without_model_download(self):
        import torch
        import demucs.spec as demucs_spec
        from demucs.api import Separator
        from demucs.htdemucs import HTDemucs

        signature = inspect.signature(Separator)
        self.assertEqual(signature.parameters["model"].default, "htdemucs")
        self.assertIn("device", signature.parameters)

        model = HTDemucs(
            sources=["drums", "bass", "other", "vocals"],
            channels=8,
            depth=4,
            nfft=4096,
            t_layers=1,
            t_heads=4,
            use_train_segment=False,
        )
        model.eval()
        get_model_calls = []

        def fake_get_model(name, repo):
            get_model_calls.append((name, repo))
            return model

        stft_calls = 0
        istft_calls = 0
        original_stft = torch.stft
        original_istft = torch.istft

        def count_stft(*args, **kwargs):
            nonlocal stft_calls
            stft_calls += 1
            return original_stft(*args, **kwargs)

        def count_istft(*args, **kwargs):
            nonlocal istft_calls
            istft_calls += 1
            return original_istft(*args, **kwargs)

        sample_count = 8192
        time = np.arange(sample_count, dtype=np.float32) / 44100
        left = (0.2 * np.sin(2 * np.pi * 440 * time) * 32767).astype(np.int16)
        right = (0.2 * np.sin(2 * np.pi * 660 * time) * 32767).astype(np.int16)
        interleaved = np.stack((left, right), axis=1).reshape(-1)

        with tempfile.TemporaryDirectory(prefix="vocal-detect-cpu-") as temp_dir:
            audio_path = Path(temp_dir) / "synthetic.wav"
            with wave.open(str(audio_path), "wb") as wav:
                wav.setnchannels(2)
                wav.setsampwidth(2)
                wav.setframerate(44100)
                wav.writeframes(interleaved.tobytes())

            with patch.dict(
                os.environ,
                {"HF_HUB_OFFLINE": "1", "HF_HUB_DISABLE_TELEMETRY": "1"},
            ):
                with patch("demucs.api.get_model", side_effect=fake_get_model):
                    with patch.object(demucs_spec.th, "stft", side_effect=count_stft):
                        with patch.object(demucs_spec.th, "istft", side_effect=count_istft):
                            separator = Separator(
                                model="htdemucs", device="cpu", shifts=0, split=False
                            )
                            with patch.object(
                                vocal_detect, "_get_separator", return_value=separator
                            ):
                                vocals, sample_rate = vocal_detect._extract_vocals_sync(
                                    str(audio_path)
                                )

        rms = vocal_detect._compute_rms(vocals, sample_rate, vocal_detect.WINDOW_SEC)

        self.assertEqual(get_model_calls, [("htdemucs", None)])
        self.assertEqual(separator._device, "cpu")
        self.assertGreater(stft_calls, 0)
        self.assertGreater(istft_calls, 0)
        self.assertEqual(sample_rate, 44100)
        self.assertEqual(vocals.shape, (sample_count,))
        self.assertTrue(np.isfinite(vocals).all())
        self.assertEqual(rms.shape, (1,))
        self.assertTrue(np.isfinite(rms).all())


if __name__ == "__main__":
    unittest.main()
