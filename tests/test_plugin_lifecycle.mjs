import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const js = readFileSync('ybx.crosspoint-plugin/plugin.js', 'utf8');

function extract(begin, end) {
  const a = js.indexOf(begin), b = js.indexOf(end, a);
  assert.ok(a !== -1 && b > a, 'cannot extract ' + begin);
  return js.slice(a, b);
}

const exists = extract('  async function fileExists(dir, name) {', '\n  // Проверяем саму прошивку');
const readToken = extract('  const readPluginToken = async () => {', '\n  const writeJson =');
const readSettingsSource = extract('  const readSettings = async ({ required = false } = {}) => {',
  '\n  const writeSettings =');
const sync = extract('    syncButton.onclick = async () => {', '\n    const SLEEP_MODES =');
// The predicates the sync button leans on, taken from the plugin itself so the
// scenarios cannot drift from what ships.
const syncUrlHelpers = extract('  const syncMode = (settings) => {', '\n  const version = async () => {')
  + '\nglobalThis.syncMode = syncMode; globalThis.pointsToYbx = pointsToYbx;';
const logout = extract('    signOutButton.onclick = async () => {', '\n    const settingGroup =');

const sleepConsts = extract('    const SLEEP_MODES =', '\n    const sleepButton =');
const sleepToggle = extract('    sleepButton.onclick = async () => {', '\n    const sleepCardButton =');
const sleepLegacy = extract('    const legacyButton =', '\n    paintSleepState();');
// The page reads the switch from the reader's own device.json, so the slices
// run inside an async wrapper with the file helpers mocked.
const sleepRuntime = '(async () => {\n' + sleepConsts + sleepToggle + sleepLegacy
  + '\npaintSleepState();\nglobalThis.sleepMode = () => sleepMode;'
  + '\nglobalThis.legacyButton = legacyButton;\n})()';

async function sleepSettings({ mode = 3, cardOn = false, token = { access_token: 'cp_test' },
                               failure = null, slot = null, confirm = true,
                               legacy = false } = {}) {
  const calls = [];
  const messages = [];
  let handlerOn = cardOn;
  const context = vm.createContext({
    settingValue: (settings, key) => settings[key],
    current: { sleepScreen: mode },
    token,
    CARD_MODE: 2, COVER_MODE: 3, COVER_CUSTOM_MODE: 4, SLEEP_SLOT: '/sleep.bmp',
    sleepButton: { disabled: false, textContent: '' },
    sleepValue: { textContent: '' },
    sleepCardButton: { disabled: true },
    sleepHint: { hidden: true, textContent: '' },
    window: { confirm: () => confirm },
    message: (text, kind) => messages.push([kind || 'info', text]),
    readSleepDevice: async () => ({ events: {} }),
    reconcileSleepCard: async () => handlerOn,
    sleepHandlerOn: () => handlerOn,
    readSleepFile: async () => slot,
    ownsSleepSlot: (bytes) => bytes === 'ours',
    legacyInSlot: async () => legacy,
    SLEEP_LEGACY_BACKUP: '/.crosspoint/plugins/ybx/sleep-legacy.bmp',
    clearLegacySleepCard: async () => { calls.push(['legacy']); legacy = false; return true; },
    document: { createElement: () => ({}) },
    setSleepCard: async (enabled, currentMode) => {
      if (failure) throw new Error(failure);
      calls.push([enabled, currentMode]);
      handlerOn = enabled;
      return enabled ? 'on' : 'cleared';
    },
  });
  await vm.runInContext(sleepRuntime, context);
  return { context, calls, messages };
}

test('the sleep switch turns the statistics card on and back off', async () => {
  const screen = await sleepSettings({ mode: 3 });  // «Обложка», card off
  assert.match(screen.context.sleepValue.textContent, /^Обложка · обои ридера/);
  assert.equal(screen.context.sleepButton.textContent, 'Включить экран сна со статистикой');

  await screen.context.sleepButton.onclick();
  assert.deepEqual(screen.calls, [[true, 3]]);
  assert.equal(screen.context.sleepMode(), 2);
  assert.equal(screen.context.sleepButton.textContent, 'Выключить экран сна со статистикой');
  assert.equal(screen.context.sleepCardButton.disabled, false);

  await screen.context.sleepButton.onclick();
  assert.deepEqual(screen.calls, [[true, 3], [false, 2]]);
  assert.equal(screen.context.sleepMode(), 3);
  assert.equal(screen.context.sleepButton.textContent, 'Включить экран сна со статистикой');
  assert.equal(screen.context.sleepCardButton.disabled, true);
  assert.match(screen.messages.at(-1)[1], /карточка убрана/);
});

test('«Обложка + Свой» is explained and switched off as a whole', async () => {
  const screen = await sleepSettings({ mode: 4, cardOn: true });
  assert.equal(screen.context.sleepHint.hidden, false);
  assert.match(screen.context.sleepHint.textContent, /только если сон не из книги/);

  await screen.context.sleepButton.onclick();
  assert.deepEqual(screen.calls, [[false, 4]]);
  assert.equal(screen.context.sleepMode(), 3);
  assert.equal(screen.context.sleepHint.hidden, true);
});

