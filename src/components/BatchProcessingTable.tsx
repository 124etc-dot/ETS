import React, { useState } from 'react';
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
  Square
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

  const filteredDocs = documents.filter((doc) => {
    // Status filter
    if (statusFilter !== 'all' && doc.status !== statusFilter) return false;

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const ocr = doc.editedData || doc.ocrResult;
      const matchName = doc.fileName.toLowerCase().includes(q);
      const matchOrder = ocr?.handwrittenOrderNumber?.toLowerCase().includes(q);
      const matchSupplier = ocr?.supplierName?.toLowerCase().includes(q);
      const matchInvoice = ocr?.invoiceNumber?.toLowerCase().includes(q);
      const matchBuyer = ocr?.buyerName?.toLowerCase().includes(q);
      return matchName || matchOrder || matchSupplier || matchInvoice || matchBuyer;
    }

    return true;
  });

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredDocs.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredDocs.map((d) => d.id)));
    }
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

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
      {/* Table Toolbar */}
      <div className="p-4 border-b border-slate-200 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Search bar */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Пошук за номером замовлення (№ххх-26), постачальником, файлом..."
              className="w-full text-xs pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 text-slate-800"
            />
          </div>

          {/* Status filter buttons */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-2.5 py-1.5 rounded-lg font-medium transition-colors ${
                statusFilter === 'all'
                  ? 'bg-slate-900 text-white font-bold'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Всі ({documents.length})
            </button>
            <button
              onClick={() => setStatusFilter('pending')}
              className={`px-2.5 py-1.5 rounded-lg font-medium transition-colors ${
                statusFilter === 'pending'
                  ? 'bg-amber-600 text-white font-bold'
                  : 'bg-amber-50 text-amber-800 hover:bg-amber-100'
              }`}
            >
              Не оброблені ({documents.filter((d) => d.status === 'pending').length})
            </button>
            <button
              onClick={() => setStatusFilter('ready_for_review')}
              className={`px-2.5 py-1.5 rounded-lg font-medium transition-colors ${
                statusFilter === 'ready_for_review'
                  ? 'bg-indigo-600 text-white font-bold'
                  : 'bg-indigo-50 text-indigo-800 hover:bg-indigo-100'
              }`}
            >
              Готові ({documents.filter((d) => d.status === 'ready_for_review').length})
            </button>
            <button
              onClick={() => setStatusFilter('synced')}
              className={`px-2.5 py-1.5 rounded-lg font-medium transition-colors ${
                statusFilter === 'synced'
                  ? 'bg-emerald-700 text-white font-bold'
                  : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
              }`}
            >
              Занесені ({documents.filter((d) => d.status === 'synced').length})
            </button>
          </div>
        </div>

        {/* Batch Operations Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 text-xs">
          <div className="flex items-center space-x-2">
            <button
              onClick={toggleSelectAll}
              className="p-1 text-slate-500 hover:text-slate-800 transition-colors flex items-center space-x-1"
            >
              {selectedIds.size > 0 && selectedIds.size === filteredDocs.length ? (
                <CheckSquare className="w-4 h-4 text-indigo-600" />
              ) : (
                <Square className="w-4 h-4 text-slate-400" />
              )}
              <span className="font-semibold text-slate-700">
                Вибрано {selectedIds.size} з {filteredDocs.length}
              </span>
            </button>
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
          </div>
        </div>
      </div>

      {/* Table Content */}
      {filteredDocs.length === 0 ? (
        <div className="p-12 text-center text-slate-500 space-y-3">
          <FileText className="w-10 h-10 mx-auto text-slate-300" />
          <h4 className="text-sm font-bold text-slate-700">Немає документів у списку</h4>
          <p className="text-xs max-w-sm mx-auto text-slate-400">
            Зчитайте файли з папки Google Drive або перетягніть PDF / фото з пристрою.
          </p>
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
              {filteredDocs.map((doc) => {
                const isSelected = selectedIds.has(doc.id);
                const data = doc.editedData || doc.ocrResult;

                return (
                  <tr
                    key={doc.id}
                    className={`hover:bg-slate-50/80 transition-colors ${
                      isSelected ? 'bg-indigo-50/30' : ''
                    }`}
                  >
                    {/* Checkbox */}
                    <td className="p-3 text-center">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelectDoc(doc.id)}
                        className="rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                      />
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
    </div>
  );
};
