import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from aiohttp import WSMsgType, WSServerHandshakeError
from aiohttp.test_utils import TestClient, TestServer

from bridge import PNG_SIGNATURE, create_app

TOKEN = "f" * 64
ORIGIN = "https://chat.example.com"
HOST = "127.0.0.1:17321"
NATIVE_HEADERS = {"Host": HOST, "X-Token": TOKEN}
BROWSER_HEADERS = {"Host": HOST, "Origin": ORIGIN}


class BridgeTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        with patch("bridge.MAX_PNG_BYTES", 16):
            app = create_app({"origin": ORIGIN, "port": 17321, "token": TOKEN})
        self.client = TestClient(TestServer(app))
        await self.client.start_server()
        self.addAsyncCleanup(self.client.close)

    async def receiver(self):
        socket = await self.client.ws_connect(f"/ws?token={TOKEN}", headers=BROWSER_HEADERS)
        self.assertEqual(await socket.receive_str(timeout=2), "ready-v2")
        return socket

    async def test_delivers_png_to_one_receiver(self):
        socket = await self.receiver()
        second = await self.client.ws_connect(f"/ws?token={TOKEN}", headers=BROWSER_HEADERS)
        rejected = await second.receive(timeout=2)
        self.assertEqual(rejected.type, WSMsgType.CLOSE)
        self.assertEqual(rejected.data, 4009)

        data = PNG_SIGNATURE + b"data"
        request = asyncio.ensure_future(self.client.post(
            "/upload", headers={**NATIVE_HEADERS, "Content-Type": "image/png"}, data=data
        ))
        self.assertEqual(await socket.receive_bytes(timeout=2), data)
        self.assertFalse(request.done())
        await socket.send_str("accepted")
        self.assertEqual((await request).status, 204)

    async def start_audio(self, socket, source):
        take = AsyncMock()
        take.started = asyncio.get_running_loop().create_future()
        take.started.set_result(True)
        take.task = asyncio.get_running_loop().create_future()
        take.stop.return_value = b"RIFF\x00\x00\x00\x00WAVEdata"
        with patch("bridge.Recording.start", return_value=take) as start:
            request = asyncio.ensure_future(self.client.post(
                "/command", headers=NATIVE_HEADERS, data=source
            ))
            self.assertEqual(await socket.receive_str(timeout=2), "arm-audio")
            start.assert_not_awaited()
            await socket.send_str("accepted")
            response = await request
            self.assertEqual(response.status, 200)
            self.assertEqual(await response.text(), "recording-started")
            start.assert_awaited_once_with(source)
        return take

    async def test_two_presses_record_locally_and_deliver_wav(self):
        socket = await self.receiver()
        for source in ["browser", "externalApp", "microphone"]:
            with self.subTest(source=source):
                take = await self.start_audio(socket, source)
                request = asyncio.ensure_future(self.client.post(
                    "/command", headers=NATIVE_HEADERS, data=source
                ))
                self.assertEqual(await socket.receive_bytes(timeout=2), take.stop.return_value)
                await socket.send_str("accepted")
                self.assertEqual(await (await request).text(), "audio-delivered")
                take.stop.assert_awaited_once()
                take.cancel.assert_awaited_once()

    async def test_status_reports_a_live_recording_and_clears_after_exit(self):
        socket = await self.receiver()
        for headers in [{"Host": HOST}, {**NATIVE_HEADERS, "Origin": ORIGIN}]:
            self.assertEqual((await self.client.get("/recording", headers=headers)).status, 403)
        take = await self.start_audio(socket, "externalApp")
        response = await self.client.get("/recording", headers=NATIVE_HEADERS)
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertEqual(await response.text(), "externalApp")
        take.task.set_result(None)
        response = await self.client.get("/recording", headers=NATIVE_HEADERS)
        self.assertEqual(await response.text(), "")

    async def test_other_source_cancels_without_transcription(self):
        socket = await self.receiver()
        take = await self.start_audio(socket, "browser")
        response = await self.client.post("/command", headers=NATIVE_HEADERS, data="microphone")
        self.assertEqual(await response.text(), "recording-canceled")
        take.stop.assert_not_awaited()
        take.cancel.assert_awaited_once()

    async def test_disconnect_cancels_recording(self):
        socket = await self.receiver()
        take = await self.start_audio(socket, "browser")
        canceled = asyncio.Event()
        take.cancel.side_effect = canceled.set
        await socket.close()
        await asyncio.wait_for(canceled.wait(), timeout=2)
        take.stop.assert_not_awaited()
        take.cancel.assert_awaited_once()

    async def test_rejects_invalid_origin_token_and_host(self):
        for headers, token in [
            ({**BROWSER_HEADERS, "Origin": "https://other.example.com"}, TOKEN),
            (BROWSER_HEADERS, "invalid"),
            ({**BROWSER_HEADERS, "Host": "other.example.com:17321"}, TOKEN),
        ]:
            with self.assertRaises(WSServerHandshakeError) as error:
                await self.client.ws_connect(f"/ws?token={token}", headers=headers)
            self.assertEqual(error.exception.status, 403)
        for headers in [{"Host": HOST}, {**NATIVE_HEADERS, "Origin": ORIGIN}]:
            response = await self.client.post("/command", data="browser", headers=headers)
            self.assertEqual(response.status, 403)

    async def test_rejects_invalid_payloads_and_does_not_queue_when_offline(self):
        for route, data, content_type, status in [
            ("/upload", b"not png", "image/png", 400),
            ("/upload", PNG_SIGNATURE, "text/plain", 415),
            ("/upload", PNG_SIGNATURE * 3, "image/png", 413),
            ("/upload", PNG_SIGNATURE, "image/png", 503),
            ("/command", b"submit", "text/plain", 400),
            ("/command", b"microphoneXXXXXXXXXXXXXXXX", "text/plain", 400),
            ("/command", b"browser", "text/plain", 503),
        ]:
            with self.subTest(data=data):
                response = await self.client.post(
                    route, headers={**NATIVE_HEADERS, "Content-Type": content_type}, data=data
                )
                self.assertEqual(response.status, status)

    async def test_reports_if_no_composer_could_accept_the_action(self):
        socket = await self.receiver()
        request = asyncio.ensure_future(self.client.post(
            "/command", headers=NATIVE_HEADERS, data="browser"
        ))
        self.assertEqual(await socket.receive_str(timeout=2), "arm-audio")
        await socket.send_str("unavailable")
        self.assertEqual((await request).status, 409)

    async def test_closes_an_unresponsive_receiver(self):
        socket = await self.receiver()
        with patch("bridge.DELIVERY_TIMEOUT", 0.15):
            request = asyncio.ensure_future(self.client.post(
                "/command", headers=NATIVE_HEADERS, data="browser"
            ))
            self.assertEqual(await socket.receive_str(timeout=2), "arm-audio")
            self.assertEqual((await socket.receive(timeout=2)).type, WSMsgType.CLOSE)
            self.assertEqual((await request).status, 504)
        response = await self.client.post("/command", headers=NATIVE_HEADERS, data="browser")
        self.assertEqual(response.status, 503)
