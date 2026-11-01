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
  const UPDATE_URL = 'https://ybx.app/crosspoint-plugin/latest.json';
  // Xteink's built-in KOSync client is the flakiest part of the TLS stack, so the
  // sync host answers over plain HTTP — for the narrow kosync_ key only, which
  // carries no catalogue, download or event scope. The old https address stays
  // recognized: readers configured by plugin 1.6.x keep reporting mode 'plugin'
  // until «Обновить ключ» moves them onto the sync host.
  const KOSYNC_URL = 'http://sync.ybx.app/api/v1/crosspoint/kosync';
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
  const SYNC_OFF = { koServerUrl: '', koUsername: '', koPassword: '' };

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
  // These endpoints belong to the same service but NOT the same auth scheme:
  // account KOSync uses an account/device key; the plugin endpoint uses the cp_
  // token or, since 1.6.8, the narrow kosync_ key written by the plugin itself.
  const syncMode = (settings) => {
    const address = settingValue(settings, 'koServerUrl');
    if (typeof address !== 'string' || !address) return 'other';
    try {
      const url = new URL(address);
      if (url.username || url.password || url.search || url.hash || url.port) return 'other';
      if (!['my.ybx.app', 'ybx.app', 'opds.ybx.app', 'sync.ybx.app'].includes(url.hostname)) {
        return 'other';
      }
      const path = url.pathname.replace(/\/+$/, '') || '/';
      if (path === '/api/v1/crosspoint/kosync'
          && (url.protocol === 'https:'
              || (url.hostname === 'sync.ybx.app' && url.protocol === 'http:'))) {
        return 'plugin';
      }
      // Caddy serves both schemes on OPDS/sync; primary/cabinet hosts
      // redirect HTTP, which old readers may not follow.
      const legacyHost = ['opds.ybx.app', 'sync.ybx.app'].includes(url.hostname);
      if (path === '/kosync' &&
          (url.protocol === 'https:' || (legacyHost && url.protocol === 'http:'))) {
        return 'account';
      }
    } catch { /* malformed URL must not be classified as configured */ }
    return 'other';
  };
  const pointsToYbx = (settings) => syncMode(settings) === 'plugin';
  const fetchKosyncKey = async () => {
    // The narrow kosync_ key: this account's progress GET/PUT and nothing else.
    // It is minted over TLS with the cp_ token before it is ever handed to the
    // firmware settings that may travel over plain HTTP. A reader whose TLS is
    // broken cannot reach this call either — and such a reader could not have
    // paired at all; setup it manually with a code from the cabinet instead.
    if (typeof api.relay !== 'function') {
      throw new Error('эта прошивка не умеет защищённых запросов из плагина — настройте KOSync вручную');
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

  const relay = async (path, auth) => {
    const res = await api.relay('GET', API + path, { Authorization: 'Bearer ' + auth }, '');
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
      note.textContent = 'Нет данных: начните читать книгу из каталога YBX на ридере.';
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
      note.textContent = 'Пока нет наград. Они появятся здесь после синхронизации с Яндекс Книгами.';
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
  const SLEEP_DEVICE = DIR + '/device.json';
  const SLEEP_BACKUP_LIMIT = 256 * 1024;
  const CARD_MODE = 2;         // CrossPointSettings::SLEEP_SCREEN_MODE::CUSTOM
  const COVER_MODE = 3;        // CrossPointSettings::SLEEP_SCREEN_MODE::COVER
  const COVER_CUSTOM_MODE = 4; // ...::COVER_CUSTOM — the card when sleep is not from a book
  // Версию в адресах берём из device.json ридера: сборка 1.7.0 подставляет свою.
  const handlerVersion = (device) => (String(device?.download?.url || '').match(/[?&]v=([^&]+)/) || [])[1] || '1.6.8';
  const sleepRequestHandler = (v) => ({
    method: 'POST',
    url: API + '/api/v1/crosspoint/events?v=' + v,
    headers: { Authorization: 'Bearer {token}', 'Content-Type': 'application/json' },
    body: '{"event":"sleep.enter","event_id":"{event.id}","ts":{event.ts}}',
  });
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
  const looksLikeSleepCard = (bytes, width, height) => {
    if (!bytes || bytes.length < 62 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) return false;
    const dword = (at) => (bytes[at] | bytes[at + 1] << 8 | bytes[at + 2] << 16 | bytes[at + 3] << 24);
    return dword(2) === bytes.length && dword(10) === 62 && dword(28) === 1
      && Math.abs(dword(18)) === width && Math.abs(dword(22)) === height
      && bytes.length === 62 + Math.ceil(width / 32) * 4 * height;
  };
  const ownsSleepSlot = (bytes) => SLEEP_PANELS
    .some(([width, height]) => looksLikeSleepCard(bytes, width, height));

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
  const sleepHandlerOn = (device) => Boolean(device?.events?.['sleep.enter']?.download);
  async function writeSleepHandler(device, enabled) {
    const v = handlerVersion(device);
    device.events['sleep.enter'] = enabled
      ? { download: sleepDownloadHandler(v) }
      : { request: sleepRequestHandler(v) };
    await api.writeFile(SLEEP_DEVICE, sleepBytes(new TextEncoder().encode(
      JSON.stringify(device, null, 2) + '\n')));
  }
  // Включение: сначала сохраняем чужую картинку, потом просим сервер рисовать,
  // и только затем отдаём прошивке скачивать карточку в слот.
  async function installSleepCard(device) {
    const slot = await readSleepFile(SLEEP_SLOT);
    if (slot && !ownsSleepSlot(slot)) {
      if (slot.length > SLEEP_BACKUP_LIMIT) {
        throw new Error('в /sleep.bmp лежит ваша картинка больше 256 КБ — YBX не сможет её '
          + 'сохранить, поэтому не перезаписывает слот. Освободите его в настройках ридера.');
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
    const removed = await fetch('/delete', {
      method: 'POST',
      body: new URLSearchParams({ path: SLEEP_SLOT }),
    });
    if (!removed.ok) {
      throw new Error('не удалось убрать карточку из /sleep.bmp (HTTP ' + removed.status + ')');
    }
    return 'cleared';
  }

  async function setSleepCard(enabled, sleepMode) {
    const device = await readSleepDevice();
    if (enabled) {
      await installSleepCard(device);
      if (sleepMode !== CARD_MODE) await writeSettings({ sleepScreen: CARD_MODE });
      return 'on';
    }
    const outcome = await removeSleepCard(device);
    // Прежний режим трогаем только если он показывал карточку: «Тёмный»,
    // «Светлый» и выбор пользователя оставляем как есть.
    if (sleepMode === CARD_MODE || sleepMode === COVER_CUSTOM_MODE) {
      await writeSettings({ sleepScreen: COVER_MODE });
    }
    return outcome;
  }

  // До 1.6.8 карточка скачивалась всегда. Если обработчик теперь выключен, а в
  // слоте всё ещё наша карточка, убираем её один раз при открытии страницы.
  async function reconcileSleepCard() {
    if (!token) return null;
    const device = await readSleepDevice();
    if (sleepHandlerOn(device)) return true;
    const slot = await readSleepFile(SLEEP_SLOT);
    if (slot && ownsSleepSlot(slot)) await removeSleepCard(device);
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
    sleepHelpText.textContent = 'Карточку обновляет прошивка перед засыпанием — заходить в плагин не нужно. '
      + 'Без связи останется предыдущая картинка. Во время сна обновлений нет. '
      + 'В проверенной сборке 2.0.0-rc+91ed3ef ридер пробует последнюю сеть до 10 секунд '
      + 'при заряде от 20%; на других сборках условия зависят от прошивки. '
      + 'Пока переключатель выключен, прошивка ничего не скачивает и слот /sleep.bmp '
      + 'остаётся вашим: при выключении YBX возвращает сохранённую картинку, а если её '
      + 'не было — убирает свою карточку, и ридер снова берёт обои из /.sleep.';
    sleepHelp.append(sleepHelpTitle, sleepHelpText);
    rows.appendChild(sleepHelp);
    rows.appendChild(syncRow);
    const restoreButton = document.createElement('button');
    restoreButton.type = 'button';
    restoreButton.textContent = 'Вернуть прежний KOSync';
    restoreButton.hidden = !(await readJson(KOSYNC_PREVIOUS));
    restoreButton.onclick = async () => {
      const previous = await readJson(KOSYNC_PREVIOUS);
      if (!previous) { restoreButton.hidden = true; return; }
      const where = previous.koServerUrl || 'облако CrossPoint Sync';
      if (!window.confirm('Вернуть прежние настройки KOSync?\n\nСервер: ' + where
          + '\nЛогин: ' + (previous.koUsername || 'не указан')
          + '\n\nПароль прошивка не отдаёт, поэтому его нужно будет ввести заново '
          + 'в настройках KOSync на ридере. Ключ YBX будет стёрт.')) return;
      restoreButton.disabled = true;
      try {
        const values = { koServerUrl: previous.koServerUrl, koUsername: previous.koUsername, koPassword: '' };
        for (const key of ['koMatchMethod', 'koSyncBehavior', 'koSendMetadata']) {
          if (previous[key] !== undefined && previous[key] !== null) values[key] = previous[key];
        }
        await writeSettings(values);
        await fetch('/delete', { method: 'POST', body: new URLSearchParams({ path: KOSYNC_PREVIOUS }) });
        restoreButton.hidden = true;
        syncValue.textContent = 'свой сервер';
        syncButton.textContent = 'Настроить KOSync';
        message('Прежние адрес и логин KOSync возвращены. Введите пароль в настройках KOSync на ридере.', 'ok');
      } catch (error) {
        message('Не удалось вернуть прежний KOSync: ' + error.message, 'err');
      } finally {
        restoreButton.disabled = false;
      }
    };
    const syncButton = document.createElement('button');
    syncButton.type = 'button';
    syncButton.className = 'primary';
    syncButton.textContent = mode === 'plugin' ? 'Обновить ключ KOSync'
      : mode === 'account' ? 'Перейти на KOSync через плагин'
      : 'Настроить KOSync';
    syncButton.disabled = !token;
    syncButton.onclick = async () => {
      syncButton.disabled = true;
      try {
        const latest = await readSettings({ required: true });
        if (pointsToYbx(latest) && settingValue(latest, 'koUsername') === 'ybx') {
          if (!window.confirm('Обновить ключ синхронизации через плагин YBX?\n\n'
              + 'Будут изменены пароль и адрес сервера этого режима. '
              + 'Другие настройки сохранятся.')) {
            message('Обновление ключа отменено. Настройки не изменены.');
            return;
          }
          // Rotate the narrow key over TLS, then move the reader onto the HTTP
          // sync host: the key carries no catalog/download/event scope, so it
          // is safe to store where a TLS-limited Xteink can still reach it.
          const key = await fetchKosyncKey();
          await writeSettings({ koServerUrl: KOSYNC_URL, koPassword: key });
          await verifyPluginSync(key);
          syncValue.textContent = 'YBX · через плагин';
          syncButton.textContent = 'Обновить ключ KOSync';
          message('Адрес сохранён, сервер принимает ключ. Проверьте '
            + 'фактическую синхронизацию позиции на ридере.', 'ok');
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
        if (!window.confirm((legacy
          ? 'Сейчас используется самостоятельный KOSync аккаунта YBX. '
            + 'Его ключ не будет изменён. Перейти на режим синхронизации через плагин?'
          : crosspointCloud
            ? 'Сейчас позиции уходят в облако CrossPoint Sync, а в YBX попадают через его '
              + 'зеркало — только в одну сторону: прогресс с других устройств на этот ридер '
              + 'не возвращается. После переключения ридер будет обмениваться позициями с YBX '
              + 'напрямую в обе стороны, а облако CrossPoint перестанет получать позиции с него.'
            : 'Настроить синхронизацию через плагин YBX?')
          + '\n\nТекущий сервер: ' + server
          + '\n\nБудут заменены адрес сервера, имя пользователя, пароль и параметры '
          + 'синхронизации на этом ридере. Сохранённый прогресс на прежнем сервере не удаляется.'
          + ' Вернуть прежние адрес и логин можно кнопкой «Вернуть прежний KOSync».'
          + '\n\nПродолжить?')) {
          syncButton.disabled = false;
          message('Настройка отменена. Прежние настройки сохранены.');
          return;
        }
        message('Настраиваем KOSync…');
        const key = await fetchKosyncKey();
        await writeJson(KOSYNC_PREVIOUS, {
          koServerUrl: configuredServer || '',
          koUsername: settingValue(latest, 'koUsername') || '',
          koMatchMethod: settingValue(latest, 'koMatchMethod'),
          koSyncBehavior: settingValue(latest, 'koSyncBehavior'),
          koSendMetadata: settingValue(latest, 'koSendMetadata'),
          savedAt: new Date().toISOString(),
        });
        restoreButton.hidden = false;
        await writeSettings({
          koServerUrl: KOSYNC_URL,
          koUsername: 'ybx',
          koPassword: key,
          koMatchMethod: 1,
          koSyncBehavior: 1,
          koSendMetadata: 1,
        });
        // POST may succeed while firmware drops unknown keys. The readback
        // validates visible settings; server auth validates the credential.
        // Only the reader's next sync proves its masked password was stored.
        await verifyPluginSync(key);
        syncValue.textContent = 'YBX · через плагин';
        syncButton.textContent = 'Обновить ключ KOSync';
        message('Адрес сохранён, сервер принимает ключ. Проверьте '
          + 'фактическую синхронизацию позиции на ридере.', 'ok');
      } catch (error) {
        message('Не удалось настроить синхронизацию: ' + error.message, 'err');
      } finally {
        // After confirmation or cancellation, this action remains available
        // for future QR re-logins and key rotations.
        syncButton.disabled = !token;
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
      sleepCardEnabled = sleepHandlerOn(await readSleepDevice());
    } catch (error) {
      sleepCardEnabled = null;
    }
    const sleepButton = document.createElement('button');
    sleepButton.type = 'button';
    sleepButton.className = 'primary';
    sleepButton.onclick = async () => {
      const turningOn = sleepCardEnabled !== true;
      sleepButton.disabled = true;
      message(turningOn ? 'Включаем экран сна со статистикой…' : 'Выключаем экран сна…');
      try {
        if (turningOn) {
          const slot = await readSleepFile(SLEEP_SLOT);
          if (slot && !ownsSleepSlot(slot) && !window.confirm(
              'В /sleep.bmp лежит ваша картинка. YBX сохранит её рядом и вернёт, '
              + 'когда вы выключите статистику на экране сна.\n\nПродолжить?')) {
            message('Включение отменено: ваша картинка в /sleep.bmp не тронута.');
            return;
          }
        }
        const outcome = await setSleepCard(turningOn, sleepMode);
        sleepCardEnabled = turningOn;
        if (turningOn) {
          sleepMode = CARD_MODE;
        } else if (sleepMode === CARD_MODE || sleepMode === COVER_CUSTOM_MODE) {
          sleepMode = COVER_MODE;
        }
        paintSleepState();
        message(turningOn
          ? 'Статистика на экране сна включена: перед засыпанием ридер скачает свежую карточку.'
          : outcome === 'restored'
            ? 'Статистика выключена — ваша прежняя картинка возвращена в /sleep.bmp.'
            : outcome === 'cleared'
              ? 'Статистика выключена: карточка убрана, ридер снова возьмёт обои из /.sleep.'
              : 'Статистика выключена: прошивка больше не скачивает карточку, '
                + 'а ваша картинка в /sleep.bmp осталась на месте.', 'ok');
      } catch (error) {
        message('Не удалось изменить экран сна со статистикой: ' + error.message, 'err');
        paintSleepState();
      }
    };

    const sleepCardButton = document.createElement('button');
    sleepCardButton.type = 'button';
    sleepCardButton.className = 'primary';
    sleepCardButton.textContent = 'Обновить карточку сна';
    sleepCardButton.onclick = async () => {
      sleepCardButton.disabled = true;
      message('Загружаем карточку сна…');
      try {
        await refreshSleepCard();
        message('Карточка обновлена: она появится при следующем засыпании.', 'ok');
      } catch (error) {
        message('Не удалось обновить карточку: ' + error.message, 'err');
      } finally {
        paintSleepState();
      }
    };

    const paintSleepState = () => {
      const on = sleepCardEnabled === true;
      sleepValue.textContent = (SLEEP_MODES[sleepMode] || 'режим не определён')
        + (sleepCardEnabled === null ? ' · переключатель не прочитан'
          : on ? ' · статистика' : ' · обои ридера');
      sleepButton.textContent = on ? 'Выключить экран сна со статистикой'
        : 'Включить экран сна со статистикой';
      sleepButton.disabled = !token || sleepCardEnabled === null;
      sleepCardButton.disabled = !token || !on;
      sleepHint.hidden = sleepMode !== COVER_CUSTOM_MODE || !on;
      sleepHint.textContent = sleepHint.hidden
        ? ''
        : 'Сейчас «Обложка + Свой»: карточка появится, только если сон не из книги. '
          + 'Выберите «Свой», чтобы статистика была на каждом засыпании.';
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
          message('Файл уже есть: ' + existing.join(', ') + '. Нажмите ещё раз, чтобы перезаписать.');
          return;
        }
        const results = await exportReadingStats();
        const saved = results.filter((item) => item.ok).length;
        const missed = results.filter((item) => !item.ok).map((item) => item.path + ' (' + item.detail + ')');
        if (!saved) throw new Error(missed.join('; '));
        if (missed.length) {
          message('Сохранено ' + saved + ' из ' + results.length + ' — не записался ' + missed.join(', ') + '.', 'err');
        } else {
          message('Сохранено ' + saved + ' из ' + results.length + ': файл ждёт импорта.', 'ok');
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
          ? 'Импорт: Настройки → Приложения → Reading Stats → Import Statistics → '
            + 'источник vCodex → выбрать его ещё раз для подтверждения.'
          : 'Файл на карте: /.crosspoint/reading_stats.json и /exports/stats_exported. '
            + 'Если в прошивке есть страница Import Statistics, откройте её и выберите '
            + 'источник vCodex (второй раз — для подтверждения); если такой страницы нет, '
            + 'файл просто останется на карте.';
        const caveat = document.createElement('p');
        caveat.className = 'ybx-hint';
        caveat.style.marginTop = '8px';
        caveat.style.paddingTop = '0';
        caveat.style.borderTop = 'none';
        caveat.textContent = 'Импорт аддитивный и одноразовый по каждой книге: сессии, суммы и даты '
          + 'чтения переносятся один раз, повторная выгрузка уже импортированные книги не пересчитает. '
          + 'Счётчиков перелистываний в облаке нет, поэтому они не выдумываются.';
        const detected = document.createElement('p');
        detected.className = 'ybx-hint';
        detected.style.marginTop = '8px';
        detected.textContent = 'Прошивка: ' + (info.family || 'неизвестно')
          + (info.version ? ' ' + info.version : '')
          + '; возможности: ' + (info.capabilities.join(', ') || 'не сообщаются') + '.';
        const detailsTitle = document.createElement('summary');
        detailsTitle.textContent = 'Как импортировать статистику';
        statsHint.replaceChildren(detailsTitle, steps, caveat, detected);
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
    updateBannerHint.textContent = 'Обновите плагин здесь, или на ридере: '
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
        if (!window.confirm('Не удалось отозвать ключ на сервере: ' + error.message
          + '\n\nУдалить локальную привязку всё равно? Ранее выданные ключи могут остаться активными. '
          + 'Для полного отключения удалите устройство в кабинете YBX.')) {
          message('Отвязка отменена: для отзыва ключа необходимо подключение к YBX.', 'err');
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
          : 'Локальная привязка удалена. Полный отзыв доступа не подтверждён — удалите устройство в кабинете YBX.';
        message(resultMessage + (cleanupWarnings.length ? ' ' + cleanupWarnings.join('; ') + '.' : ''),
          revoked && !cleanupWarnings.length ? 'ok' : 'err');
      } catch (error) {
        message('Ключ на сервере ' + (revoked ? 'отозван' : 'не подтверждён') +
          ', но очистить локальные настройки не удалось: ' + error.message, 'err');
      } finally {
        signOutButton.disabled = false;
      }
    };
    actions.append(sleepButton, sleepCardButton, statsButton, syncButton, restoreButton, checkButton, updateButton, signOutButton);
    settings.appendChild(rows);
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

  function renderSignedOut() {
    // Состояние «ещё раз, чтобы перезаписать» живёт до отвязки или перезагрузки.
    statsArmed = false;
    profile.replaceChildren();
    settingsWrap.replaceChildren();
    message('Ридер ещё не привязан. Откройте Home → Plugins → YBX на ридере и войдите по QR-коду.');
    const hint = document.createElement('section');
    hint.className = 'ybx-section';
    const text = document.createElement('p');
    text.className = 'ybx-hint';
    text.style.marginTop = '0';
    text.textContent = 'После входа здесь появятся статистика чтения, серия дней, цель года и достижения.';
    hint.appendChild(text);
    profile.appendChild(hint);
  }

  async function refresh() {
    await ensureDeviceConfig();
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
      try { await reconcileSleepCard(); } catch { /* переключатель покажет причину */ }
      await loadProfile();
      message('Ридер подключён к YBX. Каталог — Home → Plugins → YBX.', 'ok');
    } catch (error) {
      if (error.status === 409) {
        // The plugin token is fine: only the books consent is missing, so the
        // reader must not be told to sign in again.
        const detail = error.detail || {};
        message(typeof detail.message === 'string' && detail.message
          ? detail.message + ' Затем обновите эту страницу.'
          : 'Подключите книги в кабинете YBX и обновите эту страницу.', 'err');
      } else if (error.status === 401) {
        message('Сессия плагина недействительна. Откройте Home → Plugins → YBX и войдите заново.', 'err');
        renderSignedOut();
      } else {
        message('Не удалось загрузить статистику: ' + error.message, 'err');
      }
    }
  }

  await refresh();
});
