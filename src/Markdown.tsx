import { isValidElement } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

const components: Components = {
  // Links open in a new tab so the chat isn't navigated away from.
  a: ({ node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
  // Code blocks get a small language label in the corner.
  pre: ({ node, children, ...props }) => {
    const code = isValidElement<{ className?: string }>(children) ? children : null;
    const language = /language-([\w+#-]+)/.exec(code?.props.className ?? '')?.[1];
    return (
      <div className="code-block">
        {language && <span className="code-lang">{language}</span>}
        <pre {...props}>{children}</pre>
      </div>
    );
  },
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
