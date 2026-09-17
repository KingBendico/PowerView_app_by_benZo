// Native Electron integration test. Uses an isolated profile, demo data and a loopback fixture only.
const { app, globalShortcut } = require('electron');
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
  win.webContents.setBackgroundThrottling(false);
  win.webContents.on('console-message', event => { if (event.level === 'error') { errors.push(event.message); console.error('RENDERER:', event.message); } });
  const js = code => win.webContents.executeJavaScript(code).catch(error => { console.error('FAILED SCRIPT:', code); throw error; });
  await until(() => js('typeof appState !== "undefined" && appState?.connection.status === "demo" && document.querySelectorAll("[data-shade-id]").length === 2').catch(() => false));
  async function check(name, fn) {
    let deadline;
    try {
      await Promise.race([fn(), new Promise((_resolve,reject) => { deadline = setTimeout(() => reject(new Error(`Check timed out: ${name}`)),45000); })]);
      checks.push(name); console.log(`PASS ${name}`);
    }
    catch (error) {
      console.error('UI STATE:', await js(`(() => { const dialog = document.querySelector('dialog[open]'); return dialog ? {
        error: dialog.querySelector('[role=alert]')?.textContent,
        invalid: [...dialog.querySelectorAll(':invalid')].map(el => ({ id: el.id, message: el.validationMessage })),
        saveDisabled: dialog.querySelector('[type=submit]')?.disabled,
        pending: appState.pending
      } : null; })()`));
      throw error;
    }
    finally { clearTimeout(deadline); }
  }
  await check('isolated renderer, working preload, Home and demo banner', async () => {
    assert.deepEqual(await js('[typeof require, typeof process, typeof window.powerView.moveShade]'), ['undefined', 'undefined', 'function']);
    assert.equal(await js('document.getElementById("demoModeBar").hidden'), false);
    assert.equal(await js('document.getElementById("btn-home").getAttribute("aria-current")'), 'page');
  });
  await check('schedule timeline filters weekdays and paused routines, shows setup errors and sends no movement', async () => {
    await runtime.getInsights().refresh();
    const before = runtime.getController().commandSequence;
    await js('document.getElementById("btn-schedules").click()');
    assert.equal(await js('document.getElementById("btn-schedules").getAttribute("aria-current")'), 'page');
    assert.equal(await js('document.querySelectorAll(".schedule-row").length'), 4);
    assert.match(await js('document.getElementById("scheduleTimeline").textContent'), /15m after sunrise/);
    assert.match(await js('document.getElementById("scheduleTimeline").textContent'), /Not saved to: Street window/);
    await js('document.querySelector(".schedule-days [data-day=\\"5\\"]").click()');
    assert.equal(await js('document.querySelectorAll(".schedule-row").length'), 3);
    assert.equal(await js('!!document.querySelector("[data-schedule-id=\\"202\\"]")'), false);
    await js('document.getElementById("scheduleFilter").value="paused"; document.getElementById("scheduleFilter").dispatchEvent(new Event("change"))');
    assert.equal(await js('document.querySelectorAll(".schedule-row").length'), 1);
    assert.match(await js('document.getElementById("scheduleTimeline").textContent'), /Movie time.*Paused/);
    await js('document.querySelector(".schedule-days [data-day=\\"-1\\"]").click(); document.getElementById("scheduleFilter").value="all"; document.getElementById("scheduleFilter").dispatchEvent(new Event("change"))');
    assert.equal(runtime.getController().commandSequence, before);
    win.showInactive(); await wait(120);
    fs.writeFileSync(path.resolve(__dirname,'../docs/screenshots/schedules-light.png'),(await win.webContents.capturePage()).toPNG());
  });
  await check('health reports battery ranges, wired power and unknown values, and opens the correct room', async () => {
    await js('document.getElementById("btn-health").click()');
    assert.equal(await js('document.querySelector(".health-card").dataset.healthShade'), '13');
    assert.match(await js('document.querySelector("[data-health-shade=\\"13\\"]").textContent'), /20% or less/);
    assert.match(await js('document.querySelector("[data-health-shade=\\"21\\"]").textContent'), /Wired power/);
    assert.match(await js('document.querySelector("[data-health-shade=\\"41\\"]").textContent'), /Not reported/);
    await js('document.getElementById("healthFilter").value="attention"; document.getElementById("healthFilter").dispatchEvent(new Event("change"))');
    assert.equal(await js('document.querySelectorAll(".health-card").length'), 1);
    await js('document.querySelector(".health-card .text-action").click()');
    assert.equal(await js('displayedRoomId'), '1');
    await js('document.getElementById("btn-health").click(); document.getElementById("healthFilter").value="all"; document.getElementById("healthFilter").dispatchEvent(new Event("change"))');
    await until(() => !runtime.getController().state.refreshing);
    await wait(120); fs.writeFileSync(path.resolve(__dirname,'../docs/screenshots/health-light.png'),(await win.webContents.capturePage()).toPNG());
  });
  await check('activity separates accepted app commands from live position reports and supports issue filters', async () => {
    await js('api.moveShade({id:"41",positions:{primary:55}})');
    await until(() => !runtime.getController().state.motions['41']);
    await js('document.querySelector("[data-health-tab=activity]").click()');
    assert.match(await js('document.getElementById("activityList").textContent'), /This app · Accepted/);
    assert.match(await js('document.getElementById("activityList").textContent'), /Position reported/);
    assert.match(await js('document.getElementById("activityList").textContent'), /Gateway report · Reported/);
    runtime.getController().applyEvent({evt:'shade-offline',id:22});
    await js('document.getElementById("activityFilter").value="issues"; document.getElementById("activityFilter").dispatchEvent(new Event("change"))');
    assert.match(await js('document.getElementById("activityList").textContent'), /Above the sink · Shade offline/);
    runtime.getController().applyEvent({evt:'shade-online',id:22});
    await js('document.getElementById("activityFilter").value="all"; document.getElementById("activityFilter").dispatchEvent(new Event("change"))');
    await wait(120); fs.writeFileSync(path.resolve(__dirname,'../docs/screenshots/activity-light.png'),(await win.webContents.capturePage()).toPNG());
  });
  await check('schedule, health and activity views fit narrow dark windows and preserve focused filters during updates', async () => {
    win.setSize(360,760); await js('api.setPrefs({...prefs,theme:"dark"})');
    await js('document.getElementById("btn-schedules").click(); document.getElementById("scheduleFilter").focus()');
    await js('api.refreshInsights()');
    assert.equal(await js('document.activeElement.id'), 'scheduleFilter');
    for (const view of ['schedules','health']) {
      await js(`document.getElementById('btn-${view}').click()`);
      if (view === 'health') await js('document.querySelector("[data-health-tab=devices]").click()');
      await wait(150);
      assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'),true);
      fs.writeFileSync(path.resolve(__dirname,`../docs/screenshots/${view}-narrow.png`),(await win.webContents.capturePage()).toPNG());
    }
    await js('document.querySelector("[data-health-tab=activity]").click()');
    assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'),true);
    await js('document.querySelector("[data-health-tab=devices]").click(); api.setPrefs({...prefs,theme:"light"})');
    // Keep the compositor active for the motion tests that follow. macOS may
    // suspend animation frames after a previously visible window is hidden.
    win.setSize(1080,860); win.showInactive();
  });
  await check('25% preset means 25% closed and single-axis commands work', async () => {
    await js('document.getElementById("btn-blinds").click(); navigateToRoomShades(allRooms[0])');
    await js('document.getElementById("shade-name-11").closest("article").querySelector(".btn-fine-shade--chip").click()');
    await until(async () => await js('allShades.find(s=>s.id==="11").positions.primary') === .75);
    await until(async () => await js('document.getElementById("shade-11-pct-closed").value') === '25');
    assert.equal(await js('document.getElementById("shade-11-pct-closed").value'), '25');
  });
  await check('precise numeric entry and reported state', async () => {
    await js('const input = document.getElementById("shade-11-pct-closed"); input.value="37"; input.dispatchEvent(new Event("change"))');
    await until(async () => await js('allShades.find(s=>s.id==="11").positions.primary') === .63);
    assert.match(await js('document.getElementById("shade-reported-11").textContent'), /37% closed/);
  });
  await check('single-shade grips remain reachable at both endpoints and grabbing them does not jump', async () => {
    for (const closed of [0,100]) {
      await js(`api.moveShade({id:'11',positions:{primary:${100 - closed}}})`);
      await until(() => !runtime.getController().state.motions['11']); await wait(220);
      const bounds = await js(`(() => {
        window.gripWindow = document.querySelector('[data-shade-id="11"] .motion-window');
        window.grip = gripWindow.querySelector('.motion-grip');
        window.gripRect = grip.getBoundingClientRect(); window.gripWindowRect = gripWindow.getBoundingClientRect();
        return {top:gripRect.top-gripWindowRect.top,bottom:gripWindowRect.bottom-gripRect.bottom,visible:getComputedStyle(grip).visibility};
      })()`);
      assert.ok(bounds.top >= -.1 && bounds.bottom >= -.1, JSON.stringify(bounds));
      assert.equal(bounds.visible,'visible');
      await js(`grip.dispatchEvent(new PointerEvent('pointerdown',{pointerId:76,button:0,clientX:gripRect.left+gripRect.width/2,clientY:gripRect.top+gripRect.height/2,bubbles:true}))`);
      assert.equal(await js('document.getElementById("shade-11-pct-closed").value'),String(closed));
      await js(`document.dispatchEvent(new PointerEvent('pointermove',{pointerId:76,clientX:gripRect.left+gripRect.width/2,clientY:gripRect.top+gripRect.height/2+gripWindowRect.height*${closed ? '-.1' : '.1'},bubbles:true}))`);
      assert.equal(await js('document.getElementById("shade-11-pct-closed").value'),String(closed ? 90 : 10));
      await js('document.dispatchEvent(new PointerEvent("pointercancel",{pointerId:76,bubbles:true}))');
      assert.equal(runtime.getController().state.targets['11'],undefined);
    }
    await js("api.moveShade({id:'11',positions:{primary:63}})");
    await until(() => !runtime.getController().state.motions['11']); await wait(220);
  });
  await check('dragging keeps a stable target during refresh and cancellation sends no movement', async () => {
    await until(() => !runtime.getController().state.motions['11']);
    await js(`window.dragWindow = document.querySelector('[data-shade-id="11"] .motion-window');
      window.dragRect = dragWindow.getBoundingClientRect();
      dragWindow.dispatchEvent(new PointerEvent('pointerdown',{pointerId:77,button:0,clientX:dragRect.left+30,clientY:dragRect.top+dragRect.height*.6,bubbles:true}));`);
    assert.equal(await js('document.getElementById("shade-11-pct-closed").value'), '60');
    await js('api.refresh()');
    assert.equal(await js('document.getElementById("shade-11-pct-closed").value'), '60');
    assert.ok(Math.abs(await js('Number(dragWindow.dataset.physicalPrimary)') - 37) < 1);
    await js('document.dispatchEvent(new PointerEvent("pointercancel",{pointerId:77,bubbles:true}))');
    assert.equal(runtime.getController().state.targets['11'], undefined);
    assert.equal(await js('document.getElementById("shade-11-pct-closed").value'), '37');
  });
  await check('released target stays put while the simulated shade moves monotonically and settles', async () => {
    await js(`dragWindow.dispatchEvent(new PointerEvent('pointerdown',{pointerId:78,button:0,clientX:dragRect.left+30,clientY:dragRect.top+dragRect.height*.7,bubbles:true}));
      document.dispatchEvent(new PointerEvent('pointerup',{pointerId:78,clientX:dragRect.left+30,clientY:dragRect.top+dragRect.height*.7,bubbles:true}));`);
    await until(() => runtime.getController().state.motions['11']);
    const samples = [];
    for (let i=0;i<5;i++) {
      await wait(130); await js('api.setPrefs({...prefs})');
      samples.push(await js('Number(dragWindow.dataset.physicalPrimary)'));
      assert.equal(await js('document.getElementById("shade-11-pct-closed").value'), '70');
    }
    assert.ok(samples[0] > 37 && samples.at(-1) < 70);
    for (let i=1;i<samples.length;i++) assert.ok(samples[i] >= samples[i-1] - .1, `Position reversed: ${samples}`);
    const output=path.resolve(__dirname,'../docs/screenshots'); fs.mkdirSync(output,{recursive:true});
    fs.writeFileSync(path.join(output,'shade-moving.png'),(await win.webContents.capturePage()).toPNG());
    await until(() => !runtime.getController().state.motions['11']); await wait(220);
    assert.equal(await js('Number(dragWindow.dataset.physicalPrimary)'), 70);
    assert.equal(await js('dragWindow.querySelector(".target-primary").hidden'), true);
  });
  await check('Stop interrupts travel and holds the physical position', async () => {
    await js('api.shadeAction({id:"11",action:"open"})');
    await wait(450); await js('api.shadeAction({id:"11",action:"stop"})'); await wait(220);
    const stopped = await js('Number(dragWindow.dataset.physicalPrimary)');
    assert.ok(stopped > 0 && stopped < 70); await wait(300);
    // REST reads round to whole percentages; there must be no continued travel.
    assert.ok(Math.abs(await js('Number(dragWindow.dataset.physicalPrimary)') - stopped) < .51);
    assert.equal(runtime.getController().state.motions['11'], undefined);
  });
  await check('appearance editor saves curtain style and color without moving the device', async () => {
    const before = runtime.getController().state.snapshot.shades[0].positions.primary;
    await js(`document.getElementById('shade-appearance-11').click(); document.querySelector('#shadeAppearanceDialog [value="curtain"]').click(); document.querySelector('#shadeAppearanceDialog [data-color="#b68471"]').click()`);
    await js('document.querySelector("#shadeAppearanceDialog .appearance-save").click()');
    await until(async () => !await js('!!document.getElementById("shadeAppearanceDialog")'));
    assert.deepEqual(runtime.getController().state.config.appearances.demo['11'],{kind:'curtain',fabric:'pleated',color:'#b68471',draw:'split'});
    assert.equal(runtime.getController().state.snapshot.shades[0].positions.primary, before);
    assert.equal(await js('document.querySelector("[data-shade-id=\\"11\\"] .motion-window").dataset.covering'), 'curtain');
  });
  await check('curtain dragging uses horizontal targets and updates both fabric panels', async () => {
    await js(`window.curtainWindow = document.querySelector('[data-shade-id="11"] .motion-window');
      window.curtainRect = curtainWindow.getBoundingClientRect();
      curtainWindow.dispatchEvent(new PointerEvent('pointerdown',{pointerId:79,button:0,clientX:curtainRect.left+curtainRect.width*.27,clientY:curtainRect.top+50,bubbles:true}));
      document.dispatchEvent(new PointerEvent('pointerup',{pointerId:79,clientX:curtainRect.left+curtainRect.width*.27,clientY:curtainRect.top+50,bubbles:true}));`);
    await until(() => runtime.getController().state.motions['11']);
    assert.equal(await js('document.getElementById("shade-11-pct-closed").value'), '50');
    await until(() => !runtime.getController().state.motions['11']); await wait(220);
    assert.equal(await js('curtainWindow.querySelector(".curtain-left").style.width'), '27%');
    assert.equal(await js('curtainWindow.querySelector(".curtain-right").style.width'), '27%');
    assert.equal(await js('curtainWindow.querySelectorAll(".motion-grip:not([hidden])").length'),2);
    await js(`window.curtainGrip = curtainWindow.querySelector('.motion-grip[data-side="right"]'); window.curtainGripRect = curtainGrip.getBoundingClientRect();
      curtainGrip.dispatchEvent(new PointerEvent('pointerdown',{pointerId:80,button:0,clientX:curtainGripRect.left+curtainGripRect.width/2,clientY:curtainGripRect.top+curtainGripRect.height/2,bubbles:true}));`);
    assert.equal(await js('document.getElementById("shade-11-pct-closed").value'),'50');
    await js(`document.dispatchEvent(new PointerEvent('pointermove',{pointerId:80,clientX:curtainGripRect.left+curtainGripRect.width/2-curtainRect.width*.115,clientY:curtainGripRect.top+curtainGripRect.height/2,bubbles:true}))`);
    assert.equal(await js('document.getElementById("shade-11-pct-closed").value'),'75');
    await js('document.dispatchEvent(new PointerEvent("pointercancel",{pointerId:80,bubbles:true}))');
  });
  await check('type 9 exposes the two physical edges directly and keeps independent keyboard control', async () => {
    await js('navigateToRoomShades(allRooms.find(r=>r.id==="3"))');
    assert.equal(await js('document.querySelectorAll(".shade-unified-dual").length'), 2);
    assert.equal(await js('document.querySelectorAll("[data-rail]").length'), 0);
    assert.equal(await js(`document.querySelectorAll('[data-shade-id="31"] .shade-handle:not([hidden])').length`), 2);
    await js(`document.querySelector('[data-shade-id="31"] .shade-handle[data-axis="secondary"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))`);
    await until(async () => await js('allShades.find(s=>s.id==="31").positions.secondary') === .21);
    assert.equal(runtime.getController().shade('31').positions.primary,0);
    assert.equal(await js('document.querySelector(".dual-rail-fine").open'),false);
  });
  // Keep the real IPC/events/movement path, with shorter demo trips for the gesture matrix.
  runtime.getController().client.fullTravelMs = 1000;
  async function railPositions(primary, secondary) {
    await js(`api.moveShade({id:'32',positions:{primary:${primary},secondary:${secondary}}})`);
    await until(()=>!runtime.getController().state.motions['32']); await wait(220);
  }
  await js(`window.railCard=document.querySelector('[data-shade-id="32"]'); window.railWindow=railCard.querySelector('.motion-window');
    window.beginRailDrag=(axis='merged')=>{
      const grip=railWindow.querySelector('.shade-handle[data-axis="'+axis+'"]'), rect=grip.getBoundingClientRect();
      window.railStart={x:rect.left+rect.width/2,y:rect.top+rect.height/2};
      grip.dispatchEvent(new PointerEvent('pointerdown',{pointerId:88,button:0,clientX:railStart.x,clientY:railStart.y,bubbles:true}));
    };
    window.moveRailDrag=(dx,dy,type='pointermove',id=88)=>document.dispatchEvent(new PointerEvent(type,{pointerId:id,clientX:railStart.x+dx,clientY:railStart.y+dy,bubbles:true})); void 0;`);
  await check('meeting edges have one reachable grip at both endpoints; taps and sideways motion send nothing', async () => {
    for (const bottom of [0,100]) {
      await railPositions(100-bottom,bottom);
      assert.equal(await js('railWindow.querySelectorAll(".shade-handle:not([hidden])").length'),1);
      assert.equal(await js('railWindow.dataset.railsMerged'),'true');
      assert.match(await js('railCard.querySelector(".dual-rail-hint").textContent'),bottom ? /Pull up/ : /Pull down/);
      const bounds=await js(`(() => {const r=railWindow.getBoundingClientRect(),g=railWindow.querySelector('.shade-handle:not([hidden])').getBoundingClientRect();return {top:g.top-r.top,bottom:r.bottom-g.bottom};})()`);
      assert.ok(bounds.top>=0 && bounds.bottom>=0,JSON.stringify(bounds));
      const intents=[], listener=event=>intents.push(event); runtime.getController().on('intent',listener);
      try {
        await js('beginRailDrag(); moveRailDrag(1,1,"pointerup"); beginRailDrag(); moveRailDrag(20,3,"pointerup")');
        await js(`beginRailDrag(); moveRailDrag(0,${bottom ? 20 : -20},'pointerup')`);
        await js(`(() => {const r=railWindow.getBoundingClientRect(); railWindow.dispatchEvent(new PointerEvent('pointerdown',{pointerId:89,button:0,clientX:r.left+20,clientY:r.top+r.height/2,bubbles:true})); document.dispatchEvent(new PointerEvent('pointerup',{pointerId:89,bubbles:true}));})()`);
        await js('api.refresh()');
        assert.equal(intents.length,0);
        assert.equal(runtime.getController().shade('32').positions.primary,100-bottom);
        assert.equal(runtime.getController().shade('32').positions.secondary,bottom);
      } finally { runtime.getController().removeListener('intent',listener); }
    }
  });
  await check('pull direction chooses a meeting edge once, survives refresh and reversal, and sends one command on release', async () => {
    for (const direction of [-1,1]) {
      await railPositions(50,50);
      const axis=direction<0?'secondary':'primary';
      const intents=[], listener=event=>intents.push(event); runtime.getController().on('intent',listener);
      try {
        await js(`beginRailDrag(); moveRailDrag(0,railWindow.clientHeight*.1*${direction})`);
        assert.equal(await js('railWindow.dataset.dragRail'),axis);
        assert.equal(await js(`document.getElementById('shade-32-${axis}-position').value`),String(50+10*direction));
        await js('api.refresh()');
        assert.equal(await js(`document.getElementById('shade-32-${axis}-position').value`),String(50+10*direction));
        assert.equal(await js('Number(railWindow.dataset.physicalPrimary)'),50);
        assert.equal(await js('Number(railWindow.dataset.physicalSecondary)'),50);
        await js(`moveRailDrag(0,-railWindow.clientHeight*.1*${direction})`);
        assert.equal(await js('railWindow.dataset.dragRail'),axis);
        assert.equal(await js(`document.getElementById('shade-32-${axis}-position').value`),'50');
        assert.equal(intents.length,0);
        await js(`moveRailDrag(0,railWindow.clientHeight*.1*${direction},'pointerup')`);
        await until(()=>!runtime.getController().state.motions['32'] && runtime.getController().shade('32').positions[axis]===40);
        assert.equal(runtime.getController().shade('32').positions[axis==='primary'?'secondary':'primary'],50);
        assert.equal(intents.length,1);
      } finally { runtime.getController().removeListener('intent',listener); }
    }
  });
  await check('pointer cancellation, Escape, focus loss and lost capture discard a rail drag', async () => {
    await railPositions(50,50);
    const intents=[], listener=event=>intents.push(event); runtime.getController().on('intent',listener);
    try {
      for (const cancel of [
        'moveRailDrag(0,0,"pointercancel")',
        'window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}))',
        'window.dispatchEvent(new Event("blur"))',
        'railWindow.dispatchEvent(new PointerEvent("lostpointercapture",{pointerId:88}))',
      ]) {
        await js('beginRailDrag(); moveRailDrag(0,-railWindow.clientHeight*.1); moveRailDrag(0,20,"pointerup",99)');
        assert.equal(await js('railWindow.dataset.dragRail'),'secondary');
        await js(cancel);
        await js('moveRailDrag(0,-30,"pointerup")');
        assert.equal(await js('railWindow.classList.contains("shade-window-dragging")'),false);
        assert.equal(await js('railWindow.querySelector(".target-secondary").hidden'),true);
        assert.equal(await js('currentMainView'),'room-shades');
      }
      await js('api.refresh()');
      assert.equal(intents.length,0);
      assert.equal(runtime.getController().shade('32').positions.secondary,50);
    } finally { runtime.getController().removeListener('intent',listener); }
  });
  await check('separate edges drag independently across the full rail width and stop at the other rail', async () => {
    await railPositions(15,15);
    assert.equal(await js('railWindow.querySelectorAll(".shade-handle:not([hidden])").length'),2);
    await js(`(() => {const r=railWindow.getBoundingClientRect(); window.railStart={x:r.left+railWindow.clientLeft+8,y:r.top+railWindow.clientTop+railWindow.clientHeight*.15}; railWindow.dispatchEvent(new PointerEvent('pointerdown',{pointerId:88,button:0,clientX:railStart.x,clientY:railStart.y,bubbles:true})); moveRailDrag(0,railWindow.clientHeight*.1,'pointerup');})()`);
    await until(()=>!runtime.getController().state.motions['32'] && runtime.getController().shade('32').positions.secondary===25); await wait(220);
    assert.equal(runtime.getController().shade('32').positions.primary,15);
    await js('beginRailDrag("primary"); moveRailDrag(0,-railWindow.clientHeight*.1,"pointerup")');
    await until(()=>!runtime.getController().state.motions['32'] && runtime.getController().shade('32').positions.primary===25); await wait(220);
    assert.equal(runtime.getController().shade('32').positions.secondary,25);
    await js('beginRailDrag("secondary"); moveRailDrag(0,railWindow.clientHeight)');
    assert.equal(await js('document.getElementById("shade-32-secondary-position").value'),'75');
    await js('moveRailDrag(0,0,"pointercancel"); beginRailDrag("primary"); moveRailDrag(0,-railWindow.clientHeight)');
    assert.equal(await js('document.getElementById("shade-32-primary-position").value'),'25');
    await js('moveRailDrag(0,0,"pointercancel")');
    assert.equal(runtime.getController().shade('32').positions.secondary,25);
    assert.equal(runtime.getController().shade('32').positions.primary,25);
  });
  await check('fine adjustment has independent fields and bottom-edge shortcuts respect the top-edge limit', async () => {
    await js('railCard.querySelector(".dual-rail-fine summary").click()');
    assert.equal(await js('railCard.querySelector(".dual-rail-fine").open'),true);
    await js('document.getElementById("shade-32-secondary-position").value="40"; document.getElementById("shade-32-secondary-position").dispatchEvent(new Event("change"))');
    await until(()=>!runtime.getController().state.motions['32'] && runtime.getController().shade('32').positions.secondary===40);
    assert.equal(runtime.getController().shade('32').positions.primary,25);
    assert.equal(await js('document.getElementById("shade-32-primary-position").min'),'40');
    assert.equal(await js(`railCard.querySelector('[data-rail-value="25"]').disabled`),true);
    await js(`railCard.querySelector('[data-rail-value="50"]').click()`);
    await until(()=>!runtime.getController().state.motions['32'] && runtime.getController().shade('32').positions.primary===50);
    for (const primary of [58,60]) {
      await js(`railCard.querySelector('[data-rail-step="-8"]').click()`);
      await until(()=>!runtime.getController().state.motions['32'] && runtime.getController().shade('32').positions.primary===primary);
    }
    assert.equal(runtime.getController().shade('32').positions.secondary,40);
    assert.equal(await js(`railCard.querySelector('[data-rail-step="-8"]').disabled`),true);
    await js('railCard.querySelector(".dual-rail-fine summary").click()');
  });
  await check('meeting-edge keyboard controls choose direction and keep focus when the grip separates', async () => {
    await railPositions(50,50);
    await js(`railWindow.querySelector('[data-axis="merged"]').focus(); document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true}))`);
    await until(()=>!runtime.getController().state.motions['32'] && runtime.getController().shade('32').positions.secondary===49);
    assert.equal(runtime.getController().shade('32').positions.primary,50);
    await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))`);
    await until(()=>!runtime.getController().state.motions['32'] && runtime.getController().shade('32').positions.primary===49);
    assert.equal(runtime.getController().shade('32').positions.secondary,49);
    await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}))`);
    await until(()=>!runtime.getController().state.motions['32'] && runtime.getController().shade('32').positions.secondary===0); await wait(220);
    assert.equal(await js('document.activeElement.dataset.axis'),'secondary');
    assert.equal(await js('document.activeElement.hidden'),false);
  });
  await check('native mouse input reaches grips and full-width edges with working pointer capture', async () => {
    win.show(); win.focus(); await wait(150);
    for (const { primary, secondary, axis, delta, edge } of [
      { primary:100, secondary:0, axis:'primary', delta:.2 },
      { primary:0, secondary:100, axis:'secondary', delta:-.2 },
      { primary:50, secondary:50, axis:'secondary', delta:-.2 },
      { primary:10, secondary:10, axis:'primary', delta:-.15 },
      { primary:10, secondary:10, axis:'secondary', delta:.15, edge:true },
    ]) {
      await railPositions(primary,secondary);
      const point=await js(`(() => {
        const grip=railWindow.querySelector('.shade-handle[data-axis="'+(railWindow.dataset.railsMerged==='true'?'merged':'${axis}')+'"]');
        const r=railWindow.getBoundingClientRect(),g=grip.getBoundingClientRect();
        railWindow.addEventListener('pointerdown',event=>{
          window.nativeRailPointer={id:event.pointerId,trusted:event.isTrusted};
          railWindow.addEventListener('pointermove',move=>{
            nativeRailPointer.captured=move.isTrusted && railWindow.hasPointerCapture(move.pointerId);
            nativeRailPointer.axis=railWindow.dataset.dragRail;
          },{once:true});
        },{once:true});
        return {x:Math.round(${edge ? 'r.left+railWindow.clientLeft+8' : 'g.left+g.width/2'}),
          y:Math.round(${edge ? `r.top+railWindow.clientTop+railWindow.clientHeight*${secondary/100}` : 'g.top+g.height/2'}),height:railWindow.clientHeight};
      })()`);
      const dy=Math.round(point.height*delta), start=axis==='primary'?100-primary:secondary;
      const expected=Math.round(start+dy/point.height*100);
      const intents=[],listener=event=>intents.push(event); runtime.getController().on('intent',listener);
      try {
        win.focus();
        win.webContents.sendInputEvent({type:'mouseMove',x:point.x,y:point.y});
        win.webContents.sendInputEvent({type:'mouseDown',x:point.x,y:point.y,button:'left',clickCount:1});
        win.webContents.sendInputEvent({type:'mouseMove',x:point.x,y:point.y+dy,modifiers:['leftButtonDown']});
        win.webContents.sendInputEvent({type:'mouseUp',x:point.x,y:point.y+dy,button:'left',clickCount:1});
        await until(()=>!runtime.getController().state.motions['32'] && runtime.getController().shade('32').positions[axis]===(axis==='primary'?100-expected:expected));
        assert.equal(await js('nativeRailPointer.trusted && nativeRailPointer.captured'),true);
        assert.equal(await js('nativeRailPointer.axis'),axis);
        assert.equal(runtime.getController().shade('32').positions[axis==='primary'?'secondary':'primary'],axis==='primary'?secondary:primary);
        assert.equal(intents.length,1);
      } finally { runtime.getController().removeListener('intent',listener); }
    }
  });
  await check('edge grips stay separated when visible and adapt to narrow layouts with readable fine adjustment', async () => {
    const output=path.resolve(__dirname,'../docs/screenshots');
    win.showInactive();
    await railPositions(100,0);
    await js('document.activeElement.blur(); window.scrollTo(0,0)');
    fs.writeFileSync(path.join(output,'dual-rail-open.png'),(await win.webContents.capturePage()).toPNG());
    await railPositions(60,0);
    assert.equal(await js('railWindow.dataset.railsMerged'),'true');
    win.setSize(360,760); await wait(250);
    assert.equal(await js('railWindow.dataset.railsMerged'),'false');
    assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'),true);
    const gap=await js(`(() => {const a=railWindow.querySelector('[data-axis="secondary"]').getBoundingClientRect(),b=railWindow.querySelector('[data-axis="primary"]').getBoundingClientRect();return b.top-a.bottom;})()`);
    assert.ok(gap>=6,`Overlapping edge controls: ${gap}`);
    await js('api.setPrefs({...prefs,theme:"dark"}); railCard.querySelector(".dual-rail-fine summary").click(); railCard.scrollIntoView({block:"start"})');
    await wait(200);
    assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'),true);
    fs.writeFileSync(path.join(output,'dual-rail-narrow.png'),(await win.webContents.capturePage()).toPNG());
    win.setSize(1080,860); await js('api.setPrefs({...prefs,theme:"light"}); railCard.querySelector(".dual-rail-fine summary").click()');
    await railPositions(10,20); await js('window.scrollTo(0,0)'); await wait(200);
    fs.writeFileSync(path.join(output,'dual-rail-top.png'),(await win.webContents.capturePage()).toPNG());
    await railPositions(50,50);
    fs.writeFileSync(path.join(output,'dual-rail-merged.png'),(await win.webContents.capturePage()).toPNG());
    win.hide();
  });
  await check('Bedroom left allows curtain selection and replaces demo rails with working curtain controls', async () => {
    await js('document.getElementById("shade-appearance-31").click()');
    assert.equal(await js('document.querySelector("#shadeAppearanceDialog [value=curtain]").disabled'), false);
    assert.equal(await js('document.getElementById("appearanceFabric").disabled'), false);
    await js('document.querySelector("#shadeAppearanceDialog [value=curtain]").click(); document.querySelector("#shadeAppearanceDialog .appearance-save").click()');
    await until(async () => !await js('!!document.getElementById("shadeAppearanceDialog")'));
    assert.equal(await js('allShades.find(s=>s.id==="31").controls.kind'), 'vertical');
    assert.equal(await js('document.getElementById("shade-31-pct-closed").value'), '79');
    assert.equal(runtime.getController().state.motions['31'], undefined);
    assert.equal(await js('document.querySelector("[data-shade-id=\\"31\\"] .motion-window").dataset.covering'), 'curtain');
  });
  await check('single-draw curtains preview, drag and animate toward the selected stacking side', async () => {
    for (const draw of ['left', 'right']) {
      await js(`document.getElementById('shade-appearance-31').click(); document.getElementById('appearanceDraw').value='${draw}'; document.getElementById('appearanceDraw').dispatchEvent(new Event('change'))`);
      assert.equal(await js(`document.querySelector('#shadeAppearanceDialog .curtain-${draw === 'left' ? 'right' : 'left'}').hidden`), true);
      assert.equal(await js(`document.querySelector('#shadeAppearanceDialog .curtain-${draw}').style.width`), '61.6%');
      await js('document.querySelector("#shadeAppearanceDialog .appearance-save").click()');
      await until(async () => !await js('!!document.getElementById("shadeAppearanceDialog")'));
      assert.equal(await js(`document.querySelectorAll('[data-shade-id="31"] .motion-grip:not([hidden])').length`),1);
      assert.equal(await js(`document.querySelector('[data-shade-id="31"] .motion-grip:not([hidden])').dataset.side`),draw);
      const closed = draw === 'left' ? 50 : 25, fraction = draw === 'left' ? .52 : .72;
      await js(`window.singleCurtain = document.querySelector('[data-shade-id="31"] .motion-window'); window.singleRect = singleCurtain.getBoundingClientRect();
        singleCurtain.dispatchEvent(new PointerEvent('pointerdown',{pointerId:81,button:0,clientX:singleRect.left+singleRect.width*${fraction},clientY:singleRect.top+50,bubbles:true}));
        document.dispatchEvent(new PointerEvent('pointerup',{pointerId:81,clientX:singleRect.left+singleRect.width*${fraction},clientY:singleRect.top+50,bubbles:true}));`);
      await until(() => runtime.getController().state.motions['31']);
      assert.equal(await js('document.getElementById("shade-31-pct-closed").value'), String(closed));
      assert.equal(await js('singleCurtain.querySelector(".target-secondary").hidden'), true);
      await until(() => !runtime.getController().state.motions['31']); await wait(220);
      assert.equal(await js(`singleCurtain.querySelector('.curtain-${draw}').style.width`), draw === 'left' ? '52%' : '28%');
      assert.equal(runtime.getController().state.config.appearances.demo['31'].draw, draw);
    }
    await js('singleCurtain.closest(".shade-window-visual").dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true,cancelable:true}))');
    await until(() => runtime.getController().state.motions['31']);
    assert.equal(await js('document.getElementById("shade-31-pct-closed").value'), '24');
    await until(() => !runtime.getController().state.motions['31']);
    const output=path.resolve(__dirname,'../docs/screenshots');
    await js('document.getElementById("shade-appearance-31").click()');
    await wait(100); fs.writeFileSync(path.join(output,'single-draw-editor.png'),(await win.webContents.capturePage()).toPNG());
    await js('document.getElementById("shadeAppearanceDialog").close()');
    await until(async () => !await js('!!document.getElementById("shadeAppearanceDialog")'));
  });
  await check('resetting a demo curtain restores the original two-rail shade and clears the saved override', async () => {
    await js('document.getElementById("shade-appearance-31").click(); document.querySelector("#shadeAppearanceDialog .appearance-reset").click()');
    assert.equal(await js('document.querySelector("#shadeAppearanceDialog [value=shade]").checked'), true);
    assert.equal(await js('document.querySelector(".curtain-draw-field").hidden'), true);
    await js('document.querySelector("#shadeAppearanceDialog .appearance-save").click()');
    await until(async () => !await js('!!document.getElementById("shadeAppearanceDialog")'));
    assert.equal(await js('allShades.find(s=>s.id==="31").controls.kind'), 'dual-rail');
    // The compact grips fit separately at the restored 24% fabric coverage.
    assert.equal(await js('document.getElementById("shade-name-31").closest("article").querySelectorAll(".shade-handle:not([hidden])").length'), 2);
    assert.equal(await js('document.getElementById("shade-name-31").closest("article").querySelectorAll("[data-rail-input]").length'), 2);
    assert.equal(await js('document.getElementById("shade-name-31").closest("article").querySelectorAll("[data-rail]").length'), 0);
    assert.equal(runtime.getController().state.config.appearances.demo['31'], undefined);
  });
  // Appearance resets recreate the demo client. Shorten later trips again;
  // long-trip animation and Stop have already been verified above.
  runtime.getController().client.fullTravelMs = 1000;
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
  await check('Saved controls captures named positions without movement and saves a custom group', async () => {
    // These async flows use scripted DOM actions; keep their dialogs out of the
    // user's way so desktop input cannot close one mid-check.
    win.hide();
    await until(() => !runtime.getController().state.motions['21'] && !runtime.getController().state.motions['22']);
    await js('document.getElementById("btn-home").click(); window.savedControls.open("presets")');
    await until(() => js('!!document.querySelector("#savedControlsDialog[open]")'));
    const before = runtime.getController().state.snapshot.shades.filter(shade => ['21','22'].includes(shade.id)).map(shade=>({...shade.positions}));
    await js('document.getElementById("savedControlName").value="Breakfast light"; document.getElementById("savedSelectGroup").value="room:2"; document.getElementById("savedSelectGroup").dispatchEvent(new Event("change")); document.querySelector("#savedControlsDialog .shortcuts-save").click()');
    await until(() => runtime.getSavedControls().home().presets.length === 1);
    assert.deepEqual(runtime.getSavedControls().home().presets[0].positions.map(item=>item.positions),before);
    assert.deepEqual(runtime.getController().state.snapshot.shades.filter(shade=>['21','22'].includes(shade.id)).map(shade=>shade.positions),before);
    await until(() => js('!document.querySelector("#savedControlsDialog .shortcuts-save").disabled'));
    await js('document.querySelector("[data-tab=groups]").click(); document.getElementById("savedControlName").value="Kitchen pair"; document.querySelector("#savedControlsDialog .shortcuts-save").click()');
    await until(() => runtime.getSavedControls().home().groups.length === 1);
    assert.deepEqual(runtime.getSavedControls().home().groups[0].shadeIds,['21','22']);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(profile,'config.json'),'utf8')).savedControls.demo.groups[0].shadeIds,['21','22']);
    await js('document.querySelector("#savedControlsDialog .shortcuts-cancel").click()'); await until(() => js('!document.getElementById("savedControlsDialog")'));
    assert.equal(await js('document.querySelectorAll("#savedControlsHome .saved-card").length'),2);
  });
  await check('saved groups and presets run through Home and appear as shortcut targets', async () => {
    await js('document.querySelector("#savedControlsHome [data-saved-action=close]").click()');
    await until(() => runtime.getSavedControls().lastResult?.includes('Kitchen pair: 2 of 2'));
    await until(() => !runtime.getController().state.motions['21'] && !runtime.getController().state.motions['22']);
    assert.equal(runtime.getController().state.snapshot.shades.find(shade=>shade.id==='21').positions.primary,0);
    await js('document.querySelector("#savedControlsHome [data-saved-action=activate]").click()');
    await until(() => runtime.getSavedControls().lastResult?.includes('Breakfast light: 2 of 2'));
    await until(() => !runtime.getController().state.motions['21'] && !runtime.getController().state.motions['22']);
    assert.equal((await js('api.getShortcuts()')).presets[0].name,'Breakfast light');
  });
  await check('privacy timer closes, counts down, restores early and cancels on a newer command', async () => {
    const original=runtime.getController().state.snapshot.shades.find(shade=>shade.id==='21').positions.primary;
    await js('window.savedControls.open("privacy")'); await until(() => js('!!document.querySelector("#savedControlsDialog[open]")'));
    await js('document.querySelector(".saved-shade-picker input[value=\\"21\\"]").click(); document.getElementById("privacyMinutes").value="1"; document.querySelector("#savedControlsDialog .shortcuts-save").click()');
    await until(() => runtime.getSavedControls().getState().timers.some(timer=>timer.status==='waiting'),15000);
    const first=runtime.getSavedControls().getState().timers.at(-1);
    await until(() => js('document.querySelector(".privacy-card p").textContent.includes("Restores in")'));
    await js('document.querySelector(".saved-dialog .privacy-card .saved-card-actions button").click()');
    await until(() => runtime.getSavedControls().jobs.get(first.id).status==='completed');
    await until(() => !runtime.getController().state.motions['21']);
    assert.equal(runtime.getController().state.snapshot.shades.find(shade=>shade.id==='21').positions.primary,original);
    await js('document.querySelector("#savedControlsDialog .shortcuts-save").click()');
    await until(() => runtime.getSavedControls().getState().timers.some(timer=>timer.status==='waiting'),15000);
    await js('api.shadeAction({id:"21",action:"stop"})');
    assert.equal(runtime.getSavedControls().getState().timers.at(-1).status,'cancelled');
    await js('document.querySelector("[data-tab=presets]").click(); document.querySelector("#savedControlsDialog .shortcuts-scroll").scrollTop=0; document.activeElement.blur()');
    // A previously shown then hidden macOS window may not paint a capture.
    win.showInactive();
    await wait(200); fs.writeFileSync(path.resolve(__dirname,'../docs/screenshots/saved-controls.png'),(await win.webContents.capturePage()).toPNG());
    win.hide();
    win.setSize(360,760); await wait(200);
    assert.equal(await js('document.querySelector("#savedControlsDialog .shortcuts-scroll").scrollWidth <= document.querySelector("#savedControlsDialog .shortcuts-scroll").clientWidth'),true);
    assert.equal(await js('document.querySelector("#savedControlsDialog .shortcuts-save").getBoundingClientRect().bottom < window.innerHeight'),true);
    await js('document.querySelector("#savedControlsDialog .shortcuts-cancel").click()'); await until(() => js('!document.getElementById("savedControlsDialog")'));
    win.setSize(1080,860);
  });
  let shortcutBindings;
  const waitForVisibility = async visible => {
    // macOS may coalesce show/hide notifications during rapid focus changes.
    // Require the resulting native state to stay settled, rather than hanging
    // on a notification that may already have been delivered.
    let stableSince = null;
    await until(() => {
      if (win.isVisible() !== visible || !visible && win.isFocused()) { stableSince = null; return false; }
      stableSince ??= Date.now(); return Date.now() - stableSince >= 200;
    });
  };
  const hideWindow = async () => {
    win.hide(); await waitForVisibility(false);
  };
  const openShortcuts = async () => {
    if (!win.isVisible()) { win.show(); await waitForVisibility(true); }
    win.focus();
    await js('if (!uiOverlays.settingsIsOpen()) document.getElementById("settingsButton").click(); document.getElementById("keyboardShortcutsButton").click()');
    await until(() => js('!!document.querySelector("#keyboardShortcutsDialog[open]")'));
  };
  const closeShortcuts = async () => {
    await js('document.querySelector("#keyboardShortcutsDialog .shortcuts-cancel").click()');
    await until(() => js('!document.getElementById("keyboardShortcutsDialog")'));
  };
  await check('shortcut editor adds the Office starter, detects duplicates and records native key input', async () => {
    await js('api.setPrefs({...prefs,theme:"light"})'); await openShortcuts();
    assert.equal(runtime.getShortcuts().editing, true);
    assert.equal(await js('document.getElementById("shortcutStarterShade").value'), '41');
    await js('document.getElementById("shortcutAddEssentials").click()');
    assert.equal(await js('document.querySelectorAll(".shortcut-row").length'), 3);
    await js('document.querySelectorAll(".shortcut-record")[2].click()');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'C', modifiers: ['control','shift'] });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'C', modifiers: ['control','shift'] });
    await until(() => js('document.querySelectorAll(".shortcut-record")[2].textContent.includes("Ctrl + Shift + C")'));
    await js('document.querySelector(".shortcuts-save").click()');
    await until(() => js('document.querySelector(".shortcuts-error").textContent.includes("more than once")'));
    assert.deepEqual(runtime.getShortcuts().settings().bindings, []);
    await js('document.querySelectorAll(".shortcut-record")[2].click()');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'H', modifiers: ['control','shift'] });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'H', modifiers: ['control','shift'] });
    await until(() => js('document.querySelectorAll(".shortcut-record")[2].textContent.includes("Ctrl + Shift + H")'));
    await js('document.querySelector(".shortcuts-scroll").scrollTop=0; document.activeElement.blur()');
    await wait(250); fs.writeFileSync(path.resolve(__dirname,'../docs/screenshots/shortcut-editor.png'),(await win.webContents.capturePage()).toPNG());
    await js('document.querySelector(".shortcuts-save").click()');
    await until(() => js('!document.getElementById("keyboardShortcutsDialog")'));
    shortcutBindings = runtime.getShortcuts().settings().bindings;
    assert.deepEqual(shortcutBindings.map(item => [item.targetId,item.action,item.percent]), [['41','close',undefined],['41','open',undefined],['41','position',50]]);
    for (const binding of shortcutBindings) assert.equal(globalShortcut.isRegistered(binding.accelerator), true);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(profile,'config.json'),'utf8')).shortcuts.demo.bindings, shortcutBindings);
  });
  await check('native registration conflicts preserve saved shortcuts; Cancel resumes and mobile layout fits', async () => {
    await openShortcuts();
    assert.equal(globalShortcut.isRegistered('Control+Shift+C'), false);
    assert.equal(globalShortcut.register('Control+Alt+Shift+F18', () => {}), true);
    await js('document.querySelector(".shortcut-record").click()');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F18', modifiers: ['control','alt','shift'] });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'F18', modifiers: ['control','alt','shift'] });
    await until(() => js('document.querySelector(".shortcut-record").textContent.includes("F18")'));
    await js('document.querySelector(".shortcuts-save").click()');
    await until(() => js('document.querySelector(".shortcuts-error").textContent.includes("unavailable")'));
    assert.deepEqual(runtime.getShortcuts().settings().bindings, shortcutBindings);
    globalShortcut.unregister('Control+Alt+Shift+F18');
    win.setSize(360,760); await wait(200);
    assert.equal(await js('document.querySelector(".shortcuts-scroll").scrollWidth <= document.querySelector(".shortcuts-scroll").clientWidth'), true);
    assert.equal(await js('document.querySelector(".shortcuts-save").getBoundingClientRect().bottom < window.innerHeight'), true);
    fs.writeFileSync(path.resolve(__dirname,'../docs/screenshots/shortcut-narrow.png'),(await win.webContents.capturePage()).toPNG());
    await closeShortcuts(); win.setSize(1080,860);
    assert.equal(globalShortcut.isRegistered('Control+Shift+C'), true);
  });
  await check('background shortcut routing moves demo shades and settles at the requested percentage', async () => {
    await js('uiOverlays.settingsClose(); navigateToRoomShades(allRooms.find(room=>room.id==="4"))');
    await hideWindow();
    await until(() => !win.isFocused());
    assert.equal(win.isFocused(), false);
    assert.equal(await runtime.getShortcuts().trigger(shortcutBindings[2].id), true);
    await until(() => !runtime.getController().state.motions['41']);
    assert.equal(runtime.getController().state.snapshot.shades.find(item=>item.id==='41').positions.primary, 50);
    assert.match(runtime.getShortcuts().lastRun.message, /50% closed — command accepted/);
  });
  await check('room, scene, whole-home Stop and app shortcuts can be configured in the editor', async () => {
    await openShortcuts();
    await js('document.getElementById("shortcutAddStop").click(); document.getElementById("shortcutAddApp").click(); document.getElementById("shortcutAdd").click()');
    await js('document.querySelector(".shortcut-row:last-child .shortcut-target").value="scene:104"; document.querySelector(".shortcut-row:last-child .shortcut-target").dispatchEvent(new Event("change")); document.querySelector(".shortcut-row:last-child .shortcut-record").click()');
    win.webContents.sendInputEvent({ type:'keyDown', keyCode:'F15', modifiers:['control','alt','shift'] });
    win.webContents.sendInputEvent({ type:'keyUp', keyCode:'F15', modifiers:['control','alt','shift'] });
    await until(() => js('document.querySelector(".shortcut-row:last-child .shortcut-record").textContent.includes("F15")'));
    await js('document.getElementById("shortcutAdd").click(); document.querySelector(".shortcut-row:last-child .shortcut-target").value="room:2"; document.querySelector(".shortcut-row:last-child .shortcut-target").dispatchEvent(new Event("change")); document.querySelector(".shortcut-row:last-child .shortcut-action").value="close"; document.querySelector(".shortcut-row:last-child .shortcut-action").dispatchEvent(new Event("change")); document.querySelector(".shortcut-row:last-child .shortcut-record").click()');
    win.webContents.sendInputEvent({ type:'keyDown', keyCode:'F16', modifiers:['control','alt','shift'] });
    win.webContents.sendInputEvent({ type:'keyUp', keyCode:'F16', modifiers:['control','alt','shift'] });
    await until(() => js('document.querySelector(".shortcut-row:last-child .shortcut-record").textContent.includes("F16")'));
    await js('document.querySelector(".shortcuts-save").click()'); await until(() => js('!document.getElementById("keyboardShortcutsDialog")'));
    const manager = runtime.getShortcuts(); shortcutBindings = manager.settings().bindings;
    assert.equal(shortcutBindings.length, 7);
    for (const target of ['scene','room','home']) assert.equal(await manager.trigger(shortcutBindings.find(item=>item.target===target).id), true);
    assert.equal(runtime.getController().state.feedback['scene:104'].kind, 'success');
    assert.equal(runtime.getController().state.feedback['room:2'].kind, 'success');
    assert.equal(runtime.getController().state.feedback['room-stop:null'].kind, 'success');
    assert.deepEqual(runtime.getController().state.motions, {});
  });
  await check('disabling shortcuts releases native registrations and editor cancellation restores focus', async () => {
    await openShortcuts(); await js('document.getElementById("shortcutsEnabled").click(); document.querySelector(".shortcuts-save").click()');
    await until(() => js('!document.getElementById("keyboardShortcutsDialog")'));
    for (const binding of shortcutBindings) assert.equal(globalShortcut.isRegistered(binding.accelerator), false);
    await openShortcuts(); await js('document.getElementById("shortcutsEnabled").click(); document.querySelector(".shortcuts-save").click()');
    await until(() => js('!document.getElementById("keyboardShortcutsDialog")'));
    for (const binding of shortcutBindings) assert.equal(globalShortcut.isRegistered(binding.accelerator), true);
    assert.equal(await js('document.activeElement.id'), 'keyboardShortcutsButton');
    await js('uiOverlays.settingsClose()');
  });
  await check('app shortcut shows PowerView and hiding its editor resumes native keys', async () => {
    const manager = runtime.getShortcuts(), binding = shortcutBindings.find(item => item.target === 'app');
    await hideWindow();
    assert.equal(await manager.trigger(binding.id), true); await waitForVisibility(true);
    await openShortcuts(); assert.equal(manager.editing, true);
    await hideWindow(); await until(() => js('!document.getElementById("keyboardShortcutsDialog")'));
    assert.equal(manager.editing, false); assert.equal(globalShortcut.isRegistered('Control+Shift+C'), true);
    await js('uiOverlays.settingsClose()');
  });
  const data = { rooms: [{ id: 1, ptName: '<b>Fixture room</b>', color: 0 }],
    shades: [{id:11,roomId:1,type:1,ptName:'Fixture shade',positions:{primary:.25}}],
    scenes: [{id:101,ptName:'Fixture scene',roomIds:[1]}],
    automations: [{id:301,type:0,enabled:true,days:127,hour:12,min:0,sceneId:101,errorShd_Ids:[]}] };
  let failure = false, scheduleFailure = false, delay = 0, received = [];
  const streams = new Set();
  server = http.createServer(async (req,res) => {
    const pathname = new URL(req.url,'http://localhost').pathname;
    if (pathname === '/home/events') { res.writeHead(200, {'Content-Type':'text/event-stream'}); res.write(': connected\n\n'); streams.add(res); res.on('close',()=>streams.delete(res)); return; }
    if (pathname === '/home/automations' && scheduleFailure) { res.writeHead(503, {'Content-Type':'application/json'}); res.end('{"errMsg":"Unavailable"}'); return; }
    if (req.method === 'PUT') {
      let body=''; for await (const chunk of req) body+=chunk; received.push({path:req.url,body:body ? JSON.parse(body) : null});
      res.writeHead(failure ? 500 : 204); res.end(); return;
    }
    if (delay) await wait(delay);
    const value = pathname === '/gateway' ? {config:{name:'Fixture',mgwConfig:{primary:true},mgwStatus:{running:true}}}
      : pathname === '/home/colors' ? {colors:['#cccccc']}
      : pathname === '/gateway/info' ? {fwVersion:'3.1.475',serialNumber:'fixture-only'}
      : pathname === '/home/scenes/active' ? [] : data[pathname.split('/').at(-1)];
    res.writeHead(value ? 200 : 404, {'Content-Type':'application/json'}); res.end(JSON.stringify(value || {}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=`127.0.0.1:${server.address().port}`;
  await check('real IPC and HTTP failures retain reported positions; no extra axis', async () => {
    await js(`api.connect(${JSON.stringify(address)})`);
    for (const binding of shortcutBindings) assert.equal(globalShortcut.isRegistered(binding.accelerator), false);
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
  await check('gateway travel events animate between reports and final feedback settles precisely', async () => {
    const send = event => { for (const res of streams) res.write('data: '+JSON.stringify(event)+'\n\n'); };
    send({evt:'motion-started',id:11,currentPositions:{primary:.9},targetPositions:{primary:.3,etaInSeconds:1.5}});
    await until(() => runtime.getController().state.motions['11']);
    await wait(350);
    const midway = await js('Number(document.querySelector(".motion-window").dataset.physicalPrimary)');
    assert.ok(midway > 10 && midway < 70);
    await js('api.refresh()');
    const afterRefresh = await js('Number(document.querySelector(".motion-window").dataset.physicalPrimary)');
    assert.ok(afterRefresh >= midway, 'A cached read pulled the moving graphic backwards');
    assert.equal(runtime.getController().state.snapshot.shades[0].positions.primary, 90);
    send({evt:'motion-stopped',id:11,currentPositions:{primary:.3}});
    await until(() => !runtime.getController().state.motions['11']); await wait(240);
    assert.equal(await js('Number(document.querySelector(".motion-window").dataset.physicalPrimary)'), 70);
  });
  await check('invalid target IDs are rejected at the main-process boundary', async () => {
    const count=received.length;
    assert.equal(await js('api.activateScene("../gateway").then(()=>false,()=>true)'),true);
    assert.equal(received.length,count);
  });
  await check('optional schedule HTTP failures keep cached rows and live controls; empty lists are shown honestly', async () => {
    await runtime.getInsights().refresh();
    await js('document.getElementById("btn-schedules").click()');
    assert.equal(await js('document.querySelectorAll(".schedule-row").length'),1);
    assert.match(await js('document.getElementById("scheduleTimeline").textContent'),/Fixture scene/);
    assert.doesNotMatch(await js('document.getElementById("scheduleTimeline").textContent'),/Morning light/);
    const count=received.length;
    scheduleFailure=true; await js('api.refreshInsights()');
    assert.equal(await js('document.querySelectorAll(".schedule-row").length'),1);
    assert.match(await js('document.getElementById("insightsNotice").textContent'),/HTTP 503.*Showing information/);
    assert.equal(runtime.getController().state.connection.status,'connected');
    scheduleFailure=false; data.automations=[]; await js('api.refreshInsights()');
    assert.match(await js('document.getElementById("scheduleTimeline").textContent'),/No schedules saved/);
    assert.equal(received.length,count);
    await js('document.getElementById("btn-health").click(); document.querySelector("[data-health-tab=activity]").click()');
    assert.match(await js('document.getElementById("activityList").textContent'),/This app · Failed/);
    assert.doesNotMatch(await js('document.getElementById("activityList").textContent'),/Desk window/);
  });
  await check('captured native light/dark and narrow screenshots', async () => {
    // macOS can suspend the compositor after a shown window is hidden. Restore it for capture.
    win.showInactive();
    await js('api.demo(true)'); await until(async () => await js('appState.connection.status') === 'demo');
    await js('api.setPrefs({...prefs,theme:"light"})');
    await js('document.getElementById("btn-blinds").click()'); await wait(200);
    fs.writeFileSync(path.resolve(__dirname,'../docs/screenshots/rooms-light.png'),(await win.webContents.capturePage()).toPNG());
    await js('api.setPrefs({...prefs,theme:"dark"})'); await wait(200);
    fs.writeFileSync(path.resolve(__dirname,'../docs/screenshots/rooms-dark.png'),(await win.webContents.capturePage()).toPNG());
    await js('api.setPrefs({...prefs,theme:"light"})');
    await js('currentMainView="home"; showHome(); document.activeElement.blur(); window.scrollTo(0,0); clearTimeout(showSceneRunToast._hideTimer); document.getElementById("sceneRunToast")?.classList.remove("is-visible")');
    const output=path.resolve(__dirname,'../docs/screenshots'); fs.mkdirSync(output,{recursive:true});
    await wait(250); fs.writeFileSync(path.join(output,'home-light.png'),(await win.webContents.capturePage()).toPNG());
    await js('api.setPrefs({...prefs,theme:"dark"})');
    await js('navigateToRoomShades(allRooms[0])');
    await wait(250); fs.writeFileSync(path.join(output,'room-dark.png'),(await win.webContents.capturePage()).toPNG());
    await js('api.setPrefs({...prefs,theme:"light"}); navigateToRoomShades(allRooms.find(r=>r.id==="2"))');
    await wait(200); fs.writeFileSync(path.join(output,'shade-handles.png'),(await win.webContents.capturePage()).toPNG());
    await js('api.setPrefs({...prefs,theme:"dark"}); navigateToRoomShades(allRooms[0])');
    await js('document.getElementById("shade-appearance-11").click()');
    await wait(100); fs.writeFileSync(path.join(output,'appearance-editor.png'),(await win.webContents.capturePage()).toPNG());
    await js('document.getElementById("shadeAppearanceDialog").close()');
    win.setSize(360,760); await wait(250); fs.writeFileSync(path.join(output,'room-narrow.png'),(await win.webContents.capturePage()).toPNG());
  });
  assert.deepEqual(errors, [], `Renderer errors: ${errors.join('\n')}`);
  const report={at:new Date().toISOString(),electron:process.versions.electron,platform:process.platform,arch:process.arch,checks,rendererErrors:errors,realHardwareTested:false};
  fs.writeFileSync(path.resolve(__dirname,'../docs/native-smoke-results.json'),JSON.stringify(report,null,2)+'\n');
  console.log(`Native smoke passed: ${checks.length} checks.`);
}
run().then(()=>app.exit(0)).catch(error=>{console.error(error);app.exit(1)});
