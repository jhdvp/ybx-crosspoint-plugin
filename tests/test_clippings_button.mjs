import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const js = readFileSync('ybx.crosspoint-plugin/plugin.js', 'utf8');
const first = js.indexOf('    const revokeClippingKey = async () => {');
const last = js.indexOf('    const syncButton = document.createElement', first);
assert.ok(first > 0 && last > first, 'read actual button handler');
const realHandler = js.slice(first, last) + '\nglobalThis.clippingButton = clippingButton; globalThis.revokeClipButton = revokeClipButton;';
const BASE = 'https://my.ybx.app/api/v1/crosspoint/kosync';
const KEY = 'kosync_' + 'a'.repeat(43);

function scenario({ enabled = false, consent = true, relayStatus = 200,
  response = { kosync_key: KEY, sync_url: BASE, clippings_enabled: true },
  failReadback = false, relayAvailable = true, revokeFails = false, oldServer = '',
  token = { access_token: 'cp_valid' }, existingBackup = null } = {}) {
  const values = { koServerUrl: oldServer, koUsername: '', koPassword: '',
    koServerType: 2, koMatchMethod: 0, libraryUseMetadata: 0, koSendMetadata: 0,
    koSyncBehavior: 0, koSyncClippings: Number(enabled) };
  const writes = [], messages = [], calls = [], confirms = [], backups = [];
  const revokeResponse = { status: revokeFails ? 503 : 204 };
  let reads = 0;
  const context = vm.createContext({
    document: { createElement: () => ({ type: '', className: '', disabled: false,
      textContent: '', onclick: null }) },
    token, Date, JSON, String, Number, Error, Object,
    API: 'https://my.ybx.app', CLIPPINGS_KOSYNC_URL: BASE,
    KOSYNC_PREVIOUS: '/private/previous.json',
    current: Object.entries(values).map(([key, value]) => ({ key, value })),
    clipsEnabled: (arr) => Number(arr.find(x => x.key === 'koSyncClippings')?.value || 0) === 1,
    settingValue: (arr, name) => arr.find(x => x.key === name)?.value,
    readSettings: async () => {
      reads++;
      if (failReadback && reads > 1) throw new Error('settings readback failed');
      return Object.entries(values).map(([key, value]) => ({ key, value }));
    },
    writeSettings: async (data) => {
      writes.push({ ...data }); Object.assign(values, data);
    },
    readJson: async () => existingBackup,
    writeJson: async (path, value) => backups.push({ path, value }),
    api: { relay: relayAvailable ? async (...args) => {
      calls.push(args);
      if (String(args[1]).endsWith('/auth/clippings-key/revoke')) return { status: revokeResponse.status };
      return { status: relayStatus, body: JSON.stringify(response) };
    } : null },
    verifyPluginSync: async (key) => {
      assert.equal(key, KEY);
      assert.equal(values.koServerUrl, BASE);
      calls.push(['GET', 'verified HTTPS progress auth']);
    },
    syncButton: { textContent: '' }, syncValue: { textContent: '' },
    disableSyncButton: { hidden: true },
    restoreButton: { hidden: true }, clipValue: { textContent: '' },
    window: { confirm: (text) => { confirms.push(text); return consent; } },
    message: (text, kind) => messages.push([text, kind]),
  });
  vm.runInContext(realHandler, context);
  return { click: () => context.clippingButton.onclick(), button: context.clippingButton,
    context, values, writes, messages, calls, confirms, backups, revokeResponse };
}

test('quote activation sets KoSync credentials, binary book matching and the clipping flag, not metadata', async () => {
  const t = scenario();
  await t.click();
  assert.equal(t.calls[0][0], 'POST');
  assert.equal(t.calls[0][1], 'https://my.ybx.app/api/v1/crosspoint/auth/clippings-key');
  assert.equal(t.calls[0][2].Authorization, 'Bearer cp_valid');
  assert.equal(t.writes.length, 1);
  assert.equal(t.values.koServerUrl, BASE);
  assert.equal(t.values.koPassword, KEY);
  assert.equal(t.values.koUsername, 'ybx');
  assert.equal(t.values.koServerType, 2);  // preserve user's server type
  assert.equal(t.values.koMatchMethod, 1);  // YBX maps clippings by binary EPUB hash only
  assert.equal(t.values.koSendMetadata, 0);
  assert.equal(t.values.libraryUseMetadata, 0);
  assert.equal(t.values.koSyncBehavior, 0);
  assert.equal(t.values.koSyncClippings, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(t.writes[0])), {
    koServerUrl: BASE, koUsername: 'ybx', koPassword: KEY, koMatchMethod: 1, koSyncClippings: 1,
  });
  assert.equal(t.backups.length, 1);
  assert.match(t.messages.at(-1)[0], /передачу цитат/);
  assert.equal(t.messages.at(-1)[1], 'ok');
  assert.match(t.button.textContent, /^Выключить/);
  assert.equal(t.button.disabled, false);
});

