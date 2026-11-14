// Attached images: small ones waiting in the input box, and the ones in your sent messages.
import { useImage } from './images';
import { CloseIcon } from './icons';

/** An image waiting in the input box, with a × to take it out. */
export function AttachmentThumb({ id, onRemove }: { id: string; onRemove: () => void }) {
  const url = useImage(id);
  return (
    <div className="attachment">
      {url ? <img src={url} alt="Attached image" /> : <div className="img-missing" />}
      <button className="attachment-remove" aria-label="Remove image" title="Remove image" onClick={onRemove}>
        <CloseIcon />
      </button>
    </div>
  );
}

/** The images in one of your messages, shown in its bubble above the text. */
export function MessageImages({ ids, withText }: { ids: string[]; withText: boolean }) {
  return (
    <div className={`msg-images${withText ? ' with-text' : ''}`}>
      {ids.map((id) => (
        <MessageImage key={id} id={id} />
      ))}
    </div>
  );
}

function MessageImage({ id }: { id: string }) {
  const url = useImage(id);
  return url ? <img src={url} alt="Attached image" /> : <div className="img-missing" role="img" aria-label="Image not available" />;
}
