import { isValidElement, useRef, type ComponentProps, type ReactNode } from 'react';
import CopyButton from './CopyButton';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

function CodeBlock({ children, preProps }: { children?: ReactNode; preProps: ComponentProps<'pre'> }) {
  const preRef = useRef<HTMLPreElement>(null);
  const code = isValidElement<{ className?: string }>(children) ? children : null;
  const language = /language-([\w+#-]+)/.exec(code?.props.className ?? '')?.[1];
  return (
    <div className="code-block">
      <div className="code-tools">
        {language && <span className="code-lang">{language}</span>}
        <CopyButton className="code-copy" getText={() => preRef.current?.textContent ?? ''} />
      </div>
      <pre {...preProps} ref={preRef}>
        {children}
      </pre>
    </div>
  );
}

const components: Components = {
  // Links open in a new tab so the chat isn't navigated away from.
  a: ({ node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
  // An image in a reply is shown as a link, never loaded: loading it would send a request to whatever address
  // the model wrote, and that address could carry text from the chat. Clicking the link opens it on purpose.
  img: ({ src, alt }) =>
    typeof src === 'string' && src ? (
      <a href={src} target="_blank" rel="noreferrer" title={src}>
        {alt ? `Image: ${alt}` : 'Image'}
      </a>
    ) : (
      alt || null
    ),
  // Code blocks get a small language label and a copy button in the corner.
  pre: ({ node, children, ...props }) => <CodeBlock preProps={props}>{children}</CodeBlock>,
  // Wide tables scroll sideways instead of stretching the page.
  table: ({ node, ...props }) => (
    <div className="table-wrap">
      <table {...props} />
    </div>
  ),
};

export default function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={components}>
      {text}
    </ReactMarkdown>
  );
}
