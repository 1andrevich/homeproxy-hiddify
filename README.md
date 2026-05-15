# HomeProxy-hiddify

A modern ImmortalWrt proxy platform powered by [hiddify-core](https://github.com/hiddify/hiddify-core).

## Overview

HomeProxy Hiddify is a feature-rich proxy management system built on the ImmortalWrt platform. 
Multi-Protocol Support: Naive, Mieru, Hysteria, SOCKS, Shadowsocks, ShadowTLS, Tor, Trojan, VLess (XHTTP), VMess, WireGuard, SSH and more.

## Key Features

- **Modern Web Interface** - Clean and responsive UI for easy proxy management
- **Multi-Protocol Support** - Support for various proxy protocols via hiddify-core
- **Node Management** - Efficiently manage multiple proxy nodes
- **ACL (Access Control Lists)** - Advanced traffic routing and filtering rules
- **NFT Rules** - Network filter table rule management for fine-grained traffic control
- **Subscription Support** - Built-in subscription management for proxy nodes

## ⚠️ Early Stage Project

This project is currently in an **early stage of development**. The web UI configuration is still being developed and will be improved in future versions. 


## Prerequisites

- OpenWRT / ImmortalWrt 24.10 or higher (opkg)
- OpenWRT / ImmortalWrt 25.12 or higher (apk)

## Installation

### OpenWRT 25.12+ (APK)

#### 1. Install hiddify-core package

```sh
wget -O /tmp/homeproxy-hiddify.pub https://github.com/1andrevich/homeproxy-hiddify/releases/latest/download/homeproxy-hiddify.pub
cp /tmp/homeproxy-hiddify.pub /etc/apk/keys/
wget -O /tmp/hiddify-core.apk "https://github.com/1andrevich/hiddify-core/releases/latest/download/hiddify-core_$(. /etc/os-release; echo "$OPENWRT_ARCH").apk"
apk update
apk add /tmp/hiddify-core.apk
```

#### 2. Install the package

```sh
wget -O /tmp/homeproxy-hiddify.pub https://github.com/1andrevich/homeproxy-hiddify/releases/latest/download/homeproxy-hiddify.pub
cp /tmp/homeproxy-hiddify.pub /etc/apk/keys/
wget -O /tmp/luci-app-homeproxy-hiddify.apk "$(wget -qO- 'https://api.github.com/repos/1andrevich/homeproxy-hiddify/releases' | grep -o 'https://github\.com/[^"]*luci-app-homeproxy-hiddify[^"]*\.apk' | head -1)"
apk add /tmp/luci-app-homeproxy-hiddify.apk
```

Once the key is in `/etc/apk/keys/` it is trusted permanently — no flag needed for future updates.

---

### OpenWRT 24.10 (opkg)

#### 1. Install hiddify-core package

```sh
wget -O /tmp/hiddify-core.ipk "https://github.com/1andrevich/hiddify-core/releases/latest/download/hiddify-core_$(. /etc/os-release; echo "$OPENWRT_ARCH").ipk"
opkg update
opkg install /tmp/hiddify-core.ipk
```

#### 2. Install the package

```sh
wget -O /tmp/luci-app-homeproxy-hiddify.ipk "$(wget -qO- 'https://api.github.com/repos/1andrevich/homeproxy-hiddify/releases' | grep -o 'https://github\.com/[^"]*luci-app-homeproxy-hiddify[^"]*\.ipk' | head -1)"
opkg install /tmp/luci-app-homeproxy-hiddify.ipk
```

### Optional. If using "Custom JSON" - Add your proxy config 

With Routing Mode "Custom JSON" enabled,
Place your sing-box compatible JSON config at `/etc/homeproxy/hiddify-c.json`.

> **Required:** add `"default_mark": 100` inside the `"route": {}` section to prevent tproxy routing loops:
>
> ```json
> "route": {
>     "default_mark": 100,
>     ...
> }
> ```

Also add (or merge) the following sections into your config:

**Log:**
```json
"log": {
    "disabled": false,
    "level": "warn",
    "output": "/var/run/homeproxy/hiddify-c.log",
    "timestamp": true
}
```

**Inbounds:**
```json
"inbounds": [
    {
        "type": "direct",
        "tag": "dns-in",
        "listen": "::",
        "listen_port": 5333
    },
    {
        "type": "mixed",
        "tag": "mixed-in",
        "listen": "::",
        "listen_port": 5330,
        "udp_timeout": "300s",
        "sniff": true,
        "sniff_override_destination": true,
        "set_system_proxy": false
    },
    {
        "type": "redirect",
        "tag": "redirect-in",
        "listen": "::",
        "listen_port": 5331,
        "sniff": true,
        "sniff_override_destination": true
    },
    {
        "type": "tproxy",
        "tag": "tproxy-in",
        "listen": "::",
        "listen_port": 5332,
        "network": "udp",
        "udp_timeout": "300s",
        "sniff": true,
        "sniff_override_destination": true
    }
]
```

### 4. Start the service

```sh
/etc/init.d/homeproxy start
```

The service will auto-start on boot. Monitor logs at **Services → HomeProxy-Hiddify → Status**.
