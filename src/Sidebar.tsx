import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent } from 'react';
import type { Chat, Folder, SidebarSize } from './storage';
import { downloadChatMarkdown } from './export';
import { ChevronIcon, CloseIcon, DownloadIcon, EditIcon, FolderIcon, FolderPlusIcon, PlusIcon, SearchIcon, SlidersIcon, TrashIcon } from './icons';
import { searchChats, searchTerms, splitMatches } from './search';
import RowMenu, { type MenuItem } from './RowMenu';
import ConfirmDialog from './ConfirmDialog';

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
  onOpen: (id: string, query?: string) => void; // query: the search that found it, so the chat can scroll to the match
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onNewFolder: () => string; // returns the new folder's id
  onRenameFolder: (id: string, name: string) => void;
  onToggleFolder: (id: string) => void;
  onDeleteFolder: (id: string) => void;
  onMoveChat: (chatId: string, folderId: string | null) => void;
  onOpenPreferences: () => void;
  focusSearch: number; // goes up when Ctrl+K is pressed
};

export default function Sidebar(props: Props) {
  const { chats, folders, activeId, locked, size, onSize } = props;
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const [draggedChat, setDraggedChat] = useState<string | null>(null); // a chat being dragged to a folder
  const [dropOver, setDropOver] = useState<string | null>(null); // 'root' or a folder id, for highlighting
  const [newFolderId, setNewFolderId] = useState<string | null>(null); // opens straight into renaming
  const dragging = dragWidth !== null;
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const searching = searchTerms(query).length > 0;
  // Only searched again when the chats or the words change (not each time the page redraws, e.g. while a reply streams).
  const hits = useMemo(() => (searching ? searchChats(chats, query) : []), [chats, query, searching]);

  useEffect(() => {
    if (!props.focusSearch) return;
    searchRef.current?.focus();
    searchRef.current?.select();
  }, [props.focusSearch]);

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
            <button className="new-chat" onClick={props.onNew} disabled={locked} title="New chat (Alt+N)">
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

          <div className="search">
            <SearchIcon />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // Marked as handled only when there was something to clear, so an empty box leaves Esc to stop a reply.
                if (e.key === 'Escape' && query) {
                  e.preventDefault();
                  setQuery('');
                }
              }}
              placeholder="Search chats"
              aria-label="Search chats"
              title="Search chats (Ctrl+K)"
            />
            {query && (
              <button className="search-clear" aria-label="Clear search" title="Clear search" onClick={() => setQuery('')}>
                <CloseIcon />
              </button>
            )}
          </div>

          {searching ? (
            <SearchResults
              hits={hits}
              folders={folders}
              query={query}
              activeId={activeId}
              locked={locked}
              onOpen={(id) => props.onOpen(id, query)}
            />
          ) : (
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
          )}

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
      else if (e.key === 'Escape') {
        e.preventDefault(); // handled here, so it doesn't also stop a reply
        finish(false);
      }
    },
    onBlur: () => finish(true),
    onFocus: (e: { currentTarget: HTMLInputElement }) => e.currentTarget.select(),
    'aria-label': label,
    autoFocus: true,
  };

  return { renaming, start, inputProps };
}

/**
 * A row's ⋯ menu: Rename, Export as Markdown (chats only) and Delete. Delete first asks in a panel in the
 * middle of the window. `disabled` (while a reply is written) turns off Rename and Delete.
 */
function RowActions(props: {
  name: string; // the chat's or folder's name
  kind: 'chat' | 'folder';
  onRename: () => void;
  onExport?: () => void;
  onDelete: () => void;
  disabled?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);

  const items: MenuItem[] = [
    { label: 'Rename', icon: <EditIcon />, onSelect: props.onRename, disabled: props.disabled },
    ...(props.onExport ? [{ label: 'Export as Markdown', icon: <DownloadIcon />, onSelect: props.onExport }] : []),
    // returnFocus: back to ⋯, so that's where the focus goes again if the panel is cancelled
    { label: 'Delete', icon: <TrashIcon />, onSelect: () => setConfirming(true), disabled: props.disabled, danger: true, returnFocus: true },
  ];

  return (
    <>
      <RowMenu items={items} label={`Options for ${props.kind} "${props.name}"`} keepShown={confirming} />
      {confirming && (
        <ConfirmDialog
          icon={<TrashIcon />}
          danger
          title={props.kind === 'chat' ? 'Delete chat?' : 'Delete folder?'}
          confirmLabel="Delete"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            props.onDelete();
          }}
        >
          {props.kind === 'chat' ? (
            <>
              <span className="confirm-name">{props.name}</span> will be deleted for good. This can't be undone.
            </>
          ) : (
            <>
              <span className="confirm-name">{props.name}</span> will be deleted. The chats inside go back to the main list.
            </>
          )}
        </ConfirmDialog>
      )}
    </>
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
      {!rename.renaming && (
        <RowActions name={chat.title} kind="chat" onRename={rename.start} onExport={() => downloadChatMarkdown(chat)} onDelete={onDelete} disabled={locked} />
      )}
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
        <RowActions name={folder.name} kind="folder" onRename={rename.start} onDelete={onDelete} />
      )}
    </div>
  );
}

/** What the sidebar shows while you're searching: matching chats with a snippet of the match. */
function SearchResults(props: {
  hits: ReturnType<typeof searchChats>;
  folders: Folder[];
  query: string;
  activeId: string | null;
  locked: boolean;
  onOpen: (id: string) => void;
}) {
  const terms = searchTerms(props.query);
  const marked = (text: string) =>
    splitMatches(text, terms).map((part, i) => (part.match ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>));

  if (props.hits.length === 0) return <p className="search-empty">No chats match.</p>;

  return (
    <ul className={`chat-list search-results${props.locked ? ' locked' : ''}`}>
      {props.hits.map(({ chat, snippet }) => {
        const folder = props.folders.find((f) => f.id === chat.folderId);
        return (
          <li key={chat.id}>
            <button
              className={`search-result${chat.id === props.activeId ? ' active' : ''}`}
              onClick={() => props.onOpen(chat.id)}
              disabled={props.locked}
            >
              <span className="search-title">{marked(chat.title)}</span>
              {snippet && <span className="search-snippet">{marked(snippet)}</span>}
              {folder && <span className="search-folder">{folder.name}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
