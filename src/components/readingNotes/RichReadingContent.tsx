'use client';

import { useEffect, useRef } from 'react';
import { sanitizeReadingHtml } from '@/lib/readingNotes/richContent';

function plainTextToHtml(text: string) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  return lines.map((line) => {
    const paragraph = document.createElement('p');
    paragraph.textContent = line || ' ';
    return paragraph.outerHTML;
  }).join('');
}

function insertHtmlAtSelection(editor: HTMLElement, html: string) {
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  if (!range || !editor.contains(range.commonAncestorContainer)) {
    editor.insertAdjacentHTML('beforeend', html);
    return;
  }
  range.deleteContents();
  const fragment = range.createContextualFragment(html);
  const lastNode = fragment.lastChild;
  range.insertNode(fragment);
  if (lastNode) {
    range.setStartAfter(lastNode);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
}

export function RichReadingEditor({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (html: string) => void;
  ariaLabel: string;
}) {
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.innerHTML !== value) editor.innerHTML = value;
  }, [value]);

  function emitSanitized() {
    const editor = editorRef.current;
    if (!editor) return;
    try {
      const sanitized = sanitizeReadingHtml(editor.innerHTML);
      if (editor.innerHTML !== sanitized.html) editor.innerHTML = sanitized.html;
      onChange(sanitized.html);
    } catch {
      onChange('');
    }
  }

  function handlePaste(event: React.ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    const html = event.clipboardData.getData('text/html');
    const plain = event.clipboardData.getData('text/plain');
    const source = html || plainTextToHtml(plain);
    try {
      const sanitized = sanitizeReadingHtml(source);
      if (!editorRef.current) return;
      insertHtmlAtSelection(editorRef.current, sanitized.html);
      emitSanitized();
    } catch {
      // An empty or unsupported paste leaves the current value unchanged.
    }
  }

  return (
    <div
      ref={editorRef}
      role="textbox"
      aria-label={ariaLabel}
      aria-multiline="true"
      contentEditable
      suppressContentEditableWarning
      onInput={emitSanitized}
      onPaste={handlePaste}
      className="reading-rich-content min-h-36 w-full overflow-x-auto rounded-md border border-stone-300 bg-white px-3 py-3 text-sm leading-6 text-stone-900 outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-300"
    />
  );
}

export function RichReadingContent({ html }: { html: string }) {
  return (
    <div
      className="reading-rich-content overflow-x-auto text-sm leading-6 text-stone-800"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
