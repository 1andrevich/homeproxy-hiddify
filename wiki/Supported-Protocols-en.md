🇬🇧 [English](Supported-Protocols-en) | 🇷🇺 [Русский](Supported-Protocols-ru)

# Supported Protocols

Re:HomeProxy runs on a choice of cores: [hiddify-core](https://github.com/hiddify/hiddify-core) (default) or [sing-box-extended](https://github.com/shtorm-7/sing-box-extended) — both forks of [sing-box](https://sing-box.sagernet.org) with additional protocols and features not available upstream. The protocols shown in the node editor depend on **which core you installed** and how it was compiled on your device. You choose and install the core on the **Core management** section (Services → Re:HomeProxy → Core & Tools).

---

## Filling in the node editor

When you add a node by hand, the editor exposes the underlying **sing-box outbound** options — TLS (including **Reality**, **uTLS** fingerprints, **ECH**), the transport (**gRPC / WebSocket / HTTP / HTTPUpgrade / XHTTP**), and **multiplex**. Rather than duplicate sing-box's reference here, match each field to your server using the upstream docs:

- [Outbound reference](https://sing-box.sagernet.org/configuration/outbound/) — every outbound type and its fields
- [TLS (shared)](https://sing-box.sagernet.org/configuration/shared/tls/) — Reality, uTLS, ECH, ALPN
- [V2Ray transports](https://sing-box.sagernet.org/configuration/shared/v2ray-transport/) — gRPC / WS / HTTP / HTTPUpgrade
- [Multiplex](https://sing-box.sagernet.org/configuration/shared/multiplex/)

Most users never fill these by hand — importing a share link or subscription sets them for you (see [Subscriptions & Node Import](Subscriptions-en)).

---

## Extended-core features (not in upstream sing-box)

Both cores are sing-box forks that add features missing from upstream. Some are **hiddify-core only**; others are in **both** hiddify-core and sing-box-extended (noted per item):

### TLS Fragmentation (`tls_fragment`) *(hiddify-core only)*
Splits the TLS ClientHello handshake across multiple TCP packets so that the SNI (Server Name Indication) field — which reveals the destination domain — arrives in separate fragments. DPI systems that inspect only whole packets to identify and block domains cannot reassemble the SNI in time, so the connection passes through undetected.

**Fragment modes:**
- **SNI/Domain** — splits packets into two pieces; simple and effective in most cases
- **Random** — divides into many very small pieces for maximum obfuscation; use when SNI mode alone is insufficient

**Key parameters:**
- **Fragment size** — recommended 100–200 bytes; ideally one byte less than the domain name length
- **Fragment interval** — timing between fragments; tune per ISP if needed
- **Mixed SNI case** — randomises capitalisation of the SNI (e.g. `wWw.ExAmPlE.cOm`) to defeat case-sensitive matching
- **Padding** — appends random data to the domain field

> **Note:** Do not enable fragment and padding at the same time — they cancel each other out. Effectiveness varies by ISP and may require parameter tuning.

Can be applied to any protocol that uses TLS (VLESS, VMess, Trojan, etc.).

*Source: [How the TLS Trick works and its usage — hiddify.com](https://hiddify.com/manager/basic-concepts-and-troubleshooting/How-the-TLS-Trick-works-and-its-usage/#tls-fragment)*

### XHTTP Transport *(both cores)*
A modern HTTP-based transport for VLESS designed for CDN compatibility and multiplexing. Not in upstream sing-box, but available on **both** hiddify-core and sing-box-extended. See the VLESS section below.

### Additional Protocols *(both cores)*
MieruTCP / MieruUDP and extended NaïveProxy variants — available on **both** cores (see below).

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
| **XHTTP** | **Yes** | Not in upstream sing-box; on both cores — see below |

**XHTTP** is an extended transport for VLESS, available on **both** hiddify-core and sing-box-extended (but not upstream sing-box). It uses chunked HTTP transfers over a single or multiplexed connection, designed specifically for CDN compatibility and to avoid patterns detectable as non-browser traffic.

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

## Requires the sing-box-extended core

These node types are available when you install **sing-box-extended** instead of hiddify-core (pick your core on the **Core Management** page). hiddify-core does **not** support them.

### AmneziaWG
An obfuscated variant of WireGuard. It adds junk packets and randomised handshake headers (the `Jc`, `Jmin`, `Jmax`, `S1`, `S2`, `H1`–`H4`, `I1`–`I5` parameters) so that DPI systems which detect and block plain WireGuard no longer recognise the traffic. Set the obfuscation parameters to match your AmneziaWG server (or a Cloudflare WARP endpoint running AmneziaWG). Same fast Curve25519 / ChaCha20-Poly1305 cryptography as WireGuard, but the packets no longer look like WireGuard on the wire.

---

## Mieru — requires `with_quic`

### MieruTCP / MieruUDP
Anti-censorship protocol developed independently of sing-box, added by the extended cores (hiddify-core **and** sing-box-extended). Uses fully randomized traffic patterns with no identifiable headers or handshakes, making it very difficult to detect or classify by DPI.

- **MieruTCP** — TCP transport variant
- **MieruUDP** — UDP transport variant; higher throughput, requires UDP access

Requires a Mieru server. See the [Mieru project](https://github.com/enfein/mieru) for server setup.

---

## Coming in Future hiddify-core Versions

### DNSTT (planned)
DNS tunneling protocol — tunnels proxy traffic inside DNS queries and responses. Extremely useful in heavily restricted environments where only DNS traffic is allowed (e.g., captive portals, some corporate networks). Significantly lower throughput than other protocols due to DNS packet size limits, but works where nothing else does.

---

## How to Check What Your Build Supports

Run the version command for **whichever core you installed**:

```sh
hiddify-core version    # if you run hiddify-core
sing-box version        # if you run sing-box-extended
```

Look at the `Tags:` line. Protocols that require a specific tag will only appear in the node editor if that tag is present.

Example:
```
Tags: with_quic,with_wireguard,with_gvisor,with_naive_outbound,...
```

---

## Note on NaïveProxy

NaïveProxy availability is controlled by the `with_naive_outbound` build tag — it is not architecture-specific. Some builds omit it to reduce binary size. Check your installed version as shown above before assuming it is unavailable.
