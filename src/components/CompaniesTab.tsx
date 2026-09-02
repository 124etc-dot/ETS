import React, { useState } from 'react';
import { 
  Building2, 
  Users, 
  Search, 
  ExternalLink, 
  ShieldCheck, 
  Sparkles,
  CheckCircle2,
  RefreshCw,
  Trash2
} from 'lucide-react';
import { SheetCompanyLists, SheetConfig } from '../types';
import { GoogleSheetsService } from '../services/googleSheets';

interface Props {
  companyLists: SheetCompanyLists;
  sheetConfig: SheetConfig | null;
  onRefresh: () => Promise<void>;
  accessToken?: string;
  onNotify?: (msg: string, type: 'info' | 'success' | 'error') => void;
}

export const CompaniesTab: React.FC<Props> = ({ 
  companyLists, 
  sheetConfig, 
  onRefresh, 
  accessToken,
  onNotify 
}) => {
  const [ourSearch, setOurSearch] = useState('');
  const [supplierSearch, setSupplierSearch] = useState('');
  const [isCleaning, setIsCleaning] = useState(false);
  const [cleanupMessage, setCleanupMessage] = useState<string | null>(null);

  // Guarantee strictly unique lists on display
  const uniqueOur = GoogleSheetsService.deduplicateCompanyList(companyLists.ourCompanies);
  const uniqueSuppliers = GoogleSheetsService.deduplicateCompanyList(companyLists.suppliers);

  const filteredOur = uniqueOur.filter((c) =>
    c.toLowerCase().includes(ourSearch.toLowerCase())
  );

  const filteredSuppliers = uniqueSuppliers.filter((s) =>
    s.toLowerCase().includes(supplierSearch.toLowerCase())
  );

  const handleCleanSheetDuplicates = async () => {
    if (!sheetConfig?.spreadsheetId || !accessToken) {
      onNotify?.('Будь ласка, переконайтеся що Google Таблицю підключено', 'info');
      return;
    }

    setIsCleaning(true);
    setCleanupMessage(null);
    try {
      const res = await GoogleSheetsService.deduplicateCompaniesTab(
        sheetConfig.spreadsheetId,
        accessToken,
        sheetConfig.suppliersSheetName || 'Постачальники'
      );

      await onRefresh();

      if (res.removedCount > 0) {
        const msg = `Знайдено та успішно видалено ${res.removedCount} дублікат(ів) у вкладці "${sheetConfig.suppliersSheetName || 'Постачальники'}". Залишилось ${res.remainingCount} унікальних контрагентів.`;
        setCleanupMessage(msg);
        onNotify?.(msg, 'success');
      } else {
        const msg = `Дублікатів у вкладці "${sheetConfig.suppliersSheetName || 'Постачальники'}" не виявлено. Всі ${res.remainingCount} записів унікальні.`;
        setCleanupMessage(msg);
        onNotify?.(msg, 'info');
      }
    } catch (err) {
      console.error('Failed to clean duplicates in sheet:', err);
      onNotify?.('Помилка при спробі очистити дублікати в таблиці', 'error');
    } finally {
      setIsCleaning(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Intro info banner */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
        <div className="flex items-start space-x-3.5">
          <div className="w-9 h-9 rounded-lg bg-indigo-600 text-white flex items-center justify-center shrink-0 mt-0.5">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-bold text-slate-900">
              Списки компаній для точної ідентифікації контрагентів
            </h3>
            <p className="text-xs text-slate-600 mt-1 leading-relaxed">
              Коли ви скануєте рахунок, Gemini AI звіряє шапку документа з цими списками. Назва постачальника гарантовано <strong>не може співпадати</strong> з жодною назвою з переліку <em>"Наші компанії"</em>. Всі назви автоматично нормалізуються до формату <span className="font-semibold text-slate-800">ТОВ НАЗВА</span> без дублікатів.
            </p>
            {sheetConfig?.spreadsheetUrl && (
              <div className="flex flex-wrap items-center gap-3 mt-3">
                <a
                  href={sheetConfig.spreadsheetUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center space-x-1.5 text-xs text-indigo-600 hover:text-indigo-800 font-semibold"
                >
                  <span>Редагувати списки в Google Sheets</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>

                {accessToken && (
                  <button
                    type="button"
                    onClick={handleCleanSheetDuplicates}
                    disabled={isCleaning}
                    className="inline-flex items-center space-x-1.5 text-xs font-semibold px-2.5 py-1 bg-slate-50 hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 border border-slate-200 hover:border-indigo-300 rounded-md transition-colors disabled:opacity-50"
                  >
                    {isCleaning ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                    )}
                    <span>Очистити дублікати в таблиці Google</span>
                  </button>
                )}
              </div>
            )}

            {cleanupMessage && (
              <div className="mt-3 p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{cleanupMessage}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Column 1: Our Companies */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center space-x-2.5">
              <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 flex items-center justify-center">
                <Building2 className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900">Наші компанії</h4>
                <p className="text-[10px] text-slate-400">Вкладка: "{sheetConfig?.ourCompaniesSheetName || 'Наші компанії'}"</p>
              </div>
            </div>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
              {uniqueOur.length} компаній
            </span>
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              value={ourSearch}
              onChange={(e) => setOurSearch(e.target.value)}
              placeholder="Пошук нашої компанії..."
              className="w-full text-xs pl-8 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {filteredOur.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-6">
                Список порожній або нічого не знайдено
              </p>
            ) : (
              filteredOur.map((company, idx) => (
                <div
                  key={idx}
                  className="p-3 bg-slate-50 hover:bg-indigo-50/40 border border-slate-200 hover:border-indigo-200 rounded-lg transition-colors flex items-center justify-between text-xs"
                >
                  <div className="flex items-center space-x-2.5 min-w-0">
                    <span className="w-5 h-5 rounded bg-indigo-100 text-indigo-800 text-[10px] font-bold flex items-center justify-center shrink-0">
                      {idx + 1}
                    </span>
                    <span className="font-semibold text-slate-900 truncate">{company}</span>
                  </div>
                  <span className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded font-medium shrink-0">
                    Покупець / Платник
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Column 2: Suppliers */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center space-x-2.5">
              <div className="w-8 h-8 rounded-lg bg-slate-100 border border-slate-200 text-slate-700 flex items-center justify-center">
                <Users className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900">Постачальники</h4>
                <p className="text-[10px] text-slate-400">Вкладка: "{sheetConfig?.suppliersSheetName || 'Постачальники'}"</p>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                {uniqueSuppliers.length} постачальників
              </span>
            </div>
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              value={supplierSearch}
              onChange={(e) => setSupplierSearch(e.target.value)}
              placeholder="Пошук постачальника..."
              className="w-full text-xs pl-8 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {filteredSuppliers.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-6">
                Список порожній або нічого не знайдено
              </p>
            ) : (
              filteredSuppliers.map((supplier, idx) => (
                <div
                  key={idx}
                  className="p-3 bg-slate-50 hover:bg-slate-100/70 border border-slate-200 hover:border-slate-300 rounded-lg transition-colors flex items-center justify-between text-xs"
                >
                  <div className="flex items-center space-x-2.5 min-w-0">
                    <span className="w-5 h-5 rounded bg-slate-200 text-slate-700 text-[10px] font-bold flex items-center justify-center shrink-0">
                      {idx + 1}
                    </span>
                    <span className="font-semibold text-slate-900 truncate">{supplier}</span>
                  </div>
                  <span className="text-[10px] text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-medium shrink-0">
                    Контрагент
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