test('a user picture in /sleep.bmp is not touched without consent', async () => {
  const screen = await sleepSettings({ mode: 3, slot: 'theirs', confirm: false });
  await screen.context.sleepButton.onclick();
  assert.deepEqual(screen.calls, []);
  assert.match(screen.messages.at(-1)[1], /не тронута/);
});

test('a refused change leaves the switch where it was', async () => {
  const screen = await sleepSettings({ mode: 3, failure: 'HTTP 500' });
  await screen.context.sleepButton.onclick();
  assert.equal(screen.context.sleepMode(), 3);
  assert.equal(screen.context.sleepButton.textContent, 'Включить экран сна со статистикой');
  assert.equal(screen.context.sleepButton.disabled, false);
  assert.match(screen.messages.at(-1)[1], /Не удалось изменить экран сна/);
});

test('SD lookup failure blocks overwrite; actual absence is allowed', async () => {
  for (const response of [
    { ok: false, status: 503 },
    { ok: true, status: 200, json: async () => ({ error: 'corrupt' }) },
  ]) {
    const context = vm.createContext({ fetch: async () => response, encodeURIComponent, Error });
    vm.runInContext(exists + '\nglobalThis.check = fileExists;', context);
    await assert.rejects(context.check('/exports', 'stats_exported'), /SD/);
  }
  const ctx = vm.createContext({
    encodeURIComponent,
    fetch: async () => ({
      ok: true, status: 200,
      json: async () => [{ name: 'stats_exported', isDirectory: false }],
    }),
  });
  vm.runInContext(exists + '\nglobalThis.check = fileExists;', ctx);
  assert.equal(await ctx.check('/exports', 'stats_exported'), true);
  assert.equal(await ctx.check('/exports', 'other'), false);

  // Same filename can be stored under alternate spellings on a FAT volume.
  const fat = vm.createContext({
    encodeURIComponent,
    fetch: async () => ({
      ok: true, status: 200, json: async () =>
        [{ name: ' READING_STATS.JSON. ', isDirectory: false }],
    }),
  });
  vm.runInContext(exists + '\nglobalThis.check = fileExists;', fat);
  assert.equal(await fat.check('/.crosspoint', 'reading_stats.json'), true);
});

test('explicit logout sentinel blocks stale legacy credential fallback', async () => {
  const scenario = async (current) => {
    const seen = [];
    const context = vm.createContext({
      TOKEN_PATH: '/current', LEGACY_TOKEN_PATH: '/legacy',
      readJson: async (path) => {
        seen.push(path);
        return path === '/current' ? current : { access_token: 'cp_legacy' };
      },
    });
    vm.runInContext(readToken + '\nglobalThis.readPluginToken = readPluginToken;', context);
    return { token: await context.readPluginToken(), seen };
  };
  const explicit = await scenario({ disconnected: true });
  assert.equal(explicit.token, null);
  assert.deepEqual(explicit.seen, ['/current']);
  const migrated = await scenario(null);
  assert.equal(migrated.token.access_token, 'cp_legacy');
  const active = await scenario({ access_token: 'cp_current' });
  assert.equal(active.token.access_token, 'cp_current');
  assert.deepEqual(active.seen, ['/current']);
});

test('settings failure must block mutation, not imply that settings are blank', async () => {
  for (const response of [
    { ok: false, status: 500 },
    { ok: true, json: async () => ({ unexpected: true }) },
  ]) {
    const ctx = vm.createContext({ fetch: async () => response, Error, Array });
    vm.runInContext(readSettingsSource + '\nglobalThis.getSettings = readSettings;', ctx);
    const displayed = await ctx.getSettings();
    assert.equal(displayed.length, 0);
    await assert.rejects(ctx.getSettings({ required: true }), /settings|настроек/);
  }
});

