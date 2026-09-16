const { normalizeSnapshot, GatewayError } = require('./gateway-client');
const { validatePositions } = require('./capabilities');

class DemoGateway {
  constructor() {
    this.address = 'demo'; this.disposed = false;
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
  }
  async wait() {
    await new Promise(resolve => setTimeout(resolve, 180));
    if (this.disposed) throw new GatewayError('Connection changed.', 'CANCELLED');
  }
  async identify() { return { address: 'demo', name: 'Demo home', role: 'Demo' }; }
  async getSnapshot() { await this.wait(); return normalizeSnapshot(structuredClone(this.data), this.address); }
  async setPositions(shade, positions) {
    const values = validatePositions(shade, positions); await this.wait();
    Object.assign(this.data.shades.find(item => String(item.id) === shade.id).positions, values); this.data.active = [];
  }
  async stopShade() { await this.wait(); }
  async jogShade() { await this.wait(); }
  async activateScene(sceneId) {
    await this.wait(); const scene = this.data.scenes.find(item => String(item.id) === sceneId);
    for (const shade of this.data.shades.filter(item => scene.roomIds.includes(item.roomId))) {
      shade.positions.primary = sceneId === '101' ? 1 : sceneId === '104' ? 0.4 : 0;
      if ('secondary' in shade.positions) shade.positions.secondary = 0;
    }
    this.data.active = [{ id: sceneId }];
  }
  dispose() { this.disposed = true; }
}
module.exports = { DemoGateway };
