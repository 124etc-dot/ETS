export type DocumentType = 'invoice' | 'payment' | 'other';
export type InvoicePaymentStatus = 'Оплачено' | 'Не оплачено' | 'Оплачено частково';
export type InvoiceApprovalStatus = 'ПОГОДЖЕНО' | 'НЕ ПОГОДЖЕНО' | 'ВІДХИЛЕНО' | 'Approved' | 'Pending' | 'Rejected';
export type ExpenseCategory = 'PROJECT' | 'OVERHEAD';

export interface ExtractedLineItem {
  name: string;
  quantity?: number;
  unitPrice?: number;
  total?: number;
}

export interface OCRResult {
  documentType: DocumentType;
  documentTypeUkrainian: string; // "Рахунок на оплату" | "Платіжна інструкція"
  
  // Category of expense: OVERHEAD (ЦЕХ / загальновиробничі витрати) vs PROJECT (прямі витрати замовлення)
  expenseCategory?: ExpenseCategory;
  isOverhead?: boolean;

  // Critical Handwritten Order Number (format: xxx-xx without №, or "ЦЕХ")
  handwrittenOrderNumber: string; // e.g. "123-26", "ЦЕХ" or empty if none
  handwrittenRawText?: string; // Exact text as written
  handwrittenLocation?: string; // "Top right", "Bottom corner", "Near total amount", etc.
  handwrittenConfidence: 'high' | 'medium' | 'low' | 'none';
  
  // Status: "Оплачено" | "Не оплачено" | "Оплачено частково"
  paymentStatus?: InvoicePaymentStatus;

  // Approval status: "ПОГОДЖЕНО" | "НЕ ПОГОДЖЕНО"
  approvalStatus?: InvoiceApprovalStatus;

  // Invoice details
  supplierName: string; // Must NOT match our companies
  supplierTaxId?: string; // ЄДРПОУ / ІПН
  supplierIban?: string;
  buyerName: string; // Matches our company
  buyerTaxId?: string;
  invoiceNumber: string;
  invoiceDate: string; // YYYY-MM-DD
  invoiceDateOriginal?: string; // e.g. "15 березня 2026 р."
  totalAmount: number;
  currency: string; // "UAH", "USD", "EUR", "PLN"
  vatAmount?: number; // ПДВ
  
  // Payment details (if doc is payment order / платіжка)
  paymentNumber?: string;
  paymentDate?: string;
  payerName?: string;
  payeeName?: string;
  amountPaid?: number;
  paymentPurpose?: string; // Призначення платежу
  referencedInvoiceNumber?: string;
  referencedInvoiceNumbers?: string[]; // Multiple invoice numbers from payment purpose e.g. ["124", "125", "126"]
  referencedOrderNumber?: string;

  // Matching info
  matchedInvoiceNumber?: string;
  matchedInvoiceAmount?: number;
  matchedInvoicePreviousPaid?: number;
  matchedInvoiceRowIndex?: number;
  matchedInvoiceTab?: 'Рахунки' | 'Цех';
  matchedInvoices?: Array<{
    invoiceNumber: string;
    orderNumber?: string;
    invoiceAmount: number;
    previousPaidAmount?: number;
    paidAmount?: number;
    computedStatus: InvoicePaymentStatus;
    matchedRowIndex?: number;
    matchedDocId?: string;
    matchReason?: string;
    targetTab?: 'Рахунки' | 'Цех';
    isOverhead?: boolean;
    supplier?: string;
    buyer?: string;
  }>;
  matchedPaymentNumber?: string;
  matchedPaymentAmount?: number;
  matchedPaymentRowIndex?: number;
  matchedPaymentsSummary?: string;
  paidAmount?: number; // Paid amount for invoices (Column J)

  // Additional
  documentTitle?: string;
  bankExecutionStamp?: string;
  lineItems?: ExtractedLineItem[];
  notes?: string;
  confidenceScore: number; // 0 to 100
  validationWarnings?: string[];
}

