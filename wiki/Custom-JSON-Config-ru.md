🇬🇧 [English](Custom-JSON-Config-en) | 🇷🇺 [Русский](Custom-JSON-Config-ru)

# Пользовательский JSON конфиг

**Пользовательский JSON** — режим маршрутизации, позволяющий полностью обойти UCI-конфигурацию HomeProxy и использовать «сырой» JSON-конфиг формата [sing-box](https://sing-box.sagernet.org) / hiddify-core напрямую. Предназначен для опытных пользователей, которым нужен тонкий контроль, недоступный через веб-интерфейс.

Чтобы включить режим: **HomeProxy → Клиент → Настройки маршрутизации** → установить **Режим маршрутизации** в значение **Пользовательский JSON**.

Файл конфигурации размещается по пути `/etc/homeproxy/hiddify-c.json`.

---

## Структура конфига

Конфиг hiddify-core — это JSON-объект. Основные секции верхнего уровня:

| Секция | Назначение |
|--------|-----------|
| `log` | Уровень логирования и путь к файлу лога |
| `dns` | DNS-серверы, правила и стратегия разрешения |
| `inbounds` | Как трафик попадает в прокси (tproxy, tun, socks, http и др.) |
| `outbounds` | Куда трафик выходит (прямо, через прокси-серверы, цепочки) |
| `route` | Правила сопоставления входящего трафика с исходящими |
| `experimental` | Кэш, Clash API и другие экспериментальные возможности |

Минимальный рабочий конфиг требует как минимум одного inbound, двух outbound (`proxy` + `direct`) и правил маршрутизации.

**Полная документация:** [Конфигурация sing-box](https://sing-box.sagernet.org/configuration/)

Отдельные разделы:
- [DNS](https://sing-box.sagernet.org/configuration/dns/)
- [Inbounds](https://sing-box.sagernet.org/configuration/inbound/)
- [Outbounds](https://sing-box.sagernet.org/configuration/outbound/)
- [Route](https://sing-box.sagernet.org/configuration/route/)

---

## hiddify-core и sing-box

hiddify-core — форк sing-box, в целом совместимый по формату конфига. Ключевые отличия:

- **Дополнительные протоколы** — hiddify-core поддерживает протоколы, которых нет в upstream sing-box или которые появились в нём позже. Это AnyTLS, расширенные опции для некоторых существующих протоколов. Полный список — на странице [Поддерживаемые протоколы](Supported-Protocols-ru).
- **Расширения hiddify** — некоторые дополнительные поля и опции специфичны для hiddify. Они задокументированы в [руководстве HiddifyCli](https://hiddify.com/app/HiddifyCli-guide/#run-config-or-subscription-link-in-hiddifycli-with-hiddifyapp-settings).
- **Различия версий** — hiddify-core может опережать или отставать от конкретного релиза sing-box. Если функция sing-box не работает — проверьте release notes hiddify-core.

При написании конфигов отталкивайтесь от документации sing-box, обращаясь к руководству hiddify-core там, где поведение отличается.

---

## Пример скелета конфига

```json
{
  "log": {
    "disabled": false,
    "level": "warn",
    "output": "/var/run/homeproxy/hiddify-c.log",
    "timestamp": true
  },
  "dns": {
    "servers": [
      { "tag": "remote", "address": "tls://1.1.1.1" },
      { "tag": "local",  "address": "223.5.5.5", "detour": "direct" }
    ],
    "rules": [
      { "geosite": "cn", "server": "local" }
    ]
  },
  "inbounds": [
    {
      "type": "tproxy",
      "tag": "tproxy-in",
      "listen": "::",
      "listen_port": 5332,
      "network": "udp",
      "sniff": true
    }
  ],
  "outbounds": [
    {
      "type": "vless",
      "tag": "proxy",
      "server": "your.server.example",
      "server_port": 443
    },
    { "type": "direct", "tag": "direct" },
    { "type": "block",  "tag": "block"  },
    { "type": "dns",    "tag": "dns-out" }
  ],
  "route": {
    "default_mark": 100,
    "rules": [
      { "protocol": "dns", "outbound": "dns-out" },
      { "geosite": "cn",   "outbound": "direct"  },
      { "geoip":   "cn",   "outbound": "direct"  }
    ],
    "final": "proxy"
  }
}
```

Это только иллюстрация — адаптируйте тип/порт inbound, настройки outbound и правила маршрутизации под свою конфигурацию.

---

## Советы

- **Проверяйте перед сохранением.** Некорректный JSON будет молча проигнорирован. Используйте JSON-валидатор перед вставкой — ошибки синтаксиса не отображаются в интерфейсе. После сохранения проверьте лог (см. ниже), чтобы убедиться, что конфиг загрузился корректно.

- **Логи.** Если конфиг применился, но трафик не работает — проверьте лог hiddify-core в **HomeProxy → Лог** или через SSH: `tail -f /var/run/homeproxy/hiddify-c.log`.

- **Порты входящих соединений.** Правила файрвола HomeProxy ожидают конкретные порты. Если вы меняете порты inbound в пользовательском JSON, правила nftables перестанут совпадать и трафик не достигнет inbound. Стандартная конфигурация inbounds, используемая HomeProxy:

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

  Если нужно изменить порты — обновите их и в пользовательском JSON, и в `/etc/config/homeproxy` (опции `mixed_port`, `redirect_port`, `tproxy_port`, `dns_port`), чтобы правила файрвола оставались согласованными.

- **`default_mark`.** **Обязательное** поле в секции `route` для предотвращения петель маршрутизации tproxy. Без него собственный исходящий трафик hiddify-core перехватывается правилами nftables и снова направляется в прокси. Значение должно совпадать с `self_mark` в `/etc/config/homeproxy` (по умолчанию: `100`):

  ```json
  "route": {
      "default_mark": 100,
      ...
  }
  ```

  Если вы меняете это значение — обновите `self_mark` в `/etc/config/homeproxy` соответственно.

- **Теги outbound.** Правила маршрутизации ссылаются на outbound по имени тега — следите за их согласованностью.
