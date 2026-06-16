import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { logger } from '../../core/logger.js';
import { extensionFor, type StorageProvider, type StoredObject } from '../provider.js';

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl: string;
  presignTtlSeconds: number;
}

/**
 * S3-compatible storage — Cloudflare R2, AWS S3, MinIO, Backblaze B2, etc.
 * R2 is the cheap default: zero egress fees, so serving via its public domain
 * costs nothing per download.
 */
export class S3StorageProvider implements StorageProvider {
  readonly enabled = true;
  readonly name = 's3';
  private client: S3Client;

  constructor(private cfg: S3Config) {
    this.client = new S3Client({
      endpoint: cfg.endpoint || undefined,
      region: cfg.region,
      // R2/MinIO (custom endpoint) need path-style; AWS S3 prefers virtual-hosted.
      forcePathStyle: !!cfg.endpoint,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    });
  }

  async put(buffer: Buffer, contentType: string, keyHint: string): Promise<StoredObject> {
    const key = `captures/${keyHint}.${extensionFor(contentType)}`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );

    const url = this.cfg.publicBaseUrl
      ? `${this.cfg.publicBaseUrl.replace(/\/$/, '')}/${key}`
      : await getSignedUrl(
          this.client,
          new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }),
          { expiresIn: this.cfg.presignTtlSeconds },
        );

    logger.debug({ key, bytes: buffer.length }, 'uploaded capture (s3)');
    return { key, url, bytes: buffer.length };
  }
}
