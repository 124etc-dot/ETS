import React, { useState } from 'react';
import {
  Trash2,
  Copy,
  Edit2,
  Check,
  X,
  AlertCircle,
  HelpCircle,
} from 'lucide-react';
import { ConstructiveItem, MATERIAL_CATEGORIES } from '../../types/calculator';

interface Props {
  item: ConstructiveItem;
  index: number;
  onUpdate: (updated: ConstructiveItem) => void;
  onDelete: (id: string) => void;
  onDuplicate: (item: ConstructiveItem) => void;
}

// Helper to format clean numeric string without floating-point tails like 1.0000000000001
const cleanNumber = (val: number | string, decimals: number = 4): string => {
  const n = typeof val === 'string' ? parseFloat(val) : val;
  if (isNaN(n) || n === null || n === undefined) return '0';
  return parseFloat(Number(n).toFixed(decimals)).toString();
};

export const ConstructiveItemRow: React.FC<Props> = ({
  item,
  index,
  onUpdate,
  onDelete,
  onDuplicate,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [constructive, setConstructive] = useState(item.constructive);
  const [quantity, setQuantity] = useState(() => cleanNumber(item.quantity, 4));
  const [basePrice, setBasePrice] = useState(() => cleanNumber(item.basePrice, 2));
  const [wasteFactor, setWasteFactor] = useState(() => cleanNumber(item.wasteFactor, 3));
  const [complexityFactor, setComplexityFactor] = useState(() => cleanNumber(item.complexityFactor, 2));
  const [notes, setNotes] = useState(item.notes || '');

  const catInfo = MATERIAL_CATEGORIES[item.category];
  const isService = item.category === 'services';

  React.useEffect(() => {
    if (!isEditing) {
      setConstructive(item.constructive);
      setQuantity(cleanNumber(item.quantity, 4));
      setBasePrice(cleanNumber(item.basePrice, 2));
      setWasteFactor(cleanNumber(item.wasteFactor, 3));
      setComplexityFactor(cleanNumber(item.complexityFactor, 2));
      setNotes(item.notes || '');
    }
  }, [item, isEditing]);

  const handleSaveEdit = () => {
    const rawQ = parseFloat(quantity) || 0;
    const rawP = parseFloat(basePrice) || 0;
    const rawW = isService ? 1 : parseFloat(wasteFactor) || 1;
    const rawC = parseFloat(complexityFactor) || 1;

    // Use Math.round & toFixed to eliminate float tails from state
    const q = parseFloat((Math.round(Math.max(0, rawQ) * 10000) / 10000).toFixed(4));
    const p = parseFloat((Math.round(Math.max(0, rawP) * 100) / 100).toFixed(2));
    const w = isService ? 1 : parseFloat((Math.round(Math.max(1, rawW) * 1000) / 1000).toFixed(3));
    const c = parseFloat((Math.round(Math.max(1, rawC) * 100) / 100).toFixed(2));

    const effQty = isService ? q : parseFloat((Math.round(q * w * 10000) / 10000).toFixed(4));
    const matCost = parseFloat((Math.round(effQty * p * 100) / 100).toFixed(2));
    const totCost = parseFloat((Math.round(matCost * c * 100) / 100).toFixed(2));
    // Keep client price proportional
    const prevCost = item.totalCost || 1;
    const ratio = item.clientPrice > 0 ? item.clientPrice / prevCost : 1.35;
    const clientPr = parseFloat((Math.round(totCost * ratio * 100) / 100).toFixed(2));

    onUpdate({
      ...item,
      constructive: constructive.trim() || item.constructive,
      quantity: q,
      basePrice: p,
      wasteFactor: w,
      effectiveQuantity: effQty,
      materialCost: matCost,
      complexityFactor: c,
      totalCost: totCost,
      clientPrice: clientPr,
      notes: notes.trim(),
    });
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setConstructive(item.constructive);
    setQuantity(cleanNumber(item.quantity, 4));
    setBasePrice(cleanNumber(item.basePrice, 2));
    setWasteFactor(cleanNumber(item.wasteFactor, 3));
    setComplexityFactor(cleanNumber(item.complexityFactor, 2));
    setNotes(item.notes || '');
    setIsEditing(false);
  };

  const wastePercent = Math.round((item.wasteFactor - 1) * 100);

  return (
    <tr className={`border-b border-slate-200/80 hover:bg-slate-50/70 transition-colors text-xs ${
      isEditing ? 'bg-amber-50/40' : ''
    }`}>
      {/* Position # */}
      <td className="py-2.5 px-3 font-mono text-slate-400 font-semibold text-center w-10">
        {index + 1}
      </td>

      {/* Constructive Element Name */}
      <td className="py-2.5 px-3 min-w-[180px]">
        {isEditing ? (
          <input
            type="text"
            value={constructive}
            onChange={(e) => setConstructive(e.target.value)}
            className="w-full px-2 py-1 border border-slate-300 rounded font-medium text-slate-800 text-xs focus:ring-1 focus:ring-indigo-500"
            placeholder="Назва конструктиву"
          />
        ) : (
          <div>
            <span className="font-semibold text-slate-900 block leading-snug">{item.constructive}</span>
            {item.notes && (
              <span className="text-[11px] text-slate-400 line-clamp-1 italic">{item.notes}</span>
            )}
          </div>
        )}
      </td>

      {/* Material & Category */}
      <td className="py-2.5 px-3 min-w-[200px]">
        <div className="flex flex-col">
          <span className="font-medium text-slate-800 text-xs leading-snug">{item.materialName}</span>
          <span className="inline-flex items-center gap-1 text-[10px] text-slate-500 font-medium mt-0.5">
            <span className={`w-1.5 h-1.5 rounded-full ${isService ? 'bg-amber-500' : 'bg-indigo-500'}`}></span>
            {catInfo?.name || item.category}
          </span>
        </div>
      </td>

      {/* Drawing Quantity */}
      <td className="py-2.5 px-2 text-right whitespace-nowrap">
        {isEditing ? (
          <input
            type="number"
            step="any"
            min="0"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="w-16 px-1.5 py-1 text-right border border-slate-300 rounded font-mono text-xs focus:ring-1 focus:ring-indigo-500"
          />
        ) : (
          <span className="font-mono font-bold text-slate-800">
            {parseFloat(Number(item.quantity).toFixed(4))}
          </span>
        )}
        <span className="text-[11px] text-slate-400 ml-1 font-sans">{item.unit}</span>
      </td>

      {/* Base Price */}
      <td className="py-2.5 px-2 text-right whitespace-nowrap">
        {isEditing ? (
          <input
            type="number"
            step="any"
            min="0"
            value={basePrice}
            onChange={(e) => setBasePrice(e.target.value)}
            className="w-20 px-1.5 py-1 text-right border border-slate-300 rounded font-mono text-xs focus:ring-1 focus:ring-indigo-500"
          />
        ) : (
          <span className="font-mono text-slate-700">
            {item.basePrice.toLocaleString('uk-UA')} ₴
          </span>
        )}
      </td>

      {/* Waste Factor */}
      <td className="py-2.5 px-2 text-center whitespace-nowrap">
        {isEditing && !isService ? (
          <input
            type="number"
            step="any"
            min="1"
            max="3"
            value={wasteFactor}
            onChange={(e) => setWasteFactor(e.target.value)}
            className="w-14 px-1 py-1 text-center border border-slate-300 rounded font-mono text-xs"
            title="Коефіцієнт відходу (наприклад 1.15)"
          />
        ) : isService ? (
          <span className="text-[10px] text-slate-400 font-mono">—</span>
        ) : (
          <span
            className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-mono font-semibold ${
              wastePercent > 0
                ? 'bg-amber-50 text-amber-800 border border-amber-200'
                : 'bg-slate-100 text-slate-600'
            }`}
            title={`Технологічний відхід: +${wastePercent}% (к-сть з відходом: ${item.effectiveQuantity} ${item.unit})`}
          >
            +{wastePercent}%
          </span>
        )}
      </td>

      {/* Effective Quantity with Waste */}
      <td className="py-2.5 px-2 text-right font-mono text-slate-700 whitespace-nowrap">
        <span className="font-semibold">{parseFloat(Number(item.effectiveQuantity).toFixed(4))}</span>
        <span className="text-[10px] text-slate-400 ml-1">{item.unit}</span>
      </td>

      {/* Complexity Multiplier */}
      <td className="py-2.5 px-2 text-center whitespace-nowrap">
        {isEditing ? (
          <input
            type="number"
            step="any"
            min="1"
            max="3"
            value={complexityFactor}
            onChange={(e) => setComplexityFactor(e.target.value)}
            className="w-14 px-1 py-1 text-center border border-slate-300 rounded font-mono text-xs"
            title="Коефіцієнт складності виготовлення (наприклад 1.15)"
          />
        ) : (
          <span
            className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-mono font-semibold ${
              item.complexityFactor > 1
                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                : 'bg-slate-100 text-slate-600'
            }`}
            title={`Коефіцієнт складності виготовлення: ${item.complexityFactor}x`}
          >
            {item.complexityFactor.toFixed(2)}x
          </span>
        )}
      </td>

      {/* Total Production Cost (Собівартість) */}
      <td className="py-2.5 px-2 text-right font-mono font-semibold text-slate-800 whitespace-nowrap">
        {item.totalCost.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₴
      </td>

      {/* Client Price (Ціна для клієнта) */}
      <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-700 whitespace-nowrap bg-emerald-50/30">
        {item.clientPrice.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₴
      </td>

      {/* Actions */}
      <td className="py-2.5 px-2 text-center whitespace-nowrap w-24">
        {isEditing ? (
          <div className="flex items-center justify-center gap-1">
            <button
              type="button"
              onClick={handleSaveEdit}
              title="Зберегти"
              className="p-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white transition cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleCancelEdit}
              title="Скасувати"
              className="p-1 rounded bg-slate-200 hover:bg-slate-300 text-slate-700 transition cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-1 opacity-70 hover:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              title="Редагувати позицію"
              className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition cursor-pointer"
            >
              <Edit2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onDuplicate(item)}
              title="Дублювати позицію"
              className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onDelete(item.id)}
              title="Видалити"
              className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </td>
    </tr>
  );
};
