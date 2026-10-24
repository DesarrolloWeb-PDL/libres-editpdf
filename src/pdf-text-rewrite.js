/**
 * Experimental rewriting of simple ASCII text in PDF page content streams.
 */
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFName,
  PDFRawStream,
  PDFRef,
} from 'pdf-lib';
import { t } from './i18n.js';

const TEXT_OBJECT_PATTERN = /\bBT\b([\s\S]*?)\bET\b/g;
const HEX_TEXT_PATTERN = /<([0-9a-fA-F\s]+)>\s*Tj\b/g;
const TEXT_SHOW_PATTERN = /\b(?:Tj|TJ)\b|(?:^|\s)['"](?=\s|$)/g;
const FONT_OR_CID_TEXT_PATTERN =
  /\/([A-Za-z0-9_.+#-]+)\s+[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][-+]?\d+)?\s+Tf\b|<([0-9a-fA-F\s]+)>\s*Tj\b/g;

/**
 * Replace one unambiguous, single-operation ASCII text object on a PDF page.
 */
export function replacePdfPageText(pdfDoc, pageIndex, originalText, replacementText) {
  assertNonEmptyText(originalText);
  assertNonEmptyText(replacementText);

  const page = pdfDoc.getPage(pageIndex);
  const contents = page.node.Contents();
  if (!contents) {
    throw new Error(t('text.noContent'));
  }

  const streams = contents instanceof PDFArray ? contents.asArray() : [contents];
  const directCandidates = [];

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
      directCandidates.push({
        entry,
        stream,
        streamIndex,
        source,
        start: operandStart,
        end: operandStart + tokenEnd,
      });
    }
  });

  if (directCandidates.length > 1) {
    throw new Error(t('text.ambiguousBlock'));
  }
  if (directCandidates.length === 1) {
    assertPrintableAscii(replacementText);
    const candidate = directCandidates[0];
    const replacementHex = `<${asciiToHex(replacementText)}>`;
    const updatedContent =
      candidate.source.slice(0, candidate.start) +
      replacementHex +
      candidate.source.slice(candidate.end);
    replaceContentStream(pdfDoc, page, contents, candidate, updatedContent);
    return;
  }

  const unicodeMaps = getPageUnicodeMaps(pdfDoc, page);
  const candidates = findUnicodeCandidates(
    pdfDoc,
    streams,
    originalText,
    unicodeMaps
  );
  if (candidates.length === 0) {
    throw new Error(t('text.unsupportedBlock'));
  }
  if (candidates.length > 1) {
    throw new Error(t('text.ambiguousBlock'));
  }

  const candidate = candidates[0];
  const replacementCharacters = Array.from(replacementText);
  if (replacementCharacters.length !== candidate.glyphs.length) {
    throw new Error(t('text.sameLengthOnly'));
  }

  const replacements = candidate.glyphs.map((glyph, index) => ({
    start: glyph.start,
    end: glyph.end,
    text: `<${encodeUnicodeGlyph(glyph, replacementCharacters[index])}>`,
  }));
  let updatedContent = candidate.source;
  replacements.sort((a, b) => b.start - a.start).forEach(({ start, end, text }) => {
    updatedContent = updatedContent.slice(0, start) + text + updatedContent.slice(end);
  });
  replaceContentStream(pdfDoc, page, contents, candidate, updatedContent);
}

