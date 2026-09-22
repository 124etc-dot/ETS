import React, { useState, useMemo, useRef, useEffect } from 'react';
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
  Plus,
  Edit2,
  Save,
  Eye,
} from 'lucide-react';
import { ProjectSheetRow, ProjectColumnHeader, SheetConfig } from '../types';
import {
  GoogleSheetsService,
  DEFAULT_PROJECTS_SPREADSHEET_ID,
  DEFAULT_PROJECTS_SPREADSHEET_URL,
  isMkProject,
  isEtsProject,
} from '../services/googleSheets';
import { AuthState } from '../services/googleAuth';
import { SAMPLE_PROJECT_HEADERS, SAMPLE_PROJECT_ROWS } from '../data/sampleProjects';
import { AddProjectModal, PLAN_SPREADSHEET_STORAGE_KEY } from './AddProjectModal';
import { ProjectPaymentSchedule } from './ProjectPaymentSchedule';

interface Props {
  sheetConfig: SheetConfig | null;
  authState: AuthState;
  onOpenSpreadsheet?: () => void;
  projects?: ProjectSheetRow[];
  onProjectsChange?: (projects: ProjectSheetRow[]) => void;
  headers?: ProjectColumnHeader[];
  onHeadersChange?: (headers: ProjectColumnHeader[]) => void;
  activeDataSource?: 'payments' | 'plan';
  onActiveDataSourceChange?: (source: 'payments' | 'plan') => void;
  isLiveFromSheet?: boolean;
  setIsLiveFromSheet?: (val: boolean) => void;
  lastSyncTime?: string | null;
  onLastSyncTimeChange?: (val: string | null) => void;
  isLoadingProjects?: boolean;
  onRefreshProjects?: (source?: 'payments' | 'plan') => Promise<void>;
  canWriteToSheets?: boolean;
}

