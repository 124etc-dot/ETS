import React, { useState } from 'react';
import {
  Layers,
  Plus,
  Trash2,
  Copy,
  Sparkles,
  Info,
  Box,
  CornerDownRight,
  MoveDown,
  Edit2,
} from 'lucide-react';
import {
  ConstructiveItem,
  MaterialItem,
  CalculatorCoefficients,
  MATERIAL_CATEGORIES,
} from '../../../types/calculator';
import { CalculatorStorageService } from '../../../services/calculatorStorage';
import { GlassCalculatorModal } from '../GlassCalculatorModal';

// Helper to format clean numeric string without floating-point tails like 1.0000000000001
const cleanNumber = (val: number | string, decimals: number = 4): string => {
  const n = typeof val === 'string' ? parseFloat(val) : val;
  if (isNaN(n) || n === 0) return '0';
  const rounded = parseFloat(n.toFixed(decimals));
  return String(rounded);
};

interface Props {
  activeUnitName: string;
  items: ConstructiveItem[];
  coefficients: CalculatorCoefficients;
  materials?: MaterialItem[];
  onAddItem: (item: ConstructiveItem) => void;
  onUpdateItem: (item: ConstructiveItem) => void;
  onDeleteItem: (id: string) => void;
  onDuplicateItem: (item: ConstructiveItem) => void;
  onDropMaterial: (material: MaterialItem) => void;
}

