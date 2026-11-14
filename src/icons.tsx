// Small line icons (16px), drawn in the current text colour.

const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export function DownloadIcon() {
  return (
    <svg {...base}>
      <path d="M12 4v11" />
      <path d="M7 11l5 5 5-5" />
      <path d="M5 20h14" />
    </svg>
  );
}

export function EditIcon() {
  return (
    <svg {...base}>
      <path d="M4 20h4L18.5 9.5a2.83 2.83 0 0 0-4-4L4 16v4" />
      <path d="M13.5 6.5l4 4" />
    </svg>
  );
}

/** The "return" key symbol ↵ */
export function SendIcon() {
  return (
    <svg {...base}>
      <path d="M19 5v7a3 3 0 0 1-3 3H5" />
      <path d="M9 11l-4 4 4 4" />
    </svg>
  );
}

export function StopIcon() {
  return (
    <svg {...base} stroke="none" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

/** The eject symbol from a DVD player: a triangle over a bar. */
export function EjectIcon() {
  return (
    <svg {...base}>
      <path d="M5 15l7-9 7 9z" />
      <path d="M5 19.5h14" />
    </svg>
  );
}

/** A little ghost: "incognito chat". */
export function GhostIcon() {
  return (
    <svg {...base}>
      <path d="M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z" />
      <path d="M9 10h.01M15 10h.01" />
    </svg>
  );
}

export function GearIcon() {
  return (
    <svg {...base}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

/** Two sliders: "preferences" (different from the gear, which is chat and model settings). */
export function SlidersIcon() {
  return (
    <svg {...base}>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </svg>
  );
}

export function SearchIcon() {
  return (
    <svg {...base}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4-4" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg {...base}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

/** Points down; the model picker's dropdown arrow. */
export function ChevronDownIcon() {
  return (
    <svg {...base}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/** A spinning arc (the spinning is done in CSS). */
export function SpinnerIcon() {
  return (
    <svg {...base} className="spinner">
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  );
}

/** A pencil over a square: "start a new chat". */
export function ComposeIcon() {
  return (
    <svg {...base}>
      <path d="M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6" />
      <path d="M18.4 2.6a2 2 0 0 1 2.9 2.9L12 14.8 8 16l1.2-4z" />
    </svg>
  );
}

export function CopyIcon() {
  return (
    <svg {...base}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h8" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg {...base}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg {...base}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function TrashIcon() {
  return (
    <svg {...base}>
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M6 6l1 14h10l1-14" />
    </svg>
  );
}

const FOLDER = 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z';

export function FolderIcon() {
  return (
    <svg {...base}>
      <path d={FOLDER} />
    </svg>
  );
}

export function FolderPlusIcon() {
  return (
    <svg {...base}>
      <path d={FOLDER} />
      <path d="M12 11v6M9 14h6" />
    </svg>
  );
}

/** Points right; the sidebar rotates it when a folder is open. */
export function ChevronIcon() {
  return (
    <svg {...base}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

/** A window with a side panel, for reopening the sidebar. */
export function SidebarIcon() {
  return (
    <svg {...base}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </svg>
  );
}

export function RegenerateIcon() {
  return (
    <svg {...base}>
      <path d="M20 11A8.1 8.1 0 0 0 4.5 9M4 5v4h4" />
      <path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 19v-4h-4" />
    </svg>
  );
}

/** An arrow pointing down, for "scroll to the newest message". */
export function ArrowDownIcon() {
  return (
    <svg {...base}>
      <path d="M12 5v14" />
      <path d="M6 13l6 6 6-6" />
    </svg>
  );
}

/** A circle with an exclamation mark, for errors. */
export function AlertIcon() {
  return (
    <svg {...base}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5" />
      <path d="M12 16.5v.01" />
    </svg>
  );
}

/** Three dots in a row (⋯), for a row's menu of actions. */
export function DotsIcon() {
  return (
    <svg {...base} stroke="none" fill="currentColor">
      <circle cx="5.5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="18.5" cy="12" r="1.8" />
    </svg>
  );
}
