import { useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent } from 'react';
import type { Chat, Folder, SidebarSize } from './storage';
import { ChevronIcon, EditIcon, FolderIcon, FolderPlusIcon, PlusIcon, SlidersIcon, TrashIcon } from './icons';

const WIDTHS: Record<SidebarSize, number> = { hidden: 0, medium: 240, large: 320 };

/** Which of the three sizes a dragged width is closest to. */
function snap(width: number): SidebarSize {
  if (width < 120) return 'hidden';
  return width < 280 ? 'medium' : 'large';
}

type Props = {
  chats: Chat[];
  folders: Folder[];
  activeId: string | null;
  locked: boolean; // true while a reply is being written
  size: SidebarSize;
  onSize: (size: SidebarSize) => void;
  onNew: () => void;
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onNewFolder: () => string; // returns the new folder's id
  onRenameFolder: (id: string, name: string) => void;
  onToggleFolder: (id: string) => void;
  onDeleteFolder: (id: string) => void;
  onMoveChat: (chatId: string, folderId: string | null) => void;
  onOpenPreferences: () => void;
};

export default function Sidebar(props: Props) {
  const { chats, folders, activeId, locked, size, onSize } = props;
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const [draggedChat, setDraggedChat] = useState<string | null>(null); // a chat being dragged to a folder
  const [dropOver, setDropOver] = useState<string | null>(null); // 'root' or a folder id, for highlighting
  const [newFolderId, setNewFolderId] = useState<string | null>(null); // opens straight into renaming
  const dragging = dragWidth !== null;

  // Drag the edge: the panel follows the pointer, then snaps to hidden, medium or large on release.
  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragWidth(WIDTHS[size]);
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    const left = e.currentTarget.parentElement!.getBoundingClientRect().left;
    setDragWidth(Math.min(WIDTHS.large, Math.max(0, e.clientX - left)));
  }
  function onPointerUp() {
    if (dragWidth === null) return;
    onSize(snap(dragWidth));
    setDragWidth(null);
  }

  // Dropping a chat on a folder puts it in that folder; dropping on the empty list takes it out of any folder.
  function dropTarget(folderId: string | null) {
    const key = folderId ?? 'root';
    return {
      onDragOver: (e: DragEvent) => {
        if (!draggedChat) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        setDropOver(key);
      },
      onDragLeave: (e: DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropOver((cur) => (cur === key ? null : cur));
      },
      onDrop: (e: DragEvent) => {
        if (!draggedChat) return;
        e.preventDefault();
        e.stopPropagation();
        props.onMoveChat(draggedChat, folderId);
        setDraggedChat(null);
        setDropOver(null);
      },
    };
  }

  const folderIds = new Set(folders.map((f) => f.id));
  const unfiled = chats.filter((c) => !c.folderId || !folderIds.has(c.folderId));

  function chatRow(chat: Chat) {
    return (
      <ChatRow
        key={chat.id}
        chat={chat}
        active={chat.id === activeId}
        locked={locked}
        dragged={chat.id === draggedChat}
        onOpen={() => props.onOpen(chat.id)}
        onRename={(title) => props.onRename(chat.id, title)}
        onDelete={() => props.onDelete(chat.id)}
        onDragStart={() => setDraggedChat(chat.id)}
        onDragEnd={() => {
          setDraggedChat(null);
          setDropOver(null);
        }}
      />
    );
  }

  return (
    <>
      <aside
        className={`sidebar${dragging ? ' dragging' : ''}`}
        style={{ width: dragWidth ?? WIDTHS[size] }}
        aria-hidden={size === 'hidden' && !dragging}
        inert={size === 'hidden' && !dragging}
      >
        <div className="sidebar-inner">
          <div className="sidebar-top">
            <button className="new-chat" onClick={props.onNew} disabled={locked}>
              <PlusIcon /> New chat
            </button>
            <button
              className="new-folder"
              aria-label="New folder"
              title="New folder"
              onClick={() => setNewFolderId(props.onNewFolder())}
            >
              <FolderPlusIcon />
            </button>
          </div>

          <ul
            className={`chat-list${locked ? ' locked' : ''}${dropOver === 'root' ? ' drop-over' : ''}`}
            {...dropTarget(null)}
          >
            {folders.map((folder) => (
              <li key={folder.id} className={`folder${dropOver === folder.id ? ' drop-over' : ''}`} {...dropTarget(folder.id)}>
                <FolderHeader
                  folder={folder}
                  startRenaming={folder.id === newFolderId}
                  onToggle={() => props.onToggleFolder(folder.id)}
                  onRename={(name) => props.onRenameFolder(folder.id, name)}
                  onDelete={() => props.onDeleteFolder(folder.id)}
                />
                {!folder.collapsed && (
                  <ul className="folder-chats">{chats.filter((c) => c.folderId === folder.id).map(chatRow)}</ul>
                )}
              </li>
            ))}
            {unfiled.map(chatRow)}
          </ul>

          <div className="sidebar-footer">
            <button className="topbar-button" aria-label="Preferences" title="Preferences" onClick={props.onOpenPreferences}>
              <SlidersIcon />
            </button>
          </div>
        </div>
      </aside>
      <div
        className={`resizer${dragging ? ' dragging' : ''}`}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onLostPointerCapture={() => setDragWidth(null)}
      />
    </>
  );
}

