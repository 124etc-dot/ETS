/**
 * Utility functions for parsing, extracting, and normalizing dates
 * from Ukrainian invoices, payment orders, bank slips, and filenames.
 */

const UKRAINIAN_MONTH_MAP: Record<string, number> = {
  // Ukrainian genitive & nominative
  'січня': 1, 'січень': 1, 'січ': 1,
  'лютого': 2, 'лютий': 2, 'лют': 2,
  'березня': 3, 'березень': 3, 'бер': 3,
  'квітня': 4, 'квітень': 4, 'квіт': 4,
  'травня': 5, 'травень': 5, 'трав': 5,
  'червня': 6, 'червень': 6, 'черв': 6,
  'липня': 7, 'липень': 7, 'лип': 7,
  'серпня': 8, 'серпень': 8, 'серп': 8,
  'вересня': 9, 'вересень': 9, 'вер': 9,
  'жовтня': 10, 'жовтень': 10, 'жовт': 10,
  'листопада': 11, 'листопад': 11, 'лист': 11,
  'грудня': 12, 'грудень': 12, 'груд': 12,

  // Russian genitive & nominative
  'января': 1, 'январь': 1, 'янв': 1,
  'февраля': 2, 'февраль': 2, 'февр': 2,
  'марта': 3, 'март': 3, 'мар': 3,
  'апреля': 4, 'апрель': 4, 'апр': 4,
  'мая': 5, 'май': 5,
  'июня': 6, 'июнь': 6, 'июн': 6,
  'июля': 7, 'июль': 7, 'июл': 7,
  'августа': 8, 'август': 8, 'авг': 8,
  'сентября': 9, 'сентябрь': 9, 'сент': 9,
  'октября': 10, 'октябрь': 10, 'окт': 10,
  'ноября': 11, 'ноябрь': 11, 'нояб': 11,
  'декабря': 12, 'декабрь': 12, 'дек': 12,

  // English
  'january': 1, 'jan': 1,
  'february': 2, 'feb': 2,
  'march': 3, 'mar': 3,
  'april': 4, 'apr': 4,
  'may': 5,
  'june': 6, 'jun': 6,
  'july': 7, 'jul': 7,
  'august': 8, 'aug': 8,
  'september': 9, 'sep': 9, 'sept': 9,
  'october': 10, 'oct': 10,
  'november': 11, 'nov': 11,
  'december': 12, 'dec': 12,
};

/**
 * Validates year, month, day numbers and returns ISO "YYYY-MM-DD" or empty string
 */
