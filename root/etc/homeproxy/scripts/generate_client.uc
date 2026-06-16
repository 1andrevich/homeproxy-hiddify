#!/usr/bin/ucode
/*
 * SPDX-License-Identifier: GPL-2.0-only
 *
 * Copyright (C) 2023-2025 ImmortalWrt.org
 */

'use strict';

import { access, readfile, writefile } from 'fs';
import { isnan } from 'math';
import { connect } from 'ubus';
import { cursor } from 'uci';

import {
	isEmpty, parseURL, strToBool, strToInt, strToTime,
	removeBlankAttrs, validation, HP_DIR, RUN_DIR
} from 'homeproxy';

const ubus = connect();

/* const features = ubus.call('luci.homeproxy', 'singbox_get_features') || {}; */

/* UCI config start */
const uci = cursor();

const uciconfig = 'homeproxy';
uci.load(uciconfig);

const uciinfra = 'infra',
      ucimain = 'config',
      ucicontrol = 'control';

const ucidnssetting = 'dns',
      ucidnsserver = 'dns_server',
      ucidnsrule = 'dns_rule';

const uciroutingsetting = 'routing',
      uciroutingnode = 'routing_node',
      uciroutingrule = 'routing_rule';

const ucinode = 'node';
const uciruleset = 'ruleset';
const uciserver = 'server';
const ucirurule = 'proxy_ru_rule';

const routing_mode = uci.get(uciconfig, ucimain, 'routing_mode') || 'bypass_mainland_china';

let wan_dns = ubus.call('network.interface', 'status', {'interface': 'wan'})?.['dns-server']?.[0];
if (!wan_dns)
	wan_dns = (routing_mode in ['proxy_mainland_china', 'global']) ? '8.8.8.8' : '223.5.5.5';

const dns_port = uci.get(uciconfig, uciinfra, 'dns_port') || '5333';

const ntp_server = uci.get(uciconfig, uciinfra, 'ntp_server') || 'time.apple.com';

/* Detect active core. Must match the core init.d actually runs, or the generated dialect
 * won't fit it. Mirror init.d's precedence: honor preferred_core when that core is
 * installed, otherwise auto-pick (hiddify-core first, then sing-box). Falls back to a
 * UCI custom path when neither standard binary is present. */
const preferred_core = uci.get(uciconfig, ucimain, 'preferred_core') || 'auto';
const have_hiddify = !!access('/usr/bin/hiddify-core');
const have_singbox = !!access('/usr/bin/sing-box');

let is_hiddify = false, is_singbox = false;
if (preferred_core === 'hiddify' && have_hiddify)
	is_hiddify = true;
else if (preferred_core === 'singbox' && have_singbox)
	is_singbox = true;
else if (have_hiddify)
	is_hiddify = true;
else if (have_singbox)
	is_singbox = true;
else {
	const custom_path = uci.get(uciconfig, ucimain, 'custom_core_path');
	const custom_type = uci.get(uciconfig, ucimain, 'custom_core_type');
	if (custom_path && access(custom_path)) {
		is_hiddify = custom_type === 'hiddify';
		is_singbox = !is_hiddify;
	}
}

const ipv6_support = uci.get(uciconfig, ucimain, 'ipv6_support') || '0';
const byedpi_enabled = uci.get(uciconfig, ucimain, 'byedpi_enabled');

let main_node, main_udp_node, dedicated_udp_node, default_outbound, default_outbound_dns,
    domain_strategy, sniff_override, dns_server, china_dns_server, russia_dns_server,
    secure_dns_server, proxy_calls, no_proxy_torrents, show_advanced_rules, dns_default_strategy, dns_default_server, dns_disable_cache,
    dns_disable_cache_expire, dns_independent_cache, dns_client_subnet, cache_file_store_rdrc,
    cache_file_rdrc_timeout, direct_domain_list, proxy_domain_list;

if (routing_mode !== 'custom') {
	main_node = uci.get(uciconfig, ucimain, 'main_node') || 'nil';
	if (main_node === 'nil') {
		warn('homeproxy: no main_node configured, skipping config generation.\n');
		exit(0);
	}
	main_udp_node = uci.get(uciconfig, ucimain, 'main_udp_node') || 'nil';
	dedicated_udp_node = !isEmpty(main_udp_node) && !(main_udp_node in ['same', main_node]);

	dns_server = uci.get(uciconfig, ucimain, 'dns_server');
	if (isEmpty(dns_server) || dns_server === 'wan')
		dns_server = wan_dns;

	if (routing_mode === 'bypass_mainland_china') {
		china_dns_server = uci.get(uciconfig, ucimain, 'china_dns_server');
		if (isEmpty(china_dns_server) || type(china_dns_server) !== 'string' || china_dns_server === 'wan')
			china_dns_server = wan_dns;
	}

	if (routing_mode === 'proxy_banned_ru') {
		russia_dns_server = uci.get(uciconfig, ucimain, 'russia_dns_server') || '77.88.8.8';
		secure_dns_server = uci.get(uciconfig, ucimain, 'secure_dns_server') || 'https://cloudflare-dns.com/dns-query';
		domain_strategy = uci.get(uciconfig, ucimain, 'domain_strategy');
		proxy_calls = uci.get(uciconfig, ucimain, 'proxy_calls');
		no_proxy_torrents = uci.get(uciconfig, ucimain, 'no_proxy_torrents');
		show_advanced_rules = uci.get(uciconfig, ucimain, 'show_advanced_rules');
	}

	dns_default_strategy = (ipv6_support !== '1') ? 'ipv4_only' : null;

	direct_domain_list = trim(readfile(HP_DIR + '/resources/direct_list.txt'));
	if (direct_domain_list)
		direct_domain_list = split(direct_domain_list, /[\r\n]/);

	proxy_domain_list = trim(readfile(HP_DIR + '/resources/proxy_list.txt'));
	if (proxy_domain_list)
		proxy_domain_list = split(proxy_domain_list, /[\r\n]/);

	sniff_override = uci.get(uciconfig, uciinfra, 'sniff_override') || '1';
} else {
	/* DNS settings */
	dns_default_strategy = uci.get(uciconfig, ucidnssetting, 'default_strategy');
	dns_default_server = uci.get(uciconfig, ucidnssetting, 'default_server');
	dns_disable_cache = uci.get(uciconfig, ucidnssetting, 'disable_cache');
	dns_disable_cache_expire = uci.get(uciconfig, ucidnssetting, 'disable_cache_expire');
	dns_independent_cache = uci.get(uciconfig, ucidnssetting, 'independent_cache');
	dns_client_subnet = uci.get(uciconfig, ucidnssetting, 'client_subnet');
	cache_file_store_rdrc = uci.get(uciconfig, ucidnssetting, 'cache_file_store_rdrc'),
	cache_file_rdrc_timeout = uci.get(uciconfig, ucidnssetting, 'cache_file_rdrc_timeout');

	/* Routing settings */
	default_outbound = uci.get(uciconfig, uciroutingsetting, 'default_outbound') || 'nil';
	default_outbound_dns = uci.get(uciconfig, uciroutingsetting, 'default_outbound_dns') || 'default-dns';
	domain_strategy = uci.get(uciconfig, uciroutingsetting, 'domain_strategy');
	sniff_override = uci.get(uciconfig, uciroutingsetting, 'sniff_override');
}

const proxy_mode = uci.get(uciconfig, ucimain, 'proxy_mode') || 'redirect_tproxy',
      default_interface = uci.get(uciconfig, ucicontrol, 'bind_interface');

const mixed_port = uci.get(uciconfig, uciinfra, 'mixed_port') || '5330';

let self_mark, redirect_port, tproxy_port, tun_name,
    tun_addr4, tun_addr6, tun_mtu, tcpip_stack,
    endpoint_independent_nat, udp_timeout;

if (routing_mode === 'custom')
	udp_timeout = uci.get(uciconfig, uciroutingsetting, 'udp_timeout');
else
	udp_timeout = uci.get(uciconfig, 'infra', 'udp_timeout');

if (match(proxy_mode, /redirect/)) {
	self_mark = uci.get(uciconfig, 'infra', 'self_mark') || '100';
	redirect_port = uci.get(uciconfig, 'infra', 'redirect_port') || '5331';
}
if (match(proxy_mode, /tproxy/))
	tproxy_port = uci.get(uciconfig, 'infra', 'tproxy_port') || '5332';
