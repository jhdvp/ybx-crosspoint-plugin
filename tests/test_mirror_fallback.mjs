import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('ybx.crosspoint-plugin/plugin.js', 'utf8');
const helper = source.slice(source.indexOf('  const mirrorRequest ='),
  source.indexOf('  const UPDATE_URL ='));
function harness(api = {}) {
  let now = 1000;
  const ctx = vm.createContext({ api, URL, Map, Date: { now: () => now } });
  vm.runInContext(helper + '\nglobalThis.request = mirrorRequest; globalThis.wrapped = api;', ctx);
  return { request: ctx.request, api: ctx.wrapped, advance: () => { now += 300001; } };
}

test('all three host pairs preserve scheme, path, query and remember mirror until main probe', async () => {
  for (const [main, mirror] of [['my', 'emy'], ['opds', 'eopds'], ['sync', 'esync']]) {
    for (const scheme of ['http', 'https']) {
      const h = harness(), calls = [];
      let mainUp = false;
      const send = async (url) => {
        calls.push(url);
        return { status: url.includes(`//${main}.`) && !mainUp ? -1 : 200 };
      };
      const url = `${scheme}://${main}.ybx.app/kosync?x=a%2Fb`;
      await h.request('reader', url, send);
      assert.deepEqual(calls, [url, url.replace(`//${main}.`, `//${mirror}.`)]);
      calls.length = 0;
      await h.request('reader', url, send);
      assert.deepEqual(calls, [url.replace(`//${main}.`, `//${mirror}.`)]);
      h.advance(); mainUp = true; calls.length = 0;
      await h.request('reader', url, send);
      await h.request('reader', url, send);
      assert.deepEqual(calls, [url, url]);
    }
  }
});

test('every HTTP response, SD error and unclassified exception bypasses fallback', async () => {
  for (const result of [{status:401}, {status:429}, {status:500, error:'http status'},
    {status:200, error:'sd write failed'}, {status:503, error:'transport failure'}, {error:'sd write failed'}]) {
    let calls = 0;
    const h = harness();
    assert.equal(await h.request('reader', 'https://my.ybx.app/api', async () => {
      calls++; return result;
    }), result);
    assert.equal(calls, 1);
  }
  for (const error of [new SyntaxError('bad JSON'), new Error('cannot create file'),
    Object.assign(new Error('relay ambiguous failure'), { status: 502 })]) {
    let calls = 0;
    await assert.rejects(harness().request('reader', 'https://my.ybx.app/api', async () => {
      calls++; throw error;
    }), (actual) => actual === error);
    assert.equal(calls, 1);
  }
});

test('transport exceptions retry, all-down rejects, browser and reader preferences differ', async () => {
  const h = harness(), calls = [];
  const send = async (url) => {
    calls.push(url);
    if (url.includes('//my.')) throw new TypeError('Failed to fetch');
    return { status: 200 };
  };
  await h.request('browser', 'https://my.ybx.app/api', send);
  calls.length = 0;
  await h.request('reader', 'https://my.ybx.app/api', send);
  assert.equal(calls.length, 2);
  let count = 0;
  await assert.rejects(h.request('browser', 'https://my.ybx.app/api', async () => {
    count++; return { status: 0 };
  }));
  assert.equal(count, 3);
});

test('relay and SD wrappers preserve method, authorization, body and destination', async () => {
  const calls = [];
  const response = async (...args) => { calls.push(args); return { status: calls.length % 2 ? -1 : 200 }; };
  const h = harness({ relay: response, fetchToSd: response });
  const headers = { Authorization: 'Bearer fixture' };
  await h.api.relay('POST', 'https://my.ybx.app/api', headers, '{"x":1}');
  assert.deepEqual(calls, [
    ['POST', 'https://my.ybx.app/api', headers, '{"x":1}'],
    ['POST', 'https://emy.ybx.app/api', headers, '{"x":1}'],
  ]);
  calls.length = 0;
  await h.api.fetchToSd('http://sync.ybx.app/api', '/out', headers);
  assert.deepEqual(calls, [
    ['http://sync.ybx.app/api', '/out', headers],
    ['http://esync.ybx.app/api', '/out', headers],
  ]);
});

test('external hosts and credential-bearing URLs are never rewritten', async () => {
  for (const url of ['https://other.example/api', 'https://my.ybx.app.evil.example/api',
    'https://user:pass@my.ybx.app/api', 'https://my.ybx.app:8443/api']) {
    let calls = 0;
    await harness().request('browser', url, async (target) => {
      calls++; assert.equal(target, url); return { status: 0 };
    });
    assert.equal(calls, 1);
  }
});

