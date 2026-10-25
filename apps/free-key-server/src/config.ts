import { resolve } from "node:path";

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export type FreeKeyServerConfig = {
  host: string;
  port: number;
  databasePath: string;
  hashPepper: string;
  clientSecret: string | null;
  adminSecret: string;
  adminUsername?: string | null;
  adminPasswordHash?: string | null;
  adminSessionSecret?: string | null;
  defaultValidityDays: number;
  refreshIntervalHours: number;
  requiredTtlMinutes: number;
  discordInviteUrl: string;
  discordPublicKey: string | null;
  discordChannelId: string | null;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): FreeKeyServerConfig {
  const hashPepper = env.FREE_KEY_HASH_PEPPER?.trim();
  const adminSecret = env.FREE_KEY_ADMIN_SECRET?.trim();
  if (!hashPepper || hashPepper.length < 24) {
    throw new Error("FREE_KEY_HASH_PEPPER must contain at least 24 characters");
  }
  if (!adminSecret || adminSecret.length < 16) {
    throw new Error("FREE_KEY_ADMIN_SECRET must contain at least 16 characters");
  }
  const adminUsername = env.FREE_KEY_ADMIN_USERNAME?.trim() || null;
  const adminPasswordHash = env.FREE_KEY_ADMIN_PASSWORD_HASH?.trim() || null;
  const adminSessionSecret = env.FREE_KEY_ADMIN_SESSION_SECRET?.trim() || null;
  if ([adminUsername, adminPasswordHash, adminSessionSecret].some(Boolean) && ![adminUsername, adminPasswordHash, adminSessionSecret].every(Boolean)) {
    throw new Error("Web admin requires FREE_KEY_ADMIN_USERNAME, FREE_KEY_ADMIN_PASSWORD_HASH and FREE_KEY_ADMIN_SESSION_SECRET together");
  }
  if (adminSessionSecret && adminSessionSecret.length < 24) throw new Error("FREE_KEY_ADMIN_SESSION_SECRET must contain at least 24 characters");
  return {
    host: env.FREE_KEY_HOST?.trim() || "127.0.0.1",
    port: Math.floor(positiveNumber(env.FREE_KEY_PORT, 43_210)),
    databasePath: resolve(env.FREE_KEY_DATABASE?.trim() || "./data/free-keys.sqlite3"),
    hashPepper,
    clientSecret: env.FREE_KEY_CLIENT_SECRET?.trim() || null,
    adminSecret,
    adminUsername,
    adminPasswordHash,
    adminSessionSecret,
    defaultValidityDays: positiveNumber(env.FREE_KEY_DEFAULT_VALIDITY_DAYS, 1),
    refreshIntervalHours: positiveNumber(env.FREE_KEY_REFRESH_INTERVAL_HOURS, 5),
    requiredTtlMinutes: positiveNumber(env.FREE_KEY_REQUIRED_TTL_MINUTES, 15),
    discordInviteUrl: env.FREE_KEY_DISCORD_INVITE_URL?.trim() || "https://discord.gg/QCNUx8FaV",
    discordPublicKey: env.DISCORD_PUBLIC_KEY?.trim() || null,
    discordChannelId: env.DISCORD_FREE_KEY_CHANNEL_ID?.trim() || null
  };
}
