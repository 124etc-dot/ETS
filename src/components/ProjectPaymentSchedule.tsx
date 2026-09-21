import React, { useState, useMemo, useEffect } from 'react';
import {
  Calendar,
  DollarSign,
  Save,
  CheckCircle2,
  AlertCircle,
  Clock,
  Sparkles,
  RefreshCw,
  Sliders,
  X,
  FileSpreadsheet,
  Layers,
} from 'lucide-react';
import { ProjectSheetRow, SheetConfig } from '../types';
import { AuthState } from '../services/googleAuth';
import {
  GoogleSheetsService,
  DEFAULT_PROJECTS_SPREADSHEET_ID,
} from '../services/googleSheets';
import { generateWeekOptions, WeekOption } from '../utils/weekUtils';

export interface PaymentTranche {
  amount: string; // formatted string or numeric string e.g. "50000" or "50 000"
  week: string;   // e.g. "Т40 (28.09 – 04.10.2026)"
}

interface Props {
  project: ProjectSheetRow;
  sheetConfig?: SheetConfig | null;
  authState?: AuthState;
  activeTabName?: string;
  onUpdateProject?: (updatedProject: ProjectSheetRow) => void;
  onNotify?: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export const ProjectPaymentSchedule: React.FC<Props> = ({
  project,
  sheetConfig,
  authState,
  activeTabName = 'Лист1',
  onUpdateProject,
  onNotify,
}) => {
  // Generate ISO-8601 week options for 2026, 2027, 2025
  const weekOptions = useMemo(() => generateWeekOptions(2026), []);

  // Initialize 4 payment tranches from project columns Z through AG
  const [tranches, setTranches] = useState<PaymentTranche[]>([
    {
      amount: project.colZ || project.rawValues?.['Z'] || '',
      week: project.colAA || project.rawValues?.['AA'] || '',
    },
    {
      amount: project.colAB || project.rawValues?.['AB'] || '',
      week: project.colAC || project.rawValues?.['AC'] || '',
    },
    {
      amount: project.colAD || project.rawValues?.['AD'] || '',
      week: project.colAE || project.rawValues?.['AE'] || '',
    },
    {
      amount: project.colAF || project.rawValues?.['AF'] || '',
      week: project.colAG || project.rawValues?.['AG'] || '',
    },
  ]);

  // Sync state if project changes
  useEffect(() => {
    setTranches([
      {
        amount: project.colZ || project.rawValues?.['Z'] || '',
        week: project.colAA || project.rawValues?.['AA'] || '',
      },
      {
        amount: project.colAB || project.rawValues?.['AB'] || '',
        week: project.colAC || project.rawValues?.['AC'] || '',
      },
      {
        amount: project.colAD || project.rawValues?.['AD'] || '',
        week: project.colAE || project.rawValues?.['AE'] || '',
      },
      {
        amount: project.colAF || project.rawValues?.['AF'] || '',
        week: project.colAG || project.rawValues?.['AG'] || '',
      },
    ]);
    setToastMessage(null);
  }, [
    project.rowNumber,
    project.colZ,
    project.colAA,
    project.colAB,
    project.colAC,
    project.colAD,
    project.colAE,
    project.colAF,
    project.colAG,
  ]);

  const [isSaving, setIsSaving] = useState(false);
  const [toastMessage, setToastMessage] = useState<{
    text: string;
    type: 'success' | 'error' | 'info';
  } | null>(null);

  // Parse numeric amount from string
  const parseNum = (val: string): number => {
    if (!val) return 0;
    const clean = val.replace(/\s/g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
    const num = parseFloat(clean);
    return isNaN(num) ? 0 : num;
  };

  // Helper to handle input change for a tranche
  const handleAmountChange = (index: number, val: string) => {
    setTranches((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], amount: val };
      return next;
    });
    setToastMessage(null);
  };

