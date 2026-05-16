🇬🇧 [English](Supported-Protocols-en) | 🇷🇺 [Русский](Supported-Protocols-ru)

# Supported Protocols

HomeProxy-hiddify uses [hiddify-core](https://github.com/hiddify/hiddify-core) as its proxy engine — a fork of [sing-box](https://sing-box.sagernet.org) with additional protocols and features not available upstream. The protocols shown in the node editor depend on how hiddify-core was compiled on your device.

---

## hiddify-core Exclusive Features

These capabilities are present in hiddify-core but not in upstream sing-box:

### TLS Fragmentation (`tls_fragment`)
Splits the TLS ClientHello handshake across multiple TCP packets. Many DPI (Deep Packet Inspection) systems inspect only the first packet to identify traffic — fragmentation defeats this by ensuring no single packet reveals enough to trigger a block. Can be enabled on protocols that use TLS (VLESS, VMess, Trojan, etc.).

### XHTTP Transport
A modern HTTP-based transport for VLESS designed for CDN compatibility and multiplexing. Not available in upstream sing-box. See the VLESS section below.

### Additional Protocols
MieruTCP, MieruUDP, and extended NaïveProxy variants (see below).

---

## Always Available

### Direct
Bypasses the proxy — traffic goes to the destination without any tunneling. Used in route rules for local or trusted destinations.

### AnyTLS
A TLS-based multiplexing protocol developed by the hiddify team. Designed to be simple, efficient, and hard to fingerprint. Good choice when other TLS-based protocols are being blocked.

### HTTP
Plain HTTP proxy (RFC 7231 CONNECT method). Supports username/password authentication. Not encrypted — use only on trusted networks or wrapped in TLS via another layer.

### Shadowsocks
One of the most widely used anti-censorship protocols. Encrypts traffic with a pre-shared key and cipher (AES-128-GCM, AES-256-GCM, ChaCha20-Poly1305, etc.). Simple to set up. Does not use TLS — traffic is obfuscated but does not look like HTTPS.

**Shadowsocks 2022** (`2022-blake3-aes-128-gcm`, `2022-blake3-aes-256-gcm`, `2022-blake3-chacha20-poly1305`) is also supported. It improves on the original with stronger authenticated encryption, replay protection, and better performance. If your server supports it, prefer the 2022 variants. ShadowTLS (see below) is designed to work with Shadowsocks 2022.

### ShadowTLS
A TLS camouflage wrapper designed for use with **Shadowsocks 2022** (not the original Shadowsocks). Wraps the underlying connection in a TLS handshake that impersonates a real HTTPS server, making traffic indistinguishable from legitimate TLS to passive observers. The TLS handshake is genuine — it completes with a real server — so SNI-based blocking and TLS fingerprinting are defeated. Requires a ShadowTLS-aware server alongside a Shadowsocks 2022 backend.

### Socks
SOCKS4 and SOCKS5 proxy. Supports optional username/password authentication (SOCKS5). No encryption — suitable for use within a trusted network or as a local outbound.

### SSH
Tunnels traffic over an SSH connection using port forwarding. Useful when only SSH is accessible and other ports are blocked. Requires an SSH server with a valid account. Slower than dedicated proxy protocols due to SSH overhead.

### Trojan
Disguises proxy traffic as regular HTTPS by using TLS with a valid certificate. A server hosting Trojan looks identical to an HTTPS web server to outside observers. Falls back to serving a real web page for non-Trojan connections, making it very hard to detect.

**Supported transports:**
| Transport | CDN Compatible | Notes |
|-----------|:--------------:|-------|
| TCP (raw TLS) | No | Default; lowest overhead |
| WebSocket | **Yes** | Works behind Cloudflare and other CDNs |
| gRPC | **Yes** | Works behind Cloudflare (requires gRPC support on CDN) |
| HTTP/2 | No | Multiplexed; not CDN-friendly without WebSocket/gRPC |

WebSocket + TLS is the most common setup for CDN (Cloudflare) deployment — the CDN terminates TLS and forwards WebSocket traffic to the origin server.

### VLESS
A lightweight successor to VMess without the extra encryption layer (relies on the transport for security, typically TLS). Widely used with Xray-based servers.

**Supported transports:**
| Transport | CDN Compatible | Notes |
|-----------|:--------------:|-------|
| TCP (raw TLS) | No | Standard setup |
| WebSocket | **Yes** | CDN-friendly; widely supported |
| gRPC | **Yes** | CDN-friendly |
| HTTP/2 | No | Multiplexed connections |
| HTTPUpgrade | **Yes** | Lightweight HTTP upgrade handshake |
| **XHTTP** | **Yes** | hiddify-core exclusive — see below |

**XHTTP** is a hiddify-core exclusive transport for VLESS. It uses chunked HTTP transfers over a single or multiplexed connection, designed specifically for CDN compatibility and to avoid patterns detectable as non-browser traffic. Upstream sing-box does not support XHTTP.

### VMess
The original V2Ray protocol. Includes its own encryption on top of the transport layer. Slightly more overhead than VLESS but very widely deployed.

**Supported transports:**
| Transport | CDN Compatible | Notes |
|-----------|:--------------:|-------|
| TCP | No | |
| WebSocket | **Yes** | Most common CDN setup |
| gRPC | **Yes** | |
| HTTP/2 | No | |
| HTTPUpgrade | **Yes** | |

VMess over WebSocket + TLS is one of the most common configurations for Cloudflare CDN deployment — the CDN hides the origin server's real IP.

---

## Requires `with_quic` Build Tag

### Hysteria
QUIC-based high-throughput proxy protocol (version 1). Uses a modified QUIC stack that tolerates packet loss better than TCP-based protocols — useful on lossy or high-latency connections. Version 1 is largely superseded by Hysteria2.

### Hysteria2
Improved and simplified version of Hysteria. Uses the Salamander obfuscation protocol and BBR congestion control. Significantly better performance than v1 and harder to detect. Recommended over Hysteria v1 for new setups.

### TUIC
QUIC-based protocol with built-in multiplexing and 0-RTT connection establishment. Low latency and efficient. Requires a TUIC server (v5 protocol).

---

## Requires `with_naive_outbound` Build Tag

### NaïveProxy
Uses the **actual Chrome network stack** to make proxy traffic indistinguishable from real Chrome browser HTTPS traffic. Extremely resistant to traffic analysis and fingerprinting because the TLS implementation, cipher choices, and behavior are identical to a real browser.

Two transport variants:

| Variant | Protocol | Notes |
|---------|----------|-------|
| **NaiveTLS** | HTTPS (TLS 1.3 over TCP) | Mimics Chrome HTTPS; most common |
| **NaiveQUIC** | HTTP/3 (QUIC) | Mimics Chrome HTTP/3; harder to block but requires UDP |

NaiveTLS is the standard choice. NaiveQUIC offers better performance where UDP is available but may be blocked in some environments that drop unknown UDP traffic.

NaïveProxy requires a compatible server (e.g., Caddy with the `forwardproxy` plugin).

---

## Requires `with_wireguard` + `with_gvisor` Build Tags

### WireGuard
Modern VPN protocol with a minimal codebase and strong cryptography (Curve25519, ChaCha20-Poly1305). Very fast and battery-efficient. Can be used as an outbound to tunnel all proxy traffic through a WireGuard VPN endpoint (e.g., a VPS or a service like Cloudflare WARP).

---

## Requires `with_quic` (hiddify-core extension)

### MieruTCP / MieruUDP
Anti-censorship protocol developed independently of sing-box, added to hiddify-core. Uses fully randomized traffic patterns with no identifiable headers or handshakes, making it very difficult to detect or classify by DPI.

- **MieruTCP** — TCP transport variant
- **MieruUDP** — UDP transport variant; higher throughput, requires UDP access

Requires a Mieru server. See the [Mieru project](https://github.com/enfein/mieru) for server setup.

---

## Coming in Future hiddify-core Versions

### DNSTT (planned)
DNS tunneling protocol — tunnels proxy traffic inside DNS queries and responses. Extremely useful in heavily restricted environments where only DNS traffic is allowed (e.g., captive portals, some corporate networks). Significantly lower throughput than other protocols due to DNS packet size limits, but works where nothing else does.

---

## How to Check What Your Build Supports

```sh
hiddify-core version
```

Look at the `Tags:` line. Protocols that require a specific tag will only appear in the node editor if that tag is present.

Example:
```
hiddify-core version v2.x.x
Tags: with_quic,with_wireguard,with_gvisor,with_naive_outbound,...
```

---

## Note on NaïveProxy

NaïveProxy availability is controlled by the `with_naive_outbound` build tag — it is not architecture-specific. Some builds omit it to reduce binary size. Check your installed version as shown above before assuming it is unavailable.
