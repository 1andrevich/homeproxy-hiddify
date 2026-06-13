/*
 * SPDX-License-Identifier: GPL-2.0-only
 *
 * Copyright (C) 2022-2025 ImmortalWrt.org
 */

'use strict';
'require form';
'require fs';
'require rpc';
'require uci';
'require ui';
'require view';

'require homeproxy as hp';
'require tools.widgets as widgets';

function allowInsecureConfirm(ev, _section_id, value) {
	if (value === '1' && !confirm(_('Are you sure to allow insecure?')))
		ev.target.firstElementChild.checked = null;
}

async function parseVpnLink(uri) {
	/* AmneziaVPN vpn:// share format: base64url(qCompress(JSON))
	 * qCompress = 4-byte big-endian uncompressed length + zlib stream */
	const b64 = uri.slice(6).replace(/-/g, '+').replace(/_/g, '/');
	const binary = atob(b64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++)
		bytes[i] = binary.charCodeAt(i);

	const ds = new DecompressionStream('deflate');
	const writer = ds.writable.getWriter();
	const reader = ds.readable.getReader();
	writer.write(bytes.slice(4)); // skip 4-byte qCompress length header
	writer.close();

	const chunks = [];
	let res;
	while (!(res = await reader.read()).done)
		chunks.push(res.value);

	const decoded = JSON.parse(new TextDecoder().decode(
		new Uint8Array(chunks.reduce((a, c) => [...a, ...c], []))
	));

	const container = decoded.containers?.find(c => c.container === decoded.defaultContainer)
	               || decoded.containers?.[0];
	if (!container) return null;

	const label = decoded.description || decoded.hostName || null;

	switch (container.container) {
	case 'amnezia-awg':
	case 'amnezia-awg2': {
		const awg = container.awg;
		if (!awg) return null;
		/* detailed fields live inside last_config as a JSON string */
		let cfg = awg;
		if (awg.last_config) {
			try { cfg = Object.assign({}, awg, JSON.parse(awg.last_config)); } catch(e) {}
		}
		const clientIp = cfg.client_ip || '';
		const localAddr = clientIp.includes('/') ? clientIp : (clientIp ? clientIp + '/32' : null);
		return {
			label: (label || (cfg.hostName + ':' + cfg.port) || 'AmneziaWG') + '-awg',
			type: 'amneziawg',
			address: cfg.hostName || decoded.hostName,
			port: String(cfg.port || awg.port),
			wireguard_local_address: localAddr ? [localAddr] : null,
			wireguard_private_key: cfg.client_priv_key,
			wireguard_peer_public_key: cfg.server_pub_key,
			wireguard_pre_shared_key: cfg.psk_key || null,
			wireguard_mtu: cfg.mtu || null,
			wireguard_persistent_keepalive_interval: cfg.persistent_keep_alive || null,
			amnezia_jc: awg.Jc,
			amnezia_jmin: awg.Jmin,
			amnezia_jmax: awg.Jmax,
			amnezia_s1: awg.S1,
			amnezia_s2: awg.S2,
			amnezia_s3: awg.S3 || null,
			amnezia_s4: awg.S4 || null,
			amnezia_h1: awg.H1,
			amnezia_h2: awg.H2,
			amnezia_h3: awg.H3,
			amnezia_h4: awg.H4,
			amnezia_i1: awg.I1 || null,
			amnezia_i2: awg.I2 || null,
			amnezia_i3: awg.I3 || null,
			amnezia_i4: awg.I4 || null,
			amnezia_i5: awg.I5 || null,
		};
	}
	case 'amnezia-xray': {
		const xray = container.xray;
		if (!xray?.last_config) return null;
		let xrayCfg;
		try { xrayCfg = JSON.parse(xray.last_config); } catch(e) { return null; }

		const outbound = xrayCfg.outbounds?.find(
			o => !['freedom', 'blackhole', 'dns'].includes(o.protocol)
		);
		if (!outbound) return null;

		const stream = outbound.streamSettings || {};
		/* Xray network → homeproxy transport */
		const netMap = { ws: 'ws', grpc: 'grpc', h2: 'http', http: 'http',
		                 httpupgrade: 'httpupgrade', xhttp: 'xhttp', splithttp: 'xhttp' };
		const transport = netMap[stream.network] || null;
		const security = stream.security || 'none';

		let config = {
			label: (label || (decoded.hostName + ':' + xray.port) || outbound.protocol) + '-XRay',
			transport: transport,
		};

		/* TLS / Reality */
		if (security === 'reality') {
			const r = stream.realitySettings || {};
			Object.assign(config, {
				tls: '1',
				tls_reality: '1',
				tls_sni: r.serverName || null,
				tls_utls: r.fingerprint || null,
				tls_reality_public_key: r.publicKey || null,
				tls_reality_short_id: r.shortId || null,
			});
		} else if (security === 'tls') {
			const t = stream.tlsSettings || {};
			Object.assign(config, {
				tls: '1',
				tls_sni: t.serverName || null,
				tls_insecure: t.allowInsecure ? '1' : '0',
				tls_utls: t.fingerprint || null,
			});
		}

		/* Transport details */
		if (transport === 'ws') {
			const ws = stream.wsSettings || {};
			config.ws_path = ws.path || null;
			config.transport_host = ws.headers?.Host || null;
		} else if (transport === 'grpc') {
			config.grpc_servicename = (stream.grpcSettings || {}).serviceName || null;
		} else if (transport === 'xhttp') {
			const xhttpCfg = stream.xhttpSettings || stream.splithttpSettings || {};
			config.http_path = xhttpCfg.path || null;
			config.http_host = xhttpCfg.host || null;
			config.xhttp_mode = xhttpCfg.mode || null;
			config.xhttp_padding_bytes = xhttpCfg.xPaddingBytes || xhttpCfg.x_padding_bytes || null;
		}

		/* Protocol-specific fields */
		switch (outbound.protocol) {
		case 'vless': {
			const vnext = outbound.settings?.vnext?.[0];
			if (!vnext) return null;
			const user = vnext.users?.[0] || {};
			return Object.assign(config, {
				type: 'vless',
				address: vnext.address,
				port: String(vnext.port),
				uuid: user.id,
				vless_flow: (security === 'reality' || security === 'tls') ? (user.flow || null) : null,
			});
		}
		case 'vmess': {
			const vnext = outbound.settings?.vnext?.[0];
			if (!vnext) return null;
			const user = vnext.users?.[0] || {};
			return Object.assign(config, {
				type: 'vmess',
				address: vnext.address,
				port: String(vnext.port),
				uuid: user.id,
				vmess_alter_id: String(user.alterId || 0),
			});
		}
		case 'trojan': {
			const server = outbound.settings?.servers?.[0];
			if (!server) return null;
			return Object.assign(config, {
				type: 'trojan',
				address: server.address,
				port: String(server.port),
				password: server.password,
			});
		}
		case 'shadowsocks': {
			const server = outbound.settings?.servers?.[0];
			if (!server) return null;
			return Object.assign(config, {
				type: 'shadowsocks',
				address: server.address,
				port: String(server.port),
				password: server.password,
				shadowsocks_encrypt_method: server.method,
			});
		}
		default:
			return null;
		}
	}
	default:
		/* amnezia-openvpn, amnezia-ipsec, unknown — skip silently */
		return null;
	}
}

function parseWireGuardConf(text) {
	const lines = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
	let section = null;
	const iface = {}, peer = {};

	for (const line of lines) {
		if (line === '[Interface]') { section = 'interface'; continue; }
		if (line === '[Peer]')      { section = 'peer';      continue; }
		const eq = line.indexOf('=');
		if (eq < 0) continue;
		const key = line.slice(0, eq).trim();
		const val = line.slice(eq + 1).trim();
		if (section === 'interface') iface[key] = val;
		else if (section === 'peer') peer[key] = val;
	}

	if (!iface.PrivateKey || !peer.PublicKey || !peer.Endpoint) return null;

	const lastColon = peer.Endpoint.lastIndexOf(':');
	const host = peer.Endpoint.slice(0, lastColon);
	const port = peer.Endpoint.slice(lastColon + 1);

	const isAWG = !!(iface.Jc || iface.Jmin || iface.Jmax || iface.H1);

	const node = {
		label:                   isAWG ? 'AmneziaWG' : 'WireGuard',
		type:                    isAWG ? 'amneziawg' : 'wireguard',
		address:                 host.replace(/^\[|\]$/g, ''),
		port:                    port,
		wireguard_private_key:   iface.PrivateKey,
		wireguard_peer_public_key: peer.PublicKey,
		wireguard_pre_shared_key:  peer.PresharedKey || null,
		wireguard_local_address: iface.Address ? iface.Address.split(',').map(a => a.trim()) : null,
		wireguard_mtu:           iface.MTU || null,
	};

	if (isAWG) {
		node.amnezia_jc   = iface.Jc   || null;
		node.amnezia_jmin = iface.Jmin  || null;
		node.amnezia_jmax = iface.Jmax  || null;
		node.amnezia_s1   = iface.S1   || null;
		node.amnezia_s2   = iface.S2   || null;
		node.amnezia_s3   = iface.S3   || null;
		node.amnezia_s4   = iface.S4   || null;
		node.amnezia_h1   = iface.H1   || null;
		node.amnezia_h2   = iface.H2   || null;
		node.amnezia_h3   = iface.H3   || null;
		node.amnezia_h4   = iface.H4   || null;
		node.amnezia_i1   = iface.I1   || null;
		node.amnezia_i2   = iface.I2   || null;
		node.amnezia_i3   = iface.I3   || null;
		node.amnezia_i4   = iface.I4   || null;
		node.amnezia_i5   = iface.I5   || null;
	}

	return node;
}

