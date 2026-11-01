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
const logout = extract('    signOutButton.onclick = async () => {', '\n    actions.append(');

const sleepConsts = extract('    const SLEEP_MODES =', '\n    const sleepButton =');
const sleepToggle = extract('    sleepButton.onclick = async () => {', '\n    const sleepCardButton =');
const sleepPaint = extract('    const paintSleepState = () => {', '\n    paintSleepState();');
const sleepRuntime = sleepConsts + sleepToggle + sleepPaint
  + '\npaintSleepState();\nglobalThis.sleepMode = () => sleepMode;';

function sleepSettings({ mode = 3, token = { access_token: 'cp_test' }, failure = null } = {}) {
  const writes = [];
  const messages = [];
  const context = vm.createContext({
    settingValue: (settings, key) => settings[key],
    current: { sleepScreen: mode },
    token,
    sleepButton: { disabled: false, textContent: '' },
    sleepValue: { textContent: '' },
    sleepCardButton: { disabled: true },
    sleepHint: { hidden: true, textContent: '' },
    message: (text, kind) => messages.push([kind || 'info', text]),
    writeSettings: async (value) => {
      if (failure) throw new Error(failure);
      writes.push(value);
    },
  });
  vm.runInContext(sleepRuntime, context);
  return { context, writes, messages };
}

test('the sleep switch turns the statistics card on and back off', async () => {
  const screen = sleepSettings({ mode: 3 });  // «Обложка»
  assert.equal(screen.context.sleepValue.textContent, 'Обложка');
  assert.equal(screen.context.sleepButton.textContent, 'Включать статистику на сне');

  await screen.context.sleepButton.onclick();
  assert.deepEqual(screen.writes.map((item) => item.sleepScreen), [2]);
  assert.equal(screen.context.sleepMode(), 2);
  assert.equal(screen.context.sleepValue.textContent, 'Свой');
  assert.equal(screen.context.sleepButton.textContent, 'Выключить статистику на сне');
  assert.equal(screen.context.sleepCardButton.disabled, false);

  await screen.context.sleepButton.onclick();
  assert.deepEqual(screen.writes.map((item) => item.sleepScreen), [2, 3]);
  assert.equal(screen.context.sleepMode(), 3);
  assert.equal(screen.context.sleepValue.textContent, 'Обложка');
  assert.equal(screen.context.sleepButton.textContent, 'Включать статистику на сне');
  assert.equal(screen.context.sleepCardButton.disabled, true);
});

test('«Обложка + Свой» is named, explained and switched off as a whole', async () => {
  const screen = sleepSettings({ mode: 4 });  // the mode behind "выключил, а оно включается"
  assert.equal(screen.context.sleepValue.textContent, 'Обложка + Свой');
  assert.equal(screen.context.sleepHint.hidden, false);
  assert.match(screen.context.sleepHint.textContent, /когда сон не из книги/);
  assert.equal(screen.context.sleepButton.textContent, 'Выключить статистику на сне');

  await screen.context.sleepButton.onclick();
  assert.deepEqual(screen.writes.map((item) => item.sleepScreen), [3]);
  assert.equal(screen.context.sleepMode(), 3);
  assert.equal(screen.context.sleepHint.hidden, true);
});

