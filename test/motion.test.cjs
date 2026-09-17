const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Controller } = require('../src/main/controller');
const { normalizeSnapshot } = require('../src/main/gateway-client');
const { defaults, cleanConfig } = require('../src/main/config-store');
const { DemoGateway } = require('../src/main/demo-gateway');
const { project } = require('../src/shared/shade-motion');

function setup(t, overrides = {}) {
  let saved = defaults(), time = 10000;
  const state = normalizeSnapshot({ rooms: [{ id: 1 }], shades: [{ id: 11, roomId: 1, type: 1, positions: { primary: .2 } }], scenes: [] }, 'home.local');
  const client = { address: 'home.local', identify: async () => ({ name: 'Home' }), getSnapshot: async () => structuredClone(state),
    setPositions: async () => {}, stopShade: async () => {}, dispose() {}, ...overrides };
  const store = { get: () => structuredClone(saved), save: value => { saved = cleanConfig(value); return structuredClone(saved); } };
  const controller = new Controller(store, { clientFactory: () => client, scheduleRefresh: false, now: () => time });
  t.after(() => controller.dispose());
  const event = (evt, position, target, eta, stamp = time) => controller.applyEvent({ evt, id: 11, isoDate: new Date(stamp).toISOString(),
    currentPositions: { primary: position }, ...(target === undefined ? {} : { targetPositions: { primary: target, etaInSeconds: eta } }) });
  return { controller, state, client, event, setTime: value => { time = value; } };
}

test('reported positions remain factual while the graphic can project the gateway travel time', async t => {
  const { controller, event } = setup(t); await controller.connect('home.local');
  await controller.moveShade({ id: '11', positions: { primary: 80 } });
  assert.equal(controller.state.targets['11'].positions.primary, 80);
  assert.equal(controller.state.snapshot.shades[0].positions.primary, 20);
  event('motion-started', .2, .8, 6);
  assert.equal(project(controller.state.motions['11'], 13000).primary, 50);
  assert.equal(project(controller.state.motions['11'], 20000).primary, 80);
  assert.equal(controller.state.snapshot.shades[0].positions.primary, 20);
});

test('cached refreshes cannot pull a moving or just-stopped shade back to its old position', async t => {
  const { controller, event, setTime, state } = setup(t); await controller.connect('home.local');
  event('motion-started', .3, .8, 6); await controller.refresh();
  assert.equal(controller.state.snapshot.shades[0].positions.primary, 30);
  setTime(12500); event('motion-stopped', .51); await controller.refresh();
  assert.equal(controller.state.snapshot.shades[0].positions.primary, 51);
  assert.equal(controller.state.motions['11'], undefined);
  state.shades[0].positions.primary = 51; await controller.refresh();
  assert.equal(controller.state.snapshot.shades[0].positions.primary, 51);
});

test('a late HTTP acknowledgment cannot undo a final movement event', async t => {
  let release;
  const { controller, event, setTime } = setup(t, { setPositions: () => new Promise(resolve => { release = resolve; }) });
  await controller.connect('home.local'); const command = controller.moveShade({ id: '11', positions: { primary: 80 } });
  event('motion-started', .2, .8, 1); setTime(11001); event('motion-stopped', .8);
  release(); await command;
  assert.equal(controller.state.feedback['shade:11'].kind, 'reported');
  assert.equal(controller.state.targets['11'], undefined);
});

test('Stop freezes the estimate and the stop report settles the actual position', async t => {
  const { controller, event, setTime } = setup(t); await controller.connect('home.local');
  event('motion-started', .2, .8, 6); setTime(13000);
  await controller.shadeAction({ id: '11', action: 'stop' });
  assert.equal(project(controller.state.motions['11'], 20000).primary, 50);
  assert.equal(controller.state.motions['11'].status, 'stopping');
  setTime(13020); event('motion-stopped', .49);
  assert.equal(controller.state.snapshot.shades[0].positions.primary, 49);
  assert.equal(controller.state.motions['11'], undefined);
});

test('missing or invalid ETA never invents intermediate positions', async t => {
  const { controller, event, setTime } = setup(t); await controller.connect('home.local');
  for (const eta of [undefined, -2, Infinity, '4', 99999]) {
    setTime((controller.eventTimes.get('11') || 10000) + 1); event('motion-started', .2, .8, eta);
    assert.equal(controller.state.motions['11'].durationMs, null);
    assert.equal(project(controller.state.motions['11'], 1000000).primary, 20);
  }
});

test('out-of-order motion events cannot restart a completed movement', async t => {
  const { controller, event, setTime } = setup(t); await controller.connect('home.local');
  event('motion-started', .2, .8, 6); setTime(17000); event('motion-stopped', .8);
  event('motion-started', .2, .8, 6, 10000);
  assert.equal(controller.state.motions['11'], undefined);
  assert.equal(controller.state.snapshot.shades[0].positions.primary, 80);
});

test('losing live updates freezes motion, and switching homes clears targets and animations', async t => {
  const { controller, event, setTime } = setup(t); await controller.connect('home.local');
  event('motion-started', .2, .8, 6); setTime(13000); controller.freezeMotion('stale');
  assert.equal(project(controller.state.motions['11'], 20000).primary, 50);
  await controller.connect('other.local');
  assert.deepEqual(controller.state.motions, {}); assert.deepEqual(controller.state.targets, {});
});

test('demo shades travel over time and Stop holds the intermediate position', async t => {
  let time = 10000; const demo = new DemoGateway({ now: () => time, latency: 0 }); t.after(() => demo.dispose());
  const events = []; demo.startEvents(event => events.push(event), () => {});
  const snapshot = await demo.getSnapshot(); await demo.setPositions(snapshot.shades[0], { primary: 0 });
  assert.equal(events[0].evt, 'motion-started'); assert.ok(events[0].targetPositions.etaInSeconds > 0);
  time += 1000; const halfway = await demo.getSnapshot();
  assert.ok(halfway.shades[0].positions.primary > 0 && halfway.shades[0].positions.primary < 65);
  await demo.stopShade('11'); const stopped = (await demo.getSnapshot()).shades[0].positions.primary;
  time += 10000; assert.equal((await demo.getSnapshot()).shades[0].positions.primary, stopped);
  assert.equal(events.at(-1).evt, 'motion-stopped');
});

test('appearance preferences persist per home and never send movement commands', async t => {
  let moves = 0; const { controller } = setup(t, { setPositions: async () => { moves++; } });
  await controller.connect('home.local');
  const appearance = { kind: 'curtain', fabric: 'pleated', color: '#b68471' };
  controller.setAppearance({ id: '11', appearance });
  assert.deepEqual(controller.state.config.appearances['home.local']['11'], appearance);
  await controller.connect('other.local'); assert.equal(controller.state.config.appearances['other.local'], undefined);
  assert.throws(() => controller.setAppearance({ id: '11', appearance: { ...appearance, color: 'url(file:///bad)' } }));
  await controller.connect('home.local'); controller.setAppearance({ id: '11', appearance: null });
  assert.equal(controller.state.config.appearances['home.local']['11'], undefined); assert.equal(moves, 0);
});
