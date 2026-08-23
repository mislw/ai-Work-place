import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  ExtractedBlock,
  ExtractedDocument,
  ExtractKnowledgeInput,
} from "@/lib/knowledge/extractors/types";

export async function extractTextDocument(
  input: ExtractKnowledgeInput,
): Promise<ExtractedDocument> {
  const content = stripBom(await readFile(input.filePath, "utf8"));
  const isMarkdown = input.mimeType === "text/markdown";
  const blocks = isMarkdown ? markdownBlocks(content) : plainTextBlocks(content);
  return {
    titleHint:
      blocks.find((block) => block.headingPath?.length)?.headingPath?.[0] ??
      path.parse(input.originalName).name,
    languageHint: guessLanguage(content),
    blocks,
    parser: isMarkdown ? "markdown" : "plain-text",
    parserVersion: "1",
    warnings: [],
  };
}

function markdownBlocks(content: string): ExtractedBlock[] {
  const blocks: ExtractedBlock[] = [];
  const headings: string[] = [];
  let paragraph: string[] = [];

  const flush = () => {
    const text = paragraph.join("\n").trim();
    if (text) {
      blocks.push({
        text,
        headingPath: headings.length > 0 ? [...headings] : undefined,
      });
    }
    paragraph = [];
  };

  for (const line of content.split(/\r?\n/)) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1]?.length ?? 1;
      headings.splice(level - 1);
      headings[level - 1] = heading[2]?.trim() ?? "";
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return blocks;
}

function plainTextBlocks(content: string): ExtractedBlock[] {
  return content
    .split(/(?:\r?\n){2,}/)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => ({ text }));
}

function stripBom(value: string) {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function guessLanguage(value: string) {
  return /[\u3400-\u9fff]/.test(value) ? "zh" : "en";
}
