import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateTotpSecret(byteLength = 20): string {
  return base32Encode(randomBytes(byteLength));
}

export function totpCode(secret: string, now = Date.now()): string {
  const counter = Math.floor(now / 30_000);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", base32Decode(secret)).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = ((digest[offset]! & 0x7f) << 24) | (digest[offset + 1]! << 16) | (digest[offset + 2]! << 8) | digest[offset + 3]!;
  return String(binary % 1_000_000).padStart(6, "0");
}

export function verifyTotp(secret: string, code: string, now = Date.now()): boolean {
  if (!/^\d{6}$/.test(code.trim())) return false;
  for (const offset of [-30_000, 0, 30_000]) if (totpCode(secret, now + offset) === code.trim()) return true;
  return false;
}

export function totpUri(secret: string, username: string, issuer = "Codex Ultra"): string {
  const label = `${issuer}:${username}`;
  return `otpauth://totp/${encodeURIComponent(label)}?secret=${encodeURIComponent(secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

export function encryptTotpSecret(secret: string, encryptionSecret: string): string {
  const key = createHash("sha256").update(encryptionSecret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(":");
}

export function decryptTotpSecret(encoded: string, encryptionSecret: string): string {
  const [version, ivText, tagText, ciphertextText] = encoded.split(":");
  if (version !== "v1" || !ivText || !tagText || !ciphertextText) throw new Error("Invalid encrypted TOTP secret");
  const key = createHash("sha256").update(encryptionSecret).digest();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextText, "base64url")), decipher.final()]).toString("utf8");
}

function base32Encode(input: Buffer): string {
  let bits = 0, value = 0, output = "";
  for (const byte of input) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(input: string): Buffer {
  let bits = 0, value = 0;
  const bytes: number[] = [];
  for (const character of input.toUpperCase().replace(/=+$/g, "")) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new Error("Invalid Base32 secret");
    value = (value << 5) | index; bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(bytes);
}
