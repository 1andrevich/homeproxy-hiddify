/*
 * SPDX-License-Identifier: GPL-2.0-only
 *
 * Copyright (C) 2023-2025 ImmortalWrt.org
 */

'use strict';
'require dom';
'require homeproxy as hp';
'require poll';
'require rpc';
'require uci';
'require ui';
'require view';

const css = '\
.diag-section { margin-bottom: 1.5em; }\
.diag-row { display:flex; align-items:baseline; margin:.35em 0; gap:.6em; }\
.diag-label { min-width:11em; color:#666; font-size:.9em; flex-shrink:0; }\
.diag-ok   { color: #2a2; font-weight: bold; }\
.diag-fail { color: #c33; font-weight: bold; }\
.diag-warn { color: #c80; font-weight: bold; }\
.diag-gray { color: #888; }\
.diag-pre { font-family:monospace; font-size:.82em; background:#f5f5f5; border:1px solid #ddd;\
  padding:.5em .8em; white-space:pre-wrap; word-break:break-all; border-radius:3px;\
  margin:.3em 0 0; max-height:14em; overflow-y:auto; }\
.diag-input { padding:.25em .4em; border:1px solid #ccc; border-radius:3px;\
  font-size:.9em; width:14em; }\
.diag-btn { margin-right:.4em; }\
.diag-port-line { font-family:monospace; font-size:.82em; margin:.1em 0; }\
#diag-report-area { width:100%; height:22em; font-family:monospace; font-size:.8em;\
  white-space:pre; overflow:auto; background:#f5f5f5; border:1px solid #ddd; padding:.5em; }\
';

/* ── RPC declarations ─────────────────────────────────────────────────── */

const callCoreCheck = rpc.declare({
	object: 'luci.homeproxy',
	method: 'diag_core_check',
	expect: { '': {} }
});

const callConfigCheck = rpc.declare({
	object: 'luci.homeproxy',
	method: 'diag_config_check',
	expect: { '': {} }
});

const callDnsRu = rpc.declare({
	object: 'luci.homeproxy',
	method: 'diag_dns_ru',
	expect: { '': {} }
});

const callNftables = rpc.declare({
	object: 'luci.homeproxy',
	method: 'diag_nftables',
	expect: { '': {} }
});


const callReport = rpc.declare({
	object: 'luci.homeproxy',
	method: 'diag_report',
	expect: { '': {} }
});

const callServiceRestart = rpc.declare({
	object: 'luci.homeproxy',
	method: 'diag_service_restart',
	expect: { '': {} }
});

const callConnCheck = rpc.declare({
	object: 'luci.homeproxy',
	method: 'connection_check',
	params: ['site'],
	expect: { '': {} }
});

const callIpInfo = rpc.declare({
	object: 'luci.homeproxy',
	method: 'clash_ip_info',
	expect: { '': {} }
});

const callActiveNode = rpc.declare({
	object: 'luci.homeproxy',
	method: 'clash_active_node',
	expect: { '': {} }
});

/* Resolve a sing-box outbound tag (cfg-<section>-out) to its UCI label. */
function resolveTag(tag) {
	const m = tag && tag.match(/^cfg-(.+)-out$/);
	if (m) {
		const label = uci.get('homeproxy', m[1], 'label');
		if (label) return label;
	}
	return tag;
}

/* ── DOM helpers ──────────────────────────────────────────────────────── */

function statusBadge(ok, text) {
	/* ucode serialises booleans as integers 0/1 — use loose checks so both
	   JS booleans and integers work. null/undefined → "uncertain" (orange ?). */
	const isOk   = !!ok;
	const isWarn = ok == null;    /* catches null AND undefined */
	const icon   = isOk ? '✓ ' : isWarn ? '? ' : '✗ ';
	const cls    = isOk ? 'diag-ok' : isWarn ? 'diag-warn' : 'diag-fail';
	const label  = text || (isOk ? _('OK') : isWarn ? '?' : _('FAIL'));
	return E('strong', { 'class': cls }, icon + label);
}

