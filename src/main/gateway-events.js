// EventSource lives in the main process so the renderer needs no network access.
class EventDecoder {
  constructor(onEvent) { this.onEvent = onEvent; this.buffer = ''; this.data = []; }
  push(chunk) {
    this.buffer += chunk;
    if (this.buffer.length > 1024 * 1024) throw new Error('Event too large');
    let end;
    while ((end = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, end).replace(/\r$/, ''); this.buffer = this.buffer.slice(end + 1);
      if (!line) {
        if (this.data.length) {
          try { this.onEvent(JSON.parse(this.data.join('\n'))); } catch { /* Ignore malformed events. */ }
          this.data = [];
        }
      } else if (line.startsWith('data:')) this.data.push(line.slice(5).replace(/^ /, ''));
      if (this.data.join('').length > 1024 * 1024) throw new Error('Event too large');
    }
  }
}
class GatewayEvents {
  constructor(address, { fetchImpl = fetch, onEvent, onStatus }) {
    Object.assign(this, { address, fetchImpl, onEvent, onStatus, stopped: false, retry: 1000 });
  }
  async start() {
    if (this.stopped) return;
    this.abort = new AbortController(); this.onStatus('connecting');
    const touch = () => { clearTimeout(this.idle); this.idle = setTimeout(() => this.abort.abort(), 75000); };
    touch();
    try {
      const response = await this.fetchImpl(`http://${this.address}/home/events?sse=true`, { signal: this.abort.signal, redirect: 'error', headers: { Accept: 'text/event-stream' } });
      if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('Unavailable event stream');
      if (this.stopped) return;
      this.onStatus('open'); this.retry = 1000;
      const decoder = new TextDecoder(), parser = new EventDecoder(this.onEvent);
      for await (const chunk of response.body) { if (this.stopped) break; touch(); parser.push(decoder.decode(chunk, { stream: true })); }
    } catch { /* Reconnect below; state reads have their own errors. */ }
    finally {
      clearTimeout(this.idle);
      if (!this.stopped) {
        this.onStatus('reconnecting');
        this.timer = setTimeout(() => this.start(), this.retry); this.retry = Math.min(this.retry * 2, 30000);
      }
    }
  }
  stop() { this.stopped = true; clearTimeout(this.timer); clearTimeout(this.idle); this.abort?.abort(); }
}
module.exports = { GatewayEvents, EventDecoder };
