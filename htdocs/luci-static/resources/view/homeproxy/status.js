/*
 * SPDX-License-Identifier: GPL-2.0-only
 *
 * Copyright (C) 2022-2025 ImmortalWrt.org
 */

'use strict';
'require dom';
'require form';
'require fs';
'require homeproxy as hp';
'require poll';
'require rpc';
'require uci';
'require ui';
'require view';

/* Thanks to luci-app-aria2 */
const css = '				\
#log_textarea {				\
	padding: 10px;			\
	text-align: left;		\
}					\
#log_textarea pre {			\
	padding: .5rem;			\
	word-break: break-all;		\
	margin: 0;			\
}					\
.description {				\
	background-color: #33ccff;	\
}';

const hp_dir = '/var/run/homeproxy';

/* Map a sing-box outbound tag to its human-readable UCI label */
function resolveTag(tag) {
	const m = tag && tag.match(/^cfg-(.+)-out$/);
	if (m) {
		const label = uci.get('homeproxy', m[1], 'label');
		if (label) return label;
	}
	/* Fixed tags: look up the backing UCI section via the 'main' config section */
	const specials = { 'main-out': 'main_node', 'main-udp-out': 'main_udp_node' };
	if (specials[tag]) {
		const section = uci.get('homeproxy', 'main', specials[tag]);
		if (section) {
			const label = uci.get('homeproxy', section, 'label');
			if (label) return label;
		}
	}
	return tag;
}

function getIPInfo(o, type) {
	const callIPInfo = rpc.declare({
		object: 'luci.homeproxy',
		method: 'clash_ip_info',
		expect: { '': {} }
	});

	const resultEl = E('strong', { 'style': 'color:gray' }, _('unchecked'));

	const formatIPInfo = (entry, nodeTag) => {
		if (!entry)
			return E('strong', { 'style': 'color:red' }, _('No data'));

		const lines = [];
		if (nodeTag)
			lines.push(E('span', {}, [ _('Node') + ': ', E('strong', {}, resolveTag(nodeTag)) ]));
		if (entry.ip) {
			const delayStr = (entry.delay && entry.delay !== 65535) ? ` — ${entry.delay} ms` : '';
			const meta = [entry.country, entry.org].filter(Boolean).join(', ');
			const label = entry.ip + (meta ? ` (${meta})` : '') + delayStr;
			lines.push(E('span', {}, [ 'IP: ', E('strong', { 'style': 'color:green' }, label) ]));
		}

		return E('span', {}, lines.map((l) => E('div', {}, [ l ])));
	};

	o.default = E('div', { 'style': 'cbi-value-field' }, [
		E('button', {
			'class': 'btn cbi-button cbi-button-action',
			'click': ui.createHandlerFn(this, () => {
				return L.resolveDefault(callIPInfo(), {}).then((ret) => {
					const el = o.default.firstElementChild.nextElementSibling;
					if (ret.error) {
						dom.content(el, E('span', { 'style': 'color:red' }, ret.error));
						return;
					}
					const entry = ret[type];
					dom.content(el, formatIPInfo(entry, type === 'proxy' ? entry?.node : null));
				});
			})
		}, [ _('Check') ]),
		' ',
		resultEl
	]);
}

function getConnStat(o, site) {
	const callConnStat = rpc.declare({
		object: 'luci.homeproxy',
		method: 'connection_check',
		params: ['site'],
		expect: { '': {} }
	});

	o.default = E('div', { 'style': 'cbi-value-field' }, [
		E('button', {
			'class': 'btn cbi-button cbi-button-action',
			'click': ui.createHandlerFn(this, () => {
				return L.resolveDefault(callConnStat(site), {}).then((ret) => {
                                        let ele = o.default.firstElementChild.nextElementSibling;
					if (ret.result) {
						ele.style.setProperty('color', 'green');
                                                ele.innerHTML = _('passed');
					} else {
						ele.style.setProperty('color', 'red');
                                                ele.innerHTML = _('failed');
					}
				});
			})
		}, [ _('Check') ]),
		' ',
		E('strong', { 'style': 'color:gray' }, _('unchecked')),
	]);
}

