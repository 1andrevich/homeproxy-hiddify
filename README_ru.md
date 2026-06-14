[**Русский 🇷🇺**](README_ru.md) / [**English**](README.md)

<a href="https://t.me/one_andrevich"><img src="https://img.shields.io/badge/Telegram-Join-blue?style=flat-square&logo=telegram" alt="Telegram"></a>
# Re:HomeProxy

Современная многоядерная прокси-платформа на основе [hiddify-core](https://github.com/hiddify/hiddify-core). Форк ImmortalWrt HomeProxy.

## Обзор

Re:HomeProxy — многофункциональная система управления прокси, новый взгляд на HomeProxy от ImmortalWrt. Работает на выбор ядра ([hiddify-core](https://github.com/hiddify/hiddify-core) или [sing-box-extended](https://github.com/shtorm-7/sing-box-extended)), включает встроенный обход DPI для разблокировки сайтов без VPN, готовые правила маршрутизации для России и установщик ядра в один клик — всё из веб-интерфейса LuCI.

## Ключевые возможности

- **Многоядерный движок** — работа на **hiddify-core** или **sing-box-extended** на ваш выбор. Встроенная страница **Управление ядром** сама установит и обновит ядро и автоматически подберёт подходящую сборку под свободное место (включая компактную сборку для устройств с малым объёмом памяти).
- **Широкая поддержка протоколов** — Naive, Mieru, Hysteria, SOCKS, Shadowsocks, ShadowTLS, Tor, Trojan, VLESS (XHTTP), VMess, WireGuard, **AmneziaWG / WARP** (sing-box-extended), SSH и другие.
- **Обход DPI через ByeDPI** — встроенная интеграция [ByeDPI](https://github.com/hufrea/byedpi) для разблокировки сайтов (например, YouTube) **без какой-либо VPN-подписки**, с готовыми пресетами стратегий и **тестером стратегий** по нескольким сайтам, который показывает, какая настройка реально работает у вашего провайдера.
- **Автовыбор через URLTest** — автоматически направляет трафик через самый быстрый доступный узел и переключается при сбое.
- **Правила маршрутизации для России** — RU Proxy Rules в один клик (Russia Inside, Re:Filter) с готовыми списками доменов/IP, чтобы через прокси шли только заблокированные адреса.
- **Поддержка подписок** — импорт узлов по ссылкам подписок (включая sing-box JSON / Hiddify) и обновление по требованию.
- **Диагностика** — встроенная страница для проверки состояния ядра/системы, просмотра портов и формирования отчёта.
- **Современный веб-интерфейс** — чистый адаптивный интерфейс LuCI с управлением узлами, маршрутизацией ACL и NFT-правилами.

## ⚠️ Проект на раннем этапе разработки

Проект находится на **раннем этапе разработки**. Настройка через веб-интерфейс ещё дорабатывается и будет улучшена в следующих версиях.


## Требования

- OpenWRT / ImmortalWrt 24.10 или выше (opkg)
- OpenWRT / ImmortalWrt 25.12 или выше (apk)

## Установка

*Рекомендуется ~80 Мб свободного места. Мало места? Сначала установите пакет LuCI, затем на странице **Управление ядром** (Сервисы → Re:HomeProxy → Статус) установите ядро — оно само подберёт подходящую сборку, включая компактную для небольших устройств.*

### OpenWRT 25.12+ (APK)

#### 1. Установка пакета hiddify-core

```sh
wget -O /tmp/homeproxy-hiddify.pub https://github.com/1andrevich/homeproxy-hiddify/releases/latest/download/homeproxy-hiddify.pub
cp /tmp/homeproxy-hiddify.pub /etc/apk/keys/
wget -O /tmp/hiddify-core.apk "https://github.com/1andrevich/hiddify-core/releases/latest/download/hiddify-core_$(. /etc/os-release; echo "$OPENWRT_ARCH").apk"
apk update
apk add /tmp/hiddify-core.apk
```

#### 2. Установка пакета Re:HomeProxy

```sh
wget -O /tmp/homeproxy-hiddify.pub https://github.com/1andrevich/homeproxy-hiddify/releases/latest/download/homeproxy-hiddify.pub
cp /tmp/homeproxy-hiddify.pub /etc/apk/keys/
wget -O /tmp/luci-app-re-homeproxy.apk "$(wget -qO- 'https://api.github.com/repos/1andrevich/homeproxy-hiddify/releases' | grep -o 'https://github\.com/[^"]*luci-app-re-homeproxy[^"]*\.apk' | head -1)"
apk add /tmp/luci-app-re-homeproxy.apk
```

После того как ключ окажется в `/etc/apk/keys/`, он будет доверенным постоянно — флаг указывать при последующих обновлениях не нужно.

#### 3. Установка языкового пакета RU

```sh
wget -O /tmp/luci-i18n-homeproxy-ru.apk "$(wget -qO- 'https://api.github.com/repos/1andrevich/homeproxy-hiddify/releases' | grep -o 'https://github\.com/[^"]*luci-i18n-homeproxy-ru[^"]*\.apk' | head -1)"
apk add /tmp/luci-i18n-homeproxy-ru.apk
```

---

### OpenWRT 24.10 (opkg)

#### 1. Установка пакета hiddify-core

```sh
wget -O /tmp/hiddify-core.ipk "https://github.com/1andrevich/hiddify-core/releases/latest/download/hiddify-core_$(. /etc/os-release; echo "$OPENWRT_ARCH").ipk"
opkg update
opkg install /tmp/hiddify-core.ipk
```

#### 2. Установка пакета Re:HomeProxy

```sh
wget -O /tmp/luci-app-re-homeproxy.ipk "$(wget -qO- 'https://api.github.com/repos/1andrevich/homeproxy-hiddify/releases' | grep -o 'https://github\.com/[^"]*luci-app-re-homeproxy[^"]*\.ipk' | head -1)"
opkg install /tmp/luci-app-re-homeproxy.ipk
```

#### 3. Установка языкового пакета RU

```sh
wget -O /tmp/luci-i18n-homeproxy-ru.ipk "$(wget -qO- 'https://api.github.com/repos/1andrevich/homeproxy-hiddify/releases' | grep -o 'https://github\.com/[^"]*luci-i18n-homeproxy-ru[^"]*\.ipk' | head -1)"
opkg install /tmp/luci-i18n-homeproxy-ru.ipk
```

### Дополнительно. Режим «Пользовательский JSON»

Подробная документация доступна на странице вики **[Пользовательский JSON конфиг](../../wiki/Custom-JSON-Config-ru)**.

### 4. Запуск службы

```sh
/etc/init.d/homeproxy start
```

Служба запускается автоматически при загрузке системы. Логи доступны в разделе **Службы → Re:HomeProxy → Статус**.
