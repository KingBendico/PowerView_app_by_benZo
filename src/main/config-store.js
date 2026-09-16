const fs = require('node:fs');
const path = require('node:path');
const { normalizeAddress } = require('./gateway-client');
const defaults = () => ({ schemaVersion: 2, ipAddress: '', theme: 'light', closeToTray: false, favorites: {}, recent: {}, roomSort: 'default', prefsMigrated: false });
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
module.exports = { ConfigStore, cleanConfig, defaults };
