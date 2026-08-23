// @vitest-environment node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chunkExtractedDocument } from "@/lib/knowledge/chunks";
import { extractKnowledgeFile } from "@/lib/knowledge/extractors";

const fixtureRoot = path.join(process.cwd(), "src", "tests", "fixtures", "knowledge");
let tempRoot: string;
let docxPath: string;
let textPdfPath: string;
let imagePath: string;
let imagePdfPath: string;

beforeAll(async () => {
  tempRoot = await mkdtemp(path.join(tmpdir(), "knowledge-extractors-"));
  docxPath = path.join(tempRoot, "headings.docx");
  textPdfPath = path.join(tempRoot, "two-pages.pdf");
  imagePath = path.join(tempRoot, "ocr.png");
  imagePdfPath = path.join(tempRoot, "image-only.pdf");

  await writeFile(docxPath, await createDocxFixture());
  await writeFile(
    textPdfPath,
    createTwoPageTextPdf("PAGE ONE Harness", "PAGE TWO Calendar"),
  );

  const canvas = createCanvas(900, 240);
  const context = canvas.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "black";
  context.font = "42px sans-serif";
  context.fillText("知识库 Knowledge Inbox", 40, 130);
  const png = canvas.toBuffer("image/png");
  await writeFile(imagePath, png);
  await writeFile(imagePdfPath, createImagePdf(canvas.width, canvas.height));
});

afterAll(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe("extractKnowledgeFile", () => {
  it("extracts UTF-8 text and Markdown heading anchors", async () => {
    const markdown = await extractKnowledgeFile({
      filePath: path.join(fixtureRoot, "sample.md"),
      mimeType: "text/markdown",
      originalName: "sample.md",
    });
    const text = await extractKnowledgeFile({
      filePath: path.join(fixtureRoot, "sample.txt"),
      mimeType: "text/plain",
      originalName: "sample.txt",
    });

    expect(markdown.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: "日历与待办需要用户确认后执行。",
          headingPath: ["Harness 接入", "工具调用"],
        }),
      ]),
    );
    expect(text.blocks.map((block) => block.text).join("\n")).toContain(
      "下午两点检查助手上传交互。",
    );
  });

  it("preserves DOCX heading hierarchy", async () => {
    const document = await extractKnowledgeFile({
      filePath: docxPath,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      originalName: "headings.docx",
    });

    expect(document.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: "Calendar details",
          headingPath: ["Harness Plan", "Calendar"],
        }),
      ]),
    );
  });

  it("extracts separate page anchors from a text PDF", async () => {
    const document = await extractKnowledgeFile({
      filePath: textPdfPath,
      mimeType: "application/pdf",
      originalName: "two-pages.pdf",
    });

    expect(document.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: expect.stringContaining("PAGE ONE Harness"), page: 1 }),
        expect.objectContaining({ text: expect.stringContaining("PAGE TWO Calendar"), page: 2 }),
      ]),
    );
  });

  it("uses OCR for images with the configured languages", async () => {
    const ocrImage = vi.fn().mockResolvedValue("知识库 Knowledge Inbox");

    const document = await extractKnowledgeFile({
      filePath: imagePath,
      mimeType: "image/png",
      originalName: "ocr.png",
      ocrLanguages: "chi_sim+eng",
      ocrImage,
    });

    expect(ocrImage).toHaveBeenCalledWith(expect.any(Buffer), "chi_sim+eng");
    expect(document.blocks[0]?.text).toContain("Knowledge Inbox");
  });

  it("renders image-only PDF pages through canvas before OCR", async () => {
    const ocrImage = vi.fn().mockResolvedValue("图片 PDF 已识别");

    const document = await extractKnowledgeFile({
      filePath: imagePdfPath,
      mimeType: "application/pdf",
      originalName: "image-only.pdf",
      ocrLanguages: "chi_sim+eng",
      ocrImage,
    });

    expect(ocrImage).toHaveBeenCalledWith(expect.any(Buffer), "chi_sim+eng");
    expect(document.blocks).toContainEqual(
      expect.objectContaining({ text: "图片 PDF 已识别", page: 1 }),
    );
  });
});

describe("chunkExtractedDocument", () => {
  it("keeps stable indexes and structural anchors under the hard cap", () => {
    const paragraph = "这是一个用于验证稳定分块的句子。".repeat(120);
    const chunks = chunkExtractedDocument(
      {
        parser: "fixture",
        parserVersion: "1",
        warnings: [],
        blocks: [
          { text: paragraph, page: 1, headingPath: ["第一章"] },
          { text: "第二页内容。".repeat(400), page: 2, headingPath: ["第二章"] },
        ],
      },
      { targetCharacters: 800, hardCharacterCap: 1_000, overlapCharacters: 120 },
    );

    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual(
      chunks.map((_, index) => index),
    );
    expect(chunks.every((chunk) => chunk.content.length <= 1_000)).toBe(true);
    expect(chunks[0]).toEqual(
      expect.objectContaining({ pageStart: 1, pageEnd: 1, headingPath: ["第一章"] }),
    );
    expect(chunks.some((chunk) => chunk.pageStart === 2)).toBe(true);
    expect(chunks.every((chunk) => chunk.charEnd > chunk.charStart)).toBe(true);
  });
});

async function createDocxFixture() {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`,
  );
  zip.folder("_rels")?.file(
    ".rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.folder("word")?.file(
    "styles.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>
</w:styles>`,
  );
  zip.folder("word")?.file(
    "document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Harness Plan</w:t></w:r></w:p>
    <w:p><w:r><w:t>Overview text</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Calendar</w:t></w:r></w:p>
    <w:p><w:r><w:t>Calendar details</w:t></w:r></w:p>
    <w:sectPr/>
  </w:body>
</w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

function createTwoPageTextPdf(pageOne: string, pageTwo: string) {
  return buildPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>",
    pdfStream(`BT /F1 18 Tf 72 720 Td (${escapePdf(pageOne)}) Tj ET`),
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>",
    pdfStream(`BT /F1 18 Tf 72 720 Td (${escapePdf(pageTwo)}) Tj ET`),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ]);
}

function createImagePdf(width: number, height: number) {
  const content = Buffer.from(
    "0 g 40 80 760 80 re f 40 160 500 24 re f 560 160 240 24 re f",
  );
  return buildPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << >> /Contents 4 0 R >>`,
    pdfStream(content),
  ]);
}

function pdfStream(content: string | Buffer) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return Buffer.concat([
    Buffer.from(`<< /Length ${buffer.length} >>\nstream\n`),
    buffer,
    Buffer.from("\nendstream"),
  ]);
}

function buildPdf(objects: Array<string | Buffer>) {
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n%\xFF\xFF\xFF\xFF\n", "binary")];
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.concat(parts).length);
    parts.push(Buffer.from(`${index + 1} 0 obj\n`));
    parts.push(Buffer.isBuffer(object) ? object : Buffer.from(object));
    parts.push(Buffer.from("\nendobj\n"));
  }
  const xrefOffset = Buffer.concat(parts).length;
  parts.push(Buffer.from(`xref\n0 ${objects.length + 1}\n`));
  parts.push(Buffer.from("0000000000 65535 f \n"));
  for (const offset of offsets.slice(1)) {
    parts.push(Buffer.from(`${String(offset).padStart(10, "0")} 00000 n \n`));
  }
  parts.push(
    Buffer.from(
      `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(parts);
}

function escapePdf(value: string) {
  return value.replace(/([\\()])/g, "\\$1");
}
