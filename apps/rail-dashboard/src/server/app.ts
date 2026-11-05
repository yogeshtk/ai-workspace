// HTTP handler: JSON API + static PWA files. Uses only node:http.

import { existsSync, readFileSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { gzipSync } from 'node:zlib';
import { decodeQuery, QueryError } from '../shared/query.ts';
import type { ApiError, ProviderStatus } from '../shared/types.ts';
import type { JourneyService } from './journeys.ts';
import { ProviderError } from './providers/types.ts';
import { searchStations } from './stations.ts';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'",
};

export interface AppOptions {
  journeys: JourneyService;
  status: ProviderStatus;
  publicDir: string;
  basicAuth: { user: string; pass: string } | null;
  rateLimitPerMinute?: number;
}

function sendJson(req: IncomingMessage, res: ServerResponse, status: number, body: unknown, extraHeaders: Record<string, string> = {}): void {
  const json = Buffer.from(JSON.stringify(body));
  const gzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? '')) && json.length > 1024;
  const payload = gzip ? gzipSync(json) : json;
  res.writeHead(status, {
    'content-type': MIME['.json']!,
    'cache-control': 'no-store',
    ...(gzip ? { 'content-encoding': 'gzip', vary: 'accept-encoding' } : {}),
    'content-length': String(payload.length),
    ...SECURITY_HEADERS,
    ...extraHeaders,
  });
  res.end(payload);
}

function sendError(req: IncomingMessage, res: ServerResponse, status: number, err: ApiError): void {
  sendJson(req, res, status, err, err.retryAfterSeconds ? { 'retry-after': String(err.retryAfterSeconds) } : {});
}

function authorised(req: IncomingMessage, auth: AppOptions['basicAuth']): boolean {
  if (!auth) return true;
  const header = String(req.headers.authorization ?? '');
  if (!header.startsWith('Basic ')) return false;
  const [user, ...rest] = Buffer.from(header.slice(6), 'base64').toString('utf8').split(':');
  return user === auth.user && rest.join(':') === auth.pass;
}

const staticCache = new Map<string, { body: Buffer; gz: Buffer | null; mtime: number }>();

function serveStatic(req: IncomingMessage, res: ServerResponse, publicDir: string, pathname: string): void {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = normalize(join(publicDir, rel));
  if (!file.startsWith(publicDir)) {
    res.writeHead(403).end();
    return;
  }
  let target = file;
  if (!existsSync(target) || !statSync(target).isFile()) {
    // SPA fallback for unknown non-asset paths.
    if (extname(rel)) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }
    target = join(publicDir, 'index.html');
    if (!existsSync(target)) {
      res.writeHead(500, { 'content-type': 'text/plain' }).end('App not built. Run "npm run build".');
      return;
    }
  }
  const mtime = statSync(target).mtimeMs;
  let entry = staticCache.get(target);
  if (!entry || entry.mtime !== mtime) {
    const body = readFileSync(target);
    const compressible = /\.(html|js|css|json|svg|webmanifest|txt)$/.test(target);
    entry = { body, gz: compressible ? gzipSync(body) : null, mtime };
    staticCache.set(target, entry);
  }
  const ext = extname(target);
  const name = target.slice(publicDir.length);
  // index.html, sw.js and the manifest must revalidate; hashed-free assets get a short cache (the SW versions them).
  const cacheControl =
    name === '/index.html' || name === '/sw.js' || ext === '.webmanifest' ? 'no-cache' : ext === '.woff2' ? 'public, max-age=31536000, immutable' : 'public, max-age=3600';
  const useGz = entry.gz && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
  const payload = useGz ? entry.gz! : entry.body;
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': cacheControl,
    'content-length': String(payload.length),
    ...(useGz ? { 'content-encoding': 'gzip', vary: 'accept-encoding' } : {}),
    ...SECURITY_HEADERS,
  });
  res.end(req.method === 'HEAD' ? undefined : payload);
}

export function createApp(opts: AppOptions) {
  const limit = opts.rateLimitPerMinute ?? 120;
  const buckets = new Map<string, { count: number; resetAt: number }>();
  const rateLimited = (ip: string): number | null => {
    const now = Date.now();
    const b = buckets.get(ip);
    if (!b || now > b.resetAt) {
      buckets.set(ip, { count: 1, resetAt: now + 60_000 });
      if (buckets.size > 1000) buckets.clear();
      return null;
    }
    b.count++;
    return b.count > limit ? Math.ceil((b.resetAt - now) / 1000) : null;
  };

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (url.pathname === '/api/health') return sendJson(req, res, 200, { ok: true, time: Date.now() });
      if (!authorised(req, opts.basicAuth)) {
        res.writeHead(401, { 'www-authenticate': 'Basic realm="rail-dashboard"', 'content-type': 'text/plain' }).end('Authentication required');
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { allow: 'GET, HEAD' }).end();
        return;
      }
      if (url.pathname.startsWith('/api/')) {
        const retry = rateLimited(req.socket.remoteAddress ?? 'unknown');
        if (retry !== null) return sendError(req, res, 429, { error: 'Too many requests — slow down.', code: 'rate-limited', retryAfterSeconds: retry });
      }
      if (url.pathname === '/api/status') return sendJson(req, res, 200, opts.status);
      if (url.pathname === '/api/stations') {
        return sendJson(req, res, 200, { stations: searchStations(url.searchParams.get('q') ?? '', 12) });
      }
      if (url.pathname === '/api/journeys') {
        const q = decodeQuery(url.searchParams);
        const result = await opts.journeys.find(q);
        return sendJson(req, res, 200, result);
      }
      if (url.pathname.startsWith('/api/')) return sendError(req, res, 404, { error: 'Unknown API route.', code: 'bad-request' });
      return serveStatic(req, res, opts.publicDir, url.pathname);
    } catch (err) {
      if (err instanceof QueryError) return sendError(req, res, 400, { error: err.message, code: 'bad-request' });
      if (err instanceof ProviderError) {
        const status = err.code === 'rate-limited' ? 429 : err.code === 'no-data' ? 422 : err.code === 'auth' ? 502 : 502;
        return sendError(req, res, status, { error: err.message, code: err.code, ...(err.retryAfterSeconds ? { retryAfterSeconds: err.retryAfterSeconds } : {}) });
      }
      console.error(err);
      return sendError(req, res, 500, { error: 'Unexpected server error.', code: 'internal' });
    }
  };
}
