import path from "node:path";
import { readFile } from "node:fs/promises";
import { createCanvas } from "@napi-rs/canvas";
import { defaultOcrImage, normalizeOcrText } from "@/lib/knowledge/extractors/image";
import type {
  ExtractedBlock,
  ExtractedDocument,
  ExtractKnowledgeInput,
} from "@/lib/knowledge/extractors/types";

export async function extractPdfDocument(
  input: ExtractKnowledgeInput,
): Promise<ExtractedDocument> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const bytes = await readFile(input.filePath);
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
  });
  const document = await task.promise;
  const blocks: ExtractedBlock[] = [];
  const warnings: string[] = [];
  const ocrImage = input.ocrImage ?? defaultOcrImage;

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const text = textContent.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (text.length >= 8) {
        blocks.push({ text, page: pageNumber });
        continue;
      }

      const viewport = page.getViewport({ scale: 2 });
      const canvas = createCanvas(
        Math.max(1, Math.ceil(viewport.width)),
        Math.max(1, Math.ceil(viewport.height)),
      );
      await page.render({
        canvasContext: canvas.getContext("2d") as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;
      const ocrText = normalizeOcrText(
        await ocrImage(
          canvas.toBuffer("image/png"),
          input.ocrLanguages ?? "chi_sim+eng",
        ),
      );
      if (ocrText) blocks.push({ text: ocrText, page: pageNumber });
      else warnings.push(`OCR_NO_TEXT_PAGE_${pageNumber}`);
    }
  } finally {
    await document.destroy();
  }

  const combined = blocks.map((block) => block.text).join("\n");
  return {
    titleHint: path.parse(input.originalName).name,
    languageHint: /[\u3400-\u9fff]/.test(combined) ? "zh" : "en",
    blocks,
    parser: "pdfjs+tesseract",
    parserVersion: "4.10.38+7.0.0",
    warnings,
  };
}