function getResVersion(o, type) {
	const callResVersion = rpc.declare({
		object: 'luci.homeproxy',
		method: 'resources_get_version',
		params: ['type'],
		expect: { '': {} }
	});

	const callResUpdate = rpc.declare({
		object: 'luci.homeproxy',
		method: 'resources_update',
		params: ['type'],
		expect: { '': {} }
	});

	return L.resolveDefault(callResVersion(type), {}).then((res) => {
		let spanTemp = E('div', { 'style': 'cbi-value-field' }, [
			E('button', {
				'class': 'btn cbi-button cbi-button-action',
				'click': ui.createHandlerFn(this, () => {
					return L.resolveDefault(callResUpdate(type), {}).then((res) => {
						switch (res.status) {
						case 0:
							o.description = _('Successfully updated.');
							break;
						case 1:
							o.description = _('Update failed.');
							break;
						case 2:
							o.description = _('Already in updating.');
							break;
						case 3:
							o.description = _('Already at the latest version.');
							break;
						default:
							o.description = _('Unknown error.');
							break;
						}

						return o.map.reset();
					});
				})
			}, [ _('Check update') ]),
			' ',
			E('strong', { 'style': (res.error ? 'color:red' : 'color:green') },
				[ res.error ? 'not found' : res.version ]
			),
		]);

		o.default = spanTemp;
	});
}

function getRuntimeLog(o, name, _option_index, section_id, _in_table) {
	const filename = o.option.split('_')[1];

	let section, log_level_el;
	switch (filename) {
	case 'homeproxy':
		section = null;
		break;
	case 'hiddify-c':
		section = 'config';
		break;
	}

	if (section) {
		const selected = uci.get('homeproxy', section, 'log_level') || 'warn';
		const choices = {
			trace: _('Trace'),
			debug: _('Debug'),
			info: _('Info'),
			warn: _('Warn'),
			error: _('Error'),
			fatal: _('Fatal'),
			panic: _('Panic')
		};

		log_level_el = E('select', {
			'id': o.cbid(section_id),
			'class': 'cbi-input-select',
			'style': 'margin-left: 4px; width: 6em;',
			'change': ui.createHandlerFn(this, (ev) => {
				uci.set('homeproxy', section, 'log_level', ev.target.value);
				return o.map.save(null, true).then(() => {
					ui.changes.apply(true);
				});
			})
		});

		Object.keys(choices).forEach((v) => {
			log_level_el.appendChild(E('option', {
				'value': v,
				'selected': (v === selected) ? '' : null
			}, [ choices[v] ]));
		});
	}

	const callLogClean = rpc.declare({
		object: 'luci.homeproxy',
		method: 'log_clean',
		params: ['type'],
		expect: { '': {} }
	});

	const log_textarea = E('div', { 'id': 'log_textarea' },
		E('img', {
			'src': L.resource('icons/loading.svg'),
			'alt': _('Loading'),
			'style': 'vertical-align:middle'
		}, _('Collecting data...'))
	);

	let log;
	poll.add(L.bind(() => {
		return fs.read_direct(String.format('%s/%s.log', hp_dir, filename), 'text')
		.then((res) => {
			log = E('pre', { 'wrap': 'pre' }, [
				res.trim() || _('Log is empty.')
			]);

			dom.content(log_textarea, log);
		}).catch((err) => {
			if (err.toString().includes('NotFoundError'))
				log = E('pre', { 'wrap': 'pre' }, [
					_('Log file does not exist.')
				]);
			else
				log = E('pre', { 'wrap': 'pre' }, [
					_('Unknown error: %s').format(err)
				]);

			dom.content(log_textarea, log);
		});
	}));

	return E([
		E('style', [ css ]),
		E('div', {'class': 'cbi-map'}, [
			E('h3', {'name': 'content', 'style': 'align-items: center; display: flex;'}, [
				_('%s log').format(name),
				log_level_el || '',
				E('button', {
					'class': 'btn cbi-button cbi-button-action',
					'style': 'margin-left: 4px;',
					'click': ui.createHandlerFn(this, () => {
						return L.resolveDefault(callLogClean(filename), {});
					})
				}, [ _('Clean log') ])
			]),
			E('div', {'class': 'cbi-section'}, [
				log_textarea,
				E('div', {'style': 'text-align:right'},
					E('small', {}, _('Refresh every %s seconds.').format(L.env.pollinterval))
				)
			])
		])
	]);
}

const CORE_MGMT = '/usr/share/homeproxy/scripts/core_mgmt.uc';

const callCurlStatus = rpc.declare({
	object: 'luci.homeproxy',
	method: 'curl_status',
	expect: { '': {} }
});

const callCurlInstall = rpc.declare({
	object: 'luci.homeproxy',
	method: 'curl_install',
	expect: { '': {} }
});

const callCurlRemove = rpc.declare({
	object: 'luci.homeproxy',
	method: 'curl_remove',
	expect: { '': {} }
});

const callByeDPIStatus = rpc.declare({
	object: 'luci.homeproxy',
	method: 'byedpi_status',
	expect: { '': {} }
});

const callByeDPIPrepareInstall = rpc.declare({
	object: 'luci.homeproxy',
	method: 'byedpi_prepare_install',
	expect: { '': {} }
});

