🇬🇧 [English](Server-Settings-en) | 🇷🇺 [Русский](Server-Settings-ru)

# Server Settings

Most of Re:HomeProxy is a **client** — the router dials *out* to proxy nodes. **Server Settings** is the reverse: it runs **inbounds** on the router so other devices can connect *in*. Use it to turn the router into your own endpoint (e.g. a home server you reach from a phone while away), or to expose a local SOCKS/HTTP proxy to the LAN.

Open it at **Services → Re:HomeProxy → Server Settings**. It is independent of client mode — run either, both, or neither. A fresh install has **no inbounds**; you add them here.

> ⚠️ An inbound opens a listening port. Turn on **Firewall** (below) only for inbounds you want reachable from the Internet, and always protect them with a strong password and/or TLS.

---

## Global

A single **Enable** switch turns the server subsystem on or off. Each inbound below also has its own enable toggle.

## Inbounds (Server settings)

Add one row per listener. The common fields:

| Field | Meaning |
|-------|---------|
| **Label** | A unique name for the inbound |
| **Enable** | Turn this inbound on/off |
| **Firewall** | *Allow access from the Internet* — off = reachable from LAN only, on = the port is opened on WAN |
| **Type** | The inbound protocol (see below) |
| **Listen address / Listen port** | Bind address (default `::`) and a unique port |
| **Username / Password** | Where the protocol uses credentials |

Per-protocol fields (encryption method, TLS, transport, multiplex…) appear in the edit dialog **after you pick a Type**. They mirror sing-box's inbound options one-to-one — rather than repeat them here, see the **[sing-box inbound reference](https://sing-box.sagernet.org/configuration/inbound/)** for each field, and the per-type pages (e.g. [VLESS](https://sing-box.sagernet.org/configuration/inbound/vless/), [Trojan](https://sing-box.sagernet.org/configuration/inbound/trojan/), [Hysteria2](https://sing-box.sagernet.org/configuration/inbound/hysteria2/)).

### Inbound types

**Always available:** AnyTLS, HTTP, **Mixed** (HTTP + SOCKS on one port), Shadowsocks, SOCKS, Trojan, VLESS, VMess.

Core/build-dependent (the dropdown only shows them if your core supports them — check tags as in [Supported Protocols](Supported-Protocols-en)):

- **Hysteria, Hysteria2, NaïveProxy, TUIC** — require a `with_quic` build.
- **MTProxy** — sing-box-extended only.

## TLS & certificates

TLS-capable inbounds expose the usual controls (min/max version, cipher suites) plus either **your own certificate** or, on a `with_acme` build, **ACME** auto-issuance (Let's Encrypt / ZeroSSL, via HTTP-01 or DNS-01 challenge). These follow sing-box field-for-field — see **[sing-box TLS](https://sing-box.sagernet.org/configuration/shared/tls/)** and its [ACME section](https://sing-box.sagernet.org/configuration/shared/tls/#acme).

## Tips

- Quickest personal endpoint: **Mixed** + a strong password — point a client's SOCKS/HTTP proxy at the router's IP and port.
- Public, blocking-resistant endpoint: a TLS type (VLESS / Trojan / Hysteria2) with ACME **DNS-01**, so you don't have to expose port 80.
- Leave **Firewall** off for an inbound you only use from inside the LAN.

See also: [Supported Protocols](Supported-Protocols-en) · [Core Management](Core-Management-en) · [Getting Started](Getting-Started-en) · [Troubleshooting](Troubleshooting-en)