function findUnicodeCandidates(pdfDoc, streams, originalText, unicodeMaps) {
  const originalCharacters = Array.from(originalText);
  const candidates = [];

  streams.forEach((entry, streamIndex) => {
    const stream = pdfDoc.context.lookup(entry);
    if (!(stream instanceof PDFRawStream)) return;

    const decodedBytes = decodePDFRawStream(stream).decode();
    const source = bytesToLatin1(decodedBytes);
    const glyphRuns = [];
    let currentRun = [];

    const finishRun = () => {
      if (currentRun.length > 0) glyphRuns.push(currentRun);
      currentRun = [];
    };

    for (const match of source.matchAll(TEXT_OBJECT_PATTERN)) {
      const body = match[1];
      const showOperators = [...body.matchAll(TEXT_SHOW_PATTERN)];
      if (showOperators.length === 0) continue;

      const textTokens = [...body.matchAll(FONT_OR_CID_TEXT_PATTERN)];
      const glyphTokens = textTokens.filter((token) => token[2]);
      if (
        showOperators.length !== glyphTokens.length ||
        showOperators.some((operator) => operator[0].trim() !== 'Tj')
      ) {
        finishRun();
        continue;
      }

      let fontMap = null;
      const blockGlyphs = [];
      let supported = true;
      for (const token of textTokens) {
        if (token[1]) {
          fontMap = unicodeMaps.get(token[1]) || null;
          continue;
        }

        const hex = token[2].replace(/\s/g, '').toUpperCase();
        const decoded = fontMap && decodeUnicodeGlyph(hex, fontMap);
        if (!decoded || Array.from(decoded.text).length !== 1) {
          supported = false;
          break;
        }
        const bodyStart = match.index + match[0].indexOf(body);
        const operandStart = bodyStart + token.index + token[0].indexOf('<');
        const tokenEnd = token[0].indexOf('>') + 1;
        blockGlyphs.push({
          character: decoded.text,
          code: decoded.code,
          unicodeMap: fontMap,
          entry,
          stream,
          streamIndex,
          source,
          start: operandStart,
          end: operandStart + tokenEnd,
        });
      }

      if (!supported || blockGlyphs.length !== glyphTokens.length) {
        finishRun();
        continue;
      }
      currentRun.push(...blockGlyphs);
    }
    finishRun();

    for (const run of glyphRuns) {
      for (let start = 0; start <= run.length - originalCharacters.length; start++) {
        const glyphs = run.slice(start, start + originalCharacters.length);
        if (glyphs.every((glyph, index) => glyph.character === originalCharacters[index])) {
          candidates.push({
            ...glyphs[0],
            glyphs,
          });
        }
      }
    }
  });

  return candidates;
}

function getPageUnicodeMaps(pdfDoc, page) {
  const resources = pdfDoc.context.lookup(page.node.Resources());
  const fontEntries = resources instanceof PDFDict
    ? pdfDoc.context.lookup(resources.get(PDFName.of('Font')))
    : null;
  const maps = new Map();
  if (!(fontEntries instanceof PDFDict)) return maps;

  for (const fontName of fontEntries.keys()) {
    const font = pdfDoc.context.lookup(fontEntries.get(fontName));
    if (!(font instanceof PDFDict)) continue;
    const toUnicode = font.get(PDFName.of('ToUnicode'));
    if (!toUnicode) continue;
    const cmapStream = pdfDoc.context.lookup(toUnicode);
    if (!(cmapStream instanceof PDFRawStream)) continue;

    const cmapBytes = decodePDFRawStream(cmapStream).decode();
    const cmapSource = bytesToLatin1(cmapBytes);
    const unicodeMap = parseToUnicodeCMap(cmapSource);
    if (unicodeMap) {
      Object.assign(unicodeMap, getCIDFontWidths(pdfDoc, font));
      maps.set(String(fontName).slice(1), unicodeMap);
    }
  }
  return maps;
}

function getCIDFontWidths(pdfDoc, type0Font) {
  const descendants = pdfDoc.context.lookup(type0Font.get(PDFName.of('DescendantFonts')));
  if (!(descendants instanceof PDFArray) || descendants.size() === 0) return {};

  const descendant = pdfDoc.context.lookup(descendants.get(0));
  if (!(descendant instanceof PDFDict)) return {};
  const defaultWidthObject = descendant.get(PDFName.of('DW'));
  const defaultWidth = defaultWidthObject?.asNumber();
  const widthArray = pdfDoc.context.lookup(descendant.get(PDFName.of('W')));
  const widths = new Map();
  if (!(widthArray instanceof PDFArray)) return { widths, defaultWidth };

  const entries = widthArray.asArray();
  for (let index = 0; index < entries.length;) {
    const firstCID = entries[index++]?.asNumber();
    const next = pdfDoc.context.lookup(entries[index++]);
    if (firstCID === undefined || !next) break;

    if (next instanceof PDFArray) {
      next.asArray().forEach((width, offset) => {
        const value = width.asNumber();
        if (value !== undefined) widths.set(firstCID + offset, value);
      });
      continue;
    }

    const lastCID = next.asNumber();
    const width = entries[index++]?.asNumber();
    if (lastCID === undefined || width === undefined) break;
    for (let cid = firstCID; cid <= lastCID; cid++) widths.set(cid, width);
  }

  return { widths, defaultWidth };
}

