import React, { useState, useEffect } from 'react';
import { 
  X, 
  Check, 
  AlertTriangle, 
  ZoomIn, 
  ZoomOut, 
  RotateCw, 
  FileSpreadsheet, 
  Sparkles, 
  PenTool, 
  Building2, 
  Calendar, 
  DollarSign, 
  FileText, 
  ShieldAlert, 
  ChevronLeft, 
  ChevronRight,
  ExternalLink,
  Info,
  RefreshCw,
  RotateCcw,
  AlertCircle
} from 'lucide-react';
import { ProcessedDocument, OCRResult, SheetCompanyLists, ExistingSheetRow, ExistingPaymentRow } from '../types';
import { OCRService } from '../services/ocrService';
import { KNOWN_PROJECT_ORDERS } from '../data/sampleDocuments';
import { CreditCard, Link as LinkIcon, CheckCircle2 } from 'lucide-react';

interface Props {
  document: ProcessedDocument | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (docId: string, updatedOcr: OCRResult) => void;
  onSyncToSheet: (docId: string, customOcr?: OCRResult) => Promise<void>;
  onReprocess?: (docId: string) => Promise<void>;
  onUploadToDrive?: (docId: string) => Promise<void>;
  isDriveConnected?: boolean;
  companyLists: SheetCompanyLists;
  existingInvoices?: ExistingSheetRow[];
  existingPayments?: ExistingPaymentRow[];
  allDocuments?: ProcessedDocument[];
  onPrevDoc?: () => void;
  onNextDoc?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
}

