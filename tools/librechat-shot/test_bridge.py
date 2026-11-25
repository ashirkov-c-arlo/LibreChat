import asyncio
import unittest
from unittest.mock import patch

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
        self.assertEqual(await socket.receive_str(timeout=2), "ready")
        return socket

    async def test_delivers_binary_png_and_audio_commands_to_one_receiver(self):
        socket = await self.receiver()
        second = await self.client.ws_connect(f"/ws?token={TOKEN}", headers=BROWSER_HEADERS)
        rejected = await second.receive(timeout=2)
        self.assertEqual(rejected.type, WSMsgType.CLOSE)
        self.assertEqual(rejected.data, 4009)

        for route, content_type, data in [
            ("/upload", "image/png", PNG_SIGNATURE + b"data"),
            ("/command", "text/plain", b"microphone"),
            ("/command", "text/plain", b"browser"),
            ("/command", "text/plain", b"externalApp"),
        ]:
            with self.subTest(data=data):
                request = asyncio.ensure_future(self.client.post(
                    route, headers={**NATIVE_HEADERS, "Content-Type": content_type}, data=data
                ))
                frame = await socket.receive(timeout=2)
                if route == "/upload":
                    self.assertEqual(frame.type, WSMsgType.BINARY)
                    self.assertEqual(frame.data, data)
                else:
                    self.assertEqual(frame.type, WSMsgType.TEXT)
                    self.assertEqual(frame.data, data.decode())
                self.assertFalse(request.done())
                await socket.send_str("accepted")
                self.assertEqual((await request).status, 204)

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
        self.assertEqual(await socket.receive_str(timeout=2), "browser")
        await socket.send_str("unavailable")
        self.assertEqual((await request).status, 409)

    async def test_closes_an_unresponsive_receiver(self):
        socket = await self.receiver()
        with patch("bridge.DELIVERY_TIMEOUT", 0.15):
            request = asyncio.ensure_future(self.client.post(
                "/command", headers=NATIVE_HEADERS, data="browser"
            ))
            self.assertEqual(await socket.receive_str(timeout=2), "browser")
            self.assertEqual((await socket.receive(timeout=2)).type, WSMsgType.CLOSE)
            self.assertEqual((await request).status, 504)
        response = await self.client.post("/command", headers=NATIVE_HEADERS, data="browser")
        self.assertEqual(response.status, 503)