/** Rename-in-place for a row: Enter saves, Escape cancels, clicking away saves. */
function useRename(current: string, onSave: (value: string) => void, label: string, startOpen = false) {
  const [renaming, setRenaming] = useState(startOpen);
  const [draft, setDraft] = useState(startOpen ? current : '');
  const finished = useRef(false); // stops Enter/Escape and the following blur from both firing

  function start() {
    finished.current = false;
    setDraft(current);
    setRenaming(true);
  }

  function finish(save: boolean) {
    if (finished.current) return;
    finished.current = true;
    if (save && draft.trim()) onSave(draft.trim());
    setRenaming(false);
  }

  const inputProps = {
    className: 'rename-input',
    value: draft,
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.nativeEvent.isComposing) finish(true);
      else if (e.key === 'Escape') finish(false);
    },
    onBlur: () => finish(true),
    onFocus: (e: { currentTarget: HTMLInputElement }) => e.currentTarget.select(),
    'aria-label': label,
    autoFocus: true,
  };

  return { renaming, start, inputProps };
}

/** Rename and delete icons shown on hover. Delete asks "Delete?" first; clicking elsewhere cancels. */
function RowActions(props: { onRename: () => void; onDelete: () => void; disabled?: boolean; confirmHint?: string }) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <button
        className="confirm-delete"
        title={props.confirmHint}
        onClick={props.onDelete}
        onBlur={() => setConfirming(false)}
        onKeyDown={(e) => e.key === 'Escape' && setConfirming(false)}
        autoFocus
      >
        Delete?
      </button>
    );
  }

  return (
    <div className="row-actions">
      <button aria-label="Rename" title="Rename" onClick={props.onRename} disabled={props.disabled}>
        <EditIcon />
      </button>
      <button aria-label="Delete" title="Delete" onClick={() => setConfirming(true)} disabled={props.disabled}>
        <TrashIcon />
      </button>
    </div>
  );
}

type RowProps = {
  chat: Chat;
  active: boolean;
  locked: boolean;
  dragged: boolean;
  onOpen: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
};

function ChatRow({ chat, active, locked, dragged, onOpen, onRename, onDelete, onDragStart, onDragEnd }: RowProps) {
  const rename = useRename(chat.title, onRename, 'Chat name');

  return (
    <li
      className={`chat-row${active ? ' active' : ''}${dragged ? ' dragged' : ''}`}
      draggable={!locked && !rename.renaming}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', chat.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnd={onDragEnd}
    >
      {rename.renaming ? (
        <input {...rename.inputProps} />
      ) : (
        <button className="chat-title" onClick={onOpen} disabled={locked} title={chat.title}>
          {chat.title}
        </button>
      )}
      {!rename.renaming && <RowActions onRename={rename.start} onDelete={onDelete} disabled={locked} />}
    </li>
  );
}

type FolderHeaderProps = {
  folder: Folder;
  startRenaming: boolean;
  onToggle: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
};

function FolderHeader({ folder, startRenaming, onToggle, onRename, onDelete }: FolderHeaderProps) {
  const rename = useRename(folder.name, onRename, 'Folder name', startRenaming);

  return (
    <div className={`folder-header${folder.collapsed ? '' : ' open'}`}>
      {rename.renaming ? (
        <input {...rename.inputProps} />
      ) : (
        <button className="folder-title" onClick={onToggle} aria-expanded={!folder.collapsed} title={folder.name}>
          <span className="chevron">
            <ChevronIcon />
          </span>
          <FolderIcon />
          <span className="folder-name">{folder.name}</span>
        </button>
      )}
      {!rename.renaming && (
        <RowActions onRename={rename.start} onDelete={onDelete} confirmHint="The chats inside go back to the main list" />
      )}
    </div>
  );
}
