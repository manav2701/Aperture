/*
 * A minimal PDF 1.4 writer for text documents (attestation PDFs, plan §11.5 and decision D11-2):
 * Helvetica in WinAnsi, A4 pages, automatic page breaks and line wrapping. The signed JSON stays
 * the record of truth; this only renders it for people.
 */

export interface PdfLine {
  text: string;
  size?: number;
  bold?: boolean;
  /** Extra space before the line, in points. */
  gap?: number | undefined;
  /** Indent in points. */
  indent?: number;
}

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 56;

/** Characters Helvetica/WinAnsi can't show become "?"; common punctuation is mapped. */
function winAnsi(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/·/g, '-')
    .replace(/[^ -~\u00a0-\u00ff]/g, '?');
}

const escape = (text: string) => text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/** Rough Helvetica width: good enough to wrap lines before the margin. */
const approxWidth = (text: string, size: number) => text.length * size * 0.52;

function wrap(line: PdfLine): PdfLine[] {
  const size = line.size ?? 10;
  const max = PAGE_WIDTH - 2 * MARGIN - (line.indent ?? 0);
  const words = winAnsi(line.text).split(' ');
  const out: PdfLine[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (approxWidth(candidate, size) > max && current !== '') {
      out.push({ ...line, text: current, gap: out.length === 0 ? line.gap : 0 });
      current = word;
    } else current = candidate;
  }
  out.push({ ...line, text: current, gap: out.length === 0 ? line.gap : 0 });
  return out;
}

export function renderPdf(input: { title: string; lines: PdfLine[]; footer?: string }): Uint8Array {
  const pages: string[] = [];
  let ops: string[] = [];
  let y = PAGE_HEIGHT - MARGIN;
  const flush = () => {
    if (input.footer !== undefined)
      ops.push(
        `BT /F1 8 Tf ${String(MARGIN)} 30 Td (${escape(winAnsi(`${input.footer} - page ${String(pages.length + 1)}`))}) Tj ET`,
      );
    pages.push(ops.join('\n'));
    ops = [];
    y = PAGE_HEIGHT - MARGIN;
  };
  for (const line of input.lines.flatMap(wrap)) {
    const size = line.size ?? 10;
    const advance = (line.gap ?? 0) + size * 1.4;
    if (y - advance < MARGIN) flush();
    y -= advance;
    ops.push(
      `BT /${line.bold === true ? 'F2' : 'F1'} ${String(size)} Tf ${String(MARGIN + (line.indent ?? 0))} ${y.toFixed(1)} Td (${escape(line.text)}) Tj ET`,
    );
  }
  flush();

  // Objects: 1 catalog, 2 pages, 3 Helvetica, 4 Helvetica-Bold, 5 info, then a page + content per page.
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 6 + i * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${String(id)} 0 R`).join(' ')}] /Count ${String(pages.length)} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  objects[5] = `<< /Title (${escape(winAnsi(input.title))}) /Producer (Aperture) >>`;
  pages.forEach((content, i) => {
    const pageId = pageIds[i] ?? 0;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${String(PAGE_WIDTH)} ${String(PAGE_HEIGHT)}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${String(pageId + 1)} 0 R >>`;
    objects[pageId + 1] =
      `<< /Length ${String(Buffer.byteLength(content, 'latin1'))} >>\nstream\n${content}\nendstream`;
  });

  let body = '%PDF-1.4\n%âãÏÓ\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(body, 'latin1');
    body += `${String(id)} 0 obj\n${objects[id] ?? 'null'}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${String(objects.length)}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) body += `${String(offsets[id] ?? 0).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${String(objects.length)} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(body, 'latin1'));
}
