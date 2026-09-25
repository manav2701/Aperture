/**
 * Incremental Server-Sent Events reader: feed it raw chunks as they stream past, and it calls
 * `onData` with each event's parsed JSON `data:` payload. Bytes are never altered — this only
 * observes the stream the client receives.
 */
export function sseObserver(onData: (payload: unknown) => void) {
  const decoder = new TextDecoder();
  let buffer = '';

  const flushEvent = (block: string) => {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (data === '' || data === '[DONE]') return;
    try {
      onData(JSON.parse(data) as unknown);
    } catch {
      // Keep-alives and non-JSON events are passed through untouched.
    }
  };

  return {
    push(chunk: Uint8Array) {
      buffer += decoder.decode(chunk, { stream: true });
      let boundary = /\r?\n\r?\n/.exec(buffer);
      while (boundary !== null) {
        flushEvent(buffer.slice(0, boundary.index));
        buffer = buffer.slice(boundary.index + boundary[0].length);
        boundary = /\r?\n\r?\n/.exec(buffer);
      }
      // Guard against an upstream that never sends an event boundary.
      if (buffer.length > 1_000_000) buffer = buffer.slice(-100_000);
    },
    end() {
      buffer += decoder.decode();
      if (buffer.trim() !== '') flushEvent(buffer);
      buffer = '';
    },
  };
}
