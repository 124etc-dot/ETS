import React, { useState, useEffect } from 'react';
import { 
  Building2, 
  Check, 
  X, 
  AlertTriangle, 
  FileText, 
  Sparkles,
  ArrowRight
} from 'lucide-react';

interface Props {
  isOpen: boolean;
  companyName: string;
  invoiceNumber?: string;
  fileName?: string;
  supplierName?: string;
  totalAmount?: number;
  currency?: string;
  taxId?: string;
  onConfirm: (confirmedCompanyName: string) => Promise<void> | void;
  onCancel: () => void;
  isLoading?: boolean;
}

export const NewCompanyConfirmModal: React.FC<Props> = ({
  isOpen,
  companyName,
  invoiceNumber,
  fileName,
  supplierName,
  totalAmount,
  currency = 'UAH',
  taxId,
  onConfirm,
  onCancel,
  isLoading = false,
}) => {
  const [editedName, setEditedName] = useState(companyName);

  useEffect(() => {
    setEditedName(companyName);
  }, [companyName, isOpen]);

  if (!isOpen) return null;

  const isFop = editedName.toUpperCase().includes('ФОП');
  const isTov = editedName.toUpperCase().includes('ТОВ') || editedName.toUpperCase().includes('ПП') || editedName.toUpperCase().includes('ТДВ');

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && !isLoading) {
      onCancel();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !isLoading && editedName.trim()) {
      onConfirm(editedName.trim());
    }
  };

  return (
    <div 
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-company-modal-title"
    >
      <div 
        className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-amber-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Accent Header */}
        <div className="bg-gradient-to-r from-amber-500 via-amber-600 to-orange-500 px-6 py-5 text-white flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-xs flex items-center justify-center text-white shadow-inner">
              <Building2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide uppercase bg-amber-400/40 text-white mb-0.5">
                Нова наша компанія (ФОП / ТОВ)
              </span>
              <h3 id="new-company-modal-title" className="text-base font-bold text-white">
                Виявлено нову нашу компанію
              </h3>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="text-white/80 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors disabled:opacity-50"
            title="Скасувати внесення (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5">
          {/* Informational Banner */}
          <div className="flex items-start space-x-3 p-3.5 bg-amber-50/80 rounded-xl border border-amber-200 text-amber-900">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-xs leading-relaxed">
              <p className="font-semibold text-amber-950 mb-0.5">
                Цієї компанії ще немає у списку «Наші компанії»
              </p>
              <p className="text-amber-800">
                У рахунку покупцем (одержувачем) вказана компанія, яку система раніше не зустрічала. 
                Ви можете підтвердити її додавання до конфігурації та таблиці або скасувати внесення рахунку.
              </p>
            </div>
          </div>

          {/* Document Context Card */}
          <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-200 text-xs space-y-2">
            <div className="flex items-center justify-between text-slate-500 font-medium pb-1.5 border-b border-slate-200">
              <div className="flex items-center space-x-1.5">
                <FileText className="w-3.5 h-3.5 text-slate-400" />
                <span>Документ:</span>
                <span className="text-slate-700 font-semibold truncate max-w-[220px]" title={fileName}>
                  {fileName || 'Рахунок'}
                </span>
              </div>
              {invoiceNumber && (
                <span className="font-bold text-slate-900 bg-white px-2 py-0.5 rounded border border-slate-200">
                  № {invoiceNumber}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1 text-[11px]">
              <div>
                <span className="text-slate-400 block">Постачальник (продавець):</span>
                <span className="font-semibold text-slate-800 truncate block" title={supplierName}>
                  {supplierName || '—'}
                </span>
              </div>
              {totalAmount !== undefined && totalAmount > 0 && (
                <div>
                  <span className="text-slate-400 block">Сума до сплати:</span>
                  <span className="font-bold text-emerald-700 block">
                    {totalAmount.toLocaleString('uk-UA', { minimumFractionDigits: 2 })} {currency}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Editable Company Name Input */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="company-name-input" className="text-xs font-bold text-slate-700 flex items-center space-x-1.5">
                <span>Назва нашої компанії / ФОП:</span>
                {isFop && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-700 border border-purple-200">
                    ФОП
                  </span>
                )}
                {isTov && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700 border border-blue-200">
                    Юр. особа
                  </span>
                )}
              </label>
              <span className="text-[10px] text-slate-400">Можна відредагувати</span>
            </div>

            <div className="relative">
              <input
                id="company-name-input"
                type="text"
                value={editedName}
                onChange={(e) => setEditedName(e.target.value)}
                placeholder="ФОП або ТОВ..."
                className="w-full px-3.5 py-2.5 bg-white border-2 border-amber-300 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 rounded-xl text-sm font-semibold text-slate-900 outline-none transition-all"
                disabled={isLoading}
                autoFocus
              />
            </div>
            {taxId && (
              <p className="text-[11px] text-slate-500">
                ЄДРПОУ / ІПН: <strong className="text-slate-700 font-semibold">{taxId}</strong>
              </p>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-col-reverse sm:flex-row items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-semibold transition-colors disabled:opacity-50 flex items-center justify-center space-x-1.5"
          >
            <X className="w-4 h-4 text-slate-500" />
            <span>Скасувати внесення</span>
          </button>

          <button
            type="button"
            onClick={() => onConfirm(editedName.trim())}
            disabled={isLoading || !editedName.trim()}
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs font-bold shadow-sm hover:shadow transition-all disabled:opacity-50 flex items-center justify-center space-x-2"
          >
            {isLoading ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Check className="w-4 h-4 text-white" />
            )}
            <span>Підтвердити: додати компанію та внести в таблицю</span>
          </button>
        </div>
      </div>
    </div>
  );
};
