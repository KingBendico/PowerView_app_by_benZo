const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Controller } = require('../src/main/controller');
const { normalizeSnapshot } = require('../src/main/gateway-client');
const { defaults, cleanConfig } = require('../src/main/config-store');
const { DemoGateway } = require('../src/main/demo-gateway');
const { project } = require('../src/shared/shade-motion');
const { panels, positionAt } = require('../src/shared/curtain-geometry');

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
  const appearance = { kind: 'curtain', fabric: 'pleated', color: '#b68471', draw: 'right' };
  controller.setAppearance({ id: '11', appearance });
  assert.deepEqual(controller.state.config.appearances['home.local']['11'], appearance);
  await controller.connect('other.local'); assert.equal(controller.state.config.appearances['other.local'], undefined);
  assert.throws(() => controller.setAppearance({ id: '11', appearance: { ...appearance, color: 'url(file:///bad)' } }));
  assert.throws(() => controller.setAppearance({ id: '11', appearance: { ...appearance, draw: 'invalid' } }));
  await controller.connect('home.local'); controller.setAppearance({ id: '11', appearance: null });
  assert.equal(controller.state.config.appearances['home.local']['11'], undefined); assert.equal(moves, 0);
});

test('single-draw and paired curtains map pointer targets to the visible fabric edge', () => {
  assert.deepEqual(panels(0, 'left'), { left: 4, right: 0 });
  assert.deepEqual(panels(50, 'left'), { left: 52, right: 0 });
  assert.deepEqual(panels(100, 'right'), { left: 0, right: 100 });
  assert.deepEqual(panels(50, 'split'), { left: 27, right: 27 });
  for (const draw of ['left', 'right', 'split']) {
    for (const closed of [0, 25, 50, 75, 100]) {
      const widths = panels(closed, draw);
      if (widths.left) assert.ok(Math.abs(positionAt(widths.left / 100, draw, 'left') - closed) < .001);
      if (widths.right) assert.ok(Math.abs(positionAt(1 - widths.right / 100, draw, 'right') - closed) < .001);
    }
  }
  const legacy = cleanConfig({ appearances: { demo: { 31: { kind: 'curtain', fabric: 'pleated', color: null } } } });
  assert.equal(legacy.appearances.demo['31'].draw, 'split');
});

test('Bedroom left can simulate curtains and restore both rails without changing coverage', async t => {
  let time = 10000;
  const demo = new DemoGateway({ now: () => time, latency: 0, fullTravelMs: 2000 }); t.after(() => demo.dispose());
  const curtain = { kind: 'curtain', fabric: 'pleated', color: null, draw: 'left' };
  let shade = demo.setAppearance('31', curtain);
  assert.equal(shade.controls.kind, 'vertical'); assert.equal(shade.demoOriginalKind, 'dual-rail');
  assert.deepEqual(shade.positions, { primary: 20 });
  await demo.setPositions(shade, { primary: 90 });
  assert.equal(demo.setAppearance('31', { ...curtain, draw: 'right' }), null);
  assert.equal(demo.motions.has(31), true, 'A texture or opening change should retain ongoing travel');
  time += 700; shade = demo.setAppearance('31', null);
  assert.equal(shade.type, 9); assert.equal(shade.controls.kind, 'dual-rail');
  assert.deepEqual(shade.positions, { primary: 35, secondary: 20 });
  assert.equal(demo.motions.has(31), false, 'The old mechanism must not finish a stale movement');
  shade = demo.setAppearance('31', curtain); await demo.setPositions(shade, { primary: 0 });
  time += 2000; shade = demo.setAppearance('31', null);
  assert.deepEqual(shade.positions, { primary: 0, secondary: 0 }, 'Restored rails must stay within their constraints');
});

test('demo covering changes survive reconnection, reset correctly and reject pending commands', async t => {
  const { controller } = setup(t); await controller.connect('', { demo: true });
  const appearance = { kind: 'curtain', fabric: 'roller', color: '#b68471', draw: 'right' };
  controller.state.pending['scene:101'] = true;
  assert.throws(() => controller.setAppearance({ id: '31', appearance }), /finish sending/);
  assert.equal(controller.state.config.appearances.demo, undefined); delete controller.state.pending['scene:101'];
  await controller.moveShade({ id: '31', positions: { primary: 50 } });
  controller.setAppearance({ id: '31', appearance });
  assert.equal(controller.state.motions['31'], undefined); assert.equal(controller.state.targets['31'], undefined);
  await controller.refresh(); assert.equal(controller.state.snapshot.shades.find(shade => shade.id === '31').controls.kind, 'vertical');
  await controller.connect('', { demo: true });
  assert.equal(controller.state.snapshot.shades.find(shade => shade.id === '31').controls.kind, 'vertical');
  assert.deepEqual(controller.state.config.appearances.demo['31'], appearance);
  controller.setAppearance({ id: '31', appearance: null }); await controller.refresh();
  assert.equal(controller.state.snapshot.shades.find(shade => shade.id === '31').controls.kind, 'dual-rail');
  assert.equal(controller.state.config.appearances.demo['31'], undefined);
});

test('real two-rail devices retain their hardware controls while allowing fabric changes', async t => {
  let moves = 0;
  const { controller, state } = setup(t, { setPositions: async () => { moves++; } });
  state.shades = normalizeSnapshot({ rooms: [], scenes: [], shades: [{ id: 11, type: 9, positions: { primary: .2, secondary: .3 } }] }, 'home.local').shades;
  await controller.connect('home.local');
  assert.throws(() => controller.setAppearance({ id: '11', appearance: { kind: 'curtain', fabric: 'roller', color: null, draw: 'left' } }), /two moving rails/);
  controller.setAppearance({ id: '11', appearance: { kind: 'shade', fabric: 'roller', color: '#b68471' } });
  assert.equal(controller.state.snapshot.shades[0].controls.kind, 'dual-rail');
  assert.deepEqual(controller.state.snapshot.shades[0].positions, { primary: 20, secondary: 30 }); assert.equal(moves, 0);
});
