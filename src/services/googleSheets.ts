import { OCRResult, SheetCompanyLists, ExistingSheetRow, ExistingPaymentRow, InvoicePaymentStatus, InvoiceApprovalStatus, ProjectSheetRow, ProjectColumnHeader, OverheadExpenseRow } from '../types';
import { OCRService } from './ocrService';
import { googleAuth } from './googleAuth';
import { formatMonthYearUk } from '../utils/dateUtils';

export class GoogleSheetsService {
  /**
   * Protected sheet tabs that must NEVER be overwritten, modified, or cleared.
   */
  private static readonly FORBIDDEN_TABS = ['лист1', 'sheet1', 'аркуш1', 'лист 1', 'sheet 1', 'аркуш 1'];

  public static readonly OVERHEAD_HEADERS = [
    'Постачальник',
    'Платник',
    'Номер рахунку',
    'Дата рахунку',
    'Сума',
    'Валюта',
    'Статус',
    'Час завантаження',
    'Сума оплати',
  ];

  public static readonly INVOICE_HEADERS = [
    'Номер замовлення',
    'Постачальник',
    'Платник',
    'Номер рахунку',
    'Дата рахунку',
    'Сума',
    'Валюта',
    'Статус',
    'Час завантаження',
    'Сума оплати',
    'Погодження',
  ];

  public static readonly PAYMENT_HEADERS = [
    'Номер платіжки',
    'Дата платіжки',
    'Платник (Наша компанія)',
    'Одержувач (Постачальник)',
    'Сума оплати',
    'Валюта',
    'Призначення платежу',
    'Номер рахунку (з призначення)',
    'Номер замовлення',
    'Назва файлу',
    'Посилання Drive',
    'Дата внесення',
  ];

  public static isProtectedTab(tabName: string): boolean {
    if (!tabName) return false;
    const clean = tabName.trim().toLowerCase();
    return this.FORBIDDEN_TABS.includes(clean);
  }

