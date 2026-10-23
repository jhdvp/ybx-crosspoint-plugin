// YBX — web-настройки SD-плагина CrossPoint.
//
// Сам плагин (device.json) уже умеет вход по QR и нативный каталог. Эта страница
// нужна для того, чего нельзя сделать с экрана ридера: включить встроенный
// KOReader Sync на device-scoped KOSync YBX и обновить плагин без Plugin Hub.
CrossPoint.registerPlugin(async (container, api) => {
  'use strict';

  const DIR = api.dir || '/.crosspoint/plugins/ybx';
  const TOKEN_PATH = DIR + '/token.json';
  const UPDATE_URL = 'https://ybx.app/crosspoint-plugin/latest.json';
  const KOSYNC_URL = 'https://my.ybx.app/api/v1/crosspoint/kosync';
  const SYNC_OFF = { koServerUrl: '', koUsername: '', koPassword: '' };

  const el = (tag, text) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    container.appendChild(node);
    return node;
  };
  const row = () => el('div', undefined);
  const b64 = (text) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));

  el('h2', 'YBX');
  const status = el('p', 'Проверка состояния…');
  status.setAttribute('role', 'status');
  const info = el('p', '');
  info.style.color = 'var(--label-color)';

  const syncRow = row();
  const syncButton = document.createElement('button');
  syncButton.type = 'button';
  syncButton.textContent = 'Настроить KOReader Sync';
  syncRow.appendChild(syncButton);

  const updateRow = row();
  const checkButton = document.createElement('button');
  checkButton.type = 'button';
  checkButton.textContent = 'Проверить обновление';
  const updateButton = document.createElement('button');
  updateButton.type = 'button';
  updateButton.textContent = 'Обновить';
  updateButton.hidden = true;
  updateRow.appendChild(checkButton);
  updateRow.appendChild(document.createTextNode(' '));
  updateRow.appendChild(updateButton);

  const signOutRow = row();
  const signOutButton = document.createElement('button');
  signOutButton.type = 'button';
  signOutButton.textContent = 'Отвязать устройство';
  signOutRow.appendChild(signOutButton);

  const message = (text) => { status.textContent = text; };
  let token = null;

  async function readJson(path) {
    const res = await fetch('/download?path=' + encodeURIComponent(path));
    if (!res.ok) return null;
    try { return await res.json(); } catch { return null; }
  }
  async function writeJson(path, value) {
    await api.writeFile(path, b64(JSON.stringify(value)));
  }
  async function readSettings() {
    const res = await fetch('/api/settings');
    return res.ok ? await res.json() : [];
  }
  async function writeSettings(settings) {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    if (!res.ok) throw new Error('settings HTTP ' + res.status);
  }
  const settingValue = (settings, key) => settings.find((item) => item.key === key)?.value;
  const pointsToYbx = (settings) => settingValue(settings, 'koServerUrl') === KOSYNC_URL;

  async function version() {
    try {
      const res = await fetch(api.pluginFile('manifest.json'), { cache: 'no-store' });
      return (await res.json()).version || '';
    } catch { return ''; }
  }

  async function refresh() {
    token = await readJson(TOKEN_PATH);
    const current = await version();
    info.textContent = current ? 'Версия плагина: ' + current : '';
    if (token && token.access_token) {
      message('Устройство привязано. Каталог: Home → Plugins → YBX.');
      syncButton.disabled = false;
      signOutButton.disabled = false;
      const settings = await readSettings();
      syncButton.textContent = pointsToYbx(settings) ? 'KOReader Sync включён' : 'Настроить KOReader Sync';
      syncButton.disabled = pointsToYbx(settings);
    } else {
      message('Не привязано: откройте Home → Plugins → YBX на ридере и войдите по QR-коду.');
      syncButton.disabled = true;
      signOutButton.disabled = true;
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
        koMatchMethod: 1, // Binary: книги сопоставляются по partial MD5
        koSyncBehavior: 1, // Smart
        koSendMetadata: 1, // title/authors для привязки к книге в YBX
      });
      message('KOReader Sync настроен. Проверьте его в Настройки → Подключения → KOReader Sync.');
      syncButton.textContent = 'KOReader Sync включён';
    } catch (error) {
      message('Не удалось настроить синхронизацию: ' + error.message);
      syncButton.disabled = false;
    }
  };

  const isNewer = (latest, current) => {
    const a = String(latest).split('.').map(Number);
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
      const current = await version();
      if (isNewer(latest.version, current)) {
        updateButton.hidden = false;
        message('Доступна версия ' + latest.version + '.');
      } else {
        updateButton.hidden = true;
        message('Установлена последняя версия (' + current + ').');
      }
    } catch (error) {
      message('Не удалось проверить обновление: ' + error.message);
    } finally {
      checkButton.disabled = false;
    }
  };

  async function loadJsZip() {
    if (window.JSZip) return window.JSZip;
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/js/jszip.min.js';
      script.onload = resolve;
      script.onerror = () => reject(new Error('JSZip недоступен в этой прошивке'));
      document.head.appendChild(script);
    });
    return window.JSZip;
  }

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
      const files = Object.values(archive.files).filter((entry) => !entry.dir);
      if (!files.length) throw new Error('пустой архив');
      for (const entry of files) {
        const name = entry.name.replace(/^ybx\//, '');
        if (!/^(manifest\.json|device\.json|plugin\.json|plugin\.js|README\.md|icon\.png)$/.test(name)) continue;
        const bytes = await entry.async('uint8array');
        let binary = '';
        for (const byte of bytes) binary += String.fromCharCode(byte);
        await api.writeFile(DIR + '/' + name, btoa(binary));
      }
      await fetch('/delete', { method: 'POST', body: new URLSearchParams({ path: zipPath }) });
      message('Обновлено до ' + latest.version + '. Перезагрузите страницу.');
      updateButton.hidden = true;
    } catch (error) {
      message('Не удалось обновить: ' + error.message);
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
      message('Устройство отвязано. Чтобы подключить заново, войдите на ридере по QR-коду.');
    } catch (error) {
      message('Не удалось отвязать: ' + error.message);
    } finally {
      signOutButton.disabled = false;
    }
  };

  await refresh();
});
