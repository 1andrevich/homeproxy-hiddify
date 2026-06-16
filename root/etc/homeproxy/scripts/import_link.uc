#!/usr/bin/ucode
/*
 * SPDX-License-Identifier: GPL-2.0-only
 *
 * Headless import of proxy share-link(s) (vless://, vmess://, trojan://, ss://,
 * hysteria://, hysteria2://, tuic://, …) into homeproxy `node` sections. This is
 * the SSH/agent-callable equivalent of the browser-only "Import share links"
 * button (handleLinkImport / parseShareLink) in the LuCI node view. It reuses the
 * shared parser in node_parse.uc — the SAME parse_uri the subscription importer
 * uses — so there is no second link-parsing implementation to drift out of sync.
 *
 * Usage:  ucode import_link.uc <path-to-file-with-one-link-per-line | single-link> [label]
 * Output: one JSON line, e.g.
 *   { "result": true, "imported": [ { "section": "…", "label": "…", "type": "vless" } ], "failed": 0 }
 *   or { "error": "…" } with a non-zero exit code.
 *
 * Imported nodes carry NO grouphash, so they are treated as user-created and are
 * never removed by a subsequent subscription update.
 */
'use strict';

import { readfile } from 'fs';
import { cursor } from 'uci';
import { parse_uri } from 'node_parse';

const uciconfig = 'homeproxy';

function emit(o) { printf('%s\n', o); }

/* Dependency-free stable hash (FNV-1a, 32-bit) — md5/digest is absent on the
 * OpenWrt 23.05 legacy build, so keep section naming pure-ucode like import_conf.uc. */
function strhash(s) {
	let h = 2166136261;
	const n = length(s);
	for (let i = 0; i < n; i++) {
		h = (h ^ ord(s, i)) & 0xFFFFFFFF;
		h = (h * 16777619) & 0xFFFFFFFF;
	}
	return sprintf('%08x', h);
}

const arg = ARGV[0];
const want_label = ARGV[1];

if (!arg) {
	emit({ error: 'usage: import_link.uc <file-with-links|link> [label]' });
	exit(1);
}

/* arg is either a readable file (one link per line) or the link itself. */
let text = readfile(arg);
if (!text)
	text = arg;

const lines = split(trim(text), '\n');
const uci = cursor();

let imported = [];
let failed = 0;

for (let line in lines) {
	line = trim(line);
	if (!length(line))
		continue;

	const config = parse_uri(line);
	if (type(config) !== 'object' || !config.type) {
		failed++;
		continue;
	}

	const label = (want_label && length(lines) === 1)
		? want_label
		: (config.label || (config.type + '-' + (config.address || 'node')));
	config.label = label;

	const name = strhash(label + '|' + (config.address || '') + ':' + (config.port || ''));
	uci.set(uciconfig, name, 'node');
	for (let k in config)
		if (config[k] !== null && config[k] !== '')
			uci.set(uciconfig, name, k, config[k]);

	push(imported, { section: name, label: label, type: config.type });
}

if (length(imported))
	uci.commit(uciconfig);

emit({ result: length(imported) > 0, imported: imported, failed: failed });
