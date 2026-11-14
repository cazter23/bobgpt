// A small panel in the middle of the window that asks before doing something that can't be undone,
// such as deleting a chat or leaving an incognito chat.
//
// Cancel has the focus at first, so pressing Enter by accident never confirms. Escape or a click outside
// cancels, Tab stays inside the panel, and afterwards the focus goes back to where it was (if that's still there).
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type Props = {
  icon: ReactNode;
  title: string;
  children: ReactNode; // the explanation under the title
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean; // a red icon (the confirm button is always the red one)
  onConfirm: () => void;
  onCancel: () => void;
};

/** Where the chat area (App's `.pane`) starts, or 0 if there's no sidebar or the chat area is too narrow for the panel. */
function chatAreaLeft(): number {
  const pane = document.querySelector('.pane')?.getBoundingClientRect();
  return pane && pane.left > 0 && pane.width >= 420 ? Math.round(pane.left) : 0;
}

export default function ConfirmDialog({ icon, title, children, confirmLabel, cancelLabel = 'Cancel', danger, onConfirm, onCancel }: Props) {
  // What had the focus before the panel opened (read while drawing, before Cancel takes the focus).
  const [returnTo] = useState(() => document.activeElement as HTMLElement | null);
  const cardRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => cancelRef.current?.focus(), []);

  // Centred over the chat area (right of the sidebar), like the greeting and messages behind it, rather than over
  // the whole window. If the chat area is too narrow to hold the panel, it's centred on the window instead.
  const [left, setLeft] = useState(chatAreaLeft);
  useEffect(() => {
    const onResize = () => setLeft(chatAreaLeft());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // The focus goes back before the panel closes, while what it goes back to is sure to still be shown.
  const cancel = () => {
    returnTo?.focus?.();
    onCancel();
  };
  const confirm = () => {
    returnTo?.focus?.();
    onConfirm();
  };

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // so a panel or the search behind doesn't react too
      cancel();
    } else if (e.key === 'Tab') {
      const buttons = [...cardRef.current!.querySelectorAll<HTMLButtonElement>('button')];
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  return createPortal(
    <div
      className="confirm-backdrop"
      style={{ paddingLeft: left }}
      onMouseDown={(e) => {
        e.preventDefault(); // or the click would move the focus to the page, after it was given back
        cancel();
      }}
    >
      <div
        ref={cardRef}
        className="confirm-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-text"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className={`confirm-icon${danger ? ' danger' : ''}`}>{icon}</div>
        <h2 id="confirm-title">{title}</h2>
        <p id="confirm-text">{children}</p>
        <div className="confirm-actions">
          <button ref={cancelRef} className="secondary-button" onClick={cancel}>
            {cancelLabel}
          </button>
          <button className="danger-button" onClick={confirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
