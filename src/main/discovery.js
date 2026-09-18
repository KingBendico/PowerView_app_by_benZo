const { isIP } = require('node:net');
const { GatewayClient } = require('./gateway-client');

class Discovery {
  constructor({ createBonjour, createClient = address => new GatewayClient(address, { timeout: 2500, readRetries: 0 }), duration = 5000 } = {}) {
    this.createBonjour = createBonjour || (onError => new (require('bonjour-service').Bonjour)({}, onError));
    this.createClient = createClient; this.duration = duration; this.running = null;
  }
  start() {
    if (this.running) return this.running.promise;
    const scan = { browsers: [], clients: [], found: [], seen: new Set(), tasks: [], cancelled: false, error: null };
    const discover = service => {
      if (scan.cancelled || scan.finishing || scan.seen.size >= 12) return;
      const hostname = service.addresses?.find(address => isIP(address) === 4) || service.host?.replace(/\.$/, '');
      if (!hostname) return;
      const address = `${hostname}${service.port && service.port !== 80 ? `:${service.port}` : ''}`;
      if (scan.seen.has(address)) return; scan.seen.add(address);
      let client;
      try { client = this.createClient(address); } catch { return; }
      scan.clients.push(client);
      scan.tasks.push(client.identify().then(async identity => {
        await client.getSnapshot();
        if (!scan.cancelled) scan.found.push({ ...identity, name: typeof service.name === 'string' ? service.name : identity.name });
      }).catch(() => {}).finally(() => client.dispose()));
    };
    scan.promise = new Promise(resolve => { scan.resolve = resolve; }); this.running = scan;
    const finish = async () => {
      if (scan.finishing) return; scan.finishing = true;
      clearTimeout(scan.timer); for (const browser of scan.browsers) browser.stop(); scan.bonjour?.destroy();
      if (scan.cancelled) for (const client of scan.clients) client.dispose();
      await Promise.allSettled(scan.tasks);
      if (this.running === scan) this.running = null;
      scan.resolve({ cancelled: scan.cancelled, devices: scan.found, error: scan.error });
    };
    scan.finish = finish;
    try {
      scan.bonjour = this.createBonjour(error => { scan.error = 'Automatic discovery is unavailable. Enter the gateway address manually.'; void error; });
      for (const type of ['PowerView-G3', 'powerview']) scan.browsers.push(scan.bonjour.find({ type, protocol: 'tcp' }, discover));
      discover({ host: 'powerview-g3.local', name: 'PowerView gateway' });
      scan.timer = setTimeout(finish, this.duration);
    } catch { scan.error = 'Automatic discovery is unavailable. Enter the gateway address manually.'; void finish(); }
    return scan.promise;
  }
  stop() { if (this.running) { this.running.cancelled = true; void this.running.finish(); } }
}
module.exports = { Discovery };
