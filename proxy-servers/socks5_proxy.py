#!/usr/bin/env python3
"""
SOCKS5 proxy (RFC 1928 / 1929), stdlib only, asyncio.

- CONNECT (TCP) with IPv4, IPv6 and domain-name targets.
- Optional username/password auth, host allowlist/blocklist, idle timeouts.

Usage:
  python3 socks5_proxy.py --port 1080 --auth user:pass --allow example.com

Client:
  curl --socks5-hostname user:pass@127.0.0.1:1080 https://example.com
"""
import argparse
import asyncio
import ipaddress
import logging
import socket

log = logging.getLogger("socks5")
BUF = 64 * 1024
IDLE_TIMEOUT = 300


async def pipe(reader, writer, idle=IDLE_TIMEOUT):
    try:
        while True:
            try:
                data = await asyncio.wait_for(reader.read(BUF), idle)
            except asyncio.TimeoutError:
                break
            if not data:
                break
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
    def __init__(self, auth=None, block=(), allow=(), timeout=10):
        self.creds = tuple(auth.split(":", 1)) if auth else None
        self.block = {h.lower() for h in block}
        self.allow = {h.lower() for h in allow}
        self.timeout = timeout

    def host_ok(self, host):
        host = host.lower()
        match = lambda s: any(host == d or host.endswith("." + d) for d in s)
        if self.allow and not match(self.allow):
            return False
        return not match(self.block)

    async def handle(self, r, w):
        peer = w.get_extra_info("peername")
        try:
            await self.serve(r, w, peer)
        except (asyncio.IncompleteReadError, ConnectionError, ValueError, asyncio.TimeoutError) as e:
            log.debug("%s closed: %s", peer, e)
            w.close()

    async def _read(self, r, n):
        return await asyncio.wait_for(r.readexactly(n), self.timeout)

    async def serve(self, r, w, peer):
        ver, n = await self._read(r, 2)
        if ver != 5:
            raise ValueError("not SOCKS5")
        methods = await self._read(r, n)
        want = 2 if self.creds else 0
        if want not in methods:
            w.write(b"\x05\xff")
            await w.drain()
            return w.close()
        w.write(bytes([5, want]))
        await w.drain()

        if self.creds:
            _, ulen = await self._read(r, 2)
            user = (await self._read(r, ulen)).decode()
            plen = (await self._read(r, 1))[0]
            pw = (await self._read(r, plen)).decode()
            ok = (user, pw) == self.creds
            w.write(b"\x01\x00" if ok else b"\x01\x01")
            await w.drain()
            if not ok:
                log.info("%s bad credentials", peer)
                return w.close()

        ver, cmd, _, atyp = await self._read(r, 4)
        if atyp == 1:
            host = socket.inet_ntop(socket.AF_INET, await self._read(r, 4))
        elif atyp == 3:
            ln = (await self._read(r, 1))[0]
            host = (await self._read(r, ln)).decode()
        elif atyp == 4:
            host = socket.inet_ntop(socket.AF_INET6, await self._read(r, 16))
        else:
            w.write(reply(8)); await w.drain(); return w.close()
        port = int.from_bytes(await self._read(r, 2), "big")

        if cmd != 1:  # only CONNECT
            w.write(reply(7)); await w.drain(); return w.close()

        if not self.host_ok(host):
            log.info("%s blocked %s", peer, host)
            w.write(reply(2)); await w.drain(); return w.close()  # 2 = connection not allowed

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
    p.add_argument("--block", nargs="*", default=[], help="domains to refuse")
    p.add_argument("--allow", nargs="*", default=[], help="only allow these domains")
    a = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    if a.host not in ("127.0.0.1", "::1", "localhost") and not a.auth:
        log.warning("Listening on %s with no --auth: anyone who reaches this port can use it.", a.host)
    server = await asyncio.start_server(Socks5(a.auth, a.block, a.allow).handle, a.host, a.port)
    log.info("SOCKS5 proxy on %s:%s", a.host, a.port)
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())
