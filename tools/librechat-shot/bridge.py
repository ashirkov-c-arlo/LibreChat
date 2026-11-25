import asyncio
import json
import secrets
import sys
from pathlib import Path

from aiohttp import WSMsgType, web

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
MAX_PNG_BYTES = 25 * 1024 * 1024
DELIVERY_TIMEOUT = 5
COMMANDS = {"microphone", "browser", "externalApp"}


class Bridge:
    def __init__(self, config):
        self.host = f"127.0.0.1:{config['port']}"
        self.origin = config["origin"]
        self.token = config["token"].encode()
        self.receiver = None
        self.receipt = None

    def authorize(self, request, *, browser=False):
        origins = request.headers.getall("Origin", [])
        token = request.query.get("token", "") if browser else request.headers.get("X-Token", "")
        if (
            request.host != self.host
            or origins != ([self.origin] if browser else [])
            or not secrets.compare_digest(token.encode(), self.token)
        ):
            raise web.HTTPForbidden()

    async def receive(self, request):
        self.authorize(request, browser=True)
        socket = web.WebSocketResponse(heartbeat=20, max_msg_size=64, timeout=3)
        if self.receiver is not None:
            await socket.prepare(request)
            await socket.close(code=4009, message=b"A tab is already connected.")
            return socket
        self.receiver = socket
        try:
            await socket.prepare(request)
            await socket.send_str("ready")
            async for message in socket:
                if message.type == WSMsgType.TEXT and message.data in {"accepted", "unavailable"}:
                    if self.receipt is not None and not self.receipt.done():
                        self.receipt.set_result(message.data == "accepted")
                else:
                    await socket.close(code=1008)
        finally:
            self.receiver = None
            if self.receipt is not None and not self.receipt.done():
                self.receipt.set_result(False)
        return socket

    async def deliver(self, data):
        socket = self.receiver
        if socket is None or socket.closed or not socket.prepared:
            raise web.HTTPServiceUnavailable(text="No LibreChat tab is connected.")
        if self.receipt is not None:
            raise web.HTTPConflict(text="Another action is in progress.")
        self.receipt = asyncio.get_running_loop().create_future()
        try:
            async with asyncio.timeout(DELIVERY_TIMEOUT):
                if isinstance(data, bytes):
                    await socket.send_bytes(data)
                else:
                    await socket.send_str(data)
                if not await self.receipt:
                    raise web.HTTPConflict(text="The LibreChat tab could not accept the action.")
        except TimeoutError:
            # Do not let a late receipt acknowledge the next action.
            await socket.close(drain=False)
            raise web.HTTPGatewayTimeout(text="The LibreChat tab did not respond.") from None
        except ConnectionError:
            raise web.HTTPServiceUnavailable(text="The LibreChat tab disconnected.") from None
        finally:
            self.receipt = None
        return web.Response(status=204)

    async def upload(self, request):
        self.authorize(request)
        if request.content_type != "image/png":
            raise web.HTTPUnsupportedMediaType()
        data = await request.read()
        if not data.startswith(PNG_SIGNATURE):
            raise web.HTTPBadRequest(text="Expected a PNG image.")
        return await self.deliver(data)

    async def command(self, request):
        self.authorize(request)
        # One read may return a partial TCP payload. Read at most one byte past the longest command.
        try:
            data = await request.content.readexactly(max(map(len, COMMANDS)) + 1)
        except asyncio.IncompleteReadError as error:
            data = error.partial
        command = data.decode("ascii", errors="replace")
        if request.content_type != "text/plain" or command not in COMMANDS:
            raise web.HTTPBadRequest(text="Unknown command.")
        return await self.deliver(command)

    async def close(self, _app):
        if self.receiver is not None:
            await self.receiver.close(code=1001)


def create_app(config):
    bridge = Bridge(config)
    app = web.Application(client_max_size=MAX_PNG_BYTES)
    app.add_routes([
        web.post("/upload", bridge.upload),
        web.post("/command", bridge.command),
        web.get("/ws", bridge.receive),
    ])
    app.on_shutdown.append(bridge.close)
    return app


if __name__ == "__main__":
    path = Path(sys.argv[1])
    if path.stat().st_mode & 0o077:
        sys.exit("Set the bridge config permissions to 600.")
    config = json.loads(path.read_text())
    web.run_app(create_app(config), host="127.0.0.1", port=config["port"], access_log=None)
