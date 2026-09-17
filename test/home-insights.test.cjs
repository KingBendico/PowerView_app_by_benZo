const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeHealth, healthSummary, normalizeAutomations, scheduleTime, scheduleDays } = require('../src/shared/home-insights');
const { GatewayClient, normalizeSnapshot } = require('../src/main/gateway-client');
const { HomeInsights } = require('../src/main/home-insights');
const { Controller } = require('../src/main/controller');
const { defaults } = require('../src/main/config-store');

const automation = (values = {}) => ({ id: 201, type: 0, days: 31, enabled: true, hour: 9, min: 15, sceneId: 101, errorShd_Ids: [], ...values });
const snapshot = address => normalizeSnapshot({ rooms: [{ id: 1, ptName: 'Office' }], scenes: [{ id: 101, ptName: 'Work', roomIds: [1] }],
  shades: [{ id: 11, ptName: 'Desk shade', roomId: 1, type: 1, positions: { primary: .5 }, batteryStatus: 1, powerType: 2 }] }, address);
function harness(t, overrides = {}, options = {}) {
  let config = defaults();
  const store = { get: () => structuredClone(config), save(value) { config = structuredClone(value); return this.get(); } };
  const clients = [];
  const controller = new Controller(store, { scheduleRefresh: false, clientFactory: address => {
    const client = { address, identify: async () => ({ name: address }), getSnapshot: async () => snapshot(address),
      getAutomations: async () => normalizeAutomations([automation()]), getGatewayInfo: async () => ({ firmware: '3.1.0' }),
      setPositions: async () => {}, stopShade: async () => {}, dispose() {}, ...overrides };
    clients.push(client); return client;
  } });
  const insights = new HomeInsights(controller, options);
  t.after(() => { insights.dispose(); controller.dispose(); });
  return { controller, insights, clients };
}

