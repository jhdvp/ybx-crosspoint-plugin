// YBX — web-настройки SD-плагина CrossPoint.
//
// Сам плагин (device.json) умеет вход по QR и нативный каталог. Эта страница —
// для того, чего нельзя сделать с экрана ридера: включить встроенный KOReader
// Sync на device-scoped KOSync YBX и обновить плагин без Plugin Hub.
CrossPoint.registerPlugin(async (container, api) => {
  'use strict';

  const DIR = api.dir || '/.crosspoint/plugins/ybx';
  const TOKEN_PATH = DIR + '/token.json';
  const UPDATE_URL = 'https://ybx.app/crosspoint-plugin/latest.json';
  const KOSYNC_URL = 'https://my.ybx.app/api/v1/crosspoint/kosync';
  const SYNC_OFF = { koServerUrl: '', koUsername: '', koPassword: '' };

  // Стиль YBX: бумага, чернила, жёлтый акцент, моно-подписи. Без внешних
  // шрифтов и анимаций — страница живёт на e-ink устройстве.
  if (!document.getElementById('ybx-plugin-style')) {
    const style = document.createElement('style');
    style.id = 'ybx-plugin-style';
    style.textContent = `
      .ybx { --paper:#e7e8e3; --plate:#dddfd8; --ink:#14161a; --soft:#5d625d;
        --line:#c3c6be; --accent:#ffdb4d; --ok:#1f6b35; --err:#a32b2b;
        max-width:560px; margin:0 auto; padding:20px; background:var(--paper);
        color:var(--ink); border:1px solid var(--line);
        font-family:"Golos Text","Segoe UI",system-ui,sans-serif;
        font-size:15px; line-height:1.5; -webkit-font-smoothing:antialiased; }
      .ybx * { box-sizing:border-box; }
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
      .ybx-row { display:flex; align-items:center; justify-content:space-between;
        gap:12px; padding:12px 0; border-top:1px solid var(--line); }
      .ybx-row:first-of-type { border-top:0; }
      .ybx-label { font-family:"Martian Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
        font-size:11px; letter-spacing:.04em; text-transform:uppercase;
        color:var(--soft); }
      .ybx-value { font-size:14px; text-align:right; }
      .ybx-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:14px; }
      .ybx button, .ybx a.ybx-btn { appearance:none; min-height:44px; padding:10px 16px;
        border:1px solid var(--ink); background:transparent; color:var(--ink);
        font:inherit; font-weight:600; cursor:pointer; text-decoration:none;
        display:inline-flex; align-items:center; justify-content:center; }
      .ybx button.primary, .ybx a.ybx-btn.primary { background:var(--accent); }
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

  const head = document.createElement('header');
  head.className = 'ybx-head';
  head.innerHTML = '<h1 class="ybx-word">YBX</h1><span class="ybx-tag">CrossPoint</span>';
  root.appendChild(head);

  const status = el('p', 'ybx-status', 'Проверка состояния…');
  status.setAttribute('role', 'status');

  const accountRow = el('div', 'ybx-row');
  const accountLabel = document.createElement('span');
  accountLabel.className = 'ybx-label';
  accountLabel.textContent = 'Устройство';
  const accountValue = document.createElement('span');
  accountValue.className = 'ybx-value';
  accountRow.append(accountLabel, accountValue);

  const syncRow = el('div', 'ybx-row');
  const syncLabel = document.createElement('span');
  syncLabel.className = 'ybx-label';
  syncLabel.textContent = 'KOReader Sync';
  const syncValue = document.createElement('span');
  syncValue.className = 'ybx-value';
  syncValue.textContent = 'не настроен';
  syncRow.append(syncLabel, syncValue);

  const versionRow = el('div', 'ybx-row');
  const versionLabel = document.createElement('span');
  versionLabel.className = 'ybx-label';
  versionLabel.textContent = 'Версия';
  const versionValue = document.createElement('span');
  versionValue.className = 'ybx-value ybx-ver';
  versionRow.append(versionLabel, versionValue);

  const actions = el('div', 'ybx-actions');
  const syncButton = document.createElement('button');
  syncButton.type = 'button';
  syncButton.className = 'primary';
  syncButton.textContent = 'Настроить KOReader Sync';
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
  actions.append(syncButton, checkButton, updateButton, signOutButton);

  const hint = el('p', 'ybx-hint',
    'Вход и каталог — на ридере: Home → Plugins → YBX. ' +
    'Отвязка стирает ключ плагина на карте памяти.');

  const message = (text, kind) => {
    status.textContent = text;
    status.className = 'ybx-status' + (kind ? ' ' + kind : '');
  };

  let token = null;
  const b64 = (text) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));
  async function readJson(path) {
    try {
      const res = await fetch('/download?path=' + encodeURIComponent(path));
      return res.ok ? await res.json() : null;
    } catch { return null; }
  }
  const writeJson = (path, value) => api.writeFile(path, b64(JSON.stringify(value)));
  const readSettings = async () => {
    try {
      const res = await fetch('/api/settings');
      return res.ok ? await res.json() : [];
    } catch { return []; }
  };
  const writeSettings = async (settings) => {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    if (!res.ok) throw new Error('settings HTTP ' + res.status);
  };
  const settingValue = (settings, key) => settings.find((item) => item.key === key)?.value;
  const pointsToYbx = (settings) => settingValue(settings, 'koServerUrl') === KOSYNC_URL;
  const currentVersion = async () => {
    try {
      const res = await fetch(api.pluginFile('manifest.json'), { cache: 'no-store' });
      return (await res.json()).version || '';
    } catch { return ''; }
  };

  async function refresh() {
    token = await readJson(TOKEN_PATH);
    const version = await currentVersion();
    versionValue.textContent = version || '—';
    if (token && token.access_token) {
      accountValue.textContent = 'привязано';
      signOutButton.disabled = false;
      const settings = await readSettings();
      const synced = pointsToYbx(settings);
      syncValue.textContent = synced ? 'настроен (YBX)' : 'не настроен';
      syncButton.disabled = synced;
      syncButton.textContent = synced ? 'KOReader Sync настроен' : 'Настроить KOReader Sync';
      message('Ридер подключён к YBX. Каталог — Home → Plugins → YBX.', 'ok');
    } else {
      accountValue.textContent = 'не привязано';
      syncValue.textContent = '—';
      syncButton.disabled = true;
      signOutButton.disabled = true;
      message('Ридер ещё не привязан. Откройте Home → Plugins → YBX на ридере и войдите по QR-коду.');
    }
  }

  syncButton.onclick = async () => {
    if (!token || !token.access_token) return;
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
      syncValue.textContent = 'настроен (YBX)';
      syncButton.textContent = 'KOReader Sync настроен';
      message('Готово: позиция синхронизируется через YBX.', 'ok');
    } catch (error) {
      message('Не удалось настроить синхронизацию: ' + error.message, 'err');
      syncButton.disabled = false;
    }
  };

  const isNewer = (next, current) => {
    const a = String(next).split('.').map(Number);
    const b = String(current).split('.').map(Number);
    for (let i = 0; i < 3; i += 1) {
      if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
    }
    return false;
  };
  let latest = null;

  checkButton.onclick = async () => {
    checkButton.disabled = true;
    message('Проверяем обновление…');
    try {
      const res = await api.relay('GET', UPDATE_URL, {}, '');
      if (!res || res.status !== 200) throw new Error('HTTP ' + (res && res.status));
      latest = JSON.parse(res.body);
      const current = await currentVersion();
      if (isNewer(latest.version, current)) {
        updateButton.hidden = false;
        message('Доступна версия ' + latest.version + '.', 'ok');
      } else {
        updateButton.hidden = true;
        message('Установлена последняя версия (' + (current || latest.version) + ').', 'ok');
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
      const settings = await readSettings();
      if (pointsToYbx(settings)) await writeSettings(SYNC_OFF);
      token = null;
      await refresh();
      message('Устройство отвязано. Чтобы подключить заново — войдите на ридере по QR-коду.', 'ok');
    } catch (error) {
      message('Не удалось отвязать: ' + error.message, 'err');
    } finally {
      signOutButton.disabled = false;
    }
  };

  await refresh();
});
