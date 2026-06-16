/**
 * Storage abstraction. A capture is uploaded somewhere fetchable; how and where
 * is pluggable. Implement this interface and register it in `registry.ts` to
 * add a backend (GCS, Azure Blob, IPFS, …) — nothing else in the codebase needs
 * to change.
 */
export interface StoredObject {
  /** Stable object key/path. */
  key: string;
  /** A URL a client can fetch the capture from. */
  url: string;
  bytes: number;
}

export interface StorageProvider {
  /** Whether uploads are available. `none` reports false; routes fall back to base64. */
  readonly enabled: boolean;
  /** The driver name, for logging/diagnostics. */
  readonly name: string;
  /**
   * Persist a capture and return a fetchable URL.
   * @param keyHint a caller-supplied unique-ish hint (e.g. a nanoid or job id)
   */
  put(buffer: Buffer, contentType: string, keyHint: string): Promise<StoredObject>;
}

/** Common content-type → extension map shared by providers. */
export const EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

export function extensionFor(contentType: string): string {
  return EXTENSION[contentType] ?? 'bin';
}
