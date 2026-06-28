#!/bin/sh
# Resolve the Zapret tester's fixed test hosts to one IPv4 each — ONCE, up front,
# so the full-test sweep doesn't re-hit DNS for every one of its candidates.
#
# Resolution uses the router's normal resolver: the SAME secure-DNS / direct-egress
# path production uses for these blocked domains (generate_client.uc), so the IP is
# representative for the TLS-handshake probe — a foreign resolver could hand back a
# different CDN edge and make the result meaningless.
#
# Each lookup is time-bounded (busybox has no `timeout`: bg + watchdog kill) so a
# wedged resolver can't hang the rpcd call (which otherwise surfaces in LuCI as
# "ubus call error"), and the whole pass is retried once because applying Zapret
# restarts homeproxy's DNS resolver and it's briefly unavailable right after.
#
# Output: one JSON line —
#   {"ok":1,"ips":{"yt":"1.2.3.4","tg":"…","dc":"…","st":"…"}}
#   {"ok":0,"error":"…"}

# tag|host — mirrors zapret_test.sh's HOSTS (far/near spread).
HOSTS="yt|redirector.googlevideo.com tg|telegram.org dc|discord.com st|www.speedtest.net"

TMP=/tmp/zapret_resolve.$$
mkdir -p "$TMP" 2>/dev/null
trap 'rm -rf "$TMP" 2>/dev/null' EXIT INT TERM

resolve_one() {  # $1=host -> echoes one non-loopback IPv4 (or empty); bounded ~2s
	nslookup "$1" > "$TMP/o" 2>/dev/null & np=$!
	( sleep 2; kill "$np" 2>/dev/null ) >/dev/null 2>&1 & sw=$!
	wait "$np" 2>/dev/null
	kill "$sw" 2>/dev/null
	grep -oE '([0-9]{1,3}\.){3}[0-9]{1,3}' "$TMP/o" 2>/dev/null | grep -vE '^127\.' | tail -1
}

JSON=""; OK=0; n=0
while [ "$n" -lt 2 ]; do
	JSON=""; ANY=""
	for h in $HOSTS; do
		tag=${h%%|*}; host=${h##*|}
		ip=$(resolve_one "$host")
		[ -n "$ip" ] && ANY=1
		[ -n "$JSON" ] && JSON="$JSON,"
		JSON="$JSON\"$tag\":\"$ip\""
	done
	[ -n "$ANY" ] && { OK=1; break; }
	n=$((n+1)); sleep 1
done

if [ "$OK" = 1 ]; then
	echo "{\"ok\":1,\"ips\":{$JSON}}"
else
	echo '{"ok":0,"error":"could not resolve any test host (DNS not ready? wait a few seconds after Apply, then retry)"}'
fi
