#!/bin/bash
# SPDX-License-Identifier: GPL-2.0-only
#
# Copyright (C) 2023 Tianling Shen <cnsztl@immortalwrt.org>

set -o errexit
set -o pipefail

PKG_MGR="${1:-apk}"
RELEASE_TYPE="${2:-snapshot}"
LEGACY="${3:-}"

export PKG_SOURCE_DATE_EPOCH="$(date "+%s")"
export SOURCE_DATE_EPOCH="$PKG_SOURCE_DATE_EPOCH"

BASE_DIR="$(cd "$(dirname $0)"; pwd)"
PKG_DIR="$BASE_DIR/.."

function get_mk_value() {
	awk -F "$1:=" '{print $2}' "$PKG_DIR/Makefile" | xargs
}

PKG_NAME="$(get_mk_value "PKG_NAME")"
if [ "$RELEASE_TYPE" == "release" ]; then
	PKG_VERSION="$(get_mk_value "PKG_VERSION")"
else
	PKG_VERSION="$(date -u +%Y.%m.%d)-r$(git rev-list --count HEAD)"
fi

TEMP_DIR="$(mktemp -d -p $BASE_DIR)"
TEMP_PKG_DIR="$TEMP_DIR/$PKG_NAME"
mkdir -p "$TEMP_PKG_DIR/lib/upgrade/keep.d/"
mkdir -p "$TEMP_PKG_DIR/usr/lib/lua/luci/i18n/"
mkdir -p "$TEMP_PKG_DIR/www/"
if [ "$PKG_MGR" == "apk" ]; then
	mkdir -p "$TEMP_PKG_DIR/lib/apk/packages/"
else
	mkdir -p "$TEMP_PKG_DIR/CONTROL/"
fi

