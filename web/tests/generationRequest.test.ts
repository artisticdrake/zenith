import { afterEach, describe, expect, it, vi } from 'vitest';
import { generationRequest } from '../src/lib/generationRequest';

afterEach(() => vi.unstubAllGlobals());

function mockStream(text: string) {
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream({
    start(controller) {
      // Every byte is a separate chunk, including Unicode and SSE delimiters.
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream' },
  })));
}

describe('generationRequest', () => {
  it('ignores heartbeats and waits for the complete result across chunks', async () => {
    mockStream(': working\r\n\r\ndata: {"success":true,"name":"José"}\r\n\r\n');
    expect(await generationRequest('/tailor/claude', { method: 'POST' })).toEqual({ success: true, name: 'José' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('surfaces failures after streaming has already started with HTTP 200', async () => {
    mockStream(': working\n\ndata: {"success":false,"error":"Claude overloaded"}\n\n');
    await expect(generationRequest('/assemble/claude', {})).rejects.toThrow('Claude overloaded');
  });

  it('detects a truncated stream and does not retry a version-creating POST', async () => {
    mockStream(': working\n\ndata: {"success":');
    await expect(generationRequest('/assemble/claude', { method: 'POST' })).rejects.toThrow('check Resume Builder');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('handles a reset while reading the response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({
      start(controller) { controller.error(new TypeError('terminated')); },
    }), { headers: { 'Content-Type': 'text/event-stream' } })));
    await expect(generationRequest('/tailor/claude', {})).rejects.toThrow('connection to the server was interrupted');
  });

  it('explains a fetch rejection and preserves authorization when opting into streaming', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(generationRequest('/tailor/claude', { headers: { Authorization: 'Bearer test' } })).rejects.toThrow('connection to the server was interrupted');
    const headers = vi.mocked(fetch).mock.calls[0][1]!.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer test');
    expect(headers.get('Accept')).toContain('text/event-stream');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('supports ordinary JSON from the old API', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ success: true, fromCache: true })));
    expect(await generationRequest('/tailor/claude', {})).toEqual({ success: true, fromCache: true });
  });

  it('retains the HTTP status for a non-JSON proxy error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Bad Gateway</html>', { status: 502 })));
    await expect(generationRequest('/tailor/claude', {})).rejects.toThrow('HTTP 502');
  });
});
