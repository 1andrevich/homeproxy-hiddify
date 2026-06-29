#!/bin/sh
# Установщик Re:HomeProxy для OpenWrt (в одном скрипте: APK / opkg / 23.05 legacy)
# https://github.com/1andrevich/homeproxy-hiddify
#
# Вручную ставится только LuCI-приложение + ключ подписи, а ядро, ByeDPI и Zapret
# устанавливаются через собственный бэкенд приложения (core_mgmt.uc + rpcd-объект
# luci.homeproxy) — поэтому определение архитектуры, компактные сборки под малую
# флеш-память, проверка подписи и резерв через зеркало GitHub работают той же
# проверенной логикой, что и графический интерфейс.
#
# Установка (одной строкой — ввод читается из /dev/tty, пайп остаётся интерактивным):
#   wget -qO- https://raw.githubusercontent.com/1andrevich/homeproxy-hiddify/master/install.sh | sh
# Либо в два шага:
#   wget -O /tmp/install.sh https://raw.githubusercontent.com/1andrevich/homeproxy-hiddify/master/install.sh
#   sh /tmp/install.sh
#
# При заблокированном/замедленном GitHub можно указать зеркало:
#   GH_MIRROR=https://my.mirror sh install.sh
# (зеркало также пишется в uci, чтобы делегированные загрузки тоже его использовали).
# Внимание: `sh <(wget -O- ...)` на OpenWrt НЕ работает — в busybox ash нет
# process substitution; используйте форму с пайпом выше.

G='\033[0;32m'; R='\033[0;31m'; Y='\033[0;33m'; C='\033[0;36m'; N='\033[0m'
ok()   { echo -e "${G}$1${N}"; }
info() { echo -e "${C}$1${N}"; }
warn() { echo -e "${Y}$1${N}"; }
die()  { echo -e "${R}$1${N}"; exit 1; }
ask()  { printf "${C}%s${N} " "$1"; read -r REPLY </dev/tty 2>/dev/null || REPLY=""; }
is_yes() { case "$1" in y|Y|yes|YES|да|Да|д|Д) return 0;; *) return 1;; esac; }

# --- Разбор JSON (на устройстве нет jq): достать строковое поле / проверить result:true
jget()  { printf '%s\n' "$1" | sed -n "s/.*\"$2\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -1; }
jtrue() { printf '%s'   "$1" | grep -qE "\"result\"[[:space:]]*:[[:space:]]*true"; }
jerr()  { printf '%s\n' "$1" | grep -qE "\"error\""; }

# --- Загрузка «сначала GitHub, при сбое — зеркало» для первого хопа (app + ключ),
#     пока ещё нет собственного gh_fetch приложения. dl <url> <файл>
dl() {
	wget -qO "$2" --timeout=20 "$1" 2>/dev/null && [ -s "$2" ] && return 0
	if [ -n "$GH_MIRROR" ]; then
		m=$(echo "$1" | sed "s#https://github.com#${GH_MIRROR}#")
		wget -qO "$2" --timeout=20 "$m" 2>/dev/null && [ -s "$2" ] && return 0
	fi
	return 1
}
api() { wget -qO- --timeout=20 "$1" 2>/dev/null; }   # GitHub API (без зеркала)

echo
ok "===== Установщик Re:HomeProxy ====="

# ---------------------------------------------------------------- 0. окружение
[ "$(id -u)" = 0 ] || die "Запустите от root."
[ -r /etc/openwrt_release ] || die "Это не OpenWrt (нет /etc/openwrt_release)."
. /etc/openwrt_release 2>/dev/null
ARCH="$DISTRIB_ARCH"; VER="$DISTRIB_RELEASE"
[ -n "$ARCH" ] || die "Не удалось определить архитектуру пакетов (DISTRIB_ARCH)."
if   command -v apk  >/dev/null 2>&1; then PM=apk;  EXT=apk
elif command -v opkg >/dev/null 2>&1; then PM=opkg; EXT=ipk
else die "Не найден поддерживаемый менеджер пакетов (apk/opkg)."; fi
case "$VER" in
	23.05*)              LEGACY=1 ;;
	24.10*|25.*|*SNAPSHOT*) LEGACY=0 ;;
	22.*|21.*|19.*)      die "OpenWrt $VER слишком старая — нужна 23.05 или новее." ;;
	*)                   LEGACY=0; warn "Непроверенная версия OpenWrt $VER — продолжаю." ;;
