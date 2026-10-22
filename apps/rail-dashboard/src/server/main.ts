import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { createApp } from './app.ts';
import { buildProviders, readConfig } from './config.ts';
import { JourneyService } from './journeys.ts';

if (existsSync('.env')) process.loadEnvFile('.env');

const cfg = readConfig();
const { set, status } = buildProviders(cfg);
const journeys = new JourneyService(set, { cacheMs: process.env.RESPONSE_CACHE_MS !== undefined ? Number(process.env.RESPONSE_CACHE_MS) : undefined });
const handler = createApp({ journeys, status, publicDir: cfg.publicDir, basicAuth: cfg.basicAuth });

const server = createServer((req, res) => {
  void handler(req, res);
});
server.listen(cfg.port, cfg.host, () => {
  console.log(`Rail dashboard on http://localhost:${cfg.port} — mode: ${status.mode}`);
  for (const m of status.messages) console.log(`  · ${m}`);
  if (!existsSync(cfg.publicDir)) console.warn(`  ! ${cfg.publicDir} missing — run "npm run build" first.`);
});