  private static async request<T>(
    endpoint: string,
    accessToken: string,
    options: RequestInit = {}
  ): Promise<T> {
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });

    if (!res.ok) {
      const errorBody = await res.text();
      let errorMsg = `Google Sheets API error: ${res.status} ${res.statusText}`;
      try {
        const json = JSON.parse(errorBody);
        if (json.error?.message) {
          errorMsg = json.error.message;
        }
      } catch {
        // use raw errorBody if JSON parse fails
      }

      if (res.status === 401 || errorMsg.includes('invalid authentication credentials') || errorMsg.includes('OAuth 2')) {
        googleAuth.markTokenExpired();
        throw new Error('Сесія Google закінчилася (термін дії токена 1 год). Поновіть сесію в один клік.');
      }

      throw new Error(errorMsg);
    }

    if (res.status === 204 || res.headers.get('content-length') === '0') {
      return {} as T;
    }
    const text = await res.text();
    if (!text || !text.trim()) {
      return {} as T;
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      return {} as T;
    }
  }

  /**
   * Extract Spreadsheet ID from URL or raw ID
   */
  public static extractSpreadsheetId(input: string): string {
    const trimmed = input.trim();
    // E.g. https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0
    const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      return match[1];
    }
    return trimmed;
  }

  /**
   * Get Spreadsheet metadata & sheet tab names
   */
  public static async getSpreadsheetDetails(
    spreadsheetId: string,
    accessToken: string
  ): Promise<{
    title: string;
    sheets: string[];
    id: string;
    sheetMeta?: Array<{ sheetId: number; title: string }>;
  }> {
    const cleanId = this.extractSpreadsheetId(spreadsheetId);
    const data = await this.request<any>(`${cleanId}?includeGridData=false`, accessToken);
    const sheets = (data.sheets || []).map((s: any) => s.properties?.title || '');
    const sheetMeta = (data.sheets || []).map((s: any) => ({
      sheetId: Number(s.properties?.sheetId ?? 0),
      title: s.properties?.title || '',
    }));
    return {
      id: cleanId,
      title: data.properties?.title || 'Google Таблиця',
      sheets,
      sheetMeta,
    };
  }

  /**
   * Find numeric sheetId (gid) by sheet tab name
   */
  public static async getSheetIdByName(
    spreadsheetId: string,
    accessToken: string,
    tabName: string
  ): Promise<number | null> {
    const cleanId = this.extractSpreadsheetId(spreadsheetId);
    const details = await this.getSpreadsheetDetails(cleanId, accessToken);
    const resolvedName = this.resolveMatchingSheetTab(details.sheets, tabName);
    const meta = details.sheetMeta?.find(
      (m) => m.title === resolvedName || m.title === tabName
    );
    return meta !== undefined && meta.sheetId !== undefined ? meta.sheetId : null;
  }

  /**
   * Delete specified rows (1-based row indices, e.g. [25, 27]) from a Google Sheet tab.
   * Requests are sorted in descending order to avoid row index shift side effects.
   */
  public static async deleteRowsFromSheet(
    spreadsheetId: string,
    accessToken: string,
    tabName: string,
    rowIndices: number[]
  ): Promise<{ deletedCount: number }> {
    if (!rowIndices || rowIndices.length === 0) return { deletedCount: 0 };
    const cleanId = this.extractSpreadsheetId(spreadsheetId);
    const sheetId = await this.getSheetIdByName(cleanId, accessToken, tabName);
    if (sheetId === null) {
      throw new Error(`Не вдалося знайти вкладку "${tabName}" у Google Таблиці.`);
    }

    // Filter out row 1 (never delete table header row) and non-positive numbers
    const validRows = Array.from(new Set(rowIndices)).filter((r) => r > 1);
    if (validRows.length === 0) return { deletedCount: 0 };

    // Sort descending: e.g. [30, 25, 21]
    validRows.sort((a, b) => b - a);

    const requests = validRows.map((rowNum) => ({
      deleteDimension: {
        range: {
          sheetId,
          dimension: 'ROWS',
          startIndex: rowNum - 1,
          endIndex: rowNum,
        },
      },
    }));

    await this.request<any>(`${cleanId}:batchUpdate`, accessToken, {
      method: 'POST',
      body: JSON.stringify({ requests }),
    });

    return { deletedCount: validRows.length };
  }

  /**
   * Normalize sheet tab names for tolerant comparison:
   * Strips whitespace, lowercases, and replaces visually identical Cyrillic/Latin characters.
   */
  public static normalizeSheetNameForComparison(name: string): string {
    if (!name) return '';
    return name
      .trim()
      .toLowerCase()
      .replace(/\u0069/g, '\u0456') // Latin 'i' -> Cyrillic 'і'
      .replace(/\u0049/g, '\u0456') // Latin 'I' -> Cyrillic 'і'
      .replace(/\u0406/g, '\u0456') // Cyrillic capital 'І' -> 'і'
      .replace(/\u0061/g, '\u0430') // Latin 'a' -> Cyrillic 'а'
      .replace(/\u0065/g, '\u0435') // Latin 'e' -> Cyrillic 'е'
      .replace(/\u006F/g, '\u043E') // Latin 'o' -> Cyrillic 'о'
      .replace(/\u0070/g, '\u0440') // Latin 'p' -> Cyrillic 'р'
      .replace(/\u0063/g, '\u0441') // Latin 'c' -> Cyrillic 'с'
      .replace(/\u0078/g, '\u0445') // Latin 'x' -> Cyrillic 'х'
      .replace(/[\s_\-\/\\()]+/g, '');
  }

  /**
   * Resolve best matching sheet tab name from available sheets in the spreadsheet.
   */
  public static resolveMatchingSheetTab(
    availableSheets: string[],
    preferredTab: string,
    synonyms: string[] = []
  ): string {
    if (!availableSheets || availableSheets.length === 0) return preferredTab;

    // 1. Direct exact match
    if (availableSheets.includes(preferredTab)) return preferredTab;

    const normPreferred = this.normalizeSheetNameForComparison(preferredTab);

    // 2. Normalized match with preferredTab (handles trailing spaces, Latin i, etc.)
    for (const sheet of availableSheets) {
      if (this.normalizeSheetNameForComparison(sheet) === normPreferred) {
        return sheet;
      }
    }

    // 3. Synonym matching
    for (const syn of synonyms) {
      const normSyn = this.normalizeSheetNameForComparison(syn);
      for (const sheet of availableSheets) {
        const normSheet = this.normalizeSheetNameForComparison(sheet);
        if (normSheet === normSyn || normSheet.includes(normSyn) || normSyn.includes(normSheet)) {
          return sheet;
        }
      }
    }

    // 4. Substring match
    for (const sheet of availableSheets) {
      const normSheet = this.normalizeSheetNameForComparison(sheet);
      if (normSheet.includes(normPreferred) || normPreferred.includes(normSheet)) {
        return sheet;
      }
    }

    return preferredTab;
  }

  /**
   * Ensure a specific tab exists in the spreadsheet.
   * If missing, creates the tab and writes standard headers.
   * NEVER touches or modifies protected tabs (Лист1).
   */
  public static async ensureTabExists(
    spreadsheetId: string,
    accessToken: string,
    tabName: string,
    defaultHeaders?: string[]
  ): Promise<void> {
    if (!tabName || this.isProtectedTab(tabName)) return;
    const cleanId = this.extractSpreadsheetId(spreadsheetId);

    try {
      const details = await this.getSpreadsheetDetails(cleanId, accessToken);
      const existing = new Set(details.sheets);

      if (!existing.has(tabName)) {
        // 1. Create the tab
        await this.request<any>(`${cleanId}:batchUpdate`, accessToken, {
          method: 'POST',
          body: JSON.stringify({
            requests: [
              {
                addSheet: {
                  properties: { title: tabName },
                },
              },
            ],
          }),
        });

        // 2. Set headers if provided
        if (defaultHeaders && defaultHeaders.length > 0) {
          const lastColLetter = String.fromCharCode(64 + defaultHeaders.length);
          await this.request<any>(
            `${cleanId}/values/'${encodeURIComponent(tabName)}'!A1:${lastColLetter}1?valueInputOption=USER_ENTERED`,
            accessToken,
            {
              method: 'PUT',
              body: JSON.stringify({
                values: [defaultHeaders],
              }),
            }
          );
        }
      } else if (defaultHeaders && defaultHeaders.length > 0) {
        // Tab exists, verify if headers are present
        try {
          const headerCheck = await this.request<any>(
            `${cleanId}/values/'${encodeURIComponent(tabName)}'!A1:A1`,
            accessToken
          );
          if (!headerCheck.values || headerCheck.values.length === 0 || !headerCheck.values[0] || !headerCheck.values[0][0]) {
            const lastColLetter = String.fromCharCode(64 + defaultHeaders.length);
            await this.request<any>(
              `${cleanId}/values/'${encodeURIComponent(tabName)}'!A1:${lastColLetter}1?valueInputOption=USER_ENTERED`,
              accessToken,
              {
                method: 'PUT',
                body: JSON.stringify({
                  values: [defaultHeaders],
                }),
              }
            );
          }
        } catch {
          // ignore
        }
      }
    } catch (err) {
      console.warn(`Error ensuring tab "${tabName}" exists:`, err);
    }
  }

  /**
   * Find the exact first available empty row index (1-based) in "Рахунки".
   * Scans rows sequentially from row 2 downwards.
   * Reads all existing genuine invoices from the sheet (ignoring template defaults)
   * and returns the very first vacant row index.
   * This guarantees new files are inserted at row 26 (right after real data), NOT skipped to row 498.
   */
  public static async findFirstAvailableInvoiceRow(
    cleanId: string,
    accessToken: string,
    tabName: string
  ): Promise<number> {
    try {
      const existingInvoices = await this.loadExistingInvoices(cleanId, accessToken, tabName);
      const occupiedRowIndices = new Set(existingInvoices.map((inv) => inv.rowIndex));

      // Header is at row 1, data starts at row 2
      let targetRow = 2;
      while (occupiedRowIndices.has(targetRow)) {
        targetRow++;
      }
      return targetRow;
    } catch (e) {
      console.warn('Error determining first empty invoice row, defaulting to row 2:', e);
      return 2;
    }
  }

  /**
   * Find the exact first available empty row index (1-based) in "Платіжки".
   * Scans rows sequentially from row 2 downwards.
   * Reads all existing genuine payments from the sheet and returns the very first vacant row index.
   */
  public static async findFirstAvailablePaymentRow(
    cleanId: string,
    accessToken: string,
    tabName: string
  ): Promise<number> {
    try {
      const { payments } = await this.loadExistingPayments(cleanId, accessToken, tabName);
      const occupiedRowIndices = new Set(payments.map((p) => p.rowIndex));

      let targetRow = 2;
      while (occupiedRowIndices.has(targetRow)) {
        targetRow++;
      }
      return targetRow;
    } catch (e) {
      console.warn('Error determining first empty payment row, defaulting to row 2:', e);
      return 2;
    }
  }

  /**
   * Find the exact first available empty row index (1-based) in "Цех" (Overhead tab).
   * Scans rows sequentially from row 2 downwards.
   */
  public static async findFirstAvailableOverheadRow(
    cleanId: string,
    accessToken: string,
    tabName: string
  ): Promise<number> {
    try {
      const expenses = await this.loadExistingOverheadExpenses(cleanId, accessToken, tabName);
      const occupiedRowIndices = new Set(expenses.map((e) => e.rowIndex).filter(Boolean) as number[]);

      let targetRow = 2;
      while (occupiedRowIndices.has(targetRow)) {
        targetRow++;
      }
      return targetRow;
    } catch (e) {
      console.warn('Error determining first empty overhead row, defaulting to row 2:', e);
      return 2;
    }
  }

  /**
   * Find the exact next available row index (1-based) in a sheet tab.
   * Scans rows from top to bottom to guarantee appending strictly into the first empty gap.
   */
  public static async getNextEmptyRowIndex(
    cleanId: string,
    accessToken: string,
    tabName: string
  ): Promise<number> {
    const lower = tabName.toLowerCase();
    if (lower.includes('цех') || lower.includes('overhead')) {
      return this.findFirstAvailableOverheadRow(cleanId, accessToken, tabName);
    }
    const isPayments = lower.includes('платіж') || lower.includes('payment');
    if (isPayments) {
      return this.findFirstAvailablePaymentRow(cleanId, accessToken, tabName);
    }
    return this.findFirstAvailableInvoiceRow(cleanId, accessToken, tabName);
  }

  /**
   * Finds and deletes all empty/blank rows in a sheet tab (e.g. rows 26 to 497).
   * Shifts any real data below them (like row 498) cleanly up to the top!
   */
  public static async compactEmptyRowsInTab(
    spreadsheetId: string,
    accessToken: string,
    tabName: string
  ): Promise<{ removedCount: number }> {
    const cleanId = this.extractSpreadsheetId(spreadsheetId);
    if (this.isProtectedTab(tabName)) return { removedCount: 0 };

    const sheetId = await this.getSheetIdByName(cleanId, accessToken, tabName);
    if (sheetId === null) {
      throw new Error(`Вкладку "${tabName}" не знайдено.`);
    }

    const safeTab = tabName.replace(/'/g, "''");
    const range = encodeURIComponent(`'${safeTab}'!A1:Z2500`);
    const res = await this.request<any>(
      `${cleanId}/values/${range}`,
      accessToken
    );
    const rows: any[][] = res.values || [];
    if (rows.length <= 2) return { removedCount: 0 };

    // Detect header row index
    let headerIdx = 0;
    for (let i = 0; i < Math.min(rows.length, 5); i++) {
      const joined = (rows[i] || []).map((c) => String(c || '').toLowerCase()).join(' ');
      if (
        joined.includes('замовлен') ||
        joined.includes('постачальн') ||
        joined.includes('платник') ||
        joined.includes('рахун') ||
        joined.includes('сума') ||
        joined.includes('призначення')
      ) {
        headerIdx = i;
        break;
      }
    }

    // Find the last row with genuine data
    let lastRealDataIdx = -1;
    for (let r = rows.length - 1; r > headerIdx; r--) {
      const row = rows[r] || [];
      const hasRealContent = row.some((cell, colIdx) => {
        if (colIdx > 12) return false;
        if (cell === undefined || cell === null) return false;
        const s = String(cell).trim();
        return (
          s !== '' &&
          s !== '—' &&
          s !== '-' &&
          s !== '0' &&
          s !== '0.00' &&
          s !== '0,00' &&
          s !== 'Не оплачено' &&
          s !== 'UAH'
        );
      });
      if (hasRealContent) {
        lastRealDataIdx = r;
        break;
      }
    }

    if (lastRealDataIdx <= headerIdx) {
      return { removedCount: 0 };
    }

    // Identify all empty row indices strictly between header and lastRealDataIdx
    const emptyRowIndices: number[] = [];
    for (let r = headerIdx + 1; r < lastRealDataIdx; r++) {
      const row = rows[r] || [];
      const hasRealContent = row.some((cell, colIdx) => {
        if (colIdx > 12) return false;
        if (cell === undefined || cell === null) return false;
        const s = String(cell).trim();
        return (
          s !== '' &&
          s !== '—' &&
          s !== '-' &&
          s !== '0' &&
          s !== '0.00' &&
          s !== '0,00' &&
          s !== 'Не оплачено' &&
          s !== 'UAH'
        );
      });
      if (!hasRealContent) {
        emptyRowIndices.push(r);
      }
    }

    if (emptyRowIndices.length === 0) {
      return { removedCount: 0 };
    }

    // Group contiguous empty rows into ranges: e.g. [25..496] -> { startIndex: 25, endIndex: 497 }
    const ranges: Array<{ startIndex: number; endIndex: number }> = [];
    let start = emptyRowIndices[0];
    let prev = emptyRowIndices[0];

    for (let i = 1; i < emptyRowIndices.length; i++) {
      const curr = emptyRowIndices[i];
      if (curr === prev + 1) {
        prev = curr;
      } else {
        ranges.push({ startIndex: start, endIndex: prev + 1 });
        start = curr;
        prev = curr;
      }
    }
    ranges.push({ startIndex: start, endIndex: prev + 1 });

    // Sort ranges descending so deleting does not shift indices of preceding ranges
    ranges.sort((a, b) => b.startIndex - a.startIndex);

    const requests = ranges.map((rg) => ({
      deleteDimension: {
        range: {
          sheetId,
          dimension: 'ROWS',
          startIndex: rg.startIndex,
          endIndex: rg.endIndex,
        },
      },
    }));

    await this.request<any>(`${cleanId}:batchUpdate`, accessToken, {
      method: 'POST',
      body: JSON.stringify({ requests }),
    });

    return { removedCount: emptyRowIndices.length };
  }

  /**
   * Helper to parse and extract a clean company name from spreadsheet Columns A and B.
   * Handles:
   * - Col A: Legal form (ТОВ), Col B: Name (ЛЕГНОПРОМ) -> "ТОВ ЛЕГНОПРОМ"
   * - Col A: Full Name (ТОВ ЛЕГНОПРОМ), Col B: EDRPOU / Notes -> "ТОВ ЛЕГНОПРОМ"
   * - Col A: "ТОВ ЛЕГНОПРОМ", Col B: "ЛЕГНОПРОМ" -> "ТОВ ЛЕГНОПРОМ" (no double names)
   * - Removes numeric codes, phone numbers, and EDRPOU from company name
   */
  public static extractCleanCompanyName(colA: unknown, colB: unknown): string {
    const rawA = colA !== undefined && colA !== null ? String(colA).trim() : '';
    const rawB = colB !== undefined && colB !== null ? String(colB).trim() : '';

    const isCodeOrNote = (str: string): boolean => {
      if (!str) return false;
      const lower = str.toLowerCase();
      if (lower.includes('єдрпоу') || lower.includes('edrpou') || lower.includes('код') || lower.includes('телефон') || lower.includes('тел')) {
        return true;
      }
      // Pure numbers, dashes, phone numbers (e.g. "39812456" or "067-123-45-67")
      if (/^[\d\s\-+().,]{6,}$/.test(str)) {
        return true;
      }
      return false;
    };

    const cleanA = isCodeOrNote(rawA) ? '' : rawA;
    const cleanB = isCodeOrNote(rawB) ? '' : rawB;

    if (!cleanA && !cleanB) return '';
    if (!cleanA) return OCRService.normalizeCompanyName(cleanB);
    if (!cleanB) return OCRService.normalizeCompanyName(cleanA);

    const normA = OCRService.normalizeCompanyName(cleanA);
    const normB = OCRService.normalizeCompanyName(cleanB);

    // If both are identical or one contains the other
    if (normA === normB) return normA;
    if (normA.includes(normB)) return normA;
    if (normB.includes(normA)) return normB;

    // Check if one is just the legal form prefix
    const isOnlyLegalForm = (str: string) => /^(ТОВ|ФОП|ПП|ТДВ|ПРАТ|ПАТ|АТ|ДП)$/i.test(str.trim());
    if (isOnlyLegalForm(cleanA)) {
      return OCRService.normalizeCompanyName(`${cleanA} ${cleanB}`);
    }
    if (isOnlyLegalForm(cleanB)) {
      return OCRService.normalizeCompanyName(`${cleanB} ${cleanA}`);
    }

    return OCRService.normalizeCompanyName(`${cleanA} ${cleanB}`);
  }

  /**
   * Checks if a string is likely a table header row rather than a company name.
   */
  public static isHeaderOrInvalidCompanyName(val: string): boolean {
    if (!val || val.length < 2) return true;
    const lower = val.toLowerCase().trim();
    if (
      lower.includes('назва постачальник') ||
      lower.includes('назва компані') ||
      lower.includes('наші компані') ||
      lower.includes('форма власност') ||
      lower.includes('контрагент') ||
      lower === 'постачальник' ||
      lower === 'постачальники' ||
      lower === 'назва' ||
      lower === 'форма' ||
      lower === 'єдрпоу' ||
      lower === 'примітка' ||
      lower === 'контакт' ||
      lower === 'тов' ||
      lower === 'фоп' ||
      lower === 'пп'
    ) {
      return true;
    }
    return false;
  }

  /**
   * Strictly deduplicates a list of company names preserving order.
   * Compares normalized uppercase strings.
   */
  public static deduplicateCompanyList(list: string[]): string[] {
    const result: string[] = [];
    const seen = new Set<string>();

    for (const item of list) {
      const norm = OCRService.normalizeCompanyName(item);
      if (!norm || this.isHeaderOrInvalidCompanyName(norm)) continue;
      const key = norm.toUpperCase().replace(/\s+/g, ' ').trim();
      if (!seen.has(key)) {
        seen.add(key);
        result.push(norm);
      }
    }

    return result;
  }

  /**
   * Read Our Companies & Suppliers from their respective tabs
   * Automatically combines Column A & B, filters headers, and strictly deduplicates.
   */
  public static async loadCompanyLists(
    spreadsheetId: string,
    accessToken: string,
    ourCompaniesTab = 'Наші компанії',
    suppliersTab = 'Постачальники'
  ): Promise<SheetCompanyLists> {
    const cleanId = this.extractSpreadsheetId(spreadsheetId);
    const result: SheetCompanyLists = {
      ourCompanies: [],
      suppliers: [],
    };

    // 1. Load Our Companies
    try {
      const safeOur = ourCompaniesTab.replace(/'/g, "''");
      const ourData = await this.request<any>(
        `${cleanId}/values/${encodeURIComponent(`'${safeOur}'!A1:B500`)}`,
        accessToken
      );
      const rows = ourData.values || [];
      const parsedOur = rows
        .map((row: any[]) => this.extractCleanCompanyName(row[0], row[1]))
        .filter((val: string) => !this.isHeaderOrInvalidCompanyName(val));

      result.ourCompanies = this.deduplicateCompanyList(parsedOur);
    } catch (e) {
      console.warn(`Could not read sheet tab "${ourCompaniesTab}":`, e);
    }

    // 2. Load Suppliers (handles Col A + Col B, single col, EDRPOU, headers, and eliminates duplicates)
    try {
      const safeSup = suppliersTab.replace(/'/g, "''");
      const supData = await this.request<any>(
        `${cleanId}/values/${encodeURIComponent(`'${safeSup}'!A1:B1000`)}`,
        accessToken
      );
      const rows = supData.values || [];
      const parsedSuppliers = rows
        .map((row: any[]) => this.extractCleanCompanyName(row[0], row[1]))
        .filter((val: string) => !this.isHeaderOrInvalidCompanyName(val));

      result.suppliers = this.deduplicateCompanyList(parsedSuppliers);
    } catch (e) {
      console.warn(`Could not read sheet tab "${suppliersTab}":`, e);
    }

    return result;
  }

  /**
   * Clean up duplicate rows directly in the Google Sheet tab (e.g. "Постачальники").
   * Preserves headers, rewrites unique rows, and clears any removed duplicate rows.
   */
  public static async deduplicateCompaniesTab(
    spreadsheetId: string,
    accessToken: string,
    tabName = 'Постачальники'
  ): Promise<{ removedCount: number; remainingCount: number }> {
    const cleanId = this.extractSpreadsheetId(spreadsheetId);
    const safeTab = tabName.replace(/'/g, "''");

    const data = await this.request<any>(
      `${cleanId}/values/${encodeURIComponent(`'${safeTab}'!A1:B1000`)}`,
      accessToken
    );

    const rows: any[][] = data.values || [];
    if (rows.length <= 1) {
      return { removedCount: 0, remainingCount: rows.length };
    }

    // Determine header row
    const firstRowA = String(rows[0]?.[0] || '').trim();
    const isFirstRowHeader = this.isHeaderOrInvalidCompanyName(firstRowA);
    const header = isFirstRowHeader ? rows[0] : ['Назва постачальника', 'ЄДРПОУ / Контакт'];
    const dataRows = isFirstRowHeader ? rows.slice(1) : rows;

    const uniqueRows: any[][] = [];
    const seen = new Set<string>();
    let removedCount = 0;

    for (const row of dataRows) {
      const colA = row[0];
      const colB = row[1];
      const norm = this.extractCleanCompanyName(colA, colB);

      if (!norm || this.isHeaderOrInvalidCompanyName(norm)) {
        continue;
      }

      const key = norm.toUpperCase().replace(/\s+/g, ' ').trim();
      if (seen.has(key)) {
        removedCount++;
      } else {
        seen.add(key);
        // Standardize row: Col A has normalized company name, Col B retains original secondary info if not code
        uniqueRows.push([norm, colB && !String(colB).includes(norm) ? String(colB).trim() : '']);
      }
    }

    if (removedCount > 0) {
      // 1. Rewrite cleaned rows starting from A1
      const writeRows = [header, ...uniqueRows];
      await this.request<any>(
        `${cleanId}/values/'${safeTab}'!A1:B${writeRows.length}?valueInputOption=USER_ENTERED`,
        accessToken,
        {
          method: 'PUT',
          body: JSON.stringify({ values: writeRows }),
        }
      );

      // 2. Clear old duplicate rows beyond writeRows.length
      try {
        await this.request<any>(
          `${cleanId}/values/'${safeTab}'!A${writeRows.length + 1}:B${rows.length + 1}:clear`,
          accessToken,
          {
            method: 'POST',
            body: JSON.stringify({}),
          }
        );
      } catch {
        // ignore clear error if already empty
      }
    }

    return { removedCount, remainingCount: uniqueRows.length };
  }

  /**
   * Append a company name to the specified company list tab ("Наші компанії" or "Постачальники")
   * if it doesn't already exist.
   * STRICT GUARANTEE: Never touches or modifies "Лист1", "Рахунки", or "Платіжки".
   */
  public static async appendCompanyIfMissing(
    spreadsheetId: string,
    accessToken: string,
    companyName: string,
    tabType: 'our' | 'supplier',
    customTabName?: string,
    taxIdOrNote?: string
  ): Promise<boolean> {
    const cleanId = this.extractSpreadsheetId(spreadsheetId);
    const normName = OCRService.normalizeCompanyName(companyName);
    if (!normName || normName.length < 3 || this.isHeaderOrInvalidCompanyName(normName)) {
      return false;
    }

    const defaultTab = tabType === 'our' ? 'Наші компанії' : 'Постачальники';
    const tabName = customTabName || defaultTab;
    if (this.isProtectedTab(tabName)) return false;

    const safeTab = tabName.replace(/'/g, "''");
    let existingRows: any[][] = [];
    try {
      const data = await this.request<any>(
        `${cleanId}/values/${encodeURIComponent(`'${safeTab}'!A1:B1000`)}`,
        accessToken
      );
      existingRows = data.values || [];
    } catch {
      // Tab might not exist yet; ensure it
    }

    const headerRow = tabType === 'our'
      ? ['Назва нашої компанії', 'ЄДРПОУ / Примітка']
      : ['Назва постачальника', 'ЄДРПОУ / Контакт'];

    if (existingRows.length === 0) {
      await this.ensureTabExists(cleanId, accessToken, tabName, headerRow);
      existingRows = [headerRow];
    }

    // Check if company is already present in existing rows
    const alreadyExists = existingRows.some((row) => {
      const rowName = this.extractCleanCompanyName(row[0], row[1]);
      return rowName && OCRService.isCompanyNameMatch(rowName, normName);
    });

    if (alreadyExists) {
      return false;
    }

    const nextRow = existingRows.length + 1;
    await this.request<any>(
      `${cleanId}/values/'${safeTab}'!A${nextRow}:B${nextRow}?valueInputOption=USER_ENTERED`,
      accessToken,
      {
        method: 'PUT',
        body: JSON.stringify({
          values: [[normName, taxIdOrNote ? String(taxIdOrNote).trim() : '']],
        }),
      }
    );
    return true;
  }

  /**
   * Read existing Invoices from "Рахунки" tab
   * Columns A to J (or auto-detected from headers):
   * A: Номер замовлення | B: Постачальник | C: Платник | D: Номер рахунку | E: Дата рахунку | F: Сума | G: Валюта | H: Статус | I: Час завантаження | J: Сума оплати
   */
  public static async loadExistingInvoices(
    spreadsheetId: string,
    accessToken: string,
    invoicesTab = 'Рахунки',
    availableSheetsHint?: string[]
  ): Promise<ExistingSheetRow[]> {
    const cleanId = this.extractSpreadsheetId(spreadsheetId);
    let targetTab = invoicesTab;

    if (availableSheetsHint && availableSheetsHint.length > 0) {
      targetTab = this.resolveMatchingSheetTab(
        availableSheetsHint,
        invoicesTab,
        ['рахунк', 'счет', 'інвойс', 'invoices', 'invoice', 'рахунки-фактури']
      );
    }

    try {
      const safeTab = targetTab.replace(/'/g, "''");
      const range = encodeURIComponent(`'${safeTab}'!A1:Z2500`);
      const data = await this.request<any>(
        `${cleanId}/values/${range}`,
        accessToken
      );
      const rows: any[][] = data.values || [];
      if (rows.length <= 1) return [];

      // Detect header row if present
      let headerRowIdx = -1;
      let colOrder = 0;
      let colSupplier = 1;
      let colBuyer = 2;
      let colInvoiceNum = 3;
      let colDate = 4;
      let colAmount = 5;
      let colCurrency = 6;
      let colStatus = 7;
      let colUploadedAt = 8;
      let colPaidAmount = 9;
      let colApproval = 10;
      let colFileName = -1;
      let colDriveLink = -1;

      const scanLimit = Math.min(rows.length, 6);
      for (let r = 0; r < scanLimit; r++) {
        const row = rows[r];
        if (!row || !Array.isArray(row)) continue;
        const joined = row.map((c) => String(c || '').toLowerCase()).join(' ');
        if (
          joined.includes('замовлен') ||
          joined.includes('постачальн') ||
          joined.includes('платник') ||
          joined.includes('рахун') ||
          joined.includes('сума') ||
          joined.includes('статус')
        ) {
          headerRowIdx = r;
          row.forEach((cellRaw, cIdx) => {
            const cell = String(cellRaw || '').trim().toLowerCase();
            if (!cell) return;
            if (cell.includes('замовлен')) {
              colOrder = cIdx;
            } else if (cell.includes('постачальн') || cell.includes('продавець')) {
              colSupplier = cIdx;
            } else if (cell.includes('платник') || cell.includes('покупець') || cell.includes('наша компанія')) {
              colBuyer = cIdx;
            } else if (cell.includes('сума оплат') || cell.includes('оплачено')) {
              colPaidAmount = cIdx;
            } else if (cell.includes('сума')) {
              colAmount = cIdx;
            } else if (cell.includes('дата') && !cell.includes('внесен') && !cell.includes('додан') && !cell.includes('час')) {
              colDate = cIdx;
            } else if (
              (cell.includes('номер') && (cell.includes('рахун') || cell.includes('інвойс'))) ||
              ((cell.includes('рахун') || cell.includes('інвойс')) && !cell.includes('дата') && !cell.includes('сума') && !cell.includes('статус'))
            ) {
              colInvoiceNum = cIdx;
            } else if (cell.includes('валюта')) {
              colCurrency = cIdx;
            } else if (cell.includes('статус')) {
              colStatus = cIdx;
            } else if (cell.includes('час') || cell.includes('внесен') || cell.includes('додан')) {
              colUploadedAt = cIdx;
            } else if (cell.includes('файл') || cell.includes('документ')) {
              colFileName = cIdx;
            } else if (cell.includes('drive') || cell.includes('посилання') || cell.includes('лінк') || cell.includes('диск')) {
              colDriveLink = cIdx;
            } else if (cell.includes('погоджен') || cell.includes('approval')) {
              colApproval = cIdx;
            }
          });
          break;
        }
      }

      const dataRows = headerRowIdx >= 0 ? rows.slice(headerRowIdx + 1) : rows.slice(1);
      const startRowIdx = (headerRowIdx >= 0 ? headerRowIdx + 1 : 1) + 1; // 1-based in sheet

      const parsedInvoices: ExistingSheetRow[] = [];

      dataRows.forEach((row, idx) => {
        if (!row || !Array.isArray(row)) return;

        const rawSupplier = String(row[colSupplier] || '').trim();
        const rawBuyer = String(row[colBuyer] || '').trim();
        const rawOrder = String(row[colOrder] || '').trim();
        let rawInvNumber = String(row[colInvoiceNum] || '').trim();
        let rawInvDate = String(row[colDate] || '').trim();
        const amount = parseFloat(String(row[colAmount] || '0').replace(/\s/g, '').replace(',', '.')) || 0;
        const paidAmount = parseFloat(String(row[colPaidAmount] || '0').replace(/\s/g, '').replace(',', '.')) || 0;
        const rawUploadedAt = String(row[colUploadedAt] || '').trim();

        // Check if row has meaningful invoice content (not an empty or template row with defaults)
        const hasSupplier = rawSupplier && rawSupplier !== '—' && rawSupplier !== '-';
        const hasInvNumber = rawInvNumber && rawInvNumber !== '—' && rawInvNumber !== '-';
        const hasOrder = rawOrder && rawOrder !== '—' && rawOrder !== '-';
        const hasAmount = amount > 0;

        // Skip completely empty template rows (like rows 26..497)
        if (!hasSupplier && !hasInvNumber && !hasOrder && !hasAmount) {
          return;
        }

        let rawStatus = String(row[colStatus] || '').trim();
        let paymentStatus: InvoicePaymentStatus = 'Не оплачено';
        if (rawStatus === 'Оплачено' || rawStatus === 'Оплачено частково' || rawStatus === 'Не оплачено') {
          paymentStatus = rawStatus as InvoicePaymentStatus;
        } else if (rawStatus.toLowerCase().includes('частков')) {
          paymentStatus = 'Оплачено частково';
        } else if (rawStatus.toLowerCase().includes('оплач') && !rawStatus.toLowerCase().includes('не') && !rawStatus.toLowerCase().includes('очік')) {
          paymentStatus = 'Оплачено';
        }

        let approvalStatus: InvoiceApprovalStatus | undefined = undefined;
        if (colApproval >= 0) {
          const rawApproval = String(row[colApproval] || '').trim().toLowerCase();
          if (rawApproval.includes('не погоджено')) {
            approvalStatus = 'НЕ ПОГОДЖЕНО';
          } else if (rawApproval.includes('погоджено')) {
            approvalStatus = 'ПОГОДЖЕНО';
          }
        }
        // Default for all unpaid invoices: 'НЕ ПОГОДЖЕНО'
        if (!approvalStatus && paymentStatus !== 'Оплачено') {
          approvalStatus = 'НЕ ПОГОДЖЕНО';
        }

        // Safety check: if rawInvNumber is formatted as a date (e.g. 2026-08-25 or 25.08.2026) and rawInvDate is not,
        // or if the two columns are swapped in the sheet row:
        const isDatePattern = (s: string) => /^\d{4}[-./]\d{2}[-./]\d{2}$/.test(s) || /^\d{2}[-./]\d{2}[-./]\d{4}$/.test(s);
        if (isDatePattern(rawInvNumber) && rawInvDate && !isDatePattern(rawInvDate)) {
          const tmp = rawInvNumber;
          rawInvNumber = rawInvDate;
          rawInvDate = tmp;
        }

        // Extract file name and drive link if present in specific columns or anywhere in row
        let rawFileName = colFileName >= 0 ? String(row[colFileName] || '').trim() : '';
        let rawDriveLink = colDriveLink >= 0 ? String(row[colDriveLink] || '').trim() : '';

        if (!rawDriveLink) {
          for (const c of row) {
            const s = String(c || '').trim();
            if (s.includes('drive.google.com') || (s.startsWith('http') && s.includes('drive'))) {
              rawDriveLink = s;
              break;
            }
          }
        }
        if (!rawFileName) {
          for (const c of row) {
            const s = String(c || '').trim();
            if (/\.(pdf|jpg|jpeg|png|webp|heic|tiff|bmp)$/i.test(s)) {
              rawFileName = s;
              break;
            }
          }
        }

        parsedInvoices.push({
          rowIndex: startRowIdx + idx,
          orderNumber: OCRService.normalizeOrderNumber(rawOrder),
          supplier: OCRService.normalizeCompanyName(rawSupplier),
          buyer: OCRService.normalizeCompanyName(rawBuyer),
          invoiceNumber: rawInvNumber,
          invoiceDate: rawInvDate,
          amount,
          currency: String(row[colCurrency] || 'UAH').trim() || 'UAH',
          paymentStatus,
          approvalStatus,
          uploadedAt: rawUploadedAt,
          paidAmount,
          fileName: rawFileName || undefined,
          driveLink: rawDriveLink || undefined,
        });
      });

      return parsedInvoices;
    } catch (e) {
      console.warn(`Could not read sheet tab "${targetTab}":`, e);
      return [];
    }
  }

  /**
   * Read existing Payments from "Платіжки" tab with resilient tab resolution,
   * smart header detection, and fallback matching.
   */
  public static async loadExistingPayments(
    spreadsheetId: string,
    accessToken: string,
    paymentsTab = 'Платіжки',
    availableSheetsHint?: string[]
  ): Promise<{ payments: ExistingPaymentRow[]; resolvedTabName: string; error?: string }> {
    const cleanId = this.extractSpreadsheetId(spreadsheetId);

    // 1. Determine the actual list of available tabs in the spreadsheet
    let availableSheets = availableSheetsHint;
    if (!availableSheets || availableSheets.length === 0) {
      try {
        const details = await this.getSpreadsheetDetails(cleanId, accessToken);
        availableSheets = details.sheets;
      } catch (err: any) {
        console.warn('Could not fetch spreadsheet metadata for tab resolution:', err);
      }
    }

    // 2. Resolve the exact tab name from the spreadsheet
    let targetTab = paymentsTab;
    if (availableSheets && availableSheets.length > 0) {
      targetTab = this.resolveMatchingSheetTab(
        availableSheets,
        paymentsTab,
        ['платіжк', 'платеж', 'оплат', 'платіжні доручення', 'виписк', 'банк', 'payments', 'payment']
      );
    }

    // Helper to fetch rows from a specific tab
    const tryFetchTab = async (tabName: string): Promise<any[][]> => {
      const safeTab = tabName.replace(/'/g, "''");
      const range = encodeURIComponent(`'${safeTab}'!A1:Z2500`);
      const data = await this.request<any>(
        `${cleanId}/values/${range}`,
        accessToken
      );
      return data.values || [];
    };

    let rows: any[][] = [];
    let usedTabName = targetTab;
    let fetchError: string | undefined;

    try {
      rows = await tryFetchTab(targetTab);
    } catch (err: any) {
      fetchError = err.message || String(err);
      console.warn(`Could not read sheet tab "${targetTab}":`, err);

      // Fallback: if targetTab failed and we have availableSheets, try alternative candidate tabs
      if (availableSheets && availableSheets.length > 0) {
        const candidates = availableSheets.filter(
          (s) => s !== targetTab && !this.isProtectedTab(s)
        );
        for (const candidate of candidates) {
          const norm = this.normalizeSheetNameForComparison(candidate);
          if (
            norm.includes('плат') ||
            norm.includes('оплат') ||
            norm.includes('банк') ||
            norm.includes('виписк')
          ) {
            try {
              const candidateRows = await tryFetchTab(candidate);
              if (candidateRows && candidateRows.length > 0) {
                rows = candidateRows;
                usedTabName = candidate;
                fetchError = undefined;
                break;
              }
            } catch {
              // continue trying other candidates
            }
          }
        }
      }
    }

    if (!rows || rows.length === 0) {
      return {
        payments: [],
        resolvedTabName: usedTabName,
        error: fetchError,
      };
    }

    // 3. Smart Header Detection
    let headerRowIdx = -1;
    let colNum = 0;
    let colDate = 1;
    let colPayer = 2;
    let colPayee = 3;
    let colAmount = 4;
    let colCurrency = 5;
    let colPurpose = 6;
    let colInvoice = 7;
    let colOrder = 8;
    let colFileName = 9;
    let colDriveLink = 10;
    let colUploadedAt = 11;

    // Scan the first 6 rows to detect if there is a header row
    const scanLimit = Math.min(rows.length, 6);
    for (let r = 0; r < scanLimit; r++) {
      const row = rows[r];
      if (!row || !Array.isArray(row)) continue;
      const joined = row.map((c) => String(c || '').toLowerCase()).join(' ');
      const hasKeywords =
        joined.includes('номер') ||
        joined.includes('дата') ||
        joined.includes('сума') ||
        joined.includes('платник') ||
        joined.includes('одержувач') ||
        joined.includes('отримувач') ||
        joined.includes('постачальник') ||
        joined.includes('призначення') ||
        joined.includes('рахун') ||
        joined.includes('№');

      if (hasKeywords) {
        headerRowIdx = r;
        row.forEach((cellRaw, cIdx) => {
          const cell = String(cellRaw || '').trim().toLowerCase();
          if (!cell) return;

          if (cell.includes('призначення') || cell.includes('підстава') || cell.includes('деталі')) {
            colPurpose = cIdx;
          } else if (cell.includes('сума') || cell.includes('грн') || cell.includes('amount')) {
            colAmount = cIdx;
          } else if (cell.includes('дата') && !cell.includes('внесен')) {
            colDate = cIdx;
          } else if (cell.includes('валюта')) {
            colCurrency = cIdx;
          } else if (cell.includes('платник') || cell.includes('наша компанія')) {
            colPayer = cIdx;
          } else if (
            cell.includes('одержувач') ||
            cell.includes('отримувач') ||
            cell.includes('постачальник') ||
            cell.includes('контрагент')
          ) {
            colPayee = cIdx;
          } else if (cell.includes('рахун')) {
            colInvoice = cIdx;
          } else if (cell.includes('замовлен')) {
            colOrder = cIdx;
          } else if (cell.includes('файл')) {
            colFileName = cIdx;
          } else if (cell.includes('drive') || cell.includes('посилання') || cell.includes('лінк')) {
            colDriveLink = cIdx;
          } else if (cell.includes('внесен') || cell.includes('додан') || cell.includes('час')) {
            colUploadedAt = cIdx;
          } else if (
            (cell.includes('номер') && !cell.includes('рахун') && !cell.includes('замовлен')) ||
            cell === '№' ||
            cell === 'номер'
          ) {
            colNum = cIdx;
          }
        });
        break;
      }
    }

    // Determine data rows
    const dataRows = headerRowIdx >= 0 ? rows.slice(headerRowIdx + 1) : rows;
    const startRowIndex = (headerRowIdx >= 0 ? headerRowIdx + 1 : 0) + 1; // 1-based in sheet

    const payments: ExistingPaymentRow[] = [];

    dataRows.forEach((row, idx) => {
      if (!row || !Array.isArray(row)) return;

      // Check if row has any non-empty cells
      const hasAnyContent = row.some(
        (cell) => cell !== undefined && cell !== null && String(cell).trim() !== ''
      );
      if (!hasAnyContent) return;

      // 1. Amount
      const rawAmountStr = String(row[colAmount] ?? '').trim();
      let amountPaid = parseFloat(rawAmountStr.replace(/\s/g, '').replace(',', '.')) || 0;

      // Fallback: If amount is 0, scan row cells for a decimal number or monetary amount
      if (amountPaid === 0) {
        for (let c = 0; c < row.length; c++) {
          if (c === colNum || c === colDate || c === colOrder) continue;
          const val = String(row[c] || '').trim().replace(/\s/g, '').replace(',', '.');
          const num = parseFloat(val);
          if (!isNaN(num) && num > 0 && /^\d+(\.\d{1,2})?$/.test(val)) {
            amountPaid = num;
            break;
          }
        }
      }

      // 2. Date
      let paymentDate = String(row[colDate] ?? '').trim();
      if (!paymentDate || !/\d{2}/.test(paymentDate)) {
        for (let c = 0; c < row.length; c++) {
          const val = String(row[c] || '').trim();
          if (/^\d{2}[./-]\d{2}[./-]\d{2,4}$/.test(val) || /^\d{4}-\d{2}-\d{2}$/.test(val)) {
            paymentDate = val;
            break;
          }
        }
      }

      // 3. Payment Number
      const paymentNumber = String(row[colNum] ?? '').trim();

      // 4. Companies
      const payer = OCRService.normalizeCompanyName(String(row[colPayer] ?? ''));
      const payee = OCRService.normalizeCompanyName(String(row[colPayee] ?? ''));

      // 5. Purpose
      const paymentPurpose = String(row[colPurpose] ?? '').trim();

      // 6. Referenced Invoice Number
      let referencedInvoiceNumber = String(row[colInvoice] ?? '').trim();
      if (!referencedInvoiceNumber && paymentPurpose) {
        const extracted = OCRService.extractAllInvoiceNumbers(undefined, undefined, paymentPurpose);
        if (extracted.length > 0) {
          referencedInvoiceNumber = extracted[0];
        }
      }

      // 7. Order Number
      const orderNumber = OCRService.normalizeOrderNumber(String(row[colOrder] ?? ''));

      // 8. Metadata
      const currency = String(row[colCurrency] ?? 'UAH').trim() || 'UAH';
      const fileName = String(row[colFileName] ?? '').trim();
      const driveLink = String(row[colDriveLink] ?? '').trim();
      const uploadedAt = String(row[colUploadedAt] ?? '').trim();

      const hasMeaningfulContent = (
        amountPaid > 0 ||
        Boolean(paymentNumber && paymentNumber !== '—' && paymentNumber !== '-') ||
        Boolean(payee && payee !== '—' && payee !== '-') ||
        Boolean(payer && payer !== '—' && payer !== '-') ||
        Boolean(referencedInvoiceNumber && referencedInvoiceNumber !== '—' && referencedInvoiceNumber !== '-')
      );
      if (!hasMeaningfulContent) return;

      payments.push({
        rowIndex: startRowIndex + idx,
        paymentNumber,
        paymentDate,
        payer,
        payee,
        amountPaid,
        currency,
        paymentPurpose,
        referencedInvoiceNumber,
        orderNumber,
        fileName,
        driveLink,
        uploadedAt,
      });
    });

    return {
      payments,
      resolvedTabName: usedTabName,
      error: fetchError,
    };
  }

  /**
   * Load existing Workshop Overhead Expenses ("Цех") from Google Sheets.
   * Columns A-I:
   * A - Постачальник
   * B - Платник
   * C - Номер рахунку
   * D - Дата рахунку
   * E - Сума
   * F - Валюта
   * G - Статус оплачено чи ні
   * H - Час завантаження
   * I - Сума оплати
   */
  public static async loadExistingOverheadExpenses(
    spreadsheetId: string,
    accessToken: string,
    overheadTab = 'Цех',
    availableSheetsHint?: string[]
  ): Promise<OverheadExpenseRow[]> {
    const cleanId = this.extractSpreadsheetId(spreadsheetId);
    let targetTab = overheadTab;

    if (availableSheetsHint && availableSheetsHint.length > 0) {
      targetTab = this.resolveMatchingSheetTab(
        availableSheetsHint,
        overheadTab,
        ['цех', 'цехові', 'overhead', 'загальновиробничі', 'накладні']
      );
    }

    try {
      const safeTab = targetTab.replace(/'/g, "''");
      const range = encodeURIComponent(`'${safeTab}'!A1:Z2500`);
      const data = await this.request<any>(
        `${cleanId}/values/${range}`,
        accessToken
      );

      const rows: any[][] = data.values || [];
      if (rows.length === 0) return [];

      let headerRowIdx = -1;
      // Default column indices per user specification (A=0, B=1, C=2, D=3, E=4, F=5, G=6, H=7, I=8)
      let colSupplier = 0;   // A: Постачальник
      let colBuyer = 1;      // B: Платник
      let colInvoiceNum = 2; // C: Номер рахунку
      let colDate = 3;       // D: Дата рахунку
      let colAmount = 4;     // E: Сума
      let colCurrency = 5;   // F: Валюта
      let colStatus = 6;     // G: Статус оплачено чи ні
      let colUploadedAt = 7; // H: Час завантаження
      let colPaidAmount = 8; // I: Сума оплати
      let colDesc = -1;
      let colMonth = -1;

      for (let i = 0; i < Math.min(rows.length, 5); i++) {
        const row = rows[i];
        if (!row || !Array.isArray(row)) continue;
        const line = row.map((c) => String(c || '').toLowerCase()).join(' ');
        if (
          line.includes('постачальник') ||
          line.includes('платник') ||
          line.includes('рахунк') ||
          line.includes('сума') ||
          line.includes('статус')
        ) {
          headerRowIdx = i;
          row.forEach((cell, colIdx) => {
            const str = String(cell || '').toLowerCase().trim();
            if (str.includes('сума оплати') || str.includes('оплачено сума') || str.includes('paid amount')) {
              colPaidAmount = colIdx;
            } else if (str.includes('сума') || str.includes('ціна') || str.includes('вартість') || str === 'amount' || str === 'total') {
              colAmount = colIdx;
            } else if (str.includes('постачальник') || str.includes('контрагент') || str.includes('продавець') || str === 'supplier') {
              colSupplier = colIdx;
            } else if (str.includes('платник') || str.includes('покупець') || str.includes('замовник') || str === 'buyer' || str === 'payer') {
              colBuyer = colIdx;
            } else if (str.includes('номер рахунк') || str.includes('№ рахунк') || str.includes('ном. рахунк') || str.includes('invoice') || str === 'номер') {
              colInvoiceNum = colIdx;
            } else if (str.includes('дата рахунк') || str.includes('дата') || str.includes('день') || str === 'date') {
              colDate = colIdx;
            } else if (str.includes('валюта') || str === 'currency') {
              colCurrency = colIdx;
            } else if (str.includes('статус') || str === 'status') {
              colStatus = colIdx;
            } else if (str.includes('час') || str.includes('завантаження') || str.includes('внесення') || str === 'timestamp') {
              colUploadedAt = colIdx;
            } else if (str.includes('опис') || str.includes('призначення') || str.includes('найменування') || str === 'description') {
              colDesc = colIdx;
            } else if (str.includes('місяць') || str.includes('період') || str === 'month') {
              colMonth = colIdx;
            }
          });
          break;
        }
      }

      const dataRows = headerRowIdx >= 0 ? rows.slice(headerRowIdx + 1) : rows;
      const startRowIndex = (headerRowIdx >= 0 ? headerRowIdx + 1 : 0) + 1;

      const expenses: OverheadExpenseRow[] = [];

      dataRows.forEach((row, idx) => {
        if (!row || !Array.isArray(row)) return;
        const hasContent = row.some((cell) => cell !== undefined && cell !== null && String(cell).trim() !== '');
        if (!hasContent) return;

        const rawAmountStr = String(colAmount >= 0 ? (row[colAmount] ?? '') : '').trim();
        const amount = parseFloat(rawAmountStr.replace(/\s/g, '').replace(',', '.')) || 0;

        const supplier = OCRService.normalizeCompanyName(String(colSupplier >= 0 ? (row[colSupplier] ?? '') : ''));
        const buyer = OCRService.normalizeCompanyName(String(colBuyer >= 0 ? (row[colBuyer] ?? '') : ''));
        const invoiceNumber = String(colInvoiceNum >= 0 ? (row[colInvoiceNum] ?? '') : '').trim();
        const date = String(colDate >= 0 ? (row[colDate] ?? '') : '').trim();
        const currency = String(colCurrency >= 0 ? (row[colCurrency] ?? '') : 'UAH').trim() || 'UAH';

        const rawStatus = String(colStatus >= 0 ? (row[colStatus] ?? '') : '').trim();
        const paymentStatus: InvoicePaymentStatus =
          rawStatus === 'Оплачено' || rawStatus === 'Оплачено частково'
            ? rawStatus
            : 'Не оплачено';

        const uploadedAt = String(colUploadedAt >= 0 ? (row[colUploadedAt] ?? '') : '').trim();

        const rawPaidStr = String(colPaidAmount >= 0 ? (row[colPaidAmount] ?? '') : '').trim();
        const paidAmount = parseFloat(rawPaidStr.replace(/\s/g, '').replace(',', '.')) || (paymentStatus === 'Оплачено' ? amount : 0);

        let description = colDesc >= 0 ? String(row[colDesc] ?? '').trim() : '';
        if (!description && invoiceNumber) {
          description = `Рахунок № ${invoiceNumber}`;
        }

        let month = colMonth >= 0 ? String(row[colMonth] ?? '').trim() : '';
        if (!month && date) {
          month = formatMonthYearUk(date);
        }

        if (amount > 0 || supplier || invoiceNumber) {
          expenses.push({
            id: `overhead-row-${startRowIndex + idx}`,
            rowIndex: startRowIndex + idx,
            supplier,
            buyer,
            invoiceNumber,
            date,
            amount,
            currency,
            paymentStatus,
            uploadedAt,
            paidAmount,
            description,
            month: month || formatMonthYearUk(date),
          });
        }
      });

      return expenses;
    } catch (e: any) {
      console.warn('Could not load overhead expenses from sheet tab:', e?.message || e);
      return [];
    }
  }

  /**
   * Append an Overhead Expense to the "Цех" tab.
   * Mapping per user specification (Columns A-I):
   * A - Постачальник
   * B - Платник
   * C - Номер рахунку
   * D - Дата рахунку
   * E - Сума
   * F - Валюта
   * G - Статус оплачено чи ні
   * H - Час завантаження
   * I - Сума оплати
   */
  public static async appendOverheadExpense(
    spreadsheetId: string,
    accessToken: string,
    data: {
      ocr?: OCRResult;
      supplier?: string;
      buyer?: string;
      invoiceNumber?: string;
      date?: string;
      amount?: number;
      currency?: string;
      status?: InvoicePaymentStatus;
      uploadedAt?: string;
      paidAmount?: number;
      description?: string;
      month?: string;
      fileName?: string;
      driveLink?: string;
      overheadTab?: string;
    }
  ): Promise<{ updatedRange: string }> {
    const cleanId = this.extractSpreadsheetId(spreadsheetId);
    const tabName = data.overheadTab || 'Цех';

    if (this.isProtectedTab(tabName)) {
      throw new Error(`Внесення даних у "${tabName}" заблоковано для збереження існуючих даних.`);
    }

    const now = new Date();
    const formattedTimestamp = data.uploadedAt || now.toLocaleString('uk-UA', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    // Extract fields with the same normalization and logic as appendInvoice
    const supplier = OCRService.normalizeCompanyName(
      data.supplier || data.ocr?.supplierName || ''
    );
    const buyer = OCRService.normalizeCompanyName(
      data.buyer || data.ocr?.buyerName || data.ocr?.payerName || ''
    );
    const invoiceNumber = (
      data.invoiceNumber || data.ocr?.invoiceNumber || ''
    ).trim();
    const invoiceDate = (
      data.date || data.ocr?.invoiceDate || now.toISOString().slice(0, 10)
    ).trim();
    const amount = data.amount ?? data.ocr?.totalAmount ?? 0;
    const currency = (data.currency || data.ocr?.currency || 'UAH').toUpperCase();
    const status: InvoicePaymentStatus =
      data.status || data.ocr?.paymentStatus || 'Не оплачено';

    const paidAmount =
      data.paidAmount ??
      (status === 'Оплачено' ? amount : 0);

    // Exact row structure Columns A-I:
    // A: Постачальник
    // B: Платник
    // C: Номер рахунку
    // D: Дата рахунку
    // E: Сума
    // F: Валюта
    // G: Статус оплачено чи ні
    // H: Час завантаження
    // I: Сума оплати
    const row = [
      supplier,           // A - Постачальник
      buyer,              // B - Платник
      invoiceNumber,      // C - Номер рахунку
      invoiceDate,        // D - Дата рахунку
      amount,             // E - сума
      currency,           // F - Валюта
      status,             // G - Статус оплачено чи ні
      formattedTimestamp, // H - час завантаження
      paidAmount,         // I - Cума оплати
    ];

    await this.ensureTabExists(cleanId, accessToken, tabName, this.OVERHEAD_HEADERS);
    const safeTab = tabName.replace(/'/g, "''");
    const targetRow = await this.findFirstAvailableOverheadRow(cleanId, accessToken, tabName);
    const range = `'${safeTab}'!A${targetRow}:I${targetRow}`;

    await this.request<any>(
      `${cleanId}/values:batchUpdate`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({
          valueInputOption: 'USER_ENTERED',
          data: [
            {
              range,
              values: [row],
            },
          ],
        }),
      }
    );

    return { updatedRange: range };
  }

  /**
   * Update payment status (Column G) and paid amount (Column I) for an overhead expense in "Цех"
   */
  public static async updateOverheadPaymentInSheet(
    spreadsheetId: string,
    accessToken: string,
    rowIndex: number,
    newStatus: InvoicePaymentStatus,
    paidAmount?: number,
    overheadTab = 'Цех'
  ): Promise<void> {
    const cleanId = this.extractSpreadsheetId(spreadsheetId);
    if (this.isProtectedTab(overheadTab)) {
      throw new Error(`Внесення даних у "${overheadTab}" заблоковано для збереження існуючих даних.`);
    }

    await this.ensureTabExists(cleanId, accessToken, overheadTab, this.OVERHEAD_HEADERS);

    const safeTab = overheadTab.replace(/'/g, "''");
    const updates: Array<{ range: string; values: any[][] }> = [
      {
        range: `'${safeTab}'!G${rowIndex}`,
        values: [[newStatus]],
      },
    ];

    if (paidAmount !== undefined) {
      updates.push({
        range: `'${safeTab}'!I${rowIndex}`,
        values: [[paidAmount]],
      });
    }

    await this.request<any>(
      `${cleanId}/values:batchUpdate`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({
          valueInputOption: 'USER_ENTERED',
          data: updates,
        }),
      }
    );
  }

  /**
   * Append an Invoice to the "Рахунки" sheet tab.
   * STRICT GUARANTEE: Never touches or modifies "Лист1".
   * Exact Columns A to J:
   * A: Номер замовлення (ххх-хх БЕЗ №)
   * B: Постачальник
   * C: Платник
   * D: Номер рахунку
   * E: Дата рахунку
   * F: Сума
   * G: Валюта
   * H: Статус (Не оплачено / Оплачено / Оплачено частково)
   * I: Час завантаження
   * J: Сума оплати
   */
  public static async appendInvoice(
    spreadsheetId: string,
    accessToken: string,
    data: {
      ocr: OCRResult;
      fileName: string;
      driveLink?: string;
      status?: InvoicePaymentStatus;
      paidAmount?: number;
      invoicesTab?: string;
    }
  ): Promise<{ updatedRange: string }> {
    const cleanId = this.extractSpreadsheetId(spreadsheetId);
    const tabName = data.invoicesTab || 'Рахунки';

    // Strict safety check: Never write to Лист1
    if (this.isProtectedTab(tabName)) {
      throw new Error(`Внесення даних у "${tabName}" заблоковано для збереження існуючих даних.`);
    }

    // Format order number strictly as xxx-xx WITHOUT symbol №
    const orderNum = OCRService.normalizeOrderNumber(data.ocr.handwrittenOrderNumber || '');

    // If marked as OVERHEAD ("ЦЕХ" / "ЦУХ"), route to the workshop overhead tab
    if (
      data.ocr.expenseCategory === 'OVERHEAD' ||
      data.ocr.isOverhead ||
      orderNum === 'ЦЕХ' ||
      OCRService.isOverheadDocument(data.ocr, data.fileName)
    ) {
      return this.appendOverheadExpense(spreadsheetId, accessToken, {
        ocr: data.ocr,
        fileName: data.fileName,
        driveLink: data.driveLink,
        status: data.status,
        paidAmount: data.paidAmount,
        overheadTab: 'Цех',
      });
    }

    // Format current timestamp e.g. 31.08.2026, 22:52:06
    const now = new Date();
    const formattedTimestamp = now.toLocaleString('uk-UA', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    // Default status for an invoice
    const status: InvoicePaymentStatus = data.status || data.ocr.paymentStatus || 'Не оплачено';

    // Normalize company names to strict format: "ТОВ НАЗВА" (UPPERCASE, NO QUOTES)
    const supplier = OCRService.normalizeCompanyName(data.ocr.supplierName || '');
    const buyer = OCRService.normalizeCompanyName(data.ocr.buyerName || '');

    // Paid amount for column J
    const paidAmount = data.paidAmount ?? (
      status === 'Оплачено' ? (data.ocr.totalAmount || 0) : 0
    );

    // Exactly 11 columns: A to K
    const row = [
      orderNum,                           // A: Номер замовлення (xxx-xx)
      supplier,                           // B: Постачальник
      buyer,                              // C: Платник
      data.ocr.invoiceNumber || '',       // D: Номер рахунку
      data.ocr.invoiceDate || '',         // E: Дата рахунку
      data.ocr.totalAmount || 0,          // F: Сума
      data.ocr.currency || 'UAH',         // G: Валюта
      status,                             // H: Статус ("Не оплачено", "Оплачено", "Оплачено частково")
      formattedTimestamp,                 // I: Час завантаження
      paidAmount,                         // J: Сума оплати
      data.ocr.approvalStatus || (status !== 'Оплачено' ? 'НЕ ПОГОДЖЕНО' : ''), // K: Погодження
    ];

    // Ensure tab exists before writing
    await this.ensureTabExists(cleanId, accessToken, tabName, this.INVOICE_HEADERS);

    const safeTab = tabName.replace(/'/g, "''");
    try {
      // Find the exact first available empty row (e.g. row 26, right below existing filled rows)
      const targetRow = await this.findFirstAvailableInvoiceRow(cleanId, accessToken, tabName);
      const range = `'${safeTab}'!A${targetRow}:K${targetRow}`;

      await this.request<any>(
        `${cleanId}/values:batchUpdate`,
        accessToken,
        {
          method: 'POST',
          body: JSON.stringify({
            valueInputOption: 'USER_ENTERED',
            data: [
              {
                range,
                values: [row],
              },
            ],
          }),
        }
      );

      return { updatedRange: range };
    } catch (err: any) {
      if (err?.message && err.message.includes('Unable to parse range')) {
        // Fallback: force create tab and retry once
        await this.ensureTabExists(cleanId, accessToken, tabName, this.INVOICE_HEADERS);
        const retryRow = await this.findFirstAvailableInvoiceRow(cleanId, accessToken, tabName);
        const retryRange = `'${safeTab}'!A${retryRow}:K${retryRow}`;
        await this.request<any>(
          `${cleanId}/values:batchUpdate`,
          accessToken,
          {
            method: 'POST',
            body: JSON.stringify({
              valueInputOption: 'USER_ENTERED',
              data: [
                {
                  range: retryRange,
                  values: [row],
                },
              ],
            }),
          }
        );
        return { updatedRange: retryRange };
      }
      throw err;
    }
  }

  /**
   * Replaces an existing unpaid invoice row in-place in "Рахунки"
   * (e.g. supplier issued a revised invoice due to out-of-stock items, price changes, etc.)
   */
  public static async replaceInvoiceInSheet(
    spreadsheetId: string,
    accessToken: string,
    rowIndex: number,
    data: {
      ocr: OCRResult;
      fileName?: string;
      driveLink?: string;
      invoicesTab?: string;
      previousInvoiceInfo?: {
        invoiceNumber?: string;
        amount?: number;
        supplier?: string;
        date?: string;
      };
      note?: string;
    }
  ): Promise<{ updatedRange: string }> {
    const cleanId = this.extractSpreadsheetId(spreadsheetId);
    const tabName = data.invoicesTab || 'Рахунки';

    if (this.isProtectedTab(tabName)) {
      throw new Error(`Внесення даних у "${tabName}" заблоковано для збереження існуючих даних.`);
    }

    if (!rowIndex || rowIndex <= 1) {
      throw new Error(`Невірний номер рядка для заміни: ${rowIndex}`);
    }

    const orderNum = OCRService.normalizeOrderNumber(data.ocr.handwrittenOrderNumber || '');
    const supplier = OCRService.normalizeCompanyName(data.ocr.supplierName || '');
    const buyer = OCRService.normalizeCompanyName(data.ocr.buyerName || '');

    const now = new Date();
    const formattedTimestamp = now.toLocaleString('uk-UA', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    const prevNote = data.previousInvoiceInfo?.invoiceNumber
      ? `заміна №${data.previousInvoiceInfo.invoiceNumber}`
      : 'заміна рахунку';
    const finalTimestamp = `${formattedTimestamp} (${prevNote})`;

    const status: InvoicePaymentStatus = 'Не оплачено';
    const paidAmount = 0;

    // Exactly 11 columns: A to K
    const row = [
      orderNum,                           // A: Номер замовлення (xxx-xx)
      supplier,                           // B: Постачальник
      buyer,                              // C: Платник
      String(data.ocr.invoiceNumber || ''), // D: Номер рахунку
      String(data.ocr.invoiceDate || ''),   // E: Дата рахунку
      Number(data.ocr.totalAmount) || 0,    // F: Сума
      String(data.ocr.currency || 'UAH'),   // G: Валюта
      status,                             // H: Статус ("Не оплачено")
      finalTimestamp,                     // I: Час завантаження / заміни
      paidAmount,                         // J: Сума оплати (0)
      'НЕ ПОГОДЖЕНО',                     // K: Погодження (новий замінений рахунок)
    ];

    const safeTab = tabName.replace(/'/g, "''");
    const range = `'${safeTab}'!A${rowIndex}:K${rowIndex}`;

    try {
      await this.request<any>(
        `${cleanId}/values:batchUpdate`,
        accessToken,
        {
          method: 'POST',
          body: JSON.stringify({
            valueInputOption: 'USER_ENTERED',
            data: [
              {
                range,
                values: [row],
              },
            ],
          }),
        }
      );
    } catch (batchErr: any) {
      console.warn(`Initial batchUpdate for range ${range} failed, trying alternative range notation:`, batchErr);
      const fallbackRange = `${tabName}!A${rowIndex}:J${rowIndex}`;
      await this.request<any>(
        `${cleanId}/values:batchUpdate`,
        accessToken,
        {
          method: 'POST',
          body: JSON.stringify({
            valueInputOption: 'USER_ENTERED',
            data: [
              {
                range: fallbackRange,
                values: [row],
              },
            ],
          }),
        }
      );
    }

    return { updatedRange: range };
  }

  /**
   * Update Status (Column H) and Paid Amount (Column J) for an existing invoice in "Рахунки"
   */
  public static async updateInvoicePaymentInSheet(
    spreadsheetId: string,
    accessToken: string,
    rowIndex: number,
    newStatus: InvoicePaymentStatus,
    paidAmount?: number,
    invoicesTab = 'Рахунки'
  ): Promise<void> {
    const cleanId = this.extractSpreadsheetId(spreadsheetId);
    if (this.isProtectedTab(invoicesTab)) return;

    await this.ensureTabExists(cleanId, accessToken, invoicesTab, this.INVOICE_HEADERS);

    const updates: Array<{ range: string; values: any[][] }> = [
      {
        range: `'${invoicesTab}'!H${rowIndex}`,
        values: [[newStatus]],
      },
    ];

    if (paidAmount !== undefined) {
      updates.push({
        range: `'${invoicesTab}'!J${rowIndex}`,
        values: [[paidAmount]],
      });
    }

    await this.request<any>(
      `${cleanId}/values:batchUpdate`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({
          valueInputOption: 'USER_ENTERED',
          data: updates,
        }),
      }
    );
  }

  /**
   * Batch updates Column J (Сума оплати) in "Рахунки" for invoices with inflated or duplicate amounts,
   * restoring them strictly to the invoice amount (100%) as per the closed-pair business rule.
   */
  public static async batchNormalizeOverpaidInvoices(
    spreadsheetId: string,
    accessToken: string,
    items: Array<{ rowIndex: number; correctPaidAmount: number }>,
    invoicesTab = 'Рахунки'
  ): Promise<void> {
    const cleanId = this.extractSpreadsheetId(spreadsheetId);
    if (this.isProtectedTab(invoicesTab) || items.length === 0) return;

    await this.ensureTabExists(cleanId, accessToken, invoicesTab, this.INVOICE_HEADERS);

    const updates = items.map((item) => ({
      range: `'${invoicesTab}'!J${item.rowIndex}`,
      values: [[item.correctPaidAmount]],
    }));

    await this.request<any>(
      `${cleanId}/values:batchUpdate`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({
          valueInputOption: 'USER_ENTERED',
          data: updates,
        }),
      }
    );
  }

  /**
   * Update status column (H) for an existing invoice in "Рахунки"
   */
  public static async updateInvoiceStatusInSheet(
    spreadsheetId: string,
    accessToken: string,
    rowIndex: number,
    newStatus: InvoicePaymentStatus,
    invoicesTab = 'Рахунки'
  ): Promise<void> {
    return this.updateInvoicePaymentInSheet(spreadsheetId, accessToken, rowIndex, newStatus, undefined, invoicesTab);
  }

  /**
   * Updates Invoice Approval Status in Column K in "Рахунки" using Validate-before-Write.
   * Dynamically locates the row by invoiceNumber & supplier to ensure table sorting doesn't mismatch rows.
   */
  public static async updateInvoiceApprovalInSheet(
    spreadsheetId: string,
    accessToken: string,
    rowIndex: number,
    approvalStatus: InvoiceApprovalStatus,
    invoiceNumber?: string,
    supplier?: string,
    invoicesTab = 'Рахунки'
  ): Promise<{ targetRow: number; updatedRange: string }> {
    const cleanId = this.extractSpreadsheetId(spreadsheetId);
    if (this.isProtectedTab(invoicesTab)) {
      throw new Error(`Внесення даних у "${invoicesTab}" заблоковано для збереження існуючих даних.`);
    }

    await this.ensureTabExists(cleanId, accessToken, invoicesTab, this.INVOICE_HEADERS);

    const safeTab = invoicesTab.replace(/'/g, "''");
    // Read current data to dynamically locate the target row (Validate-before-Write)
    const range = `'${safeTab}'!A:K`;
    const data = await this.request<any>(
      `${cleanId}/values/${encodeURIComponent(range)}`,
      accessToken
    );

    const rows: any[][] = data.values || [];
    let targetRow = rowIndex;
    let colSupplier = 1;   // Default Column B
    let colInvoiceNum = 3; // Default Column D
    let colApproval = 10;  // Default Column K
    let headerRowIdx = -1;

    // Scan for header row
    const scanLimit = Math.min(rows.length, 6);
    for (let r = 0; r < scanLimit; r++) {
      const row = rows[r];
      if (!row || !Array.isArray(row)) continue;
      const joined = row.map((c) => String(c || '').toLowerCase()).join(' ');
      if (
        joined.includes('замовлен') ||
        joined.includes('постачальн') ||
        joined.includes('платник') ||
        joined.includes('рахун') ||
        joined.includes('сума') ||
        joined.includes('статус')
      ) {
        headerRowIdx = r;
        row.forEach((cellRaw, cIdx) => {
          const cell = String(cellRaw || '').trim().toLowerCase();
          if (!cell) return;
          if (cell.includes('постачальн') || cell.includes('продавець')) {
            colSupplier = cIdx;
          } else if (
            (cell.includes('номер') && (cell.includes('рахун') || cell.includes('інвойс'))) ||
            ((cell.includes('рахун') || cell.includes('інвойс')) && !cell.includes('дата') && !cell.includes('сума') && !cell.includes('статус'))
          ) {
            colInvoiceNum = cIdx;
          } else if (cell.includes('погоджен') || cell.includes('approval')) {
            colApproval = cIdx;
          }
        });
        break;
      }
    }

    // Ensure Column K has a header if header row exists and cell is empty
    const colLetter = this.columnIndexToLetter(colApproval);
    if (headerRowIdx >= 0) {
      const headerRow = rows[headerRowIdx] || [];
      const currentHeader = String(headerRow[colApproval] || '').trim();
      if (!currentHeader) {
        try {
          await this.request<any>(
            `${cleanId}/values/'${safeTab}'!${colLetter}${headerRowIdx + 1}?valueInputOption=USER_ENTERED`,
            accessToken,
            {
              method: 'PUT',
              body: JSON.stringify({
                range: `'${safeTab}'!${colLetter}${headerRowIdx + 1}`,
                values: [['Погодження']],
              }),
            }
          );
        } catch {
          // Non-blocking header write
        }
      }
    }

    // Validate-before-Write: Dynamic row search by invoiceNumber and supplier
    const cleanStr = (s: any) =>
      String(s || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-zа-яієїґ0-9]/gi, '');

    const targetNum = cleanStr(invoiceNumber);
    const targetSup = cleanStr(supplier);

    if (targetNum || targetSup) {
      let matchedRow = -1;

      // 1. First test whether rowIndex matches directly (fast path)
      const initialIdx = rowIndex - 1; // 0-based in rows array
      if (initialIdx >= 0 && initialIdx < rows.length) {
        const checkRow = rows[initialIdx];
        if (checkRow && Array.isArray(checkRow)) {
          const rowNum = cleanStr(checkRow[colInvoiceNum]);
          const rowSup = cleanStr(checkRow[colSupplier]);

          const numMatch = !targetNum || (rowNum && (rowNum === targetNum || rowNum.includes(targetNum) || targetNum.includes(rowNum)));
          const supMatch = !targetSup || (rowSup && (rowSup === targetSup || rowSup.includes(targetSup) || targetSup.includes(rowSup)));

          if (targetNum && targetSup) {
            if (numMatch && supMatch) {
              matchedRow = rowIndex;
            }
          } else if (targetNum && numMatch) {
            matchedRow = rowIndex;
          }
        }
      }

      // 2. If row shifted or sorted, search all data rows to find the exact row
      if (matchedRow === -1) {
        const startR = headerRowIdx >= 0 ? headerRowIdx + 1 : 1;
        let candidateByBoth = -1;
        let candidateByNum = -1;

        for (let r = startR; r < rows.length; r++) {
          const checkRow = rows[r];
          if (!checkRow || !Array.isArray(checkRow)) continue;

          const rowNum = cleanStr(checkRow[colInvoiceNum]);
          const rowSup = cleanStr(checkRow[colSupplier]);

          const numMatch = targetNum && rowNum && (rowNum === targetNum || rowNum.includes(targetNum) || targetNum.includes(rowNum));
          const supMatch = targetSup && rowSup && (rowSup === targetSup || rowSup.includes(targetSup) || targetSup.includes(rowSup));

          if (numMatch && supMatch) {
            candidateByBoth = r + 1; // 1-based in sheet
            break;
          }
          if (numMatch && candidateByNum === -1) {
            candidateByNum = r + 1;
          }
        }

        if (candidateByBoth !== -1) {
          matchedRow = candidateByBoth;
        } else if (candidateByNum !== -1) {
          matchedRow = candidateByNum;
        }
      }

      if (matchedRow !== -1) {
        targetRow = matchedRow;
      }
    }

    const targetCellRange = `'${safeTab}'!${colLetter}${targetRow}`;

    await this.request<any>(
      `${cleanId}/values/${encodeURIComponent(targetCellRange)}?valueInputOption=USER_ENTERED`,
      accessToken,
      {
        method: 'PUT',
        body: JSON.stringify({
          range: targetCellRange,
          values: [[approvalStatus]],
        }),
      }
    );

    return { targetRow, updatedRange: targetCellRange };
  }

  /**
   * Converts 0-based column index to A1 column letter (0 -> A, 3 -> D, 26 -> AA)
   */
  public static columnIndexToLetter(colIndex: number): string {
    let temp = colIndex;
    let letter = '';
    while (temp >= 0) {
      letter = String.fromCharCode((temp % 26) + 65) + letter;
      temp = Math.floor(temp / 26) - 1;
    }
    return letter;
  }

  /**
   * Merges a duplicate invoice into an earlier row without shifting previous row indices:
   * 1. Updates the invoice number in the original row (e.g. Row 34 gets № 227763)
   * 2. Deletes the duplicate row (e.g. Row 45)
   * Because the duplicate row is later (e.g. row 45 > row 34), deleting it causes ZERO index shifts
   * for rows 1 to duplicateRowIndex - 1. All numbering and ordering remain 100% intact!
   */
  public static async mergeDuplicateInvoiceInSheet(
    spreadsheetId: string,
    accessToken: string,
    originalRowIndex: number,
    duplicateRowIndex: number,
    correctInvoiceNumber: string,
    invoicesTab = 'Рахунки'
  ): Promise<void> {
    const cleanId = this.extractSpreadsheetId(spreadsheetId);
    if (this.isProtectedTab(invoicesTab)) {
      throw new Error(`Вкладка "${invoicesTab}" захищена від змін.`);
    }

    if (!originalRowIndex || originalRowIndex <= 1 || !duplicateRowIndex || duplicateRowIndex <= 1) {
      throw new Error(`Некоректні номери рядків для об'єднання: оригінал ${originalRowIndex}, дубль ${duplicateRowIndex}`);
    }

    // 1. Detect dynamic column letter for Invoice Number
    let invoiceColLetter = 'D'; // Standard fallback (A=Order, B=Supplier, C=Buyer, D=InvoiceNum)
    try {
      const headerRows = await this.request<any>(
        `${cleanId}/values/'${invoicesTab.replace(/'/g, "''")}'!1:5`,
        accessToken
      );
      if (headerRows && Array.isArray(headerRows.values)) {
        for (const row of headerRows.values) {
          if (!Array.isArray(row)) continue;
          row.forEach((cellRaw, idx) => {
            const cell = String(cellRaw || '').trim().toLowerCase();
            if (
              (cell.includes('номер') && (cell.includes('рахун') || cell.includes('інвойс'))) ||
              ((cell.includes('рахун') || cell.includes('інвойс')) && !cell.includes('дата') && !cell.includes('сума') && !cell.includes('статус'))
            ) {
              invoiceColLetter = this.columnIndexToLetter(idx);
            }
          });
        }
      }
    } catch (err) {
      console.warn('Could not dynamically detect invoice number column, fallback to D:', err);
    }

    // 2. Update the original row with the correct invoice number
    const safeTab = invoicesTab.replace(/'/g, "''");
    await this.request<any>(
      `${cleanId}/values/'${safeTab}'!${invoiceColLetter}${originalRowIndex}?valueInputOption=USER_ENTERED`,
      accessToken,
      {
        method: 'PUT',
        body: JSON.stringify({
          range: `'${safeTab}'!${invoiceColLetter}${originalRowIndex}`,
          majorDimension: 'ROWS',
          values: [[correctInvoiceNumber]],
        }),
      }
    );

    // 3. Delete the duplicate row
    await this.deleteRowsFromSheet(cleanId, accessToken, invoicesTab, [duplicateRowIndex]);
  }

  /**
   * Append a Payment order to the "Платіжки" sheet tab.
   * STRICT GUARANTEE: Never touches or modifies "Лист1".
   */
  public static async appendPayment(
    spreadsheetId: string,
    accessToken: string,
    data: {
      ocr: OCRResult;
      fileName: string;
      driveLink?: string;
      paymentsTab?: string;
    }
  ): Promise<{ updatedRange: string }> {
    const cleanId = this.extractSpreadsheetId(spreadsheetId);
    const tabName = data.paymentsTab || 'Платіжки';

    // Strict safety check: Never write to Лист1
    if (this.isProtectedTab(tabName)) {
      throw new Error(`Внесення даних у "${tabName}" заблоковано для збереження існуючих даних.`);
    }

    // Ensure tab exists before writing
    await this.ensureTabExists(cleanId, accessToken, tabName, this.PAYMENT_HEADERS);

    const orderNum = OCRService.normalizeOrderNumber(data.ocr.referencedOrderNumber || data.ocr.handwrittenOrderNumber || '');
    const payer = OCRService.normalizeCompanyName(data.ocr.payerName || data.ocr.buyerName || '');
    const payee = OCRService.normalizeCompanyName(data.ocr.payeeName || data.ocr.supplierName || '');

    const row = [
      data.ocr.paymentNumber || data.ocr.invoiceNumber || '',
      data.ocr.paymentDate || data.ocr.invoiceDate || '',
      payer,
      payee,
      data.ocr.amountPaid || data.ocr.totalAmount || 0,
      data.ocr.currency || 'UAH',
      data.ocr.paymentPurpose || '',
      data.ocr.referencedInvoiceNumber || '',
      orderNum,
      data.fileName || '',
      data.driveLink || '',
      new Date().toLocaleString('uk-UA'),
    ];

    const safeTab = tabName.replace(/'/g, "''");
    try {
      // Find the exact first available empty row in "Платіжки"
      const targetRow = await this.findFirstAvailablePaymentRow(cleanId, accessToken, tabName);
      const range = `'${safeTab}'!A${targetRow}:L${targetRow}`;

      const res = await this.request<any>(
        `${cleanId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
        accessToken,
        {
          method: 'PUT',
          body: JSON.stringify({
            values: [row],
          }),
        }
      );

      const updatedRange = res.updatedRange || range;
      return { updatedRange };
    } catch (err: any) {
      if (err?.message && err.message.includes('Unable to parse range')) {
        // Fallback: force create tab and retry once
        await this.ensureTabExists(cleanId, accessToken, tabName, this.PAYMENT_HEADERS);
        const retryRow = await this.findFirstAvailablePaymentRow(cleanId, accessToken, tabName);
        const retryRange = `'${safeTab}'!A${retryRow}:L${retryRow}`;
        const res = await this.request<any>(
          `${cleanId}/values/${encodeURIComponent(retryRange)}?valueInputOption=USER_ENTERED`,
          accessToken,
          {
            method: 'PUT',
            body: JSON.stringify({
              values: [row],
            }),
          }
        );
        return {
          updatedRange: res.updatedRange || retryRange,
        };
      }
      throw err;
    }
  }

  /**
   * Update Order Number (Column I) and/or Invoice Number (Column H) for an existing payment in "Платіжки"
   */
  public static async updatePaymentOrderAndInvoiceInSheet(
    spreadsheetId: string,
    accessToken: string,
    rowIndex: number,
    orderNumber?: string,
    invoiceNumber?: string,
    paymentsTab = 'Платіжки'
  ): Promise<void> {
    const cleanId = this.extractSpreadsheetId(spreadsheetId);
    if (this.isProtectedTab(paymentsTab) || rowIndex < 2) return;

    await this.ensureTabExists(cleanId, accessToken, paymentsTab, this.PAYMENT_HEADERS);

    const updates: Array<{ range: string; values: any[][] }> = [];

    if (invoiceNumber !== undefined && invoiceNumber.trim()) {
      updates.push({
        range: `'${paymentsTab}'!H${rowIndex}`,
        values: [[invoiceNumber.trim()]],
      });
    }

    if (orderNumber !== undefined && orderNumber.trim()) {
      updates.push({
        range: `'${paymentsTab}'!I${rowIndex}`,
        values: [[orderNumber.trim()]],
      });
    }

    if (updates.length === 0) return;

    await this.request<any>(
      `${cleanId}/values:batchUpdate`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({
          valueInputOption: 'USER_ENTERED',
          data: updates,
        }),
      }
    );
  }

  /**
   * Create standard tabs & formatted column headers if spreadsheet is new/empty.
   * STRICT GUARANTEE: Never deletes, renames, or modifies "Лист1".
   * Only creates and populates dedicated tabs: 'Рахунки', 'Платіжки', 'Наші компанії', 'Постачальники'.
   */
  public static async setupStandardTemplate(
    spreadsheetId: string,
    accessToken: string
  ): Promise<void> {
    const cleanId = this.extractSpreadsheetId(spreadsheetId);
    const details = await this.getSpreadsheetDetails(cleanId, accessToken);
    const existing = new Set(details.sheets);

    const requiredTabs = ['Рахунки', 'Платіжки', 'Наші компанії', 'Постачальники'];
    const tabsToCreate = requiredTabs.filter((t) => !existing.has(t));

    // 1. Create missing tabs (does NOT touch existing tabs like Лист1)
    if (tabsToCreate.length > 0) {
      await this.request<any>(`${cleanId}:batchUpdate`, accessToken, {
        method: 'POST',
        body: JSON.stringify({
          requests: tabsToCreate.map((title) => ({
            addSheet: {
              properties: { title },
            },
          })),
        }),
      });
    }

    // 2. Set headers for "Рахунки" matching exact sequence:
    // A: Номер замовлення | B: Постачальник | C: Платник | D: Номер рахунку | E: Дата рахунку | F: Сума | G: Валюта | H: Статус | I: Час завантаження | J: Сума оплати
    await this.request<any>(
      `${cleanId}/values/'${encodeURIComponent('Рахунки')}'!A1:J1?valueInputOption=USER_ENTERED`,
      accessToken,
      {
        method: 'PUT',
        body: JSON.stringify({
          values: [[
            'Номер замовлення',
            'Постачальник',
            'Платник',
            'Номер рахунку',
            'Дата рахунку',
            'Сума',
            'Валюта',
            'Статус',
            'Час завантаження',
            'Сума оплати',
          ]],
        }),
      }
    );

    // 3. Set headers for "Платіжки"
    await this.request<any>(
      `${cleanId}/values/'${encodeURIComponent('Платіжки')}'!A1:L1?valueInputOption=USER_ENTERED`,
      accessToken,
      {
        method: 'PUT',
        body: JSON.stringify({
          values: [[
            'Номер платіжки',
            'Дата платіжки',
            'Платник (Наша компанія)',
            'Одержувач (Постачальник)',
            'Сума оплати',
            'Валюта',
            'Призначення платежу',
            'Номер рахунку (з призначення)',
            'Номер замовлення',
            'Назва файлу',
            'Посилання Drive',
            'Дата внесення',
          ]],
        }),
      }
    );

    // 4. Set headers for "Наші компанії" if empty
    try {
      const ourCheck = await this.request<any>(
        `${cleanId}/values/'${encodeURIComponent('Наші компанії')}'!A1:B1`,
        accessToken
      );
      if (!ourCheck.values || ourCheck.values.length === 0) {
        await this.request<any>(
          `${cleanId}/values/'${encodeURIComponent('Наші компанії')}'!A1:B1?valueInputOption=USER_ENTERED`,
          accessToken,
          {
            method: 'PUT',
            body: JSON.stringify({
              values: [['Назва нашої компанії', 'ЄДРПОУ / Примітка']],
            }),
          }
        );
      }
    } catch {
      // ignore
    }

    // 5. Set headers for "Постачальники" if empty
    try {
      const supCheck = await this.request<any>(
        `${cleanId}/values/'${encodeURIComponent('Постачальники')}'!A1:B1`,
        accessToken
      );
      if (!supCheck.values || supCheck.values.length === 0) {
        await this.request<any>(
          `${cleanId}/values/'${encodeURIComponent('Постачальники')}'!A1:B1?valueInputOption=USER_ENTERED`,
          accessToken,
          {
            method: 'PUT',
            body: JSON.stringify({
              values: [['Назва постачальника', 'ЄДРПОУ / Контакт']],
            }),
          }
        );
      }
    } catch {
      // ignore
    }
  }

  /**
   * Reads project cost & profitability data from "Лист1" strictly starting from row 111 and below.
   * Extracts columns: A, B, C, D, E, F, G, H, I, M, N, O, P, sum(Q+R+S+T), U, V, W, X, Y.
   * Also reads potential headers from rows 1..110 so table headers reflect the real sheet layout.
   */
  public static async getProjectsFromSheet(
    spreadsheetId: string,
    accessToken: string,
    tabName = 'Лист1'
  ): Promise<{
    headers: ProjectColumnHeader[];
    rows: ProjectSheetRow[];
    totalSumQRST: number;
    rowCount: number;
    tabNameUsed: string;
  }> {
    const cleanId = this.extractSpreadsheetId(spreadsheetId);
    let targetTab = tabName;

    // Check available sheets to match "Лист1" (case-insensitive, fallback to Sheet1 / Аркуш1 if needed)
    try {
      const details = await this.getSpreadsheetDetails(cleanId, accessToken);
      if (details && details.sheets && details.sheets.length > 0) {
        const foundTab = details.sheets.find(
          (s) =>
            s.trim().toLowerCase() === 'лист1' ||
            s.trim().toLowerCase() === 'лист 1' ||
            s.trim().toLowerCase() === 'sheet1' ||
            s.trim().toLowerCase() === 'аркуш1'
        );
        if (foundTab) {
          targetTab = foundTab;
        } else if (!details.sheets.includes(targetTab)) {
          // If neither found, use the first tab of spreadsheet
          targetTab = details.sheets[0];
        }
      }
    } catch {
      // ignore fallback
    }

    const safeTab = targetTab.replace(/'/g, "''");
    // We read from A1 to Y5000 so we capture both header definitions in rows 1..110 and project rows starting at 111
    const range = encodeURIComponent(`'${safeTab}'!A1:Y5000`);
    const data = await this.request<any>(
      `${cleanId}/values/${range}`,
      accessToken
    );

    const rows: any[][] = data.values || [];
    if (!rows || rows.length === 0) {
      return {
        headers: this.getDefaultProjectHeaders(),
        rows: [],
        totalSumQRST: 0,
        rowCount: 0,
        tabNameUsed: targetTab,
      };
    }

    // 1. Scan candidate rows (0..10 and row 109/Row 110) to determine the actual column header row
    const targetCols = [0, 1, 2, 3, 4, 5, 6, 7, 8, 12, 13, 14, 15, 20, 21, 22, 23, 24];

    const isNumOrDate = (val: string): boolean => {
      const s = val.trim();
      if (!s) return false;
      if (/^\s*[-+]?\d+([.,]\d+)?\s*(грн|%|₴|\$|€)?\s*$/i.test(s)) return true;
      if (/^\d{1,4}[-./]\d{1,2}[-./]\d{1,4}$/.test(s)) return true;
      return false;
    };

    // Calculate score for candidate header row
    const getRowHeaderScore = (rowIndex: number): number => {
      const r = rows[rowIndex];
      if (!r || !Array.isArray(r)) return 0;
      let score = 0;
      for (const colIdx of targetCols) {
        const val = String(r[colIdx] ?? '').trim();
        if (val && val.length >= 2 && !isNumOrDate(val)) {
          score += 2;
          const lower = val.toLowerCase();
          if (
            lower.includes('назв') ||
            lower.includes('замовл') ||
            lower.includes('клієнт') ||
            lower.includes('партнер') ||
            lower.includes('контракт') ||
            lower.includes('догов') ||
            lower.includes('статус') ||
            lower.includes('сума') ||
            lower.includes('оплат') ||
            lower.includes('аванс') ||
            lower.includes('витрат') ||
            lower.includes('марж') ||
            lower.includes('приміт') ||
            lower.includes('комент') ||
            lower.includes('дата') ||
            lower.includes('термін') ||
            lower.includes('відповідальн') ||
            lower.includes('менеджер') ||
            lower.includes('код') ||
            lower.includes('обʼєкт') ||
            lower.includes('об\'єкт') ||
            lower.includes('обєкт') ||
            lower.includes('№') ||
            lower.includes('проект') ||
            lower.includes('робот')
          ) {
            score += 3;
          }
        }
      }
      return score;
    };

    // Find candidate row with max score among rows 0..10 and row 109 (Row 110 in sheet)
    let bestHeaderRowIdx = 0;
    let maxHeaderScore = getRowHeaderScore(0);

    for (let r = 1; r < Math.min(10, rows.length); r++) {
      const score = getRowHeaderScore(r);
      if (score > maxHeaderScore) {
        maxHeaderScore = score;
        bestHeaderRowIdx = r;
      }
    }

    // Also check row 109 (Row 110 in sheet) in case header is placed directly above row 111
    if (rows.length > 109) {
      const score110 = getRowHeaderScore(109);
      if (score110 > maxHeaderScore && score110 >= 4) {
        maxHeaderScore = score110;
        bestHeaderRowIdx = 109;
      }
    }

    // Function to get clean title directly from the sheet
    const getColumnHeaderTitle = (colIdx: number, colLetter: string): string => {
      // 1. Try bestHeaderRowIdx
      const primaryVal = String(rows[bestHeaderRowIdx]?.[colIdx] ?? '').trim();
      if (primaryVal && !isNumOrDate(primaryVal)) {
        // If row 0 has a category and row 1 has a sub-title
        if (bestHeaderRowIdx === 1 && rows[0]?.[colIdx]) {
          const topVal = String(rows[0][colIdx]).trim();
          if (topVal && !isNumOrDate(topVal) && topVal !== primaryVal) {
            return `${topVal} / ${primaryVal}`;
          }
        }
        return primaryVal;
      }

      // 2. Try rows 0..5
      for (let r = 0; r < Math.min(5, rows.length); r++) {
        if (r === bestHeaderRowIdx) continue;
        const val = String(rows[r]?.[colIdx] ?? '').trim();
        if (val && !isNumOrDate(val)) {
          return val;
        }
      }

      // 3. Try row 109
      if (rows.length > 109 && bestHeaderRowIdx !== 109) {
        const val110 = String(rows[109]?.[colIdx] ?? '').trim();
        if (val110 && !isNumOrDate(val110)) {
          return val110;
        }
      }

      return `Колонка ${colLetter}`;
    };

    const headers: ProjectColumnHeader[] = [
      { key: 'colA', letter: 'A', title: getColumnHeaderTitle(0, 'A') },
      { key: 'colB', letter: 'B', title: getColumnHeaderTitle(1, 'B') },
      { key: 'colC', letter: 'C', title: getColumnHeaderTitle(2, 'C') },
      { key: 'colD', letter: 'D', title: getColumnHeaderTitle(3, 'D') },
      { key: 'colE', letter: 'E', title: getColumnHeaderTitle(4, 'E') },
      { key: 'colF', letter: 'F', title: getColumnHeaderTitle(5, 'F') },
      { key: 'colG', letter: 'G', title: getColumnHeaderTitle(6, 'G') },
      { key: 'colH', letter: 'H', title: getColumnHeaderTitle(7, 'H') },
      { key: 'colI', letter: 'I', title: getColumnHeaderTitle(8, 'I') },
      { key: 'colM', letter: 'M', title: getColumnHeaderTitle(12, 'M') },
      { key: 'colN', letter: 'N', title: getColumnHeaderTitle(13, 'N') },
      { key: 'colO', letter: 'O', title: getColumnHeaderTitle(14, 'O') },
      { key: 'colP', letter: 'P', title: getColumnHeaderTitle(15, 'P') },
      // The user explicitly requested: "лише ту колонку де є сума колонок назви Заробітня плата"
      { key: 'sumQRST', letter: 'Q+R+S+T', title: 'Заробітня плата' },
      { key: 'colU', letter: 'U', title: getColumnHeaderTitle(20, 'U') },
      { key: 'colV', letter: 'V', title: getColumnHeaderTitle(21, 'V') },
      { key: 'colW', letter: 'W', title: getColumnHeaderTitle(22, 'W') },
      { key: 'colX', letter: 'X', title: getColumnHeaderTitle(23, 'X') },
      { key: 'colY', letter: 'Y', title: getColumnHeaderTitle(24, 'Y') },
    ];

    // 2. Parse data rows starting strictly from row 111 (0-based index 110)
    const parseNum = (v: any): number => {
      if (typeof v === 'number') return isNaN(v) ? 0 : v;
      const s = String(v ?? '')
        .replace(/\s/g, '')
        .replace(',', '.')
        .replace(/[^0-9.-]/g, '');
      const n = parseFloat(s);
      return isNaN(n) ? 0 : n;
    };

    const isMeaningful = (v: any): boolean => {
      const s = String(v ?? '').trim();
      if (!s) return false;
      if (
        s === '—' ||
        s === '-' ||
        s === '–' ||
        s === '.' ||
        s === '0' ||
        s === '0.0' ||
        s === '0.00' ||
        s === '0,0' ||
        s === '0,00' ||
        s === '0%' ||
        s === '0.0%' ||
        s === '0.00%' ||
        s === '0,0%' ||
        s === '0,00%' ||
        s === '0 грн' ||
        s === '0,00 грн' ||
        s === '0.00 грн' ||
        s === '0 ₴' ||
        s === '0,00 ₴' ||
        s === '0.00 ₴' ||
        s.toLowerCase() === 'false' ||
        s.toLowerCase() === 'null' ||
        s.toLowerCase() === 'undefined'
      ) {
        return false;
      }
      if (/^0+(\.0+|,0+)?(\s*(грн|%|₴|\$|€))?$/i.test(s)) return false;
      if (/^#(n\/a|value!|ref!|div\/0!|name\?|null!|num!)$/i.test(s)) return false;
      return true;
    };

    const projectRows: ProjectSheetRow[] = [];
    let totalSumQRST = 0;

    // Start strictly at row index 110 (Row 111 in Google Sheets)
    const startIndex = 110;
    for (let i = startIndex; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !Array.isArray(row)) continue;

      const getVal = (idx: number) => String(row[idx] ?? '').trim();

      const colA = getVal(0);
      const colB = getVal(1);
      const colC = getVal(2);
      const colD = getVal(3);
      const colE = getVal(4);
      const colF = getVal(5);
      const colG = getVal(6);
      const colH = getVal(7);
      const colI = getVal(8);
      const colM = getVal(12);
      const colN = getVal(13);
      const colO = getVal(14);
      const colP = getVal(15);
      const colQ = getVal(16);
      const colR = getVal(17);
      const colS = getVal(18);
      const colT = getVal(19);

      const qVal = parseNum(colQ);
      const rVal = parseNum(colR);
      const sVal = parseNum(colS);
      const tVal = parseNum(colT);
      const sumQRST = qVal + rVal + sVal + tVal;

      const colU = getVal(20);
      const colV = getVal(21);
      const colW = getVal(22);
      const colX = getVal(23);
      const colY = getVal(24);

      // Check if row has an actual project identifier or meaningful data
      const hasIdentifier = isMeaningful(colA) || isMeaningful(colB) || isMeaningful(colC);
      const hasSecondary =
        isMeaningful(colD) ||
        isMeaningful(colE) ||
        isMeaningful(colF) ||
        isMeaningful(colG) ||
        isMeaningful(colX) ||
        isMeaningful(colY);
      const hasFinances =
        parseNum(colH) > 0 ||
        parseNum(colI) > 0 ||
        parseNum(colM) > 0 ||
        parseNum(colN) > 0 ||
        sumQRST > 0 ||
        parseNum(colU) > 0;

      // Filter out empty rows, formula ghosts, and unused trailing rows
      if (!hasIdentifier && !hasSecondary && !hasFinances) {
        continue;
      }

      totalSumQRST += sumQRST;

      projectRows.push({
        rowNumber: i + 1, // 1-based row number in sheet (111, 112, ...)
        colA,
        colB,
        colC,
        colD,
        colE,
        colF,
        colG,
        colH,
        colI,
        colM,
        colN,
        colO,
        colP,
        colQ,
        colR,
        colS,
        colT,
        sumQRST,
        colU,
        colV,
        colW,
        colX,
        colY,
      });
    }

    return {
      headers,
      rows: projectRows,
      totalSumQRST,
      rowCount: projectRows.length,
      tabNameUsed: targetTab,
    };
  }

  /**
   * Default headers fallback when sheet is empty or unavailable
   */
  public static getDefaultProjectHeaders(): ProjectColumnHeader[] {
    return [
      { key: 'colA', letter: 'A', title: 'Колонка A' },
      { key: 'colB', letter: 'B', title: 'Колонка B' },
      { key: 'colC', letter: 'C', title: 'Колонка C' },
      { key: 'colD', letter: 'D', title: 'Колонка D' },
      { key: 'colE', letter: 'E', title: 'Колонка E' },
      { key: 'colF', letter: 'F', title: 'Колонка F' },
      { key: 'colG', letter: 'G', title: 'Колонка G' },
      { key: 'colH', letter: 'H', title: 'Колонка H' },
      { key: 'colI', letter: 'I', title: 'Колонка I' },
      { key: 'colM', letter: 'M', title: 'Колонка M' },
      { key: 'colN', letter: 'N', title: 'Колонка N' },
      { key: 'colO', letter: 'O', title: 'Колонка O' },
      { key: 'colP', letter: 'P', title: 'Колонка P' },
      { key: 'sumQRST', letter: 'Q+R+S+T', title: 'Заробітня плата' },
      { key: 'colU', letter: 'U', title: 'Колонка U' },
      { key: 'colV', letter: 'V', title: 'Колонка V' },
      { key: 'colW', letter: 'W', title: 'Колонка W' },
      { key: 'colX', letter: 'X', title: 'Колонка X' },
      { key: 'colY', letter: 'Y', title: 'Колонка Y' },
    ];
  }

  /**
   * Validates project number format (e.g. "235-26", "227-26", "12-25", "100/26")
   */
  public static isProjectNumberValid(num: string): boolean {
    if (!num) return false;
    const trimmed = num.trim().replace(/^[№#]\s*/, '');
    // Standard format: digits/alphanumeric prefix with hyphen/slash and year suffix
    return /^[A-Za-zА-Яа-яІіЇїЄє0-9]{1,8}[-/]\d{2,4}$/.test(trimmed) || /^\d+[-/]\d+$/.test(trimmed);
  }

  /**
   * Appends a new project row into the first free/empty cell in Column A of the specified tab (default "Лист1").
   * Strictly respects user requirements:
   * - Column A: Project Number (Номер проекту)
   * - Column B: Project Name (Назва проекту)
   * - Column C: Start Date (Старт проект)
   * - Column G: Invoice Number (Рахунок)
   * - Column H: Invoice Date (Дата рахунку)
   */
  public static async addProjectToSheet(
    spreadsheetId: string,
    accessToken: string,
    projectData: {
      projectNumber: string;
      projectName: string;
      startDate: string;
      invoiceNumber?: string;
      invoiceDate?: string;
      contractAmount?: string | number;
    },
    tabName = 'Лист1'
  ): Promise<{ targetRow: number; tabNameUsed: string }> {
    const cleanId = this.extractSpreadsheetId(spreadsheetId);
    let targetTab = tabName;

    // Resolve matching sheet tab if needed (Лист1 / Sheet1 / Аркуш1)
    try {
      const details = await this.getSpreadsheetDetails(cleanId, accessToken);
      if (details && details.sheets && details.sheets.length > 0) {
        const foundTab = details.sheets.find(
          (s) =>
            s.trim().toLowerCase() === 'лист1' ||
            s.trim().toLowerCase() === 'лист 1' ||
            s.trim().toLowerCase() === 'sheet1' ||
            s.trim().toLowerCase() === 'аркуш1'
        );
        if (foundTab) {
          targetTab = foundTab;
        } else if (!details.sheets.includes(targetTab)) {
          targetTab = details.sheets[0];
        }
      }
    } catch {
      // ignore
    }

    const safeTab = targetTab.replace(/'/g, "''");

    // Read column A from row 1 to row 5000 to locate the first free/empty cell in Column A for projects
    const range = encodeURIComponent(`'${safeTab}'!A1:A5000`);
    const data = await this.request<any>(`${cleanId}/values/${range}`, accessToken);
    const colAValues: any[][] = data.values || [];

    // The project table rows start strictly at row 111 (0-based index 110).
    // Scan starting from row 111 downwards for the first empty cell in Column A.
    let targetRow = 111;
    const startIndex = 110;

    if (colAValues.length <= startIndex) {
      targetRow = 111;
    } else {
      let foundEmpty = false;
      for (let r = startIndex; r < colAValues.length; r++) {
        const cell = colAValues[r]?.[0];
        const val = cell !== undefined && cell !== null ? String(cell).trim() : '';
        if (!val) {
          targetRow = r + 1; // 1-based row index
          foundEmpty = true;
          break;
        }
      }
      if (!foundEmpty) {
        targetRow = colAValues.length + 1;
      }
    }

    // Format dates to DD.MM.YYYY if given in YYYY-MM-DD
    const formatDateForSheet = (dStr: string): string => {
      if (!dStr) return '';
      const s = dStr.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        const [y, m, d] = s.split('-');
        return `${d}.${m}.${y}`;
      }
      return s;
    };

    const formattedStartDate = formatDateForSheet(projectData.startDate);
    const formattedInvoiceDate = formatDateForSheet(projectData.invoiceDate || '');
    const cleanProjectNumber = projectData.projectNumber.trim().replace(/^[№#]\s*/, '');

    // Prepare batchUpdate value ranges:
    // Range 1: Columns A..C (A: Project Number, B: Project Name, C: Start Date)
    // Range 2: Columns G..H (G: Invoice Number, H: Invoice Date)
    // Range 3: Column M (M: Contract Amount / Сума Договору)
    const updateRanges: Array<{ range: string; values: any[][] }> = [
      {
        range: `'${safeTab}'!A${targetRow}:C${targetRow}`,
        values: [[cleanProjectNumber, projectData.projectName.trim(), formattedStartDate]],
      },
      {
        range: `'${safeTab}'!G${targetRow}:H${targetRow}`,
        values: [[projectData.invoiceNumber?.trim() || '', formattedInvoiceDate]],
      },
    ];

    if (projectData.contractAmount !== undefined && projectData.contractAmount !== null && String(projectData.contractAmount).trim() !== '') {
      const rawAmount = String(projectData.contractAmount).trim().replace(/\s/g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
      const num = parseFloat(rawAmount);
      updateRanges.push({
        range: `'${safeTab}'!M${targetRow}`,
        values: [[!isNaN(num) ? num : String(projectData.contractAmount).trim()]],
      });
    }

    await this.request<any>(`${cleanId}/values:batchUpdate`, accessToken, {
      method: 'POST',
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data: updateRanges,
      }),
    });

    return {
      targetRow,
      tabNameUsed: targetTab,
    };
  }
}


