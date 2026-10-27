import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearLedger,
  computeReputationStatus,
  deletePenalty,
  formatAntibodyNotice,
  getReputationStatus,
  readLedgerEntries,
  recordPenalty,
  submitRedemption,
  checkAccountabilityWriteGate,
  type PenaltyRecord,
  type RewardRecord,
} from "../../apps/server/src/saVmAccountabilityLedger.js";
import { runSaVmTool } from "../../apps/server/src/saVmTool.js";

describe("SA-VM Accountability & Penalty/Reward Ledger with Autonomous JEV Gatekeeper", () => {
  let tempDir: string;
  let ledgerPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "sa-vm-accountability-test-"));
    ledgerPath = join(tempDir, ".codex-ultra", "ledger", "penalties.jsonl");
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore temp cleanup errors
    }
  });

  it("Simulation Step 1: Baseline reputation starts at 100 GREEN; penalties drop score and tier", async () => {
    // 1. Clean workspace starts at 100 GREEN
    const initial = await getReputationStatus(tempDir, ledgerPath);
    expect(initial.score).toBe(100);
    expect(initial.tier).toBe("GREEN");
    expect(initial.activePenalties).toHaveLength(0);
    expect(initial.totalPenaltiesCount).toBe(0);

    // 2. Model writes broken syntax in src/payment.ts -> record L1_SYNTAX penalty (-10)
    const pen1 = await recordPenalty({
      targetFile: "src/payment.ts",
      level: "L1_SYNTAX",
      errorSignature: "TS2304: Cannot find name 'transaction'",
      details: "Missing import in transaction handler",
      cwd: tempDir,
      customLedgerPath: ledgerPath,
    });

    expect(pen1.penalty.id).toMatch(/^pen_\d+_[a-f0-9]+$/);
    expect(pen1.penalty.scoreDelta).toBe(-10);
    expect(pen1.status.score).toBe(90);
    expect(pen1.status.tier).toBe("GREEN");
    expect(pen1.status.activePenalties).toHaveLength(1);

    // 3. Model introduces regression in src/auth.ts -> record L2_REGRESSION penalty (-20)
    const pen2 = await recordPenalty({
      targetFile: "src/auth.ts",
      level: "L2_REGRESSION",
      errorSignature: "AUTH_TOKEN_EXPIRED: Token validation regression in authMiddleware",
      details: "Broke backwards compatibility with v1 JWT",
      cwd: tempDir,
      customLedgerPath: ledgerPath,
    });

    expect(pen2.penalty.scoreDelta).toBe(-20);
    expect(pen2.status.score).toBe(70);
    expect(pen2.status.tier).toBe("YELLOW"); // Score 70 drops into YELLOW tier
    expect(pen2.status.activePenalties).toHaveLength(2);

    // 4. Immutability validation: penalties can NEVER be deleted
    expect(() => deletePenalty()).toThrow("Immutable Ledger Violation: Historical penalties cannot be deleted");
    expect(() => clearLedger()).toThrow("Immutable Ledger Violation: Clearing the accountability ledger is strictly forbidden");

    // Verify physical records exist in JSONL
    const rawLines = await readLedgerEntries(ledgerPath);
    expect(rawLines).toHaveLength(2);
    expect(rawLines[0].type).toBe("penalty");
    expect(rawLines[1].type).toBe("penalty");
  });

  it("Simulation Step 2: Severe thrashing drops reputation to RED; Autonomous JEV Gate intercepts without user questions", async () => {
    // Drop score to RED (< 50) with an L3_THRASH penalty (-30) and an L2 penalty (-20)
    await recordPenalty({
      targetFile: "src/payment.ts",
      level: "L1_SYNTAX",
      errorSignature: "TS2304: Cannot find name 'transaction'",
      scoreDelta: -10,
      cwd: tempDir,
      customLedgerPath: ledgerPath,
    });
    await recordPenalty({
      targetFile: "src/payment.ts",
      level: "L2_REGRESSION",
      errorSignature: "DOUBLE_SPEND_RISK: Race condition during checkout",
      scoreDelta: -20,
      cwd: tempDir,
      customLedgerPath: ledgerPath,
    });
    const thrashPen = await recordPenalty({
      targetFile: "src/payment.ts",
      level: "L3_THRASH",
      errorSignature: "CIRCULAR_RETRY: Model repeated same broken fix 3 times",
      scoreDelta: -30,
      cwd: tempDir,
      customLedgerPath: ledgerPath,
    });

    // Score is 100 - 10 - 20 - 30 = 40 (RED Tier)
    expect(thrashPen.status.score).toBe(40);
    expect(thrashPen.status.tier).toBe("RED");

    // Model now attempts to write bad code to src/payment.ts that repeats the broken pattern
    await mkdir(join(tempDir, "src"), { recursive: true });
    const testFile = join(tempDir, "src", "payment.ts");
    await writeFile(testFile, "// original clean file\n", "utf8");

    // Case A: Model tries to write code repeating the error signature -> Autonomous JEV blocks it!
    const blockedWrite = await runSaVmTool({
      action: "write_file",
      path: "src/payment.ts",
      content: "// Broken code containing CIRCULAR_RETRY: Model repeated same broken fix 3 times\n",
    }, { cwd: tempDir, policy: { accountability: { ledgerPath } } });

    // ZERO USER FRICTION: No ask_question was called. Blocked autonomously by JEV!
    expect(blockedWrite.ok).toBe(false);
    expect(blockedWrite.kind).toBe("capability_denied");
    expect(blockedWrite.exitCode).toBe(228);
    expect(blockedWrite.stderr).toContain("JEV HIGH-RISK GATEWAY REJECTION");
    expect(blockedWrite.stderr).toContain("RED tier scrutiny");
    expect(blockedWrite.stderr).toContain("CIRCULAR_RETRY");

    // Verify disk file was NOT modified!
    const diskContent = await readFile(testFile, "utf8");
    expect(diskContent).toBe("// original clean file\n");

    // Case B: Model tries empty write (data loss risk) -> Autonomous JEV blocks it!
    const emptyWrite = await runSaVmTool({
      action: "write_file",
      path: "src/payment.ts",
      content: "   ",
    }, { cwd: tempDir, policy: { accountability: { ledgerPath } } });
    expect(emptyWrite.ok).toBe(false);
    expect(emptyWrite.stderr).toContain("data_loss");

    // Case C: Developer manual takeover override bypasses JEV gate if explicitly supplied
    const manualWrite = await runSaVmTool({
      action: "write_file",
      path: "src/payment.ts",
      content: "// Developer emergency override hotfix\nexport const hotfix = true;\n",
      manualOverride: true,
    }, { cwd: tempDir, policy: { accountability: { ledgerPath } } });

    expect(manualWrite.ok).toBe(true);
    expect(manualWrite.stdout).toContain("[ACCOUNTABILITY MANUAL OVERRIDE]");
    const updatedContent = await readFile(testFile, "utf8");
    expect(updatedContent).toContain("Developer emergency override hotfix");
  });

  it("Simulation Step 3: Model improves, submits verified redemption; JEV verifies and restores score; past penalties permanently preserved", async () => {
    // Setup initial penalty
    const pen = await recordPenalty({
      targetFile: "src/db.ts",
      level: "L2_REGRESSION",
      errorSignature: "CONNECTION_LEAK: Unclosed connection in query loop",
      scoreDelta: -20,
      cwd: tempDir,
      customLedgerPath: ledgerPath,
    });
    expect(pen.status.score).toBe(80);

    // Record another penalty to reach Yellow tier
    const pen2 = await recordPenalty({
      targetFile: "src/db.ts",
      level: "L1_SYNTAX",
      errorSignature: "TS2345: Argument type mismatch in pool.acquire()",
      scoreDelta: -10,
      cwd: tempDir,
      customLedgerPath: ledgerPath,
    });
    expect(pen2.status.score).toBe(70);
    expect(pen2.status.tier).toBe("YELLOW");

    // 1. Attempt redemption with insufficient evidence -> JEV rejects
    const badRedemption1 = await submitRedemption({
      penaltyId: pen.penalty.id,
      verificationEvidence: "fixed it", // Too brief (<10 chars)
      lessonLearned: "be careful",
      antibodyRule: "do not leak",
      cwd: tempDir,
      customLedgerPath: ledgerPath,
    });
    expect(badRedemption1.ok).toBe(false);
    expect(badRedemption1.error).toContain("Evidence is too brief");

    const badRedemption2 = await submitRedemption({
      penaltyId: pen.penalty.id,
      verificationEvidence: "Attempted fix but ran into unexpected errors and failures without resolution",
      lessonLearned: "investigate deeper",
      antibodyRule: "do not rush",
      cwd: tempDir,
      customLedgerPath: ledgerPath,
    });
    expect(badRedemption2.ok).toBe(false);
    expect(badRedemption2.error).toContain("Evidence lacks confirmation");

    // 2. Submit high quality, verified redemption
    const goodRedemption = await submitRedemption({
      penaltyId: pen.penalty.id,
      verificationEvidence: "Executed bun test tests/db.test.ts: 18/18 tests passed, 0 connection leaks verified with pool.metrics().",
      lessonLearned: "Always wrap connection checkout in try/finally to ensure connection.release() is called under all exception paths.",
      antibodyRule: "Always release pool connections in finally block; never return early before release.",
      cwd: tempDir,
      customLedgerPath: ledgerPath,
    });

    expect(goodRedemption.ok).toBe(true);
    expect(goodRedemption.reward?.id).toMatch(/^rew_\d+_[a-f0-9]+$/);
    expect(goodRedemption.reward?.linkedPenaltyId).toBe(pen.penalty.id);
    expect(goodRedemption.restoredScore).toBe(20);

    // Score recovered: 70 + 20 = 90 (Tier: GREEN)!
    expect(goodRedemption.status.score).toBe(90);
    expect(goodRedemption.status.tier).toBe("GREEN");

    // 3. IMMUTABILITY CHECK:
    // The historical penalty entry was NEVER removed from the append-only ledger!
    const entries = await readLedgerEntries(ledgerPath);
    expect(entries).toHaveLength(3); // pen1, pen2, rew1

    const historicalPenalty = entries.find((e): e is PenaltyRecord => e.id === pen.penalty.id);
    expect(historicalPenalty).toBeDefined();
    expect(historicalPenalty?.errorSignature).toBe("CONNECTION_LEAK: Unclosed connection in query loop");

    // When status is recomputed from raw disk file:
    const reloaded = computeReputationStatus(entries, ledgerPath);
    expect(reloaded.redeemedPenalties).toHaveLength(1);
    expect(reloaded.redeemedPenalties[0].id).toBe(pen.penalty.id);
    expect(reloaded.redeemedPenalties[0].redeemedBy).toBe(goodRedemption.reward?.id);
    expect(reloaded.activePenalties).toHaveLength(1); // pen2 remains active
  });

  it("Simulation Step 4: Crystallized antibody rule provides active immunity on subsequent edits", async () => {
    // Setup penalty & successful redemption that crystallizes an antibody rule
    const pen = await recordPenalty({
      targetFile: "src/crypto.ts",
      level: "L2_REGRESSION",
      errorSignature: "INSECURE_RANDOM: Math.random used for token generation",
      scoreDelta: -20,
      cwd: tempDir,
      customLedgerPath: ledgerPath,
    });

    await submitRedemption({
      penaltyId: pen.penalty.id,
      verificationEvidence: "bun test tests/crypto.test.ts passed: verified crypto.randomBytes used for entropy.",
      lessonLearned: "Math.random is pseudo-random and predictable; cryptographic tokens require CSPRNG.",
      antibodyRule: "Do not Math.random for security tokens; always use crypto.randomBytes or crypto.getRandomValues.",
      cwd: tempDir,
      customLedgerPath: ledgerPath,
    });

    // Verify antibody is recorded
    const status = await getReputationStatus(tempDir, ledgerPath);
    expect(status.antibodies).toHaveLength(1);
    expect(status.antibodies[0].rule).toContain("Do not Math.random");

    const antibodyNotice = formatAntibodyNotice("src/crypto.ts", status);
    expect(antibodyNotice).toContain("ANTIBODY IMMUNITY ACTIVE");
    expect(antibodyNotice).toContain("Do not Math.random");

    // When editing src/crypto.ts, the antibody notice is appended to tool output
    await mkdir(join(tempDir, "src"), { recursive: true });
    const testFile = join(tempDir, "src", "crypto.ts");
    await writeFile(testFile, "export function generateToken() { return 'dummy'; }\n", "utf8");

    // Edit file with safe code
    const editResult = await runSaVmTool({
      action: "edit_file",
      path: "src/crypto.ts",
      old_text: "return 'dummy';",
      new_text: "return crypto.randomBytes(32).toString('hex');",
    }, { cwd: tempDir, policy: { accountability: { ledgerPath } } });

    expect(editResult.ok).toBe(true);
    expect(editResult.stdout).toContain("Successfully edited src/crypto.ts");
    expect(editResult.stdout).toContain("[ANTIBODY IMMUNITY ACTIVE: 1 rule(s) for src/crypto.ts]");
    expect(editResult.stdout).toContain("Do not Math.random for security tokens");
  });

  it("Simulation Step 5: Full action routing via sa_vm tool (ledger_status, record_penalty, submit_redemption, get_antibodies)", async () => {
    // 1. Check ledger_status via sa_vm
    const statusRes = await runSaVmTool({
      action: "ledger_status",
      ledger_path: ledgerPath,
    }, { cwd: tempDir });
    expect(statusRes.ok).toBe(true);
    const parsedStatus = JSON.parse(statusRes.stdout);
    expect(parsedStatus.score).toBe(100);
    expect(parsedStatus.tier).toBe("GREEN");
    expect(parsedStatus.summary).toContain("责任与信誉账本");

    // 2. Record penalty via sa_vm action
    const penRes = await runSaVmTool({
      action: "record_penalty",
      target: "src/worker.ts",
      level: "L1_SYNTAX",
      error_signature: "TS1005: ';' expected at line 50",
      details: "Typo in worker loop",
      ledger_path: ledgerPath,
    }, { cwd: tempDir });
    expect(penRes.ok).toBe(true);
    const parsedPen = JSON.parse(penRes.stdout);
    expect(parsedPen.action).toBe("record_penalty");
    expect(parsedPen.penalty.targetFile).toBe("src/worker.ts");
    expect(parsedPen.status.score).toBe(90);

    // 3. Submit redemption via sa_vm action
    const rewRes = await runSaVmTool({
      action: "submit_redemption",
      penalty_id: parsedPen.penalty.id,
      verification_evidence: "Fixed typo; ran tsc --noEmit with 0 errors clean output.",
      lesson_learned: "Always check syntax before staging commits.",
      antibody_rule: "Verify typescript compilation before saving changes to critical worker loops.",
      ledger_path: ledgerPath,
    }, { cwd: tempDir });
    expect(rewRes.ok).toBe(true);
    const parsedRew = JSON.parse(rewRes.stdout);
    expect(parsedRew.action).toBe("submit_redemption");
    expect(parsedRew.status.score).toBe(100);
    expect(parsedRew.summary).toContain("赎回成功");

    // 4. Query antibodies via sa_vm action
    const antiRes = await runSaVmTool({
      action: "get_antibodies",
      target: "src/worker.ts",
      ledger_path: ledgerPath,
    }, { cwd: tempDir });
    expect(antiRes.ok).toBe(true);
    const parsedAnti = JSON.parse(antiRes.stdout);
    expect(parsedAnti.action).toBe("get_antibodies");
    expect(parsedAnti.total).toBe(1);
    expect(parsedAnti.antibodies[0].rule).toContain("Verify typescript compilation");
  });

  it("Simulation Step 6: When accountability is disabled (default off), writes pass without JEV gatekeeping even with past penalties", async () => {
    // Record heavy penalties to drop score into RED
    await recordPenalty({
      targetFile: "src/critical.ts",
      level: "L3_THRASH",
      errorSignature: "INFINITE_LOOP_DEFECT",
      scoreDelta: -60,
      cwd: tempDir,
      customLedgerPath: ledgerPath,
    });

    const status = await getReputationStatus(tempDir, ledgerPath);
    expect(status.score).toBe(40);
    expect(status.tier).toBe("RED");

    // File on disk
    await mkdir(join(tempDir, "src"), { recursive: true });
    await writeFile(join(tempDir, "src", "critical.ts"), "// initial\n", "utf8");

    // With accountability.enabled: false (or unset in ordinary policy), write succeeds without gate rejection
    const resDisabled = await runSaVmTool({
      action: "write_file",
      path: "src/critical.ts",
      content: "// Contains INFINITE_LOOP_DEFECT but accountability is disabled\n",
    }, {
      cwd: tempDir,
      policy: {
        accountability: {
          enabled: false,
          ledgerPath,
        },
      },
    });

    expect(resDisabled.ok).toBe(true);
    expect(resDisabled.stderr).toBe("");
    const content = await readFile(join(tempDir, "src", "critical.ts"), "utf8");
    expect(content).toContain("Contains INFINITE_LOOP_DEFECT");
  });
});
