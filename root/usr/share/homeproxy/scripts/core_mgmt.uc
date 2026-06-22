#!/usr/bin/ucode
/*
 * SPDX-License-Identifier: GPL-2.0-only
 *
 * Copyright (C) 2022-2025 ImmortalWrt.org
 */

'use strict';

import { access, popen, readfile } from 'fs';

function shellquote(s) {
	return `'${replace(s, "'", "'\\''")}'`;
}

function detect_pkg_manager() {
	for (let p in ['/usr/bin/apk', '/sbin/apk', '/usr/sbin/apk'])
		if (access(p)) return 'apk';
	for (let p in ['/bin/opkg', '/usr/bin/opkg'])
		if (access(p)) return 'opkg';
	return null;
}

function detect_arch() {
	const os_rel = readfile('/etc/os-release') || '';
	const m = match(os_rel, /OPENWRT_ARCH="([^"]+)"/) ||
	          match(os_rel, /OPENWRT_ARCH=([^\n]+)/);
	return m ? trim(m[1]) : '';
}

function free_kb(path) {
	const fd = popen(`df -k ${path} 2>/dev/null | awk 'NR==2{print $4}'`);
	if (!fd) return 0;
	const v = int(trim(fd.read('all'))); fd.close();
	return v || 0;
}

function free_ram_kb() {
	const m = match(readfile('/proc/meminfo') || '', /MemAvailable:\s+([0-9]+)/);
	return m ? int(m[1]) : 0;
}

/* Does the overlay filesystem transparently compress? jffs2/ubifs do (~3x on a Go binary),
 * ext4/f2fs do not. This decides how much flash the FULL binary actually occupies. */
function overlay_compresses() {
	const fd = popen("mount 2>/dev/null | awk '$3==\"/overlay\"{print $5; exit}'");
	let t = '';
	if (fd) { t = trim(fd.read('all')); fd.close(); }
	return (t in ['jffs2', 'ubifs']);
}

/* Footprint thresholds (KB). The UPX/compact build is already compressed (~20 MB on ANY fs)
 * but decompresses the whole binary into RAM at every launch (trades flash for RAM). The full
 * Go binary is ~76 MB raw → ~76 MB on ext4/f2fs, but only ~26 MB on a compressing overlay. */
const FULL_OVERLAY_RAW_KB  = 81920;   /* ~80 MB free for the full binary on an uncompressed overlay */
const FULL_OVERLAY_COMP_KB = 32768;   /* ~32 MB on a compressing overlay (binary stores ~3x smaller) */
const COMPACT_OVERLAY_KB   = 25600;   /* ~25 MB for the compact (UPX) build — fs-independent */
const COMPACT_RAM_KB       = 98304;   /* ~96 MB free RAM to decompress + run the compact build */

const action = ARGV[0];
let result;

