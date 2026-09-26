import type { MediaStorage } from '../src/storage';

/** In-memory storage for tests; signed URLs are fake but carry the key so tests can assert on it. */
export function memoryStorage(): MediaStorage & { objects: Map<string, { body: Uint8Array; contentType: string }> } {
  const objects = new Map<string, { body: Uint8Array; contentType: string }>();
  return {
    objects,
    put(key, body, contentType) {
      objects.set(key, { body, contentType });
      return Promise.resolve();
    },
    signedUrl(key, expiresInSeconds = 900) {
      if (!objects.has(key)) return Promise.reject(new Error(`no object ${key}`));
      return Promise.resolve(`https://storage.test/${key}?expires=${String(expiresInSeconds)}&signature=test`);
    },
    remove(key) {
      objects.delete(key);
      return Promise.resolve();
    },
  };
}
