const { EventEmitter } = require('node:events');
const { GatewayClient, GatewayError, normalizeAddress } = require('./gateway-client');
const { DemoGateway } = require('./demo-gateway');
const { presetFor, validatePositions } = require('./capabilities');
const { project, matches } = require('../shared/shade-motion');
const { cleanAppearance } = require('./config-store');
const { positionText } = require('../shared/home-insights');

class Controller extends EventEmitter {
  constructor(store, { clientFactory = address => new GatewayClient(address), scheduleRefresh = true, now = Date.now } = {}) {
    super(); this.store = store; this.clientFactory = clientFactory; this.scheduleRefresh = scheduleRefresh;
    this.client = null; this.epoch = 0; this.attempt = 0; this.refreshInFlight = null; this.timers = [];
    this.now = now; this.motionTimers = new Map(); this.positionGuards = new Map(); this.eventTimes = new Map(); this.commandSequence = 0;
    this.state = { config: store.get(), connection: { status: 'unconfigured', address: '', error: null },
      snapshot: null, pending: {}, feedback: {}, motions: {}, targets: {}, notice: store.notice || null, refreshing: false };
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
    const candidate = demo ? new DemoGateway({ appearances: this.store.get().appearances?.demo }) : this.clientFactory(address);
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
      this.resetMotion();
      this.refreshInFlight = null;
      this.state.snapshot = snapshot; this.state.pending = {}; this.state.feedback = {}; this.state.refreshing = false;
      this.state.connection = { status: demo ? 'demo' : 'connected', address, name: identity.name, error: null };
      const epoch = this.epoch;
      candidate.startEvents?.(event => { if (epoch === this.epoch) this.applyEvent(event); }, status => {
        if (epoch === this.epoch) {
          this.state.connection.live = status;
          if (status !== 'open') this.freezeMotion('stale');
          this.publish();
        }
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
    this.resetMotion();
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
          const motion = this.state.motions[shade.id], target = this.state.targets[shade.id];
          const guard = this.positionGuards.get(shade.id);
          const newerEvent = (this.shadeRevisions?.get(shade.id) || 0) > eventRevision;
          const finished = !newerEvent && matches(shade.positions, motion?.target || target?.positions)
            && (!motion?.durationMs || this.now() >= motion.startedAt + motion.durationMs);
          if (finished) this.finishMotion(shade.id, shade.positions);
          else if (previous && (newerEvent || (motion?.status === 'moving' && motion.durationMs)
            || (guard && this.now() < guard.until && !matches(shade.positions, guard.positions)))) {
            shade.positions = previous.positions;
            if (newerEvent) { shade.available = previous.available; shade.batteryLow = previous.batteryLow; }
            else if (!shade.available) { this.freezeMotion('stale', shade.id); delete this.state.targets[shade.id]; }
          } else if (motion) {
            // Without a usable travel time, only actual reads advance the picture.
            motion.from = { ...shade.positions }; motion.startedAt = this.now(); motion.durationMs = null;
            if (motion.status !== 'moving' && shade.available) this.finishMotion(shade.id, shade.positions);
          }
        }
        if ((this.sceneRevision || 0) > eventRevision) snapshot.activeSceneIds = this.state.snapshot.activeSceneIds;
        this.state.snapshot = snapshot; this.state.connection.error = null;
        this.state.connection.status = client.address === 'demo' ? 'demo' : 'connected';
      } catch (error) {
        if (epoch !== this.epoch) return this.getState();
        this.state.connection.status = 'offline'; this.state.connection.error = error.message; throw error;
      } finally {
        if (epoch === this.epoch) {
          if (this.state.connection.status === 'offline') this.freezeMotion('stale');
          this.state.refreshing = false; this.refreshInFlight = null; this.publish();
        }
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
  async command(key, action, request = null) {
    this.requireConnection();
    if (this.state.pending[key]) throw new Error('A command is already being sent. Please wait.');
    const epoch = this.epoch; const client = this.client;
    const requestId = ++this.commandSequence;
    const [kind, targetId] = key.split(':');
    const target = this.state.snapshot?.[kind === 'scene' ? 'scenes' : 'shades'].find(item => item.id === targetId);
    const activity = { id: `command-${epoch}-${requestId}`, kind: 'command', source: 'app', targetId,
      targetName: target?.name, title: request ? 'Set position' : kind === 'stop' ? 'Stop shade' : kind === 'scene' ? 'Run scene' : 'Jog shade' };
    const activityDetail = request ? positionText(target, request.positions) : '';
    this.emit('activity', { ...activity, status: 'pending', detail: activityDetail || 'Sending command…' });
    if (request) {
      this.state.targets[request.id] = { positions: { ...request.positions }, requestId, requestedAt: this.now() };
      this.watchMotion(request.id, 12000);
    }
    this.state.pending[key] = true; this.state.feedback[key] = { kind: 'pending', message: 'Sending command…' }; this.publish();
    try {
      await action(client);
      if (epoch !== this.epoch) throw new GatewayError('The connection changed while the command was in progress.', 'CANCELLED');
      if (!['moving', 'reported'].includes(this.state.feedback[key]?.kind)) {
        this.state.feedback[key] = { kind: 'success', message: 'Command accepted · awaiting reported position', at: new Date().toISOString() };
      }
      this.emit('activity', { ...activity, status: 'accepted', detail: [activityDetail, 'Command accepted'].filter(Boolean).join(' · ') });
      this.queueRefresh(); return { accepted: true };
    } catch (error) {
      if (epoch === this.epoch) {
        this.emit('activity', { ...activity, status: 'error', detail: error.message });
        this.state.feedback[key] = { kind: 'error', message: error.message };
        if (request && this.state.targets[request.id]?.requestId === requestId) delete this.state.targets[request.id];
        if (request && !this.state.motions[request.id]) { clearTimeout(this.motionTimers.get(request.id)); this.motionTimers.delete(request.id); }
      }
      throw error;
    } finally {
      if (epoch === this.epoch) { delete this.state.pending[key]; this.publish(); }
    }
  }
  moveShade({ id, positions }, origin = null) {
    const shade = this.shade(id);
    validatePositions(shade, positions);
    this.emit('intent', { ids: [id], origin });
    return this.command(`shade:${id}`, client => client.setPositions(shade, positions), { id, positions });
  }
  shadeAction({ id, action }, origin = null) {
    const shade = this.shade(id);
    if (['stop', 'jog'].includes(action)) this.emit('intent', { ids: [id], origin });
    if (action === 'stop') return this.command(`stop:${id}`, async client => {
      await client.stopShade(id);
      // A stop acknowledgment freezes the estimate; only a report confirms the position.
      if (this.client === client) {
        if (this.state.motions[id]) { this.freezeMotion('stopping', id); this.watchMotion(id, 4000); }
        delete this.state.targets[id];
      }
    });
    if (action === 'jog') return this.command(`shade:${id}`, client => client.jogShade(id));
    return this.moveShade({ id, positions: presetFor(shade, action) }, origin);
  }
  activateScene(id) {
    this.requireConnection();
    if (!this.state.snapshot.scenes.some(scene => scene.id === id)) throw new Error('This scene is no longer available.');
    this.emit('intent', { ids: this.state.snapshot.shades.map(shade => shade.id), origin: null });
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
    this.emit('intent', { ids: shades.map(shade => shade.id), origin: null });
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
  setAppearance({ id, appearance }) {
    const shade = this.state.snapshot?.shades.find(item => item.id === id);
    if (!shade) throw new Error('This shade is no longer available.');
    const value = appearance === null ? null : cleanAppearance(appearance);
    const demo = this.state.connection.status === 'demo' && this.client instanceof DemoGateway;
    if (value?.kind === 'curtain' && shade.controls.kind === 'dual-rail' && !demo) throw new Error('This device has two moving rails. Choose a fabric style or color; curtain controls require a single opening control.');
    if (demo && this.client.appearanceChangesType(id, value) && Object.keys(this.state.pending).length) {
      throw new Error('Wait for the demo command to finish sending, then save the covering.');
    }
    const config = this.store.get(), address = this.state.connection.address;
    config.appearances ||= {}; config.appearances[address] ||= {};
    if (value) config.appearances[address][id] = value; else delete config.appearances[address][id];
    this.state.config = this.store.save(config);
    const changed = demo ? this.client.setAppearance(id, value) : null;
    if (changed) {
      this.state.snapshot.shades[this.state.snapshot.shades.findIndex(item => item.id === id)] = changed;
      clearTimeout(this.motionTimers.get(id)); this.motionTimers.delete(id);
      delete this.state.motions[id]; delete this.state.targets[id];
      delete this.state.feedback[`shade:${id}`]; delete this.state.feedback[`stop:${id}`];
      this.positionGuards.delete(id); this.eventTimes.delete(id);
      this.eventRevision = (this.eventRevision || 0) + 1; this.shadeRevisions.set(id, this.eventRevision);
    }
    this.publish(); return this.getState();
  }
  resetMotion() {
    for (const timer of this.motionTimers.values()) clearTimeout(timer);
    this.motionTimers.clear(); this.positionGuards.clear(); this.eventTimes.clear();
    this.state.motions = {}; this.state.targets = {};
    this.eventRevision = 0; this.shadeRevisions = new Map(); this.sceneRevision = 0;
  }
  watchMotion(id, delay) {
    clearTimeout(this.motionTimers.get(id)); this.motionTimers.delete(id);
    if (!this.scheduleRefresh) return;
    const epoch = this.epoch;
    const timer = setTimeout(() => {
      this.motionTimers.delete(id);
      if (epoch !== this.epoch) return;
      if (this.state.motions[id]) this.freezeMotion('unconfirmed', id);
      else {
        delete this.state.targets[id];
        this.state.feedback[`shade:${id}`] = { kind: 'warning', message: 'No movement report received. Refresh to check the shade.' };
      }
      this.publish(); this.refresh().catch(() => {});
    }, delay);
    timer.unref?.(); this.motionTimers.set(id, timer);
  }
  freezeMotion(status, id = null) {
    for (const [key, motion] of Object.entries(this.state.motions)) {
      if (id !== null && key !== id) continue;
      this.state.motions[key] = { ...motion, from: project(motion, this.now()), startedAt: this.now(), durationMs: null, status };
    }
  }
  finishMotion(id, positions, fromEvent = false) {
    if (!fromEvent && (this.state.motions[id] || this.state.targets[id])) {
      const shade = this.state.snapshot?.shades.find(item => item.id === id);
      this.emit('activity', { kind: 'report', source: 'gateway', status: 'reported', title: 'Position confirmed by refresh',
        targetId: id, targetName: shade?.name, detail: positionText(shade, positions) });
    }
    delete this.state.motions[id]; delete this.state.targets[id];
    clearTimeout(this.motionTimers.get(id)); this.motionTimers.delete(id);
    this.positionGuards.set(id, { positions: { ...positions }, until: this.now() + 5000 });
    this.state.feedback[`shade:${id}`] = { kind: 'reported', message: 'Position reported by gateway' };
  }
  eventPositions(shade, raw) {
    const positions = {};
    for (const axis of shade.controls.axes) {
      const value = raw?.[axis.key] ?? (shade.controls.code === 5 && axis.key === 'tilt' ? raw?.primary : undefined);
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1) positions[axis.key] = value * 100;
    }
    return positions;
  }
  applyEvent(event) {
    if (!event || typeof event !== 'object' || !this.state.snapshot) return;
    const snapshot = this.state.snapshot;
    if (['homedoc-updated', 'scene-add', 'scene-del'].includes(event.evt)) {
      this.emit('gateway-event', event); this.queueRefresh(); return;
    }
    const shade = snapshot.shades.find(item => item.id === String(event.id));
    if (shade && ['motion-started', 'motion-stopped'].includes(event.evt)) {
      const stamp = Date.parse(event.isoDate);
      if (Number.isFinite(stamp) && stamp <= (this.eventTimes.get(shade.id) || 0)) return;
      if (Number.isFinite(stamp)) this.eventTimes.set(shade.id, stamp);
      const positions = this.eventPositions(shade, event.currentPositions);
      Object.assign(shade.positions, positions);
      const key = `shade:${shade.id}`;
      if (event.evt === 'motion-started') {
        const target = this.eventPositions(shade, event.targetPositions);
        const eta = event.targetPositions?.etaInSeconds;
        const durationMs = typeof eta === 'number' && Number.isFinite(eta) && eta > 0 && eta <= 600 ? eta * 1000 : null;
        this.state.motions[shade.id] = { from: { ...shade.positions }, target, startedAt: this.now(), durationMs, status: 'moving' };
        this.state.feedback[key] = { kind: 'moving', message: durationMs ? 'Moving · estimated between gateway reports' : 'Moving · waiting for position updates' };
        this.watchMotion(shade.id, (durationMs || 15000) + 3000);
      } else if (Object.keys(positions).length) {
        this.finishMotion(shade.id, shade.positions, true);
      } else {
        this.freezeMotion('stopping', shade.id); delete this.state.targets[shade.id];
        this.watchMotion(shade.id, 500); this.queueRefresh();
      }
    } else if (shade && event.evt === 'shade-offline') {
      shade.available = false; this.freezeMotion('stale', shade.id); delete this.state.targets[shade.id];
    } else if (shade && event.evt === 'shade-online') shade.available = true;
    else if (shade && event.evt === 'battery-alert') shade.batteryLow = true;
    else if (event.evt === 'scene-activated') snapshot.activeSceneIds = [...new Set([...snapshot.activeSceneIds, String(event.id)])];
    else if (event.evt === 'scene-deactivated') snapshot.activeSceneIds = snapshot.activeSceneIds.filter(id => id !== String(event.id));
    else return;
    this.eventRevision = (this.eventRevision || 0) + 1;
    if (shade) this.shadeRevisions.set(shade.id, this.eventRevision);
    if (['scene-activated', 'scene-deactivated'].includes(event.evt)) this.sceneRevision = this.eventRevision;
    this.emit('gateway-event', event);
    this.publish();
  }
  dispose() {
    this.attempt += 1; this.epoch += 1; this.client?.dispose();
    for (const timer of this.timers) clearTimeout(timer); this.resetMotion(); this.removeAllListeners();
  }
}
module.exports = { Controller };
