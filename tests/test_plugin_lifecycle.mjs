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
const sync = extract('    syncButton.onclick = async () => {', '\n    const sleepMode =');
const logout = extract('    signOutButton.onclick = async () => {', '\n    actions.append(');

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

function syncScenario({ confirm = true, synced = true, settingsFailure = false } = {}) {
  const writes = [], messages = [], confirmations = [];
  const token = { access_token: 'cp_new' };
  const context = vm.createContext({
    token, Error, URL,
    syncButton: { disabled: false },
    syncValue: { textContent: '' },
    window: { confirm: (prompt) => { confirmations.push(prompt); return confirm; } },
    readSettings: async () => {
      if (settingsFailure) throw new Error('settings HTTP 503');
      return [
        { key: 'koServerUrl', value: synced ? 'https://my.ybx.app/api/v1/crosspoint/kosync' : '' },
        { key: 'koUsername', value: 'ybx' },
      ];
    },
    pointsToYbx: (rows) => rows.some(x => x.key === 'koServerUrl' && x.value === 'https://my.ybx.app/api/v1/crosspoint/kosync'),
    settingValue: (rows, key) => rows.find(x => x.key === key)?.value,
    KOSYNC_URL: 'https://my.ybx.app/api/v1/crosspoint/kosync',
    writeSettings: async (value) => { writes.push(value); },
    message: (...x) => messages.push(x),
  });
  vm.runInContext(sync, context);
  return { context, writes, messages, confirmations };
}

test('configured KOSync can refresh only its credential', async () => {
  const host = syncScenario();
  await host.context.syncButton.onclick();
  assert.deepEqual(host.writes.map(x => Object.keys(x)), [['koPassword']]);
  assert.equal(host.writes[0].koPassword, 'cp_new');
  assert.equal(host.context.syncButton.disabled, false);
  assert.match(host.messages.at(-1)[0], /Ключ KOReader Sync обновлён/);
});

test('KOSync setup refuses a failed settings read without changing credentials', async () => {
  const host = syncScenario({ settingsFailure: true });
  await host.context.syncButton.onclick();
  assert.deepEqual(host.writes, []);
  assert.equal(host.context.syncButton.disabled, false);
  assert.match(host.messages.at(-1)[0], /settings HTTP 503/);
});

test('declined credential refresh leaves settings untouched', async () => {
  const host = syncScenario({ confirm: false });
  await host.context.syncButton.onclick();
  assert.deepEqual(host.writes, []);
  assert.equal(host.context.syncButton.disabled, false);
});

function logoutScenario({
  status = 204, confirm = false, networkFailure = false,
  writeFailure = false, legacyExisting = false, legacyWriteFailure = false,
  settingsFailure = false, settingsWriteFailure = false,
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
      : { ok: true, json: async () => [{ key: 'koServerUrl', value: 'https://my.ybx.app/api/v1/crosspoint/kosync' }] },
    readJson: async (path) =>
      legacyExisting && path.includes('/plugin-data/') ? { access_token: 'cp_old' } : null,
    pointsToYbx: () => true,
    writeSettings: async (value) => {
      if (settingsWriteFailure) throw new Error('settings write failed');
      writes.push(['settings', value]);
    },
    renderSignedOut: () => calls.push(['renderSignedOut']),
    message: (...args) => messages.push(args),
    window: { confirm: (...args) => { calls.push(['confirm', ...args]); return confirm; } },
  });
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