test('a refused settings write leaves the switch where it was', async () => {
  const screen = sleepSettings({ mode: 3, failure: 'settings HTTP 500' });

  await screen.context.sleepButton.onclick();

  assert.deepEqual(screen.writes, []);
  assert.equal(screen.context.sleepMode(), 3);
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
  dropWrite = false, dropUser = false, refreshFailure = false, authStatus = 200,
  username = null,
} = {}) {
  const writes = [], messages = [], confirmations = [], authCalls = [];
  const token = { access_token: 'cp_new' };
  const stored = {
    koServerUrl: server ?? (synced ? 'https://my.ybx.app/api/v1/crosspoint/kosync' : ''),
    koUsername: username ?? (server?.includes('/kosync') && !server.includes('/api/v1/')
      ? 'account_name' : 'ybx'),
    koPassword: 'masked',
  };
  let reads = 0;
  const context = vm.createContext({
    token, Error, URL,
    btoa: (s) => Buffer.from(s).toString('base64'),
    api: { relay: async (...args) => { authCalls.push(args); return { status: authStatus }; } },
    syncButton: { disabled: false },
    syncValue: { textContent: '' },
    window: { confirm: (prompt) => { confirmations.push(prompt); return confirm; } },
    readSettings: async () => {
      reads += 1;
      if (settingsFailure || (refreshFailure && reads > 1)) throw new Error('settings HTTP 503');
      return Object.entries(stored).map(([key, value]) => ({ key, value }));
    },
    settingValue: (rows, key) => rows.find((row) => row.key === key)?.value,
    KOSYNC_URL: 'https://my.ybx.app/api/v1/crosspoint/kosync',
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
  vm.runInContext(sync, context);
  return { context, writes, messages, confirmations, stored, authCalls };
}

test('plugin token refresh preserves the plugin endpoint and validates the token', async () => {
  const host = syncScenario();
  await host.context.syncButton.onclick();
  assert.deepEqual(host.writes.map(x => Object.keys(x)), [['koPassword']]);
  assert.equal(host.writes[0].koPassword, 'cp_new');
  assert.equal(host.authCalls[0][0], 'GET');
  assert.equal(host.authCalls[0][1], 'https://my.ybx.app/api/v1/crosspoint/kosync/users/auth');
  assert.equal(host.authCalls[0][2].Authorization,
    'Basic ' + Buffer.from('ybx:cp_new').toString('base64'));
  assert.equal(host.context.syncButton.disabled, false);
  assert.match(host.messages.at(-1)[0], /сервер принимает токен/);
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

test('firmware drops URL: no success and no token auth request', async () => {
  const host = syncScenario({ synced: false, dropWrite: true });
  await host.context.syncButton.onclick();
  assert.equal(host.writes.length, 1);
  assert.equal(host.authCalls.length, 0);
  assert.match(host.messages.at(-1)[0], /не сохранил адрес/);
  assert.equal(host.messages.at(-1)[1], 'err');
});

test('firmware accepts address but drops username: no false success', async () => {
  const host = syncScenario({ synced: false, username: 'old', dropUser: true });
  await host.context.syncButton.onclick();
  assert.match(host.messages.at(-1)[0], /не сохранил адрес или пользователя/);
  assert.equal(host.authCalls.length, 0);
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
  assert.equal(host.authCalls.length, 1);
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
    ['koServerUrl', 'koUsername', 'koPassword', 'koMatchMethod', 'koSyncBehavior', 'koSendMetadata']);
  assert.equal(host.stored.koServerUrl, 'https://my.ybx.app/api/v1/crosspoint/kosync');
  assert.equal(host.stored.koUsername, 'ybx');
  assert.equal(host.stored.koPassword, 'cp_new');
  assert.equal(host.authCalls.length, 1);
  assert.match(host.messages.at(-1)[0], /Проверьте/);
});

test('a settings read lost after the write is not success', async () => {
  const host = syncScenario({ synced: false, refreshFailure: true });
  await host.context.syncButton.onclick();
  assert.equal(host.writes.length, 1);
  assert.equal(host.authCalls.length, 0);
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
    assert.equal(host.writes[0].koServerUrl, 'https://my.ybx.app/api/v1/crosspoint/kosync', server);
  }
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
  assert.match(host.messages.at(-1)[0], /не удалось очистить настройки KOReader Sync/);
  assert.equal(host.writes.length, 1);
  assert.equal(host.messages.at(-1)[1], 'err');
});

test('KOSync settings write failure is surfaced and token cleanup continues', async () => {
  const host = logoutScenario({ settingsWriteFailure: true });
  await host.context.signOutButton.onclick();
  assert.equal(host.context.token, null);
  assert.match(host.messages.at(-1)[0], /не удалось очистить настройки KOReader Sync/);
});

test('local SD cleanup failure does not pretend logout completed', async () => {
  const host = logoutScenario({ writeFailure: true });
  await host.context.signOutButton.onclick();
  assert.notEqual(host.context.token, null);
  assert.match(host.messages.at(-1)[0], /очистить локальные настройки не удалось/);
});
