interface ManagedLayer {
  readonly isComposite: boolean;
  activateViewport(viewport: unknown): void;
}

interface DeckInternals {
  readonly layerManager?: {
    getLayers(): readonly ManagedLayer[];
    activateViewport(viewport: unknown): void;
    needsUpdate(): string | boolean;
    updateLayers(): void;
  } | null;
  readonly viewManager?: { getViewports(): readonly unknown[] } | null;
  redraw(reason?: string): void;
}

export const maxUpdatePasses = 3;

export function drawCurrentView(deck: unknown, reason: string): void {
  const internals = deck as DeckInternals;
  const layers = internals.layerManager;
  const views = internals.viewManager;
  if (!layers || !views) return;
  for (let pass = 0; pass < maxUpdatePasses; pass += 1) {
    for (const viewport of views.getViewports()) {
      layers.activateViewport(viewport);
      for (const layer of layers.getLayers()) {
        if (layer.isComposite) layer.activateViewport(viewport);
      }
    }
    if (!layers.needsUpdate()) break;
    layers.updateLayers();
  }
  internals.redraw(reason);
}

export function layersNeedUpdate(deck: unknown): boolean {
  const layers = (deck as DeckInternals).layerManager;
  return layers ? Boolean(layers.needsUpdate()) : false;
}