function row(label, value) {
	return E('div', { 'class': 'diag-row' }, [
		E('span', { 'class': 'diag-label' }, label),
		E('span', {}, value)
	]);
}

function pre(text) {
	return E('div', { 'class': 'diag-pre' }, text || _('(empty)'));
}

function sectionCard(title, id, rows) {
	return E('div', { 'class': 'cbi-section diag-section' }, [
		E('h3', {}, title),
		E('div', { 'id': id }, rows)
	]);
}

function spinner(el, label) {
	dom.content(el, E('em', { 'class': 'diag-gray' }, label || _('Testing…')));
}

/* ── Section builders ─────────────────────────────────────────────────── */

function buildConnectivitySection(view, coreType) {
	const items = [];   /* manual checks; the section's run() fires them together */

	function siteRow(label, site) {
		const resultEl = E('strong', { 'class': 'diag-gray' }, _('unchecked'));
		function run() {
			dom.content(resultEl, E('em', { 'class': 'diag-gray' }, _('Testing…')));
			return L.resolveDefault(callConnCheck(site), {}).then(function(ret) {
				dom.content(resultEl, statusBadge(!!ret.result, ret.result ? _('passed') : _('failed')));
			});
		}
		items.push(run);
		const btn = E('button', { 'class': 'btn cbi-button cbi-button-action diag-btn',
			'click': ui.createHandlerFn(view, run) }, [ _('Check') ]);
		return E('div', { 'class': 'diag-row' }, [ E('span', { 'class': 'diag-label' }, label), btn, resultEl ]);
	}

	/* Exit IP / geo — only hiddify-core's Clash API reports it. */
	function ipRow(label, type) {
		const resultEl = E('strong', { 'class': 'diag-gray' }, _('unchecked'));
		function run() {
			dom.content(resultEl, E('em', { 'class': 'diag-gray' }, _('Testing…')));
			return L.resolveDefault(callIpInfo(), {}).then(function(ret) {
				if (ret.error) { dom.content(resultEl, E('span', { 'class': 'diag-fail' }, ret.error)); return; }
				const entry = ret[type];
				if (!entry || !entry.ip) { dom.content(resultEl, E('span', { 'class': 'diag-gray' }, _('No data'))); return; }
				const meta  = [entry.country, entry.org].filter(Boolean).join(', ');
				const delay = (entry.delay && entry.delay !== 65535) ? ' — ' + entry.delay + ' ms' : '';
				const node  = (type === 'proxy' && entry.node) ? resolveTag(entry.node) + ': ' : '';
				dom.content(resultEl, E('strong', { 'class': 'diag-ok' },
					node + entry.ip + (meta ? ' (' + meta + ')' : '') + delay));
			});
		}
		items.push(run);
		const btn = E('button', { 'class': 'btn cbi-button cbi-button-action diag-btn',
			'click': ui.createHandlerFn(view, run) }, [ _('Check') ]);
		return E('div', { 'class': 'diag-row' }, [ E('span', { 'class': 'diag-label' }, label), btn, resultEl ]);
	}

	/* Active node — live status (which node sing-box has selected), auto-updating;
	 * sing-box can't report exit IP, so this stands in for the IP rows. */
	function activeNodeRow() {
		const resultEl = E('span', { 'class': 'diag-gray' }, '—');
		poll.add(L.bind(function() {
			return L.resolveDefault(callActiveNode(), {}).then(function(ret) {
				if (ret && !ret.error && ret.node) {
					const type  = ret.type ? ' (' + ret.type + ')' : '';
					const delay = (ret.delay && ret.delay !== 65535) ? ' — ' + ret.delay + ' ms' : '';
					dom.content(resultEl, E('strong', { 'class': 'diag-ok' }, resolveTag(ret.node) + type + delay));
				} else {
					dom.content(resultEl, E('span', { 'class': 'diag-gray' }, _('No active node')));
				}
			});
		}));
		return E('div', { 'class': 'diag-row' }, [ E('span', { 'class': 'diag-label' }, _('Active Node')), resultEl ]);
	}

	const rows = [
		siteRow(_('Baidu'),     'baidu'),
		siteRow(_('Google'),    'google'),
		siteRow(_('YouTube'),   'youtube'),
		siteRow(_('Yandex'),    'yandex'),
		siteRow(_('Speedtest'), 'speedtest')
	];

	/* hiddify → exit-IP rows; sing-box → live Active Node (it can't report exit IP). */
	if (coreType === 'hiddify') {
		rows.push(ipRow(_('Direct IP'), 'direct'));
		rows.push(ipRow(_('Proxy IP'),  'proxy'));
	} else if (coreType === 'singbox') {
		rows.push(activeNodeRow());
	}

	return {
		el: sectionCard(_('Connectivity'), 'diag-connectivity', rows),
		run: function() { return Promise.all(items.map(function(fn) { return fn(); })); }
	};
}

