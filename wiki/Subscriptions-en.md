🇬🇧 [English](Subscriptions-en) | 🇷🇺 [Русский](Subscriptions-ru)

# Subscriptions & Node Import

There are four ways to get nodes into Re:HomeProxy. All live on **Node Settings → Nodes** (import buttons) and **Node Settings → Subscriptions**.

---

## 1. Import share links

The **Import share links** button accepts one link per line. Supported schemes:

| Scheme | Protocol |
|--------|----------|
| `vless://` | VLESS (incl. Reality, XHTTP) |
| `vmess://` | VMess (v2rayN format) |
| `ss://` | Shadowsocks / Shadowsocks 2022 |
| `trojan://` | Trojan |
| `hysteria://`, `hysteria2://`, `hy2://` | Hysteria / Hysteria2 |
| `tuic://` | TUIC |
| `naive://` | NaïveProxy |
| `mieru://` | Mieru |
| `ssh://` | SSH |
| `wireguard://` | WireGuard |
| `vpn://` | **AmneziaVPN** share link — see below |

### AmneziaVPN `vpn://` links

Re:HomeProxy fully decodes Amnezia's `vpn://` share format (`base64url(qCompress(zlib JSON))`) right in the browser — no helper tool needed. It reads the container inside and recognises **both** Amnezia config types automatically:

- **AmneziaWG** (`amnezia-awg` / `amnezia-awg2`) → an **AmneziaWG** node, with the full obfuscation parameter set (`Jc`, `Jmin`, `Jmax`, `S1`–`S4`, `H1`–`H4`, `I1`–`I5`), MTU, keepalive and keys. *Requires the sing-box-extended core* — see [Supported Protocols](Supported-Protocols-en).
- **Xray** (`amnezia-xray`) → the Xray outbound inside is parsed into a node, including **VLESS + Reality/TLS** and the transport (`ws`, `grpc`, `xhttp`/`splithttp`, HTTPUpgrade) with their settings.

So an Amnezia link works whether it carries an AmneziaWG or an Xray profile.

### Base64

Subscription and share-link payloads are very often **base64**-encoded — this is the norm, not an edge case. Re:HomeProxy decodes base64 transparently:

- A pasted block that is one big base64 blob is decoded into its list of links.
- Individual `ss://` / `vmess://` links carry their own base64 (userinfo, VMess JSON) — handled automatically.
- Subscription URLs that return a base64 list (the classic format) are decoded on fetch.

You normally don't need to decode anything yourself — just paste the link or the blob.

Two options apply during import:

- **Allow insecure** — marks imported TLS nodes as `tls_insecure` (skip cert verification). Use only if you trust the server.
- **Packet encoding** — applied to imported VLESS/VMess nodes.

---

## 2. Import a .conf file

The **Import .conf** button reads a **WireGuard** or **AmneziaWG** `.conf` file and creates a node from it — handy for WARP/AmneziaWG configs you already have. (AmneziaWG nodes require the **sing-box-extended** core — see [Supported Protocols](Supported-Protocols-en).)

---

## 3. Subscription URLs (auto-updating)

On the **Subscriptions** tab, add one or more **Subscription URL-s**. The router fetches them and keeps the node list in sync. Re:HomeProxy understands several response formats automatically:

- **Base64 / plain share-link lists** — the classic subscription format (one encoded link per line).
- **sing-box JSON / Hiddify** — when the subscription is served as a sing-box/Hiddify JSON config. The correct format is requested via the **User-Agent**, so the same URL can return different formats to different clients.
- **Xray / V2Ray JSON** — config-array JSON (e.g. *connliberty*-style) is parsed into nodes; this path is User-Agent gated as well.

### Update settings

- **Auto update** — enable periodic refresh; pick the **Update time** (hour of day, default 02:00).
- **Update via proxy** — fetch the subscription through the proxy (useful when the subscription host itself is blocked). Off by default to avoid a startup chicken-and-egg.
- Nodes can also be refreshed on demand from the UI.

### Filtering subscription nodes

- **Filter nodes** — `Disable`, `Blacklist mode` (drop matching), or `Whitelist mode` (keep only matching).
- **Filter keywords** — the match list; **regex** is supported.

This is useful to drop dead/region-locked nodes or to keep only a curated subset (e.g. only certain countries/protocols for URLTest).

---

## Which protocols can I import?

That depends on the **core** you installed — a node type only works if the core supports it (e.g. AmneziaWG needs sing-box-extended; some QUIC/Naive protocols need specific build tags). See **[Supported Protocols](Supported-Protocols-en)** for the full matrix and how to check your build's tags.

---

## Notes

- Imported subscription nodes are grouped by their subscription; manual nodes stay separate.
- If an import reports "no valid link found", check the scheme is one of the above and that the link isn't truncated.
- For URLTest selection across many subscription nodes, combine **Filter nodes** here with a per-rule **URLTest** target in [RU Proxy Rules](Routing-and-Access-Control-en).

See also: [Getting Started](Getting-Started-en) · [Supported Protocols](Supported-Protocols-en) · [Routing & Access Control](Routing-and-Access-Control-en) · [Troubleshooting](Troubleshooting-en)
