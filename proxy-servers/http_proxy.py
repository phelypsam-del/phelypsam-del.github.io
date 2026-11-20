#!/usr/bin/env python3
"""
HTTP/HTTPS forward proxy (stdlib only, asyncio).

- Plain HTTP: forwards the request to the target and streams the response back.
- HTTPS: handles CONNECT and tunnels encrypted bytes (no decryption).
- Optional Basic auth and a host allowlist/blocklist.

Usage:
  python3 http_proxy.py --port 8080
  python3 http_proxy.py --port 8080 --auth user:pass --block example.com

Client:
  curl -x http://127.0.0.1:8080 https://example.com
  (or set your browser/OS proxy to 127.0.0.1:8080)
"""
import argparse
import asyncio
import base64
import logging
from urllib.parse import urlsplit

log = logging.getLogger("http_proxy")
BUF = 64 * 1024
HOP_HEADERS = {
    "proxy-connection", "proxy-authorization", "connection", "keep-alive",
    "te", "trailer", "transfer-encoding", "upgrade",
}


async def pipe(reader, writer):
    try:
        while data := await reader.read(BUF):
            writer.write(data)
            await writer.drain()
    except (ConnectionError, asyncio.CancelledError):
        pass
    finally:
        try:
            writer.close()
        except Exception:
            pass


async def relay(r1, w1, r2, w2):
    await asyncio.gather(pipe(r1, w2), pipe(r2, w1))


class Proxy:
    def __init__(self, auth=None, block=(), allow=(), timeout=10):
        self.auth = ("Basic " + base64.b64encode(auth.encode()).decode()) if auth else None
        self.block = {h.lower() for h in block}
        self.allow = {h.lower() for h in allow}
        self.timeout = timeout

    def host_ok(self, host):
        host = host.lower()
        match = lambda s: any(host == d or host.endswith("." + d) for d in s)
        if self.allow and not match(self.allow):
            return False
        return not match(self.block)

    async def handle(self, cr, cw):
        peer = cw.get_extra_info("peername")
        try:
            head = await asyncio.wait_for(cr.readuntil(b"\r\n\r\n"), self.timeout)
        except Exception:
            cw.close()
            return
        lines = head.decode("latin-1").split("\r\n")
        try:
            method, target, version = lines[0].split(" ", 2)
        except ValueError:
            return await self.reply(cw, 400, "Bad Request")
        headers = []
        for line in lines[1:]:
            if ":" in line:
                k, v = line.split(":", 1)
                headers.append((k.strip(), v.strip()))
        hmap = {k.lower(): v for k, v in headers}

        if self.auth and hmap.get("proxy-authorization") != self.auth:
            return await self.reply(cw, 407, "Proxy Authentication Required",
                                    extra='Proxy-Authenticate: Basic realm="proxy"\r\n')

        if method.upper() == "CONNECT":
            host, _, port = target.rpartition(":")
            host, port = host.strip("[]"), int(port or 443)
        else:
            u = urlsplit(target)
            if u.scheme != "http" or not u.hostname:
                return await self.reply(cw, 400, "Bad Request")
            host, port = u.hostname, u.port or 80
            path = (u.path or "/") + (f"?{u.query}" if u.query else "")

        if not self.host_ok(host):
            log.info("%s blocked %s", peer, host)
            return await self.reply(cw, 403, "Forbidden")

        try:
            ur, uw = await asyncio.wait_for(asyncio.open_connection(host, port), self.timeout)
        except Exception as e:
            log.info("%s upstream fail %s:%s (%s)", peer, host, port, e)
            return await self.reply(cw, 502, "Bad Gateway")

        log.info("%s %s %s:%s", peer, method, host, port)
        if method.upper() == "CONNECT":
            cw.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            await cw.drain()
        else:
            out = [f"{method} {path} {version}"]
            out += [f"{k}: {v}" for k, v in headers if k.lower() not in HOP_HEADERS]
            out.append("Connection: close")
            uw.write(("\r\n".join(out) + "\r\n\r\n").encode("latin-1"))
            await uw.drain()
        await relay(cr, cw, ur, uw)

    async def reply(self, w, code, msg, extra=""):
        w.write(f"HTTP/1.1 {code} {msg}\r\n{extra}Content-Length: 0\r\nConnection: close\r\n\r\n".encode())
        try:
            await w.drain()
        finally:
            w.close()


async def main():
    p = argparse.ArgumentParser()
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8080)
    p.add_argument("--auth", help="user:pass for Basic proxy auth")
    p.add_argument("--block", nargs="*", default=[], help="domains to refuse")
    p.add_argument("--allow", nargs="*", default=[], help="only allow these domains")
    a = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    proxy = Proxy(a.auth, a.block, a.allow)
    server = await asyncio.start_server(proxy.handle, a.host, a.port)
    log.info("HTTP proxy on %s:%s", a.host, a.port)
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())