function parseToUnicodeCMap(source) {
  const unicodeByCode = new Map();
  const codeLengths = new Set();

  for (const section of source.matchAll(/begincodespacerange([\s\S]*?)endcodespacerange/g)) {
    for (const range of section[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      codeLengths.add(range[1].length);
    }
  }

  for (const section of source.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of section[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      unicodeByCode.set(pair[1].toUpperCase(), decodeUnicodeHex(pair[2]));
      codeLengths.add(pair[1].length);
    }
  }

  for (const section of source.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const range of section[1].matchAll(
      /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<([0-9a-fA-F]+)>|\[([\s\S]*?)\])/g
    )) {
      const first = parseInt(range[1], 16);
      const last = parseInt(range[2], 16);
      if (last < first || last - first > 0x10000) continue;
      codeLengths.add(range[1].length);

      if (range[5] !== undefined) {
        const destinations = [...range[5].matchAll(/<([0-9a-fA-F]+)>/g)];
        for (let offset = 0; offset <= last - first && offset < destinations.length; offset++) {
          const code = (first + offset).toString(16).toUpperCase().padStart(range[1].length, '0');
          unicodeByCode.set(code, decodeUnicodeHex(destinations[offset][1]));
        }
        continue;
      }

      const destinationStart = BigInt(`0x${range[4]}`);
      for (let codeValue = first; codeValue <= last; codeValue++) {
        const code = codeValue.toString(16).toUpperCase().padStart(range[1].length, '0');
        const destination = (destinationStart + BigInt(codeValue - first))
          .toString(16)
          .toUpperCase()
          .padStart(range[4].length, '0');
        unicodeByCode.set(code, decodeUnicodeHex(destination));
      }
    }
  }

  if (unicodeByCode.size === 0) return null;
  const codeLengthsDescending = [...codeLengths].sort((a, b) => b - a);
  const codeByUnicode = new Map();
  for (const [code, character] of unicodeByCode) {
    if (!character) continue;
    const codes = codeByUnicode.get(character) || [];
    codes.push(code);
    codeByUnicode.set(character, codes);
  }
  return { unicodeByCode, codeByUnicode, codeLengthsDescending };
}

function decodeUnicodeGlyph(hex, unicodeMap) {
  const normalized = hex.toUpperCase();
  let offset = 0;
  let text = '';
  let code = '';
  while (offset < normalized.length) {
    const length = unicodeMap.codeLengthsDescending.find((candidate) =>
      unicodeMap.unicodeByCode.has(normalized.slice(offset, offset + candidate))
    );
    if (!length) return null;
    const nextCode = normalized.slice(offset, offset + length);
    text += unicodeMap.unicodeByCode.get(nextCode);
    code += nextCode;
    offset += length;
  }
  return { text, code };
}

function decodeUnicodeHex(hex) {
  const normalized = hex.replace(/^FEFF/i, '');
  if (normalized.length % 4 !== 0) return null;
  let text = '';
  for (let i = 0; i < normalized.length; i += 4) {
    text += String.fromCharCode(Number.parseInt(normalized.slice(i, i + 4), 16));
  }
  return text;
}

function encodeUnicodeGlyph(glyph, character) {
  const codes = glyph.unicodeMap.codeByUnicode.get(character);
  if (!codes || codes.length === 0) {
    throw new Error(t('text.unsupportedReplacementGlyph'));
  }
  const code = codes.includes(glyph.code) ? glyph.code : codes[0];
  if (decodeUnicodeGlyph(code, glyph.unicodeMap)?.text !== character) {
    throw new Error(t('text.unsupportedReplacementGlyph'));
  }
  const sourceCID = Number.parseInt(glyph.code, 16);
  const replacementCID = Number.parseInt(code, 16);
  const sourceWidth = glyph.unicodeMap.widths?.get(sourceCID) ?? glyph.unicodeMap.defaultWidth;
  const replacementWidth =
    glyph.unicodeMap.widths?.get(replacementCID) ?? glyph.unicodeMap.defaultWidth;
  if (
    sourceWidth === undefined ||
    replacementWidth === undefined ||
    Math.abs(sourceWidth - replacementWidth) > 0.01
  ) {
    throw new Error(t('text.glyphWidthMismatch'));
  }
  return code;
}

function replaceContentStream(pdfDoc, page, contents, candidate, updatedContent) {
  const dictionary = candidate.stream.dict.clone(pdfDoc.context);
  dictionary.delete(PDFName.of('Filter'));
  dictionary.delete(PDFName.of('DecodeParms'));
  const replacementStream = PDFRawStream.of(dictionary, latin1ToBytes(updatedContent));

  if (candidate.entry instanceof PDFRef) {
    pdfDoc.context.assign(candidate.entry, replacementStream);
  } else if (contents instanceof PDFArray) {
    contents.set(candidate.streamIndex, replacementStream);
  } else {
    page.node.set(PDFName.of('Contents'), replacementStream);
  }
}

function assertNonEmptyText(text) {
  if (typeof text !== 'string' || text.length === 0 || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new Error(t('text.invalidInput'));
  }
}

function assertPrintableAscii(text) {
  if (typeof text !== 'string' || !/^[\x20-\x7e]+$/.test(text)) {
    throw new Error(t('text.replacementAsciiOnly'));
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
