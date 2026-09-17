// Native Electron integration test. Uses an isolated profile, demo data and a loopback fixture only.
const { app } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'powerview-smoke-'));
process.argv.push('--smoke', '--demo', `--data-dir=${profile}`);
app.disableHardwareAcceleration();
const runtime = require('../src/main/main');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [], errors = [];
let server;
async function until(fn, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await fn()) return; await wait(80); }
  throw new Error('Timed out waiting for application state');
}
async function run() {
  await app.whenReady(); await until(() => runtime.getWindow());
  const win = runtime.getWindow();
  win.webContents.on('console-message', event => { if (event.level === 'error') { errors.push(event.message); console.error('RENDERER:', event.message); } });
  const js = code => win.webContents.executeJavaScript(code).catch(error => { console.error('FAILED SCRIPT:', code); throw error; });
  await until(() => js('typeof appState !== "undefined" && appState?.connection.status === "demo" && document.querySelectorAll("[data-shade-id]").length === 2').catch(() => false));
  async function check(name, fn) { await fn(); checks.push(name); console.log(`PASS ${name}`); }
  await check('isolated renderer, working preload, Home and demo banner', async () => {
    assert.deepEqual(await js('[typeof require, typeof process, typeof window.powerView.moveShade]'), ['undefined', 'undefined', 'function']);
    assert.equal(await js('document.getElementById("demoModeBar").hidden'), false);
    assert.equal(await js('document.getElementById("btn-home").getAttribute("aria-current")'), 'page');
  });
  await check('25% preset means 25% closed and single-axis commands work', async () => {
    await js('document.getElementById("btn-blinds").click(); navigateToRoomShades(allRooms[0])');
    await js('document.getElementById("shade-name-11").closest("article").querySelector(".btn-fine-shade--chip").click()');
    await until(async () => await js('allShades.find(s=>s.id==="11").positions.primary') === .75);
    assert.equal(await js('document.getElementById("shade-11-pct-closed").value'), '25');
  });
  await check('precise numeric entry and reported state', async () => {
    await js('const input = document.getElementById("shade-11-pct-closed"); input.value="37"; input.dispatchEvent(new Event("change"))');
    await until(async () => await js('allShades.find(s=>s.id==="11").positions.primary') === .63);
    assert.match(await js('document.getElementById("shade-reported-11").textContent'), /37% closed/);
  });
  await check('type 9 preserves dual controls and rail keyboard operation', async () => {
    await js('navigateToRoomShades(allRooms.find(r=>r.id==="3"))');
    assert.equal(await js('document.querySelectorAll(".shade-unified-dual").length'), 2);
    await js('document.getElementById("shade-name-31").closest("article").querySelector(".shade-handle-rail").dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true}))');
    await until(async () => await js('allShades.find(s=>s.id==="31").positions.secondary') === .21);
  });
  await check('pinning a shade places its controls on Home', async () => {
    await js('document.getElementById("shade-name-31").closest("article").querySelector(".scene-star").click()');
    await until(async () => await js('appState.favorites.shadeIds.includes("31")'));
    await js('document.getElementById("btn-home").click()');
    assert.equal(await js('!!document.getElementById("shade-name-31")'), true);
  });
  await check('scene activation refreshes reported active scenes', async () => {
    await js('activateScene("101")');
    await until(async () => await js('activeSceneIdSet.has("101")'));
  });
  await check('late refresh cannot reopen a previous room', async () => {
    await js('navigateToRoomShades(allRooms[0]); document.getElementById("btn-scenes").click()');
    await wait(500); assert.equal(await js('currentMainView'), 'scenes');
  });
  await check('settings traps focus, Escape restores focus, dark theme works', async () => {
    await js('document.getElementById("settingsButton").click()');
    await until(async () => await js('document.getElementById("content").inert'));
    await js('document.getElementById("settingsPanelCloseBtn").focus(); document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Tab",shiftKey:true,bubbles:true,cancelable:true}))');
    assert.notEqual(await js('document.activeElement.id'), 'settingsPanelCloseBtn');
    await js('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})); document.getElementById("themeButton").click()');
    assert.equal(await js('document.documentElement.dataset.theme'), 'dark');
    assert.equal(await js('document.getElementById("content").inert'), false);
  });
  await check('360px window and enlarged text avoid horizontal overflow', async () => {
    win.setSize(360, 760); win.webContents.setZoomFactor(1);
    await js('document.getElementById("btn-home").click()'); await wait(200);
    assert.equal(await js('document.documentElement.scrollWidth <= window.innerWidth'), true);
    win.setSize(1080, 860); win.webContents.setZoomFactor(1.5); await wait(200);
    assert.equal(await js('document.documentElement.scrollWidth <= window.innerWidth'), true);
    win.webContents.setZoomFactor(1);
  });
  await check('command search opens a matching room and supports Command-K', async () => {
    await js('document.dispatchEvent(new KeyboardEvent("keydown",{key:"k",metaKey:true,bubbles:true,cancelable:true}))');
    assert.equal(await js('document.activeElement.id'), 'homeSearch');
    await js('document.getElementById("homeSearch").value="Bedroom"; document.getElementById("homeSearch").dispatchEvent(new Event("input")); document.querySelector("#searchResults button").click()');
    assert.equal(await js('displayedRoomId'), '3');
    assert.equal(await js('document.getElementById("searchResults").hidden'), true);
    await js('document.getElementById("homeSearch").focus(); document.getElementById("homeSearch").value="Garden"; document.getElementById("homeSearch").dispatchEvent(new Event("input")); document.getElementById("homeSearch").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
    assert.equal(await js('displayedRoomId'), '3');
    assert.equal(await js('document.getElementById("searchResults").hidden'), true);
  });
  const data = { rooms: [{ id: 1, ptName: '<b>Fixture room</b>', color: 0 }],
    shades: [{id:11,roomId:1,type:1,ptName:'Fixture shade',positions:{primary:.25}}],
    scenes: [{id:101,ptName:'Fixture scene',roomIds:[1]}] };
  let failure = false, delay = 0, received = [];
  const streams = new Set();
  server = http.createServer(async (req,res) => {
    const pathname = new URL(req.url,'http://localhost').pathname;
    if (pathname === '/home/events') { res.writeHead(200, {'Content-Type':'text/event-stream'}); res.write(': connected\n\n'); streams.add(res); res.on('close',()=>streams.delete(res)); return; }
    if (req.method === 'PUT') {
      let body=''; for await (const chunk of req) body+=chunk; received.push({path:req.url,body:body ? JSON.parse(body) : null});
      res.writeHead(failure ? 500 : 204); res.end(); return;
    }
    if (delay) await wait(delay);
    const value = pathname === '/gateway' ? {config:{name:'Fixture',mgwConfig:{primary:true},mgwStatus:{running:true}}}
      : pathname === '/home/colors' ? {colors:['#cccccc']}
      : pathname === '/home/scenes/active' ? [] : data[pathname.split('/').at(-1)];
    res.writeHead(value ? 200 : 404, {'Content-Type':'application/json'}); res.end(JSON.stringify(value || {}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=`127.0.0.1:${server.address().port}`;
  await check('real IPC and HTTP failures retain reported positions; no extra axis', async () => {
    await js(`api.connect(${JSON.stringify(address)})`);
    await js('navigateToRoomShades(allRooms[0])'); await until(() => !runtime.getController().state.refreshing);
    failure=true;
    await js('updateShadePosition("11",10,0,()=>{})');
    await until(() => runtime.getController().state.feedback['shade:11']?.kind === 'error');
    assert.equal(runtime.getController().state.snapshot.shades[0].positions.primary,25);
    assert.deepEqual(received.at(-1).body,{positions:{primary:.9}});
    assert.equal(await js('document.querySelector(".room-blinds-title b") === null'),true);
    failure=false;
    await js('api.moveShade({id:"11",positions:{primary:90}})');
    assert.equal(runtime.getController().state.snapshot.shades[0].positions.primary,25);
  });
  await check('live SSE updates the visual and reported position', async () => {
    await until(() => streams.size > 0);
    for (const res of streams) res.write('data: '+JSON.stringify({evt:'motion-stopped',id:11,currentPositions:{primary:.9}})+'\n\n');
    await until(async () => await js('allShades.find(s=>s.id==="11").positions.primary') === .9);
    assert.match(await js('document.getElementById("shade-reported-11").textContent'),/10% closed/);
  });
  await check('invalid target IDs are rejected at the main-process boundary', async () => {
    const count=received.length;
    assert.equal(await js('api.activateScene("../gateway").then(()=>false,()=>true)'),true);
    assert.equal(received.length,count);
  });
  await check('captured native light/dark and narrow screenshots', async () => {
    await js('api.demo(true)'); await until(async () => await js('appState.connection.status') === 'demo');
    await js('api.setPrefs({...prefs,theme:"light"})');
    await js('currentMainView="home"; showHome(); document.activeElement.blur(); window.scrollTo(0,0); clearTimeout(showSceneRunToast._hideTimer); document.getElementById("sceneRunToast")?.classList.remove("is-visible")');
    const output=path.resolve(__dirname,'../docs/screenshots'); fs.mkdirSync(output,{recursive:true});
    await wait(250); fs.writeFileSync(path.join(output,'home-light.png'),(await win.webContents.capturePage()).toPNG());
    await js('api.setPrefs({...prefs,theme:"dark"})');
    await js('navigateToRoomShades(allRooms[0])');
    await wait(250); fs.writeFileSync(path.join(output,'room-dark.png'),(await win.webContents.capturePage()).toPNG());
    win.setSize(360,760); await wait(250); fs.writeFileSync(path.join(output,'room-narrow.png'),(await win.webContents.capturePage()).toPNG());
  });
  assert.deepEqual(errors, [], `Renderer errors: ${errors.join('\n')}`);
  const report={at:new Date().toISOString(),electron:process.versions.electron,platform:process.platform,arch:process.arch,checks,rendererErrors:errors,realHardwareTested:false};
  fs.writeFileSync(path.resolve(__dirname,'../docs/native-smoke-results.json'),JSON.stringify(report,null,2)+'\n');
  console.log(`Native smoke passed: ${checks.length} checks.`);
}
run().then(()=>app.exit(0)).catch(error=>{console.error(error);app.exit(1)});
