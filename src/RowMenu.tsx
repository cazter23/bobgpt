// The ⋯ button on a sidebar row (a chat or a folder), and the small menu it opens.
//
// The menu is drawn in <body>, positioned next to the button, because the sidebar's list scrolls and would
// otherwise cut it off. It closes on a choice, Escape, a click elsewhere, scrolling or resizing the window.
// Keys: the arrow keys (and Home/End) move between items, Enter or Space chooses, Escape or Tab closes.
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { DotsIcon } from './icons';

export type MenuItem = {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean; // drawn in red, after a dividing line
  returnFocus?: boolean; // after choosing it, the focus goes back to ⋯ (otherwise what the choice opens takes it)
};

/**
 * `label` names the row for screen readers, e.g. 'Options for "Trip to Lisbon"'. `keepShown` keeps ⋯ visible
 * even when the row isn't hovered, e.g. while a panel it opened is up, so the focus can come back to it.
 */
export default function RowMenu({ items, label, keepShown }: { items: MenuItem[]; label: string; keepShown?: boolean }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null); // null = closed
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const open = pos !== null;

  function openMenu() {
    const r = buttonRef.current!.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: r.left });
  }

  function close(returnFocus: boolean) {
    setPos(null);
    if (returnFocus) buttonRef.current?.focus();
  }

  // Once the menu's size is known: open it upwards if there's no room below, and keep it inside the window.
  useLayoutEffect(() => {
    if (!pos || !menuRef.current || !buttonRef.current) return;
    const b = buttonRef.current.getBoundingClientRect();
    const m = menuRef.current.getBoundingClientRect();
    let top = b.bottom + 4;
    if (top + m.height > window.innerHeight - 8) top = Math.max(8, b.top - m.height - 4);
    const left = Math.max(8, Math.min(b.left, window.innerWidth - m.width - 8));
    if (top !== pos.top || left !== pos.left) setPos({ top, left });
  }, [pos]);

  // On opening, the first item gets the focus, so the menu can be used from the keyboard straight away.
  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (target: EventTarget | null) =>
      !menuRef.current?.contains(target as Node) && !buttonRef.current?.contains(target as Node);
    const onDown = (e: MouseEvent) => outside(e.target) && close(false);
    const onScroll = (e: Event) => !menuRef.current?.contains(e.target as Node) && close(false);
    const onResize = () => close(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true); // true: also scrolling inside the sidebar's list
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const enabled = [...menuRef.current!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')];
    const at = enabled.indexOf(document.activeElement as HTMLButtonElement);
    const focus = (i: number) => enabled[(i + enabled.length) % enabled.length]?.focus();
    if (e.key === 'ArrowDown') focus(at + 1);
    else if (e.key === 'ArrowUp') focus(at - 1);
    else if (e.key === 'Home') focus(0);
    else if (e.key === 'End') focus(enabled.length - 1);
    else if (e.key === 'Escape' || e.key === 'Tab') close(true);
    else return;
    e.preventDefault();
    e.stopPropagation(); // so Escape doesn't also close a panel or clear the search
  }

  return (
    <>
      <button
        ref={buttonRef}
        className={`row-more${keepShown ? ' shown' : ''}`}
        aria-label={label}
        title="Options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close(false) : openMenu())}
      >
        <DotsIcon />
      </button>
      {pos &&
        createPortal(
          <div ref={menuRef} className="row-menu" role="menu" aria-label={label} style={pos} onKeyDown={onKeyDown}>
            {items.map((item) => (
              <Fragment key={item.label}>
                {item.danger && <div className="row-menu-sep" role="separator" />}
                <button
                  role="menuitem"
                  className={`row-menu-item${item.danger ? ' danger' : ''}`}
                  disabled={item.disabled}
                  onClick={() => {
                    close(!!item.returnFocus); // Rename's text box takes the focus itself
                    item.onSelect();
                  }}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              </Fragment>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
