const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Shortcuts, positionsForPercent } = require('../src/main/shortcuts');
const { cleanSettings, normalizeAccelerator, fromEvent } = require('../src/shared/shortcut-format');
const { ConfigStore, cleanConfig, defaults } = require('../src/main/config-store');
const { capabilitiesFor } = require('../src/main/capabilities');

const binding = (override = {}) => ({ id: 'close', target: 'shade', targetId: '41', action: 'close', enabled: true, accelerator: 'Control+Shift+C', ...override });
const settings = bindings => ({ enabled: true, bindings });
function fixture(t, bindings = [binding()]) {
  const controller = new EventEmitter();
  let config = { ...defaults(), shortcuts: { demo: settings(bindings) } }, clock = 1000;
  const calls = [], notices = [], reserved = new Set(), registered = new Map();
  const api = { register(key, callback) { if (reserved.has(key) || registered.has(key)) return false; registered.set(key, callback); return true; }, unregister(key) { registered.delete(key); } };
  const shade = { id: '41', roomId: '4', name: 'Desk window', type: 51, available: true, controls: capabilitiesFor({ type: 51 }), positions: { primary: 100 } };
  controller.epoch = 1;
  controller.state = { config, connection: { address: 'demo', status: 'demo', name: 'Demo home' }, snapshot: {
    shades: [shade], rooms: [{ id: '4', name: 'Office' }], scenes: [{ id: '101', name: 'Focus' }],
  } };
  controller.store = { get: () => structuredClone(config), save(value) { config = cleanConfig(value); return structuredClone(config); } };
  controller.publish = () => controller.emit('state', controller.state);
  controller.shadeAction = async value => { calls.push(['shade', value]); };
  controller.moveShade = async value => { calls.push(['position', value]); };
  controller.roomAction = async value => { calls.push(['room', value]); return [{ ok: true }]; };
  controller.activateScene = async value => { calls.push(['scene', value]); };
  controller.refresh = async () => { calls.push(['refresh']); };
  const manager = new Shortcuts(controller, api, { now: () => clock, notify: value => notices.push(value), toggleWindow: () => calls.push(['toggle']) });
  t.after(() => manager.dispose());
  return { manager, controller, registered, api, reserved, calls, notices, advance: (ms = 1000) => { clock += ms; }, shade };
}

test('shortcut capture normalizes modifiers and rejects bare, malformed or ambiguous bindings', () => {
  assert.equal(normalizeAccelerator('Shift+ctrl+c'), 'Control+Shift+C');
  assert.equal(normalizeAccelerator('cmd+option+K'), 'Alt+Super+K');
  assert.equal(fromEvent({ key: 'H', code: 'KeyH', ctrlKey: true, shiftKey: true }), 'Control+Shift+H');
  assert.equal(fromEvent({ key: 'Shift', shiftKey: true }), null);
  assert.equal(fromEvent({ key: 'c', ctrlKey: true, repeat: true }), null);
  for (const bad of ['C', 'Shift+C', 'Ctrl+Ctrl+C', 'Ctrl+', 'Ctrl+Escape', 'Ctrl+F25', null]) assert.throws(() => normalizeAccelerator(bad));
  for (const bad of [binding({ id: undefined }), binding({ target: 'constructor' }), binding({ targetId: '../42' }), binding({ target: 'room', action: 'position' }), binding({ action: 'position', percent: 100.1 }), binding({ action: 'position', percent: '50' })]) assert.throws(() => cleanSettings(settings([bad])));
  assert.throws(() => cleanSettings(settings([binding(), binding({ id: 'duplicate', accelerator: 'shift+ctrl+c' })])), /more than once/);
  assert.equal(cleanSettings(settings([binding(), binding({ id: 'disabled', enabled: false })])).bindings.length, 2);
  assert.throws(() => cleanSettings(settings(Array.from({ length: 41 }, (_, index) => binding({ id: String(index), enabled: false })))), /40/);
});