export const DocumentReviewModal: React.FC<Props> = ({
  document: doc,
  isOpen,
  onClose,
  onSave,
  onSyncToSheet,
  onReprocess,
  onUploadToDrive,
  isDriveConnected,
  companyLists,
  existingInvoices = [],
  existingPayments = [],
  allDocuments = [],
  onPrevDoc,
  onNextDoc,
  hasPrev,
  hasNext,
}) => {
  const [formData, setFormData] = useState<OCRResult>({
    documentType: 'invoice',
    documentTypeUkrainian: 'Рахунок на оплату',
    handwrittenOrderNumber: '',
    handwrittenConfidence: 'none',
    supplierName: '',
    buyerName: companyLists.ourCompanies[0] || '',
    invoiceNumber: '',
    invoiceDate: new Date().toISOString().slice(0, 10),
    totalAmount: 0,
    currency: 'UAH',
    confidenceScore: 0,
  });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isReprocessing, setIsReprocessing] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [showServerHelp, setShowServerHelp] = useState(false);

  useEffect(() => {
    if (doc) {
      const current = doc.editedData || doc.ocrResult || {
        documentType: 'invoice',
        documentTypeUkrainian: 'Рахунок на оплату',
        handwrittenOrderNumber: '',
        handwrittenConfidence: 'none',
        supplierName: '',
        buyerName: companyLists.ourCompanies[0] || '',
        invoiceNumber: '',
        invoiceDate: new Date().toISOString().slice(0, 10),
        totalAmount: 0,
        currency: 'UAH',
        confidenceScore: 0,
      };
      setFormData(current);
      setZoom(1);
      setRotation(0);
      setSavedSuccess(false);
    }
  }, [doc?.id, doc?.editedData, doc?.ocrResult, doc?.status]);

  if (!isOpen || !doc) return null;

  const isPaymentDoc = formData.documentType === 'payment';

  const handleChange = (field: keyof OCRResult, value: any) => {
    setFormData((prev) => {
      const updated = {
        ...prev,
        [field]: value,
      };

      // If updating paymentPurpose, try re-extracting referenced invoice
      if (field === 'paymentPurpose' && typeof value === 'string') {
        const invMatch = value.match(/(?:рахун(?:ок|ку|ком|ка)?|счет[а-я]*|рах\.?|СФ-?|№)\s*[:№#]?\s*([A-Za-zА-Яа-я0-9\-\/]{2,20})/i);
        if (invMatch && !updated.referencedInvoiceNumber) {
          updated.referencedInvoiceNumber = invMatch[1].trim();
        }
      }

      // If updating payment amount or referenced invoice on payment, re-evaluate match
      if (updated.documentType === 'payment' && (field === 'totalAmount' || field === 'referencedInvoiceNumber' || field === 'referencedInvoiceNumbers' || field === 'paymentPurpose')) {
        const allMatches = OCRService.matchPaymentWithAllInvoices(updated, existingInvoices, allDocuments);
        if (allMatches.length > 0) {
          updated.matchedInvoices = allMatches;
          updated.paymentStatus = allMatches[0].computedStatus;
          updated.matchedInvoiceNumber = allMatches.map((m) => m.invoiceNumber).filter(Boolean).join(', ');
          updated.matchedInvoiceAmount = allMatches.reduce((acc, m) => acc + (m.invoiceAmount || 0), 0);
          updated.matchedInvoiceRowIndex = allMatches[0].matchedRowIndex;
        }
      }

      // If updating invoice details, re-evaluate matching payments
      if (updated.documentType !== 'payment' && (field === 'totalAmount' || field === 'invoiceNumber' || field === 'handwrittenOrderNumber' || field === 'supplierName')) {
        const invoiceMatch = OCRService.matchInvoiceWithPayments(updated, existingPayments, allDocuments);
        if (invoiceMatch.computedStatus && invoiceMatch.computedStatus !== 'Не оплачено') {
          updated.paymentStatus = invoiceMatch.computedStatus;
          updated.paidAmount = invoiceMatch.totalPaidAmount;
          updated.matchedPaymentNumber = invoiceMatch.matchedPaymentNumbers.join(', ');
          updated.matchedPaymentAmount = invoiceMatch.totalPaidAmount;
          updated.matchedPaymentsSummary = invoiceMatch.matchReason;
        }
      }

      return updated;
    });
  };

  const handleOrderNumberBlur = () => {
    if (formData.handwrittenOrderNumber) {
      const normalized = OCRService.normalizeOrderNumber(formData.handwrittenOrderNumber);
      handleChange('handwrittenOrderNumber', normalized);
    }
  };

  const handleSupplierBlur = () => {
    if (formData.supplierName) {
      const normalized = OCRService.normalizeCompanyName(formData.supplierName);
      handleChange('supplierName', normalized);
    }
  };

  const handleBuyerBlur = () => {
    if (formData.buyerName) {
      const normalized = OCRService.normalizeCompanyName(formData.buyerName);
      handleChange('buyerName', normalized);
    }
  };

  const handlePayerBlur = () => {
    if (formData.payerName) {
      const normalized = OCRService.normalizeCompanyName(formData.payerName);
      handleChange('payerName', normalized);
    }
  };

  const handlePayeeBlur = () => {
    if (formData.payeeName) {
      const normalized = OCRService.normalizeCompanyName(formData.payeeName);
      handleChange('payeeName', normalized);
    }
  };

  const getCleanFormData = (): OCRResult => {
    const clean: OCRResult = {
      ...formData,
      handwrittenOrderNumber: OCRService.normalizeOrderNumber(formData.handwrittenOrderNumber || ''),
      supplierName: OCRService.normalizeCompanyName(formData.supplierName || ''),
      buyerName: OCRService.normalizeCompanyName(formData.buyerName || ''),
      payerName: OCRService.normalizeCompanyName(formData.payerName || formData.buyerName || ''),
      payeeName: OCRService.normalizeCompanyName(formData.payeeName || formData.supplierName || ''),
    };

    if (clean.documentType === 'payment') {
      const match = OCRService.matchPaymentWithInvoices(clean, existingInvoices, allDocuments);
      clean.paymentStatus = match.computedStatus;
      clean.matchedInvoiceNumber = match.matchedInvoiceNumber;
      clean.matchedInvoiceAmount = match.invoiceAmount;
      clean.matchedInvoiceRowIndex = match.matchedRowIndex;
    } else {
      const match = OCRService.matchInvoiceWithPayments(clean, existingPayments, allDocuments);
      if (match.computedStatus && match.computedStatus !== 'Не оплачено') {
        clean.paymentStatus = match.computedStatus;
        clean.paidAmount = match.totalPaidAmount;
        clean.matchedPaymentNumber = match.matchedPaymentNumbers.join(', ');
        clean.matchedPaymentAmount = match.totalPaidAmount;
        clean.matchedPaymentsSummary = match.matchReason;
      }
    }

    return clean;
  };

  const handleSaveLocal = () => {
    const cleanData = getCleanFormData();
    if ((cleanData.totalAmount || 0) <= 0 && (cleanData.amountPaid || 0) <= 0) {
      alert('Увага: Сума документа не може бути 0 грн. Будь ласка, введіть суму з документа перед збереженням.');
      return;
    }
    setFormData(cleanData);
    onSave(doc.id, cleanData);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2000);
  };

  const handleSync = async () => {
    const cleanData = getCleanFormData();
    if ((cleanData.totalAmount || 0) <= 0 && (cleanData.amountPaid || 0) <= 0) {
      alert('Увага: Занесення в Google Таблицю заблоковано, оскільки сума документа дорівнює 0 грн. В системі не може бути рахунків чи платіжок з нульовою сумою. Будь ласка, вкажіть суму.');
      return;
    }
    setFormData(cleanData);
    setIsSyncing(true);
    try {
      await onSyncToSheet(doc.id, cleanData);
    } finally {
      setIsSyncing(false);
    }
  };

  // Check if supplier equals any company in our companies
  const effectiveSupplier = isPaymentDoc ? (formData.payeeName || formData.supplierName) : formData.supplierName;
  const isSupplierInOurCompanies = companyLists.ourCompanies.some(
    (c) => c.toLowerCase().trim() === (effectiveSupplier || '').toLowerCase().trim()
  );

  const cleanOrderCode = (formData.handwrittenOrderNumber || '').replace(/[№#\s]/g, '').trim();
  const matchedProjectOrder = KNOWN_PROJECT_ORDERS.find(
    (o) => o.code === cleanOrderCode || cleanOrderCode.startsWith(o.code) || o.code.replace(/[№\s-]/g, '') === cleanOrderCode.replace(/-/g, '')
  );

  // Find matched invoices for payment
  const paymentMatches = isPaymentDoc
    ? OCRService.matchPaymentWithAllInvoices(formData, existingInvoices, allDocuments)
    : [];
  const paymentMatchInfo = isPaymentDoc
    ? OCRService.matchPaymentWithInvoices(formData, existingInvoices, allDocuments)
    : null;

  // Find matched payments for invoice (when payment was uploaded first or is already in "Платіжки")
  const invoicePaymentMatch = !isPaymentDoc
    ? OCRService.matchInvoiceWithPayments(formData, existingPayments, allDocuments)
    : null;

  const allExtractedInvoiceNumbers = isPaymentDoc
    ? OCRService.extractAllInvoiceNumbers(formData.referencedInvoiceNumber, formData.referencedInvoiceNumbers, formData.paymentPurpose)
    : [];
  const ignoredExternalInvoiceNumbers = allExtractedInvoiceNumbers.filter(
    (rn) => !paymentMatches.some((m) => {
      const cleanM = OCRService.normalizeInvoiceNumber(m.invoiceNumber);
      const cleanRN = OCRService.normalizeInvoiceNumber(rn);
      return cleanM === cleanRN || cleanM.includes(cleanRN) || cleanRN.includes(cleanM);
    })
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-2 sm:p-4 animate-in fade-in">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl h-[92vh] flex flex-col overflow-hidden border border-slate-200">
        {/* Modal Header */}
        <div className="px-6 py-3.5 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center">
              <div className="w-3.5 h-3.5 border border-white rotate-45"></div>
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-sm font-bold truncate max-w-md">{doc.fileName}</h2>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                  {doc.mimeType.includes('pdf') ? 'PDF' : 'Image'}
                </span>
                {doc.status === 'synced' && (
                  <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    Занесено
                  </span>
                )}
                {doc.driveUploadStatus === 'uploading' && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center space-x-1">
                    <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                    <span>Збереження на Диск...</span>
                  </span>
                )}
                {(doc.driveWebViewLink || doc.driveLink) && (
                  <a
                    href={doc.driveWebViewLink || doc.driveLink}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] font-semibold px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 hover:text-white border border-indigo-500/30 flex items-center space-x-1 transition-colors"
                    title="Відкрити файл на Google Диску"
                  >
                    <span>Google Диск</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                )}
                {doc.driveUploadStatus === 'failed' && onUploadToDrive && (
                  <button
                    onClick={() => onUploadToDrive(doc.id)}
                    className="text-[10px] font-semibold px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 hover:text-white border border-rose-500/30 flex items-center space-x-1 transition-colors"
                    title="Спробувати зберегти на Диск ще раз"
                  >
                    <AlertCircle className="w-2.5 h-2.5" />
                    <span>Повторити збереження на Диск</span>
                  </button>
                )}
              </div>
              <p className="text-[11px] text-slate-400">
                Перевірка та валідація розпізнаних даних
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-1.5">
            {hasPrev && (
              <button
                onClick={onPrevDoc}
                className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
                title="Попередній документ"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
            {hasNext && (
              <button
                onClick={onNextDoc}
                className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
                title="Наступний документ"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors ml-2"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Modal Body: Split view */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Left: Document Viewer */}
          <div className="w-full md:w-1/2 bg-slate-100 border-r border-slate-200 flex flex-col h-[40vh] md:h-full relative overflow-hidden">
            {/* Viewer Controls */}
            <div className="absolute top-3 left-3 z-10 bg-white/95 px-2.5 py-1 rounded-lg shadow-xs border border-slate-200 flex items-center space-x-2 text-xs">
              <button
                onClick={() => setZoom((z) => Math.min(z + 0.2, 2.5))}
                className="p-1 text-slate-700 hover:text-indigo-600 transition-colors"
                title="Збільшити"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <span className="text-[11px] font-mono text-slate-500">{Math.round(zoom * 100)}%</span>
              <button
                onClick={() => setZoom((z) => Math.max(z - 0.2, 0.5))}
                className="p-1 text-slate-700 hover:text-indigo-600 transition-colors"
                title="Зменшити"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="text-slate-300">|</span>
              <button
                onClick={() => setRotation((r) => (r + 90) % 360)}
                className="p-1 text-slate-700 hover:text-indigo-600 transition-colors"
                title="Повернути на 90°"
              >
                <RotateCw className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Document Canvas / Image Container */}
            <div className="flex-1 overflow-auto p-4 flex items-center justify-center">
              {doc.previewDataUrl ? (
                doc.mimeType === 'application/pdf' ? (
                  <iframe
                    src={`${doc.previewDataUrl}#toolbar=0`}
                    title="PDF Viewer"
                    className="w-full h-full rounded-lg border border-slate-300 bg-white shadow-xs"
                    style={{
                      transform: `scale(${zoom}) rotate(${rotation}deg)`,
                      transformOrigin: 'center center',
                      transition: 'transform 0.15s ease-out',
                    }}
                  />
                ) : (
                  <img
                    src={doc.previewDataUrl}
                    alt="Document preview"
                    className="max-w-full max-h-full object-contain rounded-lg shadow-sm"
                    style={{
                      transform: `scale(${zoom}) rotate(${rotation}deg)`,
                      transformOrigin: 'center center',
                      transition: 'transform 0.15s ease-out',
                    }}
                  />
                )
              ) : doc.driveLink ? (
                <div className="text-center p-6 space-y-3">
                  <FileText className="w-10 h-10 text-slate-400 mx-auto" />
                  <p className="text-xs text-slate-600 font-medium">
                    Документ завантажено з Google Drive
                  </p>
                  <a
                    href={doc.driveLink}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg text-xs font-semibold hover:bg-indigo-100 transition-colors"
                  >
                    <span>Відкрити на Google Диску</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              ) : (
                <div className="text-xs text-slate-400">Попередній перегляд недоступний</div>
              )}
            </div>

            {/* Handwriting detection location banner */}
            {formData.handwrittenLocation && (
              <div className="bg-amber-50 border-t border-amber-200 p-2.5 px-4 text-xs text-amber-900 flex items-center justify-between shrink-0">
                <div className="flex items-center space-x-2">
                  <PenTool className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span>
                    <strong>Знайдено рукописний напис:</strong> {formData.handwrittenLocation}
                    {formData.handwrittenRawText && (
                      <span className="ml-1.5 font-mono text-amber-950 font-bold bg-amber-200/70 px-1.5 py-0.5 rounded">
                        "{formData.handwrittenRawText}"
                      </span>
                    )}
                  </span>
                </div>
                <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded ${
                  formData.handwrittenConfidence === 'high'
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-amber-200 text-amber-900'
                }`}>
                  Впевненість: {formData.handwrittenConfidence}
                </span>
              </div>
            )}
          </div>

          {/* Right: Data Form */}
          <div className="w-full md:w-1/2 bg-white flex flex-col h-[60vh] md:h-full overflow-y-auto p-6 space-y-4">
            {/* Already in Sheet Warning Banner */}
            {doc.status === 'synced' ? (
              <div className="p-3.5 bg-emerald-50 border border-emerald-300 rounded-xl flex items-start space-x-2 text-xs text-emerald-950 shadow-xs">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="flex items-center space-x-2">
                    <strong className="font-bold text-emerald-900">Внесено в Google Таблицю</strong>
                    {doc.syncedRowIndex && (
                      <span className="text-[10px] bg-emerald-200 text-emerald-900 font-mono font-bold px-2 py-0.5 rounded">
                        рядок {doc.syncedRowIndex}
                      </span>
                    )}
                  </div>
                  <p className="text-emerald-800 mt-1">
                    {doc.alreadyInSheetReason || `Документ записано у вкладку "${doc.alreadyInSheetTab || (isPaymentDoc ? 'Платіжки' : 'Рахунки')}".`}
                  </p>
                </div>
              </div>
            ) : doc.alreadyInSheet ? (
              <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-xl flex items-start space-x-2 text-xs text-amber-950 shadow-xs">
                <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="flex items-center space-x-2">
                    <strong className="font-bold text-amber-900">Схожий запис знайдено в Google Таблиці</strong>
                    {doc.syncedRowIndex && (
                      <span className="text-[10px] bg-amber-200 text-amber-900 font-mono font-bold px-2 py-0.5 rounded">
                        рядок {doc.syncedRowIndex}
                      </span>
                    )}
                  </div>
                  <p className="text-amber-800 mt-1">
                    {doc.alreadyInSheetReason || `У таблиці знайдено схожий запис.`}
                  </p>
                  <p className="text-[11px] text-amber-700 mt-1 font-medium">
                    Якщо це новий рахунок або додаткове замовлення, перевірте дані та натисніть кнопку "Занести в Google Таблицю".
                  </p>
                </div>
              </div>
            ) : null}

            {/* In-progress processing banner */}
            {doc.status === 'processing' && (
              <div className="p-3.5 bg-indigo-50 border border-indigo-200 rounded-xl flex items-center justify-between gap-3 text-xs text-indigo-900 shadow-xs">
                <div className="flex items-center space-x-3">
                  <Sparkles className="w-5 h-5 text-indigo-600 shrink-0 animate-spin" />
                  <div>
                    <strong className="block font-bold text-indigo-950">Триває OCR-розпізнавання документа...</strong>
                    <p className="text-indigo-700 mt-0.5">Gemini AI зчитує реквізити та суми. Зазвичай це займає 1–3 секунди.</p>
                  </div>
                </div>
                {onReprocess && (
                  <button
                    type="button"
                    onClick={async () => {
                      setIsReprocessing(true);
                      try {
                        await onReprocess(doc.id);
                      } finally {
                        setIsReprocessing(false);
                      }
                    }}
                    disabled={isReprocessing}
                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold text-xs transition-colors flex items-center space-x-1.5 shrink-0 shadow-2xs cursor-pointer"
                    title="Якщо розпізнавання зависло, натисніть для негайного перезапуску"
                  >
                    <RotateCcw className={`w-3.5 h-3.5 ${isReprocessing ? 'animate-spin' : ''}`} />
                    <span>{isReprocessing ? 'Перезапуск...' : 'Перезапустити розпізнавання'}</span>
                  </button>
                )}
              </div>
            )}

            {/* Error Notification banner if OCR had an issue */}
            {doc.errorMessage && doc.status !== 'processing' && (
              <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl space-y-2 text-xs text-rose-900 shadow-xs">
                <div className="flex items-start justify-between">
                  <div className="flex items-start space-x-2">
                    <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <div>
                      <strong className="block font-bold text-rose-950">Помилка під час зчитування:</strong>
                      <p className="text-rose-800 mt-0.5">{doc.errorMessage}</p>
                      <p className="text-[11px] text-rose-600 mt-1">Ви можете відредагувати поля вручну або повторити авторозпізнавання.</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2 ml-3 shrink-0">
                    <button
                      type="button"
                      onClick={() => setShowServerHelp(!showServerHelp)}
                      className="px-2 py-1 bg-white hover:bg-rose-100 text-rose-800 border border-rose-300 rounded-lg font-medium text-[11px] transition-colors"
                    >
                      {showServerHelp ? 'Сховати інструкцію' : 'Як виправити?'}
                    </button>
                    {onReprocess && (
                      <button
                        type="button"
                        onClick={async () => {
                          setIsReprocessing(true);
                          try {
                            await onReprocess(doc.id);
                          } finally {
                            setIsReprocessing(false);
                          }
                        }}
                        disabled={isReprocessing || doc.status === 'processing'}
                        className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-semibold text-xs transition-colors flex items-center space-x-1 disabled:opacity-50"
                      >
                        <Sparkles className={`w-3.5 h-3.5 ${isReprocessing || doc.status === 'processing' ? 'animate-spin' : ''}`} />
                        <span>{isReprocessing || doc.status === 'processing' ? 'Обробка...' : 'Спробувати знову'}</span>
                      </button>
                    )}
                  </div>
                </div>

                {showServerHelp && (
                  <div className="mt-2 pt-2.5 border-t border-rose-200 text-[11px] text-slate-700 space-y-2 bg-white/70 p-3 rounded-lg">
                    <p className="font-bold text-slate-900">Чому це виникає і як правильно запустити програму:</p>
                    <ol className="list-decimal list-inside space-y-1 text-slate-600 pl-1">
                      <li>
                        <strong>Якщо ви відкрили посилання в браузері:</strong> відкривайте його у <u>звичайній вкладці</u> браузера (не через «Встановити як додаток / PWA»), оскільки окреме вікно додатка браузера інколи блокує службові cookie авторизації Google (і шлюз повертає 404/405).
                      </li>
                      <li>
                        <strong>Якщо ви запускаєте на компʼютері (локально):</strong> двічі клікніть <code className="bg-slate-100 px-1 py-0.5 rounded font-mono text-slate-800 font-bold">start-app.bat</code> у папці проєкту (або запустіть у терміналі <code className="bg-slate-100 px-1 py-0.5 rounded font-mono text-slate-800 font-bold">npm run dev</code>) і відкрийте <code className="bg-slate-100 px-1 py-0.5 rounded font-mono text-slate-800 font-bold">http://localhost:3000</code>.
                      </li>
                    </ol>
                  </div>
                )}
              </div>
            )}

            {/* Payment Specific Section */}
            {isPaymentDoc && (
              <div className="border border-blue-200 bg-blue-50/50 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1.5 text-xs font-bold text-blue-950">
                    <LinkIcon className="w-4 h-4 text-blue-600" />
                    <span>Прив'язка платіжки до рахунку (Призначення платежу)</span>
                  </div>
                  <span className="text-[10px] bg-blue-100 text-blue-900 font-bold px-2 py-0.5 rounded border border-blue-300">
                    Стовпчик J (Сума оплати)
                  </span>
                </div>

                {/* Extracted Invoice Number from Purpose */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-xs font-semibold text-blue-950 mb-1">
                      Номер рахунку (витягнуто з призначення)
                    </label>
                    <input
                      type="text"
                      value={formData.referencedInvoiceNumber || ''}
                      onChange={(e) => handleChange('referencedInvoiceNumber', e.target.value)}
                      placeholder="наприклад: 451 або СФ-000451"
                      className="w-full text-xs font-mono font-bold p-2 bg-white border border-blue-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 text-blue-950"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-blue-950 mb-1">
                      Номер замовлення (якщо є)
                    </label>
                    <input
                      type="text"
                      value={formData.handwrittenOrderNumber || ''}
                      onChange={(e) => handleChange('handwrittenOrderNumber', e.target.value)}
                      onBlur={handleOrderNumberBlur}
                      placeholder="наприклад: 142-26"
                      className="w-full text-xs font-mono font-bold p-2 bg-white border border-blue-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 text-blue-950"
                    />
                  </div>
                </div>

                {/* Match Result Preview Box */}
                {paymentMatches && paymentMatches.length > 1 ? (
                  <div className="p-3 bg-white rounded-lg border border-emerald-200 text-xs space-y-2 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-1.5 text-emerald-950 font-bold">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        <span>Знайдено {paymentMatches.length} рахунки(ів) за цією платіжкою:</span>
                      </div>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-900 border border-blue-300">
                        Групова оплата
                      </span>
                    </div>

                    <div className="border border-slate-200 rounded-lg overflow-hidden">
                      <table className="w-full text-left text-[11px]">
                        <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                          <tr>
                            <th className="p-1.5">Рахунок</th>
                            <th className="p-1.5">Замовлення</th>
                            <th className="p-1.5 text-right">Сума рах.</th>
                            <th className="p-1.5 text-right">Оплата</th>
                            <th className="p-1.5 text-center">Статус</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {paymentMatches.map((pm, idx) => (
                            <tr key={idx} className="hover:bg-slate-50">
                              <td className="p-1.5 font-bold font-mono text-slate-900">
                                {pm.invoiceNumber}
                                {pm.matchedRowIndex && (
                                  <span className="text-[9px] text-slate-400 block">ряд. {pm.matchedRowIndex}</span>
                                )}
                              </td>
                              <td className="p-1.5 font-mono text-slate-600">{pm.orderNumber || '—'}</td>
                              <td className="p-1.5 text-right font-mono text-slate-700">
                                {new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(pm.invoiceAmount || 0)} грн
                              </td>
                              <td className="p-1.5 text-right font-mono font-bold text-blue-900">
                                {new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(pm.paidAmount || 0)} грн
                              </td>
                              <td className="p-1.5 text-center">
                                <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                  pm.computedStatus === 'Оплачено'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : 'bg-amber-100 text-amber-900'
                                }`}>
                                  {pm.computedStatus}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-700 bg-slate-50 p-2 rounded">
                      <div>
                        <span className="text-slate-500">Загальна сума рахунків: </span>
                        <span className="font-mono font-bold text-slate-900">
                          {new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
                            paymentMatches.reduce((acc, m) => acc + (m.invoiceAmount || 0), 0)
                          )} грн
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500">Сума цієї платіжки: </span>
                        <span className="font-mono font-bold text-blue-950">
                          {new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(formData.totalAmount || 0)} грн
                        </span>
                      </div>
                    </div>

                    {ignoredExternalInvoiceNumbers.length > 0 && (
                      <div className="p-2 bg-slate-50 border border-slate-200 rounded text-[11px] text-slate-600 flex items-start space-x-1.5">
                        <span className="font-semibold text-slate-700 whitespace-nowrap">Проігноровано:</span>
                        <span>
                          Рахунки <strong>{ignoredExternalInvoiceNumbers.join(', ')}</strong> з призначення платежу відсутні у вкладці «Рахунки» (наприклад, інші послуги чи матеріали) та не впливають на виконання виробничих замовлень.
                        </span>
                      </div>
                    )}

                    <p className="text-[11px] text-emerald-800 bg-emerald-50/70 p-2 rounded border border-emerald-200">
                      ℹ️ <strong>Бухгалтерське правило:</strong> Для платіжок з кількома рахунками кожен знайдений рахунок автоматично вважається оплаченим на <strong>100%</strong> (сума оплати в стовпчик J читається з суми самого рахунку, статус «Оплачено»). Часткова передоплата завжди оформлюється окремою платіжкою з одним рахунком.
                    </p>
                  </div>
                ) : paymentMatchInfo && paymentMatchInfo.matchedRowIndex ? (
                  <div className="p-3 bg-white rounded-lg border border-emerald-200 text-xs space-y-1.5 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-1.5 text-emerald-950 font-bold">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        <span>Знайдено рахунок у таблиці: рядок №{paymentMatchInfo.matchedRowIndex}</span>
                      </div>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        paymentMatchInfo.computedStatus === 'Оплачено'
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                          : 'bg-amber-100 text-amber-900 border border-amber-300'
                      }`}>
                        {paymentMatchInfo.computedStatus}
                      </span>
                    </div>

                    <div className={`grid ${paymentMatchInfo.matchedInvoicePreviousPaid && paymentMatchInfo.matchedInvoicePreviousPaid > 0 ? 'grid-cols-3' : 'grid-cols-2'} gap-2 text-[11px] text-slate-700 bg-slate-50 p-2 rounded`}>
                      <div>
                        <span className="text-slate-500">Сума рахунку: </span>
                        <span className="font-mono font-bold text-slate-900 block">
                          {new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(paymentMatchInfo.invoiceAmount || 0)} грн
                        </span>
                      </div>
                      {paymentMatchInfo.matchedInvoicePreviousPaid && paymentMatchInfo.matchedInvoicePreviousPaid > 0 ? (
                        <>
                          <div>
                            <span className="text-slate-500">Було сплачено: </span>
                            <span className="font-mono font-bold text-amber-700 block">
                              {new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(paymentMatchInfo.matchedInvoicePreviousPaid)} грн
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-500">Нова доплата: </span>
                            <span className="font-mono font-bold text-blue-950 block">
                              +{new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(formData.totalAmount || 0)} грн
                            </span>
                          </div>
                        </>
                      ) : (
                        <div>
                          <span className="text-slate-500">Сума платіжки: </span>
                          <span className="font-mono font-bold text-blue-950 block">
                            {new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(formData.totalAmount || 0)} грн
                          </span>
                        </div>
                      )}
                    </div>

                    {paymentMatchInfo.matchedInvoicePreviousPaid && paymentMatchInfo.matchedInvoicePreviousPaid > 0 ? (
                      <p className="text-[11px] text-emerald-800 bg-emerald-50/70 p-1.5 rounded border border-emerald-200">
                        ℹ️ <strong>Виявлено доплату:</strong> Раніше було сплачено {new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(paymentMatchInfo.matchedInvoicePreviousPaid)} грн. Разом після цієї платіжки буде сплачено <span className="font-bold font-mono text-emerald-950">{new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format((paymentMatchInfo.matchedInvoicePreviousPaid || 0) + (formData.totalAmount || 0))} грн</span>. У стовпчик J запишеться оновлена загальна сума оплати, а статус стане «{paymentMatchInfo.computedStatus}». Новий рядок рахунку не створюється.
                      </p>
                    ) : (
                      <p className="text-[11px] text-emerald-800">
                        ℹ️ При занесенні в таблицю статус рахунку (стовпчик H) оновиться на <span className="font-bold">«{paymentMatchInfo.computedStatus}»</span>, а в стовпчик J запишеться <span className="font-bold font-mono">{paymentMatchInfo.matchedInvoices?.[0]?.paidAmount || paymentMatchInfo.paymentAmount || formData.totalAmount} грн</span>.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="p-2.5 bg-amber-50 rounded-lg border border-amber-200 text-xs text-amber-900">
                    <p className="font-semibold">⚠️ Рахунок за номером "{formData.referencedInvoiceNumber || '—'}" поки не знайдено у вкладці "Рахунки".</p>
                    <p className="text-[11px] text-amber-800 mt-0.5">
                      Платіжка запишеться у вкладку "Платіжки". Після імпорту відповідного рахунку прив'язка оновиться автоматично.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Handwritten Order Number (For Invoices) */}
            {!isPaymentDoc && (
              <div className="border-2 border-dashed border-amber-300 bg-amber-50/50 rounded-xl p-4 shadow-xs">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-bold text-amber-950 uppercase tracking-wider flex items-center space-x-1.5">
                    <PenTool className="w-4 h-4 text-amber-600" />
                    <span>Внутрішній номер замовлення (Рукописний)</span>
                  </label>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-amber-900 bg-amber-200/80 px-2 py-0.5 rounded">
                    Формат: ххх-хх (без №)
                  </span>
                </div>
                <div className="relative">
                  <input
                    type="text"
                    value={formData.handwrittenOrderNumber}
                    onChange={(e) => handleChange('handwrittenOrderNumber', e.target.value)}
                    onBlur={handleOrderNumberBlur}
                    placeholder="наприклад: 142-26 або 228-26"
                    className="w-full text-sm font-bold font-mono px-3 py-2 bg-white border border-amber-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500 text-amber-950"
                  />
                </div>

                {/* Matched project title from Master Table */}
                {matchedProjectOrder && (
                  <div className="mt-2 p-2 bg-amber-100/80 border border-amber-300 rounded-lg flex items-center justify-between text-xs text-amber-950 font-semibold">
                    <div className="flex items-center space-x-1.5 truncate">
                      <span className="text-amber-700 font-bold">🎯 Об'єкт:</span>
                      <span className="font-bold text-amber-900 truncate">{matchedProjectOrder.title}</span>
                    </div>
                    <span className="text-[10px] bg-white px-2 py-0.5 rounded border border-amber-200 text-amber-900 font-medium shrink-0">
                      {matchedProjectOrder.status}
                    </span>
                  </div>
                )}

                <p className="text-[11px] text-amber-800/80 mt-1.5 flex items-center">
                  <Info className="w-3 h-3 mr-1 shrink-0" />
                  Номер, написаний від руки. Формат: тільки цифри та дефіс (ххх-хх), без символу №.
                </p>
              </div>
            )}

            {/* Document Type Switch & Status */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Тип документа
                </label>
                <select
                  value={formData.documentType}
                  onChange={(e) => {
                    const dt = e.target.value as any;
                    handleChange('documentType', dt);
                    handleChange(
                      'documentTypeUkrainian',
                      dt === 'payment' ? 'Платіжна інструкція' : 'Рахунок на оплату'
                    );
                    if (dt === 'invoice' && !formData.paymentStatus) {
                      handleChange('paymentStatus', 'Не оплачено');
                    }
                  }}
                  className="w-full text-xs font-medium p-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="invoice">Рахунок на оплату (Invoice)</option>
                  <option value="payment">Платіжка / Квитанція (Payment)</option>
                  <option value="other">Інший фінансовий документ</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Номер {isPaymentDoc ? 'платіжки' : 'рахунку'}
                </label>
                <input
                  type="text"
                  value={formData.invoiceNumber}
                  onChange={(e) => handleChange('invoiceNumber', e.target.value)}
                  placeholder={isPaymentDoc ? "наприклад: 1042" : "наприклад СФ-000451"}
                  className="w-full text-xs font-mono p-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Статус оплати
                </label>
                <select
                  value={formData.paymentStatus || (isPaymentDoc ? 'Оплачено' : 'Не оплачено')}
                  onChange={(e) => handleChange('paymentStatus', e.target.value)}
                  className={`w-full text-xs font-bold p-2 border rounded-lg focus:outline-none focus:ring-1 ${
                    (formData.paymentStatus || 'Не оплачено') === 'Оплачено'
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-300 focus:ring-emerald-500'
                      : (formData.paymentStatus || 'Не оплачено') === 'Оплачено частково'
                      ? 'bg-amber-50 text-amber-800 border-amber-300 focus:ring-amber-500'
                      : 'bg-rose-50 text-rose-800 border-rose-300 focus:ring-rose-500'
                  }`}
                >
                  <option value="Не оплачено">Не оплачено (За замовчуванням)</option>
                  <option value="Оплачено">Оплачено (Сума збігається)</option>
                  <option value="Оплачено частково">Оплачено частково (Передоплата)</option>
                </select>
              </div>
            </div>

            {/* Matched Payment Notice for Invoices */}
            {!isPaymentDoc && invoicePaymentMatch && invoicePaymentMatch.computedStatus !== 'Не оплачено' && (
              <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-300 text-xs space-y-2 shadow-2xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1.5 text-emerald-950 font-bold">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>Знайдено оплату за цим рахунком у вкладці «Платіжки»!</span>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                    {invoicePaymentMatch.computedStatus}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-700 bg-white p-2 rounded border border-emerald-100">
                  <div>
                    <span className="text-slate-500">Сума рахунку: </span>
                    <span className="font-mono font-bold text-slate-900 block">
                      {new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(formData.totalAmount || 0)} грн
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500">Сплачено за платіжкою: </span>
                    <span className="font-mono font-bold text-emerald-800 block">
                      {new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(invoicePaymentMatch.totalPaidAmount)} грн
                    </span>
                  </div>
                </div>
                <p className="text-[11px] text-emerald-900 leading-relaxed">
                  ℹ️ {invoicePaymentMatch.matchReason}. Рахунок буде внесено в Google Таблицю одразу зі статусом <strong>«{invoicePaymentMatch.computedStatus}»</strong> та сумою оплати <span className="font-mono font-bold">{new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(invoicePaymentMatch.totalPaidAmount)} грн</span> (стовпчик J).
                </p>
              </div>
            )}

            {/* Payer (Our Company) & Payee (Supplier) */}
            <div className="space-y-3">
              {/* Payer / Buyer (Our Company) */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center space-x-1">
                  <Building2 className="w-3.5 h-3.5 text-indigo-600" />
                  <span>{isPaymentDoc ? 'Платник (Наша компанія зі списку)' : 'Наша компанія (Покупець / Платник)'}</span>
                </label>
                {companyLists.ourCompanies.length > 0 ? (
                  <select
                    value={isPaymentDoc ? (formData.payerName || formData.buyerName) : formData.buyerName}
                    onChange={(e) => {
                      const val = e.target.value;
                      handleChange('buyerName', val);
                      handleChange('payerName', val);
                    }}
                    className="w-full text-xs font-bold uppercase p-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    {Array.from(new Set(companyLists.ourCompanies)).map((c, idx) => (
                      <option key={idx} value={c}>
                        {c}
                      </option>
                    ))}
                    {!companyLists.ourCompanies.includes(isPaymentDoc ? (formData.payerName || formData.buyerName) : formData.buyerName) && (formData.payerName || formData.buyerName) && (
                      <option value={isPaymentDoc ? (formData.payerName || formData.buyerName) : formData.buyerName}>
                        {isPaymentDoc ? (formData.payerName || formData.buyerName) : formData.buyerName} (розпізнано)
                      </option>
                    )}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={isPaymentDoc ? (formData.payerName || formData.buyerName) : formData.buyerName}
                    onChange={(e) => {
                      const val = e.target.value;
                      handleChange('buyerName', val);
                      handleChange('payerName', val);
                    }}
                    onBlur={handleBuyerBlur}
                    placeholder="наприклад: ТОВ БУДМОНТАЖ-2026"
                    className="w-full text-xs font-bold uppercase p-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                )}
                <p className="text-[10px] text-slate-500 mt-0.5">
                  Формат: <span className="font-semibold text-slate-700">ТОВ НАЗВА КОМПАНІЇ</span> (всі великі літери, без лапок).
                </p>
              </div>

              {/* Payee / Supplier (Counterparty) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-700 flex items-center space-x-1">
                    <Building2 className="w-3.5 h-3.5 text-indigo-600" />
                    <span>{isPaymentDoc ? 'Отримувач (Постачальник)' : 'Постачальник (Продавець)'}</span>
                  </label>
                  {isSupplierInOurCompanies && (
                    <span className="text-[10px] text-rose-600 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded font-bold flex items-center">
                      <AlertTriangle className="w-2.5 h-2.5 mr-0.5" /> Співпадає з нашою компанією!
                    </span>
                  )}
                </div>
                <input
                  type="text"
                  list="suppliersList"
                  value={isPaymentDoc ? (formData.payeeName || formData.supplierName) : formData.supplierName}
                  onChange={(e) => {
                    const val = e.target.value;
                    handleChange('supplierName', val);
                    handleChange('payeeName', val);
                  }}
                  onBlur={isPaymentDoc ? handlePayeeBlur : handleSupplierBlur}
                  placeholder="наприклад: ТОВ ЛЕГНОПРОМ або ТОВ ЕПІЦЕНТР К"
                  className={`w-full text-xs font-bold uppercase p-2 border rounded-lg focus:outline-none focus:ring-1 ${
                    isSupplierInOurCompanies
                      ? 'border-rose-400 bg-rose-50/50 focus:ring-rose-500'
                      : 'border-slate-200 bg-slate-50 focus:ring-indigo-500'
                  }`}
                />
                <datalist id="suppliersList">
                  {Array.from(new Set(companyLists.suppliers)).map((s, idx) => (
                    <option key={idx} value={s} />
                  ))}
                </datalist>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  Формат: <span className="font-semibold text-slate-700">ТОВ НАЗВА КОМПАНІЇ</span> (всі великі літери, без лапок).
                </p>
              </div>
            </div>

            {/* Date, Amount & Currency */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Дата {isPaymentDoc ? 'платіжки' : 'рахунку'}
                </label>
                <input
                  type="date"
                  value={formData.invoiceDate}
                  onChange={(e) => handleChange('invoiceDate', e.target.value)}
                  className="w-full text-xs font-medium p-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className={`block text-xs font-semibold mb-1 flex items-center justify-between ${(formData.totalAmount || 0) <= 0 ? 'text-amber-700' : 'text-slate-700'}`}>
                  <span>{isPaymentDoc ? 'Сума оплати' : 'Загальна сума'}</span>
                  {(formData.totalAmount || 0) <= 0 && (
                    <span className="text-[10px] text-amber-600 font-bold bg-amber-100 px-1.5 py-0.2 rounded">
                      Потрібна сума!
                    </span>
                  )}
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.totalAmount || ''}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value) || 0;
                    handleChange('totalAmount', val);
                    if (isPaymentDoc) {
                      handleChange('amountPaid', val);
                    }
                  }}
                  placeholder="0.00"
                  className={`w-full text-xs font-bold font-mono p-2 rounded-lg focus:outline-none focus:ring-1 ${
                    (formData.totalAmount || 0) <= 0
                      ? 'bg-amber-50 border-2 border-amber-400 text-amber-950 focus:ring-amber-500'
                      : 'bg-slate-50 border border-slate-200 text-slate-900 focus:ring-indigo-500'
                  }`}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Валюта
                </label>
                <select
                  value={formData.currency}
                  onChange={(e) => handleChange('currency', e.target.value)}
                  className="w-full text-xs font-bold p-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="UAH">UAH (грн)</option>
                  <option value="USD">USD ($)</option>
                  <option value="EUR">EUR (€)</option>
                  <option value="PLN">PLN (zł)</option>
                </select>
              </div>
            </div>

            {/* Payment Purpose (if payment order) */}
            {isPaymentDoc && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Призначення платежу
                </label>
                <textarea
                  value={formData.paymentPurpose || ''}
                  onChange={(e) => handleChange('paymentPurpose', e.target.value)}
                  rows={2}
                  className="w-full text-xs p-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                  placeholder="Оплата згідно рахунку №... від ..."
                />
              </div>
            )}

            {/* Warnings Alert */}
            {formData.validationWarnings && formData.validationWarnings.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900 space-y-1">
                <div className="font-bold flex items-center">
                  <ShieldAlert className="w-3.5 h-3.5 mr-1 text-amber-600" />
                  <span>Повідомлення системи розпізнавання:</span>
                </div>
                <ul className="list-disc list-inside space-y-0.5 text-[11px] text-amber-800">
                  {formData.validationWarnings.map((w, idx) => (
                    <li key={idx}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Footer Action Buttons */}
            <div className="pt-3 mt-auto border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={handleSaveLocal}
                className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors flex items-center space-x-1.5"
              >
                {savedSuccess ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="text-emerald-700">Збережено!</span>
                  </>
                ) : (
                  <span>Зберегти зміни</span>
                )}
              </button>

              {doc.status === 'synced' ? (
                <div className="flex items-center space-x-2">
                  <span className="text-xs text-emerald-700 font-semibold flex items-center">
                    <CheckCircle2 className="w-4 h-4 mr-1 text-emerald-600" />
                    Внесено в таблицю
                  </span>
                  <button
                    type="button"
                    onClick={handleSync}
                    disabled={isSyncing}
                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-xs font-medium transition-colors flex items-center space-x-1"
                    title="Примусово записати повторно"
                  >
                    <span>{isSyncing ? 'Запис...' : 'Внести повторно'}</span>
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleSync}
                  disabled={isSyncing}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-xs transition-colors flex items-center space-x-1.5 disabled:opacity-50"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>
                    {isSyncing ? 'Запис у таблицю...' : doc.alreadyInSheet ? 'Занести в Google Таблицю (все одно)' : 'Занести в Google Таблицю'}
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
