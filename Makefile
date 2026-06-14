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
[ -n "$$IPKG_INSTROOT" ] || kill -HUP $$(pidof rpcd) 2>/dev/null
exit 0
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
