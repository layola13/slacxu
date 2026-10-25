import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import QRCode from "qrcode";
import { createAdminSession, readAdminSession, verifyAdminPasswordHash } from "./adminAuth.js";
import { AdminCaptchaStore } from "./adminCaptcha.js";
import { decryptTotpSecret, encryptTotpSecret, generateTotpSecret, totpUri, verifyTotp } from "./adminTotp.js";
import { adminPageHtml } from "./adminPage.js";
import { loadConfig } from "./config.js";
import { constantTimeSecretMatches, handleDiscordInteraction, verifyDiscordRequest } from "./discord.js";
import { LicenseStore } from "./licenseStore.js";

const config = loadConfig();
const store = new LicenseStore(config);
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const captchaStore = new AdminCaptchaStore();
const totpEnrollments = new Map<string, { secret: string; username: string; address: string; expiresAt: number }>();

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
    if (request.method === "GET" && url.pathname === "/health") {
      return sendJson(response, 200, { ok: true, service: "codex-ultra-free-key", now: Date.now() });
    }
    if (url.pathname === "/admin" && request.method === "GET") return sendHtml(response, adminPageHtml());
    if (url.pathname === "/v1/admin/captcha" && request.method === "GET") {
      const challenge = captchaStore.create(clientAddress(request));
      return sendJson(response, 200, { data: challenge });
    }
    if (url.pathname === "/v1/admin/login" && request.method === "POST") {
      const body = parseObject(await readBody(request));
      const username = requiredText(body.username, "username");
      const password = requiredText(body.password, "password");
      const captchaId = requiredText(body.captchaId, "captchaId");
      const captchaAnswer = requiredText(body.captchaAnswer, "captchaAnswer");
      const address = clientAddress(request);
      if (!allowLogin(address)) return sendJson(response, 429, { error: "尝试次数过多，请 15 分钟后再试" });
      if (!captchaStore.consume(captchaId, captchaAnswer, address)) {
        return sendJson(response, 401, { error: "验证码错误或已过期" });
      }
      if (!verifyAdminPassword(username, password)) {
        return sendJson(response, 401, { error: "用户名或密码错误" });
      }
      const encryptedTotpSecret = store.adminTotpSecret();
      if (!encryptedTotpSecret) {
        const secret = generateTotpSecret();
        const enrollmentId = randomUUID();
        const expiresAt = Date.now() + 10 * 60_000;
        totpEnrollments.set(enrollmentId, { secret, username, address, expiresAt });
        const qrDataUrl = await QRCode.toDataURL(totpUri(secret, username), { width: 240, margin: 1, errorCorrectionLevel: "M" });
        return sendJson(response, 200, { data: { authenticated: false, requiresTotpSetup: true, enrollmentId, qrDataUrl, secret, expiresAt } });
      }
      const totp = requiredText(body.totp, "totp");
      if (!verifyTotp(decryptTotpSecret(encryptedTotpSecret, config.adminSessionSecret!), totp)) {
        return sendJson(response, 401, { error: "动态验证码错误" });
      }
      loginAttempts.delete(address);
      const cookie = createAdminSession(username, config.adminSessionSecret!);
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Set-Cookie": `free_key_admin=${cookie}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800` });
      return response.end(JSON.stringify({ data: { authenticated: true } }));
    }
    if (url.pathname === "/v1/admin/totp/confirm" && request.method === "POST") {
      const body = parseObject(await readBody(request));
      const enrollmentId = requiredText(body.enrollmentId, "enrollmentId");
      const totp = requiredText(body.totp, "totp");
      const enrollment = totpEnrollments.get(enrollmentId);
      totpEnrollments.delete(enrollmentId);
      const address = clientAddress(request);
      if (!enrollment || enrollment.expiresAt <= Date.now() || enrollment.address !== address) {
        return sendJson(response, 401, { error: "绑定请求已过期，请重新登录" });
      }
      if (store.adminTotpSecret()) return sendJson(response, 409, { error: "Google Authenticator 已绑定" });
      if (!verifyTotp(enrollment.secret, totp)) return sendJson(response, 401, { error: "动态验证码错误，请重新登录后绑定" });
      store.setAdminTotpSecret(encryptTotpSecret(enrollment.secret, config.adminSessionSecret!));
      store.recordAudit(enrollment.username, "bind_totp", {});
      loginAttempts.delete(address);
      const cookie = createAdminSession(enrollment.username, config.adminSessionSecret!);
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Set-Cookie": `free_key_admin=${cookie}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800` });
      return response.end(JSON.stringify({ data: { authenticated: true } }));
    }
    if (url.pathname === "/v1/admin/logout" && request.method === "POST") {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Set-Cookie": "free_key_admin=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0" });
      return response.end(JSON.stringify({ data: { authenticated: false } }));
    }
    if (url.pathname.startsWith("/v1/admin/console")) {
      const session = readSession(request);
      if (!session) return sendJson(response, 401, { error: "Unauthorized" });
      if (request.method === "GET" && url.pathname === "/v1/admin/console") return sendJson(response, 200, { data: { settings: store.getSettings(), licenses: store.listLicenses(url.searchParams.get("q") || "", Number(url.searchParams.get("limit") || 100)) } });
      if (request.method === "POST" && url.pathname === "/v1/admin/console/issue") {
        const body = parseObject(await readBody(request));
        const result = store.issueAdminLicense(requiredText(body.machineHash, "machineHash"), typeof body.discordUserId === "string" ? body.discordUserId : "admin", typeof body.validityDays === "number" ? body.validityDays : Number(body.validityDays));
        store.recordAudit(session.username, "issue_license", { machineHash: result.machineHash, expiresAt: result.expiresAt });
        return sendJson(response, 200, { data: result });
      }
      if (request.method === "POST" && url.pathname === "/v1/admin/console/revoke") {
        const body = parseObject(await readBody(request));
        return sendJson(response, 200, { data: { revoked: store.revokeLicense(requiredText(body.id, "id"), session.username) } });
      }
      if (request.method === "PUT" && url.pathname === "/v1/admin/console/settings") {
        const settings = store.updateSettings(parseObject(await readBody(request)));
        store.recordAudit(session.username, "update_settings", { keys: Object.keys(settings) });
        return sendJson(response, 200, { data: settings });
      }
      return sendJson(response, 404, { error: "Not found" });
    }
    if (request.method === "POST" && url.pathname === "/discord/interactions") {
      if (!config.discordPublicKey) return sendJson(response, 503, { error: "Discord integration is not configured" });
      const rawBody = await readBody(request);
      const signature = headerText(request, "x-signature-ed25519");
      const timestamp = headerText(request, "x-signature-timestamp");
      if (!signature || !timestamp || !verifyDiscordRequest(config.discordPublicKey, signature, timestamp, rawBody)) {
        return sendJson(response, 401, { error: "Invalid Discord signature" });
      }
      return sendJson(response, 200, handleDiscordInteraction(parseObject(rawBody), store, config));
    }
    if (url.pathname.startsWith("/v1/admin/")) {
      if (!constantTimeSecretMatches(config.adminSecret, bearerToken(request))) return sendJson(response, 401, { error: "Unauthorized" });
      if (request.method === "GET" && url.pathname === "/v1/admin/settings") return sendJson(response, 200, { data: store.getSettings() });
      if (request.method === "PUT" && url.pathname === "/v1/admin/settings") {
        return sendJson(response, 200, { data: store.updateSettings(parseObject(await readBody(request))) });
      }
      return sendJson(response, 404, { error: "Not found" });
    }
    if (url.pathname.startsWith("/v1/")) {
      if (config.clientSecret && !constantTimeSecretMatches(config.clientSecret, bearerToken(request))) {
        return sendJson(response, 401, { error: "Unauthorized" });
      }
      if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed" });
      const body = parseObject(await readBody(request));
      const machineHash = requiredText(body.machineHash, "machineHash");
      const key = typeof body.key === "string" ? body.key : null;
      if (url.pathname === "/v1/access/status") return sendJson(response, 200, { data: store.status(machineHash, key) });
      if (url.pathname === "/v1/access/requirement") return sendJson(response, 200, { data: store.createRequirement(machineHash) });
      if (url.pathname === "/v1/access/prepare") return sendJson(response, 200, { data: store.prepareRefresh(machineHash, key) });
      if (url.pathname === "/v1/access/complete") {
        const authorizationId = requiredText(body.authorizationId, "authorizationId");
        store.completeRefresh(
          machineHash,
          authorizationId,
          body.success === true,
          typeof body.importedModels === "number" ? body.importedModels : 0
        );
        return sendJson(response, 200, { data: { completed: true } });
      }
      return sendJson(response, 404, { error: "Not found" });
    }
    return sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    return sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`Codex Ultra free-key service listening on http://${config.host}:${config.port}`);
});

