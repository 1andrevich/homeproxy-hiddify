🇬🇧 [English](Custom-Routing-en) | 🇷🇺 [Русский](Custom-Routing-ru)

# Custom Routing

**Custom routing** is the manual middle ground between the ready-made [routing modes](Routing-and-Access-Control-en) and a hand-written [Custom JSON](Custom-JSON-Config-en) config. You build your own **routing nodes** (where traffic can exit) and **routing rules** (which traffic goes where) in the LuCI UI, without writing JSON.

Set it on **Client → Routing Settings → Routing mode → Custom routing**. Two extra tabs appear: **Routing Nodes** and **Routing Rules**.

> You don't have to switch the whole router to Custom routing: in **Russia (Proxy Banned)** mode, ticking **Advanced custom rules** 👨‍💻 reveals these same two tabs so you can layer custom rules *on top of* the RU presets. See [Routing & Access Control](Routing-and-Access-Control-en).

---

## Routing Nodes

A **routing node** is a named outbound that rules can target. Each can be:

- a specific **node**, or **URLTest** (auto-pick the fastest from a pool),
- a **chain** — via the **Outbound** field, send this node's traffic *through* another routing node,
- with its own **Domain resolver** (including the Russia 🔓 / Secure 🔒 servers in RU mode) and **Domain strategy** (IPv4-only, prefer IPv6, etc.).

This is what lets you do things like "this rule → node A, but resolve its domains with the secure DNS" or build a multi-hop chain.

---

## Routing Rules

Each **routing rule** matches some traffic and sends it to a routing node (or **Direct**). The editor groups the match fields into tabs:

| Tab | Matches on |
|-----|-----------|
| **Other fields** | **Protocol** (sniffed — BitTorrent, DNS, QUIC, TLS, HTTP, STUN, SSH, RDP, DTLS…), **IP version**, network, rule-sets |
| **Host/IP fields** | `domain` / `domain_suffix` / `domain_keyword` / `domain_regex`, destination & source **IP CIDR** |
| **Port fields** | destination / source **port** and port ranges |
| **Process fields** | **process name / path** (for traffic originating on the router itself) |

The **Mode** field shows the matching logic — within a category the entries are OR-ed, and the categories are AND-ed together:

```
(domain || domain_suffix || domain_keyword || domain_regex || ip_cidr || ip_is_private) &&
(port || port_range) &&
(source_ip_cidr || source_ip_is_private) &&
(source_port || source_port_range) &&
(other fields)
```

Rules are evaluated top to bottom (the list is sortable) and the first match wins. The fields map one-to-one to sing-box's route rule — for exactly what each accepts, see the upstream reference:

- [Route](https://sing-box.sagernet.org/configuration/route/) — how routing is structured
- [Route Rule](https://sing-box.sagernet.org/configuration/route/rule/) — every match field
- [Sniff](https://sing-box.sagernet.org/configuration/route/sniff/) — **Protocol** matching needs sniffing enabled (it is, by default)

> **Protocol matching needs sniffing.** Matching by `quic`, `tls`, `bittorrent`, etc. relies on the inbound sniffing the first packets — Re:HomeProxy enables this on its inbounds, so it works out of the box.

---

## Custom routing vs Custom JSON

| | **Custom routing** | **[Custom JSON](Custom-JSON-Config-en)** |
|---|---|---|
| How | UI: Routing Nodes + Routing Rules | Raw sing-box / hiddify-core JSON |
| Good for | Per-app/site/IP rules without writing JSON | Full control, fields the UI doesn't expose |
| Validation | UI-guided | You must validate the JSON yourself |

Start with Custom routing; drop to Custom JSON only when you need something the rule editor can't express.

See also: [Routing & Access Control](Routing-and-Access-Control-en) · [Custom JSON Config](Custom-JSON-Config-en) · [Supported Protocols](Supported-Protocols-en) · [DNS & Diagnostics](DNS-and-Diagnostics-en)
