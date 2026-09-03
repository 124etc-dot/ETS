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
  OCRResult,
  InvoicePaymentStatus 
} from './types';
import { googleAuth, AuthState } from './services/googleAuth';
import { GoogleDriveService } from './services/googleDrive';
import { GoogleSheetsService } from './services/googleSheets';
import { OCRService } from './services/ocrService';
import { Header } from './components/Header';
import { DriveFolderBar } from './components/DriveFolderBar';
import { SpreadsheetBar } from './components/SpreadsheetBar';
import { UploadZone } from './components/UploadZone';
import { BatchProcessingTable } from './components/BatchProcessingTable';
import { DocumentReviewModal } from './components/DocumentReviewModal';
import { SheetLivePreview } from './components/SheetLivePreview';
import { CompaniesTab } from './components/CompaniesTab';
import { GoogleConnectModal } from './components/GoogleConnectModal';
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

  const [companyLists, setCompanyLists] = useState<SheetCompanyLists>({
    ourCompanies: DEFAULT_OUR_COMPANIES,
    suppliers: DEFAULT_SUPPLIERS,
  });
  const [existingInvoices, setExistingInvoices] = useState<ExistingSheetRow[]>([]);
  const existingInvoicesRef = useRef(existingInvoices);
  useEffect(() => {
    existingInvoicesRef.current = existingInvoices;
  }, [existingInvoices]);

  const [existingPayments, setExistingPayments] = useState<any[]>([]);
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
            // Permanently filter out any sample/demo invoices
            const realDocs = parsed.filter(
              (d: ProcessedDocument) => !d.id?.startsWith('sample_')
            );
            localStorage.setItem(DOCUMENTS_STORAGE_KEY, JSON.stringify(realDocs));
            return realDocs;
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

  // Save documents to localStorage whenever they change
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const lightweightDocs = documents.map((d) => ({
          ...d,
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
  }, [authState.accessToken, sheetConfig?.spreadsheetId]);

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
        setCompanyLists({
          ourCompanies: GoogleSheetsService.deduplicateCompanyList(
            lists.ourCompanies.length > 0 ? lists.ourCompanies : DEFAULT_OUR_COMPANIES
          ),
          suppliers: GoogleSheetsService.deduplicateCompanyList(
            lists.suppliers.length > 0 ? lists.suppliers : DEFAULT_SUPPLIERS
          ),
        });
      }

      const rows = await GoogleSheetsService.loadExistingInvoices(
        activeCfg.spreadsheetId,
        authState.accessToken,
        activeCfg.invoicesSheetName,
        availableTabs
      );
      setExistingInvoices(rows);

      const { payments, resolvedTabName } = await GoogleSheetsService.loadExistingPayments(
        activeCfg.spreadsheetId,
        authState.accessToken,
        activeCfg.paymentsSheetName,
        availableTabs
      );
      setExistingPayments(payments);

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
      setDocuments((prevDocs) =>
        prevDocs.map((d) => {
          const ocr = d.editedData || d.ocrResult;
          if (!ocr) return d;
          const check = OCRService.checkExistingDocumentInSheet(ocr, rows, payments);
          if (check.alreadyInSheet) {
            return {
              ...d,
              status: 'synced',
              syncedRowIndex: check.rowIndex,
              alreadyInSheet: true,
              alreadyInSheetReason: check.reason,
              alreadyInSheetTab: check.tabName,
            };
          }
          return d;
        })
      );
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

  // Process a single document with Gemini OCR
  const handleProcessDocument = async (docId: string, directDoc?: ProcessedDocument): Promise<void> => {
    const currentList = documentsRef.current;
    const doc = directDoc || currentList.find((d) => d.id === docId);
    if (!doc) return;

    setDocuments((prev) =>
      prev.map((d) => (d.id === docId ? { ...d, status: 'processing', errorMessage: undefined } : d))
    );

    try {
      let base64Payload = doc.previewDataUrl || '';
      let mimeType = doc.mimeType;

      // If document is on Drive and doesn't have base64 yet, download it
      if (!base64Payload && doc.driveFileId && authState.accessToken) {
        const downloaded = await GoogleDriveService.downloadFileBase64(
          doc.driveFileId,
          authState.accessToken
        );
        base64Payload = downloaded.base64;
        mimeType = downloaded.mimeType;
      }

      if (!base64Payload) {
        throw new Error('Вміст файлу не знайдено. Перевірте доступ до файлу.');
      }

      const ocrResult = await OCRService.analyzeDocument({
        fileData: base64Payload,
        mimeType,
        fileName: doc.fileName,
        ourCompanies: companyLists.ourCompanies,
        suppliers: companyLists.suppliers,
        knownOrders: KNOWN_PROJECT_ORDERS,
      });

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

      setDocuments((prev) =>
        prev.map((d) =>
          d.id === docId
            ? {
                ...d,
                status: sheetCheck.alreadyInSheet ? 'synced' : 'ready_for_review',
                syncedRowIndex: sheetCheck.rowIndex,
                alreadyInSheet: sheetCheck.alreadyInSheet,
                alreadyInSheetReason: sheetCheck.reason,
                alreadyInSheetTab: sheetCheck.tabName,
                ocrResult,
                editedData: ocrResult,
                previewDataUrl: base64Payload,
              }
            : d
        )
      );
    } catch (err: any) {
      setDocuments((prev) =>
        prev.map((d) =>
          d.id === docId
            ? {
                ...d,
                status: 'error',
                errorMessage: err.message || 'Помилка OCR розпізнавання.',
              }
            : d
        )
      );
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
      const newDocs: ProcessedDocument[] = files.map((f, idx) => ({
        id: `drive_${f.id}`,
        source: 'drive',
        driveFileId: f.id,
        fileName: f.name,
        fileSize: parseInt(f.size || '0', 10),
        mimeType: f.mimeType,
        driveLink: f.webViewLink,
        thumbnailUrl: f.thumbnailLink,
        status: 'pending',
        createdAt: f.createdTime ? new Date(f.createdTime).getTime() : (now + idx),
      }));

      // Filter to really new items not yet in documents
      const existingDriveIds = new Set(documentsRef.current.map((d) => d.driveFileId).filter(Boolean));
      const newlyAddedDocs = newDocs.filter((nd) => !existingDriveIds.has(nd.driveFileId));

      if (newlyAddedDocs.length > 0) {
        setDocuments((prev) => [...newlyAddedDocs, ...prev]);

        // Auto-trigger OCR if autoOcrEnabled is true
        if (autoOcrEnabled) {
          notify(`Знайдено ${newlyAddedDocs.length} нових файлів. Запускаємо авто-розпізнавання AI...`, 'info');
          setTimeout(() => {
            handleBatchProcess(newlyAddedDocs.map((d) => d.id));
          }, 300);
        } else {
          notify(`Знайдено ${newlyAddedDocs.length} нових файлів у папці Google Drive.`, 'success');
        }
      } else {
        if (!isAutoSync) {
          notify(`У папці ${files.length} файлів. Усі вже додані до списку.`, 'info');
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
  const handleSyncDocument = async (docId: string, customOcr?: OCRResult): Promise<void> => {
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

    // Safety Duplicate Check: ensure doc hasn't already been written to the sheet
    const doubleCheck = OCRService.checkExistingDocumentInSheet(
      dataToSync,
      existingInvoicesRef.current,
      existingPaymentsRef.current
    );

    if (doubleCheck.alreadyInSheet && !doc.alreadyInSheet) {
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
              }
            : d
        )
      );
      notify(
        `Документ "${doc.fileName}" вже внесено у таблицю (${doubleCheck.reason}). Повторне внесення скасовано.`,
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
        });

        // 2. Fetch fresh invoices directly from Google Sheets to ensure exact row index and status
        const freshInvoices = await GoogleSheetsService.loadExistingInvoices(
          sheetConfig.spreadsheetId,
          authState.accessToken
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
                m.paidAmount || 0
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
          fileName: doc.fileName,
          driveLink: doc.driveLink,
        });
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
  const handleUpdateInvoiceStatus = async (rowIndex: number, newStatus: InvoicePaymentStatus) => {
    if (!sheetConfig?.spreadsheetId || !authState.accessToken) {
      setExistingInvoices((prev) =>
        prev.map((inv) => (inv.rowIndex === rowIndex ? { ...inv, paymentStatus: newStatus } : inv))
      );
      notify(`Статус рахунку оновлено на "${newStatus}"`, 'success');
      return;
    }

    try {
      await GoogleSheetsService.updateInvoiceStatusInSheet(
        sheetConfig.spreadsheetId,
        authState.accessToken,
        rowIndex,
        newStatus
      );
      setExistingInvoices((prev) =>
        prev.map((inv) => (inv.rowIndex === rowIndex ? { ...inv, paymentStatus: newStatus } : inv))
      );
      notify(`Статус у Google Таблиці (рядок ${rowIndex}) оновлено на "${newStatus}"!`, 'success');
    } catch (err: any) {
      notify(err.message || 'Помилка оновлення статусу в Google Таблиці.', 'error');
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

  const handleSaveLocalData = (docId: string, updatedOcr: OCRResult) => {
    setDocuments((prev) =>
      prev.map((d) => (d.id === docId ? { ...d, editedData: updatedOcr } : d))
    );
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
    const now = Date.now();
    const docsWithStatus = newDocs.map((d, idx) => ({
      ...d,
      createdAt: d.createdAt || (now + idx),
      driveUploadStatus: authState.accessToken ? ('uploading' as const) : ('idle' as const),
    }));

    setDocuments((prev) => [...docsWithStatus, ...prev]);

    // Auto-upload to Google Drive in background if connected
    if (authState.accessToken) {
      docsWithStatus.forEach((d) => {
        handleUploadDocToDrive(d.id, d);
      });
    }
    
    if (autoOcrEnabled) {
      notify(
        authState.accessToken
          ? `Додано ${newDocs.length} файлів. Зберігаємо на Google Диск та запускаємо AI-розпізнавання...`
          : `Додано ${newDocs.length} файлів. Запускаємо AI-розпізнавання...`,
        'info'
      );
      setTimeout(() => {
        handleBatchProcess(newDocs.map((d) => d.id));
      }, 200);
    } else {
      notify(
        authState.accessToken
          ? `Додано ${newDocs.length} файлів (зберігаються на Google Диск). Натисніть "Обробити AI", щоб розпізнати.`
          : `Додано ${newDocs.length} файлів. Натисніть "Обробити AI", щоб розпізнати.`,
        'info'
      );
    }
  };

  const handleRemoveDoc = (docId: string) => {
    setDocuments((prev) => prev.filter((d) => d.id !== docId));
  };

  const handleClearAll = () => {
    if (window.confirm('Очистити всі документи зі списку?')) {
      setDocuments([]);
    }
  };

  // Navigation inside review modal
  const reviewDocIndex = selectedReviewDoc
    ? documents.findIndex((d) => d.id === selectedReviewDoc.id)
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
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
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
              onRetryDriveUpload={handleUploadDocToDrive}
              isProcessingAny={isProcessingBatch}
              isSyncingAny={isSyncingBatch}
            />
          </div>
        )}

        {/* View Mode: Google Sheet Live Table */}
        {activeTab === 'sheet' && (
          <SheetLivePreview
            sheetConfig={sheetConfig}
            existingInvoices={existingInvoices}
            existingPayments={existingPayments}
            companyLists={companyLists}
            onRefresh={refreshSheetData}
            isLoading={isLoadingSheet}
            onUpdateInvoiceStatus={handleUpdateInvoiceStatus}
            onChangePaymentsTab={handleChangePaymentsTab}
          />
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

      {/* Modal: Document Review & Verification */}
      <DocumentReviewModal
        document={selectedReviewDoc}
        isOpen={Boolean(selectedReviewDoc)}
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
