// How a model's reply is shown: nothing in it may load anything by itself, and links show where they really go.
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Markdown from '../src/Markdown';
import { safeUrl, siteOf } from '../src/links';

function show(text: string) {
  return render(<Markdown text={text} />).container;
}

describe('safeUrl', () => {
  it('keeps web addresses and places in the reply', () => {
    expect(safeUrl('https://example.com/a?b=c')).toBe('https://example.com/a?b=c');
    expect(safeUrl('http://example.com')).toBe('http://example.com');
    expect(safeUrl('HTTPS://EXAMPLE.COM')).toBe('HTTPS://EXAMPLE.COM');
    expect(safeUrl('#user-content-fn-1')).toBe('#user-content-fn-1');
  });

  it('takes out everything else', () => {
    for (const url of [
      'javascript:alert(1)',
      ' javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'data:image/svg+xml;base64,PHN2Zz4=',
      'vbscript:x',
      'file:///C:/Windows/win.ini',
      'mailto:a@example.com?body=secret',
      '/assets/x.js',
      'relative/path',
      '',
    ]) {
      expect(safeUrl(url), url).toBe('');
    }
  });
});

describe('siteOf', () => {
  it("gives the site's name without www.", () => {
    expect(siteOf('https://www.example.com/a')).toBe('example.com');
    expect(siteOf('https://sub.example.co.uk:8080/x')).toBe('sub.example.co.uk');
    expect(siteOf('not an address')).toBe('');
  });
});

describe('a reply', () => {
  it('never loads an image: it shows its description and site, with the address on hover, and is not a link', () => {
    const el = show('![a cat](https://example.com/cat.png?leak=secret)');
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('a')).toBeNull();
    const image = el.querySelector('.md-image')!;
    expect(image.textContent).toBe('Image not loaded: a cat (example.com)');
    expect(image.getAttribute('title')).toBe('https://example.com/cat.png?leak=secret');
  });

  it('describes images with no description, embedded images, and reference images', () => {
    const el = show('![](https://example.com/a.png) ![svg](data:image/svg+xml;base64,PHN2Zz4=) ![r][ref]\n\n[ref]: https://example.com/r.png');
    expect(el.querySelector('img')).toBeNull();
    expect([...el.querySelectorAll('.md-image')].map((e) => e.textContent)).toEqual([
      'Image not loaded: no description (example.com)',
      'Image not loaded: svg',
      'Image not loaded: r (example.com)',
    ]);
  });

  it('shows raw HTML as text, never as elements', () => {
    const el = show('<img src="https://example.com/x.png"> <script>alert(1)</script> <iframe src="https://example.com"></iframe>');
    expect(el.querySelector('img, script, iframe')).toBeNull();
  });

  it('opens a web link in a new tab without telling the site where it came from, with the address on hover', () => {
    const a = show('[the docs](https://example.com/docs?q=secret)').querySelector('a')!;
    expect(a.getAttribute('href')).toBe('https://example.com/docs?q=secret');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noreferrer');
    expect(a.getAttribute('title')).toBe('https://example.com/docs?q=secret');
  });

  it("names the site after a link's text when the text doesn't, and not when it does", () => {
    const el = show('[your bank](https://evil.example/login) and https://example.com/a and [example.com](https://www.example.com/b)');
    expect([...el.querySelectorAll('.link-site')].map((e) => e.textContent)).toEqual([' (evil.example)']);
  });

  it('shows only the text of a link to anything but a web page', () => {
    const el = show('[js](javascript:alert(1)) [mail](mailto:a@example.com?body=secret) [file](file:///C:/x) [data](data:text/html,x)');
    expect(el.querySelector('a')).toBeNull();
    expect(el.textContent).toBe('js mail file data');
  });

  it('keeps footnote links in the same tab', () => {
    const el = show('A claim[^1].\n\n[^1]: The source.');
    const links = [...el.querySelectorAll('a')];
    expect(links.length).toBeGreaterThan(0);
    for (const a of links) {
      expect(a.getAttribute('href')).toMatch(/^#/);
      expect(a.getAttribute('target')).toBeNull();
    }
  });
});
