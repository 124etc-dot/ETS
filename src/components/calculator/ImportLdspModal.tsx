import React, { useState, useRef } from 'react';
import {
  X,
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Layers,
  ArrowRight,
  RefreshCw,
  Sparkles,
  Download,
  AlertCircle,
  FileText,
  Tag,
  Grid,
} from 'lucide-react';
import { LdspItem, LdspParseResult, MaterialItem } from '../../types/calculator';
import {
  parseLdspFile,
  generateSampleLdspExcelWorkbook,
} from '../../services/ldspPriceParser';
import { CalculatorStorageService } from '../../services/calculatorStorage';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  existingMaterials: MaterialItem[];
  onApplyImport: (updatedMaterials: MaterialItem[], message: string) => void;
}

export const ImportLdspModal: React.FC<Props> = ({
  isOpen,
  onClose,
  existingMaterials,
  onApplyImport,
}) => {
  const [supplier, setSupplier] = useState<string>('KRONAS');
  const [customSupplier, setCustomSupplier] = useState<string>('');
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [parseResult, setParseResult] = useState<LdspParseResult | null>(null);
  const [expandedBrands, setExpandedBrands] = useState<Record<string, boolean>>({});
  const [selectedPreviewTab, setSelectedPreviewTab] = useState<'tree' | 'table'>('tree');
  const [searchFilter, setSearchFilter] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const currentSupplierName =
    supplier === 'custom' ? customSupplier || 'Постачальник' : supplier;

  const handleProcessFile = async (file: File) => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const result = await parseLdspFile(
        file,
        file.name,
        currentSupplierName,
        existingMaterials
      );

      if (result.recognizedItems.length === 0) {
        setErrorMsg(
          'Не вдалося розпізнати позиції ЛДСП. Перевірте, чи файл містить назви з габаритами (наприклад, 2800x2070) та колонку цін.'
        );
      } else {
        setParseResult(result);
        const initFolders: Record<string, boolean> = {};
        result.brandsFound.forEach((b) => {
          initFolders[b] = true;
        });
        setExpandedBrands(initFolders);
      }
    } catch (err: any) {
      console.error('Error parsing LDSP Excel:', err);
      setErrorMsg(`Помилка читання Excel: ${err.message || 'Невідомий формат'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleProcessFile(file);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleProcessFile(file);
    }
  };

  const handleDownloadSample = () => {
    try {
      const buffer = generateSampleLdspExcelWorkbook();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ЛДСП_Прайс_KRONAS.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error downloading sample:', err);
    }
  };

  const handleSaveToDatabase = async () => {
    if (!parseResult || parseResult.recognizedItems.length === 0) return;

    setIsLoading(true);
    try {
      const syncResult = await CalculatorStorageService.importLdspItemsApi(
        parseResult.recognizedItems,
        currentSupplierName
      );

      const msg = `Успішно імпортовано прайс ЛДСП (${parseResult.recognizedItems.length} поз.): +${syncResult.addedCount} нових, оновлено цін: ${syncResult.updatedCount}`;
      onApplyImport(syncResult.updatedMaterials, msg);
      onClose();
    } catch (err: any) {
      console.error('Error saving LDSP to DB:', err);
      setErrorMsg(`Не вдалося зберегти в базу: ${err.message || 'Помилка'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleBrand = (brand: string) => {
    setExpandedBrands((prev) => ({
      ...prev,
      [brand]: !prev[brand],
    }));
  };

  const existingMap = new Map<string, MaterialItem>();
  existingMaterials.forEach((m) => {
    existingMap.set(m.name.trim().toLowerCase(), m);
  });

  // Filter items for preview
  const filteredItems = (parseResult?.recognizedItems || []).filter((item) => {
    if (!searchFilter.trim()) return true;
    const q = searchFilter.toLowerCase();
    return (
      item.name.toLowerCase().includes(q) ||
      item.brand.toLowerCase().includes(q)
    );
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white w-full max-w-5xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh] animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-amber-900 via-amber-800 to-yellow-800 text-white flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 backdrop-blur-md flex items-center justify-center border border-white/20">
              <Grid className="w-6 h-6 text-amber-200" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold">Імпорт прайс-листа ЛДСП Excel</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-400/20 text-amber-200 border border-amber-400/30">
                  KRONAS .xlsx
                </span>
              </div>
              <p className="text-xs text-amber-100/90 mt-0.5">
                Автоматичне розпізнавання Бренда, розрахунок площі листа та ціни за 1 м²
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-amber-200 hover:text-white hover:bg-white/10 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {/* Supplier Selector and Sample Download Bar */}
          <div className="p-4 bg-amber-50/60 rounded-xl border border-amber-200/70 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-xs font-bold text-amber-950">Постачальник:</span>
              <div className="flex items-center gap-1.5">
                {['KRONAS', 'ВіЯр', 'custom'].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSupplier(s)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                      supplier === s
                        ? 'bg-amber-800 text-white shadow-xs'
                        : 'bg-white text-slate-700 hover:bg-amber-100/70 border border-amber-200'
                    }`}
                  >
                    {s === 'custom' ? 'Інший...' : s}
                  </button>
                ))}
              </div>

              {supplier === 'custom' && (
                <input
                  type="text"
                  placeholder="Вкажіть назву постачальника"
                  value={customSupplier}
                  onChange={(e) => setCustomSupplier(e.target.value)}
                  className="px-3 py-1.5 bg-white border border-amber-300 rounded-lg text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500 w-56"
                />
              )}
            </div>

            <button
              type="button"
              onClick={handleDownloadSample}
              className="px-3 py-1.5 bg-white hover:bg-amber-100 text-amber-900 border border-amber-300 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shadow-2xs"
              title="Завантажити зразок таблиці Excel (ЛДСП Прайс KRONAS.xlsx) з брендами Egger, Kronospan, CLEAF, Swiss Krono"
            >
              <Download className="w-3.5 h-3.5 text-amber-700" />
              <span>Зразок «ЛДСП Прайс KRONAS.xlsx»</span>
            </button>
          </div>

          {/* Upload Drop Zone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleFileDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-6 text-center transition cursor-pointer ${
              isDragging
                ? 'border-amber-600 bg-amber-50'
                : 'border-slate-300 hover:border-amber-400 bg-slate-50/50 hover:bg-amber-50/20'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileInputChange}
              className="hidden"
            />

            <div className="flex flex-col items-center justify-center gap-2">
              <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center">
                <FileSpreadsheet className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-800">
                  Оберіть файл Excel або перетягніть сюди
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Підтримуються файли .xlsx та .xls (наприклад: «ЛДСП Прайс KRONAS.xlsx»)
                </p>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[11px] font-medium text-amber-800 bg-amber-100/70 px-2.5 py-0.5 rounded-full">
                  Артикул ігнорується
                </span>
                <span className="text-[11px] font-medium text-amber-800 bg-amber-100/70 px-2.5 py-0.5 rounded-full">
                  Бренд за заголовком групи
                </span>
                <span className="text-[11px] font-medium text-amber-800 bg-amber-100/70 px-2.5 py-0.5 rounded-full">
                  Ціна за 1 м² = Ціна листа / Площа
                </span>
              </div>
            </div>
          </div>

          {/* Loading state */}
          {isLoading && (
            <div className="p-6 bg-slate-50 rounded-xl border border-slate-200 text-center space-y-2">
              <RefreshCw className="w-8 h-8 text-amber-600 animate-spin mx-auto" />
              <p className="text-sm font-bold text-slate-800">Обробка прайс-листа Excel...</p>
              <p className="text-xs text-slate-500">
                Зчитування брендів, витягування габаритів листа та перерахунок ціни за 1 м²
              </p>
            </div>
          )}

          {/* Error Message */}
          {errorMsg && (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">Помилка: </span>
                {errorMsg}
              </div>
            </div>
          )}

          {/* Parse Results Preview */}
          {parseResult && !isLoading && (
            <div className="space-y-4">
              {/* Stats Bar */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 bg-white border border-slate-200 rounded-xl">
                  <div className="text-[11px] text-slate-500 font-medium">Всього позицій</div>
                  <div className="text-lg font-bold text-slate-900 font-mono mt-0.5">
                    {parseResult.recognizedItems.length}
                  </div>
                </div>

                <div className="p-3 bg-white border border-slate-200 rounded-xl">
                  <div className="text-[11px] text-slate-500 font-medium">Брендів у файлі</div>
                  <div className="text-lg font-bold text-amber-700 font-mono mt-0.5">
                    {parseResult.brandsFound.length}
                  </div>
                </div>

                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                  <div className="text-[11px] text-emerald-700 font-medium">Нових товарів</div>
                  <div className="text-lg font-bold text-emerald-800 font-mono mt-0.5">
                    +{parseResult.newItemsCount}
                  </div>
                </div>

                <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl">
                  <div className="text-[11px] text-blue-700 font-medium">Оновлення цін</div>
                  <div className="text-lg font-bold text-blue-800 font-mono mt-0.5">
                    {parseResult.updatedItemsCount}
                  </div>
                </div>
              </div>

              {/* View Switcher and Search */}
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setSelectedPreviewTab('tree')}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                      selectedPreviewTab === 'tree'
                        ? 'bg-white text-slate-900 shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Дерево за брендами ({parseResult.brandsFound.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedPreviewTab('table')}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                      selectedPreviewTab === 'table'
                        ? 'bg-white text-slate-900 shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Таблиця ({parseResult.recognizedItems.length})
                  </button>
                </div>

                <input
                  type="text"
                  placeholder="Фільтр по назві або бренду..."
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  className="px-3 py-1.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500 w-64"
                />
              </div>

              {/* Preview Content */}
              {selectedPreviewTab === 'tree' ? (
                <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-200 max-h-96 overflow-y-auto">
                  {parseResult.brandsFound.map((brand) => {
                    const brandItems = filteredItems.filter((i) => i.brand === brand);
                    const isOpen = expandedBrands[brand] ?? true;

                    if (brandItems.length === 0 && searchFilter.trim()) return null;

                    return (
                      <div key={brand} className="bg-slate-50/50">
                        <button
                          type="button"
                          onClick={() => toggleBrand(brand)}
                          className="w-full px-4 py-2.5 bg-slate-100/80 hover:bg-slate-200/70 text-left flex items-center justify-between gap-2 transition cursor-pointer select-none"
                        >
                          <div className="flex items-center gap-2">
                            {isOpen ? (
                              <ChevronDown className="w-4 h-4 text-slate-500" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-slate-400" />
                            )}
                            <Folder className="w-4 h-4 text-amber-600" />
                            <span className="text-xs font-bold text-slate-900">{brand}</span>
                          </div>

                          <span className="text-[10px] font-mono font-bold bg-white text-slate-600 px-2 py-0.5 rounded border border-slate-200">
                            {brandItems.length} поз.
                          </span>
                        </button>

                        {isOpen && (
                          <div className="p-2 space-y-1.5 bg-white">
                            {brandItems.map((item, idx) => {
                              const isExisting = existingMap.has(item.name.trim().toLowerCase());
                              const existingItem = existingMap.get(item.name.trim().toLowerCase());
                              const priceChanged =
                                isExisting &&
                                existingItem &&
                                existingItem.basePrice !== item.price_sqm;

                              return (
                                <div
                                  key={idx}
                                  className="p-2 bg-slate-50/60 hover:bg-amber-50/40 rounded-lg border border-slate-200/80 flex items-center justify-between gap-3 text-xs"
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="font-medium text-slate-900 truncate">
                                      {item.name}
                                    </div>
                                    <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-0.5">
                                      <span className="font-mono">
                                        Площа: {item.sheet_area_sqm} м²
                                      </span>
                                      <span>•</span>
                                      <span className="font-mono">
                                        Лист: {item.price_sheet.toLocaleString('uk-UA')} ₴
                                      </span>
                                      <span>•</span>
                                      {isExisting ? (
                                        <span className="text-blue-600 font-semibold">
                                          {priceChanged ? 'Оновлення ціни' : 'Без змін'}
                                        </span>
                                      ) : (
                                        <span className="text-emerald-600 font-semibold">
                                          + Новий
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  <div className="text-right shrink-0">
                                    <div className="font-mono font-bold text-slate-900">
                                      {item.price_sqm.toLocaleString('uk-UA')} ₴
                                      <span className="text-[10px] text-slate-400 font-normal">
                                        /м²
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="border border-slate-200 rounded-xl overflow-hidden max-h-96 overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100 text-slate-700 font-bold sticky top-0 border-b border-slate-200">
                      <tr>
                        <th className="px-3 py-2">Бренд</th>
                        <th className="px-3 py-2">Повна назва (1 в 1)</th>
                        <th className="px-3 py-2 text-right">Площа (м²)</th>
                        <th className="px-3 py-2 text-right">Ціна за лист</th>
                        <th className="px-3 py-2 text-right">Ціна за 1 м²</th>
                        <th className="px-3 py-2 text-center">Статус</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {filteredItems.map((item, idx) => {
                        const isExisting = existingMap.has(item.name.trim().toLowerCase());
                        return (
                          <tr key={idx} className="hover:bg-amber-50/30">
                            <td className="px-3 py-2 font-semibold text-amber-800">
                              {item.brand}
                            </td>
                            <td className="px-3 py-2 text-slate-900 max-w-md truncate">
                              {item.name}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-slate-600">
                              {item.sheet_area_sqm} м²
                            </td>
                            <td className="px-3 py-2 text-right font-mono font-semibold text-slate-800">
                              {item.price_sheet.toLocaleString('uk-UA')} ₴
                            </td>
                            <td className="px-3 py-2 text-right font-mono font-bold text-slate-900">
                              {item.price_sqm.toLocaleString('uk-UA')} ₴
                            </td>
                            <td className="px-3 py-2 text-center">
                              {isExisting ? (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                                  Оновлення
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                  Новий
                                </span>
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
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-slate-500">
            {parseResult ? (
              <span>
                Готово до збереження: <b>{parseResult.recognizedItems.length}</b> товарів ЛДСП
              </span>
            ) : (
              <span>Оберіть файл для початку імпорту</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 font-semibold text-xs rounded-xl border border-slate-300 transition cursor-pointer"
            >
              Скасувати
            </button>

            {parseResult && parseResult.recognizedItems.length > 0 && (
              <button
                type="button"
                onClick={handleSaveToDatabase}
                disabled={isLoading}
                className="px-5 py-2 bg-gradient-to-r from-amber-700 to-amber-800 hover:from-amber-800 hover:to-amber-900 text-white font-bold text-xs rounded-xl shadow-md transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>
                  Застосувати в базу даних ({parseResult.recognizedItems.length} поз.)
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
