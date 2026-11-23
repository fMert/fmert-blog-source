import { Marked } from 'marked';
import hljs from 'highlight.js';

export function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function slugifyHeading(text = '') {
  return String(text)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-') || 'section';
}

export function stripHtml(html = '') {
  return String(html)
    .replace(/<pre[\s\S]*?<\/pre>/gi, ' ')
    .replace(/<\/?(?:p|div|li|br|h[1-6]|blockquote|tr|td|th)[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function renderMarkdown(source = '', { copyLabel = 'Copy', copiedLabel = 'Copied' } = {}) {
  const headings = [];
  const usedIds = new Map();

  const renderer = {
    heading({ tokens, depth }) {
      const html = this.parser.parseInline(tokens);
      const plain = stripHtml(html);
      const base = slugifyHeading(plain);
      const count = usedIds.get(base) || 0;
      usedIds.set(base, count + 1);
      const id = count === 0 ? base : `${base}-${count}`;

      if (depth >= 2 && depth <= 3) {
        headings.push({ id, text: plain, depth });
      }
      return `<h${depth} id="${escapeHtml(id)}"><a class="heading-anchor" href="#${escapeHtml(id)}" aria-hidden="true">#</a>${html}</h${depth}>\n`;
    },

    code({ text, lang }) {
      const rawLang = (lang || '').trim().split(/\s+/)[0].toLowerCase();
      let highlighted;
      let displayLang = rawLang;

      if (rawLang && rawLang !== 'text' && rawLang !== 'plain' && hljs.getLanguage(rawLang)) {
        highlighted = hljs.highlight(text, { language: rawLang, ignoreIllegals: true }).value;
      } else {
        highlighted = escapeHtml(text);
        if (rawLang === 'text' || rawLang === 'plain') displayLang = '';
      }

      const langBadge = displayLang
        ? `<span class="code-lang">${escapeHtml(displayLang)}</span>`
        : '<span class="code-lang"></span>';

      return [
        '<div class="code-block">',
        `<div class="code-block-header">${langBadge}<button type="button" class="code-copy" data-copy-label="${escapeHtml(copyLabel)}" data-copied-label="${escapeHtml(copiedLabel)}">${escapeHtml(copyLabel)}</button></div>`,
        `<pre><code class="hljs${displayLang ? ` language-${escapeHtml(displayLang)}` : ''}">${highlighted}</code></pre>`,
        '</div>\n'
      ].join('');
    },

    image({ href, title, text }) {
      const safeHref = escapeHtml(href || '');
      const safeAlt = escapeHtml(text || '');
      const caption = title ? `<figcaption>${escapeHtml(title)}</figcaption>` : '';
      return `<figure class="prose-figure"><img src="${safeHref}" alt="${safeAlt}" loading="lazy" decoding="async">${caption}</figure>`;
    },

    table(token) {
      const headerCells = token.header
        .map((cell, i) => {
          const align = token.align[i] ? ` style="text-align:${token.align[i]}"` : '';
          return `<th${align}>${this.parser.parseInline(cell.tokens)}</th>`;
        })
        .join('');
      const bodyRows = token.rows
        .map((row) => {
          const cells = row
            .map((cell, i) => {
              const align = token.align[i] ? ` style="text-align:${token.align[i]}"` : '';
              return `<td${align}>${this.parser.parseInline(cell.tokens)}</td>`;
            })
            .join('');
          return `<tr>${cells}</tr>`;
        })
        .join('');
      return `<div class="table-scroll"><table><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table></div>\n`;
    }
  };

  const marked = new Marked({ gfm: true, breaks: false });
  marked.use({ renderer });

  const html = marked.parse(source || '');
  const plainText = stripHtml(html);
  const words = plainText ? plainText.split(/\s+/).length : 0;
  const readingMinutes = Math.max(1, Math.round(words / 210));
  const excerpt = plainText.length > 180
    ? `${plainText.slice(0, 177).replace(/\s+\S*$/, '').replace(/[.,;:!?—-]+$/, '')}…`
    : plainText;

  return { html, headings, words, readingMinutes, excerpt, plainText };
}
