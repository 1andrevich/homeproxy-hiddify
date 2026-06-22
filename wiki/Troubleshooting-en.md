🇬🇧 [English](Troubleshooting-en) | 🇷🇺 [Русский](Troubleshooting-ru)

# Troubleshooting

---

## "Object not found" Error When Saving

**Symptom:** Saving any form (client settings, access control lists, etc.) shows:
```
RPC call to luci.homeproxy/[method] failed with error -32000: Object not found
```

**Cause:** rpcd has not loaded the `luci.homeproxy` module. This commonly happens right after installing or upgrading the package if the post-install script sent a reload signal while rpcd was not yet running.

**Fix:**
```sh
/etc/init.d/rpcd restart
```
Then **log out and log back in** to the web UI. An existing session does not pick up the new permissions without a fresh login.

---

## Proxy Modes Missing (No TProxy, No Tun)

**Symptom:** The Proxy Mode selector on the Client page only shows "Redirect TCP". TProxy and Tun options are absent even though the required kernel modules are installed.

**Cause:** Same as above — `luci.homeproxy` not loaded. The feature detection call (`singbox_get_features`) returns empty, so all capability flags are false and the options are hidden.

**Fix:** Same as above — restart rpcd and re-login.

---

## TypeError on the Client Page

**Symptom:** Opening `/cgi-bin/luci/admin/services/homeproxy/client` shows:
```
TypeError: Cannot read properties of undefined (reading 'content')
```

**Cause:** The domain list RPC call failed (module not loaded or first boot), and an older version of the package did not handle this gracefully.

**Fix:** Restart rpcd and re-login as above. If you are running an older build, update to the latest release which includes the fix.

---

## All Three Issues Share the Same Root Fix

If you just installed or upgraded the package and see any of the above:

```sh
/etc/init.d/rpcd restart
```
Log out of the web UI and log back in. Both steps are required.

---

## Cannot Download Package via wget (HTTPS Fails)

**Symptom:**
```
Failed to send request: Operation not permitted
Failed to allocate uclient context
```

**Cause:** OpenWRT's built-in `wget` (uclient-fetch) has no SSL library installed, so HTTPS requests fail.

**Fix:**
```sh
opkg update && opkg install libustream-openssl ca-certificates
```

If `opkg` itself cannot reach the internet, download the `.ipk` or `.apk` file on a PC from the [Releases page](https://github.com/1andrevich/homeproxy-hiddify/releases) and transfer it to the router with `scp`.

---

## No Internet Access When Re:HomeProxy Is Enabled (mwan3 Conflict)

**Symptom:** Ping and DNS work, but HTTP/HTTPS traffic fails when Re:HomeProxy is enabled. Stopping mwan3 restores connectivity.

**Cause:** mwan3 uses fwmarks and policy routing to steer traffic between WAN interfaces. When the proxy core makes outbound connections, mwan3 can intercept and misroute them.

**Fix:** Tell the OS to skip mwan3's routing logic for traffic already handled by Re:HomeProxy (marked `0x64`).

Add the following rule as a persistent firewall include:

```sh
uci add firewall include
uci set firewall.@include[-1].path='/etc/firewall.d/homeproxy-mwan3'
uci set firewall.@include[-1].type='script'
uci set firewall.@include[-1].reload='1'
uci commit firewall

mkdir -p /etc/firewall.d
cat > /etc/firewall.d/homeproxy-mwan3 << 'EOF'
#!/bin/sh
iptables -t mangle -I OUTPUT 1 -m mark --mark 0x64/0x64 -j RETURN
EOF
chmod +x /etc/firewall.d/homeproxy-mwan3

/etc/init.d/firewall reload
```

To verify the rule is active:
```sh
iptables -t mangle -L OUTPUT -n --line-numbers | head -5
```
The `0x64` mark rule should appear as line 1.

> This fix deliberately uses `iptables` because **mwan3** operates at the iptables layer. On a fw4 / nftables system it still applies through the iptables-nft compatibility shim — it does not conflict with Re:HomeProxy's nft chains.

---

## Subscription Update Button Does Nothing

**Symptom:** Clicking "Update subscriptions" shows a spinner but node count stays at zero after the page reloads.

**Fix:** Update to the latest release. Earlier builds used a background execution method that did not work correctly from the rpcd context. The current version uses the correct execution path.

If you are on the latest release and still see this, run manually over SSH to check for errors:
```sh
ucode /etc/homeproxy/scripts/update_subscriptions.uc
```