test('shortcuts persist independently per home and corrupt bindings cannot become commands', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'powerview-shortcut-config-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new ConfigStore(directory), demo = settings([binding()]), real = settings([binding({ action: 'open' })]);
  store.save({ ...store.get(), shortcuts: { demo, 'home.local': real, invalid: settings([binding({ accelerator: 'C' })]) } });
  assert.deepEqual(new ConfigStore(directory).get().shortcuts, { demo, 'home.local': real });
  const malicious = JSON.parse('{"shortcuts":{"__proto__":{"enabled":true,"bindings":[]}}}');
  assert.deepEqual(cleanConfig(malicious).shortcuts, {});
});

test('position shortcuts respect closed percentages, top-down direction and dual/tilt capabilities', () => {
  const shade = type => ({ type, controls: capabilitiesFor({ type }) });
  assert.deepEqual(positionsForPercent(shade(1), 25), { primary: 75 });
  assert.deepEqual(positionsForPercent(shade(7), 25), { primary: 25 });
  assert.deepEqual(positionsForPercent(shade(9), 50), { primary: 50, secondary: 0 });
  assert.deepEqual(positionsForPercent(shade(51), 50), { primary: 50, tilt: 100 });
  assert.deepEqual(positionsForPercent(shade(26), 100), { primary: 0 });
  for (const type of [40, 65, 999]) assert.throws(() => positionsForPercent(shade(type), 50));
  for (const percent of [NaN, '50', -1, 101]) assert.throws(() => positionsForPercent(shade(1), percent));
});

test('shade, room, home, scene and app shortcuts dispatch through the appropriate controller action', async t => {
  const bindings = [binding(), binding({ id: 'half', action: 'position', percent: 50, accelerator: 'Control+Shift+H' }),
    binding({ id: 'room', target: 'room', targetId: '4', accelerator: 'Control+Shift+R' }),
    binding({ id: 'home', target: 'home', action: 'stop', accelerator: 'Control+Shift+S' }),
    binding({ id: 'scene', target: 'scene', targetId: '101', action: 'activate', accelerator: 'Control+Shift+F' }),
    binding({ id: 'app', target: 'app', action: 'toggle', accelerator: 'Control+Shift+P' }),
    binding({ id: 'refresh', target: 'app', action: 'refresh', accelerator: 'Control+Shift+U' })];
  const { manager, calls } = fixture(t, bindings);
  for (const item of bindings) assert.equal(await manager.trigger(item.id), true);
  assert.deepEqual(calls, [['shade', { id: '41', action: 'close' }], ['position', { id: '41', positions: { primary: 50, tilt: 100 } }],
    ['room', { roomId: '4', action: 'close' }], ['room', { roomId: null, action: 'stop' }], ['scene', '101'], ['toggle'], ['refresh']]);
});

test('editor pauses owned keys; cancelling restores them without changing saved preferences', async t => {
  const { manager, registered, controller, calls, api } = fixture(t);
  api.register('Control+Alt+X', () => {}); // Another feature owns this key.
  manager.setEditing(true);
  assert.deepEqual([...registered.keys()], ['Control+Alt+X']);
  assert.equal(await manager.trigger('close'), false); assert.deepEqual(calls, []);
  assert.equal(manager.getState().rows[0].status, 'paused');
  manager.setEditing(false); assert.equal(registered.has('Control+Shift+C'), true);
  assert.deepEqual(controller.store.get().shortcuts.demo, settings([binding()]));
  manager.dispose(); assert.deepEqual([...registered.keys()], ['Control+Alt+X']);
});

test('conflicting saves release probe keys and preserve the previous bindings atomically', t => {
  const { manager, registered, reserved, controller } = fixture(t);
  manager.setEditing(true); reserved.add('Control+Shift+O');
  assert.throws(() => manager.save({ address: 'demo', ...settings([binding({ accelerator: 'Control+Shift+H' }), binding({ id: 'open', action: 'open', accelerator: 'Control+Shift+O' })]) }), /unavailable/);
  assert.equal(registered.size, 0); assert.equal(manager.editing, true);
  assert.deepEqual(controller.store.get().shortcuts.demo, settings([binding()]));
  manager.setEditing(false); assert.equal(registered.has('Control+Shift+C'), true);
  controller.store.save = () => { throw new Error('Disk full'); };
  assert.throws(() => manager.save({ address: 'demo', ...settings([binding({ accelerator: 'Control+Shift+H' })]) }), /Disk full/);
  assert.equal(registered.has('Control+Shift+C'), true); assert.equal(registered.has('Control+Shift+H'), false);
});

