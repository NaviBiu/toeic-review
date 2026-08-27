export type AnalysisParagraph = {
  type: 'paragraph';
  text: string;
};

export type AnalysisTableRow = {
  header: boolean;
  cells: string[];
};

export type AnalysisTable = {
  type: 'table';
  rows: AnalysisTableRow[];
};

export type AnalysisBlock = AnalysisParagraph | AnalysisTable;

const RICH_ANALYSIS_PREFIX = 'toeic-rich-analysis:v1:';

function cleanText(value: string) {
  return value.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
}

function normalizeBlocks(blocks: AnalysisBlock[]): AnalysisBlock[] {
  return blocks.flatMap((block): AnalysisBlock[] => {
    if (block.type === 'paragraph') {
      return [{ type: 'paragraph', text: block.text }];
    }
    const rows = block.rows
      .map((row) => ({ header: Boolean(row.header), cells: [...row.cells] }))
      .filter((row) => row.cells.length > 0);
    return rows.length > 0 ? [{ type: 'table', rows }] : [];
  });
}

function isAnalysisBlock(value: unknown): value is AnalysisBlock {
  if (!value || typeof value !== 'object') return false;
  const block = value as Record<string, unknown>;
  if (block.type === 'paragraph') return typeof block.text === 'string';
  if (block.type !== 'table' || !Array.isArray(block.rows)) return false;
  return block.rows.every((row) => {
    if (!row || typeof row !== 'object') return false;
    const candidate = row as Record<string, unknown>;
    return typeof candidate.header === 'boolean'
      && Array.isArray(candidate.cells)
      && candidate.cells.every((cell) => typeof cell === 'string');
  });
}

export function encodeAnalysis(blocks: AnalysisBlock[]): string {
  const normalized = normalizeBlocks(blocks);
  if (!normalized.some((block) => block.type === 'table')) {
    return normalized
      .filter((block): block is AnalysisParagraph => block.type === 'paragraph')
      .map((block) => block.text)
      .join('\n\n');
  }
  return `${RICH_ANALYSIS_PREFIX}${JSON.stringify(normalized)}`;
}

export function decodeAnalysis(value: string): AnalysisBlock[] {
  if (!value.startsWith(RICH_ANALYSIS_PREFIX)) {
    return [{ type: 'paragraph', text: value }];
  }
  try {
    const parsed = JSON.parse(value.slice(RICH_ANALYSIS_PREFIX.length));
    if (!Array.isArray(parsed) || !parsed.every(isAnalysisBlock)) throw new Error('Invalid rich analysis');
    return normalizeBlocks(parsed);
  } catch {
    return [{ type: 'paragraph', text: value }];
  }
}

export function analysisHasContent(value: string): boolean {
  return decodeAnalysis(value).some((block) => block.type === 'paragraph'
    ? Boolean(block.text.trim())
    : block.rows.some((row) => row.cells.some((cell) => Boolean(cell.trim()))));
}

function tableFromElement(table: HTMLTableElement): AnalysisTable | null {
  const rows = [...table.querySelectorAll('tr')].flatMap((row, rowIndex): AnalysisTableRow[] => {
    const cellElements = [...row.children]
      .filter((cell): cell is HTMLTableCellElement => cell instanceof HTMLTableCellElement);
    if (cellElements.length === 0) return [];
    return [{
      header: rowIndex === 0 || cellElements.every((cell) => cell.tagName === 'TH'),
      cells: cellElements.map((cell) => cleanText(cell.textContent ?? '')),
    }];
  });
  return rows.length > 0 ? { type: 'table', rows } : null;
}

export function parseAnalysisClipboardHtml(html: string): AnalysisBlock[] {
  if (typeof DOMParser === 'undefined') return [];
  const document = new DOMParser().parseFromString(html, 'text/html');
  const blocks: AnalysisBlock[] = [];

  function visit(node: Node) {
    if (node instanceof HTMLTableElement) {
      const table = tableFromElement(node);
      if (table) blocks.push(table);
      return;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      const text = cleanText(node.textContent ?? '');
      if (text) blocks.push({ type: 'paragraph', text });
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.querySelector('table')) {
      node.childNodes.forEach(visit);
      return;
    }
    const text = cleanText(node.textContent ?? '');
    if (text) blocks.push({ type: 'paragraph', text });
  }

  document.body.childNodes.forEach(visit);
  return normalizeBlocks(blocks);
}

export function parseAnalysisClipboardText(text: string): AnalysisBlock[] {
  const blocks: AnalysisBlock[] = [];
  let tableRows: AnalysisTableRow[] = [];
  const flushTable = () => {
    if (tableRows.length === 0) return;
    blocks.push({ type: 'table', rows: tableRows });
    tableRows = [];
  };

  for (const line of text.split(/\r?\n/)) {
    const cells = line.split('\t').map(cleanText);
    if (cells.length > 1) {
      tableRows.push({ header: tableRows.length === 0, cells });
      continue;
    }
    flushTable();
    const paragraph = cleanText(line);
    if (paragraph) blocks.push({ type: 'paragraph', text: paragraph });
  }
  flushTable();
  return normalizeBlocks(blocks);
}
