[**Русский 🇷🇺**](README_ru.md) / [**English**](README.md)

<a href="https://t.me/one_andrevich"><img src="https://img.shields.io/badge/Telegram-Join-blue?style=flat-square&logo=telegram" alt="Telegram"></a>
# Re:HomeProxy

A modern multi-core proxy platform powered by [hiddify-core](https://github.com/hiddify/hiddify-core). A fork of ImmortalWrt HomeProxy.

## Overview

Re:HomeProxy is a feature-rich proxy management system, a fresh take on ImmortalWrt's HomeProxy. It runs on a choice of cores ([hiddify-core](https://github.com/hiddify/hiddify-core) or [sing-box-extended](https://github.com/shtorm-7/sing-box-extended)), adds a built-in DPI-bypass for un-throttling sites without a VPN, ready-made Russia routing rules, and a one-click core installer — all from the LuCI web interface.

## Key Features

- **Multi-core engine** — run on **hiddify-core** or **sing-box-extended**, your choice per device. The built-in **Core Management** page installs and updates the core for you and automatically picks the right build for your available storage (with a compact build for tight-storage devices).
- **Wide protocol support** — Naive, Mieru, Hysteria, SOCKS, Shadowsocks, ShadowTLS, Tor, Trojan, VLESS (XHTTP), VMess, WireGuard, **AmneziaWG / WARP** (sing-box-extended), SSH and more.
- **Two built-in DPI-bypass engines** — un-throttle and unblock sites (e.g. YouTube, Discord) **without any VPN subscription**:
  - **ByeDPI** ([hufrea/byedpi](https://github.com/hufrea/byedpi)) — a SOCKS-level desync proxy, with 40 ready-made strategy presets and a multi-site **strategy tester** that shows which setting actually works on your ISP.
  - **Zapret 2** ([bol-van/zapret2](https://github.com/bol-van/zapret2), nfqws2) — a packet-level NFQUEUE desync that mangles the handshake in-place. Selected per routing rule (e.g. send only YouTube/Discord through it), with curated presets, optional Discord-voice desync, and its own scoped tester.
- **URLTest auto-selection** — automatically routes through the fastest reachable node and fails over when one goes down.
- **Russia routing rules** — one-click RU Proxy Rules (Russia Inside, Re:Filter) with curated domain/IP lists, so only blocked destinations go through the proxy.
- **Subscription support** — import nodes from subscription links (sing-box JSON / Hiddify, base64 / plain share-links, and Xray/V2Ray JSON configs) and update them on demand.
- **Diagnostics** — a built-in page to check core/system health, inspect ports, and generate a shareable report.
- **Modern web interface** — clean, responsive LuCI UI with node management, ACL traffic routing, and NFT rule control.

## ⚠️ Early Stage Project

This project is currently in an **early stage of development**. The web UI configuration is still being developed and will be improved in future versions. 


## Prerequisites

- OpenWRT / ImmortalWrt 24.10 or higher (opkg)
- OpenWRT / ImmortalWrt 25.12 or higher (apk)

## Installation

*~80 MB of free space recommended. Tight on storage? Install the LuCI app first, then use its **Core Management** page (Services → Re:HomeProxy → Status) to install a core — it auto-picks a build that fits, including a compact build for small devices.*

### OpenWRT 25.12+ (APK)

#### 1. Install *hiddify-core* package

```sh
wget -O /tmp/homeproxy-hiddify.pub https://github.com/1andrevich/homeproxy-hiddify/releases/latest/download/homeproxy-hiddify.pub
cp /tmp/homeproxy-hiddify.pub /etc/apk/keys/
wget -O /tmp/hiddify-core.apk "https://github.com/1andrevich/hiddify-core/releases/latest/download/hiddify-core_$(. /etc/os-release; echo "$OPENWRT_ARCH").apk"
apk update
apk add /tmp/hiddify-core.apk
```

#### 2. Install *luci-app-re-homeproxy* package

```sh
wget -O /tmp/homeproxy-hiddify.pub https://github.com/1andrevich/homeproxy-hiddify/releases/latest/download/homeproxy-hiddify.pub
cp /tmp/homeproxy-hiddify.pub /etc/apk/keys/
wget -O /tmp/luci-app-re-homeproxy.apk "$(wget -qO- 'https://api.github.com/repos/1andrevich/homeproxy-hiddify/releases' | grep -o 'https://github\.com/[^"]*luci-app-re-homeproxy[^"]*\.apk' | head -1)"
apk add /tmp/luci-app-re-homeproxy.apk
```

Once the key is in `/etc/apk/keys/` it is trusted permanently — no flag needed for future updates.

---

### OpenWRT 24.10 (opkg)

#### 1. Install *hiddify-core* package

```sh
wget -O /tmp/hiddify-core.ipk "https://github.com/1andrevich/hiddify-core/releases/latest/download/hiddify-core_$(. /etc/os-release; echo "$OPENWRT_ARCH").ipk"
opkg update
opkg install /tmp/hiddify-core.ipk
```

#### 2. Install *luci-app-re-homeproxy* package

```sh
wget -O /tmp/luci-app-re-homeproxy.ipk "$(wget -qO- 'https://api.github.com/repos/1andrevich/homeproxy-hiddify/releases' | grep -o 'https://github\.com/[^"]*luci-app-re-homeproxy[^"]*\.ipk' | head -1)"
opkg install /tmp/luci-app-re-homeproxy.ipk
```

### Optional 

Installation of [Russian Language Pack](https://github.com/1andrevich/homeproxy-hiddify/blob/master/README_ru.md#3-%D1%83%D1%81%D1%82%D0%B0%D0%BD%D0%BE%D0%B2%D0%BA%D0%B0-%D1%8F%D0%B7%D1%8B%D0%BA%D0%BE%D0%B2%D0%BE%D0%B3%D0%BE-%D0%BF%D0%B0%D0%BA%D0%B5%D1%82%D0%B0-ru-1)

If using "Custom JSON" — see the **[Custom JSON Config](../../wiki/Custom-JSON-Config-en)** wiki page for full details.

### 4. Start the service

```sh
/etc/init.d/homeproxy start
```

The service will auto-start on boot. Monitor logs at **Services → Re:HomeProxy → Status**.

## Documentation

Full guides live in the **[Wiki](../../wiki/Home)**:

- **[Getting Started](../../wiki/Getting-Started-en)** — from a fresh install to a working connection, step by step
- **[Core Management](../../wiki/Core-Management-en)** — hiddify-core vs sing-box-extended, the smart installer, storage and the compact build
- **[Supported Protocols](../../wiki/Supported-Protocols-en)** — every protocol, transport, and the build tags each needs
- **[Subscriptions & Node Import](../../wiki/Subscriptions-en)** — share links, .conf, Amnezia `vpn://` (AmneziaWG/Xray), subscriptions, base64
- **[Routing & Access Control](../../wiki/Routing-and-Access-Control-en)** — routing modes, RU Proxy Rules, per-device access control
- **[DNS & Diagnostics](../../wiki/DNS-and-Diagnostics-en)** — clean vs secure DNS, IPv6 leaks, and the Diagnostics page
- **[ByeDPI](../../wiki/ByeDPI-en)** — SOCKS-level DPI bypass, strategy presets and the tester
- **[Zapret](../../wiki/Zapret-en)** — packet-level (nfqws2) DPI bypass, presets, Discord-voice and the tester
- **[Custom JSON Config](../../wiki/Custom-JSON-Config-en)** — raw hiddify-core config routing mode
- **[Troubleshooting](../../wiki/Troubleshooting-en)** — common errors and fixes

## Credits & Acknowledgements

Re:HomeProxy stands on the work of many upstream projects. The LuCI app is GPL-licensed; the cores and bypass engines are fetched at install time from their own releases and remain under their own licenses.

**Base & cores**
- [ImmortalWrt HomeProxy](https://github.com/immortalwrt/homeproxy) — the original LuCI app this is a fork of
- [hiddify-core](https://github.com/hiddify/hiddify-core) — default proxy core (a sing-box fork by the Hiddify team)
- [sing-box-extended](https://github.com/shtorm-7/sing-box-extended) — alternative core with extra build tags (AmneziaWG/WARP, widest protocol set)
- [sing-box](https://sing-box.sagernet.org) — the upstream engine both cores derive from

**DPI-bypass engines**
- [hufrea/byedpi](https://github.com/hufrea/byedpi) — the ByeDPI (`ciadpi`) desync engine; OpenWrt packages by [1andrevich/ByeDPI-OpenWrt](https://github.com/1andrevich/ByeDPI-OpenWrt)
- [bol-van/zapret2](https://github.com/bol-van/zapret2) — the Zapret / nfqws2 / blockcheck2 packet desync engine; OpenWrt packages by [1andrevich/zapret2-openwrt](https://github.com/1andrevich/zapret2-openwrt); some strategy presets adapted from [flowseal/zapret-discord-youtube](https://github.com/flowseal/zapret-discord-youtube) (MIT)

**Protocols** — implemented by the cores above (see [Supported Protocols](../../wiki/Supported-Protocols-en)):

Naive, Mieru, Hysteria/Hysteria2, TUIC, SOCKS, Shadowsocks/Shadowsocks 2022, ShadowTLS, AnyTLS, Tor, Trojan, VLESS (Reality, XHTTP), VMess, WireGuard, AmneziaWG/WARP, SSH.

**Routing lists**
- [Re:Filter](https://github.com/1andrevich/re-filter) — RKN-registry domain + IP blocklist
- [itdoginfo/allow-domains](https://github.com/itdoginfo/allow-domains) — "Russia Inside" and the per-service routing lists (YouTube, Telegram, Discord, Meta, etc.)
- [itdoginfo](https://github.com/itdoginfo) — HODCA and other curated lists by itdoginfo

All trademarks and service names are the property of their respective owners and are referenced nominatively to identify the traffic each rule or list affects.
