import React, { useState, useEffect, useMemo } from 'react';
import {
  Sparkles,
  X,
  Layers,
  Check,
  Info,
  Maximize2,
  Box,
  CornerDownRight,
  ArrowRight,
  Sliders,
  DollarSign,
  ShieldCheck,
  Scissors,
  HelpCircle,
} from 'lucide-react';
import {
  ConstructiveItem,
  MaterialItem,
  CalculatorCoefficients,
  GlassEdgeProcessingType,
  GlassProcessedSides,
  GlassItemParams,
} from '../../types/calculator';
import { GLASS_EDGE_PRESETS } from '../../data/calculatorDefaults';
import { CalculatorStorageService } from '../../services/calculatorStorage';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  materials: MaterialItem[];
  coefficients: CalculatorCoefficients;
  initialItem?: ConstructiveItem | null;
  preSelectedMaterial?: MaterialItem | null;
  onSaveGlassItem: (
    glassItem: ConstructiveItem,
    serviceItem?: ConstructiveItem | null
  ) => void;
}

const QUICK_DIMENSIONS = [
  { label: '400×300', w: 400, h: 300, desc: 'Компактна поличка' },
  { label: '600×400', w: 600, h: 400, desc: 'Стандартна вітринна полиця' },
  { label: '800×400', w: 800, h: 400, desc: 'Широка полиця шафи' },
  { label: '900×600', w: 900, h: 600, desc: 'Фасадні скляні двері' },
  { label: '1000×500', w: 1000, h: 500, desc: 'Оглядовий купол вітрини' },
  { label: '1200×600', w: 1200, h: 600, desc: 'Торгова перегородка' },
  { label: '1800×800', w: 1800, h: 800, desc: 'Пристінне дзеркало' },
  { label: '2000×900', w: 2000, h: 900, desc: 'Великогабаритний вітраж' },
];

const QUICK_SUGGESTIONS = [
  'Скляні полиці вітрини',
  'Скляний купол та стінки',
  'Скляні розсувні дверцята',
  'Дзеркальне пристінне панно',
  'Оглядовий захисний екран',
  'Скляна перегородка зональна',
];

