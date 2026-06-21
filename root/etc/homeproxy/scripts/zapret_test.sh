#!/bin/sh
# Isolated nfqws2 strategy tester.
#
# nfqws2 is a packet mangler (NFQUEUE), not a proxy, so it can't be probed
# "through" like ByeDPI's SOCKS port. Instead we queue ONLY the resolved
# test-site IPs to a TEMP NFQUEUE running the candidate strategy, probe the TLS
# handshake with curl, and tear everything down via a trap — without disturbing
# the live homeproxy queue (qnum 200) or other traffic.
#
# Usage:  zapret_test.sh "<strategy opts>"
# Output: a single JSON line:  {"ok":N,"total":M,"results":[{tag,label,host,ip,tls,ok,reason},...]}
#
# Pass signal = curl time_appconnect > 0 (the TLS handshake completed = the desync
# got the ClientHello past the DPI). HTTP status is irrelevant (a 404 is a pass).

STRAT="$1"
QNUM=209                       # temp queue, distinct from the live 200
DMARK=0x40000000               # nfqws2 DESYNC_MARK (its reinjected fakes)
NFQWS=/opt/zapret2/nfq2/nfqws2
LUA="--lua-init=@/opt/zapret2/lua/zapret-lib.lua --lua-init=@/opt/zapret2/lua/zapret-antidpi.lua --lua-init=@/opt/zapret2/lua/zapret-auto.lua"
TABLE=zapret_test
CMT=zapret_test                # comment tag on our output_redir bypass rules
TMP=/tmp/zapret_test.$$

# tag|label|host  — far/near spread (mirrors the ByeDPI tester)
HOSTS="yt|YouTube|redirector.googlevideo.com tg|Telegram|telegram.org dc|Discord|discord.com st|Speedtest|www.speedtest.net"

NFQ_PID=""
WATCH_PID=""
cleanup() {
	# nfqws2 daemonizes (so $! is stale) and busybox has no pkill. Match nfqws2 by
	# process NAME (never the shell/grep itself), then kill only the one on our temp
	# qnum (sparing the live qnum 200 instance).
	for p in $(pgrep nfqws2 2>/dev/null); do
		tr '\0' ' ' < "/proc/$p/cmdline" 2>/dev/null | grep -q "qnum=$QNUM" && kill "$p" 2>/dev/null
	done
	[ -n "$NFQ_PID" ] && kill "$NFQ_PID" 2>/dev/null
	nft delete table inet "$TABLE" 2>/dev/null
	# remove our surgical bypass rules from the LIVE output_redir chain (by comment)
	for hnd in $(nft -a list chain inet fw4 homeproxy_output_redir 2>/dev/null | grep "$CMT" | grep -oE 'handle [0-9]+' | grep -oE '[0-9]+'); do
		nft delete rule inet fw4 homeproxy_output_redir handle "$hnd" 2>/dev/null
	done
	[ -n "$WATCH_PID" ] && kill "$WATCH_PID" 2>/dev/null
	rm -rf "$TMP" 2>/dev/null
}
trap cleanup EXIT INT TERM

fail() { echo "{\"ok\":0,\"total\":0,\"error\":\"$1\"}"; exit 0; }

[ -x "$NFQWS" ] || fail "zapret2 not installed"
command -v curl >/dev/null 2>&1 || fail "curl not installed"
mkdir -p "$TMP" 2>/dev/null

# Watchdog: guarantee teardown within 30s even if curl/nslookup wedges, so the
# live firewall is never left modified (busybox has no `timeout` applet).
# Redirect its fds to /dev/null: otherwise the backgrounded `sleep` keeps the
# caller's stdout pipe open and rpcd/popen blocks on read() for the full 30s
# (the result is ready in ~2s — the watchdog just held the pipe).
( sleep 30; kill -TERM $$ 2>/dev/null ) >/dev/null 2>&1 &
WATCH_PID=$!