if (action === 'info') {
	const pkg_manager = detect_pkg_manager();
	const arch = detect_arch();

	const tmp_free_kb = free_kb('/tmp');
	let overlay_free_kb = free_kb('/overlay');
	if (!overlay_free_kb) overlay_free_kb = free_kb('/');
	const ram_free_kb = free_ram_kb();

	const hiddify_installed = !!access('/usr/bin/hiddify-core');
	let hiddify_version = null;
	if (hiddify_installed) {
		const fd = popen('/usr/bin/hiddify-core version 2>/dev/null');
		if (fd) {
			const out = fd.read('all'); fd.close();
			const m = match(out, /version v?(\S+)/);
			if (m) hiddify_version = m[1];
		}
	}

	const singbox_installed = !!access('/usr/bin/sing-box');
	let singbox_version = null;
	let singbox_extended = false;
	if (singbox_installed) {
		const fd = popen('/usr/bin/sing-box version 2>/dev/null');
		if (fd) {
			const out = fd.read('all'); fd.close();
			const m = match(out, /version v?(\S+)/);
			if (m) singbox_version = m[1];
			singbox_extended = !!match(out, /amneziawg|with_amnezia/);
		}
	}

	result = {
		pkg_manager, arch, tmp_free_kb, overlay_free_kb, ram_free_kb,
		hiddify: { installed: hiddify_installed, version: hiddify_version },
		singbox: { installed: singbox_installed, version: singbox_version, extended: singbox_extended }
	};

} else if (action === 'check_remote') {
	const core = ARGV[1];
	if (!(core in ['hiddify', 'singbox'])) {
		result = { error: 'illegal core' };
	} else {
		const api_url = core === 'hiddify'
			? 'https://api.github.com/repos/1andrevich/hiddify-core/releases/latest'
			: 'https://api.github.com/repos/shtorm-7/sing-box-extended/releases/latest';

		const fd = popen('wget -qO- --timeout=10 ' + shellquote(api_url) + ' 2>/dev/null');
		if (!fd) {
			result = { error: 'wget failed' };
		} else {
			const raw = trim(fd.read('all')); fd.close();
			if (!length(raw)) {
				result = { error: 'no response from GitHub API' };
			} else {
				let data;
				try { data = json(raw); } catch(e) { data = null; }
				if (!data)
					result = { error: 'invalid JSON from GitHub API' };
				else if (!data?.tag_name)
					result = { error: 'could not read tag_name from response' };
				else
					result = { tag: data.tag_name, version: replace(data.tag_name, /^v/, '') };
			}
		}
	}

} else if (action === 'prepare_install') {
	const core = ARGV[1];
	const variant = ARGV[2] || '';   /* 'upx' = the compressed hiddify-core build (small flash, decompresses into RAM at launch) */
	if (!(core in ['hiddify', 'singbox'])) {
		result = { error: 'illegal core' };
	} else {
		const pkg_manager = detect_pkg_manager();
		if (!pkg_manager) {
			result = { error: 'no supported package manager found (apk or opkg)' };
		} else {
			const arch = detect_arch();
			if (!arch || !match(arch, /^[a-zA-Z0-9_-]+$/)) {
				result = { error: 'could not detect device architecture' };
			} else {
				const tmp_free_kb = free_kb('/tmp');
				if (tmp_free_kb < 30720) {
					result = { error: `not enough /tmp space: ${tmp_free_kb} KB free, need 30 MB` };
				} else {
					let overlay_free_kb = free_kb('/overlay');
					if (!overlay_free_kb) overlay_free_kb = free_kb('/');
					const ram_free_kb = free_ram_kb();
					const ext = pkg_manager === 'apk' ? '.apk' : '.ipk';
					/* full-binary footprint depends on whether the overlay compresses */
					const full_need = overlay_compresses() ? FULL_OVERLAY_COMP_KB : FULL_OVERLAY_RAW_KB;

					if (core === 'hiddify') {
						/* Auto-pick the build from free overlay (+ free RAM for the compact one).
						 * ARGV[2] ('standard'|'upx') is an advanced override; size-checked either way.
						 * This is the guardrail for the "full binary truncates on a small overlay →
						 * SIGBUS" trap: never offer a build the device can't actually hold/run. */
						let chosen = variant;
						let note = null;
						/* UPX-compressed binaries are crash-prone (SIGILL on startup) on these
						 * soft-float MIPS targets, so never AUTO-pick the compact build there —
						 * fall back to standard, or error cleanly. An explicit variant='upx'
						 * override is still honored (advanced users). Non-MIPS arches (incl.
						 * aarch64 like MT7622) are unaffected. */
						const mips_no_auto_upx = (arch === 'mipsel_24kc' || arch === 'mips_24kc');
						if (chosen !== 'standard' && chosen !== 'upx') {
							if (overlay_free_kb >= full_need)
								chosen = 'standard';
							else if (mips_no_auto_upx)
								chosen = null;   /* don't squeeze a crash-prone compact build onto tight-flash MIPS */
							else if (overlay_free_kb >= COMPACT_OVERLAY_KB && ram_free_kb >= COMPACT_RAM_KB) {
								chosen = 'upx';
								note = 'Limited storage — installing the compact build (decompresses into RAM at launch).';
							} else
								chosen = null;
						}

						if (!chosen) {
							result = mips_no_auto_upx
								? { error: `Not enough overlay for the full build: ${overlay_free_kb} KB free, need ~${full_need} KB. The compact build is not offered on MIPS (UPX is unreliable there). Free up space, or bake the core into a custom firmware image.` }
								: (overlay_free_kb >= COMPACT_OVERLAY_KB)
								? { error: `Device too constrained: ${overlay_free_kb} KB free overlay (full build needs ~${full_need}) and only ${ram_free_kb} KB free RAM (compact build needs ~${COMPACT_RAM_KB}). Use sing-box-extended instead.` }
								: { error: `Not enough storage: ${overlay_free_kb} KB free overlay, need at least ~${COMPACT_OVERLAY_KB} KB (~25 MB).` };
						} else {
							const need = (chosen === 'upx') ? COMPACT_OVERLAY_KB : full_need;
							if (overlay_free_kb < need) {
								result = { error: `Not enough overlay space for the ${chosen === 'upx' ? 'compact' : 'full'} build: ${overlay_free_kb} KB free, need ~${need} KB.` };
							} else {
								const hp_path = (chosen === 'upx') ? 'download/upx' : 'latest/download';
								result = {
									pkg_manager, arch, variant: chosen, note,
									dl_url: `https://github.com/1andrevich/hiddify-core/releases/${hp_path}/hiddify-core_${arch}${ext}`,
									tmp_path: `/tmp/hiddify-core${ext}`
								};
							}
						}
					} else if (overlay_free_kb < full_need) {
						result = { error: `Not enough overlay space: ${overlay_free_kb} KB free, sing-box-extended needs ~${full_need} KB.` };
					} else {
						const api_fd = popen('wget -qO- --timeout=10 https://api.github.com/repos/shtorm-7/sing-box-extended/releases/latest 2>/dev/null');
						if (!api_fd) {
							result = { error: 'failed to contact GitHub API' };
						} else {
							const api_raw = trim(api_fd.read('all')); api_fd.close();
							let api_data;
							try { api_data = json(api_raw); } catch(e) { api_data = null; }
							if (!api_data?.tag_name) {
								result = { error: 'could not determine latest version from GitHub' };
							} else {
								let dl_url = null;
								for (let asset in (api_data?.assets || [])) {
									const n = asset?.name || '';
									if (!match(n, /openwrt/)) continue;
									if (length(split(n, arch)) < 2) continue;
									if (ext === '.apk' && !match(n, /\.apk$/)) continue;
									if (ext === '.ipk' && !match(n, /\.ipk$/)) continue;
									dl_url = asset?.browser_download_url;
									break;
								}
								if (!dl_url)
									result = { error: `no package found for arch ${arch} in latest release` };
								else
									result = { pkg_manager, arch, dl_url, tmp_path: `/tmp/sing-box-extended${ext}` };
							}
						}
					}
				}
			}
		}
	}

} else if (action === 'download_pkg') {
	/* UI calls (url, tmp_path). Also tolerate an optional leading core arg
	 * (download_pkg <core> <url> <tmp_path>) so callers that mirror the
	 * prepare_install/install_pkg core-first signature don't silently fail. */
	let url      = ARGV[1];
	let tmp_path = ARGV[2];
	if (ARGV[3] && (ARGV[1] in ['hiddify', 'singbox'])) {
		url      = ARGV[2];
		tmp_path = ARGV[3];
	}
	if (!url || !tmp_path) {
		result = { result: false, error: 'missing arguments' };
	} else {
		const exit_code = system(`wget -qO ${shellquote(tmp_path)} ${shellquote(url)} 2>/dev/null`, 300000);
		result = exit_code === 0 ? { result: true } : { result: false, error: 'download failed' };
	}

} else if (action === 'install_pkg') {
	const core        = ARGV[1];
	const tmp_path    = ARGV[2];
	const pkg_manager = ARGV[3];
	if (!(core in ['hiddify', 'singbox']) || !tmp_path || !pkg_manager) {
		result = { result: false, error: 'invalid arguments' };
	} else {
		let exit_code;
		if (core === 'hiddify' && pkg_manager === 'apk') {
			exit_code = system(
				'{ wget -qO /tmp/homeproxy-hiddify.pub https://github.com/1andrevich/homeproxy-hiddify/releases/latest/download/homeproxy-hiddify.pub' +
				' && cp /tmp/homeproxy-hiddify.pub /etc/apk/keys/' +
				` && apk add ${shellquote(tmp_path)}; } >/dev/null 2>&1` +
				`; RC=$?; rm -f ${shellquote(tmp_path)} /tmp/homeproxy-hiddify.pub; exit $RC`,
				120000
			);
		} else if (pkg_manager === 'apk') {
			/* sing-box-extended has no signing key — allow-untrusted is unavoidable */
			exit_code = system(
				`{ apk add --allow-untrusted ${shellquote(tmp_path)}; } >/dev/null 2>&1` +
				`; RC=$?; rm -f ${shellquote(tmp_path)}; exit $RC`,
				120000
			);
		} else {
			exit_code = system(
				`{ opkg install --force-reinstall ${shellquote(tmp_path)}; } >/dev/null 2>&1` +
				`; RC=$?; rm -f ${shellquote(tmp_path)}; exit $RC`,
				120000
			);
		}
		result = exit_code === 0 ? { result: true } : { result: false, error: 'package installation failed' };
	}

} else if (action === 'install_kmods') {
	const pkg_manager = ARGV[1] || detect_pkg_manager();
	let exit_code = 1;
	/* No --no-cache: it forces apk to refetch the package index over the network
	 * (slow / >60s on poor uplinks, and the index is usually already cached from the
	 * app install). The kmods are tiny and resolve from the local index in seconds. */
	if (pkg_manager === 'apk')
		exit_code = system('apk add kmod-nft-tproxy kmod-tun >/dev/null 2>&1', 120000);
	else if (pkg_manager === 'opkg')
		exit_code = system('opkg install kmod-nft-tproxy kmod-tun >/dev/null 2>&1', 60000);
	result = (exit_code === 0)
		? { result: true }
		: { result: false, error: `kmod install failed (pkg_manager=${pkg_manager || 'none'})` };

} else if (action === 'remove') {
	const core = ARGV[1];
	if (!(core in ['hiddify', 'singbox'])) {
		result = { result: false, error: 'illegal core' };
	} else {
		const pkg_manager = detect_pkg_manager();
		if (!pkg_manager) {
			result = { result: false, error: 'no supported package manager found' };
		} else {
			const pkg_name = core === 'hiddify' ? 'hiddify-core' : 'sing-box-extended';
			const exit_code = pkg_manager === 'apk'
				? system(`apk del ${pkg_name} >/dev/null 2>&1`, 30000)
				: system(`opkg remove ${pkg_name} >/dev/null 2>&1`, 30000);
			result = { result: (exit_code === 0) };
		}
	}

} else {
	result = { error: `unknown action: ${action}` };
}

printf('%s\n', result);
