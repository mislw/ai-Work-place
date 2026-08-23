import type { ExtractedDocument } from "@/lib/knowledge/extractors";

export interface KnowledgeChunkDraft {
  chunkIndex: number;
  content: string;
  headingPath: string[];
  pageStart: number | null;
  pageEnd: number | null;
  charStart: number;
  charEnd: number;
}

interface ChunkOptions {
  targetCharacters?: number;
  hardCharacterCap?: number;
  overlapCharacters?: number;
}

interface Piece {
  text: string;
  headingPath: string[];
  page: number | null;
  charStart: number;
  charEnd: number;
}

export function chunkExtractedDocument(
  document: ExtractedDocument,
  options: ChunkOptions = {},
): KnowledgeChunkDraft[] {
  const target = options.targetCharacters ?? 3_200;
  const hardCap = options.hardCharacterCap ?? 4_000;
  const overlap = options.overlapCharacters ?? 400;
  if (target <= 0 || hardCap < target || overlap < 0 || overlap >= hardCap) {
    throw new Error("INVALID_CHUNK_OPTIONS");
  }

  const pieces = createPieces(document, hardCap);
  const chunks: KnowledgeChunkDraft[] = [];
  let current: Piece[] = [];

  const flush = (next?: Piece) => {
    if (current.length === 0) return;
    chunks.push(toChunk(current, chunks.length));
    const previous = current[current.length - 1];
    current = [];
    if (
      previous &&
      next &&
      sameAnchor(previous, next) &&
      overlap > 0 &&
      Math.min(overlap, previous.text.length) + 2 + next.text.length <= hardCap
    ) {
      const text = previous.text.slice(-overlap);
      current.push({
        ...previous,
        text,
        charStart: Math.max(previous.charEnd - text.length, previous.charStart),
      });
    }
  };

  for (const piece of pieces) {
    const currentLength = joinedLength(current);
    const separator = current.length > 0 ? 2 : 0;
    const anchorChanged =
      current.length > 0 && !sameAnchor(current[current.length - 1]!, piece);
    if (
      current.length > 0 &&
      (anchorChanged || currentLength + separator + piece.text.length > target)
    ) {
      flush(piece);
    }
    if (joinedLength(current) + (current.length > 0 ? 2 : 0) + piece.text.length > hardCap) {
      flush(piece);
    }
    current.push(piece);
  }
  flush();
  return chunks;
}

function createPieces(document: ExtractedDocument, hardCap: number) {
  const pieces: Piece[] = [];
  let documentOffset = 0;
  for (const block of document.blocks) {
    const text = block.text.replace(/\r/g, "").trim();
    if (!text) continue;
    const segments = splitText(text, hardCap);
    let localOffset = 0;
    for (const segment of segments) {
      const start = text.indexOf(segment, localOffset);
      const safeStart = start >= 0 ? start : localOffset;
      pieces.push({
        text: segment,
        headingPath: block.headingPath ? [...block.headingPath] : [],
        page: block.page ?? null,
        charStart: documentOffset + safeStart,
        charEnd: documentOffset + safeStart + segment.length,
      });
      localOffset = safeStart + segment.length;
    }
    documentOffset += text.length + 2;
  }
  return pieces;
}

function splitText(text: string, hardCap: number) {
  if (text.length <= hardCap) return [text];
  const sentences = text.match(/[^。！？.!?\n]+[。！？.!?]?|\n+/g) ?? [text];
  const segments: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (sentence.length > hardCap) {
      if (current) segments.push(current.trim());
      current = "";
      for (let index = 0; index < sentence.length; index += hardCap) {
        segments.push(sentence.slice(index, index + hardCap).trim());
      }
      continue;
    }
    if (current.length + sentence.length > hardCap) {
      segments.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current.trim()) segments.push(current.trim());
  return segments.filter(Boolean);
}

function sameAnchor(left: Piece, right: Piece) {
  return (
    left.page === right.page &&
    left.headingPath.length === right.headingPath.length &&
    left.headingPath.every((value, index) => value === right.headingPath[index])
  );
}

function joinedLength(pieces: Piece[]) {
  return pieces.reduce(
    (total, piece, index) => total + piece.text.length + (index > 0 ? 2 : 0),
    0,
  );
}

function toChunk(pieces: Piece[], chunkIndex: number): KnowledgeChunkDraft {
  const pages = pieces
    .map((piece) => piece.page)
    .filter((page): page is number => page !== null);
  return {
    chunkIndex,
    content: pieces.map((piece) => piece.text).join("\n\n"),
    headingPath: [...(pieces[0]?.headingPath ?? [])],
    pageStart: pages.length > 0 ? Math.min(...pages) : null,
    pageEnd: pages.length > 0 ? Math.max(...pages) : null,
    charStart: Math.min(...pieces.map((piece) => piece.charStart)),
    charEnd: Math.max(...pieces.map((piece) => piece.charEnd)),
  };
}
