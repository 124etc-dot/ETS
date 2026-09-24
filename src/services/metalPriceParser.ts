import * as XLSX from 'xlsx';
import {
  MaterialItem,
  MaterialCategory,
  ParsedPriceItem,
  PriceParseResult,
} from '../types/calculator';

export const UNIT_ONLY_REGEX = /^(т|т\.|од|од\.|м|м\.п\.|м2|м²|шт|шт\.|кг|кг\.)$/i;

/**
 * Strict check: returns true if text represents a table header column or document header.
 * Under NO circumstances can these strings become folder/category names!
 * Examples: 'Ціна роздрібна з ПДВ', 'Найменування', 'Одиниця виміру', 'Вартість різки'
 */
export function isTableHeaderRowOrText(text: string): boolean {
  if (!text) return false;
  const t = text
    .toLowerCase()
    .trim()
    .replace(/^[📁📂\s\-_:;]+/, '')
    .replace(/[:;\.]$/, '');
  if (!t) return false;

  const headerKeywords = [
    'ціна роздрібна з пдв',
    'ціна роздрібна',
    'ціна оптова з пдв',
    'ціна оптова',
    'ціна з пдв',
    'ціна без пдв',
    'ціна за од',
    'ціна за тонну',
    'ціна за 1 м',
    'ціна за м',
    'ціна за лист',
    'роздрібна ціна',
    'найменування товару',
    'найменування',
    'назва товару',
    'назва матеріалу',
    'одиниця виміру',
    'од. вим.',
    'од.вим.',
    'од. виміру',
    'од.',
    'вартість різки',
    'вартість порізки',
    'вартість 1 різу',
    'вартість різання',
    'вартість',
    'порізка',
    'різка',
    'довжина в м',
    'довжина, м',
    'довжина (м)',
    'довжина м',
    'довжина',
    'марка сталі',
    'марка',
    'характеристика',
    'гост',
    'дсту',
    'артикул',
    'код товару',
    'код',
    '№ п/п',
    '№ з/п',
    '№ пп',
    '№',
    'кількість',
    'залишок',
    'склад',
    'вага 1 м',
    'вага 1 м.п.',
    'вага',
  ];

  for (const phrase of headerKeywords) {
    if (t === phrase) return true;
    if (t.startsWith(phrase) && t.length < phrase.length + 15) return true;
  }

  // Multi-column row header detection, e.g. "Найменування Од. Ціна роздрібна з ПДВ"
  let matchHits = 0;
  for (const word of ['ціна', 'найменування', 'од.', 'одиниця', 'артикул', 'довжина', 'різка', 'порізка', 'розмір']) {
    if (t.includes(word)) matchHits++;
  }
  if (matchHits >= 2) return true;

  return false;
}

/**
 * Distributes metal items strictly into their material folders:
 * Квадрат -> «Квадрат»
 * Дріт -> «Дріт»
 * Балка / Двотавр -> «Балка»
 * Арматура -> «Арматура» (або «Арматура мірної довжини»)
 * Труба профільна -> «Труба профільна» (або «Труба профільна квадратна» / «Труба профільна прямокутна»)
 * Труба кругла / ВГП -> «Труба кругла» / «Труба ВГП» / «Труба електрозварна»
 * Кутник -> «Кутник»
 * Швелер -> «Швелер»
 * Круг -> «Круг»
 * Полоса / Смуга -> «Полоса»
 * Лист -> «Листовий прокат»
 * Шестигранник -> «Шестигранник»
 * Сітка -> «Сітка»
 * Рейка -> «Рейка»
 */
export function inferMaterialFolder(itemName: string, currentGroup?: string): string {
  const cleanGroup = (currentGroup || '')
    .replace(/^[📁📂\s\-_:;]+/, '')
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/[:;\.]$/, '')
    .trim();

  // If currentGroup is a table header or generic placeholder, it is FORBIDDEN
  const isInvalidGroup =
    !cleanGroup ||
    isTableHeaderRowOrText(cleanGroup) ||
    cleanGroup.toLowerCase().includes('ціна') ||
    cleanGroup === 'Загальний прокат' ||
    cleanGroup === 'Загальний сортамент';

  const nameLow = (itemName || '').toLowerCase();

  // Strict material folder distribution based on product type
  if (nameLow.includes('квадрат')) {
    return 'Квадрат';
  }
  if (nameLow.includes('дріт') || nameLow.includes('проволока')) {
    return 'Дріт';
  }
  if (nameLow.includes('балка') || nameLow.includes('двотавр')) {
    return 'Балка';
  }
  if (nameLow.includes('арматура')) {
    if (nameLow.includes('мірної') || (!isInvalidGroup && cleanGroup.toLowerCase().includes('мірної'))) {
      return 'Арматура мірної довжини';
    }
    return 'Арматура';
  }
  if (nameLow.includes('труба')) {
    if (nameLow.includes('прямокутн')) return 'Труба профільна прямокутна';
    if (nameLow.includes('квадратн')) return 'Труба профільна квадратна';
    if (nameLow.includes('профільн')) return 'Труба профільна';
    if (nameLow.includes('вгп')) return 'Труба ВГП';
    if (nameLow.includes('електрозварн')) return 'Труба електрозварна';
    if (nameLow.includes('безшовн')) return 'Труба безшовна';
    return 'Труба кругла';
  }
  if (nameLow.includes('кутник') || nameLow.includes('уголок')) {
    return 'Кутник';
  }
  if (nameLow.includes('швелер')) {
    return 'Швелер';
  }
  if (nameLow.includes('круг') || nameLow.includes('пруток')) {
    return 'Круг';
  }
  if (nameLow.includes('полоса') || nameLow.includes('смуга')) {
    return 'Полоса';
  }
  if (nameLow.includes('лист') || nameLow.includes('бляха') || nameLow.includes('плита') || nameLow.includes('рулон')) {
    return 'Листовий прокат';
  }
  if (nameLow.includes('сітка')) {
    return 'Сітка';
  }
  if (nameLow.includes('шестигранник')) {
    return 'Шестигранник';
  }
  if (nameLow.includes('рейка')) {
    return 'Рейка';
  }

  // If no keyword matched, use valid currentGroup if present
  if (!isInvalidGroup) {
    return cleanGroup;
  }

  return 'Чорний металопрокат';
}

/**
 * Extracts steel grade from item name if present (e.g., 'ст.3', 'ст.45', 'ст.20', '09Г2С', 'А500С', 'А240', 'AISI 304')
 */
export function extractSteelGrade(name: string): string | null {
  const norm = name.toLowerCase();
  const match =
    norm.match(/(?:ст\.?|сталь\s*|марка\s*)([0-9]+[а-яa-z]*|09г2с|25г2с|35гс)/i) ||
    norm.match(/\b(09г2с|25г2с|35гс|а500с|а400|а240|aisi\s*\d{3})\b/i);
  if (match) {
    return match[1].replace(/\s+/g, '').replace('сталь', '').trim();
  }
  return null;
}

/**
 * Canonical comparison key: strips filler words like 'металевий', 'сталевий', 'мірної довжини', 'мм', spaces
 */
