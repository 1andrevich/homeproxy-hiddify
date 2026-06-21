🇬🇧 [English](Routing-and-Access-Control-en) | 🇷🇺 [Русский](Routing-and-Access-Control-ru)

# Routing & Access Control

Re:HomeProxy decides **what** traffic is proxied (routing mode + rules) and **which devices** are affected (access control). This page covers both.

---

## Routing modes

Set on **Client → Routing → Routing mode**:

| Mode | What it does |
|------|--------------|
| **Russia (Proxy Banned)** (`proxy_banned_ru`) | Default for RU. Everything is **direct** except destinations added to **RU Proxy Rules**, which go through the proxy. |
| **Global** | All traffic through the proxy. |
| **GFWList** | Proxies a built-in list of commonly blocked (GFW) domains. |
| **Bypass mainland China** | Everything proxied except mainland-China destinations (direct). |
| **Only proxy mainland China** | Only mainland-China destinations proxied. |
| **Custom routing** | Manual routing nodes + rules (advanced). |
| **Custom JSON** | Hand-written hiddify-core config — see [Custom JSON Config](Custom-JSON-Config-en). |

**Routing ports** — restrict which destination ports are proxied (e.g. *Common ports only* to keep P2P traffic direct).

**Proxy mode** — how traffic is intercepted: `Redirect TCP`, `Redirect TCP + TProxy UDP` (default), `Redirect TCP + Tun UDP`, or full `Tun TCP/UDP` (TUN modes need `kmod-tun`).

---

## RU Proxy Rules (Russia mode)

The **RU Proxy Rules** tab is where you choose *what* to proxy in `proxy_banned_ru` mode. **The default route is Direct** — only what you add here is proxied.

Each rule = a **Source list** + a **Node** to send it through. Rules are applied with automatic priority:

1. **Smaller service lists** first (YouTube, Discord, Telegram, Twitter/X, TikTok, Meta, Roblox, anime, HDRezka, Google AI/Play, Cloudflare/CloudFront, OVH/Hetzner/DigitalOcean, news, adult, GeoBlock, HODCA…).
2. **Russia Inside** (1000+ domains, by itdoginfo) — the in-Russia must-have set.
3. **Re:Filter** (60000+ domains + 25000+ IPs) — the Roskomnadzor blocklist.

The lists themselves are community-maintained and **self-refresh** on the router; you only pick which to enable.

### Per-rule node target

For each rule the **Node** can be:

- **Same as main node** — use your main proxy.
- **Separate URLTest** — auto-select among a chosen set of nodes (with test interval/tolerance).
- **A specific node**.
- **ByeDPI** or **Zapret** — send that list through a DPI-bypass instead of a VPN node (e.g. YouTube via [ByeDPI](ByeDPI-en) / [Zapret](Zapret-en) to save VPN bandwidth).

### Handy toggles

- **Proxy calls 📞** — route VoIP ports (WhatsApp, Telegram, FaceTime…) through the proxy.
- **Do not proxify torrents 🧲** — force BitTorrent traffic direct.
- **Advanced custom rules 👨‍💻** — reveals the **Routing Nodes** and **Routing Rules** tabs for fine-grained custom rules on top of the RU presets.

---

## Access Control — which devices are affected

**Client → Access Control** controls *which LAN devices* the proxy applies to. There are several **independent** controls — they combine, they are not one dropdown:

### LAN IP Policy

- **Proxy mode for devices** — the global gate:
  - **Disable** — no per-device restriction (all LAN devices follow the routing rules).
  - **Proxy listed only** — only the listed IPs/MACs are proxied.
  - **Proxy all except listed** — everyone is proxied except the listed IPs/MACs (which go direct).
- **Gaming mode** *(independent list)* — for the selected devices, **only TCP** is proxied (UDP/game traffic stays direct for lower latency).
- **Global proxy** *(independent list)* — for the selected devices, **all** traffic goes through the proxy regardless of the routing rules.

Each of these is its own IP/MAC list, so you can mix them per device.

### WAN IP Policy

Force specific **destination** IPs/CIDRs to be proxied or direct, regardless of mode.

### Proxy / Direct Domain Lists

Free-form domain lists that are always proxied or always direct — useful for one-off destinations not covered by the RU lists.

---

## Tips

- In Russia mode, start with **Russia Inside + Re:Filter** enabled; add per-service lists only if a specific site still misbehaves.
- If a site is *throttled* (slow) rather than *blocked* (unreachable), route it through [ByeDPI](ByeDPI-en) or [Zapret](Zapret-en) instead of the VPN.
- Use the [Diagnostics](DNS-and-Diagnostics-en) page's **Direct IP vs Proxy IP** to confirm a device/destination is actually being proxied.

See also: [Getting Started](Getting-Started-en) · [Subscriptions & Node Import](Subscriptions-en) · [DNS & Diagnostics](DNS-and-Diagnostics-en) · [Troubleshooting](Troubleshooting-en)
