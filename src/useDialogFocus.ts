import { useEffect, type RefObject } from 'react';

/**
 * For a panel that opens over the page: moves keyboard focus into it when it opens (so Tab starts there and a
 * screen reader reads its name), and back to wherever it was, such as the button that opened it, when it closes.
 * The panel element needs tabIndex={-1} so that it can take focus.
 */
export function useDialogFocus(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const before = document.activeElement;
    ref.current?.focus();
    return () => {
      if (before instanceof HTMLElement && before.isConnected) before.focus();
    };
  }, [ref]);
}
