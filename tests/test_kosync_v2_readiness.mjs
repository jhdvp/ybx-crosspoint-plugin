import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('ybx.crosspoint-plugin/plugin.js', 'utf8');
const slice = (begin, end) => {
  const start = source.indexOf(begin), finish = source.indexOf(end, start);
  assert.ok(start >= 0 && finish > start, `missing browser runtime: ${begin}`);
  return source.slice(start, finish);
};
// Pull the actual shipped browser logic into a VM. No parallel reimplementation.
const classifier = slice('  const kosyncV2Readiness = (settings) => {', '\n  const fetchKosyncKey =');
const readSettings = slice('  const readSettings = async ({ required = false } = {}) => {', '\n  const writeSettings =');
const probe = slice('    const v2ProbeButton = document.createElement(\'button\');', '\n    // «Свой» is the firmware mode');
const wrap = (settings) => Object.entries(settings).map(([key, value]) =>
  typeof value === 'object' && value !== null && 'hasPassword' in value
    ? { key, value: value.value ?? null, hasPassword: value.hasPassword }
    : { key, value });
const availableHeaders = (values = {}) => ({
  koHeader1Name: '', koHeader1Value: { hasPassword: false },
  koHeader2Name: '', koHeader2Value: { hasPassword: false }, ...values,
});
const evaluate = (settings) => {
  const ctx = vm.createContext({});
  vm.runInContext(classifier + '\nglobalThis.inspect = kosyncV2Readiness;', ctx);
  return ctx.inspect(settings);
};

test('older stock settings keep legacy KoSync; no missing feature blocks operation', () => {
  const result = evaluate(wrap({ koServerUrl: 'http://sync.ybx.app/api/v1/crosspoint/kosync',
    koUsername: 'ybx', koPassword: null }));
  assert.match(result.label, /нет API заголовков/);
  assert.match(result.detail, /Legacy остаётся штатным/);
  assert.match(result.detail, /Плагин ничего не меняет/);
});

test('firmware with header slots but no V2 request is only API-capable', () => {
  const result = evaluate(wrap(availableHeaders()));
  assert.match(result.label, /поля доступны, V2 не найден/);
  assert.match(result.detail, /не задан/);
  assert.doesNotMatch(result.label, /активен|отправляет|подтверждён/);
});

test('masked V2 header value is never inferred or printed', () => {
  const result = evaluate(wrap(availableHeaders({
    koHeader2Name: ' X-YBX-KOSYNC-PROTOCOL ',
    koHeader2Value: { value: null, hasPassword: true },
  })));
  assert.match(result.label, /имя V2 найдено/);
  assert.match(result.detail, /значение скрыто|Значение скрыто/);
  assert.match(result.detail, /не подтверждён/);
  assert.doesNotMatch(JSON.stringify(result), /kosync_[A-Za-z0-9]+|cp_[A-Za-z0-9]+/);
});

test('empty V2 header slot is not treated as configured', () => {
  const result = evaluate(wrap(availableHeaders({
    koHeader1Name: 'X-YBX-Kosync-Protocol',
    koHeader1Value: { value: null, hasPassword: false },
  })));
  assert.match(result.label, /без значения/);
});

test('incomplete or failed firmware settings are never reported as V2 support', () => {
  assert.equal(evaluate([]).label, 'не проверено');
  assert.match(evaluate(wrap({ koHeader1Name: 'X-YBX-Kosync-Protocol' })).label,
    /нет API заголовков/);
  assert.match(evaluate(null).label, /не проверено/);
});

test('the refresh button only GETs firmware settings and never writes', async () => {
  const requests = [], messages = [];
  const latest = wrap(availableHeaders({
    koHeader1Name: 'X-YBX-Kosync-Protocol',
    koHeader1Value: { hasPassword: true, value: null },
  }));
  const context = vm.createContext({
    Error, Array, Map,
    fetch: async (path, options) => {
      requests.push({ path, options });
      return { ok: true, json: async () => latest };
    },
    document: { createElement: (tag) => ({ tagName: tag, disabled: false }) },
    v2Value: { textContent: '' },
    message: (...args) => messages.push(args),
  });
  vm.runInContext(readSettings + '\n' + classifier + '\n' + probe
    + '\nglobalThis.probe = v2ProbeButton;', context);
  await context.probe.onclick();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, '/api/settings');
  assert.equal(requests[0].options.cache, 'no-store');
  assert.equal(requests[0].options.method, undefined);
  assert.equal(context.v2Value.textContent, 'имя V2 найдено');
  assert.equal(context.probe.disabled, false);
  assert.match(messages.at(-1)[0], /факт отправки V2 не подтверждён/);
});

test('unavailable settings API leaves KoSync untouched and reports uncertainty', async () => {
  const requests = [], messages = [];
  const context = vm.createContext({
    Error, Array, Map,
    fetch: async (path, options) => {
      requests.push([path, options]);
      return { ok: false, status: 502 };
    },
    document: { createElement: () => ({ disabled: false }) },
    v2Value: { textContent: 'предыдущий статус' },
    message: (...args) => messages.push(args),
  });
  vm.runInContext(readSettings + '\n' + classifier + '\n' + probe
    + '\nglobalThis.probe = v2ProbeButton;', context);
  await context.probe.onclick();
  assert.deepEqual(requests.map(([path]) => path), ['/api/settings']);
  assert.equal(context.v2Value.textContent, 'не проверено');
  assert.equal(messages.at(-1)[1], 'err');
  assert.equal(context.probe.disabled, false);
});
