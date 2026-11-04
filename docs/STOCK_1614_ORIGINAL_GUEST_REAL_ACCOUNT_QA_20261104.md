# Stock 1.6.14 — original CrossPoint 2.0 RC, real YBX account, isolated QEMU

2026-11-04. **Testing only, no Stable or production deploy.** No modified firmware, no real X4 Pro hardware. Genuine official CrossPoint `2.0.0-rc+1070912` in pinned official eink-qemu / QEMU 11.1.2. Browser preview: `127.0.0.1:8950`, isolated Docker container `ybx-eink-qemu11-8950` and separate FAT16 Flash/SD media. Production reader port 8784 is untouched.

## Confirmed directly from the real unchanged firmware guest

1. Installed exactly the seven manifest-listed files of Stock YBX **1.6.14** from this PR to an isolated FAT16 SD image. Payload validator passed. Stock **Plugins → YBX** appeared, with its manifest description; no uninstall prompt on the short 60ms test click.
2. On launching the plugin, the guest used internet TLS and displayed the **real YBX device-code QR** (`Waiting for authorization`). Opened its fresh `my.ybx.app/pair?...` link using a locally logged-in browser session. The Stock guest switched from QR waiting to a **populated real YBX catalog**. No token or QR code is stored in this report.
3. The root tree actually displayed eight sections: `Все книги`, `Читаю`, `Хочу прочитать`, `Прочитано`, `Загруженные`, `Яндекс Книги`, `WB Книги`, `ЛитРес`.
4. `Все книги` populated real user library entries. Opening a real entry showed book title, author, source, description and reading progress. `Details` opened the extended book description.
5. `Fetch` on one existing account book showed **Download complete**. Verified isolated SD contained a new **905,311-byte** EPUB under `/books/ybx`; ZIP has 55 members and all member CRCs passed. The real downloaded book is intentionally **not** committed to Git, and its title is omitted here.
6. `Browse Files → books → ybx` showed the downloaded EPUB next to the synthetic fixture. Selecting the real EPUB opened its full cover in the **real original reader**, without `multi_heap_free` / panic in UART during this run.
7. The per-device YBX access token persisted in `.crosspoint/plugins/ybx/token.json` after authorization; inspected **presence and keys only**, never printed or saved token value. A cold restart **of the isolated QEMU container only** retained the book; the reader Home displayed its cover, and tapping it resumed the real EPUB cover without a crash.

## Separate original-guest Clippings/KoSync proof

In emulator [0113](https://github.com/jhdvp/ybx-esp32-emulator/blob/fix/stock1614-guest-e2e-ui-gates-20261104/tools/ybx-system-emu/experiments/0113-stock1614-real-guest-twice-20261104.md), the same unmodified Stock firmware transmitted a new local clipping to an isolated, synthetic KoSync server (2 GET, 1 PUT, progress PUT) and, after another cold boot, re-fetched the quote and progress without duplicates. Unlike this real-account catalog check, that proof did **not** touch the live Yandex API.

## Not yet verified / release hold

- Page-turning beyond the cover in the **real downloaded EPUB**: QMP returned `accepted: true` but the framebuffer did not change on taps while the reader was open. GT911/QMP stale-touch behaviour is a separate emulator issue; do not claim it is a reader bug or that full content pagination passed.
- Actual Yandex quote push/pull under the real account from **Stock** after enabling the new three browser settings. The server support is in [PR #46](https://github.com/jhdvp/xteink-yandex-books/pull/46); it has not been merged/deployed.
- Real physical reader smoke test. CI was unable to provision workers on account of GitHub billing/spending limitation, not assertion failures.
- Original CrossPoint's `setInsecure()` TLS peer-validation weakness is inherited. HTTPS routes are enforced server-side for the separately minted quote proof, but that does not protect against active TLS MITM on unmodified stock firmware.

**Decision:** excellent Stock 1.6.14 catalog, QR, download, original-firmware synthetic quote protocol evidence, but **NOT ready to claim full end-to-end real Yandex quote sync** and **NOT auto-promoted to Stable**.
