[**Русский 🇷🇺**](README_ru.md) / [**English**](README.md)

<a href="https://t.me/one_andrevich"><img src="https://img.shields.io/badge/Telegram-Join-blue?style=flat-square&logo=telegram" alt="Telegram"></a>
# Re:HomeProxy

Современная многоядерная прокси-платформа на основе [hiddify-core](https://github.com/hiddify/hiddify-core) и [sing-box-extended](https://github.com/shtorm-7/sing-box-extended).
Форк [ImmortalWrt HomeProxy](https://github.com/immortalwrt/homeproxy).

## Обзор

Re:HomeProxy — многофункциональная система управления прокси, новый взгляд на HomeProxy от ImmortalWrt. Работает на выбор ядра ([hiddify-core](https://github.com/hiddify/hiddify-core) или [sing-box-extended](https://github.com/shtorm-7/sing-box-extended)), включает встроенный обход DPI на основе [Zapret2](https://github.com/bol-van/zapret2) и [ByeDPI](https://github.com/hufrea/byedpi) для разблокировки сайтов без VPN, готовые правила маршрутизации для России и установщик ядра в один клик — всё из веб-интерфейса LuCI.

## Ключевые возможности

- **Многоядерный движок** — работа на **hiddify-core** или **sing-box-extended** на ваш выбор. Встроенная страница **Управление ядром** сама установит и обновит ядро и автоматически подберёт подходящую сборку под свободное место (включая компактную сборку для устройств с малым объёмом памяти).
- **Широкая поддержка протоколов** — Naive, Mieru, Hysteria, SOCKS, Shadowsocks, ShadowTLS, Trojan, VLESS (XHTTP), VMess, WireGuard, **AmneziaWG / WARP** (sing-box-extended), SSH и другие.
- **Два встроенных движка обхода DPI** — разблокировка сайтов и снятие троттлинга (например, YouTube, Discord) **без какой-либо VPN-подписки**:
  - **ByeDPI** ([hufrea/byedpi](https://github.com/hufrea/byedpi)) — рассинхронизирующий прокси на уровне SOCKS, 47 готовых пресетов стратегий и **тестер стратегий** по нескольким сайтам, который показывает, какая настройка реально работает у вашего провайдера.
  - **Zapret 2** ([bol-van/zapret2](https://github.com/bol-van/zapret2), nfqws2) — рассинхронизация на уровне пакетов через NFQUEUE, искажает рукопожатие «на лету». Назначается в правилах маршрутизации (например, отправить через него только YouTube/Discord), с подобранными пресетами, опциональным обходом для голоса Discord и собственным тестером.
- **Автовыбор через URLTest** — автоматически направляет трафик через самый быстрый доступный узел и переключается при сбое.
- **Правила маршрутизации для России** — RU Proxy Rules в один клик (Russia Inside, Re:Filter) с готовыми списками доменов/IP, чтобы через прокси шли только заблокированные адреса.
- **Поддержка подписок** — импорт узлов по ссылкам подписок (sing-box JSON / Hiddify, base64 / обычные share-ссылки, а также JSON-конфиги Xray/V2Ray) и обновление по требованию.
- **Диагностика** — встроенная страница для проверки состояния ядра/системы, просмотра портов и формирования отчёта.
- **Современный веб-интерфейс** — чистый адаптивный интерфейс LuCI с управлением узлами, маршрутизацией ACL и NFT-правилами.

## ⚠️ Проект на раннем этапе разработки

Проект находится на **раннем этапе разработки**. Настройка через веб-интерфейс ещё дорабатывается и будет улучшена в следующих версиях.


## Требования

- OpenWRT / ImmortalWrt 24.10 или выше (opkg)
- OpenWRT / ImmortalWrt 25.12 или выше (apk)

Опционально в разделе Releases доступна legacy-сборка для 23.05

## Установка

*Рекомендуется ~40 Мб свободного места. Мало места? Сначала установите пакет LuCI, затем на вкладке **Ядро и службы** (Службы → Re:HomeProxy → Ядро и службы) установите ядро — оно само подберёт подходящую сборку, включая компактную для небольших устройств.*

### OpenWRT 25.12+ (APK)

#### 1. Установка пакета Re:HomeProxy

```sh
wget -O /tmp/homeproxy-hiddify.pub https://github.com/1andrevich/homeproxy-hiddify/releases/latest/download/homeproxy-hiddify.pub
cp /tmp/homeproxy-hiddify.pub /etc/apk/keys/
wget -O /tmp/luci-app-re-homeproxy.apk "$(wget -qO- 'https://api.github.com/repos/1andrevich/homeproxy-hiddify/releases' | grep -o 'https://github\.com/[^"]*luci-app-re-homeproxy[^"]*\.apk' | head -1)"
apk add /tmp/luci-app-re-homeproxy.apk
```

После того как ключ окажется в `/etc/apk/keys/`, он будет доверенным постоянно — флаг указывать при последующих обновлениях не нужно.

#### 2. Установка компонентов на вкладке **Ядро и службы**

Откройте **Службы → Re:HomeProxy → Ядро и службы** и установите нужное — установщик сам подберёт сборку под свободное место:

- **Ядро прокси** *(обязательно, выберите одно)* — [hiddify-core](https://github.com/hiddify/hiddify-core) (по умолчанию) или [sing-box-extended](https://github.com/shtorm-7/sing-box-extended) (добавляет AmneziaWG / WARP и самый широкий набор протоколов). См. **[Управление ядром](../../wiki/Core-Management-ru)**.
- **ByeDPI** *(опционально)* — обход DPI на уровне SOCKS, снимает троттлинг без VPN, 47 пресетов и встроенный тестер стратегий. См. **[ByeDPI](../../wiki/ByeDPI-ru)**.
- **Zapret 2** *(опционально)* — обход DPI на уровне пакетов (nfqws2), назначается в правилах маршрутизации, с подобранными пресетами и опциональным обходом для голоса Discord. См. **[Zapret](../../wiki/Zapret-ru)**.

#### 3. Установка языкового пакета RU

```sh
wget -O /tmp/luci-i18n-homeproxy-ru.apk "$(wget -qO- 'https://api.github.com/repos/1andrevich/homeproxy-hiddify/releases' | grep -o 'https://github\.com/[^"]*luci-i18n-homeproxy-ru[^"]*\.apk' | head -1)"
apk add /tmp/luci-i18n-homeproxy-ru.apk
```

---

### OpenWRT 24.10 (opkg)

#### 1. Установка пакета Re:HomeProxy

```sh
wget -O /tmp/luci-app-re-homeproxy.ipk "$(wget -qO- 'https://api.github.com/repos/1andrevich/homeproxy-hiddify/releases' | grep -o 'https://github\.com/[^"]*luci-app-re-homeproxy[^"]*\.ipk' | head -1)"
opkg install /tmp/luci-app-re-homeproxy.ipk
```

#### 2. Установка компонентов на вкладке **Ядро и службы**

Откройте **Службы → Re:HomeProxy → Ядро и службы** и установите нужное — установщик сам подберёт сборку под свободное место:

- **Ядро прокси** *(обязательно, выберите одно)* — [hiddify-core](https://github.com/hiddify/hiddify-core) (по умолчанию) или [sing-box-extended](https://github.com/shtorm-7/sing-box-extended) (добавляет AmneziaWG / WARP и самый широкий набор протоколов). См. **[Управление ядром](../../wiki/Core-Management-ru)**.
- **ByeDPI** *(опционально)* — обход DPI на уровне SOCKS, снимает троттлинг без VPN, 47 пресетов и встроенный тестер стратегий. См. **[ByeDPI](../../wiki/ByeDPI-ru)**.
- **Zapret 2** *(опционально)* — обход DPI на уровне пакетов (nfqws2), назначается в правилах маршрутизации, с подобранными пресетами и опциональным обходом для голоса Discord. См. **[Zapret](../../wiki/Zapret-ru)**.

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

Служба запускается автоматически при загрузке системы. Логи доступны в разделе **Службы → Re:HomeProxy → Ядро и службы**.

## Документация

Полные руководства — в **[вики](../../wiki/Home)**:

- **[Первая настройка](../../wiki/Getting-Started-ru)** — от свежей установки до рабочего соединения, по шагам
- **[Управление ядром](../../wiki/Core-Management-ru)** — hiddify-core или sing-box-extended, умный установщик, память и компактная сборка
- **[Поддерживаемые протоколы](../../wiki/Supported-Protocols-ru)** — все протоколы, транспорты и нужные им build-теги
- **[Подписки и импорт узлов](../../wiki/Subscriptions-ru)** — share-ссылки, .conf, Amnezia `vpn://` (AmneziaWG/Xray), подписки, base64
- **[Маршрутизация и контроль доступа](../../wiki/Routing-and-Access-Control-ru)** — режимы маршрутизации, RU Proxy Rules, пер-девайс контроль доступа
- **[Настройки сервера](../../wiki/Server-Settings-ru)** — роутер как прокси-сервер (inbound-ы, типы, TLS/ACME)
- **[DNS и диагностика](../../wiki/DNS-and-Diagnostics-ru)** — чистый и защищённый DNS, утечки IPv6 и страница диагностики
- **[ByeDPI](../../wiki/ByeDPI-ru)** — обход DPI на уровне SOCKS, пресеты стратегий и тестер
- **[Zapret](../../wiki/Zapret-ru)** — обход DPI на уровне пакетов (nfqws2), пресеты, голос Discord и тестер
- **[Пользовательская маршрутизация](../../wiki/Custom-Routing-ru)** — узлы и правила маршрутизации в UI (матч по домену/IP/порту/протоколу/процессу)
- **[Пользовательский JSON конфиг](../../wiki/Custom-JSON-Config-ru)** — режим маршрутизации с «сырым» конфигом hiddify-core
- **[Устранение неполадок](../../wiki/Troubleshooting-ru)** — типичные ошибки и их решение

## Благодарности и используемые проекты

Re:HomeProxy опирается на работу множества вышестоящих проектов. Приложение LuCI распространяется под GPL; ядра и движки обхода DPI скачиваются при установке из их собственных релизов и остаются под своими лицензиями.

**Основа и ядра**
- [ImmortalWrt HomeProxy](https://github.com/immortalwrt/homeproxy) — исходное приложение LuCI, форком которого является проект
- [hiddify-core](https://github.com/hiddify/hiddify-core) — ядро прокси по умолчанию (форк sing-box от команды Hiddify)
- [sing-box-extended](https://github.com/shtorm-7/sing-box-extended) — альтернативное ядро с дополнительными build-тегами (AmneziaWG/WARP, самый широкий набор протоколов)
- [sing-box](https://sing-box.sagernet.org) — вышестоящий движок, на котором основаны оба ядра

**Движки обхода DPI**
- [hufrea/byedpi](https://github.com/hufrea/byedpi) — движок рассинхронизации ByeDPI (`ciadpi`); пакеты для OpenWrt — [1andrevich/ByeDPI-OpenWrt](https://github.com/1andrevich/ByeDPI-OpenWrt)
- [bol-van/zapret2](https://github.com/bol-van/zapret2) — движок рассинхронизации пакетов Zapret / nfqws2 / blockcheck2; пакеты для OpenWrt — [1andrevich/zapret2-openwrt](https://github.com/1andrevich/zapret2-openwrt); часть пресетов адаптирована из [flowseal/zapret-discord-youtube](https://github.com/flowseal/zapret-discord-youtube) (MIT)

**Протоколы** — реализованы ядрами выше (см. [Поддерживаемые протоколы](../../wiki/Supported-Protocols-ru)):

Naive, Mieru, Hysteria/Hysteria2, TUIC, SOCKS, Shadowsocks/Shadowsocks 2022, ShadowTLS, AnyTLS, Trojan, VLESS (Reality, XHTTP), VMess, WireGuard, AmneziaWG/WARP, SSH.

**Списки маршрутизации**
- [Re:Filter](https://github.com/1andrevich/re-filter) — список доменов + IP по реестру РКН
- [itdoginfo/allow-domains](https://github.com/itdoginfo/allow-domains) — «Russia Inside» и сервисные списки (YouTube, Telegram, Discord, Meta и др.)
- [itdoginfo](https://github.com/itdoginfo) — HODCA и другие подобранные списки от itdoginfo

Все товарные знаки и названия сервисов принадлежат их владельцам и упоминаются номинативно — для обозначения трафика, к которому относится правило или список.