const callByeDPIInstallPkg = rpc.declare({
	object: 'luci.homeproxy',
	method: 'byedpi_install_pkg',
	params: ['tmp_path', 'pkg_manager'],
	expect: { '': {} }
});

const callByeDPIRemove = rpc.declare({
	object: 'luci.homeproxy',
	method: 'byedpi_remove',
	expect: { '': {} }
});

const callZapretStatus = rpc.declare({
	object: 'luci.homeproxy',
	method: 'zapret_status',
	expect: { '': {} }
});

const callZapretPrepareInstall = rpc.declare({
	object: 'luci.homeproxy',
	method: 'zapret_prepare_install',
	expect: { '': {} }
});

const callZapretInstallPkg = rpc.declare({
	object: 'luci.homeproxy',
	method: 'zapret_install_pkg',
	params: ['tmp_path', 'pkg_manager'],
	expect: { '': {} }
});

const callZapretRemove = rpc.declare({
	object: 'luci.homeproxy',
	method: 'zapret_remove',
	expect: { '': {} }
});

function buildByeDPICard(byedpi, isMainNode) {
	let installed = byedpi?.installed || false;
	let version   = byedpi?.version   || null;
	const running    = byedpi?.running    || false;
	const pkgMgr     = byedpi?.pkg_manager || null;
	const canInstall = !!pkgMgr;

	const statusEl = E('strong', {
		style: installed ? 'color:green' : 'color:gray'
	}, installed ? (version ? 'v' + version : _('Installed')) : _('Not installed'));

	const runEl = E('span', {
		style: 'margin-left:6px; font-size:0.9em; color:' + (running ? 'green' : 'gray')
	}, running ? _('running') : _('stopped'));

	const msgEl = E('span', { style: 'margin-left:8px; font-size:0.9em' }, '');
	const setMsg = (txt, color) => { msgEl.textContent = txt; msgEl.style.color = color || 'gray'; };

	const installBtn = E('button', {
		class: 'btn cbi-button cbi-button-action',
		style: 'margin-left:4px',
		disabled: !canInstall || null,
		title: canInstall ? '' : _('No supported package manager detected'),
		click: async function() {
			const prevInstalled = installed;
			const prevVersion   = version;
			installBtn.disabled = true;
			removeBtn.disabled  = true;
			statusEl.textContent = _('Installing...');
			statusEl.style.color = 'gray';

			const fail = (msg) => {
				installed = prevInstalled;
				version   = prevVersion;
				statusEl.textContent = installed ? (version ? 'v' + version : _('Installed')) : _('Not installed');
				statusEl.style.color = installed ? 'green' : 'gray';
				installBtn.disabled = false;
				removeBtn.disabled  = !installed;
				setMsg(msg, 'red');
			};

			setMsg(_('Checking requirements...'), 'gray');
			const prep = await L.resolveDefault(callByeDPIPrepareInstall(), {});
			if (prep.error) return fail(prep.error);

			setMsg(_('Downloading...'), 'gray');
			const dl = await L.resolveDefault(callCoreDownload(prep.dl_url, prep.tmp_path), {});
			if (!dl.result) return fail(dl.error || _('Download failed'));

			setMsg(_('Installing package...'), 'gray');
			const inst = await L.resolveDefault(callByeDPIInstallPkg(prep.tmp_path, prep.pkg_manager), {});
			if (!inst.result) return fail(inst.error || _('Installation failed'));

			const fresh = await L.resolveDefault(callByeDPIStatus(), {});
			installed = fresh.installed || false;
			version   = fresh.version   || null;
			statusEl.textContent = installed ? (version ? 'v' + version : _('Installed')) : _('Unknown');
			statusEl.style.color = installed ? 'green' : 'gray';
			installBtn.textContent = _('Update');
			installBtn.disabled = false;
			removeBtn.disabled  = false;
			setMsg(_('Installed successfully'), 'green');
		}
	}, [ installed ? _('Update') : _('Install') ]);

	const removeBtn = E('button', {
		class: 'btn cbi-button cbi-button-negative',
		style: 'margin-left:4px',
		disabled: !installed || isMainNode || null,
		title: isMainNode ? _('Cannot remove: ByeDPI is selected as Main Node. Change Main Node first.') : '',
		click: async function() {
			removeBtn.disabled  = true;
			installBtn.disabled = true;
			setMsg(_('Removing...'), 'gray');
			const ret = await L.resolveDefault(callByeDPIRemove(), {});
			installBtn.disabled = false;
			if (ret.result) {
				installed = false;
				version   = null;
				statusEl.textContent = _('Not installed');
				statusEl.style.color = 'gray';
				installBtn.textContent = _('Install');
				setMsg(_('Removed successfully'), 'green');
			} else {
				removeBtn.disabled = false;
				setMsg(ret.error || _('Removal failed'), 'red');
			}
		}
	}, [ _('Remove') ]);

	return E('div', { style: 'margin-bottom:12px; padding:8px 10px; border:1px solid #ddd; border-radius:4px' }, [
		E('div', { style: 'display:flex; align-items:center; flex-wrap:wrap; gap:6px' }, [
			E('strong', {}, 'ciadpi (ByeDPI)'),
			statusEl,
			runEl,
			installBtn,
			removeBtn,
			msgEl
		]),
		E('div', { style: 'margin-top:4px; font-size:0.9em; color:#666' },
			_('Local SOCKS5 DPI bypass proxy by <a href="https://github.com/hufrea/byedpi" target="_blank">hufrea</a>. ' +
			  'Packages by <a href="https://github.com/1andrevich/ByeDPI-OpenWrt" target="_blank">1andrevich/ByeDPI-OpenWrt</a>. ' +
			  'Configure in the Client → ByeDPI tab.'))
	]);
}

