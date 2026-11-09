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

test('transport exceptions retry once, both-down rejects, browser and reader preferences differ', async () => {
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
  assert.equal(count, 2);
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
