import mammoth from 'mammoth';
import {
  createSanitizedReadingDocumentServer,
  sanitizeReadingHtmlServer,
} from './richContent.server';
import type { ReadingImportCandidate } from './types';

const DATE_MARKER = /^日期\s*[：:]\s*(\d{4})年(\d{1,2})月(\d{1,2})日\s*$/;
const CATEGORY_MARKER = /^分类(?:[一二三四五六七八九十\d]+)?\s*[：:]\s*(.+)$/;
const KNOWLEDGE_MARKER = /^(?:\d+[.、．]\s*)?知识点\s*[：:]\s*(.*)$/;
const NOTES_MARKER = /^备注\s*[：:]\s*(.*)$/;

const INVALID_FILE_TYPE_MESSAGE = '阅读笔记批量导入仅支持 Word(.docx) 文件';
const MAX_DOCX_BYTES = 5 * 1024 * 1024;
const SEMANTIC_BLOCK_TAGS = new Set(['P', 'UL', 'OL', 'TABLE']);
const SHOW_TEXT = 4;

type SemanticBlock = {
  html: string;
  node: Node;
  tagName: string | null;
  text: string;
};

export function validateReadingDocx(file: { name: string; size: number; buffer: Buffer }): void {
  if (file.size > MAX_DOCX_BYTES) {
    throw new Error('文件超过 5MB 上限');
  }

  if (
    !file.name.toLocaleLowerCase('en-US').endsWith('.docx') ||
    file.size < 1 ||
    file.buffer.length < 2 ||
    file.buffer[0] !== 0x50 ||
    file.buffer[1] !== 0x4b
  ) {
    throw new Error(INVALID_FILE_TYPE_MESSAGE);
  }
}

function serializeNode(node: Node): string {
  const container = node.ownerDocument?.createElement('div');
  if (!container) {
    return '';
  }
  container.appendChild(node.cloneNode(true));
  return container.innerHTML;
}

function semanticBlocks(document: Document): SemanticBlock[] {
  return Array.from(document.body.childNodes).flatMap((node) => {
    const tagName = node.nodeType === node.ELEMENT_NODE ? (node as Element).tagName : null;
    const text = node.textContent?.trim() ?? '';
    if (!text || (tagName && !SEMANTIC_BLOCK_TAGS.has(tagName))) {
      return [];
    }
    return [{ html: serializeNode(node), node, tagName, text }];
  });
}

function consumeTextPrefix(root: Node, count: number) {
  let remaining = count;
  const document = root.ownerDocument;
  if (!document) {
    return;
  }

  const walker = document.createTreeWalker(root, SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode as Text);
  }

  for (const textNode of textNodes) {
    if (remaining <= 0) {
      break;
    }
    const value = textNode.nodeValue ?? '';
    const consumed = Math.min(remaining, value.length);
    textNode.nodeValue = value.slice(consumed);
    remaining -= consumed;
  }
}

function knowledgeContent(block: SemanticBlock, capturedText: string): string | null {
  if (!capturedText.trim()) {
    return null;
  }

  const clone = block.node.cloneNode(true);
  const rawText = block.node.textContent ?? '';
  const trimmedText = rawText.trim();
  const captureOffset = trimmedText.lastIndexOf(capturedText);
  const leadingWhitespace = rawText.length - rawText.trimStart().length;
  consumeTextPrefix(clone, leadingWhitespace + Math.max(0, captureOffset));
  return serializeNode(clone);
}

function formatDate(year: string, month: string, day: string) {
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function looksLikeMarker(text: string) {
  return /^(?:日期|分类(?:[一二三四五六七八九十\d]+)?|(?:\d+[.、．]\s*)?知识点|备注)/.test(
    text,
  );
}

export async function parseReadingDocx(
  buffer: Buffer,
  importDate: string,
): Promise<ReadingImportCandidate[]> {
  const converted = await mammoth.convertToHtml({ buffer });
  const document = createSanitizedReadingDocumentServer(converted.value);
  const candidates: ReadingImportCandidate[] = [];

  let currentDate = importDate;
  let currentCategory: string | null = null;
  let currentContentNodes: string[] | null = null;
  let currentNotes: string[] | null = null;
  let currentIssues: string[] = [];
  let pendingNodes: string[] = [];
  let pendingIssues: string[] = [];

  const addIssue = (issue: string) => {
    if (currentContentNodes) {
      currentIssues.push(issue);
    } else {
      pendingIssues.push(issue);
    }
  };

  const flush = () => {
    if (!currentContentNodes) {
      return;
    }

    const sanitized = sanitizeReadingHtmlServer(currentContentNodes.join(''));
    const uniqueIssues = Array.from(new Set(currentIssues));
    const notes = currentNotes?.join('\n').trim() || null;
    candidates.push({
      sourceIndex: candidates.length,
      categoryName: currentCategory ?? '未分类',
      contentHtml: sanitized.html,
      contentText: sanitized.text,
      notes,
      noteDate: currentDate,
      confidence: uniqueIssues.length > 0 ? 'low' : 'high',
      issue: uniqueIssues.length > 0 ? uniqueIssues.join('；') : null,
    });

    currentContentNodes = null;
    currentNotes = null;
    currentIssues = [];
  };

  const beginKnowledgePoint = (initialHtml: string | null) => {
    currentContentNodes = [...pendingNodes];
    currentIssues = [...pendingIssues];
    if (!currentCategory) {
      currentIssues.push('内容出现在分类之前');
    }
    currentNotes = null;
    pendingNodes = [];
    pendingIssues = [];
    if (initialHtml) {
      currentContentNodes.push(initialHtml);
    }
  };

  for (const block of semanticBlocks(document)) {
    if (block.tagName === 'P') {
      const dateMatch = block.text.match(DATE_MARKER);
      if (dateMatch) {
        flush();
        currentDate = formatDate(dateMatch[1], dateMatch[2], dateMatch[3]);
        continue;
      }

      const categoryMatch = block.text.match(CATEGORY_MARKER);
      if (categoryMatch) {
        flush();
        currentCategory = categoryMatch[1].trim();
        continue;
      }

      const knowledgeMatch = block.text.match(KNOWLEDGE_MARKER);
      if (knowledgeMatch) {
        flush();
        beginKnowledgePoint(knowledgeContent(block, knowledgeMatch[1]));
        continue;
      }

      const notesMatch = block.text.match(NOTES_MARKER);
      if (notesMatch && currentContentNodes) {
        currentNotes = notesMatch[1].trim() ? [notesMatch[1].trim()] : [];
        continue;
      }

      if (looksLikeMarker(block.text)) {
        addIssue(`无法识别标记：${block.text}`);
      }
    }

    const contentNodes = currentContentNodes as string[] | null;
    if (contentNodes) {
      if (currentNotes) {
        currentNotes.push(block.text);
      } else {
        contentNodes.push(block.html);
      }
      continue;
    }

    pendingNodes.push(block.html);
    pendingIssues.push(currentCategory ? '内容无法附加到知识点' : '内容出现在分类之前');
  }

  if (!currentContentNodes && pendingNodes.length > 0) {
    beginKnowledgePoint(null);
  }
  flush();

  return candidates;
}