test('changing homes or replacing a binding invalidates queued callbacks from the old registration', async t => {
  const { manager, controller, registered, calls } = fixture(t);
  const old = registered.get('Control+Shift+C');
  manager.save({ address: 'demo', ...settings([binding({ action: 'open' })]) });
  old(); assert.deepEqual(calls, []);
  const saved = registered.get('Control+Shift+C');
  controller.state.connection = { address: 'real.local', status: 'connected' }; controller.epoch++; controller.publish();
  saved(); assert.deepEqual(calls, []); assert.equal(registered.size, 0);
  assert.throws(() => manager.save({ address: 'demo', ...settings([binding()]) }), /home changed/);
  controller.state.connection = { address: 'demo', status: 'demo' }; controller.epoch++; controller.publish();
  assert.equal(await manager.trigger('close'), true); assert.equal(calls[0][1].action, 'open');
});

test('offline homes release movement keys, retain app access and never replay commands on reconnect', async t => {
  const { manager, controller, registered, calls } = fixture(t, [binding(), binding({ id: 'app', target: 'app', action: 'toggle', accelerator: 'Control+Shift+P' })]);
  controller.state.connection.status = 'offline'; controller.publish();
  assert.equal(registered.has('Control+Shift+C'), false); assert.equal(registered.has('Control+Shift+P'), true);
  assert.equal(await manager.trigger('close'), false);
  assert.equal(await manager.trigger('app'), true);
  controller.state.connection.status = 'demo'; controller.publish();
  assert.deepEqual(calls, [['toggle']]); assert.equal(registered.has('Control+Shift+C'), true);
});

test('held-key callbacks are debounced and Stop can interrupt a pending movement', async t => {
  const { manager, controller, calls, advance } = fixture(t, [binding(), binding({ id: 'stop', action: 'stop', accelerator: 'Control+Shift+S' })]);
  let resolve;
  controller.shadeAction = async value => { calls.push(value); if (value.action === 'close') await new Promise(done => { resolve = done; }); };
  const first = manager.trigger('close'); advance(1000);
  assert.equal(await manager.trigger('close'), false); assert.equal(await manager.trigger('stop'), true);
  resolve(); assert.equal(await first, true);
  advance(50); assert.equal(await manager.trigger('stop'), false);
  advance(100); assert.equal(await manager.trigger('close'), false);
  assert.deepEqual(calls.map(item => item.action), ['close', 'stop']);
});

test('command failure and partial room results are reported without claiming completed movement', async t => {
  const { manager, controller, notices, advance } = fixture(t, [binding({ target: 'room', targetId: '4' })]);
  controller.roomAction = async () => [{ ok: true }, { ok: false }];
  assert.equal(await manager.trigger('close'), false); assert.match(notices[0], /1 of 2 commands accepted/);
  advance(); controller.roomAction = async () => { throw new Error('Gateway rejected the request'); };
  assert.equal(await manager.trigger('close'), false); assert.match(manager.lastRun.message, /Gateway rejected/);
});

test('startup conflicts and unavailable devices are visible; master disable releases every owned key', t => {
  const { manager, reserved, registered, controller, shade } = fixture(t);
  manager.release(); reserved.add('Control+Shift+C'); manager.sync(true);
  assert.equal(manager.getState().rows[0].status, 'conflict'); assert.equal(registered.size, 0);
  reserved.clear(); shade.available = false; controller.publish();
  assert.equal(manager.getState().rows[0].status, 'offline');
  controller.state.snapshot.shades = []; controller.publish(); assert.equal(manager.getState().rows[0].status, 'missing');
  manager.save({ address: 'demo', enabled: false, bindings: [binding()] });
  assert.equal(manager.getState().rows[0].status, 'disabled'); assert.equal(registered.size, 0);
});

test('a late acknowledgment from a previous home cannot become current shortcut feedback', async t => {
  const { manager, controller, notices } = fixture(t);
  let resolve; controller.shadeAction = () => new Promise(done => { resolve = done; });
  const running = manager.trigger('close'); controller.epoch++; controller.publish(); resolve();
  assert.equal(await running, false); assert.deepEqual(notices, []); assert.equal(manager.lastRun, null);
});
