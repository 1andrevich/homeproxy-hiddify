🇬🇧 [English](Getting-Started-en) | 🇷🇺 [Русский](Getting-Started-ru)

# Getting Started

This page walks you from a fresh install to a working connection. It assumes Re:HomeProxy is already installed (see the [README](../../blob/master/README.md) for package installation).

> Everything below is done in the LuCI web UI: **Services → Re:HomeProxy**.

---

## Step 1 — Install a core

The LuCI app is only the interface; a separate **core** binary does the proxying. Open **Core & Tools → Core management** and install one:

- **hiddify-core** (default) — lighter, has a compact build for small routers.
- **sing-box-extended** — needed for AmneziaWG/WARP and the widest protocol set.

The installer auto-picks a build that fits your storage. Full details: **[Core Management](Core-Management-en)**.

---

## Step 2 — Add at least one node

Open **Node Settings → Nodes**. A "node" is a proxy server you connect through. Add one by:

- **Import share links** — paste `vless://`, `vmess://`, `ss://`, `trojan://`, `vpn://` (Amnezia), Hysteria, etc.
- **Import .conf** — a WireGuard / AmneziaWG config file.
- **Subscription URL** — let the router pull and refresh a list of nodes automatically.
- **Manual** — fill the fields by hand.

All import methods and formats: **[Subscriptions & Node Import](Subscriptions-en)**.

---

## Step 3 — Select the main node

Back on the **Client** page, set **Main node** to the node you added — or choose **URLTest** to let Re:HomeProxy automatically pick and fail over to the fastest reachable node.

---

## Step 4 — Choose a routing mode

On the **Client → Routing** tab, pick **Routing mode**. The default depends on your LuCI language:

- **Russia (Proxy Banned)** — `proxy_banned_ru`, the default for Russian installs: everything goes **direct** except the destinations you add to **RU Proxy Rules** (blocked/throttled sites), which go through the proxy.
- **Global** — everything through the proxy.
- **GFWList / Bypass mainland China / Only proxy mainland China** — China-oriented presets.
- **Custom routing / Custom JSON** — full manual control.

For Russia, leave it on **Russia (Proxy Banned)** and open the **RU Proxy Rules** tab to enable the lists you need (Russia Inside, Re:Filter, YouTube, Discord…). Full reference: **[Routing & Access Control](Routing-and-Access-Control-en)**.

---

## Step 5 — Check the basic transport settings

Still on the **Routing** tab, the defaults are sensible:

- **Proxy mode** — `Redirect TCP + TProxy UDP` by default (TUN options appear if `kmod-tun` is installed).
- **IPv6 support** — **off** by default in Russia mode on purpose: the RU lists have no IPv6 CIDRs, so v6 traffic would bypass both the proxy and the rules. Leave it off unless you know you need it. See **[DNS & Diagnostics](DNS-and-Diagnostics-en)**.

---

## Step 6 — Save, apply, start

Press **Save & Apply**. Then start the service (it also auto-starts on boot):

```sh
/etc/init.d/homeproxy start
```

Watch the log at **Core & Tools**.

---

## Step 7 — Verify it works

Open the **Diagnostics** page and run the checks:

- **Connectivity** — confirms reachability of test sites. On **hiddify-core** it shows your **Direct IP** vs **Proxy IP** (they should differ when traffic is proxied); on **sing-box-extended** it shows the live **Active Node** instead (sing-box can't report the exit IP).
- **Core & System** — confirms the core is installed and running.
- **Configuration** — confirms the generated config is valid.

If something is off, see **[Troubleshooting](Troubleshooting-en)** and **[DNS & Diagnostics](DNS-and-Diagnostics-en)**.

---

## Optional — un-throttle sites without a VPN node

If a site (e.g. YouTube, Discord) is merely *throttled* rather than IP-blocked, you can offload it to a built-in DPI-bypass instead of spending VPN bandwidth:

- **[ByeDPI](ByeDPI-en)** — a SOCKS-level desync.
- **[Zapret](Zapret-en)** — a packet-level (nfqws2) desync.

Both can be selected per RU Proxy Rule (e.g. route only YouTube through ByeDPI/Zapret while the rest uses your VPN).

See also: [Core Management](Core-Management-en) · [Routing & Access Control](Routing-and-Access-Control-en) · [Subscriptions & Node Import](Subscriptions-en) · [Troubleshooting](Troubleshooting-en)
