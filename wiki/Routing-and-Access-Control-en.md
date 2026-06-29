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

### Main node and a separate UDP node

On the **Routing Settings** tab, **Main node** sets where traffic exits (a specific node, or **URLTest** to auto-pick the fastest with its own pool, test interval and tolerance).

By default UDP follows the main node. Set **Main UDP node** to send **UDP/QUIC out a different node** than TCP — useful when your main node handles UDP poorly (or not at all), or when you want QUIC/voice on a node that's better at it. It has its own URLTest pool too. Leave it on *Same as main node* if you don't need the split.

---

## Russia (Proxy Banned) — the full UI

`proxy_banned_ru` is the default RU mode: **everything is direct except what you explicitly proxy.** When it is selected, the **Routing** tab gains the fields below and an extra **RU Proxy Rules** tab appears.

### Routing tab (in this mode)

| Field | What it does |
|-------|--------------|
| **Russia DNS server** 🔓 | Resolves Russian/normal domains **directly** (not through the proxy). Default *Yandex (77.88.8.8)*; also SkyDNS, Comss.one, and plain-UDP Cloudflare/Google. |
| **Secure DNS server** 🔒 | Resolves **blocked** domains **through the proxy** over encrypted DNS (DoH/DoT), so your ISP can't see those lookups. Default *Cloudflare DoH*; also Quad9 / AdGuard / Google (DoH and DoT). See [DNS & Diagnostics](DNS-and-Diagnostics-en). |
| **Proxy calls** 📞 | Route VoIP call ports (WhatsApp, Telegram, FaceTime…) through the proxy. Off by default. |
| **Do not proxify torrents** 🧲 | Force BitTorrent traffic (protocol + common ports) direct. Off by default. |
| **Advanced custom rules** 👨‍💻 | Reveal the **Routing Nodes** and **Routing Rules** tabs (see below). Off by default. |
| **Routing ports** | Limit which destination ports are proxied (e.g. *Common ports only* keeps P2P direct). |
| **Proxy mode** | How traffic is intercepted — see [Routing modes](#routing-modes) above. |

### RU Proxy Rules tab

This is where you choose *what* to proxy. **The default route is Direct** — only the rules you add here are proxied. Each rule = a **Source list** ⤵️ + a **Node** 🔗 to send it through, applied with automatic priority:

1. **Smaller service lists** first — YouTube, Twitter/X, TikTok, Telegram, Discord, Roblox, Meta (Facebook/Instagram), Google AI, Google Play, anime, HDRezka, international news, adult, GeoBlock, HODCA, and cloud/CDN ranges (Cloudflare, CloudFront, OVH, Hetzner, DigitalOcean).
2. **Russia Inside** (1000+ domains, by itdoginfo) — the in-Russia must-have set.
3. **Re:Filter** (60000+ domains + 25000+ IPs) — the Roskomnadzor blocklist.

The lists are community-maintained and **self-refresh** on the router; you only pick which to enable. (Adding the same source twice is flagged — only the first rule takes effect.)

**Per-rule Node** 🔗 can be:

- **Same as main node** — use your main proxy.
- **Separate URLTest** — auto-select among a chosen set of nodes, with its own **URLTest nodes**, **Test interval** (default 180 s) and **Test tolerance** (default 150 ms).
- **A specific node**.
- **ByeDPI** or **Zapret** — send that list through a DPI-bypass instead of a VPN node (e.g. YouTube via [ByeDPI](ByeDPI-en) / [Zapret](Zapret-en) to save VPN bandwidth).

### Advanced custom rules (optional)

Enabling **Advanced custom rules** 👨‍💻 layers two extra tabs on top of the RU presets:

- **Routing Nodes** — define named outbounds (a node, a URLTest group, or a chained **Outbound**), each with its own **Domain resolver** (including the Russia 🔓 / Secure 🔒 servers) and **Domain strategy**.
- **Routing Rules** — match traffic by domain / IP / port / protocol and send it to one of those routing nodes.

Full reference for both tabs (and the standalone **Custom routing** mode): **[Custom Routing](Custom-Routing-en)**.

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
- Use the [Diagnostics](DNS-and-Diagnostics-en) page to confirm traffic is actually being proxied — **Direct IP vs Proxy IP** on hiddify-core, or the **Active Node** row on sing-box-extended.

See also: [Getting Started](Getting-Started-en) · [Subscriptions & Node Import](Subscriptions-en) · [DNS & Diagnostics](DNS-and-Diagnostics-en) · [Troubleshooting](Troubleshooting-en)
