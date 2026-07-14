import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  CreateBucketCommand,
} from "@aws-sdk/client-s3";

/**
 * Card narration via the Piper TTS sidecar, cached in MinIO. Cards are
 * immutable after publish, so each card is synthesized at most once ever;
 * afterwards every listen is a cache hit. Without S3 configured (local dev)
 * audio is synthesized per-request; without PIPER_URL the feature is off and
 * the client falls back to browser speechSynthesis.
 */

const BUCKET = process.env.S3_BUCKET || "sparklet-media";

let s3: S3Client | null | undefined;
function getS3(): S3Client | null {
  if (s3 !== undefined) return s3;
  const { S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY } = process.env;
  if (!S3_ENDPOINT || !S3_ACCESS_KEY || !S3_SECRET_KEY) {
    s3 = null;
    return s3;
  }
  s3 = new S3Client({
    endpoint: S3_ENDPOINT,
    region: "us-east-1",
    forcePathStyle: true, // MinIO
    credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
  });
  return s3;
}

export const audioEnabled = () => Boolean(process.env.PIPER_URL);
export const audioCacheEnabled = () => audioEnabled() && getS3() !== null;

const audioKey = (cardId: string) => `audio/${cardId}.wav`;

let bucketReady = false;
async function ensureBucket(client: S3Client) {
  if (bucketReady) return;
  try {
    await client.send(new CreateBucketCommand({ Bucket: BUCKET }));
  } catch {
    /* already exists */
  }
  bucketReady = true;
}

async function synthesize(text: string): Promise<Buffer> {
  const res = await fetch(process.env.PIPER_URL!, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`piper returned ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function hasCardAudio(cardId: string): Promise<boolean> {
  const client = getS3();
  if (!client) return false;
  try {
    await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: audioKey(cardId) }));
    return true;
  } catch {
    return false;
  }
}

/** Cached narration for a card: MinIO hit, else Piper synthesis + store. */
export async function getCardAudio(cardId: string, text: string): Promise<Buffer> {
  const client = getS3();
  if (client) {
    try {
      const got = await client.send(
        new GetObjectCommand({ Bucket: BUCKET, Key: audioKey(cardId) })
      );
      return Buffer.from(await got.Body!.transformToByteArray());
    } catch {
      /* cache miss */
    }
  }
  const wav = await synthesize(text);
  if (client) {
    try {
      await ensureBucket(client);
      await client.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: audioKey(cardId),
          Body: wav,
          ContentType: "audio/wav",
        })
      );
    } catch (e) {
      console.warn("audio cache write failed:", e);
    }
  }
  return wav;
}