export interface ProcessedDocument {
  id: string;
  source: 'drive' | 'upload' | 'camera';
  driveFileId?: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  driveLink?: string;
  thumbnailUrl?: string;
  previewDataUrl?: string;
  blob?: Blob;
  driveUploadStatus?: 'uploading' | 'uploaded' | 'failed' | 'idle';
  driveUploadError?: string;
  driveWebViewLink?: string;
  status: 'pending' | 'processing' | 'ready_for_review' | 'synced' | 'error';
  paymentStatus?: InvoicePaymentStatus; // "Не оплачено" | "Оплачено" | "Оплачено частково"
  approvalStatus?: InvoiceApprovalStatus; // "ПОГОДЖЕНО" | "НЕ ПОГОДЖЕНО"
  errorMessage?: string;
  expenseCategory?: ExpenseCategory;
  isOverhead?: boolean;
  ocrResult?: OCRResult;
  editedData?: OCRResult;
  ocr?: OCRResult; // Alias for ocrResult/editedData compatibility
  syncedRowIndex?: number;
  syncedAt?: string;
  createdAt?: number; // Timestamp in ms for sorting newest first
  alreadyInSheet?: boolean;
  alreadyInSheetReason?: string;
  alreadyInSheetTab?: string;
  matchedInvoiceId?: string; // For payments linked to an invoice
  matchedInvoiceNumber?: string;
  replacedRowIndex?: number; // Row index in "Рахунки" that this invoice replaced
  replacedPreviousInvoice?: {
    invoiceNumber?: string;
    amount?: number;
    supplier?: string;
    date?: string;
  };
  isReplaced?: boolean; // True if this document was superseded/replaced by a newer invoice
  replacedByDocId?: string;
  replacedByInvoiceNumber?: string;
}

export interface GoogleDriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  thumbnailLink?: string;
  webContentLink?: string;
  webViewLink?: string;
  createdTime?: string;
  modifiedTime?: string;
  parents?: string[];
  appProperties?: Record<string, string>;
  properties?: Record<string, string>;
}

export interface GoogleDriveFolder {
  id: string;
  name: string;
  webViewLink?: string;
}

export interface SheetCompanyLists {
  ourCompanies: string[];
  suppliers: string[];
}

export interface SheetConfig {
  spreadsheetId: string;
  spreadsheetTitle: string;
  spreadsheetUrl: string;
  invoicesSheetName: string; // "Рахунки"
  paymentsSheetName: string; // "Платіжки"
  ourCompaniesSheetName: string; // "Наші компанії"
  suppliersSheetName: string; // "Постачальники"
  overheadSheetName?: string; // "Цех" (загальновиробничі накладні витрати)
  availableSheets?: string[];
  isConfigured: boolean;
}

export interface ExistingSheetRow {
  rowIndex: number;
  orderNumber: string;
  supplier: string;
  buyer: string;
  invoiceNumber: string;
  invoiceDate: string;
  amount: number;
  currency: string;
  paymentStatus: InvoicePaymentStatus; // "Не оплачено" | "Оплачено" | "Оплачено частково"
  approvalStatus?: InvoiceApprovalStatus; // "ПОГОДЖЕНО" | "НЕ ПОГОДЖЕНО" | "ВІДХИЛЕНО"
  approvedBy?: string;
  approvedAt?: string;
  rejectionReason?: string;
  uploadedAt: string;
  paidAmount?: number; // Column J: Сума оплати
  paymentDate?: string;
  paymentNumber?: string;
  fileName?: string;
  driveLink?: string;
  notes?: string;
  expenseCategory?: ExpenseCategory;
  isOverhead?: boolean;
}

export interface OverheadExpenseRow {
  rowIndex?: number;
  supplier: string; // A: Постачальник
  buyer?: string; // B: Платник
  invoiceNumber?: string; // C: Номер рахунку
  date: string; // D: Дата рахунку (YYYY-MM-DD або DD.MM.YYYY)
  amount: number; // E: Сума
  currency?: string; // F: Валюта
  paymentStatus?: InvoicePaymentStatus; // G: Статус оплачено чи ні
  uploadedAt?: string; // H: Час завантаження
  paidAmount?: number; // I: Сума оплати
  description?: string; // Опис / Призначення
  month?: string; // Місяць (наприклад: "Вересень 2026")
  fileName?: string;
  driveLink?: string;
  id?: string;
  isPendingSync?: boolean;
}