cp -fpR "$PKG_DIR/htdocs"/* "$TEMP_PKG_DIR/www/"
cp -fpR "$PKG_DIR/root"/* "$TEMP_PKG_DIR/"

cat > "$TEMP_PKG_DIR/lib/upgrade/keep.d/$PKG_NAME" <<-EOF
/etc/homeproxy/certs/
/etc/homeproxy/ruleset/
/etc/homeproxy/resources/direct_list.txt
/etc/homeproxy/resources/proxy_list.txt
EOF

po2lmo "$PKG_DIR/po/zh_Hans/homeproxy.po" "$TEMP_PKG_DIR/usr/lib/lua/luci/i18n/homeproxy.zh-cn.lmo"

if [ "$PKG_MGR" == "apk" ]; then
	find "$TEMP_PKG_DIR" -type f,l -printf '/%P\n' | sort > "$TEMP_PKG_DIR/lib/apk/packages/$PKG_NAME.list"
	echo "/etc/config/homeproxy" >> "$TEMP_PKG_DIR/lib/apk/packages/$PKG_NAME.conffiles"
	cat "$TEMP_PKG_DIR/lib/apk/packages/$PKG_NAME.conffiles" | while IFS= read -r file; do
		[ -f "$TEMP_PKG_DIR/$file" ] || continue
		sha256sum "$TEMP_PKG_DIR/$file" | sed "s,$TEMP_PKG_DIR/,," >> "$TEMP_PKG_DIR/lib/apk/packages/$PKG_NAME.conffiles_static"
	done

	echo -e '#!/bin/sh
[ "${IPKG_NO_SCRIPT}" = "1" ] && exit 0
[ -s ${IPKG_INSTROOT}/lib/functions.sh ] || exit 0
. ${IPKG_INSTROOT}/lib/functions.sh
export root="${IPKG_INSTROOT}"
export pkgname="'"$PKG_NAME"'"
add_group_and_user
default_postinst
[ -n "${IPKG_INSTROOT}" ] || { rm -f /tmp/luci-indexcache.*
	rm -rf /tmp/luci-modulecache/
	killall -HUP rpcd 2>/dev/null
	exit 0
}' > "$TEMP_DIR/post-install"

	echo -e '#!/bin/sh
export PKG_UPGRADE=1
#!/bin/sh
[ "${IPKG_NO_SCRIPT}" = "1" ] && exit 0
[ -s ${IPKG_INSTROOT}/lib/functions.sh ] || exit 0
. ${IPKG_INSTROOT}/lib/functions.sh
export root="${IPKG_INSTROOT}"
export pkgname="'"$PKG_NAME"'"
add_group_and_user
default_postinst
[ -n "${IPKG_INSTROOT}" ] || { rm -f /tmp/luci-indexcache.*
	rm -rf /tmp/luci-modulecache/
	killall -HUP rpcd 2>/dev/null
	exit 0
}' > "$TEMP_DIR/post-upgrade"

	echo -e '#!/bin/sh
[ -s ${IPKG_INSTROOT}/lib/functions.sh ] || exit 0
. ${IPKG_INSTROOT}/lib/functions.sh
export root="${IPKG_INSTROOT}"
export pkgname="'"$PKG_NAME"'"
default_prerm' > "$TEMP_DIR/pre-deinstall"

	apk mkpkg \
		--info "name:$PKG_NAME" \
		--info "version:$PKG_VERSION" \
		--info "description:The modern ImmortalWrt hiddify-core based proxy platform" \
		--info "arch:noarch" \
		--info "origin:$PKG_NAME" \
		--info "url:https://github.com/1andrevich/homeproxy-hiddify" \
		--info "maintainer:1andrevich <1andrevich.recede274@passmail.net>" \
		--script "post-install:$TEMP_DIR/post-install" \
		--script "post-upgrade:$TEMP_DIR/post-upgrade" \
		--script "pre-deinstall:$TEMP_DIR/pre-deinstall" \
		--info "depends:libc firewall4 ucode-mod-digest" \
		--info "provides:luci-app-homeproxy" \
		${APK_SIGN_KEY:+--sign-key "$APK_SIGN_KEY"} \
		--files "$TEMP_PKG_DIR" \
		--output "$TEMP_DIR/${PKG_NAME}_${PKG_VERSION}.apk"

	mv "$TEMP_DIR/${PKG_NAME}_${PKG_VERSION}.apk" "$BASE_DIR/${PKG_NAME}_${PKG_VERSION}_all.apk"
else
	mkdir -p "$TEMP_PKG_DIR/CONTROL/"

	if [ "$LEGACY" == "legacy" ]; then
		SUBSC_UC="$TEMP_PKG_DIR/etc/homeproxy/scripts/update_subscriptions.uc"
		cat > /tmp/hp_legacy_patch.py << 'PYEOF'
import sys
path = sys.argv[1]
with open(path) as f:
    c = f.read()
c = c.replace("import { md5 } from 'digest';\n", "")
c = c.replace("import { open } from 'fs';", "import { open, popen } from 'fs';")
md5_fn = """
function md5(s) {
\tconst tmp = '/tmp/.hp_md5tmp';
\tconst f = open(tmp, 'w');
\tif (!f) return '';
\tf.write(s);
\tf.close();
\tconst fd = popen('md5sum < /tmp/.hp_md5tmp');
\tif (!fd) return '';
\tconst out = trim(fd.read('line'));
\tfd.close();
\treturn split(out, ' ')[0] || '';
}

"""
c = c.replace("/* UCI config start */", md5_fn + "/* UCI config start */")
with open(path, 'w') as f:
    f.write(c)
PYEOF
		python3 /tmp/hp_legacy_patch.py "$SUBSC_UC"
		rm -f /tmp/hp_legacy_patch.py
		IPK_DEPS="libc, firewall4, kmod-nft-tproxy"
	else
		IPK_DEPS="libc, firewall4, kmod-nft-tproxy, ucode-mod-digest"
	fi

	cat > "$TEMP_PKG_DIR/CONTROL/control" <<-EOF
		Package: $PKG_NAME
		Version: $PKG_VERSION
		Depends: $IPK_DEPS
		Provides: luci-app-homeproxy
		Conflicts: luci-app-homeproxy
		Replaces: luci-app-homeproxy
		Source: https://github.com/1andrevich/homeproxy-hiddify
		SourceName: $PKG_NAME
		Section: luci
		SourceDateEpoch: $PKG_SOURCE_DATE_EPOCH
		Maintainer: 1andrevich <1andrevich.recede274@passmail.net>
		Architecture: all
		Installed-Size: TO-BE-FILLED-BY-IPKG-BUILD
		Description:  The modern ImmortalWrt hiddify-core based proxy platform
	EOF
	chmod 0644 "$TEMP_PKG_DIR/CONTROL/control"

	echo -e "/etc/config/homeproxy" > "$TEMP_PKG_DIR/CONTROL/conffiles"

	echo -e '#!/bin/sh
