import React, { useState, useMemo } from 'react';
import { 
  Factory, 
  Calendar, 
  Building2, 
  DollarSign, 
  Search, 
  Plus, 
  RefreshCw, 
  ExternalLink, 
  FileSpreadsheet, 
  CheckCircle2, 
  X, 
  Layers, 
  ArrowUpDown, 
  Trash2, 
  Clock, 
  CreditCard,
  AlertCircle,
  Eye
} from 'lucide-react';
import { OverheadExpenseRow, SheetConfig, SheetCompanyLists, InvoicePaymentStatus, ProcessedDocument } from '../types';
import { GoogleSheetsService } from '../services/googleSheets';
import { OCRService } from '../services/ocrService';
import { DEFAULT_OUR_COMPANIES } from '../data/sampleDocuments';
import { formatMonthYearUk, UKRAINIAN_MONTH_NAMES } from '../utils/dateUtils';

interface Props {
  overheadExpenses: OverheadExpenseRow[];
  sheetConfig: SheetConfig | null;
  accessToken?: string;
  companyLists?: SheetCompanyLists;
  onRefresh: () => Promise<void>;
  onNotify?: (msg: string, type: 'info' | 'success' | 'error') => void;
  canWriteToSheets?: boolean;
  documents?: ProcessedDocument[];
}

