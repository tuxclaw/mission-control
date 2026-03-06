import { useEffect, useMemo, useRef } from 'react';
import { marked } from 'marked';
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
    const detectedLanguages: string[] = [];
    const renderer = new marked.Renderer();

    renderer.code = (code, infostring) => {
      const rawInfo = (infostring ?? '').trim();
      const explicitLang = rawInfo ? rawInfo.split(/\s+/)[0] : '';
      const langLabel = detectedLanguages.shift() ?? (explicitLang || 'text');
      const safeLabel = escapeHtml(langLabel);
      const langClass = langLabel ? `language-${langLabel}` : '';

      return [
        '<div class="chat-code-block">',
        '<div class="chat-code-block__header">',
        `<span class="chat-code-block__lang">${safeLabel}</span>`,
        '<button class="chat-code-block__copy" type="button">Copy</button>',
        '</div>',
        `<pre><code class="hljs ${langClass}">${code}</code></pre>`,
        '</div>',
      ].join('');
    };

    const raw = marked.parse(content, {
      async: false,
      breaks: true,
      gfm: true,
      renderer,
      highlight: (code, lang) => {
        if (lang && hljs.getLanguage(lang)) {
          const result = hljs.highlight(code, { language: lang, ignoreIllegals: true });
          detectedLanguages.push(result.language ?? lang);
          return result.value;
        }
        const result = hljs.highlightAuto(code);
        detectedLanguages.push(result.language ?? 'text');
        return result.value;
      },
    });

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