test('battery health uses documented ranges, preserves missing data and ignores battery gauges on wired shades', () => {
  for (const [status, expected] of [[0, 'Depleted'], [1, '20% or less'], [2, '21–50%'], [3, '51–100%'], [null, 'Not reported']]) {
    const shade = { ...snapshot('home').shades[0], ...normalizeHealth({ batteryStatus: status, powerType: 2 }) };
    assert.equal(healthSummary(shade).battery, expected);
    assert.equal(shade.batteryLow, status !== null && status <= 1);
  }
  const wired = normalizeHealth({ powerType: 12, batteryStatus: 0, batteryPercent: 0, signalStrength: -57, firmware: { revision: 3, subRevision: 0, build: 401 } });
  assert.equal(wired.batteryLow, false); assert.equal(healthSummary(wired).battery, 'Wired power');
  assert.equal(wired.signalStrength, -57); assert.equal(wired.firmware, '3.0.401');
  const unknown = normalizeHealth({ batteryStatus: 12, batteryPercent: Infinity, signalStrength: 0, firmware: {} });
  assert.equal(unknown.batteryStatus, null); assert.equal(unknown.batteryPercent, null); assert.equal(unknown.signalStrength, null); assert.equal(unknown.firmware, null);
  assert.equal(healthSummary({ ...normalizeHealth({ batteryStatus: 3 }), batteryLow: true }).battery, 'Low battery reported');
});
test('health prioritizes offline and low battery while distinguishing unreported positions', () => {
  const shade = snapshot('home').shades[0];
  assert.equal(healthSummary({ ...shade, available: false }).priority, 0);
  assert.equal(healthSummary(shade).priority, 1);
  assert.deepEqual(healthSummary({ ...shade, batteryLow: false, positions: {} }).issues, ['Position not reported']);
  assert.deepEqual(healthSummary({ ...shade, batteryLow: false }).issues, []);
});
test('schedule day masks use Monday first and solar offsets retain direction without invented clock times', () => {
  assert.equal(scheduleDays(1), 'Mon'); assert.equal(scheduleDays(64), 'Sun'); assert.equal(scheduleDays(24), 'Thu, Fri');
  assert.equal(scheduleDays(31), 'Weekdays'); assert.equal(scheduleDays(96), 'Weekends'); assert.equal(scheduleDays(127), 'Every day');
  assert.equal(scheduleDays(0), 'No days selected'); assert.equal(scheduleDays(null), 'Days not reported');
  for (const [type, expected] of [[2, '1h 15m before sunrise'], [10, '1h 15m after sunrise'], [6, '1h 15m before sunset'], [14, '1h 15m after sunset']]) {
    const row = normalizeAutomations([automation({ type, hour: 1, min: 15 })])[0];
    assert.equal(scheduleTime(row).text, expected);
  }
  assert.equal(scheduleTime(normalizeAutomations([automation({ type: 10, hour: 0, min: 0 })])[0]).text, 'At sunrise');
  assert.equal(scheduleTime(normalizeAutomations([automation({ hour: 0, min: 5 })])[0]).text, '00:05');
});
test('unknown schedules and provisioning problems remain visible; malformed collections are rejected', () => {
  const row = normalizeAutomations([automation({ type: 77, days: 255, enabled: 'true', errorShd_Ids: [11, '11', 'bad', 12] })])[0];
  assert.equal(row.timingKnown, false); assert.equal(row.days, null); assert.equal(row.enabled, null);
  assert.deepEqual(row.errorShadeIds, ['11', '12']); assert.equal(scheduleTime(row).text, 'Time not reported');
  for (const bad of [{}, [null], [automation(), automation()], [automation({ id: '../gateway' })]]) assert.throws(() => normalizeAutomations(bad));
});
test('schedule and gateway information reads use only documented GET routes and omit gateway identifiers', async () => {
  const calls = [];
  const client = new GatewayClient('test.local', { fetchImpl: async (url, options) => {
    calls.push([new URL(url).pathname, options.method]);
    return Response.json(url.endsWith('/home/automations') ? [automation()] : { fwVersion: '3.1.475', serialNumber: 'private-serial' });
  } });
  assert.equal((await client.getAutomations())[0].sceneId, '101');
  assert.deepEqual(await client.getGatewayInfo(), { firmware: '3.1.475' });
  assert.deepEqual(calls, [['/home/automations', 'GET'], ['/gateway/info', 'GET']]); client.dispose();
});
test('optional schedule failures retain prior data and never take working shade controls offline', async t => {
  const { controller, insights } = harness(t);
  await controller.connect('home.local'); await insights.refresh();
  assert.equal(insights.getState().schedules.data.length, 1);
  controller.client.getAutomations = async () => { throw new Error('HTTP 503'); };
  await insights.refresh();
  const state = insights.getState();
  assert.equal(state.schedules.status, 'error'); assert.equal(state.schedules.data.length, 1); assert.equal(state.gateway.status, 'ready');
  assert.equal(controller.state.connection.status, 'connected');
  assert.deepEqual(await controller.moveShade({ id: '11', positions: { primary: 40 } }), { accepted: true });
});
test('failed first load is distinguishable from an empty schedule list', async t => {
  const { controller, insights } = harness(t, { getAutomations: async () => { throw new Error('Unavailable'); } });
  await controller.connect('home.local'); await insights.refresh();
  assert.equal(insights.getState().schedules.data, null); assert.equal(insights.getState().schedules.status, 'error');
  controller.client.getAutomations = async () => []; await insights.refresh();
  assert.deepEqual(insights.getState().schedules.data, []); assert.equal(insights.getState().schedules.status, 'ready');
});
test('late diagnostic responses cannot replace another home and histories stay isolated', async t => {
  const { controller, insights } = harness(t);
  await controller.connect('old.local'); await insights.refresh();
  await controller.moveShade({ id: '11', positions: { primary: 40 } });
  let finish; controller.client.getAutomations = () => new Promise(resolve => { finish = resolve; });
  const oldRead = insights.refresh();
  await controller.connect('new.local'); await insights.refresh();
  finish(normalizeAutomations([automation({ id: 999 })])); await oldRead;
  assert.equal(insights.getState().address, 'new.local'); assert.equal(insights.getState().schedules.data[0].id, '201');
  assert.equal(insights.getState().activity.some(item => item.kind === 'command'), false);
  await controller.connect('old.local'); await insights.refresh();
  assert.equal(insights.getState().activity.some(item => item.kind === 'command'), true);
});
test('command acceptance and failure are distinct from reported positions; repeated gateway events are deduplicated', async t => {
  const { controller, insights } = harness(t);
  await controller.connect('home.local'); await insights.refresh();
  await controller.moveShade({ id: '11', positions: { primary: 40 } });
  let activity = insights.getState().activity;
  assert.equal(activity.filter(item => item.kind === 'command').length, 1);
  assert.equal(activity.find(item => item.kind === 'command').status, 'accepted');
  assert.equal(activity.some(item => item.kind === 'report'), false);
  const report = { evt: 'motion-stopped', id: 11, isoDate: '2026-09-17T18:00:00Z', currentPositions: { primary: .4 } };
  controller.applyEvent(report); controller.applyEvent(report);
  activity = insights.getState().activity;
  assert.equal(activity.filter(item => item.title === 'Position reported').length, 1);
  assert.equal(activity.find(item => item.kind === 'report').source, 'gateway');
  controller.client.setPositions = async () => { throw new Error('Motor rejected command'); };
  await assert.rejects(controller.moveShade({ id: '11', positions: { primary: 80 } }));
  assert.equal(insights.getState().activity[0].status, 'error');
});
test('refresh settlement is recorded only when it confirms a pending movement', async t => {
  const { controller, insights } = harness(t);
  await controller.connect('home.local'); await insights.refresh(); await controller.refresh();
  assert.equal(insights.getState().activity.some(item => item.kind === 'report'), false);
  await controller.moveShade({ id: '11', positions: { primary: 50 } }); await controller.refresh(); await controller.refresh();
  assert.equal(insights.getState().activity.filter(item => item.title === 'Position confirmed by refresh').length, 1);
});
test('activity remains bounded and callbacks are removed on disposal', async t => {
  const { controller, insights } = harness(t, {}, { limit: 4 });
  await controller.connect('home.local'); await insights.refresh();
  for (let i = 0; i < 10; i++) controller.applyEvent({ evt: i % 2 ? 'shade-offline' : 'shade-online', id: 11, isoDate: new Date(1000 + i).toISOString() });
  assert.equal(insights.getState().activity.length, 4);
  insights.dispose(); assert.equal(controller.listenerCount('activity'), 0); assert.equal(controller.listenerCount('gateway-event'), 0);
});
