import { UndoToastHost } from "@parfocal/ui/components/undo-toast-host";
import { createUndoToaster, type ToastOffer } from "@parfocal/ui/lib/undo-toaster";

const undoToaster = createUndoToaster();

export function showUndoToast(offer: ToastOffer): void {
  undoToaster.show(offer);
}

export function UndoToasts() {
  return <UndoToastHost toaster={undoToaster} />;
}