export function formatIsoDate(year: number, month: number, day: number): string {
  if (isNaN(year) || isNaN(month) || isNaN(day)) return '';

  // Handle 2-digit years (e.g. 26 -> 2026, 99 -> 1999)
  let fullYear = year;
  if (year < 100) {
    fullYear = year >= 70 ? 1900 + year : 2000 + year;
  }

  // Realistic business document bounds
  if (fullYear < 2000 || fullYear > 2099) return '';
  if (month < 1 || month > 12) return '';
  if (day < 1 || day > 31) return '';

  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${fullYear}-${mm}-${dd}`;
}

/**
 * Normalizes any date representation (string/number/Date) to strict ISO "YYYY-MM-DD".
 * Returns empty string if parsing fails.
 */
export function normalizeDateToIso(input: unknown): string {
  if (!input) return '';
  if (typeof input === 'number') {
    const d = new Date(input);
    if (!isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10);
    }
    return '';
  }

  const str = String(input)
    .trim()
    .replace(/^[«"'\s]+|[»"'\s]+$/g, '')
    .replace(/\s*р(?:оку|\.)?$/i, '')
    .trim();

  if (!str) return '';

  // 1. Check if already strict ISO: YYYY-MM-DD
  const isoMatch = str.match(/^(\d{4})[./\-](\d{1,2})[./\-](\d{1,2})$/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1], 10);
    const m = parseInt(isoMatch[2], 10);
    const d = parseInt(isoMatch[3], 10);
    return formatIsoDate(y, m, d);
  }

  // 2. Numeric with dots/slashes/dashes: DD.MM.YYYY or DD.MM.YY
  const dmyMatch = str.match(/^(\d{1,2})[./\-](\d{1,2})[./\-](\d{2,4})$/);
  if (dmyMatch) {
    const d = parseInt(dmyMatch[1], 10);
    const m = parseInt(dmyMatch[2], 10);
    const y = parseInt(dmyMatch[3], 10);
    return formatIsoDate(y, m, d);
  }

  // 3. Word format: "15 вересня 2026", "«15» вересня 2026 р.", "15-е вересня 2026"
  const wordMatch = str.match(/^(\d{1,2})(?:[-–—]?[еєяй])?\s+([a-zA-Zа-яА-ЯіїєґІЇЄҐ]+)\s+(\d{2,4})$/);
  if (wordMatch) {
    const d = parseInt(wordMatch[1], 10);
    const monthWord = wordMatch[2].toLowerCase();
    const y = parseInt(wordMatch[3], 10);
    const m = UKRAINIAN_MONTH_MAP[monthWord];
    if (m) {
      return formatIsoDate(y, m, d);
    }
  }

  // 4. Word format with prefix: "від 15 вересня 2026"
  const prefixWordMatch = str.match(/(?:від|от|dated)?\s*(?:«|")?\s*(\d{1,2})\s*(?:»|")?\s+([a-zA-Zа-яА-ЯіїєґІЇЄҐ]+)\s+(\d{2,4})/i);
  if (prefixWordMatch) {
    const d = parseInt(prefixWordMatch[1], 10);
    const monthWord = prefixWordMatch[2].toLowerCase();
    const y = parseInt(prefixWordMatch[3], 10);
    const m = UKRAINIAN_MONTH_MAP[monthWord];
    if (m) {
      return formatIsoDate(y, m, d);
    }
  }

  // 5. Try standard JS Date parsing fallback (e.g. ISO strings with timestamp)
  const jsDate = new Date(str);
  if (!isNaN(jsDate.getTime()) && jsDate.getFullYear() >= 2000 && jsDate.getFullYear() <= 2099) {
    return jsDate.toISOString().slice(0, 10);
  }

  return '';
}

/**
 * Extracts a date from free-form text (such as invoice headers, notes, payment purpose, or file names).
 */
export function extractDateFromText(text: string | undefined | null): string {
  if (!text) return '';
  const cleanText = text.replace(/[\r\n]+/g, ' ');

  // Pattern 1: Ukrainian written month with "від" or standalone:
  // e.g. "від 15 вересня 2026", "Рахунок № 12 від «15» вересня 2026 р."
  const monthNames = Object.keys(UKRAINIAN_MONTH_MAP).join('|');
  const monthRegex = new RegExp(
    `(?:від|от|дата|date)?\\s*(?:[«"'])?\\s*(\\d{1,2})\\s*(?:[»"'])?\\s+(${monthNames})\\s+(?:р(?:оку|\\.)?\\s*)?(\\d{2,4})`,
    'i'
  );
  const mMatch = cleanText.match(monthRegex);
  if (mMatch) {
    const d = parseInt(mMatch[1], 10);
    const monthWord = mMatch[2].toLowerCase();
    const y = parseInt(mMatch[3], 10);
    const m = UKRAINIAN_MONTH_MAP[monthWord];
    if (m) {
      const iso = formatIsoDate(y, m, d);
      if (iso) return iso;
    }
  }

  // Pattern 2: Explicit date label with DD.MM.YYYY:
  // e.g. "від 15.09.2026", "Дата: 15.09.2026", "Дата рахунку: 15.09.2026", "від 15.09.26"
  const explicitNumericRegex = /(?:від|от|дата|date|виписано|складено|оформлено|документ(?:а|у)?|рах(?:унок|унку)?|№\s*[\w\d\-_/]+)\s*[:=№]?\s*(\d{1,2})[./\-](\d{1,2})[./\-](\d{2,4})/i;
  const numMatch = cleanText.match(explicitNumericRegex);
  if (numMatch) {
    const d = parseInt(numMatch[1], 10);
    const m = parseInt(numMatch[2], 10);
    const y = parseInt(numMatch[3], 10);
    const iso = formatIsoDate(y, m, d);
    if (iso) return iso;
  }

  // Pattern 3: Standalone date in DD.MM.YYYY format
  const standaloneMatch = cleanText.match(/\b(\d{1,2})[./\-](\d{1,2})[./\-](\d{4})\b/);
  if (standaloneMatch) {
    const d = parseInt(standaloneMatch[1], 10);
    const m = parseInt(standaloneMatch[2], 10);
    const y = parseInt(standaloneMatch[3], 10);
    const iso = formatIsoDate(y, m, d);
    if (iso) return iso;
  }

  // Pattern 4: Date embedded in file name e.g. "Invoice_123_15_09_2026.pdf" or "2026-09-15_123.pdf"
  const fileNameMatch = cleanText.match(/(\d{4})[_\-](\d{2})[_\-](\d{2})|(\d{2})[_\-](\d{2})[_\-](\d{4})/);
  if (fileNameMatch) {
    if (fileNameMatch[1]) {
      const y = parseInt(fileNameMatch[1], 10);
      const m = parseInt(fileNameMatch[2], 10);
      const d = parseInt(fileNameMatch[3], 10);
      const iso = formatIsoDate(y, m, d);
      if (iso) return iso;
    } else if (fileNameMatch[4]) {
      const d = parseInt(fileNameMatch[4], 10);
      const m = parseInt(fileNameMatch[5], 10);
      const y = parseInt(fileNameMatch[6], 10);
      const iso = formatIsoDate(y, m, d);
      if (iso) return iso;
    }
  }

  return '';
}

/**
 * Ensures an OCR result has a clean, validated ISO invoiceDate / paymentDate.
 * Runs through the fallback cascade:
 * 1. Normalized invoiceDate
 * 2. Normalized invoiceDateOriginal
 * 3. Normalized paymentDate
 * 4. Extracted from header / notes / raw text / payment purpose / file name
 */
export function ensureOcrDates(
  ocr: {
    invoiceDate?: string;
    invoiceDateOriginal?: string;
    paymentDate?: string;
    documentTitle?: string;
    notes?: string;
    handwrittenRawText?: string;
    paymentPurpose?: string;
    documentType?: string;
  },
  fileName?: string
): void {
  // 1. Try normalizing current invoiceDate
  let resolvedDate = normalizeDateToIso(ocr.invoiceDate);

  // 2. Try invoiceDateOriginal
  if (!resolvedDate && ocr.invoiceDateOriginal) {
    resolvedDate = normalizeDateToIso(ocr.invoiceDateOriginal);
  }

  // 3. Try paymentDate
  if (!resolvedDate && ocr.paymentDate) {
    resolvedDate = normalizeDateToIso(ocr.paymentDate);
  }

  // 4. Try extracting from text fields
  if (!resolvedDate) {
    const textPool = [
      ocr.documentTitle,
      ocr.notes,
      ocr.handwrittenRawText,
      ocr.paymentPurpose,
      ocr.invoiceDateOriginal,
      fileName,
    ];
    for (const text of textPool) {
      if (text) {
        const extracted = extractDateFromText(text);
        if (extracted) {
          resolvedDate = extracted;
          break;
        }
      }
    }
  }

  // If found, ensure both invoiceDate and paymentDate are populated and synchronized
  if (resolvedDate) {
    ocr.invoiceDate = resolvedDate;
    if (!ocr.paymentDate) {
      ocr.paymentDate = resolvedDate;
    }
  } else if (ocr.paymentDate) {
    // If paymentDate had something we could normalize
    const normPay = normalizeDateToIso(ocr.paymentDate);
    if (normPay) {
      ocr.paymentDate = normPay;
      if (!ocr.invoiceDate) {
        ocr.invoiceDate = normPay;
      }
    }
  }
}

export const UKRAINIAN_MONTH_NAMES = [
  'Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень',
  'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'
];

/**
 * Formats a date string into Ukrainian "Місяць РРРР" (e.g. "Вересень 2026", "Серпень 2026")
 */
export function formatMonthYearUk(dateStr?: string): string {
  const now = new Date();
  if (!dateStr || !dateStr.trim()) {
    return `${UKRAINIAN_MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;
  }

  const str = dateStr.trim();

  // Try ISO YYYY-MM or YYYY-MM-DD
  const isoMatch = str.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10);
    if (month >= 1 && month <= 12) {
      return `${UKRAINIAN_MONTH_NAMES[month - 1]} ${year}`;
    }
  }

  // Try DD.MM.YYYY
  const ddmmyyyyMatch = str.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (ddmmyyyyMatch) {
    const month = parseInt(ddmmyyyyMatch[2], 10);
    let year = parseInt(ddmmyyyyMatch[3], 10);
    if (year < 100) year = 2000 + year;
    if (month >= 1 && month <= 12) {
      return `${UKRAINIAN_MONTH_NAMES[month - 1]} ${year}`;
    }
  }

  // Try text month e.g. "15 вересня 2026"
  const lower = str.toLowerCase();
  for (let i = 0; i < UKRAINIAN_MONTH_NAMES.length; i++) {
    const mName = UKRAINIAN_MONTH_NAMES[i].toLowerCase();
    const stem = mName.slice(0, 3);
    if (lower.includes(stem)) {
      const yearMatch = str.match(/\b(20\d{2})\b/);
      const year = yearMatch ? parseInt(yearMatch[1], 10) : now.getFullYear();
      return `${UKRAINIAN_MONTH_NAMES[i]} ${year}`;
    }
  }

  // Try standard parse
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return `${UKRAINIAN_MONTH_NAMES[parsed.getMonth()]} ${parsed.getFullYear()}`;
  }

  return `${UKRAINIAN_MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;
}