[ "${IPKG_NO_SCRIPT}" = "1" ] && exit 0
[ -s ${IPKG_INSTROOT}/lib/functions.sh ] || exit 0
. ${IPKG_INSTROOT}/lib/functions.sh
default_postinst $0 $@' > "$TEMP_PKG_DIR/CONTROL/postinst"
	chmod 0755 "$TEMP_PKG_DIR/CONTROL/postinst"

	echo -e "[ -n "\${IPKG_INSTROOT}" ] || {
	(. /etc/uci-defaults/$PKG_NAME) && rm -f /etc/uci-defaults/$PKG_NAME
	rm -f /tmp/luci-indexcache
	rm -rf /tmp/luci-modulecache/
	exit 0
}" > "$TEMP_PKG_DIR/CONTROL/postinst-pkg"
	chmod 0755 "$TEMP_PKG_DIR/CONTROL/postinst-pkg"

	echo -e '#!/bin/sh
[ -s ${IPKG_INSTROOT}/lib/functions.sh ] || exit 0
. ${IPKG_INSTROOT}/lib/functions.sh
default_prerm $0 $@' > "$TEMP_PKG_DIR/CONTROL/prerm"
	chmod 0755 "$TEMP_PKG_DIR/CONTROL/prerm"

	ipkg-build -m "" "$TEMP_PKG_DIR" "$TEMP_DIR"

	if [ "$LEGACY" == "legacy" ]; then
		mv "$TEMP_DIR/${PKG_NAME}_${PKG_VERSION}_all.ipk" "$BASE_DIR/${PKG_NAME}_${PKG_VERSION}_all-legacy.ipk"
	else
		mv "$TEMP_DIR/${PKG_NAME}_${PKG_VERSION}_all.ipk" "$BASE_DIR/${PKG_NAME}_${PKG_VERSION}_all.ipk"
	fi
fi

rm -rf "$TEMP_DIR"

# Build i18n package for Russian
I18N_PKG_NAME="luci-i18n-homeproxy-ru"
I18N_TEMP_DIR="$(mktemp -d -p $BASE_DIR)"
I18N_TEMP_PKG_DIR="$I18N_TEMP_DIR/$I18N_PKG_NAME"
mkdir -p "$I18N_TEMP_PKG_DIR/usr/lib/lua/luci/i18n/"
if [ "$PKG_MGR" == "apk" ]; then
	mkdir -p "$I18N_TEMP_PKG_DIR/lib/apk/packages/"
else
	mkdir -p "$I18N_TEMP_PKG_DIR/CONTROL/"
fi

po2lmo "$PKG_DIR/po/ru/homeproxy.po" "$I18N_TEMP_PKG_DIR/usr/lib/lua/luci/i18n/homeproxy.ru.lmo"

if [ "$PKG_MGR" == "apk" ]; then
	find "$I18N_TEMP_PKG_DIR" -type f,l -printf '/%P\n' | sort > "$I18N_TEMP_PKG_DIR/lib/apk/packages/$I18N_PKG_NAME.list"

	apk mkpkg \
		--info "name:$I18N_PKG_NAME" \
		--info "version:$PKG_VERSION" \
		--info "description:Russian translation for luci-app-homeproxy-hiddify" \
		--info "arch:noarch" \
		--info "origin:$I18N_PKG_NAME" \
		--info "url:https://github.com/1andrevich/homeproxy-hiddify" \
		--info "maintainer:1andrevich <1andrevich.recede274@passmail.net>" \
		--info "depends:$PKG_NAME" \
		${APK_SIGN_KEY:+--sign-key "$APK_SIGN_KEY"} \
		--files "$I18N_TEMP_PKG_DIR" \
		--output "$I18N_TEMP_DIR/${I18N_PKG_NAME}_${PKG_VERSION}.apk"

	mv "$I18N_TEMP_DIR/${I18N_PKG_NAME}_${PKG_VERSION}.apk" "$BASE_DIR/${I18N_PKG_NAME}_${PKG_VERSION}_all.apk"
