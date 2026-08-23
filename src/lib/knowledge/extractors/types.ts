export interface ExtractedBlock {
  text: string;
  page?: number;
  headingPath?: string[];
}

export interface ExtractedDocument {
  titleHint?: string;
  languageHint?: string;
  blocks: ExtractedBlock[];
  parser: string;
  parserVersion: string;
  warnings: string[];
}

export type OcrImage = (image: Buffer, languages: string) => Promise<string>;

export interface ExtractKnowledgeInput {
  filePath: string;
  mimeType: string;
  originalName: string;
  ocrLanguages?: string;
  ocrImage?: OcrImage;
}