export function canonicalMaterialKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/мірної довжини/g, '')
    .replace(/металевий|сталевий|калібрований|гарячекатаний|холоднокатаний/g, '')
    .replace(/\bмм\b/g, '')
    .replace(/[\s\t\n\-_(),.;"'/«»]+/g, '')
    .replace(/x/g, 'х')
    .trim();
}

/**
 * Checks if two material records represent the exact same product position:
 * 1. Normalized exact name match
 * 2. Canonical key match (ignoring filler adjectives like 'металевий' / 'сталевий' / 'мірної довжини')
 *    while respecting steel grade distinction (e.g. ст.45 vs ст.20)
 * 3. SKU / sourceArticle match
 */
export function areMaterialsMatching(
  m1: { name: string; sourceArticle?: string },
  m2: { name: string; sourceArticle?: string }
): boolean {
  if (m1.sourceArticle && m2.sourceArticle && m1.sourceArticle.toLowerCase() === m2.sourceArticle.toLowerCase()) {
    return true;
  }

  const norm1 = MetalPriceParserService.normalizeName(m1.name);
  const norm2 = MetalPriceParserService.normalizeName(m2.name);
  if (norm1 === norm2) return true;

  const key1 = canonicalMaterialKey(m1.name);
  const key2 = canonicalMaterialKey(m2.name);

  if (key1 === key2) {
    const grade1 = extractSteelGrade(m1.name);
    const grade2 = extractSteelGrade(m2.name);
    if (grade1 && grade2) {
      return grade1 === grade2;
    }
    return true;
  }

  return false;
}

/**
 * Forms the complete product name according to the business rule:
 * [Підкатегорія] + [Специфікація/Розмір]
 * - Strictly ignores standalone units ('т', 'м.п.', 'шт', 'кг')
 * - Example: group 'Арматура мірної довжини' + '6 міра' -> 'Арматура мірної довжини 6 міра'
 */
export function formatFullMaterialName(
  rawName: string,
  subcategoryOrGroup: string,
  article?: string
): string {
  const isInvalid = isTableHeaderRowOrText(subcategoryOrGroup);
  const cleanGroup = isInvalid
    ? ''
    : (subcategoryOrGroup || '')
        .replace(/^[📁📂\s\-_:;]+/, '')
        .replace(/\s*\([^)]*\)/g, '')
        .replace(/[:;\.]$/, '')
        .trim();

  let name = (rawName || '').trim();

  // 1. Column shift check: if name is just a unit or empty or 1-2 unit chars
  if (!name || UNIT_ONLY_REGEX.test(name) || (name.length <= 2 && /^(т|м|од|кг|шт)$/i.test(name))) {
    // If we have an article (e.g. ARM-006, TR-40402), extract dimension/spec
    let specFromArticle = '';
    if (article) {
      const artMatch = article.match(/(?:ARM|АРМ)[-_]0*([0-9]+)/i);
      if (artMatch) {
        specFromArticle = `${artMatch[1]} міра`;
      } else {
        const genMatch = article.match(/[-_]([A-Za-z0-9]+)$/);
        if (genMatch) {
          specFromArticle = genMatch[1];
        }
      }
    }
    if (specFromArticle && cleanGroup) {
      return `${cleanGroup} ${specFromArticle}`;
    }
    return cleanGroup || inferMaterialFolder(rawName, '') || 'Металопрокат';
  }

  // 2. Remove accidental unit suffixes or prefixes: "6 міра т" -> "6 міра", "т 6 міра" -> "6 міра"
  name = name.replace(/\s+(т|т\.|од|од\.|м|м\.п\.|шт|кг)$/i, '').trim();
  name = name.replace(/^(т|т\.|од|од\.|м|м\.п\.|шт|кг)\s+/i, '').trim();

  // 3. Concatenate [Підкатегорія] + [Специфікація/Розмір]
  // Case A: Name is just "6 міра", "8 міра", "10 міра", "12 міра"
  if (/^[0-9]+(\.[0-9]+)?\s*міра$/i.test(name)) {
    if (cleanGroup) {
      return `${cleanGroup} ${name}`;
    }
    return `Арматура ${name}`;
  }

  // Case B: Name is "Арматура 6 міра" and cleanGroup is "Арматура мірної довжини"
  if (/^арматура\s+[0-9]+(\.[0-9]+)?\s*міра$/i.test(name) && cleanGroup.toLowerCase().includes('арматура мірної довжини')) {
    const sizePart = name.replace(/^арматура\s+/i, '');
    return `${cleanGroup} ${sizePart}`;
  }

  // Case C: Name is just dimensions like "20х20х2", "40х40х2 мм" and cleanGroup is "Труба профільна квадратна"
  if (/^[0-9]+х[0-9]+/i.test(name) && cleanGroup) {
    if (!name.toLowerCase().includes(cleanGroup.toLowerCase().split(' ')[0])) {
      return `${cleanGroup} ${name}`;
    }
  }

  // Case D: Name is just a number like "20", "25", "30" and cleanGroup is "Квадрат"
  if (/^[0-9]+$/i.test(name) && cleanGroup) {
    return `${cleanGroup} ${name}`;
  }

  return name;
}

/**
 * Normalizes parsed items table to fix column shifts, price inversions and folder assignments:
 * - Strictly ignores cutting cost (never saves cutting cost)
 * - Corrects groupHeader to genuine material folder (never table headers!)
 * - If name === 'т' or 'м.п.', recovers name from group / context
 * - If basePrice > 3000 for profiles/rebar, swaps with tonPrice or neighboring price
 */
export function normalizeParsedItems(items: ParsedPriceItem[]): ParsedPriceItem[] {
  return items.map((row) => {
    let name = row.name;
    const rawGroup = row.groupHeader || 'Чорний металопрокат';
    let basePrice = Number(row.basePrice) || 0;
    let tonPrice = row.tonPrice !== undefined ? Number(row.tonPrice) : undefined;

    // Strict Taboo: Complete omission of cutting costs
    // cuttingPrice is explicitly ignored / removed

    // 1. Column Shift Normalization:
    // If unit was saved as name ('т' or 'м.п.' or 'од' or empty)
    if (!name || UNIT_ONLY_REGEX.test(name) || name === 'т' || name === 'м.п.' || name.length <= 2) {
      name = formatFullMaterialName('', rawGroup, row.sourceArticle);
    } else {
      name = formatFullMaterialName(name, rawGroup, row.sourceArticle);
    }

    // 2. Strict Material Folder Distribution:
    // Table headers (e.g. "Ціна роздрібна з ПДВ") are FORBIDDEN from ever being a folder!
    const groupHeader = inferMaterialFolder(name, rawGroup);

    const isSheet =
      name.toLowerCase().includes('лист') ||
      name.toLowerCase().includes('бляха') ||
      name.toLowerCase().includes('плита') ||
      groupHeader.toLowerCase().includes('лист');

    // 3. Strict Single Price Column Validation:
    // For armature, tubes, profiles, bar: retail price per meter must NOT be ton price (e.g. 58 785 грн)!
    // If price > 3000 грн/м.п. for non-sheet:
    if (!isSheet && basePrice > 3000) {
      if (tonPrice && tonPrice > 0 && tonPrice <= 3000) {
        // Swap tonPrice and basePrice
        const temp = basePrice;
        basePrice = tonPrice;
        tonPrice = temp;
      } else if (!tonPrice || tonPrice <= 0) {
        tonPrice = basePrice;
      }
    }

    // Safeguard for sheet metal:
    if (isSheet && basePrice > 10000 && tonPrice && tonPrice <= 5000 && tonPrice > 0) {
      const temp = basePrice;
      basePrice = tonPrice;
      tonPrice = temp;
    }

    const unit = isSheet ? 'м²' : 'м.п.';
    const category: MaterialCategory = isSheet ? 'sheet_metal' : 'metal_profile';

    return {
      ...row,
      name,
      category,
      groupHeader,
      unit,
      basePrice: Math.round(basePrice * 100) / 100,
      tonPrice: tonPrice ? Math.round(tonPrice * 100) / 100 : undefined,
      cuttingPrice: undefined, // Strictly ignored as per specification
    };
  });
}

