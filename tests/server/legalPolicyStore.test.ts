import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { LegalPolicyStore } from "../../apps/server/src/legalPolicyStore";

test("requires one review and keeps an earlier acceptance valid after policy changes", () => {
  const database = new Database(":memory:");
  const store = new LegalPolicyStore({ connection: database });
  store.initialize();

  const initial = store.status("first-user");
  expect(initial.required).toBe(true);

  const policyCn = store.open("first-user", "cn");
  const policyEn = store.open("first-user", "en");
  expect(policyCn.version).toBe(policyEn.version);
  expect(policyCn.documents).toHaveLength(5);
  expect(policyCn.documents.some((document) => document.id === "readme")).toBe(false);
  expect(policyCn.documents.find((document) => document.id === "terms")?.content).toContain("所在国家或地区");
  expect(store.accept("first-user", policyCn.version, "cn").required).toBe(false);

  database
    .prepare("INSERT INTO legal_policy_acceptances (user_id, policy_version, language, accepted_at, read_seconds) VALUES (?, ?, ?, ?, ?)")
    .run("returning-user", "older-policy-version", "en", Date.now() - 86_400_000, 30);
  expect(store.status("returning-user").required).toBe(false);

  database.close();
});
