import React, { useState } from 'react';
import {
  X,
  FileSpreadsheet,
  FolderPlus,
  TrendingUp,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  Folder,
  ArrowRight,
  ShieldCheck,
  Check,
  Layers,
} from 'lucide-react';
import { CalculationProject } from '../../types/calculator';
import { ProjectSheetRow, SheetConfig } from '../../types';
import { SpecificationSheetGenerator, GenerationResult } from '../../services/specificationSheetGenerator';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  project: CalculationProject;
  accessToken: string | null;
  defaultDriveFolderId?: string;
  existingProjects: ProjectSheetRow[];
  sheetConfig?: SheetConfig | null;
  onSuccess: (result: GenerationResult, updatedProjects?: ProjectSheetRow[]) => void;
  onOpenAuthModal: () => void;
  onNavigateToCashFlow: () => void;
}

export const ExportGoogleSheetModal: React.FC<Props> = ({
  isOpen,
  onClose,
  project,
  accessToken,
  defaultDriveFolderId,
  existingProjects,
  sheetConfig,
  onSuccess,
  onOpenAuthModal,
  onNavigateToCashFlow,
}) => {
  const [createSubfolder, setCreateSubfolder] = useState(true);
  const [folderId, setFolderId] = useState(defaultDriveFolderId || '');
  const [sendToCashFlow, setSendToCashFlow] = useState(true);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [generationResult, setGenerationResult] = useState<GenerationResult | null>(null);

  if (!isOpen) return null;

  const finalClientSum = project.summary.clientTotalWithVat || project.summary.clientTotalWithoutVat;

  const handleGenerate = async () => {
    if (!accessToken) {
      onOpenAuthModal();
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      // 1. Generate Google Spreadsheet with two tabs
      const result = await SpecificationSheetGenerator.generateSpecificationSheet(
        project,
        accessToken,
        {
          targetFolderId: folderId.trim() || undefined,
          createProjectFolder: createSubfolder,
        }
      );

      // 2. Optionally pass final sum into Cash Flow calendar (Requirement 3.4)
      let updatedProjectsList: ProjectSheetRow[] | undefined;
      if (sendToCashFlow) {
        const cashFlowRes = await SpecificationSheetGenerator.passToCashFlow(
          project,
          existingProjects,
          accessToken,
          sheetConfig
        );
        result.cashFlowUpdated = true;
        result.targetProjectRow = cashFlowRes.targetRow;
        updatedProjectsList = cashFlowRes.updatedProjects;
      }

      setGenerationResult(result);
      onSuccess(result, updatedProjectsList);
    } catch (err: any) {
      console.error('Error generating specification sheet:', err);
      setErrorMsg(err.message || 'Не вдалося створити Google Таблицю. Перевірте підключення Google.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-xs">
              <FileSpreadsheet className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Створення Google Таблиці специфікації
              </h2>
              <p className="text-xs text-slate-500">
                Створення файлу у Google Drive з двома вкладками та передача в Cash Flow
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto max-h-[75vh]">
          {/* SUCCESS SCREEN */}
          {generationResult ? (
            <div className="space-y-4 py-2 animate-in fade-in">
              <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-center space-y-2">
                <div className="w-12 h-12 rounded-full bg-emerald-100 border border-emerald-300 text-emerald-700 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <h3 className="text-base font-bold text-emerald-950">
                  Google Таблицю успішно створено!
                </h3>
                <p className="text-xs text-emerald-800 max-w-md mx-auto">
                  Специфікацію розраховано, таблиці з двома вкладками оформлено та збережено на Google Drive.
                </p>
              </div>

              {/* Created tabs summary */}
              <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 space-y-2 text-xs">
                <div className="font-bold text-slate-800">Створені вкладки у файлі:</div>
                <div className="flex items-center gap-2 text-slate-700">
                  <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>
                    <b>«Внутрішня специфікація»</b> — повна собівартість ({project.summary.totalPrimeCost.toLocaleString('uk-UA')} ₴), коефіцієнти відходу та складності
                  </span>
                </div>
                <div className="flex items-center gap-2 text-slate-700">
                  <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>
                    <b>«Кошторис для клієнта»</b> — комерційна пропозиція ({finalClientSum.toLocaleString('uk-UA')} ₴)
                  </span>
                </div>
                {generationResult.cashFlowUpdated && (
                  <div className="flex items-center gap-2 text-indigo-700 font-medium">
                    <TrendingUp className="w-4 h-4 text-indigo-600 shrink-0" />
                    <span>
                      Суму проєкту передано у Cash Flow (рядок {generationResult.targetProjectRow || 'активний'}) з графіком траншів!
                    </span>
                  </div>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex flex-col gap-2 pt-2">
                <a
                  href={generationResult.spreadsheetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 shadow-sm text-center"
                >
                  <ExternalLink className="w-4 h-4" />
                  <span>Відкрити створену Google Таблицю</span>
                </a>

                {generationResult.cashFlowUpdated && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onNavigateToCashFlow();
                    }}
                    className="w-full py-2.5 px-4 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 border border-indigo-200 cursor-pointer"
                  >
                    <TrendingUp className="w-4 h-4" />
                    <span>Перейти у фінансовий календар (Cash Flow)</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={onClose}
                  className="w-full py-2 text-slate-500 hover:text-slate-800 text-xs font-medium cursor-pointer"
                >
                  Закрити вікно
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Project summary card */}
              <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2 text-xs">
                <div className="flex items-center justify-between pb-1.5 border-b border-slate-200">
                  <span className="font-bold text-slate-800 text-sm">
                    № {project.projectNumber} — {project.projectName}
                  </span>
                  <span className="font-mono font-bold text-emerald-700 bg-emerald-100/70 px-2 py-0.5 rounded">
                    {finalClientSum.toLocaleString('uk-UA')} ₴
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600">
                  <div>Замовник: <b className="text-slate-800">{project.client}</b></div>
                  <div>Менеджер: <b className="text-slate-800">{project.manager}</b></div>
                  <div>Елементів у специфікації: <b className="text-slate-800">{project.items.length} поз.</b></div>
                  <div>Маржинальність: <b className="text-slate-800">{project.coefficients.marginPercent}%</b></div>
                </div>
              </div>

              {/* Tabs preview description */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-800">
                  Вміст файлу Google Sheets (2 окремі вкладки):
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div className="p-3 rounded-xl border border-slate-200 bg-white space-y-1">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                      <span className="w-2 h-2 rounded-full bg-slate-800"></span>
                      <span>1. Внутрішня специфікація</span>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Повна виробнича собівартість, витрати матеріалів з коефіцієнтами відходу, надбавка за складність та маржа.
                    </p>
                  </div>

                  <div className="p-3 rounded-xl border border-slate-200 bg-white space-y-1">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-teal-800">
                      <span className="w-2 h-2 rounded-full bg-teal-600"></span>
                      <span>2. Кошторис для клієнта</span>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Чиста комерційна пропозиція для замовника без розкриття внутрішньої собівартості.
                    </p>
                  </div>
                </div>
              </div>

              {/* Drive Folder Option */}
              <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 space-y-3">
                <div className="flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    id="createSubfolder"
                    checked={createSubfolder}
                    onChange={(e) => setCreateSubfolder(e.target.checked)}
                    className="mt-0.5 rounded text-indigo-600 focus:ring-indigo-500"
                  />
                  <label htmlFor="createSubfolder" className="text-xs text-slate-800 cursor-pointer">
                    <span className="font-bold block">
                      Створити окрему папку проєкту на Google Drive
                    </span>
                    <span className="text-[11px] text-slate-500 block">
                      Файл буде збережено у папці <code>[{project.projectNumber}] {project.projectName}</code>
                    </span>
                  </label>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    ID або посилання кореневої папки Drive:
                  </label>
                  <input
                    type="text"
                    value={folderId}
                    onChange={(e) => setFolderId(e.target.value)}
                    placeholder="За замовчуванням або вкажіть ID папки"
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-mono text-slate-700 bg-white"
                  />
                </div>
              </div>

              {/* Pass to Cash Flow Checkbox */}
              <div className="p-3.5 rounded-xl border border-indigo-200 bg-indigo-50/40 flex items-start gap-2.5">
                <input
                  type="checkbox"
                  id="sendToCashFlow"
                  checked={sendToCashFlow}
                  onChange={(e) => setSendToCashFlow(e.target.checked)}
                  className="mt-0.5 rounded text-indigo-600 focus:ring-indigo-500"
                />
                <label htmlFor="sendToCashFlow" className="text-xs text-indigo-950 cursor-pointer">
                  <span className="font-bold flex items-center gap-1.5">
                    <TrendingUp className="w-3.5 h-3.5 text-indigo-600" />
                    Передати підсумкову суму проєкту у фінансовий календар (Cash Flow)
                  </span>
                  <span className="text-[11px] text-indigo-800/80 block mt-0.5">
                    Автоматично зафіксує суму договору <b>{finalClientSum.toLocaleString('uk-UA')} ₴</b> у списку проєктів та розподілить планові транші у календар надходжень.
                  </span>
                </label>
              </div>

              {/* Error message */}
              {errorMsg && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <div>{errorMsg}</div>
                </div>
              )}

              {/* Auth warning if not connected */}
              {!accessToken && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center justify-between gap-3">
                  <span>Для створення файлу потрібна активна сесія Google Workspace.</span>
                  <button
                    type="button"
                    onClick={onOpenAuthModal}
                    className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold shrink-0 cursor-pointer"
                  >
                    Підключити Google
                  </button>
                </div>
              )}

              {/* Submit Button */}
              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isSubmitting}
                  className="px-4 py-2 border border-slate-300 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-100 transition cursor-pointer"
                >
                  Скасувати
                </button>

                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={isSubmitting || !accessToken}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white rounded-xl text-xs font-bold shadow-xs transition flex items-center gap-2 cursor-pointer"
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Створення файлу та запис у Google Sheets...</span>
                    </>
                  ) : (
                    <>
                      <FileSpreadsheet className="w-4 h-4" />
                      <span>Створити Google Таблицю специфікації</span>
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
