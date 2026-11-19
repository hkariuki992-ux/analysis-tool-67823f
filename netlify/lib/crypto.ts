import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { getStore } from "@netlify/blobs";

let cachedKey: Promise<Buffer> | null = null;

/**
 * AES-256 key used to encrypt Deriv tokens at rest. Never exposed to the browser.
 *
 * 1. If TOKEN_ENCRYPTION_KEY is set (base64 32-byte key or any 32+ char
 *    passphrase), it is used.
 * 2. Otherwise a random 256-bit key is generated once and kept in a private
 *    Netlify Blobs store — physically separate from the database that holds the
 *    encrypted tokens. `onlyIfNew` makes concurrent first requests converge on
 *    a single key.
 */
function getKey(): Promise<Buffer> {
  if (!cachedKey) {
    cachedKey = resolveKey().catch((err) => {
      cachedKey = null;
      throw err;
    });
  }
  return cachedKey;
}

async function resolveKey(): Promise<Buffer> {
  const raw = process.env.TOKEN_ENCRYPTION_KEY?.trim();
  if (raw && raw.length >= 32) {
    const b = Buffer.from(raw, "base64");
    if (b.length === 32) return b;
    return createHash("sha256").update(raw, "utf8").digest();
  }
  const store = getStore({ name: "deriv-secrets", consistency: "strong" });
  const existing = await store.get("token-encryption-key");
  if (existing) return Buffer.from(existing, "base64");
  await store.set("token-encryption-key", randomBytes(32).toString("base64"), { onlyIfNew: true });
  const stored = await store.get("token-encryption-key");
  if (!stored) throw new Error("Unable to provision token encryption key");
  return Buffer.from(stored, "base64");
}

/** AES-256-GCM encrypt -> base64url(iv | authTag | ciphertext). */
export async function encrypt(plaintext: string): Promise<string> {
  const key = await getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64url");
}

/** Returns null when the payload was tampered with or the key changed. */
export async function decrypt(payload: string): Promise<string | null> {
  const key = await getKey();
  try {
    const buf = Buffer.from(payload, "base64url");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

const UNRESERVED = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

/** PKCE (RFC 7636): 64-char verifier from the unreserved set, S256 challenge. */
export function createPkcePair(): { verifier: string; challenge: string } {
  const bytes = randomBytes(64);
  let verifier = "";
  for (const b of bytes) verifier += UNRESERVED[b % UNRESERVED.length];
  const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
  return { verifier, challenge };
}
