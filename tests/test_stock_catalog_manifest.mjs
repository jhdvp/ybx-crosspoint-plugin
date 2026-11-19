import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file) => JSON.parse(readFileSync(`ybx.crosspoint-plugin/${file}`, 'utf8'));
const manifest = read('manifest.json');
const stock = read('device.json');
const browse = stock.browse;
const expected = [
  'Все книги', 'Читаю', 'Хочу прочитать', 'Прочитано', 'Загруженные',
  'Яндекс Книги', 'WB Книги', 'ЛитРес', 'Все книги · по названию', 'Все книги · по добавлению',
];

function requestUrl(template, page = 1) {
  return new URL(template.replaceAll('{page}', String(page))
    .replaceAll('{limit}', String(browse.page_size + 1))
    .replaceAll('{query}', encodeURIComponent('test')));
}

test('Stock 1.6.18 exposes shelves and both direct sort choices without Native lists_url', () => {
  assert.equal(manifest.version, '1.6.18');
  assert.equal(manifest.mount, 'settings');
  assert.deepEqual(manifest.compatibility.firmware_family, ['crosspoint']);
  assert.equal(manifest.compatibility.plugin_api_min, 1);
  assert.equal(stock.title, 'YBX');
  assert.equal(browse.format, 'json');
  assert.equal(browse.items, 'items');
  assert.equal(browse.lists_url, undefined);
  assert.deepEqual(browse.lists.map(({ title }) => title), expected);
  assert.equal(requestUrl(browse.lists[8].url).searchParams.get('sort'), 'title');
  assert.equal(requestUrl(browse.lists[9].url).searchParams.get('sort'), 'added');
  assert.equal(browse.page_size, 10);
});

test('Every Stock section paginates with the firmware lookahead, not Native folder fields', () => {
  for (const list of browse.lists) {
    const first = requestUrl(list.url, 1);
    const second = requestUrl(list.url, 2);
    assert.equal(first.protocol, 'https:', list.title);
    assert.equal(first.hostname, 'my.ybx.app', list.title);
    assert.ok(first.pathname.startsWith('/api/v1/crosspoint/'), list.title);
    assert.equal(first.searchParams.get('page'), '1', list.title);
    assert.equal(second.searchParams.get('page'), '2', list.title);
    // Official CrossPoint PluginCatalogActivity.cpp substitutes pageSize+1.
    // Older lookahead builds send limit=11; CrossPoint 2.0.0 sends limit=10.
    // 1.6.18 declares page_size=10 so the server steps by ten in both cases.
    assert.equal(first.searchParams.get('limit'), '11', list.title);
    assert.equal(second.searchParams.get('limit'), '11', list.title);
    assert.equal(first.searchParams.get('page_size'), '10', list.title);
    assert.equal(second.searchParams.get('page_size'), '10', list.title);
    assert.ok(list.url.includes('page_size=10'), list.title);
    assert.ok(list.url.includes('{limit}'), list.title);
    assert.equal(first.searchParams.get('v'), '1.6.18', list.title);
    assert.equal(list.folder_url, undefined, list.title);
  }
  assert.equal(browse.fields.title, 'title');
  assert.equal(browse.fields.author, 'author');
  assert.equal(browse.fields.id, 'id');
  assert.equal(browse.fields.url, 'download_url');
  assert.equal(browse.fields.folder_url, undefined);
});

test('Mixed all-books and provider catalogs use the proper Stock-compatible routes', () => {
  const urls = browse.lists.map((list) => requestUrl(list.url));
  assert.equal(urls[0].searchParams.get('kind'), 'all');
  assert.equal(urls[1].searchParams.get('kind'), 'reading');
  assert.equal(urls[2].searchParams.get('kind'), 'to_read');
  assert.equal(urls[3].searchParams.get('kind'), 'done');
  assert.equal(urls[4].searchParams.get('kind'), 'uploaded');
  assert.equal(urls[5].pathname, '/api/v1/crosspoint/catalog');
  assert.equal(urls[5].searchParams.get('shelf'), 'all');
  assert.equal(urls[6].pathname, '/api/v1/crosspoint/wb/catalog');
  assert.equal(urls[6].searchParams.get('stock'), '1');
  assert.equal(urls[7].pathname, '/api/v1/crosspoint/litres/catalog');
  assert.equal(urls[7].searchParams.get('stock'), '1');
  const search = requestUrl(browse.search.url);
  assert.equal(search.searchParams.get('q'), 'test');
  assert.equal(search.searchParams.get('kind'), 'all');
  assert.equal(search.searchParams.get('page_size'), '10');
  const primary = requestUrl(browse.url);
  assert.equal(primary.searchParams.get('page_size'), '10');
  assert.equal(primary.searchParams.get('kind'), 'reading');
  // Auth, events and EPUB download carry no pagination marker.
  assert.equal(new URL(stock.download.url).searchParams.get('page_size'), null);
  for (const event of Object.values(stock.events)) {
    assert.equal(new URL(event.request.url).searchParams.get('page_size'), null);
  }
});

test('Stock needs QR device-code auth; no Native-only capabilities or URLs', () => {
  assert.equal(stock.auth.type, 'device_code');
  assert.equal(stock.auth.request.method, 'POST');
  assert.equal(new URL(stock.auth.request.url).pathname, '/api/v1/crosspoint/auth/device');
  assert.equal(new URL(stock.auth.poll.url).pathname, '/api/v1/crosspoint/auth/token');
  assert.equal(stock.auth.code_path, 'user_code');
  assert.equal(stock.auth.verify_url_path, 'verification_uri_complete');
  assert.equal(stock.auth.token_path, 'access_token');
  assert.equal(browse.headers.Authorization, 'Bearer {token}');
  assert.equal(stock.download.dest_dir, '/books/ybx');
  assert.equal(stock.download.sidecar.path, '{dest}.meta.json');
  const meta = JSON.parse(stock.download.sidecar.body);
  assert.equal(meta.book_id, '{id}');
});
