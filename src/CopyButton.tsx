import { useEffect, useRef, useState } from 'react';
import { CheckIcon, CopyIcon } from './icons';

/** Copies a message's text to the clipboard. Shows a tick for a moment afterwards. */
export default function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(0);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return; // the browser refused; leave the icon as it was
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button aria-label="Copy" title={copied ? 'Copied' : 'Copy'} onClick={copy}>
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}
