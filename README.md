[**Русский 🇷🇺**](README_ru.md) / [**English**](README.md)

<a href="https://t.me/one_andrevich"><img src="https://img.shields.io/badge/Telegram-Join-blue?style=flat-square&logo=telegram" alt="Telegram"></a>
# Re:HomeProxy

A modern multi-core proxy platform powered by [hiddify-core](https://github.com/hiddify/hiddify-core). A fork of ImmortalWrt HomeProxy.

## Overview

Re:HomeProxy is a feature-rich proxy management system, a fresh take on ImmortalWrt's HomeProxy. It runs on a choice of cores ([hiddify-core](https://github.com/hiddify/hiddify-core) or [sing-box-extended](https://github.com/shtorm-7/sing-box-extended)), adds a built-in DPI-bypass for un-throttling sites without a VPN, ready-made Russia routing rules, and a one-click core installer — all from the LuCI web interface.

## Key Features

- **Multi-core engine** — run on **hiddify-core** or **sing-box-extended**, your choice per device. The built-in **Core Management** page installs and updates the core for you and automatically picks the right build for your available storage (with a compact build for tight-storage devices).
- **Wide protocol support** — Naive, Mieru, Hysteria, SOCKS, Shadowsocks, ShadowTLS, Tor, Trojan, VLESS (XHTTP), VMess, WireGuard, **AmneziaWG / WARP** (sing-box-extended), SSH and more.
- **ByeDPI DPI-bypass** — built-in [ByeDPI](https://github.com/hufrea/byedpi) integration to un-throttle sites (e.g. YouTube) **without any VPN subscription**, with ready-made strategy presets and a multi-site **strategy tester** that shows which setting actually works on your ISP.
- **URLTest auto-selection** — automatically routes through the fastest reachable node and fails over when one goes down.
- **Russia routing rules** — one-click RU Proxy Rules (Russia Inside, Re:Filter) with curated domain/IP lists, so only blocked destinations go through the proxy.
- **Subscription support** — import nodes from subscription links (including sing-box JSON / Hiddify) and update them on demand.
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
