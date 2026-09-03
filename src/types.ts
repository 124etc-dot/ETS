export type DocumentType = 'invoice' | 'payment' | 'other';
export type InvoicePaymentStatus = 'Оплачено' | 'Не оплачено' | 'Оплачено частково';

export interface ExtractedLineItem {
  name: string;
  quantity?: number;
  unitPrice?: number;
  total?: number;
}

export interface OCRResult {
  documentType: DocumentType;
  documentTypeUkrainian: string; // "Рахунок на оплату" | "Платіжна інструкція"
  
  // Critical Handwritten Order Number (format: xxx-xx without №)
  handwrittenOrderNumber: string; // e.g. "123-26" or empty if none
  handwrittenRawText?: string; // Exact text as written
  handwrittenLocation?: string; // "Top right", "Bottom corner", "Near total amount", etc.
  handwrittenConfidence: 'high' | 'medium' | 'low' | 'none';
  
  // Status: "Оплачено" | "Не оплачено" | "Оплачено частково"
  paymentStatus?: InvoicePaymentStatus;

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
  }>;
  matchedPaymentNumber?: string;
  matchedPaymentAmount?: number;
  matchedPaymentRowIndex?: number;
  matchedPaymentsSummary?: string;
  paidAmount?: number; // Paid amount for invoices (Column J)

  // Additional
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
  errorMessage?: string;
  ocrResult?: OCRResult;
  editedData?: OCRResult;
  syncedRowIndex?: number;
  syncedAt?: string;
  createdAt?: number; // Timestamp in ms for sorting newest first
  alreadyInSheet?: boolean;
  alreadyInSheetReason?: string;
  alreadyInSheetTab?: string;
  matchedInvoiceId?: string; // For payments linked to an invoice
  matchedInvoiceNumber?: string;
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
  uploadedAt: string;
  paidAmount?: number; // Column J: Сума оплати
  paymentDate?: string;
  paymentNumber?: string;
  fileName?: string;
  driveLink?: string;
  notes?: string;
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
