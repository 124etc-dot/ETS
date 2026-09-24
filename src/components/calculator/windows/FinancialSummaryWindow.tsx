import React from 'react';
import {
  FileSpreadsheet,
  TrendingUp,
  Briefcase,
  Copy,
  Save,
  CheckCircle2,
  Clock,
  ExternalLink,
  Percent,
  Sliders,
  DollarSign,
  Truck,
  Wrench,
  Layers,
} from 'lucide-react';
import { CalculationSummary, CalculatorCoefficients } from '../../../types/calculator';

interface Props {
  summary: CalculationSummary;
  coefficients: CalculatorCoefficients;
  isApproved: boolean;
  createdSheetUrl?: string | null;
  onToggleApproval: () => void;
  onUpdateCoefficients: (coeffs: CalculatorCoefficients) => void;
  onExportGoogleSheet: () => void;
  onPassToCashFlow: () => void;
  onTransferToProjects: () => void;
  onCopyCommercialOffer: () => void;
  onSaveCalculation: () => void;
}

export const FinancialSummaryWindow: React.FC<Props> = ({
  summary,
  coefficients,
  isApproved,
  createdSheetUrl,
  onToggleApproval,
  onUpdateCoefficients,
  onExportGoogleSheet,
  onPassToCashFlow,
  onTransferToProjects,
  onCopyCommercialOffer,
  onSaveCalculation,
}) => {
  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs flex flex-col h-full min-h-[460px] overflow-hidden">
      {/* Window Header */}
      <div className="px-4 py-3 border-b border-slate-200/90 bg-slate-50/70 flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-2xs">
            04
          </div>
          <div className="min-w-0">
            <h2 className="text-xs font-bold text-slate-900 tracking-tight">
              Фінансовий підсумок & Експорт
            </h2>
            <p className="text-[10px] text-slate-500">
              Собівартість, маржа, комерційна пропозиція та вивантаження у Google Таблиці
            </p>
          </div>
        </div>

        {/* Approval Toggle Badge */}
        <button
          type="button"
          onClick={onToggleApproval}
          className={`px-3 py-1 rounded-xl text-xs font-bold flex items-center gap-1.5 border transition cursor-pointer shadow-2xs shrink-0 ${
            isApproved
              ? 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100'
              : 'bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100'
          }`}
          title="Натисніть для зміни статусу: Погоджений / На прорахунку"
        >
          {isApproved ? (
            <>
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>Погоджений ✓</span>
            </>
          ) : (
            <>
              <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              <span>На прорахунку</span>
            </>
          )}
        </button>
      </div>

      {/* Financial Metrics Cards */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
        {/* Row 1: Cost breakdown pills */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-[10px] font-semibold text-slate-500 block truncate">
              Матеріали (з відходом)
            </span>
            <span className="font-mono font-bold text-xs text-slate-900">
              {summary.materialsSubtotal.toLocaleString('uk-UA', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ₴
            </span>
          </div>

          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-[10px] font-semibold text-slate-500 block truncate">
              Роботи цеху
            </span>
            <span className="font-mono font-bold text-xs text-slate-900">
              {summary.servicesSubtotal.toLocaleString('uk-UA', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ₴
            </span>
          </div>

          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-[10px] font-semibold text-slate-500 block truncate">
              Логістика & Монтаж
            </span>
            <span className="font-mono font-bold text-xs text-slate-900">
              {((summary.deliveryCost || 0) + (summary.installationCost || 0)).toLocaleString('uk-UA', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ₴
            </span>
          </div>

          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-[10px] font-semibold text-slate-500 block truncate">
              Накладні ({coefficients.overheadPercent}%)
            </span>
            <span className="font-mono font-bold text-xs text-slate-900">
              {summary.overheadCost.toLocaleString('uk-UA', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ₴
            </span>
          </div>
        </div>

        {/* Row 2: Total Prime Cost vs Client Price */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Prime Cost Box */}
          <div className="p-3 rounded-xl bg-slate-100/80 border border-slate-200/80">
            <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
              <span>Чиста виробнича собівартість:</span>
              <span className="font-mono text-[10px]">Матеріали + Роботи + Оверхед</span>
            </div>
            <div className="font-mono font-bold text-lg text-slate-800">
              {summary.totalPrimeCost.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₴
            </div>
          </div>

          {/* Client Total Highlight Box */}
          <div className="p-3 rounded-xl bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 shadow-2xs">
            <div className="flex items-center justify-between text-xs text-emerald-800 font-semibold mb-1">
              <span>Ціна для замовника:</span>
              <span className="font-mono text-[10px] bg-emerald-100 px-1.5 py-0.5 rounded text-emerald-900">
                Маржа {coefficients.marginPercent}%
              </span>
            </div>
            <div className="font-mono font-black text-xl text-emerald-700">
              {summary.clientTotalWithoutVat.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₴
            </div>
            <div className="text-[10px] text-emerald-700/80 flex items-center justify-between mt-1 pt-1 border-t border-emerald-200/60">
              <span>Прибуток (маржинальний дохід):</span>
              <b className="font-mono">{summary.marginAmount.toLocaleString('uk-UA')} ₴</b>
            </div>
          </div>
        </div>

        {/* Margin Selector Bar */}
        <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-700 flex items-center gap-1.5">
              <Percent className="w-3.5 h-3.5 text-indigo-600" />
              <span>Швидка зміна маржинальності (% прибутку):</span>
            </span>
            <span className="font-mono font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
              {coefficients.marginPercent}%
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            {[20, 25, 30, 35, 40, 45, 50].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() =>
                  onUpdateCoefficients({
                    ...coefficients,
                    marginPercent: m,
                  })
                }
                className={`flex-1 py-1 rounded-lg text-xs font-bold transition cursor-pointer border ${
                  coefficients.marginPercent === m
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs'
                    : 'bg-white text-slate-600 hover:bg-slate-100 border-slate-200'
                }`}
              >
                {m}%
              </button>
            ))}
          </div>
        </div>

        {/* Active Google Sheet Notice if already generated */}
        {createdSheetUrl && (
          <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between text-xs animate-in fade-in">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="font-semibold text-emerald-900">
                Google Таблицю успішно згенеровано у Drive
              </span>
            </div>
            <a
              href={createdSheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-bold text-emerald-700 hover:text-emerald-900 underline flex items-center gap-1"
            >
              <span>Відкрити файл</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        )}
      </div>

      {/* Window Footer: Primary Action Buttons */}
      <div className="p-3 border-t border-slate-200/90 bg-slate-50/70 space-y-2 shrink-0">
        {/* Main Export & Integration Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {/* 1. Google Sheets Generator */}
          <button
            type="button"
            onClick={onExportGoogleSheet}
            className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer shadow-xs"
            title="Згенерувати файл Google Таблиць у папці проєкту з вкладками «Специфікація цеху» та «Кошторис клієнта»"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span className="truncate">Google Таблиця</span>
          </button>

          {/* 2. Transfer to Projects */}
          <button
            type="button"
            onClick={onTransferToProjects}
            className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer shadow-xs ${
              isApproved
                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                : 'bg-slate-200 hover:bg-blue-50 text-slate-700 hover:text-blue-800 border border-slate-300'
            }`}
            title="Внести дані через вікно «Додати проєкт»"
          >
            <Briefcase className="w-3.5 h-3.5" />
            <span className="truncate">В Проєкти</span>
          </button>

          {/* 3. Transfer to Cash Flow */}
          <button
            type="button"
            onClick={onPassToCashFlow}
            className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer shadow-xs"
            title="Передати підсумкову суму проєкту в Cash Flow"
          >
            <TrendingUp className="w-3.5 h-3.5" />
            <span className="truncate">В Cash Flow</span>
          </button>
        </div>

        {/* Secondary Utility Actions */}
        <div className="flex items-center justify-between gap-2 pt-1 text-xs">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onSaveCalculation}
              className="px-2.5 py-1 text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-100 rounded-lg border border-slate-200 flex items-center gap-1 text-xs font-semibold cursor-pointer shadow-2xs"
            >
              <Save className="w-3 h-3 text-slate-500" />
              <span>Зберегти</span>
            </button>

            <button
              type="button"
              onClick={onCopyCommercialOffer}
              className="px-2.5 py-1 text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-100 rounded-lg border border-slate-200 flex items-center gap-1 text-xs font-semibold cursor-pointer shadow-2xs"
            >
              <Copy className="w-3 h-3 text-slate-500" />
              <span>Копіювати КП</span>
            </button>
          </div>

          <span className="text-[11px] text-slate-400">
            Всього позицій: <b className="text-slate-700 font-mono">{summary.itemsCount}</b>
          </span>
        </div>
      </div>
    </div>
  );
};