  const handleWeekChange = (index: number, val: string) => {
    setTranches((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], week: val };
      return next;
    });
    setToastMessage(null);
  };

  const handleClearTranche = (index: number) => {
    setTranches((prev) => {
      const next = [...prev];
      next[index] = { amount: '', week: '' };
      return next;
    });
    setToastMessage(null);
  };

  // Calculate project budget if available
  const projectBudget = useMemo(() => {
    if (project.effectiveProjectSum && project.effectiveProjectSum > 0) {
      return project.effectiveProjectSum;
    }
    const m = parseNum(project.colM);
    const rate = parseNum(project.colI);
    if (rate > 0 && Math.abs(rate - 1) > 0.001 && m > 0) {
      return m * rate;
    }
    return m > 0 ? m : 0;
  }, [project]);

  // Sum of all 4 planned payments
  const totalPlanned = useMemo(() => {
    return tranches.reduce((sum, t) => sum + parseNum(t.amount), 0);
  }, [tranches]);

  const budgetCoveragePercent = useMemo(() => {
    if (projectBudget <= 0) return 0;
    return Math.min(100, Math.round((totalPlanned / projectBudget) * 100));
  }, [totalPlanned, projectBudget]);

  // Distribute budget evenly among 4 payments (useful one-click tool)
  const handleDistributeEvenly = () => {
    const target = projectBudget > 0 ? projectBudget : 100000;
    const part = Math.round(target / 4);
    
    // Find current week or default to week 39/40
    const nowIdx = weekOptions.findIndex((w) => w.isCurrentWeek);
    const startIdx = nowIdx >= 0 ? nowIdx : 38;

    setTranches([
      { amount: String(part), week: weekOptions[startIdx]?.fullLabel || '' },
      { amount: String(part), week: weekOptions[startIdx + 1]?.fullLabel || '' },
      { amount: String(part), week: weekOptions[startIdx + 2]?.fullLabel || '' },
      { amount: String(target - part * 3), week: weekOptions[startIdx + 3]?.fullLabel || '' },
    ]);
    setToastMessage({
      text: 'Суму розподілено на 4 рівні частини з послідовними тижнями.',
      type: 'info',
    });
  };

  // Save to Google Sheets starting from Column Z
  const handleSaveToSheet = async () => {
    setIsSaving(true);
    setToastMessage(null);

    const spreadsheetId =
      project.spreadsheetId ||
      sheetConfig?.spreadsheetId ||
      DEFAULT_PROJECTS_SPREADSHEET_ID;
    const token = authState?.accessToken;
    const tab = project.tabName || activeTabName || 'Лист1';

    try {
      if (token && spreadsheetId) {
        // Send PUT/POST request to Google Sheets API
        await GoogleSheetsService.updateProjectPaymentSchedule(
          spreadsheetId,
          token,
          tab,
          project.rowNumber,
          tranches
        );
      }

      // Update local project object
      const updatedProject: ProjectSheetRow = {
        ...project,
        colZ: tranches[0].amount,
        colAA: tranches[0].week,
        colAB: tranches[1].amount,
        colAC: tranches[1].week,
        colAD: tranches[2].amount,
        colAE: tranches[2].week,
        colAF: tranches[3].amount,
        colAG: tranches[3].week,
        rawValues: {
          ...(project.rawValues || {}),
          Z: tranches[0].amount,
          AA: tranches[0].week,
          AB: tranches[1].amount,
          AC: tranches[1].week,
          AD: tranches[2].amount,
          AE: tranches[2].week,
          AF: tranches[3].amount,
          AG: tranches[3].week,
        },
      };

      if (onUpdateProject) {
        onUpdateProject(updatedProject);
      }

      const successNotice = 'Графік оплат успішно збережено!';
      setToastMessage({
        text: successNotice,
        type: 'success',
      });

      if (onNotify) {
        onNotify(successNotice, 'success');
      }
    } catch (err: any) {
      console.error('Error saving payment schedule to Google Sheets:', err);
      const errMsg = err.message || 'Помилка збереження графіка оплат у таблицю.';
      setToastMessage({
        text: errMsg,
        type: 'error',
      });
      if (onNotify) {
        onNotify(errMsg, 'error');
      }
    } finally {
      setIsSaving(false);
    }
  };

  // Group week options by Year for clean dropdown optics
  const groupedWeeks = useMemo(() => {
    const years = [2025, 2026, 2027];
    return years
      .map((yr) => ({
        year: yr,
        weeks: weekOptions.filter((w) => w.year === yr),
      }))
      .filter((group) => group.weeks.length > 0);
  }, [weekOptions]);

  return (
    <div
      id="project-payment-schedule-block"
      className="mt-4 p-4 bg-white rounded-2xl border border-slate-200/90 shadow-2xs space-y-4 text-xs"
    >
      {/* 1. Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <span className="text-base" role="img" aria-label="calendar">📅</span>
          <div>
            <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
              Графік оплат (План надходжень)
              <span className="text-[10px] font-semibold bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full border border-blue-200">
                4 транші (Колонки Z – AG)
              </span>
            </h4>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Планування надходжень замовлення з прив'язкою до календарних тижнів року (рядок {project.rowNumber})
            </p>
          </div>
        </div>

        {projectBudget > 0 && (
          <button
            type="button"
            onClick={handleDistributeEvenly}
            className="px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:text-blue-700 bg-slate-100 hover:bg-blue-50 rounded-lg border border-slate-200 hover:border-blue-200 transition-colors flex items-center gap-1.5 cursor-pointer"
            title="Розподілити бюджет проєкту на 4 рівні частини"
          >
            <Sparkles className="w-3.5 h-3.5 text-blue-600" />
            <span>Розподілити порівну (4×25%)</span>
          </button>
        )}
      </div>

      {/* Toast Notification Banner */}
      {toastMessage && (
        <div
          className={`p-3 rounded-xl border flex items-center justify-between text-xs font-medium transition-all ${
            toastMessage.type === 'success'
              ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
              : toastMessage.type === 'error'
              ? 'bg-rose-50 text-rose-900 border-rose-200'
              : 'bg-blue-50 text-blue-900 border-blue-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {toastMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : toastMessage.type === 'error' ? (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            ) : (
              <Clock className="w-4 h-4 text-blue-600 shrink-0" />
            )}
            <span>{toastMessage.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setToastMessage(null)}
            className="text-slate-400 hover:text-slate-600 p-1"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 2. Structure: 4 Rows */}
      <div className="space-y-2.5">
        {tranches.map((tranche, idx) => {
          const trancheNum = idx + 1;
          const hasValue = Boolean(tranche.amount || tranche.week);

          return (
            <div
              key={`tranche-${trancheNum}`}
              className={`p-2.5 rounded-xl border transition-all ${
                hasValue
                  ? 'bg-slate-50/90 border-slate-300/80 shadow-2xs'
                  : 'bg-slate-50/40 border-slate-200/70 hover:border-slate-300'
              }`}
            >
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                {/* Tranche Label */}
                <div className="flex items-center justify-between sm:justify-start gap-2 min-w-[95px] shrink-0">
                  <span className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-800 text-[10px] font-mono flex items-center justify-center font-bold">
                      {trancheNum}
                    </span>
                    Оплата {trancheNum}
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono sm:hidden">
                    (кол. {idx === 0 ? 'Z, AA' : idx === 1 ? 'AB, AC' : idx === 2 ? 'AD, AE' : 'AF, AG'})
                  </span>
                </div>

                {/* Input 1: Amount */}
                <div className="relative flex-1 min-w-[140px]">
                  <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-slate-400 font-mono text-xs">
                    ₴
                  </div>
                  <input
                    type="text"
                    value={tranche.amount}
                    onChange={(e) => handleAmountChange(idx, e.target.value)}
                    placeholder="Введіть суму, грн"
                    className="w-full pl-7 pr-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono font-semibold text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                  />
                </div>

                {/* Input 2: Week Picker (Week Dropdown) */}
                <div className="relative flex-[1.4] min-w-[210px]">
                  <select
                    value={tranche.week}
                    onChange={(e) => handleWeekChange(idx, e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all cursor-pointer font-medium"
                  >
                    <option value="">-- Оберіть тиждень --</option>

                    {/* If current tranche week is custom/imported from sheets and not found in options, display it */}
                    {tranche.week && !weekOptions.some((w) => w.fullLabel === tranche.week || w.value === tranche.week) && (
                      <option value={tranche.week}>
                        ⭐ {tranche.week} (поточне збережене)
                      </option>
                    )}

                    {groupedWeeks.map(({ year, weeks }) => (
                      <optgroup key={`year-${year}`} label={`Рік ${year}`}>
                        {weeks.map((opt) => (
                          <option key={opt.value} value={opt.fullLabel}>
                            {opt.fullLabel} {opt.isCurrentWeek ? '• [Поточний]' : ''}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>

                {/* Clear tranche button */}
                {hasValue && (
                  <button
                    type="button"
                    onClick={() => handleClearTranche(idx)}
                    className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-200/60 transition-colors self-end sm:self-center cursor-pointer"
                    title="Очистити цей транш"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Summary calculation of 4 tranches */}
      <div className="p-3 bg-slate-50/80 rounded-xl border border-slate-200/80 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-4 flex-wrap">
          <div>
            <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block">
              Заплановано (4 транші):
            </span>
            <span className="font-mono font-bold text-slate-900 text-sm">
              {totalPlanned > 0 ? `${totalPlanned.toLocaleString('uk-UA')} ₴` : '0 ₴'}
            </span>
          </div>

          {projectBudget > 0 && (
            <>
              <div className="hidden sm:block w-px h-7 bg-slate-200" />
              <div>
                <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block">
                  Бюджет договору (кол. М):
                </span>
                <span className="font-mono font-medium text-slate-700">
                  {projectBudget.toLocaleString('uk-UA')} ₴
                </span>
              </div>

              <div>
                <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block">
                  Покриття плану:
                </span>
                <span className={`font-mono font-bold ${
                  budgetCoveragePercent === 100
                    ? 'text-emerald-700'
                    : budgetCoveragePercent > 100
                    ? 'text-amber-700'
                    : 'text-blue-700'
                }`}>
                  {budgetCoveragePercent}%
                </span>
              </div>

              {projectBudget - totalPlanned !== 0 && (
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block">
                    {projectBudget - totalPlanned > 0 ? 'Залишок до плану:' : 'Перевищення плану:'}
                  </span>
                  <span className="font-mono font-semibold text-slate-600">
                    {Math.abs(projectBudget - totalPlanned).toLocaleString('uk-UA')} ₴
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        {/* 3. Action Button: 💾 Записати в Таблицю */}
        <button
          type="button"
          onClick={handleSaveToSheet}
          disabled={isSaving}
          id="btn-save-payment-schedule"
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:bg-emerald-400 text-white rounded-xl font-bold flex items-center gap-2 shadow-xs transition-colors cursor-pointer text-xs"
        >
          {isSaving ? (
            <>
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>Збереження в Google Sheets...</span>
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              <span>💾 Записати в Таблицю</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
