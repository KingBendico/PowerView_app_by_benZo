const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { GatewayClient, normalizeAddress, normalizeSnapshot } = require('../src/main/gateway-client');
const { capabilitiesFor, validatePositions } = require('../src/main/capabilities');
const { ConfigStore, defaults } = require('../src/main/config-store');
const { Controller } = require('../src/main/controller');

const raw = () => ({ rooms: [{ id: 1, ptName: 'Living room' }],
  shades: [{ id: 11, roomId: 1, ptName: 'Window', type: 1, positions: { primary: 0.25 } }],
  scenes: [{ id: 101, ptName: 'Evening', roomIds: [1] }] });
const snapshot = (address = 'test.local') => normalizeSnapshot(raw(), address);
function memoryStore() {
  let value = defaults();
  return { get: () => structuredClone(value), save(next) { value = structuredClone(next); return this.get(); } };
}
function fakeClient(address, overrides = {}) {
  return { address, identify: async () => ({ name: 'Home' }), getSnapshot: async () => snapshot(address),
    setPositions: async () => {}, stopShade: async () => {}, activateScene: async () => {}, dispose() {}, ...overrides };
}

test('address normalization accepts local hostnames and rejects URLs with credentials, paths or scripts', () => {
  assert.equal(normalizeAddress(' http://powerview-g3.local/ '), 'powerview-g3.local');
  assert.equal(normalizeAddress('192.168.1.20:8000'), '192.168.1.20:8000');
  for (const bad of ['', 'http://user:password@host', 'host/path', 'host?x=1', 'javascript:alert(1)', '999.999.999.999', 'foo bar', 'https://host']) {
    assert.throws(() => normalizeAddress(bad));
  }
});

test('a secondary-only update never invents a primary value', () => {
  const shade = { type: 9, positions: { primary: 20, secondary: 30 } };
  assert.equal(capabilitiesFor(shade).axes.length, 2);
  assert.deepEqual(validatePositions(shade, { secondary: 40 }), { secondary: 0.4 });
  assert.throws(() => validatePositions(shade, { secondary: 90 }), /cross/);
  assert.throws(() => validatePositions(shade, { tilt: 40 }), /Unsupported/);
});

test('unknown capabilities and invalid numeric positions cannot generate commands', () => {
  assert.equal(capabilitiesFor({ type: 999 }).known, false);
  assert.throws(() => validatePositions({ type: 999 }, { primary: 10 }));
  for (const bad of [NaN, Infinity, -1, 101, '50']) assert.throws(() => validatePositions({ type: 1 }, { primary: bad }));
});

test('a gateway HTTP error is reported and mutation requests are never retried', async () => {
  let calls = 0;
  const client = new GatewayClient('test.local', { fetchImpl: async () => { calls++; return new Response('{"error":"failed"}', { status: 500 }); } });
  await assert.rejects(client.setPositions(snapshot().shades[0], { primary: 90 }), /HTTP 500/);
  assert.equal(calls, 1);
});

test('transport failure retries reads once but never movement commands', async () => {
  let calls = 0;
  const client = new GatewayClient('test.local', { fetchImpl: async () => { calls++; throw new Error('offline'); } });
  await assert.rejects(client.request('/home/rooms'), /Cannot reach/); assert.equal(calls, 2);
  calls = 0; await assert.rejects(client.activateScene('101'), /Cannot reach/); assert.equal(calls, 1);
});

test('scene activation uses the Gen 3 resource path and allows a 204 acknowledgment', async () => {
  let captured;
  const client = new GatewayClient('test.local', { fetchImpl: async (url, options) => { captured = { url, options }; return new Response(null, { status: 204 }); } });
  await client.activateScene('101');
  assert.equal(captured.url, 'http://test.local/home/scenes/101/activate');
  assert.equal(captured.options.method, 'PUT');
  assert.equal(captured.options.redirect, 'error');
});

test('malformed and empty read responses become actionable errors', async () => {
  for (const response of ['', '<html>not a gateway</html>']) {
    const client = new GatewayClient('test.local', { fetchImpl: async () => new Response(response) });
    await assert.rejects(client.request('/home/rooms'), error => error.code === 'INVALID_RESPONSE');
  }
  assert.throws(() => normalizeSnapshot({ ...raw(), rooms: {} }, 'test.local'), /Gen 3/);
});

