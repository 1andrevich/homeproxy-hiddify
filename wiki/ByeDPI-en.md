🇬🇧 [English](ByeDPI-en) | 🇷🇺 [Русский](ByeDPI-ru)

# ByeDPI

**ByeDPI** is a built-in DPI-bypass that can un-throttle and unblock sites **without any VPN subscription**. Re:HomeProxy bundles the [ByeDPI](https://github.com/hufrea/byedpi) engine (`ciadpi`) and manages it for you.

---

## What it is — and what it is not

ByeDPI runs a tiny local proxy that **desyncs the TLS handshake** of your connections (splitting, reordering, fake packets, OOB data, etc.) so that your ISP's Deep Packet Inspection can no longer recognise — and therefore can no longer throttle or block — the traffic.

| | |
|---|---|
| ✅ **Un-throttles DPI-filtered sites** | The common case for YouTube and similar services that load slowly or buffer endlessly under DPI throttling. |
| ✅ **No subscription, no server** | It's a local trick — you don't need a VPN node, account, or any remote server. |
| ❌ **Does not encrypt or hide traffic** | Your ISP still sees *which* sites you visit; ByeDPI only changes *how* the first packets look. It is **not a VPN**. |
| ❌ **Cannot reach fully IP-blocked sites** | If a site is blocked by IP/DNS (not just throttled), only a real proxy/VPN node can reach it. |
| ❌ **Not a tunnel** | ByeDPI carries your traffic but does not resolve DNS like a proxy — see *DNS* below. |

Think of ByeDPI as a complement to a VPN node (offload throttled sites like YouTube to ByeDPI to save VPN bandwidth), or as a standalone tool when the only problem is throttling.

---

## Enabling ByeDPI

1. Go to **Services → Re:HomeProxy → Node Settings** and open the **ByeDPI** section.
2. If `ciadpi` is not installed yet, use the **Install** button — Re:HomeProxy fetches the right `byedpi` package for your architecture.
3. Tick **Enable**, pick a strategy (see below), and **Save & Apply**.

That's all that's needed for the engine. Re:HomeProxy starts `ciadpi` for you and prevents it from looping back through the proxy automatically — you do not need to touch the firewall or process settings.

---

## Strategies and presets

A "strategy" is the set of command-line options ByeDPI uses to mangle the handshake. There is no universal best strategy — **what works depends on your ISP's DPI**. Re:HomeProxy ships **40 ready-made presets** grouped by technique:

| Group | Examples | Idea |
|-------|----------|------|
| Disorder | `--disorder 1`, `--disorder 1+s` | Reorder the first segments so DPI can't reassemble the SNI |
| Fake TTL | `--fake -1 --ttl 6…15` | Inject a fake packet that dies (low TTL) before reaching the server |
| Fake MD5 | `--fake -1 --md5sig` | Fake packet carrying an invalid TCP MD5 signature |
| TLS record | `--tlsrec 1+s` | Split at the TLS record layer |
| OOB / DisOOB | `--oob 1+s`, `--disoob 1+s` | Out-of-band byte tricks at the SNI |
| Split | `--split 1+s` | Split the ClientHello at the SNI |
| HTTP mix | `--mod-http hcsmix,…` | Case/format mixing for plain-HTTP hosts |
| **Adaptive** | `--auto=ssl_err`, `--auto=torst` | **Self-correcting** — retries per connection on TLS error / reset |
| Fake SNI/TLS | `--fake-sni`, `--fake-tls-mod` | Send a decoy SNI / TLS fingerprint |
| Aggressive combos | split + OOB + disorder together | When single techniques aren't enough |

You can also pick **Custom** and type your own option string.

### Recommended starting point: preset 31 (adaptive)

**Preset 31 — "Auto SSL Error Fallback"** (`--fake -1 --ttl 8 --auto=ssl_err --fake -1 --ttl 5`) is the safest default, **especially for YouTube**.

Why adaptive matters: a **fixed** fake-TTL strategy (presets 6–10) works for *far* servers but corrupts the handshake on *near* CDN/edge servers — e.g. some YouTube video segments served from a local Google cache. A fixed strategy that fails on near servers not only stalls the page, it can produce a storm of failed-handshake retries that **fills the router's connection-tracking table and freezes SSH/LuCI**. The adaptive `--auto=ssl_err` strategy retries per-connection when it sees a TLS error, so it self-corrects across near *and* far destinations.

---

## The strategy tester

Because the right strategy is ISP-specific, the ByeDPI section includes a **tester**:

- **Test all strategies** — probes four reference sites in parallel and shows a result per site as dots:
  - **YouTube** and **Telegram** — *far* servers
  - **Discord** and **Speedtest.net** — *near* servers
  - `●●●●` = all four reachable with that strategy; `●●○○` = far sites work but near sites fail (a sign the strategy is destination-sensitive, like a fixed fake-TTL).
- **Test current** — tests only the strategy currently in the command field and shows full site names with ✓ / ✗.

Pick a strategy that scores **all-green (`●●●●`)** for your network. If several do, prefer an adaptive one (31/32).

> The tester runs ByeDPI on a separate temporary port, so it does not disturb live traffic.

---

## Routing traffic through ByeDPI

ByeDPI appears as a selectable node (**ByeDPI**) once enabled. Two common setups:

- **Alongside a VPN node (recommended):** in `proxy_banned_ru` mode, open **RU Proxy Rules** and set a *specific list's* node to **ByeDPI** — e.g. route YouTube through ByeDPI (saving VPN bandwidth) while everything else uses your VPN.
- **Standalone (no VPN):** set ByeDPI as the **main node**. All proxied traffic then goes through the local desync.

---

## DNS

ByeDPI is a desync, not a tunnel, so DNS does **not** go through it. When ByeDPI carries traffic, Re:HomeProxy resolves names **directly** (your configured Secure DNS detours direct-out for ByeDPI). Trying to push DoH/DoT or UDP DNS *through* ByeDPI fails — the handshake mangling corrupts the encrypted DNS session. This is handled automatically; there is nothing to configure.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| A site still loads slowly | The strategy isn't right for your ISP — run **Test all strategies** and pick an all-green one. |
| YouTube buffers on a fixed fake-TTL preset | Switch to the adaptive **preset 31**; fixed TTL stalls on near Google cache nodes. |
| Router/LuCI/SSH becomes laggy | A destination-sensitive strategy is causing retry storms — switch to an adaptive preset. |
| A site is unreachable, not just slow | It may be IP-blocked, not throttled — ByeDPI can't help; use a proxy/VPN node for it. |

See also: [Zapret](Zapret-en) · [Core Management](Core-Management-en) · [Supported Protocols](Supported-Protocols-en) · [Troubleshooting](Troubleshooting-en)
