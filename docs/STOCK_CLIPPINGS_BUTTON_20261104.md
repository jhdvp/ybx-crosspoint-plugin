# Stock CrossPoint 2.0 RC — YBX Clippings button (candidate)

2026-11-04. This is Stock (not custom YBX Native), a local unreleased branch.

## Web settings

`Настройки → Синхронизация цитат → Включить синхронизацию цитат`:

- obtains a separate quote-capable `kosync_` credential from YBX API over
  authenticated HTTPS, with explicit user consent (never silently widens the
  progress-only key);
- writes the **verified HTTPS** KOSync URL, username and password to
  `/api/settings` on official Stock 2.0, along with:
  `koServerType=0` (CrossPoint), `koMatchMethod=1` (Binary),
  `koSendMetadata=1` (send title/author metadata),
  `koSyncBehavior=1` (Smart Sync), `koSyncClippings=1`;
- checks all non-secret values via readback; checks KOSync credentials on the
  HTTPS server's `/users/auth`. The original password is masked by firmware.
- distinguishes **settings written** from a completed guest→server→Yandex
  exchange. The reader has to perform Sync Progress to prove delivery.

Stock has *no metadata matching option* in `DocumentMatchMethod`; it supports
only `FILENAME=0` or `BINARY=1`. `koSendMetadata=1` is a separate setting and is
not an instruction to use filename instead of the content identity hash.

The separate **Disable** action writes only `koSyncClippings=0` (no account
removal, KOSync progress credential or book deletion). Explicitly restoring a
former KOSync profile also clears this bit; the old progress-only KOSync button
refuses to downgrade a quote-enabled HTTPS key onto the legacy HTTP host.
Backing up a manually selected third-party server does not copy masked
passwords and never overwrites an older saved backup.

## Required server side

A quote-capable KOSync key has a separate, TLS-only clipping capability and a
short MD5 proof representation matching the **unmodified** Stock ClippingSync
request (`x-auth-user`, `x-auth-key`). Progress uses the raw key over HTTP Basic
**only over TLS** for such quote-enabled keys. Existing progress-only keys
remain limited to progress and may still use their old HTTP compatibility path.
The dedicated clipping route is exactly `/api/v1/crosspoint/kosync/api/v1/clippings/{hash}`.
No quote content or quote-capable progress credential may cross plain HTTP.

## Release conditions

- Do not promote Stable 1.6.14 until the matching server PR is reviewed and
  deployed together with the plugin changes, behind a staged check.
- Test the exact Stock firmware's HTTPS clipping GET/PUT/GET, stock UI create,
  YBX server persisted quote, Yandex outbox and reverse pull. A client test
  returning 200 and a save-to-settings readback alone are not proof.
- Open EPUB without the existing `multi_heap_free` / heap corruption crash,
  and check TLS behaviour on physical X3/X4/X4 Pro as available.
- Verify installed old accounts, manual third-party KOSync, opt-out, restore,
  token rotation, offline retry, revocation and metadata send on real hardware.
