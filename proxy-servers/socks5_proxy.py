#!/usr/bin/env python3
"""
SOCKS5 proxy (RFC 1928 / 1929), stdlib only, asyncio.

- Supports CONNECT (TCP) with IPv4, IPv6 and domain-name targets.
- Optional username/password auth.

Usage:
  python3 socks5_proxy.py --port 1080
  python3 socks5_proxy.py --port 1080 --auth user:pass

Client:
  curl --socks5-hostname 127.0.0.1:1080 https://example.com
  (or set Firefox / OS SOCKS proxy to 127.0.0.1:1080)
"""
import argparse
import asyncio
import ipaddress
import logging
import socket

log = logging.getLogger("socks5")
BUF = 64 * 1024


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


def reply(code, addr="0.0.0.0", port=0):
    ip = ipaddress.ip_address(addr)
    atyp = 1 if ip.version == 4 else 4
    return bytes([5, code, 0, atyp]) + ip.packed + port.to_bytes(2, "big")


class Socks5:
    def __init__(self, auth=None, timeout=10):
        self.creds = tuple(auth.split(":", 1)) if auth else None
        self.timeout = timeout

    async def handle(self, r, w):
        peer = w.get_extra_info("peername")
        try:
            await asyncio.wait_for(self.serve(r, w, peer), None)
        except (asyncio.IncompleteReadError, ConnectionError, ValueError) as e:
            log.debug("%s closed: %s", peer, e)
            w.close()

    async def serve(self, r, w, peer):
        ver, n = await r.readexactly(2)
        if ver != 5:
            raise ValueError("not SOCKS5")
        methods = await r.readexactly(n)
        want = 2 if self.creds else 0
        if want not in methods:
            w.write(b"\x05\xff")
            await w.drain()
            return w.close()
        w.write(bytes([5, want]))
        await w.drain()

        if self.creds:
            _, ulen = await r.readexactly(2)
            user = (await r.readexactly(ulen)).decode()
            plen = (await r.readexactly(1))[0]
            pw = (await r.readexactly(plen)).decode()
            ok = (user, pw) == self.creds
            w.write(b"\x01\x00" if ok else b"\x01\x01")
            await w.drain()
            if not ok:
                return w.close()

        ver, cmd, _, atyp = await r.readexactly(4)
        if atyp == 1:
            host = socket.inet_ntop(socket.AF_INET, await r.readexactly(4))
        elif atyp == 3:
            ln = (await r.readexactly(1))[0]
            host = (await r.readexactly(ln)).decode()
        elif atyp == 4:
            host = socket.inet_ntop(socket.AF_INET6, await r.readexactly(16))
        else:
            w.write(reply(8)); await w.drain(); return w.close()
        port = int.from_bytes(await r.readexactly(2), "big")

        if cmd != 1:  # only CONNECT
            w.write(reply(7)); await w.drain(); return w.close()

        try:
            ur, uw = await asyncio.wait_for(asyncio.open_connection(host, port), self.timeout)
        except Exception as e:
            log.info("%s connect fail %s:%s (%s)", peer, host, port, e)
            w.write(reply(5)); await w.drain(); return w.close()

        bind_ip, bind_port = uw.get_extra_info("sockname")[:2]
        w.write(reply(0, bind_ip, bind_port))
        await w.drain()
        log.info("%s -> %s:%s", peer, host, port)
        await asyncio.gather(pipe(r, uw), pipe(ur, w))


async def main():
    p = argparse.ArgumentParser()
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=1080)
    p.add_argument("--auth", help="user:pass")
    a = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    server = await asyncio.start_server(Socks5(a.auth).handle, a.host, a.port)
    log.info("SOCKS5 proxy on %s:%s", a.host, a.port)
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())