esac
SUFFIX="_all"; [ "$LEGACY" = 1 ] && SUFFIX="_all-legacy"
info "OpenWrt $VER  |  арх $ARCH  |  $PM  |  legacy=$LEGACY"

# ----------------------------------------------------------- 1. LuCI-приложение + ключ
ok "[1/4] Устанавливаю LuCI-приложение Re:HomeProxy..."
if [ "$PM" = apk ]; then
	if [ ! -f /etc/apk/keys/homeproxy-hiddify.pub ]; then
		dl "https://github.com/1andrevich/homeproxy-hiddify/releases/latest/download/homeproxy-hiddify.pub" /tmp/hp.pub \
			&& cp /tmp/hp.pub /etc/apk/keys/ && rm -f /tmp/hp.pub && ok "  ключ подписи добавлен в доверенные" \
			|| warn "  не удалось скачать ключ подписи — поставлю без проверки подписи"
	fi
fi
APPURL=$(api 'https://api.github.com/repos/1andrevich/homeproxy-hiddify/releases' \
	| grep -o "https://github\.com/[^\"]*luci-app-re-homeproxy[^\"]*${SUFFIX}\.${EXT}" | head -1)
[ -n "$APPURL" ] || die "Не нашёл пакет luci-app-re-homeproxy${SUFFIX}.${EXT} (GitHub заблокирован? попробуйте GH_MIRROR=...)."
dl "$APPURL" /tmp/app.$EXT || die "Не удалось скачать приложение (попробуйте GH_MIRROR=...)."
if [ "$PM" = apk ]; then
	apk add /tmp/app.$EXT 2>/dev/null || apk add --allow-untrusted /tmp/app.$EXT || die "apk add завершился ошибкой."
else
	opkg update >/dev/null 2>&1; opkg install /tmp/app.$EXT || die "opkg install завершился ошибкой."
fi
rm -f /tmp/app.$EXT
ok "  приложение установлено."

# Опциональный языковой пакет
ask "  Языковой пакет? [ru/fa/zh-cn/нет] (по умолчанию нет):"
case "$REPLY" in
	ru|fa|zh-cn)
		LURL=$(api 'https://api.github.com/repos/1andrevich/homeproxy-hiddify/releases' \
			| grep -o "https://github\.com/[^\"]*luci-i18n-homeproxy-${REPLY}[^\"]*\.${EXT}" | head -1)
		if [ -n "$LURL" ] && dl "$LURL" /tmp/i18n.$EXT; then
			if [ "$PM" = apk ]; then apk add /tmp/i18n.$EXT 2>/dev/null || apk add --allow-untrusted /tmp/i18n.$EXT; \
			else opkg install /tmp/i18n.$EXT; fi
			uci set luci.main.lang="$REPLY"; uci commit luci; ok "  языковой пакет установлен"
		else warn "  языковой пакет не найден — пропускаю"; fi
		rm -f /tmp/i18n.$EXT ;;
esac

# Прописываем зеркало в бэкенд, чтобы делегированные загрузки тоже его использовали
if [ -n "$GH_MIRROR" ]; then uci set homeproxy.config.github_mirror="$GH_MIRROR"; uci commit homeproxy; fi

# rpcd нужно перезапустить, чтобы появились ubus-методы приложения (установка ByeDPI/Zapret)
/etc/init.d/rpcd restart >/dev/null 2>&1; sleep 2
CM=/usr/share/homeproxy/scripts/core_mgmt.uc
[ -f "$CM" ] || die "core_mgmt.uc не найден после установки — прерываю."

# ------------------------------------------------------- 2. ядро прокси (обязательно)
ok "[2/4] Ядро прокси (обязательно — выберите одно)"
echo "    1) hiddify-core       (по умолчанию; на малой флеш-памяти выберет компактную сборку)"
echo "    2) sing-box-extended  (AmneziaWG / WARP, самый широкий набор протоколов)"
ask "  Выбор [1/2] (по умолчанию 1):"
case "$REPLY" in 2) CORE=singbox ;; *) CORE=hiddify ;; esac

