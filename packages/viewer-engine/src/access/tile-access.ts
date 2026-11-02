export type MintedAccess = {
  readonly token: string;
  readonly lifetimeSeconds: number;
};

export type Mint = () => Promise<MintedAccess>;
export type Clock = () => number;
export type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

type Held = {
  readonly token: string;
  readonly refreshAt: number;
  readonly staleAt: number;
};

export const REFRESH_SHARE = 0.5;
export const SAFETY_MS = 30_000;

export class TileAccess {
  private held: Held | null = null;
  private pending: Promise<Held> | null = null;
  private readonly mint: Mint;
  private readonly now: Clock;

  constructor(mint: Mint, now: Clock = Date.now) {
    this.mint = mint;
    this.now = now;
  }

  async token(): Promise<string> {
    const held = this.held;
    const now = this.now();
    if (held === null || now >= held.staleAt) {
      return (await this.refresh()).token;
    }
    if (now >= held.refreshAt) {
      this.refresh().catch(() => undefined);
    }
    return held.token;
  }

  async fetch(input: string, init: RequestInit = {}, fetcher: Fetcher = fetch): Promise<Response> {
    const first = await fetcher(input, withToken(init, await this.token()));
    if (first.status !== 401) {
      return first;
    }
    const fresh = await this.refresh();
    return fetcher(input, withToken(init, fresh.token));
  }

  private refresh(): Promise<Held> {
    if (this.pending === null) {
      this.pending = this.minted().finally(() => {
        this.pending = null;
      });
    }
    return this.pending;
  }

  private async minted(): Promise<Held> {
    const issuedAt = this.now();
    const access = await this.mint();
    const lifetimeMs = access.lifetimeSeconds * 1000;
    const held = {
      token: access.token,
      refreshAt: issuedAt + lifetimeMs * REFRESH_SHARE,
      staleAt: issuedAt + lifetimeMs - SAFETY_MS,
    };
    this.held = held;
    return held;
  }
}

function withToken(init: RequestInit, token: string): RequestInit {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return { ...init, headers };
}
