# YBX for CrossPoint — Plugin Hub distribution

The YBX plugin connects CrossPoint readers to linked book services, QR device
pairing, EPUB downloads, reader events, and the YBX statistics/profile in WebUI.

This public repository holds the release PAYLOAD, not the editable source.
The canonical source lives in the private YBX Server repository at
plugins/crosspoint/ybx. A public release MUST match those runtime files byte
for byte, not merely have the same version number.

## Install channels

- Home → Plugins → Plugin Hub → Community Plugins → YBX (published release).
- Custom catalog: https://ybx.app/crosspoint-plugin/catalog.json
- Direct installer: https://ybx.app/installer

The universal CrossPoint profile uses static shelves. The separate YBX Reader
1.7.x profile requires the fork-only catalog.lists.auth capability. Never
replace the public plugin with a fork-only manifest.

## Release procedure

1. Increase manifest/plugin version in the PRIVATE canonical server source.
2. Package and test YBX Server, and deploy its public installation endpoint.
3. Copy the canonical runtime files to the public checkout:

    python3 tools/validate_payload.py --canonical /path/to/YBX-Site/plugins/crosspoint/ybx --sync

4. Verify parity and execute unit tests:

    python3 tools/validate_payload.py --canonical /path/to/YBX-Site/plugins/crosspoint/ybx
    python3 -m unittest discover -s tests -v

5. Review the diff, publish a non-draft/non-prerelease GitHub Release with
   tag vX.Y.Z and verify Plugin Hub indexes the immutable release payload.

The public workflow checks structural validity, while the private server
must perform cross-repository byte-parity. No private GitHub token should be
added to public pull-request workflows.

Ordinary Plugin Hub updates overwrite declared package files (including
config.json) while preserving unlisted token.json. Complete removal deletes
the plugin directory. Back up configuration before changing install channels.
