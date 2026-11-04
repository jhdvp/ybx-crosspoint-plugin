# Stock YBX 1.6.14 RC — release-gated test report

Date: 2026-11-04. **Scope: installed plugin on the *official* CrossPoint Stock
2.0.0 RC / X4 Pro only. Not the custom YBX Native 1.9.1 fork.**

## Verified in this QA pass

| Component | Result | Nature of evidence |
|---|---|---|
| ZIP manifest/public payload | PASS | `python tools/validate_payload.py`; exact same bytes for 7 files in ZIP, explicit `ybx/`, zero symlinks, deterministic 36,682-byte artifact; 13 Python tests / four subtests pass |
| Web plugin lifecycle | PASS | 48/48 Node tests; only code-level DOM/network mocks |
| QEMU gesture/fixture protocol test | PASS | 17/17 Python tests and 24 protocol subtests |
| Original guest root tree | PASS | actual original Stock X4 Pro in QEMU `8896`, captured root screen with 8 views; entered *Все книги* and verified a book details page, Fetch and *Download complete* screen with synthetic offline EPUB. New run had no independent fixture-HTTP evidence for Fetch; do not call that a network download proof |
| Real YBX paired catalog | PASS limited | paired `cp_` reader in separate official Stock guest `8906`; `my.ybx.app` HTTPS/TLS 1.3; eight requested shelf URLs returned HTTP 200 with the real account; no credentials in logs. Pages deliberately overlap one lookahead book — not duplicate UI entries |
| Stock Clippings v2 on synthetic KoSync | PASS manual E2E, **NOT automatic** | earlier actual official guest created two clippings, confirmed `View Clippings`, sent GET → PUT → GET with valid v2 revisions/cursor, plus progress PUT; see emulator experiment `0111`, synthetic HTTP evidence. The UI autorun still hits QEMU GT911/Wi-Fi picker intermittency (`0112`) |
| Original guest with real EPUB | **BLOCKER** | after live pairing, opening a downloaded EPUB reproduced `CORRUPT HEAP` (`multi_heap_free`) and guest crashed; QEMU process survived. Private forensic images retained locally and tracked in `ybx-esp32-emulator` issue #27 |
| Server Stock catalog tests | PASS with skipped environments | stock server branch: 143 pass / 69 skip on schema/shelves/sources/WB/plugin/API |
| Server generic Clippings v2 + narrow key reject | PASS but **not Stock quote E2E** | 25 pass / 1 skip for Clippings and key boundary; Stock-specific exact route QA (server branch) gives 1 pass / 2 skipped / **1 expected failure** |

## Blockers for Stock quote synchronization

1. Stock 1.6.14's web-panel `Настроить KOSync` sets URL/username/password,
   match mode and progress behavior. It does **not** set `koSyncClippings`.
   Official firmware initializes this field to **false**. Success of progress
   setup does not imply successful Clippings sync.
2. Stock web config uses `http://sync.ybx.app/api/v1/crosspoint/kosync` and a
   progress-only `kosync_` token. Official `ClippingSync` constructs
   `<base>/api/v1/clippings/<document>` with `x-auth-user` and
   `x-auth-key=MD5(kosync_)`; it does not attach the `cp_` Bearer token.
   Stock's route + credential are **not accepted** as an HTTPS quote endpoint
   by the current YBX server. Simply enabling the switch cannot fix this.
3. Plain HTTP cannot carry private highlight text safely. Do not change the
   server to accept quotes on this URL without a genuinely verified HTTPS
   transport and a separate privilege policy. Older CrossPoint 1.6.x stock
   SSL behavior needs hardware acceptance before an HTTPS-only migration.
4. Unmodified Stock's input automation still occasionally stops at QEMU Wi-Fi
   touch picker. **Manual E2E evidence is separate from a reproducible autorun.**
5. Genuine EPUB load can crash with heap corruption. Exact origin is not yet
   proven; don't blame the plugin without symbolication.

## Concrete acceptance sequence

- Official Stock firmware only, clean isolated SD and installed *exact* ZIP,
  installation/upgrade preservation and cancel/rollback. Real QR flow; check
  loading, expiry, re-auth, revocation, disabled sources, and all 8 category
  branches, lookahead, paging, Search, downloads, malformed/expired responses.
- Explicit opt-in and opt-out to Clippings, retaining manual KOSync servers.
  Test `Sync Clippings` stays off after cancellation and off after user disables.
- Safe HTTPS Stock-compatible auth on `.../api/v1/clippings/<hash>`; deny
  narrow key on unauthorized routes and deny quote text on cleartext HTTP.
- Guest firmware `Create Clipping` → GET probe → PUT → GET delta → local
  `View Clippings` → YBX row with id/revision → mapped Yandex quote outbox
  **done** → quote visible to Yandex → new quote created in Yandex → pulled
  into Stock `View Clippings` again. Include update, deletion, duplicate PUT,
  book identity mismatch, offline retries and stable no-crash book opening.
- Rerun on physical original X4 Pro before lifting stable release gate.

**Release decision: 1.6.14 RC remains NOT approved for stable / OTA.** The
code-level suite and synthetic guest Clippings proof are useful, but the
actual stock quote path has a specific compatibility/security failure.

Tracking: [Stock plugin issue #15](https://github.com/jhdvp/ybx-crosspoint-plugin/issues/15),
[guest heap corruption issue #27](https://github.com/jhdvp/ybx-esp32-emulator/issues/27),
[QEMU Wi-Fi touch issue #20](https://github.com/jhdvp/ybx-esp32-emulator/issues/20).
The custom Native [firmware PR #25](https://github.com/jhdvp/ybx-crosspoint/pull/25)
and [server PR #44](https://github.com/jhdvp/xteink-yandex-books/pull/44)
**do not constitute proof of Stock support**.