test('relative and unparseable addresses bypass the wrapper and reach send unchanged', async () => {
  for (const address of ['/api/v1/crosspoint/kosync', 'my.ybx.app/api', '//my.ybx.app/api',
    'http://', '', null, undefined, 42, {}]) {
    let calls = 0;
    await harness().request('reader', address, async (target) => {
      calls++; assert.equal(target, address); return { status: 200 };
    });
    assert.equal(calls, 1);
  }
});

test('failed periodic main probe returns to mirror for another five minutes', async () => {
  const h = harness(), calls = [];
  const send = async (url) => {
    calls.push(url);
    return { status: url.includes('//my.') ? 0 : 200 };
  };
  const url = 'https://my.ybx.app/api';
  await h.request('browser', url, send);
  h.advance(); calls.length = 0;
  await h.request('browser', url, send);
  await h.request('browser', url, send);
  assert.deepEqual(calls, [url, 'https://emy.ybx.app/api', 'https://emy.ybx.app/api']);
});

test('Основной pins all three pairs to main hosts and never touches the mirror', async () => {
  for (const [main, mirror] of [['my', 'emy'], ['opds', 'eopds'], ['sync', 'esync']]) {
    for (const scheme of ['http', 'https']) {
      const url = `${scheme}://${main}.ybx.app/kosync?x=a%2Fb`;
      // A reachable main host is the only target, scheme and query preserved.
      const ok = harness(), hits = [];
      ok.request.choice('main');
      assert.deepEqual(
        await ok.request('reader', url, async (target) => { hits.push(target); return { status: 200 }; }),
        { status: 200 });
      assert.notEqual(url, url.replace(`//${main}.`, `//${mirror}.`));
      assert.deepEqual(hits, [url]);
      // A connection failure stays on the chosen host: no mirror probing.
      const down = harness(), attempted = [];
      down.request.choice('main');
      await assert.rejects(down.request('reader', url, async (target) => {
        attempted.push(target); return { status: 0 };
      }));
      assert.deepEqual(attempted, [url]);
      // Even an HTTP reply with a transport-failure error must not fall back:
      // only the mode itself decides whether the mirror is ever contacted.
      const httpError = harness(), third = [];
      httpError.request.choice('main');
      assert.deepEqual(
        await httpError.request('browser', url, async (target) => {
          third.push(target); return { status: 503, error: 'transport failure' };
        }),
        { status: 503, error: 'transport failure' });
      assert.deepEqual(third, [url]);
    }
  }
});

test('Европа pins all three pairs to mirror hosts without probing main', async () => {
  for (const [main, mirror] of [['my', 'emy'], ['opds', 'eopds'], ['sync', 'esync']]) {
    for (const scheme of ['http', 'https']) {
      const h = harness(), calls = [];
      h.request.choice('eu');
      const url = `${scheme}://${main}.ybx.app/kosync?x=a%2Fb`;
      const expected = `${scheme}://${mirror}.ybx.app/kosync?x=a%2Fb`;
      assert.deepEqual(
        await h.request('reader', url, async (target) => {
          calls.push(target);
          return { status: target === expected ? 200 : 0 };
        }),
        { status: 200 });
      assert.deepEqual(calls, [expected]);
    }
  }
  const down = harness(), attempts = [];
  down.request.choice('eu');
  await assert.rejects(down.request('browser', 'https://sync.ybx.app/api', async (target) => {
    attempts.push(target); throw new TypeError('Failed to fetch');
  }));
  assert.deepEqual(attempts, ['https://esync.ybx.app/api']);
});

test('the default is Авто, unknown values are ignored and switching clears remembered hosts', async () => {
  const h = harness(), calls = [];
  const send = async (url) => {
    calls.push(url);
    return { status: url.includes('//my.') ? -1 : 200 };
  };
  assert.equal(h.request.choice(), 'auto');
  assert.equal(h.request.choice('bogus'), 'auto');
  assert.equal(h.request.choice('main'), 'main');
  assert.equal(h.request.choice('eu'), 'eu');
  assert.equal(h.request.choice('auto'), 'auto');
  // Back on Авто the first attempt is the main host again even though Европа
  // would have answered: a mode switch wipes the remembered last-good host.
  const url = 'https://my.ybx.app/api';
  await h.request('browser', url, send);
  assert.deepEqual(calls, [url, 'https://emy.ybx.app/api']);
});

