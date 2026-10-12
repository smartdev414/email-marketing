import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * AES-256-GCM for secrets we must be able to read back, such as SMTP mailbox
 * passwords. The key comes from AUTH_SECRET, so rotating that secret means
 * reconnecting those mailboxes.
 */

const VERSION = "v1";

function key() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return createHash("sha256").update(`mailbox-secret:${secret}`).digest();
}

export function encryptSecret(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), data]
    .map((part) => (typeof part === "string" ? part : part.toString("base64")))
    .join(":");
}

/** Null when the value is missing, malformed or was sealed with another key. */
export function decryptSecret(sealed: string | null | undefined) {
  const [version, iv, tag, data] = sealed?.split(":") ?? [];
  if (version !== VERSION || !iv || !tag || !data) return null;

  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    const plain = Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]);
    return plain.toString("utf8");
  } catch {
    return null;
  }
}
