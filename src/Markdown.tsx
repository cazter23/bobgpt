import { isValidElement, memo, useRef, type ComponentProps, type ReactNode } from 'react';
import CopyButton from './CopyButton';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { safeUrl, siteOf } from './links';

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

type TreeNode = { type: string; value?: string; children?: TreeNode[] };
const textOf = (node?: TreeNode): string =>
  node ? (node.type === 'text' ? (node.value ?? '') : (node.children ?? []).map(textOf).join('')) : '';

const components: Components = {
  a: ({ node, href, children, ...props }) => {
    // A link that safeUrl took out: just its text.
    if (!href) return <span>{children}</span>;
    // A footnote, or another place in the reply: it stays in this tab.
    if (href.startsWith('#')) return <a {...props} href={href}>{children}</a>;
    // A web page opens in a new tab, so the chat isn't navigated away from. The model chose both the text and the
    // address, and the address could carry text from the chat, so the full address shows on hover, and the site's
    // name is shown after the text whenever the text doesn't already name it.
    const site = siteOf(href);
    const named = site && textOf(node as TreeNode).toLowerCase().includes(site.toLowerCase());
    return (
      <>
        <a {...props} href={href} target="_blank" rel="noreferrer" title={href}>
          {children}
        </a>
        {site && !named && <span className="link-site"> ({site})</span>}
      </>
    );
  },
  // An image in a reply is never loaded: loading it would send a request to whatever address the model wrote, and
  // that address could carry text from the chat. It isn't a link either, so it can't be opened by accident: only its
  // description and site show, with the full address on hover.
  img: ({ src, alt }) => {
    const address = typeof src === 'string' ? src : '';
    const site = address ? siteOf(address) : '';
    return (
      <span className="md-image" title={address || undefined}>
        {`Image not loaded: ${alt || 'no description'}${site ? ` (${site})` : ''}`}
      </span>
    );
  },
  // Code blocks get a small language label and a copy button in the corner.
  pre: ({ node, children, ...props }) => <CodeBlock preProps={props}>{children}</CodeBlock>,
  // Wide tables scroll sideways instead of stretching the page.
  table: ({ node, ...props }) => (
    <div className="table-wrap">
      <table {...props} />
    </div>
  ),
};

const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeHighlight];

/** A reply's text as Markdown. Parsing and highlighting are costly, so it's only redone when the text changes. */
export default memo(function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components} urlTransform={safeUrl}>
      {text}
    </ReactMarkdown>
  );
});
