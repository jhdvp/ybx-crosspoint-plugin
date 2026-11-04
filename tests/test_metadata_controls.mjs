import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync('ybx.crosspoint-plugin/plugin.js', 'utf8');
const a = src.indexOf('    const metadataOptions = [');
const b = src.indexOf('    const restoreButton = document.createElement', a);
assert.ok(a > 0 && b > a, 'metadata controls must come from the shipped plugin');
const implementation = src.slice(a, b) + '\n;globalThis.metadataButtons = metadataButtons;';
const IDS = ['libraryUseMetadata', 'koSendMetadata'];

function world({ library = 0, send = 0, readError = false, dropWrite = false,
  missing = null } = {}) {
  const values = { libraryUseMetadata: library, koSendMetadata: send,
    koServerUrl: 'https://third-party.example/kosync',
    koMatchMethod: 0, koSyncClippings: 1, koSyncBehavior: 0 };
  if (missing) delete values[missing];
  const writes = [], messages = [];
  const element = () => ({
    children: [], textContent: '', disabled: false,
    append(...items) { this.children.push(...items); },
    appendChild(item) { this.children.push(item); },
    setAttribute(name, value) { this[name] = value; },
  });
  const ctx = vm.createContext({
    current: Object.entries(values).map(([key, value]) => ({ key, value })),
    document: { createElement: () => element() },
    token: { access_token: 'cp_test' },
    settingValue: (rows, key) => rows.find(x => x.key === key)?.value,
    settingEnabled: (rows, key) => Number(rows.find(x => x.key === key)?.value) === 1,
    readSettings: async () => {
      if (readError) throw new Error('settings HTTP 503');
      return Object.entries(values).map(([key, value]) => ({ key, value }));
    },
    writeSettings: async (patch) => {
      writes.push({ ...patch });
      if (!dropWrite) Object.assign(values, patch);
    },
    message: (message, kind) => messages.push([message, kind]),
    Error, Number,
  });
  vm.runInContext(implementation, ctx);
  return { values, writes, messages, buttons: ctx.metadataButtons };
}

test('Library metadata switch is separate from KOSync and Clippings', async () => {
  const w = world();
  await w.buttons.libraryUseMetadata.onclick();
  assert.deepEqual(JSON.parse(JSON.stringify(w.writes)), [{ libraryUseMetadata: 1 }]);
  assert.equal(w.values.koSendMetadata, 0);
  assert.equal(w.values.koServerUrl, 'https://third-party.example/kosync');
  assert.equal(w.values.koSyncClippings, 1);
  assert.equal(w.values.koMatchMethod, 0);
  assert.equal(w.messages.at(-1)[1], 'ok');
  assert.equal(w.buttons.libraryUseMetadata.textContent, 'Выключить');
});

test('Sending document metadata can be enabled without changing library setting', async () => {
  const w = world({ library: 0 });
  await w.buttons.koSendMetadata.onclick();
  assert.deepEqual(JSON.parse(JSON.stringify(w.writes)), [{ koSendMetadata: 1 }]);
  assert.equal(w.values.libraryUseMetadata, 0);
  assert.equal(w.values.koSyncClippings, 1);
  assert.equal(w.messages.at(-1)[1], 'ok');
});

test('Each metadata toggle can be disabled independently', async () => {
  const w = world({ library: 1, send: 1 });
  await w.buttons.koSendMetadata.onclick();
  assert.equal(w.values.koSendMetadata, 0);
  assert.equal(w.values.libraryUseMetadata, 1);
  await w.buttons.libraryUseMetadata.onclick();
  assert.equal(w.values.libraryUseMetadata, 0);
  assert.equal(w.values.koSendMetadata, 0);
  assert.equal(w.writes.length, 2);
});

test('Unknown firmware metadata key is not presented as switchable', () => {
  const w = world({ missing: 'libraryUseMetadata' });
  assert.equal(w.buttons.libraryUseMetadata.textContent, 'Недоступно');
  assert.equal(w.buttons.libraryUseMetadata.disabled, true);
  assert.equal(w.buttons.koSendMetadata.disabled, false);
});

test('Firmware read failure must not write any metadata fields', async () => {
  const w = world({ readError: true });
  await w.buttons.koSendMetadata.onclick();
  assert.equal(w.writes.length, 0);
  assert.equal(w.messages.at(-1)[1], 'err');
});

test('Firmware silently dropping a metadata flag must not report success', async () => {
  const w = world({ dropWrite: true });
  await w.buttons.libraryUseMetadata.onclick();
  assert.equal(w.values.libraryUseMetadata, 0);
  assert.equal(w.messages.at(-1)[1], 'err');
  assert.match(w.messages.at(-1)[0], /не сохранила/);
});

test('The web interface has three separate groups and does not mix their buttons', () => {
  assert.match(src, /settingGroup\('KOSync · позиции чтения'/);
  assert.match(src, /settingGroup\('Метаданные книг'/);
  assert.match(src, /settingGroup\('Цитаты · Clippings'/);
  assert.match(src, /kosyncActions\.append\(syncButton, disableSyncButton, restoreButton\)/);
  assert.match(src, /metadataGroup\.appendChild\(metadataRows\)/);
  assert.match(src, /clippingActions\.append\(clippingButton, revokeClipButton\)/);
  assert.deepEqual(IDS, ['libraryUseMetadata', 'koSendMetadata']);
});
