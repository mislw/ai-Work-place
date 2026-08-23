import path from "node:path";
import { isTag, type Node } from "domhandler";
import { DomUtils, parseDocument } from "htmlparser2";
import mammoth from "mammoth";
import type {
  ExtractedBlock,
  ExtractedDocument,
  ExtractKnowledgeInput,
} from "@/lib/knowledge/extractors/types";

export async function extractDocxDocument(
  input: ExtractKnowledgeInput,
): Promise<ExtractedDocument> {
  const result = await mammoth.convertToHtml(
    { path: input.filePath },
    {
      styleMap: [
        "p[style-name='heading 1'] => h1:fresh",
        "p[style-name='heading 2'] => h2:fresh",
        "p[style-name='heading 3'] => h3:fresh",
        "p[style-name='heading 4'] => h4:fresh",
        "p[style-name='heading 5'] => h5:fresh",
        "p[style-name='heading 6'] => h6:fresh",
      ],
    },
  );
  const headings: string[] = [];
  const blocks: ExtractedBlock[] = [];
  const document = parseDocument(result.value);

  visit(document.children, (node) => {
    if (!isTag(node)) return;
    const tag = node.name.toLowerCase();
    const text = DomUtils.textContent(node).replace(/\s+/g, " ").trim();
    if (!text) return;
    const heading = /^h([1-6])$/.exec(tag);
    if (heading) {
      const level = Number(heading[1]);
      headings.splice(level - 1);
      headings[level - 1] = text;
      return;
    }
    if (["p", "li", "pre", "blockquote"].includes(tag)) {
      blocks.push({
        text,
        headingPath: headings.length > 0 ? [...headings] : undefined,
      });
    }
  });

  const combined = blocks.map((block) => block.text).join("\n");
  return {
    titleHint: headings[0] ?? path.parse(input.originalName).name,
    languageHint: /[\u3400-\u9fff]/.test(combined) ? "zh" : "en",
    blocks,
    parser: "mammoth",
    parserVersion: "1.12.1",
    warnings: result.messages.map((message) => message.message),
  };
}

function visit(nodes: Node[], callback: (node: Node) => void) {
  for (const node of nodes) {
    callback(node);
    if ("children" in node && Array.isArray(node.children)) {
      visit(node.children, callback);
    }
  }
}
