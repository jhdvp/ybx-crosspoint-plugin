// YBX — веб-интерфейс SD-плагина CrossPoint.
//
// Плагин на устройстве (device.json) открывает каталог и вход по QR. Эта
// страница повторяет экран «Профиль» читалки YBX: сегодня/серия/неделя/год,
// полоса недели, «Продолжить чтение» и достижения. Здесь же — KOReader Sync,
// обновление плагина и отвязка, потому что с экрана ридера это недоступно.
CrossPoint.registerPlugin(async (container, api) => {
  'use strict';

  const DIR = api.dir || '/.crosspoint/plugins/ybx';
  const TOKEN_PATH = DIR + '/token.json';
  const API = 'https://my.ybx.app';
  const UPDATE_URL = 'https://ybx.app/crosspoint-plugin/latest.json';
  const KOSYNC_URL = API + '/api/v1/crosspoint/kosync';
  const SYNC_OFF = { koServerUrl: '', koUsername: '', koPassword: '' };

  if (!document.getElementById('ybx-plugin-style')) {
    const style = document.createElement('style');
    style.id = 'ybx-plugin-style';
    style.textContent = `
      .ybx { --paper:#e7e8e3; --plate:#dddfd8; --ink:#14161a; --soft:#5d625d;
        --line:#c3c6be; --accent:#ffdb4d; --ok:#1f6b35; --err:#a32b2b;
        max-width:640px; margin:0 auto; padding:20px; background:var(--paper);
        color:var(--ink); border:1px solid var(--line);
        font-family:"Golos Text","Segoe UI",system-ui,sans-serif;
        font-size:15px; line-height:1.5; -webkit-font-smoothing:antialiased; }
      .ybx * { box-sizing:border-box; }
      .ybx [hidden] { display:none !important; }
      .ybx-head { display:flex; align-items:baseline; justify-content:space-between;
        gap:12px; margin:0 0 14px; }
      .ybx-word { font-family:"Martian Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
        font-weight:700; font-size:22px; letter-spacing:-.04em; margin:0; }
      .ybx-tag { font-family:"Martian Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
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
      .ybx-h h2 { margin:0; font-family:"Martian Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
        font-size:12px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; }
      .ybx-h span { color:var(--soft); font-size:12px; }
      .ybx-metrics { display:grid; grid-template-columns:repeat(2,1fr); gap:8px; }
      .ybx-metric { border:1px solid var(--line); background:var(--plate); padding:12px; }
      .ybx-metric b { display:block; font-family:"Martian Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
        font-size:26px; line-height:1.05; letter-spacing:-.03em; }
      .ybx-metric span { display:block; margin-top:4px; font-size:11px; text-transform:uppercase;
        letter-spacing:.06em; color:var(--soft); }
      .ybx-metric small { display:block; margin-top:6px; font-size:11px; color:var(--soft); }
      .ybx-goal { margin-top:8px; border:1px solid var(--line); background:var(--plate); padding:10px 12px; }
      .ybx-goal-line { display:flex; justify-content:space-between; gap:10px;
        font-size:12px; color:var(--soft); margin-bottom:6px; }
      .ybx-bar { height:4px; background:var(--line); overflow:hidden; }
      .ybx-bar i { display:block; height:100%; background:var(--ink); }
      .ybx-week { display:flex; align-items:flex-end; gap:6px; height:96px;
        padding:8px 10px; border:1px solid var(--line); background:var(--plate); }
      .ybx-day { flex:1; display:flex; flex-direction:column; align-items:center;
        justify-content:flex-end; gap:4px; height:100%; min-width:0; }
      .ybx-day i { display:block; width:100%; background:var(--ink); min-height:1px; }
      .ybx-day span { font-family:"Martian Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
        font-size:9px; color:var(--soft); }
      .ybx-list { display:grid; gap:6px; }
      .ybx-row { display:flex; align-items:center; justify-content:space-between;
        gap:12px; padding:10px 0; border-top:1px solid var(--line); }
      .ybx-row:first-child { border-top:0; }
      .ybx-label { font-family:"Martian Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
        font-size:11px; letter-spacing:.04em; text-transform:uppercase; color:var(--soft); }
      .ybx-value { font-size:14px; text-align:right; }
      .ybx-book { border:1px solid var(--line); background:var(--plate); padding:10px 12px; }
      .ybx-book b { display:block; font-size:14px; }
      .ybx-book span { display:block; color:var(--soft); font-size:12px; }
      .ybx-book em { display:block; margin-top:6px; font-style:normal;
        font-family:"Martian Mono",ui-monospace,SFMono-Regular,Menlo,monospace; font-size:11px; }
      .ybx-heat { display:grid; grid-template-columns:repeat(7,1fr); gap:4px; }
      .ybx-heat-head { display:grid; grid-template-columns:repeat(7,1fr); gap:4px;
        margin-bottom:4px; }
      .ybx-heat-head span { font-family:"Martian Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
        font-size:8px; color:var(--soft); text-align:center; }
      .ybx-cell { aspect-ratio:1; border:1px solid var(--line); background:var(--paper); }
      .ybx-cell[data-level="1"] { background:#c3c6be; }
      .ybx-cell[data-level="2"] { background:#8d9288; }
      .ybx-cell[data-level="3"] { background:#4e534d; }
      .ybx-cell[data-level="4"] { background:#14161a; }
      .ybx-cell.future { opacity:.22; }
      .ybx-cell.today { outline:2px solid var(--ink); outline-offset:-2px; }
      .ybx-ach { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:8px; }
      .ybx-card { border:1px solid var(--line); background:var(--plate); padding:10px;
        display:flex; flex-direction:column; gap:4px; min-width:0; }
      .ybx-card b { font-size:13px; line-height:1.25; overflow-wrap:anywhere; }
      .ybx-card span { font-size:11px; color:var(--soft); }
      .ybx-card .ybx-bar { margin-top:auto; }
      .ybx-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
      .ybx button, .ybx a.ybx-btn { appearance:none; min-height:44px; padding:10px 16px;
        border:1px solid var(--ink); background:transparent; color:var(--ink);
        font:inherit; font-weight:600; cursor:pointer; text-decoration:none;
        display:inline-flex; align-items:center; justify-content:center; }
      .ybx button.primary { background:var(--accent); }
      .ybx button:disabled { opacity:.45; cursor:default; }
      .ybx-hint { margin:16px 0 0; padding-top:12px; border-top:1px solid var(--line);
        color:var(--soft); font-size:13px; }
      .ybx-ver { font-family:"Martian Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
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
  const writeJson = (path, value) => api.writeFile(path, b64(JSON.stringify(value)));
  const readSettings = async () => {
    try {
      const res = await fetch('/api/settings');
      return res.ok ? await res.json() : [];
    } catch { return []; }
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
  const pointsToYbx = (settings) => settingValue(settings, 'koServerUrl') === KOSYNC_URL;
  const version = async () => {
    try {
      const res = await fetch(api.pluginFile('manifest.json'), { cache: 'no-store' });
      return (await res.json()).version || '';
    } catch { return ''; }
  };

  let token = null;

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
    const d = new Date(iso + 'T12:00:00');
    return Number.isNaN(d.getTime()) ? '' : names[d.getDay()];
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
      right.textContent = goal.delta > 0 ? '+' + goal.delta + ' к графику' : (goal.delta === 0 ? 'в графике' : goal.delta + ' к графику');
      line.append(left, right);
      const bar = document.createElement('div');
      bar.className = 'ybx-bar';
      const fill = document.createElement('i');
      fill.style.width = Math.max(0, Math.min(100, goal.goal ? (done / goal.goal) * 100 : 0)) + '%';
      bar.appendChild(fill);
      wrap.append(line, bar);
      profile.appendChild(wrap);
    }

    const days = Array.isArray(calendar && calendar.days) ? calendar.days : [];
    const byDate = new Map(days.map((day) => [day.date, day]));
    const today = summary.today ? new Date(summary.today + 'T12:00:00') : new Date();
    const week = [];
    for (let offset = 6; offset >= 0; offset -= 1) {
      const d = new Date(today.getTime() - offset * 86400000);
      const iso = d.toISOString().slice(0, 10);
      const day = byDate.get(iso);
      week.push({ iso, minutes: day && day.sources && day.sources.length ? day.minutes : 0 });
    }
    const max = Math.max(1, ...week.map((day) => day.minutes));
    const weekWrap = document.createElement('div');
    weekWrap.className = 'ybx-week';
    week.forEach((day) => {
      const column = document.createElement('div');
      column.className = 'ybx-day';
      const bar = document.createElement('i');
      bar.style.height = Math.max(2, Math.round((day.minutes / max) * 100)) + '%';
      bar.style.opacity = day.minutes ? '1' : '.25';
      const label = document.createElement('span');
      label.textContent = dayLabel(day.iso);
      column.append(bar, label);
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
    profile.replaceChildren();
    renderStats(summary, calendar);
    renderAchievements(achievements);
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
    sleepLabel.textContent = 'Экран сна';
    const sleepValue = document.createElement('span');
    sleepValue.className = 'ybx-value';
    sleepRow.append(sleepLabel, sleepValue);

    const syncRow = document.createElement('div');
    syncRow.className = 'ybx-row';
    const syncLabel = document.createElement('span');
    syncLabel.className = 'ybx-label';
    syncLabel.textContent = 'KOReader Sync';
    const syncValue = document.createElement('span');
    syncValue.className = 'ybx-value';
    const current = await readSettings();
    const synced = pointsToYbx(current);
    syncValue.textContent = synced ? 'включён' : 'выключен';
    syncRow.append(syncLabel, syncValue);
    rows.appendChild(sleepRow);
    rows.appendChild(syncRow);
    const syncButton = document.createElement('button');
    syncButton.type = 'button';
    syncButton.className = 'primary';
    syncButton.textContent = synced ? 'KOReader Sync настроен' : 'Настроить KOReader Sync';
    syncButton.disabled = !token || synced;
    syncButton.onclick = async () => {
      syncButton.disabled = true;
      message('Настраиваем KOReader Sync…');
      try {
        await writeSettings({
          koServerUrl: KOSYNC_URL,
          koUsername: 'ybx',
          koPassword: token.access_token,
          koMatchMethod: 1,
          koSyncBehavior: 1,
          koSendMetadata: 1,
        });
        syncValue.textContent = 'включён';
        syncButton.textContent = 'KOReader Sync настроен';
        message('Готово: позиция синхронизируется через YBX.', 'ok');
      } catch (error) {
        message('Не удалось настроить синхронизацию: ' + error.message, 'err');
        syncButton.disabled = false;
      }
    };
    const sleepMode = Number(settingValue(current, 'sleepScreen'));
    sleepValue.textContent = sleepMode === 2 ? 'статистика YBX' : 'другой режим';
    const sleepButton = document.createElement('button');
    sleepButton.type = 'button';
    sleepButton.className = 'primary';
    sleepButton.textContent = sleepMode === 2 ? 'Экран сна включён' : 'Показывать статистику на сне';
    sleepButton.disabled = sleepMode === 2;
    sleepButton.onclick = async () => {
      sleepButton.disabled = true;
      message('Включаем экран сна…');
      try {
        await writeSettings({ sleepScreen: 2 });
        sleepValue.textContent = 'статистика YBX';
        sleepButton.textContent = 'Экран сна включён';
        message('Готово: при засыпании ридер обновит картинку со статистикой.', 'ok');
      } catch (error) {
        message('Не удалось включить экран сна: ' + error.message, 'err');
        sleepButton.disabled = false;
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
    checkButton.onclick = async () => {
      checkButton.disabled = true;
      message('Проверяем обновление…');
      try {
        const res = await api.relay('GET', UPDATE_URL, {}, '');
        if (!res || res.status !== 200) throw new Error('HTTP ' + (res && res.status));
        latest = JSON.parse(res.body);
        if (isNewer(latest.version, versionText)) {
          updateButton.hidden = false;
          message('Доступна версия ' + latest.version + '.', 'ok');
        } else {
          updateButton.hidden = true;
          message('Установлена последняя версия (' + versionText + ').', 'ok');
        }
      } catch (error) {
        message('Не удалось проверить обновление: ' + error.message, 'err');
      } finally {
        checkButton.disabled = false;
      }
    };
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
    updateButton.onclick = async () => {
      if (!latest) return;
      updateButton.disabled = true;
      message('Скачиваем обновление…');
      const zipPath = DIR + '/update.zip';
      try {
        const download = await api.fetchToSd(latest.url, zipPath);
        if (download.error || (download.status && (download.status < 200 || download.status >= 300))) {
          throw new Error('скачивание: HTTP ' + (download.status || download.error));
        }
        const JSZip = await loadJsZip();
        const res = await fetch('/download?path=' + encodeURIComponent(zipPath));
        if (!res.ok) throw new Error('чтение архива: HTTP ' + res.status);
        const archive = await JSZip.loadAsync(await res.arrayBuffer());
        const allowed = /^(manifest\.json|device\.json|plugin\.json|plugin\.js|README\.md|icon\.png)$/;
        const entries = Object.values(archive.files)
          .filter((entry) => !entry.dir && allowed.test(entry.name.replace(/^ybx\//, '')));
        if (!entries.length) throw new Error('пустой архив');
        for (const entry of entries) {
          const name = entry.name.replace(/^ybx\//, '');
          const bytes = await entry.async('uint8array');
          let binary = '';
          for (const byte of bytes) binary += String.fromCharCode(byte);
          await api.writeFile(DIR + '/' + name, btoa(binary));
        }
        await fetch('/delete', { method: 'POST', body: new URLSearchParams({ path: zipPath }) });
        updateButton.hidden = true;
        message('Обновлено до ' + latest.version + '. Перезагрузите страницу.', 'ok');
      } catch (error) {
        message('Не удалось обновить: ' + error.message, 'err');
      } finally {
        updateButton.disabled = false;
      }
    };
    signOutButton.onclick = async () => {
      signOutButton.disabled = true;
      try {
        await writeJson(TOKEN_PATH, {});
        if (pointsToYbx(await readSettings())) await writeSettings(SYNC_OFF);
        token = null;
        renderSignedOut();
        message('Устройство отвязано. Чтобы подключить заново — войдите на ридере по QR-коду.', 'ok');
      } catch (error) {
        message('Не удалось отвязать: ' + error.message, 'err');
      } finally {
        signOutButton.disabled = false;
      }
    };
    actions.append(sleepButton, syncButton, checkButton, updateButton, signOutButton);
    settings.appendChild(rows);
    settings.appendChild(actions);
    settingsWrap.appendChild(settings);
  }

  function renderSignedOut() {
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
    token = await readJson(TOKEN_PATH);
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
      message('Ридер подключён к YBX. Каталог — Home → Plugins → YBX.', 'ok');
    } catch (error) {
      if (error.status === 401 || error.status === 409) {
        message('Сессия плагина недействительна. Откройте Home → Plugins → YBX и войдите заново.', 'err');
        renderSignedOut();
      } else {
        message('Не удалось загрузить статистику: ' + error.message, 'err');
      }
    }
  }

  await refresh();
});
