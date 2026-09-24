import React, { useState, useRef } from 'react';
import {
  X,
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  Folder,
  FolderTree,
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
  Scissors,
} from 'lucide-react';
import { MaterialItem, ParsedPriceItem, PriceParseResult } from '../../types/calculator';
import { MetalPriceParserService } from '../../services/metalPriceParser';
import { CalculatorStorageService } from '../../services/calculatorStorage';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  existingMaterials: MaterialItem[];
  onApplyImport: (updatedMaterials: MaterialItem[], message: string) => void;
}

export const ImportMetalPriceModal: React.FC<Props> = ({
  isOpen,
  onClose,
  existingMaterials,
  onApplyImport,
}) => {
  const [supplier, setSupplier] = useState<string>('ТОВ «Метал Холдінг»');
  const [customSupplier, setCustomSupplier] = useState<string>('');
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadingStepText, setLoadingStepText] = useState<string>('Розпізнавання файлу...');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [parseResult, setParseResult] = useState<PriceParseResult | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [selectedPreviewTab, setSelectedPreviewTab] = useState<'tree' | 'table'>('tree');

  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentSupplierName = supplier === 'custom' ? (customSupplier || 'Постачальник') : supplier;

  const handleFileProcess = async (file: File) => {
    setIsLoading(true);
    setErrorMsg(null);
    const isPdf = file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';
    setLoadingStepText(
      isPdf
        ? 'ШІ-аналіз PDF прайс-листа Метал Холдінг (зчитування таблиць, папок та цін за 1 м/лист)...'
        : 'Обробка таблиці Excel/CSV...'
    );

    try {
      const result = await MetalPriceParserService.parseFile(
        file,
        existingMaterials,
        currentSupplierName
      );

      if (result.recognizedItems.length === 0) {
        setErrorMsg('Не вдалося розпізнати позиції з цінами. Перевірте наявність колонки «Назва товару» та колонки цін «за 1 м / лист».');
      } else {
        setParseResult(result);
        // Expand all folders by default
        const initFolders: Record<string, boolean> = {};
        result.groupHeadersFound.forEach((g) => {
          initFolders[g] = true;
        });
        setExpandedFolders(initFolders);
      }
    } catch (err: any) {
      console.error('Error parsing file:', err);
      setErrorMsg(`Помилка читання файлу: ${err.message || 'Невідомий формат'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleFileProcess(file);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileProcess(file);
    }
  };

  const handleLoadDemo = () => {
    setIsLoading(true);
    setLoadingStepText('Завантаження демо-прайсу...');
    setTimeout(() => {
      const demoItems = MetalPriceParserService.getDemoItems();
      const matched = demoItems.map((item) => {
        const norm = MetalPriceParserService.normalizeName(item.name);
        const existing = existingMaterials.find(
          (m) => MetalPriceParserService.normalizeName(m.name) === norm
        );
        return {
          ...item,
          isExisting: !!existing,
          existingId: existing?.id,
          oldPrice: existing?.basePrice,
        };
      });

      const groups = Array.from(new Set(matched.map((i) => i.groupHeader)));
      const res: PriceParseResult = {
        fileName: 'Демо_прайс_металопрокату.xlsx',
        supplier: currentSupplierName,
        mainCategory: 'Чорний металопрокат',
        totalRowsRead: 18,
        recognizedItems: matched,
        groupHeadersFound: groups,
        newItemsCount: matched.filter((i) => !i.isExisting).length,
        updatedItemsCount: matched.filter((i) => i.isExisting).length,
        errors: [],
      };

      setParseResult(res);
      const initFolders: Record<string, boolean> = {};
      groups.forEach((g) => {
        initFolders[g] = true;
      });
      setExpandedFolders(initFolders);
      setIsLoading(false);
      setErrorMsg(null);
    }, 200);
  };

  const handleLoadMetalHoldingDemo = () => {
    setIsLoading(true);
    setLoadingStepText('Імітація ШІ-парсингу PDF прайсу ТОВ «Метал Холдінг»...');
    setTimeout(() => {
      const demoItems = MetalPriceParserService.getMetalHoldingDemoItems();
      const matched = demoItems.map((item) => {
        const norm = MetalPriceParserService.normalizeName(item.name);
        const existing = existingMaterials.find(
          (m) => MetalPriceParserService.normalizeName(m.name) === norm
        );
        return {
          ...item,
          isExisting: !!existing,
          existingId: existing?.id,
          oldPrice: existing?.basePrice,
        };
      });

      const groups = Array.from(new Set(matched.map((i) => i.groupHeader)));
      const res: PriceParseResult = {
        fileName: 'Прайс_Метал_Холдінг.pdf',
        supplier: 'ТОВ «Метал Холдінг»',
        mainCategory: 'Чорний металопрокат',
        totalRowsRead: demoItems.length,
        recognizedItems: matched,
        groupHeadersFound: groups,
        newItemsCount: matched.filter((i) => !i.isExisting).length,
        updatedItemsCount: matched.filter((i) => i.isExisting).length,
        errors: [],
      };

      setParseResult(res);
      const initFolders: Record<string, boolean> = {};
      groups.forEach((g) => {
        initFolders[g] = true;
      });
      setExpandedFolders(initFolders);
      setIsLoading(false);
      setErrorMsg(null);
    }, 300);
  };

  const handleDownloadSample = () => {
    MetalPriceParserService.downloadSampleFile();
  };

  const handleDownloadMetalHoldingPdf = () => {
    MetalPriceParserService.downloadMetalHoldingSamplePdf();
  };

  const toggleFolder = (groupName: string) => {
    setExpandedFolders((prev) => ({
      ...prev,
      [groupName]: !prev[groupName],
    }));
  };

  const handleConfirmImport = async () => {
    if (!parseResult || parseResult.recognizedItems.length === 0) return;

    const { updatedMaterials, addedCount, updatedCount } =
      MetalPriceParserService.applyImportedPrices(
        parseResult.recognizedItems,
        currentSupplierName,
        existingMaterials
      );

    // Save to database API immediately
    try {
      await CalculatorStorageService.saveMaterialsToApi(updatedMaterials);
    } catch (apiErr) {
      console.warn('Failed to sync materials with /api/materials:', apiErr);
    }

    const msg = `Імпорт завершено! Додано ${addedCount} нових позицій, оновлено ціни у ${updatedCount} існуючих матеріалах (Всього в базі: ${updatedMaterials.length} поз.).`;
    onApplyImport(updatedMaterials, msg);
    CalculatorStorageService.notifyMaterialsChanged(updatedMaterials);
    onClose();
  };

  // Group items by subcategory / groupHeader
  const groupedItems = React.useMemo<Record<string, ParsedPriceItem[]>>(() => {
    if (!parseResult) return {};
    const map: Record<string, ParsedPriceItem[]> = {};
    parseResult.recognizedItems.forEach((item) => {
      const g = item.groupHeader || 'Інший прокат';
      if (!map[g]) map[g] = [];
      map[g].push(item);
    });
    return map;
  }, [parseResult]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-xs">
              <FolderTree className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900">
                  Парсер прайсу металопрокату & Генератор дерева
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200">
                  PDF (Метал Холдінг)
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                  Excel / CSV
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Автоматичне розпізнавання груп, підкатегорій та роздрібних цін (м.п. / м²) з PDF та Excel прайсів
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {/* Supplier Selector & Quick Actions */}
          <div className="bg-slate-50/80 p-3.5 rounded-xl border border-slate-200/90 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Tag className="w-4 h-4 text-slate-500" />
              <label className="text-xs font-bold text-slate-700">Постачальник:</label>
              <select
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
                className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="ТОВ «Метал Холдінг»">ТОВ «Метал Холдінг» (PDF / Excel)</option>
                <option value="ТОВ «Метінвест-СМЦ»">ТОВ «Метінвест-СМЦ»</option>
                <option value="ТОВ «АВ метал груп»">ТОВ «АВ метал груп»</option>
                <option value="ТОВ «Вікант»">ТОВ «Вікант»</option>
                <option value="custom">Інший постачальник...</option>
              </select>

              {supplier === 'custom' && (
                <input
                  type="text"
                  value={customSupplier}
                  onChange={(e) => setCustomSupplier(e.target.value)}
                  placeholder="Вкажіть назву постачальника"
                  className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Sample PDF Download */}
              <button
                type="button"
                onClick={handleDownloadMetalHoldingPdf}
                className="px-2.5 py-1 text-xs font-semibold text-blue-700 hover:text-blue-900 bg-blue-50 hover:bg-blue-100 rounded-lg border border-blue-200 transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
                title="Завантажити офіційний зразок PDF-прайсу Метал Холдінг для тестування"
              >
                <FileText className="w-3.5 h-3.5 text-blue-600" />
                <span>Зразок PDF (Метал Холдінг)</span>
              </button>

              {/* Sample Excel Download */}
              <button
                type="button"
                onClick={handleDownloadSample}
                className="px-2.5 py-1 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-100 rounded-lg border border-slate-200 transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
                title="Завантажити зразок Excel файлу з правильною структурою"
              >
                <Download className="w-3.5 h-3.5 text-slate-500" />
                <span>Зразок Excel</span>
              </button>

              {/* Metal Holding Demo 1-Click */}
              <button
                type="button"
                onClick={handleLoadMetalHoldingDemo}
                className="px-2.5 py-1 text-xs font-bold text-indigo-700 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 rounded-lg border border-indigo-200 transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
                title="Миттєве розпізнавання структури PDF прайсу ТОВ «Метал Холдінг»"
              >
                <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                <span>Демо Метал Холдінг (PDF)</span>
              </button>
            </div>
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
            className={`border-2 border-dashed rounded-2xl p-6 text-center transition cursor-pointer flex flex-col items-center justify-center gap-2 ${
              isDragging
                ? 'border-blue-500 bg-blue-50/60 scale-[1.005]'
                : 'border-slate-300 hover:border-blue-400 bg-slate-50/40 hover:bg-blue-50/20'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.xlsx,.xls,.csv,application/pdf"
              onChange={handleFileInputChange}
              className="hidden"
            />

            <div className="flex items-center gap-2">
              <div className="w-11 h-11 rounded-2xl bg-blue-100 text-blue-700 flex items-center justify-center shadow-xs">
                {isLoading ? (
                  <RefreshCw className="w-5 h-5 animate-spin text-blue-600" />
                ) : (
                  <FileText className="w-5 h-5" />
                )}
              </div>
              <div className="w-11 h-11 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center shadow-xs">
                <FileSpreadsheet className="w-5 h-5" />
              </div>
            </div>

            <div>
              <div className="text-sm font-bold text-slate-800">
                Перетягніть сюди прайс-лист металу у форматі <span className="text-blue-700 font-extrabold">PDF</span> або <span className="text-emerald-700 font-extrabold">Excel/CSV</span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Оптимізовано для офіційних PDF прайс-листів <strong>ТОВ «Метал Холдінг»</strong>, Метінвест-СМЦ, АВ метал груп
              </p>
            </div>

            {isLoading && (
              <div className="text-xs font-semibold text-blue-700 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-200 animate-pulse mt-1">
                {loadingStepText}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-center gap-2 text-[11px] text-slate-500 mt-1">
              <span className="px-2 py-0.5 bg-white rounded border border-slate-200 font-semibold text-blue-700">
                📄 PDF (Метал Холдінг)
              </span>
              <span className="px-2 py-0.5 bg-white rounded border border-slate-200">
                Колонки: Назва товару
              </span>
              <span className="px-2 py-0.5 bg-white rounded border border-slate-200">
                Ціна роздрібна / за 1 м/ лист
              </span>
              <span className="px-2 py-0.5 bg-white rounded border border-slate-200">
                Порізка (грн)
              </span>
              <span className="px-2 py-0.5 bg-white rounded border border-slate-200">
                Од. (Тонна / м.п. / м²)
              </span>
            </div>
          </div>

          {/* Error Message */}
          {errorMsg && (
            <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 flex items-start gap-2 animate-in fade-in">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">Помилка розпізнавання:</span> {errorMsg}
              </div>
            </div>
          )}

          {/* Parsed Results Section */}
          {parseResult && (
            <div className="space-y-3 animate-in fade-in">
              {/* Summary Stats Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <div className="text-[10px] font-bold text-slate-500 uppercase">
                    Головна категорія
                  </div>
                  <div className="text-xs font-bold text-slate-900 truncate mt-0.5 flex items-center gap-1.5">
                    <Folder className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    <span>{parseResult.mainCategory}</span>
                  </div>
                </div>

                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <div className="text-[10px] font-bold text-slate-500 uppercase">
                    Підкатегорій знайдено
                  </div>
                  <div className="text-xs font-bold text-slate-900 mt-0.5 font-mono">
                    {parseResult.groupHeadersFound.length} папок
                  </div>
                </div>

                <div className="bg-emerald-50/80 p-3 rounded-xl border border-emerald-200">
                  <div className="text-[10px] font-bold text-emerald-700 uppercase">
                    Нові позиції
                  </div>
                  <div className="text-xs font-bold text-emerald-900 mt-0.5 font-mono">
                    +{parseResult.newItemsCount} шт (будуть додані)
                  </div>
                </div>

                <div className="bg-amber-50/80 p-3 rounded-xl border border-amber-200">
                  <div className="text-[10px] font-bold text-amber-700 uppercase">
                    Оновлення цін
                  </div>
                  <div className="text-xs font-bold text-amber-900 mt-0.5 font-mono">
                    {parseResult.updatedItemsCount} шт (без дублювання)
                  </div>
                </div>
              </div>

              {/* View Switcher: Tree vs Flat Table */}
              <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedPreviewTab('tree')}
                    className={`px-3 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition cursor-pointer ${
                      selectedPreviewTab === 'tree'
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    <FolderTree className="w-3.5 h-3.5" />
                    <span>Дерево категорій прайсу (ТЗ)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedPreviewTab('table')}
                    className={`px-3 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition cursor-pointer ${
                      selectedPreviewTab === 'table'
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Табличний вигляд ({parseResult.recognizedItems.length})</span>
                  </button>
                </div>

                <span className="text-[11px] text-slate-400">
                  Файл: <strong className="text-slate-600">{parseResult.fileName}</strong>
                </span>
              </div>

              {/* VIEW 1: HIERARCHICAL TREE (As described in Technical Assignment) */}
              {selectedPreviewTab === 'tree' && (
                <div className="bg-slate-900 text-slate-100 rounded-xl p-4 font-mono text-xs overflow-x-auto border border-slate-800 shadow-inner max-h-[340px] overflow-y-auto">
                  {/* Root Folder: Металопрокат */}
                  <div className="flex items-center gap-2 text-emerald-400 font-bold">
                    <Folder className="w-4 h-4 fill-emerald-400/20 text-emerald-400" />
                    <span>📁 Металопрокат</span>
                  </div>

                  {/* Level 1: Чорний металопрокат (з заголовка прайсу) */}
                  <div className="pl-6 pt-1">
                    <div className="flex items-center gap-2 text-cyan-300 font-bold">
                      <span className="text-slate-600">└──</span>
                      <Folder className="w-3.5 h-3.5 fill-cyan-400/20 text-cyan-300" />
                      <span>📁 {parseResult.mainCategory}</span>
                      <span className="text-[10px] text-slate-400 font-normal">
                        (з заголовка прайсу)
                      </span>
                    </div>

                    {/* Level 2: Group Headers (Підкатегорії) */}
                    <div className="pl-6 pt-1 space-y-3">
                      {(Object.entries(groupedItems) as [string, ParsedPriceItem[]][]).map(([groupName, items]) => {
                        const isExpanded = expandedFolders[groupName] ?? true;

                        return (
                          <div key={groupName} className="space-y-1">
                            <button
                              type="button"
                              onClick={() => toggleFolder(groupName)}
                              className="flex items-center gap-2 text-amber-300 hover:text-amber-200 transition cursor-pointer select-none text-left"
                            >
                              <span className="text-slate-600">└──</span>
                              <Folder className="w-3.5 h-3.5 fill-amber-400/20 text-amber-300" />
                              <span className="font-bold">📁 {groupName}</span>
                              <span className="text-[10px] text-slate-400 font-normal">
                                ({items.length} поз.)
                              </span>
                              {isExpanded ? (
                                <ChevronDown className="w-3 h-3 text-slate-400" />
                              ) : (
                                <ChevronRight className="w-3 h-3 text-slate-400" />
                              )}
                            </button>

                            {/* Level 3: Leaf items */}
                            {isExpanded && (
                              <div className="pl-6 space-y-1 text-slate-300">
                                {items.map((it, iIdx) => {
                                  const isLast = iIdx === items.length - 1;
                                  return (
                                    <div
                                      key={iIdx}
                                      className="flex items-center gap-2 py-0.5 hover:bg-slate-800/60 rounded px-1 group"
                                    >
                                      <span className="text-slate-600">
                                        {isLast ? '└──' : '├──'}
                                      </span>
                                      <span className="text-slate-400">📄</span>
                                      <span className="font-sans font-medium text-white group-hover:text-emerald-300 transition">
                                        {it.name}
                                      </span>
                                      <span className="text-slate-500">—</span>
                                      <span className="font-bold text-emerald-400">
                                        {it.basePrice.toLocaleString('uk-UA', {
                                          minimumFractionDigits: 2,
                                        })}{' '}
                                        грн / {it.unit}
                                      </span>
                                      {it.isExisting ? (
                                        <span className="text-[10px] text-amber-300 bg-amber-950/60 px-1.5 py-0.2 rounded border border-amber-700/50">
                                          Оновлення: {it.oldPrice?.toFixed(2)} ₴ ➔ {it.basePrice.toFixed(2)} ₴
                                        </span>
                                      ) : (
                                        <span className="text-[10px] text-emerald-300 bg-emerald-950/60 px-1.5 py-0.2 rounded border border-emerald-700/50">
                                          Новий
                                        </span>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* VIEW 2: FLAT TABLE */}
              {selectedPreviewTab === 'table' && (
                <div className="border border-slate-200 rounded-xl overflow-hidden max-h-[340px] overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100 text-slate-700 font-bold sticky top-0 border-b border-slate-200">
                      <tr>
                        <th className="py-2 px-3">Підкатегорія (Папка)</th>
                        <th className="py-2 px-3">Назва матеріалу</th>
                        <th className="py-2 px-3 text-center">Од.</th>
                        <th className="py-2 px-3 text-right">Ціна роздрібна</th>
                        <th className="py-2 px-3 text-center">Статус</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {parseResult.recognizedItems.map((item, idx) => (
                        <tr key={idx} className="hover:bg-slate-50 transition">
                          <td className="py-1.5 px-3 font-semibold text-slate-700">
                            {item.groupHeader}
                          </td>
                          <td className="py-1.5 px-3 font-medium text-slate-900">
                            {item.name}
                          </td>
                          <td className="py-1.5 px-3 text-center text-slate-500 font-mono">
                            {item.unit}
                          </td>
                          <td className="py-1.5 px-3 text-right font-mono font-bold text-slate-900">
                            {item.basePrice.toFixed(2)} ₴
                          </td>
                          <td className="py-1.5 px-3 text-center">
                            {item.isExisting ? (
                              <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-amber-100 text-amber-800">
                                Оновлення
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-100 text-emerald-800">
                                Новий
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-200/80 rounded-xl transition cursor-pointer"
          >
            Скасувати
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!parseResult || parseResult.recognizedItems.length === 0}
              onClick={handleConfirmImport}
              className={`px-4 py-2 text-xs font-bold rounded-xl transition flex items-center gap-2 shadow-xs cursor-pointer ${
                parseResult && parseResult.recognizedItems.length > 0
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                  : 'bg-slate-200 text-slate-400 cursor-not-allowed'
              }`}
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>
                {parseResult
                  ? `Застосувати в базу (${parseResult.recognizedItems.length} поз.)`
                  : 'Застосувати в базу'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
