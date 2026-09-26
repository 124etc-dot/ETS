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
 * Clean and parse numeric price from Excel cell
 */
export function parseNumericPrice(cellValue: any): number {
  if (typeof cellValue === 'number') {
    return isNaN(cellValue) || cellValue <= 0 ? 0 : cellValue;
  }
  if (!cellValue) return 0;

  const str = String(cellValue)
    .replace(/\s+/g, '')
    .replace(/[гГ][рР][нН]\.?/gi, '')
    .replace(/[uU][aA][hH]/gi, '')
    .replace(/грн/gi, '')
    .replace(/,/g, '.');

  const cleanNum = parseFloat(str.replace(/[^0-9.]/g, ''));
  return isNaN(cleanNum) || cleanNum <= 0 ? 0 : cleanNum;
}

/**
 * Detect if text in a row is a brand header
 */
const KNOWN_BRANDS = [
  'Egger',
  'Kronospan',
  'Swiss Krono',
  'CLEAF',
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
  'Swisspan',
];

export function cleanBrandHeader(text: string): string {
  if (!text) return '';
  let cleaned = text.trim();

  // Strip prefixes like "Бренд:", "Виробник:", "ЛДСП", "ДСП", "Плити"
  cleaned = cleaned.replace(/^(?:Бренд|Виробник|Постачальник)\s*[:\-]\s*/i, '');
  cleaned = cleaned.replace(/^(?:ЛДСП|ДСП|Плити|Плита)\s+/i, '');

  // Check against known brands for proper casing
  const lower = cleaned.toLowerCase();
  for (const kb of KNOWN_BRANDS) {
    if (lower === kb.toLowerCase() || lower.startsWith(kb.toLowerCase() + ' ')) {
      return kb;
    }
  }

  return cleaned;
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
  const lower = name.toLowerCase();

  for (const brand of KNOWN_BRANDS) {
    if (lower.includes(brand.toLowerCase())) {
      return brand;
    }
  }
  return 'Інше';
}

/**
 * Parse an Excel Workbook containing an LDSP Price list
 * Rules implemented:
 * 1. Column 0 (Article) is completely ignored and NEVER stored in the DB.
 * 2. Rows with only a brand name and no price are group headers. All subsequent items
 *    belong to this brand until a new brand header appears.
 * 3. Full name is kept 1:1 without alterations.
 * 4. Regex extraction of dimensions (e.g. 2800x2070), Sheet area = Length * Width,
 *    Price per 1 m² = Price per sheet / Sheet area (e.g. 6045.15 / 5.796 = 1042.99).
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
  let nameColIdx = 1; // Default: Col 0 is Article, Col 1 is Name
  let priceColIdx = 2; // Default: Col 2 is Price
  let headerRowFound = false;

  // First pass: locate table headers if present
  for (let r = 0; r < Math.min(rawRows.length, 10); r++) {
    const row = rawRows[r];
    if (!Array.isArray(row)) continue;

    const rowStrings = row.map((c) => String(c || '').trim());
    if (isTableHeaderRow(rowStrings)) {
      headerRowFound = true;

      // Identify column indices
      rowStrings.forEach((colHeader, idx) => {
        const lower = colHeader.toLowerCase();
        if (
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

  // Process rows
  for (let r = 0; r < rawRows.length; r++) {
    const row = rawRows[r];
    if (!Array.isArray(row)) continue;

    // Skip empty rows
    const nonBlankCells = row
      .map((c, idx) => ({ val: String(c || '').trim(), idx }))
      .filter((c) => c.val.length > 0);

    if (nonBlankCells.length === 0) continue;

    // Check if this row is a table column title row (skip)
    const rowStrings = row.map((c) => String(c || '').trim());
    if (isTableHeaderRow(rowStrings)) {
      continue;
    }

    // Check if row contains a price
    // Column 0 is Article - completely ignored!
    let priceCandidate = parseNumericPrice(row[priceColIdx]);

    // If price wasn't at priceColIdx, inspect remaining cells (skipping column 0)
    if (priceCandidate <= 0) {
      for (let c = 1; c < row.length; c++) {
        if (c === nameColIdx) continue;
        const p = parseNumericPrice(row[c]);
        // Typical sheet price is > 100 UAH
        if (p > 50) {
          priceCandidate = p;
          break;
        }
      }
    }

    // RULE 1: If there is NO price in the row, check if it's a Brand header row
    if (priceCandidate <= 0) {
      // Find non-empty string in the row (could be in col 0, col 1, etc.)
      const textCell = nonBlankCells.find(
        (c) =>
          !/^(?:№|п\/п|код|артикул|дата|прайс|сторінка|тел|тов|kronas)/i.test(c.val) &&
          c.val.length < 50
      );

      if (textCell) {
        const potentialBrand = cleanBrandHeader(textCell.val);
        if (potentialBrand && potentialBrand.length > 1) {
          currentBrand = potentialBrand;
          brandsFoundSet.add(currentBrand);
        }
      }
      continue;
    }

    // RULE 1 & 2: Row has a price -> it's a product!
    // Get full name 1:1 without alteration
    let rawName = String(row[nameColIdx] || '').trim();

    // If name column was empty or article was shifted, check other non-price cells
    if (!rawName || rawName.length < 3) {
      const candidateCell = nonBlankCells.find(
        (c) => c.idx !== 0 && c.val.length > 5 && parseNumericPrice(c.val) <= 0
      );
      if (candidateCell) {
        rawName = candidateCell.val;
      }
    }

    if (!rawName || rawName.length < 3) {
      continue; // No valid name found
    }

    // Brand for this product
    const brand = currentBrand || detectBrandFromName(rawName) || 'KRONAS';
    brandsFoundSet.add(brand);

    // RULE 2: Calculate Sheet Area and Price per 1 m²
    // Extract dimensions from full name
    const dim = extractSheetDimensions(rawName);
    // Standard LDSP sheet fallback is 2800x2070 = 5.796 m²
    const sheetAreaSqm = dim ? dim.areaSqm : 5.796;

    const priceSheet = Number(priceCandidate.toFixed(2));
    const priceSqm = Number((priceSheet / sheetAreaSqm).toFixed(2));

    const item: LdspItem = {
      brand,
      name: rawName, // Preserved 1 in 1 without change!
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
