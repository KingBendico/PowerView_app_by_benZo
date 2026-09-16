const { isIP } = require('node:net');
const { capabilitiesFor, validatePositions } = require('./capabilities');

class GatewayError extends Error {
  constructor(message, code = 'GATEWAY_ERROR') { super(message); this.name = 'GatewayError'; this.code = code; }
}
function normalizeAddress(input) {
  if (typeof input !== 'string' || !input.trim() || input.length > 255) throw new GatewayError('Enter a gateway IP address or local hostname.', 'INVALID_ADDRESS');
  const value = input.trim();
  if (/\s|\\/.test(value)) throw new GatewayError('The gateway address contains invalid characters.', 'INVALID_ADDRESS');
  let url;
  try { url = new URL(value.includes('://') ? value : `http://${value}`); }
  catch { throw new GatewayError('Enter a valid gateway address, such as 192.168.1.20.', 'INVALID_ADDRESS'); }
  if (url.protocol !== 'http:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new GatewayError('Use the gateway hostname or IP address, without a path or login details.', 'INVALID_ADDRESS');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (!isIP(hostname) && (!/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(hostname)
    || hostname.split('.').some(part => !part || part.length > 63 || /^-|-$/.test(part)))) {
    throw new GatewayError('That gateway hostname is not valid.', 'INVALID_ADDRESS');
  }
  return url.host;
}
const id = value => {
  if ((typeof value !== 'number' && typeof value !== 'string') || !/^\d+$/.test(String(value))) throw new GatewayError('The gateway returned an invalid device ID.', 'INVALID_RESPONSE');
  return String(value);
};
const label = (item, fallback) => typeof item.ptName === 'string' && item.ptName.trim() ? item.ptName.slice(0, 200)
  : typeof item.name === 'string' && item.name.trim() ? item.name.slice(0, 200) : fallback;
