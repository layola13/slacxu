import { createHmac } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { AuthStore } from "../../apps/server/src/authStore";

const JWT_SECRET = "renewal-test-secret";
const EXPIRE_HOURS = 24;

async function authStore() {
  const database = new Database(":memory:");
  const store = new AuthStore({ connection: database } as never, {
    jwtSecret: JWT_SECRET,
    adminEmail: "admin@example.com",
    adminPassword: "ChangeMe123!",
    tokenExpireHours: EXPIRE_HOURS,
    membersRoot: mkdtempSync(join(tmpdir(), "codex-auth-renewal-"))
  });
  await store.initialize();
  return { store, database };
}

/** Mirrors the wire format of AuthStore.signJwt so a lifetime can be chosen. */
function signToken(payload: Record<string, unknown>, secret = JWT_SECRET): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}`;
  return `${unsigned}.${createHmac("sha256", secret).update(unsigned).digest("base64url")}`;
}

function claimsFor(user: { id: string; email: string; role: string }, ageHours: number) {
  const now = Math.floor(Date.now() / 1000);
  const issuedAt = now - Math.round(ageHours * 3600);
  return {
    sub: user.id,
    email: user.email,
    role: user.role,
    sid: "test-session",
    iat: issuedAt,
    exp: issuedAt + EXPIRE_HOURS * 3600
  };
}

test("a session past half its lifetime is rotated instead of expiring under a running app", async () => {
  const { store, database } = await authStore();
  const admin = store.listUsers().find((user) => user.role === "admin")!;

  // A session issued moments ago is left alone: rotating on every poll would
  // churn tokens without buying the user anything.
  const fresh = store.issueSessionForUser(admin.id);
  expect(store.renewIfExpiring(fresh.token)).toBeNull();
  expect(store.renewIfExpiring(signToken(claimsFor(admin, 1)))).toBeNull();
  expect(store.renewIfExpiring(signToken(claimsFor(admin, 11)))).toBeNull();

  const aging = signToken(claimsFor(admin, 20));
  const renewed = store.renewIfExpiring(aging);
  expect(renewed).not.toBeNull();
  expect(renewed!.token).not.toBe(aging);
  expect(renewed!.user.id).toBe(admin.id);
  expect(renewed!.expiresAt).toBeGreaterThan(Date.now() + (EXPIRE_HOURS - 1) * 3600_000);
  expect((await store.getUserByToken(renewed!.token))?.id).toBe(admin.id);

  database.close();
});

test("renewal refuses anything that is not a live session of an active member", async () => {
  const { store, database } = await authStore();
  const admin = store.listUsers().find((user) => user.role === "admin")!;

  expect(store.renewIfExpiring(null)).toBeNull();
  expect(store.renewIfExpiring("")).toBeNull();
  expect(store.renewIfExpiring("not-a-jwt")).toBeNull();
  // Already expired: the member has to sign in again rather than trade a dead
  // token for a live one.
  expect(store.renewIfExpiring(signToken(claimsFor(admin, EXPIRE_HOURS + 1)))).toBeNull();
  // Signed with the wrong secret — the shape is right, the signature is not.
  expect(store.renewIfExpiring(signToken(claimsFor(admin, 20), "other-secret"))).toBeNull();

  const member = await store.createUser({ email: "member@example.com", password: "MemberPass123!" });
  const memberToken = signToken(claimsFor(member, 20));
  expect(store.renewIfExpiring(memberToken)).not.toBeNull();
  await store.updateUser(member.id, { status: "disabled" });
  expect(store.renewIfExpiring(memberToken)).toBeNull();

  database.close();
});