function buildZapretCard(zapret) {
	let installed = zapret?.installed || false;
	let version   = zapret?.version   || null;
	const running    = zapret?.running    || false;
	const pkgMgr     = zapret?.pkg_manager || null;
	let kmodOk       = (zapret?.kmod_ok != null) ? zapret.kmod_ok : true;
	const canInstall = !!pkgMgr;

	const statusEl = E('strong', {
		style: installed ? 'color:green' : 'color:gray'
	}, installed ? (version ? 'v' + version : _('Installed')) : _('Not installed'));

	const runEl = E('span', {
		style: 'margin-left:6px; font-size:0.9em; color:' + (running ? 'green' : 'gray')
	}, running ? _('running') : _('stopped'));

	const msgEl = E('span', { style: 'margin-left:8px; font-size:0.9em' }, '');
	const setMsg = (txt, color) => { msgEl.textContent = txt; msgEl.style.color = color || 'gray'; };

	const installBtn = E('button', {
		class: 'btn cbi-button cbi-button-action',
		style: 'margin-left:4px',
		disabled: !canInstall || null,
		title: canInstall ? '' : _('No supported package manager detected'),
		click: async function() {
			const prevInstalled = installed;
			const prevVersion   = version;
			installBtn.disabled = true;
			removeBtn.disabled  = true;
			statusEl.textContent = _('Installing...');
			statusEl.style.color = 'gray';

			const fail = (msg) => {
				installed = prevInstalled;
				version   = prevVersion;
				statusEl.textContent = installed ? (version ? 'v' + version : _('Installed')) : _('Not installed');
				statusEl.style.color = installed ? 'green' : 'gray';
				installBtn.disabled = false;
				removeBtn.disabled  = !installed;
				setMsg(msg, 'red');
			};

			setMsg(_('Checking requirements...'), 'gray');
			const prep = await L.resolveDefault(callZapretPrepareInstall(), {});
			if (prep.error) return fail(prep.error);

			setMsg(_('Downloading...'), 'gray');
			const dl = await L.resolveDefault(callCoreDownload(prep.dl_url, prep.tmp_path), {});
			if (!dl.result) return fail(dl.error || _('Download failed'));

			setMsg(_('Installing package...'), 'gray');
			const inst = await L.resolveDefault(callZapretInstallPkg(prep.tmp_path, prep.pkg_manager), {});
			if (!inst.result) return fail(inst.error || _('Installation failed'));

			const fresh = await L.resolveDefault(callZapretStatus(), {});
			installed = fresh.installed || false;
			version   = fresh.version   || null;
			kmodOk    = (fresh.kmod_ok != null) ? fresh.kmod_ok : true;
			statusEl.textContent = installed ? (version ? 'v' + version : _('Installed')) : _('Unknown');
			statusEl.style.color = installed ? 'green' : 'gray';
			installBtn.textContent = _('Update');
			installBtn.disabled = false;
			removeBtn.disabled  = false;
			if (installed && !kmodOk)
				setMsg(_('Installed, but kmod-nft-queue is missing — Zapret cannot intercept traffic without it.'), 'red');
			else
				setMsg(_('Installed successfully'), 'green');
		}
	}, [ installed ? _('Update') : _('Install') ]);

	const removeBtn = E('button', {
		class: 'btn cbi-button cbi-button-negative',
		style: 'margin-left:4px',
		disabled: !installed || null,
		click: async function() {
			removeBtn.disabled  = true;
			installBtn.disabled = true;
			setMsg(_('Removing...'), 'gray');
			const ret = await L.resolveDefault(callZapretRemove(), {});
			installBtn.disabled = false;
			if (ret.result) {
				installed = false;
				version   = null;
				statusEl.textContent = _('Not installed');
				statusEl.style.color = 'gray';
				installBtn.textContent = _('Install');
				setMsg(_('Removed successfully'), 'green');
			} else {
				removeBtn.disabled = false;
				setMsg(ret.error || _('Removal failed'), 'red');
			}
		}
	}, [ _('Remove') ]);

	/* nfqws2's NFQUEUE rule needs kmod-nft-queue; warn up-front if it's missing. */
	if (installed && !kmodOk)
		setMsg(_('Warning: kmod-nft-queue is not installed — Zapret cannot intercept traffic without it.'), 'red');

	return E('div', { style: 'margin-bottom:12px; padding:8px 10px; border:1px solid #ddd; border-radius:4px' }, [
		E('div', { style: 'display:flex; align-items:center; flex-wrap:wrap; gap:6px' }, [
			E('strong', {}, 'nfqws2 (Zapret 2)'),
			statusEl,
			runEl,
			installBtn,
			removeBtn,
			msgEl
		]),
		E('div', { style: 'margin-top:4px; font-size:0.9em; color:#666' },
			_('Packet-level (NFQUEUE) DPI bypass by <a href="https://github.com/bol-van/zapret2" target="_blank">bol-van</a> (nfqws2). ' +
			  'Packages by <a href="https://github.com/1andrevich/zapret2-openwrt" target="_blank">1andrevich/zapret2-openwrt</a>. ' +
			  'Configure in the Node Settings → Zapret tab.'))
	]);
}

