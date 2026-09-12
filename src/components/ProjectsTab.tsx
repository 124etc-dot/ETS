import React, { useState, useMemo, useRef } from 'react';
import {
  Briefcase,
  RefreshCw,
  Search,
  ExternalLink,
  Download,
  Filter,
  Layers,
  ChevronRight,
  ChevronLeft,
  ArrowRightLeft,
  TrendingUp,
  DollarSign,
  Building2,
  Calendar,
  AlertCircle,
  FileSpreadsheet,
  CheckCircle2,
  Sparkles,
  Info,
  SlidersHorizontal,
  X,
  Plus
} from 'lucide-react';
import { ProjectSheetRow, ProjectColumnHeader, SheetConfig } from '../types';
import { GoogleSheetsService } from '../services/googleSheets';
import { AuthState } from '../services/googleAuth';
import { SAMPLE_PROJECT_HEADERS, SAMPLE_PROJECT_ROWS } from '../data/sampleProjects';
import { AddProjectModal } from './AddProjectModal';

interface Props {
  sheetConfig: SheetConfig | null;
  authState: AuthState;
  onOpenSpreadsheet?: () => void;
}

export const ProjectsTab: React.FC<Props> = ({
  sheetConfig,
  authState,
  onOpenSpreadsheet,
}) => {
  const [headers, setHeaders] = useState<ProjectColumnHeader[]>(SAMPLE_PROJECT_HEADERS);
  const [projects, setProjects] = useState<ProjectSheetRow[]>(SAMPLE_PROJECT_ROWS);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [isLiveFromSheet, setIsLiveFromSheet] = useState(false);
  const [activeTabName, setActiveTabName] = useState<string>('Лист1');

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedProject, setSelectedProject] = useState<ProjectSheetRow | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [sortBy, setSortBy] = useState<'row' | 'order' | 'expenses' | 'margin'>('row');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // Load from Google Sheets
  const handleLoadFromSheet = async () => {
    if (!sheetConfig?.spreadsheetId) {
      setError('Google Таблиця ще не налаштована. Будь ласка, вкажіть Spreadsheet ID у верхній панелі.');
      return;
    }

    if (!authState.isAuthenticated || !authState.accessToken) {
      setError('Для отримання даних з Google Sheets потрібно авторизуватись через Google аккаунт.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await GoogleSheetsService.getProjectsFromSheet(
        sheetConfig.spreadsheetId,
        authState.accessToken,
        'Лист1'
      );

      if (res.rows.length === 0) {
        setError(
          `У вкладці «${res.tabNameUsed}» починаючи з рядка 111 не знайдено заповнених рядків. Показано зразки.`
        );
      } else {
        setProjects(res.rows);
        setHeaders(res.headers);
        setIsLiveFromSheet(true);
        setActiveTabName(res.tabNameUsed);
        setLastSyncTime(new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      }
    } catch (err: any) {
      console.error('Failed to load projects from sheet:', err);
      setError(`Помилка завантаження з Google Sheets: ${err?.message || 'Невідома помилка'}. Показано зразки проектів.`);
    } finally {
      setIsLoading(false);
    }
  };

  // Auto-load on mount or when credentials/sheet become available
  React.useEffect(() => {
    if (sheetConfig?.spreadsheetId && authState?.accessToken && !isLiveFromSheet) {
      handleLoadFromSheet();
    }
  }, [sheetConfig?.spreadsheetId, authState?.accessToken]);

  // Horizontal scroll sync refs & state
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const topScrollRef = useRef<HTMLDivElement>(null);
  const isSyncingScroll = useRef(false);

  const handleTableScroll = () => {
    if (isSyncingScroll.current) return;
    isSyncingScroll.current = true;
    if (tableContainerRef.current && topScrollRef.current) {
      topScrollRef.current.scrollLeft = tableContainerRef.current.scrollLeft;
    }
    setTimeout(() => {
      isSyncingScroll.current = false;
    }, 10);
  };

  const handleTopScroll = () => {
    if (isSyncingScroll.current) return;
    isSyncingScroll.current = true;
    if (tableContainerRef.current && topScrollRef.current) {
      tableContainerRef.current.scrollLeft = topScrollRef.current.scrollLeft;
    }
    setTimeout(() => {
      isSyncingScroll.current = false;
    }, 10);
  };

  const scrollHorizontally = (delta: number) => {
    if (tableContainerRef.current) {
      tableContainerRef.current.scrollBy({ left: delta, behavior: 'smooth' });
    }
  };

  const scrollToSection = (target: 'start' | 'salaries' | 'end') => {
    if (!tableContainerRef.current) return;
    if (target === 'start') {
      tableContainerRef.current.scrollTo({ left: 0, behavior: 'smooth' });
    } else if (target === 'salaries') {
      tableContainerRef.current.scrollTo({ left: 1050, behavior: 'smooth' });
    } else if (target === 'end') {
      tableContainerRef.current.scrollTo({ left: 3000, behavior: 'smooth' });
    }
  };

  // Helper to get title for column, strictly respecting user request
  const getHeaderTitle = (key: string, letter: string): string => {
    if (key === 'sumQRST') {
      return 'Заробітня плата';
    }
    const found = headers.find((h) => h.key === key);
    if (found?.title && found.title.trim()) {
      return found.title;
    }
    return `Колонка ${letter}`;
  };

  // Validation helper: strictly removes trailing empty rows and ghost formulas
  const isMeaningfulCell = (v: any): boolean => {
    const s = String(v ?? '').trim();
    if (!s) return false;
    if (
      s === '—' ||
      s === '-' ||
      s === '–' ||
      s === '.' ||
      s === '0' ||
      s === '0.0' ||
      s === '0.00' ||
      s === '0,0' ||
      s === '0,00' ||
      s === '0%' ||
      s === '0.0%' ||
      s === '0.00%' ||
      s === '0,0%' ||
      s === '0,00%' ||
      s === '0 грн' ||
      s === '0,00 грн' ||
      s === '0.00 грн' ||
      s === '0 ₴' ||
      s === '0,00 ₴' ||
      s === '0.00 ₴' ||
      s.toLowerCase() === 'false' ||
      s.toLowerCase() === 'null' ||
      s.toLowerCase() === 'undefined'
    ) {
      return false;
    }
    if (/^0+(\.0+|,0+)?(\s*(грн|%|₴|\$|€))?$/i.test(s)) return false;
    if (/^#(n\/a|value!|ref!|div\/0!|name\?|null!|num!)$/i.test(s)) return false;
    return true;
  };

  const isProjectValid = (p: ProjectSheetRow): boolean => {
    const hasIdentifier = isMeaningfulCell(p.colA) || isMeaningfulCell(p.colB) || isMeaningfulCell(p.colC);
    const hasSecondary =
      isMeaningfulCell(p.colD) ||
      isMeaningfulCell(p.colE) ||
      isMeaningfulCell(p.colF) ||
      isMeaningfulCell(p.colG) ||
      isMeaningfulCell(p.colX) ||
      isMeaningfulCell(p.colY);
    const hasFinances =
      (p.sumQRST && p.sumQRST > 0) ||
      isMeaningfulCell(p.colH) ||
      isMeaningfulCell(p.colI) ||
      isMeaningfulCell(p.colM) ||
      isMeaningfulCell(p.colN) ||
      isMeaningfulCell(p.colU);
    return Boolean(hasIdentifier || hasSecondary || hasFinances);
  };

  // Only real, populated project rows (last project is cleanly the final row)
  const validProjects = useMemo(() => {
    return projects.filter(isProjectValid);
  }, [projects]);

  // Statuses for filter
  const uniqueStatuses = useMemo(() => {
    const s = new Set<string>();
    validProjects.forEach((p) => {
      if (p.colF && p.colF.trim()) s.add(p.colF.trim());
    });
    return Array.from(s);
  }, [validProjects]);

  // Filtered & Sorted Projects
  const filteredProjects = useMemo(() => {
    return validProjects.filter((p) => {
      const q = searchQuery.toLowerCase().trim();
      const matchSearch =
        !q ||
        p.colA.toLowerCase().includes(q) ||
        p.colB.toLowerCase().includes(q) ||
        p.colC.toLowerCase().includes(q) ||
        p.colG.toLowerCase().includes(q) ||
        p.colX.toLowerCase().includes(q) ||
        p.colY.toLowerCase().includes(q) ||
        String(p.rowNumber).includes(q);

      const matchStatus = selectedStatus === 'all' || p.colF.trim() === selectedStatus;

      return matchSearch && matchStatus;
    }).sort((a, b) => {
      let comp = 0;
      if (sortBy === 'row') comp = a.rowNumber - b.rowNumber;
      else if (sortBy === 'order') comp = a.colA.localeCompare(b.colA, 'uk');
      else if (sortBy === 'expenses') comp = a.sumQRST - b.sumQRST;
      else if (sortBy === 'margin') {
        const parseN = (s: string) => parseFloat(s.replace(/\s/g, '').replace(',', '.')) || 0;
        comp = parseN(a.colU) - parseN(b.colU);
      }
      return sortDir === 'asc' ? comp : -comp;
    });
  }, [validProjects, searchQuery, selectedStatus, sortBy, sortDir]);

  // Aggregated Stats
  const stats = useMemo(() => {
    const totalProjects = validProjects.length;
    const totalExpenses = validProjects.reduce((acc, p) => acc + p.sumQRST, 0);
    
    // Total Contract Sum (Col M) - user specified: "ну і сума договорів це колонка М, а не H, як вказано"
    const totalContracts = validProjects.reduce((acc, p) => {
      const n = parseFloat(p.colM.replace(/\s/g, '').replace(',', '.').replace(/[^0-9.-]/g, '')) || 0;
      return acc + n;
    }, 0);

    // Total Margin (Col U)
    const totalMargin = validProjects.reduce((acc, p) => {
      const n = parseFloat(p.colU.replace(/\s/g, '').replace(',', '.').replace(/[^0-9.-]/g, '')) || 0;
      return acc + n;
    }, 0);

    const avgMarginPercent = totalContracts > 0 ? (totalMargin / totalContracts) * 100 : 0;

    return {
      totalProjects,
      totalExpenses,
      totalContracts,
      totalMargin,
      avgMarginPercent,
    };
  }, [validProjects]);

  // Export CSV
  const handleExportCSV = () => {
    const csvHeaders = ['Рядок', ...headers.map((h) => `[${h.letter}] ${h.title}`)];
    const rows = filteredProjects.map((p) => [
      p.rowNumber,
      `"${p.colA.replace(/"/g, '""')}"`,
      `"${p.colB.replace(/"/g, '""')}"`,
      `"${p.colC.replace(/"/g, '""')}"`,
      `"${p.colD.replace(/"/g, '""')}"`,
      `"${p.colE.replace(/"/g, '""')}"`,
      `"${p.colF.replace(/"/g, '""')}"`,
      `"${p.colG.replace(/"/g, '""')}"`,
      `"${p.colH.replace(/"/g, '""')}"`,
      `"${p.colI.replace(/"/g, '""')}"`,
      `"${p.colM.replace(/"/g, '""')}"`,
      `"${p.colN.replace(/"/g, '""')}"`,
      `"${p.colO.replace(/"/g, '""')}"`,
      `"${p.colP.replace(/"/g, '""')}"`,
      p.sumQRST,
      `"${p.colU.replace(/"/g, '""')}"`,
      `"${p.colV.replace(/"/g, '""')}"`,
      `"${p.colW.replace(/"/g, '""')}"`,
      `"${p.colX.replace(/"/g, '""')}"`,
      `"${p.colY.replace(/"/g, '""')}"`,
    ]);

    const csvContent = '\uFEFF' + [csvHeaders.join(';'), ...rows.map((r) => r.join(';'))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Proekty_Marginalnist_Lyst1_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('uk-UA', {
      style: 'currency',
      currency: 'UAH',
      maximumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <div className="space-y-4">
      {/* Top Banner & Action Header */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-start space-x-3.5">
            <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl border border-blue-100 shrink-0">
              <Briefcase className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg font-bold text-slate-900">
                  Проєкти та Маржинальність
                </h1>
                <span className="px-2.5 py-0.5 text-xs font-semibold bg-blue-50 text-blue-700 rounded-full border border-blue-200">
                  Вкладка «{activeTabName}» • Рядки 111+
                </span>
                {isLiveFromSheet ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full border border-emerald-200">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                    Синхронізовано з Google Sheets {lastSyncTime && `о ${lastSyncTime}`}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full border border-slate-200">
                    Зразки даних (Лист1)
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-1 max-w-3xl">
                Прорахунок маржинальності та заробітної плати по проєктах. Назви колонок зчитано безпосередньо з Google Таблиці{' '}
                <span className="font-semibold text-slate-700">(вкладка «{activeTabName}»)</span>, починаючи з рядка 111. Колонка суми Q+R+S+T розраховує{' '}
                <span className="font-bold text-emerald-700 bg-emerald-50 px-1 rounded">Заробітну плату</span>.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap shrink-0">
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
              title="Додати новий проект"
            >
              <Plus className="w-4 h-4" />
              <span>Додати проект</span>
            </button>

            <button
              onClick={handleLoadFromSheet}
              disabled={isLoading}
              className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold flex items-center gap-2 shadow-xs transition-colors cursor-pointer disabled:opacity-50"
              title="Зчитати актуальні дані з вкладки Лист1 починаючи з рядка 111"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>{isLoading ? 'Зчитування...' : 'Оновити з Google Sheets'}</span>
            </button>

            <button
              onClick={handleExportCSV}
              className="px-3 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              <span>Експорт CSV</span>
            </button>

            {sheetConfig?.spreadsheetUrl && (
              <a
                href={sheetConfig.spreadsheetUrl}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-colors"
                title="Відкрити Google Таблицю у новій вкладці"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                <span>Відкрити таблицю</span>
                <ExternalLink className="w-3 h-3 text-emerald-600" />
              </a>
            )}
          </div>
        </div>

        {/* Error Alert if any */}
        {error && (
          <div className="mt-3.5 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2.5 text-xs text-amber-900">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold">{error}</p>
              <p className="text-[11px] text-amber-700 mt-0.5">
                Перевірте, що таблиця відкрита для доступу та містить вкладку «Лист1».
              </p>
            </div>
            <button
              onClick={() => setError(null)}
              className="text-amber-500 hover:text-amber-700 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Financial Overview Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 mt-5">
          {/* Total Projects */}
          <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200/80">
            <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
              <span className="font-medium">Проєктів у роботі (рядок 111+)</span>
              <Briefcase className="w-4 h-4 text-blue-500" />
            </div>
            <div className="text-xl font-bold text-slate-900">
              {stats.totalProjects}{' '}
              <span className="text-xs font-normal text-slate-500">
                ({filteredProjects.length !== stats.totalProjects ? `знайдено ${filteredProjects.length}` : 'активних'})
              </span>
            </div>
          </div>

          {/* Total Salaries Q+R+S+T */}
          <div className="p-3.5 bg-emerald-50/50 rounded-lg border border-emerald-200/80">
            <div className="flex items-center justify-between text-xs text-emerald-800 mb-1">
              <span className="font-medium">Заробітня плата (Q + R + S + T)</span>
              <DollarSign className="w-4 h-4 text-emerald-600" />
            </div>
            <div className="text-xl font-bold text-emerald-900">
              {formatCurrency(stats.totalExpenses)}
            </div>
            <p className="text-[10px] text-emerald-700 mt-0.5">
              Сума колонок Q + R + S + T по всіх активних проєктах
            </p>
          </div>

          {/* Total Contract Sum */}
          <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200/80">
            <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
              <span className="font-medium">Сума договорів (Колонка M)</span>
              <TrendingUp className="w-4 h-4 text-indigo-500" />
            </div>
            <div className="text-xl font-bold text-slate-900">
              {formatCurrency(stats.totalContracts)}
            </div>
            <p className="text-[10px] text-slate-500 mt-0.5">
              {getHeaderTitle('colM', 'M')} • Загальний обсяг за договорами
            </p>
          </div>

          {/* Average Margin */}
          <div className="p-3.5 bg-indigo-50/50 rounded-lg border border-indigo-200/80">
            <div className="flex items-center justify-between text-xs text-indigo-800 mb-1">
              <span className="font-medium">Загальна маржа / % (U & V)</span>
              <Sparkles className="w-4 h-4 text-indigo-600" />
            </div>
            <div className="text-xl font-bold text-indigo-900">
              {formatCurrency(stats.totalMargin)}{' '}
              <span className="text-xs font-semibold bg-indigo-100 text-indigo-800 px-1.5 py-0.5 rounded">
                ~{stats.avgMarginPercent.toFixed(1)}%
              </span>
            </div>
            <p className="text-[10px] text-indigo-700 mt-0.5">
              Чистий результат після оплати всіх витрат
            </p>
          </div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-3.5">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          {/* Search Field */}
          <div className="relative w-full sm:w-80">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Пошук за № замовлення, клієнтом, об'єктом..."
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Filters & Sorting */}
          <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end flex-wrap">
            {/* Status Filter */}
            {uniqueStatuses.length > 0 && (
              <div className="flex items-center gap-1 text-xs">
                <span className="text-slate-500 font-medium">Статус:</span>
                <select
                  value={selectedStatus}
                  onChange={(e) => setSelectedStatus(e.target.value)}
                  className="p-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="all">Всі статуси ({validProjects.length})</option>
                  {uniqueStatuses.map((st, idx) => (
                    <option key={idx} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Sort Filter */}
            <div className="flex items-center gap-1 text-xs">
              <span className="text-slate-500 font-medium">Сортування:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="p-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="row">За номером рядка (111...)</option>
                <option value="order">За колонкою A ({getHeaderTitle('colA', 'A')})</option>
                <option value="expenses">Заробітня плата (Q+R+S+T)</option>
                <option value="margin">За колонкою U ({getHeaderTitle('colU', 'U')})</option>
              </select>
              <button
                onClick={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
                className="p-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-xs font-semibold cursor-pointer"
                title={sortDir === 'asc' ? 'За зростанням' : 'За спаданням'}
              >
                {sortDir === 'asc' ? '↑' : '↓'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Horizontal Scroll Navigation Bar */}
      <div className="bg-slate-100/90 border border-slate-200 border-b-0 rounded-t-xl p-2.5 flex flex-wrap items-center justify-between gap-2 shadow-2xs">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
            <ArrowRightLeft className="w-4 h-4 text-blue-600" />
            Прокрутка колонок:
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => scrollHorizontally(-350)}
              className="px-2 py-1 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 flex items-center gap-1 cursor-pointer transition shadow-2xs"
              title="Прокрутити вліво на 350px"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Вліво
            </button>
            <button
              onClick={() => scrollHorizontally(350)}
              className="px-2 py-1 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 flex items-center gap-1 cursor-pointer transition shadow-2xs"
              title="Прокрутити вправо на 350px"
            >
              Вправо <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] text-slate-500 font-medium">Швидкий перехід:</span>
          <button
            onClick={() => scrollToSection('start')}
            className="px-2 py-1 bg-white hover:bg-blue-50 border border-slate-200 hover:border-blue-300 rounded-lg text-[11px] font-medium text-slate-700 hover:text-blue-700 transition cursor-pointer"
          >
            ◄ Початок (A..E)
          </button>
          <button
            onClick={() => scrollToSection('salaries')}
            className="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 rounded-lg text-[11px] font-bold text-emerald-800 transition cursor-pointer flex items-center gap-1 shadow-2xs"
          >
            💰 Заробітня плата (Q..T)
          </button>
          <button
            onClick={() => scrollToSection('end')}
            className="px-2 py-1 bg-white hover:bg-indigo-50 border border-slate-200 hover:border-indigo-300 rounded-lg text-[11px] font-medium text-slate-700 hover:text-indigo-700 transition cursor-pointer"
          >
            Кінець / Маржа (U..Y) ►
          </button>
        </div>
      </div>

      {/* Top Synchronized Horizontal Scrollbar Bar */}
      <div
        ref={topScrollRef}
        onScroll={handleTopScroll}
        className="overflow-x-auto custom-scrollbar bg-slate-200/70 border-x border-slate-200 border-b border-slate-300 h-3.5"
        title="Потягніть для горизонтальної прокрутки таблиці"
      >
        <div className="w-[1950px] h-1" />
      </div>

      {/* Main Table Container */}
      <div className="bg-white rounded-b-xl border border-slate-200 shadow-xs overflow-hidden">
        <div
          ref={tableContainerRef}
          onScroll={handleTableScroll}
          className="overflow-x-auto custom-scrollbar max-h-[680px]"
        >
          <table className="min-w-[1950px] w-full text-left text-xs border-collapse">
            <thead className="bg-slate-100/95 sticky top-0 z-20 text-[11px] font-bold text-slate-700 border-b border-slate-200 shadow-2xs backdrop-blur-xs">
              <tr>
                {/* Row Number - Sticky Left */}
                <th className="sticky left-0 z-30 p-2.5 text-center w-12 border-r border-slate-300 bg-slate-200 text-slate-800 shadow-[2px_0_4px_-1px_rgba(0,0,0,0.08)]">
                  Рядок #
                </th>
                {/* Col A - Sticky Left */}
                <th className="sticky left-12 z-30 p-2.5 min-w-[110px] border-r-2 border-slate-300 bg-slate-200 text-slate-900 shadow-[4px_0_6px_-2px_rgba(0,0,0,0.1)]">
                  <div className="flex items-center gap-1.5">
                    <span className="px-1.5 py-0.5 bg-blue-100 text-blue-800 rounded text-[10px] font-bold">A</span>
                    <span className="font-semibold text-slate-900">{getHeaderTitle('colA', 'A')}</span>
                  </div>
                </th>
                {/* Col B */}
                <th className="p-2.5 min-w-[150px] border-r border-slate-200">
                  <div className="flex items-center gap-1.5">
                    <span className="px-1.5 py-0.5 bg-slate-200 text-slate-800 rounded text-[10px] font-bold">B</span>
                    <span className="font-semibold text-slate-800">{getHeaderTitle('colB', 'B')}</span>
                  </div>
                </th>
                {/* Col C */}
                <th className="p-2.5 min-w-[180px] border-r border-slate-200">
                  <div className="flex items-center gap-1.5">
                    <span className="px-1.5 py-0.5 bg-slate-200 text-slate-800 rounded text-[10px] font-bold">C</span>
                    <span className="font-semibold text-slate-800">{getHeaderTitle('colC', 'C')}</span>
                  </div>
                </th>
                {/* Col D & E */}
                <th className="p-2.5 min-w-[100px] border-r border-slate-200">
                  <div className="flex items-center gap-1.5">
                    <span className="px-1.5 py-0.5 bg-slate-200 text-slate-800 rounded text-[10px] font-bold">D</span>
                    <span className="font-semibold text-slate-800">{getHeaderTitle('colD', 'D')}</span>
                  </div>
                </th>
                <th className="p-2.5 min-w-[100px] border-r border-slate-200">
                  <div className="flex items-center gap-1.5">
                    <span className="px-1.5 py-0.5 bg-slate-200 text-slate-800 rounded text-[10px] font-bold">E</span>
                    <span className="font-semibold text-slate-800">{getHeaderTitle('colE', 'E')}</span>
                  </div>
                </th>
                {/* Col F */}
                <th className="p-2.5 min-w-[100px] border-r border-slate-200">
                  <div className="flex items-center gap-1.5">
                    <span className="px-1.5 py-0.5 bg-slate-200 text-slate-800 rounded text-[10px] font-bold">F</span>
                    <span className="font-semibold text-slate-800">{getHeaderTitle('colF', 'F')}</span>
                  </div>
                </th>
                {/* Col G */}
                <th className="p-2.5 min-w-[120px] border-r border-slate-200">
                  <div className="flex items-center gap-1.5">
                    <span className="px-1.5 py-0.5 bg-slate-200 text-slate-800 rounded text-[10px] font-bold">G</span>
                    <span className="font-semibold text-slate-800">{getHeaderTitle('colG', 'G')}</span>
                  </div>
                </th>
                {/* Col H */}
                <th className="p-2.5 min-w-[110px] border-r border-slate-200 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <span className="px-1.5 py-0.5 bg-slate-200 text-slate-800 rounded text-[10px] font-bold">H</span>
                    <span className="font-semibold text-slate-800">{getHeaderTitle('colH', 'H')}</span>
                  </div>
                </th>
                {/* Col I */}
                <th className="p-2.5 min-w-[100px] border-r border-slate-200 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <span className="px-1.5 py-0.5 bg-slate-200 text-slate-800 rounded text-[10px] font-bold">I</span>
                    <span className="font-semibold text-slate-800">{getHeaderTitle('colI', 'I')}</span>
                  </div>
                </th>
                {/* Col M */}
                <th className="p-2.5 min-w-[100px] border-r border-slate-200 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <span className="px-1.5 py-0.5 bg-slate-200 text-slate-800 rounded text-[10px] font-bold">M</span>
                    <span className="font-semibold text-slate-800">{getHeaderTitle('colM', 'M')}</span>
                  </div>
                </th>
                {/* Col N */}
                <th className="p-2.5 min-w-[95px] border-r border-slate-200 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <span className="px-1.5 py-0.5 bg-slate-200 text-slate-800 rounded text-[10px] font-bold">N</span>
                    <span className="font-semibold text-slate-800">{getHeaderTitle('colN', 'N')}</span>
                  </div>
                </th>
                {/* Col O */}
                <th className="p-2.5 min-w-[100px] border-r border-slate-200 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <span className="px-1.5 py-0.5 bg-slate-200 text-slate-800 rounded text-[10px] font-bold">O</span>
                    <span className="font-semibold text-slate-800">{getHeaderTitle('colO', 'O')}</span>
                  </div>
                </th>
                {/* Col P */}
                <th className="p-2.5 min-w-[100px] border-r border-slate-200 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <span className="px-1.5 py-0.5 bg-slate-200 text-slate-800 rounded text-[10px] font-bold">P</span>
                    <span className="font-semibold text-slate-800">{getHeaderTitle('colP', 'P')}</span>
                  </div>
                </th>
                {/* Q + R + S + T: COMBINED */}
                <th className="p-2.5 min-w-[150px] border-r border-emerald-300 bg-emerald-100/70 text-right text-emerald-950">
                  <div className="flex items-center justify-end gap-1.5">
                    <span className="px-1.5 py-0.5 bg-emerald-700 text-white rounded text-[10px] font-bold">
                      Q+R+S+T
                    </span>
                    <span className="font-bold text-emerald-950">Заробітня плата</span>
                  </div>
                </th>
                {/* Col U */}
                <th className="p-2.5 min-w-[100px] border-r border-slate-200 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-800 rounded text-[10px] font-bold">U</span>
                    <span className="font-semibold text-slate-800">{getHeaderTitle('colU', 'U')}</span>
                  </div>
                </th>
                {/* Col V */}
                <th className="p-2.5 min-w-[90px] border-r border-slate-200 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-800 rounded text-[10px] font-bold">V</span>
                    <span className="font-semibold text-slate-800">{getHeaderTitle('colV', 'V')}</span>
                  </div>
                </th>
                {/* Col W */}
                <th className="p-2.5 min-w-[110px] border-r border-slate-200">
                  <div className="flex items-center gap-1.5">
                    <span className="px-1.5 py-0.5 bg-slate-200 text-slate-800 rounded text-[10px] font-bold">W</span>
                    <span className="font-semibold text-slate-800">{getHeaderTitle('colW', 'W')}</span>
                  </div>
                </th>
                {/* Col X */}
                <th className="p-2.5 min-w-[130px] border-r border-slate-200">
                  <div className="flex items-center gap-1.5">
                    <span className="px-1.5 py-0.5 bg-slate-200 text-slate-800 rounded text-[10px] font-bold">X</span>
                    <span className="font-semibold text-slate-800">{getHeaderTitle('colX', 'X')}</span>
                  </div>
                </th>
                {/* Col Y */}
                <th className="p-2.5 min-w-[140px]">
                  <div className="flex items-center gap-1.5">
                    <span className="px-1.5 py-0.5 bg-slate-200 text-slate-800 rounded text-[10px] font-bold">Y</span>
                    <span className="font-semibold text-slate-800">{getHeaderTitle('colY', 'Y')}</span>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {filteredProjects.length === 0 ? (
                <tr>
                  <td colSpan={20} className="p-8 text-center text-slate-400">
                    <Info className="w-6 h-6 mx-auto mb-2 text-slate-300" />
                    <p className="font-semibold text-slate-600">Не знайдено проектів за заданими критеріями</p>
                    <p className="text-xs text-slate-400 mt-1">Спробуйте змінити пошуковий запит або скинути фільтри</p>
                  </td>
                </tr>
              ) : (
                filteredProjects.map((p) => {
                  return (
                    <tr
                      key={p.rowNumber}
                      onClick={() => setSelectedProject(p)}
                      className="hover:bg-blue-50/40 transition-colors cursor-pointer group"
                    >
                      {/* Row Number - Sticky Left */}
                      <td className="sticky left-0 z-10 p-2.5 text-center font-mono text-[11px] font-bold text-slate-500 border-r border-slate-200 bg-slate-50 group-hover:bg-blue-100/60 shadow-[2px_0_4px_-1px_rgba(0,0,0,0.06)]">
                        {p.rowNumber}
                      </td>

                      {/* Col A - Sticky Left */}
                      <td className="sticky left-12 z-10 p-2.5 font-bold text-blue-700 border-r-2 border-slate-300 whitespace-nowrap bg-white group-hover:bg-blue-100/60 shadow-[4px_0_6px_-2px_rgba(0,0,0,0.08)]">
                        <span className="group-hover:underline">{p.colA || '—'}</span>
                      </td>

                      {/* Col B */}
                      <td className="p-2.5 border-r border-slate-200 max-w-[170px] truncate" title={p.colB}>
                        {p.colB || '—'}
                      </td>

                      {/* Col C */}
                      <td className="p-2.5 border-r border-slate-200 max-w-[200px] truncate font-medium text-slate-900" title={p.colC}>
                        {p.colC || '—'}
                      </td>

                      {/* Col D */}
                      <td className="p-2.5 border-r border-slate-200 text-slate-500 whitespace-nowrap">
                        {p.colD || '—'}
                      </td>

                      {/* Col E */}
                      <td className="p-2.5 border-r border-slate-200 text-slate-500 whitespace-nowrap">
                        {p.colE || '—'}
                      </td>

                      {/* Col F */}
                      <td className="p-2.5 border-r border-slate-200 whitespace-nowrap">
                        {p.colF ? (
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                              p.colF.toLowerCase().includes('заверш')
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : 'bg-blue-50 text-blue-700 border-blue-200'
                            }`}
                          >
                            {p.colF}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>

                      {/* Col G */}
                      <td className="p-2.5 border-r border-slate-200 max-w-[120px] truncate" title={p.colG}>
                        {p.colG || '—'}
                      </td>

                      {/* Col H */}
                      <td className="p-2.5 border-r border-slate-200 text-right font-mono font-semibold text-slate-900 whitespace-nowrap">
                        {p.colH || '—'}
                      </td>

                      {/* Col I */}
                      <td className="p-2.5 border-r border-slate-200 text-right font-mono text-slate-700 whitespace-nowrap">
                        {p.colI || '—'}
                      </td>

                      {/* Col M */}
                      <td className="p-2.5 border-r border-slate-200 text-right font-mono text-slate-600 whitespace-nowrap">
                        {p.colM || '—'}
                      </td>

                      {/* Col N */}
                      <td className="p-2.5 border-r border-slate-200 text-right font-mono text-slate-600 whitespace-nowrap">
                        {p.colN || '—'}
                      </td>

                      {/* Col O */}
                      <td className="p-2.5 border-r border-slate-200 text-right font-mono text-slate-600 whitespace-nowrap">
                        {p.colO || '—'}
                      </td>

                      {/* Col P */}
                      <td className="p-2.5 border-r border-slate-200 text-right font-mono text-slate-600 whitespace-nowrap">
                        {p.colP || '—'}
                      </td>

                      {/* Q + R + S + T: COMBINED EXPENSES */}
                      <td className="p-2.5 border-r border-emerald-200 bg-emerald-50/40 text-right whitespace-nowrap">
                        <div className="flex flex-col items-end">
                          <span className="font-mono font-bold text-emerald-900 text-xs">
                            {formatCurrency(p.sumQRST)}
                          </span>
                          {(p.colQ || p.colR) && (
                            <span className="text-[10px] text-emerald-700 font-medium">
                              Мат: {p.colQ || '0'} | ЗП: {p.colR || '0'}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Col U */}
                      <td className="p-2.5 border-r border-slate-200 text-right font-mono font-bold text-indigo-900 whitespace-nowrap">
                        {p.colU || '—'}
                      </td>

                      {/* Col V */}
                      <td className="p-2.5 border-r border-slate-200 text-right font-mono font-semibold text-indigo-700 whitespace-nowrap">
                        {p.colV || '—'}
                      </td>

                      {/* Col W */}
                      <td className="p-2.5 border-r border-slate-200 text-slate-600 whitespace-nowrap">
                        {p.colW || '—'}
                      </td>

                      {/* Col X */}
                      <td className="p-2.5 border-r border-slate-200 max-w-[140px] truncate text-slate-500" title={p.colX}>
                        {p.colX || '—'}
                      </td>

                      {/* Col Y */}
                      <td className="p-2.5 max-w-[150px] truncate text-slate-500" title={p.colY}>
                        {p.colY || '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer Summary */}
        <div className="p-3 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-600 gap-2">
          <div className="flex items-center gap-3 flex-wrap">
            <span>
              Показано проєктів: <b className="text-slate-900">{filteredProjects.length}</b> з {validProjects.length}
            </span>
            <span>•</span>
            <span>
              Початок зчитування: <b className="text-slate-900">Рядок 111</b>
            </span>
            {filteredProjects.length > 0 && (
              <>
                <span>•</span>
                <span className="text-emerald-800 font-medium">
                  Останній проєкт: <b className="text-emerald-950 font-bold">Рядок #{filteredProjects[filteredProjects.length - 1].rowNumber}</b> {filteredProjects[filteredProjects.length - 1].colA ? `(${filteredProjects[filteredProjects.length - 1].colA})` : ''}
                </span>
              </>
            )}
            <span className="text-[11px] text-slate-400">
              (порожні рядки приховано, нові додаються автоматично)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-500">Загальна заробітня плата (Q+R+S+T):</span>
            <span className="font-bold font-mono text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded">
              {formatCurrency(filteredProjects.reduce((acc, p) => acc + p.sumQRST, 0))}
            </span>
          </div>
        </div>
      </div>

      {/* Project Detail Modal */}
      {selectedProject && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/60">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-blue-100 text-blue-700 rounded-xl">
                  <Briefcase className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-slate-900">
                      Проєкт #{selectedProject.colA || selectedProject.rowNumber}
                    </h2>
                    <span className="px-2 py-0.5 text-xs font-semibold bg-blue-50 text-blue-700 rounded border border-blue-200">
                      Рядок {selectedProject.rowNumber} у Лист1
                    </span>
                    {selectedProject.colF && (
                      <span className="px-2 py-0.5 text-xs font-semibold bg-emerald-50 text-emerald-700 rounded border border-emerald-200">
                        {selectedProject.colF}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5 font-medium">
                    {selectedProject.colC || selectedProject.colB || 'Без назви'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedProject(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto space-y-4 text-xs">
              {/* Main Info */}
              <div className="grid grid-cols-2 gap-3 p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                <div>
                  <span className="text-slate-400 block mb-0.5">{getHeaderTitle('colB', 'B')} (Колонка B):</span>
                  <span className="font-semibold text-slate-800 text-sm">{selectedProject.colB || '—'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-0.5">{getHeaderTitle('colG', 'G')} (Колонка G):</span>
                  <span className="font-semibold text-slate-800 text-sm">{selectedProject.colG || '—'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-0.5">{getHeaderTitle('colD', 'D')} (D):</span>
                  <span className="font-semibold text-slate-800">{selectedProject.colD || '—'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-0.5">{getHeaderTitle('colE', 'E')} (E):</span>
                  <span className="font-semibold text-slate-800">{selectedProject.colE || '—'}</span>
                </div>
              </div>

              {/* Salary Breakdown (Q, R, S, T) */}
              <div className="p-4 bg-emerald-50/60 rounded-xl border border-emerald-200">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-bold text-emerald-950 flex items-center gap-1.5 text-sm">
                    <DollarSign className="w-4 h-4 text-emerald-600" />
                    Заробітня плата (Колонки Q + R + S + T)
                  </span>
                  <span className="font-mono font-bold text-sm text-emerald-900 bg-emerald-200/80 px-2.5 py-0.5 rounded">
                    Разом: {formatCurrency(selectedProject.sumQRST)}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div className="p-2.5 bg-white rounded-lg border border-emerald-100 shadow-2xs">
                    <span className="text-[10px] text-emerald-700 block font-semibold">Колонка Q</span>
                    <span className="font-mono font-bold text-slate-900 text-xs">
                      {selectedProject.colQ ? `${selectedProject.colQ} ₴` : '0 ₴'}
                    </span>
                  </div>
                  <div className="p-2.5 bg-white rounded-lg border border-emerald-100 shadow-2xs">
                    <span className="text-[10px] text-emerald-700 block font-semibold">Колонка R</span>
                    <span className="font-mono font-bold text-slate-900 text-xs">
                      {selectedProject.colR ? `${selectedProject.colR} ₴` : '0 ₴'}
                    </span>
                  </div>
                  <div className="p-2.5 bg-white rounded-lg border border-emerald-100 shadow-2xs">
                    <span className="text-[10px] text-emerald-700 block font-semibold">Колонка S</span>
                    <span className="font-mono font-bold text-slate-900 text-xs">
                      {selectedProject.colS ? `${selectedProject.colS} ₴` : '0 ₴'}
                    </span>
                  </div>
                  <div className="p-2.5 bg-white rounded-lg border border-emerald-100 shadow-2xs">
                    <span className="text-[10px] text-emerald-700 block font-semibold">Колонка T</span>
                    <span className="font-mono font-bold text-slate-900 text-xs">
                      {selectedProject.colT ? `${selectedProject.colT} ₴` : '0 ₴'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Financial Metrics */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                <div className="p-3 bg-blue-50/70 rounded-xl border border-blue-200">
                  <span className="text-blue-800 block text-[11px] font-bold">Сума договору ({getHeaderTitle('colM', 'M')} - M)</span>
                  <span className="font-mono font-bold text-blue-950 text-xs">{selectedProject.colM || '—'} ₴</span>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="text-slate-400 block text-[11px]">{getHeaderTitle('colH', 'H')} (H)</span>
                  <span className="font-mono font-bold text-slate-900 text-xs">{selectedProject.colH || '—'} ₴</span>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="text-slate-400 block text-[11px]">{getHeaderTitle('colI', 'I')} (I)</span>
                  <span className="font-mono font-bold text-slate-900 text-xs">{selectedProject.colI || '—'} ₴</span>
                </div>
                <div className="p-3 bg-indigo-50/60 rounded-xl border border-indigo-200">
                  <span className="text-indigo-700 block text-[11px] font-semibold">{getHeaderTitle('colU', 'U')} (U)</span>
                  <span className="font-mono font-bold text-indigo-900 text-xs">{selectedProject.colU || '—'} ₴</span>
                </div>
                <div className="p-3 bg-indigo-50/60 rounded-xl border border-indigo-200">
                  <span className="text-indigo-700 block text-[11px] font-semibold">{getHeaderTitle('colV', 'V')} (V)</span>
                  <span className="font-mono font-bold text-indigo-900 text-xs">{selectedProject.colV || '—'}</span>
                </div>
              </div>

              {/* Work Budgets (M, N, O, P, W) */}
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                <span className="font-bold text-slate-800 block mb-2">Колонки розрахунків (M, N, O, P, W)</span>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11px]">
                  <div>
                    <span className="text-slate-400 block">{getHeaderTitle('colM', 'M')} (M)</span>
                    <span className="font-mono font-medium text-slate-800">{selectedProject.colM || '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">{getHeaderTitle('colN', 'N')} (N)</span>
                    <span className="font-mono font-medium text-slate-800">{selectedProject.colN || '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">{getHeaderTitle('colO', 'O')} (O)</span>
                    <span className="font-mono font-medium text-slate-800">{selectedProject.colO || '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">{getHeaderTitle('colP', 'P')} (P)</span>
                    <span className="font-mono font-medium text-slate-800">{selectedProject.colP || '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">{getHeaderTitle('colW', 'W')} (W)</span>
                    <span className="font-medium text-slate-800">{selectedProject.colW || '—'}</span>
                  </div>
                </div>
              </div>

              {/* Notes & Comments (X, Y) */}
              {(selectedProject.colX || selectedProject.colY) && (
                <div className="space-y-2 p-3.5 bg-amber-50/50 rounded-xl border border-amber-200/80">
                  {selectedProject.colX && (
                    <div>
                      <span className="font-semibold text-amber-900 block text-[11px]">{getHeaderTitle('colX', 'X')} (Колонка X):</span>
                      <p className="text-amber-950 mt-0.5">{selectedProject.colX}</p>
                    </div>
                  )}
                  {selectedProject.colY && (
                    <div>
                      <span className="font-semibold text-amber-900 block text-[11px]">{getHeaderTitle('colY', 'Y')} (Колонка Y):</span>
                      <p className="text-amber-950 mt-0.5">{selectedProject.colY}</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
              <span className="text-[11px] text-slate-400">
                Дані зчитано з Google Таблиці, вкладка «Лист1», рядок {selectedProject.rowNumber}
              </span>
              <button
                onClick={() => setSelectedProject(null)}
                className="px-4 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-semibold cursor-pointer transition-colors"
              >
                Закрити
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Add Project Modal */}
      <AddProjectModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        existingManagers={projects.map((p) => p.colG)}
      />
    </div>
  );
};
