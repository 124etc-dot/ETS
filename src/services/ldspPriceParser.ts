import * as XLSX from 'xlsx';
import { LdspItem, LdspParseResult, MaterialItem } from '../types/calculator';

/**
 * Standard extraction of sheet dimensions from item name
 * e.g. "ЛДСП Egger F186 ST9 Бетон Чікаго світло-сірий 2800x2070x18"
 * Length: 2800 mm -> 2.8 m
 * Width: 2070 mm -> 2.07 m
 * Sheet Area: 2.8 * 2.07 = 5.796 m²
 */
export function extractSheetDimensions(name: string): {
  lengthMm: number;
  widthMm: number;
  thicknessMm?: number;
  lengthM: number;
  widthM: number;
  areaSqm: number;
  rawMatch: string;
} | null {
  if (!name) return null;

  // 1. Match dimensions in mm (e.g., 2800x2070x18, 2800х2070х18, 2800×2070, 2750*1830)
  // Handles Latin x, Cyrillic х, multiplication symbol ×, and asterisk *
  const match = name.match(
    /(?:^|[^\d])(\d{3,4})\s*[xхXХ×*]\s*(\d{3,4})(?:\s*[xхXХ×*]\s*(\d{1,2}(?:\.\d+)?))?/
  );

  if (match) {
    const d1 = parseInt(match[1], 10);
    const d2 = parseInt(match[2], 10);
    const thicknessMm = match[3] ? parseFloat(match[3]) : undefined;

    // Standard sheet dimensions are between 1000 and 4000 mm length, 500 and 3000 mm width
    if (d1 >= 1000 && d1 <= 4000 && d2 >= 500 && d2 <= 3000) {
      const lengthMm = Math.max(d1, d2);
      const widthMm = Math.min(d1, d2);
      const lengthM = lengthMm / 1000;
      const widthM = widthMm / 1000;
      const areaSqm = Number((lengthM * widthM).toFixed(4));
      return {
        lengthMm,
        widthMm,
        thicknessMm,
        lengthM,
        widthM,
        areaSqm,
        rawMatch: match[0].trim(),
      };
    }
  }

  // 2. Match dimensions in meters (e.g., 2.8x2.07)
  const meterMatch = name.match(
    /(?:^|[^\d])([1-3]\.\d{1,3})\s*[xхXХ×*]\s*([0-2]\.\d{1,3})/
  );
  if (meterMatch) {
    const m1 = parseFloat(meterMatch[1]);
    const m2 = parseFloat(meterMatch[2]);
    const lengthM = Math.max(m1, m2);
    const widthM = Math.min(m1, m2);
    const areaSqm = Number((lengthM * widthM).toFixed(4));
    return {
      lengthMm: Math.round(lengthM * 1000),
      widthMm: Math.round(widthM * 1000),
      lengthM,
      widthM,
      areaSqm,
      rawMatch: meterMatch[0].trim(),
    };
  }

  return null;
}

/**
 * Check if an Excel cell is completely empty (undefined, null, or empty/whitespace string).
 * IMPORTANT: A cell containing 0 or "0" is NOT empty! It is a valid numeric price of 0 грн.
 */
export function isCellCompletelyEmpty(cellValue: any): boolean {
  if (cellValue === undefined || cellValue === null) return true;
  if (typeof cellValue === 'number') {
    return isNaN(cellValue);
  }
  const str = String(cellValue).trim();
  return str === '';
}

/**
 * Clean and parse numeric price from Excel cell.
 * Returns null if the cell is completely empty or non-numeric.
 * Returns a number >= 0 if the cell contains a numeric price (including 0!).
 */
