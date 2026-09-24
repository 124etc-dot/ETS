import React, { useState, useMemo } from 'react';
import {
  Plus,
  Search,
  Sparkles,
  Layers,
  ChevronDown,
  Info,
} from 'lucide-react';
import {
  MaterialCategory,
  MaterialItem,
  ConstructiveItem,
  CalculatorCoefficients,
  MATERIAL_CATEGORIES,
} from '../../types/calculator';
import { CalculatorStorageService } from '../../services/calculatorStorage';

interface Props {
  materials: MaterialItem[];
  coefficients: CalculatorCoefficients;
  onAddItem: (item: ConstructiveItem) => void;
  onOpenMasterData: () => void;
}

const CONSTRUCTIVE_SUGGESTIONS = [
  'Опорний металокаркас',
  'Внутрішні перемички та ребра жорсткості',
  'Фасадні панелі МДФ',
  'Полиці вкладні з кромкуванням',
  'Скляні полиці / екран вітрини',
  'Задня стінка дзеркальна',
  'Фурнітура висувна та петлі',
  'Порошкове фарбування металоконструкції',
  'Контурне підсвічування LED COB',
  'Зварювальні слюсарні роботи',
  'Контрольне складання в цеху',
  'Монтажні роботи на обʼєкті',
];

export const ConstructiveItemForm: React.FC<Props> = ({
  materials,
  coefficients,
  onAddItem,
  onOpenMasterData,
}) => {
  const [constructive, setConstructive] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<MaterialCategory | 'all'>('all');
  const [selectedMaterialId, setSelectedMaterialId] = useState<string>(materials[0]?.id || '');
  const [materialSearch, setMaterialSearch] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  const [quantity, setQuantity] = useState('1');
  const [customPrice, setCustomPrice] = useState<string>('');
  const [customWasteFactor, setCustomWasteFactor] = useState<string>('');
  const [complexityFactor, setComplexityFactor] = useState<string>(
    coefficients.complexityMultiplier.toString()
  );
  const [notes, setNotes] = useState('');

  // Selected material item
  const selectedMaterial = useMemo(() => {
    return materials.find((m) => m.id === selectedMaterialId) || materials[0];
  }, [materials, selectedMaterialId]);

  // Filtered materials by search & category
  const filteredMaterials = useMemo(() => {
    return materials.filter((m) => {
      const matchCat = selectedCategory === 'all' || m.category === selectedCategory;
      const matchSearch =
        !materialSearch ||
        m.name.toLowerCase().includes(materialSearch.toLowerCase()) ||
        m.supplier?.toLowerCase().includes(materialSearch.toLowerCase());
      return matchCat && matchSearch;
    });
  }, [materials, selectedCategory, materialSearch]);

  // Current active values
  const activeBasePrice = customPrice !== ''
    ? parseFloat(customPrice) || 0
    : selectedMaterial?.basePrice || 0;

  const defaultCategoryWaste = selectedMaterial
    ? coefficients.wasteFactorsByCategory[selectedMaterial.category] || selectedMaterial.defaultWasteFactor || 1.10
    : 1.10;

  const isService = selectedMaterial?.category === 'services';

  const activeWasteFactor = isService
    ? 1.0
    : customWasteFactor !== ''
    ? parseFloat(customWasteFactor) || 1.0
    : defaultCategoryWaste;

  const activeComplexity = parseFloat(complexityFactor) || coefficients.complexityMultiplier || 1.15;
  const numQty = Math.max(0, parseFloat(quantity) || 0);

  // Live item preview calculations
  const previewItem = useMemo(() => {
    if (!selectedMaterial) return null;
    const raw: Omit<ConstructiveItem, 'effectiveQuantity' | 'materialCost' | 'totalCost' | 'clientPrice'> = {
      id: 'preview',
      constructive: constructive.trim() || 'Елемент',
      materialId: selectedMaterial.id,
      materialName: selectedMaterial.name,
      category: selectedMaterial.category,
      unit: selectedMaterial.unit,
      quantity: numQty,
      basePrice: activeBasePrice,
      wasteFactor: activeWasteFactor,
      complexityFactor: activeComplexity,
      notes: notes.trim(),
    };
    return CalculatorStorageService.recalculateItem(
      raw,
      coefficients.complexityMultiplier,
      coefficients.marginPercent
    );
  }, [
    selectedMaterial,
    constructive,
    numQty,
    activeBasePrice,
    activeWasteFactor,
    activeComplexity,
    notes,
    coefficients,
  ]);

  const handleSelectMaterial = (mat: MaterialItem) => {
    setSelectedMaterialId(mat.id);
    setCustomPrice(mat.basePrice.toString());
    const waste = coefficients.wasteFactorsByCategory[mat.category] || mat.defaultWasteFactor;
    setCustomWasteFactor(mat.category === 'services' ? '1.0' : waste.toString());
    setIsSearchOpen(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMaterial) return;

    const itemConstructive = constructive.trim() || selectedMaterial.name;
    const itemData: Omit<ConstructiveItem, 'effectiveQuantity' | 'materialCost' | 'totalCost' | 'clientPrice'> = {
      id: `item_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      constructive: itemConstructive,
      materialId: selectedMaterial.id,
      materialName: selectedMaterial.name,
      category: selectedMaterial.category,
      unit: selectedMaterial.unit,
      quantity: numQty > 0 ? numQty : 1,
      basePrice: activeBasePrice,
      wasteFactor: activeWasteFactor,
      complexityFactor: activeComplexity,
      notes: notes.trim(),
    };

    const calculated = CalculatorStorageService.recalculateItem(
      itemData,
      coefficients.complexityMultiplier,
      coefficients.marginPercent
    );

    onAddItem(calculated);

    // Reset some inputs for faster consecutive entries
    setConstructive('');
    setQuantity('1');
    setNotes('');
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-4 sm:p-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 mb-4 border-b border-slate-200/80">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-indigo-100 border border-indigo-200 flex items-center justify-center text-indigo-700">
            <Plus className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">Додати конструктивний елемент до замовлення</h3>
            <p className="text-[11px] text-slate-500">
              Виберіть матеріал із довідника та вкажіть параметри за кресленнями
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onOpenMasterData}
          className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-1 self-start sm:self-auto cursor-pointer"
        >
          <Layers className="w-3.5 h-3.5" />
          <span>Налаштувати довідник матеріалів</span>
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Row 1: Constructive Name & Quick Suggestions */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <span>Конструктивний вузол / Елемент</span>
              <span className="text-rose-500">*</span>
            </label>
            <span className="text-[10px] text-slate-400">назва деталі з креслення</span>
          </div>

          <input
            type="text"
            value={constructive}
            onChange={(e) => setConstructive(e.target.value)}
            placeholder="напр. Опорний металокаркас, або виберіть підказку нижче"
            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-semibold text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />

          {/* Quick Suggestions Chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1.5 mt-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider shrink-0 mr-1 flex items-center gap-0.5">
              <Sparkles className="w-3 h-3 text-amber-500" />
              Швидко:
            </span>
            {CONSTRUCTIVE_SUGGESTIONS.slice(0, 6).map((sug, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setConstructive(sug)}
                className="px-2 py-0.5 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-slate-600 rounded-md text-[11px] font-medium transition shrink-0 border border-slate-200/70 cursor-pointer"
              >
                {sug}
              </button>
            ))}
          </div>
        </div>

        {/* Row 2: Material Picker with Search & Categories */}
        <div className="p-3.5 rounded-xl bg-slate-50/80 border border-slate-200 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-indigo-600" />
              <span>Матеріал або послуга з довідника</span>
              <span className="text-rose-500">*</span>
            </label>

            {/* Category filter pills */}
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-1 sm:pb-0">
              <button
                type="button"
                onClick={() => setSelectedCategory('all')}
                className={`px-2 py-0.5 rounded text-[11px] font-semibold transition shrink-0 cursor-pointer ${
                  selectedCategory === 'all'
                    ? 'bg-indigo-600 text-white shadow-2xs'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                }`}
              >
                Всі ({materials.length})
              </button>
              {(Object.keys(MATERIAL_CATEGORIES) as MaterialCategory[]).map((catKey) => {
                const info = MATERIAL_CATEGORIES[catKey];
                const count = materials.filter((m) => m.category === catKey).length;
                return (
                  <button
                    key={catKey}
                    type="button"
                    onClick={() => setSelectedCategory(catKey)}
                    className={`px-2 py-0.5 rounded text-[11px] font-semibold transition shrink-0 cursor-pointer ${
                      selectedCategory === catKey
                        ? 'bg-indigo-600 text-white shadow-2xs'
                        : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {info.name.split(' ')[0]} ({count})
                  </button>
                );
              })}
            </div>
          </div>

          {/* Searchable Dropdown Button */}
          <div className="relative">
            <div
              onClick={() => setIsSearchOpen(!isSearchOpen)}
              className="w-full flex items-center justify-between px-3 py-2 bg-white border border-slate-300 rounded-xl cursor-pointer hover:border-indigo-400 transition shadow-2xs"
            >
              <div className="flex items-center gap-2 truncate">
                <span className="w-2 h-2 rounded-full bg-indigo-600 shrink-0"></span>
                <span className="font-semibold text-xs text-slate-900 truncate">
                  {selectedMaterial?.name || 'Оберіть матеріал...'}
                </span>
                <span className="text-[11px] text-slate-400 font-mono">
                  ({selectedMaterial?.basePrice.toLocaleString('uk-UA')} ₴ / {selectedMaterial?.unit})
                </span>
              </div>
              <ChevronDown className="w-4 h-4 text-slate-400 shrink-0 ml-2" />
            </div>

            {/* Dropdown Menu */}
            {isSearchOpen && (
              <div className="absolute left-0 right-0 top-full mt-1.5 z-40 bg-white border border-slate-200 rounded-xl shadow-xl max-h-64 overflow-hidden flex flex-col animate-in fade-in zoom-in-95">
                <div className="p-2 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
                  <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <input
                    type="text"
                    value={materialSearch}
                    onChange={(e) => setMaterialSearch(e.target.value)}
                    placeholder="Пошук матеріалу за назвою або постачальником..."
                    className="w-full bg-transparent text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none"
                    autoFocus
                  />
                  {materialSearch && (
                    <button
                      type="button"
                      onClick={() => setMaterialSearch('')}
                      className="text-slate-400 hover:text-slate-600 text-xs px-1"
                    >
                      ×
                    </button>
                  )}
                </div>

                <div className="overflow-y-auto max-h-52 p-1 divide-y divide-slate-100">
                  {filteredMaterials.length === 0 ? (
                    <div className="py-4 text-center text-xs text-slate-400">
                      Матеріалів не знайдено за вашим запитом
                    </div>
                  ) : (
                    filteredMaterials.map((mat) => (
                      <div
                        key={mat.id}
                        onClick={() => handleSelectMaterial(mat)}
                        className={`p-2 rounded-lg cursor-pointer flex items-center justify-between text-xs transition ${
                          selectedMaterialId === mat.id
                            ? 'bg-indigo-50/90 text-indigo-900 font-semibold'
                            : 'hover:bg-slate-50 text-slate-800'
                        }`}
                      >
                        <div className="truncate pr-2">
                          <div className="font-semibold truncate">{mat.name}</div>
                          <div className="text-[10px] text-slate-400 flex items-center gap-2">
                            <span>{MATERIAL_CATEGORIES[mat.category]?.name}</span>
                            {mat.supplier && <span>• {mat.supplier}</span>}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="font-mono font-bold text-slate-900">
                            {mat.basePrice.toLocaleString('uk-UA')} ₴
                          </span>
                          <span className="text-[10px] text-slate-500 ml-1">/ {mat.unit}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Row 3: Parameters Grid (Quantity, Base Price, Waste Factor, Complexity) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* Quantity */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Кількість ({selectedMaterial?.unit || 'од.'})
            </label>
            <input
              type="number"
              step="0.01"
              min="0.001"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-mono font-bold text-slate-900 focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Base Purchase Price */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-bold text-slate-700">Закупівельна ціна</label>
              <span className="text-[10px] text-slate-400 font-mono">грн</span>
            </div>
            <input
              type="number"
              step="1"
              min="0"
              value={customPrice !== '' ? customPrice : selectedMaterial?.basePrice || ''}
              onChange={(e) => setCustomPrice(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-mono font-bold text-slate-900 focus:ring-2 focus:ring-indigo-500"
              placeholder={selectedMaterial?.basePrice.toString()}
            />
          </div>

          {/* Waste Factor */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-bold text-slate-700 flex items-center gap-1">
                <span>Коеф. відходу</span>
              </label>
              <span className="text-[10px] font-mono text-amber-700 font-semibold">
                +{Math.round((activeWasteFactor - 1) * 100)}%
              </span>
            </div>
            <input
              type="number"
              step="0.01"
              min="1.0"
              max="3.0"
              disabled={isService}
              value={isService ? '1.00' : customWasteFactor !== '' ? customWasteFactor : defaultCategoryWaste.toString()}
              onChange={(e) => setCustomWasteFactor(e.target.value)}
              className={`w-full px-3 py-2 border rounded-xl text-xs font-mono font-bold focus:ring-2 focus:ring-indigo-500 ${
                isService
                  ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
                  : 'border-slate-300 text-slate-900 bg-white'
              }`}
              title={isService ? 'Для послуг та робіт коефіцієнт відходу не застосовується' : 'Коефіцієнт технологічного відходу (напр. 1.15 = +15%)'}
            />
          </div>

          {/* Complexity Multiplier */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-bold text-slate-700">Коеф. складності</label>
              <span className="text-[10px] font-mono text-blue-700 font-semibold">
                {activeComplexity.toFixed(2)}x
              </span>
            </div>
            <input
              type="number"
              step="0.05"
              min="1.0"
              max="3.0"
              value={complexityFactor}
              onChange={(e) => setComplexityFactor(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-mono font-bold text-slate-900 focus:ring-2 focus:ring-indigo-500"
              title="Коефіцієнт складності виробництва та монтажу (напр. 1.15)"
            />
          </div>
        </div>

        {/* Live Calculation Preview Banner */}
        {previewItem && (
          <div className="p-3 bg-gradient-to-r from-indigo-50/70 via-blue-50/50 to-emerald-50/70 rounded-xl border border-indigo-100 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              <span className="font-semibold text-slate-800">
                К-сть з відходом: <b className="font-mono text-indigo-700">{previewItem.effectiveQuantity} {previewItem.unit}</b>
              </span>
              <span className="text-slate-300">•</span>
              <span className="text-slate-600">
                Собівартість позиції: <b className="font-mono text-slate-900">{previewItem.totalCost.toLocaleString('uk-UA')} ₴</b>
              </span>
            </div>

            <div className="flex items-center gap-2 ml-auto">
              <span className="text-slate-600">Ціна для клієнта (з маржею {coefficients.marginPercent}%):</span>
              <span className="font-mono font-bold text-sm text-emerald-700 bg-white px-2 py-0.5 rounded-lg border border-emerald-200 shadow-2xs">
                {previewItem.clientPrice.toLocaleString('uk-UA')} ₴
              </span>
            </div>
          </div>
        )}

        {/* Notes input & Submit button */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Примітки до позиції (напр. фарбування RAL 9005 або крок 200 мм)..."
            className="flex-1 px-3 py-2 border border-slate-200 rounded-xl text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />

          <button
            type="submit"
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-xs transition flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Додати до специфікації</span>
          </button>
        </div>
      </form>
    </div>
  );
};
