import * as XLSX from 'xlsx';
import {
  MaterialItem,
  MaterialCategory,
  ParsedPriceItem,
  PriceParseResult,
} from '../types/calculator';

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
    let cuttingColIdx = -1;
    let articleColIdx = -1;

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

      let hasNameHeader = false;
      let hasPriceHeader = false;

      for (let c = 0; c < row.length; c++) {
        const val = String(row[c] || '').toLowerCase().trim();
        if (!val) continue;

        if (val.includes('назва') || val.includes('найменування') || val.includes('товар') || val.includes('номенклатура')) {
          nameColIdx = c;
          hasNameHeader = true;
        } else if (val === 'од.' || val === 'од' || val.includes('одиниця')) {
          unitColIdx = c;
        } else if (val.includes('за од') || val.includes('за т') || val.includes('ціна за т') || val.includes('ціна за од')) {
          priceTonColIdx = c;
          hasPriceHeader = true;
        } else if (val.includes('1 м') || val.includes('1м') || val.includes('м.п.') || val.includes('за лист') || val.includes('1 лист')) {
          // Strictly the meter / sheet price column
          priceMeterColIdx = c;
          hasPriceHeader = true;
        } else if (val.includes('різка') || val.includes('порізка')) {
          cuttingColIdx = c;
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

      // Skip table headers and document banners
      if (
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

      // Collect all numeric values in row with their cell index
      const numCells: { idx: number; val: number; raw: string }[] = [];
      for (let c = 0; c < row.length; c++) {
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
        if (/^(т|т\.|од|од\.|м|м\.п\.|м²|шт|кг)$/i.test(cell)) {
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
        itemName = String(row[nameColIdx]).trim();
      }

      // Clean up name: remove unit if caught
      itemName = itemName.replace(/\s+(т|т\.|од|од\.|м|м\.п\.)$/i, '').trim();

      // Rule: Do NOT take unit as name!
      if (!itemName || /^(т|т\.|од|од\.|м|м\.п\.|шт|кг)$/i.test(itemName)) {
        continue;
      }

      // Rule: Do NOT truncate to "6 міра", "8 міра"!
      // If itemName is just "6 міра" / "8 міра" and current group is "Арматура мірної довжини"
      if (/^[0-9]+(\.[0-9]+)?\s*міра$/i.test(itemName) && currentGroupHeader.toLowerCase().includes('арматура')) {
        itemName = `Арматура ${itemName}`;
      } else if (/^[0-9]+(\.[0-9]+)?\s*міра$/i.test(itemName)) {
        itemName = `Арматура ${itemName}`;
      }

      // 3. Extract Price:
      // ❌ НЕ брати першу колонку ціни (за од., де вказано 58 785 грн / 51 180 грн).
      // ✅ Брати СТРOГО другу колонку ціни (за 1 м/ лист, де вказано 14.05 грн, 22.98 грн, 33.10 грн, 47.02 грн).
      let baseMeterPrice: number | null = null;
      let tonPrice: number | undefined = undefined;
      let cuttingPrice: number | undefined = undefined;

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
        if (pc.val === 6 || pc.val === 12) {
          if (priceCandidates.length >= 3 && priceCandidates.indexOf(pc) === 1) {
            continue; // Skip length column
          }
        }
        nonLengthPrices.push(pc.val);
      }

      if (nonLengthPrices.length >= 2) {
        // First price is Ton Price (e.g. 58 785 грн / 51 180 грн) -> ❌ DO NOT USE AS BASE PRICE
        tonPrice = nonLengthPrices[0];
        // Second price is Meter / Sheet Price (e.g. 14.05 грн, 22.98 грн) -> ✅ STRICTLY USE AS BASE PRICE
        if (baseMeterPrice === null) {
          baseMeterPrice = nonLengthPrices[1];
        }
        if (nonLengthPrices.length >= 3) {
          cuttingPrice = nonLengthPrices[2];
        }
      } else if (nonLengthPrices.length === 1 && baseMeterPrice === null) {
        const singleVal = nonLengthPrices[0];
        if (singleVal > 10000) {
          tonPrice = singleVal;
        } else {
          baseMeterPrice = singleVal;
        }
      }

      if (baseMeterPrice === null || baseMeterPrice <= 0) {
        continue;
      }

      // 4. Determine category and unit
      const { category, unit } = this.determineCategoryAndUnit(itemName);

      // 5. Match with existing
      const normName = this.normalizeName(itemName);
      const existingMatch = existingMaterials.find(
        (em) => this.normalizeName(em.name) === normName
      );

      recognizedItems.push({
        name: itemName,
        category,
        parentCategory: 'Металопрокат',
        subcategory: currentSubcategory,
        groupHeader: currentGroupHeader,
        unit,
        basePrice: Math.round(baseMeterPrice * 100) / 100,
        cuttingPrice: cuttingPrice ? Math.round(cuttingPrice * 100) / 100 : undefined,
        sourceArticle: article,
        tonPrice: tonPrice ? Math.round(tonPrice * 100) / 100 : undefined,
        isExisting: !!existingMatch,
        existingId: existingMatch?.id,
        oldPrice: existingMatch?.basePrice,
      });
    }

    const newItemsCount = recognizedItems.filter((i) => !i.isExisting).length;
    const updatedItemsCount = recognizedItems.filter((i) => i.isExisting).length;

    return {
      fileName,
      supplier,
      mainCategory,
      totalRowsRead: rows.length,
      recognizedItems,
      groupHeadersFound,
      newItemsCount,
      updatedItemsCount,
      errors,
    };
  }

  /**
   * Apply imported price items into existing materials database (with update / add logic)
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

    const materialsMap = new Map<string, MaterialItem>();
    // Index existing by normalized name
    existingMaterials.forEach((m) => {
      materialsMap.set(this.normalizeName(m.name), { ...m });
    });

    const nowIso = new Date().toISOString();

    for (const item of parsedItems) {
      const normKey = this.normalizeName(item.name);
      const existing = materialsMap.get(normKey);

      let normSubcategory = item.subcategory || existing?.subcategory || 'Чорний метал';
      if (normSubcategory.toLowerCase().includes('чорн') || normSubcategory.toLowerCase().includes('метал')) {
        if (!normSubcategory.toLowerCase().includes('нержав') && !normSubcategory.toLowerCase().includes('алюмін')) {
          normSubcategory = 'Чорний метал';
        }
      }

      if (existing) {
        // Update existing item without duplicating
        const updatedItem: MaterialItem = {
          ...existing,
          basePrice: item.basePrice,
          cuttingPrice: item.cuttingPrice !== undefined ? item.cuttingPrice : existing.cuttingPrice,
          unit: item.unit,
          parentCategory: item.parentCategory || 'Металопрокат',
          subcategory: normSubcategory,
          groupHeader: item.groupHeader || existing.groupHeader,
          supplier: supplierName || existing.supplier,
          sourceArticle: item.sourceArticle || existing.sourceArticle,
          tonPrice: item.tonPrice || existing.tonPrice,
          updatedAt: nowIso,
        };
        materialsMap.set(normKey, updatedItem);
        updatedCount++;
      } else {
        // Add new item into the catalog
        const defaultWaste = item.category === 'sheet_metal' ? 1.15 : 1.10;
        const newItem: MaterialItem = {
          id: `mat_metal_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          name: item.name,
          category: item.category,
          parentCategory: item.parentCategory || 'Металопрокат',
          subcategory: normSubcategory,
          groupHeader: item.groupHeader || 'Загальний металопрокат',
          unit: item.unit,
          basePrice: item.basePrice,
          cuttingPrice: item.cuttingPrice,
          defaultWasteFactor: defaultWaste,
          supplier: supplierName,
          sourceArticle: item.sourceArticle,
          tonPrice: item.tonPrice,
          notes: item.cuttingPrice ? `Різка: ${item.cuttingPrice.toFixed(2)} грн` : undefined,
          updatedAt: nowIso,
        };
        materialsMap.set(normKey, newItem);
        addedCount++;
      }
    }

    return {
      updatedMaterials: Array.from(materialsMap.values()),
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
      ['Прайс-лист металопрокату з роздрібними цінами та послугами різки'],
      [],
      [
        'Артикул',
        'Назва товару',
        'Од.',
        'Ціна за од. (тонну)',
        'Довжина в м',
        'Ціна роздрібна з ПДВ / за 1 м/ лист',
        'Різка (вартість різу грн)',
      ],
      // Group 1: Арматура мірної довжини
      ['', 'Арматура мірної довжини', '', '', '', '', ''],
      ['ARM-006', 'Арматура 6 міра', 'Т', 32500, 6, 14.05, 10.80],
      ['ARM-008', 'Арматура 8 міра', 'Т', 32500, 6, 22.98, 12.00],
      ['ARM-010', 'Арматура 10 міра', 'Т', 32000, 6, 33.10, 13.20],
      ['ARM-012', 'Арматура 12 міра', 'Т', 31800, 6, 47.02, 14.40],
      [],
      // Group 2: Труба профільна квадратна
      ['', 'Труба профільна квадратна', '', '', '', '', ''],
      ['TR-20202', 'Труба профільна 20х20х2 мм ст.3', 'Т', 36200, 6, 52.40, 8.50],
      ['TR-40402', 'Труба профільна 40х40х2 мм ст.3', 'Т', 35800, 6, 95.80, 11.20],
      ['TR-50503', 'Труба профільна 50х50х3 мм ст.3', 'Т', 35400, 6, 168.00, 16.00],
      ['TR-60402', 'Труба профільна 60х40х2 мм ст.3', 'Т', 35800, 6, 124.50, 13.50],
      [],
      // Group 3: Кутник рівнополичний
      ['', 'Кутник рівнополичний', '', '', '', '', ''],
      ['KUT-32323', 'Кутник сталевий 32х32х3 мм ст.3', 'Т', 34500, 6, 58.20, 9.00],
      ['KUT-40404', 'Кутник сталевий 40х40х4 мм ст.3', 'Т', 34200, 6, 88.60, 11.50],
      [],
      // Group 4: Листовий прокат г/к
      ['', 'Листовий прокат гарячекатаний', '', '', '', '', ''],
      ['LST-02', 'Лист г/к 2.0 мм ст.3 (розмір 1250х2500)', 'Т', 38000, 1, 890.00, 25.00],
      ['LST-03', 'Лист г/к 3.0 мм ст.3 (розмір 1250х2500)', 'Т', 37500, 1, 1340.00, 35.00],
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
      { wch: 26 }, // Різка (вартість різу грн)
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
        name: 'Арматура 6 міра',
        category: 'metal_profile',
        parentCategory: 'Металопрокат',
        subcategory: 'Чорний металопрокат',
        groupHeader: 'Арматура мірної довжини',
        unit: 'м.п.',
        basePrice: 14.05,
        cuttingPrice: 10.80,
        sourceArticle: 'ARM-006',
        tonPrice: 32500,
      },
      {
        name: 'Арматура 8 міра',
        category: 'metal_profile',
        parentCategory: 'Металопрокат',
        subcategory: 'Чорний металопрокат',
        groupHeader: 'Арматура мірної довжини',
        unit: 'м.п.',
        basePrice: 22.98,
        cuttingPrice: 12.00,
        sourceArticle: 'ARM-008',
        tonPrice: 32500,
      },
      {
        name: 'Арматура 10 міра',
        category: 'metal_profile',
        parentCategory: 'Металопрокат',
        subcategory: 'Чорний металопрокат',
        groupHeader: 'Арматура мірної довжини',
        unit: 'м.п.',
        basePrice: 33.10,
        cuttingPrice: 13.20,
        sourceArticle: 'ARM-010',
        tonPrice: 32000,
      },
      {
        name: 'Арматура 12 міра',
        category: 'metal_profile',
        parentCategory: 'Металопрокат',
        subcategory: 'Чорний металопрокат',
        groupHeader: 'Арматура мірної довжини',
        unit: 'м.п.',
        basePrice: 47.02,
        cuttingPrice: 14.40,
        sourceArticle: 'ARM-012',
        tonPrice: 31800,
      },
      {
        name: 'Труба профільна 40х40х2 мм ст.3',
        category: 'metal_profile',
        parentCategory: 'Металопрокат',
        subcategory: 'Чорний металопрокат',
        groupHeader: 'Труба профільна квадратна',
        unit: 'м.п.',
        basePrice: 95.80,
        cuttingPrice: 11.20,
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
        cuttingPrice: 16.00,
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
        cuttingPrice: 25.00,
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
        name: 'Арматура 6 міра',
        category: 'metal_profile',
        parentCategory: 'Металопрокат',
        subcategory: 'Чорний металопрокат',
        groupHeader: 'Арматура мірної довжини',
        unit: 'м.п.',
        basePrice: 14.05,
        cuttingPrice: 10.80,
        sourceArticle: 'ARM-006',
        tonPrice: 32500,
      },
      {
        name: 'Арматура 8 міра',
        category: 'metal_profile',
        parentCategory: 'Металопрокат',
        subcategory: 'Чорний металопрокат',
        groupHeader: 'Арматура мірної довжини',
        unit: 'м.п.',
        basePrice: 22.98,
        cuttingPrice: 12.00,
        sourceArticle: 'ARM-008',
        tonPrice: 32500,
      },
      {
        name: 'Арматура 10 міра',
        category: 'metal_profile',
        parentCategory: 'Металопрокат',
        subcategory: 'Чорний металопрокат',
        groupHeader: 'Арматура мірної довжини',
        unit: 'м.п.',
        basePrice: 33.10,
        cuttingPrice: 13.20,
        sourceArticle: 'ARM-010',
        tonPrice: 32000,
      },
      {
        name: 'Арматура 12 міра',
        category: 'metal_profile',
        parentCategory: 'Металопрокат',
        subcategory: 'Чорний металопрокат',
        groupHeader: 'Арматура мірної довжини',
        unit: 'м.п.',
        basePrice: 47.02,
        cuttingPrice: 14.40,
        sourceArticle: 'ARM-012',
        tonPrice: 31800,
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
        cuttingPrice: 8.50,
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
        cuttingPrice: 9.50,
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
        cuttingPrice: 11.20,
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
        cuttingPrice: 16.00,
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
        cuttingPrice: 9.00,
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
        cuttingPrice: 10.50,
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
        cuttingPrice: 13.50,
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
        cuttingPrice: 8.00,
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
        cuttingPrice: 9.00,
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
        cuttingPrice: 11.50,
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
        cuttingPrice: 13.00,
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
        cuttingPrice: 25.00,
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
        cuttingPrice: 35.00,
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
        cuttingPrice: 45.00,
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
        cuttingPrice: 18.00,
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
        cuttingPrice: 22.00,
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
