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

const action = ARGV[0];
let result;

if (action === 'info') {
	const pkg_manager = detect_pkg_manager();
	const arch = detect_arch();

	const tmp_free_kb = free_kb('/tmp');
	let overlay_free_kb = free_kb('/overlay');
	if (!overlay_free_kb) overlay_free_kb = free_kb('/');

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
		pkg_manager, arch, tmp_free_kb, overlay_free_kb,
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

} else if (action === 'install') {
	const core = ARGV[1];
	if (!(core in ['hiddify', 'singbox'])) {
		result = { result: false, error: 'illegal core' };
	} else {
		const pkg_manager = detect_pkg_manager();
		if (!pkg_manager) {
			result = { result: false, error: 'no supported package manager found (apk or opkg)' };
		} else {
			const arch = detect_arch();
			if (!arch || !match(arch, /^[a-zA-Z0-9_-]+$/)) {
				result = { result: false, error: 'could not detect device architecture' };
			} else {
				const tmp_free_kb = free_kb('/tmp');
				if (tmp_free_kb < 30720) {
					result = { result: false, error: `not enough /tmp space: ${tmp_free_kb} KB free, need 30 MB` };
				} else {
					let overlay_free_kb = free_kb('/overlay');
					if (!overlay_free_kb) overlay_free_kb = free_kb('/');
					if (overlay_free_kb < 30720) {
						result = { result: false, error: `not enough overlay space: ${overlay_free_kb} KB free, need 30 MB` };
					} else {
						let exit_code;

						if (core === 'hiddify') {
							if (pkg_manager === 'apk') {
								exit_code = system(
									'{ wget -qO /tmp/homeproxy-hiddify.pub https://github.com/1andrevich/homeproxy-hiddify/releases/latest/download/homeproxy-hiddify.pub' +
									' && cp /tmp/homeproxy-hiddify.pub /etc/apk/keys/' +
									` && wget -qO /tmp/hiddify-core.apk https://github.com/1andrevich/hiddify-core/releases/latest/download/hiddify-core_${arch}.apk` +
									' && apk add --no-cache --allow-untrusted /tmp/hiddify-core.apk; } >/dev/null 2>&1' +
									'; RC=$?; rm -f /tmp/hiddify-core.apk /tmp/homeproxy-hiddify.pub; exit $RC',
									300000
								);
							} else {
								exit_code = system(
									`{ wget -qO /tmp/hiddify-core.ipk https://github.com/1andrevich/hiddify-core/releases/latest/download/hiddify-core_${arch}.ipk` +
									' && opkg install --force-reinstall /tmp/hiddify-core.ipk; } >/dev/null 2>&1' +
									'; RC=$?; rm -f /tmp/hiddify-core.ipk; exit $RC',
									300000
								);
							}
						} else {
							/* Find the correct sing-box-extended asset for this arch and package manager */
							const api_fd = popen('wget -qO- --timeout=10 https://api.github.com/repos/shtorm-7/sing-box-extended/releases/latest 2>/dev/null');
							let dl_url = null;
							if (api_fd) {
								const api_raw = trim(api_fd.read('all')); api_fd.close();
								let api_data;
								try { api_data = json(api_raw); } catch(e) { api_data = null; }
								if (api_data?.tag_name) {
									const ext = pkg_manager === 'apk' ? '.apk' : '.ipk';
									for (let asset in (api_data?.assets || [])) {
										const n = asset?.name || '';
										if (!match(n, /openwrt/)) continue;
										if (length(split(n, arch)) < 2) continue;
										if (ext === '.apk' && !match(n, /\.apk$/)) continue;
										if (ext === '.ipk' && !match(n, /\.ipk$/)) continue;
										dl_url = asset?.browser_download_url;
										break;
									}
								}
							}

							if (!dl_url) {
								result = { result: false, error: `no package found for arch ${arch} in latest release` };
							} else {
								const ext = pkg_manager === 'apk' ? '.apk' : '.ipk';
								const tmp_pkg = `/tmp/sing-box-extended${ext}`;
								exit_code = system(
									`{ wget -qO ${tmp_pkg} ${shellquote(dl_url)}` +
									(pkg_manager === 'apk'
										? ` && apk add --no-cache --allow-untrusted ${tmp_pkg}`
										: ` && opkg install --force-reinstall ${tmp_pkg}`) +
									`; } >/dev/null 2>&1; RC=$?; rm -f ${tmp_pkg}; exit $RC`,
									300000
								);
							}
						}

						if (!result) {
							if (exit_code !== 0) {
								result = { result: false, error: 'package installation failed' };
							} else {
								if (pkg_manager === 'apk')
									system('apk add --no-cache kmod-nft-tproxy kmod-tun >/dev/null 2>&1', 60000);
								else
									system('opkg install kmod-nft-tproxy kmod-tun >/dev/null 2>&1', 60000);
								result = { result: true };
							}
						}
					}
				}
			}
		}
	}

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
