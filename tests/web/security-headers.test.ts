import { describe, expect, it } from 'vitest';

import {
  buildCsp,
  buildSecurityHeaders,
  generateNonce,
} from '../../apps/web/src/lib/security-headers';

const base = { nonce: 'abc123', development: false, https: false, pathname: '/demo' };

describe('buildCsp', () => {
  it('locks scripts to the nonce and forbids inline scripts and eval in production', () => {
    const csp = buildCsp(base);
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-(inline|eval)/);
  });

  it.each([
    "default-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ])('contains %s', (directive) => {
    expect(buildCsp(base).split('; ')).toContain(directive);
  });

  it('allows eval and websockets only in development', () => {
    expect(buildCsp({ ...base, development: true })).toContain("'unsafe-eval'");
    expect(buildCsp({ ...base, development: true })).toContain('ws:');
    expect(buildCsp(base)).not.toContain('ws:');
  });

  it('relaxes scripts for the Swagger UI page only, and only in development', () => {
    const docs = { ...base, pathname: '/api/docs' };
    expect(buildCsp({ ...docs, development: true })).toContain("script-src 'self' 'unsafe-inline'");
    expect(buildCsp(docs)).not.toContain("'unsafe-inline'; style");
    expect(buildCsp(docs)).toContain("'nonce-abc123'");
    expect(buildCsp({ ...base, development: true })).toContain("'nonce-abc123'");
  });
});

describe('buildSecurityHeaders', () => {
  it('sends no Referer from pages whose address carries a token', () => {
    for (const pathname of ['/recuperar/abc123', '/verificar/abc123']) {
      expect(buildSecurityHeaders({ ...base, pathname })['Referrer-Policy']).toBe('no-referrer');
    }
    for (const pathname of ['/recuperar', '/verificar', '/login', '/recuperar/']) {
      expect(buildSecurityHeaders({ ...base, pathname })['Referrer-Policy']).toBe(
        'strict-origin-when-cross-origin',
      );
    }
  });

  it('sets the fixed headers', () => {
    const headers = buildSecurityHeaders(base);
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['Permissions-Policy']).toBe('camera=(), microphone=(), geolocation=()');
    expect(headers['Cross-Origin-Opener-Policy']).toBe('same-origin');
  });

  it('sends HSTS only over HTTPS', () => {
    expect(buildSecurityHeaders(base)['Strict-Transport-Security']).toBeUndefined();
    expect(buildSecurityHeaders({ ...base, https: true })['Strict-Transport-Security']).toMatch(
      /^max-age=\d+/,
    );
  });
});

describe('generateNonce', () => {
  it('is 128 bits of base64 and different every time', () => {
    const nonces = new Set(Array.from({ length: 50 }, generateNonce));
    expect(nonces.size).toBe(50);
    for (const nonce of nonces) expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});
