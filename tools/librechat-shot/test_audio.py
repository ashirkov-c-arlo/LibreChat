import asyncio
import io
import signal
import sys
import unittest
import wave
from unittest.mock import patch

from audio import AudioError, MIN_BYTES, RATE, Recording, select_source


class AudioTest(unittest.IsolatedAsyncioTestCase):
    def test_source_selection(self):
        sources = [
            {"name": "librechat_browser_audio.monitor", "description": "LibreChat Browser Audio"},
            {"name": "librechat_browser_capture"},
            {"name": "old-route", "description": "LibreChat Zoom Capture"},
            {"name": "new-route", "description": "LibreChat External App Capture"},
            {"name": "alsa_input.mic", "description": "Microphone"},
        ]
        self.assertEqual(select_source("browser", sources), "librechat_browser_capture")
        self.assertEqual(select_source("externalApp", sources), "old-route")
        self.assertEqual(select_source("externalApp", sources[3:]), "new-route")
        self.assertEqual(select_source("microphone", sources, "alsa_input.mic"), "alsa_input.mic")
        for name in ("old-route", "librechat_browser_audio.monitor", "missing"):
            with self.subTest(name=name), self.assertRaises(AudioError):
                select_source("microphone", sources, name)
        with self.assertRaises(AudioError):
            select_source("browser", sources[:1])

    async def make_recording(self):
        process = await asyncio.create_subprocess_exec(
            sys.executable, "-c",
            "import os, signal, sys; "
            "signal.signal(signal.SIGINT, lambda *_: sys.exit(0)); "
            f"os.write(1, bytes({MIN_BYTES})); signal.pause()",
            stdout=asyncio.subprocess.PIPE,
        )
        take = Recording(process)
        self.addAsyncCleanup(take.cancel)
        self.assertTrue(await asyncio.wait_for(take.started, timeout=2))
        return take

    async def test_stop_encodes_pcm_as_wav(self):
        take = await self.make_recording()
        data = await take.stop()
        self.assertIsNotNone(data)
        with wave.open(io.BytesIO(data), "rb") as file:
            self.assertEqual((file.getnchannels(), file.getsampwidth(), file.getframerate()), (1, 2, RATE))
            self.assertEqual(file.readframes(file.getnframes()), bytes(MIN_BYTES))

    async def test_cancel_reaps_recorder_without_returning_audio(self):
        take = await self.make_recording()
        await take.cancel()
        self.assertEqual(take.process.returncode, -signal.SIGKILL)
        self.assertIsNone(await take.stop())

    async def test_recording_deadline_discards_audio(self):
        with patch("audio.MAX_SECONDS", 0.25):
            take = await self.make_recording()
            self.assertIsNone(await asyncio.wait_for(take.task, timeout=2))
        self.assertIsNotNone(take.process.returncode)