test('requests time out and dispose cancels outstanding requests', async () => {
  const fetchImpl = (url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  const timeout = new GatewayClient('test.local', { fetchImpl, timeout: 10, readRetries: 0 });
  await assert.rejects(timeout.request('/home/rooms'), error => error.code === 'TIMEOUT');
  const cancelled = new GatewayClient('test.local', { fetchImpl, timeout: 10000 });
  const request = cancelled.request('/home/rooms'); cancelled.dispose();
  await assert.rejects(request, error => error.code === 'CANCELLED');
  assert.equal(cancelled.controllers.size, 0);
});

test('secondary gateways are rejected by role, not IP order', async () => {
  const client = new GatewayClient('test.local', { fetchImpl: async () => Response.json({ config: { mgwStatus: { running: true }, mgwConfig: { primary: false } } }) });
  await assert.rejects(client.identify(), error => error.code === 'SECONDARY_GATEWAY');
});

test('config migrates the original IP field and recovers corrupt JSON with a backup', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'powerview-config-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'config.json');
  fs.writeFileSync(file, '{"ipAddress":"192.168.1.20"}');
  const store = new ConfigStore(directory);
  assert.equal(store.get().ipAddress, '192.168.1.20'); assert.equal(store.get().schemaVersion, 2);
  store.save({ ...store.get(), theme: 'dark' }); assert.equal(new ConfigStore(directory).get().theme, 'dark');
  fs.writeFileSync(file, '{broken');
  const recovered = new ConfigStore(directory);
  assert.equal(recovered.get().ipAddress, ''); assert.match(recovered.notice, /backup/);
  assert.ok(fs.readdirSync(directory).some(name => name.startsWith('config.json.recovery-')));
});

test('failed shade commands preserve reported position and expose a visible failure', async t => {
  const controller = new Controller(memoryStore(), { scheduleRefresh: false,
    clientFactory: address => fakeClient(address, { setPositions: async () => { throw new Error('Command refused'); } }) });
  t.after(() => controller.dispose()); await controller.connect('test.local');
  await assert.rejects(controller.moveShade({ id: '11', positions: { primary: 90 } }), /refused/);
  const state = controller.getState();
  assert.equal(state.snapshot.shades[0].positions.primary, 25);
  assert.equal(state.feedback['shade:11'].kind, 'error'); assert.equal(state.pending['shade:11'], undefined);
});

test('accepted commands also preserve reported position until a gateway refresh', async t => {
  const controller = new Controller(memoryStore(), { scheduleRefresh: false, clientFactory: fakeClient });
  t.after(() => controller.dispose()); await controller.connect('test.local');
  await controller.moveShade({ id: '11', positions: { primary: 90 } });
  assert.equal(controller.getState().snapshot.shades[0].positions.primary, 25);
  assert.equal(controller.getState().feedback['shade:11'].kind, 'success');
});

test('a slower previous connection cannot overwrite the newly selected home', async t => {
  let completeOld;
  const controller = new Controller(memoryStore(), { scheduleRefresh: false,
    clientFactory: address => fakeClient(address, address === 'old.local' ? { getSnapshot: () => new Promise(resolve => { completeOld = resolve; }) } : {}) });
  t.after(() => controller.dispose());
  const older = controller.connect('old.local'); await Promise.resolve();
  const rejection = assert.rejects(older, error => error.code === 'CANCELLED');
  await controller.connect('new.local'); completeOld(snapshot('old.local')); await rejection;
  assert.equal(controller.getState().connection.address, 'new.local');
  assert.equal(controller.getState().config.ipAddress, 'new.local');
});

test('a failed replacement connection retains the working home and saved address', async t => {
  const controller = new Controller(memoryStore(), { scheduleRefresh: false,
    clientFactory: address => fakeClient(address, address === 'bad.local' ? { identify: async () => { throw new Error('offline'); } } : {}) });
  t.after(() => controller.dispose()); await controller.connect('good.local');
  await assert.rejects(controller.connect('bad.local'));
  assert.equal(controller.getState().connection.address, 'good.local'); assert.equal(controller.getState().config.ipAddress, 'good.local');
});

test('favorites persist per gateway rather than leaking across homes', async t => {
  const controller = new Controller(memoryStore(), { scheduleRefresh: false, clientFactory: fakeClient });
  t.after(() => controller.dispose()); await controller.connect('one.local');
  controller.toggleFavorite({ kind: 'scene', id: '101' });
  await controller.connect('two.local'); assert.deepEqual(controller.getState().favorites.sceneIds, []);
  await controller.connect('one.local'); assert.deepEqual(controller.getState().favorites.sceneIds, ['101']);
});

