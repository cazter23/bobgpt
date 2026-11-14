// One message in the chat: your bubble, or a reply with its thinking and Markdown. (The edit box is in App.tsx.)
//
// Wrapped in memo, so a row is only drawn again when something it shows changes. While a reply streams, only
// that last row changes; without memo every earlier reply's Markdown would be parsed again many times a second.
import { memo } from 'react';
import type { ChatMessage } from './api';
import CopyButton from './CopyButton';
import { MessageImages } from './ImageThumbs';
import Markdown from './Markdown';
import { EditIcon, RegenerateIcon, TrashIcon } from './icons';
import type { ThinkingView } from './settings';

export type RowAction = 'regenerate' | 'edit' | 'delete';

type Props = {
  message: ChatMessage;
  index: number;
  generating: boolean; // a reply is being written (the buttons are hidden meanwhile)
  streaming: boolean; // this is that reply
  canRegenerate: boolean; // there is one of your messages at or before this one
  thinkingView: ThinkingView;
  showSpeed: boolean;
  onAction: (action: RowAction, index: number) => void; // must stay the same function, or memo can't skip the row
};

function MessageRow({ message: m, index, generating, streaming, canRegenerate, thinkingView, showSpeed, onAction }: Props) {
  const actions = (
    <div className={`actions${generating ? ' hidden' : ''}`}>
      {m.role === 'assistant' && <CopyButton text={m.content} />}
      {canRegenerate && (
        <button aria-label="Regenerate" title="Regenerate" onClick={() => onAction('regenerate', index)}>
          <RegenerateIcon />
        </button>
      )}
      {m.role === 'user' && (
        <>
          <button aria-label="Edit" title="Edit" onClick={() => onAction('edit', index)}>
            <EditIcon />
          </button>
          <CopyButton text={m.content} />
        </>
      )}
      <button aria-label="Delete" title="Delete this message" onClick={() => onAction('delete', index)}>
        <TrashIcon />
      </button>
    </div>
  );

  if (m.role === 'user') {
    return (
      <div className="msg user" data-msg-index={index}>
        <div className="bubble">
          {m.images?.length ? <MessageImages ids={m.images} withText={!!m.content} /> : null}
          {m.content}
        </div>
        {actions}
      </div>
    );
  }

  return (
    <div className={`msg assistant${streaming ? ' streaming' : ''}`} data-msg-index={index}>
      {m.trimmed && <p className="trim-note">Earlier messages were left out to fit the context.</p>}
      {m.thinking && thinkingView !== 'hidden' && (
        <details className="thinking" key={thinkingView} open={thinkingView === 'open'}>
          <summary>
            {m.thoughtSeconds === undefined ? 'Thinking…' : `Thought for ${Math.max(1, Math.round(m.thoughtSeconds))}s`}
          </summary>
          <div className="thinking-text">{m.thinking}</div>
        </details>
      )}
      <div className="content">
        <Markdown text={m.content} />
      </div>
      {showSpeed && m.tokensPerSecond && <p className="msg-meta">{m.tokensPerSecond} tok/s</p>}
      {actions}
    </div>
  );
}

export default memo(MessageRow);
