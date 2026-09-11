import React, { useState, useEffect, useRef } from 'react';
import { 
  FileText, 
  Sparkles, 
  FileSpreadsheet, 
  Folder, 
  Building2, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw, 
  Layers, 
  PenTool, 
  ArrowRight,
  ShieldCheck,
  Clock,
  LogIn
} from 'lucide-react';
import { 
  ProcessedDocument, 
  SheetConfig, 
  SheetCompanyLists, 
  ExistingSheetRow, 
  ExistingPaymentRow,
  OCRResult,
  InvoicePaymentStatus,
  DuplicateRowMatch
} from './types';
import { googleAuth, AuthState } from './services/googleAuth';
import { GoogleDriveService } from './services/googleDrive';
import { GoogleSheetsService } from './services/googleSheets';
import { OCRService } from './services/ocrService';
import { normalizeFileName, deduplicateDocuments } from './utils/deduplication';
import { Header } from './components/Header';
import { DriveFolderBar } from './components/DriveFolderBar';
import { SpreadsheetBar } from './components/SpreadsheetBar';
import { UploadZone } from './components/UploadZone';
import { BatchProcessingTable } from './components/BatchProcessingTable';
import { DocumentReviewModal } from './components/DocumentReviewModal';
import { SheetLivePreview } from './components/SheetLivePreview';
import { CompaniesTab } from './components/CompaniesTab';
import { GoogleConnectModal } from './components/GoogleConnectModal';
import { APP_VERSION } from './version';
import { 
  DEFAULT_OUR_COMPANIES, 
  DEFAULT_SUPPLIERS, 
  DEFAULT_DRIVE_FOLDER_ID,
  DEFAULT_DRIVE_FOLDER_URL,
  KNOWN_PROJECT_ORDERS
} from './data/sampleDocuments';

const FOLDER_STORAGE_KEY = 'invoice_ocr_drive_folder_id';
const SHEET_STORAGE_KEY = 'invoice_ocr_sheet_config';
const DOCUMENTS_STORAGE_KEY = 'invoice_ocr_documents_cache_v2';
const AUTO_OCR_STORAGE_KEY = 'invoice_ocr_auto_ocr_v1';
const AUTO_SYNC_INTERVAL_KEY = 'invoice_ocr_auto_sync_interval_v1';
const DISMISSED_DRIVE_IDS_KEY = 'invoice_ocr_dismissed_drive_file_ids_v1';
const COMPANIES_STORAGE_KEY = 'invoice_sheet_companies_cache_v1';
const INVOICES_STORAGE_KEY = 'invoice_sheet_invoices_cache_v1';
const PAYMENTS_STORAGE_KEY = 'invoice_sheet_payments_cache_v1';

const getDismissedDriveIds = (): Set<string> => {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(DISMISSED_DRIVE_IDS_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch {}
  return new Set();
};

const saveDismissedDriveIds = (ids: Set<string>) => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(DISMISSED_DRIVE_IDS_KEY, JSON.stringify(Array.from(ids)));
  } catch {}
};

