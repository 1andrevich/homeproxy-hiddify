# SPDX-License-Identifier: GPL-2.0-only
#
# Copyright (C) 2022-2023 ImmortalWrt.org
# Copyright (C) 2024-2026 1andrevich <1andrevich.recede274@passmail.net>

include $(TOPDIR)/rules.mk

LUCI_TITLE:=Re:HomeProxy - multi-core proxy platform (fork of ImmortalWrt HomeProxy)
LUCI_PKGARCH:=all
LUCI_DEPENDS:= \
	+firewall4 \
	+ucode-mod-digest

PKG_NAME:=luci-app-re-homeproxy
PKG_VERSION:=1
PKG_RELEASE:=1
PKG_MAINTAINER:=1andrevich <1andrevich.recede274@passmail.net>
PKG_LICENSE:=GPL-2.0-only
PKG_LICENSE_FILES:=LICENSE

define Package/luci-app-re-homeproxy/conffiles
/etc/config/homeproxy
/etc/homeproxy/certs/
/etc/homeproxy/ruleset/
/etc/homeproxy/resources/direct_list.txt
/etc/homeproxy/resources/proxy_list.txt
endef

define Package/luci-app-re-homeproxy/postinst
#!/bin/sh
# Full restart, NOT kill -HUP: SIGHUP only reloads ACLs/session, so rpcd keeps the
# OLD ucode method set from /usr/share/rpcd/ucode/ until restarted. On every update
# that shipped a new/changed method (e.g. zapret_resolve_hosts) the method would be
# missing/stale until a manual `rpcd restart` — surfacing as "DNS not ready",
# yellow "?" in diagnostics, "Unknown method", etc. A restart reloads methods + ACLs.
# Detached + redirected and after a short delay so it (a) lets the install finish
# first, and (b) doesn't block when the upgrade is driven THROUGH rpcd (LuCI Software
# page): rpcd's popen() would otherwise wait on a child holding stdout open.
[ -n "$$IPKG_INSTROOT" ] || ( sleep 2; /etc/init.d/rpcd restart ) >/dev/null 2>&1 &
exit 0
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