function buildCurlCard(curl) {
	let installed = curl?.installed || false;
	const pkgMgr  = curl?.pkg_manager || null;
	const canInstall = !!pkgMgr;

	const statusEl = E('strong', {
		style: installed ? 'color:green' : 'color:gray'
	}, installed ? _('Installed') : _('Not installed'));

	const msgEl = E('span', { style: 'margin-left:8px; font-size:0.9em' }, '');
	const setMsg = (txt, color) => { msgEl.textContent = txt; msgEl.style.color = color || 'gray'; };

	const installBtn = E('button', {
		class: 'btn cbi-button cbi-button-action',
		style: 'margin-left:4px',
		disabled: !canInstall || null,
		title: canInstall ? '' : _('No supported package manager detected'),
		click: async function() {
			installBtn.disabled = true;
			removeBtn.disabled  = true;
			statusEl.textContent = _('Installing...');
			statusEl.style.color = 'gray';
			setMsg('', 'gray');
			const ret = await L.resolveDefault(callCurlInstall(), {});
			if (ret.result) {
				installed = true;
				statusEl.textContent = _('Installed');
				statusEl.style.color = 'green';
				installBtn.textContent = _('Reinstall');
				removeBtn.disabled  = false;
				setMsg(_('Installed successfully'), 'green');
			} else {
				statusEl.textContent = _('Not installed');
				statusEl.style.color = 'gray';
				installBtn.disabled = false;
				setMsg(ret.error || _('Installation failed'), 'red');
			}
		}
	}, [ _('Install') ]);

	const removeBtn = E('button', {
		class: 'btn cbi-button cbi-button-negative',
		style: 'margin-left:4px',
		disabled: !installed || null,
		click: async function() {
			removeBtn.disabled  = true;
			installBtn.disabled = true;
			setMsg(_('Removing...'), 'gray');
			const ret = await L.resolveDefault(callCurlRemove(), {});
			installBtn.disabled = false;
			if (ret.result) {
				installed = false;
				statusEl.textContent = _('Not installed');
				statusEl.style.color = 'gray';
				installBtn.textContent = _('Install');
				setMsg(_('Removed successfully'), 'green');
			} else {
				removeBtn.disabled = false;
				setMsg(ret.error || _('Removal failed'), 'red');
			}
		}
	}, [ _('Remove') ]);

	return E('div', { style: 'margin-bottom:12px; padding:8px 10px; border:1px solid #ddd; border-radius:4px' }, [
		E('div', { style: 'display:flex; align-items:center; flex-wrap:wrap; gap:6px' }, [
			E('strong', {}, 'curl'),
			statusEl,
			installBtn,
			removeBtn,
			msgEl
		]),
		E('div', { style: 'margin-top:4px; font-size:0.9em; color:#666' },
			_('Enables real HTTP-based ByeDPI strategy testing. Required for the "Test all strategies" feature in Client → ByeDPI tab.'))
	]);
}

function callCoreInfo() {
	return fs.exec_direct('/usr/bin/ucode', [CORE_MGMT, 'info'], 'json');
}

function callCoreCheckRemote(core) {
	return fs.exec_direct('/usr/bin/ucode', [CORE_MGMT, 'check_remote', core], 'json');
}