function syncScenario({
  confirm = true, synced = true, server = null, settingsFailure = false,
  quoteSync = false,
  dropWrite = false, dropUser = false, refreshFailure = false, authStatus = 200,
  keyStatus = 200, keyBody = JSON.stringify({ kosync_key: 'kosync_test', username: 'ybx' }),
  username = null,
} = {}) {
  const writes = [], messages = [], confirmations = [], authCalls = [];
  const token = { access_token: 'cp_new' };
  const stored = {
    koServerUrl: server ?? (synced ? 'http://sync.ybx.app/api/v1/crosspoint/kosync' : ''),
    koUsername: username ?? (server?.includes('/kosync') && !server.includes('/api/v1/')
      ? 'account_name' : 'ybx'),
    koPassword: 'masked',
    koSyncClippings: Number(quoteSync),
  };
  let reads = 0;
  const saved = [];
  const context = vm.createContext({
    token, Error, URL, Date,
    clipsEnabled: (settings) => Number(settings.find((row) => row.key === 'koSyncClippings')?.value || 0) === 1,
    btoa: (s) => Buffer.from(s).toString('base64'),
    API: 'https://my.ybx.app',
    api: { relay: async (...args) => {
      authCalls.push(args);
      if (args[0] === 'POST' && String(args[1]).endsWith('/auth/kosync-key')) {
        return { status: keyStatus, body: keyBody };
      }
      return { status: authStatus };
    } },
    mode: stored.koServerUrl.includes('/api/v1/crosspoint/kosync') ? 'plugin' : 'other',
    syncButton: { disabled: false },
    document: { createElement: () => ({ hidden: false, disabled: false, onclick: null }) },
    SYNC_OFF: { koServerUrl: '', koUsername: '', koPassword: '' },
    syncValue: { textContent: '' },
    clipValue: { textContent: '' },
    clippingButton: { textContent: '' },
    restoreButton: { hidden: true },
    KOSYNC_PREVIOUS: '/.crosspoint/plugins/ybx/kosync-previous.json',
    writeJson: async (path, value) => { saved.push([path, value]); },
    window: { confirm: (prompt) => { confirmations.push(prompt); return confirm; } },
    readSettings: async () => {
      reads += 1;
      if (settingsFailure || (refreshFailure && reads > 1)) throw new Error('settings HTTP 503');
      return Object.entries(stored).map(([key, value]) => ({ key, value }));
    },
    settingValue: (rows, key) => rows.find((row) => row.key === key)?.value,
    KOSYNC_URL: 'http://sync.ybx.app/api/v1/crosspoint/kosync',
    writeSettings: async (value) => {
      writes.push(value);
      if (!dropWrite) for (const [key, val] of Object.entries(value)) {
        if (dropUser && key === 'koUsername') continue;
        stored[key] = val;
      }
    },
    message: (...x) => messages.push(x),
  });
  vm.runInContext(syncUrlHelpers, context);
  vm.runInContext(sync + '\n;globalThis.disableSyncButton = disableSyncButton;', context);
  return { context, writes, messages, confirmations, stored, authCalls, saved };
}

const getAuthCalls = (host) => host.authCalls.filter((call) => call[0] === 'GET');

test('rotation mints the narrow key over TLS and validates it on the sync host', async () => {
  // A reader still configured by plugin 1.6.x on the old https address.
  const host = syncScenario({ server: 'https://my.ybx.app/api/v1/crosspoint/kosync' });
  await host.context.syncButton.onclick();
  assert.deepEqual(host.writes.map(x => Object.keys(x)), [['koServerUrl', 'koPassword']]);
  assert.equal(host.writes[0].koServerUrl, 'http://sync.ybx.app/api/v1/crosspoint/kosync');
  assert.equal(host.writes[0].koPassword, 'kosync_test');
  const mint = host.authCalls[0];
  assert.equal(mint[0], 'POST');
  assert.equal(mint[1], 'https://my.ybx.app/api/v1/crosspoint/auth/kosync-key');
  assert.equal(mint[2].Authorization, 'Bearer cp_new');
  const verify = getAuthCalls(host)[0];
  assert.equal(verify[1], 'http://sync.ybx.app/api/v1/crosspoint/kosync/users/auth');
  assert.equal(verify[2].Authorization,
    'Basic ' + Buffer.from('ybx:kosync_test').toString('base64'));
  assert.equal(host.context.syncButton.disabled, false);
  assert.match(host.messages.at(-1)[0], /сервер принимает ключ/);
});

test('the ordinary KOSync button cannot downgrade quote-enabled HTTPS credentials to HTTP', async () => {
  const host = syncScenario({ server: 'https://my.ybx.app/api/v1/crosspoint/kosync', quoteSync: true });
  await host.context.syncButton.onclick();
  assert.deepEqual(host.writes, []);
  assert.equal(host.authCalls.length, 0);
  assert.match(host.messages.at(-1)[0], /цитат включена/);
  assert.equal(host.messages.at(-1)[1], 'err');
});

test('KOSync disable keeps metadata and disables quotes only after confirmation', async () => {
  const host = syncScenario({ server: 'https://my.ybx.app/api/v1/crosspoint/kosync', quoteSync: true });
  host.stored.libraryUseMetadata = 1;
  host.stored.koSendMetadata = 1;
  await host.context.disableSyncButton.onclick();
  assert.deepEqual(JSON.parse(JSON.stringify(host.writes)), [{
    koServerUrl: '', koUsername: '', koPassword: '', koSyncClippings: 0,
  }]);
  assert.equal(host.stored.libraryUseMetadata, 1);
  assert.equal(host.stored.koSendMetadata, 1);
  assert.equal(host.stored.koSyncClippings, 0);
  assert.match(host.messages.at(-1)[0], /отключён/);
});

test('KOSync disable cancellation leaves credentials and clipping state alone', async () => {
  const host = syncScenario({ server: 'https://my.ybx.app/api/v1/crosspoint/kosync',
    quoteSync: true, confirm: false });
  await host.context.disableSyncButton.onclick();
  assert.equal(host.writes.length, 0);
  assert.equal(host.stored.koSyncClippings, 1);
  assert.match(host.messages.at(-1)[0], /отменено/);
});