if (match(proxy_mode), /tun/) {
	tun_name = uci.get(uciconfig, uciinfra, 'tun_name') || 'singtun0';
	tun_addr4 = uci.get(uciconfig, uciinfra, 'tun_addr4') || '172.19.0.1/30';
	tun_addr6 = uci.get(uciconfig, uciinfra, 'tun_addr6') || 'fdfe:dcba:9876::1/126';
	tun_mtu = uci.get(uciconfig, uciinfra, 'tun_mtu') || '9000';
	tcpip_stack = 'system';
	if (routing_mode === 'custom') {
		tcpip_stack = uci.get(uciconfig, uciroutingsetting, 'tcpip_stack') || 'system';
		endpoint_independent_nat = uci.get(uciconfig, uciroutingsetting, 'endpoint_independent_nat');
	}
}

const log_level = uci.get(uciconfig, ucimain, 'log_level') || 'warn';
/* UCI config end */

/* Config helper start */
function parse_port(strport) {
	if (type(strport) !== 'array' || isEmpty(strport))
		return null;

	let ports = [];
	for (let i in strport)
		push(ports, int(i));

	return ports;

}

function parse_dnsserver(server_addr, default_protocol) {
	if (isEmpty(server_addr))
		return null;

	if (!match(server_addr, /:\/\//))
		server_addr = (default_protocol || 'udp') + '://' + (validation('ip6addr', server_addr) ? `[${server_addr}]` : server_addr);
	server_addr = parseURL(server_addr);

	return {
		type: server_addr.protocol,
		server: server_addr.hostname,
		server_port: strToInt(server_addr.port),
		path: (server_addr.pathname !== '/') ? server_addr.pathname : null,
	}
}

function parse_dnsquery(strquery) {
	if (type(strquery) !== 'array' || isEmpty(strquery))
		return null;

	let querys = [];
	for (let i in strquery)
		isnan(int(i)) ? push(querys, i) : push(querys, int(i));

	return querys;

}

function generate_endpoint(node) {
	if (type(node) !== 'object' || isEmpty(node))
		return null;

	const is_wg = node.type in ['wireguard', 'amneziawg'];

	const addPrefix = (addr) => {
		if (!addr || match(addr, /\//)) return addr;
		return match(addr, /:/) ? addr + '/128' : addr + '/32';
	};
	const raw_addr = node.wireguard_local_address;

	const endpoint = {
		type: is_wg ? 'wireguard' : node.type,
		tag: 'cfg-' + node['.name'] + '-out',
		address: type(raw_addr) === 'array' ? map(raw_addr, addPrefix) : addPrefix(raw_addr),
		mtu: strToInt(node.wireguard_mtu),
		private_key: node.wireguard_private_key,
		peers: is_wg ? [
			{
				address: node.address,
				port: strToInt(node.port),
				allowed_ips: [
					'0.0.0.0/0',
					'::/0'
				],
				persistent_keepalive_interval: strToInt(node.wireguard_persistent_keepalive_interval),
				public_key: node.wireguard_peer_public_key,
				pre_shared_key: node.wireguard_pre_shared_key,
				reserved: parse_port(node.wireguard_reserved),
			}
		] : null,
		system: is_wg ? false : null,
		amnezia: (node.type === 'amneziawg') ? {
			jc: strToInt(node.amnezia_jc),
			jmin: strToInt(node.amnezia_jmin),
			jmax: strToInt(node.amnezia_jmax),
			s1: strToInt(node.amnezia_s1),
			s2: strToInt(node.amnezia_s2),
			s3: strToInt(node.amnezia_s3),
			s4: strToInt(node.amnezia_s4),
			h1: node.amnezia_h1 || null,
			h2: node.amnezia_h2 || null,
			h3: node.amnezia_h3 || null,
			h4: node.amnezia_h4 || null,
			i1: node.amnezia_i1 || null,
			i2: node.amnezia_i2 || null,
			i3: node.amnezia_i3 || null,
			i4: node.amnezia_i4 || null,
			i5: node.amnezia_i5 || null,
			j1: node.amnezia_j1 || null,
			j2: node.amnezia_j2 || null,
			j3: node.amnezia_j3 || null,
			itime: strToInt(node.amnezia_itime),
		} : null,
		tcp_fast_open: strToBool(node.tcp_fast_open),
		tcp_multi_path: strToBool(node.tcp_multi_path),
		udp_fragment: strToBool(node.udp_fragment)
	};

	return endpoint;
}

/* The transport "host" JSON type differs by transport: sing-box's HTTP/2 (`http`)
 * transport takes an ARRAY of strings, while xhttp and httpupgrade take a single
 * STRING. The UI's DynamicList (and some share-link parsers) store http_host as a
 * UCI list, which would emit a JSON array and crash hiddify-core on an xhttp node
 * ("json: cannot unmarshal array into Go value of type string"). Coerce to the
 * correct shape per transport here, so every input path (UI edit, share-link,
 * subscription) produces valid config. */
function transport_host(node) {
	let h = node.http_host;
	if (node.transport === 'http')
		return (type(h) === 'array') ? (length(h) ? h : null) : (isEmpty(h) ? null : [ h ]);
	if (type(h) === 'array')
		h = h[0];
	return h || node.httpupgrade_host;
}

function generate_outbound(node) {
	if (type(node) !== 'object' || isEmpty(node))
		return null;

	const outbound = {
		type: node.type,
		tag: 'cfg-' + node['.name'] + '-out',

		server: (node.type === 'shadowsocks' && node.shadowtls_enabled === '1') ? null : node.address,
		server_port: (node.type === 'mieru') ? 0 : ((node.type === 'shadowsocks' && node.shadowtls_enabled === '1') ? null : strToInt(node.port)),
		/* Hysteria(2) / Mieru (sing-box-extended) */
		server_ports: (!is_hiddify && node.type === 'mieru' && node.mieru_port_range) ? [node.mieru_port_range] : node.hysteria_hopping_port,

		username: (node.type !== 'ssh') ? node.username : null,
		user: (node.type === 'ssh') ? node.username : null,
		password: node.password,

		/* Direct */
		override_address: node.override_address,
		override_port: strToInt(node.override_port),
		proxy_protocol: strToInt(node.proxy_protocol),
		/* AnyTLS */
		idle_session_check_interval: strToTime(node.anytls_idle_session_check_interval),
		idle_session_timeout: strToTime(node.anytls_idle_session_timeout),
		min_idle_session: strToInt(node.anytls_min_idle_session),
		/* Hysteria (2) */
		hop_interval: strToTime(node.hysteria_hop_interval),
		up_mbps: strToInt(node.hysteria_up_mbps),
		down_mbps: strToInt(node.hysteria_down_mbps),
		obfs: node.hysteria_obfs_type ? {
			type: node.hysteria_obfs_type,
			password: node.hysteria_obfs_password
		} : node.hysteria_obfs_password,
		auth: (node.hysteria_auth_type === 'base64') ? node.hysteria_auth_payload : null,
		auth_str: (node.hysteria_auth_type === 'string') ? node.hysteria_auth_payload : null,
		recv_window_conn: strToInt(node.hysteria_recv_window_conn),
		recv_window: strToInt(node.hysteria_revc_window),
		disable_mtu_discovery: strToBool(node.hysteria_disable_mtu_discovery),
		/* Shadowsocks */
		method: node.shadowsocks_encrypt_method,
		plugin: node.shadowsocks_plugin,
		plugin_opts: node.shadowsocks_plugin_opts,
		/* ShadowTLS / Socks */
		version: (node.type === 'shadowtls') ? strToInt(node.shadowtls_version) : ((node.type === 'socks') ? node.socks_version : null),
		/* Mieru */
		portBindings: (is_hiddify && node.type === 'mieru' && node.mieru_protocol && node.mieru_port_range) ? [
			{ protocol: node.mieru_protocol, portRange: node.mieru_port_range }
		] : null,
		multiplexing: (node.type === 'mieru') ? node.mieru_multiplexing : null,
		handshake_mode: (is_hiddify && node.type === 'mieru') ? node.mieru_handshake_mode : null,
		/* SSH */
		client_version: node.ssh_client_version,
		host_key: node.ssh_host_key,
		host_key_algorithms: node.ssh_host_key_algo,
		private_key: node.ssh_priv_key,
		private_key_passphrase: node.ssh_priv_key_pp,
		/* Tuic */
		uuid: node.uuid,
		congestion_control: node.tuic_congestion_control,
		udp_relay_mode: node.tuic_udp_relay_mode,
		udp_over_stream: strToBool(node.tuic_udp_over_stream),
		zero_rtt_handshake: strToBool(node.tuic_enable_zero_rtt),
		heartbeat: strToTime(node.tuic_heartbeat),
		/* VLESS / VMess */
		flow: node.vless_flow,
		alter_id: strToInt(node.vmess_alterid),
		security: node.vmess_encrypt,
		global_padding: strToBool(node.vmess_global_padding),
		authenticated_length: strToBool(node.vmess_authenticated_length),
		packet_encoding: node.packet_encoding,

		multiplex: (node.multiplex === '1') ? {
			enabled: true,
			protocol: node.multiplex_protocol,
			max_connections: strToInt(node.multiplex_max_connections),
			min_streams: strToInt(node.multiplex_min_streams),
			max_streams: strToInt(node.multiplex_max_streams),
			padding: strToBool(node.multiplex_padding),
			brutal: (node.multiplex_brutal === '1') ? {
				enabled: true,
				up_mbps: strToInt(node.multiplex_brutal_up),
				down_mbps: strToInt(node.multiplex_brutal_down)
			} : null
		} : null,
		tls_fragment: (node.tls_fragment === '1') ? {
			enabled: true,
			size: node.tls_fragment_size,
			sleep: node.tls_fragment_sleep
		} : null,
		/* Shadowsocks has no top-level tls field in ANY sing-box-based core — for a
		 * ShadowTLS-wrapped Shadowsocks the TLS lives on the separate shadowtls transport
		 * outbound (detour). Both sing-box-extended AND hiddify-core 4.1.0 (HiddifyCli)
		 * strict-reject a stray tls here ("unknown field tls" → FATAL), so suppress it for
		 * shadowsocks unconditionally (the earlier is_singbox-only gate was wrong — hiddify
		 * is not lenient). */
		tls: (node.tls === '1' && node.type !== 'shadowsocks') ? {
			enabled: true,
			server_name: node.tls_sni,
			insecure: strToBool(node.tls_insecure),
			alpn: node.tls_alpn ? (type(node.tls_alpn) === 'array' ? node.tls_alpn : [node.tls_alpn]) : null,
			min_version: node.tls_min_version,
			max_version: node.tls_max_version,
			cipher_suites: node.tls_cipher_suites,
			certificate_path: node.tls_cert_path,
			ech: (node.tls_ech === '1') ? {
				enabled: true,
				config: node.tls_ech_config,
				config_path: node.tls_ech_config_path
			} : null,
			utls: !isEmpty(node.tls_utls) ? {
				enabled: true,
				fingerprint: node.tls_utls
			} : null,
			reality: (node.tls_reality === '1') ? {
				enabled: true,
				public_key: node.tls_reality_public_key,
				short_id: node.tls_reality_short_id
			} : null
		} : null,
		transport: (!is_hiddify && node.type === 'mieru') ? node.mieru_protocol : !isEmpty(node.transport) ? {
			type: node.transport,
			host: transport_host(node),
			path: node.http_path || node.ws_path,
			mode: (node.transport === 'xhttp') ? (node.xhttp_mode || 'auto') : null,
			x_padding_bytes: (is_singbox && node.transport === 'xhttp') ? (node.xhttp_padding_bytes || '100-1000') : null,
			headers: node.xhttp_headers ? json(node.xhttp_headers) : (node.ws_host ? { Host: node.ws_host } : null),
			method: node.http_method,
			max_early_data: strToInt(node.websocket_early_data),
			early_data_header_name: node.websocket_early_data_header,
			service_name: node.grpc_servicename,
			idle_timeout: (node.http_idle_timeout),
			ping_timeout: (node.http_ping_timeout),
			permit_without_stream: strToBool(node.grpc_permit_without_stream)
		} : null,
		/* NaiveProxy */
		quic: (node.type === 'naive') ? strToBool(node.naive_quic) : null,
		extra_headers: (node.type === 'naive') ? (node.naive_extra_headers ? json(node.naive_extra_headers) : null) : null,
		udp_over_tcp: (node.type === 'naive') ? strToBool(node.naive_udp_over_tcp) :
		              (node.type === 'ssh') ? (node.ssh_udp_over_tcp !== '0' ? true : null) :
		              ((is_hiddify && node.udp_over_tcp === '1') ? {
			enabled: true,
			version: strToInt(node.udp_over_tcp_version)
		} : null),
		tcp_fast_open: strToBool(node.tcp_fast_open),
		tcp_multi_path: strToBool(node.tcp_multi_path),
		udp_fragment: strToBool(node.udp_fragment),
		bind_interface: node.bind_interface || null,
		detour: (node.type === 'shadowsocks' && node.shadowtls_enabled === '1') ? ('cfg-' + node['.name'] + '-shadowtls-out') : null
	};

	return outbound;
}

/* Push outbound(s) for a node. For ShadowTLS-wrapped Shadowsocks, first pushes the
 * hidden ShadowTLS transport outbound, then the Shadowsocks outbound with detour set. */
function push_outbound(list, node) {
	if (node.type === 'shadowsocks' && node.shadowtls_enabled === '1') {
		push(list, {
			type: 'shadowtls',
			tag: 'cfg-' + node['.name'] + '-shadowtls-out',
			server: node.address,
			server_port: strToInt(node.port),
			version: strToInt(node.shadowtls_version) || 3,
			password: node.shadowtls_password || null,
			tls: {
				enabled: true,
				server_name: node.tls_sni || null,
				insecure: strToBool(node.tls_insecure),
				utls: !isEmpty(node.tls_utls) ? { enabled: true, fingerprint: node.tls_utls } : null
			}
		});
	}
	push(list, generate_outbound(node));
}

function get_outbound(cfg) {
	if (isEmpty(cfg))
		return null;

	if (type(cfg) === 'array') {
		if ('any-out' in cfg)
			return 'any';

		let outbounds = [];
		for (let i in cfg)
			push(outbounds, get_outbound(i));
		return outbounds;
	} else {
		switch (cfg) {
		case 'block-out':
		case 'direct-out':
		case 'main-out':
			return cfg;
		case 'byedpi-out':
			/* Fall back to direct if ByeDPI is disabled so the config stays valid */
			return (byedpi_enabled === '1') ? 'byedpi-out' : 'direct-out';
		default:
			const node = uci.get(uciconfig, cfg, 'node');
			if (isEmpty(node))
				die(sprintf("%s's node is missing, please check your configuration.", cfg));
			else if (node === 'urltest')
				return 'cfg-' + cfg + '-out';
			else
				return 'cfg-' + node + '-out';
		}
	}
}

function get_resolver(cfg) {
	if (isEmpty(cfg))
		return null;

	switch (cfg) {
	case 'default-dns':
	case 'system-dns':
	/* Built-in proxy_banned_ru resolvers — already emitted with these literal tags,
	 * so a custom DNS rule may target them directly (don't prefix as a cfg-*-dns). */
	case 'russia-dns':
	case 'secure-dns':
		return cfg;
	default:
		return 'cfg-' + cfg + '-dns';
	}
}

function get_ruleset(cfg) {
	if (isEmpty(cfg))
		return null;

	let rules = [];
	for (let i in cfg)
		push(rules, isEmpty(i) ? null : 'cfg-' + i + '-rule');
	return rules;
}
/* Config helper end */

const config = {};

const has_outbound = (tag) => {
	for (let ob in config.outbounds)
		if (ob?.tag === tag) return true;
	for (let ep in (config.endpoints || []))
		if (ep?.tag === tag) return true;
	return false;
};

/* Log */
config.log = {
	disabled: false,
	level: log_level,
	output: RUN_DIR + '/hiddify-c.log',
	timestamp: true
};

/* NTP */
if (!isEmpty(ntp_server))
	config.ntp = {
		enabled: true,
		server: ntp_server,
		detour: 'direct-out',
		domain_resolver: 'default-dns',
	};

/* DNS start */
/* Default settings */
config.dns = {
	servers: [
		{
			tag: 'default-dns',
			type: 'udp',
			server: wan_dns,
			detour: self_mark ? 'direct-out' : null
		},
		{
			tag: 'system-dns',
			type: 'local',
			detour: self_mark ? 'direct-out' : null
		}
	],
	rules: [],
	strategy: dns_default_strategy,
	disable_cache: strToBool(dns_disable_cache),
	disable_expire: strToBool(dns_disable_cache_expire),
	independent_cache: strToBool(dns_independent_cache),
	client_subnet: dns_client_subnet
};

if (!isEmpty(main_node)) {
	if (routing_mode === 'proxy_banned_ru') {
		/* Russia mode: direct-default routing, russia-dns for all, secure-dns for proxy lists.
		 *
		 * secure-dns goes through main-out for real proxy nodes — tunneling the query hides
		 * it from the ISP and reaches resolvers the ISP might block. But ByeDPI is a DPI-desync,
		 * not a tunnel: routing DNS through it fails every way (DoH/DoT TLS handshake gets
		 * corrupted by the desync; udp:// can't do socks UDP-over-TCP), and it adds no privacy
		 * since ByeDPI egresses direct anyway. So for ByeDPI, secure-dns goes direct — DoH/DoT
		 * is already encrypted/un-poisonable, it just must not pass through the desync. */
		const secure_dns_detour = (main_node === 'byedpi-out') ? 'direct-out' : 'main-out';
		push(config.dns.servers, {
			tag: 'russia-dns',
			detour: self_mark ? 'direct-out' : null,
			...parse_dnsserver(russia_dns_server)
		});
		push(config.dns.servers, {
			tag: 'secure-dns',
			domain_resolver: {
				server: 'russia-dns',
				strategy: (ipv6_support !== '1') ? 'ipv4_only' : null
			},
			detour: secure_dns_detour,
			...parse_dnsserver(secure_dns_server, 'tcp')
		});
		config.dns.final = 'russia-dns';

		/* andrevi.ch always via secure-dns (hardcoded diagnostic anchor) */
		push(config.dns.rules, {
			domain: ['andrevi.ch'],
			action: 'route',
			server: 'secure-dns'
		});

		/* Custom proxy list → secure-dns (before ru_domain_rulesets for explicit priority) */
		if (length(proxy_domain_list))
			push(config.dns.rules, {
				rule_set: 'proxy-domain',
				action: 'route',
				server: 'secure-dns'
			});

		/* Proxy-list domains → secure-dns (Cloudflare DoH via proxy) to prevent DNS leaks */
		let ru_domain_rulesets = [];
		uci.foreach(uciconfig, ucirurule, (cfg) => {
			if (cfg.enabled !== '1') return;
			const tag = (cfg.source === 'refilter') ? 'hp-ru-refilter-domain' : ('hp-ru-' + cfg.source);
			if (index(ru_domain_rulesets, tag) < 0)
				push(ru_domain_rulesets, tag);
		});
		if (length(ru_domain_rulesets))
			push(config.dns.rules, {
				rule_set: ru_domain_rulesets,
				action: 'route',
				server: 'secure-dns'
			});
	} else {
		/* Main DNS */
		push(config.dns.servers, {
			tag: 'main-dns',
			domain_resolver: {
				server: 'default-dns',
				strategy: (ipv6_support !== '1') ? 'ipv4_only' : null
			},
			detour: 'main-out',
			...parse_dnsserver(dns_server, 'tcp')
		});
		config.dns.final = 'main-dns';

		if (length(direct_domain_list))
			push(config.dns.rules, {
				rule_set: 'direct-domain',
				action: 'route',
				server: (routing_mode === 'bypass_mainland_china') ? 'china-dns' : 'default-dns'
			});

		/* Filter out SVCB/HTTPS queries for "exquisite" Apple devices */
		if (routing_mode === 'gfwlist' || length(proxy_domain_list))
			push(config.dns.rules, {
				rule_set: (routing_mode !== 'gfwlist') ? 'proxy-domain' : null,
				query_type: [64, 65],
				action: 'reject'
			});

		if (routing_mode === 'bypass_mainland_china') {
			push(config.dns.servers, {
				tag: 'china-dns',
				domain_resolver: {
					server: 'default-dns',
					strategy: 'prefer_ipv6'
				},
				detour: self_mark ? 'direct-out' : null,
				...parse_dnsserver(china_dns_server)
			});

			if (length(proxy_domain_list))
				push(config.dns.rules, {
					rule_set: 'proxy-domain',
					action: 'route',
					server: 'main-dns'
				});

			push(config.dns.rules, {
				rule_set: 'geosite-cn',
				action: 'route',
				server: 'china-dns',
				strategy: 'prefer_ipv6'
			});
			push(config.dns.rules, {
				type: 'logical',
				mode: 'and',
				rules: [
					{
						rule_set: 'geosite-noncn',
						invert: true
					},
					{
						rule_set: 'geoip-cn'
					}
				],
				action: 'route',
				server: 'china-dns',
				strategy: 'prefer_ipv6'
			});
		}
	}
} else if (!isEmpty(default_outbound)) {
	/* DNS servers */
	uci.foreach(uciconfig, ucidnsserver, (cfg) => {
		if (cfg.enabled !== '1')
			return;

		let outbound = get_outbound(cfg.outbound);
		if (outbound === 'direct-out' && isEmpty(self_mark))
			outbound = null;

		push(config.dns.servers, {
			tag: 'cfg-' + cfg['.name'] + '-dns',
			type: cfg.type,
			server: cfg.server,
			server_port: strToInt(cfg.server_port),
			path: cfg.path,
			headers: cfg.headers,
			tls: cfg.tls_sni ? {
				enabled: true,
				server_name: cfg.tls_sni
			} : null,
			domain_resolver: (cfg.address_resolver || cfg.address_strategy) ? {
				server: get_resolver(cfg.address_resolver || dns_default_server),
				strategy: cfg.address_strategy
			} : null,
			detour: outbound
		});
	});

	/* DNS rules */
	uci.foreach(uciconfig, ucidnsrule, (cfg) => {
		if (cfg.enabled !== '1')
			return;

		push(config.dns.rules, {
			ip_version: strToInt(cfg.ip_version),
			query_type: parse_dnsquery(cfg.query_type),
			network: cfg.network,
			protocol: cfg.protocol,
			domain: cfg.domain,
			domain_suffix: cfg.domain_suffix,
			domain_keyword: cfg.domain_keyword,
			domain_regex: cfg.domain_regex,
			port: parse_port(cfg.port),
			port_range: cfg.port_range,
			source_ip_cidr: cfg.source_ip_cidr,
			source_ip_is_private: strToBool(cfg.source_ip_is_private),
			ip_cidr: cfg.ip_cidr,
			ip_is_private: strToBool(cfg.ip_is_private),
			source_port: parse_port(cfg.source_port),
			source_port_range: cfg.source_port_range,
			process_name: cfg.process_name,
			process_path: cfg.process_path,
			process_path_regex: cfg.process_path_regex,
			user: cfg.user,
			rule_set: get_ruleset(cfg.rule_set),
			rule_set_ip_cidr_match_source: strToBool(cfg.rule_set_ip_cidr_match_source),
			invert: strToBool(cfg.invert),
			outbound: get_outbound(cfg.outbound),
			action: cfg.action,
			server: get_resolver(cfg.server),
			strategy: cfg.domain_strategy,
			disable_cache: strToBool(cfg.dns_disable_cache),
			rewrite_ttl: strToInt(cfg.rewrite_ttl),
			client_subnet: cfg.client_subnet,
			method: cfg.reject_method,
			no_drop: strToBool(cfg.reject_no_drop),
			rcode: cfg.predefined_rcode,
			answer: cfg.predefined_answer,
			ns: cfg.predefined_ns,
			extra: cfg.predefined_extra
		});
	});

	if (isEmpty(config.dns.rules))
		config.dns.rules = null;

	config.dns.final = get_resolver(dns_default_server);
}
/* DNS end */

/* Inbound start */
config.inbounds = [];

push(config.inbounds, {
	type: 'direct',
	tag: 'dns-in',
	listen: '::',
	listen_port: int(dns_port)
});

push(config.inbounds, {
	type: 'mixed',
	tag: 'mixed-in',
	listen: '::',
	listen_port: int(mixed_port),
	udp_timeout: strToTime(udp_timeout),
	sniff: is_hiddify ? true : null,
	sniff_override_destination: is_hiddify ? strToBool(sniff_override) : null,
	set_system_proxy: is_hiddify ? false : null,
});

if (match(proxy_mode, /redirect/))
	push(config.inbounds, {
		type: 'redirect',
		tag: 'redirect-in',

		listen: '::',
		listen_port: int(redirect_port),
		sniff: is_hiddify ? true : null,
		sniff_override_destination: is_hiddify ? strToBool(sniff_override) : null,
	});
if (match(proxy_mode, /tproxy/))
	push(config.inbounds, {
		type: 'tproxy',
		tag: 'tproxy-in',

		listen: '::',
		listen_port: int(tproxy_port),
		network: 'udp',
		udp_timeout: strToTime(udp_timeout),
		sniff: is_hiddify ? true : null,
		sniff_override_destination: is_hiddify ? strToBool(sniff_override) : null,
	});
if (match(proxy_mode, /tun/))
	push(config.inbounds, {
		type: 'tun',
		tag: 'tun-in',

		interface_name: tun_name,
		address: (ipv6_support === '1') ? [tun_addr4, tun_addr6] : [tun_addr4],
		mtu: strToInt(tun_mtu),
		auto_route: false,
		endpoint_independent_nat: strToBool(endpoint_independent_nat),
		udp_timeout: strToTime(udp_timeout),
		stack: tcpip_stack,
		sniff: is_hiddify ? true : null,
		sniff_override_destination: is_hiddify ? strToBool(sniff_override) : null,
	});
/* Server inbounds */
uci.foreach(uciconfig, uciserver, (cfg) => {
	if (cfg.enabled !== '1')
		return;

	push(config.inbounds, {
		type: cfg.type,
		tag: 'cfg-' + cfg['.name'] + '-in',

		listen: cfg.address || '::',
		listen_port: strToInt(cfg.port),
		bind_interface: cfg.bind_interface,
		reuse_addr: strToBool(cfg.reuse_addr),
		tcp_fast_open: strToBool(cfg.tcp_fast_open),
		tcp_multi_path: strToBool(cfg.tcp_multi_path),
		udp_fragment: strToBool(cfg.udp_fragment),
		udp_timeout: strToTime(cfg.udp_timeout),
		network: cfg.network,

		/* AnyTLS */
		padding_scheme: cfg.anytls_padding_scheme,

		/* Hysteria */
		up_mbps: strToInt(cfg.hysteria_up_mbps),
		down_mbps: strToInt(cfg.hysteria_down_mbps),
		obfs: cfg.hysteria_obfs_type ? {
			type: cfg.hysteria_obfs_type,
			password: cfg.hysteria_obfs_password
		} : cfg.hysteria_obfs_password,
		recv_window_conn: strToInt(cfg.hysteria_recv_window_conn),
		recv_window_client: strToInt(cfg.hysteria_revc_window_client),
		max_conn_client: strToInt(cfg.hysteria_max_conn_client),
		disable_mtu_discovery: strToBool(cfg.hysteria_disable_mtu_discovery),
		ignore_client_bandwidth: strToBool(cfg.hysteria_ignore_client_bandwidth),
		masquerade: cfg.hysteria_masquerade,

		/* Shadowsocks */
		method: (cfg.type === 'shadowsocks') ? cfg.shadowsocks_encrypt_method : null,
		password: (cfg.type in ['shadowsocks', 'shadowtls']) ? cfg.password : null,

		/* Tuic */
		congestion_control: cfg.tuic_congestion_control,
		auth_timeout: strToTime(cfg.tuic_auth_timeout),
		zero_rtt_handshake: strToBool(cfg.tuic_enable_zero_rtt),
		heartbeat: strToTime(cfg.tuic_heartbeat),

		/* MTProxy */
		concurrency: (cfg.type === 'mtproxy') ? strToInt(cfg.mtproxy_concurrency) : null,
		idle_timeout: (cfg.type === 'mtproxy') ? (cfg.mtproxy_idle_timeout || null) : null,
		handshake_timeout: (cfg.type === 'mtproxy') ? (cfg.mtproxy_handshake_timeout || null) : null,
		domain_fronting_port: (cfg.type === 'mtproxy') ? strToInt(cfg.domain_fronting_port) : null,
		domain_fronting_host: (cfg.type === 'mtproxy') ? (cfg.domain_fronting_host || null) : null,

		/* AnyTLS / HTTP / Hysteria (2) / Mixed / MTProxy / Socks / Trojan / Tuic / VLESS / VMess */
		users: (cfg.type === 'mtproxy') ?
			map(cfg.mtproxy_secrets || [], (s, i) => ({ name: 'user' + (i + 1), secret: s })) :
			(cfg.type !== 'shadowsocks') ? [
			{
				name: !(cfg.type in ['http', 'mixed', 'naive', 'socks']) ? 'cfg-' + cfg['.name'] + '-server' : null,
				username: cfg.username,
				password: cfg.password,

				/* Hysteria */
				auth: (cfg.hysteria_auth_type === 'base64') ? cfg.hysteria_auth_payload : null,
				auth_str: (cfg.hysteria_auth_type === 'string') ? cfg.hysteria_auth_payload : null,

				/* Tuic */
				uuid: cfg.uuid,

				/* VLESS / VMess */
				flow: cfg.vless_flow,
				alterId: strToInt(cfg.vmess_alterid)
			}
		] : null,

		multiplex: (cfg.multiplex === '1') ? {
			enabled: true,
			padding: strToBool(cfg.multiplex_padding),
			brutal: (cfg.multiplex_brutal === '1') ? {
				enabled: true,
				up_mbps: strToInt(cfg.multiplex_brutal_up),
				down_mbps: strToInt(cfg.multiplex_brutal_down)
			} : null
		} : null,

		tls: (cfg.tls === '1') ? {
			enabled: true,
			server_name: cfg.tls_sni,
			alpn: cfg.tls_alpn,
			min_version: cfg.tls_min_version,
			max_version: cfg.tls_max_version,
			cipher_suites: cfg.tls_cipher_suites,
			certificate_path: cfg.tls_cert_path,
			key_path: cfg.tls_key_path,
			acme: (cfg.tls_acme === '1') ? {
				domain: cfg.tls_acme_domain,
				data_directory: HP_DIR + '/certs',
				default_server_name: cfg.tls_acme_dsn,
				email: cfg.tls_acme_email,
				provider: cfg.tls_acme_provider,
				disable_http_challenge: strToBool(cfg.tls_acme_dhc),
				disable_tls_alpn_challenge: (cfg.tls_acme_dtac),
				alternative_http_port: strToInt(cfg.tls_acme_ahp),
				alternative_tls_port: strToInt(cfg.tls_acme_atp),
				external_account: (cfg.tls_acme_external_account === '1') ? {
					key_id: cfg.tls_acme_ea_keyid,
					mac_key: cfg.tls_acme_ea_mackey
				} : null,
				dns01_challenge: (cfg.tls_dns01_challenge === '1') ? {
					provider: cfg.tls_dns01_provider,
					access_key_id: cfg.tls_dns01_ali_akid,
					access_key_secret: cfg.tls_dns01_ali_aksec,
					region_id: cfg.tls_dns01_ali_rid,
					api_token: cfg.tls_dns01_cf_api_token
				} : null
			} : null,
			ech: (cfg.tls_ech_key) ? {
				enabled: true,
				key: split(cfg.tls_ech_key, '\n')
			} : null,
			reality: (cfg.tls_reality === '1') ? {
				enabled: true,
				private_key: cfg.tls_reality_private_key,
				short_id: cfg.tls_reality_short_id,
				max_time_difference: strToTime(cfg.tls_reality_max_time_difference),
				handshake: {
					server: cfg.tls_reality_server_addr,
					server_port: strToInt(cfg.tls_reality_server_port)
				}
			} : null
		} : null,

		transport: !isEmpty(cfg.transport) ? {
			type: cfg.transport,
			host: transport_host(cfg),
			path: cfg.http_path || cfg.ws_path,
			mode: (cfg.transport === 'xhttp') ? (cfg.xhttp_mode || 'auto') : null,
			x_padding_bytes: (is_singbox && cfg.transport === 'xhttp') ? (cfg.xhttp_padding_bytes || '100-1000') : null,
			headers: cfg.ws_host ? {
				Host: cfg.ws_host
			} : null,
			method: cfg.http_method,
			max_early_data: strToInt(cfg.websocket_early_data),
			early_data_header_name: cfg.websocket_early_data_header,
			service_name: cfg.grpc_servicename,
			idle_timeout: strToTime(cfg.http_idle_timeout),
			ping_timeout: strToTime(cfg.http_ping_timeout)
		} : null
	});
});
/* Inbound end */

/* Outbound start */
config.endpoints = [];

/* Default outbounds */
config.outbounds = [
	{
		type: 'direct',
		tag: 'direct-out'
	},
	{
		type: 'block',
		tag: 'block-out'
	}
];

/* Main outbounds */
if (!isEmpty(main_node)) {
	let urltest_nodes = [];

	if (main_node === 'urltest') {
		const main_urltest_nodes = filter(uci.get(uciconfig, ucimain, 'main_urltest_nodes') || [], (k) => uci.get_all(uciconfig, k) != null);
		const main_urltest_interval = uci.get(uciconfig, ucimain, 'main_urltest_interval');
		const main_urltest_tolerance = uci.get(uciconfig, ucimain, 'main_urltest_tolerance');

		push(config.outbounds, {
			type: 'urltest',
			tag: 'main-out',
			outbounds: map(main_urltest_nodes, (k) => `cfg-${k}-out`),
			interval: strToTime(main_urltest_interval),
			tolerance: strToInt(main_urltest_tolerance),
			idle_timeout: (strToInt(main_urltest_interval) > 1800) ? `${main_urltest_interval * 2}s` : null,
		});
		urltest_nodes = main_urltest_nodes;
	} else if (main_node === 'byedpi-out') {
		/* ByeDPI as main node: route through the local ByeDPI socks proxy.
		 * byedpi-out is a synthetic tag, not a real node section, so build the
		 * socks outbound here. Fall back to direct if ByeDPI is disabled. */
		if (byedpi_enabled === '1')
			push(config.outbounds, {
				type: 'socks',
				tag: 'main-out',
				server: '127.0.0.1',
				server_port: 5335,
				udp_over_tcp: (uci.get(uciconfig, ucimain, 'byedpi_udp_over_tcp') !== '0') || null
			});
		else
			push(config.outbounds, { type: 'direct', tag: 'main-out' });
	} else {
		const main_node_cfg = uci.get_all(uciconfig, main_node) || {};
		if (main_node_cfg.type in ['wireguard', 'amneziawg']) {
			push(config.endpoints, generate_endpoint(main_node_cfg));
			config.endpoints[length(config.endpoints)-1].tag = 'main-out';
		} else {
			push_outbound(config.outbounds, main_node_cfg);
			config.outbounds[length(config.outbounds)-1].tag = 'main-out';
		}
	}

	if (main_udp_node === 'urltest') {
		const main_udp_urltest_nodes = filter(uci.get(uciconfig, ucimain, 'main_udp_urltest_nodes') || [], (k) => uci.get_all(uciconfig, k) != null);
		const main_udp_urltest_interval = uci.get(uciconfig, ucimain, 'main_udp_urltest_interval');
		const main_udp_urltest_tolerance = uci.get(uciconfig, ucimain, 'main_udp_urltest_tolerance');

		push(config.outbounds, {
			type: 'urltest',
			tag: 'main-udp-out',
			outbounds: map(main_udp_urltest_nodes, (k) => `cfg-${k}-out`),
			interval: strToTime(main_udp_urltest_interval),
			tolerance: strToInt(main_udp_urltest_tolerance),
			idle_timeout: (strToInt(main_udp_urltest_interval) > 1800) ? `${main_udp_urltest_interval * 2}s` : null,
		});
		urltest_nodes = [...urltest_nodes, ...filter(main_udp_urltest_nodes, (l) => !~index(urltest_nodes, l))];
	} else if (dedicated_udp_node && main_udp_node === 'byedpi-out') {
		/* ByeDPI as dedicated UDP node — same synthetic-tag handling as above */
		if (byedpi_enabled === '1')
			push(config.outbounds, {
				type: 'socks',
				tag: 'main-udp-out',
				server: '127.0.0.1',
				server_port: 5335,
				udp_over_tcp: (uci.get(uciconfig, ucimain, 'byedpi_udp_over_tcp') !== '0') || null
			});
		else
			push(config.outbounds, { type: 'direct', tag: 'main-udp-out' });
	} else if (dedicated_udp_node) {
		const main_udp_node_cfg = uci.get_all(uciconfig, main_udp_node) || {};
		if (main_udp_node_cfg.type in ['wireguard', 'amneziawg']) {
			push(config.endpoints, generate_endpoint(main_udp_node_cfg));
			config.endpoints[length(config.endpoints)-1].tag = 'main-udp-out';
		} else {
			push_outbound(config.outbounds, main_udp_node_cfg);
			config.outbounds[length(config.outbounds)-1].tag = 'main-udp-out';
		}
	}

	for (let i in urltest_nodes) {
		const urltest_node = uci.get_all(uciconfig, i);
		if (!urltest_node) continue;
		if (urltest_node.type in ['wireguard', 'amneziawg']) {
			push(config.endpoints, generate_endpoint(urltest_node));
			config.endpoints[length(config.endpoints)-1].tag = 'cfg-' + i + '-out';
		} else {
			push_outbound(config.outbounds, urltest_node);
			config.outbounds[length(config.outbounds)-1].tag = 'cfg-' + i + '-out';
		}
	}

	/* Advanced routing_node outbounds for proxy_banned_ru */
	if (routing_mode === 'proxy_banned_ru' && show_advanced_rules === '1') {
		let adv_urltest_nodes = [],
		    adv_routing_nodes = [];

		uci.foreach(uciconfig, uciroutingnode, (cfg) => {
			if (cfg.enabled !== '1') return;

			if (cfg.node === 'urltest') {
				const existing_urltest_nodes = filter(cfg.urltest_nodes, (k) => uci.get_all(uciconfig, k) != null);
				push(config.outbounds, {
					type: 'urltest',
					tag: 'cfg-' + cfg['.name'] + '-out',
					outbounds: map(existing_urltest_nodes, (k) => `cfg-${k}-out`),
					url: cfg.urltest_url,
					interval: strToTime(cfg.urltest_interval),
					tolerance: strToInt(cfg.urltest_tolerance),
					idle_timeout: strToTime(cfg.urltest_idle_timeout),
					interrupt_exist_connections: strToBool(cfg.urltest_interrupt_exist_connections)
				});
				adv_urltest_nodes = [...adv_urltest_nodes, ...filter(existing_urltest_nodes, (l) => !~index(adv_urltest_nodes, l))];
			} else {
				const outbound = uci.get_all(uciconfig, cfg.node) || {};
				/* Skip a routing node whose target proxy node is empty or dangling —
				 * otherwise push_outbound() appends a null outbound and the next line
				 * dereferences it, crashing config generation (no file is written). */
				if (isEmpty(outbound)) return;
				if (outbound.type in ['wireguard', 'amneziawg']) {
					push(config.endpoints, generate_endpoint(outbound));
					config.endpoints[length(config.endpoints)-1].bind_interface = cfg.bind_interface;
					config.endpoints[length(config.endpoints)-1].detour = get_outbound(cfg.outbound);
				} else {
					push_outbound(config.outbounds, outbound);
					config.outbounds[length(config.outbounds)-1].bind_interface = cfg.bind_interface;
					const adv_chain_detour = get_outbound(cfg.outbound);
					if (adv_chain_detour)
						config.outbounds[length(config.outbounds)-1].detour = adv_chain_detour;
				}
				push(adv_routing_nodes, cfg.node);
			}
		});

		for (let i in filter(adv_urltest_nodes, (l) => !~index(adv_routing_nodes, l))) {
			if (has_outbound('cfg-' + i + '-out')) continue;
			const urltest_node = uci.get_all(uciconfig, i);
			if (!urltest_node) continue;
			if (urltest_node.type in ['wireguard', 'amneziawg'])
				push(config.endpoints, generate_endpoint(urltest_node));
			else
				push_outbound(config.outbounds, urltest_node);
		}
	}
} else if (!isEmpty(default_outbound)) {
	let urltest_nodes = [],
	    routing_nodes = [];

	uci.foreach(uciconfig, uciroutingnode, (cfg) => {
		if (cfg.enabled !== '1')
			return;

		if (cfg.node === 'urltest') {
			const existing_urltest_nodes = filter(cfg.urltest_nodes, (k) => uci.get_all(uciconfig, k) != null);
			push(config.outbounds, {
				type: 'urltest',
				tag: 'cfg-' + cfg['.name'] + '-out',
				outbounds: map(existing_urltest_nodes, (k) => `cfg-${k}-out`),
				url: cfg.urltest_url,
				interval: strToTime(cfg.urltest_interval),
				tolerance: strToInt(cfg.urltest_tolerance),
				idle_timeout: strToTime(cfg.urltest_idle_timeout),
				interrupt_exist_connections: strToBool(cfg.urltest_interrupt_exist_connections)
			});
			urltest_nodes = [...urltest_nodes, ...filter(existing_urltest_nodes, (l) => !~index(urltest_nodes, l))];
		} else {
			const outbound = uci.get_all(uciconfig, cfg.node) || {};
			/* Skip a routing node whose target proxy node is empty or dangling —
			 * otherwise push_outbound() appends a null outbound and the next line
			 * dereferences it, crashing config generation (no file is written). */
			if (isEmpty(outbound)) return;
			if (outbound.type in ['wireguard', 'amneziawg']) {
				push(config.endpoints, generate_endpoint(outbound));
				config.endpoints[length(config.endpoints)-1].bind_interface = cfg.bind_interface;
				config.endpoints[length(config.endpoints)-1].detour = get_outbound(cfg.outbound);
				if (cfg.domain_resolver)
					config.endpoints[length(config.endpoints)-1].domain_resolver = {
						server: get_resolver(cfg.domain_resolver),
						strategy: cfg.domain_strategy
					};
			} else {
				push_outbound(config.outbounds, outbound);
				config.outbounds[length(config.outbounds)-1].bind_interface = cfg.bind_interface;
				const chain_detour = get_outbound(cfg.outbound);
				if (chain_detour)
					config.outbounds[length(config.outbounds)-1].detour = chain_detour;
				if (cfg.domain_resolver)
					config.outbounds[length(config.outbounds)-1].domain_resolver = {
						server: get_resolver(cfg.domain_resolver),
						strategy: cfg.domain_strategy
					};
			}
			push(routing_nodes, cfg.node);
		}
	});

	for (let i in filter(urltest_nodes, (l) => !~index(routing_nodes, l))) {
		const urltest_node = uci.get_all(uciconfig, i);
		if (!urltest_node) continue;
		if (urltest_node.type in ['wireguard', 'amneziawg'])
			push(config.endpoints, generate_endpoint(urltest_node));
		else
			push_outbound(config.outbounds, urltest_node);
	}
}

if (isEmpty(config.endpoints))
	config.endpoints = null;
/* Outbound end */

/* Routing rules start */
/* Default settings */
config.route = {
	rules: [
		{
			inbound: 'dns-in',
			action: 'hijack-dns'
		},
		is_singbox ? {
			action: 'sniff'
		} : null
	],
	rule_set: [],
	auto_detect_interface: isEmpty(default_interface) ? true : null,
	default_interface: default_interface,
	default_mark: strToInt(self_mark)
};

/* Routing rules */
if (!isEmpty(main_node)) {
	/* Avoid DNS loop */
	/* sing-box-extended supports action object; hiddify-core (standard sing-box 1.12) expects a string tag */
	const default_resolver_server = (routing_mode === 'bypass_mainland_china') ? 'china-dns' :
	                                (routing_mode === 'proxy_banned_ru') ? 'russia-dns' : 'default-dns';
	config.route.default_domain_resolver = is_singbox ? {
		action: 'route',
		server: default_resolver_server,
		strategy: (ipv6_support !== '1') ? 'prefer_ipv4' : null
	} : default_resolver_server;

	/* Direct list (not needed in proxy_banned_ru — direct is the default) */
	if (length(direct_domain_list) && routing_mode !== 'proxy_banned_ru')
		push(config.route.rules, {
			rule_set: 'direct-domain',
			action: 'route',
			outbound: 'direct-out'
		});

	/* Main UDP out (not used in proxy_banned_ru — would proxy all UDP traffic) */
	if (dedicated_udp_node && routing_mode !== 'proxy_banned_ru')
		push(config.route.rules, {
			network: 'udp',
			action: 'route',
			outbound: 'main-udp-out'
		});

	config.route.final = (routing_mode === 'proxy_banned_ru') ? 'direct-out' : 'main-out';

	/* Rule set */
	/* Direct list */
	if (length(direct_domain_list) && routing_mode !== 'proxy_banned_ru')
		push(config.route.rule_set, {
			type: 'inline',
			tag: 'direct-domain',
			rules: [
				{
					domain_keyword: direct_domain_list,
				}
			]
		});

	/* Proxy list — also used in proxy_banned_ru for proxy-domain → main-out */
	if (length(proxy_domain_list))
		push(config.route.rule_set, {
			type: 'inline',
			tag: 'proxy-domain',
			rules: [
				{
					domain_keyword: proxy_domain_list,
				}
			]
		});

	if (routing_mode === 'proxy_banned_ru') {
		/* Resolve domains before routing — prevents the proxy server from doing its own DNS resolution */
		push(config.route.rules, {
			action: 'resolve',
			strategy: (ipv6_support !== '1') ? 'ipv4_only' : null
		});

		/* Advanced custom routing rules (highest priority) */
		if (show_advanced_rules === '1') {
			uci.foreach(uciconfig, uciroutingrule, (cfg) => {
				if (cfg.enabled !== '1') return;

				push(config.route.rules, {
					inbound: cfg.inbound,
					ip_version: strToInt(cfg.ip_version),
					protocol: cfg.protocol,
					network: cfg.network,
					domain: cfg.domain,
					domain_suffix: cfg.domain_suffix,
					domain_keyword: cfg.domain_keyword,
					domain_regex: cfg.domain_regex,
					source_ip_cidr: cfg.source_ip_cidr,
					source_ip_is_private: strToBool(cfg.source_ip_is_private),
					ip_cidr: cfg.ip_cidr,
					ip_is_private: strToBool(cfg.ip_is_private),
					source_port: parse_port(cfg.source_port),
					source_port_range: cfg.source_port_range,
					port: parse_port(cfg.port),
					port_range: cfg.port_range,
					process_name: cfg.process_name,
					process_path: cfg.process_path,
					process_path_regex: cfg.process_path_regex,
					user: cfg.user,
					rule_set: get_ruleset(cfg.rule_set),
					rule_set_ip_cidr_match_source: strToBool(cfg.rule_set_ip_cidr_match_source),
					rule_set_ip_cidr_accept_empty: strToBool(cfg.rule_set_ip_cidr_accept_empty),
					invert: strToBool(cfg.invert),
					action: cfg.action,
					outbound: get_outbound(cfg.outbound),
					override_address: cfg.override_address,
					override_port: strToInt(cfg.override_port)
				});
			});
		}

		/* Call proxying rules: UDP media ports + XMPP/SIP ports for VoIP apps */
		/* Torrent bypass first — takes priority over proxy_calls port ranges (51413 overlaps 50000:65530) */
		if (no_proxy_torrents === '1') {
			push(config.route.rules, {
				protocol: ['bittorrent'],
				action: 'route',
				outbound: 'direct-out'
			});
			push(config.route.rules, {
				port_range: ['6881:6889', '51413:51413'],
				action: 'route',
				outbound: 'direct-out'
			});
		}

		if (proxy_calls === '1') {
			push(config.route.rules, {
				network: 'udp',
				port: [1400, 8443],
				port_range: ['50000:65530', '596:599', '3478:3497', '16384:16387', '16393:16402'],
				action: 'route',
				outbound: 'main-out'
			});
			push(config.route.rules, {
				port: [4244, 7985, 5222, 5223, 5242, 5243],
				action: 'route',
				outbound: 'main-out'
			});
		}

		/* andrevi.ch always via proxy (hardcoded diagnostic anchor) */
		push(config.route.rules, {
			domain: ['andrevi.ch'],
			action: 'route',
			outbound: 'main-out'
		});

		/* Custom proxy list → main-out */
		if (length(proxy_domain_list))
			push(config.route.rules, {
				rule_set: 'proxy-domain',
				action: 'route',
				outbound: 'main-out'
			});

		/* Per-rule outbounds and rule sets
		 * Priority order: specific services first → russia-inside → refilter (largest list last) */
		const ru_source_priority = (s) => s === 'refilter' ? 2 : s === 'russia-inside' ? 1 : 0;
		let ru_rules = [];
		uci.foreach(uciconfig, ucirurule, (cfg) => { if (cfg.enabled === '1') push(ru_rules, cfg); });
		ru_rules = sort(ru_rules, (a, b) => ru_source_priority(a.source) - ru_source_priority(b.source));

		/* Use direct-out for rule set downloads when the main path isn't startup-safe:
		 * WireGuard/AmneziaWG endpoints aren't ready yet, and ByeDPI resolves hostnames
		 * through sing-box's own DNS inbound — which isn't serving during rule-set init, so
		 * downloading github through it deadlocks (socks5 code 4 "host unreachable") and
		 * FATALs the whole service. Direct download lets sing-box resolve via russia-dns. */
		const main_node_type = uci.get(uciconfig, main_node, 'type') || '';
		let main_has_wg = (main_node_type in ['wireguard', 'amneziawg']);
		if (!main_has_wg && main_node === 'urltest') {
			const ut_nodes = filter(uci.get(uciconfig, ucimain, 'main_urltest_nodes') || [], (k) => uci.get_all(uciconfig, k) != null);
			for (let n in ut_nodes) {
				if ((uci.get(uciconfig, n, 'type') || '') in ['wireguard', 'amneziawg']) {
					main_has_wg = true;
					break;
				}
			}
		}
		const ruleset_detour = (main_has_wg || main_node === 'byedpi-out') ? 'direct-out' : 'main-out';

		for (let cfg in ru_rules) {

			/* 'main-out' routes through the main proxy; 'byedpi-out' through the shared ByeDPI
			 * socks outbound (already created when ByeDPI is enabled). Both reuse an existing
			 * outbound, so no per-source outbound is generated. */
			let effective_outbound;
			if (cfg.node === 'main-out' || isEmpty(cfg.node))
				effective_outbound = 'main-out';
			else if (cfg.node === 'byedpi-out')
				effective_outbound = (byedpi_enabled === '1') ? 'byedpi-out' : 'direct-out';
			else
				effective_outbound = 'hp-ru-' + cfg.source + '-out';

			if (cfg.node === 'main-out' || isEmpty(cfg.node) || cfg.node === 'byedpi-out') {
				/* no new outbound needed — main-out / byedpi-out already exist */
			} else if (!has_outbound(effective_outbound)) {
				if (cfg.node === 'urltest') {
					const ut_nodes = filter(cfg.urltest_nodes || [], (k) => uci.get_all(uciconfig, k) != null);
					push(config.outbounds, {
						type: 'urltest',
						tag: effective_outbound,
						outbounds: map(ut_nodes, (k) => `cfg-${k}-out`),
						interval: strToTime(cfg.urltest_interval || '180'),
						tolerance: strToInt(cfg.urltest_tolerance || '150'),
						idle_timeout: '1800s'
					});
					/* Generate underlying node outbounds, skipping already-generated tags */
					for (let n in ut_nodes) {
						if (has_outbound('cfg-' + n + '-out')) continue;
						const nc = uci.get_all(uciconfig, n);
						if (!nc) continue;
						if (nc.type in ['wireguard', 'amneziawg']) {
							push(config.endpoints, generate_endpoint(nc));
							config.endpoints[length(config.endpoints)-1].tag = 'cfg-' + n + '-out';
						} else {
							push_outbound(config.outbounds, nc);
							config.outbounds[length(config.outbounds)-1].tag = 'cfg-' + n + '-out';
						}
					}
				} else if (!isEmpty(cfg.node)) {
					const nc = uci.get_all(uciconfig, cfg.node) || {};
					if (nc.type in ['wireguard', 'amneziawg']) {
						push(config.endpoints, generate_endpoint(nc));
						config.endpoints[length(config.endpoints)-1].tag = effective_outbound;
					} else {
						push_outbound(config.outbounds, nc);
						config.outbounds[length(config.outbounds)-1].tag = effective_outbound;
					}
				}
			}

			/* Routing rules */
			const rule_sets = (cfg.source === 'refilter')
				? ['hp-ru-refilter-domain', 'hp-ru-refilter-ip']
				: ['hp-ru-' + cfg.source];
			push(config.route.rules, {
				rule_set: rule_sets,
				action: 'route',
				outbound: effective_outbound
			});

			/* Rule sets (remote — core handles download and 1d refresh) */
			const has_ruleset = (tag) => filter(config.route.rule_set, (rs) => rs.tag === tag).length > 0;
			if (cfg.source === 'refilter') {
				if (!has_ruleset('hp-ru-refilter-domain'))
					push(config.route.rule_set, {
						type: 'remote',
						tag: 'hp-ru-refilter-domain',
						format: 'binary',
						url: 'https://github.com/1andrevich/Re-filter-lists/releases/latest/download/ruleset-domain-refilter_domains.srs',
						download_detour: ruleset_detour,
						update_interval: '1d'
					});
				if (!has_ruleset('hp-ru-refilter-ip'))
					push(config.route.rule_set, {
						type: 'remote',
						tag: 'hp-ru-refilter-ip',
						format: 'binary',
						url: 'https://github.com/1andrevich/Re-filter-lists/releases/latest/download/ruleset-ip-refilter_ipsum.srs',
						download_detour: ruleset_detour,
						update_interval: '1d'
					});
			} else {
				if (!has_ruleset('hp-ru-' + cfg.source))
					push(config.route.rule_set, {
						type: 'remote',
						tag: 'hp-ru-' + cfg.source,
						format: 'binary',
						url: 'https://github.com/itdoginfo/allow-domains/releases/latest/download/' + replace(cfg.source, '-', '_') + '.srs',
						download_detour: ruleset_detour,
						update_interval: '1d'
					});
			}
		}
	}

	if (routing_mode === 'bypass_mainland_china') {
		push(config.route.rule_set, {
			type: 'remote',
			tag: 'geoip-cn',
			format: 'binary',
			url: 'https://fastly.jsdelivr.net/gh/1715173329/IPCIDR-CHINA@rule-set/cn.srs',
			download_detour: 'main-out'
		});
		push(config.route.rule_set, {
			type: 'remote',
			tag: 'geosite-cn',
			format: 'binary',
			url: 'https://fastly.jsdelivr.net/gh/1715173329/sing-geosite@rule-set-unstable/geosite-geolocation-cn.srs',
			download_detour: 'main-out'
		});
		push(config.route.rule_set, {
			type: 'remote',
			tag: 'geosite-noncn',
			format: 'binary',
			url: 'https://fastly.jsdelivr.net/gh/1715173329/sing-geosite@rule-set-unstable/geosite-geolocation-!cn.srs',
			download_detour: 'main-out'
		});
	}

	if (isEmpty(config.route.rule_set))
		config.route.rule_set = null;
} else if (!isEmpty(default_outbound)) {
	config.route.default_domain_resolver = is_singbox ? {
		action: 'resolve',
		server: get_resolver(default_outbound_dns)
	} : get_resolver(default_outbound_dns);

	if (domain_strategy)
		push(config.route.rules, {
			action: 'resolve',
			strategy: domain_strategy
		});

	uci.foreach(uciconfig, uciroutingrule, (cfg) => {
		if (cfg.enabled !== '1')
			return null;

		push(config.route.rules, {
			inbound: cfg.inbound,
			ip_version: strToInt(cfg.ip_version),
			protocol: cfg.protocol,
			network: cfg.network,
			domain: cfg.domain,
			domain_suffix: cfg.domain_suffix,
			domain_keyword: cfg.domain_keyword,
			domain_regex: cfg.domain_regex,
			source_ip_cidr: cfg.source_ip_cidr,
			source_ip_is_private: strToBool(cfg.source_ip_is_private),
			ip_cidr: cfg.ip_cidr,
			ip_is_private: strToBool(cfg.ip_is_private),
			source_port: parse_port(cfg.source_port),
			source_port_range: cfg.source_port_range,
			port: parse_port(cfg.port),
			port_range: cfg.port_range,
			process_name: cfg.process_name,
			process_path: cfg.process_path,
			process_path_regex: cfg.process_path_regex,
			user: cfg.user,
			rule_set: get_ruleset(cfg.rule_set),
			rule_set_ip_cidr_match_source: strToBool(cfg.rule_set_ip_cidr_match_source),
			rule_set_ip_cidr_accept_empty: strToBool(cfg.rule_set_ip_cidr_accept_empty),
			invert: strToBool(cfg.invert),
			action: cfg.action,
			outbound: get_outbound(cfg.outbound),
			override_address: cfg.override_address,
			override_port: strToInt(cfg.override_port),
			udp_disable_domain_unmapping: strToBool(cfg.udp_disable_domain_unmapping),
			udp_connect: strToBool(cfg.udp_connect),
			udp_timeout: strToTime(cfg.udp_timeout),
			tls_fragment: strToBool(cfg.tls_fragment),
			tls_fragment_fallback_delay: strToTime(cfg.tls_fragment_fallback_delay),
			tls_record_fragment: strToBool(cfg.tls_record_fragment)
		});
	});

	config.route.final = get_outbound(default_outbound);

	/* Rule set */
	uci.foreach(uciconfig, uciruleset, (cfg) => {
		if (cfg.enabled !== '1')
			return null;

		push(config.route.rule_set, {
			type: cfg.type,
			tag: 'cfg-' + cfg['.name'] + '-rule',
			format: cfg.format,
			path: cfg.path,
			url: cfg.url,
			download_detour: get_outbound(cfg.outbound),
			update_interval: cfg.update_interval
		});
	});
}
/* Routing rules end */

/* ByeDPI outbound */
if (byedpi_enabled === '1') {
	const byedpi_uot = uci.get(uciconfig, ucimain, 'byedpi_udp_over_tcp') !== '0';
	push(config.outbounds, {
		type: 'socks',
		tag: 'byedpi-out',
		server: '127.0.0.1',
		server_port: 5335,
		udp_over_tcp: byedpi_uot || null
	});
}
/* ByeDPI outbound end */

/* Experimental start */
config.experimental = {
	clash_api: {
		external_controller: '127.0.0.1:9090'
	}
};
if (routing_mode in ['bypass_mainland_china', 'proxy_banned_ru', 'custom']) {
	config.experimental.cache_file = {
		enabled: true,
		path: RUN_DIR + '/cache.db',
		store_rdrc: strToBool(cache_file_store_rdrc),
		rdrc_timeout: strToTime(cache_file_rdrc_timeout),
	};
}
/* Experimental end */

system('mkdir -p ' + RUN_DIR);
writefile(RUN_DIR + '/hiddify-c.json', sprintf('%.J\n', removeBlankAttrs(config)));