function bearerToken(request: IncomingMessage): string | undefined {
  const authorization = headerText(request, "authorization");
  return authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
}

function headerText(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function clientAddress(request: IncomingMessage): string {
  return headerText(request, "x-real-ip") || request.socket.remoteAddress || "unknown";
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 64 * 1024) throw new Error("Request body is too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function parseObject(body: Buffer): Record<string, unknown> {
  if (body.length === 0) return {};
  const parsed = JSON.parse(body.toString("utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("JSON object body is required");
  return parsed as Record<string, unknown>;
}

function requiredText(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(body));
}

function sendHtml(response: ServerResponse, body: string): void {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'" });
  response.end(body);
}

function allowLogin(address: string): boolean {
  const now = Date.now();
  const current = loginAttempts.get(address);
  if (!current || current.resetAt <= now) { loginAttempts.set(address, { count: 1, resetAt: now + 15 * 60_000 }); return true; }
  if (current.count >= 10) return false;
  current.count += 1;
  return true;
}

function verifyAdminPassword(username: string, password: string): boolean {
  if (!config.adminUsername || !config.adminPasswordHash || username !== config.adminUsername) return false;
  return verifyAdminPasswordHash(password, config.adminPasswordHash);
}

function readSession(request: IncomingMessage): { username: string } | null {
  const cookieHeader = headerText(request, "cookie") || "";
  const match = cookieHeader.match(/(?:^|;\s*)free_key_admin=([^;]+)/);
  if (!match) return null;
  return config.adminSessionSecret ? readAdminSession(match[1] || "", config.adminSessionSecret) : null;

}

function shutdown(): void {
  server.close(() => {
    store.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

