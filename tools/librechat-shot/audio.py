import asyncio
import io
import json
import re
import signal
import wave

RATE = 16_000
SAMPLE_BYTES = 2
MAX_SECONDS = 300
MIN_BYTES = RATE * SAMPLE_BYTES // 4
SOURCES = {
    "browser": re.compile(r"^librechat_browser(?:_|$)"),
    "externalApp": re.compile(r"^librechat_(?:external_app|zoom)(?:_|$)"),
}


class AudioError(Exception):
    pass


async def pactl(*args):
    process = await asyncio.create_subprocess_exec(
        "pactl", *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL
    )
    try:
        output, _ = await asyncio.wait_for(process.communicate(), timeout=2)
    finally:
        if process.returncode is None:
            process.kill()
            await process.wait()
    if process.returncode != 0:
        raise AudioError("Could not read the PipeWire audio sources.")
    return output.decode()


def select_source(action, sources, default=""):
    for source in sources:
        name = source["name"]
        labels = [name, source.get("description", "")]
        labels = [re.sub(r"[^a-z0-9]+", "_", label.lower()) for label in labels]
        monitor = name.endswith(".monitor") or source.get("monitor_source") not in (None, "")
        if action == "microphone":
            if name == default and not monitor and not any("librechat_" in s for s in labels):
                return name
        elif not monitor and any(SOURCES[action].match(s) for s in labels):
            return name
    raise AudioError("The requested audio source is not available.")


class Recording:
    def __init__(self, process):
        self.process = process
        self.started = asyncio.get_running_loop().create_future()
        self.task = asyncio.create_task(self._read())

    @classmethod
    async def start(cls, action):
        try:
            sources = json.loads(await pactl("--format=json", "list", "sources"))
            default = (await pactl("get-default-source")).strip() if action == "microphone" else ""
            device = select_source(action, sources, default)
            process = await asyncio.create_subprocess_exec(
                "parec", "--raw", "--format=s16le", f"--rate={RATE}", "--channels=1",
                "--latency-msec=100", "--client-name=LibreChat Shot",
                "--property=node.dont-fallback=true", "--property=node.dont-move=true",
                f"--device={device}",
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
            )
        except (OSError, TimeoutError, ValueError) as error:
            raise AudioError("Could not open the PipeWire audio source.") from error
        return cls(process)

    async def _read(self):
        data = bytearray()
        try:
            async with asyncio.timeout(MAX_SECONDS):
                while chunk := await self.process.stdout.read(8192):
                    data.extend(chunk)
                    if not self.started.done():
                        self.started.set_result(True)
                    if len(data) >= RATE * SAMPLE_BYTES * MAX_SECONDS:
                        return None
                if await self.process.wait() != 0 or len(data) < MIN_BYTES:
                    return None
        except TimeoutError:
            return None
        finally:
            if not self.started.done():
                self.started.set_result(False)
            await self._kill()
        output = io.BytesIO()
        with wave.open(output, "wb") as file:
            file.setnchannels(1)
            file.setsampwidth(SAMPLE_BYTES)
            file.setframerate(RATE)
            file.writeframes(memoryview(data)[:len(data) // SAMPLE_BYTES * SAMPLE_BYTES])
        return output.getvalue()

    async def stop(self):
        if self.task.done():
            return None
        try:
            self.process.send_signal(signal.SIGINT)
            return await asyncio.wait_for(self.task, timeout=2)
        except (ProcessLookupError, TimeoutError):
            return None

    async def cancel(self):
        self.task.cancel()
        await asyncio.gather(self.task, return_exceptions=True)
        await self._kill()

    async def _kill(self):
        if self.process.returncode is None:
            try:
                self.process.kill()
            except ProcessLookupError:
                pass
            # Drain the pipe so a paused stdout transport cannot delay reaping.
            while await self.process.stdout.read(8192):
                pass
            await self.process.wait()