test('forced modes still pass through non-YBX, credential-bearing and unparseable addresses', async () => {
  for (const mode of ['main', 'eu', 'pt']) {
    for (const url of ['https://other.example/api', 'https://user:pass@my.ybx.app/api',
      'https://my.ybx.app:8443/api', '/api/v1/crosspoint/kosync']) {
      let calls = 0;
      const h = harness();
      h.request.choice(mode);
      await h.request('reader', url, async (target) => {
        calls++; assert.equal(target, url); return { status: 200 };
      });
      assert.equal(calls, 1);
    }
  }
});

test('the page offers «Сервер»: Авто / Основной / Европа / Португалия, persisted on the SD card', () => {
  assert.match(source,
    /const SERVER_PREFERENCE = DIR \+ '\/server-preference\.json';/);
  assert.match(source, /const SERVER_MODES = \['auto', 'main', 'eu', 'pt'\];/);
  assert.match(source,
    /\[\['auto', 'Авто'\], \['main', 'Основной'\], \['eu', 'Европа'\], \['pt', 'Португалия'\]\]/);
  assert.match(source, /title\.textContent = 'Сервер';/);
  // The control lives with the other setting groups and remains available
  // signed out, because a blocked origin breaks the first steps of pairing.
  assert.match(source,
    /settings\.append\(buildServerSection\(\), kosyncGroup, metadataGroup, clippingGroup\)/);
  assert.match(source, /settingsWrap\.appendChild\(buildServerSection\(\)\)/);
  // The saved choice is applied to the mirror wrapper before any other request.
  assert.match(source,
    /serverChoice = await readServerChoice\(\);\s*\n\s*mirrorRequest\.choice\(serverChoice\);/);
});

for (const [main, eu, pt] of [['my', 'emy', 'pmy'], ['opds', 'eopds', 'popds'], ['sync', 'esync', 'psync']]) {
  test(`PT manual and automatic routing for ${main}`, async () => {
    for (const scheme of ['http', 'https']) {
      for (const origin of [main, eu, pt]) {
        const h = harness(), calls = [];
        h.request.choice('pt');
        assert.equal(h.request.effectiveTarget(), 'pt');
        const url = `${scheme}://${origin}.ybx.app/api?x=a%2Fb`;
        await assert.rejects(h.request('reader', url, async (target) => {
          calls.push(target); return { status: 0 };
        }));
        assert.deepEqual(calls, [`${scheme}://${pt}.ybx.app/api?x=a%2Fb`]);
        calls.length = 0;
        assert.equal((await h.request('browser', url, async (target) => {
          calls.push(target); return { status: 503 };
        })).status, 503);
        assert.equal(calls.length, 1);
      }
      const h = harness(), calls = [];
      const url = `${scheme}://${main}.ybx.app/api?x=a%2Fb`;
      const send = async (target) => {
        calls.push(target);
        if (target.includes(`//${eu}.`)) throw new TypeError('Failed to fetch');
        return { status: target.includes(`//${main}.`) ? 0 : 200 };
      };
      await h.request('reader', url, send);
      assert.deepEqual(calls, [main, eu, pt].map(host => url.replace(`//${main}.`, `//${host}.`)));
      assert.equal(h.request.effectiveTarget(), 'pt');
      calls.length = 0;
      await h.request('reader', url, send);
      assert.deepEqual(calls, [url.replace(`//${main}.`, `//${pt}.`)]);
      h.advance(); calls.length = 0;
      await h.request('reader', url, send);
      assert.equal(calls[0], url);
      const http = harness(), replies = [];
      await http.request('reader', url, async (target) => {
        replies.push(target); return { status: target === url ? 0 : 503 };
      });
      assert.deepEqual(replies, [url, url.replace(`//${main}.`, `//${eu}.`)]);
    }
  });
}

test('device hosts round-trip between main, EU and PT without changing other bytes', () => {
  const start = source.indexOf('  const DEVICE_HOST_PAIRS =');
  const end = source.indexOf('  // Writes only when', start);
  const ctx = vm.createContext({ URL });
  vm.runInContext(source.slice(start, end) + '\nglobalThis.rewrite = rewriteDeviceHosts;', ctx);
  const hosts = { main: ['my', 'opds', 'sync'], eu: ['emy', 'eopds', 'esync'], pt: ['pmy', 'popds', 'psync'] };
  const original = { nested: { urls: hosts.main.map(host => `https://${host}.ybx.app:443/a%2Fb?x=1#z`) },
    external: 'https://example.com/a', relative: '/my.ybx.app/a', value: 42 };
  for (const from of Object.keys(hosts)) {
    for (const to of Object.keys(hosts)) {
      const device = JSON.parse(JSON.stringify(original));
      ctx.rewrite(device, from);
      assert.equal(ctx.rewrite(device, to), from !== to);
      assert.deepEqual(device.nested.urls, hosts[to].map(host => `https://${host}.ybx.app:443/a%2Fb?x=1#z`));
      assert.equal(ctx.rewrite(device, to), false);
      ctx.rewrite(device, 'main');
      assert.deepEqual(device, original);
    }
  }
});

