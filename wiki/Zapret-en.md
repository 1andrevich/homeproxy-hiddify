🇬🇧 [English](Zapret-en) | 🇷🇺 [Русский](Zapret-ru)

# Zapret

**Zapret 2** is a second, packet-level DPI-bypass built into Re:HomeProxy. It un-throttles and unblocks sites **without any VPN subscription** by desyncing the handshake of selected flows directly on the wire. Re:HomeProxy bundles the [bol-van/zapret2](https://github.com/bol-van/zapret2) engine (`nfqws2`) and manages it for you.

It complements [ByeDPI](ByeDPI-en): same goal, different layer. See [ByeDPI vs Zapret](#byedpi-vs-zapret) below.

---

## What it is — and what it is not

Zapret runs the **`nfqws2`** packet processor. The selected traffic is tagged in the firewall and handed to an **NFQUEUE**, where `nfqws2` rewrites the first few packets of each connection (fake packets, splitting, disorder, TCP-MD5/seq tricks, TLS-record manipulation) so your ISP's Deep Packet Inspection can no longer recognise — and therefore can no longer throttle or block — the traffic.

| | |
|---|---|
| ✅ **Un-throttles DPI-filtered sites** | The common case for YouTube, Discord and similar services slowed or blocked by DPI. |
| ✅ **No subscription, no server** | A local packet trick — no VPN node, account or remote server. |
| ✅ **Works on both cores** | Implemented as a marked direct outbound; works identically on hiddify-core and sing-box-extended. |
| ✅ **Handles TCP *and* UDP/QUIC** | Unlike ByeDPI, the NFQUEUE path also desyncs UDP flows (used for Discord voice). |
| ❌ **Does not encrypt or hide traffic** | Your ISP still sees *which* sites you visit; Zapret only changes *how* the first packets look. It is **not a VPN**. |
| ❌ **Cannot reach fully IP-blocked sites** | If a site is blocked by IP/DNS (not just throttled), only a real proxy/VPN node can reach it. |

---

## How it works

Zapret is wired as a routing **target**, not a SOCKS node:

1. The config generator adds a `direct` outbound called **`zapret-out`** stamped with a `routing_mark` (default mark `110`).
2. When a routing rule selects `zapret-out`, the core egresses that flow **directly**, but tagged with the mark.
3. An nft chain (`homeproxy_zapret_queue`) catches the marked packets and sends the first 1–12 packets of each TCP/UDP connection to an **NFQUEUE**.
4. `nfqws2` reads the queue and desyncs the handshake, then lets the connection continue normally.

Because it is a marked *direct* outbound (not a tunnel), `zapret-out` falls back to plain `direct-out` automatically when Zapret is disabled, so the generated config always stays valid. Loop-avoidance returns for the Zapret mark and `nfqws2`'s own reinjected (DESYNC_MARK) packets are added to the firewall automatically — you don't touch nft.

---

## Enabling Zapret

1. Go to **Services → Re:HomeProxy → Node Settings** and open the **Zapret** tab.
2. If `nfqws2` is not installed yet, use the **Install** button — Re:HomeProxy fetches the right [zapret2-openwrt](https://github.com/1andrevich/zapret2-openwrt) package for your architecture.
3. Tick **Enable**, pick a strategy preset (see below), and **Save & Apply**.

That's all for the engine. The `--qnum` / `--user` / `--fwmark` / `--lua-init` arguments are added automatically — you only edit the desync strategy itself.

---

## Strategies and presets

A "strategy" is the set of `nfqws2` options applied to every flow routed to Zapret. There are **no hostlists** — the routing rules already decide *what* is sent here, so the strategy only decides *how* to desync it. As with ByeDPI, **there is no universal best strategy** — what works depends on your ISP's DPI.

The **Strategy preset** picker fills the strategy field for you and is grouped into two sets:

| Group | What it is |
|-------|------------|
| **Recommended** | A small curated set, purpose-named (e.g. *Default (fake + multidisorder)*, *Multisplit*, *Fake only*). Start here. |
| **Full-test pool** | The larger technique-named pool used by the full tester. |

Presets are shipped read-only in `/etc/homeproxy/zapret_candidates.json` and are based on [bol-van/zapret2](https://github.com/bol-van/zapret2) (nfqws2/blockcheck2) with some adapted from [flowseal/zapret-discord-youtube](https://github.com/flowseal/zapret-discord-youtube) (MIT). You can also leave the preset on *custom* and type your own option string in the **Desync strategy** field.

---

## The strategy tester

Because the right strategy is ISP-specific, the Zapret tab includes a **tester** that never touches your live traffic — it spins up a **temporary NFQUEUE scoped to four test sites** and checks whether each TLS handshake completes:

- **Test current strategy** — runs whatever is in the strategy field against **YouTube**, **Telegram**, **Discord** and **Speedtest.net**, showing each site as ✓ / ✗ with the handshake time, plus an `ok/total` count.
- **Full strategy test** — sweeps the whole preset pool and reports which candidates pass, so you can apply the best one.

Pick a strategy that passes all four sites. If several do, prefer one from the **Recommended** group.

---

## Discord voice (opt-in)

Enabling **Zapret voice** routes Discord's voice-server UDP ranges (and call/voice UDP ports) to `zapret-out` **before** the normal proxy/call rules, so Discord voice is desynced via Zapret instead of being proxied. The UDP port ranges come from [flowseal/zapret-discord-youtube](https://github.com/flowseal/zapret-discord-youtube). This option is honoured only when Zapret is enabled.

---

## Routing traffic through Zapret

Once enabled, **Zapret** becomes a selectable routing target. The typical setup mirrors ByeDPI:

- **Alongside a VPN node (recommended):** in `proxy_banned_ru` mode, open **RU Proxy Rules** and set a *specific list's* target to **Zapret** — e.g. route YouTube and Discord through Zapret (no VPN bandwidth used) while everything else uses your VPN.
- **Per service:** because Zapret is selected per rule, you can mix it freely with the proxy and ByeDPI across different lists.

---

## ByeDPI vs Zapret

Both bypass DPI without a VPN; they operate at different layers, so the right one depends on your ISP.

| | **ByeDPI** | **Zapret 2** |
|---|---|---|
| Layer | Local SOCKS proxy (`ciadpi`) | Kernel NFQUEUE packet mangler (`nfqws2`) |
| Appears as | Selectable in routing rules ("ByeDPI") | Selectable in routing rules ("Zapret") |
| TCP | ✅ | ✅ |
| UDP / QUIC | Carried, but not desynced | ✅ desynced (used for Discord voice) |
| DNS | Forced direct, bypassing ByeDPI (routing it through ByeDPI corrupts DoH/DoT) | Not in the DNS path — Zapret only touches flows routed to it |
| Try when | YouTube throttling, simple per-site offload | ByeDPI doesn't beat your DPI, or you need UDP/voice desync |

There's no harm in installing both and using the tester on each — keep whichever scores all-green on your network.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| A site still loads slowly or won't open | The strategy isn't right for your ISP — run the **Full strategy test** and apply a passing one. |
| Tester shows everything failing | `nfqws2` may not be installed/running — check the **Zapret** tab and the [Diagnostics](Troubleshooting-en) page (it reports install / running / queue status). |
| Discord voice still drops | Enable **Zapret voice**, then re-test. |
| A site is unreachable, not just slow | It may be IP-blocked, not throttled — Zapret can't help; route it through a proxy/VPN node. |

See also: [ByeDPI](ByeDPI-en) · [Core Management](Core-Management-en) · [Supported Protocols](Supported-Protocols-en) · [Troubleshooting](Troubleshooting-en)
