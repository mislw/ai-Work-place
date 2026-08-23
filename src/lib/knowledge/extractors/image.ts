import path from "node:path";
import { readFile } from "node:fs/promises";
import type {
  ExtractedDocument,
  ExtractKnowledgeInput,
  OcrImage,
} from "@/lib/knowledge/extractors/types";

export async function extractImageDocument(
  input: ExtractKnowledgeInput,
): Promise<ExtractedDocument> {
  const ocrImage = input.ocrImage ?? defaultOcrImage;
  const text = normalizeOcrText(
    await ocrImage(
      await readFile(input.filePath),
      input.ocrLanguages ?? "chi_sim+eng",
    ),
  );
  return {
    titleHint: path.parse(input.originalName).name,
    languageHint: /[\u3400-\u9fff]/.test(text) ? "zh" : "en",
    blocks: text ? [{ text, page: 1 }] : [],
    parser: "tesseract",
    parserVersion: "7.0.0",
    warnings: text ? [] : ["OCR_NO_TEXT"],
  };
}

export const defaultOcrImage: OcrImage = async (image, languages) => {
  const { recognize } = await import("tesseract.js");
  const result = await recognize(image, languages);
  return result.data.text;
};

export function normalizeOcrText(value: string) {
  return value
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
