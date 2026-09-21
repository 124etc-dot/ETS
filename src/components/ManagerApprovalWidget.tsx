import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  FileText,
  CheckCircle2,
  XCircle,
  Briefcase,
  Building2,
  Calendar,
  AlertCircle,
  Check,
  X,
  MessageSquare,
  Sparkles,
  RefreshCw,
  Clock,
  Send,
  Search,
  Eye,
  ExternalLink,
  FolderOpen,
} from 'lucide-react';
import { ExistingSheetRow, ProcessedDocument, ProjectSheetRow, SheetConfig } from '../types';
import { GoogleDriveService } from '../services/googleDrive';
import { GoogleSheetsService } from '../services/googleSheets';
import { OCRService } from '../services/ocrService';
import { KNOWN_PROJECT_ORDERS } from '../data/sampleDocuments';
import { DriveLinkModal } from './DriveLinkModal';

export interface PendingInvoiceItem {
  id: string;
  rowIndex?: number;
  supplier: string;
  projectNumber: string;
  projectTitle: string;
  amount: number;
  currency: string;
  vatIncluded: boolean;
  paymentStatus?: string;
  invoiceDate: string;
  invoiceNumber?: string;
  note?: string;
  driveLink?: string;
  driveFileId?: string;
  thumbnailUrl?: string;
  mimeType?: string;
  fileName?: string;
  previewUrl?: string;
  originalInvoice?: ExistingSheetRow;
  isDemo?: boolean;
}

interface ManagerApprovalWidgetProps {
  existingInvoices: ExistingSheetRow[];
  documents: ProcessedDocument[];
  projects?: ProjectSheetRow[];
  userEmail?: string;
  sheetConfig?: SheetConfig | null;
  driveFolderId?: string;
  accessToken?: string | null;
  canWriteToSheets?: boolean;
  onRefresh?: () => Promise<void>;
  onApproveInvoice?: (
    invoice: ExistingSheetRow,
    approvedBy: string,
    approvedAt: string
  ) => Promise<void> | void;
  onRejectInvoice?: (
    invoice: ExistingSheetRow,
    rejectedBy: string,
    rejectedAt: string,
    reason: string
  ) => Promise<void> | void;
  onViewAllInvoices?: () => void;
}

// Fallback demo queue when sheet has no pending unapproved rows yet
const INITIAL_DEMO_PENDING_INVOICES: PendingInvoiceItem[] = [
  {
    id: 'demo-approval-1',
    rowIndex: 101,
    supplier: 'ТОВ «МеталСервіс»',
    projectNumber: '207-26',
    projectTitle: 'НРК Танчик',
    amount: 120000,
    currency: 'UAH',
    vatIncluded: true,
    paymentStatus: 'Не оплачено',
    invoiceDate: '21.09.2026',
    invoiceNumber: 'МС-00452',
    note: 'Термінова оплата металопрокату для каркасу конструкції (погоджено PM)',
    fileName: 'Рахунок_МеталСервіс_207-26.pdf',
    isDemo: true,
  },
  {
    id: 'demo-approval-2',
    rowIndex: 102,
    supplier: 'ТОВ «Скло-Люкс Інвест»',
    projectNumber: '216-26',
    projectTitle: 'Reiss KaWeDe',
    amount: 84500,
    currency: 'UAH',
    vatIncluded: true,
    paymentStatus: 'Не оплачено',
    invoiceDate: '19.09.2026',
    invoiceNumber: 'СЛ-2026/89',
    note: 'Гартоване скло 10мм триплекс з поліруванням кромок',
    fileName: 'Рахунок_СклоЛюкс_216-26.pdf',
    isDemo: true,
  },
  {
    id: 'demo-approval-3',
    rowIndex: 103,
    supplier: 'ПП «Фурнітура-Експерт»',
    projectNumber: '229-26',
    projectTitle: 'РічПорт',
    amount: 45320,
    currency: 'UAH',
    vatIncluded: true,
    paymentStatus: 'Не оплачено',
    invoiceDate: '18.09.2026',
    invoiceNumber: 'ФЕ-118/26',
    note: 'Комплекти затискних профілів, ролики та дотягувачі',
    fileName: 'Рахунок_Фурнітура_229-26.pdf',
    isDemo: true,
  },
];

