const { EventEmitter } = require('node:events');
const { cleanSettings, display, actionLabel } = require('../shared/shortcut-format');
const { capabilitiesFor } = require('./capabilities');

function supportsPosition(shade) {
  return !!shade?.controls?.known && !['tilt', 'overlapped'].includes(shade.controls.kind);
}
function positionsForPercent(shade, percent) {
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) throw new Error('Enter a whole percentage between 0 and 100.');
  if (!supportsPosition(shade)) throw new Error('This shade needs its individual rail or tilt controls for a custom position.');
  const cap = capabilitiesFor(shade);
  return { primary: cap.code === 6 ? percent : 100 - percent,
    ...(cap.code === 7 ? { secondary: 0 } : {}), ...([2, 4].includes(cap.code) ? { tilt: 100 } : {}) };
}

class Shortcuts extends EventEmitter {
  constructor(controller, globalShortcut, { now = Date.now, platform = process.platform, notify = () => {}, toggleWindow = () => {} } = {}) {
    super(); this.controller = controller; this.api = globalShortcut; this.now = now; this.platform = platform;
    this.notify = notify; this.toggleWindow = toggleWindow;
    this.registered = new Map(); this.errors = new Map(); this.lastPressed = new Map(); this.busy = new Set();
    this.editing = false; this.disposed = false; this.signature = ''; this.revision = 0; this.lastRun = null; this.rows = [];
    this.listener = () => this.sync(); controller.on('state', this.listener); this.sync();
  }
  settings() { return this.controller.state.config.shortcuts?.[this.controller.state.connection.address] || { enabled: true, bindings: [] }; }
  target(binding) {
    if (binding.target === 'app') return { name: 'PowerView' };
    if (binding.target === 'home') return { name: 'Whole home' };
    return this.controller.state.snapshot?.[`${binding.target}s`]?.find(item => item.id === binding.targetId);
  }
  availability(binding) {
    const state = this.controller.state, target = this.target(binding);
    if (!target) return { status: 'missing', message: 'Target unavailable' };
    if (binding.target === 'app') return null;
    if (!['connected', 'demo'].includes(state.connection.status)) return { status: 'offline', message: 'Waiting for gateway' };
    if (binding.target === 'shade') {
      if (!target.available && binding.action !== 'stop') return { status: 'offline', message: 'Shade offline' };
      if ((!target.controls.known && binding.action !== 'stop') || binding.action === 'position' && !supportsPosition(target)) return { status: 'unsupported', message: 'Action unavailable for this shade' };
    }
    return null;
  }
  getState() {
    const state = this.controller.state;
    return { address: state.connection.address, homeName: state.connection.name || 'Current home', platform: this.platform,
      ...structuredClone(this.settings()), editing: this.editing, rows: structuredClone(this.rows), lastRun: this.lastRun && { ...this.lastRun },
      shades: (state.snapshot?.shades || []).map(shade => ({ id: shade.id, name: shade.name, known: shade.controls.known,
        roomName: state.snapshot.rooms.find(room => room.id === shade.roomId)?.name || '',
        supportsPosition: supportsPosition(shade), dualRail: shade.controls.kind === 'dual-rail' })),
      rooms: (state.snapshot?.rooms || []).map(({ id, name }) => ({ id, name })),
      scenes: (state.snapshot?.scenes || []).map(({ id, name }) => ({ id, name })) };
  }
  publish() { if (!this.disposed) this.emit('state', this.getState()); }
  release() { for (const accelerator of this.registered.keys()) this.api.unregister(accelerator); this.registered.clear(); }
  sync(force = false) {
    if (this.disposed) return;
    const state = this.controller.state, settings = this.settings(), address = state.connection.address;
    const signature = JSON.stringify([address, this.controller.epoch, settings, state.connection.status, this.editing,
      state.snapshot?.shades.map(shade => [shade.id, shade.name, shade.available, shade.controls.code]), state.snapshot?.rooms, state.snapshot?.scenes]);
    if (!force && signature === this.signature) return;
    if (this.address !== address) { this.lastRun = null; this.lastPressed.clear(); this.errors.clear(); this.address = address; }
    this.signature = signature; this.release(); const revision = ++this.revision;
    this.rows = settings.bindings.map(binding => {
      let row = { status: 'active', message: 'Active' };
      if (!settings.enabled || !binding.enabled) row = { status: 'disabled', message: 'Disabled' };
      else if (this.availability(binding)) row = this.availability(binding);
      else if (this.editing) row = { status: this.errors.has(binding.accelerator) ? 'conflict' : 'paused', message: this.errors.get(binding.accelerator) || 'Paused while editing' };
      else {
        let ok = false;
        try { ok = this.api.register(binding.accelerator, () => { void this.trigger(binding.id, address, revision); }); } catch { /* Report unsupported or reserved combinations. */ }
        if (ok) { this.registered.set(binding.accelerator, binding.id); this.errors.delete(binding.accelerator); }
        else { row = { status: 'conflict', message: 'Key combination unavailable — change it and save' }; this.errors.set(binding.accelerator, row.message); }
      }
      return { id: binding.id, ...row };
    });
    this.publish();
  }
  setEditing(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('Invalid shortcut editor state.');
    this.editing = enabled; this.sync(); return this.getState();
  }
  save({ address, ...input } = {}) {
    if (!address || address !== this.controller.state.connection.address) throw new Error('The active home changed. Reopen keyboard shortcuts.');
    const settings = cleanSettings(input);
    for (const binding of settings.bindings) {
      const existing = this.settings().bindings.find(item => item.id === binding.id);
      if (!this.target(binding) && !(existing && existing.target === binding.target && existing.targetId === binding.targetId && (!binding.enabled || !settings.enabled))) throw new Error('Choose an available target, or disable the missing target’s shortcut.');
      if (settings.enabled && binding.enabled && this.availability(binding)?.status === 'unsupported') throw new Error('Choose a supported action for this shade.');
    }
    // Check every new combination before saving; a conflict must not replace working preferences.
    const probes = [];
    try {
      if (settings.enabled) for (const binding of settings.bindings.filter(item => item.enabled)) {
        if (this.registered.has(binding.accelerator)) continue;
        let ok = false;
        try { ok = this.api.register(binding.accelerator, () => {}); } catch { /* Registration result is surfaced below. */ }
        if (!ok) throw new Error(`${display(binding.accelerator, this.platform)} is unavailable. It may be reserved by the system or another app. Choose another combination.`);
        probes.push(binding.accelerator);
      }
    } finally { for (const accelerator of probes) this.api.unregister(accelerator); }
    const config = this.controller.store.get(); config.shortcuts ||= {}; config.shortcuts[address] = settings;
    this.controller.state.config = this.controller.store.save(config);
    this.editing = false; this.errors.clear(); this.lastPressed.clear();
    this.sync(true); this.controller.publish(); return this.getState();
  }
  async trigger(id, address = this.controller.state.connection.address, revision = this.revision) {
    const state = this.controller.state, settings = this.settings(), epoch = this.controller.epoch;
    const binding = settings.bindings.find(item => item.id === id);
    if (this.disposed || this.editing || revision !== this.revision || address !== state.connection.address || !settings.enabled || !binding?.enabled
        || this.registered.get(binding.accelerator) !== id || this.availability(binding)) return false;
    const now = this.now(), previous = this.lastPressed.get(id); this.lastPressed.set(id, now);
    const busyKey = `${epoch}:${id}`;
    if (this.busy.has(busyKey) || previous !== undefined && now - previous < 750) return false;
    this.busy.add(busyKey);
    const label = `${this.target(binding).name} · ${actionLabel(binding)}`;
    let result, message = 'command accepted';
    try {
      if (binding.target === 'shade') {
        if (binding.action === 'position') await this.controller.moveShade({ id: binding.targetId, positions: positionsForPercent(this.target(binding), binding.percent) });
        else await this.controller.shadeAction({ id: binding.targetId, action: binding.action });
      } else if (['room', 'home'].includes(binding.target)) {
        result = await this.controller.roomAction({ roomId: binding.target === 'home' ? null : binding.targetId, action: binding.action });
        const accepted = result.filter(item => item.ok).length;
        message = `${accepted} of ${result.length} commands accepted`;
        if (accepted !== result.length || !result.length) throw new Error(message);
      } else if (binding.target === 'scene') await this.controller.activateScene(binding.targetId);
      else if (binding.action === 'toggle') { this.toggleWindow(); message = 'done'; }
      else { await this.controller.refresh(); message = 'status refreshed'; }
      if (epoch !== this.controller.epoch || this.disposed) return false;
      this.lastRun = { id, at: new Date(this.now()).toISOString(), ok: true, message: `${label} — ${message}` };
    } catch (error) {
      if (epoch !== this.controller.epoch || this.disposed) return false;
      this.lastRun = { id, at: new Date(this.now()).toISOString(), ok: false, message: `${label} — ${error.message}` };
    } finally { this.busy.delete(busyKey); }
    this.notify(this.lastRun.message); this.publish(); return this.lastRun.ok;
  }
  dispose() { this.disposed = true; this.controller.removeListener('state', this.listener); this.release(); this.removeAllListeners(); }
}
module.exports = { Shortcuts, positionsForPercent };