export const ProjectsTab: React.FC<Props> = ({
  sheetConfig,
  authState,
  onOpenSpreadsheet,
  projects: initialProjects,
  onProjectsChange,
  headers: initialHeaders,
  onHeadersChange,
  activeDataSource: initialActiveSource,
  onActiveDataSourceChange,
  isLiveFromSheet: initialIsLive,
  setIsLiveFromSheet: setIsLiveFromSheetProp,
  lastSyncTime: initialLastSyncTime,
  onLastSyncTimeChange,
  isLoadingProjects: _isLoadingProjectsProp,
  onRefreshProjects: _onRefreshProjectsProp,
  canWriteToSheets = true,
}) => {
  const [headers, setHeaders] = useState<ProjectColumnHeader[]>(initialHeaders || SAMPLE_PROJECT_HEADERS);
  const [projects, setProjects] = useState<ProjectSheetRow[]>(initialProjects || SAMPLE_PROJECT_ROWS);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingPayments, setIsLoadingPayments] = useState(false);
  const [isLoadingPlan, setIsLoadingPlan] = useState(false);
  const [activeDataSource, setActiveDataSource] = useState<'payments' | 'plan'>(initialActiveSource || 'payments');
  const [error, setError] = useState<string | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(initialLastSyncTime || null);
  const [isLiveFromSheet, setIsLiveFromSheet] = useState(initialIsLive || false);
  const [activeTabName, setActiveTabName] = useState<string>('Лист1');

  // Sync with incoming parent state if provided
  useEffect(() => {
    if (initialProjects && initialProjects.length > 0) {
      setProjects(initialProjects);
    }
  }, [initialProjects]);

  useEffect(() => {
    if (initialHeaders && initialHeaders.length > 0) {
      setHeaders(initialHeaders);
    }
  }, [initialHeaders]);

  useEffect(() => {
    if (initialActiveSource) {
      setActiveDataSource(initialActiveSource);
    }
  }, [initialActiveSource]);

  useEffect(() => {
    if (initialIsLive !== undefined) {
      setIsLiveFromSheet(initialIsLive);
    }
  }, [initialIsLive]);

  useEffect(() => {
    if (initialLastSyncTime) {
      setLastSyncTime(initialLastSyncTime);
    }
  }, [initialLastSyncTime]);

  // Plan spreadsheet configuration
  const [planSheetConfig, setPlanSheetConfig] = useState<{
    id: string;
    title: string;
    url: string;
  } | null>(() => {
    try {
      const stored = localStorage.getItem(PLAN_SPREADSHEET_STORAGE_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });
  const [isEditingPlanSheet, setIsEditingPlanSheet] = useState(false);
  const [planSheetInput, setPlanSheetInput] = useState('');

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedProject, setSelectedProject] = useState<ProjectSheetRow | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [sortBy, setSortBy] = useState<'row' | 'order' | 'expenses' | 'margin'>('row');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // Load from Google Sheets: 1. Оплати/Борги (Лист1)
  const handleLoadPaymentsSheet = async () => {
    const effectiveSpreadsheetId = sheetConfig?.spreadsheetId || DEFAULT_PROJECTS_SPREADSHEET_ID;
    if (!effectiveSpreadsheetId) {
      setError('Google Таблиця «Оплати/Борги» ще не налаштована. Вкажіть Spreadsheet ID у верхній панелі.');
      return;
    }

    if (!authState.isAuthenticated || !authState.accessToken) {
      setError('Для отримання даних з Google Sheets потрібно авторизуватись через Google аккаунт.');
      return;
    }

    setIsLoadingPayments(true);
    setIsLoading(true);
    setError(null);
    setSyncNotice(null);

    try {
      const res = await GoogleSheetsService.getProjectsFromSheet(
        effectiveSpreadsheetId,
        authState.accessToken,
        'Лист1'
      );

      if (res.rows.length === 0) {
        setError(
          `У вкладці «${res.tabNameUsed}» починаючи з рядка 111 не знайдено заповнених рядків. Показано зразки.`
        );
      } else {
        const cleanRows = res.rows.filter((p) => !isMkProject(p));
        setProjects(cleanRows);
        onProjectsChange?.(cleanRows);
        setHeaders(res.headers);
        onHeadersChange?.(res.headers);
        setIsLiveFromSheet(true);
        setIsLiveFromSheetProp?.(true);
        setActiveDataSource('payments');
        onActiveDataSourceChange?.('payments');
        setActiveTabName(res.tabNameUsed);
        const time = new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        setLastSyncTime(time);
        onLastSyncTimeChange?.(time);
        setSyncNotice(`Дані з таблиці «Оплати/Борги» (вкладка «${res.tabNameUsed}», рядки 111+) успішно оновлено о ${time}. Завантажено ${cleanRows.length} проєктів (проєкти відділу МК виключено).`);
      }
    } catch (err: any) {
      console.error('Failed to load projects from sheet «Оплати/Борги»:', err);
      setError(`Помилка завантаження з Google Sheets «Оплати/Борги»: ${err?.message || 'Невідома помилка'}. Показано зразки проектів.`);
    } finally {
      setIsLoadingPayments(false);
      setIsLoading(false);
    }
  };

  // Load from Google Sheets: 2. План відвантажень (План, від рядка 2094)
  const handleLoadPlanSheet = async () => {
    if (!authState.isAuthenticated || !authState.accessToken) {
      setError('Для отримання даних з Google Sheets потрібно авторизуватись через Google аккаунт.');
      return;
    }

    setIsLoadingPlan(true);
    setError(null);
    setSyncNotice(null);

    try {
      let currentPlanConfig = planSheetConfig;

      // Auto-discover on Drive if not yet stored
      if (!currentPlanConfig?.id) {
        try {
          const found = await GoogleSheetsService.findSpreadsheetByName(
            authState.accessToken,
            'План відвантажень'
          );
          if (found) {
            currentPlanConfig = {
              id: found.id,
              title: found.title,
              url: found.webViewLink || `https://docs.google.com/spreadsheets/d/${found.id}/edit`,
            };
            setPlanSheetConfig(currentPlanConfig);
            localStorage.setItem(PLAN_SPREADSHEET_STORAGE_KEY, JSON.stringify(currentPlanConfig));
          }
        } catch {
          // ignore
        }
      }

      const effectivePlanId = currentPlanConfig?.id || sheetConfig?.spreadsheetId;
      if (!effectivePlanId) {
        setIsEditingPlanSheet(true);
        setError('Не знайдено ID Google Таблиці «План відвантажень». Будь ласка, введіть посилання або ID.');
        return;
      }

      const res = await GoogleSheetsService.getPlanProjectsFromSheet(
        effectivePlanId,
        authState.accessToken,
        'План',
        2094
      );

      if (res.rows.length === 0) {
        setProjects([]);
        onProjectsChange?.([]);
        setHeaders(res.headers);
        onHeadersChange?.(res.headers);
        setActiveDataSource('plan');
        onActiveDataSourceChange?.('plan');
        setActiveTabName(res.tabNameUsed);
        setIsLiveFromSheet(true);
        setIsLiveFromSheetProp?.(true);
        const time = new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        setLastSyncTime(time);
        onLastSyncTimeChange?.(time);
        setSyncNotice(`Таблицю «План відвантажень» (вкладка «${res.tabNameUsed}») оновлено о ${time}. Записів від рядка 2094 наразі немає. Нові проекти будуть записуватись від рядка 2094.`);
      } else {
        const cleanRows = res.rows.filter((p) => !isMkProject(p));
        setProjects(cleanRows);
        onProjectsChange?.(cleanRows);
        setHeaders(res.headers);
        onHeadersChange?.(res.headers);
        setActiveDataSource('plan');
        onActiveDataSourceChange?.('plan');
        setActiveTabName(res.tabNameUsed);
        setIsLiveFromSheet(true);
        setIsLiveFromSheetProp?.(true);
        const time = new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        setLastSyncTime(time);
        onLastSyncTimeChange?.(time);
        setSyncNotice(`Дані з таблиці «План відвантажень» (вкладка «${res.tabNameUsed}», від рядка 2094) успішно оновлено о ${time}. Завантажено ${cleanRows.length} проєктів (проєкти відділу МК виключено).`);
      }

      if (res.spreadsheetTitle && (!currentPlanConfig || currentPlanConfig.title !== res.spreadsheetTitle)) {
        const updated = {
          id: res.spreadsheetId,
          title: res.spreadsheetTitle,
          url: res.spreadsheetUrl,
        };
        setPlanSheetConfig(updated);
        try {
          localStorage.setItem(PLAN_SPREADSHEET_STORAGE_KEY, JSON.stringify(updated));
        } catch {
          // ignore
        }
      }
    } catch (err: any) {
      console.error('Failed to load plan shipments from sheet:', err);
      setError(`Помилка завантаження з таблиці «План відвантажень»: ${err?.message || 'Невідома помилка'}. Перевірте доступ або вкажіть ID таблиці.`);
    } finally {
      setIsLoadingPlan(false);
    }
  };

  // Backwards compatibility alias
  const handleLoadFromSheet = handleLoadPaymentsSheet;

  // Auto-load on mount or when credentials/sheet become available
  React.useEffect(() => {
    if (sheetConfig?.spreadsheetId && authState?.accessToken && !isLiveFromSheet) {
      handleLoadPaymentsSheet();
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
    if (key === 'colH') {
      const found = headers.find((h) => h.key === key);
      return found?.title && found.title.trim() ? found.title : 'Дата рахунку';
    }
    const found = headers.find((h) => h.key === key);
    if (found?.title && found.title.trim()) {
      return found.title;
    }
    return `Колонка ${letter}`;
  };

  // Helper to format invoice date (Колонка H - Дата рахунку)
  const formatInvoiceDate = (val?: string | number): string => {
    if (val === undefined || val === null) return '—';
    const str = String(val).trim();
    if (!str || str === '-' || str === '—') return '—';

    const num = Number(str.replace(',', '.'));
    if (!isNaN(num) && num > 35000 && num < 60000 && !str.includes('.')) {
      try {
        const dateObj = new Date(Math.round((num - 25569) * 86400 * 1000));
        if (!isNaN(dateObj.getTime())) {
          const dd = String(dateObj.getDate()).padStart(2, '0');
          const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
          const yyyy = dateObj.getFullYear();
          return `${dd}.${mm}.${yyyy}`;
        }
      } catch {
        // ignore
      }
    }

    const isoMatch = str.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/);
    if (isoMatch) {
      const [, y, m, d] = isoMatch;
      return `${d.padStart(2, '0')}.${m.padStart(2, '0')}.${y}`;
    }

    const dmyMatch = str.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{2,4})$/);
    if (dmyMatch) {
      const [, d, m, y] = dmyMatch;
      return `${d.padStart(2, '0')}.${m.padStart(2, '0')}.${y.length === 2 ? '20' + y : y}`;
    }

    const dmMatch = str.match(/^(\d{1,2})[,.](\d{1,2})$/);
    if (dmMatch) {
      const [, d, m] = dmMatch;
      return `${d.padStart(2, '0')}.${m.padStart(2, '0')}`;
    }

    return str.replace(/[₴$€]|грн/gi, '').trim() || '—';
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
    // User directive:
    // 1. "проекти з позначкою МК не відображаємо цілим рядком"
    if (isMkProject(p)) return false;

    // 2. "проекти з позначкою ЕТС відображаємо цілим рядком"
    if (isEtsProject(p)) return true;

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

  // Helper to extract effective budget (Сума проекту / замовлення в грн)
  // Правило перерахунку курсу валют: множимо колонку І на колонку М
  const getProjectBudget = (p: ProjectSheetRow): number => {
    if (p.effectiveProjectSum && p.effectiveProjectSum > 0) {
      return p.effectiveProjectSum;
    }
    const rate = parseFloat((p.colI || '').replace(/\s/g, '').replace(',', '.').replace(/[^0-9.-]/g, '')) || 0;
    const isRateActive = rate > 0 && Math.abs(rate - 1) > 0.0001;
    const numM = parseFloat((p.colM || '').replace(/\s/g, '').replace(',', '.').replace(/[^0-9.-]/g, '')) || 0;
    const base = numM > 0 ? numM : 0;

    if (isRateActive) {
      return base * rate;
    }

    return base;
  };

  const isRateConverted = (p: ProjectSheetRow): boolean => {
    if (p.isCurrencyConverted !== undefined) return p.isCurrencyConverted;
    const rate = parseFloat((p.colI || '').replace(/\s/g, '').replace(',', '.').replace(/[^0-9.-]/g, '')) || 0;
    return rate > 0 && Math.abs(rate - 1) > 0.0001;
  };

  // Aggregated Stats
  const stats = useMemo(() => {
    const totalProjects = validProjects.length;
    const totalExpenses = validProjects.reduce((acc, p) => acc + p.sumQRST, 0);
    
    // Total Contract Sum (Col M) - calculated with currency rate conversion if rate != 1
    const totalContracts = validProjects.reduce((acc, p) => {
      return acc + getProjectBudget(p);
    }, 0);

    // Remaining Payments (Col N) - user specified: "додамо ще 'Залишок оплат' і покажемо суму колонки N"
    const totalRemainingPayments = validProjects.reduce((acc, p) => {
      const n = parseFloat((p.colN || '').replace(/\s/g, '').replace(',', '.').replace(/[^0-9.-]/g, '')) || 0;
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
      totalRemainingPayments,
      totalMargin,
      avgMarginPercent,
    };
  }, [validProjects]);

  const memoizedProjectNumbers = useMemo(() => {
    return projects.map((p) => p.colA).filter(Boolean);
  }, [projects]);

  const memoizedManagers = useMemo(() => {
    return projects.map((p) => p.colG).filter(Boolean);
  }, [projects]);

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

  /**
   * Відображення Статусу замовлення в Проектах:
   * - Якщо Статус "Здано" (або варіанти "зданий", "завершено", "виконано") -> заливка плашки Зелена
   * - Якщо "В роботі" (або інші робочі статуси) -> залишається синьою без змін
   */
  const getProjectStatusBadgeClass = (status?: string | null): string => {
    if (!status) return 'bg-slate-100 text-slate-600 border-slate-200';
    const s = status.toLowerCase().trim();

    // Якщо Статус Здано - то заливка плашки Зелена
    if (
      s.includes('здан') ||       // "Здано", "здано", "Зданий"
      s.includes('заверш') ||     // "Завершено", "Завершення"
      s.includes('виконан') ||    // "Виконано"
      s.includes('закрито')       // "Закрито"
    ) {
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    }

    // Якщо В роботі - залишається синьою без змін
    return 'bg-blue-50 text-blue-700 border-blue-200';
  };

  const activeSpreadsheetUrl =
    activeDataSource === 'plan'
      ? planSheetConfig?.url || (planSheetConfig?.id ? `https://docs.google.com/spreadsheets/d/${planSheetConfig.id}/edit` : undefined)
      : sheetConfig?.spreadsheetUrl || DEFAULT_PROJECTS_SPREADSHEET_URL;

  return (
    <div className="space-y-4">
      {!canWriteToSheets && (
        <div className="px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl flex items-center space-x-2 text-xs text-amber-900">
          <Eye className="w-4 h-4 text-amber-600 shrink-0" />
          <span>
            <strong>Режим тільки перегляду:</strong> додавання нових проектів до Google Таблиці заблоковано для вашого облікового запису.
          </span>
        </div>
      )}

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
                  {activeDataSource === 'plan' ? 'Таблиця: План відвантажень' : 'Таблиця: Оплати / Борги'}
                </h1>
                <span className="px-2.5 py-0.5 text-xs font-semibold bg-blue-50 text-blue-700 rounded-full border border-blue-200">
                  {activeDataSource === 'plan'
                    ? `Вкладка «${activeTabName}» • Рядки 2094+`
                    : `Вкладка «${activeTabName}» • Рядки 111+`}
                </span>
                {isLiveFromSheet ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full border border-emerald-200">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                    Синхронізовано {lastSyncTime && `о ${lastSyncTime}`}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full border border-slate-200">
                    Зразки даних
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-1 max-w-3xl">
                {activeDataSource === 'plan' ? (
                  <>
                    Відображення проєктів з таблиці <span className="font-semibold text-slate-700">«План відвантажень»</span> (вкладка «{activeTabName}»), починаючи строго з рядка 2094.
                  </>
                ) : (
                  <>
                    Прорахунок маржинальності та заробітної плати по проєктах з таблиці <span className="font-semibold text-slate-700">«Оплати/Борги»</span> (вкладка «{activeTabName}»), починаючи з рядка 111. Колонка суми Q+R+S+T розраховує{' '}
                    <span className="font-bold text-emerald-700 bg-emerald-50 px-1 rounded">Заробітну плату</span>.
                  </>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap shrink-0">
            {/* 1. Add Project */}
            {canWriteToSheets && (
              <button
                onClick={() => setIsAddModalOpen(true)}
                className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                title="Додати новий проект (запис у План відвантажень від 2094 та Оплати/Борги від 127)"
              >
                <Plus className="w-4 h-4" />
                <span>Додати проект</span>
              </button>
            )}

            {/* 2. Update Plan Shipments button */}
            <button
              onClick={handleLoadPlanSheet}
              disabled={isLoadingPlan || isLoadingPayments}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 shadow-xs transition-colors cursor-pointer disabled:opacity-50 ${
                activeDataSource === 'plan'
                  ? 'bg-blue-600 hover:bg-blue-700 text-white ring-2 ring-blue-300 ring-offset-1'
                  : 'bg-white hover:bg-blue-50 text-blue-700 border border-blue-200'
              }`}
              title="Оновити дані з таблиці «План відвантажень» (вкладка «План» • від рядка 2094)"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingPlan ? 'animate-spin text-blue-300' : ''}`} />
              <span>{isLoadingPlan ? 'Оновлення Плану...' : 'Оновити План відвантажень'}</span>
            </button>

            {/* 3. Update Payments/Debts button */}
            <button
              onClick={handleLoadPaymentsSheet}
              disabled={isLoadingPayments || isLoadingPlan}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 shadow-xs transition-colors cursor-pointer disabled:opacity-50 ${
                activeDataSource === 'payments'
                  ? 'bg-blue-600 hover:bg-blue-700 text-white ring-2 ring-blue-300 ring-offset-1'
                  : 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200'
              }`}
              title="Оновити дані з таблиці «Оплати/Борги» (вкладка «Лист1» • від рядка 111)"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingPayments ? 'animate-spin text-blue-300' : ''}`} />
              <span>{isLoadingPayments ? 'Оновлення Оплат...' : 'Оновити Оплати/Борги'}</span>
            </button>

            <button
              onClick={handleExportCSV}
              className="px-3 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
              title="Експортувати поточні рядки у CSV"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              <span>Експорт CSV</span>
            </button>

            {activeSpreadsheetUrl && (
              <a
                href={activeSpreadsheetUrl}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-colors"
                title={`Відкрити таблицю «${activeDataSource === 'plan' ? 'План відвантажень' : 'Оплати/Борги'}»`}
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                <span>Відкрити {activeDataSource === 'plan' ? '«План»' : '«Оплати/Борги»'}</span>
                <ExternalLink className="w-3 h-3 text-emerald-600" />
              </a>
            )}
          </div>
        </div>

        {/* Sync Success Notice */}
        {syncNotice && (
          <div className="mt-3.5 p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-start gap-2.5 text-xs text-emerald-900">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold">{syncNotice}</p>
            </div>
            <button
              onClick={() => setSyncNotice(null)}
              className="text-emerald-500 hover:text-emerald-700 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Error Alert if any */}
        {error && (
          <div className="mt-3.5 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2.5 text-xs text-amber-900">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold">{error}</p>
              <p className="text-[11px] text-amber-700 mt-0.5">
                Перевірте, що таблиця відкрита для доступу та містить відповідну вкладку.
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

        {/* Plan Sheet ID setup toggle */}
        {isEditingPlanSheet && (
          <div className="mt-3.5 p-3.5 bg-blue-50 border border-blue-200 rounded-xl space-y-2 text-xs">
            <div className="font-semibold text-blue-950 flex items-center justify-between">
              <span>Вкажіть Google Таблицю «План відвантажень»:</span>
              <button onClick={() => setIsEditingPlanSheet(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={planSheetInput}
                onChange={(e) => setPlanSheetInput(e.target.value)}
                placeholder="Вставте посилання або ID таблиці «План відвантажень»"
                className="flex-1 px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs"
              />
              <button
                onClick={() => {
                  const clean = GoogleSheetsService.extractSpreadsheetId(planSheetInput.trim());
                  if (!clean) return;
                  const newConf = {
                    id: clean,
                    title: 'План відвантажень',
                    url: `https://docs.google.com/spreadsheets/d/${clean}/edit`,
                  };
                  setPlanSheetConfig(newConf);
                  localStorage.setItem(PLAN_SPREADSHEET_STORAGE_KEY, JSON.stringify(newConf));
                  setIsEditingPlanSheet(false);
                  handleLoadPlanSheet();
                }}
                className="px-3 py-1.5 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 cursor-pointer"
              >
                Зберегти та оновити
              </button>
            </div>
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

          {/* Total Contract Sum & Remaining Payments */}
          <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200/80 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                <span className="font-medium">Сума договорів (Колонка M)</span>
                <TrendingUp className="w-4 h-4 text-indigo-500" />
              </div>
              <div className="text-xl font-bold text-slate-900">
                {formatCurrency(stats.totalContracts)}
              </div>
            </div>

            <div className="mt-2.5 pt-2 border-t border-slate-200 flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-600">
                Залишок оплат (Кол. N):
              </span>
              <span className="font-bold font-mono text-xs text-amber-800 bg-amber-50 border border-amber-200/80 px-1.5 py-0.5 rounded">
                {formatCurrency(stats.totalRemainingPayments)}
              </span>
            </div>
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
                        <div className="flex items-center gap-1.5">
                          <span className="group-hover:underline">{p.colA || '—'}</span>
                          {isEtsProject(p) && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-100 text-blue-800 border border-blue-200">
                              ЕТС
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Col B */}
                      <td className="p-2.5 border-r border-slate-200 max-w-[170px] truncate" title={p.colB}>
                        {p.colB || '—'}
                      </td>

                      {/* Col C */}
                      <td className="p-2.5 border-r border-slate-200 max-w-[200px] truncate font-medium text-slate-900" title={p.colC}>
                        {isEtsProject(p) ? (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-blue-100 text-blue-800 border border-blue-200 shadow-2xs">
                              ЕТС
                            </span>
                            {p.colC && p.colC.trim().toUpperCase() !== 'ЕТС' && p.colC.trim().toUpperCase() !== 'ETC' && p.colC.trim().toUpperCase() !== 'ETS' && (
                              <span className="text-xs text-slate-700">{p.colC}</span>
                            )}
                          </div>
                        ) : (
                          p.colC || '—'
                        )}
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
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${getProjectStatusBadgeClass(
                              p.colF
                            )}`}
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
                      <td className="p-2.5 border-r border-slate-200 text-center font-mono text-slate-700 whitespace-nowrap">
                        {formatInvoiceDate(p.colH)}
                      </td>

                      {/* Col I */}
                      <td className="p-2.5 border-r border-slate-200 text-right font-mono text-slate-700 whitespace-nowrap">
                        {p.colI ? (
                          isRateConverted(p) ? (
                            <span className="inline-flex items-center gap-1 font-semibold text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200" title="Курс валют (не дорівнює 1)">
                              {p.colI}
                            </span>
                          ) : (
                            p.colI
                          )
                        ) : (
                          '—'
                        )}
                      </td>

                      {/* Col M */}
                      <td className="p-2.5 border-r border-slate-200 text-right font-mono text-slate-600 whitespace-nowrap">
                        <div className="flex flex-col items-end">
                          <span className="font-semibold text-slate-900">
                            {getProjectBudget(p) > 0 
                              ? formatCurrency(getProjectBudget(p)) 
                              : (p.colM || '—')}
                          </span>
                          {isRateConverted(p) && (
                            <span className="text-[10px] text-blue-600 font-normal">
                              ({p.colM} × {p.colI})
                            </span>
                          )}
                        </div>
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
                      Рядок {selectedProject.rowNumber} у {activeTabName}
                    </span>
                    {selectedProject.colF && (
                      <span className={`px-2 py-0.5 text-xs font-semibold rounded border ${getProjectStatusBadgeClass(selectedProject.colF)}`}>
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
                  <span className="font-mono font-bold text-blue-950 text-xs">
                    {getProjectBudget(selectedProject) > 0 ? formatCurrency(getProjectBudget(selectedProject)) : (selectedProject.colM || '—')}
                  </span>
                  {isRateConverted(selectedProject) && (
                    <span className="text-[10px] text-blue-700 block font-mono mt-0.5">
                      ({selectedProject.colM} × {selectedProject.colI})
                    </span>
                  )}
                </div>
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="text-slate-400 block text-[11px] flex items-center gap-1">
                    <Calendar className="w-3 h-3 text-slate-400" />
                    {getHeaderTitle('colH', 'H')} (H)
                  </span>
                  <span className="font-mono font-bold text-slate-900 text-xs">
                    {formatInvoiceDate(selectedProject.colH)}
                  </span>
                </div>
                <div className={`p-3 rounded-xl border ${isRateConverted(selectedProject) ? 'bg-amber-50/80 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
                  <span className="text-slate-400 block text-[11px] flex items-center justify-between">
                    <span>{getHeaderTitle('colI', 'I')} (I)</span>
                    {isRateConverted(selectedProject) && (
                      <span className="text-[9px] font-bold text-amber-700 bg-amber-100 px-1 py-0.5 rounded">Курс ≠ 1</span>
                    )}
                  </span>
                  <span className="font-mono font-bold text-slate-900 text-xs">{selectedProject.colI || '—'}</span>
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

              {/* 📅 Графік оплат (План надходжень - 4 транші, колонки Z..AG) */}
              <ProjectPaymentSchedule
                project={selectedProject}
                sheetConfig={sheetConfig}
                authState={authState}
                activeTabName={activeDataSource === 'plan' ? 'План' : 'Лист1'}
                onUpdateProject={(updated) => {
                  setSelectedProject(updated);
                  setProjects((prev) =>
                    prev.map((p) => (p.rowNumber === updated.rowNumber ? updated : p))
                  );
                  if (onProjectsChange) {
                    onProjectsChange(
                      projects.map((p) => (p.rowNumber === updated.rowNumber ? updated : p))
                    );
                  }
                }}
              />
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
        existingManagers={memoizedManagers}
        existingProjectNumbers={memoizedProjectNumbers}
        existingProjects={projects}
        planSheetConfig={planSheetConfig}
        onPlanSheetConfigChange={setPlanSheetConfig}
        sheetConfig={sheetConfig}
        accessToken={authState?.accessToken}
        spreadsheetId={sheetConfig?.spreadsheetId || DEFAULT_PROJECTS_SPREADSHEET_ID}
        canWriteToSheets={canWriteToSheets}
        onProjectAdded={async (newRowIndex, projNum) => {
          // Immediately reload latest project rows from active Google Sheet
          if (activeDataSource === 'plan') {
            await handleLoadPlanSheet();
          } else {
            await handleLoadPaymentsSheet();
          }
        }}
      />
    </div>
  );
};
