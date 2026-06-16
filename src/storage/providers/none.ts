import type { StorageProvider, StoredObject } from '../provider.js';

/** The default: no object store. Routes/worker fall back to inline base64. */
export class NoneStorageProvider implements StorageProvider {
  readonly enabled = false;
  readonly name = 'none';

  put(): Promise<StoredObject> {
    return Promise.reject(
      new Error('Storage is disabled (STORAGE_DRIVER=none). Set STORAGE_DRIVER=s3|local to upload.'),
    );
  }
}