else
	cat > "$I18N_TEMP_PKG_DIR/CONTROL/control" <<-EOF
		Package: $I18N_PKG_NAME
		Version: $PKG_VERSION
		Depends: $PKG_NAME
		Source: https://github.com/1andrevich/homeproxy-hiddify
		SourceName: $I18N_PKG_NAME
		Section: luci
		SourceDateEpoch: $PKG_SOURCE_DATE_EPOCH
		Maintainer: 1andrevich <1andrevich.recede274@passmail.net>
		Architecture: all
		Installed-Size: TO-BE-FILLED-BY-IPKG-BUILD
		Description:  Russian translation for luci-app-homeproxy-hiddify
	EOF
	chmod 0644 "$I18N_TEMP_PKG_DIR/CONTROL/control"

	ipkg-build -m "" "$I18N_TEMP_PKG_DIR" "$I18N_TEMP_DIR"

	if [ "$LEGACY" == "legacy" ]; then
		mv "$I18N_TEMP_DIR/${I18N_PKG_NAME}_${PKG_VERSION}_all.ipk" "$BASE_DIR/${I18N_PKG_NAME}_${PKG_VERSION}_all-legacy.ipk"
	else
		mv "$I18N_TEMP_DIR/${I18N_PKG_NAME}_${PKG_VERSION}_all.ipk" "$BASE_DIR/${I18N_PKG_NAME}_${PKG_VERSION}_all.ipk"
	fi
fi

rm -rf "$I18N_TEMP_DIR"

# Build i18n package for Chinese Simplified
I18N_ZH_PKG_NAME="luci-i18n-homeproxy-zh-cn"
I18N_ZH_TEMP_DIR="$(mktemp -d -p $BASE_DIR)"
I18N_ZH_TEMP_PKG_DIR="$I18N_ZH_TEMP_DIR/$I18N_ZH_PKG_NAME"
mkdir -p "$I18N_ZH_TEMP_PKG_DIR/usr/lib/lua/luci/i18n/"
if [ "$PKG_MGR" == "apk" ]; then
	mkdir -p "$I18N_ZH_TEMP_PKG_DIR/lib/apk/packages/"
else
	mkdir -p "$I18N_ZH_TEMP_PKG_DIR/CONTROL/"
fi

po2lmo "$PKG_DIR/po/zh_Hans/homeproxy.po" "$I18N_ZH_TEMP_PKG_DIR/usr/lib/lua/luci/i18n/homeproxy.zh-cn.lmo"

if [ "$PKG_MGR" == "apk" ]; then
	find "$I18N_ZH_TEMP_PKG_DIR" -type f,l -printf '/%P\n' | sort > "$I18N_ZH_TEMP_PKG_DIR/lib/apk/packages/$I18N_ZH_PKG_NAME.list"

	apk mkpkg \
		--info "name:$I18N_ZH_PKG_NAME" \
		--info "version:$PKG_VERSION" \
		--info "description:Chinese Simplified translation for luci-app-homeproxy-hiddify" \
		--info "arch:noarch" \
		--info "origin:$I18N_ZH_PKG_NAME" \
		--info "url:https://github.com/1andrevich/homeproxy-hiddify" \
		--info "maintainer:1andrevich <1andrevich.recede274@passmail.net>" \
		--info "depends:$PKG_NAME" \
		${APK_SIGN_KEY:+--sign-key "$APK_SIGN_KEY"} \
		--files "$I18N_ZH_TEMP_PKG_DIR" \
		--output "$I18N_ZH_TEMP_DIR/${I18N_ZH_PKG_NAME}_${PKG_VERSION}.apk"

	mv "$I18N_ZH_TEMP_DIR/${I18N_ZH_PKG_NAME}_${PKG_VERSION}.apk" "$BASE_DIR/${I18N_ZH_PKG_NAME}_${PKG_VERSION}_all.apk"
else
	cat > "$I18N_ZH_TEMP_PKG_DIR/CONTROL/control" <<-EOF
		Package: $I18N_ZH_PKG_NAME
		Version: $PKG_VERSION
		Depends: $PKG_NAME
		Source: https://github.com/1andrevich/homeproxy-hiddify
		SourceName: $I18N_ZH_PKG_NAME
		Section: luci
		SourceDateEpoch: $PKG_SOURCE_DATE_EPOCH
		Maintainer: 1andrevich <1andrevich.recede274@passmail.net>
		Architecture: all
		Installed-Size: TO-BE-FILLED-BY-IPKG-BUILD
		Description:  Chinese Simplified translation for luci-app-homeproxy-hiddify
	EOF
	chmod 0644 "$I18N_ZH_TEMP_PKG_DIR/CONTROL/control"

	ipkg-build -m "" "$I18N_ZH_TEMP_PKG_DIR" "$I18N_ZH_TEMP_DIR"

	if [ "$LEGACY" == "legacy" ]; then
		mv "$I18N_ZH_TEMP_DIR/${I18N_ZH_PKG_NAME}_${PKG_VERSION}_all.ipk" "$BASE_DIR/${I18N_ZH_PKG_NAME}_${PKG_VERSION}_all-legacy.ipk"
	else
		mv "$I18N_ZH_TEMP_DIR/${I18N_ZH_PKG_NAME}_${PKG_VERSION}_all.ipk" "$BASE_DIR/${I18N_ZH_PKG_NAME}_${PKG_VERSION}_all.ipk"
	fi
