import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('ybx.crosspoint-plugin/plugin.js', 'utf8');
const shipped = JSON.parse(readFileSync('ybx.crosspoint-plugin/device.json', 'utf8'));

function slice(begin, end) {
  const a = source.indexOf(begin);
  const b = source.indexOf(end, a);
  assert.ok(a !== -1 && b > a, 'cannot extract ' + begin);
  return source.slice(a, b);
}

// The preference constants and the address rewrite are taken from the shipped
// plugin, so a scenario cannot drift from what runs on the reader.
const runtime = slice('  const SORT_PREFERENCE =', '\n  // These endpoints belong')
  + slice('  let deviceWriteQueue =', '\n  // ── Зеркало сервера в device.json')
  + slice('  const DEVICE_HOST_PAIRS =', '\n  // ── Сортировка в адресах device.json')
  + slice('  const CATALOG_PATHS =', '\n  const sleepHandlerOn =');

function sorter({ sort = { mode: 'default' }, writeFails = false } = {}) {
  const writes = [];
  const ctx = vm.createContext({
    URL, JSON, TextEncoder, String, Boolean, Array, Object, Number, Error, Promise,
    DIR: '/.crosspoint/plugins/ybx',
    SLEEP_DEVICE: '/.crosspoint/plugins/ybx/device.json',
    readJson: async () => sort,
    writeJson: async () => {},
    sleepBytes: (bytes) => bytes,
    api: { writeFile: async (path, bytes) => {
      if (writeFails) throw new Error('HTTP 500');
      writes.push([path, bytes]);
    } },
    // The same structural guard the sleep card uses: a missing or unparseable
    // working file must never be rebuilt from scratch.
    readSleepDevice: async () => JSON.parse(JSON.stringify(shipped)),
  });
  vm.runInContext(runtime + '\nglobalThis.rewrite = rewriteDeviceSort;'
    + '\nglobalThis.rewriteOnDisk = rewriteDeviceSortOnDisk;'
    + '\nglobalThis.readChoice = readSortChoice; globalThis.saveChoice = saveSortChoice;'
    + '\nglobalThis.param = withSortParam; globalThis.hosts = rewriteDeviceHosts;', ctx);
  return { ctx, writes };
}

const shelves = (device) => [device.browse.url, ...device.browse.lists.filter((entry) => !entry.id).map((entry) => entry.url)];

test('title and added reach the root browse and every shelf of the shipped catalog', () => {
  for (const mode of ['title', 'added', 'author', 'progress']) {
    const { ctx } = sorter();
    const device = JSON.parse(JSON.stringify(shipped));
    assert.equal(ctx.rewrite(device, mode), true);
    for (const url of shelves(device)) {
      assert.match(url, new RegExp('&sort=' + mode + '$'), url);
      assert.ok(url.includes('page={page}') && url.includes('limit={limit}'), url);
      assert.ok(url.includes('page_size=10') && url.includes('v=1.7.1'), url);
    }
    // The two shelves that ship with a fixed order keep advertising it.
    assert.match(device.browse.lists[8].url, /&sort=title$/);
    assert.match(device.browse.lists[9].url, /&sort=added$/);
    // Only the size of a working file matters here, but the firmware refuses
    // a manifest over 8 KiB, so the rewrite must stay small.
    assert.ok(JSON.stringify(device, null, 2).length + 1 <= 8 * 1024);
  }
});

test('search keeps relevance order and nothing else in the file is touched', () => {
  const { ctx } = sorter();
  const before = JSON.parse(JSON.stringify(shipped));
  const device = JSON.parse(JSON.stringify(shipped));
  ctx.rewrite(device, 'title');
  assert.equal(device.browse.search.url, before.browse.search.url);
  assert.ok(!device.browse.search.url.includes('sort'));
  for (const key of ['download', 'auth', 'token', 'config']) {
    assert.deepEqual(device[key], before[key]);
  }
  assert.deepEqual(device.events, before.events);
  assert.deepEqual(Object.keys(device.browse), Object.keys(before.browse));
});

test('the default choice selects OPDS shelf order', () => {
  const { ctx } = sorter();
  const device = JSON.parse(JSON.stringify(shipped));
  ctx.rewrite(device, 'added');
  assert.equal(ctx.rewrite(device, 'default'), true);
  for (const url of [device.browse.url, ...device.browse.lists.slice(0, 8).map((e) => e.url)]) {
    assert.match(url, /&sort=opds$/);
  }
  // Only the two explicit order shelves still carry a parameter.
  assert.deepEqual(JSON.parse(JSON.stringify(device.browse.lists.slice(0, 8))),
    shipped.browse.lists.slice(0, 8));
});