test('KOSync disable refuses to clear another server', async () => {
  const host = syncScenario({ server: 'https://other.example/kosync' });
  await host.context.disableSyncButton.onclick();
  assert.equal(host.writes.length, 0);
  assert.match(host.messages.at(-1)[0], /другого сервера/);
});

test('a refused key mint writes nothing', async () => {
  const host = syncScenario({ keyStatus: 503 });
  await host.context.syncButton.onclick();
  assert.deepEqual(host.writes, []);
  assert.equal(getAuthCalls(host).length, 0);
  assert.match(host.messages.at(-1)[0], /не выдал ключ синхронизации \(HTTP 503\)/);
  assert.equal(host.messages.at(-1)[1], 'err');
});

test('a malformed key answer writes nothing', async () => {
  const host = syncScenario({ keyBody: 'not-json' });
  await host.context.syncButton.onclick();
  assert.deepEqual(host.writes, []);
  assert.match(host.messages.at(-1)[0], /некорректный ключ/);
  const wrong = syncScenario({ keyBody: JSON.stringify({ kosync_key: 'cp_sneaky' }) });
  await wrong.context.syncButton.onclick();
  assert.deepEqual(wrong.writes, []);
  assert.match(wrong.messages.at(-1)[0], /некорректный ключ/);
});

test('plugin setup refuses a failed settings read without changing credentials', async () => {
  const host = syncScenario({ settingsFailure: true });
  await host.context.syncButton.onclick();
  assert.deepEqual(host.writes, []);
  assert.match(host.messages.at(-1)[0], /settings HTTP 503/);
});

test('declined credential refresh leaves settings untouched', async () => {
  const host = syncScenario({ confirm: false });
  await host.context.syncButton.onclick();
  assert.deepEqual(host.writes, []);
  assert.equal(host.context.syncButton.disabled, false);
});

test('firmware drops URL: no success and no validation request', async () => {
  const host = syncScenario({ synced: false, dropWrite: true });
  await host.context.syncButton.onclick();
  assert.equal(host.writes.length, 1);
  assert.equal(getAuthCalls(host).length, 0);
  assert.match(host.messages.at(-1)[0], /не сохранил адрес/);
  assert.equal(host.messages.at(-1)[1], 'err');
});

test('firmware accepts address but drops username: no false success', async () => {
  const host = syncScenario({ synced: false, username: 'old', dropUser: true });
  await host.context.syncButton.onclick();
  assert.match(host.messages.at(-1)[0], /не сохранил адрес или пользователя/);
  assert.equal(getAuthCalls(host).length, 0);
});

test('good settings and server token response are reported as verified, not synchronized', async () => {
  const host = syncScenario({ synced: false });
  await host.context.syncButton.onclick();
  assert.equal(host.messages.at(-1)[1], 'ok');
  assert.match(host.messages.at(-1)[0], /Проверьте/);
  assert.doesNotMatch(host.messages.at(-1)[0], /Готово|синхронизируется/);
  assert.equal(host.context.syncValue.textContent, 'YBX · через плагин');
});

test('server refuses a token: show error despite saved URL and user', async () => {
  const host = syncScenario({ synced: false, authStatus: 401 });
  await host.context.syncButton.onclick();
  assert.equal(host.writes.length, 1);
  assert.equal(getAuthCalls(host).length, 1);
  assert.equal(host.messages.at(-1)[1], 'err');
  assert.match(host.messages.at(-1)[0], /HTTP 401/);
});

test('account KOSync stays intact when user declines explicit migration', async () => {
  for (const server of ['http://opds.ybx.app/kosync',
                        'https://sync.ybx.app/kosync/',
                        'https://my.ybx.app/kosync']) {
    const host = syncScenario({ server, confirm: false });
    await host.context.syncButton.onclick();
    assert.equal(host.writes.length, 0, server);
    assert.equal(host.authCalls.length, 0);
    assert.equal(host.stored.koServerUrl, server);
    assert.ok(host.confirmations[0].includes('самостоятельный KOSync'), server);
  }
});

test('account migration requires consent and writes coherent plugin credentials', async () => {
  const host = syncScenario({ server: 'http://opds.ybx.app/kosync' });
  await host.context.syncButton.onclick();
  assert.deepEqual(host.writes.map((item) => Object.keys(item))[0],
    ['koServerUrl', 'koUsername', 'koPassword', 'koMatchMethod', 'koSyncBehavior']);
  assert.equal(host.stored.koServerUrl, 'http://sync.ybx.app/api/v1/crosspoint/kosync');
  assert.equal(host.stored.koUsername, 'ybx');
  assert.equal(host.stored.koPassword, 'kosync_test');
  assert.equal(getAuthCalls(host).length, 1);
  assert.match(host.messages.at(-1)[0], /Проверьте/);
});

test('a settings read lost after the write is not success', async () => {
  const host = syncScenario({ synced: false, refreshFailure: true });
  await host.context.syncButton.onclick();
  assert.equal(host.writes.length, 1);
  assert.equal(getAuthCalls(host).length, 0);
  assert.equal(host.messages.at(-1)[1], 'err');
});