export function parseNumericPrice(cellValue: any): number | null {
  if (isCellCompletelyEmpty(cellValue)) {
    return null;
  }
  if (typeof cellValue === 'number') {
    return isNaN(cellValue) ? null : Math.max(0, cellValue);
  }

  const str = String(cellValue)
    .replace(/\s+/g, '')
    .replace(/[гГ][рР][нН]\.?/gi, '')
    .replace(/[uU][aA][hH]/gi, '')
    .replace(/грн/gi, '')
    .replace(/,/g, '.');

  if (!str) return null;

  const cleanNum = parseFloat(str.replace(/[^0-9.]/g, ''));
  if (isNaN(cleanNum)) {
    return null;
  }
  return Math.max(0, cleanNum);
}

/**
 * Known brands list for LDSP
 */
export const KNOWN_BRANDS = [
  'Egger',
  'Kronospan',
  'Swiss Krono',
  'CLEAF',
  'Swisspan',
  'Savicla',
  'Niemann',
  'Kastamonu',
  'AGT',
  'Fundermax',
  'Pfleiderer',
  'Alvic',
  'Skin',
  'LuxeForm',
  'SM’art',
  'Rehau',
];

/**
 * Match text against known brands
 */
export function matchKnownBrand(text: string): string | null {
  if (!text) return null;
  const clean = text
    .trim()
    .replace(/^(?:Бренд|Виробник|Постачальник|Колекція)\s*[:\-]\s*/i, '')
    .replace(/^(?:ЛДСП|ДСП|Плити|Плита)\s+/i, '')
    .trim();

  // Pure numbers are NEVER brands
  if (/^\d+$/.test(clean)) return null;

  const lower = clean.toLowerCase().replace(/[\s\-_]/g, '');

  if (lower.includes('swisskrono') || lower.includes('свісскроно')) return 'Swiss Krono';
  if (lower.includes('swisspan') || lower.includes('свісспан')) return 'Swisspan';
  if (lower.includes('kronospan') || lower.includes('кроноспан')) return 'Kronospan';
  if (lower.includes('egger') || lower.includes('еггер')) return 'Egger';
  if (lower.includes('cleaf') || lower.includes('кліф')) return 'CLEAF';
  if (lower.includes('savicla') || lower.includes('савікла')) return 'Savicla';
  if (lower.includes('niemann') || lower.includes('німан')) return 'Niemann';
  if (lower.includes('kastamonu') || lower.includes('кастамону')) return 'Kastamonu';
  if (lower.includes('agt') || lower.includes('агт')) return 'AGT';
  if (lower.includes('fundermax') || lower.includes('фундермакс')) return 'Fundermax';
  if (lower.includes('pfleiderer') || lower.includes('пфлейдерер')) return 'Pfleiderer';
  if (lower.includes('alvic') || lower.includes('алвік')) return 'Alvic';
  if (lower.includes('luxeform') || lower.includes('люксформ')) return 'LuxeForm';
  if (lower.includes('rehau') || lower.includes('рехау')) return 'Rehau';
  if (lower.includes('smart') || lower.includes('см’арт')) return 'SM’art';
  if (lower.includes('skin') || lower.includes('скін')) return 'Skin';

  return null;
}

export function cleanBrandHeader(text: string): string {
  if (!text) return '';
  let cleaned = text.trim();

  if (/^\d+$/.test(cleaned)) return '';

  const matched = matchKnownBrand(cleaned);
  if (matched) return matched;

  cleaned = cleaned.replace(/^(?:Бренд|Виробник|Постачальник|Колекція)\s*[:\-]\s*/i, '');
  cleaned = cleaned.replace(/^(?:ЛДСП|ДСП|Плити|Плита)\s+/i, '');

  return cleaned.trim();
}

/**
 * Determine if a row looks like a table header (e.g. "Артикул", "Назва", "Ціна")
 */
function isTableHeaderRow(rowValues: string[]): boolean {
  const combined = rowValues.join(' ').toLowerCase();
  return (
    (combined.includes('назва') || combined.includes('найменуван') || combined.includes('номенклатур')) &&
    (combined.includes('ціна') || combined.includes('артикул') || combined.includes('код') || combined.includes('грн'))
  );
}

/**
 * Fallback brand detection from product name
 */