test('rewriting the same order twice changes nothing and reports no write', () => {
  const { ctx, writes } = sorter();
  const device = JSON.parse(JSON.stringify(shipped));
  assert.equal(ctx.rewrite(device, 'title'), true);
  const once = JSON.stringify(device);
  assert.equal(ctx.rewrite(device, 'title'), false);
  assert.equal(JSON.stringify(device), once);
  // An unknown or missing choice is not applied: the reader keeps its order.
  for (const mode of ['bogus', 'TITLE', undefined, '', 'sort=title']) {
    assert.equal(ctx.rewrite(device, mode), false);
    assert.equal(JSON.stringify(device), once);
  }
});

test('addresses outside the YBX catalog routes are left byte for byte', () => {
  const { ctx } = sorter();
  const foreign = {
    browse: {
      url: 'https://evil.example/api/v1/crosspoint/catalog/all?page={page}',
      lists: [
        { url: 'http://my.ybx.app/api/v1/crosspoint/catalog/all?page={page}' },
        { url: 'https://my.ybx.app/api/v1/crosspoint/books/1/download?sort=added' },
        { url: 'https://my.ybx.app.evil.example/api/v1/crosspoint/catalog' },
        { url: 'https://my.ybx.app/api/v1/crosspoint/catalog/all' },
        { url: '/api/v1/crosspoint/catalog/all?x=1' },
        { url: 'https://emy.ybx.app/api/v1/crosspoint/wb/catalog?path=a%2Fb&x=1' },
        { title: 'without an address' },
      ],
    },
  };
  const before = JSON.stringify(foreign);
  assert.equal(ctx.rewrite(foreign, 'title'), true);
  const [hostile, download, suffix, bare, relative, encoded, titleOnly] =
    foreign.browse.lists.map((entry) => entry.url);
  assert.equal(foreign.browse.url, 'https://evil.example/api/v1/crosspoint/catalog/all?page={page}');
  assert.equal(hostile, 'http://my.ybx.app/api/v1/crosspoint/catalog/all?page={page}');
  assert.equal(download, 'https://my.ybx.app/api/v1/crosspoint/books/1/download?sort=added');
  assert.equal(suffix, 'https://my.ybx.app.evil.example/api/v1/crosspoint/catalog');
  assert.equal(relative, '/api/v1/crosspoint/catalog/all?x=1');
  // A template without a query has nowhere to put the parameter, so it stays.
  assert.equal(bare, 'https://my.ybx.app/api/v1/crosspoint/catalog/all');
  assert.equal(encoded, 'https://emy.ybx.app/api/v1/crosspoint/wb/catalog?path=a%2Fb&x=1&sort=title');
  assert.equal(titleOnly, undefined);
  assert.notEqual(before, JSON.stringify(foreign));
});

test('the chosen server mirror and the chosen order survive each other', () => {
  const { ctx } = sorter();
  const forHosts = (target) => {
    const device = JSON.parse(JSON.stringify(shipped));
    ctx.rewrite(device, 'title');
    ctx.hosts(device, target);
    return device;
  };
  const mirrors = { eu: 'emy', pt: 'pmy', main: 'my' };
  for (const [target, host] of Object.entries(mirrors)) {
    const moved = forHosts(target);
    assert.ok(shelves(moved).every((url) => url.startsWith(`https://${host}.ybx.app/`)));
    assert.ok(shelves(moved).every((url) => url.endsWith('&sort=title')));
    // Applying the order again after the host rewrite stays a no-op.
    assert.equal(ctx.rewrite(moved, 'title'), false);
  }
});

test('device.json is written only when an address actually moves', async () => {
  const first = sorter();
  assert.equal(await first.ctx.rewriteOnDisk('title'), true);
  assert.equal(first.writes.length, 1);
  assert.equal(first.writes[0][0], '/.crosspoint/plugins/ybx/device.json');
  const written = JSON.parse(Buffer.from(first.writes[0][1] instanceof Uint8Array
    ? first.writes[0][1] : new Uint8Array(), 'utf8').toString() || '{}');
  // The round trip above returns the shipped file, so a second pass writes nothing.
  const second = sorter();
  assert.equal(await second.ctx.rewriteOnDisk('default'), false);
  assert.equal(second.writes.length, 0);
  assert.equal(written.browse.url.includes('&sort=title'), true);
});

test('a stored choice is validated and an unreadable file means the old order', async () => {
  for (const [stored, expected] of [[{ mode: 'added' }, 'added'], [{ mode: 'title' }, 'title'],
    [{ mode: 'series' }, 'default'], [{ mode: 7 }, 'default'], [{ schema: 1 }, 'default'],
    [null, 'default'], [{}, 'default']]) {
    const { ctx } = sorter({ sort: stored });
    assert.equal(await ctx.readChoice(), expected);
  }
});

