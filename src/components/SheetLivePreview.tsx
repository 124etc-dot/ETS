import React, { useState, useMemo } from 'react';
import { 
  FileSpreadsheet, 
  RefreshCw, 
  Building2, 
  Users, 
  FileCheck,
  Search,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  AlertCircle,
  AlertTriangle,
  CreditCard,
  Calculator,
  Check,
  Loader2,
  X,
  Trash2,
  Sparkles,
  Maximize2,
  Minimize2
} from 'lucide-react';
import { SheetConfig, ExistingSheetRow, ExistingPaymentRow, SheetCompanyLists, InvoicePaymentStatus, DuplicateRowMatch } from '../types';
import { GoogleSheetsService } from '../services/googleSheets';
import { OCRService } from '../services/ocrService';

interface Props {
  sheetConfig: SheetConfig | null;
  existingInvoices: ExistingSheetRow[];
  existingPayments?: ExistingPaymentRow[];
  companyLists: SheetCompanyLists;
  onRefresh: () => Promise<void>;
  isLoading: boolean;
  onUpdateInvoiceStatus?: (rowIndex: number, newStatus: InvoicePaymentStatus, paidAmount?: number) => Promise<void>;
  onBatchReconcile?: (matches: any[]) => Promise<void>;
  onDeleteDuplicates?: (duplicates: DuplicateRowMatch[]) => Promise<void>;
  onChangePaymentsTab?: (newTab: string) => void;
  onChangeInvoicesTab?: (newTab: string) => void;
}

