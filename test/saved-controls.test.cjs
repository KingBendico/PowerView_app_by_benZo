const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Controller } = require('../src/main/controller');
const { SavedControls } = require('../src/main/saved-controls');
const { Shortcuts } = require('../src/main/shortcuts');
const { defaults, cleanConfig } = require('../src/main/config-store');
const { normalizeSnapshot, GatewayClient } = require('../src/main/gateway-client');
const { cleanHome } = require('../src/shared/saved-controls-format');

async function setup(t) {
  let config = defaults(), clock = 10000, eventTime = 10000;
  const store = { get: () => structuredClone(config), save(value) { config = cleanConfig(value); return structuredClone(config); } };
  const data = { rooms: [{ id: 1, ptName: 'Living room' }, { id: 2, ptName: 'Office' }], scenes: [{ id: 101, ptName: 'Evening', roomIds: [1] }], shades: [
    { id: 11, roomId: 1, type: 1, ptName: 'Front window', positions: { primary: .6 } },
    { id: 21, roomId: 2, type: 9, ptName: 'Dual shade', positions: { primary: .3, secondary: .2 } },
  ] };
  const calls = [], timers = new Map(), notices = []; let emit, fail = false, waitForMove = null, reports = true;
  const controller = new Controller(store, { now: () => clock, scheduleRefresh: false, clientFactory: address => ({
    address, identify: async () => ({ name: 'Test home' }), getSnapshot: async () => normalizeSnapshot(structuredClone(data), address), dispose() {},
    startEvents(callback, status) { emit = callback; status('open'); },
    async setPositions(shade, positions) {
      calls.push({ id: shade.id, positions: { ...positions } });
      if (fail) throw new Error('Motor refused'); if (waitForMove) await waitForMove;
      if (!reports) return;
      const raw = data.shades.find(item => String(item.id) === shade.id), target = Object.fromEntries(Object.entries(positions).map(([key, value]) => [key, value / 100]));
      emit({ evt: 'motion-started', id: shade.id, isoDate: new Date(++eventTime).toISOString(), currentPositions: raw.positions, targetPositions: { ...target, etaInSeconds: 1 } });
      Object.assign(raw.positions, target);
      emit({ evt: 'motion-stopped', id: shade.id, isoDate: new Date(++eventTime).toISOString(), currentPositions: raw.positions });
    }, stopShade: async id => { calls.push({ id, stop: true }); }, activateScene: async () => {},
  }) });
  await controller.connect('test.local');
  const service = new SavedControls(controller, { now: () => clock, notify: message => notices.push(message),
    setTimer(fn, ms) { const handle = { fn, at: clock + ms, unref() {} }; timers.set(handle, handle); return handle; }, clearTimer: handle => timers.delete(handle) });
  t.after(() => { service.dispose(); controller.dispose(); });
  return { controller, service, store, data, calls, notices, timers, advance(ms) { clock += ms; },
    event: value => emit({ isoDate: new Date(++eventTime).toISOString(), ...value }), setReports: value => { reports = value; }, setFailure: value => { fail = value; }, setWait: value => { waitForMove = value; } };
}
const start = (service, shadeIds = ['11']) => service.startPrivacy({ address: 'test.local', shadeIds, minutes: 1 });

test('preset capture sends no movement and saves exact per-shade rail positions independently of group membership', async t => {
  const { service, calls, store } = await setup(t);
  await service.save({ address: 'test.local', kind: 'presets', name: 'Working light', shadeIds: ['11', '21'] });
  await service.save({ address: 'test.local', kind: 'groups', name: 'Street-facing', shadeIds: ['11', '21'] });
  assert.equal(calls.length, 0);
  const preset = service.home().presets[0];
  assert.deepEqual(preset.positions.map(item => item.positions), [{ primary: 60 }, { primary: 30, secondary: 20 }]);
  assert.equal(store.get().savedControls['test.local'].groups[0].shadeIds.length, 2);
  await service.run({ address: 'test.local', kind: 'presets', id: preset.id, action: 'activate' });
  assert.deepEqual(calls.map(item => item.positions), [{ primary: 60 }, { primary: 30, secondary: 20 }]);
});

