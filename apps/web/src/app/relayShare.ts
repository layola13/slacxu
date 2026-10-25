import type { ProviderConfig } from "@codex-ui/shared";

export const RELAY_SHARE_PREFIX = "cxu-niumao-";
const SHARE_SCHEMA = "codex-ultra.relay-share.v1";
const PBKDF2_ITERATIONS = 150_000;
const BASE91_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&'()*+,/:;<=>?@[\\]^_`{|}~";

export type RelaySharePayload = {
  schema: typeof SHARE_SCHEMA;
  provider: ProviderConfig;
};

export function isRelayShareText(value: string): boolean {
  const text = value.trim();
  return text.startsWith(RELAY_SHARE_PREFIX) && text.length >= RELAY_SHARE_PREFIX.length + 8;
}

export function validateRelaySharePasswords(password: string, confirmation: string): string | null {
  const secret = password.trim();
  if (!secret) return "分享密码不能为空";
  if (secret !== confirmation.trim()) return "两次输入的分享密码不一致";
  return null;
}

export async function encryptRelayShare(provider: ProviderConfig, password: string): Promise<string> {
  const secret = password.trim();
  if (!secret) throw new Error("分享密码不能为空");
  const payload: RelaySharePayload = { schema: SHARE_SCHEMA, provider };
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  const compressed = typeof CompressionStream === "undefined" ? encoded : await compress(encoded);
  const compressionFlag = typeof CompressionStream === "undefined" ? 0 : 1;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(secret, salt);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, compressed as unknown as BufferSource));
  const packed = new Uint8Array(1 + salt.length + iv.length + ciphertext.length);
  packed[0] = compressionFlag;
  packed.set(salt, 1);
  packed.set(iv, 1 + salt.length);
  packed.set(ciphertext, 1 + salt.length + iv.length);
  return RELAY_SHARE_PREFIX + encodeBase91(packed);
}

export async function decryptRelayShare(value: string, password: string): Promise<ProviderConfig> {
  const text = value.trim();
  if (!text.startsWith(RELAY_SHARE_PREFIX)) throw new Error("不是 Codex Ultra 分享内容");
  const packed = decodeBase91(text.slice(RELAY_SHARE_PREFIX.length));
  if (packed.length < 1 + 16 + 12 + 16) throw new Error("分享内容格式无效");
  const compressionFlag = packed[0];
  if (compressionFlag !== 0 && compressionFlag !== 1) throw new Error("分享内容格式无效");
  const salt = packed.slice(1, 17);
  const iv = packed.slice(17, 29);
  const ciphertext = packed.slice(29);
  try {
    const key = await deriveKey(password.trim(), salt);
    const compressed = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext));
    const decoded = compressionFlag === 1 ? await decompress(compressed) : compressed;
    const record = JSON.parse(new TextDecoder().decode(decoded)) as Partial<RelaySharePayload>;
    if (record.schema !== SHARE_SCHEMA || !record.provider || typeof record.provider !== "object") throw new Error("分享内容格式无效");
    return record.provider as ProviderConfig;
  } catch {
    throw new Error("分享内容或密码无效");
  }
}

function encodeBase91(bytes: Uint8Array): string {
  let output = "";
  let accumulator = 0;
  let bits = 0;
  for (const byte of bytes) {
    accumulator |= byte << bits;
    bits += 8;
    if (bits > 13) {
      const value = accumulator & 8191;
      if (value > 88) {
      output += BASE91_ALPHABET[value % 91]! + BASE91_ALPHABET[Math.floor(value / 91)]!;
        accumulator >>= 13;
        bits -= 13;
      } else {
        const value15 = accumulator & 16383;
        output += BASE91_ALPHABET[value15 % 91]! + BASE91_ALPHABET[Math.floor(value15 / 91)]!;
        accumulator >>= 14;
        bits -= 14;
      }
    }
  }
  if (bits > 0) {
    output += BASE91_ALPHABET[accumulator % 91]!;
    if (bits > 7 || accumulator > 90) output += BASE91_ALPHABET[Math.floor(accumulator / 91)]!;
  }
  return output;
}

function decodeBase91(text: string): Uint8Array {
  const values = new Map([...BASE91_ALPHABET].map((char, index) => [char, index]));
  const output: number[] = [];
  let accumulator = 0;
  let bits = 0;
  let pending = -1;
  for (const char of text) {
    const value = values.get(char);
    if (value == null) throw new Error("分享内容格式无效");
    if (pending < 0) pending = value;
    else {
      const combined = pending + value * 91;
      accumulator |= combined << bits;
      bits += (combined & 8191) > 88 ? 13 : 14;
      while (bits >= 8) {
        output.push(accumulator & 255);
        accumulator >>= 8;
        bits -= 8;
      }
      pending = -1;
    }
  }
  if (pending >= 0) {
    accumulator |= pending << bits;
    bits += 7;
    while (bits >= 8) {
      output.push(accumulator & 255);
      accumulator >>= 8;
      bits -= 8;
    }
  }
  return new Uint8Array(output);
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  if (!password) throw new Error("分享密码不能为空");
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: salt as unknown as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function compress(input: Uint8Array): Promise<Uint8Array> {
  const stream = new CompressionStream("deflate-raw");
  const writer = stream.writable.getWriter();
  const output = new Response(stream.readable).arrayBuffer();
  await writer.write(input as unknown as BufferSource);
  await writer.close();
  return new Uint8Array(await output);
}

async function decompress(input: Uint8Array): Promise<Uint8Array> {
  const stream = new DecompressionStream("deflate-raw");
  const writer = stream.writable.getWriter();
  const output = new Response(stream.readable).arrayBuffer();
  await writer.write(input as unknown as BufferSource);
  await writer.close();
  return new Uint8Array(await output);
}
