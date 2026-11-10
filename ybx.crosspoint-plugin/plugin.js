// YBX — веб-интерфейс SD-плагина CrossPoint.
//
// Плагин на устройстве (device.json) открывает каталог и вход по QR. Эта
// страница повторяет экран «Профиль» читалки YBX: сегодня/серия/неделя/год,
// полоса недели, «Продолжить чтение» и достижения. Здесь же — KOReader Sync,
// обновление плагина, выгрузка статистики для прошивки vCodex и отвязка,
// потому что с экрана ридера это недоступно.
CrossPoint.registerPlugin(async (container, api) => {
  'use strict';

  const DIR = api.dir || '/.crosspoint/plugins/ybx';
  // Firmware writes tokens only into an already existing directory.
  const TOKEN_PATH = DIR + '/token.json';
  const LEGACY_TOKEN_PATH = '/.crosspoint/plugin-data/ybx/token.json';
  const API = 'https://my.ybx.app';
  // Transport preferences are separate: phone HTTPS and reader TLS can have
  // different reachability. Only connection failures switch hosts; HTTP replies
  // (including 401/429/5xx) and response-body errors stay on the chosen host.
  const mirrorRequest = (() => {
    const pairs = { 'my.ybx.app': 'emy.ybx.app',
      'opds.ybx.app': 'eopds.ybx.app', 'sync.ybx.app': 'esync.ybx.app' };
    const preferences = new Map();
    const retryAfter = 5 * 60 * 1000;
    // Ручной выбор («Сервер: Авто / Основной / Европа») отключает зондирование:
    // Основной и Европа обращаются ровно к одному серверу и никогда не пробуют
    // второй — сбой соединения возвращается вызывающему, режим меняет человек.
    let mode = 'auto';
    const request = async (transport, address, send) => {
      let url;
      try {
        url = new URL(address);
      } catch {
        // A relative or malformed address cannot name a YBX host: pass it to
        // the device API unchanged, as it was before the wrapper existed.
        return send(address);
      }
      const main = Object.keys(pairs).find((host) =>
        url.hostname === host || url.hostname === pairs[host]);
      if (!main || url.username || url.password || url.port ||
          !['http:', 'https:'].includes(url.protocol)) return send(address);
      const key = transport + ':' + url.protocol + '//' + main;
      const now = Date.now();
      const previous = preferences.get(key);
      const first = previous && previous.host === pairs[main] && now < previous.retryAt
        ? pairs[main] : main;
      const attempt = async (host) => {
        const target = new URL(url.href);
        target.hostname = host;
        const result = await send(target.href);
        // Firmware reports connection failures as status 0 / missing status.
        // A real HTTP status takes precedence over its optional error message.
        if (!result || (result.status != null && Number(result.status) <= 0)
            || (result.status == null && result.error === 'transport failure')) {
          const error = new Error(result && result.error || 'YBX: нет ответа');
          error.network = true;
          throw error;
        }
        return result;
      };
    // Ручной выбор исключает второй сервер: попытка ровно одна.
    if (mode !== 'auto') return attempt(mode === 'eu' ? pairs[main] : main);
      try {
        const result = await attempt(first);
        preferences.set(key, { host: first,
          retryAt: first === main ? 0 : (previous?.retryAt > now ? previous.retryAt : now + retryAfter) });
        return result;
      } catch (error) {
        if (Number(error.status) >= 100 ||
            !(error.network === true || error.name === 'TypeError')) throw error;
        const second = first === main ? pairs[main] : main;
        // Also throttle main probes when both hosts are unavailable.
        preferences.set(key, { host: pairs[main], retryAt: now + retryAfter });
        const result = await attempt(second);
        preferences.set(key, { host: second, retryAt: second === main ? 0 : now + retryAfter });
        return result;
      }
    };
    // Страница применяет сохранённый на SD выбор после чтения файла: один
    // сеттер для обоих транспортов, режим сознательно не зависит от транспорта.
    request.choice = (next) => {
      if (!['auto', 'main', 'eu'].includes(next)) return mode;
      // Смена режима стирает память о последнем удачном хосте, чтобы Авто
      // снова начинало с основного сервера.
      mode = next;
      preferences.clear();
      return mode;
    };
    request.effectiveEurope = () => mode === 'eu'
      || (mode === 'auto' && Array.from(preferences.values())
        .some((entry) => entry && typeof entry.host === 'string'
          && ['emy.ybx.app', 'eopds.ybx.app', 'esync.ybx.app'].includes(entry.host)));
    return request;
  })();
  // Wrap only the remote transports; SD-file and reader-local fetches bypass it.
  const deviceApi = api;
  api = Object.create(deviceApi);
  if (typeof deviceApi.relay === 'function') {
    api.relay = (method, url, headers, body) => mirrorRequest('reader', url,
      (target) => deviceApi.relay(method, target, headers, body));
  }
  if (typeof deviceApi.fetchToSd === 'function') {
    api.fetchToSd = (url, path, headers) => mirrorRequest('reader', url,
      (target) => deviceApi.fetchToSd(target, path, headers));
  }
  const UPDATE_URL = 'https://ybx.app/crosspoint-plugin/latest.json';
  // Xteink's built-in KOSync client is the flakiest part of the TLS stack, so the
  // sync host answers over plain HTTP — for the narrow kosync_ key only, which
  // carries no catalogue, download or event scope. The old https address stays
  // recognized: readers configured by plugin 1.6.x keep reporting mode 'plugin'
  // until «Обновить ключ» moves them onto the sync host.
  const KOSYNC_URL = 'http://sync.ybx.app/api/v1/crosspoint/kosync';
  // The server answers with the clippings base of the host that served the
  // request: main normally, the EU mirror when the main one is unreachable.
  // Both bases front the same clipping store, so both are trusted; no other
  // address is. The reader's KOSync client bypasses the plugin's mirror
  // wrapper, so the base the server named is the one that must be saved.
  const CLIPPINGS_KOSYNC_URLS = ['https://my.ybx.app', 'https://emy.ybx.app']
    .map((host) => host + '/api/v1/crosspoint/kosync');
  const isClippingsUrl = (url) => CLIPPINGS_KOSYNC_URLS.includes(url);
  const KOSYNC_PREVIOUS = DIR + '/kosync-previous.json';
  // The cabinet and the installer page hand out the catalogue-hosted address
  // instead, and both routes answer for the same reader account.
  const YBX_SYNC_HOSTS = ['my.ybx.app', 'ybx.app', 'opds.ybx.app'];
  // Firmware vCodex импортирует статистику из фиксированного файла: сначала
  // кладём его туда, где его ищет страница импорта в данных плагина, затем —
  // в путь, который читает Settings → Apps → Reading Stats.
  const STATS_URL = API + '/api/v1/crosspoint/reading/vcodex';
  const STATS_FILE = '/.crosspoint/reading_stats.json';
  const STATS_IMPORT_FILE = '/exports/stats_exported';
  const SYNC_OFF = { koServerUrl: '', koUsername: '', koPassword: '', koSyncClippings: 0 };

  if (!document.getElementById('ybx-plugin-style')) {
    const style = document.createElement('style');
    style.id = 'ybx-plugin-style';
    style.textContent = `
      .ybx { --paper:var(--card-bg, transparent); --plate:var(--bg, transparent);
        --ink:var(--font-color, inherit); --soft:var(--muted-color, inherit);
        --line:var(--border-color, #aaa); --accent:var(--button-bg, #4a7a62);
        --ok:var(--success-color, #3d6652); --err:var(--danger-color, #b42318);
        width:100%; margin:0; padding:0; background:transparent;
        color:var(--ink); border:0; font-family:inherit;
        font-size:15px; line-height:1.5; -webkit-font-smoothing:antialiased; }
      .ybx * { box-sizing:border-box; }
      .ybx [hidden] { display:none !important; }
      .web-ui .ybx h1, .web-ui .ybx h2, .web-ui .ybx h3,
      .ybx h1, .ybx h2, .ybx h3 { color:var(--ink); }
      .ybx-head { display:flex; align-items:baseline; justify-content:space-between;
        gap:12px; margin:0 0 14px; }
      .ybx-word { font-family:inherit;
        font-weight:700; font-size:22px; letter-spacing:-.04em; margin:0; }
      .ybx-tag { font-family:inherit;
        font-size:10px; text-transform:uppercase; letter-spacing:.08em;
        color:var(--soft); border:1px solid var(--line); padding:3px 6px; }
      .ybx-status { margin:0 0 16px; padding:10px 12px; border:1px solid var(--line);
        background:var(--plate); font-size:14px; }
      .ybx-status.ok { border-color:var(--ok); }
      .ybx-status.err { border-color:var(--err); }
      .ybx-section { margin-top:20px; }
      .ybx-section:first-of-type { margin-top:0; }
      .ybx-h { display:flex; align-items:baseline; justify-content:space-between;
        gap:10px; margin:0 0 10px; }
      .ybx .ybx-h h2 { margin:0; font-family:inherit;
        font-size:12px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; }
      .ybx-h span { color:var(--soft); font-size:12px; }
      .ybx-metrics { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
      .ybx-metric { border:1px solid var(--line); background:var(--plate); padding:12px; border-radius:12px; min-width:0; }
      .ybx-metric b { display:block; font-family:inherit;
        font-size:clamp(20px,5vw,28px); line-height:1.2; letter-spacing:-.02em; font-variant-numeric:tabular-nums; white-space:nowrap; }
      .ybx-metric span { display:block; margin-top:4px; font-size:11px; text-transform:uppercase;
        letter-spacing:.06em; color:var(--soft); }
      .ybx-metric small { display:block; margin-top:6px; font-size:11px; color:var(--soft); }
      .ybx-goal { margin-top:8px; border:1px solid var(--line); background:var(--plate); padding:10px 12px; }
      .ybx-goal-line { display:flex; justify-content:space-between; gap:10px;
        font-size:12px; color:var(--soft); margin-bottom:6px; }
      .ybx-bar { height:4px; background:var(--line); overflow:hidden; }
      .ybx-bar i { display:block; height:100%; background:var(--ink); }
      .ybx-week { display:flex; align-items:flex-end; gap:6px; height:128px;
        padding:8px 10px; border:1px solid var(--line); background:var(--plate); }
      .ybx-day { flex:1; display:flex; flex-direction:column; align-items:center;
        justify-content:flex-end; gap:4px; height:100%; min-width:0; }
      .ybx-day i { display:block; flex-shrink:0; width:100%; max-width:36px; background:var(--accent); border-radius:4px 4px 0 0; }
      .ybx-day strong { font-size:11px; font-weight:500; color:var(--ink); font-variant-numeric:tabular-nums; }
      .ybx-day span { font-family:inherit;
        font-size:11px; color:var(--soft); }
      .ybx-list { display:grid; gap:6px; }
      .ybx-row { display:flex; align-items:center; justify-content:space-between;
        gap:12px; padding:10px 0; border-top:1px solid var(--line); }
      .ybx-row:first-child { border-top:0; }
      .ybx-label { font-family:inherit;
        font-size:11px; letter-spacing:.04em; text-transform:uppercase; color:var(--soft); }
      .ybx-value { font-size:14px; text-align:right; }
      .ybx-book { border:1px solid var(--line); background:transparent; padding:12px; border-radius:12px; }
      .ybx-book b { display:block; font-size:14px; }
      .ybx-book span { display:block; color:var(--soft); font-size:12px; }
      .ybx-book em { display:block; margin-top:6px; font-style:normal;
        font-family:inherit; font-size:11px; }
      .ybx-book.clickable { cursor:pointer; }
      .ybx-book.clickable:hover { background:var(--plate); }
      .ybx-book.clickable:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
      .ybx-book.clickable:active { outline:2px solid var(--ink); outline-offset:-2px; }
      .ybx-detail { border:1px solid var(--line); background:var(--plate); padding:14px; }
      .ybx-detail h3 { margin:0 0 2px; font-size:17px; }
      .ybx-detail .ybx-sub { margin:0 0 12px; color:var(--soft); font-size:13px; }
      .ybx-detail .ybx-row:first-child { border-top:0; }
      .ybx-back { margin:0 0 14px; }
      .ybx-heat { display:grid; grid-template-columns:repeat(7,1fr); gap:4px; }
      .ybx-heat-head { display:grid; grid-template-columns:repeat(7,1fr); gap:4px;
        margin-bottom:4px; }
      .ybx-heat-head span { font-family:inherit;
        font-size:10px; color:var(--soft); text-align:center; }
      .ybx-cell { aspect-ratio:1; border:1px solid var(--line); background:var(--paper); display:grid; place-items:center; border-radius:4px; font-size:11px; color:var(--ink); }
      .ybx-cell[data-level="1"] { background:var(--accent-color-10, #f0f5f3); }
      .ybx-cell[data-level="2"] { background:color-mix(in srgb, var(--accent) 35%, var(--paper)); }
      .ybx-cell[data-level="3"] { background:color-mix(in srgb, var(--accent) 65%, var(--paper)); }
      .ybx-cell[data-level="4"] { background:var(--accent); color:var(--button-text, #fff); }
      .ybx-cell.future { opacity:.22; }
      .ybx-cell.today { outline:2px solid var(--ink); outline-offset:-2px; }
      .ybx-ach { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:8px; }
      .ybx-card { border:1px solid var(--line); background:var(--plate); padding:10px;
        display:flex; flex-direction:column; gap:4px; min-width:0; }
      .ybx-card b { font-size:13px; line-height:1.25; overflow-wrap:anywhere; }
      .ybx-card span { font-size:11px; color:var(--soft); }
      .ybx-card .ybx-bar { margin-top:auto; }
      .ybx-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
      .ybx-setting-group { margin:16px 0 0; padding:14px; border:1px solid var(--line);
        border-radius:12px; background:var(--plate); min-width:0; }
      .ybx-setting-group h3 { margin:0 0 5px; font-size:15px; line-height:1.3; }
      .ybx-setting-group > .ybx-hint { margin:5px 0 12px; }
      .ybx-setting-group .ybx-row { gap:12px; }
      .ybx-setting-group .ybx-actions { margin-top:10px; }
      .ybx-setting-group .ybx-actions button { flex:1 1 180px; }
      .ybx-setting-group .ybx-row button { flex:none; min-width:105px; }
      .ybx-setting-group .ybx-value { overflow-wrap:anywhere; }
      .ybx-update { margin:12px 0 0; padding:10px 12px; border:1px solid var(--ink);
        background:var(--plate); font-size:13px; }
      .ybx-update strong { display:block; font-size:14px; }
      .ybx-update span { display:block; margin-top:4px; color:var(--soft); font-size:12px; }
      .ybx button, .ybx a.ybx-btn { appearance:none; min-height:44px; padding:10px 16px;
        border:1px solid var(--control-border, var(--line)); border-radius:8px; background:transparent; color:var(--ink);
        font:inherit; font-weight:600; cursor:pointer; text-decoration:none;
        display:inline-flex; align-items:center; justify-content:center; }
      .ybx button.primary { background:var(--accent); color:var(--button-text, #fff); border-color:transparent; }
      .ybx button:focus-visible, .ybx summary:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
      .ybx details { margin-top:12px; }
      .ybx summary { cursor:pointer; color:var(--soft); }
      .ybx button:disabled { opacity:.45; cursor:default; }
      .ybx-hint { margin:16px 0 0; padding-top:12px; border-top:1px solid var(--line);
        color:var(--soft); font-size:13px; }
      .ybx-ver { font-family:inherit;
        font-size:12px; color:var(--soft); }
    `;
    document.head.appendChild(style);
  }

  const root = document.createElement('section');
  root.className = 'ybx';
  container.appendChild(root);
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    root.appendChild(node);
    return node;
  };
  const section = (title, note) => {
    const wrap = el('section', 'ybx-section');
    const head = document.createElement('div');
    head.className = 'ybx-h';
    const h = document.createElement('h2');
    h.textContent = title;
    head.appendChild(h);
    if (note) {
      const span = document.createElement('span');
      span.textContent = note;
      head.appendChild(span);
    }
    wrap.appendChild(head);
    return wrap;
  };

  const head = document.createElement('header');
  head.className = 'ybx-head';
  head.innerHTML = '<h1 class="ybx-word">YBX</h1><span class="ybx-tag">CrossPoint</span>';
  root.appendChild(head);
  const status = el('p', 'ybx-status', 'Проверка состояния…');
  status.setAttribute('role', 'status');

  const profile = el('div');
  const settingsWrap = el('div');

  const message = (text, kind) => {
    status.textContent = text;
    status.className = 'ybx-status' + (kind ? ' ' + kind : '');
  };
  const b64 = (text) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));
  const readJson = async (path) => {
    try {
      const res = await fetch('/download?path=' + encodeURIComponent(path));
      return res.ok ? await res.json() : null;
    } catch { return null; }
  };
  const readPluginToken = async () => {
    const current = await readJson(TOKEN_PATH);
    // An explicit local logout must win over a stale legacy credential,
    // even if firmware no longer permits writes into the legacy directory.
    if (current?.disconnected === true) return null;
    if (current?.access_token) return current;
    const legacy = await readJson(LEGACY_TOKEN_PATH);
    return legacy?.access_token ? legacy : current;
  };
  const writeJson = (path, value) => api.writeFile(path, b64(JSON.stringify(value)));
  const readSettings = async ({ required = false } = {}) => {
    try {
      const res = await fetch('/api/settings', { cache: 'no-store' });
      if (!res.ok) throw new Error('settings HTTP ' + res.status);
      const settings = await res.json();
      if (!Array.isArray(settings)) throw new Error('некорректный ответ настроек');
      return settings;
    } catch (error) {
      // Rendering may fall back to "not configured"; a button that changes
      // the reader's settings must instead refuse to overwrite unknown state.
      if (required) throw error;
      return [];
    }
  };
  const writeSettings = async (value) => {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    });
    if (!res.ok) throw new Error('settings HTTP ' + res.status);
  };
  const settingValue = (settings, key) => settings.find((item) => item.key === key)?.value;
  // Ручной выбор сервера хранится на SD-карте так же, как предпочтение экрана
  // сна: один JSON-файл плагина, перечитываемый страницей при каждом открытии.
  // Режим не зависит от транспорта — он общий для запросов браузера и ридера,
  // в отличие от запомненного адреса в ключах transport:host.
  const SERVER_PREFERENCE = DIR + '/server-preference.json';
  const SERVER_MODES = ['auto', 'main', 'eu'];
  const SERVER_CHOICE_LABELS = [['auto', 'Авто'], ['main', 'Основной'], ['eu', 'Европа']];
  const saveServerChoice = (mode) => writeJson(SERVER_PREFERENCE, { mode, schema: 1 });
  const readServerChoice = async () => {
    const pref = await readJson(SERVER_PREFERENCE);
    return SERVER_MODES.includes(pref?.mode) ? pref.mode : 'auto';
  };
  // These endpoints belong to the same service but NOT the same auth scheme:
  // account KOSync uses an account/device key; the plugin endpoint uses the cp_
  // token or, since 1.6.10, the narrow kosync_ key written by the plugin itself.
  const syncMode = (settings) => {
    const address = settingValue(settings, 'koServerUrl');
    if (typeof address !== 'string' || !address) return 'other';
    try {
      const url = new URL(address);
      if (url.username || url.password || url.search || url.hash || url.port) return 'other';
      if (!['my.ybx.app', 'emy.ybx.app', 'ybx.app', 'opds.ybx.app', 'eopds.ybx.app', 'sync.ybx.app', 'esync.ybx.app'].includes(url.hostname)) {
        return 'other';
      }
      const path = url.pathname.replace(/\/+$/, '') || '/';
      if (path === '/api/v1/crosspoint/kosync'
          && (url.protocol === 'https:'
              || (['sync.ybx.app', 'esync.ybx.app'].includes(url.hostname) && url.protocol === 'http:'))) {
        return 'plugin';
      }
      // Caddy serves both schemes on OPDS/sync; primary/cabinet hosts
      // redirect HTTP, which old readers may not follow.
      const legacyHost = ['opds.ybx.app', 'eopds.ybx.app', 'sync.ybx.app', 'esync.ybx.app'].includes(url.hostname);
      if (path === '/kosync' &&
          (url.protocol === 'https:' || (legacyHost && url.protocol === 'http:'))) {
        return 'account';
      }
    } catch { /* malformed URL must not be classified as configured */ }
    return 'other';
  };
  const pointsToYbx = (settings) => syncMode(settings) === 'plugin';
  // Passive KoSync V2 capability check. The firmware owns outbound KOReader
  // requests, not the JS plugin. The presence of header-setting fields does
  // not prove the reader sends V2, and the value is intentionally masked in
  // GET /api/settings. Never automatically configure a V2 header: the server
  // can irreversibly raise a device's minimum protocol after authenticated V2.
  const kosyncV2Readiness = (settings) => {
    const caution = 'Это не проверка исходящего HTTP-запроса. '
      + 'После первого авторизованного V2 сервер может запретить Legacy PUT при откате прошивки. '
      + 'Плагин ничего не меняет.';
    if (!Array.isArray(settings) || settings.length === 0) {
      return { label: 'не проверено', detail: 'Настройки прошивки недоступны. ' + caution };
    }
    const byKey = new Map(settings.filter((entry) => entry && typeof entry.key === 'string')
      .map((entry) => [entry.key, entry]));
    const slots = [1, 2];
    const supported = slots.every((slot) =>
      byKey.has('koHeader' + slot + 'Name') && byKey.has('koHeader' + slot + 'Value'));
    if (!supported) {
      return { label: 'нет API заголовков', detail: 'В этой прошивке веб-API не показывает '
        + 'поля пользовательских заголовков KOSync. Legacy остаётся штатным режимом. ' + caution };
    }
    for (const slot of slots) {
      const name = byKey.get('koHeader' + slot + 'Name')?.value;
      if (typeof name !== 'string' || name.trim().toLowerCase() !== 'x-ybx-kosync-protocol') continue;
      const value = byKey.get('koHeader' + slot + 'Value');
      // Obfuscated value fields normally expose only hasPassword, NOT value.
      // Never display, persist, or infer the hidden value from the header name.
      if (value?.hasPassword === false && !value?.value) {
        return { label: 'заголовок без значения', detail: 'Имя заголовка V2 найдено, '
          + 'но его значение не задано. V2 не подтверждён. ' + caution };
      }
      return { label: 'имя V2 найдено', detail: 'Поле X-YBX-Kosync-Protocol найдено. '
        + 'Значение скрыто прошивкой, а факт отправки V2 не подтверждён. ' + caution };
    }
    return { label: 'поля доступны, V2 не найден', detail: 'Прошивка показывает '
      + 'настройки пользовательских HTTP-заголовков, но заголовок YBX V2 не задан. ' + caution };
  };
  const fetchKosyncKey = async () => {
    // The narrow kosync_ key: this account's progress GET/PUT and nothing else.
    // It is minted over TLS with the cp_ token before it is ever handed to the
    // firmware settings that may travel over plain HTTP. A reader whose TLS is
    // broken cannot reach this call either — and such a reader could not have
    // paired at all; setup it manually with a code from the cabinet instead.
    if (typeof api.relay !== 'function') {
      throw new Error('прошивка не поддерживает запросы плагина, настройте KOSync вручную');
    }
    const result = await api.relay('POST', API + '/api/v1/crosspoint/auth/kosync-key',
      { Authorization: 'Bearer ' + token.access_token }, '');
    if (!result || result.status !== 200) {
      throw new Error('сервер не выдал ключ синхронизации (HTTP '
        + (result && result.status || 'нет ответа') + ')');
    }
    let payload = null;
    try { payload = JSON.parse(result.body || ''); } catch { payload = null; }
    const key = payload && payload.kosync_key;
    if (typeof key !== 'string' || !key.startsWith('kosync_')) {
      throw new Error('сервер прислал некорректный ключ');
    }
    return key;
  };
  const verifyPluginSync = async (credential) => {
    // Firmware hides koPassword from GET /api/settings: validate the visible
    // fields and separately validate the issued credential with the real
    // endpoint. Neither establishes that the *stored* password works on the
    // reader; only the reader's next sync proves that.
    const stored = await readSettings({ required: true });
    if (!pointsToYbx(stored) || settingValue(stored, 'koUsername') !== 'ybx') {
      throw new Error('ридер не сохранил адрес или пользователя YBX');
    }
    // Verify against the address the reader actually saved, so a reader still
    // on the old https endpoint and one moved to the http sync host are both
    // checked honestly. syncMode has already rejected ports, credentials and
    // queries in that URL, so appending the auth path cannot aim elsewhere.
    const base = String(settingValue(stored, 'koServerUrl')).replace(/\/+$/, '');
    const result = await api.relay('GET', base + '/users/auth',
      { Authorization: 'Basic ' + btoa('ybx:' + (credential || token.access_token)) }, '');
    if (!result || result.status !== 200) {
      throw new Error('сервер не подтвердил ключ синхронизации (HTTP '
        + (result && result.status || 'нет ответа') + ')');
    }
  };
  const version = async () => {
    try {
      const res = await fetch(api.pluginFile('manifest.json'), { cache: 'no-store' });
      return (await res.json()).version || '';
    } catch { return ''; }
  };

  let token = null;
  // Выбор сервера перечитывается с SD-карты при каждом открытии страницы и
  // применяется к зеркальной обёртке до первых сетевых запросов профиля.
  let serverChoice = 'auto';
  // Второе нажатие «Выгрузить статистику» перезаписывает уже лежащий файл.
  let statsArmed = false;
  // Автопроверка релиза делается один раз за открытие страницы.
  let updateChecked = false;

  const downloadFailed = (result) =>
    !result || result.error || !result.status || result.status < 200 || result.status >= 300;

  // Same-origin листинг карты: нужен только чтобы не затирать файл молча.
  async function fileExists(dir, name) {
    // Never treat a failed SD listing as absence: doing so would bypass the
    // confirmation before overwriting a user's exported reading statistics.
    const res = await fetch('/api/files?path=' + encodeURIComponent(dir), { cache: 'no-store' });
    if (!res.ok) throw new Error('не удалось проверить файлы на SD (HTTP ' + res.status + ')');
    const entries = await res.json();
    if (!Array.isArray(entries) || entries.some((entry) =>
      !entry || typeof entry.name !== 'string' || typeof entry.isDirectory !== 'boolean')) {
      throw new Error('некорректный список файлов на SD');
    }
    // FAT can resolve upper-case and trailing-dot aliases to the same file.
    const fatName = (value) => value.replace(/^ +/, '').replace(/[. ]+$/, '').toLowerCase();
    return entries.some((entry) => !entry.isDirectory && fatName(entry.name) === fatName(name));
  }

  // Проверяем саму прошивку, а не только плагин: страница Import Statistics
  // есть лишь в форках (vCodex/CPR/Mimee), а сток перечисляет только catalog.*.
  let firmware = null;
  async function firmwareStatus() {
    if (firmware !== null) return firmware;
    try {
      const res = await fetch('/api/status', { cache: 'no-store' });
      const data = res.ok ? await res.json() : {};
      firmware = {
        version: data.version || '',
        family: data.firmwareFamily || '',
        capabilities: String(data.pluginCapabilities || '')
          .split(',').map((item) => item.trim()).filter(Boolean)
      };
    } catch {
      firmware = { version: '', family: '', capabilities: [] };
    }
    return firmware;
  }

  // Один и тот же файл кладём в оба места: прошивка vCodex сканирует только
  // `/.crosspoint/reading_stats.json`, а страница импорта CPR/Mimee-семейства
  // читает `/exports/stats_exported`.
  async function exportReadingStats() {
    const headers = { Authorization: 'Bearer ' + token.access_token };
    const results = [];
    for (const path of [STATS_FILE, STATS_IMPORT_FILE]) {
      let result = null;
      try {
        result = await api.fetchToSd(STATS_URL, path, headers);
      } catch (error) {
        result = { error: error.message };
      }
      results.push({ path, ok: !downloadFailed(result), detail: (result && (result.status || result.error)) || 'нет ответа' });
    }
    return results;
  }

  // The sleep card needs the panel size before the first sleep, but a browser
  // page is not open then: config.json ships with the installer and this page
  // corrects it from /api/status as soon as it runs.
  async function ensureDeviceConfig() {
    try {
      const status = await fetch('/api/status', { cache: 'no-store' }).then((res) => res.json());
      const isX3 = String(status && status.device || '').toUpperCase() === 'X3';
      const next = { sleep_width: isX3 ? '528' : '480', sleep_height: isX3 ? '792' : '800' };
      const current = await readJson(DIR + '/config.json');
      if (!current || current.sleep_width !== next.sleep_width || current.sleep_height !== next.sleep_height) {
        await writeJson(DIR + '/config.json', { ...(current || {}), ...next });
      }
    } catch (error) {
      // A config fallback already ships with the plugin; page access is not essential.
    }
  }

  // Web settings run in the PHONE/COMPUTER browser, not in the ESP32
  // network stack. Send reader profile requests to YBX over browser HTTPS.
  const relay = async (path, auth) => {
    const headers = { Authorization: 'Bearer ' + auth };
    const profilePath = path.startsWith('/api/v1/crosspoint/reading/summary')
      || path.startsWith('/api/v1/crosspoint/reading/calendar')
      || path.startsWith('/api/v1/crosspoint/achievements')
      || path.startsWith('/api/v1/crosspoint/reading/books/');
    if (profilePath) {
      let response;
      try {
        response = await mirrorRequest('browser', API + path, (target) => fetch(target, {
          method: 'GET', headers, mode: 'cors', cache: 'no-store',
          credentials: 'omit',
        }));
      } catch (cause) {
        const error = new Error('не удалось подключиться к YBX, проверьте интернет на телефоне');
        error.network = true;
        error.cause = cause;
        throw error;
      }
      if (!response.ok) {
        const error = new Error('HTTP ' + response.status);
        error.status = response.status;
        try { error.detail = (await response.json()).detail; } catch (ignored) {}
        throw error;
      }
      return response.json();
    }
    const res = await api.relay('GET', API + path, headers, '');
    if (!res || res.status < 200 || res.status >= 300) {
      const error = new Error('HTTP ' + (res && res.status));
      error.status = res && res.status;
      try { error.detail = JSON.parse(res.body).detail; } catch (ignored) {}
      throw error;
    }
    return JSON.parse(res.body);
  };
  const number = (metric) => (metric && typeof metric.value === 'number' ? metric.value : null);
  const mins = (value) => {
    if (value === null) return '—';
    if (value < 60) return value + ' мин';
    const hours = Math.floor(value / 60);
    const rest = value % 60;
    return hours + ' ч' + (rest ? ' ' + rest + ' м' : '');
  };
  const percent = (metric) => {
    const value = number(metric);
    return value === null ? '—' : Math.round(value) + '%';
  };
  const dayLabel = (iso) => {
    const names = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
    const d = new Date(iso + 'T12:00:00Z');
    return Number.isNaN(d.getTime()) ? '' : names[d.getUTCDay()];
  };

  function renderStats(summary, calendar) {
    const metrics = document.createElement('div');
    metrics.className = 'ybx-metrics';
    [
      ['Сегодня', mins(number(summary.today_minutes)), 'минут чтения'],
      ['Серия', summary.current_streak_days && summary.current_streak_days.value !== null
        ? summary.current_streak_days.value + ' дн' : '—', 'подряд'],
      ['За неделю', mins(number(summary.week_minutes)), 'активного времени'],
      ['В этом году', summary.books_finished_this_year && summary.books_finished_this_year.value !== null
        ? summary.books_finished_this_year.value : '—', 'книг дочитано'],
    ].forEach(([label, value, note]) => {
      const card = document.createElement('div');
      card.className = 'ybx-metric';
      const b = document.createElement('b'); b.textContent = value;
      const span = document.createElement('span'); span.textContent = label;
      const small = document.createElement('small'); small.textContent = note;
      card.append(b, span, small);
      metrics.appendChild(card);
    });
    profile.appendChild(metrics);

    if (summary.year_goal && typeof summary.year_goal.goal === 'number') {
      const goal = summary.year_goal;
      const done = Math.min(goal.finished || 0, goal.goal);
      const wrap = document.createElement('div');
      wrap.className = 'ybx-goal';
      const line = document.createElement('div');
      line.className = 'ybx-goal-line';
      const left = document.createElement('span');
      left.textContent = 'Цель года: ' + done + ' из ' + goal.goal + ' книг';
      const right = document.createElement('span');
      const books = (n) => n + ' ' + (n % 10 === 1 && n % 100 !== 11 ? 'книгу'
        : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'книги' : 'книг');
      right.textContent = goal.delta > 0 ? 'опережаете на ' + books(goal.delta)
        : goal.delta < 0 ? 'отстаёте на ' + books(-goal.delta) : 'идёте по графику';
      line.append(left, right);
      const bar = document.createElement('div');
      bar.className = 'ybx-bar';
      const fill = document.createElement('i');
      fill.style.width = Math.max(0, Math.min(100, goal.goal ? (done / goal.goal) * 100 : 0)) + '%';
      bar.appendChild(fill);
      wrap.append(line, bar);
      profile.appendChild(wrap);
    }

    // Summary carries the full current week, including days in the previous
    // month. The public calendar deliberately omits provenance (sources).
    const days = Array.isArray(calendar && calendar.days) ? calendar.days : [];
    const byDate = new Map(days.map((day) => [day.date, day]));
    const observedWeek = Array.isArray(summary.week_days) ? summary.week_days : [];
    observedWeek.forEach((day) => byDate.set(day.date, day));
    const todayIso = summary.today || new Date().toISOString().slice(0, 10);
    const today = new Date(todayIso + 'T12:00:00Z');
    const mondayOffset = (today.getUTCDay() + 6) % 7;
    const week = [];
    for (let index = 0; index < 7; index += 1) {
      const d = new Date(today.getTime() + (index - mondayOffset) * 86400000);
      const iso = d.toISOString().slice(0, 10);
      const day = byDate.get(iso);
      const known = iso <= todayIso && day && typeof day.minutes === 'number'
        && Number.isFinite(day.minutes) && (!Array.isArray(day.sources) || day.sources.length > 0);
      week.push({ iso, minutes: known ? Math.max(0, day.minutes) : null });
    }
    const max = Math.max(1, ...week.map((day) => day.minutes));
    const weekWrap = document.createElement('div');
    weekWrap.className = 'ybx-week';
    week.forEach((day) => {
      const column = document.createElement('div');
      column.className = 'ybx-day';
      const bar = document.createElement('i');
      bar.style.height = (day.minutes === null ? 0 : Math.max(2, Math.round((day.minutes / max) * 72))) + 'px';
      bar.style.opacity = day.minutes ? '1' : '.25';
      const label = document.createElement('span');
      label.textContent = dayLabel(day.iso);
      const value = document.createElement('strong');
      value.textContent = day.minutes === null ? '—' : String(day.minutes);
      column.title = day.iso + (day.minutes === null ? ' · нет данных' : ' · ' + day.minutes + ' мин');
      column.append(value, bar, label);
      weekWrap.appendChild(column);
    });
    const weekSection = section('Неделя', 'минуты по дням');
    weekSection.appendChild(weekWrap);
    profile.appendChild(weekSection);

    const calendarDays = Array.isArray(calendar && calendar.days) ? calendar.days : [];
    if (calendarDays.length) {
      const todayLabel = summary.today || '';
      let monthTitle = '';
      try {
        monthTitle = new Date(todayLabel + 'T12:00:00').toLocaleDateString('ru-RU', { month: 'long' });
      } catch { monthTitle = ''; }
      const heatSection = section('Календарь', monthTitle);
      const head = document.createElement('div');
      head.className = 'ybx-heat-head';
      ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'].forEach((label) => {
        const cell = document.createElement('span');
        cell.textContent = label;
        head.appendChild(cell);
      });
      const grid = document.createElement('div');
      grid.className = 'ybx-heat';
      const first = calendarDays[0] ? new Date(calendarDays[0].date + 'T12:00:00') : null;
      if (first) {
        const offset = (first.getDay() + 6) % 7;
        for (let index = 0; index < offset; index += 1) {
          const blank = document.createElement('div');
          blank.className = 'ybx-cell';
          blank.style.visibility = 'hidden';
          grid.appendChild(blank);
        }
      }
      calendarDays.forEach((day) => {
        const cell = document.createElement('div');
        cell.className = 'ybx-cell';
        cell.textContent = String(Number(day.date.slice(-2)));
        cell.dataset.level = String(Math.max(0, Math.min(4, Number(day.level) || 0)));
        if (day.future) cell.classList.add('future');
        if (day.date === todayLabel) cell.classList.add('today');
        cell.title = day.date + (typeof day.minutes === 'number' ? ' · ' + day.minutes + ' мин' : '');
        grid.appendChild(cell);
      });
      heatSection.append(head, grid);
      profile.appendChild(heatSection);
    }

    const books = Array.isArray(summary.currently_reading) ? summary.currently_reading : [];
    const booksSection = section('Продолжить чтение', books.length ? books.length + ' книг' : '');
    if (!books.length) {
      const note = document.createElement('p');
      note.className = 'ybx-hint';
      note.style.marginTop = '0';
      note.textContent = 'Начните читать книгу из каталога YBX на ридере.';
      booksSection.appendChild(note);
    } else {
      const list = document.createElement('div');
      list.className = 'ybx-list';
      books.slice(0, 4).forEach((book) => {
        const card = document.createElement('div');
        card.className = 'ybx-book';
        const b = document.createElement('b'); b.textContent = book.title || 'Без названия';
        const author = document.createElement('span'); author.textContent = book.author || '';
        const em = document.createElement('em');
        em.textContent = 'Прочитано ' + percent(book.percent);
        card.append(b, author, em);
        if (book.id && token) {
          card.classList.add('clickable');
          card.setAttribute('role', 'button');
          card.tabIndex = 0;
          const open = () => showBookCard(book.id);
          card.onclick = open;
          card.onkeydown = (event) => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
          };
        }
        list.appendChild(card);
      });
      booksSection.appendChild(list);
    }
    profile.appendChild(booksSection);
  }

  function renderAchievements(data) {
    const received = (data.yandex && data.yandex.received) || [];
    const pending = (data.yandex && data.yandex.pending) || [];
    const wrap = section('Достижения', received.length ? received.length + ' получено' : '');
    if (!received.length && !pending.length) {
      const note = document.createElement('p');
      note.className = 'ybx-hint';
      note.style.marginTop = '0';
      note.textContent = 'Награды появятся после синхронизации с Яндекс Книгами.';
      wrap.appendChild(note);
      profile.appendChild(wrap);
      return;
    }
    if (received.length) {
      const grid = document.createElement('div');
      grid.className = 'ybx-ach';
      received.slice(0, 6).forEach((item) => {
        const card = document.createElement('div');
        card.className = 'ybx-card';
        const b = document.createElement('b'); b.textContent = item.title || 'Награда';
        const span = document.createElement('span'); span.textContent = item.description || 'получено';
        card.append(b, span);
        grid.appendChild(card);
      });
      wrap.appendChild(grid);
    }
    if (pending.length) {
      const sub = document.createElement('div');
      sub.className = 'ybx-h';
      sub.style.marginTop = '12px';
      const h = document.createElement('h2'); h.textContent = 'Ближе всего';
      sub.appendChild(h);
      wrap.appendChild(sub);
      const grid = document.createElement('div');
      grid.className = 'ybx-ach';
      pending.slice(0, 4).forEach((item) => {
        const value = typeof item.progress === 'number' ? Math.round(item.progress * 100) : null;
        const card = document.createElement('div');
        card.className = 'ybx-card';
        const b = document.createElement('b'); b.textContent = item.title || 'Награда';
        const span = document.createElement('span'); span.textContent = item.description || '';
        const bar = document.createElement('div'); bar.className = 'ybx-bar';
        const fill = document.createElement('i');
        fill.style.width = (value === null ? 0 : Math.max(0, Math.min(100, value))) + '%';
        bar.appendChild(fill);
        card.append(b, span, bar);
        grid.appendChild(card);
      });
      wrap.appendChild(grid);
    }
    profile.appendChild(wrap);
  }

  function renderProfile(summary, calendar, achievements) {
    lastProfile = { summary, calendar, achievements };
    profile.replaceChildren();
    renderStats(summary, calendar);
    renderAchievements(achievements);
  }

  // The profile data the book card returns to, so «назад» re-renders without a reload.
  let lastProfile = null;

  const dateText = (stamp) => {
    if (stamp === null || stamp === undefined) return null;
    const d = new Date(Number(stamp) * 1000);
    return Number.isNaN(d.getTime()) ? null
      : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  };
  const sourcesOf = (detail) => {
    const set = new Set();
    [detail.percent, detail.minutes, detail.sessions].forEach((metric) => {
      (metric && metric.sources || []).forEach((source) => set.add(source));
    });
    if (detail.dates_source) set.add(detail.dates_source);
    return [...set].map((source) => (source === 'ybx_reader' ? 'YBX-ридер' : source)).join(' · ');
  };

  function renderBookCard(detail) {
    profile.replaceChildren();
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'ybx-back';
    back.textContent = '← Назад';
    back.onclick = () => {
      if (lastProfile) {
        renderProfile(lastProfile.summary, lastProfile.calendar, lastProfile.achievements);
      } else {
        refresh();
      }
    };
    profile.appendChild(back);

    const wrap = section('Книга');
    const card = document.createElement('div');
    card.className = 'ybx-detail';
    const title = document.createElement('h3');
    title.textContent = detail.title || 'Без названия';
    const author = document.createElement('p');
    author.className = 'ybx-sub';
    author.textContent = detail.author || '';
    card.append(title, author);

    const rows = document.createElement('div');
    rows.className = 'ybx-list';
    const row = (label, value) => {
      const line = document.createElement('div');
      line.className = 'ybx-row';
      const left = document.createElement('span');
      left.className = 'ybx-label';
      left.textContent = label;
      const right = document.createElement('span');
      right.className = 'ybx-value';
      right.textContent = value;
      line.append(left, right);
      rows.appendChild(line);
    };
    row('Прочитано', percent(detail.percent));
    row('Активные минуты', mins(number(detail.minutes)));
    row('Сессии', number(detail.sessions) === null ? '—' : String(number(detail.sessions)));
    const started = dateText(detail.started_at);
    if (started) row('Начало', started);
    const finished = dateText(detail.finished_at);
    if (finished) row('Окончание', finished);
    const source = sourcesOf(detail);
    if (source) row('Источник', source);
    card.appendChild(rows);
    wrap.appendChild(card);
    profile.appendChild(wrap);
  }

  async function showBookCard(bookId) {
    if (!token) return;
    profile.replaceChildren();
    const note = document.createElement('p');
    note.className = 'ybx-hint';
    note.style.marginTop = '0';
    note.textContent = 'Загружаем книгу…';
    profile.appendChild(note);
    try {
      const detail = await relay(
        '/api/v1/crosspoint/reading/books/' + encodeURIComponent(bookId), token.access_token);
      renderBookCard(detail);
    } catch (error) {
      if (lastProfile) {
        renderProfile(lastProfile.summary, lastProfile.calendar, lastProfile.achievements);
      } else {
        refresh();
      }
      message('Не удалось загрузить книгу: ' + error.message, 'err');
    }
  }

  // ── Экран сна: слот, который прошивка ставит выше собственных обоев ──────
  // Карточка лежит в /sleep.bmp, а приоритет у этого файла выше каталогов
  // /.sleep, поэтому YBX имеет право трогать только ту картинку, которую сам
  // туда положил. Пока переключатель выключен, обработчик sleep.enter — request:
  // прошивка ничего не скачивает и слот остаётся нетронутым.
  const SLEEP_SLOT = '/sleep.bmp';
  const SLEEP_BACKUP = DIR + '/sleep-original.bmp';
  const SLEEP_LEGACY_BACKUP = DIR + '/sleep-legacy.bmp';
  // Stable across updates: never included in the release archive.
  const SLEEP_PREFERENCE = DIR + '/sleep-preference.json';
  const SLEEP_DEVICE = DIR + '/device.json';
  const SLEEP_BACKUP_LIMIT = 256 * 1024;
  const CARD_MODE = 2;         // CrossPointSettings::SLEEP_SCREEN_MODE::CUSTOM
  const COVER_MODE = 3;        // CrossPointSettings::SLEEP_SCREEN_MODE::COVER
  const COVER_CUSTOM_MODE = 4; // ...::COVER_CUSTOM — the card when sleep is not from a book
  // Версию в адресах берём из device.json ридера: сборка 1.7.0 подставляет свою.
  const handlerVersion = (device) => (String(device?.download?.url || '').match(/[?&]v=([^&]+)/) || [])[1] || '1.6.16';
  const sleepDownloadHandler = (v) => ({
    url: API + '/api/v1/crosspoint/sleep-image?w={cfg.sleep_width}&h={cfg.sleep_height}&v=' + v,
    headers: { Authorization: 'Bearer {token}' },
    dest: SLEEP_SLOT,
  });
  // Панели, для которых сервер рисует карточку: 1-bit BMP ровно этого размера
  // и есть метка «это написал YBX». Любой другой файл в слоте — чужой.
  const SLEEP_PANELS = [[480, 800], [528, 792]];

  const sleepBytes = (bytes) => {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    return btoa(binary);
  };
  // The server writes «YBX1» into the BMP header's reserved words: only a file
  // carrying that mark is ours. A same-size wallpaper without it — including a
  // card from a version before 1.6.10 — is never removed automatically; the
  // unmarked shape (zero reserved words) only offers the manual cleanup below.
  const looksLikeSleepCard = (bytes, width, height, marked = true) => {
    if (!bytes || bytes.length < 62 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) return false;
    const mark = marked ? [0x59, 0x42, 0x58, 0x31] : [0, 0, 0, 0];
    if (mark.some((byte, i) => bytes[6 + i] !== byte)) return false;
    const dword = (at) => (bytes[at] | bytes[at + 1] << 8 | bytes[at + 2] << 16 | bytes[at + 3] << 24);
    return dword(2) === bytes.length && dword(10) === 62 && dword(28) === 1
      && Math.abs(dword(18)) === width && Math.abs(dword(22)) === height
      && bytes.length === 62 + Math.ceil(width / 32) * 4 * height;
  };
  const ownsSleepSlot = (bytes) => SLEEP_PANELS
    .some(([width, height]) => looksLikeSleepCard(bytes, width, height));
  const legacySleepCard = (bytes) => SLEEP_PANELS
    .some(([width, height]) => looksLikeSleepCard(bytes, width, height, false));

  async function readSleepFile(path) {
    const res = await fetch('/download?path=' + encodeURIComponent(path), { cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('не удалось прочитать ' + path + ' (HTTP ' + res.status + ')');
    const bytes = new Uint8Array(await res.arrayBuffer());
    return bytes.length ? bytes : null;
  }

  // device.json — рабочий файл прошивки: отсутствующий или непонятный файл
  // нельзя восстанавливать «с нуля», иначе ридер потеряет каталог и вход.
  async function readSleepDevice() {
    const device = await readJson(SLEEP_DEVICE);
    const hasLists = (Array.isArray(device?.browse?.lists) && device.browse.lists.length > 0)
      || Boolean(device?.browse?.lists_url);
    if (!device || !hasLists || device.auth?.type !== 'device_code' || typeof device.events !== 'object') {
      throw new Error('не удалось прочитать device.json ридера');
    }
    return device;
  }
  // ── Зеркало сервера в device.json ───────────────────────────────────────
  // Прошивка читает каталог, поиск, книги, QR-вход, события и адрес экрана
  // сна прямо из статического device.json. Выбор «Сервер» должен двигать и
  // эти адреса, иначе читатель остаётся на основном сервере. Меняем только
  // три известные пары хостов, сохраняя схему и остальные поля.
  const DEVICE_HOST_PAIRS = [
    ['my.ybx.app', 'emy.ybx.app'],
    ['opds.ybx.app', 'eopds.ybx.app'],
    ['sync.ybx.app', 'esync.ybx.app'],
  ];
  function rewriteDeviceHosts(device, europe) {
    const toEurope = Boolean(europe);
    let changed = false;
    const walk = (value) => {
      if (typeof value === 'string') {
        let parsedUrl = null;
        try { parsedUrl = new URL(value); } catch { parsedUrl = null; }
        if (!parsedUrl || (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:')) return value;
        const pair = DEVICE_HOST_PAIRS.find(([main, mirror]) =>
          parsedUrl.hostname === main || parsedUrl.hostname === mirror);
        if (!pair) return value;
        const [main, mirror] = pair;
        const target = toEurope ? mirror : main;
        if (parsedUrl.hostname === target) return value;
        const host = parsedUrl.hostname;
        const index = value.indexOf(host);
        if (index === -1) return value;
        changed = true;
        return value.slice(0, index) + target + value.slice(index + host.length);
      }
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i += 1) value[i] = walk(value[i]);
        return value;
      }
      if (value && typeof value === 'object') {
        for (const key of Object.keys(value)) value[key] = walk(value[key]);
        return value;
      }
      return value;
    };
    if (device && typeof device === 'object') walk(device);
    return changed;
  }
  // Writes only when an address actually moves: no flash wear on page open.
  async function rewriteDeviceHostsOnDisk(europe) {
    const device = await readSleepDevice();
    if (!rewriteDeviceHosts(device, europe)) return false;
    await api.writeFile(SLEEP_DEVICE, sleepBytes(new TextEncoder().encode(
      JSON.stringify(device, null, 2) + '\n')));
    return true;
  }
  const sleepHandlerOn = (device) => Boolean(device?.events?.['sleep.enter']?.download);
  async function saveSleepPreference(enabled) {
    await api.writeFile(SLEEP_PREFERENCE, sleepBytes(new TextEncoder().encode(
      JSON.stringify({ enabled, schema: 1 }) + '\n')));
  }
  async function readSleepPreference() {
    const pref = await readJson(SLEEP_PREFERENCE);
    return typeof pref?.enabled === 'boolean' ? pref.enabled : null;
  }
  async function writeSleepHandler(device, enabled) {
    const v = handlerVersion(device);
    // Off means no sleep.enter handler at all: no network work before sleep.
    if (enabled) device.events['sleep.enter'] = { download: sleepDownloadHandler(v) };
    else delete device.events['sleep.enter'];
    await api.writeFile(SLEEP_DEVICE, sleepBytes(new TextEncoder().encode(
      JSON.stringify(device, null, 2) + '\n')));
  }
  // Включение: сначала сохраняем чужую картинку, потом просим сервер рисовать,
  // и только затем отдаём прошивке скачивать карточку в слот.
  async function installSleepCard(device) {
    const slot = await readSleepFile(SLEEP_SLOT);
    if (slot && !ownsSleepSlot(slot)) {
      if (slot.length > SLEEP_BACKUP_LIMIT) {
        throw new Error('текущая картинка экрана сна больше 256 КБ, смените её в настройках ридера');
      }
      await api.writeFile(SLEEP_BACKUP, sleepBytes(slot));
    }
    await writeSleepHandler(device, true);
  }

  // Выключение: снимаем обработчик, затем возвращаем слот. Трогаем слот только
  // если в нём по-прежнему наша карточка: пользователь мог положить туда своё.
  async function removeSleepCard(device) {
    await writeSleepHandler(device, false);
    const slot = await readSleepFile(SLEEP_SLOT);
    if (!slot || !ownsSleepSlot(slot)) return 'kept';
    const backup = await readSleepFile(SLEEP_BACKUP);
    if (backup) {
      await api.writeFile(SLEEP_SLOT, sleepBytes(backup));
      return 'restored';
    }
    // Своей картинки до YBX не было: убираем свой же файл, чтобы ридер вернулся
    // к обоям из /.sleep. Чужой файл не удаляем — см. проверку выше.
    await clearSleepSlot();
    return 'cleared';
  }

  async function clearSleepSlot() {
    const removed = await fetch('/delete', {
      method: 'POST',
      body: new URLSearchParams({ path: SLEEP_SLOT }),
    });
    if (!removed.ok) {
      throw new Error('не удалось убрать экран сна (HTTP ' + removed.status + ')');
    }
  }

  // Карточки до 1.6.10 без метки: только по кнопке, с подтверждением и копией.
  const legacyInSlot = async () => {
    try { return legacySleepCard(await readSleepFile(SLEEP_SLOT)); } catch { return false; }
  };
  async function clearLegacySleepCard() {
    if (sleepHandlerOn(await readSleepDevice())) return false;
    const slot = await readSleepFile(SLEEP_SLOT);
    if (!slot || !legacySleepCard(slot)) return false;
    // Never overwrite a previous backup with different bytes. If cleanup was
    // interrupted after backing up, the same image can safely be retried.
    const backup = await readSleepFile(SLEEP_LEGACY_BACKUP);
    if (backup) {
      const identical = backup.length === slot.length
        && backup.every((byte, index) => byte === slot[index]);
      if (!identical) {
        throw new Error('резервная копия экрана сна уже существует, сохраните её перед очисткой');
      }
    } else {
      await api.writeFile(SLEEP_LEGACY_BACKUP, sleepBytes(slot));
    }
    await clearSleepSlot();
    return true;
  }

  async function setSleepCard(enabled, sleepMode) {
    const device = await readSleepDevice();
    if (enabled) {
      await installSleepCard(device);
      if (sleepMode !== CARD_MODE) await writeSettings({ sleepScreen: CARD_MODE });
      await saveSleepPreference(true);
      return 'on';
    }
    const outcome = await removeSleepCard(device);
    // Прежний режим трогаем только если он показывал карточку: «Тёмный»,
    // «Светлый» и выбор пользователя оставляем как есть.
    if (sleepMode === CARD_MODE || sleepMode === COVER_CUSTOM_MODE) {
      await writeSettings({ sleepScreen: COVER_MODE });
    }
    await saveSleepPreference(false);
    return outcome;
  }

  // Update tools replace the bundled device.json. Restore only an explicitly
  // enabled YBX card while firmware still selects its Custom sleep screen.
  // Migration from 1.6.10/11 also uses a marked card already in /sleep.bmp.
  // Never infer opt-in from an unmarked user image.
  async function reconcileSleepCard(sleepMode) {
    if (!token) return null;
    const device = await readSleepDevice();
    const pref = await readSleepPreference();
    if (sleepHandlerOn(device)) {
      if (pref !== true) await saveSleepPreference(true);
      return true;
    }
    // A failed /api/settings read yields NaN. Do not mistake that for an
    // explicit user opt-out or destroy a persisted preference.
    if (!Number.isInteger(sleepMode)) return false;
    const slot = await readSleepFile(SLEEP_SLOT);
    if (sleepMode === CARD_MODE &&
        (pref === true || (pref === null && slot && ownsSleepSlot(slot)))) {
      await installSleepCard(device);
      await saveSleepPreference(true);
      return true;
    }
    if (slot && ownsSleepSlot(slot)) await removeSleepCard(device);
    if (pref === true) await saveSleepPreference(false);
    return false;
  }

  async function refreshSleepCard() {
    if (!token) throw new Error('сначала войдите в YBX');
    const config = await readJson(DIR + '/config.json') || {};
    const width = config.sleep_width || '480';
    const height = config.sleep_height || '800';
    await api.fetchToSd(
      API + '/api/v1/crosspoint/sleep-image?w=' + encodeURIComponent(width) + '&h=' + encodeURIComponent(height),
      '/sleep.bmp',
      { Authorization: 'Bearer ' + token.access_token },
    );
  }

  async function loadProfile() {
    const versionText = await version();
    settingsWrap.replaceChildren();
    const settings = section('Настройки', versionText ? 'v' + versionText : '');
    const rows = document.createElement('div');
    rows.className = 'ybx-list';
    const sleepRow = document.createElement('div');
    sleepRow.className = 'ybx-row';
    const sleepLabel = document.createElement('span');
    sleepLabel.className = 'ybx-label';
    sleepLabel.textContent = 'Экран сна со статистикой';
    const sleepValue = document.createElement('span');
    sleepValue.className = 'ybx-value';
    sleepRow.append(sleepLabel, sleepValue);

    const syncRow = document.createElement('div');
    syncRow.className = 'ybx-row';
    const syncLabel = document.createElement('span');
    syncLabel.className = 'ybx-label';
    syncLabel.textContent = 'KOSync';
    const syncValue = document.createElement('span');
    syncValue.className = 'ybx-value';
    const current = await readSettings();
    const mode = syncMode(current);
    syncValue.textContent = mode === 'plugin' ? 'YBX · через плагин'
      : mode === 'account' ? 'YBX · отдельный аккаунт'
      : 'не настроено через YBX';
    syncRow.append(syncLabel, syncValue);
    rows.appendChild(sleepRow);
    // Shown only while the mode that also draws the card is selected: it is the
    // answer to "выключил, а карточка всё равно появляется".
    const sleepHint = document.createElement('p');
    sleepHint.className = 'ybx-hint';
    sleepHint.hidden = true;
    rows.appendChild(sleepHint);
    const sleepHelp = document.createElement('details');
    const sleepHelpTitle = document.createElement('summary');
    sleepHelpTitle.textContent = 'Как обновляется экран сна';
    const sleepHelpText = document.createElement('p');
    sleepHelpText.className = 'ybx-hint';
    sleepHelpText.textContent = 'Ридер обновляет экран со статистикой по Wi-Fi перед засыпанием.';
    sleepHelp.append(sleepHelpTitle, sleepHelpText);
    rows.appendChild(sleepHelp);
    const v2Row = document.createElement('div');
    v2Row.className = 'ybx-row';
    const v2Label = document.createElement('span');
    v2Label.className = 'ybx-label';
    v2Label.textContent = 'KoSync V2 · совместимость';
    const v2Value = document.createElement('span');
    v2Value.className = 'ybx-value';
    v2Value.textContent = kosyncV2Readiness(current).label;
    v2Row.append(v2Label, v2Value);
    const settingEnabled = (settings, key) => {
      const raw = settingValue(settings, key);
      return raw === true || raw === 1 || String(raw).toLowerCase() === 'true' || String(raw) === '1';
    };
    const clipsEnabled = (settings) => settingEnabled(settings, 'koSyncClippings');
    const clipRow = document.createElement('div');
    clipRow.className = 'ybx-row';
    const clipLabel = document.createElement('span');
    clipLabel.className = 'ybx-label';
    clipLabel.textContent = 'Синхронизация цитат';
    const clipValue = document.createElement('span');
    clipValue.className = 'ybx-value';
    clipValue.textContent = clipsEnabled(current) ? 'Включена' : 'Выключена';
    clipRow.append(clipLabel, clipValue);
    const clipHint = document.createElement('p');
    clipHint.className = 'ybx-hint';
    clipHint.textContent = 'Синхронизация цитат и заметок с YBX через KOSync.';
    // Metadata settings are independent of the progress key and quote sync.
    const metadataOptions = [
      ['libraryUseMetadata', 'Использовать метаданные книги', 'Показывать название и автора из файла книги.'],
      ['koSendMetadata', 'Отправлять метаданные документа', 'Передавать название и автора при синхронизации.'],
    ];
    const metadataRows = document.createElement('div');
    metadataRows.className = 'ybx-list';
    const metadataButtons = {};
    for (const [key, label, hint] of metadataOptions) {
      const row = document.createElement('div');
      row.className = 'ybx-row';
      const title = document.createElement('div');
      const caption = document.createElement('strong');
      caption.textContent = label;
      const explanation = document.createElement('p');
      explanation.className = 'ybx-hint';
      explanation.textContent = hint;
      title.append(caption, explanation);
      const control = document.createElement('button');
      control.type = 'button';
      const update = (snapshot) => {
        const exists = settingValue(snapshot, key) !== undefined;
        const active = exists && settingEnabled(snapshot, key);
        control.textContent = !exists ? 'Недоступно' : active ? 'Выключить' : 'Включить';
        control.disabled = !exists;
        control.setAttribute('aria-pressed', active ? 'true' : 'false');
        control.setAttribute('aria-label', label + ': ' + (active ? 'включено' : 'выключено'));
      };
      update(current);
      control.onclick = async () => {
        control.disabled = true;
        try {
          const latest = await readSettings({ required: true });
          if (settingValue(latest, key) === undefined) {
            throw new Error('прошивка не поддерживает ' + key);
          }
          const next = Number(!settingEnabled(latest, key));
          await writeSettings({ [key]: next });
          const saved = await readSettings({ required: true });
          if (Number(settingValue(saved, key)) !== next) {
            throw new Error('прошивка не сохранила ' + key);
          }
          update(saved);
          message(label + (next ? ': включено.' : ': выключено.'), 'ok');
        } catch (error) {
          message('Не удалось сохранить метаданные: ' + error.message, 'err');
        } finally {
          control.disabled = !token || settingValue(current, key) === undefined;
        }
      };
      metadataButtons[key] = control;
      row.append(title, control);
      metadataRows.appendChild(row);
    }
    const restoreButton = document.createElement('button');
    restoreButton.type = 'button';
    restoreButton.textContent = 'Вернуть прежний KOSync';
    restoreButton.hidden = !(await readJson(KOSYNC_PREVIOUS));
    restoreButton.onclick = async () => {
      const previous = await readJson(KOSYNC_PREVIOUS);
      if (!previous) { restoreButton.hidden = true; return; }
      const where = previous.koServerUrl || 'облако CrossPoint Sync';
      if (!window.confirm('Вернуть прежний KOSync (' + where + ')? Введите пароль KOSync заново на ридере.')) return;
      restoreButton.disabled = true;
      try {
        const values = { koServerUrl: previous.koServerUrl, koUsername: previous.koUsername,
          koPassword: '', koSyncClippings: 0 };
        for (const key of ['koMatchMethod', 'koSyncBehavior']) {
          if (previous[key] !== undefined && previous[key] !== null) values[key] = previous[key];
        }
        await writeSettings(values);
        await fetch('/delete', { method: 'POST', body: new URLSearchParams({ path: KOSYNC_PREVIOUS }) });
        restoreButton.hidden = true;
        syncValue.textContent = 'свой сервер';
        disableSyncButton.hidden = true;
        syncButton.textContent = 'Настроить KOSync';
        clipValue.textContent = 'Выключена';
        clippingButton.textContent = 'Включить синхронизацию цитат';
        message('Прежний KOSync возвращён, введите пароль на ридере.', 'ok');
      } catch (error) {
        message('Не удалось вернуть прежний KOSync: ' + error.message, 'err');
      } finally {
        restoreButton.disabled = false;
      }
    };
    // Reader-side off does not invalidate the quote proof by itself. Revoke
    // the dedicated server permission while leaving the normal KOSync key.
    const revokeClippingKey = async () => {
      if (!token?.access_token || typeof api.relay !== 'function') {
        throw new Error('невозможно отозвать ключ без привязки YBX');
      }
      const revoked = await api.relay('POST', API + '/api/v1/crosspoint/auth/clippings-key/revoke',
        { Authorization: 'Bearer ' + token.access_token }, '');
      if (!revoked || revoked.status !== 204) {
        throw new Error('сервер не подтвердил отзыв ключа цитат (HTTP '
          + (revoked?.status || 'нет ответа') + ')');
      }
    };
    const revokeClipButton = document.createElement('button');
    revokeClipButton.type = 'button';
    revokeClipButton.textContent = 'Отозвать ключ цитат';
    revokeClipButton.hidden = clipsEnabled(current)
      || !isClippingsUrl(settingValue(current, 'koServerUrl'));
    revokeClipButton.disabled = !token;
    revokeClipButton.onclick = async () => {
      revokeClipButton.disabled = true;
      try {
        await revokeClippingKey();
        revokeClipButton.hidden = true;
        message('Ключ цитат отозван.', 'ok');
      } catch (error) {
        message('Не удалось отозвать ключ цитат: ' + error.message, 'err');
      } finally {
        revokeClipButton.disabled = !token;
      }
    };
    const clippingButton = document.createElement('button');
    clippingButton.type = 'button';
    clippingButton.className = 'primary';
    clippingButton.textContent = clipsEnabled(current)
      ? 'Выключить синхронизацию цитат' : 'Включить синхронизацию цитат';
    clippingButton.disabled = !token;
    clippingButton.onclick = async () => {
      clippingButton.disabled = true;
      let attemptedEnable = false;
      try {
        const latest = await readSettings({ required: true });
        if (clipsEnabled(latest)) {
          // No credential deletion or changes to KOSync progress settings.
          await writeSettings({ koSyncClippings: 0 });
          const after = await readSettings({ required: true });
          if (clipsEnabled(after)) throw new Error('ридер не выключил синхронизацию цитат');
          clipValue.textContent = 'Выключена';
          clippingButton.textContent = 'Включить синхронизацию цитат';
          syncValue.textContent = 'YBX · KOSync (без цитат)';
          if (isClippingsUrl(settingValue(latest, 'koServerUrl'))) {
            revokeClipButton.hidden = false;
            try {
              await revokeClippingKey();
              revokeClipButton.hidden = true;
              message('Синхронизация цитат выключена, ключ на сервере отозван.', 'ok');
            } catch (error) {
              message('Цитаты выключены на ридере, но серверный ключ ещё действителен: нажмите «Отозвать ключ цитат» ('
                + error.message + ').', 'err');
            }
          } else {
            message('Синхронизация цитат выключена.', 'ok');
          }
          return;
        }
        if (!token?.access_token) throw new Error('сначала привяжите устройство к YBX');
        if (typeof api.relay !== 'function') {
          throw new Error('эта версия прошивки не поддерживает защищённые запросы плагина');
        }
        const oldServer = settingValue(latest, 'koServerUrl') || '';
        const oldUser = settingValue(latest, 'koUsername') || '';
        if (!window.confirm('Включить синхронизацию цитат YBX? Настройки KOSync на ридере будут заменены.')) {
          message('Включение цитат отменено.');
          return;
        }
        message('Получаем ключ цитат…');
        const issued = await api.relay('POST', API + '/api/v1/crosspoint/auth/clippings-key',
          { Authorization: 'Bearer ' + token.access_token }, '');
        if (!issued || issued.status !== 200) {
          throw new Error('сервер не выдал ключ цитат (HTTP '
            + (issued?.status || 'нет ответа') + ')');
        }
        let body = null;
        try { body = JSON.parse(issued.body || ''); } catch { /* fail closed */ }
        const key = body?.kosync_key;
        if (typeof key !== 'string' || !/^kosync_[A-Za-z0-9_-]{43}$/.test(key)
            || !isClippingsUrl(body.sync_url) || body.clippings_enabled !== true) {
          throw new Error('сервер прислал неподходящий ключ или адрес цитат');
        }
        // Save only readable non-secret values; GET /api/settings masks passwords.
        // An existing KOSync backup is the user's earliest original server.
        if (!isClippingsUrl(oldServer) && !await readJson(KOSYNC_PREVIOUS)) {
          await writeJson(KOSYNC_PREVIOUS, {
            koServerUrl: oldServer, koUsername: oldUser,
            koMatchMethod: settingValue(latest, 'koMatchMethod'),
            koSyncBehavior: settingValue(latest, 'koSyncBehavior'),
            koSyncClippings: settingValue(latest, 'koSyncClippings'),
            savedAt: new Date().toISOString(),
          });
          restoreButton.hidden = false;
        }
        attemptedEnable = true;
        await writeSettings({
          koServerUrl: body.sync_url,
          koUsername: 'ybx', koPassword: key,
          // YBX maps books by the binary hash of the EPUB it served; with the
          // stock Filename default every clipping waits forever for a book.
          koMatchMethod: 1,
          koSyncClippings: 1,    // Official Stock firmware setting
        });
        const saved = await readSettings({ required: true });
        for (const [name, expected] of Object.entries({
          koServerUrl: body.sync_url, koUsername: 'ybx',
          koMatchMethod: 1, koSyncClippings: 1,
        })) {
          const got = settingValue(saved, name);
          if (name === 'koServerUrl' || name === 'koUsername'
            ? got !== expected : Number(got) !== expected) {
            throw new Error('прошивка не сохранила параметр ' + name);
          }
        }
        // The actual password is deliberately masked in GET /api/settings.
        // Verifying Basic auth over HTTPS is necessary, but actual guest sync
        // remains to be checked separately on the reader.
        await verifyPluginSync(key);
        clipValue.textContent = 'Включена';
        clippingButton.textContent = 'Выключить синхронизацию цитат';
        revokeClipButton.hidden = true;
        syncValue.textContent = 'YBX · KOSync (с цитатами)';
        syncButton.textContent = 'Обновить ключ KOSync';
        disableSyncButton.hidden = false;
        message('Синхронизация цитат включена. Запустите Sync Progress в книге, чтобы проверить передачу цитат.', 'ok');
      } catch (error) {
        if (attemptedEnable) {
          try { await writeSettings({ koSyncClippings: 0 }); } catch { /* safety best effort */ }
          try { await revokeClippingKey(); } catch { revokeClipButton.hidden = false; }
        }
        message('Не удалось настроить синхронизацию цитат: ' + error.message, 'err');
      } finally {
        clippingButton.disabled = !token;
      }
    };
    const syncButton = document.createElement('button');
    syncButton.type = 'button';
    syncButton.className = 'primary';
    syncButton.textContent = mode === 'plugin' ? 'Обновить ключ KOSync'
      : mode === 'account' ? 'Подключить KOSync YBX'
      : 'Настроить KOSync';
    syncButton.disabled = !token;
    syncButton.onclick = async () => {
      syncButton.disabled = true;
      try {
        const latest = await readSettings({ required: true });
        // The quote-enabled credential must never be silently replaced by the
        // old progress-only key which is carried on plain HTTP.
        if (clipsEnabled(latest)) {
          message('Синхронизация цитат включена: сначала выключите её кнопкой ниже.', 'err');
          return;
        }
        if (pointsToYbx(latest) && settingValue(latest, 'koUsername') === 'ybx') {
          if (!window.confirm('Обновить ключ KOSync? Ключ на ридере будет заменён.')) {
            message('Обновление ключа отменено.');
            return;
          }
          // Rotate the narrow key over TLS, then move the reader onto the HTTP
          // sync host: the key carries no catalog/download/event scope, so it
          // is safe to store where a TLS-limited Xteink can still reach it.
          const key = await fetchKosyncKey();
          await writeSettings({ koServerUrl: KOSYNC_URL, koPassword: key });
          await verifyPluginSync(key);
          syncValue.textContent = 'YBX · через плагин';
          disableSyncButton.hidden = false;
          syncButton.textContent = 'Обновить ключ KOSync';
          message('Ключ обновлён. Проверьте синхронизацию позиции на ридере.', 'ok');
          return;
        }
        let server = 'не указан';
        const configuredServer = settingValue(latest, 'koServerUrl');
        let crosspointCloud = !configuredServer;
        if (configuredServer) {
          try {
            const url = new URL(configuredServer);
            server = url.origin + url.pathname;
            crosspointCloud = url.hostname.includes('crosspoint');
          } catch { server = 'настроен другой сервер'; }
        }
        if (crosspointCloud) server = 'облако CrossPoint Sync';
        const legacy = syncMode(latest) === 'account';
        if (!window.confirm(legacy
          ? 'Переключить самостоятельный KOSync на плагин YBX? Прежние настройки можно вернуть кнопкой «Вернуть прежний KOSync».'
          : crosspointCloud
            ? 'Переключить KOSync на YBX? Сейчас позиции уходят в облако CrossPoint Sync только в одну сторону.'
            : 'Настроить KOSync через YBX (' + server + ')? Прежние настройки можно вернуть кнопкой «Вернуть прежний KOSync».')) {
          syncButton.disabled = false;
          message('Настройка KOSync отменена.');
          return;
        }
        message('Настраиваем KOSync…');
        const key = await fetchKosyncKey();
        await writeJson(KOSYNC_PREVIOUS, {
          koServerUrl: configuredServer || '',
          koUsername: settingValue(latest, 'koUsername') || '',
          koMatchMethod: settingValue(latest, 'koMatchMethod'),
          koSyncBehavior: settingValue(latest, 'koSyncBehavior'),
          savedAt: new Date().toISOString(),
        });
        restoreButton.hidden = false;
        await writeSettings({
          koServerUrl: KOSYNC_URL,
          koUsername: 'ybx',
          koPassword: key,
          koMatchMethod: 1,
          koSyncBehavior: 1,
        });
        // POST may succeed while firmware drops unknown keys. The readback
        // validates visible settings; server auth validates the credential.
        // Only the reader's next sync proves its masked password was stored.
        await verifyPluginSync(key);
        syncValue.textContent = 'YBX · через плагин';
        disableSyncButton.hidden = false;
        syncButton.textContent = 'Обновить ключ KOSync';
        message('KOSync настроен. Проверьте синхронизацию позиции на ридере.', 'ok');
      } catch (error) {
        message('Не удалось настроить синхронизацию: ' + error.message, 'err');
      } finally {
        // After confirmation or cancellation, this action remains available
        // for future QR re-logins and key rotations.
        syncButton.disabled = !token;
      }
    };
    // Disabling YBX progress also disables quote sync; metadata is unaffected.
    const disableSyncButton = document.createElement('button');
    disableSyncButton.type = 'button';
    disableSyncButton.textContent = 'Отключить KOSync YBX';
    disableSyncButton.hidden = mode !== 'plugin';
    disableSyncButton.disabled = !token;
    disableSyncButton.onclick = async () => {
      disableSyncButton.disabled = true;
      try {
        const latest = await readSettings({ required: true });
        if (!pointsToYbx(latest)) {
          message('KOSync YBX уже отключён, настройки другого сервера не затронуты.');
          return;
        }
        const quotesOn = clipsEnabled(latest);
        if (!window.confirm('Отключить KOSync YBX на ридере?'
            + (quotesOn ? ' Синхронизация цитат также будет выключена.' : ' Настройки синхронизации будут очищены.'))) {
          message('Отключение KOSync отменено.');
          return;
        }
        await writeSettings({ ...SYNC_OFF, koSyncClippings: 0 });
        const saved = await readSettings({ required: true });
        if (pointsToYbx(saved) || clipsEnabled(saved)) {
          throw new Error('прошивка не подтвердила отключение KOSync');
        }
        syncValue.textContent = 'не настроено через YBX';
        syncButton.textContent = 'Настроить KOSync';
        disableSyncButton.hidden = true;
        clipValue.textContent = 'Выключена';
        clippingButton.textContent = 'Включить синхронизацию цитат';
        message('KOSync YBX отключён.', 'ok');
      } catch (error) {
        message('Не удалось отключить KOSync YBX: ' + error.message, 'err');
      } finally {
        disableSyncButton.disabled = !token;
      }
    };
    const v2ProbeButton = document.createElement('button');
    v2ProbeButton.type = 'button';
    v2ProbeButton.textContent = 'Проверить KoSync V2 (без изменений)';
    v2ProbeButton.onclick = async () => {
      v2ProbeButton.disabled = true;
      try {
        // Only GET; no setting writes, no relay, no sync or device-floor change.
        const latest = await readSettings({ required: true });
        const result = kosyncV2Readiness(latest);
        v2Value.textContent = result.label;
        message(result.detail);
      } catch (_error) {
        v2Value.textContent = 'не проверено';
        message('Не удалось прочитать настройки ридера. KoSync не изменён.', 'err');
      } finally {
        v2ProbeButton.disabled = false;
      }
    };
    // «Свой» is the firmware mode that shows /sleep.bmp, so switching the card on
    // writes it and switching off writes «Обложка» — the mode a person expects to
    // come back. «Обложка + Свой» also draws the card whenever sleep is not taken
    // from a book: that is the mode behind «выключил, а оно всё равно включается»,
    // so it is named and explained here instead of reported as «другой режим».
    const SLEEP_MODES = ['Тёмный', 'Светлый', 'Свой', 'Обложка', 'Обложка + Свой',
                         'Нет', 'Быстрое возобновление', 'Прозрачный'];
    let sleepMode = Number(settingValue(current, 'sleepScreen'));
    // Переключатель — это сам обработчик sleep.enter в device.json ридера.
    let sleepCardEnabled = null;
    try {
      sleepCardEnabled = await reconcileSleepCard(sleepMode);
    } catch (error) {
      sleepCardEnabled = null;
    }
    // Карточка от версии до 1.6.10 без метки YBX1: убрать можно только вручную.
    let legacyCard = sleepCardEnabled === false && await legacyInSlot();
    const sleepButton = document.createElement('button');
    sleepButton.type = 'button';
    sleepButton.className = 'primary';
    sleepButton.onclick = async () => {
      const turningOn = sleepCardEnabled !== true;
      sleepButton.disabled = true;
      message(turningOn ? 'Включаем экран сна…' : 'Выключаем экран сна…');
      try {
        if (turningOn) {
          const slot = await readSleepFile(SLEEP_SLOT);
          if (slot && !ownsSleepSlot(slot) && !window.confirm(
              'Заменить текущую картинку экрана сна? Прежняя картинка сохранится и вернётся при выключении.')) {
            message('Включение отменено, текущая картинка не тронута.');
            return;
          }
        }
        const outcome = await setSleepCard(turningOn, sleepMode);
        sleepCardEnabled = turningOn;
        legacyCard = !turningOn && await legacyInSlot();
        if (turningOn) {
          sleepMode = CARD_MODE;
        } else if (sleepMode === CARD_MODE || sleepMode === COVER_CUSTOM_MODE) {
          sleepMode = COVER_MODE;
        }
        paintSleepState();
        message(turningOn
          ? 'Экран сна включён.'
          : outcome === 'restored'
            ? 'Экран сна выключен, прежняя картинка возвращена.'
            : outcome === 'cleared'
              ? 'Экран сна выключен, карточка убрана.'
              : 'Экран сна выключен.', 'ok');
      } catch (error) {
        message('Не удалось изменить экран сна: ' + error.message, 'err');
        paintSleepState();
      }
    };

    const sleepCardButton = document.createElement('button');
    sleepCardButton.type = 'button';
    sleepCardButton.className = 'primary';
    sleepCardButton.textContent = 'Обновить экран сна';
    sleepCardButton.onclick = async () => {
      sleepCardButton.disabled = true;
      message('Загружаем экран сна…');
      try {
        await refreshSleepCard();
        message('Экран сна обновлён.', 'ok');
      } catch (error) {
        message('Не удалось обновить экран сна: ' + error.message, 'err');
      } finally {
        paintSleepState();
      }
    };

    const legacyButton = document.createElement('button');
    legacyButton.type = 'button';
    legacyButton.textContent = 'Убрать старую карточку';
    legacyButton.onclick = async () => {
      if (!window.confirm('Убрать старую карточку YBX? Ридер вернётся к обычным обоям, а резервная копия сохранится на SD-карте.')) {
        message('Отменено, экран сна не тронут.');
        return;
      }
      legacyButton.disabled = true;
      try {
        const cleared = await clearLegacySleepCard();
        legacyCard = false;
        message(cleared
          ? 'Старая карточка убрана, резервная копия сохранена на SD-карте.'
          : 'Старая карточка уже убрана.', 'ok');
      } catch (error) {
        message('Не удалось убрать старую карточку: ' + error.message, 'err');
      } finally {
        legacyButton.disabled = false;
        paintSleepState();
      }
    };

    const paintSleepState = () => {
      const on = sleepCardEnabled === true;
      legacyButton.hidden = !token || !legacyCard || sleepCardEnabled !== false;
      sleepValue.textContent = (SLEEP_MODES[sleepMode] || 'режим не определён')
        + (sleepCardEnabled === null ? ' · переключатель не прочитан'
          : on ? ' · статистика' : ' · обои ридера');
      sleepButton.textContent = on ? 'Выключить экран сна'
        : 'Включить экран сна';
      sleepButton.disabled = !token || sleepCardEnabled === null;
      sleepCardButton.disabled = !token || !on;
      sleepHint.hidden = sleepMode !== COVER_CUSTOM_MODE || !on;
      sleepHint.textContent = sleepHint.hidden
        ? ''
        : 'В режиме «Обложка + Свой» статистика показывается, только если сон не из книги.';
    };
    paintSleepState();

    const statsHint = document.createElement('details');
    statsHint.hidden = true;

    const statsButton = document.createElement('button');
    statsButton.type = 'button';
    statsButton.className = 'primary';
    statsButton.textContent = 'Выгрузить статистику (vCodex)';
    statsButton.disabled = !token;
    statsButton.onclick = async () => {
      statsButton.disabled = true;
      message('Выгружаем статистику чтения…');
      try {
        const overwriting = statsArmed;
        statsArmed = false;
        const existing = [];
        if (await fileExists('/.crosspoint', 'reading_stats.json')) existing.push(STATS_FILE);
        if (await fileExists('/exports', 'stats_exported')) existing.push(STATS_IMPORT_FILE);
        if (!overwriting && existing.length) {
          statsArmed = true;
          message('Файл статистики уже существует на SD-карте. Нажмите ещё раз для перезаписи.');
          return;
        }
        const results = await exportReadingStats();
        const saved = results.filter((item) => item.ok).length;
        const missed = results.filter((item) => !item.ok).map((item) => item.path + ' (' + item.detail + ')');
        if (!saved) throw new Error(missed.join('; '));
        if (missed.length) {
          message('Не удалось сохранить файл статистики на SD-карту.', 'err');
        } else {
          message('Статистика сохранена на SD-карту.', 'ok');
        }
        if (!results[0].ok) {
          statsHint.hidden = true;
          return;
        }
        const info = await firmwareStatus();
        const canImport = info.capabilities.includes('stats.native.v1')
          && info.capabilities.includes('ui.dashboard.v1');
        const steps = document.createElement('p');
        steps.className = 'ybx-hint';
        steps.textContent = canImport
          ? 'На ридере откройте: Настройки → Приложения → Reading Stats → Import Statistics → vCodex.'
          : 'Если в прошивке есть раздел Reading Stats, откройте Import Statistics и выберите vCodex.';
        const detailsTitle = document.createElement('summary');
        detailsTitle.textContent = 'Как импортировать статистику';
        statsHint.replaceChildren(detailsTitle, steps);
        statsHint.hidden = false;
      } catch (error) {
        message('Не удалось выгрузить статистику: ' + error.message, 'err');
      } finally {
        statsButton.disabled = !token;
      }
    };

    const actions = document.createElement('div');
    actions.className = 'ybx-actions';

    const checkButton = document.createElement('button');
    checkButton.type = 'button';
    checkButton.textContent = 'Проверить обновление';
    const updateButton = document.createElement('button');
    updateButton.type = 'button';
    updateButton.className = 'primary';
    updateButton.textContent = 'Обновить';
    updateButton.hidden = true;
    // Баннер остаётся на экране, пока читатель решит обновить: в отличие от
    // строки состояния его не перетирает следующая операция.
    const updateBanner = document.createElement('p');
    updateBanner.className = 'ybx-update';
    updateBanner.hidden = true;
    const updateBannerTitle = document.createElement('strong');
    const updateBannerHint = document.createElement('span');
    updateBannerHint.textContent = 'Обновите плагин здесь или на ридере: '
      + 'Home → Plugins → Plugin Hub → YBX → Обновить.';
    updateBanner.append(updateBannerTitle, updateBannerHint);
    const signOutButton = document.createElement('button');
    signOutButton.type = 'button';
    signOutButton.textContent = 'Отвязать';
    let latest = null;
    const isNewer = (next, currentVersion) => {
      const a = String(next).split('.').map(Number);
      const b = String(currentVersion).split('.').map(Number);
      for (let i = 0; i < 3; i += 1) {
        if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
      }
      return false;
    };
    const showUpdate = (available) => {
      updateBanner.hidden = !available;
      updateButton.hidden = !available;
      if (available) updateBannerTitle.textContent = 'Доступна версия ' + latest.version;
    };
    const checkForUpdate = async (announce) => {
      checkButton.disabled = true;
      if (announce) message('Проверяем обновление…');
      try {
        const res = await api.relay('GET', UPDATE_URL, {}, '');
        if (!res || res.status !== 200) throw new Error('HTTP ' + (res && res.status));
        latest = JSON.parse(res.body);
        const available = isNewer(latest.version, versionText);
        showUpdate(available);
        if (announce) {
          message(available ? 'Доступна версия ' + latest.version + '.'
            : 'Установлена последняя версия (' + versionText + ').', 'ok');
        }
      } catch (error) {
        // Найденное раньше предложение обновить остаётся: сбой повторной
        // проверки не отменяет уже скачанный релиз.
        if (announce) message('Не удалось проверить обновление: ' + error.message, 'err');
      } finally {
        checkButton.disabled = false;
      }
    };
    checkButton.onclick = () => checkForUpdate(true);
    const loadJsZip = async () => {
      if (window.JSZip) return window.JSZip;
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '/js/jszip.min.js';
        script.onload = resolve;
        script.onerror = () => reject(new Error('JSZip недоступен в этой прошивке'));
        document.head.appendChild(script);
      });
      return window.JSZip;
    };
    // Every writable file must be present and backed up before the first
    // mutation. Plugin Hub may still overwrite config.json independently;
    // this in-page updater deliberately preserves it and token.json.
    const applyUpdateArchive = async (archive, expectedVersion) => {
      const filenames = ['manifest.json', 'device.json', 'plugin.json', 'plugin.js',
        'config.json', 'README.md', 'icon.png'];
      const allowed = new Set(filenames);
      const zipFiles = Object.values(archive.files).filter((entry) => !entry.dir);
      if (zipFiles.length !== filenames.length || zipFiles.some((entry) =>
        !entry.name.startsWith('ybx/') || !allowed.has(entry.name.slice(4)))) {
        throw new Error('архив содержит неожиданные или отсутствующие файлы');
      }
      const bytes = new Map();
      for (const entry of zipFiles) {
        const name = entry.name.slice(4);
        if (bytes.has(name)) throw new Error('дублирование файла ' + name);
        const content = await entry.async('uint8array');
        if (!content.length || content.length > 256 * 1024) {
          throw new Error('недопустимый размер файла ' + name);
        }
        bytes.set(name, content);
      }
      if (filenames.some((name) => !bytes.has(name))) throw new Error('неполный архив');
      const decode = (name) => JSON.parse(new TextDecoder().decode(bytes.get(name)));
      const manifest = decode('manifest.json');
      const pluginMeta = decode('plugin.json');
      if (manifest.name !== 'ybx' || manifest.version !== expectedVersion ||
          pluginMeta.id !== 'ybx' || pluginMeta.version !== expectedVersion ||
          JSON.stringify(manifest.files) !== JSON.stringify(filenames) ||
          JSON.stringify(pluginMeta.files) !== JSON.stringify(filenames) ||
          manifest.compatibility?.requires?.length) {
        throw new Error('несовместимая версия или структура плагина');
      }
      // A reader must never run a 1.7.x connected-source manifest on stock
      // CrossPoint firmware, even if a release endpoint is misconfigured.
      const device = decode('device.json');
      if (device.browse?.lists_url || !device.browse?.lists?.length ||
          device.auth?.type !== 'device_code') {
        throw new Error('архив рассчитан на другую прошивку');
      }
      const writable = filenames.filter((name) => name !== 'config.json');
      const backup = new Map();
      for (const name of writable) {
        const old = await fetch('/download?path=' + encodeURIComponent(DIR + '/' + name));
        if (!old.ok) throw new Error('резервная копия ' + name + ': HTTP ' + old.status);
        backup.set(name, new Uint8Array(await old.arrayBuffer()));
      }
      // The release's default device.json intentionally has no sleep.enter.
      // Preserve the reader's actual choice instead of resetting the card at
      // every in-page update. Preserve foreign handlers unmodified, too.
      const installedDevice = JSON.parse(new TextDecoder().decode(backup.get('device.json')));
      const previousSleep = installedDevice?.events?.['sleep.enter'];
      if (previousSleep) {
        const updateDevice = decode('device.json');
        updateDevice.events ||= {};
        const ourDownload = previousSleep.download
          && previousSleep.download.dest === SLEEP_SLOT
          && String(previousSleep.download.url || '').startsWith(
            API + '/api/v1/crosspoint/sleep-image?');
        updateDevice.events['sleep.enter'] = ourDownload
          ? { download: sleepDownloadHandler(expectedVersion) }
          : previousSleep;
        bytes.set('device.json', new TextEncoder().encode(
          JSON.stringify(updateDevice, null, 2) + '\n'));
      }
      const encode = (data) => {
        let binary = '';
        for (let i = 0; i < data.length; i += 8192) {
          binary += String.fromCharCode(...data.subarray(i, i + 8192));
        }
        return btoa(binary);
      };
      // Metadata is replaced last. Any failed write is also rolled back:
      // the host might have written some bytes before returning an error.
      const order = writable.filter((name) => name !== 'manifest.json' && name !== 'plugin.json');
      order.push('plugin.json', 'manifest.json');
      const touched = [];
      try {
        for (const name of order) {
          touched.push(name);
          await api.writeFile(DIR + '/' + name, encode(bytes.get(name)));
        }
      } catch (error) {
        const failures = [];
        for (const name of touched.reverse()) {
          try { await api.writeFile(DIR + '/' + name, encode(backup.get(name))); }
          catch (rollbackError) { failures.push(name); }
        }
        throw new Error('запись обновления: ' + error.message +
          (failures.length ? '; восстановление не удалось: ' + failures.join(', ') : '; старые файлы восстановлены'));
      }
    };
    updateButton.onclick = async () => {
      if (!latest) return;
      updateButton.disabled = true;
      message('Скачиваем обновление…');
      const zipPath = DIR + '/update.zip';
      try {
        const url = new URL(latest.url);
        if (url.protocol !== 'https:' || !['ybx.app', 'my.ybx.app'].includes(url.hostname) ||
            url.pathname !== '/crosspoint-plugin/ybx-plugin.zip' ||
            url.username || url.password || url.search || url.hash) {
          throw new Error('источник обновления не принадлежит YBX');
        }
        const download = await api.fetchToSd(url.href, zipPath);
        if (download.error || (download.status && (download.status < 200 || download.status >= 300))) {
          throw new Error('скачивание: HTTP ' + (download.status || download.error));
        }
        const JSZip = await loadJsZip();
        const res = await fetch('/download?path=' + encodeURIComponent(zipPath));
        if (!res.ok) throw new Error('чтение архива: HTTP ' + res.status);
        const archive = await JSZip.loadAsync(await res.arrayBuffer());
        await applyUpdateArchive(archive, latest.version);
        showUpdate(false);
        updateChecked = false;
        message('Обновлено до ' + latest.version + '. Перезагрузите страницу.', 'ok');
      } catch (error) {
        message('Не удалось обновить: ' + error.message, 'err');
      } finally {
        await fetch('/delete', { method: 'POST', body: new URLSearchParams({ path: zipPath }) })
          .catch(() => {});
        updateButton.disabled = false;
      }
    };
    signOutButton.onclick = async () => {
      signOutButton.disabled = true;
      let revoked = false;
      try {
        // Revocation is server-side and covers *all* cp_ credentials for the
        // current reader, including other tokens previously issued for it.
        // Never claim a remote logout based on merely clearing SD files.
        const result = await api.relay('POST', API + '/api/v1/crosspoint/auth/revoke',
          { Authorization: 'Bearer ' + token.access_token }, '');
        // A 401 is NOT proof that other previously issued keys were revoked.
        // Treat it exactly like a network failure: ask before local-only logout.
        if (!result || result.status !== 204) {
          throw new Error('сервер не подтвердил отзыв ключа (HTTP ' + (result && result.status) + ')');
        }
        revoked = true;
      } catch (error) {
        if (!window.confirm('Не удалось отозвать доступ на сервере (' + error.message + '). Отвязать ридер только локально?')) {
          message('Отвязка отменена.');
          signOutButton.disabled = false;
          return;
        }
      }
      try {
        const cleanupWarnings = [];
        // Only clear credentials for the plugin's own endpoint: ordinary
        // account KOSync (including HTTP-only legacy readers) is independent.
        // A settings read failure must not silently become an empty setting.
        try {
          const response = await fetch('/api/settings', { cache: 'no-store' });
          if (!response.ok) throw new Error('HTTP ' + response.status);
          const settings = await response.json();
          if (!Array.isArray(settings)) throw new Error('некорректный ответ');
          if (pointsToYbx(settings)) await writeSettings(SYNC_OFF);
        } catch (error) {
          cleanupWarnings.push('не удалось очистить настройки KOSync: ' + error.message);
        }

        // Mark explicit logout. The legacy fallback MUST NOT reactivate an
        // old token if this device cannot write into legacy plugin-data.
        await writeJson(TOKEN_PATH, { disconnected: true });
        const legacy = await readJson(LEGACY_TOKEN_PATH);
        if (legacy?.access_token) {
          try {
            await writeJson(LEGACY_TOKEN_PATH, { disconnected: true });
          } catch (error) {
            cleanupWarnings.push('не удалось очистить старый файл токена');
          }
        }
        token = null;
        renderSignedOut();
        const resultMessage = revoked
          ? 'Доступ на сервере отозван, локальная привязка удалена. Для нового входа используйте QR-код.'
          : 'Локальная привязка удалена. Полный отзыв доступа не подтверждён: удалите ридер в кабинете YBX.';
        message(resultMessage + (cleanupWarnings.length ? ' ' + cleanupWarnings.join('; ') + '.' : ''),
          revoked && !cleanupWarnings.length ? 'ok' : 'err');
      } catch (error) {
        message('Ключ на сервере ' + (revoked ? 'отозван' : 'не подтверждён') +
          ', но очистить локальные настройки не удалось: ' + error.message, 'err');
      } finally {
        signOutButton.disabled = false;
      }
    };
    const settingGroup = (heading, description) => {
      const group = document.createElement('div');
      group.className = 'ybx-setting-group';
      const title = document.createElement('h3');
      title.textContent = heading;
      const hint = document.createElement('p');
      hint.className = 'ybx-hint';
      hint.textContent = description;
      group.append(title, hint);
      return group;
    };
    const kosyncGroup = settingGroup('KOSync · позиции чтения',
      'Синхронизация позиции чтения между ридером и другими устройствами.');
    const kosyncActions = document.createElement('div');
    kosyncActions.className = 'ybx-actions';
    kosyncActions.append(syncButton, disableSyncButton, restoreButton);
    kosyncActions.appendChild(v2ProbeButton);
    kosyncGroup.append(syncRow, v2Row, kosyncActions);

    const metadataGroup = settingGroup('Метаданные книг',
      'Отображение названий и авторов из файлов книг.');
    metadataGroup.appendChild(metadataRows);

    const clippingGroup = settingGroup('Цитаты · Clippings',
      'Синхронизация цитат и заметок с YBX.');
    const clippingActions = document.createElement('div');
    clippingActions.className = 'ybx-actions';
    clippingActions.append(clippingButton, revokeClipButton);
    clippingGroup.append(clipRow, clipHint, clippingActions);

    actions.append(sleepButton, sleepCardButton, legacyButton, statsButton, checkButton, updateButton, signOutButton);
    settings.appendChild(rows);
    settings.append(buildServerSection(), kosyncGroup, metadataGroup, clippingGroup);
    settings.appendChild(statsHint);
    settings.appendChild(updateBanner);
    settings.appendChild(actions);
    settingsWrap.appendChild(settings);
    if (!updateChecked) {
      updateChecked = true;
      // Релиз проверяется сам при открытии страницы: читатель не должен
      // догадываться о кнопке «Проверить обновление».
      checkForUpdate(false);
    }
  }

  // ── Сервер: Авто / Основной / Европа ─────────────────────────────────────
  // Управление доступно и без привязки YBX: менять сервер нужно как раз тогда,
  // когда основной недоступен. Выбор сохраняется в JSON на SD и применяется к
  // зеркальной обёртке немедленно. Область действия — запросы плагина: каталог,
  // поиск и книги прошивка берёт напрямую по статическим адресам device.json.
  function buildServerSection() {
    const group = document.createElement('div');
    group.className = 'ybx-setting-group';
    const title = document.createElement('h3');
    title.textContent = 'Сервер';
    const hint = document.createElement('p');
    hint.className = 'ybx-hint';
    hint.textContent = 'Авто — основной сервер, при его недоступности европейское зеркало. '
      + 'Основной — только ybx.app. Европа — только зеркало (emy/eopds/esync). '
      + 'Выбор охватывает запросы плагина; каталог и загрузка книг идут с ридера '
      + 'переписывает адреса в device.json (каталог, поиск, книги, QR, события, экран сна); переоткройте плагин на ридере.';
    const actions = document.createElement('div');
    actions.className = 'ybx-actions';
    const buttons = [];
    const paintChoice = () => {
      buttons.forEach((button) => {
        const active = serverChoice === button.dataset.serverMode;
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
        button.classList.toggle('primary', active);
      });
    };
    for (const [mode, label] of SERVER_CHOICE_LABELS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.dataset.serverMode = mode;
      button.setAttribute('aria-label', 'Сервер: ' + label);
      button.onclick = async () => {
        if (serverChoice === mode) return;
        button.disabled = true;
        try {
          await saveServerChoice(mode);
          serverChoice = mode;
          mirrorRequest.choice(mode);
          paintChoice();
          let deviceNote = '';
          try {
            const europe = mode === 'eu' || mirrorRequest.effectiveEurope();
            if (await rewriteDeviceHostsOnDisk(europe)) {
              deviceNote = ' Адреса в device.json '
                + (europe ? 'переключены на зеркало' : 'возвращены на основной сервер')
                + '; переоткройте плагин на ридере, чтобы прошивка подхватила их.';
            }
          } catch (deviceError) {
            deviceNote = ' Не удалось обновить device.json: ' + deviceError.message + '.';
          }
          message('Сервер: ' + label + '.' + deviceNote, 'ok');
        } catch (error) {
          message('Не удалось сохранить выбор сервера: ' + error.message, 'err');
        } finally {
          button.disabled = false;
        }
      };
      buttons.push(button);
      actions.appendChild(button);
    }
    paintChoice();
    group.append(title, hint, actions);
    return group;
  }

  function renderSignedOut() {
    // Состояние «ещё раз, чтобы перезаписать» живёт до отвязки или перезагрузки.
    statsArmed = false;
    profile.replaceChildren();
    settingsWrap.replaceChildren();
    // Выбор сервера нужен и без привязки: недоступный основной мешает
    // именно первым шагам, поэтому управление не прячется за токеном.
    settingsWrap.appendChild(buildServerSection());
    message('Ридер не привязан. Откройте Home → Plugins → YBX на ридере и войдите по QR-коду.');
    const hint = document.createElement('section');
    hint.className = 'ybx-section';
    const text = document.createElement('p');
    text.className = 'ybx-hint';
    text.style.marginTop = '0';
    text.textContent = 'После входа здесь появятся статистика чтения, цель года и достижения.';
    hint.appendChild(text);
    profile.appendChild(hint);
  }

  async function refresh() {
    serverChoice = await readServerChoice();
    mirrorRequest.choice(serverChoice);
    await ensureDeviceConfig();
    try {
      await rewriteDeviceHostsOnDisk(serverChoice === 'eu' || mirrorRequest.effectiveEurope());
    } catch (error) { /* device.json may be unavailable; do not block page */ }
    token = await readPluginToken();
    if (!token || !token.access_token) {
      renderSignedOut();
      return;
    }
    message('Загружаем статистику…');
    try {
      const summary = await relay('/api/v1/crosspoint/reading/summary?limit=10', token.access_token);
      const month = summary.today ? summary.today.slice(0, 7) : new Date().toISOString().slice(0, 7);
      const [calendar, achievements] = await Promise.all([
        relay('/api/v1/crosspoint/reading/calendar?month=' + encodeURIComponent(month), token.access_token)
          .catch(() => ({ days: [] })),
        relay('/api/v1/crosspoint/achievements?limit=20', token.access_token)
          .catch(() => ({ yandex: { received: [], pending: [] } })),
      ]);
      renderProfile(summary, calendar, achievements);
      await loadProfile();
      message('Ридер подключён к YBX. Каталог: Home → Plugins → YBX.', 'ok');
    } catch (error) {
      if (error.status === 409) {
        // The plugin token is fine: only the books consent is missing, so the
        // reader must not be told to sign in again.
        const detail = error.detail || {};
        message(typeof detail.message === 'string' && detail.message
          ? detail.message + ' Затем обновите страницу.'
          : 'Подключите книги в кабинете YBX и обновите страницу.', 'err');
      } else if (error.status === 401) {
        message('Сессия устарела. Откройте Home → Plugins → YBX на ридере и войдите заново.', 'err');
        renderSignedOut();
      } else if (error.network) {
        message('Не удалось подключиться к YBX: проверьте интернет на телефоне.', 'err');
      } else {
        message('Не удалось загрузить статистику: ' + error.message, 'err');
      }
    }
  }

  await refresh();
});
