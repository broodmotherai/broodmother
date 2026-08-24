"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Shuts an open popup when the pointer lands outside it or Escape is pressed —
 * what every menu, dropdown and account card was carrying its own copy of.
 * Nothing is bound while it is shut, so a page full of them costs no listeners.
 */
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, onDismiss: () => void) {
  // Held in a ref so an inline arrow at the call site does not resubscribe both
  // listeners on every render.
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  useEffect(() => {
    if (!open) return;
    // pointerdown rather than click: the popup has to be gone before whatever
    // was pressed underneath it acts, and click fires after that.
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) dismiss.current();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss.current();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [ref, open]);
}
