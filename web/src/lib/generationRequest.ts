const CONNECTION_ERROR = 'The connection to the server was interrupted before a result arrived. Please try again. If you were weaving in bullets, check Resume Builder for a saved version first.';

// No automatic retries: assembly saves a new version and replaying a POST can
// duplicate it (and charge for a second generation).
export async function generationRequest(url: string, init: RequestInit): Promise<any> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'text/event-stream, application/json');
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers });
  } catch {
    throw new Error(CONNECTION_ERROR);
  }

  const validate = (data: any) => {
    if (!response.ok || !data?.success) {
      throw new Error(data?.error || `Generation failed (HTTP ${response.status}). Please try again.`);
    }
    return data;
  };
  // Also supports the old API during a rolling frontend/backend deployment.
  if (!response.headers?.get('content-type')?.includes('text/event-stream')) {
    let data: any;
    try { data = await response.json(); }
    catch {
      throw new Error(response.ok ? CONNECTION_ERROR : `The server returned HTTP ${response.status}. Please try again shortly.`);
    }
    return validate(data);
  }

  if (!response.body) throw new Error(CONNECTION_ERROR);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  try {
    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try { chunk = await reader.read(); }
      catch { throw new Error(CONNECTION_ERROR); }
      if (chunk.done) throw new Error(CONNECTION_ERROR);
      pending += decoder.decode(chunk.value, { stream: true });
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(pending))) {
        const frame = pending.slice(0, boundary.index);
        pending = pending.slice(boundary.index + boundary[0].length);
        const data = frame.split(/\r?\n/).filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart()).join('\n');
        if (!data) continue; // heartbeat comments
        let parsed: any;
        try { parsed = JSON.parse(data); }
        catch { throw new Error('The server returned an invalid generation result. Please try again.'); }
        return validate(parsed);
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
