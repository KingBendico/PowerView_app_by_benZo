const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, screen, session, globalShortcut, powerMonitor, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { isIP } = require('node:net');
const { ConfigStore, cleanConfig } = require('./config-store');
const { Controller } = require('./controller');
const { Shortcuts } = require('./shortcuts');
const { SavedControls } = require('./saved-controls');
const { HomeInsights } = require('./home-insights');
const { GatewayClient, normalizeAddress } = require('./gateway-client');
const { Discovery } = require('./discovery');
const { NetworkScan, interfaces } = require('./network-scan');
app.setName('PowerView');
const basePath = path.resolve(__dirname, '../..');
const mainUrl = pathToFileURL(path.join(basePath, 'views/index.html')).href;
const dataArg = process.argv.find(value => value.startsWith('--data-dir='));
if (dataArg) app.setPath('userData', path.resolve(dataArg.slice(11)));
else if (process.argv.includes('--demo')) app.setPath('userData', path.join(app.getPath('userData'), 'demo-profile'));
let mainWindow, tray, controller, store, shortcuts, savedControls, insights, refreshTimer, quitting = false;
const discovery = new Discovery();
const scanner = new NetworkScan();
function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}
function trusted(event) {
  return mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents
    && event.senderFrame === event.sender.mainFrame && event.senderFrame.url === mainUrl;
}
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, payload) => {
    if (!trusted(event)) throw new Error('This request is not from the application window.');
    try { return { ok: true, value: await fn(payload) }; }
    catch (error) { return { ok: false, error: error.message || 'The request failed.' }; }
  });
}
function getPrefs() {
  const state = controller.getState(), config = state.config;
  const recent = config.recent[state.connection.address] || { scenes: [], rooms: [] };
  const nameFor = (kind, id) => state.snapshot?.[kind].find(item => item.id === id)?.name || id;
  return { theme: config.theme, closeToTray: config.closeToTray, roomSort: config.roomSort,
    favoriteScenes: state.favorites.sceneIds.map(id => ({ id, name: nameFor('scenes', id) })),
    favoriteShades: state.favorites.shadeIds, recentScenes: recent.scenes, recentRooms: recent.rooms,
    homeLayout: config.homeLayout[state.connection.address] || [], homeHidden: config.homeHidden[state.connection.address] || [] };
}
function setPrefs(prefs) {
  if (!prefs || typeof prefs !== 'object') throw new Error('Invalid preferences.');
  const state = controller.getState(), config = store.get(), address = state.connection.address;
  if (address) {
    const existing = config.favorites[address] || { shadeIds: [], sceneIds: [] };
    config.favorites[address] = { ...existing, sceneIds: Array.isArray(prefs.favoriteScenes)
      ? prefs.favoriteScenes.map(item => String(item.id)).filter(id => !state.snapshot || state.snapshot.scenes.some(scene => scene.id === id)) : existing.sceneIds };
    config.recent[address] = { scenes: prefs.recentScenes, rooms: prefs.recentRooms };
    if (Array.isArray(prefs.homeLayout)) {
      const allowed = new Set(['overview', 'scenes', 'saved', 'pinned', 'rooms']);
      const order = [...new Set(prefs.homeLayout.filter(item => typeof item === 'string' && allowed.has(item)))];
      if (order.length === 5) config.homeLayout[address] = order;
    }
    if (Array.isArray(prefs.homeHidden)) {
      const allowed = new Set(['overview', 'scenes', 'saved', 'pinned', 'rooms']);
      config.homeHidden[address] = [...new Set(prefs.homeHidden.filter(item => typeof item === 'string' && allowed.has(item)))];
    }
  }
  for (const key of ['theme', 'roomSort', 'closeToTray']) if (key in prefs) config[key] = prefs[key];
  controller.state.config = store.save(config); controller.publish(); return getPrefs();
}
function setFavorites(value) {
  if (!value || typeof value !== 'object') throw new Error('Invalid favorites.');
  const state = controller.getState(), config = store.get(), address = state.connection.address;
  if (!address || !state.snapshot) throw new Error('Connect to a gateway before editing favorites.');
  const valid = (items, collection) => [...new Set(Array.isArray(items) ? items.map(String).filter(id => collection.some(item => item.id === id)) : [])];
  const favorites = { shadeIds: valid(value.shadeIds, state.snapshot.shades), sceneIds: valid(value.sceneIds, state.snapshot.scenes) };
  config.favorites[address] = favorites; controller.state.favorites = favorites; controller.state.config = store.save(config); controller.publish(); return getPrefs();
}
async function exportSettings() {
  const result = await dialog.showSaveDialog(mainWindow, { title: 'Export PowerView settings', defaultPath: 'PowerView-settings.json', filters: [{ name: 'PowerView settings', extensions: ['json'] }] });
  if (result.canceled || !result.filePath) return { canceled: true };
  fs.writeFileSync(result.filePath, JSON.stringify({ format: 'PowerView settings', version: 1, exportedAt: new Date().toISOString(), config: store.get() }, null, 2), { mode: 0o600 });
  return { canceled: false, filePath: result.filePath };
}
async function importSettings() {
  const result = await dialog.showOpenDialog(mainWindow, { title: 'Import PowerView settings', properties: ['openFile'], filters: [{ name: 'PowerView settings', extensions: ['json'] }] });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8')); } catch { throw new Error('That file is not valid JSON.'); }
  const saved = store.save(cleanConfig(parsed?.config || parsed)); controller.state.config = saved;
  const address = controller.state.connection.address;
  controller.state.favorites = address ? saved.favorites[address] || { shadeIds: [], sceneIds: [] } : { shadeIds: [], sceneIds: [] };
  controller.publish(); return { canceled: false, filePath: result.filePaths[0] };
}
function showWindow(action) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
    if (action) mainWindow.webContents.once('did-finish-load', () => send('navigation', action));
  } else {
    mainWindow.show(); mainWindow.focus(); if (action) send('navigation', action);
  }
}
function finishShortcutEditing() {
  if (!shortcuts?.editing) return;
  shortcuts.setEditing(false);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.setIgnoreMenuShortcuts(false); send('navigation', 'close-shortcuts');
  }
}
function runTrayScene(id) {
  controller.activateScene(id).then(() => send('command-notice', 'Scene command accepted.'))
    .catch(error => { showWindow(); send('command-notice', error.message); });
}
function rebuildTrayMenu() {
  if (!tray || !controller) return;
  const state = controller.getState();
  const connected = ['connected', 'demo'].includes(state.connection.status);
  const favorites = state.favorites.sceneIds.flatMap(id => {
    const scene = state.snapshot?.scenes.find(item => item.id === id);
    return scene ? [{ label: scene.name.slice(0, 80), enabled: connected && !state.pending[`scene:${id}`], click: () => runTrayScene(id) }] : [];
  });
  tray.setToolTip(`PowerView — ${state.connection.status === 'demo' ? 'Demo home' : state.connection.status}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show PowerView', click: () => showWindow() },
    { label: state.connection.status === 'demo' ? 'Demo home' : state.connection.name || 'Gateway not connected', enabled: false },
    { type: 'separator' },
    { label: 'Favorite scenes', submenu: favorites.length ? favorites : [{ label: 'Star scenes in the app', enabled: false }] },
    { label: 'Settings…', click: () => showWindow('settings') },
    { type: 'separator' }, { label: 'Quit PowerView', click: () => app.quit() },
  ]));
}
function createMainWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({ width: Math.min(1080, width), height: Math.min(920, height), minWidth: 360, minHeight: 480,
    title: 'PowerView', autoHideMenuBar: true, show: !process.argv.includes('--smoke'),
    icon: path.join(basePath, 'assets/PowerView_T.png'),
    webPreferences: { preload: path.join(basePath, 'src/preload/preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  mainWindow.webContents.on('will-attach-webview', event => event.preventDefault());
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (shortcuts?.editing || input.type !== 'keyDown' || !input.control || input.meta || input.alt || input.shift || input.isAutoRepeat) return;
    const digit = /^(?:Digit|Numpad)([1-9])$/.exec(input.code || '')?.[1] || (/^[1-9]$/.test(input.key) ? input.key : null);
    if (digit) { event.preventDefault(); send('navigation', { roomIndex: Number(digit) - 1 }); }
  });
  mainWindow.on('close', event => {
    finishShortcutEditing();
    if (!quitting && tray && controller.state.config.closeToTray) { event.preventDefault(); mainWindow.hide(); }
  });
  mainWindow.on('hide', finishShortcutEditing);
  mainWindow.webContents.on('render-process-gone', finishShortcutEditing);
  mainWindow.webContents.on('did-start-loading', finishShortcutEditing);
  mainWindow.on('closed', () => { mainWindow = null; discovery.stop(); scanner.stop(); });
  mainWindow.loadURL(mainUrl);
  return mainWindow;
}
const SWAGGER_UI_PORT = 3002;
const SWAGGER_PROBE_MS = 3500;
const SWAGGER_ENABLE_TIMEOUT_MS = 10000;
const SWAGGER_STARTUP_WAIT_MS = 22000;
const SWAGGER_POLL_MS = 450;

function isIpv4(s) {
    return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(String(s || '').trim());
}

/** Returns true if something responds on the gateway Swagger UI port (Gen3). */
async function probeSwaggerUiPort(ip) {
    const host = String(ip || '').trim();
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), SWAGGER_PROBE_MS);
        const res = await fetch(`http://${host}:${SWAGGER_UI_PORT}/`, {
            signal: controller.signal,
            redirect: 'follow',
        });
        clearTimeout(timer);
        return res.status >= 200 && res.status < 500;
    } catch {
        return false;
    }
}

