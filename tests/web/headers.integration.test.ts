import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Builds the web app and serves it the way production does, then reads the real response headers
// (security control 18). Port 4010 keeps it apart from `pnpm dev` (4000).
const webDir = resolve(import.meta.dirname, '../../apps/web');
const base = 'http://127.0.0.1:4010';
let server: ChildProcess | undefined;

async function waitUntilUp(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      await fetch(`${base}/demo`);
      return;
    } catch {
      await new Promise((done) => setTimeout(done, 500));
    }
  }
  throw new Error('The production server did not start');
}

beforeAll(async () => {
  execFileSync('pnpm', ['exec', 'next', 'build'], { cwd: webDir, stdio: 'pipe' });
  server = spawn('pnpm', ['exec', 'next', 'start', '-p', '4010'], {
    cwd: webDir,
    stdio: 'pipe',
    detached: true, // own process group, so the whole tree can be stopped
  });
  await waitUntilUp();
}, 240_000);

afterAll(() => {
  // `pnpm exec` starts `next` as a child: stop the group, or the port stays taken (the Playwright
  // run that follows in CI would find it busy).
  if (server?.pid) process.kill(-server.pid);
});

function expectSecurityHeaders(response: Response): string {
  const csp = response.headers.get('content-security-policy') ?? '';
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).not.toMatch(/script-src[^;]*unsafe-(inline|eval)/);
  expect(response.headers.get('x-frame-options')).toBe('DENY');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  expect(response.headers.get('permissions-policy')).toBe(
    'camera=(), microphone=(), geolocation=()',
  );
  expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin');
  expect(response.headers.get('x-powered-by')).toBeNull();
  expect(response.headers.get('strict-transport-security')).toBeNull(); // plain HTTP
  return /'nonce-([^']+)'/.exec(csp)?.[1] ?? '';
}

describe('response headers of the production build', () => {
  it('a page has every header and its scripts carry the nonce of that response', async () => {
    const response = await fetch(`${base}/demo`);
    expect(response.status).toBe(200);
    const nonce = expectSecurityHeaders(response);
    expect(nonce).not.toBe('');
    const html = await response.text();
    expect(html).toContain(`nonce="${nonce}"`);
    expect(html).not.toMatch(/<script(?![^>]*nonce=)[^>]*>(?!\s*<\/script>)/);
  });

  it('an API route has the same headers (even a 404)', async () => {
    expectSecurityHeaders(await fetch(`${base}/api/v1/health`));
  });

  it('the nonce changes on every request', async () => {
    const first = expectSecurityHeaders(await fetch(`${base}/demo`));
    const second = expectSecurityHeaders(await fetch(`${base}/demo`));
    expect(first).not.toBe(second);
  });

  it('honours X-Forwarded-Proto: https by adding HSTS', async () => {
    const response = await fetch(`${base}/demo`, { headers: { 'x-forwarded-proto': 'https' } });
    expect(response.headers.get('strict-transport-security')).toMatch(/^max-age=\d+/);
  });

  it('does not serve source maps for the browser', async () => {
    const html = await (await fetch(`${base}/demo`)).text();
    const chunk = /\/_next\/static\/chunks\/[^"']+\.js/.exec(html)?.[0];
    expect(chunk).toBeDefined();
    expect((await fetch(`${base}${chunk}.map`)).status).toBe(404);
  });
});
