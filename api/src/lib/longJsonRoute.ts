import type { Request, RequestHandler } from 'express';

interface JsonReply {
  status(code: number): JsonReply;
  json(body: unknown): void;
}

// New clients opt into SSE. Fast responses and older clients keep the existing
// JSON contract. During slow calls, comments keep the browser/proxy leg active;
// the final event carries the same success/error body as the original endpoint.
export function longJsonRoute(
  handler: (req: Request, reply: JsonReply) => Promise<unknown>,
  heartbeatMs = 10_000,
): RequestHandler {
  return (req, res) => {
    const startedAt = Date.now();
    let status = 200;
    let streaming = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const cleanup = () => clearInterval(timer);
    const reply: JsonReply = {
      status(code) { status = code; return reply; },
      json(body) {
        cleanup();
        if (res.destroyed || res.writableEnded) return;
        if (streaming) res.end(`data: ${JSON.stringify(body)}\n\n`);
        else res.status(status).json(body);
      },
    };
    if (req.get('accept')?.includes('text/event-stream')) {
      timer = setInterval(() => {
        if (res.destroyed || res.writableEnded) { cleanup(); return; }
        if (!streaming) {
          res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache, no-transform');
          res.setHeader('X-Accel-Buffering', 'no');
          res.flushHeaders();
          streaming = true;
        }
        res.write(': working\n\n');
      }, heartbeatMs);
      timer.unref();
    }
    res.once('finish', cleanup);
    res.once('close', () => {
      cleanup();
      if (!res.writableEnded) {
        console.warn(`[${req.path}] client disconnected after ${Date.now() - startedAt}ms requestId=${req.get('x-railway-request-id') ?? 'local'}`);
      }
    });
    // Express 4 does not catch rejected async handlers. Include profile reads
    // and prompt construction, which used to sit outside the route's try/catch.
    void Promise.resolve().then(() => handler(req, reply)).catch((error) => {
      console.error(`[${req.path}] request failed:`, error?.message ?? error);
      reply.status(500).json({ success: false, error: 'The request failed on the server. Please try again.' });
    });
  };
}
