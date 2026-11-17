import JSZip from 'jszip';
import mammoth from 'mammoth';

export interface DocumentMarginsMm {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface DocumentBaseStyle {
  fontFamily: string;
  fontSizePt: number;
  lineHeight: string;
  paraMarginBottomPt: number;
}

export interface ParsedDocxResult {
  html: string;
  pageSize?: 'a4' | 'letter';
  orientation?: 'portrait' | 'landscape';
  marginsMm?: DocumentMarginsMm;
  baseStyle?: DocumentBaseStyle;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getAttr(el: Element | null | undefined, localName: string): string | null {
  if (!el) return null;
  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes[i];
    if (
      attr.localName === localName ||
      attr.name === `w:${localName}` ||
      attr.name === localName
    ) {
      return attr.value;
    }
  }
  return null;
}

function findChild(parent: Element, localName: string): Element | null {
  for (let i = 0; i < parent.children.length; i++) {
    const c = parent.children[i];
    if (c.localName === localName) return c;
  }
  return null;
}

function findChildren(parent: Element, localName: string): Element[] {
  const res: Element[] = [];
  for (let i = 0; i < parent.children.length; i++) {
    const c = parent.children[i];
    if (c.localName === localName) res.push(c);
  }
  return res;
}

function findDescendants(parent: Element, localName: string): Element[] {
  const res: Element[] = [];
  const walk = (node: Element) => {
    for (let i = 0; i < node.children.length; i++) {
      const c = node.children[i];
      if (c.localName === localName) res.push(c);
      walk(c);
    }
  };
  walk(parent);
  return res;
}

function twipsToPx(twips: number): number {
  return (twips / 1440) * 96;
}

function twipsToMm(twips: number): number {
  return (twips / 1440) * 25.4;
}

export function mapWordFontToCss(rawFont: string | undefined | null): string | undefined {
  if (!rawFont) return undefined;
  const clean = rawFont.trim();
  if (!clean) return undefined;
  const lower = clean.toLowerCase();

  if (lower.includes('times new roman') || lower === 'times') {
    return '"Times New Roman", "Tinos", "Liberation Serif", Georgia, serif';
  }
  if (lower === 'calibri' || lower === 'calibri light') {
    return `"${clean}", "Carlito", "Liberation Sans", Arial, sans-serif`;
  }
  if (lower === 'cambria' || lower === 'cambria math') {
    return `"${clean}", "Caladea", Georgia, serif`;
  }
  if (lower === 'arial' || lower === 'helvetica') {
    return `"${clean}", "Arimo", "Liberation Sans", sans-serif`;
  }
  if (lower === 'courier new' || lower === 'courier' || lower === 'consolas') {
    return `"${clean}", "Cousine", monospace`;
  }
  if (lower.includes('garamond') || lower.includes('palatino') || lower.includes('book antiqua') || lower.includes('baskerville') || lower.includes('bodoni')) {
    return `"${clean}", "EB Garamond", "Tinos", Georgia, serif`;
  }
  if (lower === 'georgia' || lower.includes('bookman') || lower.includes('century schoolbook') || lower.includes('rockwell')) {
    return `"${clean}", Georgia, "Tinos", serif`;
  }
  if (lower.includes('mono') || lower.includes('consolas') || lower.includes('courier') || lower.includes('menlo') || lower.includes('lucida console')) {
    return `"${clean}", "Cousine", monospace`;
  }
  if (lower === 'aptos' || lower === 'aptos display') {
    return `"${clean}", "Carlito", "Inter", Arial, sans-serif`;
  }
  if (lower === 'tahoma' || lower === 'verdana' || lower === 'trebuchet ms' || lower === 'segoe ui') {
    return `"${clean}", "Arimo", "Open Sans", sans-serif`;
  }
  if (lower.includes('serif') && !lower.includes('sans')) {
    return `"${clean}", "Tinos", Georgia, serif`;
  }
  return `"${clean}", "Carlito", "Arimo", Arial, sans-serif`;
}

interface ThemeFonts {
  major: string;
  minor: string;
}

function parseThemeFonts(themeXmlText: string | null): ThemeFonts {
  const defaults: ThemeFonts = { major: 'Cambria', minor: 'Calibri' };
  if (!themeXmlText) return defaults;
  try {
    const doc = new DOMParser().parseFromString(themeXmlText, 'application/xml');
    const majorFontEl = findDescendants(doc.documentElement, 'majorFont')[0];
    const minorFontEl = findDescendants(doc.documentElement, 'minorFont')[0];
    if (majorFontEl) {
      const latin = findChild(majorFontEl, 'latin');
      const tf = getAttr(latin, 'typeface');
      if (tf) defaults.major = tf;
    }
    if (minorFontEl) {
      const latin = findChild(minorFontEl, 'latin');
      const tf = getAttr(latin, 'typeface');
      if (tf) defaults.minor = tf;
    }
  } catch {
    // ignore malformed theme
  }
  return defaults;
}

function extractFontFromRPr(rPr: Element | null, theme: ThemeFonts): string | undefined {
  if (!rPr) return undefined;
  const rFonts = findChild(rPr, 'rFonts');
  if (!rFonts) return undefined;

  const explicit =
    getAttr(rFonts, 'ascii') ||
    getAttr(rFonts, 'hAnsi') ||
    getAttr(rFonts, 'cs') ||
    getAttr(rFonts, 'eastAsia');
  if (explicit) return explicit;

  const themeAttr = getAttr(rFonts, 'asciiTheme') || getAttr(rFonts, 'hAnsiTheme');
  if (themeAttr) {
    if (themeAttr.startsWith('major')) return theme.major;
    if (themeAttr.startsWith('minor')) return theme.minor;
  }
  return undefined;
}

interface StyleDef {
  name?: string;
  basedOn?: string;
  fontFamilyRaw?: string;
  fontSizePt?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  caps?: boolean;
  color?: string;
  align?: string;
  spaceBeforePt?: number;
  spaceAfterPt?: number;
  lineHeightCss?: string;
}

function extractSpacingFromPPr(pPr: Element): {
  spaceBeforePt?: number;
  spaceAfterPt?: number;
  lineHeightCss?: string;
} {
  const res: { spaceBeforePt?: number; spaceAfterPt?: number; lineHeightCss?: string } = {};
  const spacing = findChild(pPr, 'spacing');
  if (!spacing) return res;

  const before = getAttr(spacing, 'before');
  const after = getAttr(spacing, 'after');
  const line = getAttr(spacing, 'line');
  const lineRule = getAttr(spacing, 'lineRule') || 'auto';

  if (before !== null && !Number.isNaN(Number.parseInt(before, 10))) {
    res.spaceBeforePt = Number.parseInt(before, 10) / 20;
  }
  if (after !== null && !Number.isNaN(Number.parseInt(after, 10))) {
    res.spaceAfterPt = Number.parseInt(after, 10) / 20;
  }
  if (line !== null && !Number.isNaN(Number.parseInt(line, 10))) {
    const lineNum = Number.parseInt(line, 10);
    if (lineRule === 'auto') {
      const ratio = Math.max(0.9, lineNum / 240);
      res.lineHeightCss = ratio.toFixed(2);
    } else {
      res.lineHeightCss = `${(lineNum / 20).toFixed(1)}pt`;
    }
  }
  return res;
}

function extractRPrProps(rPr: Element, theme: ThemeFonts): Partial<StyleDef> {
  const out: Partial<StyleDef> = {};
  const fontRaw = extractFontFromRPr(rPr, theme);
  if (fontRaw) out.fontFamilyRaw = fontRaw;

  const sz = findChild(rPr, 'sz') || findChild(rPr, 'szCs');
  const szVal = getAttr(sz, 'val');
  if (szVal) {
    const pt = Number.parseInt(szVal, 10) / 2;
    if (!Number.isNaN(pt) && pt > 0) out.fontSizePt = pt;
  }

  const b = findChild(rPr, 'b');
  if (b) out.bold = getAttr(b, 'val') !== '0' && getAttr(b, 'val') !== 'false';

  const it = findChild(rPr, 'i');
  if (it) out.italic = getAttr(it, 'val') !== '0' && getAttr(it, 'val') !== 'false';

  const u = findChild(rPr, 'u');
  if (u) out.underline = getAttr(u, 'val') !== 'none';

  const caps = findChild(rPr, 'caps');
  if (caps) out.caps = getAttr(caps, 'val') !== '0' && getAttr(caps, 'val') !== 'false';

  const col = findChild(rPr, 'color');
  const colVal = getAttr(col, 'val');
  if (colVal && colVal !== 'auto') out.color = `#${colVal}`;

  return out;
}

function parseStylesAndDefaults(
  xmlText: string | null,
  theme: ThemeFonts
): { stylesMap: Map<string, StyleDef>; docDefault: StyleDef; defaultParagraphStyleId: string | null } {
  const stylesMap = new Map<string, StyleDef>();
  const docDefault: StyleDef = {
    fontFamilyRaw: theme.minor,
    fontSizePt: 11,
    lineHeightCss: '1.15',
    spaceAfterPt: 8,
  };
  let defaultParagraphStyleId: string | null = null;

  if (!xmlText) return { stylesMap, docDefault, defaultParagraphStyleId };

  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  const root = doc.documentElement;

  const docDefaultsEl = findChild(root, 'docDefaults');
  if (docDefaultsEl) {
    const rPrDefault = findChild(docDefaultsEl, 'rPrDefault');
    const rPr = rPrDefault ? findChild(rPrDefault, 'rPr') : null;
    if (rPr) {
      Object.assign(docDefault, extractRPrProps(rPr, theme));
    }
    const pPrDefault = findChild(docDefaultsEl, 'pPrDefault');
    const pPr = pPrDefault ? findChild(pPrDefault, 'pPr') : null;
    if (pPr) {
      const sp = extractSpacingFromPPr(pPr);
      if (sp.spaceBeforePt !== undefined) docDefault.spaceBeforePt = sp.spaceBeforePt;
      if (sp.spaceAfterPt !== undefined) docDefault.spaceAfterPt = sp.spaceAfterPt;
      if (sp.lineHeightCss !== undefined) docDefault.lineHeightCss = sp.lineHeightCss;
    }
  }

  const styles = findDescendants(root, 'style');
  for (const st of styles) {
    const styleId = getAttr(st, 'styleId');
    if (!styleId) continue;

    if (getAttr(st, 'type') === 'paragraph' && getAttr(st, 'default') === '1') {
      defaultParagraphStyleId = styleId;
    }

    const nameEl = findChild(st, 'name');
    const basedOnEl = findChild(st, 'basedOn');
    const rPr = findChild(st, 'rPr');
    const pPr = findChild(st, 'pPr');

    const def: StyleDef = {
      name: getAttr(nameEl, 'val') ?? undefined,
      basedOn: getAttr(basedOnEl, 'val') ?? undefined,
    };

    if (rPr) {
      Object.assign(def, extractRPrProps(rPr, theme));
    }

    if (pPr) {
      const jc = findChild(pPr, 'jc');
      const jcVal = getAttr(jc, 'val');
      if (jcVal) def.align = jcVal;
      const sp = extractSpacingFromPPr(pPr);
      if (sp.spaceBeforePt !== undefined) def.spaceBeforePt = sp.spaceBeforePt;
      if (sp.spaceAfterPt !== undefined) def.spaceAfterPt = sp.spaceAfterPt;
      if (sp.lineHeightCss !== undefined) def.lineHeightCss = sp.lineHeightCss;
    }

    stylesMap.set(styleId, def);
  }

  return { stylesMap, docDefault, defaultParagraphStyleId };
}

function resolveStyleChain(
  styleId: string | null,
  stylesMap: Map<string, StyleDef>,
  docDefault: StyleDef
): StyleDef {
  const merged: StyleDef = { ...docDefault };
  if (!styleId) return merged;
  const chain: StyleDef[] = [];
  let cur: string | undefined = styleId;
  const visited = new Set<string>();

  while (cur && !visited.has(cur)) {
    visited.add(cur);
    const def = stylesMap.get(cur);
    if (!def) break;
    chain.unshift(def);
    cur = def.basedOn;
  }

  for (const s of chain) {
    if (s.name !== undefined) merged.name = s.name;
    if (s.fontFamilyRaw !== undefined) merged.fontFamilyRaw = s.fontFamilyRaw;
    if (s.fontSizePt !== undefined) merged.fontSizePt = s.fontSizePt;
    if (s.bold !== undefined) merged.bold = s.bold;
    if (s.italic !== undefined) merged.italic = s.italic;
    if (s.underline !== undefined) merged.underline = s.underline;
    if (s.caps !== undefined) merged.caps = s.caps;
    if (s.color !== undefined) merged.color = s.color;
    if (s.align !== undefined) merged.align = s.align;
    if (s.spaceBeforePt !== undefined) merged.spaceBeforePt = s.spaceBeforePt;
    if (s.spaceAfterPt !== undefined) merged.spaceAfterPt = s.spaceAfterPt;
    if (s.lineHeightCss !== undefined) merged.lineHeightCss = s.lineHeightCss;
  }
  return merged;
}

function parseNumberingTypes(xmlText: string | null): Map<string, 'ol' | 'ul'> {
  const result = new Map<string, 'ol' | 'ul'>();
  if (!xmlText) return result;
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  const abstractFormats = new Map<string, 'ol' | 'ul'>();

  for (const abs of findDescendants(doc.documentElement, 'abstractNum')) {
    const absId = getAttr(abs, 'abstractNumId');
    if (!absId) continue;
    const lvl = findChild(abs, 'lvl');
    const numFmt = lvl ? findChild(lvl, 'numFmt') : null;
    const val = getAttr(numFmt, 'val') || 'bullet';
    abstractFormats.set(absId, val === 'bullet' ? 'ul' : 'ol');
  }

  for (const num of findDescendants(doc.documentElement, 'num')) {
    const numId = getAttr(num, 'numId');
    const absRef = findChild(num, 'abstractNumId');
    const absId = getAttr(absRef, 'val');
    if (numId && absId) {
      result.set(numId, abstractFormats.get(absId) || 'ul');
    }
  }
  return result;
}

function mapHighlightColor(val: string | null): string | null {
  if (!val || val === 'none') return null;
  const table: Record<string, string> = {
    yellow: '#fef08a',
    green: '#bbf7d0',
    cyan: '#a5f3fc',
    magenta: '#f5d0fe',
    blue: '#bfdbfe',
    red: '#fecaca',
    darkBlue: '#93c5fd',
    darkCyan: '#99f6e4',
    darkGreen: '#86efac',
    darkMagenta: '#e9d5ff',
    darkRed: '#fca5a5',
    darkYellow: '#fde047',
    lightGray: '#e4e4e7',
    darkGray: '#d4d4d8',
  };
  return table[val] || val;
}

export async function parseDocxToHtml(arrayBuffer: ArrayBuffer): Promise<ParsedDocxResult> {
  try {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const docXmlFile = zip.file('word/document.xml');
    if (!docXmlFile) {
      throw new Error('word/document.xml tidak ditemukan');
    }

    const docXmlText = await docXmlFile.async('text');
    const stylesXmlText = (await zip.file('word/styles.xml')?.async('text')) ?? null;
    const themeXmlText = (await zip.file('word/theme/theme1.xml')?.async('text')) ?? null;
    const numberingXmlText = (await zip.file('word/numbering.xml')?.async('text')) ?? null;
    const relsXmlText = (await zip.file('word/_rels/document.xml.rels')?.async('text')) ?? null;

    const themeFonts = parseThemeFonts(themeXmlText);
    const { stylesMap, docDefault, defaultParagraphStyleId } = parseStylesAndDefaults(
      stylesXmlText,
      themeFonts
    );
    const normalStyle = resolveStyleChain(
      defaultParagraphStyleId || 'Normal',
      stylesMap,
      docDefault
    );
    const numberingMap = parseNumberingTypes(numberingXmlText);

    const baseStyle: DocumentBaseStyle = {
      fontFamily:
        mapWordFontToCss(normalStyle.fontFamilyRaw) ||
        '"Calibri", "Carlito", "Liberation Sans", Arial, sans-serif',
      fontSizePt: normalStyle.fontSizePt || 11,
      lineHeight: normalStyle.lineHeightCss || '1.15',
      paraMarginBottomPt: normalStyle.spaceAfterPt ?? 8,
    };

    // Load relationship targets & embedded media images
    const relMap = new Map<string, string>();
    const mediaCache = new Map<string, string>();

    if (relsXmlText) {
      const relsDoc = new DOMParser().parseFromString(relsXmlText, 'application/xml');
      for (const rel of findDescendants(relsDoc.documentElement, 'Relationship')) {
        const id = getAttr(rel, 'Id');
        const target = getAttr(rel, 'Target');
        if (id && target) {
          relMap.set(id, target);
        }
      }
    }

    for (const [id, target] of relMap.entries()) {
      const cleanPath = target.startsWith('/')
        ? target.slice(1)
        : `word/${target.replace(/^\.\//, '')}`;
      const mediaFile = zip.file(cleanPath);
      if (mediaFile) {
        const ext = cleanPath.split('.').pop()?.toLowerCase() || 'png';
        const mime =
          ext === 'jpg' || ext === 'jpeg'
            ? 'image/jpeg'
            : ext === 'webp'
              ? 'image/webp'
              : ext === 'gif'
                ? 'image/gif'
                : ext === 'svg'
                  ? 'image/svg+xml'
                  : 'image/png';
        const b64 = await mediaFile.async('base64');
        mediaCache.set(id, `data:${mime};base64,${b64}`);
      }
    }

    const xmlDoc = new DOMParser().parseFromString(docXmlText, 'application/xml');
    const body = findChild(xmlDoc.documentElement, 'body');
    if (!body) throw new Error('Body dokumen tidak ditemukan');

    // Detect page size, orientation, & margins from sectPr
    let pageSize: 'a4' | 'letter' | undefined;
    let orientation: 'portrait' | 'landscape' | undefined;
    let marginsMm: DocumentMarginsMm | undefined;

    const sectPr = findChild(body, 'sectPr') || findDescendants(body, 'sectPr').pop();
    if (sectPr) {
      const pgSz = findChild(sectPr, 'pgSz');
      if (pgSz) {
        const w = Number.parseInt(getAttr(pgSz, 'w') || '0', 10);
        const h = Number.parseInt(getAttr(pgSz, 'h') || '0', 10);
        const orient = getAttr(pgSz, 'orient');
        if (orient === 'landscape' || (w > 0 && h > 0 && w > h)) {
          orientation = 'landscape';
        } else {
          orientation = 'portrait';
        }
        const longSide = Math.max(w, h);
        if (longSide > 0) {
          pageSize = Math.abs(longSide - 15840) < Math.abs(longSide - 16838) ? 'letter' : 'a4';
        }
      }

      const pgMar = findChild(sectPr, 'pgMar');
      if (pgMar) {
        const top = Number.parseInt(getAttr(pgMar, 'top') || '1440', 10);
        const right = Number.parseInt(getAttr(pgMar, 'right') || '1440', 10);
        const bottom = Number.parseInt(getAttr(pgMar, 'bottom') || '1440', 10);
        const left = Number.parseInt(getAttr(pgMar, 'left') || '1440', 10);
        marginsMm = {
          top: Math.max(4, Math.min(60, Math.round(twipsToMm(top) * 10) / 10)),
          right: Math.max(4, Math.min(60, Math.round(twipsToMm(right) * 10) / 10)),
          bottom: Math.max(4, Math.min(60, Math.round(twipsToMm(bottom) * 10) / 10)),
          left: Math.max(4, Math.min(60, Math.round(twipsToMm(left) * 10) / 10)),
        };
      }
    }

    const renderRun = (run: Element, paraStyle: StyleDef): string => {
      const rPr = findChild(run, 'rPr');
      const rStyleEl = rPr ? findChild(rPr, 'rStyle') : null;
      const rStyleId = getAttr(rStyleEl, 'val');
      const charStyle = rStyleId ? stylesMap.get(rStyleId) : undefined;

      const cssParts: string[] = [];

      const runFontRaw = extractFontFromRPr(rPr, themeFonts) || charStyle?.fontFamilyRaw;
      const runFontCss = mapWordFontToCss(runFontRaw);
      if (runFontCss) {
        cssParts.push(`font-family:${runFontCss}`);
      }

      const sz = rPr ? findChild(rPr, 'sz') || findChild(rPr, 'szCs') : null;
      const szVal = getAttr(sz, 'val');
      if (szVal) {
        cssParts.push(`font-size:${Number.parseInt(szVal, 10) / 2}pt`);
      } else if (charStyle?.fontSizePt) {
        cssParts.push(`font-size:${charStyle.fontSizePt}pt`);
      }

      const b = rPr ? findChild(rPr, 'b') : null;
      if (b) {
        const isBold = getAttr(b, 'val') !== '0' && getAttr(b, 'val') !== 'false';
        cssParts.push(`font-weight:${isBold ? 700 : 400}`);
      } else if (charStyle?.bold !== undefined) {
        cssParts.push(`font-weight:${charStyle.bold ? 700 : 400}`);
      }

      const it = rPr ? findChild(rPr, 'i') : null;
      if (it) {
        const isItalic = getAttr(it, 'val') !== '0' && getAttr(it, 'val') !== 'false';
        cssParts.push(`font-style:${isItalic ? 'italic' : 'normal'}`);
      } else if (charStyle?.italic !== undefined) {
        cssParts.push(`font-style:${charStyle.italic ? 'italic' : 'normal'}`);
      }

      const caps = rPr ? findChild(rPr, 'caps') : null;
      const smallCaps = rPr ? findChild(rPr, 'smallCaps') : null;
      if (caps && getAttr(caps, 'val') !== '0' && getAttr(caps, 'val') !== 'false') {
        cssParts.push('text-transform:uppercase');
      } else if (smallCaps && getAttr(smallCaps, 'val') !== '0' && getAttr(smallCaps, 'val') !== 'false') {
        cssParts.push('font-variant:small-caps');
      }

      const u = rPr ? findChild(rPr, 'u') : null;
      const uVal = getAttr(u, 'val');
      const strike = rPr ? findChild(rPr, 'strike') : null;
      const dstrike = rPr ? findChild(rPr, 'dstrike') : null;
      const decorations: string[] = [];
      if (u && uVal !== 'none') decorations.push('underline');
      if (strike || dstrike) decorations.push('line-through');
      if (decorations.length > 0) cssParts.push(`text-decoration:${decorations.join(' ')}`);

      const col = rPr ? findChild(rPr, 'color') : null;
      const colVal = getAttr(col, 'val');
      if (colVal && colVal !== 'auto') {
        cssParts.push(`color:#${colVal}`);
      } else if (charStyle?.color) {
        cssParts.push(`color:${charStyle.color}`);
      } else if (paraStyle.color) {
        cssParts.push(`color:${paraStyle.color}`);
      }

      const hl = rPr ? findChild(rPr, 'highlight') : null;
      const hlColor = mapHighlightColor(getAttr(hl, 'val'));
      if (hlColor) {
        cssParts.push(`background-color:${hlColor}`);
      } else {
        const shd = rPr ? findChild(rPr, 'shd') : null;
        const fill = getAttr(shd, 'fill');
        if (fill && fill !== 'auto') {
          cssParts.push(`background-color:#${fill}`);
        }
      }

      const vertAlign = rPr ? findChild(rPr, 'vertAlign') : null;
      const vVal = getAttr(vertAlign, 'val');

      let inner = '';
      for (let i = 0; i < run.children.length; i++) {
        const child = run.children[i];
        if (child.localName === 't') {
          inner += escapeHtml(child.textContent || '');
        } else if (child.localName === 'tab') {
          inner += '<span style="display:inline-block;width:2em"> </span>';
        } else if (child.localName === 'br') {
          const brType = getAttr(child, 'type');
          if (brType === 'page') {
            inner += '<!--DOCX_PAGE_BREAK-->';
          } else {
            inner += '<br/>';
          }
        } else if (child.localName === 'drawing' || child.localName === 'pict') {
          const blips = findDescendants(child, 'blip');
          const imgDatas = findDescendants(child, 'imagedata');
          let relId: string | null = null;
          if (blips.length > 0) {
            relId = getAttr(blips[0], 'embed') || getAttr(blips[0], 'link');
          } else if (imgDatas.length > 0) {
            relId = getAttr(imgDatas[0], 'id');
          }

          if (relId && mediaCache.has(relId)) {
            const extent = findDescendants(child, 'extent')[0];
            const cx = Number.parseInt(getAttr(extent, 'cx') || '0', 10);
            const cy = Number.parseInt(getAttr(extent, 'cy') || '0', 10);
            const wPx = cx > 0 ? Math.round((cx / 914400) * 96) : null;
            const hPx = cy > 0 ? Math.round((cy / 914400) * 96) : null;
            const imgStyle = [
              'max-width:100%',
              'display:inline-block',
              wPx ? `width:${wPx}px` : '',
              hPx ? `height:${hPx}px` : 'height:auto',
            ]
              .filter(Boolean)
              .join(';');
            inner += `<img src="${mediaCache.get(relId)}" style="${imgStyle}" alt="Gambar dokumen" />`;
          }
        }
      }

      if (!inner) return '';
      if (vVal === 'superscript') inner = `<sup>${inner}</sup>`;
      if (vVal === 'subscript') inner = `<sub>${inner}</sub>`;

      if (cssParts.length > 0 && !inner.includes('<!--DOCX_PAGE_BREAK-->')) {
        return `<span style="${cssParts.join(';')}">${inner}</span>`;
      }
      return inner;
    };

    const renderParagraph = (
      p: Element,
      inTable = false
    ): { html: string; listType: 'ol' | 'ul' | null } => {
      const pPr = findChild(p, 'pPr');
      const pStyleEl = pPr ? findChild(pPr, 'pStyle') : null;
      const pStyleId = getAttr(pStyleEl, 'val') || defaultParagraphStyleId || 'Normal';
      const resolvedStyle = resolveStyleChain(pStyleId, stylesMap, docDefault);

      // Extract pPr -> rPr defaults for empty paragraphs or paragraph-level run defaults
      const pRPr = pPr ? findChild(pPr, 'rPr') : null;
      const pRPrProps = pRPr ? extractRPrProps(pRPr, themeFonts) : {};
      const effectiveStyle: StyleDef = { ...resolvedStyle, ...pRPrProps };

      const hasPageBreakBefore = pPr ? Boolean(findChild(pPr, 'pageBreakBefore')) : false;

      // Determine semantic tag ONLY for document outline; exact visual font comes from inline style!
      let tag = 'p';
      const styleLower = (pStyleId || effectiveStyle.name || '').toLowerCase();
      if (styleLower.includes('heading1') || styleLower === 'heading 1' || styleLower === 'title') {
        tag = 'h1';
      } else if (styleLower.includes('heading2') || styleLower === 'heading 2' || styleLower === 'subtitle') {
        tag = 'h2';
      } else if (styleLower.includes('heading3') || styleLower === 'heading 3') {
        tag = 'h3';
      }

      const numPr = pPr ? findChild(pPr, 'numPr') : null;
      const numIdEl = numPr ? findChild(numPr, 'numId') : null;
      const numId = getAttr(numIdEl, 'val');
      const listType = numId && numId !== '0' ? numberingMap.get(numId) || 'ul' : null;

      const css: string[] = [];

      const fontCss = mapWordFontToCss(effectiveStyle.fontFamilyRaw);
      if (fontCss) css.push(`font-family:${fontCss}`);
      if (effectiveStyle.fontSizePt) css.push(`font-size:${effectiveStyle.fontSizePt}pt`);
      if (effectiveStyle.bold !== undefined) {
        css.push(`font-weight:${effectiveStyle.bold ? 700 : 400}`);
      } else if (tag !== 'p') {
        css.push('font-weight:400');
      }
      if (effectiveStyle.italic) css.push('font-style:italic');
      if (effectiveStyle.caps) css.push('text-transform:uppercase');
      if (effectiveStyle.color) css.push(`color:${effectiveStyle.color}`);

      const jc = pPr ? findChild(pPr, 'jc') : null;
      const jcVal = getAttr(jc, 'val') || effectiveStyle.align;
      if (jcVal) {
        const alignMap: Record<string, string> = {
          left: 'left',
          start: 'left',
          center: 'center',
          right: 'right',
          end: 'right',
          both: 'justify',
          distribute: 'justify',
        };
        if (alignMap[jcVal]) css.push(`text-align:${alignMap[jcVal]}`);
      }

      const ind = pPr ? findChild(pPr, 'ind') : null;
      if (ind && !listType) {
        const left = getAttr(ind, 'left') || getAttr(ind, 'start');
        const right = getAttr(ind, 'right') || getAttr(ind, 'end');
        const firstLine = getAttr(ind, 'firstLine');
        const hanging = getAttr(ind, 'hanging');
        if (left) css.push(`margin-left:${Math.round(twipsToPx(Number.parseInt(left, 10)))}px`);
        if (right) css.push(`margin-right:${Math.round(twipsToPx(Number.parseInt(right, 10)))}px`);
        if (firstLine) {
          css.push(`text-indent:${Math.round(twipsToPx(Number.parseInt(firstLine, 10)))}px`);
        } else if (hanging) {
          css.push(`text-indent:-${Math.round(twipsToPx(Number.parseInt(hanging, 10)))}px`);
        }
      }

      const pSpacing = pPr ? extractSpacingFromPPr(pPr) : {};
      const beforePt = pSpacing.spaceBeforePt ?? effectiveStyle.spaceBeforePt;
      const afterPt = pSpacing.spaceAfterPt ?? effectiveStyle.spaceAfterPt;
      const lineHeightCss = pSpacing.lineHeightCss ?? effectiveStyle.lineHeightCss;

      if (beforePt !== undefined) css.push(`margin-top:${beforePt}pt`);
      else css.push('margin-top:0pt');

      if (inTable) {
        css.push(`margin-bottom:${pSpacing.spaceAfterPt ?? 0}pt`);
      } else if (afterPt !== undefined) {
        css.push(`margin-bottom:${afterPt}pt`);
      } else {
        css.push(`margin-bottom:${baseStyle.paraMarginBottomPt}pt`);
      }

      if (lineHeightCss) css.push(`line-height:${lineHeightCss}`);

      const shd = pPr ? findChild(pPr, 'shd') : null;
      const pFill = getAttr(shd, 'fill');
      if (pFill && pFill !== 'auto') {
        css.push(`background-color:#${pFill};padding:4px 6px`);
      }

      // Paragraph bottom border (common in Indonesian Kop Surat)
      const pBdr = pPr ? findChild(pPr, 'pBdr') : null;
      const pBottomBdr = pBdr ? findChild(pBdr, 'bottom') : null;
      if (pBottomBdr) {
        const bVal = getAttr(pBottomBdr, 'val');
        if (bVal && bVal !== 'none') {
          const bSz = Number.parseInt(getAttr(pBottomBdr, 'sz') || '6', 10);
          const bColor = getAttr(pBottomBdr, 'color');
          const pxWidth = Math.max(1, Math.round(bSz / 4));
          const bStyle = bVal === 'double' ? 'double' : 'solid';
          const colHex = bColor && bColor !== 'auto' ? `#${bColor}` : '#18181b';
          css.push(`border-bottom:${pxWidth}px ${bStyle} ${colHex};padding-bottom:4pt`);
        }
      }

      let runsHtml = '';
      for (let i = 0; i < p.children.length; i++) {
        const child = p.children[i];
        if (child.localName === 'r') {
          runsHtml += renderRun(child, effectiveStyle);
        } else if (child.localName === 'hyperlink') {
          const linkRuns = findChildren(child, 'r')
            .map((r) => renderRun(r, effectiveStyle))
            .join('');
          runsHtml += `<span style="color:#2563eb;text-decoration:underline">${linkRuns}</span>`;
        }
      }

      const prefix = hasPageBreakBefore ? '<div class="docx-page-break"></div>' : '';

      if (runsHtml.includes('<!--DOCX_PAGE_BREAK-->')) {
        const segments = runsHtml.split('<!--DOCX_PAGE_BREAK-->');
        const outSegs = segments.map((seg, idx) => {
          const content = seg.trim() ? seg : '&nbsp;';
          const block = `<${tag} style="${css.join(';')}">${content}</${tag}>`;
          return idx > 0 ? `<div class="docx-page-break"></div>${block}` : block;
        });
        return { html: prefix + outSegs.join(''), listType: null };
      }

      if (!runsHtml.trim()) {
        runsHtml = '&nbsp;';
      }

      if (listType) {
        return {
          html: `${prefix}<li style="${css.join(';')}">${runsHtml}</li>`,
          listType,
        };
      }

      return {
        html: `${prefix}<${tag} style="${css.join(';')}">${runsHtml}</${tag}>`,
        listType: null,
      };
    };

    const renderTable = (tbl: Element): string => {
      const tblPr = findChild(tbl, 'tblPr');
      const tblBorders = tblPr ? findChild(tblPr, 'tblBorders') : null;
      const insideH = tblBorders ? findChild(tblBorders, 'insideH') : null;
      const topBdr = tblBorders ? findChild(tblBorders, 'top') : null;
      const borderNone =
        (insideH && getAttr(insideH, 'val') === 'none') &&
        (!topBdr || getAttr(topBdr, 'val') === 'none');

      const tblW = tblPr ? findChild(tblPr, 'tblW') : null;
      const tblWVal = tblW ? Number.parseInt(getAttr(tblW, 'w') || '9360', 10) : 9360;
      const tblWType = tblW ? (getAttr(tblW, 'type') || 'dxa') : 'dxa';
      const tblWidthTwips = (tblWType === 'dxa' && tblWVal > 0) ? tblWVal : 9360;

      const rows = findChildren(tbl, 'tr');
      const rowsHtml = rows
        .map((tr) => {
          const cells = findChildren(tr, 'tc');
          const cellsHtml = cells
            .map((tc) => {
              const tcPr = findChild(tc, 'tcPr');
              const gridSpan = tcPr ? findChild(tcPr, 'gridSpan') : null;
              const colspan = getAttr(gridSpan, 'val');
              const shd = tcPr ? findChild(tcPr, 'shd') : null;
              const fill = getAttr(shd, 'fill');
              const tcW = tcPr ? findChild(tcPr, 'tcW') : null;
              const tcWType = getAttr(tcW, 'type');
              const tcWVal = getAttr(tcW, 'w');

              const cellCss: string[] = [
                'padding:4pt 6pt',
                'vertical-align:top',
                borderNone ? 'border:1px solid transparent' : 'border:1px solid #18181b',
              ];
              if (fill && fill !== 'auto') {
                cellCss.push(`background-color:#${fill}`);
              }
              if (tcWVal && tcWType === 'pct') {
                cellCss.push(`width:${Math.round(Number.parseInt(tcWVal, 10) / 50)}%`);
              } else if (tcWVal && tcWType === 'dxa') {
                const pct = Math.min(100, Math.round((Number.parseInt(tcWVal, 10) / tblWidthTwips) * 1000) / 10);
                cellCss.push(`width:${pct}%`);
              }

              const paras = findChildren(tc, 'p')
                .map((p) => renderParagraph(p, true).html)
                .join('');

              return `<td${colspan ? ` colspan="${colspan}"` : ''} style="${cellCss.join(';')}">${paras || '&nbsp;'}</td>`;
            })
            .join('');
          return `<tr>${cellsHtml}</tr>`;
        })
        .join('');

      return `<table style="width:100%;border-collapse:collapse;margin:6pt 0">${rowsHtml}</table>`;
    };

    const outputBlocks: string[] = [];
    let openList: 'ol' | 'ul' | null = null;

    const closeList = () => {
      if (openList) {
        outputBlocks.push(`</${openList}>`);
        openList = null;
      }
    };

    for (let i = 0; i < body.children.length; i++) {
      const child = body.children[i];
      if (child.localName === 'p') {
        const res = renderParagraph(child, false);
        if (res.listType) {
          if (openList !== res.listType) {
            closeList();
            openList = res.listType;
            outputBlocks.push(`<${openList}>`);
          }
          outputBlocks.push(res.html);
        } else {
          closeList();
          outputBlocks.push(res.html);
        }
      } else if (child.localName === 'tbl') {
        closeList();
        outputBlocks.push(renderTable(child));
      }
    }
    closeList();

    return {
      html: outputBlocks.join('\n') || '<p>(Dokumen Word kosong)</p>',
      pageSize,
      orientation,
      marginsMm,
      baseStyle,
    };
  } catch {
    const res = await mammoth.convertToHtml({ arrayBuffer });
    return {
      html: res.value || '<p>(Dokumen Word kosong)</p>',
    };
  }
}
