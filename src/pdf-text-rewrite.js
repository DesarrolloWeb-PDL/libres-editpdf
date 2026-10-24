/**
 * Experimental rewriting of simple ASCII text in PDF page content streams.
 */
import {
  decodePDFRawStream,
  PDFArray,
  PDFName,
  PDFRawStream,
  PDFRef,
} from 'pdf-lib';

const TEXT_OBJECT_PATTERN = /\bBT\b([\s\S]*?)\bET\b/g;
const HEX_TEXT_PATTERN = /<([0-9a-fA-F\s]+)>\s*Tj\b/g;
const TEXT_SHOW_PATTERN = /\b(?:Tj|TJ)\b|(?:^|\s)['"](?=\s|$)/g;

/**
 * Replace one unambiguous, single-operation ASCII text object on a PDF page.
 */
export function replacePdfPageText(pdfDoc, pageIndex, originalText, replacementText) {
  assertPrintableAscii(originalText);
  assertPrintableAscii(replacementText);

  const page = pdfDoc.getPage(pageIndex);
  const contents = page.node.Contents();
  if (!contents) {
    throw new Error('This page has no editable content stream.');
  }

  const streams = contents instanceof PDFArray ? contents.asArray() : [contents];
  const candidates = [];

  streams.forEach((entry, streamIndex) => {
    const stream = pdfDoc.context.lookup(entry);
    if (!(stream instanceof PDFRawStream)) return;

    const decodedBytes = decodePDFRawStream(stream).decode();
    const source = bytesToLatin1(decodedBytes);

    for (const match of source.matchAll(TEXT_OBJECT_PATTERN)) {
      const body = match[1];
      const uncommentedBody = body.replace(/%[^\r\n]*/g, '');
      const showOperators = [...uncommentedBody.matchAll(TEXT_SHOW_PATTERN)];
      if (showOperators.length !== 1 || showOperators[0][0].trim() !== 'Tj') continue;

      const operands = [...body.matchAll(HEX_TEXT_PATTERN)];
      if (operands.length !== 1 || decodeHexAscii(operands[0][1]) !== originalText) continue;

      const bodyStart = match.index + match[0].indexOf(body);
      const operandStart = bodyStart + operands[0].index;
      const tokenEnd = operands[0][0].indexOf('>') + 1;
      candidates.push({
        entry,
        stream,
        streamIndex,
        source,
        start: operandStart,
        end: operandStart + tokenEnd,
      });
    }
  });

  if (candidates.length === 0) {
    throw new Error(
      'This text is not in a supported single-operation ASCII PDF text block.'
    );
  }
  if (candidates.length > 1) {
    throw new Error(
      'This text appears in multiple PDF text blocks; the edit is ambiguous.'
    );
  }

  const candidate = candidates[0];
  const replacementHex = `<${asciiToHex(replacementText)}>`;
  const updatedContent =
    candidate.source.slice(0, candidate.start) +
    replacementHex +
    candidate.source.slice(candidate.end);
  const dictionary = candidate.stream.dict.clone(pdfDoc.context);
  dictionary.delete(PDFName.of('Filter'));
  dictionary.delete(PDFName.of('DecodeParms'));

  const replacementStream = PDFRawStream.of(
    dictionary,
    latin1ToBytes(updatedContent)
  );

  if (candidate.entry instanceof PDFRef) {
    pdfDoc.context.assign(candidate.entry, replacementStream);
  } else if (contents instanceof PDFArray) {
    contents.set(candidate.streamIndex, replacementStream);
  } else {
    page.node.set(PDFName.of('Contents'), replacementStream);
  }
}

function assertPrintableAscii(text) {
  if (typeof text !== 'string' || !/^[\x20-\x7e]+$/.test(text)) {
    throw new Error('The prototype supports non-empty printable ASCII text only.');
  }
}

function bytesToLatin1(bytes) {
  let result = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    result += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return result;
}

function latin1ToBytes(text) {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}

function decodeHexAscii(hex) {
  const normalized = hex.replace(/\s/g, '');
  if (normalized.length % 2 !== 0) return null;

  let text = '';
  for (let i = 0; i < normalized.length; i += 2) {
    const value = Number.parseInt(normalized.slice(i, i + 2), 16);
    if (value < 0x20 || value > 0x7e) return null;
    text += String.fromCharCode(value);
  }
  return text;
}

function asciiToHex(text) {
  return [...text]
    .map((character) => character.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}
