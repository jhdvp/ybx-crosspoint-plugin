# KoSync V2: CrossPoint client compatibility and read-only readiness

Observed 2026-11-04. Server-side tracking: YBX Apps #24; Kaneo #166.

## What the client does

`ybx.crosspoint-plugin/plugin.js` manages the firmware's built-in KOReader
sync settings. The plugin does **not** implement KOReader HTTP authorization,
progress GET or progress PUT. Its current YBX mode configures an HTTP sync
host, the `ybx` username and a narrowly scoped `kosync_` token.

Custom KOReader headers exist in newer firmware sources:
`KOReaderCredentialStore::setCustomHeader()` stores up to two name/value
pairs in `/.crosspoint/koreader.json`, with values obfuscated for that reader.
`getSettingsList()` exposes `koHeader1Name`, `koHeader1Value`,
`koHeader2Name`, `koHeader2Value`; GET `/api/settings` masks the two values.
`KOReaderSyncClient.cpp` calls `applyCustomHeaders()` after `http.begin()`
for `/users/auth`, `/users/create`, progress GET and progress PUT.

This is **source-level** proof of the capability, not a captured outbound
request from the installed firmware. Stock releases and custom builds must
be checked individually; do not infer capabilities from a plugin version.

## Passive inspection in plugin settings

The new **«Проверить KoSync V2 (без изменений)»** action lives in the
independent **«KOSync · позиции чтения»** group introduced by the ongoing
Stock 1.6.14 settings refactor (PR #17), alongside enable/disable and restore.
The separate **metadata** and **quotes/clippings** groups are unchanged by
this diagnostic. The action only does a fresh same-origin **GET
`/api/settings`**. Its output deliberately distinguishes:

| Actual settings response | Reported result | Safe interpretation |
| --- | --- | --- |
| Empty/unreachable | `не проверено` | Unknown; keep existing sync untouched |
| No four header-setting keys | `нет API заголовков` | No web-configurable headers detected; legacy remains supported |
| Four keys, no V2 header name | `поля доступны, V2 не найден` | UI can configure headers, but V2 is not configured |
| V2 name with explicitly empty value | `заголовок без значения` | No usable V2 advertisement established |
| V2 name with masked/unknown value | `имя V2 найдено` | Name exists, but **value and wire traffic are unverified** |

The plugin never reads hidden header values, writes a setting, changes
credentials or rotates tokens in this diagnostic. Ordinary stock KoSync
setup remains unchanged. The read-only check is available to both stock and
custom firmware users, but never requires the four fields.

## Verified evidence

- Live QEMU guest `ybx-eink-qemu11-8950`: real GET `/api/settings` returned
  **HTTP 200** with 71 visible settings, including the four custom KOReader
  header settings. Without changing its settings, running the plugin's
  actual readiness-classifier against just these sanitized fields returned
  **`поля доступны, V2 не найден`**. A different QEMU guest in deep sleep did
  not answer the endpoint; no intervention was made to wake it.
- Native C11 client `core/ybx_kosync.c` explicitly emits
  `X-YBX-Kosync-Protocol: 2`; the C11 host test asserts the header.
  Android's Java and native transports also set the header in source.
- `tests/e2e/run_kosync_v2_v1_v2_queue.sh` was executed locally on the
  current YBX Apps repository. It compiled a **real historical pre-V2 binary**
  (`829ab833...`) and the current V2 core against the same disposable SQLite
  queue: V2 queued progress, historical V1 encountered GET 200 / PUT 403 and
  preserved the queue, and restored V2 transmitted the retained entry without
  replaying the V1 queue. This tests the offline queue and recovery path,
  **not** a production-device HTTP exchange or a server floor reset.
- The 15-minute live production observation previously recorded seven
  successfully authenticated legacy requests and zero V2 advertisements.
  That window did not identify which installed firmware caused them.

## Why V2 is NOT enabled by this plugin change

The PostgreSQL V21 server binds an authenticated V2 request to the device's
minimum accepted protocol. After floor 2, a downgraded V1 client may receive
403 for progress PUT. A local V2 → V1 → V2 queue-format round trip does not
remove this **server-side** downgrade restriction.

Do **not** write raw `koreader.json` to set the header: stored values use
reader-bound obfuscation. Do **not** infer V2 from only `koHeader*Name` or an
available header-setting API. Do **not** raise every registered device floor.

A genuine wire-level sign-off requires a **disposable test device** and a
controlled KoSync endpoint: verify credential storage, actual auth/GET/PUT
headers, saved progress, fallback, and downgrade rejection/recovery for the
specific firmware build. Production devices with important positions should
remain on Legacy until an accepted migration and rollback plan exists.

## Local checks

```sh
node --test tests/*.test.mjs tests/*.mjs
python3 -m pytest -q tests/test_payload.py
python3 tools/validate_payload.py
```

No production deployment, device setting change, token rotation or protocol
floor migration is part of this change.