export interface ExistingPaymentRow {
  rowIndex: number;
  paymentNumber: string;
  paymentDate: string;
  payer: string;
  payee: string;
  amountPaid: number;
  currency: string;
  paymentPurpose: string;
  referencedInvoiceNumber: string;
  orderNumber: string;
  fileName: string;
  driveLink: string;
  uploadedAt: string;
}

export interface DuplicateRowMatch {
  rowIndex: number; // Row index of the duplicate row to be deleted
  originalRowIndex: number; // Row index of the original kept row
  tabName: string; // 'Рахунки' or 'Платіжки'
  type: 'invoice' | 'payment';
  identifier: string; // Description e.g. "Рахунок №105 від ТОВ ЛІНА ТД"
  amount: number;
  reason: string;
  date?: string;
  orderNumber?: string;
  suggestedAction?: 'delete' | 'merge_fix_number';
  suggestedCorrectInvoiceNumber?: string;
}

export interface ProjectSheetRow {
  rowNumber: number; // 1-based row number in Google Sheet (111, 112, ...)
  colA: string; // Колонка A (наприклад, Номер замовлення / код проекту)
  colB: string; // Колонка B (Клієнт / Замовник)
  colC: string; // Колонка C (Назва проекту / об'єкту)
  colD: string; // Колонка D
  colE: string; // Колонка E
  colF: string; // Колонка F
  colG: string; // Колонка G (Рахунок)
  colH: string; // Колонка H (Дата рахунку)
  colI: string; // Колонка I (Курс валют)
  colM: string; // Колонка M (Сума проекту / Договору)
  colN: string; // Колонка N
  colO: string; // Колонка O
  colP: string; // Колонка P
  colQ: string; // Колонка Q (компонент зарплати / собівартості)
  colR: string; // Колонка R (компонент зарплати / собівартості)
  colS: string; // Колонка S (компонент зарплати / собівартості)
  colT: string; // Колонка T (компонент зарплати / собівартості)
  sumQRST: number; // Сума колонок Q + R + S + T (Заробітня плата / собівартість)
  colU: string; // Колонка U
  colV: string; // Колонка V (Загальні витрати)
  colW: string; // Колонка W
  colX: string; // Колонка X
  colY: string; // Колонка Y
  // Payment schedule (План надходжень - 4 транші)
  colZ?: string; // Оплата 1 - Сума
  colAA?: string; // Оплата 1 - Вибір тижня
  colAB?: string; // Оплата 2 - Сума
  colAC?: string; // Оплата 2 - Вибір тижня
  colAD?: string; // Оплата 3 - Сума
  colAE?: string; // Оплата 3 - Вибір тижня
  colAF?: string; // Оплата 4 - Сума
  colAG?: string; // Оплата 4 - Вибір тижня
  tabName?: string; // Origin tab name (e.g. 'Лист1' or 'План')
  spreadsheetId?: string; // Origin spreadsheet ID
  rawValues?: Record<string, string>;
  currencyRate?: number; // Курс валют (кол. I)
  isCurrencyConverted?: boolean; // Чи відрізняється курс від 1
  rawInvoiceSum?: number; // Початкова сума рахунку (кол. H)
  rawProjectSum?: number; // Початкова сума проекту (кол. M)
  convertedProjectSum?: number; // Сума проекту помножена на курс валют (кол. M * кол. I)
  effectiveProjectSum?: number; // Ефективна сума проекту/замовлення в грн (кол. M * кол. I)
}

export interface ProjectColumnHeader {
  key: string;
  letter: string;
  title: string;
}

// ==================== CASH FLOW / ПЛАНУВАННЯ НАДХОДЖЕНЬ ТА ВИТРАТ ====================

