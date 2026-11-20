# Python Proxy Servers

Two dependency-free forward proxies written with Python's asyncio.

| File | What it does | Default port |
|---|---|---|
| `http_proxy.py` | HTTP proxy + HTTPS tunneling (CONNECT), Basic auth, allow/block lists | 8080 |
| `socks5_proxy.py` | SOCKS5 proxy (TCP CONNECT, IPv4/IPv6/domains), username/password auth | 1080 |

Requires Python 3.8+.

## Run

```bash
python3 http_proxy.py --port 8080 --auth user:pass
python3 socks5_proxy.py --port 1080 --auth user:pass
```

## Test

```bash
curl -x http://user:pass@127.0.0.1:8080 https://example.com
curl --socks5-hostname user:pass@127.0.0.1:1080 https://example.com
```

## Options

- `--host` – bind address (default `127.0.0.1`; use `0.0.0.0` to accept remote clients — always set `--auth` if you do)
- `--port` – listen port
- `--auth user:pass` – require credentials
- `--block a.com b.com` / `--allow a.com` – HTTP proxy only

HTTPS traffic is tunneled, not decrypted.
