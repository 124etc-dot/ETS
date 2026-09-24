import React from 'react';
import {
  TrendingUp,
  Percent,
  Layers,
  Wrench,
  Sparkles,
  ShieldCheck,
  Building,
  DollarSign,
  Info,
} from 'lucide-react';
import { CalculationSummary, CalculatorCoefficients } from '../../types/calculator';

interface Props {
  summary: CalculationSummary;
  coefficients: CalculatorCoefficients;
  onUpdateCoefficients: (coeffs: CalculatorCoefficients) => void;
}

export const CalculatorSummaryCard: React.FC<Props> = ({
  summary,
  coefficients,
  onUpdateCoefficients,
}) => {
  const handleComplexityChange = (val: number) => {
    onUpdateCoefficients({
      ...coefficients,
      complexityMultiplier: Math.round(val * 100) / 100,
    });
  };

  const handleMarginChange = (val: number) => {
    onUpdateCoefficients({
      ...coefficients,
      marginPercent: Math.round(val),
    });
  };

  const handleVatToggle = () => {
    onUpdateCoefficients({
      ...coefficients,
      vatRatePercent: coefficients.vatRatePercent > 0 ? 0 : 20,
    });
  };

  const handleOverheadChange = (val: number) => {
    onUpdateCoefficients({
      ...coefficients,
      overheadPercent: Math.max(0, Math.min(50, Math.round(val))),
    });
  };

  // Percentages for the visual progress bar
  const totalBase = summary.clientTotalWithoutVat || 1;
  const matPct = Math.round((summary.rawMaterialCost / totalBase) * 100);
  const wastePct = Math.round((summary.wasteAddedCost / totalBase) * 100);
  const servPct = Math.round((summary.servicesSubtotal / totalBase) * 100);
  const compPct = Math.round((summary.complexityAddedCost / totalBase) * 100);
  const overPct = Math.round((summary.overheadCost / totalBase) * 100);
  const profitPct = Math.max(0, 100 - (matPct + wastePct + servPct + compPct + overPct));

  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-4 sm:p-5 space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-200/80">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-emerald-100 border border-emerald-200 flex items-center justify-center text-emerald-700">
            <TrendingUp className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              Фінансовий підсумок та коефіцієнти проєкту
            </h3>
            <p className="text-[11px] text-slate-500">
              Динамічний перерахунок собівартості, прибутку та вартості для клієнта у реальному часі
            </p>
          </div>
        </div>

        {/* VAT Switcher */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-600 font-medium">Ставка ПДВ:</span>
          <button
            type="button"
            onClick={handleVatToggle}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer border ${
              coefficients.vatRatePercent > 0
                ? 'bg-blue-600 text-white border-blue-700 shadow-2xs'
                : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
            }`}
          >
            {coefficients.vatRatePercent > 0 ? 'ПДВ 20%' : 'Без ПДВ (0%)'}
          </button>
        </div>
      </div>

      {/* Visual Cost & Margin Breakdown Stacked Bar */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px] text-slate-600">
          <span className="font-semibold text-slate-800">Структура вартості замовлення:</span>
          <span className="font-mono text-slate-500">
            Собівартість: {Math.round((summary.totalPrimeCost / totalBase) * 100)}% • Маржа: {Math.round((summary.marginAmount / totalBase) * 100)}%
          </span>
        </div>

        <div className="h-4 rounded-full overflow-hidden bg-slate-100 flex p-0.5 gap-0.5 border border-slate-200">
          <div
            style={{ width: `${matPct}%` }}
            className="bg-indigo-500 rounded-l-full h-full transition-all duration-300"
            title={`Матеріали: ${summary.rawMaterialCost.toLocaleString('uk-UA')} ₴ (${matPct}%)`}
          />
          <div
            style={{ width: `${wastePct}%` }}
            className="bg-amber-500 h-full transition-all duration-300"
            title={`Технологічний відхід: ${summary.wasteAddedCost.toLocaleString('uk-UA')} ₴ (${wastePct}%)`}
          />
          <div
            style={{ width: `${servPct}%` }}
            className="bg-sky-500 h-full transition-all duration-300"
            title={`Роботи та послуги: ${summary.servicesSubtotal.toLocaleString('uk-UA')} ₴ (${servPct}%)`}
          />
          <div
            style={{ width: `${compPct}%` }}
            className="bg-purple-500 h-full transition-all duration-300"
            title={`Складність виготовлення: ${summary.complexityAddedCost.toLocaleString('uk-UA')} ₴ (${compPct}%)`}
          />
          <div
            style={{ width: `${overPct}%` }}
            className="bg-slate-400 h-full transition-all duration-300"
            title={`Накладні цеху: ${summary.overheadCost.toLocaleString('uk-UA')} ₴ (${overPct}%)`}
          />
          <div
            style={{ width: `${profitPct}%` }}
            className="bg-emerald-500 rounded-r-full h-full transition-all duration-300"
            title={`Плановий прибуток: ${summary.marginAmount.toLocaleString('uk-UA')} ₴ (${profitPct}%)`}
          />
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500 pt-0.5">
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
            <span>Матеріали</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-amber-500"></span>
            <span>Відхід</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-sky-500"></span>
            <span>Роботи/цех</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-purple-500"></span>
            <span>Складність</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-slate-400"></span>
            <span>Накладні</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            <span className="font-semibold text-emerald-800">Прибуток (маржа)</span>
          </div>
        </div>
      </div>

      {/* Interactive Sliders for Complexity, Margin & Overhead */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3.5 rounded-xl bg-slate-50/80 border border-slate-200">
        {/* Complexity Multiplier Control */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <label className="font-bold text-slate-800 flex items-center gap-1">
              <span>Складність виготовлення</span>
            </label>
            <span className="font-mono font-bold text-blue-700 bg-blue-100/70 px-1.5 py-0.2 rounded text-[11px]">
              {coefficients.complexityMultiplier.toFixed(2)}x
            </span>
          </div>

          <input
            type="range"
            min="1.0"
            max="1.8"
            step="0.05"
            value={coefficients.complexityMultiplier}
            onChange={(e) => handleComplexityChange(parseFloat(e.target.value))}
            className="w-full accent-blue-600 h-1.5 bg-slate-200 rounded-lg cursor-pointer"
          />

          <div className="flex items-center justify-between gap-1 text-[10px]">
            {[
              { val: 1.0, lbl: '1.0 Базова' },
              { val: 1.15, lbl: '1.15 Стандарт' },
              { val: 1.3, lbl: '1.30 Складна' },
              { val: 1.5, lbl: '1.50 Ексклюзив' },
            ].map((preset) => (
              <button
                key={preset.val}
                type="button"
                onClick={() => handleComplexityChange(preset.val)}
                className={`px-1 py-0.2 rounded transition cursor-pointer ${
                  coefficients.complexityMultiplier === preset.val
                    ? 'font-bold text-blue-800 bg-blue-100'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {preset.lbl}
              </button>
            ))}
          </div>
        </div>

        {/* Planned Margin % Control */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <label className="font-bold text-slate-800 flex items-center gap-1">
              <span>Планова маржинальність</span>
            </label>
            <span className="font-mono font-bold text-emerald-700 bg-emerald-100/70 px-1.5 py-0.2 rounded text-[11px]">
              {coefficients.marginPercent}%
            </span>
          </div>

          <input
            type="range"
            min="15"
            max="60"
            step="1"
            value={coefficients.marginPercent}
            onChange={(e) => handleMarginChange(parseInt(e.target.value, 10))}
            className="w-full accent-emerald-600 h-1.5 bg-slate-200 rounded-lg cursor-pointer"
          />

          <div className="flex items-center justify-between gap-1 text-[10px]">
            {[20, 25, 30, 35, 40, 45, 50].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => handleMarginChange(m)}
                className={`px-1 py-0.2 rounded transition cursor-pointer ${
                  coefficients.marginPercent === m
                    ? 'font-bold text-emerald-800 bg-emerald-100'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {m}%
              </button>
            ))}
          </div>
        </div>

        {/* Overhead Percent Control */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <label className="font-bold text-slate-800 flex items-center gap-1">
              <span>Загальновиробничі накладні</span>
            </label>
            <span className="font-mono font-bold text-slate-700 bg-slate-200 px-1.5 py-0.2 rounded text-[11px]">
              {coefficients.overheadPercent}%
            </span>
          </div>

          <input
            type="range"
            min="0"
            max="20"
            step="1"
            value={coefficients.overheadPercent}
            onChange={(e) => handleOverheadChange(parseInt(e.target.value, 10))}
            className="w-full accent-slate-600 h-1.5 bg-slate-200 rounded-lg cursor-pointer"
          />

          <div className="flex items-center justify-between gap-1 text-[10px]">
            {[0, 3, 5, 8, 10, 15].map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => handleOverheadChange(o)}
                className={`px-1 py-0.2 rounded transition cursor-pointer ${
                  coefficients.overheadPercent === o
                    ? 'font-bold text-slate-900 bg-slate-200'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {o}%
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main KPI Numbers Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* 1. Prime Cost Card */}
        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-col justify-between">
          <div className="text-[11px] font-semibold text-slate-500 flex items-center justify-between">
            <span>Повна собівартість:</span>
            <Layers className="w-3.5 h-3.5 text-slate-400" />
          </div>
          <div className="mt-1 font-mono font-bold text-lg text-slate-900">
            {summary.totalPrimeCost.toLocaleString('uk-UA', { minimumFractionDigits: 2 })} ₴
          </div>
          <div className="text-[10px] text-slate-500 mt-1 flex flex-col">
            <span>Мат-ли: {summary.materialsSubtotal.toLocaleString('uk-UA')} ₴</span>
            <span>Роботи/послуги: {summary.servicesSubtotal.toLocaleString('uk-UA')} ₴</span>
          </div>
        </div>

        {/* 2. Profit / Margin Card */}
        <div className="p-3.5 rounded-xl bg-emerald-50/70 border border-emerald-200/90 flex flex-col justify-between">
          <div className="text-[11px] font-semibold text-emerald-800 flex items-center justify-between">
            <span>Плановий прибуток:</span>
            <span className="font-bold bg-emerald-200/70 text-emerald-900 px-1.5 py-0.2 rounded text-[10px]">
              {summary.effectiveMarginPercent}% маржі
            </span>
          </div>
          <div className="mt-1 font-mono font-bold text-lg text-emerald-700">
            +{summary.marginAmount.toLocaleString('uk-UA', { minimumFractionDigits: 2 })} ₴
          </div>
          <div className="text-[10px] text-emerald-700 mt-1">
            Націнка до собівартості: +{summary.totalPrimeCost > 0 ? Math.round((summary.marginAmount / summary.totalPrimeCost) * 100) : 0}%
          </div>
        </div>

        {/* 3. Subtotal Without VAT */}
        <div className="p-3.5 rounded-xl bg-blue-50/70 border border-blue-200/90 flex flex-col justify-between">
          <div className="text-[11px] font-semibold text-blue-800 flex items-center justify-between">
            <span>Кошторис без ПДВ:</span>
            <Building className="w-3.5 h-3.5 text-blue-500" />
          </div>
          <div className="mt-1 font-mono font-bold text-lg text-blue-900">
            {summary.clientTotalWithoutVat.toLocaleString('uk-UA', { minimumFractionDigits: 2 })} ₴
          </div>
          <div className="text-[10px] text-blue-700 mt-1">
            {coefficients.vatRatePercent > 0 ? `+ ПДВ 20%: ${summary.vatAmount.toLocaleString('uk-UA')} ₴` : 'Без нарахування ПДВ'}
          </div>
        </div>

        {/* 4. TOTAL CLIENT OFFER WITH VAT (Hero Metric) */}
        <div className="p-3.5 rounded-xl bg-gradient-to-br from-emerald-600 to-teal-700 text-white shadow-md flex flex-col justify-between">
          <div className="text-[11px] font-bold text-emerald-100 flex items-center justify-between">
            <span>ВСЬОГО ДЛЯ КЛІЄНТА:</span>
            <DollarSign className="w-4 h-4 text-emerald-200" />
          </div>
          <div className="mt-1 font-mono font-extrabold text-xl tracking-tight text-white">
            {summary.clientTotalWithVat.toLocaleString('uk-UA', { minimumFractionDigits: 2 })} ₴
          </div>
          <div className="text-[10px] text-emerald-100/90 mt-1 font-medium">
            {coefficients.vatRatePercent > 0 ? 'Сума з урахуванням ПДВ 20%' : 'Кінцева комерційна сума'}
          </div>
        </div>
      </div>
    </div>
  );
};