function callCorePrepare(core, variant) {
	return fs.exec_direct('/usr/bin/ucode', [CORE_MGMT, 'prepare_install', core, variant || ''], 'json');
}

function callCoreDownload(url, tmpPath) {
	return fs.exec_direct('/usr/bin/ucode', [CORE_MGMT, 'download_pkg', url, tmpPath], 'json');
}

function callCoreInstallPkg(core, tmpPath, pkgManager) {
	return fs.exec_direct('/usr/bin/ucode', [CORE_MGMT, 'install_pkg', core, tmpPath, pkgManager], 'json');
}

function callCoreInstallKmods(pkgManager) {
	return fs.exec_direct('/usr/bin/ucode', [CORE_MGMT, 'install_kmods', pkgManager], 'json');
}

function callCoreRemove(core) {
	return fs.exec_direct('/usr/bin/ucode', [CORE_MGMT, 'remove', core], 'json');
}

function buildCoreCard(core, coreInfo) {
	const isHiddify = core === 'hiddify';
	const name = isHiddify ? 'hiddify-core' : 'sing-box-extended';
	const pkgMgr = coreInfo.pkg_manager;
	const coreData = (isHiddify ? coreInfo.hiddify : coreInfo.singbox) || {};
	const canInstall = !!pkgMgr;

	const desc = isHiddify
		? _('hiddify-core with sing-box syntax compatibility. Supports Hiddify App protocols and advanced features. Best compatibility with Hiddify Manager protocols. Does not support AmneziaWG.')
		: _('Extended sing-box with additional protocols including AmneziaWG and TrustTunnel support. Created by shtorm-7.');

	let installed = coreData.installed || false;
	let version   = coreData.version   || null;

	const statusEl = E('strong', {
		style: installed ? 'color:green' : 'color:gray'
	}, installed ? 'v' + version : _('Not installed'));

	const msgEl = E('span', { style: 'margin-left:8px; font-size:0.9em' }, '');
	const setMsg = (txt, color) => { msgEl.textContent = txt; msgEl.style.color = color || 'gray'; };

	const remoteEl = E('span', { style: 'font-size:0.9em; color:gray' }, '');

	const checkBtn = E('button', {
		class: 'btn cbi-button',
		click: async function() {
			checkBtn.disabled = true;
			remoteEl.textContent = _('Checking...');
			remoteEl.style.color = 'gray';
			const ret = await L.resolveDefault(callCoreCheckRemote(core), {});
			checkBtn.disabled = false;
			if (ret.error) {
				remoteEl.textContent = ret.error;
				remoteEl.style.color = 'red';
			} else {
				remoteEl.textContent = _('Latest') + ': v' + ret.version;
				remoteEl.style.color = installed && version === ret.version ? 'green' : 'darkorange';
			}
		}
	}, [ _('Check update') ]);

	/* One smart Install: the backend auto-picks the build that fits this device's flash
	 * (and RAM for the compact one) — the user never sees "UPX" or has to choose. */
	const doInstall = async () => {
		const prevInstalled = installed;
		const prevVersion   = version;
		installBtn.disabled = true;
		removeBtn.disabled  = true;
		statusEl.textContent = _('Installing...');
		statusEl.style.color = 'gray';

		const fail = (msg) => {
			installed = prevInstalled;
			version   = prevVersion;
			statusEl.textContent = installed ? 'v' + (version || '?') : _('Not installed');
			statusEl.style.color = installed ? 'green' : 'gray';
			installBtn.disabled = false;
			removeBtn.disabled  = !installed;
			setMsg(msg, 'red');
		};

		setMsg(_('Checking requirements...'), 'gray');
		const prep = await L.resolveDefault(callCorePrepare(core, ''), {});
		if (prep.error) return fail(prep.error);

		const compact = (prep.variant === 'upx');
		setMsg(prep.note || _('Downloading...'), prep.note ? 'darkorange' : 'gray');
		const dl = await L.resolveDefault(callCoreDownload(prep.dl_url, prep.tmp_path), {});
		if (!dl.result) return fail(dl.error || _('Download failed'));

		setMsg(_('Installing package...'), 'gray');
		const inst = await L.resolveDefault(callCoreInstallPkg(core, prep.tmp_path, prep.pkg_manager), {});
		if (!inst.result) return fail(inst.error || _('Installation failed'));

		setMsg(_('Installing kernel modules...'), 'gray');
		await L.resolveDefault(callCoreInstallKmods(prep.pkg_manager), {});

		const fresh = await L.resolveDefault(callCoreInfo(), {});
		const fd = (isHiddify ? fresh.hiddify : fresh.singbox) || {};
		installed = fd.installed || false;
		version   = fd.version   || null;
		statusEl.textContent = installed ? 'v' + version : _('Unknown');
		statusEl.style.color = installed ? 'green' : 'gray';
		installBtn.textContent = _('Update');
		installBtn.disabled = false;
		removeBtn.disabled  = false;
		setMsg(compact ? _('Installed successfully (compact build)') : _('Installed successfully'), 'green');
	};

	const installBtn = E('button', {
		class: 'btn cbi-button cbi-button-action',
		style: 'margin-left:4px',
		disabled: !canInstall || null,
		title: canInstall ? '' : _('No supported package manager detected'),
		click: function() { return doInstall(); }
	}, [ installed ? _('Update') : _('Install') ]);

	const removeBtn = E('button', {
		class: 'btn cbi-button cbi-button-negative',
		style: 'margin-left:4px',
		disabled: !installed || null,
		click: async function() {
			removeBtn.disabled  = true;
			installBtn.disabled = true;
			setMsg(_('Removing...'), 'gray');

			const ret = await L.resolveDefault(callCoreRemove(core), {});

			installBtn.disabled = false;
			if (ret.result) {
				installed = false;
				version   = null;
				statusEl.textContent = _('Not installed');
				statusEl.style.color = 'gray';
				installBtn.textContent = _('Install');
				setMsg(_('Removed successfully'), 'green');
			} else {
				removeBtn.disabled = false;
				setMsg(ret.error || _('Removal failed'), 'red');
			}
		}
	}, [ _('Remove') ]);

	return E('div', { style: 'margin-bottom:12px; padding:8px 10px; border:1px solid #ddd; border-radius:4px' }, [
		E('div', { style: 'display:flex; align-items:center; flex-wrap:wrap; gap:6px' }, [
			E('strong', {}, name),
			statusEl,
			checkBtn,
			remoteEl,
			installBtn,
			removeBtn,
			msgEl
		]),
		E('div', { style: 'margin-top:4px; font-size:0.9em; color:#666' }, desc)
	]);
}

