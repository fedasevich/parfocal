export const ROOM_PROTOCOL = "parfocal-room-v1";
export const FIRST_RETRY_MS = 500;
export const MAX_RETRY_MS = 30_000;
export const RENEW_RETRY_MS = 5000;

export type RoomTicket = { readonly token: string; readonly lifetimeSeconds: number };

export type RoomMessage = { readonly kind: string; readonly ids: Readonly<Record<string, string>> };

export type RoomSignal = { readonly type: string } & Readonly<Record<string, unknown>>;

export type SocketLike = {
  onopen: (() => void) | null;
  onmessage: ((message: { data: unknown }) => void) | null;
  onclose: ((close: { code: number }) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
};

export type Timers = {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
};

export type RoomClientOptions = {
  readonly url: string;
  readonly ticket: () => Promise<RoomTicket | null>;
  readonly open: (url: string, protocols: string[]) => SocketLike;
  readonly refetch: () => Promise<void> | void;
  readonly onEvent: (event: RoomMessage) => void;
  readonly onSignal?: (signal: RoomSignal) => void;
  readonly onEnded?: (reason: "no-access") => void;
  readonly timers?: Timers;
};

const realTimers: Timers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function retryDelay(attempt: number): number {
  return Math.min(FIRST_RETRY_MS * 2 ** attempt, MAX_RETRY_MS);
}

function frameOf(data: unknown): Record<string, unknown> | null {
  if (typeof data !== "string") {
    return null;
  }
  try {
    const frame: unknown = JSON.parse(data);
    return typeof frame === "object" && frame !== null ? (frame as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function messageOf(frame: Record<string, unknown>): RoomMessage | null {
  if (frame.type !== "event" || typeof frame.kind !== "string") {
    return null;
  }
  return { kind: frame.kind, ids: (frame.ids ?? {}) as Record<string, string> };
}

const SERVER_FRAMES = new Set(["event", "pong", "renewed"]);

export class RoomClient {
  private readonly options: RoomClientOptions;
  private readonly timers: Timers;
  private socket: SocketLike | null = null;
  private timer: unknown = null;
  private attempt = 0;
  private stopped = false;
  private opened = false;

  constructor(options: RoomClientOptions) {
    this.options = options;
    this.timers = options.timers ?? realTimers;
  }

  start(): void {
    this.stopped = false;
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimer();
    this.socket?.close(1000, "left");
    this.socket = null;
  }

  send(signal: RoomSignal): boolean {
    if (this.socket === null || !this.opened) {
      return false;
    }
    this.socket.send(JSON.stringify(signal));
    return true;
  }

  private async connect(): Promise<void> {
    let ticket: RoomTicket | null;
    try {
      ticket = await this.options.ticket();
    } catch {
      this.retry();
      return;
    }
    if (this.stopped) {
      return;
    }
    if (ticket === null) {
      this.end();
      return;
    }
    const socket = this.options.open(this.options.url, [ROOM_PROTOCOL, ticket.token]);
    this.socket = socket;
    this.opened = false;
    socket.onopen = () => {
      this.opened = true;
      this.attempt = 0;
      this.scheduleRenew(ticket.lifetimeSeconds);
      void this.options.refetch();
    };
    socket.onmessage = ({ data }) => {
      const frame = frameOf(data);
      if (frame === null) {
        return;
      }
      const event = messageOf(frame);
      if (event !== null) {
        this.options.onEvent(event);
      } else if (typeof frame.type === "string" && !SERVER_FRAMES.has(frame.type)) {
        this.options.onSignal?.(frame as RoomSignal);
      }
    };
    socket.onclose = () => {
      if (this.socket !== socket) {
        return;
      }
      this.socket = null;
      this.clearTimer();
      this.retry();
    };
  }

  private retry(): void {
    if (this.stopped) {
      return;
    }
    const delay = retryDelay(this.attempt);
    this.attempt += 1;
    this.clearTimer();
    this.timer = this.timers.set(() => void this.connect(), delay);
  }

  private scheduleRenew(lifetimeSeconds: number): void {
    this.clearTimer();
    this.timer = this.timers.set(() => void this.renew(), (lifetimeSeconds * 1000) / 2);
  }

  private async renew(): Promise<void> {
    const socket = this.socket;
    let ticket: RoomTicket | null;
    try {
      ticket = await this.options.ticket();
    } catch {
      this.clearTimer();
      this.timer = this.timers.set(() => void this.renew(), RENEW_RETRY_MS);
      return;
    }
    if (this.stopped || socket === null || this.socket !== socket) {
      return;
    }
    if (ticket === null) {
      this.end();
      return;
    }
    socket.send(JSON.stringify({ type: "renew", token: ticket.token }));
    this.scheduleRenew(ticket.lifetimeSeconds);
  }

  private end(): void {
    this.stop();
    this.options.onEnded?.("no-access");
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      this.timers.clear(this.timer);
      this.timer = null;
    }
  }
}
