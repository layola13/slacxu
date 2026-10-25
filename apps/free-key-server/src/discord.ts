import { createPublicKey, timingSafeEqual, verify } from "node:crypto";
import type { FreeKeyServerConfig } from "./config.js";
import type { LicenseStore } from "./licenseStore.js";

const DISCORD_PUBLIC_KEY_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function verifyDiscordRequest(publicKeyHex: string, signatureHex: string, timestamp: string, body: Buffer): boolean {
  try {
    const rawKey = Buffer.from(publicKeyHex, "hex");
    const signature = Buffer.from(signatureHex, "hex");
    if (rawKey.length !== 32 || signature.length !== 64) return false;
    const publicKey = createPublicKey({
      key: Buffer.concat([DISCORD_PUBLIC_KEY_PREFIX, rawKey]),
      format: "der",
      type: "spki"
    });
    return verify(null, Buffer.concat([Buffer.from(timestamp), body]), publicKey, signature);
  } catch {
    return false;
  }
}

export function constantTimeSecretMatches(expected: string, actual: string | undefined): boolean {
  if (!actual) return false;
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

export function handleDiscordInteraction(input: Record<string, unknown>, store: LicenseStore, config: FreeKeyServerConfig): Record<string, unknown> {
  if (input.type === 1) return { type: 1 };
  if (input.type !== 2) return ephemeral("Unsupported Discord interaction");
  const channelId = typeof input.channel_id === "string" ? input.channel_id : "";
  if (config.discordChannelId && channelId !== config.discordChannelId) {
    return ephemeral("请在指定的 get-free-key 频道使用此命令。");
  }
  const data = objectValue(input.data);
  if (data.name !== "free-key") return ephemeral("Unsupported command");
  const options = Array.isArray(data.options) ? data.options.map(objectValue) : [];
  const required = options.find((option) => option.name === "required")?.value;
  const memberUser = objectValue(objectValue(input.member).user);
  const directUser = objectValue(input.user);
  const discordUserId = typeof memberUser.id === "string" ? memberUser.id : typeof directUser.id === "string" ? directUser.id : "";
  if (typeof required !== "string" || !discordUserId) return ephemeral("required 码或 Discord 用户信息缺失。");
  try {
    const license = store.issueLicense(required, discordUserId);
    return ephemeral([
      "你的 Codex Ultra 免费模型密钥：",
      `\`${license.key}\``,
      `有效期至：${new Date(license.expiresAt).toISOString()}`,
      "密钥仅绑定申请时的 Windows 机器，请勿公开分享。"
    ].join("\n"));
  } catch (error) {
    return ephemeral(error instanceof Error ? error.message : String(error));
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function ephemeral(content: string): Record<string, unknown> {
  return { type: 4, data: { content, flags: 64 } };
}
