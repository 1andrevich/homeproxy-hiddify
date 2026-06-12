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

function getActiveNode(o) {
	const callActiveNode = rpc.declare({
		object: 'luci.homeproxy',
		method: 'clash_active_node',
		expect: { '': {} }
	});

	const el = E('span', { 'style': 'color:gray' }, '—');

	poll.add(L.bind(() => {
		return L.resolveDefault(callActiveNode(), {}).then((ret) => {
			if (ret.error) {
				dom.content(el, E('span', { 'style': 'color:red' }, ret.error));
				return;
			}
			if (!ret.node) {
				dom.content(el, E('span', { 'style': 'color:gray' }, _('No active node')));
				return;
			}
			const name  = resolveTag(ret.node);
			const type  = ret.type  ? ` (${ret.type})`  : '';
			const delay = (ret.delay && ret.delay !== 65535) ? ` — ${ret.delay} ms` : '';
			dom.content(el, E('strong', { 'style': 'color:green' }, `${name}${type}${delay}`));
		});
	}));

	o.default = el;
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

function callCoreInfo() {
	return fs.exec_direct('/usr/bin/ucode', [CORE_MGMT, 'info'], 'json');
}

function callCoreCheckRemote(core) {
	return fs.exec_direct('/usr/bin/ucode', [CORE_MGMT, 'check_remote', core], 'json');
}

function callCorePrepare(core) {
	return fs.exec_direct('/usr/bin/ucode', [CORE_MGMT, 'prepare_install', core], 'json');
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
		? _('hiddify-core with sing-box syntax compatibility. Supports Hiddify App protocols and advanced features. Best compatibility with Hiddify Manager protocols.')
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
				statusEl.textContent = installed ? 'v' + (version || '?') : _('Not installed');
				statusEl.style.color = installed ? 'green' : 'gray';
				installBtn.disabled = false;
				removeBtn.disabled  = !installed;
				setMsg(msg, 'red');
			};

			setMsg(_('Checking requirements...'), 'gray');
			const prep = await L.resolveDefault(callCorePrepare(core), {});
			if (prep.error) return fail(prep.error);

			setMsg(_('Downloading...'), 'gray');
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
			uci.load('homeproxy')
		]);
	},

	render([features, coreInfo]) {
		const routingMode = uci.get('homeproxy', 'config', 'routing_mode') || '';
		const isRuMode = routingMode === 'proxy_banned_ru';
		let m, s, o;

		m = new form.Map('homeproxy');

		s = m.section(form.NamedSection, 'config', 'homeproxy', _('Connection check'));
		s.anonymous = true;

		o = s.option(form.DummyValue, '_check_baidu', _('BaiDu'));
		o.cfgvalue = L.bind(getConnStat, this, o, 'baidu');

		o = s.option(form.DummyValue, '_check_google', _('Google'));
		o.cfgvalue = L.bind(getConnStat, this, o, 'google');

		o = s.option(form.DummyValue, '_check_youtube', _('YouTube'));
		o.cfgvalue = L.bind(getConnStat, this, o, 'youtube');

		o = s.option(form.DummyValue, '_check_yandex', _('Yandex'));
		o.cfgvalue = L.bind(getConnStat, this, o, 'yandex');

		o = s.option(form.DummyValue, '_check_speedtest', _('Speedtest'));
		o.cfgvalue = L.bind(getConnStat, this, o, 'speedtest');

		if (features.core_type === 'hiddify') {
			o = s.option(form.DummyValue, '_check_direct_ip', _('Direct IP'));
			o.cfgvalue = L.bind(getIPInfo, this, o, 'direct');

			o = s.option(form.DummyValue, '_check_proxy_ip', _('Proxy IP'));
			o.cfgvalue = L.bind(getIPInfo, this, o, 'proxy');
		}

		if (features.core_type === 'singbox') {
			o = s.option(form.DummyValue, '_active_node', _('Active Node'));
			o.cfgvalue = L.bind(getActiveNode, this, o);
		}

		s = m.section(form.NamedSection, 'config', 'homeproxy', _('Resources management'));
		s.anonymous = true;

		o = s.option(form.DummyValue, '_active_core', _('Active core'));
		const coreName = features.core_type === 'hiddify' ? 'hiddify-core' :
		                 features.core_type === 'singbox' ? 'sing-box' : null;
		const coreVer = features.version ? ' v' + features.version : '';
		o.default = coreName
			? E('strong', { 'style': 'color:green' }, coreName + coreVer)
			: E('strong', { 'style': 'color:red' }, _('No core installed'));

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

		s = m.section(form.NamedSection, 'config', 'homeproxy');
		s.anonymous = true;

		o = s.option(form.DummyValue, '_homeproxy_logview');
		o.render = L.bind(getRuntimeLog, this, o, _('HomeProxy'));

		o = s.option(form.DummyValue, '_hiddify-c_logview');
		o.render = L.bind(getRuntimeLog, this, o, _('core client'));

		return m.render();
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