function buildCoreSection(view) {
	const resultsEl   = E('div', {});
	const restartMsgEl = E('span', { 'class': 'diag-gray', 'style': 'font-size:.9em' });

	function run() {
		spinner(resultsEl, _('Checking core…'));
		return L.resolveDefault(callCoreCheck(), {}).then(function(ret) {
			if (!ret || ret.error) {
				dom.content(resultsEl, E('span', { 'class': 'diag-fail' }, ret ? ret.error : _('RPC error')));
				return;
			}

			const portLines = (ret.listen_ports && ret.listen_ports.length)
				? ret.listen_ports.map(function(l) { return E('div', { 'class': 'diag-port-line' }, l); })
				: [ E('em', { 'class': 'diag-gray' }, _('none detected')) ];

			dom.content(resultsEl, [
				row(_('Hiddify-core'),    statusBadge(ret.hiddify_installed, ret.hiddify_installed ? _('installed') : _('not found'))),
				row(_('sing-box'),        statusBadge(ret.singbox_installed,  ret.singbox_installed  ? _('installed') : _('not found'))),
				row(_('ByeDPI'),          statusBadge(ret.byedpi_installed,   ret.byedpi_installed   ? _('installed') : _('not found'))),
				ret.binary ? row(_('Active binary'), E('code', {}, ret.binary)) : null,
				ret.version ? row(_('Version'), E('span', { 'class': 'diag-pre', 'style': 'max-height:5em' }, ret.version)) : null,
				row(_('Running'),         statusBadge(ret.running, ret.running ? _('yes') + (ret.pid ? ' (PID ' + ret.pid + ')' : '') : _('no'))),
				ret.byedpi_installed ? row(_('ByeDPI running'), statusBadge(ret.byedpi_running, ret.byedpi_running ? _('yes') + (ret.byedpi_pid ? ' (PID ' + ret.byedpi_pid + ')' : '') : _('no'))) : null,
				row(_('Listening ports'), E('div', {}, portLines))
			].filter(Boolean));
		});
	}

	function restart() {
		dom.content(restartMsgEl, E('em', { 'class': 'diag-gray' }, _('Restarting… (may take ~5 s)')));
		return L.resolveDefault(callServiceRestart(), {}).then(function(ret) {
			if (ret && ret.result) {
				dom.content(restartMsgEl, statusBadge(true, _('Service restarted')));
				/* Refresh core status after restart */
				return run();
			} else {
				dom.content(restartMsgEl, statusBadge(false,
					_('Restart failed') + (ret && ret.exit_code != null ? ' (exit ' + ret.exit_code + ')' : '')));
			}
		});
	}

	return {
		el: sectionCard(_('Core & System'), 'diag-core', [
			E('div', { 'class': 'diag-row' }, [
				E('button', {
					'class': 'btn cbi-button cbi-button-action diag-btn',
					'click': ui.createHandlerFn(view, run)
				}, _('Check')),
				E('button', {
					'class': 'btn cbi-button cbi-button-negative diag-btn',
					'click': ui.createHandlerFn(view, restart)
				}, _('Restart Service')),
				restartMsgEl
			]),
			resultsEl
		]),
		run: run
	};
}