test('invalid schemes, substring paths and ports never identify a configured endpoint', async () => {
  for (const server of [
    'ftp://ybx.app/kosync', 'https://ybx.app/not-kosync',
    'https://ybx.app/kosync.bad', 'https://ybx.app:8080/kosync',
    'http://example.com/kosync', 'https://sync.crosspointreader.com',
    'https://ybx.app/kosync?token=abc', 'http://my.ybx.app/kosync', '',
  ]) {
    const host = syncScenario({ server });
    assert.equal(host.context.syncMode([{ key: 'koServerUrl', value: server }]), 'other', server);
    await host.context.syncButton.onclick();
    assert.equal(host.writes[0].koServerUrl, 'http://sync.ybx.app/api/v1/crosspoint/kosync', server);
  }
});

test('the plugin endpoint is recognized on the sync host over HTTP and on the cabinet over HTTPS', () => {
  const host = syncScenario({ synced: false });
  const row = (value) => [{ key: 'koServerUrl', value }];
  assert.equal(host.context.syncMode(row('http://sync.ybx.app/api/v1/crosspoint/kosync')), 'plugin');
  assert.equal(host.context.syncMode(row('http://sync.ybx.app/api/v1/crosspoint/kosync/')), 'plugin');
  assert.equal(host.context.syncMode(row('https://my.ybx.app/api/v1/crosspoint/kosync')), 'plugin');
  assert.equal(host.context.syncMode(row('https://sync.ybx.app/api/v1/crosspoint/kosync')), 'plugin');
  // The cabinet host redirects HTTP to HTTPS and never carries a broad token
  // in the clear, so plain HTTP there is a typo, not a configured endpoint.
  assert.equal(host.context.syncMode(row('http://my.ybx.app/api/v1/crosspoint/kosync')), 'other');
  assert.equal(host.context.syncMode(row('http://sync.ybx.app/api/v1/crosspoint/kosync/x')), 'other');
  assert.equal(host.context.syncMode(row('http://sync.ybx.app:8080/api/v1/crosspoint/kosync')), 'other');
});
function logoutScenario({
  status = 204, confirm = false, networkFailure = false,
  writeFailure = false, legacyExisting = false, legacyWriteFailure = false,
  settingsFailure = false, settingsWriteFailure = false,
  storedServer = 'https://my.ybx.app/api/v1/crosspoint/kosync',
} = {}) {
  const calls = [], writes = [], messages = [];
  const context = vm.createContext({
    token: { access_token: 'cp_current' },
    API: 'https://my.ybx.app',
    TOKEN_PATH: '/.crosspoint/plugins/ybx/token.json',
    LEGACY_TOKEN_PATH: '/.crosspoint/plugin-data/ybx/token.json',
    SYNC_OFF: { koServerUrl: '', koUsername: '', koPassword: '' },
    signOutButton: { disabled: false }, Error,
    api: { relay: async (...args) => {
      calls.push(args);
      if (networkFailure) throw new Error('offline');
      return { status };
    } },
    writeJson: async (...args) => {
      writes.push(args);
      if (writeFailure || (legacyWriteFailure && args[0].includes('/plugin-data/'))) {
        throw new Error('disk full');
      }
    },
    fetch: async () => settingsFailure
      ? { ok: false, status: 503 }
      : { ok: true, json: async () => [{ key: 'koServerUrl', value: storedServer }] },
    readJson: async (path) =>
      legacyExisting && path.includes('/plugin-data/') ? { access_token: 'cp_old' } : null,
    URL, KOSYNC_URL: 'https://my.ybx.app/api/v1/crosspoint/kosync',
    settingValue: (rows, key) => rows.find(r => r.key === key)?.value,
    writeSettings: async (value) => {
      if (settingsWriteFailure) throw new Error('settings write failed');
      writes.push(['settings', value]);
    },
    renderSignedOut: () => calls.push(['renderSignedOut']),
    message: (...args) => messages.push(args),
    window: { confirm: (...args) => { calls.push(['confirm', ...args]); return confirm; } },
  });
  vm.runInContext(syncUrlHelpers, context);
  vm.runInContext(logout, context);
  return { context, calls, writes, messages };
}

test('logout revokes on server before erasing local credentials', async () => {
  const host = logoutScenario();
  await host.context.signOutButton.onclick();
  const call = host.calls[0];
  assert.equal(call[0], 'POST');
  assert.equal(call[1], 'https://my.ybx.app/api/v1/crosspoint/auth/revoke');
  assert.equal(call[2].Authorization, 'Bearer cp_current');
  assert.equal(call[3], '');
  assert.equal(host.writes.length, 2);
  assert.equal(host.writes.at(-1)[0], '/.crosspoint/plugins/ybx/token.json');
  assert.equal(host.writes.at(-1)[1].disconnected, true);
  assert.equal(host.context.token, null);
  assert.equal(host.context.signOutButton.disabled, false);
  assert.match(host.messages.at(-1)[0], /Доступ на сервере отозван/);
});

