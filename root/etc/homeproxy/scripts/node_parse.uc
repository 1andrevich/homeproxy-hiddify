/*
 * SPDX-License-Identifier: GPL-2.0-only
 *
 * Shared share-link parser: turns a single proxy share-link (vless://, vmess://,
 * trojan://, ss://, hysteria://, hysteria2://, tuic://, …) into a homeproxy node
 * config object. Extracted verbatim from update_subscriptions.uc so the
 * subscription importer AND the standalone link importer (import_link.uc) use one
 * implementation. `log` is an injected callback (no-op by default) so callers can
 * route diagnostics where they like.
 */
'use strict';

import { urldecode, urlencode, urldecode_params } from 'luci.http';
import { parseURL, decodeBase64Str, validation, isEmpty } from 'homeproxy';
import { connect } from 'ubus';
const sing_features = connect().call('luci.homeproxy', 'singbox_get_features', {}) || {};

export function parse_uri(uri, log) {
	if (type(log) != 'function') log = function() {};
	let config, url, params;

	if (type(uri) === 'object') {
		if (uri.nodetype === 'sip008') {
			/* https://shadowsocks.org/guide/sip008.html */
			config = {
				label: uri.remarks,
				type: 'shadowsocks',
				address: uri.server,
				port: uri.server_port,
				shadowsocks_encrypt_method: uri.method,
				password: uri.password,
				shadowsocks_plugin: uri.plugin,
				shadowsocks_plugin_opts: uri.plugin_opts
			};
		} else {
			/* Pre-parsed sing-box JSON outbound from parse_singbox_outbound() */
			config = uri;
		}
	} else if (type(uri) === 'string') {
		uri = split(trim(uri), '://');

		switch (uri[0]) {
		case 'anytls':
			/* https://github.com/anytls/anytls-go/blob/v0.0.8/docs/uri_scheme.md */
			url = parseURL('http://' + uri[1]) || {};
			params = url.searchParams || {};

			config = {
				label: url.hash ? urldecode(url.hash) : null,
				type: 'anytls',
				address: url.hostname,
				port: url.port,
				password: urldecode(url.username),
				tls: '1',
				tls_sni: params.sni,
				tls_insecure: (params.insecure === '1') ? '1' : '0'
			};

			break;
		case 'http':
		case 'https':
			url = parseURL('http://' + uri[1]) || {};

			config = {
				label: url.hash ? urldecode(url.hash) : null,
				type: 'http',
				address: url.hostname,
				port: url.port,
				username: url.username ? urldecode(url.username) : null,
				password: url.password ? urldecode(url.password) : null,
				tls: (uri[0] === 'https') ? '1' : '0'
			};

			break;
		case 'hysteria':
			/* https://github.com/HyNetwork/hysteria/wiki/URI-Scheme */
			url = parseURL('http://' + uri[1]) || {};
			params = url.searchParams || {};

			if (!sing_features.with_quic || (params.protocol && params.protocol !== 'udp')) {
				log(sprintf('Skipping unsupported %s node: %s.', uri[0], urldecode(url.hash) || url.hostname));
				if (!sing_features.with_quic)
					log(sprintf('Please rebuild sing-box with %s support!', 'QUIC'));

				return null;
			}

			config = {
				label: url.hash ? urldecode(url.hash) : null,
				type: 'hysteria',
				address: url.hostname,
				port: url.port,
				hysteria_protocol: params.protocol || 'udp',
				hysteria_auth_type: params.auth ? 'string' : null,
				hysteria_auth_payload: params.auth,
				hysteria_obfs_password: params.obfsParam,
				hysteria_down_mbps: params.downmbps,
				hysteria_up_mbps: params.upmbps,
				tls: '1',
				tls_insecure: (params.insecure in ['true', '1']) ? '1' : '0',
				tls_sni: params.peer,
				tls_alpn: params.alpn
			};

			break;
		case 'hysteria2':
		case 'hy2':
			/* https://v2.hysteria.network/docs/developers/URI-Scheme/ */
			url = parseURL('http://' + uri[1]) || {};
			params = url.searchParams || {};

			if (!sing_features.with_quic) {
				log(sprintf('Skipping unsupported %s node: %s.', uri[0], urldecode(url.hash) || url.hostname));
				log(sprintf('Please rebuild sing-box with %s support!', 'QUIC'));
				return null;
			}

			config = {
				label: url.hash ? urldecode(url.hash) : null,
				type: 'hysteria2',
				address: url.hostname,
				port: url.port,
				password: url.username ? (
					urldecode(url.username + (url.password ? (':' + url.password) : ''))
				) : null,
				hysteria_obfs_type: params.obfs,
				hysteria_obfs_password: params['obfs-password'],
				tls: '1',
				tls_insecure: (params.insecure === '1') ? '1' : '0',
				tls_sni: params.sni
			};

			break;
		case 'naive':
		case 'naive+http':
		case 'naive+https':
			url = parseURL('http://' + uri[1]) || {};
			params = url.searchParams || {};

			let naive_extra_headers = null;
			if (params.header) {
				const hdr = split(params.header, ':', 2);
				if (length(hdr) === 2) {
					let hdrs = {};
					hdrs[trim(hdr[0])] = trim(hdr[1]);
					naive_extra_headers = sprintf('%J', hdrs);
				}
			}

			config = {
				label: url.hash ? urldecode(url.hash) : null,
				type: 'naive',
				address: url.hostname,
				port: url.port,
				username: url.username ? urldecode(url.username) : null,
				password: url.password ? urldecode(url.password) : null,
				tls: (uri[0] === 'naive+https' || params.security === 'tls') ? '1' : '0',
				tls_sni: params.sni || url.hostname,
				naive_udp_over_tcp: (params.uot === '1') ? '1' : null,
				naive_quic: (params.quic === '1') ? '1' : null,
				naive_extra_headers: naive_extra_headers
			};

			break;
		case 'socks':
		case 'socks4':
		case 'socks4a':
		case 'socsk5':
		case 'socks5h':
			url = parseURL('http://' + uri[1]) || {};

			config = {
				label: url.hash ? urldecode(url.hash) : null,
				type: 'socks',
				address: url.hostname,
				port: url.port,
				username: url.username ? urldecode(url.username) : null,
				password: url.password ? urldecode(url.password) : null,
				socks_version: (match(uri[0], /4/)) ? '4' : '5'
			};

			break;
		case 'ss':
			/* "Lovely" Shadowrocket format */
			const ss_suri = split(uri[1], '#');
			let ss_slabel = '';
			if (length(ss_suri) <= 2) {
				if (length(ss_suri) === 2)
					ss_slabel = '#' + urlencode(ss_suri[1]);
				if (decodeBase64Str(ss_suri[0]))
					uri[1] = decodeBase64Str(ss_suri[0]) + ss_slabel;
			}

			/* Legacy format is not supported, it should be never appeared in modern subscriptions */
			/* https://github.com/shadowsocks/shadowsocks-org/commit/78ca46cd6859a4e9475953ed34a2d301454f579e */

			/* SIP002 format https://shadowsocks.org/guide/sip002.html */
			url = parseURL('http://' + uri[1]) || {};

			let ss_userinfo = {};
			if (url.username && url.password)
				/* User info encoded with URIComponent */
				ss_userinfo = [url.username, urldecode(url.password)];
			else if (url.username)
				/* User info encoded with base64 */
				ss_userinfo = split(decodeBase64Str(urldecode(url.username)), ':', 2);

			let ss_plugin, ss_plugin_opts;
			if (url.search && url.searchParams.plugin) {
				const ss_plugin_info = split(url.searchParams.plugin, ';', 2);
				ss_plugin = ss_plugin_info[0];
				if (ss_plugin === 'simple-obfs')
					/* Fix non-standard plugin name */
					ss_plugin = 'obfs-local';
				ss_plugin_opts = ss_plugin_info[1];
			}

			config = {
				label: url.hash ? urldecode(url.hash) : null,
				type: 'shadowsocks',
				address: url.hostname,
				port: url.port,
				shadowsocks_encrypt_method: ss_userinfo[0],
				password: ss_userinfo[1],
				shadowsocks_plugin: ss_plugin,
				shadowsocks_plugin_opts: ss_plugin_opts
			};

			break;
		case 'shadowtls':
			/* shadowtls://STLS_PASS@HOST:PORT?version=V&sni=SNI&fp=FP&method=SS_METHOD&password=SS_PASS#Label
			 * Represents a Shadowsocks 2022 connection wrapped in ShadowTLS transport. */
			url = parseURL('http://' + uri[1]) || {};
			params = url.searchParams || {};

			config = {
				label: url.hash ? urldecode(url.hash) : null,
				type: 'shadowsocks',
				address: url.hostname,
				port: url.port,
				shadowsocks_encrypt_method: params.method || '2022-blake3-aes-256-gcm',
				password: params.password ? urldecode(params.password) : null,
				shadowtls_enabled: '1',
				shadowtls_password: url.username ? urldecode(url.username) : null,
				shadowtls_version: params.version || '3',
				tls_sni: params.sni || null,
				tls_utls: params.fp || null
			};

			break;
		case 'ssh':
			/* Manual parse to avoid parseURL corruption on long base64 query values */
			let ssh_str = trim(uri[1]);
			let ssh_label = null;

			const ssh_hash_idx = index(ssh_str, '#');
			if (ssh_hash_idx >= 0) {
				ssh_label = urldecode(substr(ssh_str, ssh_hash_idx + 1));
				ssh_str = substr(ssh_str, 0, ssh_hash_idx);
			}

			let ssh_params = {};
			const ssh_q = index(ssh_str, '?');
			if (ssh_q >= 0) {
				ssh_params = urldecode_params(substr(ssh_str, ssh_q + 1)) || {};
				ssh_str = substr(ssh_str, 0, ssh_q);
			}
			ssh_str = replace(ssh_str, /\/+$/, '');

			const ssh_at = index(ssh_str, '@');
			let ssh_user = null, ssh_pass = null, ssh_host = null, ssh_port = null;
			if (ssh_at >= 0) {
				const ssh_userinfo = substr(ssh_str, 0, ssh_at);
				const ssh_hostport = substr(ssh_str, ssh_at + 1);
				const ssh_colon = index(ssh_userinfo, ':');
				if (ssh_colon >= 0) {
					ssh_user = urldecode(substr(ssh_userinfo, 0, ssh_colon));
					ssh_pass = urldecode(substr(ssh_userinfo, ssh_colon + 1));
				} else {
					ssh_user = urldecode(ssh_userinfo);
				}
				const ssh_hp = split(ssh_hostport, ':');
				ssh_port = pop(ssh_hp);
				ssh_host = join(':', ssh_hp) || null;
			}

			let ssh_host_key = null;
			/* Hiddify: hk=key1\n,key2\n,key3\n — urldecode_params already decodes values */
			const raw_hk = ssh_params.hk || ssh_params.host_key || ssh_params.hostKey;
			if (raw_hk) {
				const ssh_hk_lines = filter(split(raw_hk, ','), (l) => length(trim(l)) > 0);
				ssh_host_key = length(ssh_hk_lines) ? ssh_hk_lines : null;
			}

			config = {
				label: ssh_label,
				type: 'ssh',
				address: ssh_host,
				port: ssh_port,
				username: ssh_user,
				password: length(ssh_pass) ? ssh_pass : null,
				/* Hiddify uses pk= (short) or private_key= ; urldecode_params already decoded */
				ssh_priv_key: ssh_params.pk || ssh_params.private_key || ssh_params.privateKey || null,
				ssh_priv_key_pp: length(ssh_params.passphrase) ? ssh_params.passphrase : null,
				ssh_host_key: ssh_host_key,
				/* Hiddify always enables udp_over_tcp for SSH; only disable if explicitly set to 0 */
				ssh_udp_over_tcp: (ssh_params.uot === '0' || ssh_params.udp_over_tcp in ['0', 'false']) ? null : '1'
			};

			break;
		case 'trojan':
			/* https://p4gefau1t.github.io/trojan-go/developer/url/ */
			url = parseURL('http://' + uri[1]) || {};
			params = url.searchParams || {};

			config = {
				label: url.hash ? urldecode(url.hash) : null,
				type: 'trojan',
				address: url.hostname,
				port: url.port,
				password: urldecode(url.username),
				transport: (params.type && params.type !== 'tcp') ? params.type : null,
				tls: '1',
				tls_sni: params.sni,
				tls_alpn: params.alpn ? split(urldecode(params.alpn), ',') : null,
				tls_reality: (params.security === 'reality') ? '1' : '0',
				tls_reality_public_key: params.pbk ? urldecode(params.pbk) : null,
				tls_reality_short_id: params.sid,
				tls_utls: sing_features.with_utls ? params.fp : null
			};
			switch(params.type) {
			case 'grpc':
				config.grpc_servicename = params.serviceName;
				break;
			case 'http':
			case 'tcp':
				if (params.type === 'http' || params.headerType === 'http') {
					config.http_host = params.host ? split(urldecode(params.host), ',') : null;
					config.http_path = params.path ? urldecode(params.path) : null;
				}
				break;
			case 'httpupgrade':
				config.httpupgrade_host = params.host ? urldecode(params.host) : null;
				config.http_path = params.path ? urldecode(params.path) : null;
				break;
			case 'ws':
				config.ws_host = params.host ? urldecode(params.host) : null;
				config.ws_path = params.path ? urldecode(params.path) : null;
				if (config.ws_path && match(config.ws_path, /\?ed=/)) {
					config.websocket_early_data_header = 'Sec-WebSocket-Protocol';
					config.websocket_early_data = split(config.ws_path, '?ed=')[1];
					config.ws_path = split(config.ws_path, '?ed=')[0];
				}
				break;
			case 'xhttp':
				config.http_path = params.path ? urldecode(params.path) : null;
				config.http_host = params.host ? urldecode(params.host) : null;
				config.xhttp_mode = params.mode || null;
				break;
			}

			if (params.hiddify === '1') {
				if (params.fragment) {
					const fparts = split(urldecode(params.fragment), ',');
					if (length(fparts) >= 2) {
						config.tls_fragment = '1';
						config.tls_fragment_size = fparts[0];
						config.tls_fragment_sleep = fparts[1];
						config.tls_fragment_type = fparts[2] || null;
					}
				}
				if (params.allowInsecure === 'true' || params.insecure === 'true')
					config.tls_insecure = '1';
			}

			break;
		case 'tuic':
			/* https://github.com/daeuniverse/dae/discussions/182 */
			url = parseURL('http://' + uri[1]) || {};
			params = url.searchParams || {};

			if (!sing_features.with_quic) {
				log(sprintf('Skipping unsupported %s node: %s.', uri[0], urldecode(url.hash) || url.hostname));
				log(sprintf('Please rebuild sing-box with %s support!', 'QUIC'));

				return null;
			}

			config = {
				label: url.hash ? urldecode(url.hash) : null,
				type: 'tuic',
				address: url.hostname,
				port: url.port,
				uuid: url.username,
				password: url.password ? urldecode(url.password) : null,
				tuic_congestion_control: params.congestion_control,
				tuic_udp_relay_mode: params.udp_relay_mode,
				tuic_enable_zero_rtt: params.zero_rtt_handshake || null,
				tuic_heartbeat: params.heartbeat || null,
				tls: '1',
				tls_sni: params.sni,
				tls_alpn: params.alpn ? split(urldecode(params.alpn), ',') : null,
			};

			break;
		case 'vless':
			/* https://github.com/XTLS/Xray-core/discussions/716 */
			url = parseURL('http://' + uri[1]) || {};
			params = url.searchParams || {};

			/* Unsupported protocol */
			if (params.type === 'kcp') {
				log(sprintf('Skipping sunsupported %s node: %s.', uri[0], urldecode(url.hash) || url.hostname));
				return null;
			} else if (params.type === 'quic' && ((params.quicSecurity && params.quicSecurity !== 'none') || !sing_features.with_quic)) {
				log(sprintf('Skipping sunsupported %s node: %s.', uri[0], urldecode(url.hash) || url.hostname));
				if (!sing_features.with_quic)
					log(sprintf('Please rebuild sing-box with %s support!', 'QUIC'));

				return null;
			}

			config = {
				label: url.hash ? urldecode(url.hash) : null,
				type: 'vless',
				address: url.hostname,
				port: url.port,
				uuid: url.username,
				transport: (params.type !== 'tcp') ? params.type : null,
				tls: (params.security in ['tls', 'xtls', 'reality']) ? '1' : '0',
				tls_sni: params.sni,
				tls_alpn: params.alpn ? split(urldecode(params.alpn), ',') : null,
				tls_reality: (params.security === 'reality') ? '1' : '0',
				tls_reality_public_key: params.pbk ? urldecode(params.pbk) : null,
				tls_reality_short_id: params.sid,
				tls_utls: sing_features.with_utls ? params.fp : null,
				vless_flow: (params.security in ['tls', 'reality']) ? params.flow : null
			};
			switch(params.type) {
			case 'grpc':
				config.grpc_servicename = params.serviceName;
				break;
			case 'http':
			case 'tcp':
				if (params.type === 'http' || params.headerType === 'http') {
					config.http_host = params.host ? split(urldecode(params.host), ',') : null;
					config.http_path = params.path ? urldecode(params.path) : null;
				}
				break;
			case 'httpupgrade':
				config.httpupgrade_host = params.host ? urldecode(params.host) : null;
				config.http_path = params.path ? urldecode(params.path) : null;
				break;
			case 'ws':
				config.ws_host = params.host ? urldecode(params.host) : null;
				config.ws_path = params.path ? urldecode(params.path) : null;
				if (config.ws_path && match(config.ws_path, /\?ed=/)) {
					config.websocket_early_data_header = 'Sec-WebSocket-Protocol';
					config.websocket_early_data = split(config.ws_path, '?ed=')[1];
					config.ws_path = split(config.ws_path, '?ed=')[0];
				}
				break;
			case 'xhttp':
				config.http_path = params.path ? urldecode(params.path) : null;
				config.http_host = params.host ? urldecode(params.host) : null;
				config.xhttp_mode = params.mode || null;
				break;
			}

			if (params.hiddify === '1') {
				if (params.fragment) {
					const fparts = split(urldecode(params.fragment), ',');
					if (length(fparts) >= 2) {
						config.tls_fragment = '1';
						config.tls_fragment_size = fparts[0];
						config.tls_fragment_sleep = fparts[1];
						config.tls_fragment_type = fparts[2] || null;
					}
				}
				if (params.allowInsecure === 'true' || params.insecure === 'true')
					config.tls_insecure = '1';
				if (params.extra) {
					try {
						const extra = json(urldecode(params.extra));
						if (extra.headers && length(keys(extra.headers)) > 0)
							config.xhttp_headers = sprintf('%J', extra.headers);
						if (extra.downloadSettings) {
							const dl = extra.downloadSettings;
							config.xhttp_download_server = dl.address;
							config.xhttp_download_port = '' + dl.port;
							if (dl.xhttpSettings) {
								config.xhttp_download_path = dl.xhttpSettings.path;
								config.xhttp_download_host = dl.xhttpSettings.host;
								config.xhttp_download_mode = dl.xhttpSettings.mode;
							}
							config.xhttp_download_security = dl.security;
							if (dl.security === 'reality' && dl.realitySettings) {
								config.xhttp_download_sni = dl.realitySettings.serverName;
								config.xhttp_download_fp = dl.realitySettings.fingerprint;
								config.xhttp_download_pbk = dl.realitySettings.publicKey;
								config.xhttp_download_sid = dl.realitySettings.shortId;
							} else if (dl.security === 'tls' && dl.tlsSettings) {
								config.xhttp_download_sni = dl.tlsSettings.serverName;
								config.xhttp_download_alpn = dl.tlsSettings.alpn;
							}
						}
					} catch(e) {}
				}
			}

			break;
		case 'vmess':
			/* "Lovely" shadowrocket format */
			if (match(uri, /&/)) {
				log(sprintf('Skipping unsupported %s format.', uri[0]));
				return null;
			}

			/* https://github.com/2dust/v2rayN/wiki/Description-of-VMess-share-link */
			try {
				uri = json(decodeBase64Str(uri[1])) || {};
			} catch(e) {
				log(sprintf('Skipping unsupported %s format.', uri[0]));
				return null;
			}

			if (uri.v != '2') {
				log(sprintf('Skipping unsupported %s format.', uri[0]));
				return null;
			/* Unsupported protocol */
			} else if (uri.net === 'kcp') {
				log(sprintf('Skipping unsupported %s node: %s.', uri[0], uri.ps || uri.add));
				return null;
			} else if (uri.net === 'quic' && ((uri.type && uri.type !== 'none') || uri.path || !sing_features.with_quic)) {
				log(sprintf('Skipping unsupported %s node: %s.', uri[0], uri.ps || uri.add));
				if (!sing_features.with_quic)
					log(sprintf('Please rebuild sing-box with %s support!', 'QUIC'));

				return null;
			}
			/*
			 * https://www.v2fly.org/config/protocols/vmess.html#vmess-md5-%E8%AE%A4%E8%AF%81%E4%BF%A1%E6%81%AF-%E6%B7%98%E6%B1%B0%E6%9C%BA%E5%88%B6
			 * else if (uri.aid && int(uri.aid) !== 0) {
			 * 	log(sprintf('Skipping unsupported %s node: %s.', uri[0], uri.ps || uri.add));
			 * 	return null;
			 * }
			 */

			config = {
				label: uri.ps ? urldecode(uri.ps) : null,
				type: 'vmess',
				address: uri.add,
				port: uri.port,
				uuid: uri.id,
				vmess_alterid: uri.aid,
				vmess_encrypt: uri.scy || 'auto',
				vmess_global_padding: '1',
				transport: (uri.net !== 'tcp') ? uri.net : null,
				tls: (uri.tls === 'tls') ? '1' : '0',
				tls_sni: uri.sni || uri.host,
				tls_alpn: uri.alpn ? split(uri.alpn, ',') : null,
				tls_utls: sing_features.with_utls ? uri.fp : null
			};
			switch (uri.net) {
			case 'grpc':
				config.grpc_servicename = uri.path;
				break;
			case 'h2':
			case 'tcp':
				if (uri.net === 'h2' || uri.type === 'http') {
					config.transport = 'http';
					config.http_host = uri.host ? split(uri.host, ',') : null;
					config.http_path = uri.path;
				}
				break;
			case 'httpupgrade':
				config.httpupgrade_host = uri.host;
				config.http_path = uri.path;
				break;
			case 'ws':
				config.ws_host = uri.host;
				config.ws_path = uri.path;
				if (config.ws_path && match(config.ws_path, /\?ed=/)) {
					config.websocket_early_data_header = 'Sec-WebSocket-Protocol';
					config.websocket_early_data = split(config.ws_path, '?ed=')[1];
					config.ws_path = split(config.ws_path, '?ed=')[0];
				}
				break;
			}

			break;
		case 'mieru':
			/* https://github.com/enfein/mieru */
			url = parseURL('http://' + uri[1]) || {};
			params = url.searchParams || {};

			config = {
				label: url.hash ? urldecode(url.hash) : null,
				type: 'mieru',
				address: url.hostname,
				port: '0',
				username: url.username ? urldecode(url.username) : null,
				password: url.password ? urldecode(url.password) : null,
				mieru_protocol: params.protocol || null,
				mieru_port_range: params.port || null,
				mieru_multiplexing: params.multiplexing || null,
				mieru_handshake_mode: params['handshake-mode'] || null
			};

			break;
		case 'wg':
		case 'wireguard':
			/* Manual parse: WireGuard private key may contain URL-encoded chars
			 * incompatible with parseURL's userinfo regex */
			let wg_str = trim(uri[1]);
			let wg_label = null;

			const wg_hash = index(wg_str, '#');
			if (wg_hash >= 0) {
				wg_label = urldecode(substr(wg_str, wg_hash + 1));
				wg_str = substr(wg_str, 0, wg_hash);
			}

			let wg_params = {};
			const wg_q = index(wg_str, '?');
			if (wg_q >= 0) {
				wg_params = urldecode_params(substr(wg_str, wg_q + 1)) || {};
				wg_str = substr(wg_str, 0, wg_q);
			}

			/* Strip trailing slash left by "KEY@HOST:PORT/?params" format */
			wg_str = replace(wg_str, /\/+$/, '');

			const wg_at = index(wg_str, '@');
			let wg_priv_key = null, wg_host = null, wg_port = null;
			if (wg_at >= 0) {
				wg_priv_key = urldecode(substr(wg_str, 0, wg_at));
				const wg_hp_parts = split(substr(wg_str, wg_at + 1), ':');
				wg_port = pop(wg_hp_parts);
				wg_host = join(':', wg_hp_parts) || null;
			} else {
				/* wg://HOST:PORT?privateKey=...&publicKey=... format (no userinfo) */
				const wg_hp_parts = split(wg_str, ':');
				wg_port = pop(wg_hp_parts);
				wg_host = join(':', wg_hp_parts) || null;
				wg_priv_key = wg_params.privateKey || wg_params.privatekey || null;
			}

			const wg_local_addr = wg_params.address || wg_params.ip || null;
			config = {
				label: wg_label,
				type: 'wireguard',
				address: wg_host,
				port: wg_port,
				wireguard_private_key: wg_priv_key,
				wireguard_peer_public_key: wg_params.publicKey || wg_params.publickey || null,
				wireguard_pre_shared_key: wg_params.presharedKey || wg_params.presharedkey || null,
				wireguard_local_address: wg_local_addr ? split(wg_local_addr, ',') : null,
				wireguard_mtu: wg_params.mtu || null,
				wireguard_reserved: wg_params.reserved ? split(wg_params.reserved, ',') : null
			};

			break;
		}
	}

	if (!isEmpty(config)) {
		if (config.address)
			config.address = replace(config.address, /\[|\]/g, '');

		if (!validation('host', config.address) || (config.type !== 'mieru' && !validation('port', config.port))) {
			log(sprintf('Skipping invalid %s node: %s.', config.type, config.label || 'NULL'));
			return null;
		} else if (!config.label)
			config.label = (validation('ip6addr', config.address) ?
				`[${config.address}]` : config.address) + ':' + config.port;
	}

	return config;
};
