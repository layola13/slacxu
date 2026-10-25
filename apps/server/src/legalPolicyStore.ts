import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RuntimeDatabase } from "./runtime/database.js";
import type {
  LegalConsentStatus,
  LegalPolicyBundle,
  LegalPolicyDocument,
  LegalPolicyLanguage
} from "@codex-ui/shared";
import { LocalDatabase } from "./localDatabase.js";

// Acceptance is explicit through the UI checkbox. The old mandatory 30-second
// timer made the compact confirmation dialog appear unresponsive and rejected
// an otherwise valid confirmation click.
const MIN_READ_SECONDS = 0;
const POLICY_CACHE_TTL_MS = 5_000;
function resolveLegalDir(): string {
  const envDir = process.env.CODEX_UI_LEGAL_DIR?.trim();
  if (envDir && existsSync(envDir)) return resolve(envDir);
  const base = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(base, "legal"),
    join(base, "..", "legal"),
    join(base, ".."),
    join(base, "..", "..", ".."),
    process.cwd(),
    join(process.cwd(), "legal"),
  ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "PRIVACY.md"))) {
      return resolve(candidate);
    }
  }
  return envDir ? resolve(envDir) : resolve(base, "../../..");
}

const DOCUMENTS: Array<{
  id: LegalPolicyDocument["id"];
  titleCn: string;
  titleEn: string;
  cn: string;
  en: string;
  versioned?: boolean;
}> = [
  { id: "privacy", titleCn: "隐私政策", titleEn: "Privacy Policy", cn: "PRIVACY.md", en: "PRIVACY_EN.md" },
  { id: "terms", titleCn: "服务条款与免责声明", titleEn: "Terms of Service & Disclaimer", cn: "TERMS.md", en: "TERMS_EN.md" },
  { id: "license", titleCn: "开源与商业许可协议", titleEn: "License & Commercial Policy", cn: "LICENSE", en: "LICENSE" },
  { id: "thirdParty", titleCn: "第三方开源库清单", titleEn: "Third-Party Components", cn: "THIRD_PARTY_LICENSES.md", en: "THIRD_PARTY_LICENSES_EN.md" },
  { id: "legal", titleCn: "综合法律协议", titleEn: "Merged Agreement", cn: "LEGAL.md", en: "LEGAL_EN.md" }
];

type AcceptanceRow = {
  accepted_at: number;
  language: LegalPolicyLanguage;
};

type ReviewRow = {
  started_at: number;
};

type CurrentPolicy = Omit<LegalPolicyBundle, "minReadSeconds" | "reviewStartedAt" | "serverNow">;

let policyCache: { expiresAt: number; cn: CurrentPolicy; en: CurrentPolicy } | null = null;

export class LegalPolicyStore {
  private readonly db: RuntimeDatabase;

  public constructor(database: Pick<LocalDatabase, "connection"> = new LocalDatabase()) {
    this.db = database.connection;
  }