function collection(value, name) {
  if (!Array.isArray(value) || value.length > 10000 || value.some(item => !item || typeof item !== 'object')) {
    throw new GatewayError(`This gateway did not return a valid ${name} list. PowerView Gen 3 is required.`, 'INVALID_RESPONSE');
  }
  return value;
}
function normalizeSnapshot({ rooms, shades, scenes, colors = {}, active = [] }, address) {
  const palette = Array.isArray(colors?.colors) ? colors.colors : [];
  return { address, lastUpdated: new Date().toISOString(),
    rooms: collection(rooms, 'room').map(room => ({ id: id(room.id), name: label(room, 'Unnamed room'),
      color: /^#[a-f0-9]{3}(?:[a-f0-9]{3})?$/i.test(palette[Number(room.color)]) ? palette[Number(room.color)] : '#7d9385' })),
    shades: collection(shades, 'shade').map(shade => {
      const positions = {};
      for (const key of ['primary', 'secondary', 'tilt']) {
        const value = shade.positions?.[key];
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1) positions[key] = Math.round(value * 100);
      }
      const capabilities = capabilitiesFor(shade);
      if (capabilities.code === 5 && positions.tilt === undefined && positions.primary !== undefined) {
        positions.tilt = positions.primary; delete positions.primary;
      }
      return { id: id(shade.id), roomId: shade.roomId == null ? null : id(shade.roomId), name: label(shade, 'Unnamed shade'),
        type: Number(shade.type), capabilities: shade.capabilities, controls: capabilities, positions,
        available: shade.timedOut !== true && shade.positions?.primary !== null,
        batteryPercent: typeof shade.batteryPercent === 'number' && shade.batteryPercent >= 0 && shade.batteryPercent <= 100 ? Math.round(shade.batteryPercent) : null,
        batteryLow: false, batteryStatus: Number.isInteger(shade.batteryStatus) ? shade.batteryStatus : null };
    }),
    scenes: collection(scenes, 'scene').map(scene => ({ id: id(scene.id), name: label(scene, 'Unnamed scene'),
      roomIds: Array.isArray(scene.roomIds) ? scene.roomIds.map(id) : [] })),
    activeSceneIds: (Array.isArray(active) ? active : active?.scenes || active?.sceneIds || active?.activeScenes || [])
      .flatMap(scene => { try { return [id(typeof scene === 'object' ? scene.id ?? scene.sceneId ?? scene.scene?.id ?? scene.sceneID : scene)]; } catch { return []; } }),
  };
}
class GatewayClient {
  constructor(address, { fetchImpl = globalThis.fetch, timeout = 6000, readRetries = 1 } = {}) {
    this.address = normalizeAddress(address); this.fetch = fetchImpl; this.timeout = timeout; this.readRetries = readRetries;
    this.controllers = new Set(); this.disposed = false;
  }
  async request(route, { method = 'GET', body, attempt = 0 } = {}) {
    if (this.disposed) throw new GatewayError('Connection changed. Try again.', 'CANCELLED');
    const abort = new AbortController(); this.controllers.add(abort);
    const timer = setTimeout(() => abort.abort(), this.timeout);
    try {
      const response = await this.fetch(`http://${this.address}${route}`, { method, signal: abort.signal, redirect: 'error',
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      if (!response.ok) throw new GatewayError(response.status === 423 ? 'The gateway is busy or updating. Try again shortly.'
        : `The gateway returned HTTP ${response.status}. Check the connection and try again.`, `HTTP_${response.status}`);
      const text = await response.text();
      if (!text.trim()) {
        if (method !== 'GET') return null;
        throw new GatewayError('The gateway returned an empty response. Try refreshing.', 'INVALID_RESPONSE');
      }
      try { return JSON.parse(text); } catch { throw new GatewayError('The gateway returned an unreadable response.', 'INVALID_RESPONSE'); }
    } catch (error) {
      if (this.disposed) throw new GatewayError('Connection changed. Try again.', 'CANCELLED');
      if (!(error instanceof GatewayError) && method === 'GET' && attempt < this.readRetries) return this.request(route, { method, attempt: attempt + 1 });
      if (error instanceof GatewayError) throw error;
      throw new GatewayError(abort.signal.aborted ? 'The gateway took too long to respond. Check that it is online.'
        : 'Cannot reach the gateway. Check the address and connect to the same network.', abort.signal.aborted ? 'TIMEOUT' : 'OFFLINE');
    } finally { clearTimeout(timer); this.controllers.delete(abort); }
  }
  async identify() {
    const info = await this.request('/gateway');
    if (!info || typeof info !== 'object' || Array.isArray(info) || !info.config) throw new GatewayError('This device did not identify as a PowerView Gen 3 gateway.', 'UNSUPPORTED_GATEWAY');
    const config = info.config;
    if (config.mgwStatus?.running === true && config.mgwConfig?.primary === false) throw new GatewayError('This is a secondary gateway. Connect to the primary gateway for your home.', 'SECONDARY_GATEWAY');
    return { address: this.address, name: config.hubName || config.name || 'PowerView gateway', role: 'Primary' };
  }
  async getSnapshot() {
    const [rooms, shades, scenes, colors, active] = await Promise.all([
      this.request('/home/rooms'), this.request('/home/shades'), this.request('/home/scenes'),
      this.request('/home/colors').catch(() => ({})), this.request('/home/scenes/active').catch(() => []),
    ]);
    return normalizeSnapshot({ rooms, shades, scenes, colors, active }, this.address);
  }
  setPositions(shade, positions) {
    return this.request(`/home/shades/positions?ids=${encodeURIComponent(id(shade.id))}`, { method: 'PUT', body: { positions: validatePositions(shade, positions) } });
  }
  stopShade(shadeId) { return this.request(`/home/shades/stop?ids=${encodeURIComponent(id(shadeId))}`, { method: 'PUT' }); }
  jogShade(shadeId) { return this.request(`/home/shades/${encodeURIComponent(id(shadeId))}/motion`, { method: 'PUT', body: { motion: 'jog' } }); }
  activateScene(sceneId) { return this.request(`/home/scenes/${encodeURIComponent(id(sceneId))}/activate`, { method: 'PUT' }); }
  startEvents(onEvent, onStatus) {
    const { GatewayEvents } = require('./gateway-events');
    this.events?.stop();
    this.events = new GatewayEvents(this.address, { fetchImpl: this.fetch, onEvent, onStatus });
    this.events.start();
  }
  dispose() { this.disposed = true; this.events?.stop(); for (const controller of this.controllers) controller.abort(); this.controllers.clear(); }
}
module.exports = { GatewayClient, GatewayError, normalizeAddress, normalizeSnapshot };