// The controls themselves: the section is built from the shipped page source.
const section = slice('  function buildSortSection() {', '\n  function renderSignedOut() {');

function panel({ sortChoice = 'default', rewriteResult = true, rewriteFails = false,
  saveFails = false } = {}) {
  const messages = [];
  const saves = [];
  let rewritten = [];
  const element = () => ({
    children: [], dataset: {}, textContent: '', type: '', disabled: false, className: '',
    append(...items) { this.children.push(...items); },
    appendChild(item) { this.children.push(item); },
    setAttribute(name, value) { this[name] = value; },
    classList: { toggle() {} },
  });
  const ctx = vm.createContext({
    document: { createElement: () => element() },
    SORT_CHOICE_LABELS: vm.runInNewContext(slice('  const SORT_CHOICE_LABELS =','  const saveSortChoice') + 'SORT_CHOICE_LABELS'),
    sortChoice,
    message: (text, kind) => messages.push([text, kind]),
    saveSortChoice: async (mode) => {
      if (saveFails) throw new Error('SD недоступна');
      saves.push(mode);
    },
    rewriteDeviceSortOnDisk: async (mode) => {
      if (rewriteFails) throw new Error('HTTP 500');
      rewritten.push(mode);
      return rewriteResult;
    },
    Error, Promise, Array,
  });
  vm.runInContext(section + '\nglobalThis.group = buildSortSection();', ctx);
  const buttons = ctx.group.children[2].children;
  return { ctx, buttons, messages, saves, rewritten: () => rewritten };
}

test('the page offers both orders and the untouched default as separate choices', () => {
  const w = panel();
  assert.deepEqual(w.buttons.map((b) => b.textContent),
    ['Как на полке OPDS', 'По названию', 'По дате добавления', 'По автору', 'По прогрессу']);
  assert.deepEqual(w.buttons.map((b) => b.dataset.sortMode), ['default', 'title', 'added', 'author', 'progress']);
  assert.equal(w.buttons[0]['aria-pressed'], 'true');
  assert.equal(w.buttons[1]['aria-pressed'], 'false');

});

test('choosing an order stores it and rewrites the reader addresses', async () => {
  const w = panel();
  await w.buttons[2].onclick();
  assert.deepEqual(w.saves, ['added']);
  assert.deepEqual(w.rewritten(), ['added']);
  assert.equal(w.ctx.sortChoice, 'added');
  assert.equal(w.buttons[2]['aria-pressed'], 'true');
  assert.equal(w.buttons[0]['aria-pressed'], 'false');
  assert.equal(w.messages.at(-1)[1], 'ok');
  assert.match(w.messages.at(-1)[0], /По дате добавления/);
  assert.match(w.messages.at(-1)[0], /Переоткройте Home → Plugins → YBX/);
  // The current choice is not rewritten again.
  await w.buttons[2].onclick();
  assert.deepEqual(w.saves, ['added']);
});

test('a choice that moved no address does not tell the reader to reopen', async () => {
  const w = panel({ sortChoice: 'title', rewriteResult: false });
  await w.buttons[2].onclick();
  assert.match(w.messages.at(-1)[0], /^Сортировка: По дате добавления\.$/);
});

test('a failed device write keeps the choice and defers it to the next page open', async () => {
  const w = panel({ rewriteFails: true });
  await w.buttons[1].onclick();
  assert.deepEqual(w.saves, ['title']);
  assert.equal(w.ctx.sortChoice, 'title');
  assert.equal(w.messages.at(-1)[1], 'ok');
  assert.match(w.messages.at(-1)[0], /Не удалось обновить device\.json/);
});

test('a failed preference store leaves the page and the catalog untouched', async () => {
  const w = panel({ saveFails: true });
  await w.buttons[1].onclick();
  assert.deepEqual(w.rewritten(), []);
  assert.equal(w.ctx.sortChoice, 'default');
  assert.equal(w.buttons[1]['aria-pressed'], 'false');
  assert.equal(w.buttons[1].disabled, false);
  assert.equal(w.messages.at(-1)[1], 'err');
});

test('the shipped payload still ships the plain default order', () => {
  assert.match(shipped.browse.url, /&sort=opds$/);
  assert.doesNotMatch(shipped.browse.search.url, /[?&]sort=/);
  for (const entry of shipped.browse.lists) {
    const expected = entry.id ? entry.id.slice(7) : 'opds';
    assert.equal(new URL(entry.url).searchParams.get('sort'), expected);
  }
});

test('the page wires the section and reconciles it on every open', () => {
  assert.match(source, /settings\.append\(buildServerSection\(\), buildSortSection\(\), kosyncGroup/);
  assert.match(source, /sortChoice = await readSortChoice\(\);/);
  assert.match(source, /await rewriteDeviceSortOnDisk\(sortChoice\);/);
});