# 1. Resolve test hosts to one IPv4 each — BEFORE touching the firewall, so a slow
#    resolver never runs while the redirect is modified.
IPSET=""
for h in $HOSTS; do
	tag=${h%%|*}; host=${h##*|}
	ip=$(nslookup "$host" 2>/dev/null | grep -oE '([0-9]{1,3}\.){3}[0-9]{1,3}' | grep -vE '^127\.' | tail -1)
	echo "$ip" > "$TMP/ip_$tag"
	[ -n "$ip" ] && IPSET="$IPSET $ip,"
done
IPSET=$(echo "$IPSET" | sed 's/[[:space:]]//g; s/,$//')
[ -z "$IPSET" ] && fail "could not resolve any test host"

# 2. Surgically send ONLY the test IPs' TCP/443 direct (return from output_redir,
#    so router-origin curl egresses direct where our temp queue can catch it).
#    Everything else stays redirected. Tagged with a comment for clean teardown.
if nft list chain inet fw4 homeproxy_output_redir >/dev/null 2>&1; then
	nft insert rule inet fw4 homeproxy_output_redir ip daddr "{ $IPSET }" tcp dport 443 counter return comment "\"$CMT\"" 2>/dev/null
fi

# 3. Temp table: queue test-IP TCP/443 handshakes to QNUM (exclude nfqws's own
#    reinjected DMARK fakes so they aren't re-queued); notrack those fakes.
nft add table inet "$TABLE" 2>/dev/null
nft add chain inet "$TABLE" pre "{ type filter hook postrouting priority mangle; policy accept; }" 2>/dev/null
nft add rule  inet "$TABLE" pre "meta mark and $DMARK == 0 ip daddr { $IPSET } tcp dport 443 ct original packets 1-12 counter queue num $QNUM bypass" 2>/dev/null
nft add chain inet "$TABLE" out "{ type filter hook output priority -150; policy accept; }" 2>/dev/null
nft add rule  inet "$TABLE" out "meta mark and $DMARK != 0 notrack" 2>/dev/null

# 4. Start the candidate nfqws2 on the temp queue.
$NFQWS --qnum=$QNUM --user=daemon --fwmark=$DMARK $LUA $STRAT >/dev/null 2>&1 &
NFQ_PID=$!
sleep 1
pgrep -f "qnum=$QNUM" >/dev/null 2>&1 || fail "nfqws2 did not start - check strategy"

# 5. Probe every host in parallel: curl forced to the resolved IP (keeps SNI),
#    write "time_appconnect curl_exit". Wait ONLY on the curl jobs — a bare `wait`
#    would also block on the 30s watchdog child.
CPIDS=""
for h in $HOSTS; do
	tag=${h%%|*}; host=${h##*|}
	ip=$(cat "$TMP/ip_$tag" 2>/dev/null)
	if [ -z "$ip" ]; then echo "0 6" > "$TMP/r_$tag"; continue; fi
	( out=$(curl -s --resolve "${host}:443:${ip}" -o /dev/null -w '%{time_appconnect}' --connect-timeout 4 --max-time 10 "https://${host}" 2>/dev/null); echo "$out $?" > "$TMP/r_$tag" ) >/dev/null 2>&1 &
	CPIDS="$CPIDS $!"
done
[ -n "$CPIDS" ] && wait $CPIDS

# 6. Build JSON.
JSON=""; OKC=0; TOT=0
for h in $HOSTS; do
	tag=${h%%|*}; rest=${h#*|}; label=${rest%%|*}; host=${rest##*|}
	ip=$(cat "$TMP/ip_$tag" 2>/dev/null)
	raw=$(cat "$TMP/r_$tag" 2>/dev/null); tls=${raw%% *}; rc=${raw##* }
	TOT=$((TOT+1))
	ok=0; case "$tls" in 0|0.000000|"") ok=0;; *) ok=1;; esac
	[ "$ok" = 1 ] && OKC=$((OKC+1))
	reason=""
	if [ "$ok" = 0 ]; then
		case "$rc" in 6) reason=dns;; 7) reason=refused;; 28) reason=timeout;; 35|51|53|56|58|59|60) reason=tls;; *) reason=fail;; esac
	fi
	[ -n "$JSON" ] && JSON="$JSON,"
	JSON="$JSON{\"tag\":\"$tag\",\"label\":\"$label\",\"host\":\"$host\",\"ip\":\"$ip\",\"tls\":\"$tls\",\"ok\":$ok,\"reason\":\"$reason\"}"
done

echo "{\"ok\":$OKC,\"total\":$TOT,\"results\":[$JSON]}"