export function detectBrandFromName(name: string): string {
  if (!name) return 'Інше';
  const matched = matchKnownBrand(name);
  if (matched) return matched;
  return 'Інше';
}

/**
 * Parse an Excel Workbook containing an LDSP Price list
 * Rules implemented:
 * 1. Column 0 (Article) is completely ignored and NEVER stored in the DB.
 * 2. Proper Brand Header identification:
 *    A row is a Brand ONLY when:
 *    - Article column is empty;
 *    - Price column is COMPLETELY EMPTY (and NOT equal to 0);
 *    - Name column contains brand name.
 *    Products with 0 UAH price are regular items belonging to the current active brand!
 * 3. Full name is kept 1:1 without alterations.
 * 4. Regex extraction of dimensions (e.g. 2800x2070), Sheet area = Length * Width,
 *    Price per 1 m² = Price per sheet / Sheet area (for 0 UAH: 0 / area = 0 UAH/m²).
 * 5. Returns LdspItem[] with brand, name, price_sheet, price_sqm, sheet_area_sqm, unit.
 */
export function parseLdspWorkbook(
  workbook: XLSX.WorkBook,
  fileName: string = 'ЛДСП Прайс KRONAS.xlsx',
  supplier: string = 'KRONAS',
  existingMaterials: MaterialItem[] = []
): LdspParseResult {
  const errors: string[] = [];
  const recognizedItems: LdspItem[] = [];
  const brandsFoundSet = new Set<string>();

  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    return {
      fileName,
      supplier,
      totalRowsRead: 0,
      recognizedItems: [],
      brandsFound: [],
      newItemsCount: 0,
      updatedItemsCount: 0,
      errors: ['Файл не містить жодної вкладки (sheet).'],
    };
  }

  // Select the most relevant sheet (prefer sheet containing "ЛДСП", "Прайс", or the first sheet)
  let targetSheetName = workbook.SheetNames[0];
  const preferredSheet = workbook.SheetNames.find((name) =>
    /лдсп|прайс|kronas|лист/i.test(name)
  );
  if (preferredSheet) {
    targetSheetName = preferredSheet;
  }

  const sheet = workbook.Sheets[targetSheetName];
  if (!sheet) {
    return {
      fileName,
      supplier,
      totalRowsRead: 0,
      recognizedItems: [],
      brandsFound: [],
      newItemsCount: 0,
      updatedItemsCount: 0,
      errors: ['Вкладка порожня.'],
    };
  }

  // Convert to array of arrays
  const rawRows: any[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    blankrows: false,
  });

  if (!rawRows || rawRows.length === 0) {
    return {
      fileName,
      supplier,
      totalRowsRead: 0,
      recognizedItems: [],
      brandsFound: [],
      newItemsCount: 0,
      updatedItemsCount: 0,
      errors: ['У таблиці немає даних.'],
    };
  }

  let currentBrand = '';
  let articleColIdx = 0; // Default: Col 0 is Article - ALWAYS ignored for DB
  let nameColIdx = 1; // Default: Col 1 is Name
  let priceColIdx = -1; // Determined dynamically below
  let headerRowIdx = -1;

  // First pass: locate table headers if present
  for (let r = 0; r < Math.min(rawRows.length, 15); r++) {
    const row = rawRows[r];
    if (!Array.isArray(row)) continue;

    const rowStrings = row.map((c) => String(c ?? '').trim());
    if (isTableHeaderRow(rowStrings)) {
      headerRowIdx = r;
      rowStrings.forEach((colHeader, idx) => {
        const lower = colHeader.toLowerCase();
        if (lower.includes('артикул') || lower.includes('код')) {
          articleColIdx = idx;
        } else if (
          lower.includes('назва') ||
          lower.includes('найменуван') ||
          lower.includes('номенклатур') ||
          lower.includes('товар')
        ) {
          nameColIdx = idx;
        } else if (
          lower.includes('ціна') ||
          lower.includes('цена') ||
          lower.includes('лист') ||
          lower.includes('роздріб') ||
          lower.includes('грн') ||
          lower.includes('price')
        ) {
          priceColIdx = idx;
        }
      });
      break;
    }
  }

  // If price column wasn't explicitly found in headers, detect by numeric column
  if (priceColIdx === -1) {
    const candidateScores: Record<number, number> = {};
    const startScan = headerRowIdx >= 0 ? headerRowIdx + 1 : 0;
    for (let r = startScan; r < Math.min(rawRows.length, 30); r++) {
      const row = rawRows[r];
      if (!Array.isArray(row)) continue;
      for (let c = 2; c < row.length; c++) {
        if (c === nameColIdx || c === articleColIdx) continue;
        const cell = row[c];
        if (parseNumericPrice(cell) !== null) {
          candidateScores[c] = (candidateScores[c] || 0) + 1;
        }
      }
    }
    let bestCol = 2;
    let maxScore = 0;
    for (const [colStr, score] of Object.entries(candidateScores)) {
      if (score > maxScore) {
        maxScore = score;
        bestCol = parseInt(colStr, 10);
      }
    }
    priceColIdx = bestCol;
  }

  // Second pass: process each row
  for (let r = 0; r < rawRows.length; r++) {
    // Skip header row
    if (r === headerRowIdx) continue;

    const row = rawRows[r];
    if (!Array.isArray(row)) continue;

    const rowStrings = row.map((c) => String(c ?? '').trim());
    if (isTableHeaderRow(rowStrings)) {
      continue;
    }

    // Completely empty row?
    const hasAnyContent = row.some((c) => !isCellCompletelyEmpty(c));
    if (!hasAnyContent) continue;

    const rawArticleCell = row[articleColIdx];
    const rawNameCell = row[nameColIdx];
    const rawPriceCell = row[priceColIdx];

    const isArticleEmpty = isCellCompletelyEmpty(rawArticleCell);
    const parsedPrimaryPrice = parseNumericPrice(rawPriceCell);

    // Look for price in row
    let rowPrice: number | null = parsedPrimaryPrice;
    let hasPriceInRow = parsedPrimaryPrice !== null;

    if (!hasPriceInRow) {
      // Check other non-name, non-article cells
      for (let c = 2; c < row.length; c++) {
        if (c === nameColIdx || c === articleColIdx) continue;
        const p = parseNumericPrice(row[c]);
        if (p !== null) {
          rowPrice = p;
          hasPriceInRow = true;
          break;
        }
      }
    }

    // RULE 2: A row is a Brand Header ONLY WHEN:
    // - Article column is completely empty;
    // - Price column is COMPLETELY EMPTY (hasPriceInRow === false, NOT 0!);
    // - Name column contains a brand name.
    const articleStr = String(rawArticleCell ?? '').trim();
    const nameStr = String(rawNameCell ?? '').trim();

    // Check if article column matches a known brand string (in case brand header row was put in col 0 instead of col 1)
    // Note: numeric articles like "92532" will NEVER match!
    const articleBrandMatch = !/^\d+$/.test(articleStr) ? matchKnownBrand(articleStr) : null;
    const nameBrandMatch = !/^\d+$/.test(nameStr) ? matchKnownBrand(nameStr) : null;

    const isPriceCompletelyEmpty = !hasPriceInRow;
    const candidateText = nameStr || articleStr;

    const hasNoSheetDimensions = extractSheetDimensions(candidateText) === null;
    const isBrandCandidate =
      !/^\d+$/.test(candidateText) &&
      hasNoSheetDimensions &&
      (nameBrandMatch !== null ||
        articleBrandMatch !== null ||
        (isArticleEmpty && isPriceCompletelyEmpty && candidateText.length >= 2 && candidateText.length <= 40));

    if (isPriceCompletelyEmpty && (isArticleEmpty || articleBrandMatch !== null) && isBrandCandidate) {
      const detectedBrand =
        nameBrandMatch ||
        articleBrandMatch ||
        cleanBrandHeader(candidateText);

      if (detectedBrand && !/^\d+$/.test(detectedBrand)) {
        currentBrand = detectedBrand;
        brandsFoundSet.add(currentBrand);
      }
      continue; // Handled as Brand header!
    }

    // If not a brand header, row is a PRODUCT!
    // RULE 1: Article column is completely ignored and NEVER stored in DB.
    // RULE 3: Name is preserved 1:1 without alterations.
    let rawName = nameStr;
    if (!rawName || rawName.length < 3) {
      // If name column was empty or shifted, look for non-article, non-price text
      for (let c = 1; c < row.length; c++) {
        if (c === articleColIdx || c === priceColIdx) continue;
        const val = String(row[c] ?? '').trim();
        if (val.length >= 3 && !/^\d+$/.test(val) && parseNumericPrice(val) === null) {
          rawName = val;
          break;
        }
      }
    }

    // Skip if name is invalid or purely numbers
    if (!rawName || rawName.length < 3 || /^\d+$/.test(rawName)) {
      continue;
    }

    // Active brand for this product (defaults to currentBrand, or detected from name)
    const brand = currentBrand || detectBrandFromName(rawName) || 'KRONAS';
    brandsFoundSet.add(brand);

    // RULE 4: Sheet dimensions and price calculation
    const dim = extractSheetDimensions(rawName);
    const sheetAreaSqm = dim ? dim.areaSqm : 5.796; // Standard LDSP sheet 2800x2070 = 5.796 m²

    // For 0 грн items: price_sheet = 0, price_sqm = 0
    const priceSheet = rowPrice !== null ? Number(rowPrice.toFixed(2)) : 0;
    const priceSqm = priceSheet > 0 ? Number((priceSheet / sheetAreaSqm).toFixed(2)) : 0;

    const item: LdspItem = {
      brand,
      name: rawName, // 1 in 1 from Excel without changes
      price_sheet: priceSheet,
      price_sqm: priceSqm,
      sheet_area_sqm: sheetAreaSqm,
      unit: 'м²',
    };

    recognizedItems.push(item);
  }

  // Calculate new vs updated count against existing materials
  let newItemsCount = 0;
  let updatedItemsCount = 0;
  const existingMap = new Map<string, MaterialItem>();
  existingMaterials.forEach((m) => {
    existingMap.set(m.name.trim().toLowerCase(), m);
  });

  recognizedItems.forEach((item) => {
    if (existingMap.has(item.name.trim().toLowerCase())) {
      updatedItemsCount++;
    } else {
      newItemsCount++;
    }
  });

  return {
    fileName,
    supplier,
    totalRowsRead: rawRows.length,
    recognizedItems,
    brandsFound: Array.from(brandsFoundSet),
    newItemsCount,
    updatedItemsCount,
    errors,
  };
}

