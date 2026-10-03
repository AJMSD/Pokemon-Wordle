import { describe, it, expect } from 'vitest';
import { allowedOrigin, corsHeadersFor, handleCors } from './cors';

const req = (origin?: string, method = 'GET') =>
  new Request('http://x/fn', { method, headers: origin ? { Origin: origin } : {} });

describe('cors', () => {
  it('echoes allowlisted origins', () => {
    expect(allowedOrigin('https://wurmple.ajmsd.space')).toBe('https://wurmple.ajmsd.space');
    expect(allowedOrigin('http://localhost:5173')).toBe('http://localhost:5173');
    expect(allowedOrigin('http://localhost:4173')).toBe('http://localhost:4173');
  });

  it('rejects others', () => {
    expect(allowedOrigin('https://evil.example')).toBeNull();
    expect(allowedOrigin('https://wurmple.ajmsd.space.evil.example')).toBeNull();
    expect(allowedOrigin(null)).toBeNull();
  });

  it('sets ACAO + Vary only for allowed origins', () => {
    const ok = corsHeadersFor(req('http://localhost:5173'));
    expect(ok['Access-Control-Allow-Origin']).toBe('http://localhost:5173');
    expect(ok.Vary).toBe('Origin');
    const bad = corsHeadersFor(req('https://evil.example'));
    expect(bad['Access-Control-Allow-Origin']).toBeUndefined();
    expect(bad.Vary).toBe('Origin');
  });

  it('answers preflight', () => {
    expect(handleCors(req('http://localhost:5173', 'OPTIONS'))?.status).toBe(200);
    expect(handleCors(req('http://localhost:5173', 'GET'))).toBeNull();
  });
});
