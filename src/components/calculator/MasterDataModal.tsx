import React, { useState } from 'react';
import {
  X,
  Search,
  Plus,
  Trash2,
  RefreshCw,
  Download,
  Upload,
  Layers,
  Wrench,
  Percent,
  Check,
  AlertCircle,
  HelpCircle,
  Sparkles,
  FileSpreadsheet,
  Grid,
} from 'lucide-react';
import {
  MaterialCategory,
  MaterialItem,
  CalculatorCoefficients,
  MATERIAL_CATEGORIES,
} from '../../types/calculator';
import { CalculatorStorageService } from '../../services/calculatorStorage';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  materials: MaterialItem[];
  coefficients: CalculatorCoefficients;
  onMaterialsChange: (materials: MaterialItem[]) => void;
  onCoefficientsChange: (coeffs: CalculatorCoefficients) => void;
  onOpenImportPrice?: () => void;
  onOpenImportLdsp?: () => void;
}

export const MasterDataModal: React.FC<Props> = ({
  isOpen,
  onClose,
  materials,
  coefficients,
  onMaterialsChange,
  onCoefficientsChange,
  onOpenImportPrice,
  onOpenImportLdsp,
}) => {
  const [activeTab, setActiveTab] = useState<'materials' | 'waste' | 'coefficients'>('materials');
  const [selectedCatFilter, setSelectedCatFilter] = useState<MaterialCategory | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [tempPrice, setTempPrice] = useState<string>('');

  // New material form state
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState<MaterialCategory>('metal_profile');
  const [newUnit, setNewUnit] = useState('м.п.');
  const [newPrice, setNewPrice] = useState('');
  const [newSupplier, setNewSupplier] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const showNotification = (msg: string) => {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(null), 3500);
  };

  const filteredMaterials = materials.filter((m) => {
    const matchCat = selectedCatFilter === 'all' || m.category === selectedCatFilter;
    const matchSearch =
      !searchQuery ||
      m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.supplier?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.notes?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchCat && matchSearch;
  });

  const handleStartEditPrice = (item: MaterialItem) => {
    setEditingPriceId(item.id);
    setTempPrice(item.basePrice.toString());
  };

  const handleSavePrice = (id: string) => {
    const rawP = parseFloat(tempPrice);
    if (!isNaN(rawP) && rawP >= 0) {
      const p = parseFloat((Math.round(rawP * 100) / 100).toFixed(2));
      const updated = materials.map((m) =>
        m.id === id ? { ...m, basePrice: p, updatedAt: new Date().toISOString() } : m
      );
      onMaterialsChange(updated);
      CalculatorStorageService.saveMaterials(updated);
      showNotification('Ціну оновлено');
    }
    setEditingPriceId(null);
  };

  const handleDeleteMaterial = (id: string) => {
    if (window.confirm('Ви впевнені, що хочете видалити цей матеріал із довідника?')) {
      const updated = materials.filter((m) => m.id !== id);
      onMaterialsChange(updated);
      CalculatorStorageService.saveMaterials(updated);
      showNotification('Матеріал видалено');
    }
  };

  const handleCreateMaterial = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    const p = Math.max(0, parseFloat(newPrice) || 0);
    const catDefaultWaste = coefficients.wasteFactorsByCategory[newCategory] || 1.10;

    const newItem: MaterialItem = {
      id: `mat_custom_${Date.now()}`,
      name: newName.trim(),
      category: newCategory,
      unit: newUnit.trim() || 'шт',
      basePrice: p,
      defaultWasteFactor: newCategory === 'services' ? 1.0 : catDefaultWaste,
      supplier: newSupplier.trim(),
      notes: newNotes.trim(),
      updatedAt: new Date().toISOString(),
    };

    const updated = [newItem, ...materials];
    onMaterialsChange(updated);
    CalculatorStorageService.saveMaterials(updated);

    // Reset form
    setNewName('');
    setNewPrice('');
    setNewSupplier('');
    setNewNotes('');
    setIsAddingNew(false);
    showNotification('Новий матеріал успішно додано до довідника');
  };

  const handleResetDefaults = () => {
    if (window.confirm('Скинути довідник матеріалів до стандартного заводського списку?')) {
      const defs = CalculatorStorageService.resetMaterialsToDefault();
      onMaterialsChange(defs);
      showNotification('Довідник скинуто до початкових значень');
    }
  };

  const handleWasteFactorChange = (category: MaterialCategory, percent: number) => {
    const factor = Math.round((1 + percent / 100) * 100) / 100;
    const updatedCoeffs = {
      ...coefficients,
      wasteFactorsByCategory: {
        ...coefficients.wasteFactorsByCategory,
        [category]: factor,
      },
    };
    onCoefficientsChange(updatedCoeffs);
    CalculatorStorageService.saveCoefficients(updatedCoeffs);
  };

  const handleExportJson = () => {
    const dataStr = JSON.stringify({ materials, coefficients }, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ETS_MasterData_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (parsed.materials && Array.isArray(parsed.materials)) {
          onMaterialsChange(parsed.materials);
          CalculatorStorageService.saveMaterials(parsed.materials);
        }
        if (parsed.coefficients) {
          onCoefficientsChange(parsed.coefficients);
          CalculatorStorageService.saveCoefficients(parsed.coefficients);
        }
        showNotification('Довідники успішно імпортовано');
      } catch (err) {
        alert('Помилка імпорту JSON файлу');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-xs">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Довідники & Коефіцієнти (Settings / Master Data)
              </h2>
              <p className="text-xs text-slate-500">
                Базові закупівельні ціни матеріалів, норми технологічного відходу та планові коефіцієнти
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

        {/* Tab Navigation */}
        <div className="px-5 pt-3 border-b border-slate-200 bg-white flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={() => setActiveTab('materials')}
              className={`px-3.5 py-2 rounded-t-xl text-xs font-bold border-b-2 flex items-center gap-1.5 transition cursor-pointer ${
                activeTab === 'materials'
                  ? 'border-indigo-600 text-indigo-700 bg-indigo-50/50'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Матеріали та ціни ({materials.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('waste')}
              className={`px-3.5 py-2 rounded-t-xl text-xs font-bold border-b-2 flex items-center gap-1.5 transition cursor-pointer ${
                activeTab === 'waste'
                  ? 'border-indigo-600 text-indigo-700 bg-indigo-50/50'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <Percent className="w-3.5 h-3.5" />
              <span>Технологічний відхід</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('coefficients')}
              className={`px-3.5 py-2 rounded-t-xl text-xs font-bold border-b-2 flex items-center gap-1.5 transition cursor-pointer ${
                activeTab === 'coefficients'
                  ? 'border-indigo-600 text-indigo-700 bg-indigo-50/50'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Складність & Маржа</span>
            </button>
          </div>

          <div className="hidden sm:flex items-center gap-2 pb-2">
            {onOpenImportPrice && (
              <button
                type="button"
                onClick={onOpenImportPrice}
                className="px-2.5 py-1 text-blue-700 hover:text-blue-900 bg-blue-50 hover:bg-blue-100 rounded-lg text-xs font-bold border border-blue-200 flex items-center gap-1 transition cursor-pointer shadow-2xs"
                title="Імпорт прайс-листа металопрокату (PDF Метал Холдінг / Excel / CSV)"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-blue-600" />
                <span>Імпорт металу</span>
              </button>
            )}

            {onOpenImportLdsp && (
              <button
                type="button"
                onClick={onOpenImportLdsp}
                className="px-2.5 py-1 text-amber-900 hover:text-amber-950 bg-amber-50 hover:bg-amber-100 rounded-lg text-xs font-bold border border-amber-300 flex items-center gap-1 transition cursor-pointer shadow-2xs"
                title="Імпорт прайс-листа ЛДСП Excel (KRONAS / Egger / Kronospan / CLEAF)"
              >
                <Grid className="w-3.5 h-3.5 text-amber-700" />
                <span>Імпорт ЛДСП</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleExportJson}
              className="px-2.5 py-1 text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs font-semibold flex items-center gap-1 transition cursor-pointer"
              title="Експорт довідників у JSON"
            >
              <Download className="w-3 h-3" />
              <span>Експорт</span>
            </button>

            <label className="px-2.5 py-1 text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs font-semibold flex items-center gap-1 transition cursor-pointer">
              <Upload className="w-3 h-3" />
              <span>Імпорт</span>
              <input type="file" accept=".json" onChange={handleImportJson} className="hidden" />
            </label>
          </div>
        </div>

        {/* Success toast notification */}
        {successMessage && (
          <div className="bg-emerald-50 text-emerald-800 border-b border-emerald-200 px-5 py-2 text-xs font-semibold flex items-center gap-2 animate-in fade-in">
            <Check className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          {/* TAB 1: MATERIALS CATALOG */}
          {activeTab === 'materials' && (
            <div className="space-y-4">
              {/* Controls bar: Search, Category pills, Add button */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Пошук за назвою матеріалу або постачальником..."
                    className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsAddingNew(!isAddingNew)}
                    className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <Plus className="w-4 h-4" />
                    <span>{isAddingNew ? 'Приховати форму' : 'Новий матеріал'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleResetDefaults}
                    className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition cursor-pointer"
                    title="Скинути довідник до початкових значень"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Add Material Form */}
              {isAddingNew && (
                <form
                  onSubmit={handleCreateMaterial}
                  className="p-4 rounded-xl bg-indigo-50/60 border border-indigo-200/80 space-y-3 animate-in fade-in"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-indigo-900 flex items-center gap-1.5">
                      <Plus className="w-3.5 h-3.5" />
                      Додати новий матеріал або послугу
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsAddingNew(false)}
                      className="text-slate-400 hover:text-slate-600 text-xs"
                    >
                      Скасувати
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 mb-1">
                        Найменування матеріалу *
                      </label>
                      <input
                        type="text"
                        required
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder="напр. Труба нержавіюча 50х25х2 мм"
                        className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-medium focus:ring-1 focus:ring-indigo-500 bg-white"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 mb-1">Категорія</label>
                      <select
                        value={newCategory}
                        onChange={(e) => {
                          const cat = e.target.value as MaterialCategory;
                          setNewCategory(cat);
                          setNewUnit(MATERIAL_CATEGORIES[cat]?.defaultUnit || 'шт');
                        }}
                        className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-medium focus:ring-1 focus:ring-indigo-500 bg-white"
                      >
                        {(Object.keys(MATERIAL_CATEGORIES) as MaterialCategory[]).map((k) => (
                          <option key={k} value={k}>
                            {MATERIAL_CATEGORIES[k].name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 mb-1">Одиниця виміру</label>
                      <input
                        type="text"
                        value={newUnit}
                        onChange={(e) => setNewUnit(e.target.value)}
                        placeholder="м.п., м², шт, год"
                        className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-medium focus:ring-1 focus:ring-indigo-500 bg-white"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 mb-1">
                        Базова ціна закупівлі (грн) *
                      </label>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        required
                        value={newPrice}
                        onChange={(e) => setNewPrice(e.target.value)}
                        placeholder="0.00"
                        className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-mono font-bold focus:ring-1 focus:ring-indigo-500 bg-white"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 mb-1">Постачальник</label>
                      <input
                        type="text"
                        value={newSupplier}
                        onChange={(e) => setNewSupplier(e.target.value)}
                        placeholder="напр. ВіЯр, АВ метал"
                        className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-medium focus:ring-1 focus:ring-indigo-500 bg-white"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="submit"
                      className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow-xs transition cursor-pointer"
                    >
                      Зберегти в довідник
                    </button>
                  </div>
                </form>
              )}

              {/* Category Filter Pills */}
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
                <button
                  type="button"
                  onClick={() => setSelectedCatFilter('all')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition shrink-0 cursor-pointer ${
                    selectedCatFilter === 'all'
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  Всі категорії ({materials.length})
                </button>
                {(Object.keys(MATERIAL_CATEGORIES) as MaterialCategory[]).map((catKey) => {
                  const info = MATERIAL_CATEGORIES[catKey];
                  const count = materials.filter((m) => m.category === catKey).length;
                  return (
                    <button
                      key={catKey}
                      type="button"
                      onClick={() => setSelectedCatFilter(catKey)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition shrink-0 cursor-pointer ${
                        selectedCatFilter === catKey
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {info.name} ({count})
                    </button>
                  );
                })}
              </div>

              {/* Materials Table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-100/80 border-b border-slate-200 text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                      <th className="py-2.5 px-3">Матеріал / Послуга</th>
                      <th className="py-2.5 px-3">Категорія</th>
                      <th className="py-2.5 px-2 text-center">Од.</th>
                      <th className="py-2.5 px-3 text-right">Закупівельна ціна (грн)</th>
                      <th className="py-2.5 px-3">Постачальник</th>
                      <th className="py-2.5 px-2 text-center w-14">Дії</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/80 text-xs">
                    {filteredMaterials.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-slate-400">
                          Матеріалів не знайдено
                        </td>
                      </tr>
                    ) : (
                      filteredMaterials.map((mat) => {
                        const isEditingThis = editingPriceId === mat.id;
                        return (
                          <tr key={mat.id} className="hover:bg-slate-50 transition-colors">
                            <td className="py-2.5 px-3 font-semibold text-slate-900">
                              <div>{mat.name}</div>
                              <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                                {mat.groupHeader && (
                                  <span className="text-[10px] font-medium text-slate-600 bg-slate-100 px-1.5 py-0.2 rounded">
                                    📁 {mat.groupHeader}
                                  </span>
                                )}
                                {mat.notes && (
                                  <span className="text-[10px] text-slate-400 font-normal italic">
                                    {mat.notes}
                                  </span>
                                )}
                              </div>
                            </td>

                            <td className="py-2.5 px-3">
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700">
                                {MATERIAL_CATEGORIES[mat.category]?.name || mat.category}
                              </span>
                            </td>

                            <td className="py-2.5 px-2 text-center font-mono text-slate-600">
                              {mat.unit}
                            </td>

                            {/* Base Price cell (with inline edit) */}
                            <td className="py-2.5 px-3 text-right">
                              {isEditingThis ? (
                                <div className="flex items-center justify-end gap-1">
                                  <input
                                    type="number"
                                    step="any"
                                    min="0"
                                    value={tempPrice}
                                    onChange={(e) => setTempPrice(e.target.value)}
                                    className="w-20 px-1.5 py-0.5 text-right font-mono font-bold text-xs border border-indigo-400 rounded focus:outline-none"
                                    autoFocus
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') handleSavePrice(mat.id);
                                      if (e.key === 'Escape') setEditingPriceId(null);
                                    }}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleSavePrice(mat.id)}
                                    className="p-1 bg-emerald-600 text-white rounded hover:bg-emerald-700"
                                  >
                                    <Check className="w-3 h-3" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditingPriceId(null)}
                                    className="p-1 bg-slate-200 text-slate-600 rounded hover:bg-slate-300"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </div>
                              ) : (
                                <div
                                  onClick={() => handleStartEditPrice(mat)}
                                  className="cursor-pointer group flex items-center justify-end gap-1"
                                  title="Натисніть для зміни закупівельної ціни"
                                >
                                  <span className="font-mono font-bold text-slate-800 group-hover:text-indigo-600">
                                    {mat.basePrice.toLocaleString('uk-UA', { minimumFractionDigits: 2 })} ₴
                                  </span>
                                  <span className="text-[10px] text-slate-400 opacity-0 group-hover:opacity-100">
                                    ✎
                                  </span>
                                </div>
                              )}
                            </td>

                            <td className="py-2.5 px-3 text-slate-500 text-[11px] truncate max-w-[140px]">
                              {mat.supplier || '—'}
                            </td>

                            <td className="py-2.5 px-2 text-center">
                              <button
                                type="button"
                                onClick={() => handleDeleteMaterial(mat.id)}
                                className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition cursor-pointer"
                                title="Видалити матеріал"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 2: WASTE FACTORS PER CATEGORY */}
          {activeTab === 'waste' && (
            <div className="space-y-4">
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-start gap-2">
                <HelpCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold">Коефіцієнт технологічного відходу (Scrap factor):</span>{' '}
                  автоматично додає необхідний запас матеріалу на розкрій, припуски на торцювання,
                  обрізки листів та технологічний бій. При внесенні креслярської кількості вартість
                  матеріалу перемножується на вказаний коефіцієнт.
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {(Object.keys(MATERIAL_CATEGORIES) as MaterialCategory[]).map((catKey) => {
                  const catInfo = MATERIAL_CATEGORIES[catKey];
                  const currentFactor = coefficients.wasteFactorsByCategory[catKey] || 1.10;
                  const currentPercent = Math.round((currentFactor - 1) * 100);
                  const isService = catKey === 'services';

                  return (
                    <div
                      key={catKey}
                      className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2.5"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-xs font-bold text-slate-900">{catInfo.name}</h4>
                          <p className="text-[11px] text-slate-500">{catInfo.description}</p>
                        </div>

                        <span
                          className={`px-2 py-0.5 rounded-lg text-xs font-mono font-bold ${
                            isService
                              ? 'bg-slate-200 text-slate-600'
                              : 'bg-amber-100 text-amber-900 border border-amber-300'
                          }`}
                        >
                          {isService ? '0%' : `+${currentPercent}% (${currentFactor.toFixed(2)}x)`}
                        </span>
                      </div>

                      {!isService ? (
                        <div className="space-y-1">
                          <input
                            type="range"
                            min="0"
                            max="35"
                            step="1"
                            value={currentPercent}
                            onChange={(e) =>
                              handleWasteFactorChange(catKey, parseInt(e.target.value, 10))
                            }
                            className="w-full accent-amber-600 h-1.5 bg-slate-200 rounded-lg cursor-pointer"
                          />
                          <div className="flex items-center justify-between text-[10px] text-slate-400">
                            <span>0% (без відходу)</span>
                            <span>15% (типовий)</span>
                            <span>35% (високий відхід)</span>
                          </div>
                        </div>
                      ) : (
                        <div className="text-[11px] text-slate-400 italic">
                          Для погодинних та штучних робіт коефіцієнт відходу зафіксовано на 1.0 (0%)
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 3: GLOBAL COEFFICIENTS (COMPLEXITY, MARGIN, OVERHEAD) */}
          {activeTab === 'coefficients' && (
            <div className="space-y-5 max-w-2xl mx-auto py-2">
              {/* Complexity */}
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">
                      Базовий коефіцієнт складності виробництва/збірки
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      Враховує трудовитрати на радіуси, стикування матеріалів різної природи, точність
                    </p>
                  </div>
                  <span className="font-mono font-bold text-blue-700 bg-blue-100 px-2 py-0.5 rounded text-xs">
                    {coefficients.complexityMultiplier.toFixed(2)}x
                  </span>
                </div>

                <div className="grid grid-cols-4 gap-2 text-center text-xs">
                  {[
                    { val: 1.0, title: 'Базова (1.00x)', desc: 'Прямолінійні' },
                    { val: 1.15, title: 'Стандарт (1.15x)', desc: 'Точні зазори' },
                    { val: 1.3, title: 'Складна (1.30x)', desc: 'Радіуси, скло' },
                    { val: 1.5, title: 'Ексклюзив (1.50x)', desc: 'Індивідуальні' },
                  ].map((lvl) => (
                    <button
                      key={lvl.val}
                      type="button"
                      onClick={() => {
                        const updated = { ...coefficients, complexityMultiplier: lvl.val };
                        onCoefficientsChange(updated);
                        CalculatorStorageService.saveCoefficients(updated);
                      }}
                      className={`p-2 rounded-xl border transition cursor-pointer text-left ${
                        coefficients.complexityMultiplier === lvl.val
                          ? 'border-blue-600 bg-blue-50 text-blue-900 font-bold'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <div className="font-semibold text-[11px]">{lvl.title}</div>
                      <div className="text-[10px] text-slate-400">{lvl.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Profit Margin */}
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">
                      Планова маржинальність (% прибутку)
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      Розраховується як частка прибутку у фінальній ціні для замовника
                    </p>
                  </div>
                  <span className="font-mono font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded text-xs">
                    {coefficients.marginPercent}%
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {[20, 25, 30, 35, 40, 45, 50].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        const updated = { ...coefficients, marginPercent: m };
                        onCoefficientsChange(updated);
                        CalculatorStorageService.saveCoefficients(updated);
                      }}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer border ${
                        coefficients.marginPercent === m
                          ? 'border-emerald-600 bg-emerald-600 text-white shadow-2xs'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {m}%
                    </button>
                  ))}
                </div>
              </div>

              {/* Overhead */}
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">
                      Загальновиробничі накладні витрати цеху (%)
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      Амортизація обладнання, електроенергія, оренда, витратні інструменти
                    </p>
                  </div>
                  <span className="font-mono font-bold text-slate-700 bg-slate-200 px-2 py-0.5 rounded text-xs">
                    {coefficients.overheadPercent}%
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {[0, 3, 5, 8, 10, 15].map((o) => (
                    <button
                      key={o}
                      type="button"
                      onClick={() => {
                        const updated = { ...coefficients, overheadPercent: o };
                        onCoefficientsChange(updated);
                        CalculatorStorageService.saveCoefficients(updated);
                      }}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer border ${
                        coefficients.overheadPercent === o
                          ? 'border-slate-700 bg-slate-800 text-white shadow-2xs'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {o}%
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition shadow-xs cursor-pointer"
          >
            Готово
          </button>
        </div>
      </div>
    </div>
  );
};