export const SheetLivePreview: React.FC<Props> = ({
  sheetConfig,
  existingInvoices,
  existingPayments = [],
  companyLists,
  onRefresh,
  isLoading,
  onUpdateInvoiceStatus,
  onBatchReconcile,
  onDeleteDuplicates,
  onChangePaymentsTab,
  onChangeInvoicesTab,
}) => {
  const [activeTab, setActiveTab] = useState<'invoices' | 'payments' | 'ourCompanies' | 'suppliers'>('invoices');
  const [filterText, setFilterText] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | InvoicePaymentStatus>('all');
  const [updatingRowIndex, setUpdatingRowIndex] = useState<number | null>(null);
  const [isBatchReconciling, setIsBatchReconciling] = useState(false);
  const [isDeletingDuplicates, setIsDeletingDuplicates] = useState(false);
  const [showDuplicatesModal, setShowDuplicatesModal] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);

  // Real-time detection of duplicate rows in "Рахунки" and "Платіжки"
  const duplicateInvoices = useMemo(
    () => OCRService.findDuplicateInvoices(existingInvoices),
    [existingInvoices]
  );
  const duplicatePayments = useMemo(
    () => OCRService.findDuplicatePayments(existingPayments),
    [existingPayments]
  );
  const allDuplicates = useMemo(
    () => [...duplicateInvoices, ...duplicatePayments],
    [duplicateInvoices, duplicatePayments]
  );

  const duplicateInvoicesMap = useMemo(() => {
    const map = new Map<number, DuplicateRowMatch>();
    for (const d of duplicateInvoices) {
      map.set(d.rowIndex, d);
    }
    return map;
  }, [duplicateInvoices]);

  const duplicatePaymentsMap = useMemo(() => {
    const map = new Map<number, DuplicateRowMatch>();
    for (const d of duplicatePayments) {
      map.set(d.rowIndex, d);
    }
    return map;
  }, [duplicatePayments]);

  const handleDeleteAllDuplicates = async () => {
    if (!onDeleteDuplicates || allDuplicates.length === 0) return;
    const confirmed = window.confirm(
      `Видалити всі ${allDuplicates.length} виявлених дублікатів рядків з Google Таблиці?\n\nПерші оригінальні записи буде збережено, видаляться лише повторні рядки.`
    );
    if (!confirmed) return;

    setIsDeletingDuplicates(true);
    try {
      await onDeleteDuplicates(allDuplicates);
      setShowDuplicatesModal(false);
    } finally {
      setIsDeletingDuplicates(false);
    }
  };

  const handleDeleteSingleDuplicate = async (match: DuplicateRowMatch) => {
    if (!onDeleteDuplicates) return;
    const confirmed = window.confirm(
      `Видалити дублікат рядок ${match.rowIndex} з вкладки "${match.tabName}" (${match.identifier})?`
    );
    if (!confirmed) return;

    setIsDeletingDuplicates(true);
    try {
      await onDeleteDuplicates([match]);
    } finally {
      setIsDeletingDuplicates(false);
    }
  };

  if (!sheetConfig?.isConfigured) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-12 text-center shadow-xs space-y-4">
        <div className="w-12 h-12 bg-emerald-50 text-emerald-700 rounded-xl flex items-center justify-center mx-auto border border-emerald-200">
          <FileSpreadsheet className="w-6 h-6" />
        </div>
        <div className="max-w-md mx-auto space-y-1.5">
          <h3 className="text-sm font-bold text-slate-900">
            Google Таблиця ще не підключена
          </h3>
          <p className="text-xs text-slate-500">
            Введіть посилання на вашу Google Таблицю у верхній панелі, щоб переглядати вкладки "Рахунки", "Платіжки", "Наші компанії" та "Постачальники".
          </p>
        </div>
      </div>
    );
  }

  const unpaidCount = existingInvoices.filter((i) => i.paymentStatus === 'Не оплачено').length;
  const paidCount = existingInvoices.filter((i) => i.paymentStatus === 'Оплачено').length;
  const partialCount = existingInvoices.filter((i) => i.paymentStatus === 'Оплачено частково').length;

  const trimmedFilter = filterText.trim();
  const q = trimmedFilter.toLowerCase();

  const filteredInvoices = existingInvoices.filter((inv) => {
    if (statusFilter !== 'all' && inv.paymentStatus !== statusFilter) {
      return false;
    }
    if (!trimmedFilter) return true;
    return (
      inv.orderNumber?.toLowerCase().includes(q) ||
      inv.supplier?.toLowerCase().includes(q) ||
      inv.buyer?.toLowerCase().includes(q) ||
      inv.invoiceNumber?.toLowerCase().includes(q)
    );
  });

  // All invoices matching the search query/order number across ALL statuses
  const orderMatchedInvoicesAllStatuses = trimmedFilter
    ? existingInvoices.filter((inv) => {
        return (
          inv.orderNumber?.toLowerCase().includes(q) ||
          inv.supplier?.toLowerCase().includes(q) ||
          inv.buyer?.toLowerCase().includes(q) ||
          inv.invoiceNumber?.toLowerCase().includes(q)
        );
      })
    : [];

  // Check if search query matched order number(s) specifically
  const matchedOrderNumbers = Array.from(
    new Set(
      orderMatchedInvoicesAllStatuses
        .map((inv) => inv.orderNumber?.trim())
        .filter((num): num is string => Boolean(num && num.toLowerCase().includes(q)))
    )
  );
  const isOrderFilter = matchedOrderNumbers.length > 0;

  // Sum of all materials/invoices for this order regardless of payment status
  const totalOrderAmount = orderMatchedInvoicesAllStatuses.reduce(
    (acc, inv) => acc + (inv.amount || 0),
    0
  );

  const totalOrderPaid = orderMatchedInvoicesAllStatuses.reduce((acc, inv) => {
    const amt = inv.amount || 0;
    const paid =
      inv.paidAmount !== undefined
        ? inv.paidAmount
        : inv.paymentStatus === 'Оплачено'
        ? amt
        : 0;
    return acc + paid;
  }, 0);

  const totalOrderRemaining = Math.max(0, totalOrderAmount - totalOrderPaid);

  const displayedInvoicesAmount = filteredInvoices.reduce((acc, inv) => acc + (inv.amount || 0), 0);
  const displayedInvoicesPaid = filteredInvoices.reduce((acc, inv) => {
    const amt = inv.amount || 0;
    const paid =
      inv.paidAmount !== undefined
        ? inv.paidAmount
        : inv.paymentStatus === 'Оплачено'
        ? amt
        : 0;
    return acc + paid;
  }, 0);

  const filteredPayments = existingPayments.filter((pay) => {
    if (!trimmedFilter) return true;
    return (
      pay.paymentNumber?.toLowerCase().includes(q) ||
      pay.payer?.toLowerCase().includes(q) ||
      pay.payee?.toLowerCase().includes(q) ||
      pay.referencedInvoiceNumber?.toLowerCase().includes(q) ||
      pay.paymentPurpose?.toLowerCase().includes(q) ||
      pay.orderNumber?.toLowerCase().includes(q)
    );
  });

  // Guarantee strictly deduplicated lists for display
  const uniqueOur = GoogleSheetsService.deduplicateCompanyList(companyLists.ourCompanies);
  const uniqueSuppliers = GoogleSheetsService.deduplicateCompanyList(companyLists.suppliers);

  // Reconcile invoices with payments from "Платіжки"
  const reconciledMatches = useMemo(() => {
    return OCRService.reconcileInvoicesWithPayments(existingInvoices, existingPayments);
  }, [existingInvoices, existingPayments]);

  const reconciledMap = useMemo(() => {
    const map = new Map<number, (typeof reconciledMatches)[0]>();
    for (const m of reconciledMatches) {
      map.set(m.invoiceRowIndex, m);
    }
    return map;
  }, [reconciledMatches]);

  const pendingReconciliations = useMemo(() => {
    return reconciledMatches.filter((m) => m.currentStatus !== 'Оплачено');
  }, [reconciledMatches]);

  const handleStatusChange = async (rowIndex: number, newStatus: InvoicePaymentStatus, customPaidAmt?: number) => {
    if (!onUpdateInvoiceStatus) return;
    setUpdatingRowIndex(rowIndex);
    try {
      const targetInvoice = existingInvoices.find((i) => i.rowIndex === rowIndex);
      const recMatch = reconciledMap.get(rowIndex);
      const paidAmt =
        customPaidAmt !== undefined
          ? customPaidAmt
          : newStatus === 'Оплачено'
          ? (recMatch?.paidAmount || targetInvoice?.amount || 0)
          : (targetInvoice?.paidAmount || 0);
      await onUpdateInvoiceStatus(rowIndex, newStatus, paidAmt);
    } finally {
      setUpdatingRowIndex(null);
    }
  };

  const handleBatchReconcileAllPending = async () => {
    if (pendingReconciliations.length === 0) return;
    setIsBatchReconciling(true);
    try {
      if (onBatchReconcile) {
        await onBatchReconcile(pendingReconciliations);
      } else if (onUpdateInvoiceStatus) {
        for (const item of pendingReconciliations) {
          await onUpdateInvoiceStatus(item.invoiceRowIndex, item.computedStatus, item.paidAmount);
        }
      }
    } finally {
      setIsBatchReconciling(false);
    }
  };

  return (
    <div
      className={`bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden flex-1 flex flex-col min-h-0 transition-all ${
        isMaximized
          ? 'fixed inset-2 md:inset-4 z-50 rounded-2xl shadow-2xl border-slate-300'
          : ''
      }`}
    >
      {/* Header & Tabs */}
      <div className="p-4 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3 bg-slate-50/50 shrink-0">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0">
            <FileSpreadsheet className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="text-sm font-bold text-slate-900">{sheetConfig.spreadsheetTitle}</h3>
              <a
                href={sheetConfig.spreadsheetUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-emerald-700 hover:text-emerald-900 flex items-center space-x-1 font-semibold"
              >
                <span>Відкрити в Sheets</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </a>
            </div>
            <p className="text-xs text-slate-500">
              Синхронізовані дані з хмарної таблиці <span className="text-emerald-700 font-medium">(Лист1 не змінюється)</span>
            </p>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex items-center space-x-2">
          <div className="flex items-center bg-slate-200/70 p-1 rounded-lg text-xs font-semibold">
            <button
              onClick={() => setActiveTab('invoices')}
              className={`px-3 py-1.5 rounded-md transition-colors flex items-center space-x-1.5 ${
                activeTab === 'invoices'
                  ? 'bg-white text-emerald-800 shadow-xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileCheck className="w-3.5 h-3.5" />
              <span>Рахунки ({existingInvoices.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('payments')}
              className={`px-3 py-1.5 rounded-md transition-colors flex items-center space-x-1.5 ${
                activeTab === 'payments'
                  ? 'bg-white text-blue-800 shadow-xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <CreditCard className="w-3.5 h-3.5" />
              <span>Платіжки ({existingPayments.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('ourCompanies')}
              className={`px-3 py-1.5 rounded-md transition-colors flex items-center space-x-1.5 ${
                activeTab === 'ourCompanies'
                  ? 'bg-white text-indigo-800 shadow-xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Building2 className="w-3.5 h-3.5" />
              <span>Наші компанії ({uniqueOur.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('suppliers')}
              className={`px-3 py-1.5 rounded-md transition-colors flex items-center space-x-1.5 ${
                activeTab === 'suppliers'
                  ? 'bg-white text-amber-800 shadow-xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Постачальники ({uniqueSuppliers.length})</span>
            </button>
          </div>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={() => setShowDuplicatesModal(true)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer border ${
                allDuplicates.length > 0
                  ? 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100 shadow-xs'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
              title="Перевірка та видалення дублікатів у Рахунках та Платіжках"
            >
              {allDuplicates.length > 0 ? (
                <AlertTriangle className="w-3.5 h-3.5 text-amber-700 shrink-0" />
              ) : (
                <Sparkles className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              )}
              <span>
                Дублікати: {allDuplicates.length > 0 ? `${allDuplicates.length} знайдено` : '0'}
              </span>
            </button>

            <button
              onClick={onRefresh}
              disabled={isLoading}
              className="p-2 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors shadow-xs disabled:opacity-50 cursor-pointer"
              title="Оновити дані з Google Sheets"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            </button>

            <button
              type="button"
              onClick={() => setIsMaximized((prev) => !prev)}
              className="p-2 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors shadow-xs cursor-pointer"
              title={isMaximized ? 'Згорнути до стандартного розміру' : 'Розгорнути таблицю на весь екран'}
            >
              {isMaximized ? (
                <Minimize2 className="w-3.5 h-3.5" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Tab: Invoices */}
      {activeTab === 'invoices' && (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Sub-bar: Search & Status Filters */}
          <div className="p-3 border-b border-slate-100 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
            <div className="relative w-full sm:w-80">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder="Фільтр за номером замовлення (ххх-хх), постачальником..."
                className="w-full text-xs pl-8 pr-8 py-1.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              {filterText && (
                <button
                  type="button"
                  onClick={() => setFilterText('')}
                  className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600 p-0.5 rounded cursor-pointer"
                  title="Очистити фільтр"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Status counts & filter buttons */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <button
                onClick={() => setStatusFilter('all')}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                  statusFilter === 'all'
                    ? 'bg-slate-900 text-white font-bold'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Всі ({existingInvoices.length})
              </button>
              <button
                onClick={() => setStatusFilter('Не оплачено')}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors flex items-center space-x-1 cursor-pointer ${
                  statusFilter === 'Не оплачено'
                    ? 'bg-rose-600 text-white font-bold'
                    : 'bg-rose-50 text-rose-800 hover:bg-rose-100'
                }`}
              >
                <Clock className="w-3 h-3" />
                <span>Не оплачено ({unpaidCount})</span>
              </button>
              <button
                onClick={() => setStatusFilter('Оплачено частково')}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors flex items-center space-x-1 cursor-pointer ${
                  statusFilter === 'Оплачено частково'
                    ? 'bg-amber-600 text-white font-bold'
                    : 'bg-amber-50 text-amber-800 hover:bg-amber-100'
                }`}
              >
                <AlertCircle className="w-3 h-3" />
                <span>Оплачено частково ({partialCount})</span>
              </button>
              <button
                onClick={() => setStatusFilter('Оплачено')}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors flex items-center space-x-1 cursor-pointer ${
                  statusFilter === 'Оплачено'
                    ? 'bg-emerald-700 text-white font-bold'
                    : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                }`}
              >
                <CheckCircle2 className="w-3 h-3" />
                <span>Оплачено ({paidCount})</span>
              </button>
            </div>
          </div>

          {/* Indicator: Total Materials / Invoices for the filtered order(s) regardless of status */}
          {trimmedFilter && orderMatchedInvoicesAllStatuses.length > 0 && (
            <div className="p-3.5 bg-gradient-to-r from-amber-50 via-amber-50/80 to-orange-50 border-b border-amber-200 flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="flex items-start sm:items-center space-x-3">
                <div className="w-9 h-9 rounded-xl bg-amber-200 border border-amber-300 text-amber-950 flex items-center justify-center shrink-0 shadow-2xs">
                  <Calculator className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-bold uppercase tracking-wide text-amber-950">
                      {isOrderFilter
                        ? `Замовлення ${matchedOrderNumbers.map((n) => `«${n}»`).join(', ')}`
                        : `Фільтр «${trimmedFilter}»`}
                    </span>
                    <span className="text-[11px] bg-amber-200/90 text-amber-950 font-bold px-2 py-0.5 rounded-full border border-amber-300">
                      {orderMatchedInvoicesAllStatuses.length}{' '}
                      {orderMatchedInvoicesAllStatuses.length === 1
                        ? 'рахунок'
                        : orderMatchedInvoicesAllStatuses.length < 5
                        ? 'рахунки'
                        : 'рахунків'}{' '}
                      (всі статуси)
                    </span>
                    {statusFilter !== 'all' && (
                      <span className="text-[10px] bg-white text-slate-700 font-semibold px-2 py-0.5 rounded-full border border-slate-200">
                        у таблиці зі статусом «{statusFilter}»: {filteredInvoices.length}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-amber-800 mt-0.5 font-medium">
                    Загальна вартість усіх матеріалів за цим замовленням незалежно від статусу оплати
                  </p>
                </div>
              </div>

              {/* Metric Values */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="bg-white border border-amber-300 px-3.5 py-1.5 rounded-xl shadow-2xs">
                  <span className="text-[10px] text-slate-500 block font-semibold">Сума матеріалів (всі рахунки)</span>
                  <span className="text-sm sm:text-base font-bold font-mono text-slate-950">
                    {new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(totalOrderAmount)}{' '}
                    <span className="text-xs font-semibold text-slate-600">грн</span>
                  </span>
                </div>

                <div className="bg-emerald-50/90 border border-emerald-300 px-3.5 py-1.5 rounded-xl shadow-2xs">
                  <span className="text-[10px] text-emerald-800 block font-semibold">Сплачено</span>
                  <span className="text-sm sm:text-base font-bold font-mono text-emerald-950">
                    {new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(totalOrderPaid)}{' '}
                    <span className="text-xs font-semibold text-emerald-700">грн</span>
                  </span>
                </div>

                {totalOrderRemaining > 0 && (
                  <div className="bg-rose-50/90 border border-rose-300 px-3.5 py-1.5 rounded-xl shadow-2xs">
                    <span className="text-[10px] text-rose-800 block font-semibold">Залишок до сплати</span>
                    <span className="text-sm sm:text-base font-bold font-mono text-rose-950">
                      {new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(totalOrderRemaining)}{' '}
                      <span className="text-xs font-semibold text-rose-700">грн</span>
                    </span>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setFilterText('');
                    setStatusFilter('all');
                  }}
                  className="p-2 text-amber-800 hover:text-amber-950 hover:bg-amber-200/70 rounded-lg transition-colors cursor-pointer ml-1"
                  title="Скинути фільтр"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Duplicate Warning Banner: Invoices */}
          {duplicateInvoices.length > 0 && (
            <div className="mx-4 my-2.5 p-3.5 bg-amber-50/90 border border-amber-300 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
              <div className="flex items-start space-x-3">
                <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center shrink-0 mt-0.5 border border-amber-300">
                  <AlertTriangle className="w-4 h-4 text-amber-700" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-amber-950">
                    У вкладці «Рахунки» виявлено {duplicateInvoices.length} {duplicateInvoices.length === 1 ? 'дублікат рядка' : duplicateInvoices.length < 5 ? 'дублікати рядків' : 'дублікатів рядків'}!
                  </h4>
                  <p className="text-[11px] text-amber-900 mt-0.5">
                    {duplicateInvoices
                      .slice(0, 3)
                      .map((d) => `Рядок ${d.rowIndex} (дублює р. ${d.originalRowIndex}: ${d.identifier})`)
                      .join('; ')}
                    {duplicateInvoices.length > 3 && ` та ще ${duplicateInvoices.length - 3}...`}
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-2 shrink-0 self-start sm:self-center">
                <button
                  type="button"
                  onClick={() => setShowDuplicatesModal(true)}
                  className="px-3 py-1.5 bg-white border border-amber-300 hover:bg-amber-100/70 text-amber-950 rounded-lg text-xs font-semibold transition-colors cursor-pointer shadow-2xs"
                >
                  Деталі дублів
                </button>
                {onDeleteDuplicates && (
                  <button
                    type="button"
                    onClick={() => onDeleteDuplicates(duplicateInvoices)}
                    disabled={isDeletingDuplicates}
                    className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition-colors flex items-center space-x-1.5 shadow-xs cursor-pointer disabled:opacity-50"
                  >
                    {isDeletingDuplicates ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5" />
                    )}
                    <span>Видалити {duplicateInvoices.length} дублів</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Reconciliation Notice Banner: Invoices that have matching payments in "Платіжки" */}
          {pendingReconciliations.length > 0 && (
            <div className="mx-4 my-3 p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
              <div className="flex items-start space-x-3">
                <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0 mt-0.5">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-emerald-950">
                    Знайдено підтвердження оплати для {pendingReconciliations.length}{' '}
                    {pendingReconciliations.length === 1 ? 'рахунку' : pendingReconciliations.length < 5 ? 'рахунків' : 'рахунків'} у вкладці «Платіжки»!
                  </h4>
                  <p className="text-[11px] text-emerald-800 mt-0.5">
                    {pendingReconciliations
                      .slice(0, 3)
                      .map((p) => `Рядок ${p.invoiceRowIndex}: ${p.supplier} (${new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2 }).format(p.invoiceAmount)} ₴) → платіжка в рядку ${p.matchedPaymentRowIndex}`)
                      .join('; ')}
                    {pendingReconciliations.length > 3 && ` та ще ${pendingReconciliations.length - 3}...`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleBatchReconcileAllPending}
                disabled={isBatchReconciling}
                className="px-3.5 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-bold transition-colors flex items-center space-x-1.5 shrink-0 self-start sm:self-center shadow-xs cursor-pointer"
              >
                {isBatchReconciling ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Оновлення...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Оновити статуси в таблиці ({pendingReconciliations.length})</span>
                  </>
                )}
              </button>
            </div>
          )}

          {filteredInvoices.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs flex-1 flex items-center justify-center">
              {existingInvoices.length === 0
                ? 'У вкладці "Рахунки" поки немає записів. Додайте перший рахунок вище.'
                : 'Не знайдено записів за поточним фільтром.'}
            </div>
          ) : (
            <div className="flex-1 min-h-[500px] lg:min-h-[560px] overflow-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-slate-500 font-bold text-[11px] z-10">
                  <tr>
                    <th className="p-2.5 w-14 text-slate-400 font-mono">№</th>
                    <th className="p-2.5 bg-amber-50/80 text-amber-950 border-x border-amber-200">A: Номер замовлення</th>
                    <th className="p-2.5">B: Постачальник</th>
                    <th className="p-2.5">C: Платник</th>
                    <th className="p-2.5">D: Номер рахунку</th>
                    <th className="p-2.5">E: Дата рахунку</th>
                    <th className="p-2.5 text-right bg-slate-100/60 text-slate-900">F: Сума рахунку</th>
                    <th className="p-2.5 text-center">G: Валюта</th>
                    <th className="p-2.5 text-center">H: Статус</th>
                    <th className="p-2.5 text-slate-500">I: Час завантаження</th>
                    <th className="p-2.5 text-right bg-emerald-50 text-emerald-950 font-bold border-l border-emerald-200">
                      J: Сума оплати
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-sans">
                  {filteredInvoices.map((inv) => {
                    const invoiceAmount = inv.amount || 0;
                    const recMatch = reconciledMap.get(inv.rowIndex);
                    const dupInvoice = duplicateInvoicesMap.get(inv.rowIndex);
                    const paidAmount = inv.paidAmount !== undefined 
                      ? inv.paidAmount 
                      : (inv.paymentStatus === 'Оплачено' ? invoiceAmount : (recMatch ? recMatch.paidAmount : 0));
                    const remainingAmount = Math.max(0, invoiceAmount - paidAmount);

                    return (
                      <tr 
                        key={inv.rowIndex} 
                        className={`transition-colors ${
                          dupInvoice 
                            ? 'bg-amber-50/70 hover:bg-amber-100/70 border-l-4 border-l-amber-500' 
                            : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="p-2.5 text-slate-400 font-mono">
                          <div className="flex items-center space-x-1">
                            <span>{inv.rowIndex}</span>
                            {dupInvoice && (
                              <button
                                type="button"
                                onClick={() => handleDeleteSingleDuplicate(dupInvoice)}
                                disabled={isDeletingDuplicates}
                                title={`Дублікат рядка ${dupInvoice.originalRowIndex}. Натисніть, щоб видалити цей рядок з таблиці.`}
                                className="p-1 text-rose-600 hover:text-rose-800 hover:bg-rose-100 rounded cursor-pointer transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="p-2.5 bg-amber-50/40 border-x border-amber-100/80 font-mono font-bold text-amber-950">
                          {inv.orderNumber ? (
                            <button
                              type="button"
                              onClick={() => setFilterText(inv.orderNumber || '')}
                              title="Натисніть для фільтрації за цим замовленням"
                              className="px-2 py-0.5 rounded bg-amber-100 text-amber-950 border border-amber-300 hover:bg-amber-200 hover:border-amber-400 transition-colors text-left font-mono font-bold cursor-pointer inline-flex items-center space-x-1"
                            >
                              <span>{inv.orderNumber}</span>
                            </button>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                        <td className="p-2.5 font-semibold text-slate-900">{inv.supplier || '—'}</td>
                        <td className="p-2.5 text-slate-700">{inv.buyer || '—'}</td>
                        <td className="p-2.5 font-mono font-medium text-slate-900">{inv.invoiceNumber || '—'}</td>
                        <td className="p-2.5 text-slate-600 font-mono">{inv.invoiceDate || '—'}</td>
                        <td className="p-2.5 text-right font-mono font-bold text-slate-900 bg-slate-50/50">
                          {invoiceAmount
                            ? new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(invoiceAmount)
                            : '0,00'}
                        </td>
                        <td className="p-2.5 text-center font-mono font-semibold text-slate-600">
                          {inv.currency || 'UAH'}
                        </td>
                        <td className="p-2.5 text-center">
                          {onUpdateInvoiceStatus ? (
                            <select
                              value={inv.paymentStatus || 'Не оплачено'}
                              disabled={updatingRowIndex === inv.rowIndex}
                              onChange={(e) => handleStatusChange(inv.rowIndex, e.target.value as InvoicePaymentStatus)}
                              className={`text-[11px] font-bold px-2 py-1 rounded-full border cursor-pointer focus:outline-none transition-colors ${
                                inv.paymentStatus === 'Оплачено'
                                  ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                  : inv.paymentStatus === 'Оплачено частково'
                                  ? 'bg-amber-100 text-amber-900 border-amber-300'
                                  : 'bg-rose-100 text-rose-800 border-rose-300'
                              }`}
                            >
                              <option value="Не оплачено">Не оплачено</option>
                              <option value="Оплачено">Оплачено</option>
                              <option value="Оплачено частково">Оплачено частково</option>
                            </select>
                          ) : (
                            <span
                              className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                                inv.paymentStatus === 'Оплачено'
                                  ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                  : inv.paymentStatus === 'Оплачено частково'
                                  ? 'bg-amber-100 text-amber-900 border-amber-300'
                                  : 'bg-rose-100 text-rose-800 border-rose-300'
                              }`}
                            >
                              {inv.paymentStatus || 'Не оплачено'}
                            </span>
                          )}

                          {dupInvoice && (
                            <div className="mt-1 flex items-center justify-center">
                              <span 
                                title={dupInvoice.reason}
                                className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-bold"
                              >
                                <AlertTriangle className="w-3 h-3 text-amber-700" />
                                <span>Дубль р.{dupInvoice.originalRowIndex}</span>
                              </span>
                            </div>
                          )}

                          {recMatch && inv.paymentStatus !== 'Оплачено' && (
                            <div className="mt-1.5 flex flex-col items-center">
                              <span
                                title={recMatch.matchReason}
                                className="text-[10px] text-emerald-800 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded font-medium text-center"
                              >
                                💡 Платіжка в рядку {recMatch.matchedPaymentRowIndex}
                              </span>
                              {onUpdateInvoiceStatus && (
                                <button
                                  type="button"
                                  disabled={updatingRowIndex === inv.rowIndex}
                                  onClick={() => handleStatusChange(inv.rowIndex, recMatch.computedStatus, recMatch.paidAmount)}
                                  className="mt-0.5 text-[10px] text-emerald-700 underline font-bold hover:text-emerald-950 cursor-pointer"
                                  title={`Застосувати статус "${recMatch.computedStatus}" та оновити в таблиці`}
                                >
                                  {updatingRowIndex === inv.rowIndex ? 'Оновлення...' : 'Застосувати «Оплачено»'}
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="p-2.5 text-slate-500 font-mono text-[11px] whitespace-nowrap">
                          {inv.uploadedAt || '—'}
                        </td>
                        <td className="p-2.5 text-right font-mono font-bold bg-emerald-50/50 border-l border-emerald-100">
                          {paidAmount > 0 ? (
                            <div>
                              <span className={inv.paymentStatus === 'Оплачено' ? 'text-emerald-950' : 'text-emerald-700'}>
                                {new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(paidAmount)}
                              </span>
                              {inv.paymentStatus === 'Оплачено частково' && remainingAmount > 0 && (
                                <p className="text-[10px] text-amber-700 font-normal">
                                  залишок: {new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(remainingAmount)}
                                </p>
                              )}
                              {recMatch && inv.paymentStatus !== 'Оплачено' && (
                                <p className="text-[9px] text-emerald-600 font-medium">
                                  знайдено в платіжках
                                </p>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-400 font-normal">0,00</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="sticky bottom-0 bg-slate-100 border-t-2 border-slate-300 font-bold text-slate-900 text-xs shadow-xs z-10">
                  <tr>
                    <td colSpan={6} className="p-2.5 text-right font-semibold text-slate-700">
                      {trimmedFilter ? (
                        <span>Разом за показаними рядками ({filteredInvoices.length}):</span>
                      ) : (
                        <span>Разом за всіма рахунками ({existingInvoices.length}):</span>
                      )}
                    </td>
                    <td className="p-2.5 text-right font-mono font-bold text-slate-950 bg-slate-200/80">
                      {new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
                        displayedInvoicesAmount
                      )}
                    </td>
                    <td colSpan={3}></td>
                    <td className="p-2.5 text-right font-mono font-bold text-emerald-950 bg-emerald-100/80 border-l border-emerald-200">
                      {new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
                        displayedInvoicesPaid
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab: Payments (Платіжки) */}
      {activeTab === 'payments' && (
        <div className="p-4 space-y-3 flex-1 flex flex-col min-h-0">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5 text-xs bg-slate-50 p-2.5 rounded-lg border border-slate-200 shrink-0">
            <div className="relative w-full sm:w-72">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder="Пошук за номером, платником, призначенням..."
                className="w-full text-xs pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs">
              {sheetConfig?.availableSheets && sheetConfig.availableSheets.length > 0 && (
                <div className="flex items-center space-x-1.5">
                  <span className="text-slate-500 text-[11px] font-medium">Вкладка в таблиці:</span>
                  <select
                    value={sheetConfig.paymentsSheetName || 'Платіжки'}
                    onChange={(e) => onChangePaymentsTab?.(e.target.value)}
                    className="text-xs bg-white border border-slate-300 rounded px-2 py-1 font-semibold text-blue-900 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer shadow-2xs"
                  >
                    {sheetConfig.availableSheets.map((sh) => (
                      <option key={sh} value={sh}>
                        {sh}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <p className="text-xs text-slate-600">
                Записів: <span className="font-bold text-slate-900">{existingPayments.length}</span>
              </p>
            </div>
          </div>

          {/* Duplicate Warning Banner: Payments */}
          {duplicatePayments.length > 0 && (
            <div className="p-3.5 bg-amber-50/90 border border-amber-300 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
              <div className="flex items-start space-x-3">
                <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center shrink-0 mt-0.5 border border-amber-300">
                  <AlertTriangle className="w-4 h-4 text-amber-700" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-amber-950">
                    У вкладці «{sheetConfig?.paymentsSheetName || 'Платіжки'}» виявлено {duplicatePayments.length} {duplicatePayments.length === 1 ? 'дублікат рядка' : duplicatePayments.length < 5 ? 'дублікати рядків' : 'дублікатів рядків'}!
                  </h4>
                  <p className="text-[11px] text-amber-900 mt-0.5">
                    {duplicatePayments
                      .slice(0, 3)
                      .map((d) => `Рядок ${d.rowIndex} (дублює р. ${d.originalRowIndex}: ${d.identifier})`)
                      .join('; ')}
                    {duplicatePayments.length > 3 && ` та ще ${duplicatePayments.length - 3}...`}
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-2 shrink-0 self-start sm:self-center">
                <button
                  type="button"
                  onClick={() => setShowDuplicatesModal(true)}
                  className="px-3 py-1.5 bg-white border border-amber-300 hover:bg-amber-100/70 text-amber-950 rounded-lg text-xs font-semibold transition-colors cursor-pointer shadow-2xs"
                >
                  Деталі дублів
                </button>
                {onDeleteDuplicates && (
                  <button
                    type="button"
                    onClick={() => onDeleteDuplicates(duplicatePayments)}
                    disabled={isDeletingDuplicates}
                    className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition-colors flex items-center space-x-1.5 shadow-xs cursor-pointer disabled:opacity-50"
                  >
                    {isDeletingDuplicates ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5" />
                    )}
                    <span>Видалити {duplicatePayments.length} дублів</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {filteredPayments.length === 0 ? (
            <div className="p-8 text-center bg-slate-50/50 rounded-xl border border-slate-200 space-y-3">
              {existingPayments.length === 0 ? (
                <div className="max-w-md mx-auto space-y-2">
                  <p className="text-xs font-semibold text-slate-700">
                    У вкладці «<span className="text-blue-700">{sheetConfig?.paymentsSheetName || 'Платіжки'}</span>» знайдено 0 записів.
                  </p>
                  {sheetConfig?.availableSheets && sheetConfig.availableSheets.length > 1 && (
                    <div className="pt-2 text-xs text-slate-500 space-y-1.5">
                      <p className="text-[11px]">
                        Якщо ваші платіжки знаходяться в іншій вкладці Google Таблиці, оберіть її:
                      </p>
                      <div className="flex flex-wrap justify-center gap-1.5 pt-1">
                        {sheetConfig.availableSheets
                          .filter((s) => s !== sheetConfig.paymentsSheetName)
                          .map((sheetName) => (
                            <button
                              key={sheetName}
                              type="button"
                              onClick={() => onChangePaymentsTab?.(sheetName)}
                              className="px-2.5 py-1 text-xs bg-white hover:bg-blue-50 text-blue-800 border border-blue-200 hover:border-blue-400 rounded-md font-medium transition-colors shadow-2xs"
                            >
                              {sheetName}
                            </button>
                          ))}
                      </div>
                    </div>
                  )}
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={onRefresh}
                      disabled={isLoading}
                      className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg text-xs font-medium text-slate-700 shadow-2xs disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                      <span>Оновити дані з таблиці</span>
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-500">Не знайдено платіжок за поточним пошуком.</p>
              )}
            </div>
          ) : (
            <div className="flex-1 min-h-[500px] lg:min-h-[560px] overflow-auto border border-slate-200 rounded-lg shadow-2xs">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-slate-500 font-bold text-[11px]">
                  <tr>
                    <th className="p-2.5 w-12 text-slate-400 font-mono">№</th>
                    <th className="p-2.5">Номер платіжки</th>
                    <th className="p-2.5">Дата</th>
                    <th className="p-2.5">Платник (Наша компанія)</th>
                    <th className="p-2.5">Одержувач (Постачальник)</th>
                    <th className="p-2.5 text-right bg-blue-50 text-blue-950 font-bold">Сума оплати</th>
                    <th className="p-2.5">Призначення платежу</th>
                    <th className="p-2.5 bg-amber-50 text-amber-950 font-bold">Рахунок з призначення</th>
                    <th className="p-2.5">Замовлення</th>
                    <th className="p-2.5 text-slate-500">Дата внесення</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-sans">
                  {filteredPayments.map((pay, idx) => {
                    const rowNum = pay.rowIndex || idx + 1;
                    const dupPayment = pay.rowIndex ? duplicatePaymentsMap.get(pay.rowIndex) : undefined;

                    return (
                      <tr 
                        key={idx} 
                        className={`transition-colors ${
                          dupPayment 
                            ? 'bg-amber-50/70 hover:bg-amber-100/70 border-l-4 border-l-amber-500' 
                            : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="p-2.5 text-slate-400 font-mono">
                          <div className="flex items-center space-x-1">
                            <span>{rowNum}</span>
                            {dupPayment && (
                              <button
                                type="button"
                                onClick={() => handleDeleteSingleDuplicate(dupPayment)}
                                disabled={isDeletingDuplicates}
                                title={`Дублікат рядка ${dupPayment.originalRowIndex}. Натисніть, щоб видалити цей рядок з таблиці.`}
                                className="p-1 text-rose-600 hover:text-rose-800 hover:bg-rose-100 rounded cursor-pointer transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="p-2.5 font-mono font-bold text-slate-900">
                          <div>{pay.paymentNumber || '—'}</div>
                          {dupPayment && (
                            <div className="mt-0.5">
                              <span 
                                title={dupPayment.reason}
                                className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-bold"
                              >
                                <AlertTriangle className="w-3 h-3 text-amber-700" />
                                <span>Дубль р.{dupPayment.originalRowIndex}</span>
                              </span>
                            </div>
                          )}
                        </td>
                        <td className="p-2.5 text-slate-600 font-mono">{pay.paymentDate || '—'}</td>
                        <td className="p-2.5 font-semibold text-slate-900">{pay.payer || '—'}</td>
                        <td className="p-2.5 font-semibold text-slate-900">{pay.payee || '—'}</td>
                        <td className="p-2.5 text-right font-mono font-bold text-blue-950 bg-blue-50/50">
                          {pay.amountPaid
                            ? new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(pay.amountPaid)
                            : '0,00'} {pay.currency || 'UAH'}
                        </td>
                        <td className="p-2.5 text-slate-700 max-w-xs truncate" title={pay.paymentPurpose}>
                          {pay.paymentPurpose || '—'}
                        </td>
                        <td className="p-2.5 bg-amber-50/40 font-mono font-bold text-amber-950">
                          {pay.referencedInvoiceNumber ? (
                            <span className="px-2 py-0.5 rounded bg-amber-100 border border-amber-300">
                              {pay.referencedInvoiceNumber}
                            </span>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                        <td className="p-2.5 font-mono">{pay.orderNumber || '—'}</td>
                        <td className="p-2.5 text-slate-500 font-mono text-[11px] whitespace-nowrap">
                          {pay.uploadedAt || '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab: Our Companies */}
      {activeTab === 'ourCompanies' && (
        <div className="p-6 flex-1 overflow-auto">
          <div className="max-w-2xl">
            <h4 className="text-sm font-bold text-slate-800 mb-1 flex items-center space-x-2">
              <Building2 className="w-4 h-4 text-indigo-600" />
              <span>Список "Наші компанії" (з вкладки Google Таблиці)</span>
            </h4>
            <p className="text-xs text-slate-500 mb-4">
              Всі назви компаній стандартизовано у форматі <span className="font-semibold text-slate-800">ТОВ НАЗВА КОМПАНІЇ</span> (всі великі літери, без лапок).
            </p>

            {uniqueOur.length === 0 ? (
              <div className="p-6 bg-slate-50 rounded-xl text-center text-xs text-slate-400 border border-slate-200">
                Вкладка "Наші компанії" порожня або ще не створена.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {uniqueOur.map((comp, idx) => (
                  <div
                    key={idx}
                    className="p-3 bg-indigo-50/60 border border-indigo-200 rounded-lg text-xs font-semibold text-indigo-950 flex items-center justify-between"
                  >
                    <span className="truncate">{comp}</span>
                    <span className="text-[10px] text-indigo-400 font-mono">#{idx + 1}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab: Suppliers */}
      {activeTab === 'suppliers' && (
        <div className="p-6 flex-1 overflow-auto">
          <div className="max-w-3xl">
            <h4 className="text-sm font-bold text-slate-800 mb-1 flex items-center space-x-2">
              <Users className="w-4 h-4 text-indigo-600" />
              <span>Список "Постачальники" (з вкладки Google Таблиці)</span>
            </h4>
            <p className="text-xs text-slate-500 mb-4">
              Всі назви контрагентів стандартизовано у форматі <span className="font-semibold text-slate-800">ТОВ НАЗВА КОМПАНІЇ</span> (всі великі літери, без лапок).
            </p>

            {uniqueSuppliers.length === 0 ? (
              <div className="p-6 bg-slate-50 rounded-xl text-center text-xs text-slate-400 border border-slate-200">
                Вкладка "Постачальники" порожня або ще не створена.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                {uniqueSuppliers.map((sup, idx) => (
                  <div
                    key={idx}
                    className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 flex items-center justify-between"
                  >
                    <span className="truncate">{sup}</span>
                    <span className="text-[10px] text-slate-400 font-mono">#{idx + 1}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Duplicates Modal */}
      {showDuplicatesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[85vh] flex flex-col overflow-hidden border border-slate-200">
            {/* Header */}
            <div className="p-4 sm:p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center space-x-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                  allDuplicates.length > 0 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
                }`}>
                  {allDuplicates.length > 0 ? (
                    <AlertTriangle className="w-5 h-5 text-amber-700" />
                  ) : (
                    <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  )}
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-slate-900">
                    Перевірка дублікатів у Google Таблиці
                  </h3>
                  <p className="text-xs text-slate-500">
                    Автоматичне виявлення та безпечне видалення повторних рядків з таблиці
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowDuplicatesModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-4">
              {/* Summary Stats */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <div className="text-[11px] text-slate-500 font-medium">Всього дублікатів</div>
                  <div className={`text-xl font-extrabold mt-0.5 ${
                    allDuplicates.length > 0 ? 'text-amber-600' : 'text-emerald-600'
                  }`}>
                    {allDuplicates.length}
                  </div>
                </div>
                <div className="p-3 bg-amber-50/50 border border-amber-200 rounded-xl">
                  <div className="text-[11px] text-amber-900 font-medium">Дублів у «Рахунки»</div>
                  <div className="text-xl font-extrabold text-amber-800 mt-0.5">
                    {duplicateInvoices.length}
                  </div>
                </div>
                <div className="p-3 bg-blue-50/50 border border-blue-200 rounded-xl">
                  <div className="text-[11px] text-blue-900 font-medium">Дублів у «Платіжки»</div>
                  <div className="text-xl font-extrabold text-blue-800 mt-0.5">
                    {duplicatePayments.length}
                  </div>
                </div>
              </div>

              {allDuplicates.length === 0 ? (
                <div className="p-8 text-center bg-emerald-50/60 border border-emerald-200 rounded-xl space-y-2">
                  <div className="w-12 h-12 mx-auto rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <h4 className="text-sm font-bold text-emerald-950">Дублікатів не виявлено!</h4>
                  <p className="text-xs text-emerald-800 max-w-md mx-auto">
                    Всі записи у вкладках «Рахунки» ({existingInvoices.length}) та «Платіжки» ({existingPayments.length}) є унікальними. Захист від повторного внесення активний.
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  <div className="text-xs font-semibold text-slate-700 flex items-center justify-between">
                    <span>Знайдені повторні рядки (видаляється лише дубль, оригінал зберігається):</span>
                    <span className="text-[11px] text-slate-400">Сортування за номером рядка</span>
                  </div>

                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden bg-white shadow-2xs">
                    {allDuplicates.map((item, idx) => (
                      <div
                        key={`${item.tabName}-${item.rowIndex}-${idx}`}
                        className="p-3 sm:p-3.5 hover:bg-slate-50 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                                item.type === 'invoice'
                                  ? 'bg-amber-100 text-amber-900 border border-amber-300'
                                  : 'bg-blue-100 text-blue-900 border border-blue-300'
                              }`}
                            >
                              {item.tabName}
                            </span>
                            <span className="text-xs font-bold text-rose-700 font-mono">
                              Рядок {item.rowIndex}
                            </span>
                            <span className="text-xs text-slate-400">→</span>
                            <span className="text-xs text-slate-600 font-mono">
                              повторює оригінал (рядок {item.originalRowIndex})
                            </span>
                          </div>

                          <p className="text-xs font-bold text-slate-900 truncate">
                            {item.identifier}
                          </p>

                          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                            <span>Причина: <span className="text-slate-700 font-medium">{item.reason}</span></span>
                            {item.amount !== undefined && (
                              <span>• Сума: <strong className="text-slate-800">{new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2 }).format(item.amount)} грн</strong></span>
                            )}
                            {item.date && <span>• Дата: {item.date}</span>}
                          </div>
                        </div>

                        <div className="shrink-0 self-end sm:self-center">
                          <button
                            type="button"
                            onClick={() => handleDeleteSingleDuplicate(item)}
                            disabled={isDeletingDuplicates}
                            className="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer disabled:opacity-50"
                            title={`Видалити рядок ${item.rowIndex} з вкладки "${item.tabName}"`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Видалити дубль</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setShowDuplicatesModal(false)}
                className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
              >
                Закрити
              </button>

              {allDuplicates.length > 0 && onDeleteDuplicates && (
                <button
                  type="button"
                  onClick={handleDeleteAllDuplicates}
                  disabled={isDeletingDuplicates}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition-colors flex items-center space-x-2 shadow-xs cursor-pointer disabled:opacity-50"
                >
                  {isDeletingDuplicates ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                  <span>Видалити всі {allDuplicates.length} дублікатів з Google Таблиці</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

