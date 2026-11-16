export const LOGINS_PER_WINDOW = 10;
export const LOGIN_WINDOW_MS = 60_000;

const RECENT = "recent";
const HIT_URL = "https://login-counter/hit";

export type LoginCounterEnv = {
  readonly LOGIN_COUNTER?: DurableObjectNamespace;
};

export type LoginDecision = { readonly allowed: boolean; readonly retryAfterSeconds: number };

export class LoginCounter {
  clock: () => number = () => Date.now();
  readonly ctx: DurableObjectState;

  constructor(ctx: DurableObjectState, _env: unknown) {
    this.ctx = ctx;
  }

  async fetch(_request: Request): Promise<Response> {
    return Response.json(await this.hit());
  }

  async hit(): Promise<LoginDecision> {
    const now = this.clock();
    const stored = (await this.ctx.storage.get<number[]>(RECENT)) ?? [];
    const recent = stored.filter((at) => now - at < LOGIN_WINDOW_MS);
    if (recent.length >= LOGINS_PER_WINDOW) {
      const oldest = recent[0] ?? now;
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + LOGIN_WINDOW_MS - now) / 1000));
      return { allowed: false, retryAfterSeconds };
    }
    recent.push(now);
    await this.ctx.storage.put(RECENT, recent);
    await this.ctx.storage.setAlarm(now + LOGIN_WINDOW_MS);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}

export async function countLogin(
  namespace: DurableObjectNamespace,
  address: string,
): Promise<LoginDecision> {
  const counter = namespace.get(namespace.idFromName(`login:${address}`));
  const answer = await counter.fetch(HIT_URL, { method: "POST" });
  return answer.json<LoginDecision>();
}
