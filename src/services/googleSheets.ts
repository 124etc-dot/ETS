import { OCRResult, SheetCompanyLists, ExistingSheetRow, ExistingPaymentRow, InvoicePaymentStatus } from '../types';
import { OCRService } from './ocrService';
import { googleAuth } from './googleAuth';

export class GoogleSheetsService {
  /**
   * Protected sheet tabs that must NEVER be overwritten, modified, or cleared.
   */
  private static readonly FORBIDDEN_TABS = ['лист1', 'sheet1', 'аркуш1', 'лист 1', 'sheet 1', 'аркуш 1'];

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

    return res.json();
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
  ): Promise<{ title: string; sheets: string[]; id: string }> {
    const cleanId = this.extractSpreadsheetId(spreadsheetId);
    const data = await this.request<any>(`${cleanId}?includeGridData=false`, accessToken);
    const sheets = (data.sheets || []).map((s: any) => s.properties?.title || '');
    return {
      id: cleanId,
      title: data.properties?.title || 'Google Таблиця',
      sheets,
    };
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
   * Find the exact next available row index (1-based) in a sheet tab.
   * Scans rows to guarantee appending strictly starts at Column A of a new row.
   */
  public static async getNextEmptyRowIndex(
    cleanId: string,
    accessToken: string,
    tabName: string
  ): Promise<number> {
    try {
      const res = await this.request<any>(
        `${cleanId}/values/'${encodeURIComponent(tabName)}'!A1:L2000`,
        accessToken
      );
      const values: any[][] = res.values || [];
      if (values.length === 0) return 2; // If completely empty, row 1 is header, row 2 is data

      let lastNonEmptyRow = 0;
      for (let i = values.length - 1; i >= 0; i--) {
        const row = values[i];
        if (row && row.some((cell: any) => cell !== undefined && String(cell).trim() !== '')) {
          lastNonEmptyRow = i + 1; // 1-based row index
          break;
        }
      }

      // If at least row 1 has something (headers), start at least on row 2
      return Math.max(2, lastNonEmptyRow + 1);
    } catch (e) {
      console.warn(`Could not determine next row for "${tabName}", defaulting to row 2:`, e);
      return 2;
    }
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
            }
          });
          break;
        }
      }

      const dataRows = headerRowIdx >= 0 ? rows.slice(headerRowIdx + 1) : rows.slice(1);
      const startRowIdx = (headerRowIdx >= 0 ? headerRowIdx + 1 : 1) + 1; // 1-based in sheet

      return dataRows.map((row, idx) => {
        let rawStatus = String(row[colStatus] || '').trim();
        let paymentStatus: InvoicePaymentStatus = 'Не оплачено';
        if (rawStatus === 'Оплачено' || rawStatus === 'Оплачено частково' || rawStatus === 'Не оплачено') {
          paymentStatus = rawStatus as InvoicePaymentStatus;
        } else if (rawStatus.toLowerCase().includes('частков')) {
          paymentStatus = 'Оплачено частково';
        } else if (rawStatus.toLowerCase().includes('оплач') && !rawStatus.toLowerCase().includes('не') && !rawStatus.toLowerCase().includes('очік')) {
          paymentStatus = 'Оплачено';
        }

        const amount = parseFloat(String(row[colAmount] || '0').replace(/\s/g, '').replace(',', '.')) || 0;
        const paidAmount = parseFloat(String(row[colPaidAmount] || '0').replace(/\s/g, '').replace(',', '.')) || 0;

        let rawInvNumber = String(row[colInvoiceNum] || '').trim();
        let rawInvDate = String(row[colDate] || '').trim();

        // Safety check: if rawInvNumber is formatted as a date (e.g. 2026-08-25 or 25.08.2026) and rawInvDate is not,
        // or if the two columns are swapped in the sheet row:
        const isDatePattern = (s: string) => /^\d{4}[-./]\d{2}[-./]\d{2}$/.test(s) || /^\d{2}[-./]\d{2}[-./]\d{4}$/.test(s);
        if (isDatePattern(rawInvNumber) && rawInvDate && !isDatePattern(rawInvDate)) {
          const tmp = rawInvNumber;
          rawInvNumber = rawInvDate;
          rawInvDate = tmp;
        }

        return {
          rowIndex: startRowIdx + idx,
          orderNumber: OCRService.normalizeOrderNumber(String(row[colOrder] || '')),
          supplier: OCRService.normalizeCompanyName(String(row[colSupplier] || '')),
          buyer: OCRService.normalizeCompanyName(String(row[colBuyer] || '')),
          invoiceNumber: rawInvNumber,
          invoiceDate: rawInvDate,
          amount,
          currency: String(row[colCurrency] || 'UAH').trim() || 'UAH',
          paymentStatus,
          uploadedAt: String(row[colUploadedAt] || '').trim(),
          paidAmount,
        };
      });
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

    // Exactly 10 columns: A to J
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
    ];

    // Ensure tab exists before writing
    await this.ensureTabExists(cleanId, accessToken, tabName, this.INVOICE_HEADERS);

    const nextRow = await this.getNextEmptyRowIndex(cleanId, accessToken, tabName);
    const range = `'${encodeURIComponent(tabName)}'!A${nextRow}:J${nextRow}`;

    try {
      const res = await this.request<any>(
        `${cleanId}/values/${range}?valueInputOption=USER_ENTERED`,
        accessToken,
        {
          method: 'PUT',
          body: JSON.stringify({
            values: [row],
          }),
        }
      );

      return {
        updatedRange: res.updatedRange || range,
      };
    } catch (err: any) {
      if (err?.message && err.message.includes('Unable to parse range')) {
        // Fallback: force create tab and retry once
        await this.ensureTabExists(cleanId, accessToken, tabName, this.INVOICE_HEADERS);
        const retryRow = await this.getNextEmptyRowIndex(cleanId, accessToken, tabName);
        const retryRange = `'${encodeURIComponent(tabName)}'!A${retryRow}:J${retryRow}`;
        const res = await this.request<any>(
          `${cleanId}/values/${retryRange}?valueInputOption=USER_ENTERED`,
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

    const nextRow = await this.getNextEmptyRowIndex(cleanId, accessToken, tabName);
    const range = `'${encodeURIComponent(tabName)}'!A${nextRow}:L${nextRow}`;

    try {
      const res = await this.request<any>(
        `${cleanId}/values/${range}?valueInputOption=USER_ENTERED`,
        accessToken,
        {
          method: 'PUT',
          body: JSON.stringify({
            values: [row],
          }),
        }
      );

      return {
        updatedRange: res.updatedRange || range,
      };
    } catch (err: any) {
      if (err?.message && err.message.includes('Unable to parse range')) {
        // Fallback: force create tab and retry once
        await this.ensureTabExists(cleanId, accessToken, tabName, this.PAYMENT_HEADERS);
        const retryRow = await this.getNextEmptyRowIndex(cleanId, accessToken, tabName);
        const retryRange = `'${encodeURIComponent(tabName)}'!A${retryRow}:L${retryRow}`;
        const res = await this.request<any>(
          `${cleanId}/values/${retryRange}?valueInputOption=USER_ENTERED`,
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
}