/**
 * If Swagger on :3002 is down (common after idle), hit /gateway/swagger?enable=true on port 80
 * and wait until the UI port answers before the user opens the browser.
 */
async function ensureSwaggerUiReady(ip) {
    const trimmed = String(ip || '').trim();
    if (!trimmed) {
        return { ok: false, error: 'No address entered.' };
    }
    if (!isIpv4(trimmed)) {
        return { ok: false, error: 'Enter a valid IPv4 address (e.g. 192.168.1.10).' };
    }

    if (await probeSwaggerUiPort(trimmed)) {
        return { ok: true };
    }

    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), SWAGGER_ENABLE_TIMEOUT_MS);
        const res = await fetch(`http://${trimmed}/gateway/swagger?enable=true`, {
            signal: controller.signal,
            redirect: 'follow',
        });
        clearTimeout(timer);
        if (!res.ok) {
            return { ok: false, error: `Could not enable Swagger (HTTP ${res.status}).` };
        }
    } catch (e) {
        const msg =
            e.name === 'AbortError'
                ? 'Timed out asking the gateway to start Swagger.'
                : e.message || 'Cannot reach gateway on port 80.';
        return { ok: false, error: msg };
    }

    const deadline = Date.now() + SWAGGER_STARTUP_WAIT_MS;
    while (Date.now() < deadline) {
        if (await probeSwaggerUiPort(trimmed)) {
            return { ok: true };
        }
        await new Promise((r) => setTimeout(r, SWAGGER_POLL_MS));
    }
    return {
        ok: false,
        error: 'Swagger on port 3002 did not start in time. Check the hub or try the button again.',
    };
}