/**
 * Parse an Excel file (File, ArrayBuffer, or Uint8Array)
 */
export async function parseLdspFile(
  fileOrBuffer: File | ArrayBuffer | Uint8Array,
  fileName: string = 'ЛДСП Прайс KRONAS.xlsx',
  supplier: string = 'KRONAS',
  existingMaterials: MaterialItem[] = []
): Promise<LdspParseResult> {
  let uint8Array: Uint8Array;

  if (fileOrBuffer instanceof File) {
    const arrayBuffer = await fileOrBuffer.arrayBuffer();
    uint8Array = new Uint8Array(arrayBuffer);
    fileName = fileOrBuffer.name;
  } else if (fileOrBuffer instanceof Uint8Array) {
    uint8Array = fileOrBuffer;
  } else {
    uint8Array = new Uint8Array(fileOrBuffer);
  }

  const workbook = XLSX.read(uint8Array, {
    type: 'array',
    raw: false,
  });

  return parseLdspWorkbook(workbook, fileName, supplier, existingMaterials);
}

/**
 * Generate a high quality sample Excel file matching KRONAS LDSP Price list structure
 * Perfect for testing and demonstration!
 */
export function generateSampleLdspExcelWorkbook(): Uint8Array {
  const wb = XLSX.utils.book_new();

  const sampleRows: any[][] = [
    // Header
    ['Артикул', 'Назва', 'Од. вим.', 'Ціна за лист (грн)'],

    // Brand Group 1: Egger
    ['', 'Egger', '', ''],
    [
      '10001',
      'ЛДСП Egger F186 ST9 Бетон Чікаго світло-сірий 2800x2070x18',
      'лист',
      6045.15,
    ],
    [
      '10002',
      'ЛДСП Egger W980 ST2 Білий Платиновий 2800x2070x18',
      'лист',
      3850.0,
    ],
    [
      '10003',
      'ЛДСП Egger H1180 ST37 Дуб Галіфакс натуральний 2800x2070x18',
      'лист',
      7420.5,
    ],
    [
      '10004',
      'ЛДСП Egger U708 ST9 Світло-сірий 2800x2070x18',
      'лист',
      4290.0,
    ],
    [
      '10005',
      'ЛДСП Egger U999 ST9 Чорний 2800x2070x18',
      'лист',
      4380.0,
    ],
    [
      '10006',
      'ЛДСП Egger H3303 ST10 Дуб Арлінгтон природний 2800x2070x18',
      'лист',
      5680.0,
    ],
    [
      '10007',
      'ЛДСП Egger H1344 ST32 Дуб Шерман 2800x2070x18',
      'лист',
      0,
    ],

    // Brand Group 2: Kronospan
    ['', 'Kronospan', '', ''],
    [
      '20001',
      'ЛДСП Kronospan 0101 SM Білий Фасадний 2800x2070x18',
      'лист',
      2950.0,
    ],
    [
      '20002',
      'ЛДСП Kronospan 0190 PE Чорний 2800x2070x18',
      'лист',
      3150.0,
    ],
    [
      '20003',
      'ЛДСП Kronospan K003 PW Дуб Крафт золотий 2800x2070x18',
      'лист',
      3890.0,
    ],
    [
      '20004',
      'ЛДСП Kronospan K001 PW Дуб Крафт білий 2800x2070x18',
      'лист',
      3890.0,
    ],
    [
      '20005',
      'ЛДСП Kronospan 0514 PE Слонова кістка 2800x2070x18',
      'лист',
      3100.0,
    ],

    // Brand Group 3: CLEAF
    ['', 'CLEAF', '', ''],
    [
      '30001',
      'ЛДСП CLEAF Sherwood S081 2800x2070x18',
      'лист',
      7200.0,
    ],
    [
      '30002',
      'ЛДСП CLEAF Ares FB03 2800x2070x18',
      'лист',
      8150.0,
    ],
    [
      '30003',
      'ЛДСП CLEAF Millennium B073 2800x2070x18',
      'лист',
      7650.0,
    ],

    // Brand Group 4: Swiss Krono
    ['', 'Swiss Krono', '', ''],
    [
      '40001',
      'ЛДСП Swiss Krono Дуб Сонома D3025 2800x2070x16',
      'лист',
      2650.0,
    ],
    [
      '40002',
      'ЛДСП Swiss Krono Венге Луізіана D2413 2800x2070x18',
      'лист',
      2890.0,
    ],
    [
      '40003',
      'ЛДСП Swiss Krono Антрацит U164 2800x2070x18',
      'лист',
      3050.0,
    ],
  ];

  const ws = XLSX.utils.aoa_to_sheet(sampleRows);

  // Set column widths
  ws['!cols'] = [
    { wch: 12 }, // Артикул
    { wch: 65 }, // Назва
    { wch: 12 }, // Од. вим.
    { wch: 22 }, // Ціна за лист
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Прайс ЛДСП KRONAS');

  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new Uint8Array(buf);
}