  public initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS legal_policy_reviews (
        user_id TEXT NOT NULL,
        policy_version TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        last_opened_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, policy_version)
      );
      CREATE TABLE IF NOT EXISTS legal_policy_acceptances (
        user_id TEXT NOT NULL,
        policy_version TEXT NOT NULL,
        language TEXT NOT NULL CHECK (language IN ('cn', 'en')),
        accepted_at INTEGER NOT NULL,
        read_seconds INTEGER NOT NULL,
        PRIMARY KEY (user_id, policy_version)
      );
      CREATE INDEX IF NOT EXISTS legal_policy_acceptances_user_idx
        ON legal_policy_acceptances (user_id, accepted_at DESC);
    `);
  }

  public status(userId: string): LegalConsentStatus {
    const policy = readCurrentPolicy("cn");
    const accepted = this.db
      .prepare(`SELECT accepted_at, language FROM legal_policy_acceptances WHERE user_id = ? ORDER BY accepted_at DESC LIMIT 1`)
      .get(userId) as AcceptanceRow | undefined;
    return {
      required: !accepted,
      version: policy.version,
      minReadSeconds: MIN_READ_SECONDS,
      acceptedAt: accepted?.accepted_at,
      language: accepted?.language
    };
  }

  public open(userId: string, language: LegalPolicyLanguage): LegalPolicyBundle {
    const policy = readCurrentPolicy(language);
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO legal_policy_reviews (user_id, policy_version, started_at, last_opened_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, policy_version) DO UPDATE SET last_opened_at = excluded.last_opened_at
    `).run(userId, policy.version, now, now);
    const review = this.db
      .prepare(`SELECT started_at FROM legal_policy_reviews WHERE user_id = ? AND policy_version = ? LIMIT 1`)
      .get(userId, policy.version) as ReviewRow | undefined;
    return {
      ...policy,
      minReadSeconds: MIN_READ_SECONDS,
      reviewStartedAt: review?.started_at ?? now,
      serverNow: now
    };
  }

  public accept(userId: string, version: string, language: LegalPolicyLanguage): LegalConsentStatus {
    const policy = readCurrentPolicy(language);
    if (version !== policy.version) {
      throw new Error("The legal policy changed. Reopen it and review the latest version.");
    }
    const review = this.db
      .prepare(`SELECT started_at FROM legal_policy_reviews WHERE user_id = ? AND policy_version = ? LIMIT 1`)
      .get(userId, version) as ReviewRow | undefined;
    if (!review) {
      throw new Error("Open the legal policy before accepting it.");
    }
    const now = Date.now();
    const readSeconds = Math.floor((now - review.started_at) / 1000);
    if (readSeconds < MIN_READ_SECONDS) {
      throw new Error(`Please continue reading for ${MIN_READ_SECONDS - readSeconds} seconds.`);
    }
    this.db.prepare(`
      INSERT INTO legal_policy_acceptances (user_id, policy_version, language, accepted_at, read_seconds)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, policy_version) DO UPDATE SET
        language = excluded.language,
        accepted_at = excluded.accepted_at,
        read_seconds = excluded.read_seconds
    `).run(userId, version, language, now, readSeconds);
    return this.status(userId);
  }
}

function readCurrentPolicy(language: LegalPolicyLanguage): CurrentPolicy {
  const now = Date.now();
  if (!policyCache || policyCache.expiresAt <= now) {
    policyCache = { ...buildPolicySnapshot(), expiresAt: now + POLICY_CACHE_TTL_MS };
  }
  return policyCache[language];
}

function buildPolicySnapshot(): { cn: CurrentPolicy; en: CurrentPolicy } {
  const sources = new Map<string, { content: string; modifiedAt: number }>();
  for (const document of DOCUMENTS) {
    for (const file of new Set([document.cn, document.en])) {
      if (sources.has(file)) continue;
      const path = resolve(resolveLegalDir(), file);
      if (!existsSync(path)) {
        // fallback handled below
      }
      if (existsSync(path)) {
        try {
          sources.set(file, { content: readFileSync(path, "utf8"), modifiedAt: statSync(path).mtimeMs });
        } catch {
        }
      }
      if (!sources.has(file)) {
        sources.set(file, {
          content: `# ${file}\n\nCodex Ultra legal notice.\nBy using this workbench, you agree to comply with applicable terms, privacy policies, and local regulations.`,
          modifiedAt: 1
        });
      }
    }
  }

  const hash = createHash("sha256");
  const versionedFiles = new Set<string>();
  for (const document of DOCUMENTS) {
    if (document.versioned === false) continue;
    for (const file of new Set([document.cn, document.en])) {
      if (versionedFiles.has(file)) continue;
      versionedFiles.add(file);
      hash.update(file);
      hash.update("\0");
      hash.update(sources.get(file)?.content ?? "");
    }
  }
  const version = hash.digest("hex").slice(0, 20);
  const updatedAt = Math.max(...Array.from(sources.values(), (source) => source.modifiedAt));
  const createPolicy = (language: LegalPolicyLanguage): CurrentPolicy => ({
    version,
    language,
    updatedAt,
    documents: DOCUMENTS.map((document) => {
      const file = language === "cn" ? document.cn : document.en;
      return {
        id: document.id,
        title: language === "cn" ? document.titleCn : document.titleEn,
        file,
        content: sources.get(file)?.content ?? ""
      } satisfies LegalPolicyDocument;
    })
  });
  return {
    cn: createPolicy("cn"),
    en: createPolicy("en")
  };
}
