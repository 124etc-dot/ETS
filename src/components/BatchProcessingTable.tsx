import React, { useState, useEffect } from 'react';
import { 
  FileText, 
  Sparkles, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  ExternalLink, 
  Eye, 
  FileSpreadsheet, 
  Search, 
  Filter, 
  Trash2, 
  RefreshCw, 
  PenTool, 
  ArrowUpDown,
  CheckSquare,
  Square,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  X,
  RotateCcw
} from 'lucide-react';
import { ProcessedDocument } from '../types';
import { OCRService } from '../services/ocrService';

interface Props {
  documents: ProcessedDocument[];
  onOpenReview: (doc: ProcessedDocument) => void;
  onProcessDoc: (docId: string) => Promise<void>;
  onBatchProcess: (docIds: string[]) => Promise<void>;
  onSyncDoc: (docId: string) => Promise<void>;
  onBatchSync: (docIds: string[]) => Promise<void>;
  onRemoveDoc: (docId: string) => void;
  onClearAll: () => void;
  onRetryDriveUpload?: (docId: string) => void;
  isProcessingAny: boolean;
  isSyncingAny: boolean;
}

export const BatchProcessingTable: React.FC<Props> = ({
  documents,
  onOpenReview,
  onProcessDoc,
  onBatchProcess,
  onSyncDoc,
  onBatchSync,
  onRemoveDoc,
  onClearAll,
  onRetryDriveUpload,
  isProcessingAny,
  isSyncingAny,
}) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'ready_for_review' | 'synced' | 'error'>('all');
  
  // Pagination & Sorting state (50 items per page default, newest first)
  const [pageSize, setPageSize] = useState<number | 'all'>(50);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'orderNumber' | 'amountDesc' | 'amountAsc'>('newest');

  // Reset to page 1 when filtering, searching, sorting, or changing page size
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter, sortBy, pageSize]);

  // Count documents by status
  const countAll = documents.length;
  const countPending = documents.filter((d) => d.status === 'pending' || d.status === 'processing').length;
  const countReady = documents.filter((d) => d.status === 'ready_for_review').length;
  const countSynced = documents.filter((d) => d.status === 'synced').length;
  const countError = documents.filter((d) => d.status === 'error').length;

  // 1. Filter documents
  const filteredDocs = documents.filter((doc) => {
    // Status filter (всі, очікують, готові, синхронізовані)
    if (statusFilter === 'pending') {
      if (doc.status !== 'pending' && doc.status !== 'processing') return false;
    } else if (statusFilter !== 'all') {
      if (doc.status !== statusFilter) return false;
    }

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const ocr = doc.editedData || doc.ocrResult;
      const matchName = doc.fileName.toLowerCase().includes(q);
      const matchOrder = ocr?.handwrittenOrderNumber?.toLowerCase().includes(q);
      const matchSupplier = ocr?.supplierName?.toLowerCase().includes(q);
      const matchSupplierEdrpou = ocr?.supplierEdrpou?.toLowerCase().includes(q);
      const matchInvoice = ocr?.invoiceNumber?.toLowerCase().includes(q);
      const matchBuyer = ocr?.buyerName?.toLowerCase().includes(q);
      const matchBuyerEdrpou = ocr?.buyerEdrpou?.toLowerCase().includes(q);
      const matchPaymentNum = ocr?.paymentNumber?.toLowerCase().includes(q);
      const matchPurpose = ocr?.paymentPurpose?.toLowerCase().includes(q);
      const matchDate = (ocr?.invoiceDate?.toLowerCase().includes(q)) || (ocr?.paymentDate?.toLowerCase().includes(q));
      const amountVal = (ocr?.totalAmount ?? ocr?.amountPaid)?.toString() || '';
      const matchAmount = amountVal.includes(q);

      return (
        matchName ||
        matchOrder ||
        matchSupplier ||
        matchSupplierEdrpou ||
        matchInvoice ||
        matchBuyer ||
        matchBuyerEdrpou ||
        matchPaymentNum ||
        matchPurpose ||
        matchDate ||
        matchAmount
      );
    }

    return true;
  });

  // 2. Sort documents (default: newest first by createdAt / date)
  const sortedDocs = [...filteredDocs].sort((a, b) => {
    if (sortBy === 'newest') {
      const timeA = a.createdAt || 0;
      const timeB = b.createdAt || 0;
      if (timeA !== timeB) return timeB - timeA;
      const dateA = a.editedData?.invoiceDate || a.ocrResult?.invoiceDate || a.editedData?.paymentDate || a.ocrResult?.paymentDate || '';
      const dateB = b.editedData?.invoiceDate || b.ocrResult?.invoiceDate || b.editedData?.paymentDate || b.ocrResult?.paymentDate || '';
      if (dateA && dateB && dateA !== dateB) return dateB.localeCompare(dateA);
      return 0;
    }
    if (sortBy === 'oldest') {
      const timeA = a.createdAt || 0;
      const timeB = b.createdAt || 0;
      if (timeA !== timeB) return timeA - timeB;
      const dateA = a.editedData?.invoiceDate || a.ocrResult?.invoiceDate || a.editedData?.paymentDate || a.ocrResult?.paymentDate || '';
      const dateB = b.editedData?.invoiceDate || b.ocrResult?.invoiceDate || b.editedData?.paymentDate || b.ocrResult?.paymentDate || '';
      if (dateA && dateB && dateA !== dateB) return dateA.localeCompare(dateB);
      return 0;
    }
    if (sortBy === 'orderNumber') {
      const ordA = a.editedData?.handwrittenOrderNumber || a.ocrResult?.handwrittenOrderNumber || '';
      const ordB = b.editedData?.handwrittenOrderNumber || b.ocrResult?.handwrittenOrderNumber || '';
      if (ordA && !ordB) return -1;
      if (!ordA && ordB) return 1;
      return ordA.localeCompare(ordB);
    }
    if (sortBy === 'amountDesc') {
      const amtA = a.editedData?.totalAmount || a.ocrResult?.totalAmount || a.editedData?.amountPaid || a.ocrResult?.amountPaid || 0;
      const amtB = b.editedData?.totalAmount || b.ocrResult?.totalAmount || b.editedData?.amountPaid || b.ocrResult?.amountPaid || 0;
      return amtB - amtA;
    }
    if (sortBy === 'amountAsc') {
      const amtA = a.editedData?.totalAmount || a.ocrResult?.totalAmount || a.editedData?.amountPaid || a.ocrResult?.amountPaid || 0;
      const amtB = b.editedData?.totalAmount || b.ocrResult?.totalAmount || b.editedData?.amountPaid || b.ocrResult?.amountPaid || 0;
      return amtA - amtB;
    }
    return 0;
  });

  // 3. Paginate
  const totalItems = sortedDocs.length;
  const effectivePageSize = pageSize === 'all' ? (totalItems || 1) : pageSize;
  const totalPages = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(totalItems / effectivePageSize));
  const safeCurrentPage = Math.min(Math.max(1, currentPage), totalPages);

  const startIndex = pageSize === 'all' ? 0 : (safeCurrentPage - 1) * effectivePageSize;
  const endIndex = pageSize === 'all' ? totalItems : Math.min(startIndex + effectivePageSize, totalItems);
  const paginatedDocs = sortedDocs.slice(startIndex, endIndex);

  // Selection handlers
  const isPageFullySelected = paginatedDocs.length > 0 && paginatedDocs.every((d) => selectedIds.has(d.id));
  const areAllFilteredSelected = totalItems > 0 && selectedIds.size >= totalItems;

  const toggleSelectPage = () => {
    if (isPageFullySelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        paginatedDocs.forEach((d) => next.delete(d.id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        paginatedDocs.forEach((d) => next.add(d.id));
        return next;
      });
    }
  };

  const selectAllFiltered = () => {
    setSelectedIds(new Set(filteredDocs.map((d) => d.id)));
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  const toggleSelectDoc = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const readyToSyncCount = filteredDocs.filter((d) => d.status === 'ready_for_review').length;
  const pendingProcessCount = filteredDocs.filter((d) => d.status === 'pending').length;

  // Smart page numbers array for pagination bar
  const getPageNumbers = (): (number | string)[] => {
    const delta = 2;
    const range: number[] = [];
    const rangeWithDots: (number | string)[] = [];
    let l: number | undefined;

    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || (i >= safeCurrentPage - delta && i <= safeCurrentPage + delta)) {
        range.push(i);
      }
    }

    for (const i of range) {
      if (l !== undefined) {
        if (i - l === 2) {
          rangeWithDots.push(l + 1);
        } else if (i - l !== 1) {
          rangeWithDots.push('...');
        }
      }
      rangeWithDots.push(i);
      l = i;
    }

    return rangeWithDots;
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
      {/* Table Toolbar */}
      <div className="p-4 border-b border-slate-200 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Search bar with clear button & real-time indicator */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Пошук: № замовлення (ххх-26), постачальник, рахунок, сума..."
              className="w-full text-xs pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 text-slate-800 transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600 p-0.5 rounded transition-colors"
                title="Очистити пошук"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Status filter buttons: (всі, очікують, готові, синхронізовані) */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <button
                onClick={() => setStatusFilter('all')}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-all flex items-center space-x-1.5 ${
                  statusFilter === 'all'
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                <span>Всі</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                  statusFilter === 'all' ? 'bg-slate-700 text-slate-100' : 'bg-slate-200 text-slate-700'
                }`}>
                  {countAll}
                </span>
              </button>

              <button
                onClick={() => setStatusFilter('pending')}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-all flex items-center space-x-1.5 ${
                  statusFilter === 'pending'
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'bg-amber-50 text-amber-800 hover:bg-amber-100'
                }`}
                title="Документи, що очікують розпізнавання OCR або обробки"
              >
                <Clock className="w-3.5 h-3.5" />
                <span>Очікують</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                  statusFilter === 'pending' ? 'bg-amber-700 text-amber-100' : 'bg-amber-200 text-amber-900'
                }`}>
                  {countPending}
                </span>
              </button>

              <button
                onClick={() => setStatusFilter('ready_for_review')}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-all flex items-center space-x-1.5 ${
                  statusFilter === 'ready_for_review'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'bg-indigo-50 text-indigo-800 hover:bg-indigo-100'
                }`}
                title="Розпізнані документи, готові до перевірки та внесення в таблицю"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Готові</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                  statusFilter === 'ready_for_review' ? 'bg-indigo-700 text-indigo-100' : 'bg-indigo-200 text-indigo-900'
                }`}>
                  {countReady}
                </span>
              </button>

              <button
                onClick={() => setStatusFilter('synced')}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-all flex items-center space-x-1.5 ${
                  statusFilter === 'synced'
                    ? 'bg-emerald-700 text-white shadow-xs'
                    : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                }`}
                title="Документи, успішно записані в Google Таблицю"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Синхронізовані</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                  statusFilter === 'synced' ? 'bg-emerald-800 text-emerald-100' : 'bg-emerald-200 text-emerald-900'
                }`}>
                  {countSynced}
                </span>
              </button>

              {countError > 0 && (
                <button
                  onClick={() => setStatusFilter('error')}
                  className={`px-2.5 py-1.5 rounded-lg font-semibold transition-all flex items-center space-x-1.5 ${
                    statusFilter === 'error'
                      ? 'bg-rose-600 text-white shadow-xs'
                      : 'bg-rose-50 text-rose-800 hover:bg-rose-100'
                  }`}
                  title="Документи з помилками"
                >
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>Помилки</span>
                  <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                    statusFilter === 'error' ? 'bg-rose-700 text-rose-100' : 'bg-rose-200 text-rose-900'
                  }`}>
                    {countError}
                  </span>
                </button>
              )}
            </div>

            {/* Sort Dropdown */}
            <div className="flex items-center space-x-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5">
              <ArrowUpDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="bg-transparent text-slate-700 font-semibold focus:outline-none cursor-pointer text-xs"
                title="Сортування списку"
              >
                <option value="newest">Найновіші спочатку (за часом ↓)</option>
                <option value="oldest">Найстаріші спочатку (за часом ↑)</option>
                <option value="orderNumber">За номером замовлення (ххх-хх)</option>
                <option value="amountDesc">Сума (за спаданням ↓)</option>
                <option value="amountAsc">Сума (за зростанням ↑)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Active Filters Bar if any filter or search query is applied */}
        {(statusFilter !== 'all' || searchQuery.trim() !== '') && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 bg-indigo-50/50 border border-indigo-100 rounded-lg text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-slate-500 font-medium flex items-center gap-1 text-[11px]">
                <Filter className="w-3.5 h-3.5 text-indigo-600" />
                Активні критерії:
              </span>

              {statusFilter !== 'all' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-white border border-indigo-200 text-indigo-700 rounded-md font-medium text-[11px] shadow-2xs">
                  Статус: {
                    statusFilter === 'pending'
                      ? 'Очікують'
                      : statusFilter === 'ready_for_review'
                      ? 'Готові'
                      : statusFilter === 'synced'
                      ? 'Синхронізовані'
                      : 'Помилки'
                  }
                  <button
                    onClick={() => setStatusFilter('all')}
                    className="hover:text-indigo-900 ml-0.5 text-slate-400 hover:text-slate-700"
                    title="Скинути фільтр за статусом"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}

              {searchQuery.trim() !== '' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-white border border-slate-300 text-slate-700 rounded-md font-medium text-[11px] shadow-2xs">
                  Пошук: "{searchQuery.trim()}"
                  <button
                    onClick={() => setSearchQuery('')}
                    className="hover:text-slate-900 ml-0.5 text-slate-400 hover:text-slate-700"
                    title="Очистити пошук"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}

              <span className="text-slate-500 text-[11px]">
                (Знайдено: <strong className="text-slate-800">{filteredDocs.length}</strong> з {documents.length})
              </span>
            </div>

            <button
              onClick={() => {
                setStatusFilter('all');
                setSearchQuery('');
              }}
              className="text-[11px] text-indigo-700 hover:text-indigo-900 font-semibold flex items-center gap-1 underline transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              Скинути всі фільтри
            </button>
          </div>
        )}

        {/* Batch Operations Bar & Page Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 text-xs">
          <div className="flex items-center space-x-2">
            <button
              onClick={toggleSelectPage}
              className="p-1 text-slate-500 hover:text-slate-800 transition-colors flex items-center space-x-1"
            >
              {isPageFullySelected ? (
                <CheckSquare className="w-4 h-4 text-indigo-600" />
              ) : (
                <Square className="w-4 h-4 text-slate-400" />
              )}
              <span className="font-semibold text-slate-700">
                {selectedIds.size > 0 
                  ? `Вибрано ${selectedIds.size} з ${totalItems}`
                  : `Вибрати сторінку (${paginatedDocs.length})`}
              </span>
            </button>

            {selectedIds.size > 0 && (
              <button
                onClick={clearSelection}
                className="text-[11px] text-slate-400 hover:text-slate-600 underline ml-1"
              >
                Зняти виділення
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => {
                const targetIds = selectedIds.size > 0
                  ? Array.from(selectedIds)
                  : filteredDocs.filter((d) => d.status === 'pending').map((d) => d.id);
                onBatchProcess(targetIds);
              }}
              disabled={isProcessingAny || (selectedIds.size === 0 && pendingProcessCount === 0)}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold shadow-xs transition-colors flex items-center space-x-1.5 disabled:opacity-50"
            >
              {isProcessingAny ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              <span>
                Обробити AI ({selectedIds.size > 0 ? selectedIds.size : pendingProcessCount})
              </span>
            </button>

            <button
              onClick={() => {
                const targetIds = selectedIds.size > 0
                  ? Array.from(selectedIds)
                  : filteredDocs.filter((d) => d.status === 'ready_for_review').map((d) => d.id);
                onBatchSync(targetIds);
              }}
              disabled={isSyncingAny || (selectedIds.size === 0 && readyToSyncCount === 0)}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold shadow-xs transition-colors flex items-center space-x-1.5 disabled:opacity-50"
            >
              {isSyncingAny ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <FileSpreadsheet className="w-3.5 h-3.5" />
              )}
              <span>
                Занести в таблицю ({selectedIds.size > 0 ? selectedIds.size : readyToSyncCount})
              </span>
            </button>

            {documents.length > 0 && (
              <button
                onClick={onClearAll}
                className="px-2.5 py-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors flex items-center space-x-1"
                title="Очистити список"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Очистити</span>
              </button>
            )}

            {/* Quick Mini Pagination at top if > 1 page */}
            {totalPages > 1 && (
              <div className="flex items-center space-x-1 pl-2 border-l border-slate-200">
                <span className="text-[11px] text-slate-500 font-medium mr-1">
                  Стор. <strong className="text-slate-800">{safeCurrentPage}</strong> з <strong className="text-slate-800">{totalPages}</strong>
                </span>
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={safeCurrentPage <= 1}
                  className="p-1 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded disabled:opacity-30 disabled:hover:bg-transparent"
                  title="Попередня сторінка"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safeCurrentPage >= totalPages}
                  className="p-1 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded disabled:opacity-30 disabled:hover:bg-transparent"
                  title="Наступна сторінка"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Banner: Select all across all pages */}
        {isPageFullySelected && totalItems > paginatedDocs.length && !areAllFilteredSelected && (
          <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-2 text-xs text-indigo-900 flex items-center justify-between">
            <span>
              Вибрано всі <strong>{paginatedDocs.length}</strong> документів на цій сторінці.
            </span>
            <button
              onClick={selectAllFiltered}
              className="text-indigo-700 hover:text-indigo-950 font-bold underline"
            >
              Вибрати всі {totalItems} документів у списку
            </button>
          </div>
        )}
      </div>

      {/* Table Content */}
      {filteredDocs.length === 0 ? (
        <div className="p-12 text-center text-slate-500 space-y-3">
          {documents.length > 0 ? (
            <>
              <div className="w-12 h-12 mx-auto rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                <Search className="w-6 h-6" />
              </div>
              <h4 className="text-sm font-bold text-slate-800">За вашим запитом документів не знайдено</h4>
              <p className="text-xs max-w-md mx-auto text-slate-500">
                Не знайдено документів, які відповідають вибраному статусу «
                {statusFilter === 'pending'
                  ? 'Очікують'
                  : statusFilter === 'ready_for_review'
                  ? 'Готові'
                  : statusFilter === 'synced'
                  ? 'Синхронізовані'
                  : statusFilter === 'error'
                  ? 'Помилки'
                  : 'Всі'}
                »{searchQuery.trim() ? ` або пошуковому запиту "${searchQuery.trim()}"` : ''}.
              </p>
              <div className="pt-2">
                <button
                  onClick={() => {
                    setStatusFilter('all');
                    setSearchQuery('');
                  }}
                  className="inline-flex items-center space-x-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold transition-colors shadow-2xs"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Скинути фільтр та пошук</span>
                </button>
              </div>
            </>
          ) : (
            <>
              <FileText className="w-10 h-10 mx-auto text-slate-300" />
              <h4 className="text-sm font-bold text-slate-700">Немає документів у списку</h4>
              <p className="text-xs max-w-sm mx-auto text-slate-400">
                Зчитайте файли з папки Google Drive або перетягніть PDF / фото з пристрою.
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                <th className="p-3 w-10 text-center"></th>
                <th className="p-3">Документ</th>
                <th className="p-3 bg-amber-50/60 text-amber-900 border-x border-amber-200">
                  <span className="flex items-center space-x-1">
                    <PenTool className="w-3 h-3 text-amber-600" />
                    <span>Внутр. замовлення (Рукопис)</span>
                  </span>
                </th>
                <th className="p-3">Постачальник</th>
                <th className="p-3">Наша компанія</th>
                <th className="p-3">Рахунок / Дата</th>
                <th className="p-3 text-right">Сума</th>
                <th className="p-3 text-center">Статус</th>
                <th className="p-3 text-right">Дії</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedDocs.map((doc, index) => {
                const isSelected = selectedIds.has(doc.id);
                const data = doc.editedData || doc.ocrResult;
                const rowSequence = startIndex + index + 1;

                return (
                  <tr
                    key={doc.id}
                    className={`hover:bg-slate-50/80 transition-colors ${
                      isSelected ? 'bg-indigo-50/30' : ''
                    }`}
                  >
                    {/* Checkbox & Sequence */}
                    <td className="p-3 text-center">
                      <div className="flex items-center justify-center space-x-1.5">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectDoc(doc.id)}
                          className="rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        />
                        <span className="text-[10px] text-slate-400 font-mono select-none w-5 text-left">
                          {rowSequence}
                        </span>
                      </div>
                    </td>

                    {/* File Name & Preview */}
                    <td className="p-3">
                      <div className="flex items-center space-x-2.5">
                        <div className="w-8 h-8 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0 overflow-hidden">
                          {doc.previewDataUrl && !doc.mimeType.includes('pdf') ? (
                            <img
                              src={doc.previewDataUrl}
                              alt=""
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <FileText className="w-4 h-4 text-slate-500" />
                          )}
                        </div>
                        <div className="min-w-0 max-w-[170px]">
                          <div className="flex items-center space-x-1">
                            {data?.documentType === 'payment' && (
                              <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-blue-100 text-blue-900 border border-blue-200 shrink-0">
                                Платіжка
                              </span>
                            )}
                            <p className="font-semibold text-slate-900 truncate" title={doc.fileName}>
                              {doc.fileName}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-slate-400 mt-0.5">
                            <span>{(doc.fileSize / 1024).toFixed(0)} KB</span>
                            <span>•</span>
                            <span className="capitalize">{doc.source === 'camera' ? 'камера' : doc.source === 'upload' ? 'ручне' : 'диск'}</span>
                            
                            {/* Google Drive Status / Link */}
                            {doc.driveUploadStatus === 'uploading' && (
                              <span className="inline-flex items-center space-x-1 px-1.5 py-0.2 rounded text-[9px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
                                <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                                <span>Збереження на Диск...</span>
                              </span>
                            )}
                            
                            {(doc.driveWebViewLink || doc.driveLink) && (
                              <a
                                href={doc.driveWebViewLink || doc.driveLink}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center space-x-0.5 text-indigo-600 hover:text-indigo-800 font-medium hover:underline"
                                title="Відкрити на Google Drive"
                              >
                                <span>Google Диск</span>
                                <ExternalLink className="w-2.5 h-2.5 inline" />
                              </a>
                            )}

                            {doc.driveUploadStatus === 'failed' && onRetryDriveUpload && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onRetryDriveUpload(doc.id);
                                }}
                                className="inline-flex items-center space-x-0.5 text-rose-600 hover:text-rose-800 font-medium underline"
                                title={doc.driveUploadError || 'Повторити збереження на Google Диск'}
                              >
                                <AlertCircle className="w-2.5 h-2.5 inline" />
                                <span>Повторити збереження</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Handwritten Order # */}
                    <td className="p-3 bg-amber-50/30 border-x border-amber-100/80 font-mono">
                      {data?.handwrittenOrderNumber ? (
                        <div className="flex items-center space-x-1.5">
                          <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-950 font-bold text-xs border border-amber-300">
                            {data.handwrittenOrderNumber}
                          </span>
                          {data.handwrittenConfidence && (
                            <span
                              className={`text-[9px] uppercase px-1 rounded font-bold ${
                                data.handwrittenConfidence === 'high'
                                  ? 'text-emerald-700 bg-emerald-100'
                                  : 'text-amber-700 bg-amber-100'
                              }`}
                              title={data.handwrittenLocation}
                            >
                              {data.handwrittenConfidence}
                            </span>
                          )}
                        </div>
                      ) : data?.documentType === 'payment' && (data?.referencedInvoiceNumbers?.length || data?.referencedInvoiceNumber) ? (
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[10px] bg-blue-50 text-blue-900 border border-blue-200 px-1.5 py-0.5 rounded font-mono font-semibold truncate max-w-[150px]" title={`Прив'язка до рахунків: ${data.referencedInvoiceNumber || data.referencedInvoiceNumbers?.join(', ')}`}>
                            Рах: {data.referencedInvoiceNumber || data.referencedInvoiceNumbers?.join(', ')}
                          </span>
                          {data?.referencedInvoiceNumbers && data.referencedInvoiceNumbers.length > 1 && (
                            <span className="text-[9px] text-blue-700 font-bold">
                              ({data.referencedInvoiceNumbers.length} рахунки)
                            </span>
                          )}
                        </div>
                      ) : doc.status === 'ready_for_review' || doc.status === 'synced' ? (
                        <span className="text-[11px] text-amber-700/70 italic">Не знайдено</span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>

                    {/* Supplier / Payee */}
                    <td className="p-3">
                      <p className="font-semibold text-slate-800 max-w-[140px] truncate" title={data?.payeeName || data?.supplierName}>
                        {data?.payeeName || data?.supplierName || '—'}
                      </p>
                      {data?.supplierTaxId && (
                        <span className="text-[10px] text-slate-400 font-mono">
                          Код: {data.supplierTaxId}
                        </span>
                      )}
                    </td>

                    {/* Our Company / Payer */}
                    <td className="p-3">
                      <p className="text-slate-700 max-w-[130px] truncate font-medium" title={data?.payerName || data?.buyerName}>
                        {data?.payerName || data?.buyerName || '—'}
                      </p>
                    </td>

                    {/* Invoice / Payment # & Date */}
                    <td className="p-3 font-mono">
                      <p className="font-semibold text-slate-900 truncate max-w-[120px]">
                        {data?.paymentNumber || data?.invoiceNumber || '—'}
                      </p>
                      <span className="text-[10px] text-slate-500">
                        {data?.paymentDate || data?.invoiceDate || '—'}
                      </span>
                    </td>

                    {/* Total Amount */}
                    <td className="p-3 text-right font-mono font-bold">
                      {data?.totalAmount ? (
                        <span className="text-slate-900">
                          {OCRService.formatCurrency(data.totalAmount, data.currency)}
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>

                    {/* Status Badge */}
                    <td className="p-3 text-center">
                      {doc.status === 'pending' && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600">
                          <Clock className="w-3 h-3 mr-1 text-slate-400" />
                          Очікує
                        </span>
                      )}
                      {doc.status === 'processing' && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-100 text-indigo-800 animate-pulse">
                          <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
                          Розпізнавання...
                        </span>
                      )}
                      {doc.status === 'ready_for_review' && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-900 border border-amber-200">
                          <CheckCircle2 className="w-3 h-3 mr-1 text-amber-600" />
                          Готово
                        </span>
                      )}
                      {doc.status === 'synced' && (
                        <div className="flex flex-col items-center">
                          <span
                            className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 shadow-2xs"
                            title={doc.alreadyInSheetReason || `Вже внесено у вкладку "${doc.alreadyInSheetTab || 'Рахунки/Платіжки'}"`}
                          >
                            <CheckCircle2 className="w-3 h-3 mr-1 text-emerald-600" />
                            Внесено в таблицю
                          </span>
                          {doc.syncedRowIndex && (
                            <span className="text-[9px] text-emerald-700 font-mono mt-0.5">
                              рядок {doc.syncedRowIndex}
                            </span>
                          )}
                        </div>
                      )}
                      {doc.status === 'error' && (
                        <div className="flex flex-col items-center">
                          <span
                            className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-100 text-rose-800 max-w-[120px] truncate"
                            title={doc.errorMessage || 'Помилка розпізнавання'}
                          >
                            <AlertCircle className="w-3 h-3 mr-1 shrink-0" />
                            Помилка
                          </span>
                        </div>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end space-x-1.5">
                        <button
                          onClick={() => onOpenReview(doc)}
                          className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition-colors flex items-center space-x-1"
                          title="Переглянути та перевірити"
                        >
                          <Eye className="w-3 h-3" />
                          <span>Перевірка</span>
                        </button>

                        {(doc.status === 'pending' || doc.status === 'error') && (
                          <button
                            onClick={() => onProcessDoc(doc.id)}
                            disabled={isProcessingAny}
                            className="px-2 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-xs font-semibold transition-colors flex items-center space-x-1"
                            title="Обробити через AI"
                          >
                            <Sparkles className="w-3.5 h-3.5" />
                            <span>{doc.status === 'error' ? 'Повторити' : 'Розпізнати'}</span>
                          </button>
                        )}

                        {doc.status === 'ready_for_review' && (
                          <button
                            onClick={() => onSyncDoc(doc.id)}
                            disabled={isSyncingAny}
                            className="p-1 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                            title="Занести в Google Таблицю"
                          >
                            <FileSpreadsheet className="w-4 h-4" />
                          </button>
                        )}

                        {doc.status === 'synced' && (
                          <span
                            className="p-1 text-emerald-600 cursor-help"
                            title={doc.alreadyInSheetReason || "Цей документ вже присутній у Google Таблиці, дублювання виключено."}
                          >
                            <CheckCircle2 className="w-4 h-4" />
                          </span>
                        )}

                        <button
                          onClick={() => onRemoveDoc(doc.id)}
                          className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                          title="Видалити зі списку"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modern E-Commerce Style Pagination Footer */}
      {filteredDocs.length > 0 && (
        <div className="p-3.5 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
          {/* Left: Summary and Page Size selector */}
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-slate-600 font-medium">
              Показано <strong className="text-slate-900 font-mono">{startIndex + 1}–{endIndex}</strong> з <strong className="text-slate-900 font-mono">{totalItems}</strong> документів
            </span>

            <div className="flex items-center space-x-1.5 pl-3 border-l border-slate-200">
              <span className="text-slate-500 text-[11px]">Показувати по:</span>
              <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-2xs">
                {[25, 50, 100].map((size) => (
                  <button
                    key={size}
                    onClick={() => setPageSize(size)}
                    className={`px-2 py-0.5 text-xs font-semibold rounded-md transition-colors ${
                      pageSize === size
                        ? 'bg-indigo-600 text-white shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                  >
                    {size}
                  </button>
                ))}
                <button
                  onClick={() => setPageSize('all')}
                  className={`px-2 py-0.5 text-xs font-semibold rounded-md transition-colors ${
                    pageSize === 'all'
                      ? 'bg-indigo-600 text-white shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                  }`}
                  title="Показати всі документи без розбивки"
                >
                  Всі
                </button>
              </div>
            </div>
          </div>

          {/* Right: Page Buttons */}
          {totalPages > 1 && (
            <div className="flex items-center space-x-1">
              {/* First page button */}
              <button
                onClick={() => setCurrentPage(1)}
                disabled={safeCurrentPage <= 1}
                className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 disabled:opacity-30 disabled:hover:bg-white shadow-2xs transition-colors"
                title="Перша сторінка"
              >
                <ChevronsLeft className="w-3.5 h-3.5" />
              </button>

              {/* Prev page button */}
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={safeCurrentPage <= 1}
                className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 disabled:opacity-30 disabled:hover:bg-white shadow-2xs transition-colors"
                title="Попередня сторінка"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>

              {/* Page numbers with active styling */}
              <div className="flex items-center space-x-1 px-1">
                {getPageNumbers().map((item, idx) => {
                  if (item === '...') {
                    return (
                      <span key={`dots-${idx}`} className="px-1.5 py-1 text-slate-400 font-bold select-none">
                        …
                      </span>
                    );
                  }
                  const pageNum = item as number;
                  const isActive = pageNum === safeCurrentPage;
                  return (
                    <button
                      key={pageNum}
                      onClick={() => setCurrentPage(pageNum)}
                      className={`min-w-7 h-7 px-2 text-xs font-bold rounded-lg transition-colors shadow-2xs ${
                        isActive
                          ? 'bg-indigo-600 text-white border border-indigo-600'
                          : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-200'
                      }`}
                    >
                      {pageNum}
                    </button>
                  );
                })}
              </div>

              {/* Next page button */}
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={safeCurrentPage >= totalPages}
                className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 disabled:opacity-30 disabled:hover:bg-white shadow-2xs transition-colors"
                title="Наступна сторінка"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>

              {/* Last page button */}
              <button
                onClick={() => setCurrentPage(totalPages)}
                disabled={safeCurrentPage >= totalPages}
                className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 disabled:opacity-30 disabled:hover:bg-white shadow-2xs transition-colors"
                title="Остання сторінка"
              >
                <ChevronsRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
