import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'node:crypto';

const ALGO = 'aes-256-gcm';
const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;
const PREFIX = 'enc:v1:';

function getSecretPath(): string {
  const override = process.env.UNFCK_SECRET_PATH;
  if (override) return resolve(override);
  return resolve(process.cwd(), 'data', '.app_secret');
}

let cachedKey: Buffer | null = null;

function loadOrCreateAppSecret(): Buffer {
  if (cachedKey) return cachedKey;
  const path = getSecretPath();
  if (existsSync(path)) {
    const raw = readFileSync(path, 'utf8').trim();
    const key = Buffer.from(raw, 'base64');
    if (key.length !== KEY_LEN) {
      throw new Error(
        `app secret at ${path} is malformed (expected ${KEY_LEN} bytes, got ${key.length})`,
      );
    }
    cachedKey = key;
    return key;
  }

  // One-shot migration from the legacy default location (<cwd>/data/.app_secret).
  // The Tauri sidecar used to land that file inside the program-files install
  // tree, which the NSIS uninstaller wipes on every reinstall — the encrypted
  // auth rows survived in app_data_dir but the key didn't. Now the key lives
  // next to the DB. If a user upgrades into this build, copy the old key over
  // first so their existing logins still decrypt.
  const legacyPath = resolve(process.cwd(), 'data', '.app_secret');
  if (legacyPath !== path && existsSync(legacyPath)) {
    const raw = readFileSync(legacyPath, 'utf8').trim();
    const key = Buffer.from(raw, 'base64');
    if (key.length === KEY_LEN) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, raw, { mode: 0o600 });
      cachedKey = key;
      return key;
    }
  }

  mkdirSync(dirname(path), { recursive: true });
  const fresh = randomBytes(KEY_LEN);
  writeFileSync(path, fresh.toString('base64'), { mode: 0o600 });
  cachedKey = fresh;
  return fresh;
}

/**
 * Derive the per-row encryption key. We salt scrypt with a fixed string so
 * the same app secret always yields the same key — that means one wrong-cookie
 * write doesn't invalidate the whole row, and rotation is a simple re-encrypt.
 */
function deriveKey(): Buffer {
  const secret = loadOrCreateAppSecret();
  return scryptSync(secret, 'unfck-bandcamp-cookies-v1', KEY_LEN);
}

export function encryptSecret(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return (
    PREFIX +
    iv.toString('base64') +
    ':' +
    tag.toString('base64') +
    ':' +
    ct.toString('base64')
  );
}

/**
 * Decrypt a stored cookie string. Backwards-compatible: anything that does
 * not start with the version prefix is returned as-is so old plain-text
 * rows keep working until the next save() re-encrypts them.
 */
export function decryptSecret(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored;
  const rest = stored.slice(PREFIX.length);
  const parts = rest.split(':');
  if (parts.length !== 3) {
    throw new Error('encrypted secret is malformed');
  }
  const iv = Buffer.from(parts[0], 'base64');
  const tag = Buffer.from(parts[1], 'base64');
  const ct = Buffer.from(parts[2], 'base64');
  if (iv.length !== IV_LEN || tag.length !== TAG_LEN) {
    throw new Error('encrypted secret has wrong IV or tag length');
  }
  const key = deriveKey();
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

export function isEncryptedSecret(stored: string): boolean {
  return stored.startsWith(PREFIX);
}