export const BomEditorWindow: React.FC<Props> = ({
  activeUnitName,
  items,
  coefficients,
  materials = [],
  onAddItem,
  onUpdateItem,
  onDeleteItem,
  onDuplicateItem,
  onDropMaterial,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isAddingCustom, setIsAddingCustom] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customQty, setCustomQty] = useState('1');
  const [customPrice, setCustomPrice] = useState('100');

  // Glass & Mirror Calculator Modal State
  const [isGlassModalOpen, setIsGlassModalOpen] = useState(false);
  const [editingGlassItem, setEditingGlassItem] = useState<ConstructiveItem | null>(null);
  const [preSelectedGlassMaterial, setPreSelectedGlassMaterial] = useState<MaterialItem | null>(null);

  const handleOpenGlassModal = (
    item?: ConstructiveItem | null,
    mat?: MaterialItem | null
  ) => {
    setEditingGlassItem(item || null);
    setPreSelectedGlassMaterial(mat || null);
    setIsGlassModalOpen(true);
  };

  const handleSaveGlassItem = (
    glassItem: ConstructiveItem,
    serviceItem?: ConstructiveItem | null
  ) => {
    const existingGlass = items.find((i) => i.id === glassItem.id);
    if (existingGlass) {
      onUpdateItem(glassItem);
    } else {
      onAddItem(glassItem);
    }

    if (serviceItem) {
      const existingService = items.find(
        (i) => i.id === serviceItem.id || i.linkedGlassItemId === glassItem.id
      );
      if (existingService) {
        onUpdateItem(serviceItem);
      } else {
        onAddItem(serviceItem);
      }
    } else {
      // Remove any previously linked service row if switched to combined mode
      const orphanService = items.find(
        (i) =>
          i.linkedGlassItemId === glassItem.id ||
          (glassItem.glassParams?.linkedServiceItemId &&
            i.id === glassItem.glassParams.linkedServiceItemId)
      );
      if (orphanService) {
        onDeleteItem(orphanService.id);
      }
    }
  };

  // Safe delete handling linked service items
  const handleDeleteItem = (id: string) => {
    const target = items.find((i) => i.id === id);
    if (target?.glassParams?.linkedServiceItemId) {
      onDeleteItem(target.glassParams.linkedServiceItemId);
    }
    const linkedService = items.find((i) => i.linkedGlassItemId === id);
    if (linkedService && linkedService.id !== id) {
      onDeleteItem(linkedService.id);
    }
    onDeleteItem(id);
  };

  // Drag-and-Drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!isDragOver) setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    try {
      const raw = e.dataTransfer.getData('application/json');
      if (raw) {
        const mat = JSON.parse(raw) as MaterialItem;
        if (mat && mat.id && mat.name) {
          if (mat.category === 'glass_mirror') {
            handleOpenGlassModal(null, mat);
          } else {
            onDropMaterial(mat);
          }
        }
      }
    } catch (err) {
      console.error('Failed to parse dropped material', err);
    }
  };

  const handleCreateCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customName.trim()) return;

    const q = Math.max(0.0001, parseFloat(customQty) || 1);
    const p = Math.max(0, parseFloat(customPrice) || 0);
    const c = coefficients.complexityMultiplier || 1.15;
    const w = 1.10;

    const raw: Omit<ConstructiveItem, 'effectiveQuantity' | 'materialCost' | 'totalCost' | 'clientPrice'> = {
      id: `custom_${Date.now()}`,
      constructive: customName.trim(),
      materialId: 'custom_mat',
      materialName: 'Спеціальна позиція',
      category: 'hardware',
      unit: 'шт',
      quantity: q,
      basePrice: p,
      wasteFactor: w,
      complexityFactor: c,
      notes: 'Додано вручну',
    };

    const newItem = CalculatorStorageService.recalculateItem(
      raw,
      c,
      coefficients.marginPercent
    );

    onAddItem(newItem);
    setCustomName('');
    setCustomQty('1');
    setCustomPrice('100');
    setIsAddingCustom(false);
  };

  // Generic handler for inline editing of row parameters with recalculation
  const handleFieldChange = (
    item: ConstructiveItem,
    field: 'constructive' | 'quantity' | 'wasteFactor' | 'complexityFactor' | 'basePrice',
    val: string
  ) => {
    if (field === 'constructive') {
      onUpdateItem({ ...item, constructive: val });
      return;
    }

    const num = parseFloat(val);
    const updatedRaw: Omit<ConstructiveItem, 'effectiveQuantity' | 'materialCost' | 'totalCost' | 'clientPrice'> = {
      ...item,
      quantity: field === 'quantity' ? (isNaN(num) ? 0 : num) : item.quantity,
      wasteFactor:
        field === 'wasteFactor'
          ? item.category === 'services'
            ? 1.0
            : isNaN(num)
            ? 1.0
            : num
          : item.wasteFactor,
      complexityFactor:
        field === 'complexityFactor' ? (isNaN(num) ? 1.0 : num) : item.complexityFactor,
      basePrice: field === 'basePrice' ? (isNaN(num) ? 0 : num) : item.basePrice,
    };

    const recalculated = CalculatorStorageService.recalculateItem(
      updatedRaw,
      updatedRaw.complexityFactor,
      coefficients.marginPercent
    );
    onUpdateItem(recalculated);
  };

  // Subtotal for this specific assembly
  const unitPrimeCost = items.reduce((acc, i) => acc + (i.totalCost || 0), 0);
  const unitClientPrice = items.reduce((acc, i) => acc + (i.clientPrice || 0), 0);

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`bg-white rounded-2xl border transition-all duration-200 shadow-xs flex flex-col h-full min-h-[460px] overflow-hidden ${
        isDragOver
          ? 'border-indigo-500 ring-2 ring-indigo-500/20 bg-indigo-50/20'
          : 'border-slate-200/90'
      }`}
    >
      {/* Window Header */}
      <div className="px-4 py-3 border-b border-slate-200/90 bg-slate-50/70 flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-2xs">
            01
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-bold text-slate-900 tracking-tight">
                Конструктор елемента (BOM Editor)
              </h2>
              <span className="text-[11px] text-slate-400">·</span>
              <span className="text-xs font-semibold text-indigo-700 truncate max-w-[200px]" title={activeUnitName}>
                {activeUnitName}
              </span>
            </div>
            <p className="text-[10px] text-slate-500">
              Специфікація деталей поточного виробу. Перетягуйте сюди матеріали з Каталогу
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] font-mono font-bold text-slate-600 bg-white px-2 py-0.5 rounded-md border border-slate-200">
            {items.length} поз.
          </span>

          {/* Quick Glass / Mirror Calculator button */}
          <button
            type="button"
            onClick={() => handleOpenGlassModal(null)}
            className="px-2.5 py-1 text-xs font-semibold text-cyan-800 bg-cyan-50 hover:bg-cyan-100 rounded-lg border border-cyan-200/90 transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
            title="Калькулятор скляних елементів (Площа заготовки + Обробка периметра)"
          >
            <Sparkles className="w-3.5 h-3.5 text-cyan-600" />
            <span className="font-bold">Скло / Дзеркало</span>
          </button>

          <button
            type="button"
            onClick={() => setIsAddingCustom(!isAddingCustom)}
            className="px-2.5 py-1 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg border border-indigo-200/80 transition flex items-center gap-1 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Вручну</span>
          </button>
        </div>
      </div>

      {/* Manual Quick Add Sub-bar */}
      {isAddingCustom && (
        <form
          onSubmit={handleCreateCustom}
          className="p-3 bg-indigo-50/60 border-b border-indigo-100 grid grid-cols-1 sm:grid-cols-4 gap-2 text-xs animate-in fade-in"
        >
          <div className="sm:col-span-2">
            <input
              type="text"
              required
              placeholder="Назва конструктивної деталі..."
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <div>
            <input
              type="number"
              step="any"
              min="0"
              placeholder="К-сть (шт)"
              value={customQty}
              onChange={(e) => setCustomQty(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-mono font-bold focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              step="any"
              min="0"
              placeholder="Ціна (₴)"
              value={customPrice}
              onChange={(e) => setCustomPrice(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-mono font-bold focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <button
              type="submit"
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg text-xs shrink-0 cursor-pointer"
            >
              +
            </button>
          </div>
        </form>
      )}

      {/* Drop Zone Visual Alert during drag */}
      {isDragOver && (
        <div className="m-3 p-6 border-2 border-dashed border-indigo-500 bg-indigo-50/80 rounded-xl flex flex-col items-center justify-center text-center animate-pulse">
          <MoveDown className="w-8 h-8 text-indigo-600 mb-1" />
          <span className="text-xs font-bold text-indigo-900">
            Відпустіть матеріал або послугу сюди
          </span>
          <span className="text-[11px] text-indigo-600">
            Позиція автоматично додасться у специфікацію виробу «{activeUnitName}»
          </span>
        </div>
      )}

      {/* Main Table Content */}
      <div className="flex-1 overflow-auto">
        {items.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center p-8 text-center text-slate-400">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 mb-3 border border-slate-200">
              <Box className="w-6 h-6" />
            </div>
            <h4 className="text-xs font-bold text-slate-700 mb-1">
              Специфікація виробу поки що порожня
            </h4>
            <p className="text-[11px] text-slate-400 max-w-sm mb-3">
              Перетягніть необхідний матеріал чи роботу з <b>Вікна 2 (Каталог)</b> або натисніть <b>«+»</b> на картці матеріалу
            </p>
            <span className="text-[10px] text-indigo-600 font-semibold bg-indigo-50 px-2.5 py-1 rounded-md border border-indigo-100">
              Підтримується Drag-and-Drop
            </span>
          </div>
        ) : (
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50/90 border-b border-slate-200/90 text-[10px] font-bold text-slate-500 uppercase tracking-wider sticky top-0 z-10">
                <th className="py-2 px-2 text-center w-8">#</th>
                <th className="py-2 px-2.5 min-w-[140px]">Конструктив / Елемент</th>
                <th className="py-2 px-2 min-w-[120px]">Матеріал / Категорія</th>
                <th className="py-2 px-2 text-right w-24">Кількість</th>
                <th className="py-2 px-1 text-center w-14" title="Коефіцієнт відходу">Відхід</th>
                <th className="py-2 px-1 text-center w-14" title="Коефіцієнт складності">Складн.</th>
                <th className="py-2 px-2 text-right w-20">Закуп.</th>
                <th className="py-2 px-2 text-right w-20">Собіварт.</th>
                <th className="py-2 px-2.5 text-right w-24 font-bold text-slate-700">Клієнт (₴)</th>
                <th className="py-2 px-1.5 text-center w-16">Дії</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item, idx) => {
                const isService = item.category === 'services';
                const wastePct = Math.round((item.wasteFactor - 1) * 100);

                return (
                  <tr
                    key={item.id}
                    className="hover:bg-slate-50/80 transition-colors group"
                  >
                    {/* Index */}
                    <td className="py-2 px-2 text-center font-mono text-slate-400 text-[11px]">
                      {idx + 1}
                    </td>

                    {/* Constructive Name input */}
                    <td className="py-1.5 px-2.5">
                      <input
                        type="text"
                        value={item.constructive}
                        onChange={(e) =>
                          onUpdateItem({
                            ...item,
                            constructive: e.target.value,
                          })
                        }
                        className="w-full px-1.5 py-0.5 border border-transparent hover:border-slate-300 focus:border-indigo-400 rounded font-semibold text-slate-900 text-xs focus:outline-none bg-transparent"
                      />

                      {/* Glass & Mirror Details Badge */}
                      {(item.category === 'glass_mirror' || item.isGlassItem) && (
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          <button
                            type="button"
                            onClick={() => handleOpenGlassModal(item)}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-cyan-50 hover:bg-cyan-100 text-cyan-800 border border-cyan-200/80 transition cursor-pointer"
                            title="Відкрити калькулятор скла (Ш×В мм, площа, периметр, кромка)"
                          >
                            <Sparkles className="w-3 h-3 text-cyan-600 shrink-0" />
                            {item.glassParams ? (
                              <span>
                                {item.glassParams.widthMm}×{item.glassParams.heightMm} мм ({item.glassParams.piecesCount} шт) · S={item.glassParams.areaSqm} м² · P={item.glassParams.perimeterM} м.п. ({item.glassParams.edgeProcessingName})
                              </span>
                            ) : (
                              <span>Калькулятор скла (Ш×В мм, кромка)</span>
                            )}
                          </button>
                        </div>
                      )}

                      {/* Linked Edge Service Badge */}
                      {item.isGlassLinkedService && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-50 text-indigo-700 border border-indigo-200/60">
                            <CornerDownRight className="w-2.5 h-2.5 text-indigo-500" />
                            <span>Послуга обробки кромки скла ({item.quantity} м.п.)</span>
                          </span>
                        </div>
                      )}
                    </td>

                    {/* Material & category */}
                    <td className="py-1.5 px-2">
                      <div className="truncate max-w-[130px]" title={item.materialName}>
                        <span className="font-medium text-slate-700 text-xs block truncate">
                          {item.materialName}
                        </span>
                        <span className="text-[10px] text-slate-400 font-sans block truncate">
                          {MATERIAL_CATEGORIES[item.category]?.name.split(' ')[0] || item.category}
                        </span>
                      </div>
                    </td>

                    {/* Quantity with step=any */}
                    <td className="py-1.5 px-2 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1">
                        <input
                          type="number"
                          step="any"
                          min="0"
                          value={item.quantity}
                          onChange={(e) => handleFieldChange(item, 'quantity', e.target.value)}
                          className="w-16 px-1.5 py-0.5 text-right font-mono font-bold text-xs border border-slate-200 rounded focus:border-indigo-400 focus:outline-none"
                          title="Кількість за кресленнями (підтримує дробові числа)"
                        />
                        <span className="text-[10px] text-slate-400 font-sans w-5 text-left">{item.unit}</span>
                      </div>
                    </td>

                    {/* Waste Factor */}
                    <td className="py-1.5 px-1 text-center whitespace-nowrap">
                      {isService ? (
                        <span className="text-[10px] text-slate-300 font-mono">—</span>
                      ) : (
                        <div className="inline-flex items-center gap-0.5">
                          <input
                            type="number"
                            step="any"
                            min="1.0"
                            value={item.wasteFactor}
                            onChange={(e) => handleFieldChange(item, 'wasteFactor', e.target.value)}
                            className="w-14 px-1 py-0.5 text-center font-mono font-semibold text-[11px] text-amber-800 bg-amber-50/70 border border-amber-200/80 rounded focus:border-indigo-400 focus:outline-none"
                            title={`Коефіцієнт відходу: ${item.wasteFactor} (+${wastePct}%)`}
                          />
                        </div>
                      )}
                    </td>

                    {/* Complexity factor */}
                    <td className="py-1.5 px-1 text-center whitespace-nowrap">
                      <input
                        type="number"
                        step="any"
                        min="1.0"
                        value={item.complexityFactor}
                        onChange={(e) => handleFieldChange(item, 'complexityFactor', e.target.value)}
                        className="w-14 px-1 py-0.5 text-center font-mono font-semibold text-[11px] text-blue-700 bg-blue-50/60 border border-blue-200/80 rounded focus:border-indigo-400 focus:outline-none"
                        title="Коефіцієнт складності виготовлення"
                      />
                    </td>

                    {/* Base price (Закупівельна ціна) */}
                    <td className="py-1.5 px-2 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-0.5">
                        <input
                          type="number"
                          step="any"
                          min="0"
                          value={item.basePrice}
                          onChange={(e) => handleFieldChange(item, 'basePrice', e.target.value)}
                          className="w-16 px-1.5 py-0.5 text-right font-mono font-medium text-[11px] text-slate-800 border border-slate-200 rounded focus:border-indigo-400 focus:outline-none"
                          title="Закупівельна ціна за одиницю"
                        />
                        <span className="text-[10px] text-slate-400">₴</span>
                      </div>
                    </td>

                    {/* Total cost (Собівартість) */}
                    <td className="py-1.5 px-2 text-right font-mono font-semibold text-slate-700 whitespace-nowrap text-[11px]">
                      {item.totalCost.toLocaleString('uk-UA', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ₴
                    </td>

                    {/* Client price (Підсумкова ціна для клієнта) */}
                    <td className="py-1.5 px-2.5 text-right font-mono font-extrabold text-emerald-700 whitespace-nowrap text-xs bg-emerald-50/30">
                      {item.clientPrice.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₴
                    </td>

                    {/* Row actions */}
                    <td className="py-1.5 px-1.5 text-center whitespace-nowrap">
                      <div className="flex items-center justify-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                        {(item.category === 'glass_mirror' || item.isGlassItem) && (
                          <button
                            type="button"
                            onClick={() => handleOpenGlassModal(item)}
                            className="p-1 text-cyan-600 hover:text-cyan-800 rounded transition cursor-pointer"
                            title="Відкрити калькулятор скла (Ш×В мм, кромка)"
                          >
                            <Sparkles className="w-3 h-3" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onDuplicateItem(item)}
                          className="p-1 text-slate-400 hover:text-indigo-600 rounded transition cursor-pointer"
                          title="Дублювати деталь"
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteItem(item.id)}
                          className="p-1 text-slate-400 hover:text-rose-600 rounded transition cursor-pointer"
                          title="Видалити"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Window Footer: Real-time Element Subtotal */}
      <div className="px-4 py-2.5 border-t border-slate-200/90 bg-slate-50/70 flex items-center justify-between gap-3 text-xs shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-slate-500">
            Собівартість елемента:
          </span>
          <span className="font-mono font-bold text-slate-900">
            {unitPrimeCost.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₴
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-slate-500">Ціна виробу для клієнта:</span>
          <span className="font-mono font-extrabold text-sm text-emerald-700 bg-white px-2.5 py-0.5 rounded-lg border border-emerald-200 shadow-2xs">
            {unitClientPrice.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₴
          </span>
        </div>
      </div>

      {/* Glass & Mirror Calculator Modal */}
      <GlassCalculatorModal
        isOpen={isGlassModalOpen}
        onClose={() => setIsGlassModalOpen(false)}
        materials={materials}
        coefficients={coefficients}
        initialItem={editingGlassItem}
        preSelectedMaterial={preSelectedGlassMaterial}
        onSaveGlassItem={handleSaveGlassItem}
      />
    </div>
  );
};
