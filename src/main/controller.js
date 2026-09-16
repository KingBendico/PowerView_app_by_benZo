const { EventEmitter } = require('node:events');
const { GatewayClient, GatewayError, normalizeAddress } = require('./gateway-client');
const { DemoGateway } = require('./demo-gateway');
const { presetFor } = require('./capabilities');

class Controller extends EventEmitter {
  constructor(store, { clientFactory = address => new GatewayClient(address), scheduleRefresh = true } = {}) {
    super(); this.store = store; this.clientFactory = clientFactory; this.scheduleRefresh = scheduleRefresh;
    this.client = null; this.epoch = 0; this.attempt = 0; this.refreshInFlight = null; this.timers = [];
    this.state = { config: store.get(), connection: { status: 'unconfigured', address: '', error: null },
      snapshot: null, pending: {}, feedback: {}, notice: store.notice || null, refreshing: false };
  }
  getState() {
    const state = structuredClone(this.state);
    state.favorites = state.config.favorites[state.connection.address] || { shadeIds: [], sceneIds: [] };
    return state;
  }
  publish() { this.emit('state', this.getState()); }
  async connect(input, { demo = false } = {}) {
    const address = demo ? 'demo' : normalizeAddress(input);
    const attempt = ++this.attempt;
    const candidate = demo ? new DemoGateway() : this.clientFactory(address);
    if (!this.client) { this.state.connection = { status: 'connecting', address, error: null }; this.publish(); }
    try {
      const identity = await candidate.identify();
      const snapshot = await candidate.getSnapshot();
      if (attempt !== this.attempt) throw new GatewayError('A newer connection was requested.', 'CANCELLED');
      const config = this.store.get();
      if (!demo) config.ipAddress = address;
      if (demo && !config.favorites.demo) config.favorites.demo = { shadeIds: ['11', '41'], sceneIds: ['101', '102', '104'] };
      this.state.config = this.store.save(config);
      this.client?.dispose(); this.client = candidate; this.epoch += 1;
      for (const timer of this.timers) clearTimeout(timer); this.timers = [];
      this.refreshInFlight = null;
      this.state.snapshot = snapshot; this.state.pending = {}; this.state.feedback = {}; this.state.refreshing = false;
      this.state.connection = { status: demo ? 'demo' : 'connected', address, name: identity.name, error: null };
      const epoch = this.epoch;
      candidate.startEvents?.(event => { if (epoch === this.epoch) this.applyEvent(event); }, status => {
        if (epoch === this.epoch) { this.state.connection.live = status; this.publish(); }
      });
      this.publish(); return this.getState();
    } catch (error) {
      candidate.dispose();
      if (attempt === this.attempt && !this.client) {
        this.state.connection = { status: 'offline', address, error: error.message }; this.publish();
      }
      throw error;
    }
  }
  async leaveDemo() {
    this.attempt += 1; this.epoch += 1; this.client?.dispose(); this.client = null;
    this.state.snapshot = null; this.state.pending = {}; this.state.feedback = {}; this.state.refreshing = false;
    this.state.connection = { status: 'unconfigured', address: '', error: null }; this.publish();
    if (this.state.config.ipAddress) return this.connect(this.state.config.ipAddress);
    return this.getState();
  }
  async refresh() {
    if (!this.client) {
      const address = this.state.config.ipAddress || this.state.connection.address;
      if (address && address !== 'demo') return this.connect(address);
      return this.getState();
    }
    const epoch = this.epoch;
    if (this.refreshInFlight?.epoch === epoch) return this.refreshInFlight.promise;
    const client = this.client;
    this.state.refreshing = true; this.publish();
    const promise = (async () => {
      try {
        const eventRevision = this.eventRevision || 0;
        const snapshot = await client.getSnapshot();
        if (epoch !== this.epoch) return this.getState();
        for (const shade of snapshot.shades) {
          const previous = this.state.snapshot?.shades.find(item => item.id === shade.id);
          if (previous && (this.shadeRevisions?.get(shade.id) || 0) > eventRevision) {
            shade.positions = previous.positions; shade.available = previous.available; shade.batteryLow = previous.batteryLow;
          }
        }
        if ((this.sceneRevision || 0) > eventRevision) snapshot.activeSceneIds = this.state.snapshot.activeSceneIds;
        this.state.snapshot = snapshot; this.state.connection.error = null;
        this.state.connection.status = client.address === 'demo' ? 'demo' : 'connected';
      } catch (error) {
        if (epoch !== this.epoch) return this.getState();
        this.state.connection.status = 'offline'; this.state.connection.error = error.message; throw error;
      } finally {
        if (epoch === this.epoch) { this.state.refreshing = false; this.refreshInFlight = null; this.publish(); }
      }
      return this.getState();
    })();
    this.refreshInFlight = { epoch, promise }; return promise;
  }
  requireConnection() {
    if (!this.client || !['connected', 'demo'].includes(this.state.connection.status)) throw new GatewayError('Reconnect your gateway before sending a command.', 'OFFLINE');
  }
  shade(id) {
    this.requireConnection();
    const shade = this.state.snapshot.shades.find(item => item.id === id);
    if (!shade) throw new Error('This shade is no longer available. Refresh your home.');
    return shade;
  }
  queueRefresh() {
    if (!this.scheduleRefresh) return;
    for (const timer of this.timers) clearTimeout(timer);
    const epoch = this.epoch;
    this.timers = [150, 3000].map(delay => setTimeout(() => {
      if (epoch === this.epoch) this.refresh().catch(() => {});
    }, delay));
  }
  async command(key, action) {
    this.requireConnection();
    if (this.state.pending[key]) throw new Error('A command is already being sent. Please wait.');
    const epoch = this.epoch; const client = this.client;
    this.state.pending[key] = true; this.state.feedback[key] = { kind: 'pending', message: 'Sending command…' }; this.publish();
    try {
      await action(client);
      if (epoch !== this.epoch) throw new GatewayError('The connection changed while the command was in progress.', 'CANCELLED');
      this.state.feedback[key] = { kind: 'success', message: 'Command accepted · awaiting reported position', at: new Date().toISOString() };
      this.queueRefresh(); return { accepted: true };
    } catch (error) {
      if (epoch === this.epoch) this.state.feedback[key] = { kind: 'error', message: error.message };
      throw error;
    } finally {
      if (epoch === this.epoch) { delete this.state.pending[key]; this.publish(); }
    }
  }
  moveShade({ id, positions }) {
    const shade = this.shade(id);
    return this.command(`shade:${id}`, client => client.setPositions(shade, positions));
  }
  shadeAction({ id, action }) {
    const shade = this.shade(id);
    if (action === 'stop') return this.command(`stop:${id}`, client => client.stopShade(id));
    if (action === 'jog') return this.command(`shade:${id}`, client => client.jogShade(id));
    return this.moveShade({ id, positions: presetFor(shade, action) });
  }
  activateScene(id) {
    this.requireConnection();
    if (!this.state.snapshot.scenes.some(scene => scene.id === id)) throw new Error('This scene is no longer available.');
    return this.command(`scene:${id}`, client => client.activateScene(id));
  }
  async roomAction({ roomId, action }) {
    this.requireConnection();
    if (!['open', 'close', 'stop'].includes(action)) throw new Error('Invalid room action.');
    if (roomId !== null && !this.state.snapshot.rooms.some(room => room.id === roomId)) throw new Error('Unknown room.');
    if (action === 'stop') this.stopVersion = (this.stopVersion || 0) + 1;
    const stopVersion = this.stopVersion || 0;
    const key = `${action === 'stop' ? 'room-stop' : 'room'}:${roomId}`; if (this.state.pending[key]) throw new Error('A room action is already in progress.');
    const shades = this.state.snapshot.shades.filter(shade => roomId === null || shade.roomId === roomId);
    const epoch = this.epoch; const results = new Array(shades.length); let index = 0;
    this.state.pending[key] = true; this.state.feedback[key] = { kind: 'pending', message: 'Sending room commands…' }; this.publish();
    await Promise.all(Array.from({ length: Math.min(3, shades.length) }, async () => {
      while (index < shades.length) {
        const current = index++; const shade = shades[current];
        try {
          if (epoch !== this.epoch) throw new Error('Connection changed; command was not sent.');
          if (action !== 'stop' && stopVersion !== (this.stopVersion || 0)) throw new Error('Cancelled by Stop; command was not sent.');
          await this.shadeAction({ id: shade.id, action }); results[current] = { id: shade.id, name: shade.name, ok: true };
        } catch (error) { results[current] = { id: shade.id, name: shade.name, ok: false, error: error.message }; }
      }
    }));
    if (epoch === this.epoch) {
      delete this.state.pending[key]; const count = results.filter(result => result.ok).length;
      this.state.feedback[key] = { kind: count === results.length ? 'success' : 'error',
        message: `${count} of ${results.length} commands accepted.`, results }; this.publish();
    }
    return results;
  }
  toggleFavorite({ kind, id }) {
    if (!['shade', 'scene'].includes(kind)) throw new Error('Invalid favorite type.');
    if (!this.state.snapshot?.[`${kind}s`].some(item => item.id === id)) throw new Error('This item is no longer available.');
    const config = this.store.get(); const host = this.state.connection.address;
    const favorites = config.favorites[host] || { shadeIds: [], sceneIds: [] }; const key = `${kind}Ids`;
    favorites[key] = favorites[key].includes(id) ? favorites[key].filter(value => value !== id) : [...favorites[key], id];
    config.favorites[host] = favorites; this.state.config = this.store.save(config); this.publish(); return this.getState();
  }
  setPreferences(preferences) {
    if (!preferences || typeof preferences !== 'object' || Object.keys(preferences).some(key => !['theme', 'closeToTray'].includes(key))) throw new Error('Invalid preferences.');
    if (preferences.theme !== undefined && !['system', 'light', 'dark'].includes(preferences.theme)) throw new Error('Invalid theme.');
    if (preferences.closeToTray !== undefined && typeof preferences.closeToTray !== 'boolean') throw new Error('Invalid window preference.');
    this.state.config = this.store.save({ ...this.store.get(), ...preferences }); this.publish(); return this.getState();
  }
  applyEvent(event) {
    if (!event || typeof event !== 'object' || !this.state.snapshot) return;
    const snapshot = this.state.snapshot;
    this.eventRevision = (this.eventRevision || 0) + 1;
    const shade = snapshot.shades.find(item => item.id === String(event.id));
    if (shade) { this.shadeRevisions ||= new Map(); this.shadeRevisions.set(shade.id, this.eventRevision); }
    if (['scene-activated', 'scene-deactivated'].includes(event.evt)) this.sceneRevision = this.eventRevision;
    if (shade && ['motion-started', 'motion-stopped'].includes(event.evt) && event.currentPositions) {
      for (const key of ['primary', 'secondary', 'tilt']) {
        const value = event.currentPositions[key];
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1) shade.positions[shade.controls.code === 5 && key === 'primary' ? 'tilt' : key] = Math.round(value * 100);
      }
      const key = `shade:${shade.id}`;
      if (event.evt === 'motion-stopped') this.state.feedback[key] = { kind: 'reported', message: 'Position reported by gateway' };
    } else if (shade && event.evt === 'shade-offline') shade.available = false;
    else if (shade && event.evt === 'shade-online') shade.available = true;
    else if (shade && event.evt === 'battery-alert') shade.batteryLow = true;
    else if (event.evt === 'scene-activated') snapshot.activeSceneIds = [...new Set([...snapshot.activeSceneIds, String(event.id)])];
    else if (event.evt === 'scene-deactivated') snapshot.activeSceneIds = snapshot.activeSceneIds.filter(id => id !== String(event.id));
    else return;
    this.publish();
  }
  dispose() {
    this.attempt += 1; this.epoch += 1; this.client?.dispose();
    for (const timer of this.timers) clearTimeout(timer); this.removeAllListeners();
  }
}
module.exports = { Controller };
