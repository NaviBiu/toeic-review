const ALLOWED_TAGS = new Set([
  'P',
  'BR',
  'STRONG',
  'B',
  'EM',
  'I',
  'U',
  'UL',
  'OL',
  'LI',
  'TABLE',
  'THEAD',
  'TBODY',
  'TFOOT',
  'TR',
  'TH',
  'TD',
]);

const ALLOWED_ATTRIBUTES = new Map([
  ['TH', new Set(['rowspan', 'colspan'])],
  ['TD', new Set(['rowspan', 'colspan'])],
]);

const FORBIDDEN_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'IFRAME',
  'OBJECT',
  'EMBED',
  'LINK',
  'META',
  'NOSCRIPT',
  'TEMPLATE',
  'SVG',
  'MATH',
  'IMG',
  'VIDEO',
  'AUDIO',
  'SOURCE',
  'FORM',
  'INPUT',
  'BUTTON',
]);

const TEXT_BOUNDARY_TAGS = new Set([
  'P',
  'BR',
  'UL',
  'OL',
  'LI',
  'TABLE',
  'THEAD',
  'TBODY',
  'TFOOT',
  'TR',
  'TH',
  'TD',
]);

export type SanitizedReadingContent = {
  html: string;
  text: string;
};

export function normalizeReadingText(text: string) {
  return text.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('en-US');
}

function sanitizeSpan(value: string): string | null {
  if (!/^[+-]?\d+$/.test(value.trim())) {
    return null;
  }

  return String(Math.min(20, Math.max(1, Number.parseInt(value, 10))));
}

function sanitizeElementAttributes(element: Element) {
  const allowed = ALLOWED_ATTRIBUTES.get(element.tagName) ?? new Set<string>();

  for (const attribute of Array.from(element.attributes)) {
    if (!allowed.has(attribute.name.toLowerCase())) {
      element.removeAttribute(attribute.name);
      continue;
    }

    const span = sanitizeSpan(attribute.value);
    if (span === null) {
      element.removeAttribute(attribute.name);
    } else {
      element.setAttribute(attribute.name.toLowerCase(), span);
    }
  }
}

function sanitizeNode(node: Node) {
  if (node.nodeType === node.COMMENT_NODE) {
    node.parentNode?.removeChild(node);
    return;
  }

  if (node.nodeType !== node.ELEMENT_NODE) {
    return;
  }

  const element = node as Element;
  if (FORBIDDEN_TAGS.has(element.tagName)) {
    element.remove();
    return;
  }

  for (const child of Array.from(element.childNodes)) {
    sanitizeNode(child);
  }

  if (ALLOWED_TAGS.has(element.tagName)) {
    sanitizeElementAttributes(element);
    return;
  }

  element.replaceWith(...Array.from(element.childNodes));
}

function collectText(node: Node, parts: string[]) {
  if (node.nodeType === node.TEXT_NODE) {
    parts.push(node.nodeValue ?? '');
    return;
  }

  if (node.nodeType !== node.ELEMENT_NODE) {
    return;
  }

  const isBoundary = TEXT_BOUNDARY_TAGS.has((node as Element).tagName);
  if (isBoundary) {
    parts.push(' ');
  }
  for (const child of Array.from(node.childNodes)) {
    collectText(child, parts);
  }
  if (isBoundary) {
    parts.push(' ');
  }
}

export function sanitizeReadingDocument(document: Document): SanitizedReadingContent {
  for (const node of Array.from(document.body.childNodes)) {
    sanitizeNode(node);
  }

  const textParts: string[] = [];
  collectText(document.body, textParts);
  const text = normalizeReadingText(textParts.join(''));
  if (!text) {
    throw new Error('知识点不能为空');
  }

  return { html: document.body.innerHTML, text };
}

export function sanitizeReadingHtml(html: string): SanitizedReadingContent {
  const document = new DOMParser().parseFromString(html, 'text/html');
  return sanitizeReadingDocument(document);
}