function parseShareLink(uri, features) {
	let config, url, params;

	uri = uri.split('://');
	if (uri[0] && uri[1]) {
		switch (uri[0]) {
		case 'anytls':
			/* https://github.com/anytls/anytls-go/blob/v0.0.8/docs/uri_scheme.md */
			url = new URL('http://' + uri[1]);
			params = url.searchParams;

			/* Check if password exists */
			if (!url.username)
				return null;

			config = {
				label: url.hash ? decodeURIComponent(url.hash.slice(1)) : null,
				type: 'anytls',
				address: url.hostname,
				port: url.port || '80',
				password: url.username ? decodeURIComponent(url.username) : null,
				tls: '1',
				tls_sni: params.get('sni'),
				tls_insecure: (params.get('insecure') === '1') ? '1' : '0'
			};

			break;
		case 'http':
		case 'https':
			url = new URL('http://' + uri[1]);

			config = {
				label: url.hash ? decodeURIComponent(url.hash.slice(1)) : null,
				type: 'http',
				address: url.hostname,
				port: url.port || '80',
				username: url.username ? decodeURIComponent(url.username) : null,
				password: url.password ? decodeURIComponent(url.password) : null,
				tls: (uri[0] === 'https') ? '1' : '0'
			};

			break;
		case 'hysteria':
			/* https://github.com/HyNetwork/hysteria/wiki/URI-Scheme */
			url = new URL('http://' + uri[1]);
			params = url.searchParams;

			/* WeChat-Video / FakeTCP are unsupported by sing-box currently */
			if (!features.with_quic || (params.get('protocol') && params.get('protocol') !== 'udp'))
				return null;

			config = {
				label: url.hash ? decodeURIComponent(url.hash.slice(1)) : null,
				type: 'hysteria',
				address: url.hostname,
				port: url.port || '80',
				hysteria_protocol: params.get('protocol') || 'udp',
				hysteria_auth_type: params.get('auth') ? 'string' : null,
				hysteria_auth_payload: params.get('auth'),
				hysteria_obfs_password: params.get('obfsParam'),
				hysteria_down_mbps: params.get('downmbps'),
				hysteria_up_mbps: params.get('upmbps'),
				tls: '1',
				tls_sni: params.get('peer'),
				tls_alpn: params.get('alpn'),
				tls_insecure: (params.get('insecure') === '1') ? '1' : '0'
			};

			break;
		case 'hysteria2':
		case 'hy2':
			/* https://v2.hysteria.network/docs/developers/URI-Scheme/ */
			url = new URL('http://' + uri[1]);
			params = url.searchParams;

			if (!features.with_quic)
				return null;

			config = {
				label: url.hash ? decodeURIComponent(url.hash.slice(1)) : null,
				type: 'hysteria2',
				address: url.hostname,
				port: url.port || '80',
				password: url.username ? (
					decodeURIComponent(url.username + (url.password ? (':' + url.password) : ''))
				) : null,
				hysteria_obfs_type: params.get('obfs'),
				hysteria_obfs_password: params.get('obfs-password'),
				tls: '1',
				tls_sni: params.get('sni'),
				tls_insecure: (params.get('insecure') === '1' || params.get('allow_insecure') === '1') ? '1' : '0'
			};

			break;
		case 'mieru':
			/* https://github.com/enfein/mieru */
			url = new URL('http://' + uri[1]);
			params = url.searchParams;

			config = {
				label: url.hash ? decodeURIComponent(url.hash.slice(1)) : null,
				type: 'mieru',
				address: url.hostname,
				port: '0',
				username: url.username ? decodeURIComponent(url.username) : null,
				password: url.password ? decodeURIComponent(url.password) : null,
				mieru_protocol: params.get('protocol') || null,
				mieru_port_range: params.get('port') || null,
				mieru_multiplexing: params.get('multiplexing') || null,
				mieru_handshake_mode: params.get('handshake-mode') || null
			};

			break;
		case 'naive':
		case 'naive+http':
		case 'naive+https': {
			if (!features.with_naive_outbound)
				return null;

			url = new URL('http://' + uri[1]);
			params = url.searchParams;

			let naiveExtraHeaders = null;
			if (params.get('header')) {
				const hdrParts = params.get('header').split(':');
				if (hdrParts.length >= 2) {
					let hdrs = {};
					hdrs[hdrParts[0].trim()] = hdrParts.slice(1).join(':').trim();
					naiveExtraHeaders = JSON.stringify(hdrs);
				}
			}

			config = {
				label: url.hash ? decodeURIComponent(url.hash.slice(1)) : null,
				type: 'naive',
				address: url.hostname,
				port: url.port || '443',
				username: url.username ? decodeURIComponent(url.username) : null,
				password: url.password ? decodeURIComponent(url.password) : null,
				tls: (uri[0] === 'naive+https' || params.get('security') === 'tls') ? '1' : '0',
				tls_sni: params.get('sni') || url.hostname,
				naive_udp_over_tcp: (params.get('uot') === '1') ? '1' : null,
				naive_quic: (params.get('quic') === '1') ? '1' : null,
				naive_extra_headers: naiveExtraHeaders
			};

			break;
		}
		case 'socks':
		case 'socks4':
		case 'socks4a':
		case 'socsk5':
		case 'socks5h':
			url = new URL('http://' + uri[1]);

			config = {
				label: url.hash ? decodeURIComponent(url.hash.slice(1)) : null,
				type: 'socks',
				address: url.hostname,
				port: url.port || '80',
				username: url.username ? decodeURIComponent(url.username) : null,
				password: url.password ? decodeURIComponent(url.password) : null,
				socks_version: (uri[0].includes('4')) ? '4' : '5'
			};

			break;
		case 'ss':
			try {
				/* "Lovely" Shadowrocket format */
				try {
					let suri = uri[1].split('#'), slabel = '';
					if (suri.length <= 2) {
						if (suri.length === 2)
							slabel = '#' + suri[1];
						uri[1] = hp.decodeBase64Str(suri[0]) + slabel;
					}
				} catch(e) { }

				/* SIP002 format https://shadowsocks.org/guide/sip002.html */
				url = new URL('http://' + uri[1]);

				let userinfo;
				if (url.username && url.password) {
					/* User info encoded with URIComponent */
					userinfo = [url.username, decodeURIComponent(url.password)];
				} else if (url.username) {
					/* User info encoded with base64 */
					userinfo = hp.decodeBase64Str(decodeURIComponent(url.username)).split(':');
					if (userinfo.length > 1)
						userinfo = [userinfo[0], userinfo.slice(1).join(':')]
				}

				if (!hp.shadowsocks_encrypt_methods.includes(userinfo[0]))
					return null;

				let plugin, plugin_opts;
				if (url.search && url.searchParams.get('plugin')) {
					let plugin_info = url.searchParams.get('plugin').split(';');
					plugin = plugin_info[0];
					plugin_opts = (plugin_info.length > 1) ? plugin_info.slice(1).join(';') : null;
				}

				config = {
					label: url.hash ? decodeURIComponent(url.hash.slice(1)) : null,
					type: 'shadowsocks',
					address: url.hostname,
					port: url.port || '80',
					shadowsocks_encrypt_method: userinfo[0],
					password: userinfo[1],
					shadowsocks_plugin: plugin,
					shadowsocks_plugin_opts: plugin_opts
				};
			} catch(e) {
				/* Legacy format https://github.com/shadowsocks/shadowsocks-org/commit/78ca46cd6859a4e9475953ed34a2d301454f579e */
				uri = uri[1].split('@');
				if (uri.length < 2)
					return null;
				else if (uri.length > 2)
					uri = [ uri.slice(0, -1).join('@'), uri.slice(-1).toString() ];

				config = {
					type: 'shadowsocks',
					address: uri[1].split(':')[0],
					port: uri[1].split(':')[1],
					shadowsocks_encrypt_method: uri[0].split(':')[0],
					password: uri[0].split(':').slice(1).join(':')
				};
			}

			break;
		case 'ssh': {
			/* Manual parse to avoid URL corruption on long base64 query values */
			let sshStr = uri[1];
			let sshLabel = null;

			const sshHashIdx = sshStr.indexOf('#');
			if (sshHashIdx >= 0) {
				sshLabel = decodeURIComponent(sshStr.slice(sshHashIdx + 1));
				sshStr = sshStr.slice(0, sshHashIdx);
			}

			let sshParams = {};
			const sshQ = sshStr.indexOf('?');
			if (sshQ >= 0) {
				sshParams = Object.fromEntries(new URLSearchParams(sshStr.slice(sshQ + 1)));
				sshStr = sshStr.slice(0, sshQ);
			}
			sshStr = sshStr.replace(/\/+$/, '');

			const sshAt = sshStr.indexOf('@');
			let sshUser = null, sshPass = null, sshHost = null, sshPort = null;
			if (sshAt >= 0) {
				const sshUserinfo = sshStr.slice(0, sshAt);
				const sshHostport = sshStr.slice(sshAt + 1);
				const sshColon = sshUserinfo.indexOf(':');
				if (sshColon >= 0) {
					sshUser = decodeURIComponent(sshUserinfo.slice(0, sshColon));
					sshPass = decodeURIComponent(sshUserinfo.slice(sshColon + 1));
				} else {
					sshUser = decodeURIComponent(sshUserinfo);
				}
				const sshHp = sshHostport.split(':');
				sshPort = sshHp.pop();
				sshHost = sshHp.join(':') || null;
			}

			let sshHostKey = null;
			const rawHk = sshParams['hk'] || sshParams['host_key'] || sshParams['hostKey'];
			if (rawHk) {
				const hkLines = rawHk.split(',').filter(l => l.trim().length > 0);
				sshHostKey = hkLines.length ? hkLines : null;
			}

			config = {
				label: sshLabel,
				type: 'ssh',
				address: sshHost,
				port: sshPort,
				username: sshUser,
				password: sshPass || null,
				ssh_priv_key: sshParams['pk'] || sshParams['private_key'] || sshParams['privateKey'] || null,
				ssh_priv_key_pp: sshParams['passphrase'] || null,
				ssh_host_key: sshHostKey
			};

			break;
		}
		case 'trojan':
			/* https://p4gefau1t.github.io/trojan-go/developer/url/ */
			url = new URL('http://' + uri[1]);
			params = url.searchParams;

			/* Check if password exists */
			if (!url.username)
				return null;

			config = {
				label: url.hash ? decodeURIComponent(url.hash.slice(1)) : null,
				type: 'trojan',
				address: url.hostname,
				port: url.port || '80',
				password: decodeURIComponent(url.username),
				transport: params.get('type') !== 'tcp' ? params.get('type') : null,
				tls: '1',
				tls_sni: params.get('sni')
			};
			switch (params.get('type')) {
			case 'grpc':
				config.grpc_servicename = params.get('serviceName');
				break;
			case 'ws':
				config.ws_host = params.get('host') ? decodeURIComponent(params.get('host')) : null;
				config.ws_path = params.get('path') ? decodeURIComponent(params.get('path')) : null;
				if (config.ws_path && config.ws_path.includes('?ed=')) {
					config.websocket_early_data_header = 'Sec-WebSocket-Protocol';
					config.websocket_early_data = config.ws_path.split('?ed=')[1];
					config.ws_path = config.ws_path.split('?ed=')[0];
				}
				break;
			case 'xhttp':
				config.http_path = params.get('path') ? decodeURIComponent(params.get('path')) : null;
				config.http_host = params.get('host') ? decodeURIComponent(params.get('host')) : null;
				config.xhttp_mode = params.get('mode') || null;
				config.xhttp_padding_bytes = params.get('xPaddingBytes') || params.get('x_padding_bytes') || null;
				break;
			}

			if (params.get('hiddify') === '1') {
				if (params.get('fragment')) {
					const fparts = params.get('fragment').split(',');
					if (fparts.length >= 2) {
						config.tls_fragment = '1';
						config.tls_fragment_size = fparts[0];
						config.tls_fragment_sleep = fparts[1];
						config.tls_fragment_type = fparts[2] || null;
					}
				}
				if (params.get('allowInsecure') === 'true' || params.get('insecure') === 'true')
					config.tls_insecure = '1';
			}

			break;
		case 'tuic':
			/* https://github.com/daeuniverse/dae/discussions/182 */
			url = new URL('http://' + uri[1]);
			params = url.searchParams;

			if (!features.with_quic)
				return null;

			/* Check if uuid exists */
			if (!url.username)
				return null;

			config = {
				label: url.hash ? decodeURIComponent(url.hash.slice(1)) : null,
				type: 'tuic',
				address: url.hostname,
				port: url.port || '80',
				uuid: url.username,
				password: url.password ? decodeURIComponent(url.password) : null,
				tuic_congestion_control: params.get('congestion_control'),
				tuic_udp_relay_mode: params.get('udp_relay_mode'),
				tuic_enable_zero_rtt: params.get('zero_rtt_handshake') || null,
				tuic_heartbeat: params.get('heartbeat') || null,
				tls: '1',
				tls_sni: params.get('sni'),
				tls_alpn: params.get('alpn') ? decodeURIComponent(params.get('alpn')).split(',') : null,
				tls_insecure: (params.get('allow_insecure') === '1' || params.get('insecure') === '1') ? '1' : '0'
			};

			break;
		case 'vless':
			/* https://github.com/XTLS/Xray-core/discussions/716 */
			url = new URL('http://' + uri[1]);
			params = url.searchParams;

			/* Unsupported protocol */
			if (params.get('type') === 'kcp')
				return null;
			else if (params.get('type') === 'quic' && ((params.get('quicSecurity') && params.get('quicSecurity') !== 'none') || !features.with_quic))
				return null;
			/* Check if uuid and type exist */
			if (!url.username || !params.get('type'))
				return null;

			config = {
				label: url.hash ? decodeURIComponent(url.hash.slice(1)) : null,
				type: 'vless',
				address: url.hostname,
				port: url.port || '80',
				uuid: url.username,
				transport: params.get('type') !== 'tcp' ? params.get('type') : null,
				tls: ['tls', 'xtls', 'reality'].includes(params.get('security')) ? '1' : '0',
				tls_sni: params.get('sni'),
				tls_alpn: params.get('alpn') ? decodeURIComponent(params.get('alpn')).split(',') : null,
				tls_reality: (params.get('security') === 'reality') ? '1' : '0',
				tls_reality_public_key: params.get('pbk') ? decodeURIComponent(params.get('pbk')) : null,
				tls_reality_short_id: params.get('sid'),
				tls_utls: features.with_utls ? params.get('fp') : null,
				vless_flow: ['tls', 'reality'].includes(params.get('security')) ? params.get('flow') : null
			};
			switch (params.get('type')) {
			case 'grpc':
				config.grpc_servicename = params.get('serviceName');
				break;
			case 'http':
			case 'tcp':
				if (config.transport === 'http' || params.get('headerType') === 'http') {
					config.http_host = params.get('host') ? decodeURIComponent(params.get('host')).split(',') : null;
					config.http_path = params.get('path') ? decodeURIComponent(params.get('path')) : null;
				}
				break;
			case 'httpupgrade':
				config.httpupgrade_host = params.get('host') ? decodeURIComponent(params.get('host')) : null;
				config.http_path = params.get('path') ? decodeURIComponent(params.get('path')) : null;
				break;
			case 'ws':
				config.ws_host = params.get('host') ? decodeURIComponent(params.get('host')) : null;
				config.ws_path = params.get('path') ? decodeURIComponent(params.get('path')) : null;
				if (config.ws_path && config.ws_path.includes('?ed=')) {
					config.websocket_early_data_header = 'Sec-WebSocket-Protocol';
					config.websocket_early_data = config.ws_path.split('?ed=')[1];
					config.ws_path = config.ws_path.split('?ed=')[0];
				}
				break;
			case 'xhttp':
				config.http_path = params.get('path') ? decodeURIComponent(params.get('path')) : null;
				config.http_host = params.get('host') ? decodeURIComponent(params.get('host')) : null;
				config.xhttp_mode = params.get('mode') || null;
				config.xhttp_padding_bytes = params.get('xPaddingBytes') || params.get('x_padding_bytes') || null;
				break;
			}

			if (params.get('hiddify') === '1') {
				if (params.get('fragment')) {
					const fparts = params.get('fragment').split(',');
					if (fparts.length >= 2) {
						config.tls_fragment = '1';
						config.tls_fragment_size = fparts[0];
						config.tls_fragment_sleep = fparts[1];
						config.tls_fragment_type = fparts[2] || null;
					}
				}
				if (params.get('allowInsecure') === 'true' || params.get('insecure') === 'true')
					config.tls_insecure = '1';
				if (params.get('extra')) {
					try {
						const extra = JSON.parse(params.get('extra'));
						if (extra.headers && Object.keys(extra.headers).length > 0)
							config.xhttp_headers = JSON.stringify(extra.headers);
						if (extra.downloadSettings) {
							const dl = extra.downloadSettings;
							config.xhttp_download_server = dl.address || null;
							config.xhttp_download_port = dl.port ? String(dl.port) : null;
							if (dl.xhttpSettings) {
								config.xhttp_download_path = dl.xhttpSettings.path || null;
								config.xhttp_download_host = dl.xhttpSettings.host || null;
								config.xhttp_download_mode = dl.xhttpSettings.mode || null;
							}
							config.xhttp_download_security = dl.security || null;
							if (dl.security === 'reality' && dl.realitySettings) {
								config.xhttp_download_sni = dl.realitySettings.serverName || null;
								config.xhttp_download_fp = dl.realitySettings.fingerprint || null;
								config.xhttp_download_pbk = dl.realitySettings.publicKey || null;
								config.xhttp_download_sid = dl.realitySettings.shortId || null;
							} else if (dl.security === 'tls' && dl.tlsSettings) {
								config.xhttp_download_sni = dl.tlsSettings.serverName || null;
								config.xhttp_download_alpn = dl.tlsSettings.alpn || null;
							}
						}
					} catch(e) { }
				}
			}

			break;
		case 'vmess':
			/* "Lovely" shadowrocket format */
			if (uri.includes('&'))
				return null;

			/* https://github.com/2dust/v2rayN/wiki/Description-of-VMess-share-link */
			uri = JSON.parse(hp.decodeBase64Str(uri[1]));

			if (uri.v != '2')
				return null;
			/* Unsupported protocols */
			else if (uri.net === 'kcp')
				return null;
			else if (uri.net === 'quic' && ((uri.type && uri.type !== 'none') || !features.with_quic))
				return null;
			/* https://www.v2fly.org/config/protocols/vmess.html#vmess-md5-%E8%AE%A4%E8%AF%81%E4%BF%A1%E6%81%AF-%E6%B7%98%E6%B1%B0%E6%9C%BA%E5%88%B6
			 * else if (uri.aid && parseInt(uri.aid) !== 0)
			 * 	return null;
			 */

			config = {
				label: uri.ps,
				type: 'vmess',
				address: uri.add,
				port: uri.port,
				uuid: uri.id,
				vmess_alterid: uri.aid,
				vmess_encrypt: uri.scy || 'auto',
				transport: (uri.net !== 'tcp') ? uri.net : null,
				tls: uri.tls === 'tls' ? '1' : '0',
				tls_sni: uri.sni || uri.host,
				tls_alpn: uri.alpn ? uri.alpn.split(',') : null,
				tls_utls: features.with_utls ? uri.fp : null
			};
			switch (uri.net) {
			case 'grpc':
				config.grpc_servicename = uri.path;
				break;
			case 'h2':
			case 'tcp':
				if (uri.net === 'h2' || uri.type === 'http') {
					config.transport = 'http';
					config.http_host = uri.host ? uri.host.split(',') : null;
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
				if (config.ws_path && config.ws_path.includes('?ed=')) {
					config.websocket_early_data_header = 'Sec-WebSocket-Protocol';
					config.websocket_early_data = config.ws_path.split('?ed=')[1];
					config.ws_path = config.ws_path.split('?ed=')[0];
				}
				break;
			}

			break;
		case 'wg':
		case 'wireguard': {
			if (!features.with_wireguard || !features.with_gvisor)
				return null;

			/* Manual parse: private key in userinfo may contain chars that confuse URL parsing */
			let wgStr = uri[1];
			let wgLabel = null;

			const wgHash = wgStr.indexOf('#');
			if (wgHash >= 0) {
				wgLabel = decodeURIComponent(wgStr.slice(wgHash + 1));
				wgStr = wgStr.slice(0, wgHash);
			}

			let wgParams = {};
			const wgQ = wgStr.indexOf('?');
			if (wgQ >= 0) {
				wgParams = Object.fromEntries(new URLSearchParams(wgStr.slice(wgQ + 1)));
				wgStr = wgStr.slice(0, wgQ);
			}
			wgStr = wgStr.replace(/\/+$/, '');

			const wgAt = wgStr.indexOf('@');
			let wgPrivKey = null, wgHost = null, wgPort = null;
			if (wgAt >= 0) {
				wgPrivKey = decodeURIComponent(wgStr.slice(0, wgAt));
				const wgHp = wgStr.slice(wgAt + 1).split(':');
				wgPort = wgHp.pop();
				wgHost = wgHp.join(':') || null;
			} else {
				const wgHp = wgStr.split(':');
				wgPort = wgHp.pop();
				wgHost = wgHp.join(':') || null;
				wgPrivKey = wgParams['privateKey'] || wgParams['privatekey'] || null;
			}

			const wgLocalAddr = wgParams['address'] || wgParams['ip'] || null;
			config = {
				label: wgLabel,
				type: 'wireguard',
				address: wgHost,
				port: wgPort,
				wireguard_private_key: wgPrivKey,
				wireguard_peer_public_key: wgParams['publicKey'] || wgParams['publickey'] || null,
				wireguard_pre_shared_key: wgParams['presharedKey'] || wgParams['presharedkey'] || null,
				wireguard_local_address: wgLocalAddr ? wgLocalAddr.split(',') : null,
				wireguard_mtu: wgParams['mtu'] || null,
				wireguard_reserved: wgParams['reserved'] ? wgParams['reserved'].split(',') : null
			};

			break;
		}
		}
	}

	if (config) {
		if (!config.address || !config.port)
			return null;
		else if (!config.label)
			config.label = config.address + ':' + config.port;

		config.address = config.address.replace(/\[|\]/g, '');
	}

	return config;
}

function renderNodeSettings(section, data, features, main_node, routing_mode) {
	let s = section, o;
	s.rowcolors = true;
	s.sortable = true;
	s.nodescriptions = true;
	s.modaltitle = L.bind(hp.loadModalTitle, this, _('Node'), _('Add a node'), data[0]);
	s.sectiontitle = L.bind(hp.loadDefaultLabel, this, data[0]);


	o = s.option(form.Value, 'label', _('Label'));
	o.load = L.bind(hp.loadDefaultLabel, this, data[0]);
	o.validate = L.bind(hp.validateUniqueValue, this, data[0], 'node', 'label');
	o.modalonly = true;

	o = s.option(form.ListValue, 'type', _('Type'));
	o.value('direct', _('Direct'));
	o.value('anytls', _('AnyTLS'));
	o.value('http', _('HTTP'));
	if (features.with_quic) {
		o.value('hysteria', _('Hysteria'));
		o.value('hysteria2', _('Hysteria2'));
		o.value('mieru', _('Mieru'));
	}
	o.value('shadowsocks', _('Shadowsocks'));
	o.value('shadowtls', _('ShadowTLS'));
	if (features.with_naive_outbound)
		o.value('naive', _('NaïveProxy'));
	o.value('socks', _('Socks'));
	o.value('ssh', _('SSH'));
	o.value('trojan', _('Trojan'));
	if (features.with_quic)
		o.value('tuic', _('Tuic'));
	if (features.with_wireguard && features.with_gvisor)
		o.value('wireguard', _('WireGuard'));
	o.value('amneziawg', _('AmneziaWG'));
	o.value('vless', _('VLESS'));
	o.value('vmess', _('VMess'));
	o.rmempty = false;

	o = s.option(form.Value, 'address', _('Address'));
	o.datatype = 'host';
	o.depends({'type': 'direct', '!reverse': true});
	o.rmempty = false;

	o = s.option(form.Value, 'port', _('Port'));
	o.datatype = 'port';
	o.depends('type', 'anytls');
	o.depends('type', 'http');
	o.depends('type', 'hysteria');
	o.depends('type', 'hysteria2');
	o.depends('type', 'naive');
	o.depends('type', 'shadowsocks');
	o.depends('type', 'shadowtls');
	o.depends('type', 'socks');
	o.depends('type', 'ssh');
	o.depends('type', 'trojan');
	o.depends('type', 'tuic');
	o.depends('type', 'vless');
	o.depends('type', 'vmess');
	o.depends('type', 'wireguard');
	o.depends('type', 'amneziawg');
	o.rmempty = false;

	o = s.option(form.Value, 'username', _('Username'));
	o.depends('type', 'http');
	o.depends('type', 'mieru');
	o.depends('type', 'naive');
	o.depends('type', 'socks');
	o.depends('type', 'ssh');
	o.modalonly = true;

	o = s.option(form.Value, 'password', _('Password'));
	o.password = true;
	o.depends('type', 'anytls');
	o.depends('type', 'http');
	o.depends('type', 'hysteria2');
	o.depends('type', 'mieru');
	o.depends('type', 'naive');
	o.depends('type', 'shadowsocks');
	o.depends('type', 'ssh');
	o.depends('type', 'trojan');
	o.depends('type', 'tuic');
	o.depends({'type': 'shadowtls', 'shadowtls_version': '2'});
	o.depends({'type': 'shadowtls', 'shadowtls_version': '3'});
	o.depends({'type': 'socks', 'socks_version': '5'});
	o.validate = function(section_id, value) {
		if (section_id) {
			let type = this.section.formvalue(section_id, 'type');
			let required_type = [ 'anytls', 'shadowsocks', 'shadowtls', 'trojan' ];

			if (required_type.includes(type)) {
				if (type === 'shadowsocks') {
					let encmode = this.section.formvalue(section_id, 'shadowsocks_encrypt_method');
					if (encmode === 'none')
						return true;
				}
				if (!value)
					return _('Expecting: %s').format(_('non-empty value'));
			}
		}

		return true;
	}
	o.modalonly = true;

	/* Direct config */
	o = s.option(form.ListValue, 'proxy_protocol', _('Proxy protocol'),
		_('Write proxy protocol in the connection header.'));
	o.value('', _('Disable'));
	o.value('1', _('v1'));
	o.value('2', _('v2'));
	o.depends('type', 'direct');
	o.modalonly = true;

	/* AnyTLS config start */
	o = s.option(form.Value, 'anytls_idle_session_check_interval', _('Idle session check interval'),
		_('Interval checking for idle sessions, in seconds.'));
	o.datatype = 'uinteger';
	o.placeholder = '30';
	o.depends('type', 'anytls');
	o.modalonly = true;

	o = s.option(form.Value, 'anytls_idle_session_timeout', _('Idle session check timeout'),
		_('In the check, close sessions that have been idle for longer than this, in seconds.'));
	o.datatype = 'uinteger';
	o.placeholder = '30';
	o.depends('type', 'anytls');
	o.modalonly = true;

	o = s.option(form.Value, 'anytls_min_idle_session', _('Minimum idle sessions'),
		_('In the check, at least the first <code>n</code> idle sessions are kept open.'));
	o.datatype = 'uinteger';
	o.placeholder = '0';
	o.depends('type', 'anytls');
	o.modalonly = true;
	/* AnyTLS config end */

	/* Hysteria (2) config start */
	o = s.option(form.DynamicList, 'hysteria_hopping_port', _('Hopping port'));
	o.depends('type', 'hysteria');
	o.depends('type', 'hysteria2');
	o.validate = hp.validatePortRange;
	o.modalonly = true;

	o = s.option(form.Value, 'hysteria_hop_interval', _('Hop interval'),
		_('Port hopping interval in seconds.'));
	o.datatype = 'uinteger';
	o.placeholder = '30';
	o.depends({'type': 'hysteria', 'hysteria_hopping_port': /[\s\S]/});
	o.depends({'type': 'hysteria2', 'hysteria_hopping_port': /[\s\S]/});
	o.modalonly = true;

	o = s.option(form.ListValue, 'hysteria_protocol', _('Protocol'));
	o.value('udp');
	/* WeChat-Video / FakeTCP are unsupported by sing-box currently
	 * o.value('wechat-video');
	 * o.value('faketcp');
	 */
	o.default = 'udp';
	o.depends('type', 'hysteria');
	o.rmempty = false;
	o.modalonly = true;

	o = s.option(form.ListValue, 'hysteria_auth_type', _('Authentication type'));
	o.value('', _('Disable'));
	o.value('base64', _('Base64'));
	o.value('string', _('String'));
	o.depends('type', 'hysteria');
	o.modalonly = true;

	o = s.option(form.Value, 'hysteria_auth_payload', _('Authentication payload'));
	o.password = true
	o.depends({'type': 'hysteria', 'hysteria_auth_type': /[\s\S]/});
	o.rmempty = false;
	o.modalonly = true;

	o = s.option(form.ListValue, 'hysteria_obfs_type', _('Obfuscate type'));
	o.value('', _('Disable'));
	o.value('salamander', _('Salamander'));
	o.depends('type', 'hysteria2');
	o.modalonly = true;

	o = s.option(form.Value, 'hysteria_obfs_password', _('Obfuscate password'));
	o.password = true;
	o.depends('type', 'hysteria');
	o.depends({'type': 'hysteria2', 'hysteria_obfs_type': /[\s\S]/});
	o.modalonly = true;

	o = s.option(form.Value, 'hysteria_down_mbps', _('Max download speed'),
		_('Max download speed in Mbps.'));
	o.datatype = 'uinteger';
	o.depends('type', 'hysteria');
	o.depends('type', 'hysteria2');
	o.modalonly = true;

	o = s.option(form.Value, 'hysteria_up_mbps', _('Max upload speed'),
		_('Max upload speed in Mbps.'));
	o.datatype = 'uinteger';
	o.depends('type', 'hysteria');
	o.depends('type', 'hysteria2');
	o.modalonly = true;

	o = s.option(form.Value, 'hysteria_recv_window_conn', _('QUIC stream receive window'),
		_('The QUIC stream-level flow control window for receiving data.'));
	o.datatype = 'uinteger';
	o.depends('type', 'hysteria');
	o.modalonly = true;

	o = s.option(form.Value, 'hysteria_revc_window', _('QUIC connection receive window'),
		_('The QUIC connection-level flow control window for receiving data.'));
	o.datatype = 'uinteger';
	o.depends('type', 'hysteria');
	o.modalonly = true;

	o = s.option(form.Flag, 'hysteria_disable_mtu_discovery', _('Disable Path MTU discovery'),
		_('Disables Path MTU Discovery (RFC 8899). Packets will then be at most 1252 (IPv4) / 1232 (IPv6) bytes in size.'));
	o.depends('type', 'hysteria');
	o.modalonly = true;
	/* Hysteria (2) config end */

	/* Shadowsocks config start */
	o = s.option(form.ListValue, 'shadowsocks_encrypt_method', _('Encrypt method'));
	for (let i of hp.shadowsocks_encrypt_methods)
		o.value(i);
	/* Stream ciphers */
	o.value('aes-128-ctr');
	o.value('aes-192-ctr');
	o.value('aes-256-ctr');
	o.value('aes-128-cfb');
	o.value('aes-192-cfb');
	o.value('aes-256-cfb');
	o.value('chacha20');
	o.value('chacha20-ietf');
	o.value('rc4-md5');
	o.default = 'aes-128-gcm';
	o.depends('type', 'shadowsocks');
	o.rmempty = false;
	o.modalonly = true;

	o = s.option(form.ListValue, 'shadowsocks_plugin', _('Plugin'));
	o.value('', _('none'));
	o.value('obfs-local');
	o.value('v2ray-plugin');
	o.depends('type', 'shadowsocks');
	o.modalonly = true;

	o = s.option(form.Value, 'shadowsocks_plugin_opts', _('Plugin opts'));
	o.depends('shadowsocks_plugin', 'obfs-local');
	o.depends('shadowsocks_plugin', 'v2ray-plugin');
	o.modalonly = true;
	/* Shadowsocks config end */

	/* ShadowTLS transport (overlay for Shadowsocks) */
	o = s.option(form.Flag, 'shadowtls_enabled', _('ShadowTLS transport'),
		_('Wrap this Shadowsocks connection in ShadowTLS for TLS camouflage.'));
	o.depends('type', 'shadowsocks');
	o.rmempty = false;
	o.modalonly = true;

	o = s.option(form.Value, 'shadowtls_password', _('ShadowTLS password'));
	o.password = true;
	o.depends({'type': 'shadowsocks', 'shadowtls_enabled': '1'});
	o.modalonly = true;

	/* ShadowTLS config */
	o = s.option(form.ListValue, 'shadowtls_version', _('ShadowTLS version'));
	o.value('1', _('v1'));
	o.value('2', _('v2'));
	o.value('3', _('v3'));
	o.default = '1';
	o.depends('type', 'shadowtls');
	o.depends({'type': 'shadowsocks', 'shadowtls_enabled': '1'});
	o.rmempty = false;
	o.modalonly = true;

	/* Socks config */
	o = s.option(form.ListValue, 'socks_version', _('Socks version'));
	o.value('4', _('Socks4'));
	o.value('4a', _('Socks4A'));
	o.value('5', _('Socks5'));
	o.default = '5';
	o.depends('type', 'socks');
	o.rmempty = false;
	o.modalonly = true;

	/* SSH config start */
	o = s.option(form.Value, 'ssh_client_version', _('Client version'),
		_('Random version will be used if empty.'));
	o.depends('type', 'ssh');
	o.modalonly = true;

	o = s.option(form.DynamicList, 'ssh_host_key', _('Host key'),
		_('Accept any if empty.'));
	o.depends('type', 'ssh');
	o.modalonly = true;

	o = s.option(form.DynamicList, 'ssh_host_key_algo', _('Host key algorithms'))
	o.depends('type', 'ssh');
	o.modalonly = true;

	o = s.option(form.DynamicList, 'ssh_priv_key', _('Private key'));
	o.password = true;
	o.depends('type', 'ssh');
	o.modalonly = true;

	o = s.option(form.Value, 'ssh_priv_key_pp', _('Private key passphrase'));
	o.password = true;
	o.depends('type', 'ssh');
	o.modalonly = true;
	/* SSH config end */

	/* Mieru config start */
	o = s.option(form.ListValue, 'mieru_protocol', _('Protocol'));
	o.value('TCP', _('TCP'));
	o.value('UDP', _('UDP'));
	o.value('TCP_AND_UDP', _('TCP and UDP'));
	o.depends('type', 'mieru');
	o.rmempty = false;
	o.modalonly = true;

	o = s.option(form.Value, 'mieru_port_range', _('Port range'),
		_('Port range for the Mieru connection, e.g. %s.').format('<code>8080-8180</code>'));
	o.depends('type', 'mieru');
	o.rmempty = false;
	o.modalonly = true;

	o = s.option(form.ListValue, 'mieru_multiplexing', _('Multiplexing'));
	o.value('', _('Default'));
	o.value('MULTIPLEXING_OFF', _('Off'));
	o.value('MULTIPLEXING_LOW', _('Low'));
	o.value('MULTIPLEXING_MIDDLE', _('Middle'));
	o.value('MULTIPLEXING_HIGH', _('High'));
	o.depends('type', 'mieru');
	o.modalonly = true;

	o = s.option(form.Value, 'mieru_handshake_mode', _('Handshake mode'));
	o.depends('type', 'mieru');
	o.modalonly = true;
	/* Mieru config end */

	/* TUIC config start */
	o = s.option(form.Value, 'uuid', _('UUID'));
	o.password = true;
	o.depends('type', 'tuic');
	o.depends('type', 'vless');
	o.depends('type', 'vmess');
	o.validate = hp.validateUUID;
	o.modalonly = true;

	o = s.option(form.ListValue, 'tuic_congestion_control', _('Congestion control algorithm'),
		_('QUIC congestion control algorithm.'));
	o.value('cubic', _('CUBIC'));
	o.value('new_reno', _('New Reno'));
	o.value('bbr', _('BBR'));
	o.default = 'cubic';
	o.depends('type', 'tuic');
	o.rmempty = false;
	o.modalonly = true;

	o = s.option(form.ListValue, 'tuic_udp_relay_mode', _('UDP relay mode'),
		_('UDP packet relay mode.'));
	o.value('', _('Default'));
	o.value('native', _('Native'));
	o.value('quic', _('QUIC'));
	o.depends('type', 'tuic');
	o.modalonly = true;

	o = s.option(form.Flag, 'tuic_udp_over_stream', _('UDP over stream'),
		_('This is the TUIC port of the UDP over TCP protocol, designed to provide a QUIC stream based UDP relay mode that TUIC does not provide.'));
	o.depends({'type': 'tuic','tuic_udp_relay_mode': ''});
	o.modalonly = true;

	o = s.option(form.Flag, 'tuic_enable_zero_rtt', _('Enable 0-RTT handshake'),
		_('Enable 0-RTT QUIC connection handshake on the client side. This is not impacting much on the performance, as the protocol is fully multiplexed.<br/>' +
			'Disabling this is highly recommended, as it is vulnerable to replay attacks.'));
	o.depends('type', 'tuic');
	o.modalonly = true;

	o = s.option(form.Value, 'tuic_heartbeat', _('Heartbeat interval'),
		_('Interval for sending heartbeat packets for keeping the connection alive (in seconds).'));
	o.datatype = 'uinteger';
	o.default = '10';
	o.depends('type', 'tuic');
	o.modalonly = true;
	/* Tuic config end */

	/* VMess / VLESS config start */
	o = s.option(form.ListValue, 'vless_flow', _('Flow'));
	o.value('', _('None'));
	o.value('xtls-rprx-vision');
	o.depends('type', 'vless');
	o.modalonly = true;

	o = s.option(form.Value, 'vmess_alterid', _('Alter ID'),
		_('Legacy protocol support (VMess MD5 Authentication) is provided for compatibility purposes only, use of alterId > 1 is not recommended.'));
	o.datatype = 'uinteger';
	o.depends('type', 'vmess');
	o.modalonly = true;

	o = s.option(form.ListValue, 'vmess_encrypt', _('Encrypt method'));
	o.value('auto');
	o.value('none');
	o.value('zero');
	o.value('aes-128-gcm');
	o.value('chacha20-poly1305');
	o.default = 'auto';
	o.depends('type', 'vmess');
	o.rmempty = false;
	o.modalonly = true;

	o = s.option(form.Flag, 'vmess_global_padding', _('Global padding'),
		_('Protocol parameter. Will waste traffic randomly if enabled (enabled by default in v2ray and cannot be disabled).'));
	o.default = o.enabled;
	o.depends('type', 'vmess');
	o.rmempty = false;
	o.modalonly = true;

	o = s.option(form.Flag, 'vmess_authenticated_length', _('Authenticated length'),
		_('Protocol parameter. Enable length block encryption.'));
	o.depends('type', 'vmess');
	o.modalonly = true;
	/* VMess config end */

	/* Transport config start */
	o = s.option(form.ListValue, 'transport', _('Transport'),
		_('No TCP transport, plain HTTP is merged into the HTTP transport.'));
	o.value('', _('None'));
	o.value('grpc', _('gRPC'));
	o.value('http', _('HTTP'));
	o.value('httpupgrade', _('HTTPUpgrade'));
	o.value('quic', _('QUIC'));
	o.value('ws', _('WebSocket'));
	o.value('xhttp', _('XHTTP'));
	o.depends('type', 'trojan');
	o.depends('type', 'vless');
	o.depends('type', 'vmess');
	o.onchange = function(ev, section_id, value) {
		let desc = this.map.findElement('id', 'cbid.homeproxy.%s.transport'.format(section_id)).nextElementSibling;
		if (value === 'http')
			desc.innerHTML = _('TLS is not enforced. If TLS is not configured, plain HTTP 1.1 is used.');
		else if (value === 'quic')
			desc.innerHTML = _('No additional encryption support: It\'s basically duplicate encryption.');
		else
			desc.innerHTML = _('No TCP transport, plain HTTP is merged into the HTTP transport.');

		let tls = this.map.findElement('id', 'cbid.homeproxy.%s.tls'.format(section_id)).firstElementChild;
		if ((value === 'http' && tls.checked) || (value === 'grpc' && !features.with_grpc)) {
			this.map.findElement('id', 'cbid.homeproxy.%s.http_idle_timeout'.format(section_id)).nextElementSibling.innerHTML =
				_('Specifies the period of time (in seconds) after which a health check will be performed using a ping frame if no frames have been received on the connection.<br/>' +
					'Please note that a ping response is considered a received frame, so if there is no other traffic on the connection, the health check will be executed every interval.');

			this.map.findElement('id', 'cbid.homeproxy.%s.http_ping_timeout'.format(section_id)).nextElementSibling.innerHTML =
				_('Specifies the timeout duration (in seconds) after sending a PING frame, within which a response must be received.<br/>' +
					'If a response to the PING frame is not received within the specified timeout duration, the connection will be closed.');
		} else if (value === 'grpc' && features.with_grpc) {
			this.map.findElement('id', 'cbid.homeproxy.%s.http_idle_timeout'.format(section_id)).nextElementSibling.innerHTML =
				_('If the transport doesn\'t see any activity after a duration of this time (in seconds), it pings the client to check if the connection is still active.');

			this.map.findElement('id', 'cbid.homeproxy.%s.http_ping_timeout'.format(section_id)).nextElementSibling.innerHTML =
				_('The timeout (in seconds) that after performing a keepalive check, the client will wait for activity. If no activity is detected, the connection will be closed.');
		}
	}
	o.modalonly = true;

	/* gRPC config start */
	o = s.option(form.Value, 'grpc_servicename', _('gRPC service name'));
	o.depends('transport', 'grpc');
	o.modalonly = true;

	if (features.with_grpc) {
		o = s.option(form.Flag, 'grpc_permit_without_stream', _('gRPC permit without stream'),
			_('If enabled, the client transport sends keepalive pings even with no active connections.'));
		o.depends('transport', 'grpc');
		o.modalonly = true;
	}
	/* gRPC config end */

	/* HTTP(Upgrade) config start */
	o = s.option(form.DynamicList, 'http_host', _('Host'));
	o.datatype = 'hostname';
	o.depends('transport', 'http');
	o.depends('transport', 'xhttp');
	o.modalonly = true;

	o = s.option(form.Value, 'httpupgrade_host', _('Host'));
	o.datatype = 'hostname';
	o.depends('transport', 'httpupgrade');
	o.modalonly = true;

	o = s.option(form.Value, 'http_path', _('Path'));
	o.depends('transport', 'http');
	o.depends('transport', 'httpupgrade');
	o.depends('transport', 'xhttp');
	o.modalonly = true;

	o = s.option(form.Value, 'http_method', _('Method'));
	o.value('GET', _('GET'));
	o.value('PUT', _('PUT'));
	o.depends('transport', 'http');
	o.modalonly = true;

	o = s.option(form.Value, 'http_idle_timeout', _('Idle timeout'),
		_('Specifies the period of time (in seconds) after which a health check will be performed using a ping frame if no frames have been received on the connection.<br/>' +
			'Please note that a ping response is considered a received frame, so if there is no other traffic on the connection, the health check will be executed every interval.'));
	o.datatype = 'uinteger';
	o.depends('transport', 'grpc');
	o.depends({'transport': 'http', 'tls': '1'});
	o.modalonly = true;

	o = s.option(form.Value, 'http_ping_timeout', _('Ping timeout'),
		_('Specifies the timeout duration (in seconds) after sending a PING frame, within which a response must be received.<br/>' +
			'If a response to the PING frame is not received within the specified timeout duration, the connection will be closed.'));
	o.datatype = 'uinteger';
	o.depends('transport', 'grpc');
	o.depends({'transport': 'http', 'tls': '1'});
	o.modalonly = true;
	/* HTTP config end */

	/* WebSocket config start */
	o = s.option(form.Value, 'ws_host', _('Host'));
	o.depends('transport', 'ws');
	o.modalonly = true;

	o = s.option(form.Value, 'ws_path', _('Path'));
	o.depends('transport', 'ws');
	o.modalonly = true;

	o = s.option(form.Value, 'websocket_early_data', _('Early data'),
		_('Allowed payload size is in the request.'));
	o.datatype = 'uinteger';
	o.value('2048');
	o.depends('transport', 'ws');
	o.modalonly = true;

	o = s.option(form.Value, 'websocket_early_data_header', _('Early data header name'));
	o.value('Sec-WebSocket-Protocol');
	o.depends('transport', 'ws');
	o.modalonly = true;
	/* WebSocket config end */

	/* XHTTP config start */
	o = s.option(form.ListValue, 'xhttp_mode', _('XHTTP mode'));
	o.value('auto', _('Auto'));
	o.value('packet-up', _('Packet up'));
	o.value('packet-down', _('Packet down'));
	o.value('stream-up', _('Stream up'));
	o.value('stream-down', _('Stream down'));
	o.value('bidi', _('Bidi'));
	o.depends('transport', 'xhttp');
	o.modalonly = true;

	o = s.option(form.Value, 'xhttp_headers', _('Extra headers'),
		_('JSON object, e.g. {"X-Header": "value"}. Leave empty for none.'));
	o.depends('transport', 'xhttp');
	o.modalonly = true;
	/* XHTTP config end */

	o = s.option(form.ListValue, 'packet_encoding', _('Packet encoding'));
	o.value('', _('none'));
	o.value('packetaddr', _('packet addr (v2ray-core v5+)'));
	o.value('xudp', _('Xudp (Xray-core)'));
	o.depends('type', 'vless');
	o.depends('type', 'vmess');
	o.modalonly = true;
	/* Transport config end */

	/* Wireguard config start */
	o = s.option(form.DynamicList, 'wireguard_local_address', _('Local address'),
		_('List of IP (v4 or v6) addresses prefixes to be assigned to the interface.'));
	o.datatype = 'cidr';
	o.depends('type', 'wireguard');
	o.depends('type', 'amneziawg');
	o.rmempty = false;
	o.modalonly = true;

	o = s.option(form.Value, 'wireguard_private_key', _('Private key'),
		_('WireGuard requires base64-encoded private keys.'));
	o.password = true;
	o.depends('type', 'wireguard');
	o.depends('type', 'amneziawg');
	o.validate = L.bind(hp.validateBase64Key, this, 44);
	o.rmempty = false;
	o.modalonly = true;

	o = s.option(form.Value, 'wireguard_peer_public_key', _('Peer pubkic key'),
		_('WireGuard peer public key.'));
	o.depends('type', 'wireguard');
	o.depends('type', 'amneziawg');
	o.validate = L.bind(hp.validateBase64Key, this, 44);
	o.rmempty = false;
	o.modalonly = true;

	o = s.option(form.Value, 'wireguard_pre_shared_key', _('Pre-shared key'),
		_('WireGuard pre-shared key.'));
	o.password = true;
	o.depends('type', 'wireguard');
	o.depends('type', 'amneziawg');
	o.validate = L.bind(hp.validateBase64Key, this, 44);
	o.modalonly = true;

	o = s.option(form.DynamicList, 'wireguard_reserved', _('Reserved field bytes'));
	o.datatype = 'integer';
	o.depends('type', 'wireguard');
	o.modalonly = true;

	o = s.option(form.Value, 'wireguard_mtu', _('MTU'));
	o.datatype = 'range(0,9000)';
	o.placeholder = '1408';
	o.depends('type', 'wireguard');
	o.depends('type', 'amneziawg');
	o.modalonly = true;

	o = s.option(form.Value, 'wireguard_persistent_keepalive_interval', _('Persistent keepalive interval'),
		_('In seconds. Disabled by default.'));
	o.datatype = 'uinteger';
	o.depends('type', 'wireguard');
	o.depends('type', 'amneziawg');
	o.modalonly = true;
	/* Wireguard config end */

	/* AmneziaWG config start */
	o = s.option(form.Value, 'amnezia_jc', _('Jc'),
		_('Junk packet count.'));
	o.datatype = 'uinteger';
	o.depends('type', 'amneziawg');
	o.rmempty = false;
	o.modalonly = true;

	o = s.option(form.Value, 'amnezia_jmin', _('Jmin'),
		_('Junk packet minimum size.'));
	o.datatype = 'uinteger';
	o.depends('type', 'amneziawg');
	o.rmempty = false;
	o.modalonly = true;

	o = s.option(form.Value, 'amnezia_jmax', _('Jmax'),
		_('Junk packet maximum size.'));
	o.datatype = 'uinteger';
	o.depends('type', 'amneziawg');
	o.rmempty = false;
	o.modalonly = true;

	o = s.option(form.Value, 'amnezia_s1', _('S1'));
	o.datatype = 'uinteger';
	o.depends('type', 'amneziawg');
	o.rmempty = false;
	o.modalonly = true;

	o = s.option(form.Value, 'amnezia_s2', _('S2'));
	o.datatype = 'uinteger';
	o.depends('type', 'amneziawg');
	o.rmempty = false;
	o.modalonly = true;

	o = s.option(form.Value, 'amnezia_s3', _('S3'));
	o.datatype = 'uinteger';
	o.depends('type', 'amneziawg');
	o.modalonly = true;

	o = s.option(form.Value, 'amnezia_s4', _('S4'));
	o.datatype = 'uinteger';
	o.depends('type', 'amneziawg');
	o.modalonly = true;

	o = s.option(form.Value, 'amnezia_h1', _('H1'),
		_('Magic header range, e.g. 426560850-1096521767'));
	o.depends('type', 'amneziawg');
	o.rmempty = false;
	o.modalonly = true;

	o = s.option(form.Value, 'amnezia_h2', _('H2'),
		_('Magic header range, e.g. 1603445073-1836768565'));
	o.depends('type', 'amneziawg');
	o.rmempty = false;
	o.modalonly = true;

	o = s.option(form.Value, 'amnezia_h3', _('H3'),
		_('Magic header range, e.g. 2047861992-2141668339'));
	o.depends('type', 'amneziawg');
	o.rmempty = false;
	o.modalonly = true;

	o = s.option(form.Value, 'amnezia_h4', _('H4'),
		_('Magic header range, e.g. 2141792848-2142674170'));
	o.depends('type', 'amneziawg');
	o.rmempty = false;
	o.modalonly = true;

	o = s.option(form.Value, 'amnezia_i1', _('I1'),
		_('Optional cookie byte sequence in &lt;b 0x...&gt; format.'));
	o.depends('type', 'amneziawg');
	o.modalonly = true;

	o = s.option(form.Value, 'amnezia_i2', _('I2'));
	o.depends('type', 'amneziawg');
	o.modalonly = true;

	o = s.option(form.Value, 'amnezia_i3', _('I3'));
	o.depends('type', 'amneziawg');
	o.modalonly = true;

	o = s.option(form.Value, 'amnezia_i4', _('I4'));
	o.depends('type', 'amneziawg');
	o.modalonly = true;

	o = s.option(form.Value, 'amnezia_i5', _('I5'));
	o.depends('type', 'amneziawg');
	o.modalonly = true;

	o = s.option(form.Value, 'amnezia_j1', _('J1'));
	o.depends('type', 'amneziawg');
	o.modalonly = true;

	o = s.option(form.Value, 'amnezia_j2', _('J2'));
	o.depends('type', 'amneziawg');
	o.modalonly = true;

	o = s.option(form.Value, 'amnezia_j3', _('J3'));
	o.depends('type', 'amneziawg');
	o.modalonly = true;

	o = s.option(form.Value, 'amnezia_itime', _('ITime'));
	o.datatype = 'uinteger';
	o.depends('type', 'amneziawg');
	o.modalonly = true;
	/* AmneziaWG config end */

	/* Mux config start */
	o = s.option(form.Flag, 'multiplex', _('Multiplex'));
	o.depends('type', 'shadowsocks');
	o.depends('type', 'trojan');
	o.depends('type', 'vless');
	o.depends('type', 'vmess');
	o.modalonly = true;

	o = s.option(form.ListValue, 'multiplex_protocol', _('Protocol'),
		_('Multiplex protocol.'));
	o.value('h2mux');
	o.value('smux');
	o.value('yamux');
	o.default = 'h2mux';
	o.depends('multiplex', '1');
	o.rmempty = false;
	o.modalonly = true;

	o = s.option(form.Value, 'multiplex_max_connections', _('Maximum connections'));
	o.datatype = 'uinteger';
	o.depends('multiplex', '1');
	o.modalonly = true;

	o = s.option(form.Value, 'multiplex_min_streams', _('Minimum streams'),
		_('Minimum multiplexed streams in a connection before opening a new connection.'));
	o.datatype = 'uinteger';
	o.depends('multiplex', '1');
	o.modalonly = true;

	o = s.option(form.Value, 'multiplex_max_streams', _('Maximum streams'),
		_('Maximum multiplexed streams in a connection before opening a new connection.<br/>' +
			'Conflict with <code>%s</code> and <code>%s</code>.').format(
				_('Maximum connections'), _('Minimum streams')));
	o.datatype = 'uinteger';
	o.depends({'multiplex': '1', 'multiplex_max_connections': '', 'multiplex_min_streams': ''});
	o.modalonly = true;

	o = s.option(form.Flag, 'multiplex_padding', _('Enable padding'));
	o.depends('multiplex', '1');
	o.modalonly = true;

	o = s.option(form.Flag, 'multiplex_brutal', _('Enable TCP Brutal'),
		_('Enable TCP Brutal congestion control algorithm'));
	o.depends('multiplex', '1');
	o.modalonly = true;

	o = s.option(form.Value, 'multiplex_brutal_down', _('Download bandwidth'),
		_('Download bandwidth in Mbps.'));
	o.datatype = 'uinteger';
	o.depends('multiplex_brutal', '1');
	o.modalonly = true;

	o = s.option(form.Value, 'multiplex_brutal_up', _('Upload bandwidth'),
		_('Upload bandwidth in Mbps.'));
	o.datatype = 'uinteger';
	o.depends('multiplex_brutal', '1');
	o.modalonly = true;
	/* Mux config end */

	/* TLS config start */
	o = s.option(form.Flag, 'tls', _('TLS'));
	o.depends('type', 'anytls');
	o.depends('type', 'http');
	o.depends('type', 'hysteria');
	o.depends('type', 'hysteria2');
	o.depends('type', 'naive');
	o.depends('type', 'shadowtls');
	o.depends('type', 'trojan');
	o.depends('type', 'tuic');
	o.depends('type', 'vless');
	o.depends('type', 'vmess');
	o.validate = function(section_id, _value) {
		if (section_id) {
			let type = this.map.lookupOption('type', section_id)[0].formvalue(section_id);
			let tls = this.map.findElement('id', 'cbid.homeproxy.%s.tls'.format(section_id)).firstElementChild;

			if (['anytls', 'hysteria', 'hysteria2', 'shadowtls', 'tuic'].includes(type)) {
				tls.checked = true;
				tls.disabled = true;
			} else {
				tls.disabled = null;
			}
		}

		return true;
	}
	o.modalonly = true;

	o = s.option(form.Value, 'tls_sni', _('TLS SNI'),
		_('Used to verify the hostname on the returned certificates unless insecure is given.'));
	o.depends('tls', '1');
	o.depends({'type': 'shadowsocks', 'shadowtls_enabled': '1'});
	o.modalonly = true;

	o = s.option(form.DynamicList, 'tls_alpn', _('TLS ALPN'),
		_('List of supported application level protocols, in order of preference.'));
	o.depends('tls', '1');
	o.modalonly = true;

	o = s.option(form.Flag, 'tls_insecure', _('Allow insecure'),
		_('Allow insecure connection at TLS client.') +
		'<br/>' +
		_('This is <strong>DANGEROUS</strong>, your traffic is almost like <strong>PLAIN TEXT</strong>! Use at your own risk!'));
	o.depends('tls', '1');
	o.depends({'type': 'shadowsocks', 'shadowtls_enabled': '1'});
	o.onchange = allowInsecureConfirm;
	o.modalonly = true;

	o = s.option(form.ListValue, 'tls_min_version', _('Minimum TLS version'),
		_('The minimum TLS version that is acceptable.'));
	o.value('', _('default'));
	for (let i of hp.tls_versions)
		o.value(i);
	o.depends('tls', '1');
	o.modalonly = true;

	o = s.option(form.ListValue, 'tls_max_version', _('Maximum TLS version'),
		_('The maximum TLS version that is acceptable.'));
	o.value('', _('default'));
	for (let i of hp.tls_versions)
		o.value(i);
	o.depends('tls', '1');
	o.modalonly = true;

	o = s.option(hp.CBIStaticList, 'tls_cipher_suites', _('Cipher suites'),
		_('The elliptic curves that will be used in an ECDHE handshake, in preference order. If empty, the default will be used.'));
	for (let i of hp.tls_cipher_suites)
		o.value(i);
	o.depends('tls', '1');
	o.optional = true;
	o.modalonly = true;

	o = s.option(form.Flag, 'tls_self_sign', _('Append self-signed certificate'),
		_('If you have the root certificate, use this option instead of allowing insecure.'));
	o.depends('tls_insecure', '0');
	o.modalonly = true;

	o = s.option(form.Value, 'tls_cert_path', _('Certificate path'),
		_('The path to the server certificate, in PEM format.'));
	o.value('/etc/homeproxy/certs/client_ca.pem');
	o.depends('tls_self_sign', '1');
	o.validate = hp.validateCertificatePath;
	o.rmempty = false;
	o.modalonly = true;

	o = s.option(form.Button, '_upload_cert', _('Upload certificate'),
		_('<strong>Save your configuration before uploading files!</strong>'));
	o.inputstyle = 'action';
	o.inputtitle = _('Upload...');
	o.depends({'tls_self_sign': '1', 'tls_cert_path': '/etc/homeproxy/certs/client_ca.pem'});
	o.onclick = L.bind(hp.uploadCertificate, this, _('certificate'), 'client_ca');
	o.modalonly = true;

	o = s.option(form.Flag, 'tls_ech', _('Enable ECH'),
		_('ECH (Encrypted Client Hello) is a TLS extension that allows a client to encrypt the first part of its ClientHello message.'));
	o.depends('tls', '1');
	o.modalonly = true;

	o = s.option(form.Value, 'tls_ech_config_path', _('ECH config path'),
		_('The path to the ECH config, in PEM format. If empty, load from DNS will be attempted.'));
	o.value('/etc/homeproxy/certs/client_ech_conf.pem');
	o.depends('tls_ech', '1');
	o.modalonly = true;

	o = s.option(form.Button, '_upload_ech_config', _('Upload ECH config'),
		_('<strong>Save your configuration before uploading files!</strong>'));
	o.inputstyle = 'action';
	o.inputtitle = _('Upload...');
	o.depends({'tls_ech': '1', 'tls_ech_config_path': '/etc/homeproxy/certs/client_ech_conf.pem'});
	o.onclick = L.bind(hp.uploadCertificate, this, _('ECH config'), 'client_ech_conf');
	o.modalonly = true;

	if (features.with_utls) {
		o = s.option(form.ListValue, 'tls_utls', _('uTLS fingerprint'),
			_('uTLS is a fork of "crypto/tls", which provides ClientHello fingerprinting resistance.'));
		o.value('', _('Disable'));
		o.value('360');
		o.value('android');
		o.value('chrome');
		o.value('edge');
		o.value('firefox');
		o.value('ios');
		o.value('qq');
		o.value('random');
		o.value('randomized');
		o.value('safari');
		o.depends({'tls': '1', 'type': /^((?!hysteria2?|tuic$).)+$/});
		o.depends({'type': 'shadowsocks', 'shadowtls_enabled': '1'});
		o.validate = function(section_id, value) {
			if (section_id) {
				let tls_reality = this.map.findElement('id', 'cbid.homeproxy.%s.tls_reality'.format(section_id)).firstElementChild;
				if (tls_reality.checked && !value)
					return _('Expecting: %s').format(_('non-empty value'));

				let vless_flow = this.map.lookupOption('vless_flow', section_id)[0].formvalue(section_id);
				if ((tls_reality.checked || vless_flow) && ['360', 'android'].includes(value))
					return _('Unsupported fingerprint!');
			}

			return true;
		}
		o.modalonly = true;

		o = s.option(form.Flag, 'tls_reality', _('REALITY'));
		o.depends({'tls': '1', 'type': 'anytls'});
		o.depends({'tls': '1', 'type': 'vless'});
		o.modalonly = true;

		o = s.option(form.Value, 'tls_reality_public_key', _('REALITY public key'));
		o.password = true;
		o.depends('tls_reality', '1');
		o.rmempty = false;
		o.modalonly = true;

		o = s.option(form.Value, 'tls_reality_short_id', _('REALITY short ID'));
		o.password = true;
		o.depends('tls_reality', '1');
		o.modalonly = true;
	}
	/* TLS config end */

	/* Extra settings start */
	o = s.option(form.Flag, 'tcp_fast_open', _('TCP fast open'));
	o.modalonly = true;

	o = s.option(form.Flag, 'tcp_multi_path', _('MultiPath TCP'));
	o.modalonly = true;

	o = s.option(form.Flag, 'udp_fragment', _('UDP Fragment'),
		_('Enable UDP fragmentation.'));
	o.modalonly = true;

	o = s.option(widgets.DeviceSelect, 'bind_interface', _('Binded interface'),
		_('The network interface to bind to.'));
	o.multiple = false;
	o.noaliases = true;
	o.modalonly = true;

	o = s.option(form.Flag, 'udp_over_tcp', _('UDP over TCP'),
		_('Enable the SUoT protocol, requires server support. Conflict with multiplex.'));
	o.depends('type', 'socks');
	o.depends({'type': 'shadowsocks', 'multiplex': '0'});
	o.modalonly = true;

	o = s.option(form.ListValue, 'udp_over_tcp_version', _('SUoT version'));
	o.value('1', _('v1'));
	o.value('2', _('v2'));
	o.default = '2';
	o.depends('udp_over_tcp', '1');
	o.modalonly = true;
	/* Extra settings end */

	return s;
}

return view.extend({
	load() {
		return Promise.all([
			uci.load('homeproxy'),
			hp.getBuiltinFeatures()
		]);
	},

	render(data) {
		let m, s, o, ss, so;
		let main_node = uci.get(data[0], 'config', 'main_node');
		let routing_mode = uci.get(data[0], 'config', 'routing_mode');
		let features = data[1];

		/* Cache subscription information, it will be called multiple times */
		let subinfo = [];
		for (let suburl of (uci.get(data[0], 'subscription', 'subscription_url') || [])) {
			const url = new URL(suburl);
			const urlhash = hp.calcStringMD5(suburl.replace(/#.*$/, ''));
			const title = url.hash ? decodeURIComponent(url.hash.slice(1)) : url.hostname;
			subinfo.push({ 'hash': urlhash, 'title': title });
		}

		m = new form.Map('homeproxy', _('Edit nodes'));

		s = m.section(form.NamedSection, 'subscription', 'homeproxy');

		/* Node settings start */
		/* User nodes start */
		s.tab('node', _('Nodes'));
		o = s.taboption('node', form.SectionValue, '_node', form.GridSection, 'node');
		ss = renderNodeSettings(o.subsection, data, features, main_node, routing_mode);
		ss.addremove = true;
		ss.filter = function(section_id) {
			for (let info of subinfo)
				if (info.hash === uci.get(data[0], section_id, 'grouphash'))
					return false;

			return true;
		}
		/* Import subscription links start */
		/* Thanks to luci-app-shadowsocks-libev */
		ss.handleLinkImport = function() {
			let textarea = new ui.Textarea();
			ui.showModal(_('Import share links'), [
				E('p', _('Support Amnezia (vpn://), Hysteria, Mieru, NaïveProxy (naive://), Shadowsocks (ss://), SSH, Trojan, v2rayN (VMess), WireGuard, and VLESS (vless://) online configuration delivery standard.')),
				textarea.render(),
				E('div', { class: 'right' }, [
					E('button', {
						class: 'btn',
						click: ui.hideModal
					}, [ _('Cancel') ]),
					'',
					E('button', {
						class: 'btn cbi-button-action',
						click: ui.createHandlerFn(this, function() {
							let input_links = textarea.getValue().trim().split('\n')
								.map(l => l.trim()).filter(Boolean);
							if (!input_links.length)
								return ui.hideModal();

							/* Remove duplicates */
							input_links = [...new Set(input_links)];

							let allow_insecure = uci.get(data[0], 'subscription', 'allow_insecure');
							let packet_encoding = uci.get(data[0], 'subscription', 'packet_encoding');
							const total = input_links.length;

							const vpnLinks = input_links.filter(l => l.startsWith('vpn://'));
							const uriLinks = input_links.filter(l => !l.startsWith('vpn://'));

							return Promise.all(vpnLinks.map(l => parseVpnLink(l).catch(() => null)))
								.then(vpnConfigs => {
									const configs = [
										...vpnConfigs.filter(Boolean),
										...uriLinks.map(l => parseShareLink(l, features)).filter(Boolean)
									];

									let imported_node = 0;
									configs.forEach((config) => {
										if (config.tls === '1' && allow_insecure === '1')
											config.tls_insecure = '1';
										if (['vless', 'vmess'].includes(config.type))
											config.packet_encoding = packet_encoding;

										let nameHash = hp.calcStringMD5(config.label);
										let sid = uci.add(data[0], 'node', nameHash);
										Object.keys(config).forEach((k) => {
											uci.set(data[0], sid, k, config[k]);
										});
										imported_node++;
									});

									if (imported_node === 0)
										ui.addNotification(null, E('p', _('No valid share link found.')));
									else
										ui.addNotification(null, E('p', _('Successfully imported %s nodes of total %s.').format(
											imported_node, total)));

									return uci.save()
										.then(L.bind(this.map.load, this.map))
										.then(L.bind(this.map.reset, this.map))
										.then(L.ui.hideModal)
										.catch(() => {});
								});
						})
					}, [ _('Import') ])
				])
			])
		}
		ss.handleConfImport = function() {
			const fileInput = E('input', { type: 'file', accept: '.conf', style: 'display:block;margin:8px 0' });
			ui.showModal(_('Import .conf file'), [
				E('p', _('Select a WireGuard or AmneziaWG .conf file.')),
				fileInput,
				E('div', { class: 'right' }, [
					E('button', { class: 'btn', click: ui.hideModal }, [ _('Cancel') ]),
					' ',
					E('button', {
						class: 'btn cbi-button-action',
						click: ui.createHandlerFn(this, function() {
							const file = fileInput.files[0];
							if (!file) return ui.hideModal();

							return new Promise((resolve) => {
								const reader = new FileReader();
								reader.onload = (ev) => resolve(ev.target.result);
								reader.readAsText(file);
							}).then((text) => {
								const config = parseWireGuardConf(text);
								if (!config) {
									ui.hideModal();
									return ui.addNotification(null, E('p', _('No valid WireGuard/AmneziaWG config found.')));
								}

								const existingLabels = new Set(
									uci.sections(data[0], 'node').map(s => s.label).filter(Boolean)
								);
								if (existingLabels.has(config.label)) {
									const base = config.label;
									let n = 2;
									while (existingLabels.has(base + '-' + n)) n++;
									config.label = base + '-' + n;
								}

								const sid = uci.add(data[0], 'node');
								for (const [k, v] of Object.entries(config))
									if (v != null) uci.set(data[0], sid, k, Array.isArray(v) ? v : String(v));

								return uci.save()
									.then(L.bind(this.map.load, this.map))
									.then(L.bind(this.map.reset, this.map))
									.then(L.ui.hideModal)
									.then(() => ui.addNotification(null, E('p', _('Successfully imported node: %s').format(config.label))))
									.catch(() => {});
							});
						})
					}, [ _('Import') ])
				])
			]);
		}

		ss.renderSectionAdd = function(/* ... */) {
			let el = form.GridSection.prototype.renderSectionAdd.apply(this, arguments),
				nameEl = el.querySelector('.cbi-section-create-name');

			ui.addValidator(nameEl, 'uciname', true, (v) => {
				let button = el.querySelector('.cbi-section-create > .cbi-button-add');
				let uciconfig = this.uciconfig || this.map.config;

				if (!v) {
					button.disabled = true;
					return true;
				} else if (uci.get(uciconfig, v)) {
					button.disabled = true;
					return _('Expecting: %s').format(_('unique UCI identifier'));
				} else {
					button.disabled = null;
					return true;
				}
			}, 'blur', 'keyup');

			el.appendChild(E('button', {
				'class': 'cbi-button cbi-button-add',
				'title': _('Import share links'),
				'click': ui.createHandlerFn(this, 'handleLinkImport')
			}, [ _('Import share links') ]));

			el.appendChild(E('button', {
				'class': 'cbi-button cbi-button-add',
				'title': _('Import .conf file'),
				'click': ui.createHandlerFn(this, 'handleConfImport')
			}, [ _('Import .conf') ]));

			return el;
		}
		/* Import subscription links end */
		/* User nodes end */

		/* Subscription nodes start */
		for (const info of subinfo) {
			s.tab('sub_' + info.hash, _('Sub (%s)').format(info.title));
			o = s.taboption('sub_' + info.hash, form.SectionValue, '_sub_' + info.hash, form.GridSection, 'node');
			ss = renderNodeSettings(o.subsection, data, features, main_node, routing_mode);
			ss.filter = function(section_id) {
				return (uci.get(data[0], section_id, 'grouphash') === info.hash);
			}
		}
		/* Subscription nodes end */
		/* Node settings end */

		/* Subscriptions settings start */
		s.tab('subscription', _('Subscriptions'));

		o = s.taboption('subscription', form.Flag, 'auto_update', _('Auto update'),
			_('Auto update subscriptions and geodata.'));
		o.rmempty = false;

		o = s.taboption('subscription', form.ListValue, 'auto_update_time', _('Update time'));
		for (let i = 0; i < 24; i++)
			o.value(i, i + ':00');
		o.default = '2';
		o.depends('auto_update', '1');

		o = s.taboption('subscription', form.Flag, 'update_via_proxy', _('Update via proxy'),
			_('Update subscriptions via proxy.'));
		o.rmempty = false;

		o = s.taboption('subscription', form.DynamicList, 'subscription_url', _('Subscription URL-s'),
			_('Support Hysteria, Shadowsocks, Trojan, v2rayN (VMess), and XTLS (VLESS) online configuration delivery standard.'));
		o.validate = function(section_id, value) {
			if (section_id && value) {
				try {
					let url = new URL(value);
					if (!url.hostname)
						return _('Expecting: %s').format(_('valid URL'));
				}
				catch(e) {
					return _('Expecting: %s').format(_('valid URL'));
				}
			}

			return true;
		}

		o = s.taboption('subscription', form.ListValue, 'filter_nodes', _('Filter nodes'),
			_('Drop/keep specific nodes from subscriptions.'));
		o.value('disabled', _('Disable'));
		o.value('blacklist', _('Blacklist mode'));
		o.value('whitelist', _('Whitelist mode'));
		o.default = 'disabled';
		o.rmempty = false;

		o = s.taboption('subscription', form.DynamicList, 'filter_keywords', _('Filter keywords'),
			_('Drop/keep nodes that contain the specific keywords. <a target="_blank" href="https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions">Regex</a> is supported.'));
		o.depends({'filter_nodes': 'disabled', '!reverse': true});
		o.rmempty = false;

		o = s.taboption('subscription', form.Value, 'user_agent', _('User-Agent'));
		o.placeholder = 'Wget/1.21 (HomeProxy, like v2rayN)';

		o = s.taboption('subscription', form.Flag, 'allow_insecure', _('Allow insecure'),
			_('Allow insecure connection by default when add nodes from subscriptions.') +
			'<br/>' +
			_('This is <strong>DANGEROUS</strong>, your traffic is almost like <strong>PLAIN TEXT</strong>! Use at your own risk!'));
		o.rmempty = false;
		o.onchange = allowInsecureConfirm;

		o = s.taboption('subscription', form.ListValue, 'packet_encoding', _('Default packet encoding'));
		o.value('', _('none'));
		o.value('packetaddr', _('packet addr (v2ray-core v5+)'));
		o.value('xudp', _('Xudp (Xray-core)'));

		o = s.taboption('subscription', form.Button, '_save_subscriptions', _('Save subscriptions settings'),
			_('NOTE: Save current settings before updating subscriptions.'));
		o.inputstyle = 'apply';
		o.inputtitle = _('Save current settings');
		o.onclick = function() {
			return this.map.save(null, true).then(() => {
				ui.changes.apply(true);
			});
		}

		o = s.taboption('subscription', form.Button, '_update_subscriptions', _('Update nodes from subscriptions'));
		o.inputstyle = 'apply';
		o.inputtitle = function(section_id) {
			let sublist = uci.get(data[0], section_id, 'subscription_url') || [];
			if (sublist.length > 0) {
				return _('Update %s subscriptions').format(sublist.length);
			} else {
				this.readonly = true;
				return _('No subscription available')
			}
		}
		o.onclick = function() {
			ui.showModal(_('Updating subscriptions'), [
				E('p', { 'class': 'spinning' }, _('Fetching nodes, please wait...'))
			]);

			return fs.exec_direct('/etc/homeproxy/scripts/update_subscriptions.uc').then(() => {
				return location.reload();
			}).catch((err) => {
				ui.hideModal();
				ui.addNotification(null, E('p', _('An error occurred during updating subscriptions: %s').format(err)));
				return this.map.reset();
			});
		}

		o = s.taboption('subscription', form.Button, '_remove_subscriptions', _('Remove all nodes from subscriptions'));
		o.inputstyle = 'reset';
		o.inputtitle = function() {
			let subnodes = [];
			uci.sections(data[0], 'node', (res) => {
				if (res.grouphash)
					subnodes = subnodes.concat(res['.name'])
			});

			if (subnodes.length > 0) {
				return _('Remove %s nodes').format(subnodes.length);
			} else {
				this.readonly = true;
				return _('No subscription node');
			}
		}
		o.onclick = function() {
			let subnodes = [];
			uci.sections(data[0], 'node', (res) => {
				if (res.grouphash)
					subnodes = subnodes.concat(res['.name'])
			});

			for (let i in subnodes)
				uci.remove(data[0], subnodes[i]);

			if (subnodes.includes(uci.get(data[0], 'config', 'main_node')))
				uci.set(data[0], 'config', 'main_node', 'nil');

			if (subnodes.includes(uci.get(data[0], 'config', 'main_udp_node')))
				uci.set(data[0], 'config', 'main_udp_node', 'nil');

			this.inputtitle = _('%s nodes removed').format(subnodes.length);
			this.readonly = true;

			return this.map.save(null, true);
		}
		/* Subscriptions settings end */

		/* ByeDPI settings start */
		s.tab('byedpi', _('ByeDPI'));
		let byedpiSV = s.taboption('byedpi', form.SectionValue, '_byedpi', form.NamedSection, 'config', 'homeproxy');
		ss = byedpiSV.subsection;
		ss.anonymous = true;
		ss.addremove = false;

		o = ss.option(form.Flag, 'byedpi_udp_over_tcp', _('UDP over TCP'),
			_('Wrap UDP traffic in TCP when routing to ByeDPI.'));
		o.default = o.enabled;
		o.rmempty = false;

		(function() {
			const BYEDPI_PRESETS = [
				/* 0-4: Disorder — most effective on Linux */
				{ name: '1 — Disorder Basic',              args: '--disorder 1' },
				{ name: '2 — Disorder at SNI',             args: '--disorder 1+s' },
				{ name: '3 — Disorder TLS+HTTP',           args: '--proto tls,http --disorder 1' },
				{ name: '4 — Split + Disorder',            args: '--split 1 --disorder 3' },
				{ name: '5 — Disorder + Auto TLS Record',  args: '--disorder 1 --auto=torst --tlsrec 1+s' },
				/* 5-9: Fake TTL */
				{ name: '6 — Fake TTL=6',                  args: '--fake -1 --ttl 6' },
				{ name: '7 — Fake TTL=8',                  args: '--fake -1 --ttl 8' },
				{ name: '8 — Fake TTL=10',                 args: '--fake -1 --ttl 10' },
				{ name: '9 — Fake TTL=12',                 args: '--fake -1 --ttl 12' },
				{ name: '10 — Fake TTL=15',                args: '--fake -1 --ttl 15' },
				/* 10-13: Fake MD5 — Linux-only TCP option */
				{ name: '11 — Fake MD5',                   args: '--fake -1 --md5sig' },
				{ name: '12 — Disorder + Fake MD5',        args: '--disorder 1 --fake -1 --md5sig' },
				{ name: '13 — Fake MD5 TLS+HTTP',          args: '--proto tls,http --fake -1 --md5sig' },
				{ name: '14 — Fake MD5 + Auto Reset',      args: '--fake -1 --md5sig --auto=torst --disorder 1' },
				/* 14-17: TLS Record split */
				{ name: '15 — TLS Record Split',           args: '--tlsrec 1+s' },
				{ name: '16 — TLS Record + Auto',          args: '--auto=torst --tlsrec 1+s' },
				{ name: '17 — TLS Record + Timeout',       args: '--auto=torst --timeout 3 --tlsrec 1+s' },
				{ name: '18 — Disorder + TLS Record',      args: '--disorder 1 --tlsrec 1+s' },
				/* 18-21: OOB */
				{ name: '19 — OOB at SNI',                 args: '--oob 1+s' },
				{ name: '20 — OOB at SNI+3',               args: '--oob 3+s' },
				{ name: '21 — DisoOB at SNI',              args: '--disoob 1+s' },
				{ name: '22 — DisoOB + Fake MD5',          args: '--disoob 1+s --fake -1 --md5sig' },
				/* 22-25: Split */
				{ name: '23 — Split at SNI',               args: '--split 1+s' },
				{ name: '24 — Split at SNI Middle',        args: '--split 0+sm' },
				{ name: '25 — Split at 2',                 args: '--split 2' },
				{ name: '26 — Split + OOB',                args: '--split 1+s --oob 2+s' },
				/* 26-29: HTTP modification */
				{ name: '27 — HTTP Host Case Mix',         args: '--proto http --mod-http hcsmix' },
				{ name: '28 — HTTP Host Double Mix',       args: '--proto http --mod-http hcsmix,dcsmix' },
				{ name: '29 — HTTP Full Mix',              args: '--proto http --mod-http hcsmix,dcsmix,rmspace' },
				{ name: '30 — HTTP Mix + Disorder',        args: '--proto tls,http --mod-http hcsmix --disorder 1' },
				/* 30-31: Auto-mode */
				{ name: '31 — Auto SSL Error Fallback',    args: '--fake -1 --ttl 8 --auto=ssl_err --fake -1 --ttl 5' },
				{ name: '32 — Auto Reset Fallback',        args: '--fake -1 --md5sig --auto=torst --disorder 1' },
				/* 32-34: Fake SNI / TLS mod */
				{ name: '33 — Random SNI Fake',            args: '--fake -1 --fake-sni "????.net"' },
				{ name: '34 — Random TLS Fake',            args: '--fake -1 --fake-tls-mod rand' },
				{ name: '35 — Original TLS Fake',          args: '--fake -1 --fake-tls-mod orig' },
				/* 35-39: Aggressive combos */
				{ name: '36 — Aggressive Split',           args: '--split 1+s --disorder 3+s' },
				{ name: '37 — Aggressive OOB + MD5',       args: '--oob 1+s --disorder 1 --fake -1 --md5sig' },
				{ name: '38 — Aggressive DisoOB',          args: '--disoob 1+s --disorder 3+s' },
				{ name: '39 — Aggressive Combo',           args: '--split 1+s --oob 2+s --disorder 3+s' },
				{ name: '40 — TLS+HTTP Disorder + Record', args: '--proto tls,http --disorder 1 --tlsrec 1+s' },
				/* 40-41: UDP */
				{ name: '41 — UDP Fake',                   args: '--proto udp --udp-fake 5' },
				{ name: '42 — TLS+UDP Fake MD5',           args: '--proto tls,udp --fake -1 --md5sig --udp-fake 5' },
				/* 42: Full combo */
				{ name: '43 — Full TLS Bypass',            args: '--proto tls --fake -1 --md5sig --tlsrec 1+s' }
			];

			const BYEDPI_GROUPS = [
				{ label: _('Disorder — reorders TCP segments'),  range: [0,  4]  },
				{ label: _('Fake TTL'),                          range: [5,  9]  },
				{ label: _('Fake MD5'),                          range: [10, 13] },
				{ label: _('TLS Record Split'),                                   range: [14, 17] },
				{ label: _('OOB'),                                                range: [18, 21] },
				{ label: _('Split'),                                              range: [22, 25] },
				{ label: _('HTTP Modification'),                                  range: [26, 29] },
				{ label: _('Auto-mode'),                                          range: [30, 31] },
				{ label: _('Fake SNI / TLS Modification'),                        range: [32, 34] },
				{ label: _('Aggressive'),                                         range: [35, 39] },
				{ label: _('UDP'),                                                range: [40, 41] },
				{ label: _('Full Combo'),                                         range: [42, 42] },
			];

			const callByeDPITest = rpc.declare({
				object: 'luci.homeproxy',
				method: 'byedpi_strategy_test',
				params: ['cmd_opts', 'port'],
				expect: { '': {} }
			});

			const callCurlStatus = rpc.declare({
				object: 'luci.homeproxy',
				method: 'curl_status',
				expect: { '': {} }
			});

			/* Reference to the Command-options option, set when it's created below.
			 * The preset dropdown drives this field through LuCI's own widget API. */
			let cmdOptsOpt = null;

			function applyPreset(idx) {
				if (!BYEDPI_PRESETS[idx])
					return;
				const val = BYEDPI_PRESETS[idx].args;
				const widget = cmdOptsOpt ? cmdOptsOpt.getUIElement('config') : null;
				if (widget) {
					widget.setValue(val);
					widget.node.dispatchEvent(new Event('change', { bubbles: true }));
				} else {
					/* fallback if the widget isn't registered yet */
					const el = document.querySelector('[name*=".byedpi_cmd_opts"]');
					if (el) {
						el.value = val;
						el.dispatchEvent(new Event('change', { bubbles: true }));
					}
				}
			}

			/* Preset selector — DummyValue so LuCI never tracks or resets it.
			 * It's a picker that fills byedpi_cmd_opts, not a stored value. On every
			 * render it pre-selects whichever preset matches the current options, so it
			 * reflects truth and survives section re-renders. */
			o = ss.option(form.DummyValue, '_byedpi_preset', _('Strategy preset'));
			o.render = function(option_index, section_id) {
				const cur = (uci.get('homeproxy', 'config', 'byedpi_cmd_opts') || '').trim();
				let curIdx = -1;
				for (let i = 0; i < BYEDPI_PRESETS.length; i++)
					if (BYEDPI_PRESETS[i].args === cur) { curIdx = i; break; }

				const sel = E('select', {
					'class': 'cbi-input-select',
					'style': 'max-width:100%'
				});
				sel.appendChild(E('option', {
					value: '',
					selected: curIdx < 0 ? '' : null
				}, curIdx < 0 ? _('— custom / select a preset —') : _('— select a preset —')));
				for (let g of BYEDPI_GROUPS) {
					const grp = E('optgroup', { label: g.label });
					for (let i = g.range[0]; i <= g.range[1]; i++) {
						grp.appendChild(E('option', {
							value: String(i),
							selected: i === curIdx ? '' : null
						}, BYEDPI_PRESETS[i].name));
					}
					sel.appendChild(grp);
				}
				sel.addEventListener('change', function() {
					if (sel.value !== '')
						applyPreset(parseInt(sel.value));
				});
				return E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, _('Strategy preset')),
					E('div', { 'class': 'cbi-value-field' }, [
						sel,
						E('div', { 'class': 'cbi-value-description' },
							_('Grouped by technique. Based on <a href="https://github.com/hufrea/byedpi" target="_blank">hufrea/byedpi</a> and community testing. See also <a href="https://github.com/fatyzzz/Byedpi-Setup" target="_blank">fatyzzz/Byedpi-Setup</a>.'))
					])
				]);
			};
			o.write = function() {};

			o = ss.option(form.Value, 'byedpi_cmd_opts',
				_('Command options'),
				_('Arguments passed to ByeDPI. Select a preset above or enter custom options. See <code>ciadpi --help</code> for full flag reference.'));
			o.placeholder = '--disorder 1';
			cmdOptsOpt = o;

			/* Strategy tester */
			o = ss.option(form.DummyValue, '_byedpi_tester',
				_('Test current strategy'),
				_('Starts ByeDPI with the current options on a temporary port and tests it. ' +
				  'With curl installed: makes a real HTTP request through ByeDPI to verify DPI bypass. ' +
				  'Without curl: only confirms arguments are valid and ByeDPI starts.'));
			o.render = function(option_index, section_id) {
				const msgEl = E('span', { style: 'margin-left:8px; font-size:0.9em; color:gray' }, '');
				const btn = E('button', {
					'class': 'btn cbi-button cbi-button-action',
					'click': ui.createHandlerFn(this, () => {
						const el = document.querySelector('[name*=".byedpi_cmd_opts"]');
						const opts = el ? el.value.trim() : '';
						btn.disabled = true;
						msgEl.style.color = 'gray';
						msgEl.textContent = _('Testing...');
						return L.resolveDefault(callByeDPITest(opts, '15335'), {}).then((ret) => {
							btn.disabled = false;
							if (ret.result) {
								msgEl.style.color = 'green';
								msgEl.textContent = ret.method === 'curl'
									? _('✓ HTTP request succeeded through ByeDPI')
									: _('✓ ByeDPI started (install curl for full test)');
							} else {
								msgEl.style.color = 'red';
								msgEl.textContent = ret.error || _('Test failed');
							}
						});
					})
				}, [ _('Test') ]);

				return E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, _('Test current strategy')),
					E('div',   { 'class': 'cbi-value-field' }, [ btn, msgEl ])
				]);
			};
			o.write = function() {};

			/* Test all strategies */
			o = ss.option(form.DummyValue, '_byedpi_test_all', _('Test all strategies'));
			o.render = function(option_index, section_id) {
				const progressEl = E('div', {
					style: 'font-size:0.9em; margin:6px 0; display:none'
				}, '');
				const tableEl = E('table', {
					style: 'width:100%; border-collapse:collapse; font-size:0.85em; display:none; margin-top:4px'
				});

				const btn = E('button', {
					'class': 'btn cbi-button cbi-button-action',
					'disabled': true,
					'click': ui.createHandlerFn(this, function() {
						if (!confirm(_('Test all 43 strategies sequentially?\n\n' +
						              'Each test takes ~5-10 seconds (~5-7 min total).\n' +
						              'LAN clients are not affected during testing.')))
							return;

						btn.disabled = true;
						progressEl.style.display = '';
						progressEl.style.color = 'gray';
						progressEl.textContent = _('Preparing...');
						tableEl.style.display = '';
						tableEl.innerHTML = '';

						const rows = [];
						for (let i = 0; i < BYEDPI_PRESETS.length; i++) {
							const statusCell = E('td', {
								style: 'width:22px; text-align:center; font-size:1em; color:gray'
							}, '–');
							const errorCell = E('td', {
								style: 'padding:2px 8px; color:#888; font-size:0.8em; font-style:italic'
							}, '');
							const applyBtn = E('button', {
								'class': 'btn cbi-button cbi-button-save',
								style: 'padding:1px 8px; font-size:0.8em; visibility:hidden',
								click: (function(idx) {
									return function() { applyPreset(idx); };
								})(i)
							}, [ _('Apply') ]);

							tableEl.appendChild(E('tr', { style: 'border-bottom:1px solid #f0f0f0' }, [
								statusCell,
								E('td', { style: 'padding:2px 8px; color:#555; white-space:nowrap' },
									BYEDPI_PRESETS[i].name),
								E('td', { style: 'padding:2px 8px; color:#888; font-family:monospace; font-size:0.85em; word-break:break-all' },
									BYEDPI_PRESETS[i].args),
								errorCell,
								E('td', { style: 'padding:2px 4px; white-space:nowrap' }, [ applyBtn ])
							]));
							rows.push({ statusCell, errorCell, applyBtn });
						}

						let passed = 0;
						let chain = Promise.resolve();
						for (let i = 0; i < BYEDPI_PRESETS.length; i++) {
							chain = chain.then((function(idx) {
								return function() {
									const { statusCell, errorCell, applyBtn } = rows[idx];
									progressEl.textContent =
										(idx + 1) + ' / ' + BYEDPI_PRESETS.length +
										': ' + BYEDPI_PRESETS[idx].name;
									statusCell.textContent = '⏳';
									return L.resolveDefault(
										callByeDPITest(BYEDPI_PRESETS[idx].args, '15335'), {}
									).then(function(ret) {
										if (ret.result) {
											statusCell.textContent = '✓';
											statusCell.style.color = 'green';
											applyBtn.style.visibility = '';
											passed++;
										} else {
											statusCell.textContent = '✗';
											statusCell.style.color = '#cc3300';
											errorCell.textContent = ret.error || '';
										}
									});
								};
							})(i));
						}

						return chain.then(function() {
							progressEl.style.color = passed > 0 ? 'green' : '#cc3300';
							progressEl.textContent =
								_('Done') + ': ' + passed + ' / ' +
								BYEDPI_PRESETS.length + ' ' + _('passed') +
								(passed > 0 ? ' — ' + _('click Apply next to any working strategy') : '');
							btn.disabled = false;
						});
					})
				}, [ _('Test all strategies') ]);

				const hintEl = E('div', { style: 'font-size:0.85em; color:#666; margin-bottom:6px' },
					_('Runs all 43 presets one by one and shows which ones work. ~5-7 min total.'));

				L.resolveDefault(callCurlStatus(), {}).then(function(status) {
					if (status.installed) {
						btn.disabled = false;
					} else {
						hintEl.textContent = _('Requires curl. Install it on the Status page first.');
						hintEl.style.color = '#c00';
					}
				});

				return E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, _('Test all strategies')),
					E('div', { 'class': 'cbi-value-field' }, [
						hintEl,
						btn,
						progressEl,
						tableEl
					])
				]);
			};
			o.write = function() {};
		})();

		o = ss.option(form.Flag, 'byedpi_block_quic',
			_('Block QUIC (UDP port 443)') + ' ⚠️',
			_('This nftables rule drops all outgoing UDP port 443 packets to external addresses, ' +
			  'forcing browsers and apps to fall back to TCP/TLS where ByeDPI can apply DPI bypass. ' +
			  'Side effects: may break services that require QUIC, and affects all LAN clients. ' +
			  'Enable if your strategy works but some sites still do not load.'));
		o.default = o.disabled;
		o.rmempty = false;
		/* ByeDPI settings end */

		return m.render();
	}
});
