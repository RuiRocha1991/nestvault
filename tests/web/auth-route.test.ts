import { describe, expect, it, vi } from 'vitest';

const handler = vi.fn((req: Request) =>
  Promise.resolve(Response.json({ path: new URL(req.url).pathname })),
);

vi.mock('@webapp/server/auth', () => ({ getAuth: () => Promise.resolve({ handler }) }));
vi.mock('@nestvault/config', () => ({ env: { APP_URL: 'http://localhost:4000' } }));

const { GET, POST } = await import('../../apps/web/src/app/api/v1/auth/[...all]/route');

const params = { params: Promise.resolve({ all: ['sign-up', 'email'] }) };
const url = 'http://localhost:4000/api/v1/auth/sign-up/email';

describe('/api/v1/auth/[...all]', () => {
  it('hands same-origin writes to Better Auth', async () => {
    const response = await POST(
      new Request(url, {
        method: 'POST',
        headers: { origin: 'http://localhost:4000' },
        body: '{}',
      }),
      params,
    );
    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('refuses a write from another origin before Better Auth sees it', async () => {
    handler.mockClear();
    const response = await POST(
      new Request(url, { method: 'POST', headers: { origin: 'https://evil.example' }, body: '{}' }),
      params,
    );
    expect(response.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it('serves reads without an Origin header', async () => {
    const response = await GET(new Request(url.replace('sign-up/email', 'get-session')), params);
    expect(response.status).toBe(200);
  });
});
