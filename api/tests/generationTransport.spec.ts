import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import express from 'express';
import { postClaudeMessage } from '../src/lib/claudeTransport';
import { longJsonRoute } from '../src/lib/longJsonRoute';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const frame = (event: object) => `data: ${JSON.stringify(event)}\r\n\r\n`;
const start = { type: 'message_start', message: { model: 'test', usage: { input_tokens: 8 } } };
const stop = { type: 'message_stop' };

async function withServer(handler: http.RequestListener, run: (url: string) => Promise<void>) {
  const server = http.createServer(handler).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await run(`http://127.0.0.1:${(server.address() as any).port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function main() {
  await withServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    assert.equal(JSON.parse(body).stream, true);
    res.setHeader('Content-Type', 'text/event-stream');
    const events = [start,
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'ping' },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '{"name":"José"}' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 12 } }, stop,
    ].map(frame).join('');
    // Split delimiters and multi-byte Unicode characters across writes.
    for (const byte of Buffer.from(events)) res.write(Buffer.from([byte]));
    res.end();
  }, async (url) => {
    const { json } = await postClaudeMessage(url, {}, {});
    assert.equal(json.content[0].text, '{"name":"José"}');
    assert.deepEqual(json.usage, { input_tokens: 8, output_tokens: 12 });
    assert.equal(json.stop_reason, 'end_turn');
  });
  console.log('  ok    Claude stream preserves text and token usage across chunks');

  await withServer((_req, res) => {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Rate limited' } }));
  }, async (url) => {
    const result = await postClaudeMessage(url, {}, {});
    assert.equal(result.status, 429);
    assert.equal(result.json.error.message, 'Rate limited');
  });
  console.log('  ok    non-streaming API errors retain status and message');

  for (const mode of ['reset', 'incomplete', 'error', 'malformed']) {
    await withServer(async (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(frame(start));
      await pause(20);
      if (mode === 'reset') res.destroy();
      if (mode === 'incomplete') res.end();
      if (mode === 'error') res.end(frame({ type: 'error', error: { message: 'Overloaded' } }));
      if (mode === 'malformed') res.end('data: {bad JSON}\n\n');
    }, async (url) => {
      const expected = mode === 'error' ? /Overloaded/ : mode === 'malformed' ? /JSON|property/i : /closed|interrupted|aborted/;
      await assert.rejects(postClaudeMessage(url, {}, {}, { deadlineMs: 2000 }), expected);
    });
    console.log(`  ok    ${mode} response rejects without hanging or crashing`);
  }

  await withServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(frame(start));
    const timer = setInterval(() => res.write(frame({ type: 'ping' })), 15);
    res.on('close', () => clearInterval(timer));
  }, async (url) => {
    await assert.rejects(postClaudeMessage(url, {}, {}, { idleTimeoutMs: 100, deadlineMs: 180 }), /exceeded/);
  });
  console.log('  ok    pings do not bypass the total generation deadline');

  await withServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(frame(start));
  }, async (url) => {
    await assert.rejects(postClaudeMessage(url, {}, {}, { idleTimeoutMs: 60, deadlineMs: 2000 }), /stopped responding/);
  });
  console.log('  ok    stalled response rejects on idle timeout');

  const app = express();
  app.post('/slow', longJsonRoute(async (_req, reply) => {
    await pause(45);
    reply.json({ success: true, score: 88 });
  }, 10));
  app.post('/fail', longJsonRoute(async (_req, reply) => {
    await pause(45);
    reply.status(500).json({ success: false, error: 'Overloaded' });
  }, 10));
  app.post('/throw', longJsonRoute(async () => { throw new Error('profile lookup failed'); }));
  await withServer(app, async (url) => {
    const response = await fetch(`${url}/slow`, { method: 'POST', headers: { Accept: 'text/event-stream' } });
    assert.match(response.headers.get('content-type')!, /text\/event-stream/);
    const reader = response.body!.getReader();
    const first = await reader.read();
    assert.match(new TextDecoder().decode(first.value), /: working/);
    let rest = '';
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      rest += new TextDecoder().decode(chunk.value);
    }
    assert.match(rest, /data: {"success":true,"score":88}/);
    const failed = await fetch(`${url}/fail`, { method: 'POST', headers: { Accept: 'text/event-stream' } });
    assert.match(await failed.text(), /"success":false,"error":"Overloaded"/);
    const legacy = await fetch(`${url}/fail`, { method: 'POST' });
    assert.equal(legacy.status, 500);
    assert.deepEqual(await legacy.json(), { success: false, error: 'Overloaded' });
    const thrown = await fetch(`${url}/throw`, { method: 'POST' });
    assert.equal(thrown.status, 500);
    assert.equal((await thrown.json()).success, false);
  });
  console.log('  ok    browser heartbeats, late failures, legacy JSON, async rejection handling');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