test('saved PT choice and Portuguese KOSync hosts are recognized', async () => {
  const start = source.indexOf('  const SERVER_PREFERENCE =');
  const end = source.indexOf('  const pointsToYbx =', start);
  const ctx = vm.createContext({ URL, DIR: '/plugin',
    writeJson: async () => {}, readJson: async () => ({ mode: 'pt' }),
    settingValue: (settings, key) => settings.find(item => item.key === key)?.value });
  vm.runInContext(source.slice(start, end)
    + '\nglobalThis.readChoice = readServerChoice; globalThis.syncMode = syncMode;', ctx);
  assert.equal(await ctx.readChoice(), 'pt');
  const classify = (url) => ctx.syncMode([{ key: 'koServerUrl', value: url }]);
  for (const host of ['pmy', 'popds', 'psync']) {
    assert.equal(classify(`https://${host}.ybx.app/api/v1/crosspoint/kosync`), 'plugin');
    assert.equal(classify(`https://${host}.ybx.app/kosync`), 'account');
  }
  assert.equal(classify('http://psync.ybx.app/api/v1/crosspoint/kosync'), 'plugin');
  assert.equal(classify('http://popds.ybx.app/kosync'), 'account');
  assert.equal(classify('http://pmy.ybx.app/api/v1/crosspoint/kosync'), 'other');
  assert.equal(classify('https://pmy.ybx.app.evil.example/kosync'), 'other');
});

test('a new sleep handler follows the chosen server and mirrored handlers stay recognised', async () => {
  const start = source.indexOf('  const isOurSleepUrl =');
  const end = source.indexOf('  // Панели, для которых сервер рисует карточку');
  const pairs = source.indexOf('  const DEVICE_HOST_PAIRS =');
  const rewriteEnd = source.indexOf('  // Writes only when an address actually moves');
  const writeStart = source.indexOf('  async function writeSleepHandler');
  const writeEnd = source.indexOf('  // Включение: сначала сохраняем');
  const written = [];
  const ctx = vm.createContext({ URL, JSON, TextEncoder, btoa, String, Boolean, API: 'https://my.ybx.app',
    SLEEP_SLOT: '/sleep.bmp', SLEEP_DEVICE: '/device.json', handlerVersion: () => '1.6.17',
    mirrorRequest: { effectiveTarget: () => 'pt' },
    sleepBytes: (bytes) => bytes, api: { writeFile: async (path, bytes) => written.push([path, bytes]) } });
  vm.runInContext(source.slice(start, end) + source.slice(pairs, rewriteEnd) + source.slice(writeStart, writeEnd)
    + '\nglobalThis.write = writeSleepHandler; globalThis.ours = isOurSleepUrl;'
    + 'globalThis.target = sleepHostTarget; globalThis.rewrite = rewriteDeviceHosts;'
    + 'globalThis.handler = sleepDownloadHandler;', ctx);
  const device = { events: {} };
  await ctx.write(device, true);
  assert.match(device.events['sleep.enter'].download.url, /^https:\/\/pmy\.ybx\.app\/api\/v1\/crosspoint\/sleep-image\?/);
  assert.equal(written.length, 1);
  for (const host of ['my', 'emy', 'pmy']) {
    assert.equal(ctx.ours(`https://${host}.ybx.app/api/v1/crosspoint/sleep-image?w=1`), true);
  }
  assert.equal(ctx.ours('https://evil.example/api/v1/crosspoint/sleep-image?w=1'), false);
  assert.equal(ctx.ours('https://pmy.ybx.app/other'), false);
  // The in-page update keeps the handler on the host the reader already uses.
  for (const [host, expected] of [['my', 'main'], ['emy', 'eu'], ['pmy', 'pt']]) {
    assert.equal(ctx.target(`https://${host}.ybx.app/api/v1/crosspoint/sleep-image?w=1`), expected);
    const handler = { download: ctx.handler('1.6.17') };
    ctx.rewrite(handler, ctx.target(`https://${host}.ybx.app/x`));
    assert.match(handler.download.url, new RegExp(`^https://${host}\\.ybx\\.app/`));
  }
});
