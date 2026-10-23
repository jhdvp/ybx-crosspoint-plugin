# YBX для CrossPoint — дистрибуция

Официальный плагин YBX для CrossPoint Reader (Xteink X3/X4/X4 Pro):
один каталог книг из подключённых магазинов (Яндекс Книги сейчас;
Литрес и WB — по мере коннекторов), вход по QR (RFC 8628), полки,
поиск, скачивание EPUB в `/books/ybx/`, события чтения для аналитики YBX.

Исходник плагина — `YBX Site/plugins/crosspoint/ybx` (единственный источник
истины). Этот репозиторий — упаковка для двух каналов установки.

## Канал 1 — Plugin Hub (автоматически)

Payload: `ybx.crosspoint-plugin/` (direct-child, `manifest.name: "ybx"`,
`version: 1.0.1`). Для автообнаружения нужны публичный репозиторий, topic
`crosspoint-plugin` и non-prerelease Release с тегом `v1.0.1`. После
обновления каталога (до 3 часов) плагин появляется в Community Plugins:
Home → Plugins → Plugin Hub → Install → Community Plugins → Яндекс Книги.

Альтернатива без публикации: в Plugin Hub добавить custom catalog
`https://ybx.app/crosspoint-plugin/catalog.json` (сервер уже отдаёт его).

## Канал 2 — установщик на ybx.app

Страница `/installer` умеет ставить плагин по Wi-Fi прямо на ридер
(upload в `/.crosspoint/plugins/ybx/`), плюс кнопка ZIP
(`https://ybx.app/crosspoint-plugin/ybx-plugin.zip`) для ручной установки.
Включить Settings → Connectivity → Plugins = Enabled, затем
Home → Plugins → Яндекс Книги и привязать по QR.

## Разработка

```bash
npm run sync      # скопировать payload из ../YBX Site/plugins/crosspoint/ybx
npm run validate  # контракт Plugin Hub
npm test
```

Релиз: поднять `version` в manifest/plugin.json (источник), `npm run sync`,
закоммитить, поставить тег `vX.Y.Z` и опубликовать non-prerelease Release.
