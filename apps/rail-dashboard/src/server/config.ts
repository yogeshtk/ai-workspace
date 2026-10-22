// Server configuration from environment variables (see .env.example).
// Credentials stay on the server; the browser only ever talks to /api/*.

import { resolve } from 'node:path';
import { addBankHolidays } from '../shared/calendar.ts';
import type { ProviderStatus } from '../shared/types.ts';
import { DarwinProvider } from './providers/darwin.ts';
import { DemoProvider, type DemoScenario } from './providers/demo.ts';
import type { ProviderSet } from './journeys.ts';
import { ScheduleStore } from './timetable/schedule-store.ts';

export interface ServerConfig {
  port: number;
  host: string;
  darwinApiKey: string | null;
  darwinBaseUrl: string | undefined;
  timetableFile: string;
  forceDemo: boolean;
  demoScenario: DemoScenario;
  demoLatencyMs: number;
  basicAuth: { user: string; pass: string } | null;
  publicDir: string;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  if (env.BANK_HOLIDAYS) addBankHolidays(env.BANK_HOLIDAYS.split(',').map((s) => s.trim()));
  const user = env.BASIC_AUTH_USER?.trim();
  const pass = env.BASIC_AUTH_PASSWORD?.trim();
  return {
    port: Number(env.PORT) || 8787,
    host: env.HOST || '0.0.0.0',
    darwinApiKey: env.DARWIN_API_KEY?.trim() || null,
    darwinBaseUrl: env.DARWIN_BASE_URL?.trim() || undefined,
    timetableFile: resolve(env.TIMETABLE_FILE || 'data/timetable.json'),
    forceDemo: env.DEMO_MODE === 'true' || env.DEMO_MODE === '1',
    demoScenario: env.DEMO_SCENARIO === 'disrupted' ? 'disrupted' : 'normal',
    demoLatencyMs: Number(env.DEMO_LATENCY_MS) || 0,
    basicAuth: user && pass ? { user, pass } : null,
    publicDir: resolve(env.PUBLIC_DIR || 'dist/public'),
  };
}

export function buildProviders(cfg: ServerConfig): { set: ProviderSet; status: ProviderStatus } {
  const messages: string[] = [];
  const live = cfg.darwinApiKey && !cfg.forceDemo ? new DarwinProvider({ apiKey: cfg.darwinApiKey, baseUrl: cfg.darwinBaseUrl }) : null;

  let scheduled: ScheduleStore | null = null;
  if (!cfg.forceDemo) {
    try {
      scheduled = ScheduleStore.load(cfg.timetableFile);
    } catch (err) {
      messages.push(`Could not read the timetable file: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const demoMode = cfg.forceDemo || (!live && !scheduled);
  const liveMissing = live ? [] : ['DARWIN_API_KEY (Rail Data Marketplace → "Live Departure Board" subscription)'];
  const schedMissing = scheduled ? [] : [`Timetable file ${cfg.timetableFile} (run "npm run timetable:import")`];
  if (demoMode) {
    messages.push(
      cfg.forceDemo
        ? 'Demo mode forced by DEMO_MODE=true.'
        : 'Demo mode: no live credentials and no imported timetable. Results are simulated and are not real trains.',
    );
  } else if (!live) {
    messages.push('No live feed configured: showing the planned timetable only (no delays, cancellations or confirmed platforms).');
  } else if (!scheduled) {
    messages.push('No timetable imported: only the next ~2 hours (live) can be searched; other dates need the timetable import.');
  }

  const set: ProviderSet = {
    live: demoMode ? null : live,
    scheduled: demoMode ? null : scheduled,
    demo: demoMode ? new DemoProvider({ scenario: cfg.demoScenario, latencyMs: cfg.demoLatencyMs }) : null,
    now: Date.now,
  };
  const status: ProviderStatus = {
    mode: demoMode ? 'demo' : live ? 'live' : 'scheduled-only',
    live: { name: 'National Rail Darwin (LDBWS via Rail Data Marketplace)', configured: Boolean(live), missing: liveMissing },
    scheduled: {
      name: 'Network Rail SCHEDULE (CIF) timetable',
      configured: Boolean(scheduled),
      missing: schedMissing,
      detail: scheduled ? scheduled.describe() : null,
    },
    demo: demoMode,
    messages,
  };
  return { set, status };
}
