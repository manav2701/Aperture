import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Private object storage for generated media (plan/phases/phase-06 §6.6). Anything S3-compatible
 * works: Supabase Storage, Cloudflare R2, Backblaze B2, MinIO. Objects are never public; people
 * get 15-minute signed URLs.
 */
export interface MediaStorage {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  signedUrl(key: string, expiresInSeconds?: number): Promise<string>;
  remove(key: string): Promise<void>;
}

export interface S3Settings {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export const SIGNED_URL_SECONDS = 15 * 60;

export function s3Storage(settings: S3Settings): MediaStorage {
  const client = new S3Client({
    endpoint: settings.endpoint,
    region: settings.region,
    // Supabase, MinIO and B2 address buckets by path, not by subdomain.
    forcePathStyle: true,
    credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
  });
  return {
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({ Bucket: settings.bucket, Key: key, Body: body, ContentType: contentType }),
      );
    },
    signedUrl(key, expiresInSeconds = SIGNED_URL_SECONDS) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket: settings.bucket, Key: key }), {
        expiresIn: expiresInSeconds,
      });
    },
    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket: settings.bucket, Key: key }));
    },
  };
}

/** Storage from MEDIA_S3_* variables, or undefined when they are not all set (media is then disabled). */
export function storageFromEnv(env: Readonly<Record<string, string | undefined>>): MediaStorage | undefined {
  const { MEDIA_S3_ENDPOINT, MEDIA_S3_REGION, MEDIA_S3_BUCKET, MEDIA_S3_ACCESS_KEY_ID, MEDIA_S3_SECRET_ACCESS_KEY } =
    env;
  if (
    !MEDIA_S3_ENDPOINT ||
    !MEDIA_S3_REGION ||
    !MEDIA_S3_BUCKET ||
    !MEDIA_S3_ACCESS_KEY_ID ||
    !MEDIA_S3_SECRET_ACCESS_KEY
  )
    return undefined;
  return s3Storage({
    endpoint: MEDIA_S3_ENDPOINT,
    region: MEDIA_S3_REGION,
    bucket: MEDIA_S3_BUCKET,
    accessKeyId: MEDIA_S3_ACCESS_KEY_ID,
    secretAccessKey: MEDIA_S3_SECRET_ACCESS_KEY,
  });
}

/** Where a job's n-th output lives. */
export const mediaKey = (orgId: string, jobId: string, index: number, extension: string) =>
  `org/${orgId}/media/${jobId}/${String(index)}.${extension}`;

export function extensionFor(contentType: string): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
  };
  return map[contentType.split(';')[0]?.trim() ?? ''] ?? 'bin';
}