export class MetalPriceParserService {
  /**
   * Helper to normalize text for string comparisons
   */
  public static normalizeName(str: string): string {
    return str
      .toLowerCase()
      .replace(/[\s\t\n]+/g, ' ')
      .replace(/[,;:]/g, ' ')
      .replace(/["'«»]/g, '')
      .replace(/x/g, 'х') // English x to Cyrillic х
      .trim();
  }

  /**
   * Parse numeric price string (supports comma, space, currency symbols)
   */
  public static parseNumeric(val: any): number | null {
    if (val === null || val === undefined) return null;
    if (typeof val === 'number') {
      return isNaN(val) ? null : val;
    }
    const cleanStr = String(val)
      .replace(/\s+/g, '')
      .replace(/грн|₴|uah|rub|usd|eur/gi, '')
      .replace(',', '.')
      .trim();

    if (!cleanStr) return null;
    const num = parseFloat(cleanStr);
    return isNaN(num) ? null : num;
  }

  /**
   * Check if text represents a main category header
   */
  private static isMainCategoryText(text: string): boolean {
    const t = text.toLowerCase();
    return (
      t.includes('чорний метал') ||
      t.includes('нержавіючий метал') ||
      t.includes('алюмінієв') ||
      t.includes('кольоровий метал') ||
      t.includes('металопрокат')
    );
  }

  /**
   * Determine material category and unit from item name
   */
  public static determineCategoryAndUnit(itemName: string): {
    category: MaterialCategory;
    unit: string;
  } {
    const nameLow = itemName.toLowerCase();
    if (
      nameLow.includes('лист') ||
      nameLow.includes('бляха') ||
      nameLow.includes('плита') ||
      nameLow.includes('рулон')
    ) {
      return { category: 'sheet_metal', unit: 'м²' };
    }
    return { category: 'metal_profile', unit: 'м.п.' };
  }

  /**
   * Helper to convert File to Base64 data string
   */
  public static async fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(file);
    });
  }

  /**
   * Client-side fallback text extractor using pdfjs-dist
   */
  public static async extractLinesFromPdf(buffer: ArrayBuffer): Promise<string[][]> {
    try {
      if (typeof (Promise as any).try !== 'function') {
        (Promise as any).try = function<T>(fn: () => T | PromiseLike<T>): Promise<T> {
          return new Promise((resolve) => resolve(fn()));
        };
      }

      let pdfjsLib: any;
      try {
        pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
      } catch {
        pdfjsLib = await import('pdfjs-dist');
      }

      try {
        if (!pdfjsLib.GlobalWorkerOptions?.workerSrc) {
          pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
        }
      } catch (e) {
        // worker configuration is optional for plain text extraction
      }

      const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(buffer),
        useWorkerFetch: false,
        useSystemFonts: true,
      });

      const pdfDoc = await loadingTask.promise;
      const allRows: string[][] = [];

      for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
        const page = await pdfDoc.getPage(pageNum);
        const textContent = await page.getTextContent();

        // Group text items by vertical Y position (row bucketing ~ 3.5px tolerance)
        const lineBuckets = new Map<number, { x: number; text: string; width: number }[]>();
        for (const item of textContent.items as any[]) {
          if (!item.str || !item.str.trim()) continue;
          const y = Math.round((item.transform?.[5] || 0) / 3.5) * 3.5;
          const x = item.transform?.[4] || 0;
          const width = item.width || 0;
          if (!lineBuckets.has(y)) {
            lineBuckets.set(y, []);
          }
          lineBuckets.get(y)!.push({ x, text: item.str, width });
        }

        // Sort rows by Y descending (PDF coordinates origin is bottom-left)
        const sortedYs = Array.from(lineBuckets.keys()).sort((a, b) => b - a);
        for (const y of sortedYs) {
          const rawItems = lineBuckets.get(y)!;
          rawItems.sort((a, b) => a.x - b.x);

          // Group adjacent items that belong to the same cell/column
          const cells: string[] = [];
          let currentCell = '';
          let lastRight = -1;

          for (let i = 0; i < rawItems.length; i++) {
            const item = rawItems[i];
            const text = item.text.trim();
            if (!text) continue;

            const isUnit = /^(т|т\.|од|од\.|м|м\.п\.|м²|шт|кг)$/i.test(text);
            const isPureNumber = /^[0-9]+([.,][0-9]+)?$/.test(text.replace(/\s+/g, ''));
            const prevHadCyrillic = currentCell && /[а-яіїєґ]/i.test(currentCell);

            // A new column starts if:
            // 1. Significant horizontal gap (> 14 pt)
            // 2. The item is an explicit unit indicator ("т", "од.")
            // 3. The item is a pure price number appearing after words
            const isNewCol =
              lastRight !== -1 &&
              (item.x - lastRight > 14 ||
               isUnit ||
               (isPureNumber && prevHadCyrillic));

            if (isNewCol && currentCell) {
              cells.push(currentCell.trim());
              currentCell = text;
            } else {
              currentCell = currentCell ? `${currentCell} ${text}` : text;
            }

            lastRight = item.x + (item.width || (text.length * 5.5));
          }
          if (currentCell) {
            cells.push(currentCell.trim());
          }

          if (cells.length > 0) {
            allRows.push(cells);
          }
        }
      }

      return allRows;
    } catch (err) {
      console.warn('pdfjs-dist text extraction error:', err);
      return [];
    }
  }

  /**
   * Parse PDF file (Metal Holding, Metinvest, etc.)
   */
  public static async parsePdfFile(
    file: File,
    existingMaterials: MaterialItem[],
    customSupplier?: string
  ): Promise<PriceParseResult> {
    const supplier = customSupplier?.trim() || 'ТОВ «Метал Холдінг»';

    // 1. Try server-side AI parsing via Gemini
    try {
      const base64 = await this.fileToBase64(file);
      const res = await fetch('/api/metal-price/parse-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileData: base64,
          fileName: file.name,
          existingMaterials,
          customSupplier: supplier,
        }),
      });

      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.recognizedItems) && json.recognizedItems.length > 0) {
          return json;
        }
      }
    } catch (netErr) {
      console.warn('Server-side PDF parse failed or offline, trying client-side fallback:', netErr);
    }

    // 2. Client-side fallback using pdfjs-dist
    try {
      const buffer = await file.arrayBuffer();
      const rows = await this.extractLinesFromPdf(buffer);
      if (rows.length > 0) {
        const parsed = this.parse2DArray(rows, file.name, existingMaterials, supplier);
        if (parsed.recognizedItems.length > 0) {
          return parsed;
        }
      }
    } catch (clientErr) {
      console.warn('Client-side PDF fallback failed:', clientErr);
    }

    throw new Error(
      `Не вдалося зчитати дані з PDF «${file.name}». Переконайтеся, що файл містить таблицю з найменуванням та роздрібними цінами за 1 м/лист.`
    );
  }

  /**
   * Parse Excel (.xlsx, .xls), CSV or PDF (.pdf) file
   */
  public static async parseFile(
    file: File,
    existingMaterials: MaterialItem[],
    customSupplier?: string
  ): Promise<PriceParseResult> {
    const isPdf =
      file.name.toLowerCase().endsWith('.pdf') ||
      file.type === 'application/pdf';

    if (isPdf) {
      return this.parsePdfFile(file, existingMaterials, customSupplier);
    }

    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, {
      type: 'array',
      cellDates: false,
      raw: false,
    });

    // Use first sheet
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      throw new Error(`У файлі «${file.name}» не знайдено жодного аркуша.`);
    }

    // Convert sheet to 2D array
    const rawRows: any[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: '',
      blankrows: false,
    });

    return this.parse2DArray(rawRows, file.name, existingMaterials, customSupplier);
  }

  /**
   * Core parser on 2D table array
   * СТРОГО дотримується правила 3 колонок:
   * 1. Група (Підкатегорія) - рядок заголовка без цін
   * 2. Назва товару - всі слова повністю («Арматура 6 міра»), не обрізати і не брати одиницю «т»
   * 3. Ціна за метр/лист - друга колонка ціни («за 1 м/ лист»), ігноруючи ціну за тонну («за од.»)
   */
  public static parse2DArray(
    rows: any[][],
    fileName: string,
    existingMaterials: MaterialItem[],
    customSupplier?: string
  ): PriceParseResult {
    const errors: string[] = [];
    const groupHeadersFound: string[] = [];
    const recognizedItems: ParsedPriceItem[] = [];

    let mainCategory = 'Чорний металопрокат';
    let currentSubcategory = 'Чорний металопрокат';
    let currentGroupHeader = 'Арматура мірної довжини';
    let supplier = customSupplier?.trim() || 'ТОВ «Метал Холдінг»';

    // 1. Scan early rows to identify table column indices if header exists
    let headerRowIdx = -1;
    let nameColIdx = -1;
    let unitColIdx = -1;
    let priceTonColIdx = -1;
    let priceMeterColIdx = -1;
    let articleColIdx = -1;
    const cuttingColIndices = new Set<number>();

    for (let r = 0; r < Math.min(rows.length, 12); r++) {
      const row = rows[r] || [];
      const rowTextJoined = row.map((c) => String(c || '').trim()).filter(Boolean).join(' ').toLowerCase();

      // Check for main category
      if (this.isMainCategoryText(rowTextJoined)) {
        if (rowTextJoined.includes('нержав')) {
          mainCategory = 'Нержавіючий металопрокат';
          currentSubcategory = 'Нержавіючий металопрокат';
        } else if (rowTextJoined.includes('алюмін')) {
          mainCategory = 'Алюмінієвий прокат';
          currentSubcategory = 'Алюмінієвий прокат';
        } else if (rowTextJoined.includes('чорн')) {
          mainCategory = 'Чорний металопрокат';
          currentSubcategory = 'Чорний металопрокат';
        }
      }

      // Check if this row already has product prices (if so, stop header scanning)
      const hasPricesInRow = row.some((c) => {
        const num = this.parseNumeric(c);
        return num !== null && num > 0;
      });
      if (hasPricesInRow) {
        break;
      }

      let hasNameHeader = false;
      let hasPriceHeader = false;

      for (let c = 0; c < row.length; c++) {
        const val = String(row[c] || '').toLowerCase().trim();
        if (!val) continue;

        if (val.includes('різка') || val.includes('порізка') || val.includes('1 різ')) {
          // Strictly mark cutting price column to completely ignore it
          cuttingColIndices.add(c);
        } else if (val.includes('назва') || val.includes('найменування') || val.includes('товар') || val.includes('номенклатура')) {
          nameColIdx = c;
          hasNameHeader = true;
        } else if (val === 'од.' || val === 'од' || val === 'од. вим.' || val.includes('одиниця')) {
          unitColIdx = c;
        } else if (val.includes('за од') || val.includes('за т') || val.includes('ціна за т') || val.includes('ціна за од')) {
          priceTonColIdx = c;
          hasPriceHeader = true;
        } else if (
          (val.includes('ціна') && (val.includes('1 м') || val.includes('1м') || val.includes('м.п.') || val.includes('лист') || val.includes('роздріб'))) ||
          val === 'за 1 м' ||
          val === 'за 1 м.п.' ||
          val === 'за 1м' ||
          val === 'за лист' ||
          val === 'ціна роздрібна' ||
          val === 'ціна роздрібна з пдв'
        ) {
          // Strictly the meter / sheet price column
          priceMeterColIdx = c;
          hasPriceHeader = true;
        } else if (val.includes('артикул') || val === 'код') {
          articleColIdx = c;
        }
      }

      if (hasNameHeader || hasPriceHeader) {
        headerRowIdx = r;
      }
    }

    const startRow = headerRowIdx !== -1 ? headerRowIdx + 1 : 0;

    // 2. Process data rows
    for (let r = startRow; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.length === 0) continue;

      const cleanCells = row.map((c) => (c !== undefined && c !== null ? String(c).trim() : '')).filter(Boolean);
      if (cleanCells.length === 0) continue;

      const rowJoined = cleanCells.join(' ');
      const rowLow = rowJoined.toLowerCase();

      // Skip table headers, document banners and column header rows
      if (
        isTableHeaderRowOrText(rowJoined) ||
        rowLow.includes('ціна роздрібна з пдв') ||
        rowLow.includes('найменування товару') ||
        rowLow.includes('назва товару') ||
        (rowLow.includes('артикул') && rowLow.includes('ціна')) ||
        (rowLow.includes('од.') && rowLow.includes('ціна')) ||
        rowLow.includes('metal-holding') ||
        rowLow.includes('офіційний прайс') ||
        rowLow.includes('діє з:') ||
        rowLow.includes('товариство з обмеженою') ||
        rowLow.includes('всі ціни вказані в гривнях')
      ) {
        if (rowLow.includes('нержав')) {
          mainCategory = 'Нержавіючий металопрокат';
          currentSubcategory = 'Нержавіючий металопрокат';
        } else if (rowLow.includes('алюмін')) {
          mainCategory = 'Алюмінієвий прокат';
          currentSubcategory = 'Алюмінієвий прокат';
        } else if (rowLow.includes('чорн')) {
          mainCategory = 'Чорний металопрокат';
          currentSubcategory = 'Чорний металопрокат';
        }
        continue;
      }

      // Collect all numeric values in row with their cell index (EXCLUDING cutting price column)
      const numCells: { idx: number; val: number; raw: string }[] = [];
      for (let c = 0; c < row.length; c++) {
        // STRICT RULE: Completely exclude cutting price column from reading
        if (cuttingColIndices.has(c)) continue;

        const val = row[c];
        if (val === undefined || val === null || val === '') continue;
        const num = this.parseNumeric(val);
        if (num !== null && num > 0) {
          numCells.push({ idx: c, val: num, raw: String(val).trim() });
        }
      }

      // Check if row is a GROUP HEADER (Folder)
      // Condition: No prices in price columns or no numeric cells at all
      const isHeaderRow = numCells.length === 0;

      if (isHeaderRow) {
        let groupTitle = cleanCells.join(' ')
          .replace(/^[📁📂\s\-_:;]+/, '')
          .replace(/\s*\([^)]*\)/g, '') // remove (сталь 25Г2С...), (ГОСТ...)
          .replace(/[:;\.]$/, '')
          .trim();

        if (!groupTitle || groupTitle.length < 3) continue;

        // STRICT FILTER: Table headers (e.g. "Ціна роздрібна з ПДВ") must NEVER become group folders!
        if (isTableHeaderRowOrText(groupTitle)) {
          continue;
        }

        // Skip footnotes or disclaimer lines
        const groupTitleLow = groupTitle.toLowerCase();
        if (
          groupTitle.startsWith('*') ||
          groupTitleLow.startsWith('примітка') ||
          groupTitleLow.startsWith('послуги') ||
          groupTitleLow.includes('враховуються додатково')
        ) {
          continue;
        }

        if (this.isMainCategoryText(groupTitle)) {
          if (groupTitle.toLowerCase().includes('нержав')) {
            mainCategory = 'Нержавіючий металопрокат';
            currentSubcategory = 'Нержавіючий металопрокат';
          } else if (groupTitle.toLowerCase().includes('алюмін')) {
            mainCategory = 'Алюмінієвий прокат';
            currentSubcategory = 'Алюмінієвий прокат';
          } else if (groupTitle.toLowerCase().includes('чорн')) {
            mainCategory = 'Чорний металопрокат';
            currentSubcategory = 'Чорний металопрокат';
          }
        } else {
          currentGroupHeader = groupTitle;
          if (!groupHeadersFound.includes(groupTitle)) {
            groupHeadersFound.push(groupTitle);
          }
        }
        continue;
      }

      // PRODUCT ROW
      // 1. Locate Unit cell if present ("т", "м", "од")
      let unitCellIdx = -1;
      for (let c = 0; c < row.length; c++) {
        const cell = String(row[c] || '').trim().toLowerCase();
        if (UNIT_ONLY_REGEX.test(cell)) {
          unitCellIdx = c;
          break;
        }
      }

      // 2. Extract Product Name (ВСІ слова повністю!)
      let nameParts: string[] = [];
      let article: string | undefined = undefined;

      // Determine where the name cells are
      let endNameIdx = unitCellIdx !== -1 ? unitCellIdx : (numCells[0]?.idx ?? row.length);

      for (let c = 0; c < endNameIdx; c++) {
        const cell = String(row[c] || '').trim();
        if (!cell) continue;

        // Check for article code in first cell
        if (c === 0 && (/^[A-Z0-9]{2,10}[-_][A-Z0-9]+$/i.test(cell) || /^(ARM|TR|LST|KUT|SHV|АРМ|ТР|КУТ|ЛСТ|ШВ)-/i.test(cell))) {
          article = cell;
          continue;
        }

        nameParts.push(cell);
      }

      let itemName = nameParts.join(' ').trim();

      // Fallback if name was in nameColIdx
      if (!itemName && nameColIdx !== -1 && row[nameColIdx]) {
        const fallbackCell = String(row[nameColIdx]).trim();
        if (!UNIT_ONLY_REGEX.test(fallbackCell)) {
          itemName = fallbackCell;
        }
      }

      // Check for column shift: if itemName is empty or matches a unit ('т', 'м.п.', 'од', etc.)
      if (!itemName || UNIT_ONLY_REGEX.test(itemName) || itemName === 'т' || itemName === 'м.п.') {
        // Search other cells for specification/size (e.g. '6 міра', '20х20х2')
        let specFound = '';
        for (let c = 0; c < row.length; c++) {
          const val = String(row[c] || '').trim();
          if (/^[0-9]+(\.[0-9]+)?\s*міра$/i.test(val) || /^[0-9]+х[0-9]+/i.test(val)) {
            specFound = val;
            break;
          }
          if (c === 0 && /^[A-Z0-9]{2,10}[-_][A-Z0-9]+$/i.test(val)) {
            article = val;
          }
        }
        itemName = formatFullMaterialName(specFound, currentGroupHeader, article);
      } else {
        itemName = formatFullMaterialName(itemName, currentGroupHeader, article);
      }

      // Strict Taboo: Never allow a unit or blank to be an item name!
      if (!itemName || UNIT_ONLY_REGEX.test(itemName) || itemName === 'т' || itemName === 'м.п.') {
        continue;
      }

      // 3. Extract Single Price (строго роздрібна ціна за 1 м/ лист):
      // ❌ НЕ брати колонку ціни за тонну (58 785 грн / 51 180 грн)
      // ❌ ПОВНІСТЮ ІГНОРУВАТИ вартість порізки!
      // ✅ Брати СТРOГО роздрібну ціну за 1 м/ лист (14.05, 175.36, 273.66, 393.21)
      let baseMeterPrice: number | null = null;
      let tonPrice: number | undefined = undefined;

      // Case A: If explicit priceMeterColIdx matched
      if (priceMeterColIdx !== -1 && row[priceMeterColIdx] !== undefined) {
        const val = this.parseNumeric(row[priceMeterColIdx]);
        if (val !== null && val > 0) {
          baseMeterPrice = val;
        }
      }

      // Case B: Filter numeric values that are at or after unitCellIdx (or after name)
      const priceCandidates = numCells.filter((nc) => nc.idx >= (unitCellIdx !== -1 ? unitCellIdx : endNameIdx));

      // Separate length (often integer 6 or 12 between ton and meter price)
      const nonLengthPrices: number[] = [];
      for (const pc of priceCandidates) {
        if ((pc.val === 6 || pc.val === 12) && priceCandidates.length >= 2) {
          const pos = priceCandidates.indexOf(pc);
          if (pos > 0 && pos < priceCandidates.length - 1) {
            continue; // Skip length column
          }
        }
        nonLengthPrices.push(pc.val);
      }

      if (nonLengthPrices.length >= 2) {
        // First price is Ton Price (e.g. 58 785 грн / 51 180 грн) -> ❌ DO NOT USE AS BASE PRICE
        tonPrice = nonLengthPrices[0];
        // Second price is Meter / Sheet Price (e.g. 14.05 грн, 175.36 грн) -> ✅ STRICTLY USE AS BASE PRICE
        if (baseMeterPrice === null || baseMeterPrice > 3000) {
          baseMeterPrice = nonLengthPrices[1];
        }
      } else if (nonLengthPrices.length === 1 && baseMeterPrice === null) {
        const singleVal = nonLengthPrices[0];
        if (singleVal > 10000) {
          tonPrice = singleVal;
        } else {
          baseMeterPrice = singleVal;
        }
      }

      const isSheet =
        itemName.toLowerCase().includes('лист') ||
        itemName.toLowerCase().includes('бляха') ||
        itemName.toLowerCase().includes('плита') ||
        currentGroupHeader.toLowerCase().includes('лист');

      // Validation check: if baseMeterPrice > 3000 грн/м.п. for rebar or profiles, this is ton price!
      if (!isSheet && baseMeterPrice !== null && baseMeterPrice > 3000) {
        tonPrice = baseMeterPrice;
        // Search rightward in nonLengthPrices for genuine meter price
        const meterCandidate = nonLengthPrices.find((p) => p > 0 && p <= 3000);
        if (meterCandidate) {
          baseMeterPrice = meterCandidate;
        }
      }

      if (baseMeterPrice === null || baseMeterPrice <= 0) {
        continue;
      }

      // 4. Strict Material Folder Distribution:
      // All items (e.g. Квадрат металевий 20, Дріт, Балка) strictly into their material folders!
      const targetFolder = inferMaterialFolder(itemName, currentGroupHeader);
      if (!groupHeadersFound.includes(targetFolder)) {
        groupHeadersFound.push(targetFolder);
      }

      // 5. Determine category and unit
      const { category, unit } = this.determineCategoryAndUnit(itemName);

      // 6. Match with existing material position (anti-duplicate check)
      const existingMatch = existingMaterials.find(
        (em) => areMaterialsMatching(em, { name: itemName, sourceArticle: article })
      );

      recognizedItems.push({
        name: itemName,
        category,
        parentCategory: 'Металопрокат',
        subcategory: currentSubcategory,
        groupHeader: targetFolder,
        unit,
        basePrice: Math.round(baseMeterPrice * 100) / 100,
        cuttingPrice: undefined, // COMPLETELY IGNORED as requested
        sourceArticle: article,
        tonPrice: tonPrice ? Math.round(tonPrice * 100) / 100 : undefined,
        isExisting: !!existingMatch,
        existingId: existingMatch?.id,
        oldPrice: existingMatch?.basePrice,
      });
    }

    const normalizedList = normalizeParsedItems(recognizedItems);

    const newItemsCount = normalizedList.filter((i) => !i.isExisting).length;
    const updatedItemsCount = normalizedList.filter((i) => i.isExisting).length;

    return {
      fileName,
      supplier,
      mainCategory,
      totalRowsRead: rows.length,
      recognizedItems: normalizedList,
      groupHeadersFound,
      newItemsCount,
      updatedItemsCount,
      errors,
    };
  }

  /**
   * Apply imported price items into existing materials database (with update / add logic)
   * - Strict single price update: updates ONLY basePrice per meter/sheet
   * - Strict duplicate protection: matches items by name, specification, and steel grade
   * - Eliminates cutting cost from database records
   */
  public static applyImportedPrices(
    parsedItems: ParsedPriceItem[],
    supplierName: string,
    existingMaterials: MaterialItem[]
  ): {
    updatedMaterials: MaterialItem[];
    addedCount: number;
    updatedCount: number;
  } {
    let addedCount = 0;
    let updatedCount = 0;

    // Clone existing materials array for in-place updates and index by ID
    const materialsList: MaterialItem[] = existingMaterials.map((m) => ({
      ...m,
      cuttingPrice: undefined, // Clean out any previous cutting prices
      notes: m.notes && m.notes.includes('Різка:') ? undefined : m.notes,
    }));

    const nowIso = new Date().toISOString();

    for (const item of parsedItems) {
      // Find matching existing material using strict steel grade & dimensional matching
      const existingIndex = materialsList.findIndex((em) => areMaterialsMatching(em, item));

      let normSubcategory = item.subcategory || 'Чорний метал';
      if (normSubcategory.toLowerCase().includes('чорн') || normSubcategory.toLowerCase().includes('метал')) {
        if (!normSubcategory.toLowerCase().includes('нержав') && !normSubcategory.toLowerCase().includes('алюмін')) {
          normSubcategory = 'Чорний метал';
        }
      }

      if (existingIndex !== -1) {
        const existing = materialsList[existingIndex];
        // UPDATE EXISTING: only update basePrice for meter/sheet! No duplicate is created!
        const updatedItem: MaterialItem = {
          ...existing,
          basePrice: item.basePrice,
          cuttingPrice: undefined, // Completely excluded
          unit: item.unit || existing.unit,
          parentCategory: item.parentCategory || existing.parentCategory || 'Металопрокат',
          subcategory: normSubcategory,
          groupHeader: inferMaterialFolder(existing.name, item.groupHeader || existing.groupHeader),
          supplier: supplierName || existing.supplier,
          sourceArticle: item.sourceArticle || existing.sourceArticle,
          tonPrice: item.tonPrice || existing.tonPrice,
          notes: existing.notes && existing.notes.includes('Різка:') ? undefined : existing.notes,
          updatedAt: nowIso,
        };
        materialsList[existingIndex] = updatedItem;
        updatedCount++;
      } else {
        // ADD NEW ITEM: only if not already matched
        const defaultWaste = item.category === 'sheet_metal' ? 1.15 : 1.10;
        const newItem: MaterialItem = {
          id: `mat_metal_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          name: item.name,
          category: item.category,
          parentCategory: item.parentCategory || 'Металопрокат',
          subcategory: normSubcategory,
          groupHeader: inferMaterialFolder(item.name, item.groupHeader),
          unit: item.unit,
          basePrice: item.basePrice,
          cuttingPrice: undefined, // No cutting cost stored
          defaultWasteFactor: defaultWaste,
          supplier: supplierName,
          sourceArticle: item.sourceArticle,
          tonPrice: item.tonPrice,
          notes: undefined,
          updatedAt: nowIso,
        };
        materialsList.push(newItem);
        addedCount++;
      }
    }

    return {
      updatedMaterials: materialsList,
      addedCount,
      updatedCount,
    };
  }

  /**
   * Generates a sample metal pricelist Excel workbook conforming to the TZ specification
   */
  public static generateSampleWorkbook(): XLSX.WorkBook {
    const wb = XLSX.utils.book_new();

    const data: any[][] = [
      ['ЧОРНИЙ МЕТАЛОПРОКАТ'],
      ['Прайс-лист металопрокату з роздрібними цінами за 1 м.п. / лист'],
      [],
      [
        'Артикул',
        'Назва товару',
        'Од.',
        'Ціна за од. (тонну)',
        'Довжина в м',
        'Ціна роздрібна з ПДВ / за 1 м/ лист',
      ],
      // Group 1: Арматура мірної довжини
      ['', 'Арматура мірної довжини', '', '', '', ''],
      ['ARM-006', 'Арматура мірної довжини 6 міра', 'Т', 58785, 6, 14.05],
      ['ARM-008', 'Арматура мірної довжини 8 міра', 'Т', 51180, 6, 22.98],
      ['ARM-010', 'Арматура мірної довжини 10 міра', 'Т', 49500, 6, 33.10],
      ['ARM-012', 'Арматура мірної довжини 12 міра', 'Т', 48900, 6, 47.02],
      [],
      // Group 2: Труба профільна квадратна
      ['', 'Труба профільна квадратна', '', '', '', ''],
      ['TR-20202', 'Труба профільна 20х20х2 мм ст.3', 'Т', 36200, 6, 52.40],
      ['TR-40402', 'Труба профільна 40х40х2 мм ст.3', 'Т', 35800, 6, 95.80],
      ['TR-50503', 'Труба профільна 50х50х3 мм ст.3', 'Т', 35400, 6, 168.00],
      ['TR-60402', 'Труба профільна 60х40х2 мм ст.3', 'Т', 35800, 6, 124.50],
      [],
      // Group 3: Кутник рівнополичний
      ['', 'Кутник рівнополичний', '', '', '', ''],
      ['KUT-32323', 'Кутник сталевий 32х32х3 мм ст.3', 'Т', 34500, 6, 58.20],
      ['KUT-40404', 'Кутник сталевий 40х40х4 мм ст.3', 'Т', 34200, 6, 88.60],
      [],
      // Group 4: Листовий прокат г/к
      ['', 'Листовий прокат гарячекатаний', '', '', '', ''],
      ['LST-02', 'Лист г/к 2.0 мм ст.3 (розмір 1250х2500)', 'Т', 38000, 1, 890.00],
      ['LST-03', 'Лист г/к 3.0 мм ст.3 (розмір 1250х2500)', 'Т', 37500, 1, 1340.00],
    ];

    const ws = XLSX.utils.aoa_to_sheet(data);

    // Apply column widths
    ws['!cols'] = [
      { wch: 12 }, // Артикул
      { wch: 38 }, // Назва товару
      { wch: 6 },  // Од.
      { wch: 20 }, // Ціна за тонну
      { wch: 12 }, // Довжина в м
      { wch: 34 }, // Ціна роздрібна з ПДВ / за 1 м/ лист
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Чорний металопрокат');
    return wb;
  }

  /**
   * Download the sample Excel file
   */
  public static downloadSampleFile(): void {
    const wb = this.generateSampleWorkbook();
    XLSX.writeFile(wb, 'Зразок_прайсу_металопрокату.xlsx');
  }

  /**
   * Return demo items array for immediate 1-click testing
   */
  public static getDemoItems(): ParsedPriceItem[] {
    return [
      {
        name: 'Арматура мірної довжини 6 міра',
        category: 'metal_profile',
        parentCategory: 'Металопрокат',
        subcategory: 'Чорний металопрокат',
        groupHeader: 'Арматура мірної довжини',
        unit: 'м.п.',
        basePrice: 14.05,
        sourceArticle: 'ARM-006',
        tonPrice: 58785,
      },
      {
        name: 'Арматура мірної довжини 8 міра',
        category: 'metal_profile',
        parentCategory: 'Металопрокат',
        subcategory: 'Чорний металопрокат',
        groupHeader: 'Арматура мірної довжини',
        unit: 'м.п.',
        basePrice: 22.98,
        sourceArticle: 'ARM-008',
        tonPrice: 51180,
      },
      {
        name: 'Арматура мірної довжини 10 міра',
        category: 'metal_profile',
        parentCategory: 'Металопрокат',
        subcategory: 'Чорний металопрокат',
        groupHeader: 'Арматура мірної довжини',
        unit: 'м.п.',
        basePrice: 33.10,
        sourceArticle: 'ARM-010',
        tonPrice: 49500,
      },
      {
        name: 'Арматура мірної довжини 12 міра',
        category: 'metal_profile',
        parentCategory: 'Металопрокат',
        subcategory: 'Чорний металопрокат',
        groupHeader: 'Арматура мірної довжини',
        unit: 'м.п.',
        basePrice: 47.02,
        sourceArticle: 'ARM-012',
        tonPrice: 48900,
      },
      {
        name: 'Труба профільна 40х40х2 мм ст.3',
        category: 'metal_profile',
        parentCategory: 'Металопрокат',
        subcategory: 'Чорний металопрокат',
        groupHeader: 'Труба профільна квадратна',
        unit: 'м.п.',
        basePrice: 95.80,
        sourceArticle: 'TR-40402',
        tonPrice: 35800,
      },
      {
        name: 'Труба профільна 50х50х3 мм ст.3',
        category: 'metal_profile',
        parentCategory: 'Металопрокат',
        subcategory: 'Чорний металопрокат',
        groupHeader: 'Труба профільна квадратна',
        unit: 'м.п.',
        basePrice: 168.00,
        sourceArticle: 'TR-50503',
        tonPrice: 35400,
      },
      {
        name: 'Лист г/к 2.0 мм ст.3',
        category: 'sheet_metal',
        parentCategory: 'Металопрокат',
        subcategory: 'Чорний металопрокат',
        groupHeader: 'Листовий прокат гарячекатаний',
        unit: 'м²',
        basePrice: 890.00,
        sourceArticle: 'LST-02',
        tonPrice: 38000,
      },
    ];
  }

  /**
   * Return demo items specifically structured from ТОВ «Метал Холдінг» PDF pricelist
   */
  public static getMetalHoldingDemoItems(): ParsedPriceItem[] {
    return [
      // 1. Арматура мірної довжини
      {
        name: 'Арматура мірної довжини 6 міра',
        category: 'metal_profile',
        parentCategory: 'Металопрокат',
        subcategory: 'Чорний металопрокат',
        groupHeader: 'Арматура мірної довжини',
        unit: 'м.п.',
        basePrice: 14.05,
        sourceArticle: 'ARM-006',
        tonPrice: 58785,
      },
      {
        name: 'Арматура мірної довжини 8 міра',
        category: 'metal_profile',
        parentCategory: 'Металопрокат',
        subcategory: 'Чорний металопрокат',
        groupHeader: 'Арматура мірної довжини',
        unit: 'м.п.',
        basePrice: 22.98,
        sourceArticle: 'ARM-008',
        tonPrice: 51180,
      },
      {
        name: 'Арматура мірної довжини 10 міра',
        category: 'metal_profile',
        parentCategory: 'Металопрокат',
        subcategory: 'Чорний металопрокат',
        groupHeader: 'Арматура мірної довжини',
        unit: 'м.п.',
        basePrice: 33.10,
        sourceArticle: 'ARM-010',
        tonPrice: 49500,
      },
      {
        name: 'Арматура мірної довжини 12 міра',
        category: 'metal_profile',
        parentCategory: 'Металопрокат',
        subcategory: 'Чорний металопрокат',
        groupHeader: 'Арматура мірної довжини',
        unit: 'м.п.',
        basePrice: 47.02,
        sourceArticle: 'ARM-012',
        tonPrice: 48900,
      },

      // 2. Труба профільна квадратна
      {
        name: 'Труба профільна 20х20х2 мм ст.3',
        category: 'metal_profile',
        parentCategory: 'Металопрокат',
        subcategory: 'Чорний металопрокат',
        groupHeader: 'Труба профільна квадратна',
        unit: 'м.п.',
        basePrice: 52.40,
        sourceArticle: 'TR-20202',
        tonPrice: 36200,
      },
      {
        name: 'Труба профільна 25х25х2 мм ст.3',
        category: 'metal_profile',
        parentCategory: 'Металопрокат',
        subcategory: 'Чорний металопрокат',
        groupHeader: 'Труба профільна квадратна',
        unit: 'м.п.',
        basePrice: 66.80,
        sourceArticle: 'TR-25252',
        tonPrice: 36000,
      },
      {
        name: 'Труба профільна 40х40х2 мм ст.3',
        category: 'metal_profile',
        parentCategory: 'Металопрокат',
        subcategory: 'Чорний металопрокат',
        groupHeader: 'Труба профільна квадратна',
        unit: 'м.п.',
        basePrice: 95.80,
        sourceArticle: 'TR-40402',
        tonPrice: 35800,
      },
      {
        name: 'Труба профільна 50х50х3 мм ст.3',
        category: 'metal_profile',
        parentCategory: 'Металопрокат',
        subcategory: 'Чорний металопрокат',
        groupHeader: 'Труба профільна квадратна',
        unit: 'м.п.',
        basePrice: 168.00,
        sourceArticle: 'TR-50503',
        tonPrice: 35400,
      },

      // 3. Труба профільна прямокутна
      {
        name: 'Труба профільна 40х20х2 мм ст.3',
        category: 'metal_profile',
        parentCategory: 'Металопрокат',
        subcategory: 'Чорний металопрокат',
        groupHeader: 'Труба профільна прямокутна',
        unit: 'м.п.',
        basePrice: 71.50,
        sourceArticle: 'TR-40202',
        tonPrice: 36000,
      },
      {
        name: 'Труба профільна 50х25х2 мм ст.3',
        category: 'metal_profile',
        parentCategory: 'Металопрокат',
        subcategory: 'Чорний металопрокат',
        groupHeader: 'Труба профільна прямокутна',
        unit: 'м.п.',
        basePrice: 91.20,
        sourceArticle: 'TR-50252',
        tonPrice: 35900,
      },
      {
        name: 'Труба профільна 60х40х2 мм ст.3',
        category: 'metal_profile',
        parentCategory: 'Металопрокат',
        subcategory: 'Чорний металопрокат',
        groupHeader: 'Труба профільна прямокутна',
        unit: 'м.п.',
        basePrice: 124.50,
        sourceArticle: 'TR-60402',
        tonPrice: 35800,
      },

      // 4. Кутник рівнополичний
      {
        name: 'Кутник сталевий 25х25х3 мм ст.3',
        category: 'metal_profile',
        parentCategory: 'Металопрокат',
        subcategory: 'Чорний металопрокат',
        groupHeader: 'Кутник рівнополичний',
        unit: 'м.п.',
        basePrice: 42.10,
        sourceArticle: 'KUT-25253',
        tonPrice: 34800,
      },
      {
        name: 'Кутник сталевий 32х32х3 мм ст.3',
        category: 'metal_profile',
        parentCategory: 'Металопрокат',
        subcategory: 'Чорний металопрокат',
        groupHeader: 'Кутник рівнополичний',
        unit: 'м.п.',
        basePrice: 58.20,
        sourceArticle: 'KUT-32323',
        tonPrice: 34500,
      },
      {
        name: 'Кутник сталевий 40х40х4 мм ст.3',
        category: 'metal_profile',
        parentCategory: 'Металопрокат',
        subcategory: 'Чорний металопрокат',
        groupHeader: 'Кутник рівнополичний',
        unit: 'м.п.',
        basePrice: 88.60,
        sourceArticle: 'KUT-40404',
        tonPrice: 34200,
      },
      {
        name: 'Кутник сталевий 50х50х4 мм ст.3',
        category: 'metal_profile',
        parentCategory: 'Металопрокат',
        subcategory: 'Чорний металопрокат',
        groupHeader: 'Кутник рівнополичний',
        unit: 'м.п.',
        basePrice: 112.40,
        sourceArticle: 'KUT-50504',
        tonPrice: 33900,
      },

      // 5. Листовий прокат
      {
        name: 'Лист г/к 2.0 мм ст.3 (розмір 1250х2500)',
        category: 'sheet_metal',
        parentCategory: 'Металопрокат',
        subcategory: 'Чорний металопрокат',
        groupHeader: 'Листовий прокат гарячекатаний',
        unit: 'м²',
        basePrice: 890.00,
        sourceArticle: 'LST-02',
        tonPrice: 38000,
      },
      {
        name: 'Лист г/к 3.0 мм ст.3 (розмір 1250х2500)',
        category: 'sheet_metal',
        parentCategory: 'Металопрокат',
        subcategory: 'Чорний металопрокат',
        groupHeader: 'Листовий прокат гарячекатаний',
        unit: 'м²',
        basePrice: 1340.00,
        sourceArticle: 'LST-03',
        tonPrice: 37500,
      },
      {
        name: 'Лист г/к 4.0 мм ст.3 (розмір 1250х2500)',
        category: 'sheet_metal',
        parentCategory: 'Металопрокат',
        subcategory: 'Чорний металопрокат',
        groupHeader: 'Листовий прокат гарячекатаний',
        unit: 'м²',
        basePrice: 1780.00,
        sourceArticle: 'LST-04',
        tonPrice: 37000,
      },

      // 6. Швелер сталевий
      {
        name: 'Швелер сталевий 8У ст.3',
        category: 'metal_profile',
        parentCategory: 'Металопрокат',
        subcategory: 'Чорний металопрокат',
        groupHeader: 'Швелер сталевий',
        unit: 'м.п.',
        basePrice: 245.00,
        sourceArticle: 'SHV-08',
        tonPrice: 37500,
      },
      {
        name: 'Швелер сталевий 10У ст.3',
        category: 'metal_profile',
        parentCategory: 'Металопрокат',
        subcategory: 'Чорний металопрокат',
        groupHeader: 'Швелер сталевий',
        unit: 'м.п.',
        basePrice: 318.50,
        sourceArticle: 'SHV-10',
        tonPrice: 37200,
      },
    ];
  }

  /**
   * Download the sample Metal Holding PDF file
   */
  public static downloadMetalHoldingSamplePdf(): void {
    const a = document.createElement('a');
    a.href = '/api/metal-price/sample-pdf';
    a.download = 'Price_Metal_Holding.pdf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
}
