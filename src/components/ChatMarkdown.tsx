import { useEffect, useMemo, useRef } from 'react';
import { marked, type Tokens } from 'marked';
import hljs from 'highlight.js';

type ChatMarkdownProps = {
  content: string;
};

const stripScripts = (html: string) => html.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');

const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export function ChatMarkdown({ content }: ChatMarkdownProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const html = useMemo(() => {
    const renderer = new marked.Renderer();

    renderer.code = ({ text, lang }: Tokens.Code) => {
      const rawLang = (lang ?? '').split(/\s+/)[0] || '';
      let highlighted: string;
      let langLabel: string;

      if (rawLang && hljs.getLanguage(rawLang)) {
        const result = hljs.highlight(text, { language: rawLang, ignoreIllegals: true });
        highlighted = result.value;
        langLabel = result.language ?? rawLang;
      } else {
        const result = hljs.highlightAuto(text);
        highlighted = result.value;
        langLabel = result.language ?? 'text';
      }

      const safeLabel = escapeHtml(langLabel);
      const langClass = langLabel ? `language-${langLabel}` : '';

      return [
        '<div class="chat-code-block">',
        '<div class="chat-code-block__header">',
        `<span class="chat-code-block__lang">${safeLabel}</span>`,
        '<button class="chat-code-block__copy" type="button">Copy</button>',
        '</div>',
        `<pre><code class="hljs ${langClass}">${highlighted}</code></pre>`,
        '</div>',
      ].join('');
    };

    const raw = marked.parse(content, {
      async: false,
      breaks: true,
      gfm: true,
      renderer,
    }) as string;

    return stripScripts(raw);
  }, [content]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('.chat-code-block__copy'));
    const handlers = new Map<HTMLButtonElement, () => void>();

    buttons.forEach(button => {
      const handler = () => {
        const wrapper = button.closest('.chat-code-block');
        const codeEl = wrapper?.querySelector('code');
        const text = codeEl?.textContent ?? '';
        navigator.clipboard.writeText(text).catch(() => {});
      };
      handlers.set(button, handler);
      button.addEventListener('click', handler);
    });

    return () => {
      handlers.forEach((handler, button) => {
        button.removeEventListener('click', handler);
      });
    };
  }, [content]);

  return (
    <div
      ref={containerRef}
      className="chat-markdown"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
