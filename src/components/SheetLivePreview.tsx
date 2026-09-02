import React, { useState } from 'react';
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
  CreditCard
} from 'lucide-react';
import { SheetConfig, ExistingSheetRow, ExistingPaymentRow, SheetCompanyLists, InvoicePaymentStatus } from '../types';
import { GoogleSheetsService } from '../services/googleSheets';

interface Props {
  sheetConfig: SheetConfig | null;
  existingInvoices: ExistingSheetRow[];
  existingPayments?: ExistingPaymentRow[];
  companyLists: SheetCompanyLists;
  onRefresh: () => Promise<void>;
  isLoading: boolean;
  onUpdateInvoiceStatus?: (rowIndex: number, newStatus: InvoicePaymentStatus, paidAmount?: number) => Promise<void>;
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
  onChangePaymentsTab,
  onChangeInvoicesTab,
}) => {
  const [activeTab, setActiveTab] = useState<'invoices' | 'payments' | 'ourCompanies' | 'suppliers'>('invoices');
  const [filterText, setFilterText] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | InvoicePaymentStatus>('all');
  const [updatingRowIndex, setUpdatingRowIndex] = useState<number | null>(null);

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

  const filteredInvoices = existingInvoices.filter((inv) => {
    if (statusFilter !== 'all' && inv.paymentStatus !== statusFilter) {
      return false;
    }
    if (!filterText.trim()) return true;
    const q = filterText.toLowerCase();
    return (
      inv.orderNumber?.toLowerCase().includes(q) ||
      inv.supplier?.toLowerCase().includes(q) ||
      inv.buyer?.toLowerCase().includes(q) ||
      inv.invoiceNumber?.toLowerCase().includes(q)
    );
  });

  const filteredPayments = existingPayments.filter((pay) => {
    if (!filterText.trim()) return true;
    const q = filterText.toLowerCase();
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

  const handleStatusChange = async (rowIndex: number, newStatus: InvoicePaymentStatus) => {
    if (!onUpdateInvoiceStatus) return;
    setUpdatingRowIndex(rowIndex);
    try {
      const targetInvoice = existingInvoices.find((i) => i.rowIndex === rowIndex);
      const paidAmt = newStatus === 'Оплачено' ? (targetInvoice?.amount || 0) : (targetInvoice?.paidAmount || 0);
      await onUpdateInvoiceStatus(rowIndex, newStatus, paidAmt);
    } finally {
      setUpdatingRowIndex(null);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
      {/* Header & Tabs */}
      <div className="p-4 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3 bg-slate-50/50">
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

          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="p-2 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors shadow-xs disabled:opacity-50"
            title="Оновити дані з Google Sheets"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Tab: Invoices */}
      {activeTab === 'invoices' && (
        <div>
          {/* Sub-bar: Search & Status Filters */}
          <div className="p-3 border-b border-slate-100 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative w-full sm:w-72">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder="Фільтр за номером замовлення (ххх-хх), постачальником..."
                className="w-full text-xs pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            {/* Status counts & filter buttons */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <button
                onClick={() => setStatusFilter('all')}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                  statusFilter === 'all'
                    ? 'bg-slate-900 text-white font-bold'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Всі ({existingInvoices.length})
              </button>
              <button
                onClick={() => setStatusFilter('Не оплачено')}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors flex items-center space-x-1 ${
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
                className={`px-2.5 py-1 rounded-md font-medium transition-colors flex items-center space-x-1 ${
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
                className={`px-2.5 py-1 rounded-md font-medium transition-colors flex items-center space-x-1 ${
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

          {filteredInvoices.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs">
              {existingInvoices.length === 0
                ? 'У вкладці "Рахунки" поки немає записів. Додайте перший рахунок вище.'
                : 'Не знайдено записів за поточним фільтром.'}
            </div>
          ) : (
            <div className="overflow-x-auto max-h-96">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-slate-500 font-bold text-[11px]">
                  <tr>
                    <th className="p-2.5 w-12 text-slate-400 font-mono">№</th>
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
                    const paidAmount = inv.paidAmount !== undefined ? inv.paidAmount : (inv.paymentStatus === 'Оплачено' ? invoiceAmount : 0);
                    const remainingAmount = Math.max(0, invoiceAmount - paidAmount);

                    return (
                      <tr key={inv.rowIndex} className="hover:bg-slate-50 transition-colors">
                        <td className="p-2.5 text-slate-400 font-mono">{inv.rowIndex}</td>
                        <td className="p-2.5 bg-amber-50/40 border-x border-amber-100/80 font-mono font-bold text-amber-950">
                          {inv.orderNumber ? (
                            <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-950 border border-amber-300">
                              {inv.orderNumber}
                            </span>
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
                        </td>
                        <td className="p-2.5 text-slate-500 font-mono text-[11px] whitespace-nowrap">
                          {inv.uploadedAt || '—'}
                        </td>
                        <td className="p-2.5 text-right font-mono font-bold bg-emerald-50/50 border-l border-emerald-100">
                          {paidAmount > 0 ? (
                            <div>
                              <span className="text-emerald-950">
                                {new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(paidAmount)}
                              </span>
                              {inv.paymentStatus === 'Оплачено частково' && remainingAmount > 0 && (
                                <p className="text-[10px] text-amber-700 font-normal">
                                  залишок: {new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(remainingAmount)}
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
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab: Payments (Платіжки) */}
      {activeTab === 'payments' && (
        <div className="p-4 space-y-3">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5 text-xs bg-slate-50 p-2.5 rounded-lg border border-slate-200">
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
            <div className="overflow-x-auto max-h-96">
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
                  {filteredPayments.map((pay, idx) => (
                    <tr key={idx} className="hover:bg-slate-50 transition-colors">
                      <td className="p-2.5 text-slate-400 font-mono">{pay.rowIndex || idx + 1}</td>
                      <td className="p-2.5 font-mono font-bold text-slate-900">{pay.paymentNumber || '—'}</td>
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
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab: Our Companies */}
      {activeTab === 'ourCompanies' && (
        <div className="p-6">
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
        <div className="p-6">
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
    </div>
  );
};