fi

rm -rf "$I18N_ZH_TEMP_DIR"

# Build i18n package for Farsi (Persian)
I18N_FA_PKG_NAME="luci-i18n-homeproxy-fa"
I18N_FA_TEMP_DIR="$(mktemp -d -p $BASE_DIR)"
I18N_FA_TEMP_PKG_DIR="$I18N_FA_TEMP_DIR/$I18N_FA_PKG_NAME"
mkdir -p "$I18N_FA_TEMP_PKG_DIR/usr/lib/lua/luci/i18n/"
if [ "$PKG_MGR" == "apk" ]; then
	mkdir -p "$I18N_FA_TEMP_PKG_DIR/lib/apk/packages/"
else
	mkdir -p "$I18N_FA_TEMP_PKG_DIR/CONTROL/"
fi

po2lmo "$PKG_DIR/po/fa_IR/homeproxy.po" "$I18N_FA_TEMP_PKG_DIR/usr/lib/lua/luci/i18n/homeproxy.fa.lmo"

if [ "$PKG_MGR" == "apk" ]; then
	find "$I18N_FA_TEMP_PKG_DIR" -type f,l -printf '/%P\n' | sort > "$I18N_FA_TEMP_PKG_DIR/lib/apk/packages/$I18N_FA_PKG_NAME.list"

	apk mkpkg \
		--info "name:$I18N_FA_PKG_NAME" \
		--info "version:$PKG_VERSION" \
		--info "description:Farsi (Persian) translation for luci-app-homeproxy-hiddify" \
		--info "arch:noarch" \
		--info "origin:$I18N_FA_PKG_NAME" \
		--info "url:https://github.com/1andrevich/homeproxy-hiddify" \
		--info "maintainer:1andrevich <1andrevich.recede274@passmail.net>" \
		--info "depends:$PKG_NAME" \
		${APK_SIGN_KEY:+--sign-key "$APK_SIGN_KEY"} \
		--files "$I18N_FA_TEMP_PKG_DIR" \
		--output "$I18N_FA_TEMP_DIR/${I18N_FA_PKG_NAME}_${PKG_VERSION}.apk"

	mv "$I18N_FA_TEMP_DIR/${I18N_FA_PKG_NAME}_${PKG_VERSION}.apk" "$BASE_DIR/${I18N_FA_PKG_NAME}_${PKG_VERSION}_all.apk"
else
	cat > "$I18N_FA_TEMP_PKG_DIR/CONTROL/control" <<-EOF
		Package: $I18N_FA_PKG_NAME
		Version: $PKG_VERSION
		Depends: $PKG_NAME
		Source: https://github.com/1andrevich/homeproxy-hiddify
		SourceName: $I18N_FA_PKG_NAME
		Section: luci
		SourceDateEpoch: $PKG_SOURCE_DATE_EPOCH
		Maintainer: 1andrevich <1andrevich.recede274@passmail.net>
		Architecture: all
		Installed-Size: TO-BE-FILLED-BY-IPKG-BUILD
		Description:  Farsi (Persian) translation for luci-app-homeproxy-hiddify
	EOF
	chmod 0644 "$I18N_FA_TEMP_PKG_DIR/CONTROL/control"

	ipkg-build -m "" "$I18N_FA_TEMP_PKG_DIR" "$I18N_FA_TEMP_DIR"

	if [ "$LEGACY" == "legacy" ]; then
		mv "$I18N_FA_TEMP_DIR/${I18N_FA_PKG_NAME}_${PKG_VERSION}_all.ipk" "$BASE_DIR/${I18N_FA_PKG_NAME}_${PKG_VERSION}_all-legacy.ipk"
	else
		mv "$I18N_FA_TEMP_DIR/${I18N_FA_PKG_NAME}_${PKG_VERSION}_all.ipk" "$BASE_DIR/${I18N_FA_PKG_NAME}_${PKG_VERSION}_all.ipk"
	fi
fi

rm -rf "$I18N_FA_TEMP_DIR"
