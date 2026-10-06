/**
 * Limitador de tentativas FALHAS (anti brute force de senha/TOTP).
 * Conta só falhas: após `max` falhas na janela, a chave fica bloqueada até a
 * falha mais antiga sair da janela. Sucesso zera a chave.
 * Memória do processo (VPS); na Cloudflare vale por isolate — melhor que nada.
 */
export class FailureLimiter {
  private failures = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  private recent(key: string): number[] {
    const now = this.now();
    const list = (this.failures.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length) this.failures.set(key, list);
    else this.failures.delete(key);
    return list;
  }

  /** Segundos até poder tentar de novo (0 = liberado). */
  retryAfter(key: string): number {
    const list = this.recent(key);
    if (list.length < this.max) return 0;
    return Math.max(1, Math.ceil((list[0] + this.windowMs - this.now()) / 1000));
  }

  fail(key: string): void {
    const list = this.recent(key);
    list.push(this.now());
    this.failures.set(key, list);
  }

  reset(key: string): void {
    this.failures.delete(key);
  }
}

/** Login: 10 falhas por usuário a cada 15 min. */
export const loginLimiter = new FailureLimiter(10, 15 * 60_000);
/** Códigos TOTP (confirmar/desativar 2FA): 10 falhas por usuário a cada 15 min. */
export const totpLimiter = new FailureLimiter(10, 15 * 60_000);