function installHandlers() {
  handle('get-state', () => controller.getState());
  handle('get-insights', () => insights.getState());
  handle('refresh-insights', () => insights.refresh());
  handle('get-config', () => store.get());
  handle('get-prefs', getPrefs);
  handle('set-prefs', setPrefs);
  handle('set-favorites', setFavorites);
  handle('export-settings', exportSettings);
  handle('import-settings', importSettings);
  handle('get-shortcuts', () => shortcuts.getState());
  handle('get-saved-controls', () => savedControls.getState());
  handle('save-control', data => savedControls.save(data));
  handle('remove-control', data => savedControls.remove(data));
  handle('run-control', data => savedControls.run(data));
  handle('privacy-start', data => savedControls.startPrivacy(data));
  handle('privacy-cancel', id => savedControls.cancel(id));
  handle('privacy-restore', id => savedControls.restore(id));
  handle('save-shortcuts', data => {
    const result = shortcuts.save(data); mainWindow.webContents.setIgnoreMenuShortcuts(false); return result;
  });
  handle('edit-shortcuts', enabled => {
    const result = shortcuts.setEditing(enabled); mainWindow.webContents.setIgnoreMenuShortcuts(enabled); return result;
  });
  handle('connect', address => controller.connect(address));
  handle('refresh', () => controller.refresh());
  handle('demo', enabled => enabled === true ? controller.connect('', { demo: true }) : controller.leaveDemo());
  handle('move-shade', data => controller.moveShade({ id: String(data?.id), positions: data?.positions }));
  handle('shade-action', data => controller.shadeAction({ id: String(data?.id), action: data?.action }));
  handle('room-action', data => controller.roomAction({ roomId: data?.roomId == null ? null : String(data.roomId), action: data?.action }));
  handle('activate-scene', id => controller.activateScene(String(id)));
  handle('favorite', data => controller.toggleFavorite({ kind: data?.kind, id: String(data?.id) }));
  handle('shade-appearance', data => controller.setAppearance({ id: String(data?.id), appearance: data?.appearance }));
  handle('validate-gateway', async address => {
    const client = new GatewayClient(address);
    try { const identity = await client.identify(); await client.getSnapshot(); return identity; } finally { client.dispose(); }
  });
  handle('discover-gateway', () => discovery.start());
  handle('interfaces', interfaces);
  handle('scan-network', name => scanner.start(name, progress => send('scan-progress', progress)));
  handle('stop-scan', () => { scanner.stop(); discovery.stop(); });
  handle('open-swagger', async address => {
    const clean = normalizeAddress(address);
    if (isIP(clean) !== 4) throw new Error('Swagger requires a gateway IPv4 address without a port.');
    const result = await ensureSwaggerUiReady(clean);
    if (!result.ok) throw new Error(result.error);
    await shell.openExternal(`http://${clean}:3002/#/`); return 'Opened Swagger in your browser.';
  });
}
app.whenReady().then(async () => {
  store = new ConfigStore(app.getPath('userData')); controller = new Controller(store);
  insights = new HomeInsights(controller);
  insights.on('state', state => send('insights-state', state));
  savedControls = new SavedControls(controller, { notify: message => send('command-notice', message) });
  savedControls.on('state', state => send('saved-controls-state', state));
  powerMonitor.on('suspend', () => savedControls.cancelAll('Computer sleeping · timer cancelled.'));
  powerMonitor.on('resume', () => savedControls.cancelAll('Computer resumed · no late restore will run.'));
  shortcuts = new Shortcuts(controller, globalShortcut, { savedControls, notify: message => send('command-notice', message),
    toggleWindow: () => { if (mainWindow?.isVisible() && mainWindow.isFocused()) mainWindow.hide(); else showWindow(); } });
  shortcuts.on('state', state => send('shortcuts-state', state));
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  installHandlers();
  controller.on('state', state => { send('state', state); rebuildTrayMenu(); });
  const menu = [ { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] } ];
  if (process.platform === 'darwin') menu.unshift({ label: 'PowerView', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] });
  else menu.push({ label: 'File', submenu: [{ role: 'quit' }] });
  Menu.setApplicationMenu(Menu.buildFromTemplate(menu));
  createMainWindow();
  if (!process.argv.includes('--smoke')) {
    let icon = nativeImage.createFromPath(path.join(basePath, 'assets/PowerView_T.png'));
    if (!icon.isEmpty()) { icon = icon.resize({ width: 18, height: 18 }); tray = new Tray(icon); tray.on('click', () => showWindow()); rebuildTrayMenu(); }
    if (process.platform === 'darwin') app.dock.setIcon(path.join(basePath, 'assets/PowerView_T.png'));
  }
  if (process.argv.includes('--demo')) await controller.connect('', { demo: true }).catch(() => {});
  else if (store.get().ipAddress) await controller.connect(store.get().ipAddress).catch(() => {});
  refreshTimer = setInterval(() => {
    if (controller.client) { controller.refresh().catch(() => {}); void insights.refresh(); }
  }, 60000);
  app.on('activate', () => showWindow());
});
app.on('before-quit', () => { quitting = true; clearInterval(refreshTimer); discovery.stop(); scanner.stop(); shortcuts?.dispose(); savedControls?.dispose(); insights?.dispose(); controller?.dispose(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin' && !controller?.state.config.closeToTray) app.quit(); });
module.exports = { getWindow: () => mainWindow, getController: () => controller, getShortcuts: () => shortcuts, getSavedControls: () => savedControls, getInsights: () => insights };
