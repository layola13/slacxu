import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { PNG } from "pngjs";

const CAPTCHA_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

type CaptchaRecord = {
  answerHash: Buffer;
  address: string;
  expiresAt: number;
};

export type CaptchaChallenge = {
  captchaId: string;
  imageDataUrl: string;
  expiresAt: number;
};

export class AdminCaptchaStore {
  private readonly records = new Map<string, CaptchaRecord>();

  public create(address: string, now = Date.now()): CaptchaChallenge {
    this.prune(now);
    const answer = randomAnswer(5);
    const captchaId = randomUUID();
    const expiresAt = now + 5 * 60_000;
    this.records.set(captchaId, { answerHash: hashAnswer(captchaId, answer), address, expiresAt });
    return { captchaId, imageDataUrl: renderCaptchaPng(answer), expiresAt };
  }

  public consume(captchaId: string, answer: string, address: string, now = Date.now()): boolean {
    const record = this.records.get(captchaId);
    this.records.delete(captchaId);
    if (!record || record.expiresAt <= now || record.address !== address) return false;
    const actual = hashAnswer(captchaId, answer.trim().toUpperCase());
    return actual.length === record.answerHash.length && timingSafeEqual(actual, record.answerHash);
  }

  private prune(now: number): void {
    for (const [id, record] of this.records) if (record.expiresAt <= now) this.records.delete(id);
    if (this.records.size <= 2_000) return;
    for (const id of this.records.keys()) {
      this.records.delete(id);
      if (this.records.size <= 1_500) break;
    }
  }
}

function randomAnswer(length: number): string {
  let result = "";
  while (result.length < length) {
    for (const byte of randomBytes(length)) {
      if (byte >= Math.floor(256 / CAPTCHA_ALPHABET.length) * CAPTCHA_ALPHABET.length) continue;
      result += CAPTCHA_ALPHABET[byte % CAPTCHA_ALPHABET.length];
      if (result.length === length) break;
    }
  }
  return result;
}

function hashAnswer(id: string, answer: string): Buffer {
  return createHash("sha256").update(id).update("\0").update(answer).digest();
}

function renderCaptchaPng(answer: string): string {
  const width = 210, height = 58;
  const png = new PNG({ width, height, colorType: 6 });
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) setPixel(png, x, y, 238, 242, 247);
  const noise = randomBytes(1_600);
  for (let index = 0; index < noise.length; index += 4) setPixel(png, noise[index]! % width, noise[index + 1]! % height, 130 + noise[index + 2]! % 100, 130 + noise[index + 3]! % 100, 170);
  [...answer].forEach((character, index) => drawGlyph(png, GLYPHS[character]!, 18 + index * 38 + randomBytes(1)[0]! % 5, 10 + randomBytes(1)[0]! % 5));
  return `data:image/png;base64,${PNG.sync.write(png).toString("base64")}`;
}

function drawGlyph(png: PNG, rows: string[], startX: number, startY: number): void {
  const scale = 6;
  rows.forEach((row, y) => [...row].forEach((pixel, x) => {
    if (pixel !== "1") return;
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) setPixel(png, startX + x * scale + dx, startY + y * scale + dy, 23, 32, 51);
  }));
}

function setPixel(png: PNG, x: number, y: number, red: number, green: number, blue: number): void {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const offset = (png.width * y + x) * 4;
  png.data[offset] = red; png.data[offset + 1] = green; png.data[offset + 2] = blue; png.data[offset + 3] = 255;
}

const GLYPHS: Record<string, string[]> = {
  A:["01110","10001","10001","11111","10001","10001","10001"],B:["11110","10001","10001","11110","10001","10001","11110"],C:["01111","10000","10000","10000","10000","10000","01111"],D:["11110","10001","10001","10001","10001","10001","11110"],E:["11111","10000","10000","11110","10000","10000","11111"],F:["11111","10000","10000","11110","10000","10000","10000"],G:["01111","10000","10000","10111","10001","10001","01111"],H:["10001","10001","10001","11111","10001","10001","10001"],J:["00111","00010","00010","00010","10010","10010","01100"],K:["10001","10010","10100","11000","10100","10010","10001"],L:["10000","10000","10000","10000","10000","10000","11111"],M:["10001","11011","10101","10101","10001","10001","10001"],N:["10001","11001","10101","10011","10001","10001","10001"],P:["11110","10001","10001","11110","10000","10000","10000"],Q:["01110","10001","10001","10001","10101","10010","01101"],R:["11110","10001","10001","11110","10100","10010","10001"],S:["01111","10000","10000","01110","00001","00001","11110"],T:["11111","00100","00100","00100","00100","00100","00100"],U:["10001","10001","10001","10001","10001","10001","01110"],V:["10001","10001","10001","10001","10001","01010","00100"],W:["10001","10001","10001","10101","10101","10101","01010"],X:["10001","10001","01010","00100","01010","10001","10001"],Y:["10001","10001","01010","00100","00100","00100","00100"],Z:["11111","00001","00010","00100","01000","10000","11111"],2:["01110","10001","00001","00010","00100","01000","11111"],3:["11110","00001","00001","01110","00001","00001","11110"],4:["00010","00110","01010","10010","11111","00010","00010"],5:["11111","10000","10000","11110","00001","00001","11110"],6:["01110","10000","10000","11110","10001","10001","01110"],7:["11111","00001","00010","00100","01000","01000","01000"],8:["01110","10001","10001","01110","10001","10001","01110"],9:["01110","10001","10001","01111","00001","00001","01110"]
};