PREP=$(ucode "$CM" prepare_install "$CORE")
jerr "$PREP" && die "  подготовка ядра не удалась: $(jget "$PREP" error)"
DLURL=$(jget "$PREP" dl_url); TMP=$(jget "$PREP" tmp_path); PMG=$(jget "$PREP" pkg_manager)
[ -n "$DLURL" ] && [ -n "$TMP" ] && [ -n "$PMG" ] || die "  подготовка ядра не вернула данные для загрузки."
info "  скачиваю $CORE..."
jtrue "$(ucode "$CM" download_pkg "$DLURL" "$TMP")" || die "  не удалось скачать ядро (попробуйте GH_MIRROR=...)."
jtrue "$(ucode "$CM" install_pkg "$CORE" "$TMP" "$PMG")" || die "  установка ядра не удалась."
jtrue "$(ucode "$CM" install_kmods "$PMG")" || warn "  не удалось поставить kmod — без kmod-nft-tproxy/kmod-tun прокси не будет маршрутизировать."
ok "  $CORE установлен."

# --------------------------------------------------------------- 3. ByeDPI (опционально)
ask "[3/4] Установить ByeDPI (обход DPI на уровне SOCKS, нужен curl)? [y/N]:"
if is_yes "$REPLY"; then
	info "  ставлю curl (его использует тестер стратегий ByeDPI)..."
	if [ "$PM" = apk ]; then apk add curl >/dev/null 2>&1; else opkg install curl >/dev/null 2>&1; fi
	BP=$(ubus call luci.homeproxy byedpi_prepare_install 2>/dev/null)
	if [ -z "$BP" ] || jerr "$BP"; then warn "  не удалось подготовить ByeDPI — пропускаю. ($(jget "$BP" error))"
	else
		BURL=$(jget "$BP" dl_url); BTMP=$(jget "$BP" tmp_path); BPMG=$(jget "$BP" pkg_manager)
		if [ -n "$BURL" ] && dl "$BURL" "$BTMP"; then
			RES=$(ubus call luci.homeproxy byedpi_install_pkg "{\"tmp_path\":\"$BTMP\",\"pkg_manager\":\"$BPMG\"}" 2>/dev/null)
			jtrue "$RES" && ok "  ByeDPI установлен." || warn "  установка ByeDPI не удалась."
		else warn "  не удалось скачать ByeDPI — пропускаю."; fi
	fi
fi

# --------------------------------------------------------------- 4. Zapret (опционально)
ask "[4/4] Установить Zapret 2 (обход DPI на уровне пакетов — видео/QUIC, звонки)? [y/N]:"
if is_yes "$REPLY"; then
	info "  ставлю модуль ядра NFQUEUE..."
	if [ "$PM" = apk ]; then apk add kmod-nft-queue >/dev/null 2>&1; else opkg install kmod-nft-queue >/dev/null 2>&1; fi
	ZP=$(ubus call luci.homeproxy zapret_prepare_install 2>/dev/null)
	if [ -z "$ZP" ] || jerr "$ZP"; then warn "  не удалось подготовить Zapret — пропускаю. ($(jget "$ZP" error))"
	else
		ZURL=$(jget "$ZP" dl_url); ZTMP=$(jget "$ZP" tmp_path); ZPMG=$(jget "$ZP" pkg_manager)
		if [ -n "$ZURL" ] && dl "$ZURL" "$ZTMP"; then
			RES=$(ubus call luci.homeproxy zapret_install_pkg "{\"tmp_path\":\"$ZTMP\",\"pkg_manager\":\"$ZPMG\"}" 2>/dev/null)
			jtrue "$RES" && ok "  Zapret установлен." || warn "  установка Zapret не удалась."
		else warn "  не удалось скачать Zapret — пропускаю."; fi
	fi
fi

# ------------------------------------------------------------------- 5. финал
/etc/init.d/homeproxy enable  >/dev/null 2>&1
/etc/init.d/homeproxy start   >/dev/null 2>&1

# LAN-адрес роутера для прямой ссылки на страницу LuCI (обрезаем /маску на 25.12+)
LANIP=$(uci -q get network.lan.ipaddr | cut -d/ -f1)
[ -n "$LANIP" ] || LANIP=$(ip -4 addr show br-lan 2>/dev/null | sed -n 's#.*inet \([0-9.]*\).*#\1#p' | head -1)
[ -n "$LANIP" ] || LANIP="192.168.1.1"

echo
ok "===== Готово ====="
info "Откройте Re:HomeProxy в браузере:"
URL="http://$LANIP/cgi-bin/luci/admin/services/homeproxy"
# OSC 8: кликабельная ссылка в поддерживающих терминалах; в остальных просто виден URL
printf '\033[0;36m  \033]8;;%s\033\\%s\033]8;;\033\\\033[0m\n' "$URL" "$URL"