test('failed revocation requires confirmation before local-only logout', async () => {
  const reject = logoutScenario({ networkFailure: true, confirm: false });
  await reject.context.signOutButton.onclick();
  assert.deepEqual(reject.writes, []);
  assert.equal(reject.context.token.access_token, 'cp_current');
  const accept = logoutScenario({ networkFailure: true, confirm: true });
  await accept.context.signOutButton.onclick();
  assert.equal(accept.context.token, null);
  assert.match(accept.messages.at(-1)[0], /Полный отзыв доступа не подтверждён/);
});

test('401 requires explicit confirmation before any local logout', async () => {
  const refused = logoutScenario({ status: 401, confirm: false });
  await refused.context.signOutButton.onclick();
  assert.equal(refused.context.token.access_token, 'cp_current');
  assert.deepEqual(refused.writes, []);
  assert.ok(refused.calls.some(x => x[0] === 'confirm'));
  const accepted = logoutScenario({ status: 401, confirm: true });
  await accepted.context.signOutButton.onclick();
  assert.equal(accepted.context.token, null);
  assert.match(accepted.messages.at(-1)[0], /не подтверждён/);
});

test('legacy cleanup failure cannot restore logged-out session', async () => {
  const host = logoutScenario({ legacyExisting: true, legacyWriteFailure: true });
  await host.context.signOutButton.onclick();
  assert.equal(host.context.token, null);
  assert.equal(host.writes[1][1].disconnected, true);
  assert.match(host.messages.at(-1)[0], /не удалось очистить старый файл токена/);
  assert.equal(host.messages.at(-1)[1], 'err');
});

test('logout never erases independent account KOSync over HTTP or HTTPS', async () => {
  for (const server of ['http://opds.ybx.app/kosync', 'https://sync.ybx.app/kosync']) {
    const host = logoutScenario({ storedServer: server });
    await host.context.signOutButton.onclick();
    assert.ok(!host.writes.some(x => x[0] === 'settings'), server);
    assert.equal(host.context.token, null);
  }
});

test('failed KOSync settings read is surfaced, but local token is blocked', async () => {
  const host = logoutScenario({ settingsFailure: true });
  await host.context.signOutButton.onclick();
  assert.equal(host.context.token, null);
  assert.match(host.messages.at(-1)[0], /не удалось очистить настройки KOSync/);
  assert.equal(host.writes.length, 1);
  assert.equal(host.messages.at(-1)[1], 'err');
});

test('KOSync settings write failure is surfaced and token cleanup continues', async () => {
  const host = logoutScenario({ settingsWriteFailure: true });
  await host.context.signOutButton.onclick();
  assert.equal(host.context.token, null);
  assert.match(host.messages.at(-1)[0], /не удалось очистить настройки KOSync/);
});

test('local SD cleanup failure does not pretend logout completed', async () => {
  const host = logoutScenario({ writeFailure: true });
  await host.context.signOutButton.onclick();
  assert.notEqual(host.context.token, null);
  assert.match(host.messages.at(-1)[0], /очистить локальные настройки не удалось/);
});

// The slot helpers decide whose picture /sleep.bmp holds; they must never
// delete or overwrite a picture YBX did not write.
const sleepSlot = extract('  const SLEEP_SLOT =', '\n  async function refreshSleepCard');

function bmpCard(width, height) {
  const size = 62 + Math.ceil(width / 32) * 4 * height;
  const bytes = new Uint8Array(size);
  const put = (at, value) => { bytes[at] = value & 255; bytes[at + 1] = value >> 8 & 255;
    bytes[at + 2] = value >> 16 & 255; bytes[at + 3] = value >> 24 & 255; };
  bytes[0] = 0x42; bytes[1] = 0x4d; put(2, size); put(10, 62); put(18, width); put(22, height);
  bytes[28] = 1;
  bytes.set([0x59, 0x42, 0x58, 0x31], 6);  // «YBX1», the server's mark
  return bytes;
}