test('preset selection, names, stored positions and home boundaries are validated before saving or moving', async t => {
  const { service, controller, calls } = await setup(t);
  for (const value of [[], ['11', '11'], ['../1'], ['999']]) await assert.rejects(service.save({ address: 'test.local', kind: 'presets', name: 'Preset', shadeIds: value }));
  await assert.rejects(service.save({ address: 'other.local', kind: 'presets', name: 'Preset', shadeIds: ['11'] }), /home changed/);
  await assert.rejects(service.save({ address: 'test.local', kind: 'groups', name: ' ', shadeIds: ['11'] }), /name/);
  controller.state.motions['11'] = { status: 'moving', from: { primary: 60 }, target: { primary: 0 }, durationMs: 1000, startedAt: 10000 };
  await assert.rejects(service.save({ address: 'test.local', kind: 'presets', name: 'Preset', shadeIds: ['11'] }), /settle/);
  assert.equal(calls.length, 0);
  assert.throws(() => cleanHome({ groups: [], presets: [{ id: 'p', name: 'Bad', shadeIds: ['11'], positions: [{ id: '11', code: 0, positions: { primary: NaN } }] }] }));
});

test('privacy countdown starts after confirmed closing and expiry restores the original positions', async t => {
  const { service, calls, advance } = await setup(t);
  await start(service, ['11', '21']);
  const job = [...service.jobs.values()][0]; assert.equal(job.status, 'waiting'); assert.equal(job.dueAt, 70000);
  assert.deepEqual(calls.map(item => item.positions), [{ primary: 0 }, { primary: 0, secondary: 0 }]);
  advance(60000); await job.handle.fn();
  assert.equal(job.status, 'completed');
  assert.deepEqual(calls.slice(2).map(item => item.positions), [{ primary: 60 }, { primary: 30, secondary: 20 }]);
});

test('Cancel keeps positions and manual movement, Stop and scene activation cancel an existing restore', async t => {
  for (const action of ['cancel', 'move', 'stop', 'scene']) {
    const { service, controller, calls } = await setup(t); await start(service);
    const job = [...service.jobs.values()][0], before = calls.length;
    if (action === 'cancel') service.cancel(job.id);
    if (action === 'move') await controller.moveShade({ id: '11', positions: { primary: 25 } });
    if (action === 'stop') await controller.shadeAction({ id: '11', action: 'stop' });
    if (action === 'scene') await controller.activateScene('101');
    assert.equal(job.status, 'cancelled'); await service.restore(job.id);
    assert.equal(calls.length, before + Number(['move', 'stop'].includes(action)));
  }
});

test('external movement and a changed position found on refresh cannot be overwritten by a timer', async t => {
  const one = await setup(t); await start(one.service);
  const job = [...one.service.jobs.values()][0];
  one.event({ evt: 'motion-started', id: '11', currentPositions: { primary: 0 }, targetPositions: { primary: .3, etaInSeconds: 1 } });
  assert.equal(job.status, 'cancelled'); await one.service.restore(job.id); assert.equal(one.calls.length, 1);
  const two = await setup(t); await start(two.service); const second = [...two.service.jobs.values()][0];
  // Even immediately after closure, UI stale-read protection must not mask a changed physical position.
  two.data.shades[0].positions.primary = .4;
  await two.service.restore(second.id); assert.equal(second.status, 'error'); assert.equal(two.calls.length, 1);
});

test('connection loss, switching homes and sleep cancel timers, with no restart or late replay', async t => {
  for (const action of ['offline', 'stream', 'home', 'sleep', 'late']) {
    const { service, controller, calls, advance } = await setup(t); await start(service); const job = [...service.jobs.values()][0];
    if (action === 'offline') { controller.state.connection.status = 'offline'; controller.publish(); }
    if (action === 'stream') { controller.state.connection.live = 'retrying'; controller.publish(); }
    if (action === 'home') await controller.connect('other.local');
    if (action === 'sleep') service.cancelAll('Computer sleeping');
    if (action === 'late') { advance(120000); await service.restore(job.id, false); }
    assert.equal(job.status, 'cancelled'); assert.equal(calls.length, 1);
    assert.equal(controller.store.get().privacyTimers, undefined);
  }
});

