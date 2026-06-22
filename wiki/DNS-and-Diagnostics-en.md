🇬🇧 [English](DNS-and-Diagnostics-en) | 🇷🇺 [Русский](DNS-and-Diagnostics-ru)

# DNS & Diagnostics

Two related topics: how Re:HomeProxy resolves names (and why that matters for leaks), and how to verify everything works.

---

## DNS

DNS is configured on **Client → Routing**. Which fields appear depends on the routing mode.

### Russia mode (`proxy_banned_ru`) — two resolvers

Russia mode splits DNS into a **clean** resolver and a **secure** resolver so that lookups go to the right place:

| Field | Purpose | Default |
|-------|---------|---------|
| **Russia DNS server 🔓** | Resolves **Russian** domains **directly**, without the proxy. Plain UDP DNS. | Yandex `77.88.8.8` (also SkyDNS, Comss.one, Cloudflare, Google) |
| **Secure DNS server 🔒** | Resolves **blocked** domains **through the proxy** using encrypted DNS (DoH/DoT), so your ISP can't see which blocked sites you look up. | Cloudflare DoH `https://cloudflare-dns.com/dns-query` (also Quad9, AdGuard, Google; DoT variants) |

This split matters: resolving a blocked domain over plain ISP DNS would either fail or leak the lookup, so blocked domains use encrypted DNS via the proxy, while ordinary Russian domains resolve fast and direct.

> **ByeDPI note:** when a node is ByeDPI, secure DNS is automatically detoured **direct** (not through ByeDPI), because the desync corrupts DoH/DoT. This is handled for you — see [ByeDPI](ByeDPI-en).

### Other modes

- **DNS server** — the general resolver (supports UDP/TCP/DoH/DoQ/DoT). Default `8.8.8.8`. Or `WAN DNS` to read it from the interface.
- **China DNS server** — used in *Bypass mainland China* mode for Chinese domains (default Aliyun `223.5.5.5`).

### Advanced: DNS Servers & DNS Rules

The **DNS Settings**, **DNS Servers**, and **DNS Rules** tabs (under Node Settings) let you define custom resolvers and per-domain DNS routing, including the **domain strategy** (IPv4-only, prefer IPv6, etc.). Most users never need these.

### IPv6 and leaks

In Russia mode, **IPv6 support is off by default on purpose**: the RU routing lists contain **no IPv6 CIDRs**, so any IPv6 traffic would bypass *both* the proxy and the rules — a silent leak. If your WAN has IPv6 and you want everything controlled, the safe choice is to **leave IPv6 disabled** rather than enabling `ipv6_support`.

---

## Diagnostics

The **Diagnostics** page (Services → Re:HomeProxy → Diagnostics) runs live checks. Each card has its own **Check** button.

| Card | What it shows |
|------|---------------|
| **Connectivity** | Reachability of test sites. On **hiddify-core** it also shows your **Direct IP** vs **Proxy IP** (the two should differ when traffic is actually proxied); on **sing-box-extended** it shows the live **Active Node** instead, because sing-box can't report the exit IP. |
| **Core & System** | Whether the core (hiddify-core / sing-box-extended) and ByeDPI are installed, the active binary, version, whether they're running (with PID), and listening ports. Includes a **Restart Service** button. |
| **Configuration** | Whether the generated core config is **valid**, its size, and counts of inbounds / outbounds / rules. |
| **DNS Tests** | Checks that DNS resolution works through the configured resolvers. |
| **Network Intercept** | The nft/firewall interception state — UCI firewall settings and, when Zapret is on, the **Zapret NFQUEUE counters** (mark 110 → queue) so you can confirm packets are reaching nfqws2. |
| **Diagnostics Report** | **Generate** a shareable plain-text report bundling the above — paste it when asking for help. |

### Reading the results

- **Direct IP == Proxy IP** (hiddify-core) → traffic isn't being proxied (check main node / routing mode / access control). On sing-box-extended, confirm the **Active Node** row shows your chosen node instead.
- **Core not running** → use **Restart Service**; if status shows all `?`, the rpcd backend is stale (`/etc/init.d/rpcd restart`, wait ~2 s).
- **Config invalid** → a node or rule is malformed; the report names the error.
- **Zapret counters not incrementing** → the strategy/queue isn't catching traffic — see [Zapret](Zapret-en).

See also: [Getting Started](Getting-Started-en) · [Routing & Access Control](Routing-and-Access-Control-en) · [ByeDPI](ByeDPI-en) · [Zapret](Zapret-en) · [Troubleshooting](Troubleshooting-en)
