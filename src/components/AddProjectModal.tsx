import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Plus,
  Calendar,
  User,
  Receipt,
  DollarSign,
  Building,
  Briefcase,
  Check,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Sparkles,
  FileSpreadsheet,
} from 'lucide-react';
import { SheetConfig } from '../types';
import { GoogleSheetsService } from '../services/googleSheets';

interface AddProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingManagers?: string[];
  sheetConfig?: SheetConfig | null;
  accessToken?: string | null;
  onProjectAdded?: (targetRow: number, projectNumber: string) => void;
}

export const AddProjectModal: React.FC<AddProjectModalProps> = ({
  isOpen,
  onClose,
  existingManagers = [],
  sheetConfig,
  accessToken,
  onProjectAdded,
}) => {
  // Current date formatted YYYY-MM-DD for standard HTML date input
  const getTodayString = () => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  // Form State
  const [projectNumber, setProjectNumber] = useState('');
  const [projectName, setProjectName] = useState('');
  const [startDate, setStartDate] = useState(getTodayString());
  const [department, setDepartment] = useState<'ЕТС' | 'МК'>('ЕТС');
  const [manager, setManager] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [contractAmount, setContractAmount] = useState('');

  // Execution & Feedback State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<{ row: number; tab: string; projectNumber: string } | null>(null);

  // Manager suggestions & memory
  const [savedManagers, setSavedManagers] = useState<string[]>([]);
  const [showManagerSuggestions, setShowManagerSuggestions] = useState(false);
  const managerContainerRef = useRef<HTMLDivElement>(null);

  // Format validation for Project Number (e.g. 235-26)
  const isNumberFormatValid = projectNumber.trim().length > 0 && GoogleSheetsService.isProjectNumberValid(projectNumber);

  // Reset or initialize state when modal opens
  useEffect(() => {
    if (isOpen) {
      setErrorMessage(null);
      setSuccessInfo(null);
      if (!startDate) {
        setStartDate(getTodayString());
      }
    }
  }, [isOpen]);

  // Load saved managers from localStorage and merge with existingManagers
  useEffect(() => {
    try {
      const stored = localStorage.getItem('saved_project_managers');
      const parsedStored: string[] = stored ? JSON.parse(stored) : [];
      const combined = Array.from(
        new Set([
          ...parsedStored,
          ...existingManagers.filter((m) => m && m.trim() !== '—' && m.trim() !== '-'),
        ])
      ).filter(Boolean);
      setSavedManagers(combined);
    } catch {
      setSavedManagers(existingManagers.filter(Boolean));
    }
  }, [existingManagers, isOpen]);

  // Click outside listener for manager autocomplete suggestions dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        managerContainerRef.current &&
        !managerContainerRef.current.contains(e.target as Node)
      ) {
        setShowManagerSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Filter manager suggestions by input
  const filteredManagers = savedManagers.filter((m) =>
    m.toLowerCase().startsWith(manager.toLowerCase().trim())
  );

  const handleSelectManager = (m: string) => {
    setManager(m);
    setShowManagerSuggestions(false);
  };

  const handleManagerBlur = () => {
    const trimmed = manager.trim();
    if (trimmed && !savedManagers.includes(trimmed)) {
      const updated = [...savedManagers, trimmed];
      setSavedManagers(updated);
      try {
        localStorage.setItem('saved_project_managers', JSON.stringify(updated));
      } catch (e) {
        console.error('Failed to save manager to localStorage:', e);
      }
    }
  };

  // Submit and write to Google Sheet "Лист1"
  const handleSaveProject = async () => {
    setErrorMessage(null);
    setSuccessInfo(null);

    const cleanNumber = projectNumber.trim().replace(/^[№#]\s*/, '');
    if (!cleanNumber) {
      setErrorMessage('Будь ласка, введіть номер проекту.');
      return;
    }

    if (!GoogleSheetsService.isProjectNumberValid(cleanNumber)) {
      setErrorMessage('Невірний формат номера проекту. Формат має бути у вигляді номер-рік, наприклад: 235-26');
      return;
    }

    if (!projectName.trim()) {
      setErrorMessage('Будь ласка, вкажіть назву проекту.');
      return;
    }

    if (!sheetConfig?.spreadsheetId) {
      setErrorMessage('Google Таблиця не налаштована. Будь ласка, перевірте підключення таблиці вгорі сторінки.');
      return;
    }

    if (!accessToken) {
      setErrorMessage('Відсутня авторизація в Google акаунті. Будь ласка, підключіть Google акаунт.');
      return;
    }

    setIsSubmitting(true);
    try {
      // Writes to Google Sheet "Оплати/Борги", tab "Лист1" at the first free/empty cell in Column A
      // Mapping: Col A = Номер проекту, Col B = Назва проекту, Col C = Старт проект, Col G = Рахунок, Col H = Дата рахунку, Col M = Сума Договору
      const result = await GoogleSheetsService.addProjectToSheet(
        sheetConfig.spreadsheetId,
        accessToken,
        {
          projectNumber: cleanNumber,
          projectName: projectName.trim(),
          startDate: startDate.trim(),
          invoiceNumber: invoiceNumber.trim(),
          invoiceDate: invoiceDate.trim(),
          contractAmount: contractAmount.trim(),
        },
        'Лист1'
      );

      setSuccessInfo({
        row: result.targetRow,
        tab: result.tabNameUsed,
        projectNumber: cleanNumber,
      });

      // Notify parent to refresh project list from sheet
      if (onProjectAdded) {
        onProjectAdded(result.targetRow, cleanNumber);
      }

      // Reset fields after successful entry
      setProjectNumber('');
      setProjectName('');
      setStartDate(getTodayString());
      setInvoiceNumber('');
      setInvoiceDate('');
      setContractAmount('');

      // Auto close after 2.2 seconds if user doesn't close manually
      setTimeout(() => {
        onClose();
      }, 2200);
    } catch (err: any) {
      console.error('Failed to write project to sheet:', err);
      setErrorMessage(err?.message || 'Помилка під час запису в Google Таблицю.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden border border-slate-200 flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="p-5 border-b border-slate-200 bg-slate-50 flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-blue-600 text-white rounded-xl shadow-xs">
              <Briefcase className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <span>Додати новий проект</span>
                <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
                  Вкладка «Лист1»
                </span>
              </h2>
              <p className="text-xs text-slate-500">
                Запис у перший вільний рядок колонки А з прив'язкою колонок B, C, G, H, M
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 rounded-lg cursor-pointer transition-colors disabled:opacity-50"
            title="Закрити"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Notifications & Feedback */}
        {errorMessage && (
          <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2.5 text-xs text-red-800 animate-in fade-in">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold">Помилка валідації або запису:</p>
              <p className="mt-0.5">{errorMessage}</p>
            </div>
          </div>
        )}

        {successInfo && (
          <div className="mx-6 mt-4 p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-2.5 text-xs text-emerald-800 animate-in fade-in">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-bold">
                Проект № {successInfo.projectNumber} успішно записано!
              </p>
              <p className="mt-0.5 text-emerald-700">
                Занесено у рядок <b>{successInfo.row}</b> вкладки <b>«{successInfo.tab}»</b> (Колонки A, B, C, G, H, M).
              </p>
            </div>
          </div>
        )}

        {/* Form Body */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSaveProject();
          }}
          className="p-6 overflow-y-auto space-y-4 text-xs"
        >
          {/* Row 1: Номер проекту & Назва проекту */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div className="sm:col-span-1">
              <div className="flex items-center justify-between mb-1">
                <label className="block text-slate-700 font-semibold">
                  Номер проекту <span className="text-red-500">*</span>
                </label>
                <span className="text-[10px] text-blue-600 font-mono font-semibold">
                  Кол. A
                </span>
              </div>
              <div className="relative">
                <input
                  type="text"
                  value={projectNumber}
                  onChange={(e) => {
                    setProjectNumber(e.target.value);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  placeholder="напр. 235-26"
                  disabled={isSubmitting}
                  className={`w-full px-3 py-2 bg-slate-50 border rounded-lg text-xs font-mono font-medium text-slate-800 focus:outline-none focus:ring-2 focus:bg-white transition-colors ${
                    projectNumber.trim()
                      ? isNumberFormatValid
                        ? 'border-emerald-400 focus:ring-emerald-500'
                        : 'border-amber-400 focus:ring-amber-500'
                      : 'border-slate-300 focus:ring-blue-500'
                  }`}
                />
                {projectNumber.trim() && isNumberFormatValid && (
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-emerald-600 flex items-center">
                    <Check className="w-3.5 h-3.5" />
                  </span>
                )}
              </div>
              <div className="mt-1 flex items-center justify-between">
                {projectNumber.trim() ? (
                  isNumberFormatValid ? (
                    <span className="text-[10px] text-emerald-600 font-medium flex items-center gap-1">
                      <Check className="w-3 h-3" /> Формат правильний
                    </span>
                  ) : (
                    <span className="text-[10px] text-amber-600 font-medium">
                      Очікується формат: 235-26
                    </span>
                  )
                ) : (
                  <span className="text-[10px] text-slate-400">
                    Формат: номер-рік (235-26)
                  </span>
                )}
              </div>
            </div>

            <div className="sm:col-span-2">
              <div className="flex items-center justify-between mb-1">
                <label className="block text-slate-700 font-semibold">
                  Назва проекту <span className="text-red-500">*</span>
                </label>
                <span className="text-[10px] text-blue-600 font-mono font-semibold">
                  Кол. B
                </span>
              </div>
              <input
                type="text"
                value={projectName}
                onChange={(e) => {
                  setProjectName(e.target.value);
                  if (errorMessage) setErrorMessage(null);
                }}
                disabled={isSubmitting}
                placeholder="напр. Ресторан 'Zafferano' (оздоблювальні роботи)"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
              />
            </div>
          </div>

          {/* Row 2: Старт проекту & Відділ */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-slate-700 font-semibold flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-blue-600" />
                  Старт проекту
                  <span className="text-[10px] text-blue-600 font-normal bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">
                    поточна дата
                  </span>
                </label>
                <span className="text-[10px] text-blue-600 font-mono font-semibold">
                  Кол. C
                </span>
              </div>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={isSubmitting}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
              />
            </div>

            <div>
              <label className="block text-slate-700 font-semibold mb-1 flex items-center gap-1.5">
                <Building className="w-3.5 h-3.5 text-blue-600" />
                Відділ <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setDepartment('ЕТС')}
                  disabled={isSubmitting}
                  className={`py-2 px-3 rounded-lg border text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                    department === 'ЕТС'
                      ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                      : 'bg-slate-50 text-slate-700 border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  {department === 'ЕТС' && <Check className="w-3.5 h-3.5" />}
                  ЕТС
                </button>
                <button
                  type="button"
                  onClick={() => setDepartment('МК')}
                  disabled={isSubmitting}
                  className={`py-2 px-3 rounded-lg border text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                    department === 'МК'
                      ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                      : 'bg-slate-50 text-slate-700 border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  {department === 'МК' && <Check className="w-3.5 h-3.5" />}
                  МК
                </button>
              </div>
            </div>
          </div>

          {/* Row 3: Менеджер проекту (з автодоповненням і пам'яттю) */}
          <div ref={managerContainerRef} className="relative">
            <label className="block text-slate-700 font-semibold mb-1 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-blue-600" />
                Менеджер проекту
              </span>
              <span className="text-[10px] text-slate-400 font-normal">
                автопідказка при введенні першої літери
              </span>
            </label>
            <input
              type="text"
              value={manager}
              onChange={(e) => {
                setManager(e.target.value);
                setShowManagerSuggestions(true);
              }}
              onFocus={() => setShowManagerSuggestions(true)}
              onBlur={handleManagerBlur}
              disabled={isSubmitting}
              placeholder="Введіть ім'я менеджера (напр. Олексій С.)"
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
            />

            {/* Suggestions Dropdown */}
            {showManagerSuggestions && filteredManagers.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 z-30 bg-white border border-slate-200 rounded-xl shadow-lg max-h-48 overflow-y-auto p-1.5">
                <div className="text-[10px] font-semibold text-slate-400 px-2.5 py-1 uppercase tracking-wider">
                  Раніше введені менеджери
                </div>
                {filteredManagers.map((m, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onMouseDown={() => handleSelectManager(m)}
                    className="w-full text-left px-2.5 py-1.5 hover:bg-blue-50 text-slate-800 hover:text-blue-700 rounded-lg text-xs font-medium flex items-center justify-between transition cursor-pointer"
                  >
                    <span>{m}</span>
                    <span className="text-[10px] text-slate-400">вибрати</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Row 4: Рахунок та Дата рахунку */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-slate-700 font-semibold flex items-center gap-1.5">
                  <Receipt className="w-3.5 h-3.5 text-blue-600" />
                  Рахунок
                </label>
                <span className="text-[10px] text-blue-600 font-mono font-semibold">
                  Кол. G
                </span>
              </div>
              <input
                type="text"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                disabled={isSubmitting}
                placeholder="напр. № 142 від ТОВ '...'"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-slate-700 font-semibold flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-blue-600" />
                  Дата рахунку
                </label>
                <span className="text-[10px] text-blue-600 font-mono font-semibold">
                  Кол. H
                </span>
              </div>
              <input
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                disabled={isSubmitting}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
              />
            </div>
          </div>

          {/* Row 5: Сума Договору */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-slate-700 font-semibold flex items-center gap-1.5">
                <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
                Сума Договору (Колонка M)
              </label>
              <span className="text-[10px] text-emerald-600 font-mono font-semibold">
                Кол. M
              </span>
            </div>
            <div className="relative">
              <input
                type="text"
                value={contractAmount}
                onChange={(e) => setContractAmount(e.target.value)}
                disabled={isSubmitting}
                placeholder="0.00"
                className="w-full pl-3 pr-8 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-mono font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 font-bold text-slate-400">
                ₴
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Значення суми договору записується у колонку M знайденого рядка
            </p>
          </div>
        </form>

        {/* Modal Footer with Actions */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
            <span>
              {sheetConfig?.spreadsheetTitle ? (
                <>Цільова таблиця: <b>{sheetConfig.spreadsheetTitle}</b> (Лист1)</>
              ) : (
                <>Ціль: перша вільна ячейка колонки А (вкладка Лист1)</>
              )}
            </span>
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-xl text-xs font-semibold cursor-pointer transition shadow-2xs disabled:opacity-50"
            >
              Скасувати
            </button>

            {/* Action button: "Записати проект" */}
            <button
              type="button"
              onClick={handleSaveProject}
              disabled={isSubmitting || (projectNumber.trim().length > 0 && !isNumberFormatValid)}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold cursor-pointer transition shadow-xs flex items-center gap-1.5"
              title="Записати проект у першу вільну клітинку колонки А вкладки Лист1"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Запис у Google Таблицю...</span>
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  <span>Записати проект</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

