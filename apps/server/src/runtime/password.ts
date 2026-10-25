import bcrypt from "bcryptjs";
import { isBunRuntime } from "./index.js";

export async function hashPassword(password: string): Promise<string> {
  if (isBunRuntime) {
    const bun = (globalThis as { Bun: { password: { hash(value: string, options: { algorithm: "bcrypt" }): Promise<string> } } }).Bun;
    return bun.password.hash(password, { algorithm: "bcrypt" });
  }
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (isBunRuntime) {
    const bun = (globalThis as { Bun: { password: { verify(value: string, digest: string): Promise<boolean> } } }).Bun;
    return bun.password.verify(password, hash);
  }
  return bcrypt.compare(password, hash);
}

