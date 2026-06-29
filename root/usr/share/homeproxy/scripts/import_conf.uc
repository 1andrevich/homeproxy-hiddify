#!/usr/bin/ucode
/*
 * SPDX-License-Identifier: GPL-2.0-only
 *
 * Headless import of a WireGuard / AmneziaWG `.conf` file into a homeproxy
 * `node` section. This is the SSH/agent-callable equivalent of the browser-only
 * `parseWireGuardConf()` + "Import .conf" button in the LuCI node view — kept
 * field-for-field in sync with it.
 *
 * Usage:  ucode import_conf.uc <path-to-.conf> [label]
 * Output: one JSON line, e.g. { "result": true, "section": "awg…", "label": "…", "type": "amneziawg" }
 *         or { "error": "…" } with a non-zero exit code.
 */
'use strict';

import { readfile } from 'fs';
import { cursor } from 'uci';

const uciconfig = 'homeproxy';

function emit(o) { printf('%s\n', o); }

/* Dependency-free stable hash (FNV-1a, 32-bit) for an idempotent section name.
 * Deliberately NOT using `digest`/md5: ucode-mod-digest is absent on OpenWrt 23.05
 * (the legacy build strips it), and that target's build patch only rewrites
 * update_subscriptions.uc — not this script. Pure ucode works everywhere. */
function strhash(s) {
	let h = 2166136261;
	const n = length(s);
	for (let i = 0; i < n; i++) {
		h = (h ^ ord(s, i)) & 0xFFFFFFFF;
		h = (h * 16777619) & 0xFFFFFFFF;
	}
	return sprintf('%08x', h);
}

const path = ARGV[0];
const want_label = ARGV[1];

if (!path) {
	emit({ error: 'usage: import_conf.uc <path-to-.conf> [label]' });
	exit(1);
}

const text = readfile(path);
if (!text) {
	emit({ error: `cannot read file: ${path}` });
	exit(1);
}

/* ---- parse (mirror of parseWireGuardConf in node.js) ---- */
const rawlines = split(text, '\n');
let section = null;
let iface = {}, peer = {};

for (let i = 0; i < length(rawlines); i++) {
	let line = trim(rawlines[i]);
	if (!length(line) || substr(line, 0, 1) === '#')
		continue;
	if (line === '[Interface]') { section = 'interface'; continue; }
	if (line === '[Peer]')      { section = 'peer';      continue; }
	let eq = index(line, '=');
	if (eq < 0)
		continue;
	let key = trim(substr(line, 0, eq));
	let val = trim(substr(line, eq + 1));
	if (section === 'interface') iface[key] = val;
	else if (section === 'peer') peer[key] = val;
}

if (!iface.PrivateKey || !peer.PublicKey || !peer.Endpoint) {
	emit({ error: 'not a valid WireGuard/AmneziaWG .conf (missing PrivateKey / PublicKey / Endpoint)' });
	exit(1);
}

/* split Endpoint host:port on the LAST colon (IPv6 literal safe) */
const ep = peer.Endpoint;
const lc = rindex(ep, ':');
let host = (lc >= 0) ? substr(ep, 0, lc) : ep;
const port = (lc >= 0) ? substr(ep, lc + 1) : '';
host = replace(host, '[', '');
host = replace(host, ']', '');

const isAWG = !!(iface.Jc || iface.Jmin || iface.Jmax || iface.H1);

let node = {
	label: want_label || (isAWG ? 'AmneziaWG' : 'WireGuard'),
	type: isAWG ? 'amneziawg' : 'wireguard',
	address: host,
	port: port,
	wireguard_private_key: iface.PrivateKey,
	wireguard_peer_public_key: peer.PublicKey
};
if (peer.PresharedKey) node.wireguard_pre_shared_key = peer.PresharedKey;
if (iface.Address)     node.wireguard_local_address = map(split(iface.Address, ','), (a) => trim(a));
if (iface.MTU)         node.wireguard_mtu = iface.MTU;

if (isAWG) {
	const awg = {
		amnezia_jc: iface.Jc, amnezia_jmin: iface.Jmin, amnezia_jmax: iface.Jmax,
		amnezia_s1: iface.S1, amnezia_s2: iface.S2, amnezia_s3: iface.S3, amnezia_s4: iface.S4,
		amnezia_h1: iface.H1, amnezia_h2: iface.H2, amnezia_h3: iface.H3, amnezia_h4: iface.H4,
		amnezia_i1: iface.I1, amnezia_i2: iface.I2, amnezia_i3: iface.I3, amnezia_i4: iface.I4, amnezia_i5: iface.I5
	};
	for (let k in awg)
		if (awg[k] != null && awg[k] !== '')
			node[k] = awg[k];
}

/* ---- write the node section (idempotent: same file → same section name) ---- */
const uci = cursor();
uci.load(uciconfig);

const sid = 'awg' + strhash(text);
uci.set(uciconfig, sid, 'node');
for (let k in node)
	uci.set(uciconfig, sid, k, node[k]);
uci.commit(uciconfig);

emit({ result: true, section: sid, label: node.label, type: node.type });
