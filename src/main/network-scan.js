const os = require('node:os');
const { isIP } = require('node:net');
const { GatewayClient } = require('./gateway-client');
const number = address => address.split('.').reduce((n, part) => (n * 256 + Number(part)) >>> 0, 0);
const address = n => [24, 16, 8, 0].map(shift => (n >>> shift) & 255).join('.');
function subnetHosts(ip, netmask) {
  if (isIP(ip) !== 4 || isIP(netmask) !== 4) return [];
  const mask = number(netmask), inverse = (~mask) >>> 0;
  if ((inverse & (inverse + 1)) !== 0 || inverse < 2 || inverse > 1023) return [];
  const start = (number(ip) & mask) >>> 0;
  return Array.from({ length: inverse - 1 }, (_, i) => address(start + i + 1)).filter(value => value !== ip);
}
function interfaces() {
  return Object.entries(os.networkInterfaces()).flatMap(([name, entries]) => entries.flatMap(entry => {
    if (entry.internal || !subnetHosts(entry.address, entry.netmask).length) return [];
    return [{ name: `${name}:${entry.address}`, label: `${name} · ${entry.address}`, address: entry.address, netmask: entry.netmask }];
  }));
}
class NetworkScan {
  constructor({ getInterfaces = interfaces, createClient = ip => new GatewayClient(ip, { timeout: 1200, readRetries: 0 }) } = {}) {
    this.getInterfaces = getInterfaces; this.createClient = createClient;
  }
  async start(name, onProgress = () => {}) {
    if (this.scan) throw new Error('A network scan is already running.');
    const network = this.getInterfaces().find(item => item.name === name);
    if (!network) throw new Error('Choose a local network, or enter your gateway address manually.');
    const hosts = subnetHosts(network.address, network.netmask);
    const scan = { cancelled: false, clients: new Set(), devices: [], next: 0, completed: 0 }; this.scan = scan;
    try {
      await Promise.all(Array.from({ length: Math.min(12, hosts.length) }, async () => {
        while (!scan.cancelled && scan.next < hosts.length) {
          const client = this.createClient(hosts[scan.next++]); scan.clients.add(client);
          try { const identity = await client.identify(); if (!scan.cancelled) scan.devices.push(identity); }
          catch { /* Only list verified gateways. */ }
          finally { client.dispose(); scan.clients.delete(client); scan.completed++;
            if (!scan.cancelled) onProgress({ current: scan.completed, total: hosts.length }); }
        }
      }));
      return { cancelled: scan.cancelled, devices: scan.devices };
    } finally { if (this.scan === scan) this.scan = null; }
  }
  stop() { if (this.scan) { this.scan.cancelled = true; for (const client of this.scan.clients) client.dispose(); } }
}
module.exports = { NetworkScan, interfaces, subnetHosts };
