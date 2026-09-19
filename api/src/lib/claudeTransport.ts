import http from 'node:http';
import https from 'node:https';

// Stream upstream even though callers need a complete Message. Anthropic pings
// and token deltas keep the connection active during long generations.
export function postClaudeMessage(
  url: string,
  headers: Record<string, string>,
  payload: Record<string, unknown>,
  { idleTimeoutMs = 120_000, deadlineMs = 240_000 } = {},
): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const body = JSON.stringify({ ...payload, stream: true });
    let settled = false;
    let deadline: ReturnType<typeof setTimeout>;
    const finish = (error?: Error, result?: { status: number; json: any }) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (error) reject(error);
      else resolve(result!);
    };
    const request = (target.protocol === 'http:' ? http : https).request(target, {
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
      timeout: idleTimeoutMs,
    }, (response) => {
      const status = response.statusCode ?? 0;
      const streaming = String(response.headers['content-type']).includes('text/event-stream');
      let pending = '';
      let message: any;
      let stopped = false;

      const event = (frame: string) => {
        const data = frame.split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart()).join('\n');
        if (!data) return; // comments / keep-alives
        const value = JSON.parse(data);
        if (value.type === 'error') throw new Error(value.error?.message || 'Claude stream failed');
        if (value.type === 'message_start') message = { ...value.message, content: [] };
        if (value.type === 'content_block_start' && message) {
          message.content[value.index] = { ...value.content_block };
        }
        if (value.type === 'content_block_delta' && value.delta?.type === 'text_delta') {
          const block = message?.content?.[value.index];
          if (!block || block.type !== 'text') throw new Error('Invalid Claude text stream');
          block.text += value.delta.text;
        }
        if (value.type === 'message_delta' && message) {
          Object.assign(message, value.delta);
          message.usage = { ...message.usage, ...value.usage };
        }
        if (value.type === 'message_stop') stopped = true;
      };

      response.setEncoding('utf8');
      response.on('data', (chunk: string) => {
        pending += chunk;
        if (!streaming) return;
        try {
          // Accept LF and CRLF, including delimiters split across TCP chunks.
          let boundary: RegExpExecArray | null;
          while ((boundary = /\r?\n\r?\n/.exec(pending))) {
            event(pending.slice(0, boundary.index).replace(/\r\n/g, '\n'));
            pending = pending.slice(boundary.index + boundary[0].length);
          }
        } catch (error) {
          finish(error as Error);
          response.destroy();
          request.destroy();
        }
      });
      response.on('end', () => {
        try {
          if (streaming) {
            if (!stopped || !message) throw new Error('Claude connection closed before generation completed');
            finish(undefined, { status, json: message });
          } else {
            // HTTP failures (401, 429, 529, etc.) still have ordinary JSON bodies.
            finish(undefined, { status, json: pending ? JSON.parse(pending) : {} });
          }
        } catch (error) {
          finish(error as Error);
        }
      });
      // IncomingMessage has its own error lifecycle, separate from the request.
      // Always settle the Promise on a truncated response instead of hanging or
      // letting an unhandled response error terminate the API process.
      response.on('error', (error) => finish(error));
      response.on('aborted', () => finish(new Error('Claude connection closed during generation')));
      response.on('close', () => {
        if (!response.complete) finish(new Error('Claude response was interrupted'));
      });
    });
    request.on('socket', (socket) => socket.setKeepAlive(true, 10_000));
    request.on('error', (error) => finish(error));
    request.on('timeout', () => request.destroy(new Error('Claude stopped responding. Please try again.')));
    // Socket timeouts only measure inactivity; pings must not keep a stuck call
    // alive forever. This deadline also covers DNS / connection establishment.
    deadline = setTimeout(() => {
      const error = new Error('Claude generation exceeded four minutes. Please try again.');
      finish(error);
      request.destroy(error);
    }, deadlineMs);
    deadline.unref();
    request.end(body);
  });
}