async function slotWorld({ slot = null, backup = null, legacyBackup = null, preference = null,
                           handler = 'request', token = { access_token: 'cp_x' } } = {}) {
  const files = new Map();
  if (slot) files.set('/sleep.bmp', slot);
  if (backup) files.set('/.crosspoint/plugins/ybx/sleep-original.bmp', backup);
  if (legacyBackup) files.set('/.crosspoint/plugins/ybx/sleep-legacy.bmp', legacyBackup);
  const device = { browse: { lists_url: 'x' }, auth: { type: 'device_code' },
    download: { url: 'https://my.ybx.app/api/v1/crosspoint/books/{id}/download?v=1.7.0' },
    events: { 'sleep.enter': handler === 'download' ? { download: {} } : { request: {} } } };
  const writes = [];
  const deletes = [];
  const settings = [];
  const ctx = vm.createContext({
    DIR: '/.crosspoint/plugins/ybx', API: 'https://my.ybx.app', token,
    TextEncoder, Uint8Array, String, Boolean, Math, JSON, Error, URLSearchParams, encodeURIComponent,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    readJson: async (path) => path.endsWith('sleep-preference.json')
      ? (preference === null ? null : { enabled: preference, schema: 1 })
      : JSON.parse(JSON.stringify(device)),
    writeSettings: async (value) => settings.push(value),
    api: { writeFile: async (path, b64) => {
      const bytes = new Uint8Array(Buffer.from(b64, 'base64'));
      writes.push(path); files.set(path, bytes);
      if (path.endsWith('device.json')) Object.assign(device, JSON.parse(Buffer.from(bytes).toString()));
    } },
    fetch: async (url, init) => {
      if (url === '/delete') { const p = init.body.get('path'); deletes.push(p); files.delete(p); return { ok: true }; }
      const path = decodeURIComponent(url.split('path=')[1]);
      const bytes = files.get(path);
      return bytes ? { ok: true, status: 200, arrayBuffer: async () => bytes.buffer } : { ok: false, status: 404 };
    },
  });
  await vm.runInContext('(async () => {\n' + sleepSlot
    + '\nObject.assign(globalThis, { setSleepCard, reconcileSleepCard, ownsSleepSlot,'
    + ' clearLegacySleepCard, legacyInSlot });\n})()', ctx);
  return { ctx, files, writes, deletes, settings, device };
}

test('turning the card off restores a saved picture and never deletes a foreign one', async () => {
  const theirs = new Uint8Array([0x42, 0x4d, 1, 2, 3]);
  const off = await slotWorld({ slot: bmpCard(480, 800), backup: theirs, handler: 'download' });
  assert.equal(await off.ctx.setSleepCard(false, 2), 'restored');
  assert.deepEqual([...off.files.get('/sleep.bmp')], [...theirs]);
  assert.deepEqual(off.deletes, []);
  assert.equal('sleep.enter' in off.device.events, false);

  const foreign = await slotWorld({ slot: theirs, handler: 'download' });
  assert.equal(await foreign.ctx.setSleepCard(false, 3), 'kept');
  assert.deepEqual(foreign.deletes, []);
  assert.deepEqual([...foreign.files.get('/sleep.bmp')], [...theirs]);

  const ours = await slotWorld({ slot: bmpCard(528, 792), handler: 'download' });
  assert.equal(await ours.ctx.setSleepCard(false, 2), 'cleared');
  assert.deepEqual(ours.deletes, ['/sleep.bmp']);
});

test('turning the card on backs up a foreign picture first', async () => {
  const theirs = new Uint8Array([0x42, 0x4d, 9, 9]);
  const on = await slotWorld({ slot: theirs });
  assert.equal(await on.ctx.setSleepCard(true, 3), 'on');
  assert.deepEqual([...on.files.get('/.crosspoint/plugins/ybx/sleep-original.bmp')], [...theirs]);
  assert.ok(on.device.events['sleep.enter'].download);
  assert.deepEqual(on.settings.map((item) => item.sleepScreen), [2]);
});

test('opening the page removes a card left by an always-on version, and only that', async () => {
  const left = await slotWorld({ slot: bmpCard(480, 800) });
  assert.equal(await left.ctx.reconcileSleepCard(3), false);
  assert.deepEqual(left.deletes, ['/sleep.bmp']);

  const theirs = await slotWorld({ slot: new Uint8Array([0x42, 0x4d, 7]) });
  await theirs.ctx.reconcileSleepCard(3);
  assert.deepEqual(theirs.deletes, []);
  assert.deepEqual(theirs.writes, []);
});

test('replacing a hand-configured server saves it for «Вернуть прежний KOSync»', async () => {
  const host = syncScenario({ server: 'https://kosync.example.org', username: 'me' });
  await host.context.syncButton.onclick();
  assert.equal(host.saved.length, 1);
  assert.equal(host.saved[0][1].koServerUrl, 'https://kosync.example.org');
  assert.equal(host.saved[0][1].koUsername, 'me');
  assert.equal('koPassword' in host.saved[0][1], false);
  assert.equal(host.context.restoreButton.hidden, false);
  assert.match(host.confirmations[0], /Вернуть прежний KOSync/);
});

test('an empty server is named as the CrossPoint Sync cloud and its one-way mirror explained', async () => {
  const host = syncScenario({ server: '', username: '' });
  await host.context.syncButton.onclick();
  assert.match(host.confirmations[0], /облако CrossPoint Sync/);
  assert.match(host.confirmations[0], /только в одну сторону/);
});

test('a same-size monochrome wallpaper without the YBX mark is never treated as ours', async () => {
  const lookalike = bmpCard(480, 800);
  lookalike.set([0, 0, 0, 0], 6);
  const world = await slotWorld({ slot: lookalike });
  assert.equal(world.ctx.ownsSleepSlot(lookalike), false);
  await world.ctx.reconcileSleepCard();
  assert.deepEqual(world.deletes, []);
  const off = await slotWorld({ slot: lookalike, handler: 'download' });
  assert.equal(await off.ctx.setSleepCard(false, 2), 'kept');
  assert.deepEqual(off.deletes, []);
});