return view.extend({
	load() {
		return Promise.all([
			hp.getBuiltinFeatures(),
			L.resolveDefault(callCoreInfo(), {}),
			uci.load('homeproxy'),
			L.resolveDefault(callByeDPIStatus(), {}),
			L.resolveDefault(callCurlStatus(), {}),
			L.resolveDefault(callZapretStatus(), {})
		]);
	},

	render([features, coreInfo, _uci, byedpiStatus, curlStatus, zapretStatus]) {
		const routingMode = uci.get('homeproxy', 'config', 'routing_mode') || '';
		const isRuMode = routingMode === 'proxy_banned_ru';
		let m, s, o;

		m = new form.Map('homeproxy');

		s = m.section(form.NamedSection, 'config', 'homeproxy', _('Resources management'));
		s.anonymous = true;

		o = s.option(form.DummyValue, '_active_core', _('Active core'));
		const coreName = features.core_type === 'hiddify' ? 'hiddify-core' :
		                 features.core_type === 'singbox' ? 'sing-box' : null;
		const coreVer = features.version ? ' v' + features.version : '';
		const coreCustomSuffix = features.core_custom ? ' (custom)' : '';

		if (!features.core_type) {
			const callDetectCustomCore = rpc.declare({
				object: 'luci.homeproxy',
				method: 'detect_custom_core',
				params: ['path'],
				expect: { '': {} }
			});

			const savedPath = uci.get('homeproxy', 'config', 'custom_core_path') || '';
			const pathInput = E('input', {
				'type': 'text',
				'class': 'cbi-input-text',
				'value': savedPath,
				'placeholder': '/path/to/hiddify-core',
				'style': 'width:260px; margin-right:4px'
			});
			const detectMsg = E('span', { 'style': 'margin-left:8px; font-size:0.9em; color:gray' }, '');
			const detectBtn = E('button', {
				'class': 'btn cbi-button cbi-button-action',
				'click': async function() {
					const path = pathInput.value.trim();
					if (!path) return;
					detectBtn.disabled = true;
					detectMsg.textContent = _('Detecting...');
					detectMsg.style.color = 'gray';
					const ret = await L.resolveDefault(callDetectCustomCore(path), {});
					detectBtn.disabled = false;
					if (ret.result) {
						const typeName = ret.type === 'hiddify' ? 'hiddify-core' : 'sing-box';
						detectMsg.textContent = _('Detected') + ': ' + typeName + (ret.version ? ' v' + ret.version : '') + ' — ' + _('reload page to apply');
						detectMsg.style.color = 'green';
					} else {
						detectMsg.textContent = ret.error || _('Detection failed');
						detectMsg.style.color = 'red';
					}
				}
			}, [ _('Detect') ]);

			o.default = E('div', {}, [
				E('strong', { 'style': 'color:red' }, _('No core installed')),
				E('details', { 'style': 'margin-top:6px' }, [
					E('summary', { 'style': 'cursor:pointer; color:#666; font-size:0.9em' }, _('I have a custom core path')),
					E('div', { 'style': 'margin-top:6px' }, [ pathInput, detectBtn, detectMsg ])
				])
			]);
		} else {
			o.default = E('strong', { 'style': 'color:green' }, coreName + coreVer + coreCustomSuffix);
		}

		if (!isRuMode) {
			o = s.option(form.DummyValue, '_china_ip4_version', _('China IPv4 list version'));
			o.cfgvalue = L.bind(getResVersion, this, o, 'china_ip4');
			o.rawhtml = true;

			o = s.option(form.DummyValue, '_china_ip6_version', _('China IPv6 list version'));
			o.cfgvalue = L.bind(getResVersion, this, o, 'china_ip6');
			o.rawhtml = true;

			o = s.option(form.DummyValue, '_china_list_version', _('China list version'));
			o.cfgvalue = L.bind(getResVersion, this, o, 'china_list');
			o.rawhtml = true;

			o = s.option(form.DummyValue, '_gfw_list_version', _('GFW list version'));
			o.cfgvalue = L.bind(getResVersion, this, o, 'gfw_list');
			o.rawhtml = true;
		}


		if (!isRuMode) {
			o = s.option(form.Value, 'github_token', _('GitHub token'));
			o.password = true;
			o.renderWidget = function() {
				let node = form.Value.prototype.renderWidget.apply(this, arguments);

				(node.querySelector('.control-group') || node).appendChild(E('button', {
					'class': 'cbi-button cbi-button-apply',
					'title': _('Save'),
					'click': ui.createHandlerFn(this, () => {
						return this.map.save(null, true).then(() => {
							ui.changes.apply(true);
						});
					}, this.option)
				}, [ _('Save') ]));

				return node;
			}
		}

		s = m.section(form.NamedSection, 'config', 'homeproxy', _('Core management'));
		s.anonymous = true;

		o = s.option(form.DummyValue, '_core_env');
		const tmpMB     = coreInfo.tmp_free_kb     != null ? Math.round(coreInfo.tmp_free_kb     / 1024) : '?';
		const overlayMB = coreInfo.overlay_free_kb != null ? Math.round(coreInfo.overlay_free_kb / 1024) : '?';
		o.default = E('div', { style: 'font-size:0.9em; color:#555; padding:2px 0 6px' }, [
			_('Package manager') + ': ',
			E('strong', {}, coreInfo.pkg_manager || _('none detected')),
			E('span', { style: 'margin:0 8px' }, '|'),
			_('Architecture') + ': ',
			E('strong', {}, coreInfo.arch || '?'),
			E('span', { style: 'margin:0 8px' }, '|'),
			_('Free /tmp') + ': ',
			E('strong', {
				style: (coreInfo.tmp_free_kb != null && coreInfo.tmp_free_kb < 30720) ? 'color:red' : 'color:green'
			}, tmpMB + ' MB'),
			E('span', { style: 'margin:0 8px' }, '|'),
			_('Free overlay') + ': ',
			E('strong', {
				style: (coreInfo.overlay_free_kb != null && coreInfo.overlay_free_kb < 30720) ? 'color:red' : 'color:green'
			}, overlayMB + ' MB')
		]);

		o = s.option(form.DummyValue, '_core_hiddify');
		o.default = buildCoreCard('hiddify', coreInfo);

		o = s.option(form.DummyValue, '_core_singbox');
		o.default = buildCoreCard('singbox', coreInfo);

		s = m.section(form.NamedSection, 'config', 'homeproxy', _('AntiDPI'));
		s.anonymous = true;

		o = s.option(form.DummyValue, '_byedpi_card');
		o.default = buildByeDPICard(byedpiStatus, uci.get('homeproxy', 'config', 'main_node') === 'byedpi-out');

		o = s.option(form.DummyValue, '_curl_card', _('ByeDPI strategy tester'));
		o.default = buildCurlCard(curlStatus);

		o = s.option(form.DummyValue, '_zapret_card');
		o.default = buildZapretCard(zapretStatus);

		s = m.section(form.NamedSection, 'config', 'homeproxy');
		s.anonymous = true;

		o = s.option(form.DummyValue, '_homeproxy_logview');
		o.render = L.bind(getRuntimeLog, this, o, _('Re:HomeProxy'));

		o = s.option(form.DummyValue, '_hiddify-c_logview');
		o.render = L.bind(getRuntimeLog, this, o, _('core client'));

		return m.render();
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