test('disabling quotes changes only one flag, leaves progress and metadata intact', async () => {
  const t = scenario({ enabled: true, oldServer: BASE });
  await t.click();
  assert.deepEqual(t.writes, [{ koSyncClippings: 0 }]);
  assert.equal(t.values.koServerUrl, BASE);
  assert.equal(t.context.syncValue.textContent, 'YBX · KOSync (без цитат)');
  assert.equal(t.values.koSendMetadata, 0);
  assert.equal(t.values.libraryUseMetadata, 0);
  assert.equal(t.calls.length, 1);
  assert.ok(t.calls[0][1].endsWith('/auth/clippings-key/revoke'));
  assert.equal(t.calls[0][2].Authorization, 'Bearer cp_valid');
  assert.equal(t.context.revokeClipButton.hidden, true);
  assert.match(t.button.textContent, /^Включить/);
});

test('quote revoke outage disables locally but leaves a retry button and visible warning', async () => {
  const t = scenario({ enabled: true, oldServer: BASE, revokeFails: true });
  await t.click();
  assert.equal(t.values.koSyncClippings, 0);
  assert.equal(t.values.koServerUrl, BASE);
  assert.equal(t.context.revokeClipButton.hidden, false);
  assert.equal(t.messages.at(-1)[1], 'err');
  assert.match(t.messages.at(-1)[0], /серверный ключ ещё действителен/);
  t.revokeResponse.status = 204;
  await t.context.revokeClipButton.onclick();
  assert.equal(t.context.revokeClipButton.hidden, true);
  assert.equal(t.messages.at(-1)[1], 'ok');
  assert.equal(t.values.koSyncClippings, 0);
});

test('declined consent mints nothing, writes nothing and preserves other server', async () => {
  const t = scenario({ consent: false, oldServer: 'https://third-party.example/kosync' });
  await t.click();
  assert.equal(t.calls.length, 0);
  assert.equal(t.writes.length, 0);
  assert.equal(t.backups.length, 0);
  assert.equal(t.values.koServerUrl, 'https://third-party.example/kosync');
});

test('server failure does not enable quote sync or alter metadata', async () => {
  const t = scenario({ relayStatus: 503 });
  await t.click();
  assert.equal(t.writes.length, 0);
  assert.equal(t.values.koSendMetadata, 0);
  assert.equal(t.values.libraryUseMetadata, 0);
  assert.equal(t.messages.at(-1)[1], 'err');
});

test('production 404 before server rollout must leave old KOSync and metadata untouched', async () => {
  const url = 'https://third-party.example/custom-kosync';
  const t = scenario({ relayStatus: 404, oldServer: url });
  await t.click();
  assert.equal(t.writes.length, 0);
  assert.equal(t.backups.length, 0);
  assert.equal(t.values.koServerUrl, url);
  assert.equal(t.values.koSyncClippings, 0);
  assert.equal(t.values.koSendMetadata, 0);
  assert.equal(t.values.libraryUseMetadata, 0);
  assert.equal(t.messages.at(-1)[1], 'err');
  assert.equal(t.button.disabled, false, 'retry button remains available after server deployment');
});

test('invalid token or unsafe quote endpoint fails closed', async () => {
  for (const response of [
    { kosync_key: 'cp_wrong', sync_url: BASE, clippings_enabled: true },
    { kosync_key: KEY, sync_url: 'http://sync.ybx.app/api/v1/crosspoint/kosync', clippings_enabled: true },
    { kosync_key: KEY, sync_url: BASE + '/untrusted', clippings_enabled: true },
    { kosync_key: KEY, sync_url: BASE, clippings_enabled: false },
  ]) {
    const t = scenario({ response });
    await t.click();
    assert.equal(t.writes.length, 0);
    assert.equal(t.messages.at(-1)[1], 'err');
  }
});

test('failed firmware readback disables partial quote setup and reports error', async () => {
  const t = scenario({ failReadback: true });
  await t.click();
  assert.equal(t.writes.length, 2);
  assert.equal(t.writes[0].koSyncClippings, 1);
  assert.equal(t.writes[1].koSyncClippings, 0);
  assert.equal(t.messages.at(-1)[1], 'err');
});

test('a backup of original KOSync is never overwritten', async () => {
  const backup = { koServerUrl: 'https://original.example/kosync' };
  const t = scenario({ existingBackup: backup, oldServer: BASE });
  await t.click();
  assert.equal(t.backups.length, 0);
  assert.equal(t.values.koSyncClippings, 1);
});

test('missing relay support refuses opt-in, no settings altered', async () => {
  const t = scenario({ relayAvailable: false });
  await t.click();
  assert.equal(t.writes.length, 0);
  assert.equal(t.messages.at(-1)[1], 'err');
});
