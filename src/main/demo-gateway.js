const { normalizeSnapshot, GatewayError } = require('./gateway-client');
const { capabilitiesFor, validatePositions } = require('./capabilities');
const { project } = require('../shared/shade-motion');
const { normalizeAutomations } = require('../shared/home-insights');

class DemoGateway {
  constructor({ now = Date.now, latency = 180, fullTravelMs = 8000, appearances = {} } = {}) {
    this.address = 'demo'; this.disposed = false;
    this.now = now; this.latency = latency; this.fullTravelMs = fullTravelMs; this.motions = new Map();
    this.data = {
      rooms: [{ id: 1, ptName: 'Living room', color: 0 }, { id: 2, ptName: 'Kitchen', color: 1 },
        { id: 3, ptName: 'Bedroom', color: 2 }, { id: 4, ptName: 'Office', color: 3 }],
      shades: [
        { id: 11, roomId: 1, ptName: 'Garden window', type: 1, positions: { primary: 0.65 }, batteryStatus: 3 },
        { id: 12, roomId: 1, ptName: 'Patio doors', type: 69, positions: { primary: 1 } },
        { id: 13, roomId: 1, ptName: 'Street window', type: 8, positions: { primary: 0.25, secondary: 0.35 }, batteryStatus: 2 },
        { id: 21, roomId: 2, ptName: 'Breakfast nook', type: 1, positions: { primary: 1 } },
        { id: 22, roomId: 2, ptName: 'Above the sink', type: 1, positions: { primary: 0.8 } },
        { id: 31, roomId: 3, ptName: 'Bedroom left', type: 9, positions: { primary: 0, secondary: 0.2 }, batteryStatus: 3 },
        { id: 32, roomId: 3, ptName: 'Bedroom right', type: 9, positions: { primary: 0, secondary: 0.2 }, batteryStatus: 3 },
        { id: 41, roomId: 4, ptName: 'Desk window', type: 51, positions: { primary: 0.45, tilt: 0.65 } },
      ],
      scenes: [{ id: 101, ptName: 'Morning light', roomIds: [1, 2] }, { id: 102, ptName: 'Evening privacy', roomIds: [1, 3] },
        { id: 103, ptName: 'Movie time', roomIds: [1] }, { id: 104, ptName: 'Focus time', roomIds: [4] },
        { id: 105, ptName: 'Good night', roomIds: [1, 2, 3, 4] }],
      colors: { colors: ['#8c9c7a', '#c1a37c', '#9e92ad', '#829daa'] }, active: [],
    };
    // Representative health and schedules; no scheduled demo action moves a shade.
    for (const shade of this.data.shades) {
      shade.powerType = [12, 21, 22].includes(shade.id) ? 12 : 2;
      shade.signalStrength = shade.id === 13 ? -78 : -54;
      shade.firmware = { revision: 3, subRevision: 0, build: 401 };
    }
    this.data.shades.find(shade => shade.id === 13).batteryStatus = 1;
    this.automations = [
      { id: 201, type: 10, enabled: true, days: 127, hour: 0, min: 15, sceneId: 101, errorShd_Ids: [] },
      { id: 202, type: 0, enabled: true, days: 31, hour: 9, min: 0, sceneId: 104, errorShd_Ids: [] },
      { id: 203, type: 14, enabled: true, days: 127, hour: 0, min: 45, sceneId: 102, errorShd_Ids: [13] },
      { id: 204, type: 0, enabled: true, days: 127, hour: 22, min: 30, sceneId: 105, errorShd_Ids: [] },
      { id: 205, type: 0, enabled: false, days: 96, hour: 20, min: 0, sceneId: 103, errorShd_Ids: [] },
    ];
    this.originalShades = new Map(this.data.shades.map(shade => [String(shade.id), structuredClone(shade)]));
    this.railPositions = new Map();
    for (const [id, appearance] of Object.entries(appearances)) {
      if (this.originalShades.has(id)) this.setAppearance(id, appearance);
    }
  }
  async wait() {
    await new Promise(resolve => setTimeout(resolve, this.latency));
    if (this.disposed) throw new GatewayError('Connection changed.', 'CANCELLED');
  }
  async identify() { return { address: 'demo', name: 'Demo home', role: 'Demo' }; }
  snapshot() {
    this.sync(); const snapshot = normalizeSnapshot(structuredClone(this.data), this.address);
    for (const shade of snapshot.shades) shade.demoOriginalKind = capabilitiesFor(this.originalShades.get(shade.id)).kind;
    return snapshot;
  }
  async getSnapshot() { await this.wait(); return this.snapshot(); }
  async getAutomations() { await this.wait(); return normalizeAutomations(this.automations); }
  async getGatewayInfo() { await this.wait(); return { firmware: '3.1.0 · Demo' }; }
  appearanceChangesType(id, appearance) {
    const original = this.originalShades.get(id), shade = this.data.shades.find(item => String(item.id) === id);
    if (!original || !shade || capabilitiesFor(original).kind !== 'dual-rail') return false;
    return shade.type !== (appearance?.kind === 'curtain' ? 69 : original.type);
  }
  setAppearance(id, appearance) {
    if (!this.appearanceChangesType(id, appearance)) return null;
    this.sync();
    const shade = this.data.shades.find(item => String(item.id) === id);
    clearTimeout(this.motions.get(shade.id)?.timer); this.motions.delete(shade.id);
    // A demo may change mechanism; preserve the uncovered area when converting.
    if (appearance?.kind === 'curtain') {
      this.railPositions.set(id, shade.positions.secondary);
      shade.positions = { primary: Math.min(1, shade.positions.primary + shade.positions.secondary) };
      shade.type = 69;
    } else {
      const opening = shade.positions.primary;
      const secondary = Math.min(opening, this.railPositions.get(id) ?? this.originalShades.get(id).positions.secondary);
      shade.positions = { primary: opening - secondary, secondary };
      shade.type = this.originalShades.get(id).type;
    }
    return this.snapshot().shades.find(item => item.id === id);
  }
  startEvents(onEvent, onStatus) { this.onEvent = onEvent; onStatus('open'); }
  emit(evt, shade, extra = {}) {
    if (!this.disposed) this.onEvent?.({ evt, id: shade.id, isoDate: new Date(this.now()).toISOString(),
      currentPositions: { ...shade.positions }, ...extra });
  }
  sync() {
    for (const [id, motion] of this.motions) {
      const shade = this.data.shades.find(item => item.id === id);
      Object.assign(shade.positions, project(motion, this.now()));
    }
  }
  beginMotion(shade, values) {
    this.sync(); clearTimeout(this.motions.get(shade.id)?.timer);
    const from = { ...shade.positions }, target = { ...from, ...values };
    const distance = Math.max(...Object.keys(values).map(axis => Math.abs(target[axis] - (from[axis] ?? target[axis]))));
    const motion = { from, target, startedAt: this.now(), durationMs: Math.max(400, distance * this.fullTravelMs) };
    this.motions.set(shade.id, motion);
    this.emit('motion-started', shade, { targetPositions: { ...target, etaInSeconds: motion.durationMs / 1000 } });
    motion.timer = setTimeout(() => {
      if (this.disposed || this.motions.get(shade.id) !== motion) return;
      Object.assign(shade.positions, target); this.motions.delete(shade.id); this.emit('motion-stopped', shade);
    }, motion.durationMs);
    motion.timer.unref?.();
  }
  async setPositions(shade, positions) {
    const values = validatePositions(shade, positions); await this.wait();
    this.beginMotion(this.data.shades.find(item => String(item.id) === shade.id), values);
    for (const scene of this.data.active) this.onEvent?.({ evt: 'scene-deactivated', id: scene.id });
    this.data.active = [];
  }
  async stopShade(id) {
    await this.wait(); this.sync(); const shade = this.data.shades.find(item => String(item.id) === id);
    clearTimeout(this.motions.get(shade.id)?.timer); this.motions.delete(shade.id); this.emit('motion-stopped', shade);
  }
  async jogShade() { await this.wait(); }
  async activateScene(sceneId) {
    await this.wait(); const scene = this.data.scenes.find(item => String(item.id) === sceneId);
    for (const shade of this.data.shades.filter(item => scene.roomIds.includes(item.roomId))) {
      const target = { primary: sceneId === '101' ? 1 : sceneId === '104' ? 0.4 : 0 };
      if ('secondary' in shade.positions) target.secondary = 0;
      this.beginMotion(shade, target);
    }
    this.data.active = [{ id: sceneId }];
    this.onEvent?.({ evt: 'scene-activated', id: sceneId });
  }
  dispose() { this.disposed = true; for (const motion of this.motions.values()) clearTimeout(motion.timer); this.motions.clear(); }
}
module.exports = { DemoGateway };
