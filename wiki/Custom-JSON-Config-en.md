🇬🇧 [English](Custom-JSON-Config-en) | 🇷🇺 [Русский](Custom-JSON-Config-ru)

# Custom JSON Config

**Custom JSON** is a routing mode that lets you bypass HomeProxy's UCI-based configuration entirely and supply a raw [sing-box](https://sing-box.sagernet.org) / hiddify-core JSON config directly. It is intended for advanced users who need fine-grained control that the web UI does not expose.

To enable it, go to **HomeProxy → Client → Routing Settings** and set **Routing Mode** to **Custom JSON**.

---

## Config Structure

A hiddify-core config is a JSON object. The main top-level sections are:

| Section | Purpose |
|---------|---------|
| `log` | Logging level and output path |
| `dns` | DNS servers, rules, and strategy |
| `inbounds` | How traffic enters the proxy (tproxy, tun, socks, http, etc.) |
| `outbounds` | Where traffic exits (direct, proxy servers, chains) |
| `route` | Rules that map inbound traffic to outbounds |
| `experimental` | Cache database, clash API, and other experimental features |

A minimal working config needs at least one inbound, at least two outbounds (`proxy` + `direct`), and route rules to decide which traffic goes where.

**Full reference:** [sing-box Configuration](https://sing-box.sagernet.org/configuration/)

Specific sections:
- [DNS](https://sing-box.sagernet.org/configuration/dns/)
- [Inbounds](https://sing-box.sagernet.org/configuration/inbound/)
- [Outbounds](https://sing-box.sagernet.org/configuration/outbound/)
- [Route](https://sing-box.sagernet.org/configuration/route/)

---

## hiddify-core vs. sing-box

hiddify-core is a fork of sing-box and is largely config-compatible. The key differences:

- **Additional protocols** — hiddify-core may support protocols not yet upstream in sing-box, or support them earlier. This includes AnyTLS and extended options for some existing protocols. Check [Supported Protocols](Supported-Protocols-en) for what your installed build includes.
- **Hiddify-specific extensions** — some extra fields and options exist for hiddify's own features. These are documented in the [HiddifyCli guide](https://hiddify.com/app/HiddifyCli-guide/#run-config-or-subscription-link-in-hiddifycli-with-hiddifyapp-settings).
- **Version differences** — hiddify-core may be ahead of or behind a specific sing-box release. If a sing-box feature is missing, check the hiddify-core release notes.

When writing configs, start from the sing-box documentation and refer to the hiddify-core guide for anything that does not behave as expected.

---

## Example Skeleton

```json
{
  "log": {
    "level": "info"
  },
  "dns": {
    "servers": [
      { "tag": "remote", "address": "tls://1.1.1.1" },
      { "tag": "local",  "address": "223.5.5.5", "detour": "direct" }
    ],
    "rules": [
      { "geosite": "cn", "server": "local" }
    ]
  },
  "inbounds": [
    {
      "type": "tproxy",
      "tag": "tproxy-in",
      "listen": "::",
      "listen_port": 5332
    }
  ],
  "outbounds": [
    {
      "type": "vless",
      "tag": "proxy",
      "server": "your.server.example",
      "server_port": 443
    },
    { "type": "direct", "tag": "direct" },
    { "type": "block",  "tag": "block"  },
    { "type": "dns",    "tag": "dns-out" }
  ],
  "route": {
    "rules": [
      { "protocol": "dns", "outbound": "dns-out" },
      { "geosite": "cn",   "outbound": "direct"  },
      { "geoip":   "cn",   "outbound": "direct"  }
    ],
    "final": "proxy"
  }
}
```

This is illustrative only — adjust inbound type/port, outbound settings, and routing rules to match your setup.

---

## Tips

- **Validate before saving.** An invalid JSON config will silently fail to apply. Use a JSON validator before pasting — syntax errors will not be reported in the UI. After saving, check the log (see below) to confirm the config loaded correctly.
- **Logs.** If the config applies but traffic does not work, check the hiddify-core log in **HomeProxy → Log** or via SSH: `tail -f /var/run/homeproxy/hiddify-c.log`.
- **Inbound ports.** HomeProxy's firewall rules expect specific ports. If you change inbound ports in a custom config, the nftables redirect rules will not match and traffic will not reach your inbound. The default inbound configuration used by HomeProxy is:

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

  If you need to change these ports, update them both in your custom JSON and in `/etc/config/homeproxy` (the `proxy_port`, `redirect_port`, `tproxy_port`, and `dns_port` options) so the firewall rules stay in sync.
- **`default_mark`.** This is **required** in the `route` section to prevent tproxy routing loops. Without it, hiddify-core's own outbound traffic gets intercepted by the nftables tproxy rules and sent back to the proxy, causing a loop. The value must match `self_mark` in `/etc/config/homeproxy` (default: `100`):

  ```json
  "route": {
      "default_mark": 100,
      ...
  }
  ```

  If you change this value, update `self_mark` in `/etc/config/homeproxy` to match.

- **Outbound tags.** Route rules reference outbound tags by name — keep them consistent.
