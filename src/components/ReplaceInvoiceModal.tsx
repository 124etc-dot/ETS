import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  RefreshCw, 
  X, 
  FileText, 
  Upload, 
  Check, 
  AlertTriangle, 
  ArrowRight, 
  FileSpreadsheet, 
  Sparkles, 
  Loader2, 
  Edit3, 
  FolderCheck,
  Calendar,
  DollarSign,
  Building2,
  Tag,
  Trash2
} from 'lucide-react';
import { ExistingSheetRow, ProcessedDocument, OCRResult, SheetCompanyLists } from '../types';
import { OCRService } from '../services/ocrService';
import { GoogleDriveService } from '../services/googleDrive';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  targetInvoice: ExistingSheetRow | null;
  documents: ProcessedDocument[];
  companyLists: SheetCompanyLists;
  onConfirmReplace: (
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
  ) => Promise<void>;
  onAddLocalDocument?: (file: File) => Promise<ProcessedDocument | null>;
}

export const ReplaceInvoiceModal: React.FC<Props> = ({
  isOpen,
  onClose,
  targetInvoice,
  documents,
  companyLists,
  onConfirmReplace,
  onAddLocalDocument,
}) => {
  if (!isOpen || !targetInvoice) return null;

  const [activeTab, setActiveTab] = useState<'upload' | 'queue' | 'manual'>('upload');
  const [selectedQueueDocId, setSelectedQueueDocId] = useState<string>('');
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadedPreview, setUploadedPreview] = useState<string>('');
  const [trashOldDriveFile, setTrashOldDriveFile] = useState<boolean>(true);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form data for the replacement invoice
  const [formData, setFormData] = useState<OCRResult>({
    documentType: 'invoice',
    documentTypeUkrainian: 'Рахунок на оплату',
    handwrittenOrderNumber: targetInvoice.orderNumber || '',
    handwrittenConfidence: 'high',
    supplierName: targetInvoice.supplier || '',
    buyerName: targetInvoice.buyer || companyLists.ourCompanies[0] || '',
    invoiceNumber: '',
    invoiceDate: new Date().toISOString().split('T')[0],
    totalAmount: targetInvoice.amount || 0,
    currency: targetInvoice.currency || 'UAH',
    paymentStatus: 'Не оплачено',
    confidenceScore: 100,
  });

  // Track source document if chosen from queue
  const [sourceDoc, setSourceDoc] = useState<ProcessedDocument | undefined>(undefined);

  // Reset form when targetInvoice changes
  useEffect(() => {
    if (targetInvoice) {
      setFormData({
        documentType: 'invoice',
        documentTypeUkrainian: 'Рахунок на оплату',
        handwrittenOrderNumber: targetInvoice.orderNumber || '',
        handwrittenConfidence: 'high',
        supplierName: targetInvoice.supplier || '',
        buyerName: targetInvoice.buyer || companyLists.ourCompanies[0] || '',
        invoiceNumber: '',
        invoiceDate: new Date().toISOString().split('T')[0],
        totalAmount: targetInvoice.amount || 0,
        currency: targetInvoice.currency || 'UAH',
        paymentStatus: 'Не оплачено',
        confidenceScore: 100,
      });
      setSelectedQueueDocId('');
      setUploadedFile(null);
      setUploadedPreview('');
      setSourceDoc(undefined);
      setSubmitError(null);
    }
  }, [targetInvoice, companyLists]);

  // Detect if previous invoice has a known Drive file with fuzzy matching
  const previousDriveFile = useMemo(() => {
    if (!targetInvoice) return null;
    const cleanTargetInv = OCRService.sanitizeInvoiceNumber(targetInvoice.invoiceNumber || '');
    const cleanTargetOrder = OCRService.normalizeOrderNumber(targetInvoice.orderNumber || '');

    const matchingDoc = documents.find((d) => {
      // Direct row index match
      if (d.syncedRowIndex && d.syncedRowIndex === targetInvoice.rowIndex) return true;
      // Drive link match
      if (d.driveLink && targetInvoice.driveLink && d.driveLink === targetInvoice.driveLink) return true;
      if (targetInvoice.driveLink && d.driveFileId && targetInvoice.driveLink.includes(d.driveFileId)) return true;
      // Exact file name match
      if (d.fileName && targetInvoice.fileName && d.fileName === targetInvoice.fileName) return true;

      // Invoice number match via OCR
      const docInvNum = d.ocrResult?.invoiceNumber || d.editedData?.invoiceNumber || '';
      if (cleanTargetInv && docInvNum && OCRService.isInvoiceNumberMatch(docInvNum, targetInvoice.invoiceNumber)) {
        return true;
      }

      // File name containing clean target invoice number
      if (cleanTargetInv && cleanTargetInv.length >= 2 && d.fileName) {
        const fnClean = OCRService.sanitizeInvoiceNumber(d.fileName);
        if (fnClean.includes(cleanTargetInv)) return true;
      }

      // Order number and supplier match
      const docOrder = OCRService.normalizeOrderNumber(d.ocrResult?.handwrittenOrderNumber || d.editedData?.handwrittenOrderNumber || '');
      const docSupplier = d.ocrResult?.supplierName || d.editedData?.supplierName || '';
      if (cleanTargetOrder && docOrder === cleanTargetOrder && targetInvoice.supplier && OCRService.isCompanyNameMatch(docSupplier, targetInvoice.supplier)) {
        return true;
      }

      return false;
    });

    const fileName = matchingDoc?.fileName || targetInvoice.fileName || '';
    const driveFileId = matchingDoc?.driveFileId || (targetInvoice.driveLink ? GoogleDriveService.extractFileId(targetInvoice.driveLink) : '');

    return {
      fileName,
      driveFileId,
      hasDriveLink: Boolean(driveFileId || targetInvoice.driveLink || matchingDoc?.driveLink),
    };
  }, [targetInvoice, documents]);

  // Filter available candidate invoice documents from current queue (exclude payments and already replaced)
  const availableQueueInvoices = useMemo(() => {
    return documents.filter((d) => {
      const data = d.editedData || d.ocrResult;
      if (data && data.documentType === 'payment') return false;
      if (d.isReplaced) return false;
      // Prefer documents not yet synced or documents with matching supplier/order
      return true;
    });
  }, [documents]);

  // Handle selecting a document from the queue
  const handleSelectQueueDoc = (docId: string) => {
    setSelectedQueueDocId(docId);
    const doc = documents.find((d) => d.id === docId);
    if (!doc) return;

    setSourceDoc(doc);
    const data = doc.editedData || doc.ocrResult;
    if (data) {
      setFormData({
        ...data,
        documentType: 'invoice',
        handwrittenOrderNumber: String(data.handwrittenOrderNumber || targetInvoice.orderNumber || ''),
        supplierName: String(data.supplierName || targetInvoice.supplier || ''),
        buyerName: String(data.buyerName || targetInvoice.buyer || ''),
        invoiceNumber: String(data.invoiceNumber || ''),
        invoiceDate: String(data.invoiceDate || targetInvoice.invoiceDate || new Date().toISOString().split('T')[0]),
        totalAmount: typeof data.totalAmount === 'number' ? data.totalAmount : (parseFloat(String(data.totalAmount || '0')) || 0),
        currency: String(data.currency || targetInvoice.currency || 'UAH'),
        paymentStatus: 'Не оплачено',
      });
    }
  };

  // Handle processing a newly uploaded file
  const handleProcessUploadedFile = async (file: File) => {
    setUploadedFile(file);
    setIsProcessingFile(true);

    try {
      // 1. Read file to Base64 preview
      const previewBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      setUploadedPreview(previewBase64);

      // 2. Run AI OCR
      const ocr = await OCRService.analyzeDocument({
        fileData: previewBase64,
        mimeType: file.type || 'application/pdf',
        fileName: file.name,
        ourCompanies: companyLists.ourCompanies,
        suppliers: companyLists.suppliers,
        docTypeHint: 'invoice',
      });

      // 3. Pre-fill form data with OCR extracted fields, preserving order number from old invoice if AI didn't catch it
      setFormData({
        ...ocr,
        documentType: 'invoice',
        handwrittenOrderNumber: String(ocr.handwrittenOrderNumber || targetInvoice.orderNumber || ''),
        supplierName: String(ocr.supplierName || targetInvoice.supplier || ''),
        buyerName: String(ocr.buyerName || targetInvoice.buyer || ''),
        invoiceNumber: String(ocr.invoiceNumber || ''),
        invoiceDate: String(ocr.invoiceDate || targetInvoice.invoiceDate || new Date().toISOString().split('T')[0]),
        totalAmount: typeof ocr.totalAmount === 'number' ? ocr.totalAmount : (parseFloat(String(ocr.totalAmount || '0')) || 0),
        currency: String(ocr.currency || targetInvoice.currency || 'UAH'),
        paymentStatus: 'Не оплачено',
      });

      // 4. Also optionally add to documents queue in background
      if (onAddLocalDocument) {
        const createdDoc = await onAddLocalDocument(file);
        if (createdDoc) {
          setSourceDoc(createdDoc);
        }
      }
    } catch (err: any) {
      alert(`Помилка розпізнавання файлу: ${err.message || err}`);
    } finally {
      setIsProcessingFile(false);
    }
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleProcessUploadedFile(e.dataTransfer.files[0]);
    }
  };

  const handleConfirm = async () => {
    try {
      const cleanInvoiceNumber = String(formData.invoiceNumber ?? '').trim();
      if (!cleanInvoiceNumber) {
        alert('Будь ласка, вкажіть новий номер рахунку.');
        return;
      }

      const numAmount = typeof formData.totalAmount === 'number'
        ? formData.totalAmount
        : parseFloat(String(formData.totalAmount ?? '0').replace(/\s/g, '').replace(',', '.')) || 0;

      if (numAmount <= 0) {
        alert('Будь ласка, вкажіть суму рахунку (більше 0 грн).');
        return;
      }

      const cleanOcr: OCRResult = {
        ...formData,
        documentType: 'invoice',
        documentTypeUkrainian: 'Рахунок на оплату',
        handwrittenOrderNumber: OCRService.normalizeOrderNumber(String(formData.handwrittenOrderNumber ?? targetInvoice.orderNumber ?? '')),
        supplierName: OCRService.normalizeCompanyName(String(formData.supplierName ?? targetInvoice.supplier ?? '')),
        buyerName: OCRService.normalizeCompanyName(String(formData.buyerName ?? targetInvoice.buyer ?? '')),
        invoiceNumber: cleanInvoiceNumber,
        invoiceDate: String(formData.invoiceDate ?? targetInvoice.invoiceDate ?? new Date().toISOString().split('T')[0]).trim(),
        totalAmount: Math.abs(numAmount),
        currency: String(formData.currency ?? 'UAH').trim() || 'UAH',
        paymentStatus: 'Не оплачено',
      };

      setIsSubmitting(true);
      setSubmitError(null);

      await onConfirmReplace(
        targetInvoice.rowIndex,
        cleanOcr,
        sourceDoc,
        {
          invoiceNumber: targetInvoice.invoiceNumber,
          amount: targetInvoice.amount,
          supplier: targetInvoice.supplier,
          date: targetInvoice.invoiceDate,
          orderNumber: targetInvoice.orderNumber,
        },
        {
          trashOldDriveFile,
          oldFileId: previousDriveFile?.driveFileId,
          oldFileName: previousDriveFile?.fileName,
        }
      );
      onClose();
    } catch (err: any) {
      console.error('Помилка заміни рахунку:', err);
      setSubmitError(err?.message || 'Не вдалося замінити рахунок у таблиці. Перевірте зʼєднання.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Difference calculation
  const currentTotalAmount = typeof formData.totalAmount === 'number'
    ? formData.totalAmount
    : parseFloat(String(formData.totalAmount ?? '0').replace(/\s/g, '').replace(',', '.')) || 0;
  const amountDiff = currentTotalAmount - (Number(targetInvoice.amount) || 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div 
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 bg-linear-to-r from-amber-500 via-amber-600 to-amber-700 text-white flex items-center justify-between shadow-xs">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-white/15 rounded-xl backdrop-blur-xs">
              <RefreshCw className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-base font-bold text-white leading-tight">
                  Заміна рахунку в рядку {targetInvoice.rowIndex}
                </h3>
                <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-white/20 text-white font-semibold">
                  Вкладка «Рахунки»
                </span>
              </div>
              <p className="text-xs text-amber-100 mt-0.5">
                Перезапис неоплаченого рядка новими реквізитами без створення дубліката
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-x-0 space-y-5 flex-1">
          {/* Card: Current row info in Sheet */}
          <div className="bg-amber-50/70 border border-amber-200/90 rounded-xl p-3.5 flex flex-col space-y-2">
            <div className="flex items-center justify-between text-xs text-amber-900 font-semibold border-b border-amber-200/60 pb-1.5">
              <span className="flex items-center space-x-1.5">
                <FileSpreadsheet className="w-4 h-4 text-amber-700" />
                <span>Поточний запис у таблиці (що замінюємо):</span>
              </span>
              <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded font-mono font-bold">
                Рядок {targetInvoice.rowIndex}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div>
                <span className="text-[10px] text-slate-500 uppercase tracking-wider block">Замовлення (A)</span>
                <span className="font-mono font-bold text-amber-950">
                  {targetInvoice.orderNumber || '—'}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 uppercase tracking-wider block">Постачальник (B)</span>
                <span className="font-semibold text-slate-900 truncate block" title={targetInvoice.supplier}>
                  {targetInvoice.supplier || '—'}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 uppercase tracking-wider block">Рахунок (D/E)</span>
                <span className="font-mono text-slate-900">
                  №{targetInvoice.invoiceNumber || '—'} ({targetInvoice.invoiceDate || '—'})
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 uppercase tracking-wider block">Сума (F)</span>
                <span className="font-mono font-bold text-slate-900">
                  {OCRService.formatCurrency(targetInvoice.amount, targetInvoice.currency)}
                </span>
              </div>
            </div>
          </div>

          {/* Selection of Replacement Mode */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              Оберіть спосіб внесення нового рахунку:
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setActiveTab('upload')}
                className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center justify-center space-x-1.5 transition-all cursor-pointer border ${
                  activeTab === 'upload'
                    ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                    : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
                }`}
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Завантажити файл</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('queue')}
                className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center justify-center space-x-1.5 transition-all cursor-pointer border ${
                  activeTab === 'queue'
                    ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                    : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
                }`}
              >
                <FolderCheck className="w-3.5 h-3.5" />
                <span>Вибрати з черги ({availableQueueInvoices.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('manual')}
                className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center justify-center space-x-1.5 transition-all cursor-pointer border ${
                  activeTab === 'manual'
                    ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                    : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
                }`}
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Ввести вручну</span>
              </button>
            </div>
          </div>

          {/* Mode 1: Upload File */}
          {activeTab === 'upload' && (
            <div className="space-y-3 animate-in fade-in duration-150">
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleFileDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
                  dragOver 
                    ? 'border-amber-500 bg-amber-50/50' 
                    : 'border-slate-200 hover:border-amber-400 bg-slate-50/50'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf,image/*"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      handleProcessUploadedFile(e.target.files[0]);
                    }
                  }}
                />
                
                {isProcessingFile ? (
                  <div className="flex flex-col items-center space-y-2 text-amber-700">
                    <Loader2 className="w-7 h-7 animate-spin" />
                    <span className="text-xs font-semibold">Gemini AI розпізнає новий рахунок...</span>
                  </div>
                ) : uploadedFile ? (
                  <div className="flex items-center justify-center space-x-2 text-emerald-700">
                    <Check className="w-5 h-5 text-emerald-600" />
                    <div className="text-left">
                      <p className="text-xs font-bold">{uploadedFile.name}</p>
                      <p className="text-[10px] text-slate-500">Розпізнано. Дані підставлено у форму нижче.</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center space-y-1 text-slate-600">
                    <Upload className="w-6 h-6 text-amber-600 mb-1" />
                    <p className="text-xs font-semibold">Перетягніть сюди новий файл рахунку або натисніть</p>
                    <p className="text-[11px] text-slate-400">Підтримуються PDF або зображення (JPG, PNG)</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Mode 2: Select from Queue */}
          {activeTab === 'queue' && (
            <div className="space-y-2 animate-in fade-in duration-150">
              {availableQueueInvoices.length === 0 ? (
                <div className="p-4 bg-slate-50 rounded-xl text-center text-xs text-slate-500 border border-slate-200">
                  У черзі немає завантажених рахунків. Завантажте новий файл у вкладці «Завантажити файл».
                </div>
              ) : (
                <div className="max-h-48 overflow-y-auto space-y-1.5 border border-slate-200 rounded-xl p-2 bg-slate-50/50">
                  {availableQueueInvoices.map((d) => {
                    const data = d.editedData || d.ocrResult;
                    const isSelected = selectedQueueDocId === d.id;
                    const matchesOrder = data?.handwrittenOrderNumber && targetInvoice.orderNumber && data.handwrittenOrderNumber === targetInvoice.orderNumber;
                    const matchesSupplier = data?.supplierName && targetInvoice.supplier && OCRService.isCompanyNameMatch(data.supplierName, targetInvoice.supplier);

                    return (
                      <div
                        key={d.id}
                        onClick={() => handleSelectQueueDoc(d.id)}
                        className={`p-2.5 rounded-lg border text-xs cursor-pointer transition-all flex items-center justify-between ${
                          isSelected
                            ? 'bg-amber-100/80 border-amber-400 text-amber-950 font-medium'
                            : 'bg-white border-slate-200 hover:border-amber-300 text-slate-700'
                        }`}
                      >
                        <div className="flex items-center space-x-2 truncate">
                          <FileText className={`w-4 h-4 shrink-0 ${isSelected ? 'text-amber-700' : 'text-slate-400'}`} />
                          <div className="truncate">
                            <span className="font-semibold text-slate-900 block truncate">
                              {d.fileName}
                            </span>
                            <span className="text-[10px] text-slate-500 flex items-center space-x-2">
                              <span>Рах: №{data?.invoiceNumber || '—'}</span>
                              <span>•</span>
                              <span>Сума: {OCRService.formatCurrency(data?.totalAmount || 0)}</span>
                              {matchesOrder && (
                                <span className="bg-amber-200 text-amber-900 px-1 rounded font-bold">
                                  Замовлення співпадає ({data?.handwrittenOrderNumber})
                                </span>
                              )}
                            </span>
                          </div>
                        </div>

                        {isSelected && <Check className="w-4 h-4 text-amber-700 shrink-0" />}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Form fields for New Invoice Details (Always Editable) */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <span className="text-xs font-bold text-slate-800 flex items-center space-x-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                <span>Нові реквізити рахунку для рядка {targetInvoice.rowIndex}:</span>
              </span>
              <span className="text-[10px] text-slate-500">
                Перевірте та скоригуйте за потреби
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Order Number (A) */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Номер замовлення (Колонка A):
                </label>
                <input
                  type="text"
                  value={formData.handwrittenOrderNumber || ''}
                  onChange={(e) => setFormData({ ...formData, handwrittenOrderNumber: e.target.value })}
                  placeholder="напр. 142-26"
                  className="w-full px-3 py-1.5 text-xs font-mono font-bold bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 outline-hidden"
                />
              </div>

              {/* New Invoice Number (D) */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Новий номер рахунку (Колонка D): *
                </label>
                <input
                  type="text"
                  value={formData.invoiceNumber ?? ''}
                  onChange={(e) => setFormData({ ...formData, invoiceNumber: e.target.value })}
                  placeholder="напр. 4125 або СФ-0042"
                  className="w-full px-3 py-1.5 text-xs font-mono font-bold bg-white border border-amber-300 rounded-lg focus:ring-2 focus:ring-amber-500 outline-hidden"
                />
              </div>

              {/* New Invoice Date (E) */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Нова дата рахунку (Колонка E):
                </label>
                <input
                  type="date"
                  value={formData.invoiceDate ?? ''}
                  onChange={(e) => setFormData({ ...formData, invoiceDate: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 outline-hidden"
                />
              </div>

              {/* New Amount (F) */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Нова сума рахунку, грн (Колонка F): *
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.totalAmount ?? ''}
                  onChange={(e) => setFormData({ ...formData, totalAmount: parseFloat(e.target.value) || 0 })}
                  placeholder="0.00"
                  className="w-full px-3 py-1.5 text-xs font-mono font-bold bg-white border border-amber-300 rounded-lg focus:ring-2 focus:ring-amber-500 outline-hidden"
                />
              </div>

              {/* Supplier (B) */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Постачальник (Колонка B):
                </label>
                <input
                  type="text"
                  value={formData.supplierName ?? ''}
                  onChange={(e) => setFormData({ ...formData, supplierName: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 outline-hidden"
                />
              </div>

              {/* Buyer (C) */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Платник (Колонка C):
                </label>
                <select
                  value={formData.buyerName}
                  onChange={(e) => setFormData({ ...formData, buyerName: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 outline-hidden"
                >
                  {companyLists.ourCompanies.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Side-by-Side Comparison Box */}
          <div className="bg-slate-100 border border-slate-200 rounded-xl p-3.5 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
            {/* Old */}
            <div className="w-full sm:w-1/2 p-2.5 bg-white rounded-lg border border-slate-200">
              <span className="text-[10px] text-slate-400 font-semibold uppercase block">Було (Рядок {targetInvoice.rowIndex}):</span>
              <p className="font-mono font-bold text-slate-700 text-sm mt-0.5">
                №{targetInvoice.invoiceNumber || '—'}
              </p>
              <p className="text-[11px] text-slate-500">
                Сума: <span className="font-mono font-semibold text-slate-800">{OCRService.formatCurrency(targetInvoice.amount)}</span>
              </p>
            </div>

            <ArrowRight className="w-4 h-4 text-amber-600 shrink-0 hidden sm:block" />

            {/* New */}
            <div className="w-full sm:w-1/2 p-2.5 bg-amber-50/90 rounded-lg border border-amber-300">
              <span className="text-[10px] text-amber-700 font-semibold uppercase block">Стане в рядку {targetInvoice.rowIndex}:</span>
              <p className="font-mono font-bold text-amber-950 text-sm mt-0.5">
                №{formData.invoiceNumber || '—'}
              </p>
              <p className="text-[11px] text-amber-900 flex items-center justify-between">
                <span>Сума: <span className="font-mono font-bold">{OCRService.formatCurrency(formData.totalAmount || 0)}</span></span>
                {amountDiff !== 0 && (
                  <span className={`font-mono text-[10px] px-1 rounded font-bold ${
                    amountDiff > 0 ? 'bg-amber-200 text-amber-900' : 'bg-emerald-200 text-emerald-900'
                  }`}>
                    {amountDiff > 0 ? `+${amountDiff.toFixed(2)} грн` : `${amountDiff.toFixed(2)} грн`}
                  </span>
                )}
              </p>
            </div>
          </div>

          {/* Google Drive Old File Handling Checkbox */}
          <div className="bg-slate-50/90 border border-slate-200/90 rounded-xl p-3.5 transition-colors hover:border-slate-300">
            <label className="flex items-start space-x-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={trashOldDriveFile}
                onChange={(e) => setTrashOldDriveFile(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500 cursor-pointer accent-amber-600"
              />
              <div className="flex-1">
                <div className="flex items-center space-x-2">
                  <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                    Перемістити старий файл рахунку в кошик на Google Диску
                  </span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${
                    trashOldDriveFile ? 'bg-amber-100 text-amber-800 border border-amber-200' : 'bg-slate-200 text-slate-600'
                  }`}>
                    {trashOldDriveFile ? 'У кошик' : 'Залишити на Диску'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                  {previousDriveFile?.fileName ? (
                    <>
                      Попередній файл <span className="font-mono font-bold text-slate-700 bg-slate-200/60 px-1 py-0.5 rounded">«{previousDriveFile.fileName}»</span> буде переміщено в кошик (Trash) Google Диску.
                    </>
                  ) : (
                    <>
                      Пов&apos;язаний файл попереднього рахунку №{targetInvoice.invoiceNumber || '—'} буде переміщено в кошик (Trash) Google Диску.
                    </>
                  )}
                  {' '}У кошику файл безпечно зберігається протягом 30 днів і за потреби його завжди можна відновити. Новий рахунок записується в папку окремим файлом.
                </p>
              </div>
            </label>
          </div>

          {/* Submission Error Banner */}
          {submitError && (
            <div className="text-xs text-rose-800 bg-rose-50 p-3 rounded-lg border border-rose-200 flex items-start space-x-2.5">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <strong className="block font-semibold text-rose-900">Не вдалося замінити рахунок:</strong>
                <p className="mt-0.5 text-[11px] leading-relaxed text-rose-700">{submitError}</p>
              </div>
            </div>
          )}

          {/* Audit Trail Note */}
          <div className="text-[11px] text-slate-500 bg-slate-50 p-2.5 rounded-lg border border-slate-200 flex items-start space-x-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <span>
              <strong>Механіка заміни:</strong> рядок <strong>{targetInvoice.rowIndex}</strong> буде перезаписано новими реквізитами (номер, дата, сума). 
              У колонці «Час завантаження» автоматично зафіксується відмітка про заміну попереднього рахунку №{targetInvoice.invoiceNumber || '—'} для збереження історії. 
              Нові рядки у таблицю не додаватимуться.
            </span>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
          >
            Скасувати
          </button>

          <button
            type="button"
            onClick={handleConfirm}
            disabled={isSubmitting || !String(formData.invoiceNumber || '').trim() || (currentTotalAmount || 0) <= 0}
            className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg shadow-sm transition-all flex items-center space-x-2 disabled:opacity-50 cursor-pointer"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Оновлення рядка {targetInvoice.rowIndex}...</span>
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4" />
                <span>Замінити рахунок у рядку {targetInvoice.rowIndex}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
