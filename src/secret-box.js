import crypto from 'node:crypto';
import { config } from './config.js';

/**
 * AES-256-GCM for values that sit in state.json.
 *
 * The OAuth tokens have always been sealed this way. The import-network
 * settings -- a live YouTube cookie jar and a proxy URL with its password --
 * sat in plain text in the same file, which meant a stolen or leaked state.json
 * handed over a signed-in YouTube session and a paid proxy account while every
 * other credential in it was unreadable.
 *
 * `open` accepts a plain string that was never sealed, so existing values keep
 * working and are sealed the next time they are written. That migration is
 * one-way on purpose: nothing here ever writes plaintext back.
 */
export class SecretBoxError extends Error {}

function keyOrNull() {
  const secret = config.socialTokenKey;
  if (!secret || secret.length < 32) return null;
  return crypto.createHash('sha256').update(secret).digest();
}

/** True when this deployment can seal at all. */
export function canSeal() { return keyOrNull() !== null; }

export function seal(value) {
  const key = keyOrNull();
  // Without a key there is nothing to seal with. Refusing here would break a
  // local deployment that never configured one; the caller is told by canSeal.
  if (key === null) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function isSealed(payload) {
  return typeof payload === 'string' && /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(payload);
}

export function open(payload) {
  if (payload === null || payload === undefined) return null;
  // Written before this existed, or written by a deployment with no key.
  if (!isSealed(payload)) return payload;
  const key = keyOrNull();
  if (key === null) throw new SecretBoxError('This value is encrypted and SOCIAL_TOKEN_KEY is not set.');
  const [, ivText, tagText, dataText] = String(payload).split('.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(dataText, 'base64url')), decipher.final()]).toString('utf8'));
}
