export const undoWindowMs = 4000;

export type ToastOffer = {
  message: string;
  undo?: () => void;
};

export type ShownToast = {
  id: number;
  message: string;
  canUndo: boolean;
};

type Scheduler = {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

type UndoToasterOptions = {
  windowMs?: number;
  scheduler?: Scheduler;
};

export type UndoToaster = {
  show: (offer: ToastOffer) => number;
  undo: (id: number) => boolean;
  dismiss: (id: number) => void;
  current: () => ShownToast | null;
  subscribe: (listener: () => void) => () => void;
};

export function createUndoToaster(options: UndoToasterOptions = {}): UndoToaster {
  const windowMs = options.windowMs ?? undoWindowMs;
  const scheduler: Scheduler = options.scheduler ?? {
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  const listeners = new Set<() => void>();
  let nextId = 1;
  let active: { shown: ShownToast; undo: (() => void) | undefined; timer: unknown } | null = null;

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const clear = () => {
    if (active === null) return;
    scheduler.clearTimeout(active.timer);
    active = null;
  };

  const dismiss = (id: number) => {
    if (active?.shown.id !== id) return;
    clear();
    notify();
  };

  const show = (offer: ToastOffer) => {
    clear();
    const id = nextId++;
    const timer = scheduler.setTimeout(() => dismiss(id), windowMs);
    active = {
      shown: { id, message: offer.message, canUndo: offer.undo !== undefined },
      undo: offer.undo,
      timer,
    };
    notify();
    return id;
  };

  const undo = (id: number) => {
    if (active?.shown.id !== id || active.undo === undefined) return false;
    const restore = active.undo;
    clear();
    restore();
    notify();
    return true;
  };

  return {
    show,
    undo,
    dismiss,
    current: () => active?.shown ?? null,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
