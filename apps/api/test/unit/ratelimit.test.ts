import { describe, expect, test } from "bun:test";
import { MemoryRateLimiter, rateLimitHeaders, type RateCategory } from "../../src/lib/ratelimit";

describe("MemoryRateLimiter", () => {
  test("deixa passar até o limite e barra o seguinte", async () => {
    const rl = new MemoryRateLimiter(3);
    expect(await rl.isLimited(1, "error")).toBe(false);
    expect(await rl.isLimited(1, "error")).toBe(false);
    expect(await rl.isLimited(1, "error")).toBe(false);
    expect(await rl.isLimited(1, "error")).toBe(true);
  });

  test("buckets são separados por categoria e por projeto", async () => {
    const rl = new MemoryRateLimiter(1);
    expect(await rl.isLimited(1, "error")).toBe(false);
    // outra categoria no mesmo projeto: não é limitada
    expect(await rl.isLimited(1, "transaction")).toBe(false);
    // mesmo projeto limitado em error, outro projeto não
    expect(await rl.isLimited(2, "error")).toBe(false);
    expect(await rl.isLimited(1, "error")).toBe(true);
  });

  test("janela deslizante expira após 60s", async () => {
    let fakeNow = 1_000_000;
    const rl = new MemoryRateLimiter(2, () => fakeNow);
    expect(await rl.isLimited(1, "error")).toBe(false);
    expect(await rl.isLimited(1, "error")).toBe(false);
    expect(await rl.isLimited(1, "error")).toBe(true);

    // 61s depois: a janela passou e o bucket volta a aceitar
    fakeNow += 61_000;
    expect(await rl.isLimited(1, "error")).toBe(false);
  });
});

describe("rateLimitHeaders", () => {
  test("formata no padrão do Sentry: retry:category:scope", () => {
    const cats: RateCategory[] = ["error", "transaction"];
    expect(rateLimitHeaders(cats)).toBe("60000:error:project;60000:transaction:project");
  });
});
