import { useEffect, useRef, useState } from 'react';
import { CheckIcon, CopyIcon } from './icons';

/** Copies text to the clipboard (`text`, or whatever `getText` returns at click time). Shows a tick for a moment afterwards. */
export default function CopyButton({ text, getText, className }: { text?: string; getText?: () => string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(0);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(getText ? getText() : (text ?? ''));
    } catch {
      return; // the browser refused; leave the icon as it was
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button className={className} aria-label="Copy" title={copied ? 'Copied' : 'Copy'} onClick={copy}>
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}
