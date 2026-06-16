import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { logger } from '../../core/logger.js';
import { extensionFor, type StorageProvider, type StoredObject } from '../provider.js';

export interface LocalConfig {
  dir: string;
  publicBaseUrl: string;
}

/**
 * Filesystem storage — writes captures to a local directory. Useful for
 * self-hosters without an object store, or when a sidecar/CDN serves the dir.
 * Set LOCAL_PUBLIC_BASE_URL to the URL that maps to the directory; otherwise the
 * returned `url` is a `file://` path (fine for single-box setups).
 */
export class LocalStorageProvider implements StorageProvider {
  readonly enabled = true;
  readonly name = 'local';
  private dir: string;

  constructor(private cfg: LocalConfig) {
    this.dir = resolve(cfg.dir);
  }

  async put(buffer: Buffer, contentType: string, keyHint: string): Promise<StoredObject> {
    const key = `${keyHint}.${extensionFor(contentType)}`;
    await mkdir(this.dir, { recursive: true });
    const path = join(this.dir, key);
    await writeFile(path, buffer);

    const url = this.cfg.publicBaseUrl
      ? `${this.cfg.publicBaseUrl.replace(/\/$/, '')}/${key}`
      : `file://${path}`;

    logger.debug({ path, bytes: buffer.length }, 'wrote capture (local)');
    return { key, url, bytes: buffer.length };
  }
}
