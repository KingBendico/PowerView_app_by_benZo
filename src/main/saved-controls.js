const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const format = require('../shared/saved-controls-format');
const { presetFor, validatePositions } = require('./capabilities');
const ACTIVE = new Set(['closing', 'waiting', 'restoring']);
const matches = (actual, expected) => Object.entries(expected).every(([key, value]) => Number.isFinite(actual?.[key]) && Math.abs(actual[key] - value) <= 1);

class SavedControls extends EventEmitter {
  constructor(controller, { now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, notify = () => {} } = {}) {
    super(); this.controller = controller; this.now = now; this.setTimer = setTimer; this.clearTimer = clearTimer; this.notify = notify;
    this.jobs = new Map(); this.busy = new Set(); this.lastResult = null; this.signature = ''; this.disposed = false;
    this.onState = () => this.sync();
    this.onIntent = ({ ids, origin }) => {
      for (const job of this.jobs.values()) if (ACTIVE.has(job.status) && origin !== job.id && job.items.some(item => ids.includes(item.id))) this.finish(job, 'cancelled', 'Cancelled by a newer command.');
    };
    this.onEvent = event => {
      for (const job of this.jobs.values()) {
        if (!ACTIVE.has(job.status)) continue;
        const item = job.items.find(item => item.id === String(event.id));
        if (event.evt === 'scene-activated') this.finish(job, 'cancelled', 'Cancelled because a scene was activated.');
        else if (item && event.evt === 'motion-started') {
          const target = this.controller.eventPositions(this.controller.shade(item.id), event.targetPositions);
          const expected = job.status === 'restoring' ? item.positions : item.closed;
          if (job.status === 'waiting' || !matches(target, expected)) this.finish(job, 'cancelled', 'Cancelled because the shade moved again.');
        }
      }
    };
    controller.on('state', this.onState); controller.on('intent', this.onIntent); controller.on('gateway-event', this.onEvent);
  }
  home() { return this.controller.state.config.savedControls?.[this.controller.state.connection.address] || { groups: [], presets: [] }; }
  assertHome(address) { if (!address || address !== this.controller.state.connection.address) throw new Error('The active home changed. Reopen Saved controls.'); }
  getState() {
    const state = this.controller.state;
    return { address: state.connection.address, homeName: state.connection.name || 'Your home', connected: ['demo', 'connected'].includes(state.connection.status),
      ...structuredClone(this.home()), busy: [...this.busy], lastResult: this.lastResult,
      shades: (state.snapshot?.shades || []).map(shade => ({ id: shade.id, name: shade.name, available: shade.available, known: shade.controls.known,
        roomId: shade.roomId, roomName: state.snapshot.rooms.find(room => room.id === shade.roomId)?.name || '' })),
      timers: [...this.jobs.values()].filter(job => job.address === state.connection.address).map(job => ({ id: job.id, name: job.name, count: job.items.length, minutes: job.minutes, dueAt: job.dueAt, status: job.status, message: job.message })) };
  }
  publish() {
    if (this.disposed) return;
    const state = this.getState(), signature = JSON.stringify(state);
    if (signature !== this.signature) { this.signature = signature; this.emit('state', state); }
  }
  selected(ids) {
    this.controller.requireConnection();
    return format.ids(ids).map(id => this.controller.shade(id));
  }
  capture(shades) {
    return shades.map(shade => {
      if (!shade.available || !shade.controls.known) throw new Error(`${shade.name} is offline or has unsupported controls.`);
      if (this.controller.state.motions[shade.id] || this.controller.state.targets[shade.id] || this.controller.state.pending[`shade:${shade.id}`]) throw new Error(`Wait for ${shade.name} to settle before saving its position.`);
      const positions = Object.fromEntries(shade.controls.axes.map(axis => [axis.key, shade.positions[axis.key]]));
      validatePositions(shade, positions);
      return { id: shade.id, code: shade.controls.code, positions };
    });
  }
  async save({ address, kind, name, shadeIds }) {
    this.assertHome(address); name = format.name(name); shadeIds = format.ids(shadeIds);
    if (!['presets', 'groups'].includes(kind)) throw new Error('Choose a preset or a group.');
    const epoch = this.controller.epoch;
    if (kind === 'presets') await this.controller.refresh();
    this.assertHome(address); if (epoch !== this.controller.epoch) throw new Error('The connection changed. Try saving again.');
    const shades = this.selected(shadeIds), entry = { id: randomUUID(), name, shadeIds };
    if (kind === 'presets') entry.positions = this.capture(shades);
    const config = this.controller.store.get(); config.savedControls ||= {};
    const home = structuredClone(config.savedControls[address] || { groups: [], presets: [] });
    if (home[kind].length >= 50) throw new Error('You can save up to 50 groups and 50 presets per home.');
    if (home[kind].some(item => item.name.toLowerCase() === name.toLowerCase())) throw new Error('A saved control already has that name. Choose another name.');
    home[kind].push(entry); config.savedControls[address] = format.cleanHome(home);
    this.controller.state.config = this.controller.store.save(config); this.controller.publish(); return this.getState();
  }
  remove({ address, kind, id }) {
    this.assertHome(address); if (!['presets', 'groups'].includes(kind)) throw new Error('Invalid saved control.');
    const config = this.controller.store.get(), home = config.savedControls?.[address];
    if (!home?.[kind].some(item => item.id === id)) throw new Error('This saved control is no longer available.');
    home[kind] = home[kind].filter(item => item.id !== id);
    this.controller.state.config = this.controller.store.save(config); this.controller.publish(); return this.getState();
  }
  validateSaved(item) {
    const shade = this.controller.shade(item.id);
    if (!shade.available || shade.controls.code !== item.code) throw new Error(`${shade.name} is offline or its controls have changed. Save a new preset.`);
    validatePositions(shade, item.positions); return shade;
  }
  async run({ address, kind, id, action }) {
    this.assertHome(address);
    if (!['presets', 'groups'].includes(kind)) throw new Error('Invalid saved control.');
    const entry = this.home()[kind].find(item => item.id === id);
    if (!entry) throw new Error('This saved control is no longer available.');
    if (kind === 'groups' && !['open', 'close', 'stop'].includes(action) || kind === 'presets' && action !== 'activate') throw new Error('Invalid saved action.');
    const key = `${kind}:${id}:${action}`;
    if (this.busy.has(key)) throw new Error('This saved control is already sending commands.');
    const shades = this.selected(entry.shadeIds), epoch = this.controller.epoch;
    if (kind === 'presets') entry.positions.forEach(item => this.validateSaved(item));
    this.controller.emit('intent', { ids: entry.shadeIds, origin: null });
    if (action === 'stop') this.controller.stopVersion = (this.controller.stopVersion || 0) + 1;
    const stopVersion = this.controller.stopVersion || 0, results = [];
    this.busy.add(key); this.publish();
    try {
      for (const shade of shades) {
        try {
          if (epoch !== this.controller.epoch || action !== 'stop' && stopVersion !== (this.controller.stopVersion || 0)) throw new Error('Cancelled before sending.');
          if (kind === 'presets') { const item = entry.positions.find(item => item.id === shade.id); this.validateSaved(item); await this.controller.moveShade({ id: shade.id, positions: item.positions }); }
          else await this.controller.shadeAction({ id: shade.id, action });
          results.push({ id: shade.id, ok: true });
        } catch (error) { results.push({ id: shade.id, ok: false, error: error.message }); }
      }
      if (epoch === this.controller.epoch) {
        this.lastResult = `${entry.name}: ${results.filter(item => item.ok).length} of ${results.length} commands accepted.`;
        this.notify(this.lastResult);
      }
      return results;
    } finally { this.busy.delete(key); this.publish(); }
  }
  async startPrivacy({ address, shadeIds, minutes }) {
    this.assertHome(address); shadeIds = format.ids(shadeIds);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) throw new Error('Choose 1–240 minutes.');
    const epoch = this.controller.epoch; await this.controller.refresh(); this.assertHome(address);
    if (epoch !== this.controller.epoch) throw new Error('The connection changed. Start the timer again.');
    if (this.controller.state.connection.live !== 'open') throw new Error('Wait for live gateway updates to connect before starting a timer.');
    if ([...this.jobs.values()].some(job => ACTIVE.has(job.status) && job.items.some(item => shadeIds.includes(item.id)))) throw new Error('A selected shade already has a privacy timer. Cancel it first.');
    if ([...this.jobs.values()].filter(job => ACTIVE.has(job.status)).length >= 10) throw new Error('Use up to 10 privacy timers at once.');
    const shades = this.selected(shadeIds), items = this.capture(shades).map(item => ({ ...item, closed: presetFor(this.controller.shade(item.id), 'close') }));
    const job = { id: randomUUID(), address, epoch, items, minutes, name: shades.length === 1 ? shades[0].name : `${shades.length} shades`, status: 'closing', message: 'Closing · timer starts when positions are confirmed', dueAt: null, startedAt: this.now(), closingSent: false };
    this.jobs.set(job.id, job); this.publish();
    job.handle = this.setTimer(() => { if (job.status === 'closing') this.finish(job, 'cancelled', 'Closing was not confirmed. No automatic restore will run.'); }, 120000); job.handle?.unref?.();
    try {
      for (const item of items) {
        if (job.status !== 'closing' || epoch !== this.controller.epoch) break;
        await this.controller.moveShade({ id: item.id, positions: item.closed }, job.id);
      }
      job.closingSent = true; this.sync(); return this.getState();
    } catch (error) { this.finish(job, 'error', `Could not close all selected shades: ${error.message}. No automatic restore will run.`); throw error; }
  }
  finish(job, status, message) {
    if (!ACTIVE.has(job.status)) return;
    this.clearTimer(job.handle); job.handle = null; job.status = status; job.message = message;
    this.notify(`${job.name}: ${message}`);
    const old = [...this.jobs.values()].filter(item => !ACTIVE.has(item.status));
    for (const item of old.slice(0, Math.max(0, old.length - 10))) this.jobs.delete(item.id);
    this.publish();
  }
  cancel(id) { const job = this.jobs.get(id); if (job) { this.assertHome(job.address); this.finish(job, 'cancelled', 'Timer cancelled · current positions kept.'); } return this.getState(); }
  cancelAll(reason) { for (const job of this.jobs.values()) this.finish(job, 'cancelled', reason); }
  sync() {
    const state = this.controller.state;
    if (this.address !== state.connection.address) { this.address = state.connection.address; this.lastResult = null; }
    for (const job of this.jobs.values()) {
      if (!ACTIVE.has(job.status)) continue;
      if (job.epoch !== this.controller.epoch || !['demo', 'connected'].includes(state.connection.status) || state.connection.live !== 'open') { this.finish(job, 'cancelled', 'Timer cancelled because the gateway connection changed.'); continue; }
      const unchanged = job.items.every(item => {
        const shade = state.snapshot.shades.find(shade => shade.id === item.id);
        return shade?.available && shade.controls.code === item.code && matches(shade.positions, item.closed) && !state.motions[item.id] && !state.targets[item.id];
      });
      if (job.status === 'closing' && job.closingSent && unchanged) {
        this.clearTimer(job.handle); job.status = 'waiting'; job.dueAt = this.now() + job.minutes * 60000; job.message = 'Will restore previous positions';
        job.handle = this.setTimer(() => this.restore(job.id, false).catch(error => this.finish(job, 'error', error.message)), job.minutes * 60000); job.handle?.unref?.();
      } else if (job.status === 'waiting' && !unchanged) this.finish(job, 'cancelled', 'Timer cancelled because a shade changed or became unavailable.');
    }
    this.publish();
  }
  async restore(id, manual = true) {
    const job = this.jobs.get(id); if (!job || job.status !== 'waiting') return this.getState();
    this.assertHome(job.address);
    if (!manual && Math.abs(this.now() - job.dueAt) > 15000) { this.finish(job, 'cancelled', 'Timer expired while the app was paused. No late restore was sent.'); return this.getState(); }
    this.clearTimer(job.handle); job.status = 'restoring'; job.message = 'Restoring previous positions…'; this.publish();
    try {
      // Inspect a fresh gateway report directly: visual stale-read guards must not hide a newer physical position.
      const snapshot = await this.controller.client.getSnapshot();
      if (job.status !== 'restoring' || job.epoch !== this.controller.epoch) return this.getState();
      for (const item of job.items) {
        this.validateSaved(item);
        const shade = snapshot.shades.find(shade => shade.id === item.id);
        if (!shade?.available || shade.controls.code !== item.code || !matches(shade.positions, item.closed) || this.controller.state.motions[item.id] || this.controller.state.targets[item.id]) throw new Error('A shade changed. Previous positions were not restored.');
      }
      for (const item of job.items) {
        if (job.status !== 'restoring' || job.epoch !== this.controller.epoch) return this.getState();
        await this.controller.moveShade({ id: item.id, positions: item.positions }, job.id);
      }
      this.finish(job, 'completed', 'Restore commands accepted · final positions appear on the shade controls.');
    } catch (error) { this.finish(job, 'error', `Restore stopped: ${error.message}`); }
    return this.getState();
  }
  dispose() { this.cancelAll('PowerView quit · timer cancelled.'); this.disposed = true; this.controller.removeListener('state', this.onState); this.controller.removeListener('intent', this.onIntent); this.controller.removeListener('gateway-event', this.onEvent); this.removeAllListeners(); }
}
module.exports = { SavedControls };
