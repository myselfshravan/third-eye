import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../core/config.js';
import { logger } from '../core/logger.js';

/**
 * Object storage on Cloudflare R2 (or any S3-compatible store). R2 is the cheap
 * choice here: zero egress fees, so serving captures via its public domain /
 * CDN costs nothing per download.
 */

let client: S3Client | null = null;

function s3(): S3Client {
  if (!client) {
    client = new S3Client({
      endpoint: config.storage.endpoint,
      region: config.storage.region,
      // R2 / MinIO want path-style addressing with a custom endpoint.
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.storage.accessKeyId,
        secretAccessKey: config.storage.secretAccessKey,
      },
    });
  }
  return client;
}

export interface StoredObject {
  key: string;
  url: string;
  bytes: number;
}

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

export function isStorageEnabled(): boolean {
  return config.storage.enabled;
}

/** Upload a capture and return a fetchable URL (public CDN or presigned). */
export async function putObject(
  buffer: Buffer,
  contentType: string,
  keyHint: string,
): Promise<StoredObject> {
  if (!config.storage.enabled) {
    throw new Error('Storage is disabled (STORAGE_ENABLED=false)');
  }
  const ext = EXT[contentType] ?? 'bin';
  const key = `captures/${keyHint}.${ext}`;

  await s3().send(
    new PutObjectCommand({
      Bucket: config.storage.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );

  let url: string;
  if (config.storage.publicBaseUrl) {
    url = `${config.storage.publicBaseUrl.replace(/\/$/, '')}/${key}`;
  } else {
    url = await getSignedUrl(
      s3(),
      new GetObjectCommand({ Bucket: config.storage.bucket, Key: key }),
      { expiresIn: config.storage.presignTtlSeconds },
    );
  }

  logger.debug({ key, bytes: buffer.length }, 'uploaded capture');
  return { key, url, bytes: buffer.length };
}
