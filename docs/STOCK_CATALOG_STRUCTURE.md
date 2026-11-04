# YBX Stock 1.6.14 RC — карта каталогов и приёмка

> **Только стандартный CrossPoint API 1**, без прошивочных расширений
> `catalog.lists.auth` и `catalog.folders.json`. Стоковая версия 1.6.13
> остаётся доступна до отдельной приёмки и публикации кандидата.

## Статическое меню (на ридере)

```text
CrossPoint → Plugins → YBX
├── Все книги                 Яндекс + WB + ЛитРес + загруженные EPUB
├── Читаю                     объединённый статус reading
├── Хочу прочитать            объединённый статус to_read
├── Прочитано                 объединённый статус done
├── Загруженные               пользовательские EPUB
├── Яндекс Книги              все книги только Яндекса
├── WB Книги                  отдельная полка WB
└── ЛитРес                    отдельная полка ЛитРес
```

Каждый пункт — статический `browse.lists[]` c обычным JSON endpoint.
Невозможно автоматически скрыть неподключённый источник; для WB/ЛитРес
сервер `stock=1` возвращает несскачиваемую инструкцию вместо 404/409.
Для Яндекса прежняя обработка consent остается.

**Особенность штатного CrossPoint:** карточки «Подключите…» имеют
`download_url: ""`, но старый UI всё равно показывает стандартную кнопку
`Fetch`. Эта кнопка не скрывается настройками плагина. При её нажатии
сервер блокирует служебные ID (`ybx-connect-*` и обновление) с HTTP 404
**без обращения к книжному сервису и без скачивания файла**.
Нажимать `Fetch` в карточке подключения не нужно: подключение выполняется
через кабинет YBX.

Для скачивания используется фиксированный HTTPS-адрес YBX с `{id}`,
а не произвольный `download_url` из ответа каталога: нельзя передавать
постоянный Bearer-токен стороннему URL.

**«Загруженные»** здесь означает пользовательские EPUB, добавленные в
библиотеку **YBX Server**, а не автоматическое перечисление всех EPUB на SD.

Вложенных папок серий и полок **нет**: `folder_url` требует YBX Native.
Их доступный серверный вариант — отдельно через OPDS.

## Точки API

- `GET /api/v1/crosspoint/catalog/all?kind=all|reading|to_read|done|uploaded`
  объединяет аккаунтные книги из разрешённых источников, использует
  серверный dedup и сортировку; выдаёт книгу только если доступен ID.
- `GET /api/v1/crosspoint/catalog/all?kind=all&q={query}` — единый поиск
  по названию, автору и всем вложенным источникам (с серверным dedup).
- `GET /api/v1/crosspoint/catalog?shelf=all` — отдельный Яндекс.
- `GET /api/v1/crosspoint/wb/catalog?stock=1` — WB.
- `GET /api/v1/crosspoint/litres/catalog?stock=1` — ЛитРес.
- `GET /api/v1/crosspoint/books/{id}/download` — прежний scoped EPUB
  download; в карточке нет новой необходимости в TLS возможностей Native.
- `POST /api/v1/crosspoint/auth/device` и `/auth/token` — прежний QR,
  путь токена `token.json` сохраняется, доступ к магазинам только на сервере.

## Acceptance/rollout gates

1. Public payload unit-tests + negative tests запрета Native capabilities;
   имена, версии, ZIP, `catalog.json` совпадают.
2. Server tests на 0/1/2/3 подключённых источника, поиск, дедуп,
   страницы 10 книг (+1 lookahead), пустой/отозванный источник,
   ошибки/отсутствующие EPUB.
3. Попарное совпадение `plugins/crosspoint/ybx` в приватном серверном
   проекте и `ybx.crosspoint-plugin` в публичном репозитории.
4. Развернуть серверную часть **до** публикации новой версии 1.6.14;
   проверить 1.6.13 и 1.6.14 одновременно, без forced upgrade.
5. Пройти QR, поиск, EPUB, KOSync, сон/статистику, обновление и сохранение
   данных на физическом CrossPoint 1.6.x / 2.0 RC. Проверить X3/X4/X4Pro.
6. Только после этих gate-ов мержить public PR и выпускать release 1.6.14;
   не обновлять Plugin Hub main до завершения QA.


## QEMU evidence

Official CrossPoint 2.0 RC X4 Pro booted with the unmodified Stock 1.6.14
payload on a disposable SD; Plugins picker discovers YBX. A second,
isolated test connected to PICSimLabWifi and rendered all **eight**
list names using a deliberately invalid fake token, with a safe
not-signed-in failure state. This does **not** certify pairing,
actual book contents or EPUB downloads. See
[QEMU 11 smoke report](qa/stock1614-qemu-20261104.md) and its screenshot.