function buildConfigSection(view) {
	const resultsEl = E('div', {});

	function run() {
		spinner(resultsEl, _('Checking config…'));
		return L.resolveDefault(callConfigCheck(), {}).then(function(ret) {
			if (!ret || ret.error) {
				dom.content(resultsEl, E('span', { 'class': 'diag-fail' }, ret ? ret.error : _('RPC error')));
				return;
			}

			dom.content(resultsEl, [
				row(_('Valid'),       statusBadge(ret.valid)),
				ret.size_bytes != null ? row(_('Size'), (ret.size_bytes / 1024).toFixed(1) + ' KB') : null,
				ret.stats ? row(_('Inbounds'),    String(ret.stats.inbounds)) : null,
				ret.stats ? row(_('Outbounds'),   String(ret.stats.outbounds)) : null,
				ret.stats ? row(_('Rules'),       String(ret.stats.rules)) : null,
				ret.stats ? row(_('DNS servers'), String(ret.stats.dns_servers)) : null,
				ret.check_output ? E('div', {}, [
					E('div', { 'class': 'diag-label' }, _('Check output')),
					pre(ret.check_output)
				]) : null
			].filter(Boolean));
		});
	}

	return {
		el: sectionCard(_('Configuration'), 'diag-config', [
			E('div', { 'class': 'diag-row' }, [
				E('button', {
					'class': 'btn cbi-button cbi-button-action diag-btn',
					'click': ui.createHandlerFn(view, run)
				}, _('Check'))
			]),
			resultsEl
		]),
		run: run
	};
}

function buildDnsSection(view) {
	const resultsEl = E('div', {});

	const cardEl = sectionCard(_('DNS Tests'), 'diag-dns', [
		E('div', { 'class': 'diag-row' }, [
			E('button', {
				'class': 'btn cbi-button cbi-button-action diag-btn',
				'click': ui.createHandlerFn(view, run)
			}, _('Test'))
		]),
		resultsEl
	]);
	cardEl.style.display = 'none';

	function run() {
		spinner(resultsEl, _('Testing DNS…'));
		return L.resolveDefault(callDnsRu(), {}).then(function(ret) {
			if (ret.skip) {
				cardEl.style.display = 'none';
				return;
			}
			cardEl.style.display = '';
			if (ret.error) {
				dom.content(resultsEl, E('span', { 'class': 'diag-fail' }, ret.error));
				return;
			}

			dom.content(resultsEl, [
				E('div', { 'style': 'font-weight:bold; margin:.4em 0 .2em' }, _('Russia DNS')),
				row(_('Server'), E('code', {}, ret.russia_server || '?')),
				row('mail.ru', statusBadge(ret.russia_ok,
					ret.russia_ok ? _('Resolved') : _('No answer — check server address'))),
				ret.russia_output ? E('div', {}, [
					E('div', { 'class': 'diag-label' }, 'nslookup mail.ru'),
					pre(ret.russia_output)
				]) : null,

				E('div', { 'style': 'font-weight:bold; margin:.8em 0 .2em' }, _('Secure DNS')),
				ret.secure_server ? row(_('Server'), E('code', {}, ret.secure_server)) : null,
				row(_('Bootstrap'), E('code', {}, ret.bootstrap || '?')),
				row('andrevi.ch', statusBadge(ret.secure_ok,
					ret.secure_ok ? _('Resolved via proxy') : _('No answer — check proxy and proxy list'))),
				ret.secure_output ? E('div', {}, [
					E('div', { 'class': 'diag-label' }, 'nslookup andrevi.ch'),
					pre(ret.secure_output)
				]) : null
			].filter(Boolean));
		});
	}

	return { el: cardEl, run: run };
}

