// Small load generator for capacity checks against the local gateway.
// Usage: node loadtest.mjs <endpoint> <concurrency> <seconds>
//   endpoint: puzzle | guess | health
// Guest sessions it creates use guest_id 'loadtest-*'; clean them up with
//   delete from daily_sessions where guest_id like 'loadtest-%';
//   delete from rate_limits where key like '%:ip:%';
import { randomUUID } from 'node:crypto';

const [endpoint = 'puzzle', concurrency = '10', seconds = '10'] = process.argv.slice(2);
const base = process.env.BASE ?? 'http://127.0.0.1:54321/functions/v1';
const anon = process.env.ANON_KEY;
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
const headers = { Authorization: `Bearer ${anon}`, 'Content-Type': 'application/json' };
// Spread requests over fake client IPs so per-IP limits don't mask backend capacity.
const randomIp = () => Array.from({ length: 4 }, () => Math.floor(Math.random() * 254) + 1).join('.');

const requests = {
  health: () => fetch(`${base}/health`),
  puzzle: () => fetch(`${base}/get-daily-puzzle`, { headers }),
  guess: () =>
    fetch(`${base}/submit-guess`, {
      method: 'POST',
      headers: { ...headers, 'CF-Connecting-IP': randomIp() },
      body: JSON.stringify({ guess: 'pikachu', puzzle_date_key: today, guest_id: `loadtest-${randomUUID()}` }),
    }),
};

const send = requests[endpoint];
const deadline = Date.now() + Number(seconds) * 1000;
const latencies = [];
const statuses = {};

async function worker() {
  while (Date.now() < deadline) {
    const t0 = performance.now();
    try {
      const res = await send();
      await res.arrayBuffer();
      statuses[res.status] = (statuses[res.status] ?? 0) + 1;
    } catch {
      statuses.error = (statuses.error ?? 0) + 1;
    }
    latencies.push(performance.now() - t0);
  }
}

await Promise.all(Array.from({ length: Number(concurrency) }, worker));
latencies.sort((a, b) => a - b);
const pct = (p) => latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))].toFixed(0);
console.log(JSON.stringify({
  endpoint, concurrency: Number(concurrency), requests: latencies.length,
  rps: +(latencies.length / Number(seconds)).toFixed(1),
  p50_ms: +pct(50), p95_ms: +pct(95), p99_ms: +pct(99), statuses,
}));
