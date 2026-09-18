// Characterizes the untouched local baseline with fake DOM/IPC/network. No hardware access.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
if (!process.argv[2]) throw new Error('Pass the path to the original local baseline (not the upgraded source).');
const repo = path.resolve(process.argv[2]);
class Element {
  constructor(tag = 'div') {
    this.tagName = tag; this.children = []; this.events = {}; this.attributes = {}; this.dataset = {};
    this.style = { setProperty() {} }; this.classList = { add() {}, remove() {}, toggle() {} }; this.value = '';
  }
  set innerHTML(v) { this.html = v; this.children = []; }
  get innerHTML() { return this.html || ''; }
  appendChild(e) { this.children.push(e); return e; }
  setAttribute(k,v) { this.attributes[k] = v; }
  removeAttribute(k) { delete this.attributes[k]; }
  addEventListener(k, cb) { (this.events[k] ||= []).push(cb); }
  dispatch(k) { for (const cb of this.events[k] || []) cb.call(this, { stopPropagation() {}, target: this }); }
}
function fixture() {
  const requests = [], nodes = new Map();
  const document = {
    body: new Element(), documentElement: new Element(), activeElement: null,
    getElementById(id) {
      if (/Overlay|Backdrop|PanelClose|ipAddress|shade-battery-row|shade-badges/.test(id)) return null;
      if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id);
    },
    createElement: tag => new Element(tag), createTextNode: text => ({textContent: text}), addEventListener() {},
  };
  class XHR {
    constructor() { this.events = {}; this.DONE = 4; requests.push(this); }
    addEventListener(k, cb) { this.events[k] = cb; }
    open(method,url) { this.method = method; this.url = url; }
    setRequestHeader() {}
    send(body) { this.body = body; }
    respond(status, data) { this.status = status; this.responseText = JSON.stringify(data); this.readyState = 4;
      for (const k of ['readystatechange','load','loadend']) this.events[k]?.call(this); }
  }
  const ctx = vm.createContext({ document, XMLHttpRequest: XHR, console, setTimeout() {}, clearTimeout() {},
    ResizeObserver: class { observe() {} }, window: {}, confirm: () => true,
    localStorage: { getItem: () => null, setItem() {} }, requestAnimationFrame() {},
    require: () => ({ ipcRenderer: { on() {}, invoke: async () => ({}) } }) });
  vm.runInContext(fs.readFileSync(path.join(repo,'src/renderer/renderer.js'),'utf8'),ctx);
  const run = js => vm.runInContext(js,ctx);
  run('host="http://fixture.local"; allRooms=[{id:1,ptName:"Stairs"}]; allShades=[{id:11,roomId:1,ptName:"Window",type:1,positions:{primary:0.25,secondary:0.6}}]');
  return {run,requests,document};
}
const results = [];
function check(name, fn) { try { results.push({name,result:'verified',observation:fn()}); } catch(e) { results.push({name,result:'failed',error:e.message}); } }
check('HTTP failure now preserves remembered position', () => {
  const f=fixture(); f.run('updateShadePosition(11,10,60)'); f.requests[0].respond(500,{});
  assert.equal(f.run('allShades[0].positions.primary'),.25); return 'Prior failed-command state finding is fixed.';
});
check('Acknowledgment still replaces reported position before telemetry', () => {
  const f=fixture(); f.run('updateShadePosition(11,10,60)'); f.requests[0].respond(200,{});
  assert.equal(f.run('allShades[0].positions.primary'),.9); return '25% opening becomes 90% on HTTP acknowledgment alone.';
});
check('Single-axis update still transmits secondary', () => {
  const f=fixture(); f.run('updateShadePosition(11,10,60)');
  assert.equal(JSON.parse(f.requests[0].body).positions.secondary,.6); return 'Secondary is retained rather than reset, but is still sent unnecessarily.';
});
check('The 25% preset sends 75% closed', () => {
  const f=fixture(); f.run('moveShadeToGatewayPrimary(11,0.25,null)');
  const p=JSON.parse(f.requests[0].body).positions.primary; assert.equal(f.run(`gatewayPositionToVisualPercent(${p})`),75);
  return 'Preset labels use the opposite percentage convention from the number field.';
});
check('Gen 3 scene route has been corrected', () => {
  const f=fixture(); f.run('showSceneRunToast=()=>{}; activateScene(101)');
  assert.equal(f.requests[0].url,'http://fixture.local/home/scenes/101/activate'); return f.requests[0].url;
});
check('Empty gateway configuration skips requests', () => {
  const f=fixture(); f.run('host=""; fetchColors(); fetchAllShades(); fetchAllScenes(); fetchAllRooms()');
  assert.equal(f.requests.length,0); return 'Prior invalid http:/// request finding is fixed.';
});
check('Transport error invokes bulk callback twice', () => {
  const f=fixture(); f.run('var calls=0; gatewayPutJson("http://fixture.local/test",{},()=>calls++)');
  const r=f.requests[0]; r.status=0; r.events.error.call(r); r.events.loadend.call(r);
  assert.equal(f.run('calls'),2); return 'Both error and loadend deliver the callback.';
});
check('Manual refresh on room grid does not refresh rooms or scenes', () => {
  const f=fixture(); f.run('currentMainView="rooms"; refreshAllHubDataNow()');
  assert.deepEqual(f.requests.map(r=>new URL(r.url).pathname),['/home/colors','/home/shades/']);
  return 'Refresh requests only colors and shades until another navigation action.';
});
check('Navigation away does not invalidate pending room reads', () => {
  const f=fixture(); f.run('fetchAndDisplayShadesInRoom(1); currentMainView="scenes"; displayShadesInRoom=()=>{currentMainView="room-shades"}');
  f.requests[0].respond(200,[]); assert.equal(f.run('currentMainView'),'room-shades');
  return 'A late room response can reopen the room after switching to Scenes.';
});
check('Room names now render as text', () => {
  const f=fixture(); f.run('allRooms[0].ptName="<b>marker</b>"; allShades=[]; displayShadesInRoom(1)');
  const heading=f.document.getElementById('content').children.find(e=>e.tagName==='h2');
  assert.equal(heading.children.at(-1).textContent,' <b>marker</b> blinds'); return 'Prior room-heading HTML injection finding is fixed.';
});
check('Type 9 still receives the single shade control', () => {
  const f=fixture(); f.run('var choice=""; allShades[0].type=9; createShadeWindowControl=()=>{choice="single";return {row:document.createElement("div")}};createDualShadeWindowControl=()=>{choice="dual";return {root:document.createElement("div")}};displayShadesInRoom(1)');
  assert.equal(f.run('choice'),'single'); return 'Only type 8 gets the dual-rail graphic.';
});
check('No timeout is set on shade requests', () => {
  const f=fixture(); f.run('fetchAllShades();updateShadePosition(11,10,60)');
  assert.ok(f.requests.every(r=>r.timeout===undefined)); return 'The default XHR timeout is unlimited.';
});
const output={reviewedAt:new Date().toISOString(),source:repo,method:'Baseline JavaScript executed with simulated DOM, IPC and gateway responses; no Electron or hardware validation.',total:results.length,verified:results.filter(r=>r.result==='verified').length,results};
fs.writeFileSync(path.join(__dirname,'current-source-results.json'),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify(output,null,2));
if(output.total!==output.verified)process.exitCode=1;