function buildNftSection(view) {
	const resultsEl = E('div', {});

	function run() {
		spinner(resultsEl, _('Reading nftables…'));
		return L.resolveDefault(callNftables(), {}).then(function(ret) {
			if (ret.error) {
				dom.content(resultsEl, E('span', { 'class': 'diag-fail' }, ret.error));
				return;
			}

			dom.content(resultsEl, [
				row(_('Re:HomeProxy chains'), statusBadge(ret.nft_present,
				    ret.nft_present ? _('found') : _('not found — firewall rules may be missing'))),
				ret.nft_rules ? E('div', {}, [
					E('div', { 'class': 'diag-label' }, _('Matched lines in fw4')),
					pre(ret.nft_rules)
				]) : null,
				ret.uci_firewall ? E('div', {}, [
					E('div', { 'class': 'diag-label' }, _('UCI firewall settings')),
					pre(ret.uci_firewall)
				]) : null
			].filter(Boolean));
		});
	}

	return {
		el: sectionCard(_('Network Intercept'), 'diag-nft', [
			E('div', { 'class': 'diag-row' }, [
				E('button', {
					'class': 'btn cbi-button cbi-button-action diag-btn',
					'click': ui.createHandlerFn(view, run)
				}, _('Check'))
			]),
			resultsEl
		]),
		run: run
	};
}


function buildReportSection(view) {
	const textArea = E('textarea', {
		'id': 'diag-report-area',
		'readonly': true,
		'placeholder': _('Click Generate to collect diagnostics…')
	});

	function run() {
		textArea.value = _('Collecting diagnostics — this may take a few seconds…');
		return L.resolveDefault(callReport(), {}).then(function(ret) {
			textArea.value = ret.report || _('(empty)');
		});
	}

	function copy() {
		textArea.select();
		document.execCommand('copy');
	}

	function download() {
		const text = textArea.value;
		if (!text || text === _('Click Generate to collect diagnostics…')) return;
		const now = new Date();
		const pad = (n) => String(n).padStart(2, '0');
		const stamp = now.getFullYear() + '-' + pad(now.getMonth()+1) + '-' + pad(now.getDate()) +
		              '_' + pad(now.getHours()) + '-' + pad(now.getMinutes()) + '-' + pad(now.getSeconds());
		const blob = new Blob([text], { type: 'text/plain' });
		const url  = URL.createObjectURL(blob);
		const a    = E('a', { href: url, download: 'homeproxy-diagnostics-' + stamp + '.txt' });
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	}

	return {
		el: sectionCard(_('Diagnostics Report'), 'diag-report', [
			E('div', { 'class': 'diag-row' }, [
				E('button', {
					'class': 'btn cbi-button cbi-button-action diag-btn',
					'click': ui.createHandlerFn(view, run)
				}, _('Generate')),
				E('button', {
					'class': 'btn cbi-button diag-btn',
					'click': ui.createHandlerFn(view, copy)
				}, _('Copy')),
				E('button', {
					'class': 'btn cbi-button diag-btn',
					'click': ui.createHandlerFn(view, download)
				}, _('Download')),
				E('em', { 'class': 'diag-gray', 'style': 'font-size:.85em' },
					_('Sensitive values (passwords, keys, UUIDs) are redacted.'))
			]),
			textArea
		])
	};
}

/* ── View ─────────────────────────────────────────────────────────────── */

return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(hp.getBuiltinFeatures(), {}),
			uci.load('homeproxy')
		]);
	},

	render: function(data) {
		const features = (data && data[0]) || {};
		document.head.appendChild(E('style', {}, [ css ]));

		const core   = buildCoreSection(this);
		const config = buildConfigSection(this);
		const dns    = buildDnsSection(this);
		const nft    = buildNftSection(this);
		const conn   = buildConnectivitySection(this, features.core_type || null);
		const report = buildReportSection(this);

		dns.run();

		const runAll = ui.createHandlerFn(this, function() {
			return Promise.all([
				core.run(),
				config.run(),
				nft.run(),
				conn.run()
			]);
		});

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('Re:HomeProxy Diagnostics')),
			E('div', { 'class': 'cbi-section', 'style': 'padding-bottom:.5em' }, [
				E('button', {
					'class': 'btn cbi-button cbi-button-action important',
					'click': runAll
				}, _('Run All Tests')),
				E('em', { 'class': 'diag-gray', 'style': 'margin-left:.8em; font-size:.9em' },
					_('Runs Core, Config, Network, and Connectivity checks simultaneously.'))
			]),
			core.el,
			config.el,
			dns.el,
			nft.el,
			conn.el,
			report.el
		]);
	},

	handleSaveApply: null,
	handleSave:      null,
	handleReset:     null
});
