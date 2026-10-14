import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

export const MAX_README_BYTES = 256 * 1024;

export function renderMarkdown(src: string): string {
  const html = marked.parse(src, { async: false, gfm: true }) as string;
  return sanitizeHtml(html, {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, 'h1', 'h2', 'img', 'del'],
    allowedAttributes: { a: ['href', 'title'], img: ['src', 'alt', 'title'], code: ['class'] },
    allowedClasses: { code: [/^language-[\w-]+$/] },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    transformTags: { a: sanitizeHtml.simpleTransform('a', { rel: 'nofollow noopener noreferrer' }) },
  });
}

export function isMarkdownName(name: string): boolean {
  return /\.(md|markdown)$/i.test(name);
}

export function isReadmeName(name: string): boolean {
  return /^readme(\.(md|markdown|txt))?$/i.test(name);
}
