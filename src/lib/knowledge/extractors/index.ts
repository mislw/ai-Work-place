import { SUPPORTED_KNOWLEDGE_MIME_TYPES } from "@/lib/knowledge/contracts";
import { extractDocxDocument } from "@/lib/knowledge/extractors/docx";
import { extractImageDocument } from "@/lib/knowledge/extractors/image";
import { extractPdfDocument } from "@/lib/knowledge/extractors/pdf";
import { extractTextDocument } from "@/lib/knowledge/extractors/text";
import type {
  ExtractedDocument,
  ExtractKnowledgeInput,
} from "@/lib/knowledge/extractors/types";

export type {
  ExtractedBlock,
  ExtractedDocument,
  ExtractKnowledgeInput,
  OcrImage,
} from "@/lib/knowledge/extractors/types";

export async function extractKnowledgeFile(
  input: ExtractKnowledgeInput,
): Promise<ExtractedDocument> {
  if (!SUPPORTED_KNOWLEDGE_MIME_TYPES.has(input.mimeType)) {
    throw new Error(`UNSUPPORTED_MIME_TYPE: ${input.mimeType}`);
  }
  if (input.mimeType === "text/plain" || input.mimeType === "text/markdown") {
    return extractTextDocument(input);
  }
  if (
    input.mimeType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return extractDocxDocument(input);
  }
  if (input.mimeType === "application/pdf") {
    return extractPdfDocument(input);
  }
  if (input.mimeType.startsWith("image/")) {
    return extractImageDocument(input);
  }
  throw new Error(`UNSUPPORTED_MIME_TYPE: ${input.mimeType}`);
}
