const { EventEmitter } = require('node:events');
const { positionText } = require('../shared/home-insights');

const emptyResource = () => ({ status: 'idle', data: null, updatedAt: null, error: null });
class HomeInsights extends EventEmitter {
  constructor(controller, { now = Date.now, limit = 200 } = {}) {
    super(); this.controller = controller; this.now = now; this.limit = limit;
    this.address = ''; this.client = null; this.generation = 0; this.histories = new Map(); this.sequence = 0;
    this.schedules = emptyResource(); this.gateway = emptyResource(); this.recentEvents = new Set();
    this.onState = state => this.sync(state);
    this.onActivity = entry => this.record(entry);
    this.onGatewayEvent = event => this.gatewayEvent(event);
    controller.on('state', this.onState); controller.on('activity', this.onActivity); controller.on('gateway-event', this.onGatewayEvent);
    this.sync(controller.getState());
  }
  getState() {
    return structuredClone({ address: this.address, schedules: this.schedules, gateway: this.gateway,
      activity: this.histories.get(this.address) || [], limit: this.limit });
  }
  publish() { this.emit('state', this.getState()); }
  sync(state) {
    const connected = ['connected', 'demo'].includes(state.connection.status);
    if (state.connection.address !== this.address || (connected && this.controller.client !== this.client)) {
      for (const entry of this.histories.get(this.address) || []) if (entry.status === 'pending') {
        entry.status = 'warning'; entry.detail = 'Connection changed before the command was confirmed.';
      }
      const changedHome = state.connection.address !== this.address;
      clearTimeout(this.configTimer);
      this.address = state.connection.address; this.client = connected ? this.controller.client : null;
      this.generation++; this.inFlight = null; this.lastConnection = null; this.recentEvents.clear();
      if (changedHome) { this.schedules = emptyResource(); this.gateway = emptyResource(); }
      if (this.address && !this.histories.has(this.address)) {
        this.histories.set(this.address, []);
        if (this.histories.size > 10) this.histories.delete(this.histories.keys().next().value);
      }
      this.publish();
      if (connected) void this.refresh();
    }
    const key = `${state.connection.status}:${state.connection.live || ''}`;
    if (key !== this.lastConnection && this.address) {
      if (state.connection.status === 'offline') this.record({ kind: 'connection', status: 'error', source: 'app', title: 'Gateway unavailable', detail: state.connection.error });
      else if (connected && state.connection.live === 'reconnecting') this.record({ kind: 'connection', status: 'warning', source: 'app', title: 'Live updates interrupted', detail: 'Reconnecting to the gateway event stream.' });
      else if (connected && (state.connection.live === 'open' || !state.connection.live)) this.record({ kind: 'connection', status: 'reported', source: 'app', title: state.connection.status === 'demo' ? 'Demo home connected' : 'Gateway connected' });
      this.lastConnection = key;
    }
  }
  record(entry) {
    if (!this.address) return;
    const history = this.histories.get(this.address);
    if (!history) return;
    const existing = entry.id && history.find(item => item.id === entry.id);
    if (existing) Object.assign(existing, entry, { updatedAt: this.now() });
    else history.unshift({ ...entry, id: entry.id || `event-${++this.sequence}`, at: this.now(), updatedAt: this.now() });
    history.length = Math.min(history.length, this.limit); this.publish();
  }
  refresh() {
    if (this.inFlight) return this.inFlight;
    const client = this.controller.client, generation = this.generation;
    if (!client || !['connected', 'demo'].includes(this.controller.state.connection.status)) return Promise.resolve(this.getState());
    this.schedules = { ...this.schedules, status: 'loading', error: null };
    this.gateway = { ...this.gateway, status: 'loading', error: null }; this.publish();
    const read = async (key, method) => {
      try {
        if (typeof client[method] !== 'function') throw new Error('This information is not available from this gateway.');
        const data = await client[method]();
        if (generation === this.generation) this[key] = { status: 'ready', data, updatedAt: this.now(), error: null };
      } catch (error) {
        if (generation === this.generation) this[key] = { ...this[key], status: 'error', error: error.message };
      }
      if (generation === this.generation) this.publish();
    };
    this.inFlight = Promise.all([read('schedules', 'getAutomations'), read('gateway', 'getGatewayInfo')]).then(() => this.getState())
      .finally(() => { if (generation === this.generation) this.inFlight = null; });
    return this.inFlight;
  }
  gatewayEvent(event) {
    if (event.isoDate) {
      const key = `${event.evt}:${event.id || ''}:${event.isoDate}`;
      if (this.recentEvents.has(key)) return;
      this.recentEvents.add(key);
      if (this.recentEvents.size > 300) this.recentEvents.delete(this.recentEvents.values().next().value);
    }
    const snapshot = this.controller.state.snapshot;
    const shade = snapshot?.shades.find(item => item.id === String(event.id));
    const scene = snapshot?.scenes.find(item => item.id === String(event.id));
    const titles = { 'motion-started': 'Movement started', 'motion-stopped': 'Position reported', 'shade-offline': 'Shade offline',
      'shade-online': 'Shade online', 'battery-alert': 'Low battery reported', 'scene-activated': 'Scene activated',
      'scene-deactivated': 'Scene no longer active', 'homedoc-updated': 'Home configuration changed', 'scene-add': 'Scene added', 'scene-del': 'Scene removed' };
    if (!titles[event.evt]) return;
    const sceneEvent = event.evt.startsWith('scene-');
    const detail = shade && ['motion-started', 'motion-stopped'].includes(event.evt)
      ? positionText(shade, this.controller.eventPositions(shade, event.evt === 'motion-started' ? event.targetPositions : event.currentPositions)) : '';
    this.record({ kind: 'report', status: ['shade-offline', 'battery-alert'].includes(event.evt) ? 'warning' : 'reported', source: 'gateway',
      title: event.evt === 'motion-stopped' && !detail ? 'Movement stopped · position not reported' : titles[event.evt], detail,
      targetName: sceneEvent ? scene?.name : shade?.name, targetId: event.id == null ? null : String(event.id),
      reportedAt: Number.isFinite(Date.parse(event.isoDate)) ? Date.parse(event.isoDate) : null });
    if (event.evt === 'homedoc-updated') {
      clearTimeout(this.configTimer); this.configTimer = setTimeout(() => { void this.refresh(); }, 350); this.configTimer.unref?.();
    }
  }
  dispose() {
    this.generation++; clearTimeout(this.configTimer);
    this.controller.off('state', this.onState); this.controller.off('activity', this.onActivity); this.controller.off('gateway-event', this.onGatewayEvent);
    this.removeAllListeners();
  }
}
module.exports = { HomeInsights };