export const GlassCalculatorModal: React.FC<Props> = ({
  isOpen,
  onClose,
  materials,
  coefficients,
  initialItem,
  preSelectedMaterial,
  onSaveGlassItem,
}) => {
  // Filter glass & mirror materials from catalog
  const glassMaterials = useMemo(() => {
    return materials.filter(
      (m) =>
        m.category === 'glass_mirror' ||
        m.subcategory === 'Скло' ||
        m.subcategory === 'Дзеркало' ||
        m.name.toLowerCase().includes('скло') ||
        m.name.toLowerCase().includes('дзеркал')
    );
  }, [materials]);

  // Form state
  const [selectedMaterialId, setSelectedMaterialId] = useState<string>('');
  const [constructive, setConstructive] = useState('Скляне наповнення / Полиця');
  const [widthMm, setWidthMm] = useState<string>('600');
  const [heightMm, setHeightMm] = useState<string>('400');
  const [piecesCount, setPiecesCount] = useState<string>('1');
  const [processedSides, setProcessedSides] = useState<GlassProcessedSides>('all_4');
  const [edgeProcessingType, setEdgeProcessingType] = useState<GlassEdgeProcessingType>('polishing');
  const [customEdgePrice, setCustomEdgePrice] = useState<string>('95');
  const [separateServiceRow, setSeparateServiceRow] = useState<boolean>(true);
  const [customGlassPrice, setCustomGlassPrice] = useState<string>('');
  const [wasteFactor, setWasteFactor] = useState<string>('1.12');
  const [complexityFactor, setComplexityFactor] = useState<string>(() =>
    String(coefficients.complexityMultiplier || 1.15)
  );
  const [notes, setNotes] = useState('');

  // Selected material
  const selectedMaterial = useMemo(() => {
    return (
      glassMaterials.find((m) => m.id === selectedMaterialId) ||
      materials.find((m) => m.id === selectedMaterialId) ||
      glassMaterials[0] ||
      materials[0]
    );
  }, [glassMaterials, materials, selectedMaterialId]);

  // Reset or populate on open
  useEffect(() => {
    if (!isOpen) return;

    if (initialItem && initialItem.glassParams) {
      const gp = initialItem.glassParams;
      setSelectedMaterialId(initialItem.materialId);
      setConstructive(initialItem.constructive);
      setWidthMm(String(gp.widthMm));
      setHeightMm(String(gp.heightMm));
      setPiecesCount(String(gp.piecesCount));
      setProcessedSides(gp.processedSides || 'all_4');
      setEdgeProcessingType(gp.edgeProcessingType);
      setCustomEdgePrice(String(gp.edgePricePerMeter));
      setSeparateServiceRow(gp.separateServiceRow !== false);
      setCustomGlassPrice(String(initialItem.basePrice));
      setWasteFactor(String(initialItem.wasteFactor || 1.12));
      setComplexityFactor(String(initialItem.complexityFactor || coefficients.complexityMultiplier || 1.15));
      setNotes(initialItem.notes || '');
    } else if (initialItem) {
      setSelectedMaterialId(initialItem.materialId);
      setConstructive(initialItem.constructive);
      setCustomGlassPrice(String(initialItem.basePrice));
      setWasteFactor(String(initialItem.wasteFactor || 1.12));
      setComplexityFactor(String(initialItem.complexityFactor || coefficients.complexityMultiplier || 1.15));
      setWidthMm('600');
      setHeightMm('400');
      setPiecesCount('1');
      setProcessedSides('all_4');
      setEdgeProcessingType('polishing');
      setCustomEdgePrice('95');
      setSeparateServiceRow(true);
      setNotes(initialItem.notes || '');
    } else if (preSelectedMaterial) {
      setSelectedMaterialId(preSelectedMaterial.id);
      setConstructive('Скляне наповнення / Полиця');
      setCustomGlassPrice(String(preSelectedMaterial.basePrice));
      setWasteFactor(String(preSelectedMaterial.defaultWasteFactor || 1.12));
      setComplexityFactor(String(coefficients.complexityMultiplier || 1.15));
      setWidthMm('600');
      setHeightMm('400');
      setPiecesCount('1');
      setProcessedSides('all_4');
      setEdgeProcessingType('polishing');
      setCustomEdgePrice('95');
      setSeparateServiceRow(true);
      setNotes('');
    } else {
      const defaultMat = glassMaterials[0] || materials[0];
      if (defaultMat) {
        setSelectedMaterialId(defaultMat.id);
        setCustomGlassPrice(String(defaultMat.basePrice));
        setWasteFactor(String(defaultMat.defaultWasteFactor || 1.12));
      }
      setConstructive('Скляне наповнення / Полиця');
      setWidthMm('600');
      setHeightMm('400');
      setPiecesCount('1');
      setProcessedSides('all_4');
      setEdgeProcessingType('polishing');
      setCustomEdgePrice('95');
      setSeparateServiceRow(true);
      setComplexityFactor(String(coefficients.complexityMultiplier || 1.15));
      setNotes('');
    }
  }, [isOpen, initialItem, preSelectedMaterial, glassMaterials, materials, coefficients]);

  // Update edge price when preset changes unless user manually changed it
  const handleSelectEdgePreset = (type: GlassEdgeProcessingType) => {
    setEdgeProcessingType(type);
    const preset = GLASS_EDGE_PRESETS.find((p) => p.id === type);
    if (preset) {
      setCustomEdgePrice(String(preset.defaultPrice));
    }
  };

  // Update glass price when material changes
  const handleMaterialChange = (matId: string) => {
    setSelectedMaterialId(matId);
    const mat = materials.find((m) => m.id === matId);
    if (mat) {
      setCustomGlassPrice(String(mat.basePrice));
      if (mat.defaultWasteFactor) {
        setWasteFactor(String(mat.defaultWasteFactor));
      }
    }
  };

  // --- Real-Time Geometric & Cost Calculations ---
  const numW = Math.max(1, parseFloat(widthMm) || 0);
  const numH = Math.max(1, parseFloat(heightMm) || 0);
  const numPieces = Math.max(1, parseInt(piecesCount, 10) || 1);

  // 1. Area calculation: (W * H / 1_000_000) * piecesCount
  const singlePieceAreaSqm = (numW * numH) / 1000000;
  const totalAreaSqm = parseFloat((singlePieceAreaSqm * numPieces).toFixed(4));

  // 2. Perimeter calculation based on processed sides:
  // 4 sides: 2 * (W + H) / 1000
  // 3 sides: (2 * H + W) / 1000
  // 2 long sides: 2 * max(W, H) / 1000
  // 2 short sides: 2 * min(W, H) / 1000
  // 1 side: max(W, H) / 1000
  const singlePiecePerimeterM = useMemo(() => {
    switch (processedSides) {
      case '3_sides':
        return (2 * Math.min(numW, numH) + Math.max(numW, numH)) / 1000;
      case '2_long':
        return (2 * Math.max(numW, numH)) / 1000;
      case '2_short':
        return (2 * Math.min(numW, numH)) / 1000;
      case '1_side':
        return Math.max(numW, numH) / 1000;
      case 'all_4':
      default:
        return (2 * (numW + numH)) / 1000;
    }
  }, [numW, numH, processedSides]);

  const totalPerimeterM = parseFloat((singlePiecePerimeterM * numPieces).toFixed(3));

  // 3. Costs:
  const activeGlassPrice = customGlassPrice !== ''
    ? Math.max(0, parseFloat(customGlassPrice) || 0)
    : selectedMaterial?.basePrice || 1650;

  const activeWaste = Math.max(1, parseFloat(wasteFactor) || 1.12);
  const activeComplexity = Math.max(1, parseFloat(complexityFactor) || coefficients.complexityMultiplier || 1.15);
  const activeEdgePrice = edgeProcessingType === 'none' ? 0 : Math.max(0, parseFloat(customEdgePrice) || 0);

  // Material cost with waste factor: Area (m²) * Price * WasteFactor
  const glassMaterialCost = parseFloat((totalAreaSqm * activeGlassPrice * activeWaste).toFixed(2));
  // Edge processing cost: Perimeter (m.p.) * EdgePrice
  const edgeCost = parseFloat((totalPerimeterM * activeEdgePrice).toFixed(2));

  // Combined Prime Cost with complexity factor
  const combinedDirectCost = parseFloat((glassMaterialCost + edgeCost).toFixed(2));
  const combinedTotalCost = parseFloat((combinedDirectCost * activeComplexity).toFixed(2));

  // Client Price with margin: Cost / (1 - margin / 100)
  const marginPercent = Math.min(95, Math.max(0, coefficients.marginPercent || 35));
  const marginMultiplier = 1 / (1 - marginPercent / 100);
  const clientPrice = parseFloat((combinedTotalCost * marginMultiplier).toFixed(2));

  // Current edge preset info
  const currentEdgePreset = useMemo(() => {
    return GLASS_EDGE_PRESETS.find((p) => p.id === edgeProcessingType) || GLASS_EDGE_PRESETS[2];
  }, [edgeProcessingType]);

  // Handle Submit
  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMaterial) return;

    const baseGlassItemId = initialItem?.id || `glass_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const linkedServiceId = initialItem?.glassParams?.linkedServiceItemId || `serv_edge_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const glassParamsData: GlassItemParams = {
      widthMm: numW,
      heightMm: numH,
      piecesCount: numPieces,
      areaSqm: totalAreaSqm,
      perimeterM: totalPerimeterM,
      processedSides,
      edgeProcessingType,
      edgeProcessingName: currentEdgePreset.name,
      edgePricePerMeter: activeEdgePrice,
      glassBasePrice: activeGlassPrice,
      glassMaterialCost,
      edgeCost,
      combinedTotalCost,
      separateServiceRow,
      linkedServiceItemId: separateServiceRow ? linkedServiceId : undefined,
    };

    const cleanConstructiveName = constructive.trim() || 'Скляне наповнення';

    if (separateServiceRow) {
      // 1. Separate Glass Item: quantity = totalAreaSqm (m²)
      const rawGlassItem: Omit<ConstructiveItem, 'effectiveQuantity' | 'materialCost' | 'totalCost' | 'clientPrice'> = {
        id: baseGlassItemId,
        constructive: cleanConstructiveName,
        materialId: selectedMaterial.id,
        materialName: selectedMaterial.name,
        category: selectedMaterial.category || 'glass_mirror',
        unit: 'м²',
        quantity: totalAreaSqm,
        basePrice: activeGlassPrice,
        wasteFactor: activeWaste,
        complexityFactor: activeComplexity,
        notes: `Ш ${numW}×В ${numH} мм, ${numPieces} шт | S=${totalAreaSqm} м²${notes ? ` · ${notes}` : ''}`,
        glassParams: glassParamsData,
        isGlassItem: true,
        linkedGlassItemId: undefined,
      };

      const calculatedGlassItem = CalculatorStorageService.recalculateItem(
        rawGlassItem,
        activeComplexity,
        coefficients.marginPercent
      );

      // 2. Separate Linked Service Item for edge processing (only if price > 0 and type != 'none')
      let serviceItem: ConstructiveItem | null = null;
      if (edgeProcessingType !== 'none' && totalPerimeterM > 0) {
        const rawServiceItem: Omit<ConstructiveItem, 'effectiveQuantity' | 'materialCost' | 'totalCost' | 'clientPrice'> = {
          id: linkedServiceId,
          constructive: `${currentEdgePreset.shortName} (${cleanConstructiveName} ${numW}×${numH} мм)`,
          materialId: `serv_edge_${edgeProcessingType}`,
          materialName: currentEdgePreset.name,
          category: 'services',
          unit: 'м.п.',
          quantity: totalPerimeterM,
          basePrice: activeEdgePrice,
          wasteFactor: 1.0,
          complexityFactor: 1.0, // Services usually don't duplicate glass complexity or use standard 1.0
          notes: `Обробка периметра ${totalPerimeterM} м.п. для «${cleanConstructiveName}» (${numPieces} шт)`,
          isGlassLinkedService: true,
          linkedGlassItemId: baseGlassItemId,
        };

        serviceItem = CalculatorStorageService.recalculateItem(
          rawServiceItem,
          1.0,
          coefficients.marginPercent
        );
      }

      onSaveGlassItem(calculatedGlassItem, serviceItem);
    } else {
      // Combined into single item:
      // Effective base price calculated so that: effectiveQuantity * effectiveBasePrice = glassMaterialCost + edgeCost
      const effectiveAreaWithWaste = totalAreaSqm * activeWaste;
      const combinedDirect = glassMaterialCost + edgeCost;
      const effectiveBasePrice = effectiveAreaWithWaste > 0
        ? parseFloat((combinedDirect / effectiveAreaWithWaste).toFixed(2))
        : activeGlassPrice;

      const rawCombinedItem: Omit<ConstructiveItem, 'effectiveQuantity' | 'materialCost' | 'totalCost' | 'clientPrice'> = {
        id: baseGlassItemId,
        constructive: cleanConstructiveName,
        materialId: selectedMaterial.id,
        materialName: selectedMaterial.name,
        category: selectedMaterial.category || 'glass_mirror',
        unit: 'м²',
        quantity: totalAreaSqm,
        basePrice: effectiveBasePrice,
        wasteFactor: activeWaste,
        complexityFactor: activeComplexity,
        notes: `Ш ${numW}×В ${numH} мм, ${numPieces} шт | S=${totalAreaSqm} м² (${activeGlassPrice} ₴/м²), П=${totalPerimeterM} м.п. (${currentEdgePreset.shortName} ${activeEdgePrice} ₴/м.п.)${notes ? ` · ${notes}` : ''}`,
        glassParams: {
          ...glassParamsData,
          separateServiceRow: false,
          linkedServiceItemId: undefined,
        },
        isGlassItem: true,
        linkedGlassItemId: undefined,
      };

      const calculatedCombined = CalculatorStorageService.recalculateItem(
        rawCombinedItem,
        activeComplexity,
        coefficients.marginPercent
      );

      // Pass null for serviceItem to delete/clear any previously linked service row
      onSaveGlassItem(calculatedCombined, null);
    }

    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto animate-in fade-in duration-150">
      <div
        className="bg-white rounded-2xl shadow-2xl border border-slate-200/90 w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-slate-200/90 bg-gradient-to-r from-cyan-900 via-indigo-950 to-slate-900 text-white flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-cyan-500/20 border border-cyan-400/40 flex items-center justify-center text-cyan-300 shadow-inner">
              <Sparkles className="w-5 h-5 text-cyan-300" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm sm:text-base font-bold text-white tracking-tight">
                  Калькулятор скла та дзеркал (Площа + Обробка периметра)
                </h3>
                <span className="text-[10px] font-bold uppercase tracking-wider bg-cyan-500/30 text-cyan-200 border border-cyan-400/30 px-2 py-0.5 rounded-full">
                  BOM Режим
                </span>
              </div>
              <p className="text-[11px] text-cyan-200/80">
                Автоматичний розрахунок заготовки в м² та обробки кромки за периметром у м.п.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-white/80 hover:text-white flex items-center justify-center transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
          {/* Section 1: Material & Constructive Name */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50/70 p-4 rounded-xl border border-slate-200/80">
            <div>
              <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5 mb-1.5">
                <Layers className="w-3.5 h-3.5 text-indigo-600" />
                <span>Матеріал скла / дзеркала</span>
                <span className="text-rose-500">*</span>
              </label>
              <select
                value={selectedMaterialId}
                onChange={(e) => handleMaterialChange(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-500"
              >
                {glassMaterials.map((mat) => (
                  <option key={mat.id} value={mat.id}>
                    {mat.name} ({mat.basePrice.toLocaleString('uk-UA')} ₴/м²)
                  </option>
                ))}
              </select>
              <div className="flex items-center justify-between text-[11px] text-slate-500 mt-1.5 px-0.5">
                <span>Постачальник: <b>{selectedMaterial?.supplier || 'Скло-Сервіс'}</b></span>
                <span>Базова ціна: <b>{activeGlassPrice.toLocaleString('uk-UA')} ₴/м²</b></span>
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5 mb-1.5">
                <span>Конструктивний вузол / Елемент</span>
                <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                value={constructive}
                onChange={(e) => setConstructive(e.target.value)}
                placeholder="напр. Скляні полиці вітрини"
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-500"
              />
              {/* Quick suggestions */}
              <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-1 mt-1">
                {QUICK_SUGGESTIONS.slice(0, 4).map((sug, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setConstructive(sug)}
                    className="px-2 py-0.5 bg-white hover:bg-cyan-50 hover:text-cyan-800 text-slate-600 rounded text-[10px] font-medium border border-slate-200 transition shrink-0 cursor-pointer"
                  >
                    {sug}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Section 2: Geometric Dimensions (Ширина, Висота, Кількість) */}
          <div className="bg-white p-4 rounded-xl border border-slate-200/90 shadow-2xs space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Maximize2 className="w-4 h-4 text-cyan-600" />
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Геометричні розміри деталі за кресленнями
                </h4>
              </div>
              <span className="text-[11px] text-slate-500">
                Вкажіть точні габарити в міліметрах (мм)
              </span>
            </div>

            {/* Quick dimension presets */}
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider shrink-0 mr-1">
                Типові:
              </span>
              {QUICK_DIMENSIONS.map((dim, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    setWidthMm(String(dim.w));
                    setHeightMm(String(dim.h));
                  }}
                  className={`px-2 py-1 rounded-lg text-xs font-mono font-semibold transition shrink-0 border cursor-pointer ${
                    parseInt(widthMm, 10) === dim.w && parseInt(heightMm, 10) === dim.h
                      ? 'bg-cyan-100 text-cyan-900 border-cyan-300 ring-1 ring-cyan-400'
                      : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
                  }`}
                  title={dim.desc}
                >
                  {dim.label}
                </button>
              ))}
            </div>

            {/* Inputs: Width, Height, Pieces */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              {/* Width */}
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                <label className="text-[11px] font-bold text-slate-700 block mb-1">
                  Ширина деталі (Ш, мм)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    step="1"
                    required
                    value={widthMm}
                    onChange={(e) => setWidthMm(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm font-mono font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  />
                  <span className="text-xs font-bold text-slate-400">мм</span>
                </div>
              </div>

              {/* Height */}
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                <label className="text-[11px] font-bold text-slate-700 block mb-1">
                  Висота деталі (В, мм)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    step="1"
                    required
                    value={heightMm}
                    onChange={(e) => setHeightMm(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm font-mono font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  />
                  <span className="text-xs font-bold text-slate-400">мм</span>
                </div>
              </div>

              {/* Quantity */}
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                <label className="text-[11px] font-bold text-slate-700 block mb-1">
                  Кількість деталей (шт.)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    step="1"
                    required
                    value={piecesCount}
                    onChange={(e) => setPiecesCount(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm font-mono font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  />
                  <span className="text-xs font-bold text-slate-400">шт</span>
                </div>
              </div>
            </div>

            {/* Calculated Geometry Preview Banner */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 bg-gradient-to-br from-cyan-50 to-indigo-50/50 rounded-xl border border-cyan-200/80 text-xs">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold text-cyan-800 uppercase tracking-wider block">
                    1. Площа заготовки (м²)
                  </span>
                  <span className="text-xs text-slate-500">
                    Формула: ({numW} × {numH} / 1 000 000) × {numPieces} шт
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-base sm:text-lg font-mono font-extrabold text-cyan-900 block">
                    {totalAreaSqm.toFixed(4)} м²
                  </span>
                  <span className="text-[10px] text-slate-400">
                    1 деталь: {singlePieceAreaSqm.toFixed(4)} м²
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between sm:border-l sm:border-cyan-200/80 sm:pl-4">
                <div>
                  <span className="text-[10px] font-bold text-indigo-800 uppercase tracking-wider block">
                    2. Периметр обробки (м.п.)
                  </span>
                  <span className="text-xs text-slate-500">
                    Формула: 2 × ({numW} + {numH}) / 1 000 × {numPieces} шт
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-base sm:text-lg font-mono font-extrabold text-indigo-900 block">
                    {totalPerimeterM.toFixed(3)} м.п.
                  </span>
                  <span className="text-[10px] text-slate-400">
                    1 деталь: {singlePiecePerimeterM.toFixed(3)} м.п.
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: Edge Processing Selection (Обробка кромки за периметром) */}
          <div className="bg-white p-4 rounded-xl border border-slate-200/90 shadow-2xs space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Scissors className="w-4 h-4 text-indigo-600" />
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Тип обробки кромки за периметром деталі
                </h4>
              </div>

              {/* Processed Sides Selector */}
              <div className="flex items-center gap-1.5 text-[11px]">
                <span className="text-slate-500">Сторони:</span>
                <select
                  value={processedSides}
                  onChange={(e) => setProcessedSides(e.target.value as GlassProcessedSides)}
                  className="px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 focus:outline-none"
                >
                  <option value="all_4">4 сторони (повний периметр)</option>
                  <option value="3_sides">3 сторони (П-подібно)</option>
                  <option value="2_long">2 довгі сторони</option>
                  <option value="2_short">2 короткі сторони</option>
                  <option value="1_side">1 сторона (фасадний край)</option>
                </select>
              </div>
            </div>

            {/* Presets Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {GLASS_EDGE_PRESETS.map((preset) => {
                const isSelected = edgeProcessingType === preset.id;
                return (
                  <div
                    key={preset.id}
                    onClick={() => handleSelectEdgePreset(preset.id)}
                    className={`p-3 rounded-xl border text-left transition cursor-pointer relative ${
                      isSelected
                        ? 'border-indigo-500 bg-indigo-50/50 ring-2 ring-indigo-500/20 shadow-2xs'
                        : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/60 bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-slate-900 text-xs">
                        {preset.shortName}
                      </span>
                      <span className={`font-mono font-bold text-xs ${isSelected ? 'text-indigo-700' : 'text-slate-700'}`}>
                        {preset.defaultPrice > 0 ? `${preset.defaultPrice} ₴/м.п.` : '0 ₴'}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-500 leading-relaxed line-clamp-2">
                      {preset.description}
                    </p>
                    {isSelected && (
                      <div className="absolute top-2 right-2 w-4 h-4 rounded-full bg-indigo-600 text-white flex items-center justify-center">
                        <Check className="w-2.5 h-2.5" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Custom Edge Price Row */}
            {edgeProcessingType !== 'none' && (
              <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-200/80 gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-700">
                    Ціна обробки за 1 м.п. (з прайсу постачальника):
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={customEdgePrice}
                    onChange={(e) => setCustomEdgePrice(e.target.value)}
                    className="w-24 px-2.5 py-1 text-right font-mono font-bold text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <span className="text-xs font-bold text-slate-500">₴ / м.п.</span>
                </div>
              </div>
            )}
          </div>

          {/* Section 4: Output Representation in BOM Editor */}
          <div className="bg-white p-4 rounded-xl border border-slate-200/90 shadow-2xs space-y-3">
            <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
              <CornerDownRight className="w-4 h-4 text-emerald-600" />
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                Відображення у специфікації (BOM Editor)
              </h4>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Option A: Separate Service Row */}
              <div
                onClick={() => setSeparateServiceRow(true)}
                className={`p-3.5 rounded-xl border transition cursor-pointer ${
                  separateServiceRow
                    ? 'border-emerald-500 bg-emerald-50/40 ring-2 ring-emerald-500/20 shadow-2xs'
                    : 'border-slate-200 hover:border-slate-300 bg-white'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${separateServiceRow ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300'}`}>
                      {separateServiceRow && <Check className="w-2.5 h-2.5" />}
                    </div>
                    <span className="font-bold text-slate-900 text-xs">
                      Два пов'язані рядки (Рекомендовано)
                    </span>
                  </div>
                  <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                    Прозоро
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 leading-relaxed pl-6">
                  1. <b>Скло</b> (Кількість = <b>{totalAreaSqm} м²</b>)<br />
                  2. <b>Послуга обробки</b> (Кількість = <b>{totalPerimeterM} м.п.</b>, окремий рядок робіт)
                </p>
              </div>

              {/* Option B: Combined into single position */}
              <div
                onClick={() => setSeparateServiceRow(false)}
                className={`p-3.5 rounded-xl border transition cursor-pointer ${
                  !separateServiceRow
                    ? 'border-indigo-500 bg-indigo-50/40 ring-2 ring-indigo-500/20 shadow-2xs'
                    : 'border-slate-200 hover:border-slate-300 bg-white'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${!separateServiceRow ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300'}`}>
                      {!separateServiceRow && <Check className="w-2.5 h-2.5" />}
                    </div>
                    <span className="font-bold text-slate-900 text-xs">
                      Один зведений рядок у BOM
                    </span>
                  </div>
                  <span className="text-[10px] font-bold text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-full">
                    Компактно
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 leading-relaxed pl-6">
                  Вартість обробки периметра (<b>{edgeCost.toLocaleString('uk-UA')} ₴</b>) сумується в загальну собівартість позиції скла. Кількість = <b>{totalAreaSqm} м²</b>.
                </p>
              </div>
            </div>
          </div>

          {/* Section 5: Real-Time Financial Cost Breakdown */}
          <div className="bg-slate-900 text-white p-4 sm:p-5 rounded-2xl shadow-sm space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
              <span className="text-xs font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-1.5">
                <DollarSign className="w-4 h-4" />
                Логіка калькуляції собівартості скла та кромки
              </span>
              <span className="text-[11px] text-slate-400">
                Маржинальність: {marginPercent}% · Коеф. складності: {activeComplexity}x
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
              {/* Cost of Material */}
              <div className="bg-slate-800/80 p-3 rounded-xl border border-slate-700/60">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">
                  1. Вартість матеріалу
                </span>
                <div className="font-mono font-bold text-sm text-cyan-300">
                  {glassMaterialCost.toLocaleString('uk-UA', { minimumFractionDigits: 2 })} ₴
                </div>
                <span className="text-[10px] text-slate-500 block mt-0.5">
                  {totalAreaSqm} м² × {activeGlassPrice} ₴ × {activeWaste} (відхід)
                </span>
              </div>

              {/* Cost of Edge Processing */}
              <div className="bg-slate-800/80 p-3 rounded-xl border border-slate-700/60">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">
                  2. Вартість обробки
                </span>
                <div className="font-mono font-bold text-sm text-indigo-300">
                  {edgeCost.toLocaleString('uk-UA', { minimumFractionDigits: 2 })} ₴
                </div>
                <span className="text-[10px] text-slate-500 block mt-0.5">
                  {totalPerimeterM} м.п. × {activeEdgePrice} ₴/м.п.
                </span>
              </div>

              {/* Total Prime Cost */}
              <div className="bg-slate-800/80 p-3 rounded-xl border border-slate-700/60">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">
                  Собівартість виробу
                </span>
                <div className="font-mono font-bold text-sm text-white">
                  {combinedTotalCost.toLocaleString('uk-UA', { minimumFractionDigits: 2 })} ₴
                </div>
                <span className="text-[10px] text-slate-500 block mt-0.5">
                  Разом із складністю {activeComplexity}x
                </span>
              </div>

              {/* Client Price */}
              <div className="bg-emerald-950/80 p-3 rounded-xl border border-emerald-600/40">
                <span className="text-[10px] text-emerald-400 uppercase tracking-wider block mb-1">
                  Ціна для клієнта
                </span>
                <div className="font-mono font-extrabold text-base text-emerald-300">
                  {clientPrice.toLocaleString('uk-UA', { minimumFractionDigits: 2 })} ₴
                </div>
                <span className="text-[10px] text-emerald-400/80 block mt-0.5">
                  Плановий прибуток: {(clientPrice - combinedTotalCost).toLocaleString('uk-UA', { minimumFractionDigits: 2 })} ₴
                </span>
              </div>
            </div>
          </div>
        </form>

        {/* Modal Footer */}
        <div className="px-5 py-3.5 border-t border-slate-200/90 bg-slate-50 flex items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200 rounded-xl transition cursor-pointer"
          >
            Скасувати
          </button>

          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <span className="text-[10px] text-slate-500 block">Разом до специфікації:</span>
              <span className="text-xs font-mono font-bold text-slate-900">
                {totalAreaSqm} м² скла + {totalPerimeterM} м.п. обробки
              </span>
            </div>

            <button
              type="button"
              onClick={handleSave}
              className="px-5 py-2.5 bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-700 hover:to-indigo-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-md transition cursor-pointer"
            >
              <Sparkles className="w-4 h-4 text-cyan-200" />
              <span>{initialItem ? 'Зберегти зміни у BOM' : 'Додати скло у специфікацію'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
