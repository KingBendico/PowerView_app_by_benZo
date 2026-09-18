const fs = require('node:fs');
const path = require('node:path');
const { normalizeAddress } = require('./gateway-client');
const { cleanSettings: cleanShortcutSettings } = require('../shared/shortcut-format');
const { cleanHome: cleanSavedControls } = require('../shared/saved-controls-format');
const defaults = () => ({ schemaVersion: 2, ipAddress: '', theme: 'light', closeToTray: false, favorites: {}, recent: {}, appearances: {}, shortcuts: {}, savedControls: {}, homeLayout: {}, homeHidden: {}, roomSort: 'default', prefsMigrated: false });
function cleanAppearance(value) {
  if (!value || !['shade', 'curtain'].includes(value.kind) || !['pleated', 'roller', 'slatted'].includes(value.fabric)
    || value.color !== null && !/^#[a-f0-9]{6}$/i.test(value.color)
    || value.draw !== undefined && !['split', 'left', 'right'].includes(value.draw)) throw new Error('Choose a valid shade style, curtain opening and fabric color.');
  return { kind: value.kind, fabric: value.fabric, color: value.color, draw: value.draw ?? 'split' };
}
function cleanConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid settings');
  const config = defaults();
  if (raw.ipAddress) config.ipAddress = normalizeAddress(raw.ipAddress);
  if (['light', 'dark', 'system'].includes(raw.theme)) config.theme = raw.theme;
  config.closeToTray = raw.closeToTray === true;
  config.prefsMigrated = raw.prefsMigrated === true;
  if (['default', 'az', 'recent'].includes(raw.roomSort)) config.roomSort = raw.roomSort;
  if (raw.recent && typeof raw.recent === 'object') {
    for (const [host, value] of Object.entries(raw.recent).slice(0, 100)) {
      if (host === '__proto__' || !value) continue;
      const clean = key => Array.isArray(value[key]) ? value[key].filter(item => item && /^\d+$/.test(String(item.id)))
        .slice(0, 8).map(item => ({ id: String(item.id), name: String(item.name || '').slice(0, 200), at: Number(item.at) || 0 })) : [];
      config.recent[host] = { scenes: clean('scenes'), rooms: clean('rooms') };
    }
  }
  if (raw.favorites && typeof raw.favorites === 'object' && !Array.isArray(raw.favorites)) {
    for (const [host, favorites] of Object.entries(raw.favorites).slice(0, 100)) {
      if (host === '__proto__' || !favorites || typeof favorites !== 'object') continue;
      const list = key => Array.isArray(favorites[key]) ? [...new Set(favorites[key].filter(v => typeof v === 'string' && /^\d+$/.test(v)))].slice(0, 200) : [];
      config.favorites[host] = { shadeIds: list('shadeIds'), sceneIds: list('sceneIds') };
    }
  }
  if (raw.appearances && typeof raw.appearances === 'object' && !Array.isArray(raw.appearances)) {
    for (const [host, entries] of Object.entries(raw.appearances).slice(0, 100)) {
      if (['__proto__', 'constructor', 'prototype'].includes(host) || !entries || typeof entries !== 'object') continue;
      config.appearances[host] = {};
      for (const [id, appearance] of Object.entries(entries).slice(0, 500)) {
        if (!/^\d+$/.test(id)) continue;
        try { config.appearances[host][id] = cleanAppearance(appearance); } catch { /* Ignore one invalid visual preference. */ }
      }
    }
  }
  if (raw.shortcuts && typeof raw.shortcuts === 'object' && !Array.isArray(raw.shortcuts)) {
    for (const [host, settings] of Object.entries(raw.shortcuts).slice(0, 100)) {
      if (['__proto__', 'constructor', 'prototype'].includes(host)) continue;
      try { config.shortcuts[host] = cleanShortcutSettings(settings); } catch { /* Invalid bindings must never become global commands. */ }
    }
  }
  if (raw.savedControls && typeof raw.savedControls === 'object' && !Array.isArray(raw.savedControls)) {
    for (const [host, value] of Object.entries(raw.savedControls).slice(0, 100)) {
      if (['__proto__', 'constructor', 'prototype'].includes(host)) continue;
      try { config.savedControls[host] = cleanSavedControls(value); } catch { /* Ignore invalid stored movement instructions. */ }
    }
  }
  if (raw.homeLayout && typeof raw.homeLayout === 'object' && !Array.isArray(raw.homeLayout)) {
    const allowed = new Set(['overview', 'scenes', 'saved', 'pinned', 'rooms']);
    for (const [host, order] of Object.entries(raw.homeLayout).slice(0, 100)) {
      if (['__proto__', 'constructor', 'prototype'].includes(host) || !Array.isArray(order)) continue;
      const clean = [...new Set(order.filter(item => typeof item === 'string' && allowed.has(item)))];
      if (clean.length) config.homeLayout[host] = clean;
    }
  }
  if (raw.homeHidden && typeof raw.homeHidden === 'object' && !Array.isArray(raw.homeHidden)) {
    const allowed = new Set(['overview', 'scenes', 'saved', 'pinned', 'rooms']);
    for (const [host, hidden] of Object.entries(raw.homeHidden).slice(0, 100)) {
      if (['__proto__', 'constructor', 'prototype'].includes(host) || !Array.isArray(hidden)) continue;
      const clean = [...new Set(hidden.filter(item => typeof item === 'string' && allowed.has(item)))];
      config.homeHidden[host] = clean;
    }
  }
  return config;
}
class ConfigStore {
  constructor(directory) {
    this.directory = directory; this.filename = path.join(directory, 'config.json'); this.notice = null;
    fs.mkdirSync(directory, { recursive: true });
    try { this.value = fs.existsSync(this.filename) ? cleanConfig(JSON.parse(fs.readFileSync(this.filename, 'utf8'))) : defaults(); }
    catch {
      if (fs.existsSync(this.filename)) fs.copyFileSync(this.filename, `${this.filename}.recovery-${Date.now()}`);
      this.value = defaults(); this.notice = 'Your saved settings could not be read. A backup was kept; please reconnect your gateway.';
    }
    const legacy = path.join(directory, 'prefs.json');
    if (!this.value.prefsMigrated && fs.existsSync(legacy)) {
      try {
        const prefs = JSON.parse(fs.readFileSync(legacy, 'utf8'));
        const host = this.value.ipAddress;
        this.value = cleanConfig({ ...this.value, theme: prefs.theme, roomSort: prefs.roomSort, prefsMigrated: true,
          favorites: { ...this.value.favorites, ...(host ? { [host]: { shadeIds: [], sceneIds: (prefs.favoriteScenes || []).map(item => String(item.id)) } } : {}) },
          recent: host ? { [host]: { scenes: prefs.recentScenes, rooms: prefs.recentRooms } } : {} });
      } catch { this.notice = 'Some old preferences could not be imported. The original prefs.json has been kept.'; }
    }
  }
  get() { return structuredClone(this.value); }
  save(value) {
    const next = cleanConfig(value); const temporary = `${this.filename}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(next, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, this.filename); this.value = next;
    return this.get();
  }
}
module.exports = { ConfigStore, cleanConfig, cleanAppearance, defaults };