export const ManagerApprovalWidget: React.FC<ManagerApprovalWidgetProps> = ({
  existingInvoices,
  documents,
  projects = [],
  userEmail = '124etc@gmail.com',
  sheetConfig,
  driveFolderId,
  accessToken,
  canWriteToSheets = true,
  onRefresh,
  onApproveInvoice,
  onRejectInvoice,
  onViewAllInvoices,
}) => {
  // Set of dismissed/handled item IDs (to animate out instantly)
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  // Optimistic drive link overrides for immediate UI updates
  const [overriddenLinks, setOverriddenLinks] = useState<Record<string, string>>({});

  // Drive Link In-App Preview & Management Modal state
  const [driveLinkModal, setDriveLinkModal] = useState<{
    rowIndex?: number;
    title: string;
    currentLink?: string;
    fileName?: string;
    localPreviewUrl?: string;
    itemId: string;
  } | null>(null);

  // Rejection modal state
  const [rejectingItem, setRejectingItem] = useState<PendingInvoiceItem | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string>('');
  const [isSubmittingReject, setIsSubmittingReject] = useState<boolean>(false);

  // Status feedback state (e.g. "Погоджено" during action)
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'info' | 'error' } | null>(null);

  const showToast = (text: string, type: 'success' | 'info' | 'error' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 4000);
  };

  // Helper to format currency values
  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat('uk-UA', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  // Helper to find project title by order code
  const resolveProjectTitle = (orderCode: string): string => {
    if (!orderCode) return '';
    const clean = orderCode.trim().toLowerCase().replace(/[^a-zа-яієїґ0-9]/gi, '');
    
    // Check in real projects prop
    if (projects.length > 0) {
      const foundInProjects = projects.find((p) => {
        const pCode = String(p.colA || '').trim().toLowerCase().replace(/[^a-zа-яієїґ0-9]/gi, '');
        return pCode === clean || (clean.length >= 3 && pCode.includes(clean));
      });
      if (foundInProjects) {
        return String(foundInProjects.colB || foundInProjects.colC || '').trim();
      }
    }

    // Check in known project orders
    const foundKnown = KNOWN_PROJECT_ORDERS.find((ko) => {
      const koClean = ko.code.trim().toLowerCase().replace(/[^a-zа-яієїґ0-9]/gi, '');
      return koClean === clean || koClean.includes(clean) || clean.includes(koClean);
    });
    if (foundKnown) {
      return foundKnown.title;
    }

    return '';
  };

  // Helper to verify if a ProcessedDocument is a payment slip / payment instruction / bank receipt (NOT an invoice)
  const isPaymentDocument = (doc: ProcessedDocument): boolean => {
    if (!doc) return false;

    // 1. Sheet tab mapping
    if (doc.alreadyInSheetTab && /платеж|платіж|payment/i.test(doc.alreadyInSheetTab)) return true;
    if (doc.alreadyInSheetReason && /платіж|платеж|банк|оплат|сплат/i.test(doc.alreadyInSheetReason)) return true;

    // 2. Matched invoice flags (meaning this doc is a payment matched to an invoice)
    if (doc.matchedInvoiceId || doc.matchedInvoiceNumber) return true;

    // 3. File name and drive link detection using GoogleDriveService.isPaymentFileName
    if (doc.fileName && GoogleDriveService.isPaymentFileName(doc.fileName)) return true;
    if (doc.driveLink && GoogleDriveService.isPaymentFileName(doc.driveLink)) return true;

    // 4. Check OCR data
    const ocr = doc.ocrResult || doc.editedData || doc.ocr;
    if (ocr) {
      if (ocr.documentType === 'payment') return true;
      if (ocr.matchedInvoiceNumber || (ocr.matchedInvoiceAmount && ocr.matchedInvoiceAmount > 0)) return true;
      const docTypeUkr = (ocr.documentTypeUkrainian || '').toLowerCase();
      const docTitle = (ocr.documentTitle || '').toLowerCase();
      if (/(платіж|інструкц|доручен|квитанц|виписк|чек|ордер|меморіал|касов|переказ|payment|receipt)/i.test(docTypeUkr)) return true;
      if (/(платіж|інструкц|доручен|квитанц|виписк|чек|ордер|меморіал|касов|переказ|payment|receipt)/i.test(docTitle)) return true;
      if (ocr.paymentNumber && (!ocr.lineItems || ocr.lineItems.length === 0)) return true;
      if (ocr.bankExecutionStamp) return true;
      if (ocr.paymentPurpose && /(згідно|оплата|сплата|перерахування)/i.test(ocr.paymentPurpose)) return true;
      if (ocr.referencedInvoiceNumber || (ocr.referencedInvoiceNumbers && ocr.referencedInvoiceNumbers.length > 0)) return true;
    }

    return false;
  };

  // Helper to verify if a document is an invoice
  const isInvoiceDocument = (doc: ProcessedDocument): boolean => {
    if (!doc) return false;
    return !isPaymentDocument(doc);
  };

  // Helper to match document preview / scan strictly for INVOICES (excluding payment slips)
  const findMatchingDocScan = (inv: ExistingSheetRow) => {
    if (documents.length === 0) return null;

    // Filter to invoice documents only — strictly ignore any payment slips!
    const invoiceDocs = documents.filter((doc) => isInvoiceDocument(doc));
    if (invoiceDocs.length === 0) return null;

    const invNum = String(inv.invoiceNumber || '').trim();
    const cleanInvNum = OCRService.sanitizeInvoiceNumber(invNum).toLowerCase();
    const invSup = OCRService.normalizeCompanyName(inv.supplier || '').toLowerCase();
    const invOrder = OCRService.normalizeOrderNumber(inv.orderNumber || '').toLowerCase();
    const invAmount = Number(inv.amount) || 0;
    
    // 1. Exact drive link / file ID match among invoices
    if (inv.driveLink) {
      const matchByDrive = invoiceDocs.find((doc) => {
        if (doc.driveLink && inv.driveLink === doc.driveLink) return true;
        if (doc.driveWebViewLink && inv.driveLink === doc.driveWebViewLink) return true;
        if (doc.driveFileId && inv.driveLink.includes(doc.driveFileId)) return true;
        return false;
      });
      if (matchByDrive) return matchByDrive;
    }

    // 2. Direct file name match among invoices
    if (inv.fileName) {
      const cleanInvFn = inv.fileName.trim().toLowerCase();
      const matchByFileName = invoiceDocs.find((doc) => {
        return doc.fileName && doc.fileName.trim().toLowerCase() === cleanInvFn;
      });
      if (matchByFileName) return matchByFileName;
    }

    // 3. Exact sheet row match (ONLY if doc was explicitly synced to the Invoices tab and matches supplier or number)
    if (inv.rowIndex) {
      const matchByRow = invoiceDocs.find((doc) => {
        const isInInvoicesTab = !doc.alreadyInSheetTab || /рахун|invoice/i.test(doc.alreadyInSheetTab);
        if (!isInInvoicesTab) return false;
        if (doc.syncedRowIndex !== inv.rowIndex) return false;

        const docOcr = doc.ocrResult || doc.editedData || doc.ocr;
        const cleanDocInv = docOcr?.invoiceNumber ? OCRService.sanitizeInvoiceNumber(docOcr.invoiceNumber).toLowerCase() : '';
        const docSup = OCRService.normalizeCompanyName(docOcr?.supplierName || '').toLowerCase();
        const docAmount = Number(docOcr?.totalAmount) || 0;

        if (cleanInvNum && cleanDocInv && cleanInvNum === cleanDocInv) return true;
        if (invSup && docSup && (docSup.includes(invSup) || invSup.includes(docSup))) return true;
        if (invAmount > 0 && docAmount > 0 && Math.abs(invAmount - docAmount) < 1) return true;
        return false;
      });
      if (matchByRow) return matchByRow;
    }

    // 4. Exact invoice number + supplier match
    if (cleanInvNum && cleanInvNum.length >= 2) {
      const matchByNumAndSup = invoiceDocs.find((doc) => {
        const docOcr = doc.ocrResult || doc.editedData || doc.ocr;
        const cleanDocInv = docOcr?.invoiceNumber ? OCRService.sanitizeInvoiceNumber(docOcr.invoiceNumber).toLowerCase() : '';
        const docSup = OCRService.normalizeCompanyName(docOcr?.supplierName || '').toLowerCase();
        
        const numMatches = cleanDocInv && (cleanDocInv === cleanInvNum || cleanDocInv.includes(cleanInvNum) || cleanInvNum.includes(cleanDocInv));
        const supMatches = invSup && docSup && (docSup.includes(invSup) || invSup.includes(docSup));
        return numMatches && supMatches;
      });
      if (matchByNumAndSup) return matchByNumAndSup;
    }

    // 5. Exact invoice number + amount match
    if (cleanInvNum && cleanInvNum.length >= 2 && invAmount > 0) {
      const matchByNumAndAmount = invoiceDocs.find((doc) => {
        const docOcr = doc.ocrResult || doc.editedData || doc.ocr;
        const cleanDocInv = docOcr?.invoiceNumber ? OCRService.sanitizeInvoiceNumber(docOcr.invoiceNumber).toLowerCase() : '';
        const docAmount = Number(docOcr?.totalAmount) || 0;
        
        const numMatches = cleanDocInv && (cleanDocInv === cleanInvNum || cleanDocInv.includes(cleanInvNum));
        const amountMatches = docAmount > 0 && Math.abs(invAmount - docAmount) < 1;
        return numMatches && amountMatches;
      });
      if (matchByNumAndAmount) return matchByNumAndAmount;
    }

    // 6. Match by invoice number strictly
    if (cleanInvNum && cleanInvNum.length >= 2) {
      const matchByNum = invoiceDocs.find((doc) => {
        const docOcr = doc.ocrResult || doc.editedData || doc.ocr;
        const cleanDocInv = docOcr?.invoiceNumber ? OCRService.sanitizeInvoiceNumber(docOcr.invoiceNumber).toLowerCase() : '';
        return cleanDocInv && cleanDocInv === cleanInvNum;
      });
      if (matchByNum) return matchByNum;
    }

    // 7. Order number + Supplier + Amount match
    if (invOrder && invSup && invAmount > 0) {
      const matchByOrderAndSup = invoiceDocs.find((doc) => {
        const docOcr = doc.ocrResult || doc.editedData || doc.ocr;
        const docOrder = OCRService.normalizeOrderNumber(docOcr?.handwrittenOrderNumber || docOcr?.referencedOrderNumber || '').toLowerCase();
        const docSup = OCRService.normalizeCompanyName(docOcr?.supplierName || '').toLowerCase();
        const docAmount = Number(docOcr?.totalAmount) || 0;

        const orderMatches = docOrder && docOrder === invOrder;
        const supMatches = docSup && (docSup.includes(invSup) || invSup.includes(docSup));
        const amountsMatch = docAmount > 0 && Math.abs(invAmount - docAmount) < 1;
        return orderMatches && supMatches && amountsMatch;
      });
      if (matchByOrderAndSup) return matchByOrderAndSup;
    }

    return null;
  };

  // Helper helper to avoid typo
  const docDocInv = (a: string, b: string) => b;

  // Open Google Drive In-App Preview & Management Modal
  const handleOpenDriveLinkModal = (item: PendingInvoiceItem) => {
    const matchingDoc = item.originalInvoice ? findMatchingDocScan(item.originalInvoice) : null;
    let localPreviewUrl = item.previewUrl;
    if (!localPreviewUrl && matchingDoc?.previewDataUrl) {
      localPreviewUrl = matchingDoc.previewDataUrl;
    }
    if (!localPreviewUrl && documents && documents.length > 0) {
      const cleanLink = item.driveLink ? GoogleSheetsService.cleanDriveUrl(item.driveLink) : '';
      const matched = documents.find((d) => {
        if (item.rowIndex && d.syncedRowIndex === item.rowIndex) return true;
        if (item.fileName && d.fileName && item.fileName.trim().toLowerCase() === d.fileName.trim().toLowerCase()) return true;
        if (cleanLink && d.driveLink && GoogleSheetsService.cleanDriveUrl(d.driveLink) === cleanLink) return true;
        return false;
      });
      if (matched?.previewDataUrl) {
        localPreviewUrl = matched.previewDataUrl;
      }
    }

    setDriveLinkModal({
      rowIndex: item.rowIndex,
      title: `Рахунок ${item.invoiceNumber ? `№${item.invoiceNumber}` : 'б/н'} (${item.supplier})`,
      currentLink: item.driveLink,
      fileName: item.fileName,
      localPreviewUrl,
      itemId: item.id,
    });
  };

  // Compute pending unapproved invoices
  const pendingItems = useMemo<PendingInvoiceItem[]>(() => {
    // Check real existing invoices in sheet
    const realPending: PendingInvoiceItem[] = [];

    existingInvoices.forEach((inv) => {
      // КРИТИЧНА ВИМОГА КОРИСТУВАЧА:
      // "Увага в блоці на погодження керівнику відображаємо тільки рахунки зі статусом Не оплачено"
      const rawPayStatus = String(inv.paymentStatus || '').trim().toLowerCase();
      const isUnpaid =
        rawPayStatus === 'не оплачено' ||
        rawPayStatus === 'unpaid' ||
        (!rawPayStatus && Number(inv.paidAmount || 0) === 0 && (!inv.paymentStatus || inv.paymentStatus === 'Не оплачено'));

      // Категорично відсікаємо будь-які оплачені або частково оплачені рахунки
      if (!isUnpaid || (rawPayStatus.includes('оплачено') && !rawPayStatus.includes('не'))) {
        return;
      }

      // Перевірка статусу погодження: виключаємо вже погоджені та відхилені
      const isExplicitlyHandled =
        inv.approvalStatus === 'ПОГОДЖЕНО' ||
        inv.approvalStatus === 'Approved' ||
        inv.approvalStatus === 'ВІДХИЛЕНО' ||
        inv.approvalStatus === 'Rejected';

      if (isExplicitlyHandled) {
        return;
      }

      const id = `inv-row-${inv.rowIndex}-${inv.invoiceNumber || 'no-num'}`;
      if (dismissedIds.has(id)) return;

      const resolvedTitle = resolveProjectTitle(inv.orderNumber);
      const matchingDoc = findMatchingDocScan(inv);

      let effectiveDriveLink: string | undefined = undefined;
      let driveFileId: string | undefined = undefined;
      let previewUrl: string | undefined = undefined;
      let thumbnailUrl: string | undefined = undefined;
      let fileName: string | undefined = undefined;

      // 1. From matchingDoc (strictly verified as invoice document)
      if (matchingDoc) {
        driveFileId = matchingDoc.driveFileId;
        previewUrl = matchingDoc.previewDataUrl || (matchingDoc.thumbnailUrl ? matchingDoc.thumbnailUrl.replace(/=s\d+/, '=s1600') : undefined);
        thumbnailUrl = matchingDoc.thumbnailUrl;
        fileName = matchingDoc.fileName;
        effectiveDriveLink = matchingDoc.driveLink || matchingDoc.driveWebViewLink || (driveFileId ? `https://drive.google.com/file/d/${driveFileId}/view` : undefined);
      }

      // 2. From spreadsheet row's direct driveLink (only if not a payment file)
      if (inv.driveLink) {
        const isSuspectPayment = GoogleDriveService.isPaymentFileName(inv.driveLink) || (inv.fileName && GoogleDriveService.isPaymentFileName(inv.fileName));
        if (!isSuspectPayment) {
          effectiveDriveLink = inv.driveLink;
          const extractedId = GoogleDriveService.extractFileId(inv.driveLink);
          if (extractedId) driveFileId = extractedId;
        }
      }

      if (inv.fileName && !GoogleDriveService.isPaymentFileName(inv.fileName)) {
        fileName = inv.fileName;
      }

      const finalDriveLink = overriddenLinks[id] !== undefined ? (overriddenLinks[id] || undefined) : effectiveDriveLink;

      realPending.push({
        id,
        rowIndex: inv.rowIndex,
        supplier: inv.supplier || 'Невідомий постачальник',
        projectNumber: inv.orderNumber ? (inv.orderNumber.startsWith('#') ? inv.orderNumber : `#${inv.orderNumber}`) : 'Без проєкту',
        projectTitle: resolvedTitle,
        amount: Number(inv.amount) || 0,
        currency: inv.currency || 'UAH',
        vatIncluded: true,
        paymentStatus: 'Не оплачено',
        invoiceDate: inv.invoiceDate || '—',
        invoiceNumber: inv.invoiceNumber || undefined,
        note: inv.notes || matchingDoc?.ocr?.notes || undefined,
        driveLink: finalDriveLink,
        driveFileId: finalDriveLink ? (GoogleDriveService.extractFileId(finalDriveLink) || driveFileId) : undefined,
        thumbnailUrl,
        mimeType: matchingDoc?.mimeType,
        fileName: fileName || matchingDoc?.fileName,
        previewUrl,
        originalInvoice: inv,
        isDemo: false,
      });
    });

    if (realPending.length > 0) {
      return realPending;
    }

    // If no real unapproved invoices found, provide the realistic demo items
    return INITIAL_DEMO_PENDING_INVOICES
      .filter((item) => !dismissedIds.has(item.id))
      .map((item) => ({
        ...item,
        driveLink: overriddenLinks[item.id] !== undefined ? (overriddenLinks[item.id] || undefined) : item.driveLink,
        driveFileId: overriddenLinks[item.id] ? GoogleDriveService.extractFileId(overriddenLinks[item.id]) : item.driveFileId,
      }));
  }, [existingInvoices, dismissedIds, projects, documents, overriddenLinks]);

  // Handle Approve action
  const handleApprove = async (item: PendingInvoiceItem) => {
    if (processingId) return;
    setProcessingId(item.id);

    const now = new Date();
    const approvedAt = now.toLocaleString('uk-UA', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const approvedBy = userEmail || '124etc@gmail.com';

    try {
      if (item.originalInvoice && onApproveInvoice) {
        await onApproveInvoice(item.originalInvoice, approvedBy, approvedAt);
      } else if (item.originalInvoice && sheetConfig?.spreadsheetId && accessToken) {
        await GoogleSheetsService.updateInvoiceApprovalInSheet(
          sheetConfig.spreadsheetId,
          accessToken,
          item.originalInvoice.rowIndex,
          'ПОГОДЖЕНО',
          item.originalInvoice.invoiceNumber,
          item.originalInvoice.supplier,
          sheetConfig.invoicesSheetName || 'Рахунки',
          { approvedBy, approvedAt }
        );
      }

      // Add to dismissed IDs so it animates out
      setDismissedIds((prev) => new Set([...prev, item.id]));
      showToast(`✅ Рахунок від ${item.supplier} погоджено! (${approvedBy})`, 'success');
    } catch (err: any) {
      showToast(err.message || 'Помилка збереження погодження в таблиці.', 'error');
    } finally {
      setProcessingId(null);
    }
  };

  // Open reject modal
  const openRejectDialog = (item: PendingInvoiceItem) => {
    setRejectingItem(item);
    setRejectionReason('');
  };

  // Submit reject action
  const handleConfirmReject = async () => {
    if (!rejectingItem || isSubmittingReject) return;
    setIsSubmittingReject(true);

    const now = new Date();
    const rejectedAt = now.toLocaleString('uk-UA', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const rejectedBy = userEmail || '124etc@gmail.com';
    const finalReason = rejectionReason.trim() || 'Відхилено керівником без додаткових коментарів';

    try {
      if (rejectingItem.originalInvoice && onRejectInvoice) {
        await onRejectInvoice(rejectingItem.originalInvoice, rejectedBy, rejectedAt, finalReason);
      } else if (rejectingItem.originalInvoice && sheetConfig?.spreadsheetId && accessToken) {
        await GoogleSheetsService.updateInvoiceApprovalInSheet(
          sheetConfig.spreadsheetId,
          accessToken,
          rejectingItem.originalInvoice.rowIndex,
          'ВІДХИЛЕНО',
          rejectingItem.originalInvoice.invoiceNumber,
          rejectingItem.originalInvoice.supplier,
          sheetConfig.invoicesSheetName || 'Рахунки',
          { approvedBy: rejectedBy, approvedAt: rejectedAt, rejectionReason: finalReason }
        );
      }

      const itemId = rejectingItem.id;
      setDismissedIds((prev) => new Set([...prev, itemId]));
      setRejectingItem(null);
      showToast(`❌ Рахунок від ${rejectingItem.supplier} відхилено: "${finalReason}"`, 'info');
    } catch (err: any) {
      showToast(err.message || 'Помилка запису відхилення.', 'error');
    } finally {
      setIsSubmittingReject(false);
    }
  };

  // Reset dismissed items to test the flow again
  const handleResetQueue = () => {
    setDismissedIds(new Set());
    showToast('Чергу рахунків на погодження оновлено!', 'info');
  };

  return (
    <div id="manager-approval-widget" className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs flex flex-col justify-between">
      {/* Block Header: 📄 На погодження керівнику + лічильник кількості */}
      <div>
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
              <span className="text-base" role="img" aria-label="document">📄</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900">
                  На погодження керівнику
                </h3>
                <span className={`px-2 py-0.5 rounded-full text-xs font-bold transition-all ${
                  pendingItems.length > 0
                    ? 'bg-amber-100 text-amber-800 border border-amber-200'
                    : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                }`}>
                  ({pendingItems.length})
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Рахунки <span className="font-semibold text-rose-600">«Не оплачено»</span> • Керівник: <span className="font-semibold text-slate-700">{userEmail}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-1.5">
            {dismissedIds.size > 0 && (
              <button
                type="button"
                onClick={handleResetQueue}
                title="Скинути фільтри черги"
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer text-xs"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            )}
            {onViewAllInvoices && (
              <button
                type="button"
                onClick={onViewAllInvoices}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold cursor-pointer transition-colors"
              >
                Усі
              </button>
            )}
          </div>
        </div>

        {/* Temporary toast alert */}
        {toastMessage && (
          <div className={`mt-3 p-2.5 rounded-xl text-xs font-medium border flex items-center justify-between animate-fadeIn ${
            toastMessage.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : toastMessage.type === 'error'
              ? 'bg-rose-50 text-rose-800 border-rose-200'
              : 'bg-slate-100 text-slate-800 border-slate-200'
          }`}>
            <span>{toastMessage.text}</span>
            <button
              onClick={() => setToastMessage(null)}
              className="text-slate-400 hover:text-slate-600 ml-2"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Cards List or Empty State */}
        <div className="mt-4 space-y-3.5">
          <AnimatePresence mode="popLayout">
            {pendingItems.length > 0 ? (
              pendingItems.map((item) => {
                const isItemProcessing = processingId === item.id;

                return (
                  <motion.div
                    key={item.id}
                    id={`approval-card-${item.id}`}
                    layout
                    initial={{ opacity: 0, y: 12, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.92, height: 0, marginBottom: 0, transition: { duration: 0.25 } }}
                    transition={{ duration: 0.2 }}
                    className="p-4 rounded-xl border border-slate-200 hover:border-slate-300 bg-slate-50/40 hover:bg-white shadow-2xs hover:shadow-xs transition-all flex flex-col justify-between"
                  >
                    <div>
                      {/* Top Row: Supplier & Invoice Number */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Building2 className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                          <div className="font-bold text-slate-900 text-sm truncate" title={item.supplier}>
                            {item.supplier}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="px-1.5 py-0.5 bg-rose-50 text-rose-700 text-[10px] font-bold rounded border border-rose-200">
                            Не оплачено
                          </span>
                          {item.invoiceNumber && (
                            <span className="px-2 py-0.5 bg-slate-100 text-slate-700 text-[11px] font-mono font-medium rounded-md border border-slate-200/80">
                              № {item.invoiceNumber}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Project Field: № та назва замовлення */}
                      <div className="mt-2 flex items-center gap-1.5 text-xs">
                        <Briefcase className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                        <span className="font-semibold text-blue-700">Проєкт:</span>
                        <span className="font-bold text-slate-800 truncate" title={`${item.projectNumber} ${item.projectTitle}`}>
                          {item.projectNumber} {item.projectTitle ? `• ${item.projectTitle}` : ''}
                        </span>
                      </div>

                      {/* Large Amount: Сума рахунку з ПДВ великим шрифтом */}
                      <div className="mt-3 flex items-baseline justify-between pt-2.5 border-t border-slate-200/60">
                        <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                          Сума з ПДВ
                        </span>
                        <div className="text-right">
                          <span className="text-lg sm:text-xl font-extrabold text-slate-900 font-mono tracking-tight">
                            {formatCurrency(item.amount)}
                          </span>
                          <span className="ml-1 text-xs font-bold text-slate-600">грн</span>
                        </div>
                      </div>

                      {/* Date & Note: короткий коментар секретаря/PM, якщо є */}
                      <div className="mt-2.5 space-y-1 text-xs text-slate-600">
                        <div className="flex items-center gap-1.5 text-slate-500 text-[11px]">
                          <Calendar className="w-3 h-3 text-slate-400 shrink-0" />
                          <span>Дата: {item.invoiceDate}</span>
                        </div>

                        {item.note && (
                          <div className="p-2 bg-amber-50/70 border border-amber-200/60 rounded-lg text-amber-900 text-[11px] flex items-start gap-1.5">
                            <MessageSquare className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                            <span className="leading-snug">{item.note}</span>
                          </div>
                        )}
                      </div>

                      {/* File Preview & Google Drive Link Section */}
                      <div className="mt-3 pt-2.5 border-t border-slate-200/60">
                        {item.driveLink ? (
                          <div className="flex items-center justify-between p-2 rounded-lg bg-indigo-50/70 border border-indigo-100/90 gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="w-6 h-6 rounded-md bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0">
                                <FileText className="w-3.5 h-3.5" />
                              </div>
                              <div className="min-w-0">
                                <div className="text-[11px] font-bold text-indigo-950 truncate max-w-[170px] sm:max-w-[220px]" title={item.fileName || 'Файл на Google Диску'}>
                                  {item.fileName || 'Файл на Google Диску'}
                                </div>
                                <div className="text-[10px] text-indigo-600 font-medium flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                  <span>Google Диск підключено</span>
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => handleOpenDriveLinkModal(item)}
                                className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-[11px] font-semibold flex items-center gap-1 shadow-2xs hover:shadow-xs transition-colors cursor-pointer"
                                title="Переглянути скан рахунку у модальному вікні"
                              >
                                <Eye className="w-3 h-3" />
                                <span>Переглянути</span>
                              </button>
                              <a
                                href={GoogleSheetsService.cleanDriveUrl(item.driveLink)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-1 bg-white hover:bg-indigo-100 text-indigo-600 border border-indigo-200 rounded-md transition-colors"
                                title="Відкрити на Google Диску у новій вкладці"
                              >
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            </div>
                          </div>
                        ) : item.previewUrl ? (
                          <div className="flex items-center justify-between p-2 rounded-lg bg-emerald-50/70 border border-emerald-100/90 gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="w-6 h-6 rounded-md bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                                <FileText className="w-3.5 h-3.5" />
                              </div>
                              <div className="min-w-0">
                                <div className="text-[11px] font-bold text-emerald-950 truncate max-w-[170px] sm:max-w-[220px]" title={item.fileName || 'Локальний скан'}>
                                  {item.fileName || 'Локальний скан рахунку'}
                                </div>
                                <div className="text-[10px] text-emerald-600 font-medium">Скан розпізнано</div>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => handleOpenDriveLinkModal(item)}
                                className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-[11px] font-semibold flex items-center gap-1 shadow-2xs transition-colors cursor-pointer"
                                title="Переглянути локальний скан рахунку"
                              >
                                <Eye className="w-3 h-3" />
                                <span>Скан</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleOpenDriveLinkModal(item)}
                                className="px-2 py-1 bg-white hover:bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-md text-[11px] font-medium flex items-center gap-1 transition-colors cursor-pointer"
                                title="Прикріпити посилання на Google Диск"
                              >
                                <FolderOpen className="w-3 h-3 text-indigo-600" />
                                <span>+ Диск</span>
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between p-1.5 px-2.5 rounded-lg bg-slate-50 border border-slate-200/70 text-slate-500">
                            <span className="text-[11px] text-slate-500 flex items-center gap-1.5">
                              <FolderOpen className="w-3.5 h-3.5 text-slate-400" />
                              <span>Файл на Диску не прикріплено</span>
                            </span>
                            <button
                              type="button"
                              onClick={() => handleOpenDriveLinkModal(item)}
                              className="px-2.5 py-1 bg-white hover:bg-indigo-50 text-indigo-600 hover:text-indigo-700 border border-indigo-200 rounded-md text-[11px] font-semibold flex items-center gap-1 shadow-2xs transition-colors cursor-pointer"
                              title="Додати посилання на Google Диск (Колонка L)"
                            >
                              <ExternalLink className="w-3 h-3 text-indigo-500" />
                              <span>+ Посилання на Диск</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Action Buttons: ✅ Погодити | ❌ Відхилити */}
                    <div className="mt-4 pt-3 border-t border-slate-100 grid grid-cols-2 gap-2.5">
                      {/* Button 1: ✅ Погодити (Green button) */}
                      <button
                        type="button"
                        id={`btn-approve-${item.id}`}
                        disabled={isItemProcessing}
                        onClick={() => handleApprove(item)}
                        className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow-2xs hover:shadow-xs active:scale-95 cursor-pointer whitespace-nowrap disabled:opacity-50"
                        title="Погодити рахунок в один клік"
                      >
                        {isItemProcessing ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Check className="w-3.5 h-3.5" />
                        )}
                        <span>Погодити</span>
                      </button>

                      {/* Button 2: ❌ Відхилити (Red/grey button) */}
                      <button
                        type="button"
                        id={`btn-reject-${item.id}`}
                        disabled={isItemProcessing}
                        onClick={() => openRejectDialog(item)}
                        className="px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
                        title="Відхилити рахунок із зазначенням причини"
                      >
                        <X className="w-3.5 h-3.5 text-rose-600" />
                        <span>Відхилити</span>
                      </button>
                    </div>
                  </motion.div>
                );
              })
            ) : (
              /* Empty State: 🎉 Усі рахунки погоджено! Черга порожня. */
              <motion.div
                key="empty-approval-state"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.25 }}
                className="py-8 px-4 text-center rounded-xl bg-emerald-50/50 border border-emerald-200/80 flex flex-col items-center justify-center space-y-3"
              >
                <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shadow-xs">
                  <CheckCircle2 className="w-7 h-7" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-sm font-bold text-emerald-950">
                    🎉 Усі неоплачені рахунки погоджено! Черга порожня.
                  </h4>
                  <p className="text-xs text-emerald-800/80 max-w-xs mx-auto">
                    Усі неоплачені рахунки опрацьовано. Нові рахунки зі статусом «Не оплачено» з'являтимуться тут автоматично.
                  </p>
                </div>
                {dismissedIds.size > 0 && (
                  <button
                    type="button"
                    onClick={handleResetQueue}
                    className="mt-2 text-xs text-emerald-700 hover:text-emerald-900 font-semibold underline underline-offset-2 flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Показати опрацьовані рахунки</span>
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Rejection Modal Dialog */}
      <AnimatePresence>
        {rejectingItem && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white rounded-2xl shadow-xl max-w-md w-full border border-slate-200 overflow-hidden"
            >
              {/* Modal Header */}
              <div className="p-5 bg-rose-50/60 border-b border-rose-100 flex items-center justify-between">
                <div className="flex items-center space-x-2.5">
                  <div className="w-8 h-8 rounded-lg bg-rose-100 text-rose-600 flex items-center justify-center">
                    <XCircle className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      Відхилення рахунку
                    </h3>
                    <p className="text-xs text-slate-500">
                      {rejectingItem.supplier} • {formatCurrency(rejectingItem.amount)} грн
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setRejectingItem(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-white transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-5 space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    Вкажіть причину відхилення:
                  </label>
                  <textarea
                    rows={3}
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    placeholder="Наприклад: Невірна сума у рахунку, дублікат, або не погоджено PM проєкту..."
                    className="w-full text-xs p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-rose-500 focus:border-rose-500 outline-none"
                    autoFocus
                  />
                </div>

                {/* Quick chip options for fast selection */}
                <div>
                  <div className="text-[11px] font-semibold text-slate-500 mb-1.5">
                    Швидкий вибір причини:
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      'Помилка в сумі рахунку',
                      'Невірні реквізити / постачальник',
                      'Дублікат рахунку',
                      'Не погоджено PM проєкту',
                      'Відсутній підтверджуючий акт/специфікація',
                    ].map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => setRejectionReason(chip)}
                        className={`px-2 py-1 rounded-lg text-[11px] border transition-colors cursor-pointer ${
                          rejectionReason === chip
                            ? 'bg-rose-100 text-rose-800 border-rose-300 font-semibold'
                            : 'bg-slate-50 hover:bg-slate-100 text-slate-600 border-slate-200'
                        }`}
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setRejectingItem(null)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-200 transition-colors"
                >
                  Скасувати
                </button>
                <button
                  type="button"
                  disabled={isSubmittingReject}
                  onClick={handleConfirmReject}
                  className="px-4 py-1.5 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white flex items-center gap-1.5 transition-colors shadow-2xs disabled:opacity-50"
                >
                  {isSubmittingReject ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <X className="w-3.5 h-3.5" />
                  )}
                  <span>Підтвердити відхилення</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Google Drive In-App Preview & Link Modal */}
      {driveLinkModal && (
        <DriveLinkModal
          isOpen={!!driveLinkModal}
          onClose={() => setDriveLinkModal(null)}
          title={driveLinkModal.title}
          targetSheetName={sheetConfig?.invoicesSheetName || 'Рахунки'}
          targetColumn="L"
          rowIndex={driveLinkModal.rowIndex || 0}
          initialLink={driveLinkModal.currentLink}
          localPreviewUrl={driveLinkModal.localPreviewUrl}
          fileName={driveLinkModal.fileName}
          canEdit={canWriteToSheets ?? (!!sheetConfig?.spreadsheetId && !!accessToken)}
          onSave={async (newLink) => {
            const clean = GoogleSheetsService.cleanDriveUrl(newLink);
            setOverriddenLinks((prev) => ({ ...prev, [driveLinkModal.itemId]: clean }));
            if (driveLinkModal.rowIndex && sheetConfig?.spreadsheetId && accessToken) {
              await GoogleSheetsService.updateInvoiceDriveLinkInSheet(
                sheetConfig.spreadsheetId,
                accessToken,
                driveLinkModal.rowIndex,
                clean,
                sheetConfig.invoicesSheetName || 'Рахунки'
              );
            }
            showToast('Посилання Google Диск успішно збережено!', 'success');
            if (onRefresh) {
              await onRefresh();
            }
          }}
          onDelete={async () => {
            setOverriddenLinks((prev) => ({ ...prev, [driveLinkModal.itemId]: '' }));
            if (driveLinkModal.rowIndex && sheetConfig?.spreadsheetId && accessToken) {
              await GoogleSheetsService.updateInvoiceDriveLinkInSheet(
                sheetConfig.spreadsheetId,
                accessToken,
                driveLinkModal.rowIndex,
                '',
                sheetConfig.invoicesSheetName || 'Рахунки'
              );
            }
            showToast('Посилання Google Диск видалено.', 'info');
            if (onRefresh) {
              await onRefresh();
            }
          }}
        />
      )}

    </div>
  );
};
