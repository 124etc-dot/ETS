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
  Sparkles,
} from 'lucide-react';

interface AddProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingManagers?: string[];
}

export const AddProjectModal: React.FC<AddProjectModalProps> = ({
  isOpen,
  onClose,
  existingManagers = [],
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

  // Manager suggestions & memory
  const [savedManagers, setSavedManagers] = useState<string[]>([]);
  const [showManagerSuggestions, setShowManagerSuggestions] = useState(false);
  const managerContainerRef = useRef<HTMLDivElement>(null);

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
    // Remember manager if entered
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
              <h2 className="text-base font-bold text-slate-900">
                Додати новий проект
              </h2>
              <p className="text-xs text-slate-500">
                Внесіть параметри проекту та реквізити договору
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 rounded-lg cursor-pointer transition-colors"
            title="Закрити"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form
          onSubmit={(e) => e.preventDefault()}
          className="p-6 overflow-y-auto space-y-4 text-xs"
        >
          {/* Row 1: Номер проекту & Назва проекту */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div className="sm:col-span-1">
              <label className="block text-slate-700 font-semibold mb-1">
                Номер проекту <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={projectNumber}
                  onChange={(e) => setProjectNumber(e.target.value)}
                  placeholder="напр. 235-26"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-mono font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
                />
              </div>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-slate-700 font-semibold mb-1">
                Назва проекту <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="напр. Ресторан 'Zafferano' (оздоблювальні роботи)"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
              />
            </div>
          </div>

          {/* Row 2: Старт проекту & Відділ */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-slate-700 font-semibold mb-1 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-blue-600" />
                Старт проекту
                <span className="text-[10px] text-blue-600 font-normal bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">
                  поточна дата
                </span>
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
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
              <label className="block text-slate-700 font-semibold mb-1 flex items-center gap-1.5">
                <Receipt className="w-3.5 h-3.5 text-blue-600" />
                Рахунок
              </label>
              <input
                type="text"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                placeholder="напр. № 142 від ТОВ '...'"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
              />
            </div>

            <div>
              <label className="block text-slate-700 font-semibold mb-1 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-blue-600" />
                Дата рахунку
              </label>
              <input
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
              />
            </div>
          </div>

          {/* Row 5: Сума Договору */}
          <div>
            <label className="block text-slate-700 font-semibold mb-1 flex items-center gap-1.5">
              <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
              Сума Договору (Колонка M)
            </label>
            <div className="relative">
              <input
                type="text"
                value={contractAmount}
                onChange={(e) => setContractAmount(e.target.value)}
                placeholder="0.00"
                className="w-full pl-3 pr-8 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-mono font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 font-bold text-slate-400">
                ₴
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Значення суми договору буде прив'язане до колонки M проекту
            </p>
          </div>
        </form>

        {/* Modal Footer with Actions */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <span className="text-[11px] text-slate-500">
            Форма додавання проекту • Кнопка запису активна в режимі очікування
          </span>

          <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-xl text-xs font-semibold cursor-pointer transition shadow-2xs"
            >
              Скасувати
            </button>

            {/* Separate button: "Записати проект" (no action bound for now as explicitly requested) */}
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                // As requested: "І окремо кнопка - Записати проект, але поки на неї не вішаємо ніяких дій."
              }}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold cursor-pointer transition shadow-xs flex items-center gap-1.5"
              title="Записати проект (дія поки не призначена)"
            >
              <Plus className="w-4 h-4" />
              <span>Записати проект</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
