import { config } from '../core/config.js';
import { logger } from '../core/logger.js';
import type { StorageProvider, StoredObject } from './provider.js';
import { NoneStorageProvider } from './providers/none.js';
import { S3StorageProvider } from './providers/s3.js';
import { LocalStorageProvider } from './providers/local.js';

export type { StorageProvider, StoredObject } from './provider.js';

/**
 * Storage registry. To add a backend: implement `StorageProvider` and add a
 * line here keyed by its `STORAGE_DRIVER` value — no call site changes needed.
 */
const BUILDERS: Record<string, () => StorageProvider> = {
  none: () => new NoneStorageProvider(),
  s3: () => new S3StorageProvider(config.storage.s3),
  local: () => new LocalStorageProvider(config.storage.local),
};

let provider: StorageProvider | null = null;
export function getStorage(): StorageProvider {
  if (!provider) {
    const build = BUILDERS[config.storage.driver] ?? BUILDERS.none!;
    provider = build();
    logger.info({ driver: provider.name, enabled: provider.enabled }, 'storage initialised');
  }
  return provider;
}

export function isStorageEnabled(): boolean {
  return getStorage().enabled;
}

/** Facade kept for call-site stability. */
export function putObject(
  buffer: Buffer,
  contentType: string,
  keyHint: string,
): Promise<StoredObject> {
  return getStorage().put(buffer, contentType, keyHint);
}