test('room actions report each failure instead of marking the whole room successful', async t => {
  const data = snapshot(); data.shades.push({ ...data.shades[0], id: '12', name: 'Other shade' });
  const controller = new Controller(memoryStore(), { scheduleRefresh: false,
    clientFactory: address => fakeClient(address, { getSnapshot: async () => data,
      setPositions: async shade => { if (shade.id === '12') throw new Error('Device unavailable'); } }) });
  t.after(() => controller.dispose()); await controller.connect('test.local');
  const results = await controller.roomAction({ roomId: '1', action: 'close' });
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.equal(controller.getState().feedback['room:1'].kind, 'error');
  assert.equal(controller.getState().feedback['room:1'].message, '1 of 2 commands accepted.');
});

const { EventDecoder } = require('../src/main/gateway-events');
const { subnetHosts, NetworkScan } = require('../src/main/network-scan');
test('event decoder handles chunk boundaries, CRLF, comments and malformed events', () => {
  const events=[]; const decoder=new EventDecoder(event=>events.push(event));
  decoder.push(': heartbeat\r\ndata: {"evt":"motion-'); decoder.push('stopped","id":11}\r\n\r\ndata: invalid\n\n');
  assert.deepEqual(events,[{evt:'motion-stopped',id:11}]);
});
test('legacy preferences migrate without changing the original prefs file', t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'powerview-migration-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  fs.writeFileSync(path.join(directory,'config.json'),JSON.stringify({ipAddress:'test.local'}));
  const old=JSON.stringify({theme:'dark',favoriteScenes:[{id:101,name:'Evening'}],recentRooms:[{id:1,name:'Office'}],roomSort:'az'});
  fs.writeFileSync(path.join(directory,'prefs.json'),old);
  const store=new ConfigStore(directory); const config=store.get();
  assert.equal(config.theme,'dark');assert.equal(config.roomSort,'az');
  assert.deepEqual(config.favorites['test.local'].sceneIds,['101']);
  assert.equal(config.recent['test.local'].rooms[0].id,'1');
  assert.equal(fs.readFileSync(path.join(directory,'prefs.json'),'utf8'),old);
});
test('subnet bounds honor the netmask and exclude self, network and broadcast', () => {
  const hosts=subnetHosts('192.0.2.130','255.255.255.128');
  assert.equal(hosts[0],'192.0.2.129'); assert.equal(hosts.at(-1),'192.0.2.254');assert.equal(hosts.length,125);
  assert.equal(hosts.includes('192.0.2.130'),false);
  assert.deepEqual(subnetHosts('10.0.0.1','255.0.0.0'),[]);
});
test('scan cancellation aborts active work and schedules no new addresses', async () => {
  let count=0;const pending=[];
  const scan=new NetworkScan({getInterfaces:()=>[{name:'fixture',address:'192.0.2.1',netmask:'255.255.255.0'}],
    createClient:()=>{count++;let reject;return {identify:()=>new Promise((_,r)=>{reject=r;pending.push(r)}),dispose:()=>reject?.(new Error('cancelled'))}}});
  const promise=scan.start('fixture');assert.equal(count,12);scan.stop();const result=await promise;
  assert.equal(result.cancelled,true);assert.equal(count,12);
});
test('Stop remains available during movement and prevents queued bulk movement', async t => {
  const data=snapshot();for(let n=12;n<16;n++) data.shades.push({...data.shades[0],id:String(n)});
  const releases=[];let stops=0,moves=0;
  const controller=new Controller(memoryStore(),{scheduleRefresh:false,clientFactory:address=>fakeClient(address,{
    getSnapshot:async()=>data,setPositions:()=>{moves++;return new Promise(resolve=>releases.push(resolve))},stopShade:async()=>{stops++}
  })});t.after(()=>controller.dispose());await controller.connect('test.local');
  const open=controller.roomAction({roomId:'1',action:'open'});await Promise.resolve();
  await controller.roomAction({roomId:'1',action:'stop'});releases.forEach(resolve=>resolve());const results=await open;
  assert.equal(stops,5);assert.equal(moves,3);assert.equal(results.filter(r=>!r.ok).length,2);
});