export default function App() {
  const [authState, setAuthState] = useState<AuthState>(googleAuth.getAuthState());
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'process' | 'sheet' | 'companies' | 'history'>('process');

  // Google Drive & Sheets state with local persistence
  const [driveFolderId, setDriveFolderId] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(FOLDER_STORAGE_KEY) || DEFAULT_DRIVE_FOLDER_ID;
    }
    return DEFAULT_DRIVE_FOLDER_ID;
  });

  const [sheetConfig, setSheetConfig] = useState<SheetConfig | null>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(SHEET_STORAGE_KEY);
      if (stored) {
        try {
          return JSON.parse(stored);
        } catch {
          // ignore
        }
      }
    }
    return null;
  });

  const handleUpdateFolder = (folderId: string) => {
    setDriveFolderId(folderId);
    if (typeof window !== 'undefined') {
      localStorage.setItem(FOLDER_STORAGE_KEY, folderId);
    }
  };

  const handleUpdateSheetConfig = (config: SheetConfig) => {
    setSheetConfig(config);
    if (typeof window !== 'undefined') {
      localStorage.setItem(SHEET_STORAGE_KEY, JSON.stringify(config));
    }
  };

  const [companyLists, setCompanyLists] = useState<SheetCompanyLists>(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(COMPANIES_STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed?.ourCompanies?.length || parsed?.suppliers?.length) return parsed;
        }
      } catch {}
    }
    return {
      ourCompanies: DEFAULT_OUR_COMPANIES,
      suppliers: DEFAULT_SUPPLIERS,
    };
  });

  const [existingInvoices, setExistingInvoices] = useState<ExistingSheetRow[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(INVOICES_STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
      } catch {}
    }
    return [];
  });
  const existingInvoicesRef = useRef(existingInvoices);
  useEffect(() => {
    existingInvoicesRef.current = existingInvoices;
  }, [existingInvoices]);

  const [existingPayments, setExistingPayments] = useState<any[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(PAYMENTS_STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
      } catch {}
    }
    return [];
  });
  const existingPaymentsRef = useRef(existingPayments);
  useEffect(() => {
    existingPaymentsRef.current = existingPayments;
  }, [existingPayments]);

  // Auto-OCR and Auto-Sync periodic settings
  const [autoOcrEnabled, setAutoOcrEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(AUTO_OCR_STORAGE_KEY);
      if (stored !== null) return stored === 'true';
    }
    return true; // Default ON
  });

  const [autoSyncIntervalMinutes, setAutoSyncIntervalMinutes] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(AUTO_SYNC_INTERVAL_KEY);
      if (stored !== null) return parseInt(stored, 10);
    }
    return 60; // Default 1 hour
  });

  const [lastAutoSyncTime, setLastAutoSyncTime] = useState<Date | null>(null);
  const [nextAutoSyncSeconds, setNextAutoSyncSeconds] = useState<number>(() => autoSyncIntervalMinutes * 60);
  const [isAutoSyncing, setIsAutoSyncing] = useState<boolean>(false);

  const handleToggleAutoOcr = (enabled: boolean) => {
    setAutoOcrEnabled(enabled);
    if (typeof window !== 'undefined') {
      localStorage.setItem(AUTO_OCR_STORAGE_KEY, String(enabled));
    }
    notify(
      enabled 
        ? 'Авто-розпізнавання AI увімкнено: нові файли будуть оброблятись автоматично.' 
        : 'Авто-розпізнавання AI вимкнено.',
      'info'
    );
  };

  const handleChangeAutoSyncInterval = (minutes: number) => {
    setAutoSyncIntervalMinutes(minutes);
    setNextAutoSyncSeconds(minutes * 60);
    if (typeof window !== 'undefined') {
      localStorage.setItem(AUTO_SYNC_INTERVAL_KEY, String(minutes));
    }
    notify(
      minutes > 0
        ? `Автоматичне зчитування папки налаштовано: кожні ${minutes >= 60 ? `${minutes / 60} год` : `${minutes} хв`}.`
        : 'Автоматичне фонове зчитування папки вимкнено.',
      'info'
    );
  };

  // Helper to ensure payment instructions are never misclassified as invoices
  const autoCorrectPaymentClassification = (data: OCRResult | undefined, fileName: string): OCRResult | undefined => {
    if (!data) return data;
    const lowerFileName = (fileName || '').toLowerCase();
    const lowerDocTitle = (data.documentTitle || '').toLowerCase();
    const lowerDocTypeUkr = (data.documentTypeUkrainian || '').toLowerCase();
    const lowerBankStamp = (data.bankExecutionStamp || '').toLowerCase();
    const lowerNotes = (data.notes || '').toLowerCase();
    const lowerPurpose = (data.paymentPurpose || '').toLowerCase();
    const lowerRawText = (data.handwrittenRawText || '').toLowerCase();

    const isBankPayment = (
      data.documentType === 'payment' ||
      lowerDocTitle.includes('платіж') ||
      lowerDocTitle.includes('інструкц') ||
      lowerDocTitle.includes('доручен') ||
      lowerDocTitle.includes('квитанц') ||
      lowerDocTitle.includes('виписк') ||
      lowerDocTitle.includes('ордер') ||
      lowerDocTitle.includes('чек') ||
      lowerDocTypeUkr.includes('платіж') ||
      lowerDocTypeUkr.includes('інструкц') ||
      lowerDocTypeUkr.includes('доручен') ||
      lowerDocTypeUkr.includes('квитанц') ||
      lowerDocTypeUkr.includes('виписк') ||
      lowerDocTypeUkr.includes('ордер') ||
      lowerDocTypeUkr.includes('чек') ||
      lowerFileName.includes('платіж') ||
      lowerFileName.includes('платеж') ||
      lowerFileName.includes('доручен') ||
      lowerFileName.includes('інструкц') ||
      lowerFileName.includes('квитанц') ||
      lowerBankStamp.includes('банк') ||
      lowerBankStamp.includes('виконан') ||
      lowerBankStamp.includes('прийнято') ||
      lowerBankStamp.includes('ibank') ||
      lowerBankStamp.includes('проведено') ||
      lowerBankStamp.includes('еп') ||
      lowerBankStamp.includes('uetr') ||
      lowerNotes.includes('платіжна інструкція') ||
      lowerNotes.includes('платіжне доручення') ||
      lowerNotes.includes('ibank2ua') ||
      lowerNotes.includes('uetr') ||
      lowerNotes.includes('надавач платіжних послуг') ||
      lowerNotes.includes('дата виконання банк') ||
      lowerRawText.includes('платіжна інструкція') ||
      lowerRawText.includes('ibank2ua') ||
      (Boolean(data.paymentPurpose) && (
        lowerPurpose.includes('згідно рах') ||
        lowerPurpose.includes('оплата за товар') ||
        lowerPurpose.includes('оплата згідно') ||
        lowerPurpose.includes('перерахування')
      ))
    );

    if (isBankPayment) {
      const updated = { ...data };
      updated.documentType = 'payment';
      if (!updated.documentTypeUkrainian || updated.documentTypeUkrainian.toLowerCase().includes('рахунок')) {
        updated.documentTypeUkrainian = 'Платіжна інструкція';
      }
      updated.paymentStatus = 'Оплачено';

      // Extract payment number from notes/text/file name (e.g. N 1216, N 1215)
      if (!updated.paymentNumber) {
        const pNumMatch = `${updated.notes || ''} ${updated.handwrittenRawText || ''} ${fileName || ''}`.match(/(?:платіжна інструкція|доручення|від)?\s*(?:N|№)\s*(\d{1,10})/i);
        if (pNumMatch && pNumMatch[1]) {
          updated.paymentNumber = pNumMatch[1].trim();
        } else if (updated.invoiceNumber) {
          updated.paymentNumber = updated.invoiceNumber;
        }
      }

      // Extract referenced invoice from paymentPurpose or notes (e.g. "згідно рах. № 4104" or "згідно рахунку № 4373")
      const fullText = `${updated.paymentPurpose || ''} ${updated.notes || ''}`;
      const invMatch = fullText.match(/(?:згідно|по|за|рахун(?:ок|ку|ка)?|рах\.?)\s*(?:№|N)?\s*([A-Za-zА-Яа-я0-9\-_/]+)/i);
      if (invMatch && invMatch[1]) {
        const foundInv = invMatch[1].trim();
        updated.referencedInvoiceNumber = foundInv;
        updated.referencedInvoiceNumbers = [foundInv];
        updated.invoiceNumber = foundInv;
      }

      // Amounts
      if (updated.amountPaid > 0 && updated.totalAmount <= 0) {
        updated.totalAmount = updated.amountPaid;
      } else if (updated.totalAmount > 0 && updated.amountPaid <= 0) {
        updated.amountPaid = updated.totalAmount;
      }

      // Dates
      if (updated.paymentDate && !updated.invoiceDate) {
        updated.invoiceDate = updated.paymentDate;
      } else if (updated.invoiceDate && !updated.paymentDate) {
        updated.paymentDate = updated.invoiceDate;
      }

      // Payer / Payee alignment
      if (!updated.payerName && updated.buyerName) updated.payerName = updated.buyerName;
      if (!updated.payeeName && updated.supplierName) updated.payeeName = updated.supplierName;
      if (!updated.buyerName && updated.payerName) updated.buyerName = updated.payerName;
      if (!updated.supplierName && updated.payeeName) updated.supplierName = updated.payeeName;

      return updated;
    }

    return data;
  };

  // Documents in queue with localStorage persistence
  const [documents, setDocuments] = useState<ProcessedDocument[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        // Also remove older cache key if present
        localStorage.removeItem('invoice_ocr_documents_cache');
        
        const stored = localStorage.getItem(DOCUMENTS_STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed) && parsed.length > 0) {
            // Permanently filter out any sample/demo invoices and reset stuck 'processing' status
            const realDocs = parsed
              .filter((d: ProcessedDocument) => !d.id?.startsWith('sample_'))
              .map((d: ProcessedDocument) => {
                const fixedOcr = autoCorrectPaymentClassification(d.ocrResult, d.fileName);
                const fixedEdited = autoCorrectPaymentClassification(d.editedData, d.fileName);
                return {
                  ...d,
                  status: d.status === 'processing' ? ('pending' as const) : d.status,
                  ocrResult: fixedOcr,
                  editedData: fixedEdited,
                  errorMessage: d.status === 'processing' ? undefined : d.errorMessage,
                };
              });
            const dedupedDocs = deduplicateDocuments(realDocs).uniqueDocs;
            localStorage.setItem(DOCUMENTS_STORAGE_KEY, JSON.stringify(dedupedDocs));
            return dedupedDocs;
          }
        }
      } catch {
        // ignore
      }
    }
    return [];
  });

  // Keep a ref to documents for background async loops
  const documentsRef = useRef<ProcessedDocument[]>(documents);
  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);

  // Dynamically collect real project orders from active Google Sheet invoices and loaded documents
  const dynamicKnownOrders = React.useMemo(() => {
    const ordersMap = new Map<string, string>();
    
    // Add from existing sheet rows
    if (Array.isArray(existingInvoices)) {
      existingInvoices.forEach((inv) => {
        const ord = OCRService.normalizeOrderNumber(inv.orderNumber || '');
        if (ord && /^\d{1,6}-\d{2}$/.test(ord)) {
          if (!ordersMap.has(ord)) {
            ordersMap.set(ord, inv.supplier || '');
          }
        }
      });
    }

    // Add from loaded documents
    if (Array.isArray(documents)) {
      documents.forEach((doc) => {
        const ord = OCRService.normalizeOrderNumber(doc.ocrData?.handwrittenOrderNumber || '');
        if (ord && /^\d{1,6}-\d{2}$/.test(ord)) {
          if (!ordersMap.has(ord)) {
            ordersMap.set(ord, doc.ocrData?.supplierName || '');
          }
        }
      });
    }

    // Only fallback to sample orders if no real orders exist in sheet or documents
    if (ordersMap.size === 0) {
      KNOWN_PROJECT_ORDERS.forEach((o) => {
        ordersMap.set(o.code, o.title);
      });
    }

    return Array.from(ordersMap.entries()).map(([code, title]) => ({ code, title }));
  }, [existingInvoices, documents]);

  // Save documents to localStorage whenever they change
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const lightweightDocs = documents.map((d) => ({
          ...d,
          // Never persist transient 'processing' status to avoid hangs across sessions
          status: d.status === 'processing' ? ('pending' as const) : d.status,
          previewDataUrl: d.previewDataUrl && d.previewDataUrl.length > 200000 ? undefined : d.previewDataUrl,
        }));
        localStorage.setItem(DOCUMENTS_STORAGE_KEY, JSON.stringify(lightweightDocs));
      } catch {
        // ignore storage quota limit
      }
    }
  }, [documents]);

  const [selectedReviewDoc, setSelectedReviewDoc] = useState<ProcessedDocument | null>(null);

  // Loading flags
  const [isLoadingFolder, setIsLoadingFolder] = useState(false);
  const [isLoadingSheet, setIsLoadingSheet] = useState(false);
  const [isProcessingBatch, setIsProcessingBatch] = useState(false);
  const [isSyncingBatch, setIsSyncingBatch] = useState(false);
  const [isRefreshingSession, setIsRefreshingSession] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  // Subscribe to auth state
  useEffect(() => {
    const unsub = googleAuth.subscribe((state) => {
      setAuthState(state);
    });
    return unsub;
  }, []);

  // Quick 1-click session renewal without losing any context
  const handleQuickRefreshSession = async () => {
    setIsRefreshingSession(true);
    try {
      await googleAuth.refreshSession();
      notify('Сесію Google успішно поновлено! Дані оновлено.', 'success');
      if (sheetConfig?.spreadsheetId) {
        refreshSheetData();
      }
      if (driveFolderId) {
        handleFetchDriveFiles(driveFolderId);
      }
    } catch (err: any) {
      console.error('Failed to refresh session:', err);
      notify(err.message || 'Не вдалося поновити сесію. Спробуйте ще раз.', 'error');
    } finally {
      setIsRefreshingSession(false);
    }
  };

  // Auto-refresh sheet data when auth token is acquired or sheetConfig changes
  useEffect(() => {
    if (authState.accessToken && sheetConfig?.spreadsheetId) {
      refreshSheetData();
    }
    // Auto-fetch Drive folder files if folder is configured and documents list is empty
    if (authState.accessToken && driveFolderId && documentsRef.current.length === 0) {
      handleFetchDriveFiles(driveFolderId);
    }
    // Auto-upload any local documents that haven't been saved to Google Drive yet
    if (authState.accessToken) {
      const pendingUploads = documentsRef.current.filter(
        (d) => !d.driveFileId && d.source !== 'drive' && (d.driveUploadStatus === 'idle' || d.driveUploadStatus === 'failed' || !d.driveUploadStatus)
      );
      if (pendingUploads.length > 0) {
        pendingUploads.forEach((d) => {
          handleUploadDocToDrive(d.id, d);
        });
      }
    }
  }, [authState.accessToken, sheetConfig?.spreadsheetId, driveFolderId]);

  // Show notification helper
  const notify = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setNotification({ message, type });
    setTimeout(() => {
      setNotification(null);
    }, 5000);
  };

  // Load companies & existing rows from Google Sheet
  const refreshSheetData = async (customConfig?: SheetConfig) => {
    const activeCfg = customConfig || sheetConfig;
    if (!activeCfg?.spreadsheetId || !authState.accessToken) return;
    setIsLoadingSheet(true);
    try {
      // 1. Ensure available tabs are discovered
      let availableTabs = activeCfg.availableSheets;
      if (!availableTabs || availableTabs.length === 0) {
        try {
          const details = await GoogleSheetsService.getSpreadsheetDetails(
            activeCfg.spreadsheetId,
            authState.accessToken
          );
          availableTabs = details.sheets;
        } catch {
          // ignore
        }
      }

      const lists = await GoogleSheetsService.loadCompanyLists(
        activeCfg.spreadsheetId,
        authState.accessToken,
        activeCfg.ourCompaniesSheetName,
        activeCfg.suppliersSheetName
      );
      if (lists.ourCompanies.length > 0 || lists.suppliers.length > 0) {
        const dedupedLists = {
          ourCompanies: GoogleSheetsService.deduplicateCompanyList(
            lists.ourCompanies.length > 0 ? lists.ourCompanies : DEFAULT_OUR_COMPANIES
          ),
          suppliers: GoogleSheetsService.deduplicateCompanyList(
            lists.suppliers.length > 0 ? lists.suppliers : DEFAULT_SUPPLIERS
          ),
        };
        setCompanyLists(dedupedLists);
        try {
          localStorage.setItem(COMPANIES_STORAGE_KEY, JSON.stringify(dedupedLists));
        } catch {}
      }

      const rows = await GoogleSheetsService.loadExistingInvoices(
        activeCfg.spreadsheetId,
        authState.accessToken,
        activeCfg.invoicesSheetName,
        availableTabs
      );
      if (rows && rows.length > 0) {
        setExistingInvoices(rows);
        try {
          localStorage.setItem(INVOICES_STORAGE_KEY, JSON.stringify(rows));
        } catch {}
      }

      const { payments, resolvedTabName } = await GoogleSheetsService.loadExistingPayments(
        activeCfg.spreadsheetId,
        authState.accessToken,
        activeCfg.paymentsSheetName,
        availableTabs
      );
      if (payments && payments.length > 0) {
        setExistingPayments(payments);
        try {
          localStorage.setItem(PAYMENTS_STORAGE_KEY, JSON.stringify(payments));
        } catch {}
      }

      // Auto-sync tab names or availableSheets back to sheetConfig if discovered
      if (
        (resolvedTabName && resolvedTabName !== activeCfg.paymentsSheetName) ||
        (availableTabs && (!activeCfg.availableSheets || activeCfg.availableSheets.length !== availableTabs.length))
      ) {
        const updatedConfig: SheetConfig = {
          ...activeCfg,
          paymentsSheetName: resolvedTabName || activeCfg.paymentsSheetName,
          availableSheets: availableTabs || activeCfg.availableSheets,
        };
        handleUpdateSheetConfig(updatedConfig);
      }

      // Automatically re-evaluate whether any documents in the list already exist in the sheet
      setDocuments((prevDocs) => {
        // If sheet data failed to load or is completely empty, do NOT modify documents state
        if ((!rows || rows.length === 0) && (!payments || payments.length === 0)) {
          return prevDocs;
        }

        const remainingDocs: ProcessedDocument[] = [];

        for (const d of prevDocs) {
          const ocr = d.editedData || d.ocrResult;
          if (!ocr) {
            remainingDocs.push(d);
            continue;
          }

          // For payments: if handwrittenOrderNumber is missing, inherit it from matching invoices
          let effectiveOcr = ocr;
          if (ocr.documentType === 'payment' && !ocr.handwrittenOrderNumber) {
            const pMatch = OCRService.matchPaymentWithInvoices(ocr, rows, prevDocs);
            if (pMatch.matchedOrderNumber) {
              effectiveOcr = {
                ...ocr,
                handwrittenOrderNumber: pMatch.matchedOrderNumber,
                referencedOrderNumber: pMatch.matchedOrderNumber,
                handwrittenConfidence: 'high',
                matchedInvoiceNumber: pMatch.matchedInvoiceNumber || ocr.matchedInvoiceNumber,
              };
            }
          }

          const check = OCRService.checkExistingDocumentInSheet(effectiveOcr, rows, payments);

          if (check.alreadyInSheet) {
            remainingDocs.push({
              ...d,
              ocrResult: effectiveOcr,
              editedData: effectiveOcr,
              syncedRowIndex: check.rowIndex,
              alreadyInSheet: true,
              alreadyInSheetReason: check.reason,
              alreadyInSheetTab: check.tabName,
              status: d.syncedAt ? 'synced' : d.status === 'synced' && !d.syncedAt ? 'ready_for_review' : d.status,
            });
          } else {
            // Document is NOT currently in the Google Sheet:
            // KEEP the document! Never drop documents from queue behind the user's back.
            remainingDocs.push({
              ...d,
              ocrResult: effectiveOcr,
              editedData: effectiveOcr,
              syncedRowIndex: undefined,
              alreadyInSheet: false,
              alreadyInSheetReason: undefined,
              alreadyInSheetTab: undefined,
              status: d.status === 'synced' ? 'ready_for_review' : d.status,
            });
          }
        }

        return remainingDocs;
      });
    } catch (err: any) {
      console.warn('Could not refresh sheet data:', err);
    } finally {
      setIsLoadingSheet(false);
    }
  };

  const handleChangePaymentsTab = async (newTab: string) => {
    if (!sheetConfig) return;
    const updated = { ...sheetConfig, paymentsSheetName: newTab };
    handleUpdateSheetConfig(updated);
    await refreshSheetData(updated);
  };

  const handleChangeInvoicesTab = async (newTab: string) => {
    if (!sheetConfig) return;
    const updated = { ...sheetConfig, invoicesSheetName: newTab };
    handleUpdateSheetConfig(updated);
    await refreshSheetData(updated);
  };

  // Process a single document with Gemini OCR
  const handleProcessDocument = async (docId: string, directDoc?: ProcessedDocument): Promise<void> => {
    const currentList = documentsRef.current;
    const doc = directDoc || currentList.find((d) => d.id === docId);
    if (!doc) return;

    setDocuments((prev) =>
      prev.map((d) => (d.id === docId ? { ...d, status: 'processing', errorMessage: undefined } : d))
    );
    setSelectedReviewDoc((prev) =>
      prev?.id === docId ? { ...prev, status: 'processing', errorMessage: undefined } : prev
    );

    try {
      const executeOcrWorkflow = async () => {
        let base64Payload = doc.previewDataUrl || '';
        let mimeType = doc.mimeType;

        // If previewDataUrl is missing but blob exists, convert blob to base64
        if (!base64Payload && doc.blob) {
          try {
            base64Payload = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(doc.blob!);
            });
          } catch {
            // Ignore fallback error
          }
        }

        // If document is on Drive and doesn't have base64 yet, download it
        if (!base64Payload && doc.driveFileId) {
          if (!authState.accessToken) {
            throw new Error('Для завантаження файлу з Google Drive необхідна авторизація. Натисніть "Авторизуватись".');
          }
          const downloaded = await GoogleDriveService.downloadFileBase64(
            doc.driveFileId,
            authState.accessToken
          );
          base64Payload = downloaded.base64;
          mimeType = downloaded.mimeType;
        }

        if (!base64Payload) {
          throw new Error('Вміст файлу не знайдено. Будь ласка, завантажте файл знову або виберіть з Диска.');
        }

        const ocrResult = await OCRService.analyzeDocument({
          fileData: base64Payload,
          mimeType,
          fileName: doc.fileName,
          ourCompanies: companyLists.ourCompanies,
          suppliers: companyLists.suppliers,
          knownOrders: dynamicKnownOrders,
        });

        return { ocrResult, base64Payload, mimeType };
      };

      // 45-second timeout safeguard so it NEVER hangs indefinitely
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                'Час очікування розпізнавання вичерпано (таймаут 45 с). Перевірте інтернет-з’єднання або натисніть "Перезапустити".'
              )
            ),
          45000
        )
      );

      const { ocrResult, base64Payload, mimeType } = await Promise.race([executeOcrWorkflow(), timeoutPromise]);

      if (ocrResult.documentType === 'payment') {
        const match = OCRService.matchPaymentWithInvoices(
          ocrResult,
          existingInvoicesRef.current,
          documentsRef.current
        );
        ocrResult.matchedInvoiceNumber = match.matchedInvoiceNumber;
        ocrResult.matchedInvoiceAmount = match.invoiceAmount;
        ocrResult.matchedInvoiceRowIndex = match.matchedRowIndex;
        ocrResult.paymentStatus = match.computedStatus;
        if (match.matchedOrderNumber) {
          ocrResult.referencedOrderNumber = match.matchedOrderNumber;
          ocrResult.handwrittenOrderNumber = match.matchedOrderNumber;
          ocrResult.handwrittenConfidence = 'high';
        }
      } else {
        const match = OCRService.matchInvoiceWithPayments(
          ocrResult,
          existingPaymentsRef.current,
          documentsRef.current
        );
        if (match.computedStatus && match.computedStatus !== 'Не оплачено') {
          ocrResult.paymentStatus = match.computedStatus;
          ocrResult.paidAmount = match.totalPaidAmount;
          ocrResult.matchedPaymentNumber = match.matchedPaymentNumbers.join(', ');
          ocrResult.matchedPaymentAmount = match.totalPaidAmount;
          ocrResult.matchedPaymentsSummary = match.matchReason;
        } else {
          ocrResult.paymentStatus = ocrResult.paymentStatus || 'Не оплачено';
        }
      }

      // Check if this document already exists in Google Sheets
      const sheetCheck = OCRService.checkExistingDocumentInSheet(
        ocrResult,
        existingInvoicesRef.current,
        existingPaymentsRef.current
      );

      const updatedDoc: ProcessedDocument = {
        ...doc,
        status: 'ready_for_review',
        syncedRowIndex: sheetCheck.rowIndex,
        alreadyInSheet: sheetCheck.alreadyInSheet,
        alreadyInSheetReason: sheetCheck.reason,
        alreadyInSheetTab: sheetCheck.tabName,
        ocrResult,
        editedData: ocrResult,
        previewDataUrl: base64Payload || doc.previewDataUrl,
        mimeType: mimeType || doc.mimeType,
        errorMessage: undefined,
      };

      setDocuments((prev) => {
        const next = prev.map((d) => (d.id === docId ? updatedDoc : d));
        // If this was an invoice with an order number, propagate it to any matching payments in queue
        if (updatedDoc.ocrResult?.documentType === 'invoice') {
          const invOrder = updatedDoc.ocrResult.handwrittenOrderNumber;
          if (invOrder) {
            return next.map((d) => {
              if (d.id === docId) return d;
              const data = d.editedData || d.ocrResult;
              if (data?.documentType === 'payment' && !data.handwrittenOrderNumber) {
                const pMatch = OCRService.matchPaymentWithInvoices(data, existingInvoicesRef.current, next);
                if (pMatch.matchedOrderNumber) {
                  const updatedData: OCRResult = {
                    ...data,
                    handwrittenOrderNumber: pMatch.matchedOrderNumber,
                    referencedOrderNumber: pMatch.matchedOrderNumber,
                    handwrittenConfidence: 'high',
                    matchedInvoiceNumber: pMatch.matchedInvoiceNumber || data.matchedInvoiceNumber,
                  };
                  return { ...d, ocrResult: updatedData, editedData: updatedData };
                }
              }
              return d;
            });
          }
        }
        return next;
      });
      setSelectedReviewDoc((prev) => (prev?.id === docId ? updatedDoc : prev));

      // Persist OCR result directly into Google Drive appProperties so all devices share cached OCR without re-querying AI
      if (authState.accessToken && updatedDoc.driveFileId) {
        GoogleDriveService.saveOcrToDriveProperties(
          updatedDoc.driveFileId,
          ocrResult,
          authState.accessToken
        ).catch((saveErr) => {
          console.warn(`Could not save OCR properties to Drive for ${updatedDoc.fileName}:`, saveErr);
        });
      }
    } catch (err: any) {
      const errDoc: ProcessedDocument = {
        ...doc,
        status: 'error',
        errorMessage: err.message || 'Помилка OCR розпізнавання.',
      };
      setDocuments((prev) =>
        prev.map((d) => (d.id === docId ? errDoc : d))
      );
      setSelectedReviewDoc((prev) => (prev?.id === docId ? errDoc : prev));
    }
  };

  // Batch process selected documents
  const handleBatchProcess = async (docIds: string[]) => {
    if (docIds.length === 0) return;
    setIsProcessingBatch(true);

    for (const id of docIds) {
      await handleProcessDocument(id);
    }

    setIsProcessingBatch(false);
    notify(`Оброблено ${docIds.length} документів через Gemini AI.`, 'success');
  };

  // Fetch files from Google Drive folder
  const handleFetchDriveFiles = async (folderId: string, isAutoSync = false) => {
    if (!authState.accessToken) {
      if (!isAutoSync) setIsAuthModalOpen(true);
      return;
    }
    
    if (isAutoSync) {
      setIsAutoSyncing(true);
    } else {
      setIsLoadingFolder(true);
    }

    try {
      const files = await GoogleDriveService.listFilesInFolder(folderId, authState.accessToken);
      
      const now = Date.now();
      const newDocs: ProcessedDocument[] = files.map((f, idx) => {
        const rawCachedOcr = GoogleDriveService.extractOcrFromDriveProperties(f.appProperties);
        const cachedOcr = rawCachedOcr ? autoCorrectPaymentClassification(rawCachedOcr, f.name) : undefined;
        return {
          id: `drive_${f.id}`,
          source: 'drive',
          driveFileId: f.id,
          fileName: f.name,
          fileSize: parseInt(f.size || '0', 10),
          mimeType: f.mimeType,
          driveLink: f.webViewLink,
          thumbnailUrl: f.thumbnailLink,
          status: cachedOcr ? ('ready_for_review' as const) : ('pending' as const),
          ocrResult: cachedOcr || undefined,
          editedData: cachedOcr || undefined,
          createdAt: f.createdTime ? new Date(f.createdTime).getTime() : (now + idx),
        };
      });

      // Filter to really new items not yet in documents and not dismissed by the user
      const dismissedIds = getDismissedDriveIds();
      const existingDriveIds = new Set(documentsRef.current.map((d) => d.driveFileId).filter(Boolean));
      const existingNamesMap = new Map<string, ProcessedDocument>();
      for (const d of documentsRef.current) {
        const norm = normalizeFileName(d.fileName);
        if (norm && !existingNamesMap.has(norm)) {
          existingNamesMap.set(norm, d);
        }
      }

      // Match files against existing rows in Google Sheets
      const currentInvoices = existingInvoicesRef.current;
      const currentPayments = existingPaymentsRef.current;

      const findSheetMatchForDriveFile = (f: { id: string; name: string; webViewLink?: string }) => {
        const cleanName = f.name.toLowerCase().trim();
        const pMatch = currentPayments.find(
          (p) =>
            (p.payee || p.payer || p.amountPaid || p.paymentNumber) &&
            ((p.driveLink && f.webViewLink && p.driveLink.includes(f.id)) ||
              (p.fileName && p.fileName.trim().length > 3 && cleanName.length > 3 && p.fileName.toLowerCase().trim() === cleanName))
        );
        if (pMatch) {
          // If pMatch does not have an order number in the sheet, inherit it from matching invoice
          let orderNumber = pMatch.orderNumber || '';
          let matchedInvNum = pMatch.referencedInvoiceNumber || '';
          if (!orderNumber) {
            const tempOcr: OCRResult = {
              documentType: 'payment',
              documentTypeUkrainian: 'Платіжна інструкція',
              paymentNumber: pMatch.paymentNumber || '',
              paymentDate: pMatch.paymentDate || '',
              payerName: pMatch.payer || '',
              buyerName: pMatch.payer || '',
              payeeName: pMatch.payee || '',
              supplierName: pMatch.payee || '',
              invoiceNumber: '',
              invoiceDate: '',
              amountPaid: pMatch.amountPaid || 0,
              totalAmount: pMatch.amountPaid || 0,
              currency: pMatch.currency || 'UAH',
              paymentPurpose: pMatch.paymentPurpose || '',
              referencedInvoiceNumber: pMatch.referencedInvoiceNumber || '',
              referencedInvoiceNumbers: pMatch.referencedInvoiceNumber ? [pMatch.referencedInvoiceNumber] : [],
              handwrittenOrderNumber: '',
              handwrittenConfidence: 'none',
              confidenceScore: 100,
            };
            const match = OCRService.matchPaymentWithInvoices(tempOcr, currentInvoices, documentsRef.current);
            if (match.matchedOrderNumber) {
              orderNumber = match.matchedOrderNumber;
            }
            if (match.matchedInvoiceNumber && !matchedInvNum) {
              matchedInvNum = match.matchedInvoiceNumber;
            }
          }

          const matchedData: OCRResult = {
            documentType: 'payment',
            documentTypeUkrainian: 'Платіжна інструкція',
            invoiceNumber: '',
            invoiceDate: '',
            paymentNumber: pMatch.paymentNumber || '',
            paymentDate: pMatch.paymentDate || '',
            payerName: pMatch.payer || '',
            buyerName: pMatch.payer || '',
            payeeName: pMatch.payee || '',
            supplierName: pMatch.payee || '',
            amountPaid: pMatch.amountPaid || 0,
            totalAmount: pMatch.amountPaid || 0,
            currency: pMatch.currency || 'UAH',
            paymentPurpose: pMatch.paymentPurpose || '',
            referencedInvoiceNumber: pMatch.referencedInvoiceNumber || '',
            referencedInvoiceNumbers: pMatch.referencedInvoiceNumber ? [pMatch.referencedInvoiceNumber] : [],
            handwrittenOrderNumber: orderNumber,
            referencedOrderNumber: orderNumber,
            handwrittenConfidence: orderNumber ? 'high' : 'none',
            matchedInvoiceNumber: matchedInvNum,
            confidenceScore: 100,
            paymentStatus: 'Оплачено',
          };
          return {
            inSheet: true,
            tab: 'Платіжки',
            rowIndex: pMatch.rowIndex,
            matchedData,
          };
        }
        const iMatch = currentInvoices.find((inv) => {
          if (!inv.supplier && !inv.buyer && !inv.amount && !inv.invoiceNumber) return false;
          // 1. Direct drive link or file name match
          if (inv.driveLink && f.webViewLink && inv.driveLink.includes(f.id)) return true;
          if (inv.fileName && inv.fileName.trim().length > 3 && cleanName.length > 3 && inv.fileName.toLowerCase().trim() === cleanName) return true;

          // 2. Invoice number inside file name
          const cleanInv = OCRService.sanitizeInvoiceNumber(inv.invoiceNumber || '');
          if (cleanInv && cleanInv.length >= 2) {
            const cleanFn = OCRService.sanitizeInvoiceNumber(cleanName);
            if (cleanFn.includes(cleanInv)) {
              const cleanOrder = OCRService.normalizeOrderNumber(inv.orderNumber || '');
              if (cleanOrder && cleanName.includes(cleanOrder.toLowerCase())) return true;
              if (inv.supplier && cleanName.includes(inv.supplier.slice(0, 4).toLowerCase())) return true;
              return true;
            }
          }

          return false;
        });
        if (iMatch) {
          const matchedData: OCRResult = {
            documentType: 'invoice',
            documentTypeUkrainian: 'Рахунок на оплату',
            invoiceNumber: iMatch.invoiceNumber || '',
            invoiceDate: iMatch.invoiceDate || '',
            supplierName: iMatch.supplier || '',
            buyerName: iMatch.buyer || '',
            totalAmount: iMatch.amount || 0,
            amountPaid: iMatch.paidAmount || 0,
            currency: iMatch.currency || 'UAH',
            handwrittenOrderNumber: iMatch.orderNumber || '',
            handwrittenConfidence: iMatch.orderNumber ? 'high' : 'none',
            confidenceScore: 100,
            paymentStatus: iMatch.paymentStatus || 'Не оплачено',
          };
          return {
            inSheet: true,
            tab: 'Рахунки',
            rowIndex: iMatch.rowIndex,
            matchedData,
          };
        }
        return { inSheet: false };
      };

      // Collect updates for local/manually-uploaded documents that match Drive files by name
      const docUpdatesToApply: {
        docId: string;
        driveFileId: string;
        driveLink?: string;
        thumbnailUrl?: string;
        cachedOcr?: OCRResult;
      }[] = [];

      const newlyAddedDocs = newDocs
        .filter((nd) => {
          // 1. Skip if already dismissed or trashed by user
          if (nd.driveFileId && dismissedIds.has(nd.driveFileId)) {
            return false;
          }
          // 2. Skip if driveFileId already exists in queue
          if (existingDriveIds.has(nd.driveFileId)) {
            return false;
          }
          // 3. Skip if a document with this normalized file name already exists in queue (e.g. manual upload)
          const normName = normalizeFileName(nd.fileName);
          const existingByName = normName ? existingNamesMap.get(normName) : undefined;
          if (existingByName) {
            // Link Google Drive metadata and cached OCR to the existing document instead of creating a duplicate
            if (!existingByName.driveFileId || existingByName.driveUploadStatus !== 'uploaded' || (!existingByName.ocrResult && nd.ocrResult)) {
              docUpdatesToApply.push({
                docId: existingByName.id,
                driveFileId: nd.driveFileId!,
                driveLink: nd.driveLink,
                thumbnailUrl: nd.thumbnailUrl,
                cachedOcr: !existingByName.ocrResult ? nd.ocrResult : undefined,
              });
            }
            return false;
          }
          return true;
        })
        .map((nd) => {
          const match = findSheetMatchForDriveFile({
            id: nd.driveFileId!,
            name: nd.fileName,
            webViewLink: nd.driveLink,
          });
          if (match.inSheet) {
            const data = match.matchedData;
            const hasGenuineCompany = Boolean(
              (data.supplierName && data.supplierName !== '—') ||
              (data.payeeName && data.payeeName !== '—') ||
              (data.payerName && data.payerName !== '—')
            );
            return {
              ...nd,
              status: hasGenuineCompany ? ('synced' as const) : ('ready_for_review' as const),
              alreadyInSheet: true,
              alreadyInSheetTab: match.tab,
              syncedRowIndex: match.rowIndex,
              alreadyInSheetReason: `Файл знайдено у вкладці "${match.tab}" Google Таблиці (рядок ${match.rowIndex}).`,
              ocrResult: match.matchedData,
              editedData: match.matchedData,
            };
          }
          return nd;
        });

      // Deduplicate new batch items among themselves just in case Drive has duplicate file names
      const dedupedNewlyAdded = deduplicateDocuments(newlyAddedDocs).uniqueDocs;

      // Apply Google Drive metadata and cached OCR updates to matched local documents
      if (docUpdatesToApply.length > 0) {
        const updateMap = new Map(docUpdatesToApply.map((u) => [u.docId, u]));
        setDocuments((prev) =>
          prev.map((d) => {
            const u = updateMap.get(d.id);
            if (u) {
              const effectiveOcr = d.ocrResult || u.cachedOcr;
              return {
                ...d,
                driveFileId: u.driveFileId,
                driveLink: u.driveLink || d.driveLink,
                driveWebViewLink: u.driveLink || d.driveWebViewLink,
                thumbnailUrl: u.thumbnailUrl || d.thumbnailUrl,
                driveUploadStatus: 'uploaded' as const,
                ocrResult: effectiveOcr,
                editedData: d.editedData || effectiveOcr,
                status: d.status === 'pending' && effectiveOcr ? ('ready_for_review' as const) : d.status,
              };
            }
            return d;
          })
        );
      }

      if (dedupedNewlyAdded.length > 0) {
        setDocuments((prev) => deduplicateDocuments([...dedupedNewlyAdded, ...prev]).uniqueDocs);

        // Auto-trigger OCR ONLY for docs that are completely pending (not synced and not cached in Drive)
        const docsToOcr = dedupedNewlyAdded.filter((d) => d.status === 'pending');
        const docsWithCachedOcr = dedupedNewlyAdded.filter((d) => d.status === 'ready_for_review');

        if (autoOcrEnabled && docsToOcr.length > 0) {
          const cacheNote = docsWithCachedOcr.length > 0 ? ` (${docsWithCachedOcr.length} завантажено з кешу Drive)` : '';
          notify(`Знайдено ${docsToOcr.length} нових файлів для AI-розпізнавання${cacheNote}...`, 'info');
          setTimeout(() => {
            handleBatchProcess(docsToOcr.map((d) => d.id));
          }, 300);
        } else if (docsToOcr.length > 0) {
          notify(`Знайдено ${docsToOcr.length} нових файлів у папці Google Drive (очікують розпізнавання).`, 'success');
        } else if (docsWithCachedOcr.length > 0) {
          notify(`Підтягнуто ${docsWithCachedOcr.length} файлів із збереженими результатами розпізнавання (без повторних викликів AI).`, 'success');
        } else {
          if (!isAutoSync) {
            notify(`Зчитано ${dedupedNewlyAdded.length} файлів (усі вже внесені в таблицю або збережені в кеші).`, 'info');
          }
        }
      } else {
        if (!isAutoSync) {
          notify(`У папці ${files.length} файлів. Усі вже додані або вилучені зі списку.`, 'info');
        }
      }

      setLastAutoSyncTime(new Date());
    } catch (err: any) {
      if (!isAutoSync) {
        notify(err.message || 'Помилка завантаження файлів з Google Drive.', 'error');
      }
    } finally {
      setIsLoadingFolder(false);
      setIsAutoSyncing(false);
    }
  };

  // Background Periodic Auto-Sync Timer
  useEffect(() => {
    if (autoSyncIntervalMinutes <= 0 || !authState.accessToken || !driveFolderId) {
      return;
    }

    const timer = setInterval(() => {
      setNextAutoSyncSeconds((prev) => {
        if (prev <= 1) {
          // Trigger background auto sync
          handleFetchDriveFiles(driveFolderId, true);
          return autoSyncIntervalMinutes * 60;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [autoSyncIntervalMinutes, authState.accessToken, driveFolderId, autoOcrEnabled]);

  // Sync a document to Google Sheets
  const handleSyncDocument = async (docId: string, customOcr?: OCRResult, forceAppend = false): Promise<void> => {
    if (!authState.accessToken) {
      setIsAuthModalOpen(true);
      return;
    }
    if (!sheetConfig?.spreadsheetId) {
      notify('Будь ласка, спочатку підключіть Google Таблицю у верхній панелі.', 'error');
      return;
    }

    const doc = documents.find((d) => d.id === docId);
    if (!doc) return;

    const dataToSync = customOcr || doc.editedData || doc.ocrResult;
    if (!dataToSync) {
      notify('Немає розпізнаних даних для запису в таблицю.', 'error');
      return;
    }

    const effAmount = dataToSync.documentType === 'payment'
      ? (dataToSync.amountPaid || dataToSync.totalAmount || 0)
      : (dataToSync.totalAmount || 0);

    if (effAmount <= 0) {
      notify(`Документ "${doc.fileName}" має нульову суму (0 грн). В системі апріорі не може бути рахунків чи платіжок без суми. Будь ласка, відкрийте документ та вкажіть суму перед занесенням.`, 'error');
      return;
    }

    // CRITICAL: Fetch fresh rows from Google Sheets right before appending to avoid race condition duplicates with concurrent users (e.g. secretary)
    let freshInvoices = existingInvoicesRef.current;
    let freshPayments = existingPaymentsRef.current;
    try {
      const [invData, payData] = await Promise.all([
        GoogleSheetsService.loadExistingInvoices(
          sheetConfig.spreadsheetId,
          authState.accessToken,
          sheetConfig.invoicesSheetName
        ),
        GoogleSheetsService.loadExistingPayments(
          sheetConfig.spreadsheetId,
          authState.accessToken,
          sheetConfig.paymentsSheetName,
          sheetConfig.availableSheets
        ),
      ]);
      if (invData && invData.length > 0) {
        freshInvoices = invData;
        setExistingInvoices(invData);
      }
      if (payData && payData.payments && payData.payments.length > 0) {
        freshPayments = payData.payments;
        setExistingPayments(payData.payments);
      }
    } catch (e) {
      console.warn('Could not fetch fresh rows before sync, using cached:', e);
    }

    // Strict Duplicate Check: verify if this record already exists in Google Sheets
    const doubleCheck = OCRService.checkExistingDocumentInSheet(
      dataToSync,
      freshInvoices,
      freshPayments
    );

    const rowPhysicallyExists = doubleCheck.rowIndex
      ? doubleCheck.tabName === 'Платіжки'
        ? freshPayments.some((p) => p.rowIndex === doubleCheck.rowIndex)
        : freshInvoices.some((inv) => inv.rowIndex === doubleCheck.rowIndex)
      : false;

    if (doubleCheck.alreadyInSheet && rowPhysicallyExists && !forceAppend) {
      // PREVENT DUPLICATE ROW: do NOT call appendInvoice / appendPayment!
      // If user altered payment status or amount on invoice, update the existing row instead of duplicating
      // If invoice already exists in the sheet, preserve its status as source of truth instead of overwriting
      if (dataToSync.documentType === 'invoice' && doubleCheck.rowIndex) {
        const existingRow = freshInvoices.find((inv) => inv.rowIndex === doubleCheck.rowIndex);
        if (existingRow) {
          dataToSync.paymentStatus = existingRow.paymentStatus;
          dataToSync.paidAmount = existingRow.paidAmount;
        }
      }

      // If it's a payment and matches an invoice, reconcile the invoice status
      let paymentReconcileMsg = '';
      if (dataToSync.documentType === 'payment') {
        const allMatches = OCRService.matchPaymentWithAllInvoices(
          dataToSync,
          freshInvoices,
          documentsRef.current
        );
        for (const m of allMatches) {
          if (m.matchedRowIndex && m.computedStatus) {
            try {
              await GoogleSheetsService.updateInvoicePaymentInSheet(
                sheetConfig.spreadsheetId,
                authState.accessToken,
                m.matchedRowIndex,
                m.computedStatus,
                m.paidAmount || 0,
                sheetConfig.invoicesSheetName
              );
            } catch (err) {
              console.warn('Could not update invoice for duplicate payment:', err);
            }
          }
        }
        if (allMatches.length > 0) {
          paymentReconcileMsg = ` Рахунки зв'язано зі статусом "${allMatches[0].computedStatus}".`;
        }
      }

      setDocuments((prev) =>
        prev.map((d) =>
          d.id === docId
            ? {
                ...d,
                status: 'synced',
                syncedRowIndex: doubleCheck.rowIndex,
                alreadyInSheet: true,
                alreadyInSheetReason: doubleCheck.reason,
                alreadyInSheetTab: doubleCheck.tabName,
                syncedAt: new Date().toISOString(),
                editedData: dataToSync,
              }
            : d
        )
      );

      await refreshSheetData();
      notify(
        `⚠️ Запис вже є у вкладці "${doubleCheck.tabName}" (рядок ${doubleCheck.rowIndex}). Створення дубліката скасовано! Документ зв'язано.${paymentReconcileMsg}`,
        'info'
      );
      return;
    }

    try {
      let matchInfoMsg = '';

      if (dataToSync.documentType === 'payment') {
        // 1. Append payment record to "Платіжки"
        await GoogleSheetsService.appendPayment(sheetConfig.spreadsheetId, authState.accessToken, {
          ocr: dataToSync,
          fileName: doc.fileName,
          driveLink: doc.driveLink,
          paymentsTab: sheetConfig.paymentsSheetName,
        });

        // 2. Fetch fresh invoices directly from Google Sheets to ensure exact row index and status
        const freshInvoices = await GoogleSheetsService.loadExistingInvoices(
          sheetConfig.spreadsheetId,
          authState.accessToken,
          sheetConfig.invoicesSheetName,
          sheetConfig.availableSheets
        );

        // 3. Match with fresh existing invoices and update status for ALL matched invoices on "Рахунки"
        const allMatches = OCRService.matchPaymentWithAllInvoices(
          dataToSync,
          freshInvoices.length > 0 ? freshInvoices : existingInvoicesRef.current,
          documentsRef.current
        );

        if (allMatches.length > 0) {
          const updatedRowIndices = new Map<number, { status: InvoicePaymentStatus; paid: number }>();
          const updatedDocIds = new Map<string, { status: InvoicePaymentStatus; paid: number }>();
          const updatedInvoiceNames: string[] = [];

          for (const m of allMatches) {
            if (m.matchedRowIndex && m.computedStatus) {
              await GoogleSheetsService.updateInvoicePaymentInSheet(
                sheetConfig.spreadsheetId,
                authState.accessToken,
                m.matchedRowIndex,
                m.computedStatus,
                m.paidAmount || 0,
                sheetConfig.invoicesSheetName
              );
              updatedRowIndices.set(m.matchedRowIndex, { status: m.computedStatus, paid: m.paidAmount || 0 });
              updatedInvoiceNames.push(`№${m.invoiceNumber} -> "${m.computedStatus}" (${OCRService.formatCurrency(m.paidAmount || 0)})`);
            }

            if (m.matchedDocId && m.computedStatus) {
              updatedDocIds.set(m.matchedDocId, { status: m.computedStatus, paid: m.paidAmount || 0 });
            }
          }

          if (updatedRowIndices.size > 0) {
            setExistingInvoices((prev) =>
              prev.map((inv) => {
                if (inv.rowIndex && updatedRowIndices.has(inv.rowIndex)) {
                  const u = updatedRowIndices.get(inv.rowIndex)!;
                  return { ...inv, paymentStatus: u.status, paidAmount: u.paid };
                }
                return inv;
              })
            );
          }

          if (updatedDocIds.size > 0) {
            setDocuments((prev) =>
              prev.map((d) => {
                if (updatedDocIds.has(d.id)) {
                  const u = updatedDocIds.get(d.id)!;
                  return {
                    ...d,
                    editedData: d.editedData
                      ? {
                          ...d.editedData,
                          paymentStatus: u.status,
                          amountPaid: u.paid,
                        }
                      : undefined,
                  };
                }
                return d;
              })
            );
          }

          matchInfoMsg = ` Оновлено ${updatedInvoiceNames.length} рахунків: ${updatedInvoiceNames.join(', ')}.`;
        }
      } else {
        // For Invoices: check if a matching payment was already uploaded to "Платіжки"
        let initialStatus: InvoicePaymentStatus = dataToSync.paymentStatus || 'Не оплачено';
        let initialPaidAmount = dataToSync.paidAmount || 0;

        try {
          const { payments: freshPayments } = await GoogleSheetsService.loadExistingPayments(
            sheetConfig.spreadsheetId,
            authState.accessToken,
            sheetConfig.paymentsSheetName,
            sheetConfig.availableSheets
          );

          const invoiceMatch = OCRService.matchInvoiceWithPayments(
            dataToSync,
            freshPayments,
            documentsRef.current
          );

          if (invoiceMatch.computedStatus && invoiceMatch.computedStatus !== 'Не оплачено') {
            initialStatus = invoiceMatch.computedStatus;
            initialPaidAmount = invoiceMatch.totalPaidAmount;
            matchInfoMsg = ` ${invoiceMatch.matchReason || ''}. Статус встановлено: "${initialStatus}".`;
          }
        } catch {
          // ignore lookup failure and proceed with normal append
        }

        await GoogleSheetsService.appendInvoice(sheetConfig.spreadsheetId, authState.accessToken, {
          ocr: {
            ...dataToSync,
            paymentStatus: initialStatus,
          },
          status: initialStatus,
          paidAmount: initialPaidAmount,
          fileName: doc.fileName,
          driveLink: doc.driveLink,
          invoicesTab: sheetConfig.invoicesSheetName,
        });
      }

      if (doc.driveFileId) {
        const dismissed = getDismissedDriveIds();
        dismissed.add(doc.driveFileId);
        saveDismissedDriveIds(dismissed);
      }

      setDocuments((prev) =>
        prev.map((d) =>
          d.id === docId
            ? {
                ...d,
                status: 'synced',
                syncedAt: new Date().toISOString(),
                editedData: dataToSync,
              }
            : d
        )
      );

      // Refresh live view
      await refreshSheetData();
      notify(
        `Документ "${doc.fileName}" успішно записано у Google Таблицю!${matchInfoMsg}`,
        'success'
      );
    } catch (err: any) {
      notify(err.message || 'Помилка запису в Google Таблицю.', 'error');
      throw err;
    }
  };

  // Direct status update from SheetLivePreview table
  const handleUpdateInvoiceStatus = async (
    rowIndex: number, 
    newStatus: InvoicePaymentStatus,
    paidAmount?: number
  ) => {
    const targetInvoice = existingInvoices.find((i) => i.rowIndex === rowIndex);
    const effectivePaidAmount =
      paidAmount !== undefined
        ? paidAmount
        : newStatus === 'Оплачено'
        ? (targetInvoice?.amount || 0)
        : (targetInvoice?.paidAmount || 0);

    if (!sheetConfig?.spreadsheetId || !authState.accessToken) {
      setExistingInvoices((prev) =>
        prev.map((inv) => 
          inv.rowIndex === rowIndex 
            ? { ...inv, paymentStatus: newStatus, paidAmount: effectivePaidAmount } 
            : inv
        )
      );
      notify(`Статус рахунку оновлено на "${newStatus}"`, 'success');
      return;
    }

    try {
      await GoogleSheetsService.updateInvoicePaymentInSheet(
        sheetConfig.spreadsheetId,
        authState.accessToken,
        rowIndex,
        newStatus,
        effectivePaidAmount,
        sheetConfig.invoicesSheetName
      );
      setExistingInvoices((prev) =>
        prev.map((inv) => 
          inv.rowIndex === rowIndex 
            ? { ...inv, paymentStatus: newStatus, paidAmount: effectivePaidAmount } 
            : inv
        )
      );
      notify(`Статус у Google Таблиці (рядок ${rowIndex}) оновлено на "${newStatus}"!`, 'success');
    } catch (err: any) {
      notify(err.message || 'Помилка оновлення статусу в Google Таблиці.', 'error');
    }
  };

  // Replace an unpaid invoice row in-place with an updated document
  const handleReplaceInvoice = async (
    targetRowIndex: number,
    newOcr: OCRResult,
    sourceDoc?: ProcessedDocument,
    previousInvoiceInfo?: {
      invoiceNumber?: string;
      amount?: number;
      supplier?: string;
      date?: string;
      orderNumber?: string;
    },
    options?: {
      trashOldDriveFile?: boolean;
      oldFileId?: string;
      oldFileName?: string;
    }
  ) => {
    const targetInvoice = existingInvoices.find((i) => i.rowIndex === targetRowIndex);
    const prevInfo = {
      invoiceNumber: previousInvoiceInfo?.invoiceNumber || targetInvoice?.invoiceNumber,
      amount: previousInvoiceInfo?.amount ?? targetInvoice?.amount,
      supplier: previousInvoiceInfo?.supplier || targetInvoice?.supplier,
      date: previousInvoiceInfo?.date || targetInvoice?.invoiceDate,
      orderNumber: previousInvoiceInfo?.orderNumber || targetInvoice?.orderNumber,
    };

    // If source document is from local upload and not yet in Google Drive, ensure background upload
    if (sourceDoc && !sourceDoc.driveFileId && authState.accessToken) {
      handleUploadDocToDrive(sourceDoc.id, sourceDoc).catch((err) => {
        console.warn('Background Drive upload for replacement doc error:', err);
      });
    }

    // Move old file to Google Drive trash if user requested
    let trashedFileName = '';
    if (options?.trashOldDriveFile && authState.accessToken) {
      let oldFileId = options.oldFileId ? GoogleDriveService.extractFileId(options.oldFileId) : '';
      let oldFileName = options.oldFileName || '';

      const targetInvNumClean = OCRService.sanitizeInvoiceNumber(prevInfo.invoiceNumber || targetInvoice?.invoiceNumber || '');
      const targetOrderClean = OCRService.normalizeOrderNumber(prevInfo.orderNumber || targetInvoice?.orderNumber || '');

      const matchedOldDoc = documentsRef.current.find((d) => {
        if (sourceDoc && d.id === sourceDoc.id) return false;

        // 1. Direct row index match
        if (d.syncedRowIndex && d.syncedRowIndex === targetRowIndex) return true;

        // 2. Drive file ID or drive link match
        if (oldFileId && d.driveFileId === oldFileId) return true;
        if (targetInvoice?.driveLink && d.driveLink && d.driveLink.includes(GoogleDriveService.extractFileId(targetInvoice.driveLink))) return true;
        if (targetInvoice?.fileName && d.fileName && d.fileName.toLowerCase().trim() === targetInvoice.fileName.toLowerCase().trim()) return true;

        // 3. Invoice number match
        const dInv = d.ocrResult?.invoiceNumber || d.editedData?.invoiceNumber || '';
        if (targetInvNumClean && dInv && OCRService.isInvoiceNumberMatch(dInv, prevInfo.invoiceNumber || targetInvoice?.invoiceNumber || '')) {
          return true;
        }

        // 4. File name contains clean invoice number
        if (targetInvNumClean && targetInvNumClean.length >= 2 && d.fileName) {
          const fnClean = OCRService.sanitizeInvoiceNumber(d.fileName);
          if (fnClean.includes(targetInvNumClean)) return true;
        }

        // 5. Order number + supplier match
        const dOrder = OCRService.normalizeOrderNumber(d.ocrResult?.handwrittenOrderNumber || d.editedData?.handwrittenOrderNumber || '');
        const dSupplier = d.ocrResult?.supplierName || d.editedData?.supplierName || '';
        if (targetOrderClean && dOrder === targetOrderClean && prevInfo.supplier && OCRService.isCompanyNameMatch(dSupplier, prevInfo.supplier)) {
          return true;
        }

        return false;
      });

      if (matchedOldDoc) {
        if (!oldFileId && matchedOldDoc.driveFileId) {
          oldFileId = matchedOldDoc.driveFileId;
        }
        if (!oldFileName && matchedOldDoc.fileName) {
          oldFileName = matchedOldDoc.fileName;
        }
      }

      if (!oldFileId && targetInvoice?.driveLink) {
        oldFileId = GoogleDriveService.extractFileId(targetInvoice.driveLink);
        oldFileName = targetInvoice.fileName || '';
      }

      // If still not found, search Google Drive folder directly!
      if (!oldFileId && driveFolderId && authState.accessToken) {
        try {
          const driveMatch = await GoogleDriveService.findFileInFolder(
            driveFolderId,
            authState.accessToken,
            {
              invoiceNumber: prevInfo.invoiceNumber || targetInvoice?.invoiceNumber,
              orderNumber: prevInfo.orderNumber || targetInvoice?.orderNumber,
              supplier: prevInfo.supplier || targetInvoice?.supplier,
              fileName: targetInvoice?.fileName,
            }
          );
          if (driveMatch) {
            oldFileId = driveMatch.id;
            oldFileName = driveMatch.name;
          }
        } catch (searchErr) {
          console.warn('Could not search Drive folder for old invoice file:', searchErr);
        }
      }

      if (oldFileId) {
        try {
          await GoogleDriveService.trashFile(oldFileId, authState.accessToken);
          trashedFileName = oldFileName || `№${prevInfo.invoiceNumber || targetInvoice?.invoiceNumber || ''}`;

          // IMPORTANT: Remember this file ID in dismissed drive IDs so it never re-appears when fetching files!
          const dismissed = getDismissedDriveIds();
          dismissed.add(oldFileId);
          saveDismissedDriveIds(dismissed);

          // Remove the old document from local queue/documents state
          setDocuments((prev) =>
            prev.filter(
              (d) =>
                d.driveFileId !== oldFileId &&
                !(matchedOldDoc && d.id === matchedOldDoc.id) &&
                !(d.syncedRowIndex === targetRowIndex && (!sourceDoc || d.id !== sourceDoc.id))
            )
          );
        } catch (trashErr: any) {
          console.warn('Could not trash old file from Google Drive:', trashErr);
          notify(`Не вдалося перемістити старий файл на Диску в кошик: ${trashErr.message || trashErr}`, 'error');
        }
      } else {
        console.warn('Old file for invoice replacement could not be located on Google Drive:', {
          targetInvoice,
          prevInfo,
        });
        notify(
          `Попередній файл рахунку №${prevInfo.invoiceNumber || '—'} не знайдено на Google Диску (можливо, він уже видалений або назва суттєво відрізняється).`,
          'info'
        );
      }
    }

    if (!sheetConfig?.spreadsheetId || !authState.accessToken) {
      // Local/offline state update
      setExistingInvoices((prev) =>
        prev.map((inv) => {
          if (inv.rowIndex !== targetRowIndex) return inv;
          return {
            ...inv,
            orderNumber: newOcr.handwrittenOrderNumber || inv.orderNumber,
            invoiceNumber: newOcr.invoiceNumber || inv.invoiceNumber,
            invoiceDate: newOcr.invoiceDate || inv.invoiceDate,
            amount: newOcr.totalAmount || inv.amount,
            supplier: newOcr.supplierName || inv.supplier,
            payer: newOcr.buyerName || inv.payer,
            paymentStatus: 'Не оплачено',
            paidAmount: 0,
            replacedAt: new Date().toISOString(),
            replacedPreviousInvoice: prevInfo,
          };
        })
      );

      if (sourceDoc) {
        setDocuments((prev) =>
          prev.map((d) => {
            if (d.id === sourceDoc.id) {
              return {
                ...d,
                status: 'synced',
                syncedRowIndex: targetRowIndex,
                syncedAt: new Date().toISOString(),
                syncedSheetTab: sheetConfig?.invoicesSheetName || 'Рахунки',
                alreadyInSheet: true,
                replacedRowIndex: targetRowIndex,
                replacedPreviousInvoice: prevInfo,
                editedData: newOcr,
              };
            }
            if (d.syncedRowIndex === targetRowIndex && d.id !== sourceDoc.id) {
              return {
                ...d,
                isReplaced: true,
                replacedByInvoiceNumber: newOcr.invoiceNumber,
              };
            }
            return d;
          })
        );
      }

      notify(`Рахунок у рядку ${targetRowIndex} успішно замінено (локальний режим).`, 'success');
      return;
    }

    try {
      notify(`Заміна рахунку в рядку ${targetRowIndex} у Google Таблиці...`, 'info');
      await GoogleSheetsService.replaceInvoiceInSheet(
        sheetConfig.spreadsheetId,
        authState.accessToken,
        targetRowIndex,
        {
          ocr: newOcr,
          fileName: sourceDoc?.fileName,
          driveLink: sourceDoc?.driveLink,
          invoicesTab: sheetConfig.invoicesSheetName,
          previousInvoiceInfo: prevInfo,
        }
      );

      // Update local existingInvoices immediately so UI reflects the replacement without delay
      setExistingInvoices((prev) =>
        prev.map((inv) => {
          if (inv.rowIndex !== targetRowIndex) return inv;
          return {
            ...inv,
            orderNumber: newOcr.handwrittenOrderNumber || inv.orderNumber,
            invoiceNumber: newOcr.invoiceNumber || inv.invoiceNumber,
            invoiceDate: newOcr.invoiceDate || inv.invoiceDate,
            amount: newOcr.totalAmount || inv.amount,
            supplier: newOcr.supplierName || inv.supplier,
            buyer: newOcr.buyerName || inv.buyer,
            paymentStatus: 'Не оплачено',
            paidAmount: 0,
            replacedAt: new Date().toISOString(),
            replacedPreviousInvoice: prevInfo,
          };
        })
      );

      // Refresh sheets data from server in background
      try {
        await refreshSheetData();
      } catch (refErr) {
        console.warn('Could not refresh sheet data immediately after replacement:', refErr);
      }

      // Update local documents list
      if (sourceDoc) {
        setDocuments((prev) =>
          prev.map((d) => {
            if (d.id === sourceDoc.id) {
              return {
                ...d,
                status: 'synced',
                syncedRowIndex: targetRowIndex,
                syncedAt: new Date().toISOString(),
                syncedSheetTab: sheetConfig.invoicesSheetName || 'Рахунки',
                alreadyInSheet: true,
                replacedRowIndex: targetRowIndex,
                replacedPreviousInvoice: prevInfo,
                editedData: newOcr,
              };
            }
            if (d.syncedRowIndex === targetRowIndex && d.id !== sourceDoc.id) {
              return {
                ...d,
                isReplaced: true,
                replacedByInvoiceNumber: newOcr.invoiceNumber,
              };
            }
            return d;
          })
        );
      }

      const trashNotice = trashedFileName
        ? ` 🗑️ Старий файл «${trashedFileName}» переміщено в кошик на Google Диску.`
        : '';

      notify(
        `✅ Рахунок у рядку ${targetRowIndex} успішно замінено новими даними (№${newOcr.invoiceNumber || '—'}, ${newOcr.totalAmount} грн)!${trashNotice}`,
        'success'
      );
    } catch (err: any) {
      notify(err.message || 'Помилка заміни рахунку в Google Таблиці.', 'error');
      throw err;
    }
  };

  // Batch reconcile statuses from SheetLivePreview
  const handleBatchReconcileInvoiceStatuses = async (
    matches: Array<{
      invoiceRowIndex: number;
      computedStatus: InvoicePaymentStatus;
      paidAmount: number;
    }>
  ) => {
    if (!sheetConfig?.spreadsheetId || !authState.accessToken) {
      setExistingInvoices((prev) =>
        prev.map((inv) => {
          const match = matches.find((m) => m.invoiceRowIndex === inv.rowIndex);
          if (match) {
            return { ...inv, paymentStatus: match.computedStatus, paidAmount: match.paidAmount };
          }
          return inv;
        })
      );
      notify(`Оновлено статуси для ${matches.length} рахунків`, 'success');
      return;
    }

    setIsLoadingSheet(true);
    let updatedCount = 0;
    try {
      for (const item of matches) {
        try {
          await GoogleSheetsService.updateInvoicePaymentInSheet(
            sheetConfig.spreadsheetId,
            authState.accessToken,
            item.invoiceRowIndex,
            item.computedStatus,
            item.paidAmount,
            sheetConfig.invoicesSheetName
          );
          updatedCount++;
        } catch (e) {
          console.error(`Error updating row ${item.invoiceRowIndex}:`, e);
        }
      }
      setExistingInvoices((prev) =>
        prev.map((inv) => {
          const match = matches.find((m) => m.invoiceRowIndex === inv.rowIndex);
          if (match) {
            return { ...inv, paymentStatus: match.computedStatus, paidAmount: match.paidAmount };
          }
          return inv;
        })
      );
      notify(
        `Успішно оновлено статуси оплат для ${updatedCount} рахунків у Google Таблиці!`,
        'success'
      );
    } catch (err: any) {
      notify(err.message || 'Помилка при оновленні статусів.', 'error');
    } finally {
      setIsLoadingSheet(false);
    }
  };

  // Normalize overpaid / duplicate payment amounts (Column J) in "Рахунки"
  const handleNormalizeOverpaidInvoices = async (
    items: Array<{ rowIndex: number; correctPaidAmount: number }>
  ) => {
    if (!sheetConfig?.spreadsheetId || !authState.accessToken) {
      setExistingInvoices((prev) =>
        prev.map((inv) => {
          const match = items.find((i) => i.rowIndex === inv.rowIndex);
          if (match) {
            return { ...inv, paidAmount: match.correctPaidAmount, paymentStatus: 'Оплачено' };
          }
          return inv;
        })
      );
      notify(`Нормалізовано суми оплат для ${items.length} рахунків (закріплено 100% суми).`, 'success');
      return;
    }

    setIsLoadingSheet(true);
    try {
      await GoogleSheetsService.batchNormalizeOverpaidInvoices(
        sheetConfig.spreadsheetId,
        authState.accessToken,
        items,
        sheetConfig.invoicesSheetName || 'Рахунки'
      );
      setExistingInvoices((prev) =>
        prev.map((inv) => {
          const match = items.find((i) => i.rowIndex === inv.rowIndex);
          if (match) {
            return { ...inv, paidAmount: match.correctPaidAmount, paymentStatus: 'Оплачено' };
          }
          return inv;
        })
      );
      notify(
        `Успішно усунено заводвоєння сум оплат для ${items.length} рахунків у Google Таблиці (пари закриті на 100%)!`,
        'success'
      );
    } catch (err: any) {
      notify(err.message || 'Помилка нормалізації сум оплат.', 'error');
    } finally {
      setIsLoadingSheet(false);
    }
  };

  // Batch sync to Google Sheets
  const handleBatchSync = async (docIds: string[]) => {
    if (!authState.accessToken) {
      setIsAuthModalOpen(true);
      return;
    }
    if (!sheetConfig?.spreadsheetId) {
      notify('Будь ласка, спочатку підключіть Google Таблицю.', 'error');
      return;
    }

    setIsSyncingBatch(true);
    let successCount = 0;

    for (const id of docIds) {
      try {
        await handleSyncDocument(id);
        successCount++;
      } catch (e) {
        console.error('Failed to sync doc:', id, e);
      }
    }

    setIsSyncingBatch(false);
    notify(`Успішно занесено ${successCount} записів у Google Таблицю!`, 'success');
  };

  // Delete duplicate rows from Google Sheets ("Рахунки" and "Платіжки")
  const handleDeleteDuplicateRows = async (duplicates: DuplicateRowMatch[]) => {
    if (!authState.accessToken) {
      setIsAuthModalOpen(true);
      return;
    }
    if (!sheetConfig?.spreadsheetId) {
      notify('Будь ласка, спочатку підключіть Google Таблицю.', 'error');
      return;
    }
    if (!duplicates || duplicates.length === 0) {
      notify('Не знайдено дублікатів для видалення.', 'info');
      return;
    }

    setIsLoadingSheet(true);
    try {
      const invoiceRowIndices = duplicates
        .filter((d) => d.type === 'invoice')
        .map((d) => d.rowIndex);
      const paymentRowIndices = duplicates
        .filter((d) => d.type === 'payment')
        .map((d) => d.rowIndex);

      let deletedTotal = 0;

      if (invoiceRowIndices.length > 0) {
        const res = await GoogleSheetsService.deleteRowsFromSheet(
          sheetConfig.spreadsheetId,
          authState.accessToken,
          sheetConfig.invoicesSheetName || 'Рахунки',
          invoiceRowIndices
        );
        deletedTotal += res.deletedCount;
      }

      if (paymentRowIndices.length > 0) {
        const res = await GoogleSheetsService.deleteRowsFromSheet(
          sheetConfig.spreadsheetId,
          authState.accessToken,
          sheetConfig.paymentsSheetName || 'Платіжки',
          paymentRowIndices
        );
        deletedTotal += res.deletedCount;
      }

      await refreshSheetData();
      notify(
        `🧹 Успішно видалено ${deletedTotal} дублікатів рядків з Google Таблиці! Оновлено.`,
        'success'
      );
    } catch (err: any) {
      console.error('Error deleting duplicate rows:', err);
      notify(err.message || 'Помилка при видаленні дублікатів з Google Таблиці.', 'error');
    } finally {
      setIsLoadingSheet(false);
    }
  };

  // Compact empty/blank gap rows in a sheet tab
  const handleCompactEmptyRows = async (tabName: string) => {
    if (!sheetConfig?.spreadsheetId || !authState.accessToken) {
      notify('Потрібно підключити Google Таблицю для цієї операції.', 'error');
      return;
    }

    setIsLoadingSheet(true);
    try {
      notify(`Очищення пустих рядків у вкладці "${tabName}"...`, 'info');
      const res = await GoogleSheetsService.compactEmptyRowsInTab(
        sheetConfig.spreadsheetId,
        authState.accessToken,
        tabName
      );

      if (res.removedCount > 0) {
        await refreshSheetData();
        notify(
          `✨ Успішно видалено ${res.removedCount} пустих рядків у вкладці "${tabName}". Дані підтягнуто вгору!`,
          'success'
        );
      } else {
        notify(`У вкладці "${tabName}" немає порожніх рядків між записами.`, 'info');
      }
    } catch (err: any) {
      notify(err.message || 'Помилка видалення пустих рядків у Google Таблиці.', 'error');
    } finally {
      setIsLoadingSheet(false);
    }
  };

  const handleDeleteInvoiceRow = async (rowIndex: number) => {
    if (!sheetConfig?.spreadsheetId || !authState.accessToken) return;
    setIsLoadingSheet(true);
    try {
      notify(`Видалення рядка ${rowIndex} з вкладки "${sheetConfig.invoicesSheetName || 'Рахунки'}"...`, 'info');
      await GoogleSheetsService.deleteRowsFromSheet(
        sheetConfig.spreadsheetId,
        authState.accessToken,
        sheetConfig.invoicesSheetName || 'Рахунки',
        [rowIndex]
      );
      await refreshSheetData();
      notify(`🧹 Рядок ${rowIndex} успішно видалено з Google Таблиці та вилучено з черги!`, 'success');
    } catch (err: any) {
      notify(err.message || 'Помилка видалення рядка з Google Таблиці.', 'error');
    } finally {
      setIsLoadingSheet(false);
    }
  };

  const handleDeletePaymentRow = async (rowIndex: number) => {
    if (!sheetConfig?.spreadsheetId || !authState.accessToken) return;
    setIsLoadingSheet(true);
    try {
      notify(`Видалення рядка ${rowIndex} з вкладки "${sheetConfig.paymentsSheetName || 'Платіжки'}"...`, 'info');
      await GoogleSheetsService.deleteRowsFromSheet(
        sheetConfig.spreadsheetId,
        authState.accessToken,
        sheetConfig.paymentsSheetName || 'Платіжки',
        [rowIndex]
      );
      await refreshSheetData();
      notify(`🧹 Рядок ${rowIndex} успішно видалено з Google Таблиці та вилучено з черги!`, 'success');
    } catch (err: any) {
      notify(err.message || 'Помилка видалення рядка з Google Таблиці.', 'error');
    } finally {
      setIsLoadingSheet(false);
    }
  };

  const handleMergeDuplicateInvoice = async (
    originalRowIndex: number,
    duplicateRowIndex: number,
    correctInvoiceNumber: string
  ) => {
    if (!sheetConfig?.spreadsheetId || !authState.accessToken) return;
    setIsLoadingSheet(true);
    try {
      notify(
        `Об'єднання: оновлення рядка ${originalRowIndex} номером №${correctInvoiceNumber} та видалення дублюючого рядка ${duplicateRowIndex}...`,
        'info'
      );
      await GoogleSheetsService.mergeDuplicateInvoiceInSheet(
        sheetConfig.spreadsheetId,
        authState.accessToken,
        originalRowIndex,
        duplicateRowIndex,
        correctInvoiceNumber,
        sheetConfig.invoicesSheetName || 'Рахунки'
      );
      await refreshSheetData();
      notify(
        `✨ Успішно! Номер №${correctInvoiceNumber} внесено в рядок ${originalRowIndex}, дублюючий рядок ${duplicateRowIndex} видалено. Вся нумерація рядків збереглася!`,
        'success'
      );
    } catch (err: any) {
      notify(err.message || 'Помилка об\'єднання дублікату в Google Таблиці.', 'error');
    } finally {
      setIsLoadingSheet(false);
    }
  };

  const handleMoveInvoiceToPayments = async (inv: ExistingSheetRow) => {
    if (!sheetConfig?.spreadsheetId || !authState.accessToken) return;
    setIsLoadingSheet(true);
    try {
      notify(`Перенесення запису "${inv.supplier || ''}" у вкладку «Платіжки»...`, 'info');
      const ocr: OCRResult = {
        documentType: 'payment',
        documentTypeUkrainian: 'Платіжна інструкція',
        handwrittenOrderNumber: inv.orderNumber || '',
        handwrittenConfidence: 'none',
        paymentNumber: inv.invoiceNumber || '',
        paymentDate: inv.invoiceDate || '',
        payerName: inv.buyer || '',
        payeeName: inv.supplier || '',
        buyerName: inv.buyer || '',
        supplierName: inv.supplier || '',
        invoiceNumber: inv.invoiceNumber || '',
        invoiceDate: inv.invoiceDate || '',
        amountPaid: inv.amount || 0,
        totalAmount: inv.amount || 0,
        currency: inv.currency || 'UAH',
        paymentPurpose: inv.notes || `Оплата згідно рахунку №${inv.invoiceNumber}`,
        referencedInvoiceNumber: inv.invoiceNumber || '',
        confidenceScore: 100,
      };

      await GoogleSheetsService.appendPayment(sheetConfig.spreadsheetId, authState.accessToken, {
        ocr,
        fileName: inv.fileName || '',
        driveLink: inv.driveLink || '',
        paymentsTab: sheetConfig.paymentsSheetName,
      });

      await GoogleSheetsService.deleteRowsFromSheet(
        sheetConfig.spreadsheetId,
        authState.accessToken,
        sheetConfig.invoicesSheetName || 'Рахунки',
        [inv.rowIndex]
      );

      await refreshSheetData();
      notify(`✅ Запис (${inv.supplier || ''}, ${inv.amount} грн) успішно перенесено у вкладку «Платіжки»!`, 'success');
    } catch (err: any) {
      notify(err.message || 'Помилка перенесення запису у вкладку Платіжки.', 'error');
    } finally {
      setIsLoadingSheet(false);
    }
  };

  const handleMovePaymentToInvoices = async (pay: ExistingPaymentRow) => {
    if (!sheetConfig?.spreadsheetId || !authState.accessToken) return;
    setIsLoadingSheet(true);
    try {
      notify(`Перенесення запису "${pay.payee || ''}" у вкладку «Рахунки»...`, 'info');
      const ocr: OCRResult = {
        documentType: 'invoice',
        documentTypeUkrainian: 'Рахунок на оплату',
        handwrittenOrderNumber: pay.orderNumber || '',
        handwrittenConfidence: 'none',
        invoiceNumber: pay.referencedInvoiceNumber || pay.paymentNumber || '',
        invoiceDate: pay.paymentDate || '',
        buyerName: pay.payer || '',
        supplierName: pay.payee || '',
        payerName: pay.payer || '',
        payeeName: pay.payee || '',
        totalAmount: pay.amountPaid || 0,
        currency: pay.currency || 'UAH',
        notes: pay.paymentPurpose || '',
        confidenceScore: 100,
      };

      await GoogleSheetsService.appendInvoice(sheetConfig.spreadsheetId, authState.accessToken, {
        ocr,
        fileName: pay.fileName || '',
        driveLink: pay.driveLink || '',
        invoicesTab: sheetConfig.invoicesSheetName,
      });

      await GoogleSheetsService.deleteRowsFromSheet(
        sheetConfig.spreadsheetId,
        authState.accessToken,
        sheetConfig.paymentsSheetName || 'Платіжки',
        [pay.rowIndex]
      );

      await refreshSheetData();
      notify(`✅ Запис (${pay.payee || ''}, ${pay.amountPaid} грн) успішно перенесено у вкладку «Рахунки»!`, 'success');
    } catch (err: any) {
      notify(err.message || 'Помилка перенесення запису у вкладку Рахунки.', 'error');
    } finally {
      setIsLoadingSheet(false);
    }
  };

  const handleSaveLocalData = (docId: string, updatedOcr: OCRResult) => {
    let effectiveOcr = updatedOcr;
    if (updatedOcr.documentType === 'payment' && !updatedOcr.handwrittenOrderNumber) {
      const match = OCRService.matchPaymentWithInvoices(updatedOcr, existingInvoicesRef.current, documentsRef.current);
      if (match.matchedOrderNumber) {
        effectiveOcr = {
          ...updatedOcr,
          handwrittenOrderNumber: match.matchedOrderNumber,
          referencedOrderNumber: match.matchedOrderNumber,
          handwrittenConfidence: 'high',
          matchedInvoiceNumber: match.matchedInvoiceNumber || updatedOcr.matchedInvoiceNumber,
        };
      }
    }
    setDocuments((prev) =>
      prev.map((d) => (d.id === docId ? { ...d, editedData: effectiveOcr } : d))
    );

    const targetDoc = documentsRef.current.find((d) => d.id === docId);
    if (targetDoc?.driveFileId && authState.accessToken) {
      GoogleDriveService.saveOcrToDriveProperties(
        targetDoc.driveFileId,
        effectiveOcr,
        authState.accessToken
      ).catch(() => {});
    }
  };

  // Upload a local or camera file to Google Drive automatically in background
  const handleUploadDocToDrive = async (docId: string, directDoc?: ProcessedDocument): Promise<void> => {
    const currentList = documentsRef.current;
    const doc = directDoc || currentList.find((d) => d.id === docId);
    if (!doc) return;

    if (!authState.accessToken) {
      setDocuments((prev) =>
        prev.map((d) => (d.id === docId ? { ...d, driveUploadStatus: 'idle' } : d))
      );
      return;
    }

    if (doc.driveFileId && doc.driveUploadStatus === 'uploaded') {
      return;
    }

    setDocuments((prev) =>
      prev.map((d) => (d.id === docId ? { ...d, driveUploadStatus: 'uploading', driveUploadError: undefined } : d))
    );

    try {
      let blobToUpload = doc.blob;
      if (!blobToUpload && doc.previewDataUrl) {
        blobToUpload = GoogleDriveService.dataUrlToBlob(doc.previewDataUrl);
      }

      if (!blobToUpload) {
        throw new Error('Вміст файлу не знайдено для збереження на Диск');
      }

      const cleanFolder = driveFolderId ? GoogleDriveService.extractFolderId(driveFolderId) : null;
      let uploaded: any;
      try {
        uploaded = await GoogleDriveService.uploadFile(
          blobToUpload,
          doc.fileName,
          cleanFolder,
          authState.accessToken
        );
      } catch (uploadErr: any) {
        // If uploading to the specific folder failed (e.g. folder ID permission/deleted), fallback to root
        if (cleanFolder && (uploadErr.message?.includes('File not found') || uploadErr.message?.includes('parent') || uploadErr.message?.includes('404'))) {
          uploaded = await GoogleDriveService.uploadFile(
            blobToUpload,
            doc.fileName,
            null,
            authState.accessToken
          );
        } else {
          throw uploadErr;
        }
      }

      setDocuments((prev) =>
        prev.map((d) =>
          d.id === docId
            ? {
                ...d,
                driveFileId: uploaded.id,
                driveLink: uploaded.webViewLink,
                driveWebViewLink: uploaded.webViewLink,
                thumbnailUrl: uploaded.thumbnailLink || d.thumbnailUrl,
                driveUploadStatus: 'uploaded',
              }
            : d
        )
      );

      const ocrToPersist = doc.editedData || doc.ocrResult;
      if (ocrToPersist && authState.accessToken) {
        GoogleDriveService.saveOcrToDriveProperties(
          uploaded.id,
          ocrToPersist,
          authState.accessToken
        ).catch(() => {});
      }
    } catch (err: any) {
      console.warn(`Drive upload failed for ${doc.fileName}:`, err);
      setDocuments((prev) =>
        prev.map((d) =>
          d.id === docId
            ? {
                ...d,
                driveUploadStatus: 'failed',
                driveUploadError: err.message || 'Помилка збереження на Google Диск',
              }
            : d
        )
      );
    }
  };

  const handleAddLocalDocuments = (newDocs: ProcessedDocument[]) => {
    const currentList = documentsRef.current;
    const existingDriveIds = new Set(currentList.map((d) => d.driveFileId).filter(Boolean));
    const existingNames = new Set(currentList.map((d) => normalizeFileName(d.fileName)).filter(Boolean));

    const uniqueDocs: ProcessedDocument[] = [];
    const skippedDuplicates: string[] = [];

    for (const doc of newDocs) {
      const normName = normalizeFileName(doc.fileName);
      const isDupDrive = doc.driveFileId && existingDriveIds.has(doc.driveFileId);
      const isDupName = normName && existingNames.has(normName);

      if (isDupDrive || isDupName) {
        skippedDuplicates.push(doc.fileName);
      } else {
        uniqueDocs.push(doc);
        if (normName) existingNames.add(normName);
        if (doc.driveFileId) existingDriveIds.add(doc.driveFileId);
      }
    }

    if (uniqueDocs.length === 0) {
      notify(
        skippedDuplicates.length === 1
          ? `Файл "${skippedDuplicates[0]}" вже є в Черзі обробки (дублікат пропущено).`
          : `Усі завантажені файли (${skippedDuplicates.length} шт.) вже є в Черзі обробки (дублікати пропущено).`,
        'info'
      );
      return;
    }

    const now = Date.now();
    const docsWithStatus = uniqueDocs.map((d, idx) => ({
      ...d,
      createdAt: d.createdAt || (now + idx),
      driveUploadStatus: authState.accessToken ? ('uploading' as const) : ('idle' as const),
    }));

    setDocuments((prev) => deduplicateDocuments([...docsWithStatus, ...prev]).uniqueDocs);

    // Auto-upload to Google Drive in background if connected
    if (authState.accessToken) {
      docsWithStatus.forEach((d) => {
        handleUploadDocToDrive(d.id, d);
      });
    }

    const skipNotice = skippedDuplicates.length > 0 ? ` (${skippedDuplicates.length} дублікат(ів) пропущено)` : '';
    
    if (autoOcrEnabled) {
      notify(
        authState.accessToken
          ? `Додано ${uniqueDocs.length} файлів${skipNotice}. Зберігаємо на Google Диск та запускаємо AI-розпізнавання...`
          : `Додано ${uniqueDocs.length} файлів${skipNotice}. Запускаємо AI-розпізнавання...`,
        'info'
      );
      setTimeout(() => {
        handleBatchProcess(uniqueDocs.map((d) => d.id));
      }, 200);
    } else {
      notify(
        authState.accessToken
          ? `Додано ${uniqueDocs.length} файлів${skipNotice} (зберігаються на Google Диск). Натисніть "Обробити AI", щоб розпізнати.`
          : `Додано ${uniqueDocs.length} файлів${skipNotice}. Натисніть "Обробити AI", щоб розпізнати.`,
        'info'
      );
    }
  };

  const handleAddSingleLocalDocument = async (file: File): Promise<ProcessedDocument | null> => {
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const newDoc: ProcessedDocument = {
        id: `local_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        source: 'upload',
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg'),
        previewDataUrl: dataUrl,
        blob: file,
        status: 'pending',
        createdAt: Date.now(),
      };

      handleAddLocalDocuments([newDoc]);
      return newDoc;
    } catch (err) {
      console.error('Failed to create document from file:', err);
      return null;
    }
  };

  const handleDeduplicateDocuments = () => {
    const { uniqueDocs, removedCount } = deduplicateDocuments(documents);
    if (removedCount > 0) {
      setDocuments(uniqueDocs);
      notify(`Прибрано ${removedCount} дублікат(ів) з Черги обробки. Дані та статуси об'єднано.`, 'success');
    } else {
      notify('У Черзі обробки немає дублікатів файлів.', 'info');
    }
  };

  const handleRemoveDoc = (docId: string) => {
    const doc = documents.find((d) => d.id === docId);
    if (doc?.driveFileId) {
      const dismissed = getDismissedDriveIds();
      dismissed.add(doc.driveFileId);
      saveDismissedDriveIds(dismissed);
    }
    setDocuments((prev) => prev.filter((d) => d.id !== docId));
  };

  const handleClearAll = () => {
    if (window.confirm('Очистити всі документи зі списку?')) {
      const dismissed = getDismissedDriveIds();
      documents.forEach((d) => {
        if (d.driveFileId) dismissed.add(d.driveFileId);
      });
      saveDismissedDriveIds(dismissed);
      setDocuments([]);
    }
  };

  // Navigation inside review modal
  const activeReviewDoc = selectedReviewDoc
    ? documents.find((d) => d.id === selectedReviewDoc.id) || selectedReviewDoc
    : null;

  const reviewDocIndex = activeReviewDoc
    ? documents.findIndex((d) => d.id === activeReviewDoc.id)
    : -1;

  const handleNextReviewDoc = () => {
    if (reviewDocIndex >= 0 && reviewDocIndex < documents.length - 1) {
      setSelectedReviewDoc(documents[reviewDocIndex + 1]);
    }
  };

  const handlePrevReviewDoc = () => {
    if (reviewDocIndex > 0) {
      setSelectedReviewDoc(documents[reviewDocIndex - 1]);
    }
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 flex flex-col font-sans selection:bg-indigo-600 selection:text-white">
      {/* Top Navbar */}
      <Header
        authState={authState}
        sheetConfig={sheetConfig}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onOpenAuthModal={() => setIsAuthModalOpen(true)}
        onLogout={() => {
          googleAuth.clearToken();
          notify('Обліковий запис Google відключено.');
        }}
        totalPendingCount={documents.filter((d) => d.status === 'pending').length}
        totalReadyCount={documents.filter((d) => d.status === 'ready_for_review').length}
      />

      {/* Floating Notification */}
      {notification && (
        <div className="fixed bottom-5 right-5 z-50 animate-in slide-in-from-bottom-5 duration-200">
          <div
            className={`px-4 py-2.5 rounded-lg shadow-xl border flex items-center space-x-2 text-xs font-semibold ${
              notification.type === 'success'
                ? 'bg-slate-900 text-white border-slate-700'
                : notification.type === 'error'
                ? 'bg-rose-950 text-white border-rose-800'
                : 'bg-slate-900 text-white border-slate-700'
            }`}
          >
            {notification.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
            {notification.type === 'error' && <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />}
            {notification.type === 'info' && <Sparkles className="w-4 h-4 text-indigo-400 shrink-0" />}
            <span>{notification.message}</span>
          </div>
        </div>
      )}

      {/* Main Container */}
      <main className={`flex-1 max-w-[1600px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col min-h-0 ${activeTab === 'sheet' ? 'space-y-4' : 'space-y-6'}`}>
        {/* Session Expired Banner */}
        {(!authState.isAuthenticated && authState.userEmail) && (
          <div className="bg-amber-50 border border-amber-300/80 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs animate-in fade-in duration-200">
            <div className="flex items-center space-x-3">
              <div className="w-9 h-9 rounded-lg bg-amber-100 border border-amber-200 flex items-center justify-center shrink-0">
                <Clock className="w-5 h-5 text-amber-700" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                  <span>Сесія Google закінчилася (1 година)</span>
                  <span className="text-[10px] font-normal text-amber-700 bg-amber-200/60 px-1.5 py-0.5 rounded">
                    {authState.userEmail}
                  </span>
                </h4>
                <p className="text-[11px] text-amber-700 mt-0.5">
                  Google обмежує дію OAuth-токена до 60 хвилин для безпеки. Натисніть кнопку поруч, щоб поновити зв&apos;язок в 1 клік — усі ваші відкриті документи та таблиці збережені.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleQuickRefreshSession}
              disabled={isRefreshingSession}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white rounded-lg text-xs font-bold shadow-xs transition-colors flex items-center space-x-1.5 shrink-0 self-end sm:self-auto disabled:opacity-50 cursor-pointer"
            >
              {isRefreshingSession ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <LogIn className="w-3.5 h-3.5" />
              )}
              <span>Поновити сесію в 1 клік</span>
            </button>
          </div>
        )}

        {/* Step 1 & 2 Setup Bars */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <DriveFolderBar
            accessToken={authState.accessToken}
            currentFolderId={driveFolderId}
            onSelectFolder={handleUpdateFolder}
            onFetchFiles={handleFetchDriveFiles}
            isLoading={isLoadingFolder}
            totalFilesInFolder={documents.filter((d) => d.source === 'drive').length}
            autoSyncIntervalMinutes={autoSyncIntervalMinutes}
            onChangeAutoSyncInterval={handleChangeAutoSyncInterval}
            autoOcrEnabled={autoOcrEnabled}
            onToggleAutoOcr={handleToggleAutoOcr}
            lastAutoSyncTime={lastAutoSyncTime}
            nextAutoSyncSeconds={nextAutoSyncSeconds}
            isAutoSyncing={isAutoSyncing}
          />

          <SpreadsheetBar
            accessToken={authState.accessToken}
            sheetConfig={sheetConfig}
            companyLists={companyLists}
            onUpdateSheetConfig={handleUpdateSheetConfig}
            onRefreshData={refreshSheetData}
            isLoading={isLoadingSheet}
          />
        </div>

        {/* View Mode: Process / OCR */}
        {activeTab === 'process' && (
          <div className="space-y-6">
            {/* Upload / Camera zone */}
            <UploadZone 
              onAddDocuments={handleAddLocalDocuments} 
              isDriveConnected={Boolean(authState.accessToken)}
            />

            {/* Document processing table */}
            <BatchProcessingTable
              documents={documents}
              onOpenReview={(doc) => setSelectedReviewDoc(doc)}
              onProcessDoc={handleProcessDocument}
              onBatchProcess={handleBatchProcess}
              onSyncDoc={handleSyncDocument}
              onBatchSync={handleBatchSync}
              onRemoveDoc={handleRemoveDoc}
              onClearAll={handleClearAll}
              onDeduplicate={handleDeduplicateDocuments}
              onRetryDriveUpload={handleUploadDocToDrive}
              isProcessingAny={isProcessingBatch}
              isSyncingAny={isSyncingBatch}
            />
          </div>
        )}

        {/* View Mode: Google Sheet Live Table */}
        {activeTab === 'sheet' && (
          <div className="flex-1 flex flex-col min-h-0">
            <SheetLivePreview
              sheetConfig={sheetConfig}
              existingInvoices={existingInvoices}
              existingPayments={existingPayments}
              companyLists={companyLists}
              onRefresh={refreshSheetData}
              isLoading={isLoadingSheet}
              onUpdateInvoiceStatus={handleUpdateInvoiceStatus}
              onBatchReconcile={handleBatchReconcileInvoiceStatuses}
              onDeleteDuplicates={handleDeleteDuplicateRows}
              onCompactEmptyRows={handleCompactEmptyRows}
              onChangePaymentsTab={handleChangePaymentsTab}
              onChangeInvoicesTab={handleChangeInvoicesTab}
              onDeleteInvoiceRow={handleDeleteInvoiceRow}
              onDeletePaymentRow={handleDeletePaymentRow}
              onMoveInvoiceToPayments={handleMoveInvoiceToPayments}
              onMovePaymentToInvoices={handleMovePaymentToInvoices}
              onNormalizeOverpaidInvoices={handleNormalizeOverpaidInvoices}
              documents={documents}
              onReplaceInvoice={handleReplaceInvoice}
              onAddLocalDocument={handleAddSingleLocalDocument}
              onMergeDuplicateInvoice={handleMergeDuplicateInvoice}
            />
          </div>
        )}

        {/* View Mode: Companies Management */}
        {activeTab === 'companies' && (
          <CompaniesTab
            companyLists={companyLists}
            sheetConfig={sheetConfig}
            onRefresh={refreshSheetData}
            accessToken={authState.accessToken || undefined}
            onNotify={notify}
          />
        )}
      </main>

      {/* App Footer */}
      <footer className="mt-auto border-t border-slate-200 bg-white py-3.5 px-4 sm:px-6 lg:px-8 text-xs text-slate-500 shadow-2xs">
        <div className="max-w-[1600px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-2.5">
          <div className="flex items-center space-x-2">
            <span className="font-bold text-slate-800 tracking-tight">ETS Invoice &amp; Payment</span>
            <span className="text-slate-300">•</span>
            <span 
              className="font-mono font-bold text-indigo-700 bg-indigo-50/80 border border-indigo-200/80 px-2 py-0.5 rounded text-[11px]"
              title="Поточний реліз застосунку з package.json"
            >
              {APP_VERSION}
            </span>
          </div>
          <p className="text-[11px] text-slate-400">
            Автоматизоване OCR-розпізнавання рахунків, рукописних замовлень №ххх-26 та синхронізація з Google Таблицями
          </p>
        </div>
      </footer>

      {/* Modal: Document Review & Verification */}
      <DocumentReviewModal
        document={activeReviewDoc}
        isOpen={Boolean(activeReviewDoc)}
        onClose={() => setSelectedReviewDoc(null)}
        onSave={handleSaveLocalData}
        onSyncToSheet={handleSyncDocument}
        onReprocess={handleProcessDocument}
        onUploadToDrive={handleUploadDocToDrive}
        isDriveConnected={Boolean(authState.accessToken)}
        companyLists={companyLists}
        existingInvoices={existingInvoices}
        existingPayments={existingPayments}
        allDocuments={documents}
        onPrevDoc={handlePrevReviewDoc}
        onNextDoc={handleNextReviewDoc}
        hasPrev={reviewDocIndex > 0}
        hasNext={reviewDocIndex < documents.length - 1}
        onReplaceInvoice={async (targetRowIndex, docId, cleanData, prevInfo, options) => {
          const doc = documents.find((d) => d.id === docId);
          await handleReplaceInvoice(targetRowIndex, cleanData, doc, prevInfo, options);
        }}
      />

      {/* Modal: Google Auth Connect */}
      <GoogleConnectModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onSuccess={() => {
          notify('Google акаунт успішно підключено!', 'success');
          refreshSheetData();
        }}
      />
    </div>
  );
}