test('a card from before 1.6.10 is removed only by hand, with a copy kept', async () => {
  const old = bmpCard(480, 800);
  old.set([0, 0, 0, 0], 6);
  const world = await slotWorld({ slot: old });
  assert.equal(await world.ctx.legacyInSlot(), true);
  assert.equal(await world.ctx.clearLegacySleepCard(), true);
  assert.deepEqual([...world.files.get('/.crosspoint/plugins/ybx/sleep-legacy.bmp')], [...old]);
  assert.deepEqual(world.deletes, ['/sleep.bmp']);

  // A marked card, a foreign picture and a live switch are all left alone.
  for (const [slot, handler] of [[bmpCard(480, 800), 'request'],
    [new Uint8Array([0x42, 0x4d, 7]), 'request'], [old, 'download']]) {
    const other = await slotWorld({ slot, handler });
    assert.equal(await other.ctx.clearLegacySleepCard(), false);
    assert.deepEqual(other.deletes, []);
    assert.deepEqual(other.writes, []);
  }
});

test('the old-card button shows only with the switch off and asks first', async () => {
  const hidden = await sleepSettings({ mode: 3, cardOn: true, legacy: true });
  assert.equal(hidden.context.legacyButton.hidden, true);

  const declined = await sleepSettings({ mode: 3, legacy: true, confirm: false });
  assert.equal(declined.context.legacyButton.hidden, false);
  await declined.context.legacyButton.onclick();
  assert.deepEqual(declined.calls, []);
  assert.match(declined.messages.at(-1)[1], /не тронут/);

  const screen = await sleepSettings({ mode: 3, legacy: true });
  await screen.context.legacyButton.onclick();
  assert.deepEqual(screen.calls, [['legacy']]);
  assert.match(screen.messages.at(-1)[1], /sleep-legacy\.bmp/);
  assert.equal(screen.context.legacyButton.hidden, true);
});


test('legacy cleanup refuses to overwrite a different pre-existing backup', async () => {
  const slot = bmpCard(480, 800);
  slot.set([0, 0, 0, 0], 6);
  const preserved = new Uint8Array([0x42, 0x4d, 42]);
  const world = await slotWorld({ slot, legacyBackup: preserved });
  await assert.rejects(world.ctx.clearLegacySleepCard(), /резервная копия.*уже существует/);
  assert.deepEqual([...world.files.get('/.crosspoint/plugins/ybx/sleep-legacy.bmp')], [...preserved]);
  assert.deepEqual([...world.files.get('/sleep.bmp')], [...slot]);
  assert.deepEqual(world.deletes, []);
  assert.deepEqual(world.writes, []);
});

test('legacy cleanup is retryable when backup already contains this exact image', async () => {
  const slot = bmpCard(480, 800);
  slot.set([0, 0, 0, 0], 6);
  const world = await slotWorld({ slot, legacyBackup: slot.slice() });
  assert.equal(await world.ctx.clearLegacySleepCard(), true);
  assert.deepEqual(world.writes, []);
  assert.deepEqual(world.deletes, ['/sleep.bmp']);
});


test('an enabled sleep card survives an external device.json replacement', async () => {
  const card = bmpCard(480, 800);
  const world = await slotWorld({ slot: card, preference: true });
  assert.equal(await world.ctx.reconcileSleepCard(2), true);
  assert.ok(world.device.events['sleep.enter']?.download, 'sleep handler restored');
  assert.deepEqual(world.deletes, []);
  assert.equal(world.files.get('/sleep.bmp'), card);
});

test('upgrade from 1.6.11 can recover enabled sleep from its marked card and custom mode', async () => {
  const old = await slotWorld({ slot: bmpCard(528, 792) });
  assert.equal(await old.ctx.reconcileSleepCard(2), true);
  assert.ok(old.device.events['sleep.enter']?.download);
  assert.ok(old.files.has('/.crosspoint/plugins/ybx/sleep-preference.json'));
  assert.deepEqual(old.deletes, []);
});

test('a disabled card stays disabled after upgrade even with a stale marked image', async () => {
  const off = await slotWorld({ slot: bmpCard(480, 800), preference: false });
  assert.equal(await off.ctx.reconcileSleepCard(2), false);
  assert.equal('sleep.enter' in off.device.events, false);
  assert.deepEqual(off.deletes, ['/sleep.bmp']);
  const foreign = await slotWorld({ slot: new Uint8Array([0x42, 0x4d, 7]), preference: false });
  assert.equal(await foreign.ctx.reconcileSleepCard(2), false);
  assert.deepEqual(foreign.deletes, []);
  assert.deepEqual(foreign.writes, []);
});


test('temporary failure reading firmware sleep mode does not discard saved preference', async () => {
  const world = await slotWorld({ slot: bmpCard(480, 800), preference: true });
  assert.equal(await world.ctx.reconcileSleepCard(NaN), false);
  assert.deepEqual(world.deletes, []);
  assert.deepEqual(world.writes, []);
  assert.deepEqual(Object.keys(world.device.events), ['sleep.enter']); // unrelated request event untouched
});
