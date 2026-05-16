[**Русский 🇷🇺**](README_ru.md) / [**English**](README.md)

<a href="https://t.me/one_andrevich"><img src="https://img.shields.io/badge/Telegram-Join-blue?style=flat-square&logo=telegram" alt="Telegram"></a>
# HomeProxy-hiddify

Современная прокси-платформа для ImmortalWrt на основе [hiddify-core](https://github.com/hiddify/hiddify-core).

## Обзор

HomeProxy Hiddify — многофункциональная система управления прокси, построенная на платформе ImmortalWrt.  
Поддерживаемые протоколы: Naive, Mieru, Hysteria, SOCKS, Shadowsocks, ShadowTLS, Tor, Trojan, VLess (XHTTP), VMess, WireGuard, SSH и другие.

## Ключевые возможности

- **Современный веб-интерфейс** — чистый и адаптивный интерфейс для удобного управления прокси
- **Мультипротокольная поддержка** — работа с различными прокси-протоколами через hiddify-core
- **Управление узлами** — эффективное управление несколькими прокси-узлами
- **ACL (списки контроля доступа)** — расширенные правила маршрутизации и фильтрации трафика
- **NFT-правила** — управление правилами таблиц сетевых фильтров для точного контроля трафика
- **Поддержка подписок** — встроенное управление подписками для прокси-узлов

## ⚠️ Проект на раннем этапе разработки

Проект находится на **раннем этапе разработки**. Настройка через веб-интерфейс ещё дорабатывается и будет улучшена в следующих версиях.


## Требования

- OpenWRT / ImmortalWrt 24.10 или выше (opkg)
- OpenWRT / ImmortalWrt 25.12 или выше (apk)

## Установка

*Потребуется 80 Мб свободного пространства*

### OpenWRT 25.12+ (APK)

#### 1. Установка пакета hiddify-core

```sh
wget -O /tmp/homeproxy-hiddify.pub https://github.com/1andrevich/homeproxy-hiddify/releases/latest/download/homeproxy-hiddify.pub
cp /tmp/homeproxy-hiddify.pub /etc/apk/keys/
wget -O /tmp/hiddify-core.apk "https://github.com/1andrevich/hiddify-core/releases/latest/download/hiddify-core_$(. /etc/os-release; echo "$OPENWRT_ARCH").apk"
apk update
apk add /tmp/hiddify-core.apk
```

#### 2. Установка пакета HomeProxy-hiddify

```sh
wget -O /tmp/homeproxy-hiddify.pub https://github.com/1andrevich/homeproxy-hiddify/releases/latest/download/homeproxy-hiddify.pub
cp /tmp/homeproxy-hiddify.pub /etc/apk/keys/
wget -O /tmp/luci-app-homeproxy-hiddify.apk "$(wget -qO- 'https://api.github.com/repos/1andrevich/homeproxy-hiddify/releases' | grep -o 'https://github\.com/[^"]*luci-app-homeproxy-hiddify[^"]*\.apk' | head -1)"
apk add /tmp/luci-app-homeproxy-hiddify.apk
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

#### 2. Установка пакета HomeProxy-hiddify

```sh
wget -O /tmp/luci-app-homeproxy-hiddify.ipk "$(wget -qO- 'https://api.github.com/repos/1andrevich/homeproxy-hiddify/releases' | grep -o 'https://github\.com/[^"]*luci-app-homeproxy-hiddify[^"]*\.ipk' | head -1)"
opkg install /tmp/luci-app-homeproxy-hiddify.ipk
```

#### 3. Установка языкового пакета RU

```sh
wget -O /tmp/luci-i18n-homeproxy-ru.ipk "$(wget -qO- 'https://api.github.com/repos/1andrevich/homeproxy-hiddify/releases' | grep -o 'https://github\.com/[^"]*luci-i18n-homeproxy-ru[^"]*\.ipk' | head -1)"
opkg install /tmp/luci-i18n-homeproxy-ru.ipk
```

### Дополнительно. Режим «Пользовательский JSON»

При включённом режиме маршрутизации «Пользовательский JSON» разместите конфигурационный файл в формате sing-box по пути `/etc/homeproxy/hiddify-c.json`.

> **Обязательно:** добавьте `"default_mark": 100` внутри раздела `"route": {}`, чтобы предотвратить петли маршрутизации tproxy:
>
> ```json
> "route": {
>     "default_mark": 100,
>     ...
> }
> ```

Также добавьте (или объедините) в вашу конфигурацию следующие разделы:

**Лог:**
```json
"log": {
    "disabled": false,
    "level": "warn",
    "output": "/var/run/homeproxy/hiddify-c.log",
    "timestamp": true
}
```

**Входящие соединения (inbounds):**
```json
"inbounds": [
    {
        "type": "direct",
        "tag": "dns-in",
        "listen": "::",
        "listen_port": 5333
    },
    {
        "type": "mixed",
        "tag": "mixed-in",
        "listen": "::",
        "listen_port": 5330,
        "udp_timeout": "300s",
        "sniff": true,
        "sniff_override_destination": true,
        "set_system_proxy": false
    },
    {
        "type": "redirect",
        "tag": "redirect-in",
        "listen": "::",
        "listen_port": 5331,
        "sniff": true,
        "sniff_override_destination": true
    },
    {
        "type": "tproxy",
        "tag": "tproxy-in",
        "listen": "::",
        "listen_port": 5332,
        "network": "udp",
        "udp_timeout": "300s",
        "sniff": true,
        "sniff_override_destination": true
    }
]
```

### 4. Запуск службы

```sh
/etc/init.d/homeproxy start
```

Служба запускается автоматически при загрузке системы. Логи доступны в разделе **Службы → HomeProxy-Hiddify → Статус**.