export type CashFlowCompany =
  | 'Шоп Інтеріор'
  | 'Гала Продакшн'
  | 'Інокс Україна'
  | 'Преміум Шоп'
  | 'Ільїнський Костянтин Владиславович'
  | 'Інші';

/**
 * Окремий транш надходження за проєктом
 */
export interface CashFlowInflowItem {
  projectRowNumber: number;
  projectCode: string; // colA (наприклад, "216-26")
  client: string; // colB (Замовник)
  projectName: string; // colC (Назва проекту / об'єкту)
  colG: string; // Рахунок / код компанії (наприклад "ШІ-142", "ГП-089")
  company: string; // Нормалізована назва нашої компанії: 'Шоп Інтеріор', 'Гала Продакшн' тощо
  trancheNumber: 1 | 2 | 3 | 4;
  amount: number;
  rawAmount: string;
  rawWeek: string;
  weekKey: string; // Ідентифікатор тижня, наприклад "2026-W40"
  weekNumber: number;
  year: number;
  weekLabel: string;
}

/**
 * Окремий неоплачений рахунок постачальника
 */
export interface CashFlowOutflowItem {
  invoiceRowIndex: number;
  invoiceNumber: string;
  supplier: string;
  buyer: string; // Оригінальна назва платника/нашої компанії
  company: string; // Нормалізована назва нашої компанії: 'Шоп Інтеріор', 'Гала Продакшн' тощо
  orderNumber?: string;
  amount: number; // Неоплачена сума до сплати
  totalInvoiceAmount: number; // Повна сума рахунку
  paidAmount?: number; // Вже сплачена частина
  approvalStatus?: InvoiceApprovalStatus; // "ПОГОДЖЕНО" | "НЕ ПОГОДЖЕНО" | "ВІДХИЛЕНО"
  uploadedAt: string; // Дата завантаження рахунку
  invoiceDate?: string; // Дата рахунку
  plannedPaymentDate: string; // Планова дата оплати: YYYY-MM-DD (дата завантаження + 5 днів)
  weekKey: string; // Ідентифікатор тижня, наприклад "2026-W40"
  weekNumber: number;
  year: number;
  weekLabel: string;
}

/**
 * Зведені показники по окремій компанії (ТОВ/ФОП) за тиждень
 */
export interface CompanyWeeklyCashFlow {
  company: string;
  inflow: number; // Вхід (Надходження)
  outflow: number; // Вихід (Витрати)
  balance: number; // Тижневий баланс: Вхід - Вихід
  inflowItems: CashFlowInflowItem[];
  outflowItems: CashFlowOutflowItem[];
}

/**
 * Зведені показники за конкретний календарний тиждень
 */
export interface WeeklyCashFlow {
  weekKey: string; // e.g. "2026-W40"
  weekNumber: number; // 40
  year: number; // 2026
  weekLabel: string; // "Т40 (28.09 – 04.10.2026)"
  shortLabel: string; // "Т40"
  startDate: string; // "28.09.2026"
  endDate: string; // "04.10.2026"
  isCurrentWeek: boolean;
  totalInflow: number; // Загальний вхід по всіх компаніях за тиждень
  totalOutflow: number; // Загальний вихід по всіх компаніях за тиждень
  netBalance: number; // Підсумковий тижневий баланс: Вхід - Вихід
  byCompany: Record<string, CompanyWeeklyCashFlow>; // Розбивка за ТОВ/ФОП
}

/**
 * Загальний підсумок Календаря платежів (Cash Flow)
 */
export interface CashFlowSummary {
  weeks: WeeklyCashFlow[];
  grandTotalInflow: number; // Загальний Вхід
  grandTotalOutflow: number; // Загальний Вихід
  grandTotalBalance: number; // Підсумковий Баланс (Вхід - Вихід)
  companyTotals: Record<
    string,
    {
      company: string;
      inflow: number;
      outflow: number;
      balance: number;
      inflowCount: number;
      outflowCount: number;
    }
  >;
  unmatchedInflowsCount: number;
  unmatchedOutflowsCount: number;
}