export const OverheadTab: React.FC<Props> = ({
  overheadExpenses,
  sheetConfig,
  accessToken,
  companyLists,
  onRefresh,
  onNotify,
  canWriteToSheets = true,
  documents = [],
}) => {
  const getOverheadDriveLink = (exp: OverheadExpenseRow): string | undefined => {
    if (exp.driveLink) return exp.driveLink;
    if (!documents || documents.length === 0) return undefined;
    const match = documents.find((d) => {
      const link = d.driveLink || d.driveWebViewLink || (d.driveFileId ? `https://drive.google.com/file/d/${d.driveFileId}/view` : '');
      if (!link) return false;
      if (exp.fileName && d.fileName && exp.fileName.toLowerCase() === d.fileName.toLowerCase()) return true;
      const cleanInv = OCRService.sanitizeInvoiceNumber(exp.invoiceNumber || '');
      if (cleanInv && cleanInv.length >= 2) {
        const dInv = OCRService.sanitizeInvoiceNumber(d.ocrResult?.invoiceNumber || d.editedData?.invoiceNumber || '');
        if (dInv === cleanInv) {
          const expSup = OCRService.normalizeCompanyName(exp.supplier || '');
          const dSup = OCRService.normalizeCompanyName(d.ocrResult?.supplierName || d.editedData?.supplierName || '');
          if (!expSup || !dSup || expSup === dSup || expSup.includes(dSup) || dSup.includes(expSup)) {
            return true;
          }
        }
      }
      return false;
    });
    return match?.driveLink || match?.driveWebViewLink || (match?.driveFileId ? `https://drive.google.com/file/d/${match.driveFileId}/view` : undefined);
  };
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMonth, setSelectedMonth] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | InvoicePaymentStatus>('all');
  const [viewMode, setViewMode] = useState<'flat' | 'grouped'>('flat');
  const [sortField, setSortField] = useState<'date' | 'amount' | 'supplier' | 'invoiceNumber'>('date');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [updatingRowIndex, setUpdatingRowIndex] = useState<number | null>(null);

  // Quick manual expense modal state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newExpenseDate, setNewExpenseDate] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );
  const [newSupplier, setNewSupplier] = useState('');
  const [newBuyer, setNewBuyer] = useState(
    companyLists?.ourCompanies?.[0] || 'ТОВ ЕТС ПРОДЖЕКТС'
  );
  const [newInvoiceNumber, setNewInvoiceNumber] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newCurrency, setNewCurrency] = useState('UAH');
  const [newStatus, setNewStatus] = useState<InvoicePaymentStatus>('Не оплачено');
  const [newPaidAmount, setNewPaidAmount] = useState('');

  // Extract all distinct months available in expenses
  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    overheadExpenses.forEach((exp) => {
      if (exp.month && exp.month.trim()) {
        set.add(exp.month.trim());
      } else if (exp.date) {
        set.add(formatMonthYearUk(exp.date));
      }
    });

    const list = Array.from(set);
    return list.sort((a, b) => {
      const yearA = parseInt((a.match(/\b(20\d{2})\b/) || [])[1] || '0', 10);
      const yearB = parseInt((b.match(/\b(20\d{2})\b/) || [])[1] || '0', 10);
      if (yearA !== yearB) return yearB - yearA;

      const getMonthIndex = (str: string) => {
        const lower = str.toLowerCase();
        for (let i = 0; i < UKRAINIAN_MONTH_NAMES.length; i++) {
          if (lower.includes(UKRAINIAN_MONTH_NAMES[i].toLowerCase().slice(0, 3))) return i;
        }
        return 0;
      };
      return getMonthIndex(b) - getMonthIndex(a);
    });
  }, [overheadExpenses]);

  const activeMonth = useMemo(() => {
    if (selectedMonth === 'all') return 'all';
    if (availableMonths.includes(selectedMonth)) return selectedMonth;
    return availableMonths[0] || 'all';
  }, [selectedMonth, availableMonths]);

  // Filtered expenses
  const filteredExpenses = useMemo(() => {
    return overheadExpenses.filter((exp) => {
      const expMonth = exp.month || formatMonthYearUk(exp.date);
      if (activeMonth !== 'all' && expMonth !== activeMonth) {
        return false;
      }
      if (statusFilter !== 'all') {
        const currentStatus = exp.paymentStatus || 'Не оплачено';
        if (currentStatus !== statusFilter) return false;
      }
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchSupplier = (exp.supplier || '').toLowerCase().includes(query);
        const matchBuyer = (exp.buyer || '').toLowerCase().includes(query);
        const matchInvoiceNum = (exp.invoiceNumber || '').toLowerCase().includes(query);
        const matchDesc = (exp.description || '').toLowerCase().includes(query);
        const matchDate = (exp.date || '').toLowerCase().includes(query);
        const matchAmount = String(exp.amount || '').includes(query);
        const matchStatus = (exp.paymentStatus || '').toLowerCase().includes(query);
        if (!matchSupplier && !matchBuyer && !matchInvoiceNum && !matchDesc && !matchDate && !matchAmount && !matchStatus) {
          return false;
        }
      }
      return true;
    });
  }, [overheadExpenses, activeMonth, statusFilter, searchQuery]);

  // Sorted expenses
  const sortedExpenses = useMemo(() => {
    return [...filteredExpenses].sort((a, b) => {
      let comp = 0;
      if (sortField === 'date') {
        comp = (a.date || '').localeCompare(b.date || '');
      } else if (sortField === 'amount') {
        comp = (a.amount || 0) - (b.amount || 0);
      } else if (sortField === 'supplier') {
        comp = (a.supplier || '').localeCompare(b.supplier || '', 'uk');
      } else if (sortField === 'invoiceNumber') {
        comp = (a.invoiceNumber || '').localeCompare(b.invoiceNumber || '', undefined, { numeric: true });
      }
      return sortOrder === 'desc' ? -comp : comp;
    });
  }, [filteredExpenses, sortField, sortOrder]);

  // Grouped by month
  const groupedByMonth = useMemo(() => {
    const map = new Map<string, OverheadExpenseRow[]>();
    sortedExpenses.forEach((exp) => {
      const m = exp.month || formatMonthYearUk(exp.date);
      if (!map.has(m)) {
        map.set(m, []);
      }
      map.get(m)!.push(exp);
    });
    return map;
  }, [sortedExpenses]);

  // Statistics
  const totalForSelectedMonth = useMemo(() => {
    return filteredExpenses.reduce((sum, item) => sum + (item.amount || 0), 0);
  }, [filteredExpenses]);

  const totalPaidForSelectedMonth = useMemo(() => {
    return filteredExpenses.reduce((sum, item) => {
      if (item.paymentStatus === 'Оплачено') return sum + (item.amount || 0);
      if (item.paymentStatus === 'Оплачено частково') return sum + (item.paidAmount || 0);
      return sum;
    }, 0);
  }, [filteredExpenses]);

  const totalUnpaidForSelectedMonth = useMemo(() => {
    return Math.max(0, totalForSelectedMonth - totalPaidForSelectedMonth);
  }, [totalForSelectedMonth, totalPaidForSelectedMonth]);

  const totalAllTime = useMemo(() => {
    return overheadExpenses.reduce((sum, item) => sum + (item.amount || 0), 0);
  }, [overheadExpenses]);

  const topSupplier = useMemo(() => {
    const counts = new Map<string, number>();
    filteredExpenses.forEach((e) => {
      if (!e.supplier) return;
      counts.set(e.supplier, (counts.get(e.supplier) || 0) + (e.amount || 0));
    });
    let top = '—';
    let max = 0;
    counts.forEach((amt, supp) => {
      if (amt > max) {
        max = amt;
        top = supp;
      }
    });
    return { name: top, amount: max };
  }, [filteredExpenses]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await onRefresh();
      onNotify?.('Дані вкладки «Цех» успішно синхронізовано з Google Таблиці', 'success');
    } catch (e: any) {
      onNotify?.(`Помилка оновлення: ${e?.message || e}`, 'error');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleToggleStatus = async (exp: OverheadExpenseRow) => {
    if (!canWriteToSheets) {
      onNotify?.('У вас обліковий запис з правами тільки перегляду. Зміна статусів оплати заборонена.', 'error');
      return;
    }
    if (!sheetConfig?.spreadsheetId || !accessToken || !exp.rowIndex) return;
    const targetStatus: InvoicePaymentStatus =
      exp.paymentStatus === 'Оплачено' ? 'Не оплачено' : 'Оплачено';
    const targetPaidAmount = targetStatus === 'Оплачено' ? exp.amount : 0;
    setUpdatingRowIndex(exp.rowIndex);
    try {
      await GoogleSheetsService.updateOverheadPaymentInSheet(
        sheetConfig.spreadsheetId,
        accessToken,
        exp.rowIndex,
        targetStatus,
        targetPaidAmount,
        sheetConfig.overheadSheetName || 'Цех'
      );
      onNotify?.(`Статус рахунку №${exp.invoiceNumber || exp.rowIndex} цеху оновлено: "${targetStatus}"`, 'success');
      await onRefresh();
    } catch (e: any) {
      onNotify?.(`Помилка оновлення статусу: ${e?.message || e}`, 'error');
    } finally {
      setUpdatingRowIndex(null);
    }
  };

  const handleDeleteRow = async (exp: OverheadExpenseRow) => {
    if (!canWriteToSheets) {
      onNotify?.('У вас обліковий запис з правами тільки перегляду. Видалення записів заборонено.', 'error');
      return;
    }
    if (!sheetConfig?.spreadsheetId || !accessToken || !exp.rowIndex) return;
    const desc = exp.invoiceNumber ? `№ ${exp.invoiceNumber}` : `#${exp.rowIndex}`;
    if (!window.confirm(`Видалити рядок #${exp.rowIndex} (Рахунок ${desc}, ${exp.supplier}, ${exp.amount} грн) з вкладки «Цех»?`)) {
      return;
    }
    setUpdatingRowIndex(exp.rowIndex);
    try {
      await GoogleSheetsService.deleteRowsFromSheet(
        sheetConfig.spreadsheetId,
        accessToken,
        sheetConfig.overheadSheetName || 'Цех',
        [exp.rowIndex]
      );
      onNotify?.(`Рядок #${exp.rowIndex} успішно видалено з вкладки «Цех»`, 'success');
      await onRefresh();
    } catch (e: any) {
      onNotify?.(`Помилка видалення рядка: ${e?.message || e}`, 'error');
    } finally {
      setUpdatingRowIndex(null);
    }
  };

  const handleCreateExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWriteToSheets) {
      onNotify?.('У вас обліковий запис з правами тільки перегляду. Додавання витрат цеху заборонено.', 'error');
      return;
    }
    if (!sheetConfig?.spreadsheetId || !accessToken) {
      onNotify?.('Google Таблицю не підключено або сесія закінчилася', 'error');
      return;
    }

    const amt = parseFloat(newAmount.replace(/\s/g, '').replace(',', '.'));
    if (isNaN(amt) || amt <= 0) {
      onNotify?.('Будь ласка, вкажіть коректну суму рахунку', 'error');
      return;
    }

    if (!newSupplier.trim()) {
      onNotify?.('Будь ласка, вкажіть назву постачальника', 'error');
      return;
    }

    const paidAmt = newStatus === 'Оплачено' 
      ? amt 
      : (parseFloat(newPaidAmount.replace(/\s/g, '').replace(',', '.')) || 0);

    setIsSubmitting(true);
    try {
      const month = formatMonthYearUk(newExpenseDate);
      await GoogleSheetsService.appendOverheadExpense(
        sheetConfig.spreadsheetId,
        accessToken,
        {
          supplier: newSupplier.trim(),
          buyer: newBuyer.trim(),
          invoiceNumber: newInvoiceNumber.trim(),
          date: newExpenseDate,
          amount: amt,
          currency: newCurrency,
          status: newStatus,
          paidAmount: paidAmt,
          month,
          overheadTab: sheetConfig.overheadSheetName || 'Цех',
        }
      );

      onNotify?.(`Рахунок цеху (${newSupplier.trim()}, ${amt.toLocaleString('uk-UA')} грн) успішно додано у вкладку «Цех»!`, 'success');
      setIsAddModalOpen(false);
      setNewAmount('');
      setNewSupplier('');
      setNewInvoiceNumber('');
      setNewPaidAmount('');
      setNewStatus('Не оплачено');
      await onRefresh();
    } catch (err: any) {
      onNotify?.(`Помилка збереження рахунку цеху: ${err?.message || err}`, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const openSheetTabUrl = () => {
    if (!sheetConfig?.spreadsheetId) return;
    const url = `https://docs.google.com/spreadsheets/d/${sheetConfig.spreadsheetId}`;
    window.open(url, '_blank');
  };

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center space-x-3.5">
            <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-700 shrink-0">
              <Factory className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
                  Витрати Цеху
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200">
                  Вкладка «Цех»
                </span>
              </div>
              <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                Колонки: <b>А</b> — Постачальник, <b>В</b> — Платник, <b>C</b> — Номер рахунку, <b>D</b> — Дата рахунку, <b>E</b> — Сума, <b>F</b> — Валюта, <b>G</b> — Статус, <b>H</b> — Час завантаження, <b>I</b> — Сума оплати.
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center flex-wrap gap-2">
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer disabled:opacity-50"
              title="Оновити дані з вкладки Цех"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-amber-600' : ''}`} />
              <span>{isRefreshing ? 'Оновлення...' : 'Оновити'}</span>
            </button>

            {sheetConfig?.spreadsheetId && (
              <button
                onClick={openSheetTabUrl}
                className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer"
                title="Відкрити таблицю Google Таблиці"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                <span className="hidden sm:inline">Google Таблиця</span>
                <ExternalLink className="w-3 h-3 text-slate-400" />
              </button>
            )}

            {canWriteToSheets && (
              <button
                onClick={() => setIsAddModalOpen(true)}
                className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-semibold shadow-xs flex items-center space-x-1.5 transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Додати рахунок вручну</span>
              </button>
            )}
          </div>
        </div>

        {!canWriteToSheets && (
          <div className="mt-4 px-3.5 py-2 bg-amber-50 border border-amber-200 rounded-xl flex items-center space-x-2 text-xs text-amber-900">
            <Eye className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              <strong>Режим тільки перегляду:</strong> додавання рахунків цеху та зміна статусів оплати в таблиці заблоковані.
            </span>
          </div>
        )}

        {/* Highlighted Analytics Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6 pt-6 border-t border-slate-100">
          {/* Main Selected Month Summary Card */}
          <div className="bg-gradient-to-br from-amber-50 to-orange-50/70 border border-amber-200/90 rounded-xl p-4 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-amber-900 uppercase tracking-wider">
                {activeMonth === 'all' ? 'Всього за всі періоди' : `Всього за ${activeMonth}`}
              </span>
              <span className="w-7 h-7 rounded-lg bg-amber-200/60 flex items-center justify-center text-amber-800">
                <DollarSign className="w-4 h-4" />
              </span>
            </div>
            <div className="mt-2 text-2xl sm:text-3xl font-extrabold text-amber-950 font-mono tracking-tight">
              {totalForSelectedMonth.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-base sm:text-lg font-bold text-amber-800">грн</span>
            </div>
            <div className="mt-1 text-xs text-amber-800/90 font-medium">
              Рахунків у вибірці: <b>{filteredExpenses.length}</b> (всього в Цеху: {overheadExpenses.length})
            </div>
          </div>

          {/* Paid Total Card */}
          <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-4 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-emerald-800 uppercase tracking-wider">
                Оплачено
              </span>
              <span className="w-7 h-7 rounded-lg bg-emerald-200/70 flex items-center justify-center text-emerald-700">
                <CheckCircle2 className="w-4 h-4" />
              </span>
            </div>
            <div className="mt-2 text-xl font-bold text-emerald-950 font-mono">
              {totalPaidForSelectedMonth.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-sm text-emerald-700 font-normal">грн</span>
            </div>
            <div className="mt-1 text-xs text-emerald-700">
              {totalForSelectedMonth > 0 ? `${Math.round((totalPaidForSelectedMonth / totalForSelectedMonth) * 100)}% від суми` : '0%'}
            </div>
          </div>

          {/* Unpaid Total Card */}
          <div className="bg-rose-50/70 border border-rose-200 rounded-xl p-4 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-rose-800 uppercase tracking-wider">
                До сплати (Не оплачено)
              </span>
              <span className="w-7 h-7 rounded-lg bg-rose-200/70 flex items-center justify-center text-rose-700">
                <AlertCircle className="w-4 h-4" />
              </span>
            </div>
            <div className="mt-2 text-xl font-bold text-rose-950 font-mono">
              {totalUnpaidForSelectedMonth.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-sm text-rose-700 font-normal">грн</span>
            </div>
            <div className="mt-1 text-xs text-rose-700">
              {filteredExpenses.filter(e => e.paymentStatus !== 'Оплачено').length} неоплачених рахунків
            </div>
          </div>

          {/* Top Supplier */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                Топ постачальник цеху
              </span>
              <span className="w-7 h-7 rounded-lg bg-slate-200/70 flex items-center justify-center text-slate-700">
                <Building2 className="w-4 h-4" />
              </span>
            </div>
            <div className="mt-2 text-sm font-bold text-slate-900 truncate" title={topSupplier.name}>
              {topSupplier.name}
            </div>
            <div className="mt-1 text-xs text-slate-600 font-mono font-bold">
              {topSupplier.amount > 0 ? `${topSupplier.amount.toLocaleString('uk-UA')} грн` : '—'}
            </div>
          </div>
        </div>
      </div>

      {/* Filter and Control Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        {/* Month Selector Pills & View Toggle */}
        <div className="flex items-center flex-wrap gap-1.5">
          <div className="flex items-center space-x-1 mr-2 text-xs font-semibold text-slate-500">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <span>Період:</span>
          </div>

          <button
            onClick={() => setSelectedMonth('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              activeMonth === 'all'
                ? 'bg-amber-600 text-white shadow-xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Всі місяці ({overheadExpenses.length})
          </button>

          {availableMonths.map((m) => {
            const countInMonth = overheadExpenses.filter((e) => (e.month || formatMonthYearUk(e.date)) === m).length;
            return (
              <button
                key={m}
                onClick={() => setSelectedMonth(m)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  activeMonth === m
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {m} ({countInMonth})
              </button>
            );
          })}
        </div>

        {/* View mode switcher */}
        <div className="flex items-center space-x-2 self-end md:self-auto">
          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="text-xs font-semibold bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-slate-700 cursor-pointer focus:outline-none"
          >
            <option value="all">Всі статуси</option>
            <option value="Не оплачено">Не оплачено</option>
            <option value="Оплачено">Оплачено</option>
            <option value="Оплачено частково">Оплачено частково</option>
          </select>

          <div className="flex items-center bg-slate-100 p-0.5 rounded-xl border border-slate-200">
            <button
              onClick={() => setViewMode('flat')}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                viewMode === 'flat'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              Таблиця
            </button>
            <button
              onClick={() => setViewMode('grouped')}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                viewMode === 'grouped'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              По місяцях
            </button>
          </div>
        </div>
      </div>

      {/* Search and Sort Toolbar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Пошук постачальника, платника, № рахунку..."
              className="w-full text-xs font-medium pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-amber-500 focus:bg-white transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center space-x-2 w-full sm:w-auto justify-end">
            <span className="text-xs text-slate-500 hidden sm:inline">Сортувати:</span>
            <select
              value={sortField}
              onChange={(e) => setSortField(e.target.value as any)}
              className="text-xs font-semibold bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 cursor-pointer focus:outline-none"
            >
              <option value="date">За датою рахунку</option>
              <option value="amount">За сумою</option>
              <option value="supplier">За постачальником</option>
              <option value="invoiceNumber">За номером рахунку</option>
            </select>
            <button
              onClick={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')}
              className="p-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-700 transition-colors cursor-pointer"
              title={sortOrder === 'desc' ? 'За спаданням' : 'За зростанням'}
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      {viewMode === 'flat' ? (
        /* Flat Table View */
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <h2 className="text-sm font-bold text-slate-900">
                Рахунки цеху ({sortedExpenses.length})
              </h2>
              {activeMonth !== 'all' && (
                <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-100 text-amber-800">
                  {activeMonth}
                </span>
              )}
            </div>
            <span className="text-xs font-mono font-bold text-slate-900">
              Підсумок: {totalForSelectedMonth.toLocaleString('uk-UA', { minimumFractionDigits: 2 })} грн
            </span>
          </div>

          {sortedExpenses.length === 0 ? (
            <div className="p-12 text-center">
              <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center mx-auto mb-3">
                <Factory className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-bold text-slate-900">Не знайдено рахунків цеху</h3>
              <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                Рахунки з ручною або друкованою позначкою «ЦЕХ» автоматично зберігаються у вкладку «Цех» Google Таблиці у колонки A–I.
              </p>
              {canWriteToSheets && (
                <button
                  onClick={() => setIsAddModalOpen(true)}
                  className="mt-4 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-semibold shadow-xs inline-flex items-center space-x-1.5 transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Додати перший рахунок цеху</span>
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50/80 text-slate-600 font-semibold border-b border-slate-200 uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="py-3 px-3">A - Постачальник</th>
                    <th className="py-3 px-3">B - Платник</th>
                    <th className="py-3 px-3">C - № Рахунку</th>
                    <th className="py-3 px-3">D - Дата</th>
                    <th className="py-3 px-3 text-right">E - Сума</th>
                    <th className="py-3 px-2 text-center">F - Валюта</th>
                    <th className="py-3 px-3 text-center">G - Статус</th>
                    <th className="py-3 px-3 text-right">I - Сума оплати</th>
                    <th className="py-3 px-3">H - Час завантаження</th>
                    <th className="py-3 px-2 text-center">Дії</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedExpenses.map((exp, idx) => (
                    <tr key={exp.id || idx} className="hover:bg-amber-50/40 transition-colors">
                      {/* A: Постачальник */}
                      <td className="py-3 px-3 font-bold text-slate-900">
                        <div className="flex items-center space-x-1.5">
                          <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span className="truncate max-w-[200px]" title={exp.supplier}>{exp.supplier || '—'}</span>
                        </div>
                      </td>

                      {/* B: Платник */}
                      <td className="py-3 px-3 text-slate-700 font-medium">
                        <span className="truncate max-w-[180px] block" title={exp.buyer}>
                          {exp.buyer || '—'}
                        </span>
                      </td>

                      {/* C: Номер рахунку */}
                      <td className="py-3 px-3 font-mono font-bold text-slate-900 whitespace-nowrap">
                        <div>
                          {exp.invoiceNumber ? (
                            <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-800 border border-slate-200 font-mono text-[11px]">
                              № {exp.invoiceNumber}
                            </span>
                          ) : (
                            <span className="text-slate-400">б/н</span>
                          )}
                        </div>
                        {getOverheadDriveLink(exp) && (
                          <a
                            href={getOverheadDriveLink(exp)}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-0.5 inline-flex items-center space-x-1 text-[10px] text-indigo-600 hover:text-indigo-800 font-medium hover:underline font-sans font-normal"
                            title="Відкрити файл на Google Диску"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <span>Google Диск</span>
                            <ExternalLink className="w-2.5 h-2.5 inline" />
                          </a>
                        )}
                      </td>

                      {/* D: Дата рахунку */}
                      <td className="py-3 px-3 font-mono font-medium text-slate-900 whitespace-nowrap">
                        <div className="flex items-center space-x-1.5">
                          <Calendar className="w-3.5 h-3.5 text-slate-400" />
                          <span>{exp.date || '—'}</span>
                        </div>
                      </td>

                      {/* E: Сума */}
                      <td className="py-3 px-3 text-right font-mono font-extrabold text-amber-950 text-sm whitespace-nowrap">
                        {(exp.amount || 0).toLocaleString('uk-UA', { minimumFractionDigits: 2 })}
                      </td>

                      {/* F: Валюта */}
                      <td className="py-3 px-2 text-center font-mono font-bold text-slate-600 text-[11px]">
                        {exp.currency || 'UAH'}
                      </td>

                      {/* G: Статус оплати (interactive toggle) */}
                      <td className="py-3 px-3 text-center whitespace-nowrap">
                        {canWriteToSheets ? (
                          <button
                            onClick={() => handleToggleStatus(exp)}
                            disabled={updatingRowIndex === exp.rowIndex}
                            className={`inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-bold transition-transform active:scale-95 cursor-pointer ${
                              exp.paymentStatus === 'Оплачено'
                                ? 'bg-emerald-100 text-emerald-800 border border-emerald-300 hover:bg-emerald-200'
                                : exp.paymentStatus === 'Оплачено частково'
                                ? 'bg-blue-100 text-blue-800 border border-blue-300 hover:bg-blue-200'
                                : 'bg-rose-100 text-rose-800 border border-rose-300 hover:bg-rose-200'
                            }`}
                            title="Натисніть для перемикання статусу оплати"
                          >
                            {exp.paymentStatus === 'Оплачено' ? (
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            ) : (
                              <Clock className="w-3 h-3 text-rose-500" />
                            )}
                            <span>{exp.paymentStatus || 'Не оплачено'}</span>
                          </button>
                        ) : (
                          <span
                            className={`inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-bold ${
                              exp.paymentStatus === 'Оплачено'
                                ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                : exp.paymentStatus === 'Оплачено частково'
                                ? 'bg-blue-100 text-blue-800 border border-blue-300'
                                : 'bg-rose-100 text-rose-800 border border-rose-300'
                            }`}
                          >
                            {exp.paymentStatus === 'Оплачено' ? (
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            ) : (
                              <Clock className="w-3 h-3 text-rose-500" />
                            )}
                            <span>{exp.paymentStatus || 'Не оплачено'}</span>
                          </span>
                        )}
                      </td>

                      {/* I: Сума оплати */}
                      <td className="py-3 px-3 text-right font-mono font-bold text-slate-800 whitespace-nowrap">
                        {exp.paidAmount !== undefined
                          ? exp.paidAmount.toLocaleString('uk-UA', { minimumFractionDigits: 2 })
                          : (exp.paymentStatus === 'Оплачено' ? (exp.amount || 0).toLocaleString('uk-UA', { minimumFractionDigits: 2 }) : '0.00')}
                      </td>

                      {/* H: Час завантаження */}
                      <td className="py-3 px-3 text-slate-500 font-mono text-[11px] whitespace-nowrap">
                        {exp.uploadedAt || '—'}
                      </td>

                      {/* Дії: Рядок & Видалення */}
                      <td className="py-3 px-2 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center space-x-1">
                          <span className="text-slate-400 font-mono text-[10px]" title="Номер рядка у Google Sheets">
                            {exp.rowIndex ? `#${exp.rowIndex}` : '—'}
                          </span>
                          {canWriteToSheets && exp.rowIndex && (
                            <button
                              onClick={() => handleDeleteRow(exp)}
                              disabled={updatingRowIndex === exp.rowIndex}
                              className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors cursor-pointer"
                              title="Видалити рядок з вкладки «Цех»"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        /* Grouped by Month View */
        <div className="space-y-4">
          {Array.from(groupedByMonth.entries()).map(([monthName, exps]) => {
            const monthTotal = exps.reduce((s, e) => s + (e.amount || 0), 0);
            const monthPaid = exps.reduce((s, e) => {
              if (e.paymentStatus === 'Оплачено') return s + (e.amount || 0);
              if (e.paymentStatus === 'Оплачено частково') return s + (e.paidAmount || 0);
              return s;
            }, 0);

            return (
              <div key={monthName} className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
                <div className="px-5 py-3.5 bg-gradient-to-r from-amber-50/70 via-slate-50 to-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center space-x-2">
                    <Calendar className="w-4 h-4 text-amber-700" />
                    <h3 className="text-sm font-extrabold text-slate-900 tracking-tight">
                      {monthName}
                    </h3>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-200/80 text-amber-950">
                      {exps.length} рахунків
                    </span>
                  </div>
                  <div className="flex items-center space-x-4 text-xs font-mono">
                    <div>
                      <span className="text-slate-500 mr-1.5">Разом:</span>
                      <span className="font-extrabold text-amber-950">
                        {monthTotal.toLocaleString('uk-UA', { minimumFractionDigits: 2 })} грн
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 mr-1.5">Оплачено:</span>
                      <span className="font-extrabold text-emerald-800">
                        {monthPaid.toLocaleString('uk-UA', { minimumFractionDigits: 2 })} грн
                      </span>
                    </div>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200 uppercase tracking-wider text-[10px]">
                      <tr>
                        <th className="py-2.5 px-3">A - Постачальник</th>
                        <th className="py-2.5 px-3">B - Платник</th>
                        <th className="py-2.5 px-3">C - № Рахунку</th>
                        <th className="py-2.5 px-3">D - Дата</th>
                        <th className="py-2.5 px-3 text-right">E - Сума</th>
                        <th className="py-2.5 px-2 text-center">F - Валюта</th>
                        <th className="py-2.5 px-3 text-center">G - Статус</th>
                        <th className="py-2.5 px-3 text-right">I - Сума оплати</th>
                        <th className="py-2.5 px-3">H - Час завантаження</th>
                        <th className="py-2.5 px-2 text-center">Дії</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {exps.map((exp, idx) => (
                        <tr key={exp.id || idx} className="hover:bg-amber-50/40 transition-colors">
                          <td className="py-2.5 px-3 font-bold text-slate-900 truncate max-w-[200px]">
                            {exp.supplier || '—'}
                          </td>
                          <td className="py-2.5 px-3 text-slate-700 truncate max-w-[180px]">
                            {exp.buyer || '—'}
                          </td>
                          <td className="py-2.5 px-3 font-mono font-bold text-slate-900 whitespace-nowrap">
                            <div>{exp.invoiceNumber ? `№ ${exp.invoiceNumber}` : 'б/н'}</div>
                            {getOverheadDriveLink(exp) && (
                              <a
                                href={getOverheadDriveLink(exp)}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-0.5 inline-flex items-center space-x-1 text-[10px] text-indigo-600 hover:text-indigo-800 font-medium hover:underline font-sans font-normal"
                                title="Відкрити файл на Google Диску"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <span>Google Диск</span>
                                <ExternalLink className="w-2.5 h-2.5 inline" />
                              </a>
                            )}
                          </td>
                          <td className="py-2.5 px-3 font-mono font-medium text-slate-900 whitespace-nowrap">
                            {exp.date || '—'}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-extrabold text-amber-950 text-sm whitespace-nowrap">
                            {(exp.amount || 0).toLocaleString('uk-UA', { minimumFractionDigits: 2 })}
                          </td>
                          <td className="py-2.5 px-2 text-center font-mono font-bold text-slate-600 text-[11px]">
                            {exp.currency || 'UAH'}
                          </td>
                          <td className="py-2.5 px-3 text-center whitespace-nowrap">
                            {canWriteToSheets ? (
                              <button
                                onClick={() => handleToggleStatus(exp)}
                                disabled={updatingRowIndex === exp.rowIndex}
                                className={`inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold transition-transform active:scale-95 cursor-pointer ${
                                  exp.paymentStatus === 'Оплачено'
                                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                    : exp.paymentStatus === 'Оплачено частково'
                                    ? 'bg-blue-100 text-blue-800 border border-blue-300'
                                    : 'bg-rose-100 text-rose-800 border border-rose-300'
                                }`}
                              >
                                <span>{exp.paymentStatus || 'Не оплачено'}</span>
                              </button>
                            ) : (
                              <span
                                className={`inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                                  exp.paymentStatus === 'Оплачено'
                                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                    : exp.paymentStatus === 'Оплачено частково'
                                    ? 'bg-blue-100 text-blue-800 border border-blue-300'
                                    : 'bg-rose-100 text-rose-800 border border-rose-300'
                                }`}
                              >
                                <span>{exp.paymentStatus || 'Не оплачено'}</span>
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-800 whitespace-nowrap">
                            {exp.paidAmount !== undefined
                              ? exp.paidAmount.toLocaleString('uk-UA', { minimumFractionDigits: 2 })
                              : (exp.paymentStatus === 'Оплачено' ? (exp.amount || 0).toLocaleString('uk-UA', { minimumFractionDigits: 2 }) : '0.00')}
                          </td>
                          <td className="py-2.5 px-3 text-slate-500 font-mono text-[11px] whitespace-nowrap">
                            {exp.uploadedAt || '—'}
                          </td>
                          <td className="py-2.5 px-2 text-center whitespace-nowrap">
                            <div className="flex items-center justify-center space-x-1">
                              <span className="text-slate-400 font-mono text-[10px]">
                                {exp.rowIndex ? `#${exp.rowIndex}` : '—'}
                              </span>
                              {canWriteToSheets && exp.rowIndex && (
                                <button
                                  onClick={() => handleDeleteRow(exp)}
                                  disabled={updatingRowIndex === exp.rowIndex}
                                  className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors cursor-pointer"
                                  title="Видалити"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Manual Expense Modal matching A-I structure */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center">
                  <Factory className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Додати рахунок у вкладку «Цех»</h3>
                  <p className="text-[11px] text-slate-500">Запис у відповідні колонки A–I Google Таблиці</p>
                </div>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateExpense} className="space-y-3.5">
              {/* Row 1: Supplier (Col A) */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Колонка A: Постачальник (ТОВ / ФОП) *
                </label>
                <input
                  type="text"
                  value={newSupplier}
                  onChange={(e) => setNewSupplier(e.target.value)}
                  placeholder="наприклад: ТОВ ЕПІЦЕНТР К"
                  required
                  className="w-full text-xs font-medium px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500 uppercase"
                />
              </div>

              {/* Row 2: Payer (Col B) */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Колонка B: Платник (наша компанія / наш ФОП)
                </label>
                <input
                  type="text"
                  value={newBuyer}
                  onChange={(e) => setNewBuyer(e.target.value)}
                  placeholder="наприклад: ТОВ ЕТС ПРОДЖЕКТС"
                  className="w-full text-xs font-medium px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500 uppercase"
                />
                <div className="mt-1 flex flex-wrap gap-1">
                  {GoogleSheetsService.deduplicateCompanyList([
                    ...(companyLists?.ourCompanies || []),
                    ...DEFAULT_OUR_COMPANIES,
                  ]).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNewBuyer(c)}
                      className="text-[10px] px-2 py-0.5 bg-slate-100 hover:bg-amber-100 text-slate-700 rounded cursor-pointer"
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              {/* Row 3: Invoice Number (Col C) & Date (Col D) */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Колонка C: Номер рахунку
                  </label>
                  <input
                    type="text"
                    value={newInvoiceNumber}
                    onChange={(e) => setNewInvoiceNumber(e.target.value)}
                    placeholder="наприклад: 142"
                    className="w-full text-xs font-mono font-medium px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Колонка D: Дата рахунку *
                  </label>
                  <input
                    type="date"
                    value={newExpenseDate}
                    onChange={(e) => setNewExpenseDate(e.target.value)}
                    required
                    className="w-full text-xs font-medium px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>
              </div>

              {/* Row 4: Amount (Col E) & Currency (Col F) */}
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Колонка E: Сума *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={newAmount}
                    onChange={(e) => setNewAmount(e.target.value)}
                    placeholder="наприклад: 1450.00"
                    required
                    className="w-full text-sm font-bold font-mono px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Колонка F: Валюта
                  </label>
                  <select
                    value={newCurrency}
                    onChange={(e) => setNewCurrency(e.target.value)}
                    className="w-full text-xs font-bold px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer"
                  >
                    <option value="UAH">UAH (грн)</option>
                    <option value="EUR">EUR (€)</option>
                    <option value="USD">USD ($)</option>
                  </select>
                </div>
              </div>

              {/* Row 5: Payment Status (Col G) & Paid Amount (Col I) */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Колонка G: Статус оплати
                  </label>
                  <select
                    value={newStatus}
                    onChange={(e) => {
                      const st = e.target.value as InvoicePaymentStatus;
                      setNewStatus(st);
                      if (st === 'Оплачено' && newAmount) {
                        setNewPaidAmount(newAmount);
                      } else if (st === 'Не оплачено') {
                        setNewPaidAmount('0');
                      }
                    }}
                    className="w-full text-xs font-bold px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer"
                  >
                    <option value="Не оплачено">Не оплачено</option>
                    <option value="Оплачено">Оплачено</option>
                    <option value="Оплачено частково">Оплачено частково</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Колонка I: Сума оплати
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={newStatus === 'Оплачено' ? newAmount : newPaidAmount}
                    onChange={(e) => setNewPaidAmount(e.target.value)}
                    disabled={newStatus === 'Оплачено'}
                    placeholder="0.00"
                    className="w-full text-xs font-mono font-bold px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500 disabled:opacity-60"
                  />
                </div>
              </div>

              <div className="p-2.5 bg-amber-50/70 border border-amber-200 rounded-lg text-[11px] text-amber-900">
                Колонка <b>H</b> (Час завантаження) заповнюється автоматично точним поточним штампом часу.
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                >
                  Скасувати
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold shadow-xs transition-colors flex items-center space-x-1.5 disabled:opacity-50 cursor-pointer"
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Запис у вкладку «Цех»...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Зберегти в «Цех» (A–I)</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