test('closing failures never arm a restore; overlapping timers and invalid durations are rejected', async t => {
  const f = await setup(t);
  for (const minutes of [0, 241, 1.5, '30']) await assert.rejects(f.service.startPrivacy({ address: 'test.local', shadeIds: ['11'], minutes }));
  f.setFailure(true); await assert.rejects(start(f.service), /Motor refused/);
  assert.equal([...f.service.jobs.values()][0].status, 'error'); assert.equal(f.timers.size, 0);
  f.setFailure(false); await start(f.service);
  await assert.rejects(start(f.service), /already has/);
});

test('Stop interrupts queued group/preset commands and a partial failure is reported per shade', async t => {
  const f = await setup(t); await f.service.save({ address: 'test.local', kind: 'groups', name: 'Both', shadeIds: ['11', '21'] });
  const group = f.service.home().groups[0]; let release;
  f.setWait(new Promise(resolve => { release = resolve; }));
  const run = f.service.run({ address: 'test.local', kind: 'groups', id: group.id, action: 'close' });
  await f.controller.roomAction({ roomId: null, action: 'stop' }); release();
  const results = await run;
  assert.equal(results[0].ok, true); assert.equal(results[1].ok, false);
  assert.equal(f.calls.filter(item => item.positions).length, 1);
});

test('removing a preset makes its shortcut unavailable; saved presets and groups have global shortcut routing', async t => {
  const f = await setup(t); await f.service.save({ address: 'test.local', kind: 'presets', name: 'Focus', shadeIds: ['11'] });
  const preset = f.service.home().presets[0];
  const registered = new Map(), shortcuts = new Shortcuts(f.controller, { register(key, callback) { registered.set(key, callback); return true; }, unregister(key) { registered.delete(key); } }, { savedControls: f.service });
  t.after(() => shortcuts.dispose());
  shortcuts.save({ address: 'test.local', enabled: true, bindings: [{ id: 'preset-key', target: 'preset', targetId: preset.id, action: 'activate', enabled: true, accelerator: 'Control+Shift+P' }] });
  assert.equal(await shortcuts.trigger('preset-key'), true); assert.equal(f.calls.length, 1);
  f.service.remove({ address: 'test.local', kind: 'presets', id: preset.id });
  assert.equal(shortcuts.getState().rows[0].status, 'missing'); assert.equal(registered.size, 0);
});

test('HTTP success with a nonzero gateway command result is treated as a failed movement', async () => {
  for (const value of [{ err: 1, responses: [] }, { err: 0, responses: [{ id: 11, err: 7 }] }]) {
    const client = new GatewayClient('test.local', { fetchImpl: async () => Response.json(value) });
    await assert.rejects(client.stopShade('11'), error => error.code === 'COMMAND_REJECTED');
  }
});

test('an accepted close without position confirmation never starts the privacy countdown', async t => {
  const f = await setup(t); f.setReports(false); await start(f.service);
  const job = [...f.service.jobs.values()][0]; assert.equal(job.status, 'closing'); assert.equal(job.dueAt, null);
  f.advance(120000); await job.handle.fn(); assert.equal(job.status, 'cancelled'); assert.equal(f.calls.length, 1);
});

test('cancelling a restore in progress prevents commands to the remaining selected shades', async t => {
  const f = await setup(t); await start(f.service, ['11', '21']); const job = [...f.service.jobs.values()][0];
  let release; f.setWait(new Promise(resolve => { release = resolve; }));
  const restoring = f.service.restore(job.id); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.length, 3); f.service.cancel(job.id); release(); await restoring;
  assert.equal(f.calls.length, 3); assert.equal(job.status, 'cancelled');
});
