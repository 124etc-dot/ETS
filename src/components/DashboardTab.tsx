import React, { useState, useMemo } from 'react';
import { 
  BarChart3, 
  Briefcase, 
  FileSpreadsheet, 
  Factory, 
  FileText, 
  CheckCircle2, 
  Clock, 
  ArrowUpRight, 
  TrendingUp, 
  DollarSign, 
  Building2, 
  Layers, 
  ExternalLink,
  ChevronRight,
  ShieldCheck,
  FolderSync,
  RefreshCw,
  Search,
  Filter,
  Calendar,
  User,
  Check,
  Eye,
  X,
  Sparkles,
  ChevronDown
} from 'lucide-react';
import { ExistingSheetRow, OverheadExpenseRow, ProcessedDocument, ProjectSheetRow, ProjectColumnHeader, SheetConfig } from '../types';
import { AuthState } from '../services/googleAuth';
import { SAMPLE_PROJECT_ROWS } from '../data/sampleProjects';

interface Props {
  sheetConfig: SheetConfig | null;
  authState: AuthState;
  onSelectTab: (tab: 'dashboard' | 'process' | 'sheet' | 'companies' | 'history' | 'projects' | 'overhead') => void;
  existingInvoices: ExistingSheetRow[];
  existingPayments: any[];
  overheadExpenses: OverheadExpenseRow[];
  documents: ProcessedDocument[];
  companyLists?: any;
  projects?: ProjectSheetRow[];
  projectHeaders?: ProjectColumnHeader[];
  isLoadingProjects?: boolean;
  isLiveProjectsFromSheet?: boolean;
  projectsLastSyncTime?: string | null;
  activeProjectsSource?: 'payments' | 'plan';
  onRefreshProjects?: (source?: 'payments' | 'plan') => Promise<void>;
  onSwitchProjectsSource?: (source: 'payments' | 'plan') => void;
}

export const DashboardTab: React.FC<Props> = ({
  sheetConfig,
  authState,
  onSelectTab,
  existingInvoices,
  existingPayments,
  overheadExpenses,
  documents,
  projects: realProjectsProp,
  projectHeaders,
  isLoadingProjects = false,
  isLiveProjectsFromSheet = false,
  projectsLastSyncTime,
  activeProjectsSource = 'payments',
  onRefreshProjects,
  onSwitchProjectsSource,
}) => {
  // Use real projects if provided, otherwise fallback
  const projectRows = realProjectsProp && realProjectsProp.length > 0 ? realProjectsProp : SAMPLE_PROJECT_ROWS;

  const getHeaderTitle = (key: string, fallbackLetter: string) => {
    const h = projectHeaders?.find((header) => header.key === key);
    if (h && h.title) return h.title;
    if (key === 'colH') return 'Дата рахунку';
    return `Колонка ${fallbackLetter}`;
  };

  // Helper to format invoice date (Колонка H - Дата рахунку)
  const formatInvoiceDate = (val?: string | number): string => {
    if (val === undefined || val === null) return '—';
    const str = String(val).trim();
    if (!str || str === '-' || str === '—') return '—';

    // If it's an Excel serial date number (e.g. 40000 to 55000)
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

    // If format is YYYY-MM-DD or YYYY.MM.DD
    const isoMatch = str.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/);
    if (isoMatch) {
      const [, y, m, d] = isoMatch;
      return `${d.padStart(2, '0')}.${m.padStart(2, '0')}.${y}`;
    }

    // If format is DD.MM.YYYY or DD-MM-YYYY
    const dmyMatch = str.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{2,4})$/);
    if (dmyMatch) {
      const [, d, m, y] = dmyMatch;
      return `${d.padStart(2, '0')}.${m.padStart(2, '0')}.${y.length === 2 ? '20' + y : y}`;
    }

    // If format is DD,MM or DD.MM (e.g., "19,08" or "19.08" for project №208-26)
    const dmMatch = str.match(/^(\d{1,2})[,.](\d{1,2})$/);
    if (dmMatch) {
      const [, d, m] = dmMatch;
      return `${d.padStart(2, '0')}.${m.padStart(2, '0')}`;
    }

    // Fallback: cleaned text, never adding currency suffix
    return str.replace(/[₴$€]|грн/gi, '').trim() || '—';
  };

  // Local search and filter for concise projects list
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'in_progress' | 'completed'>('all');
  const [visibleCount, setVisibleCount] = useState(6);
  const [selectedProject, setSelectedProject] = useState<ProjectSheetRow | null>(null);

  // Helper number parser
  const parseAmount = (val?: string | number): number => {
    if (typeof val === 'number') return isNaN(val) ? 0 : val;
    if (!val) return 0;
    const clean = String(val).replace(/\s+/g, '').replace(/,/g, '.').replace(/[^\d.-]/g, '');
    const num = parseFloat(clean);
    return isNaN(num) ? 0 : num;
  };

  const formatCurrency = (val: number): string => {
    return new Intl.NumberFormat('uk-UA', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(val);
  };

  // Helper to format or display values from sheet columns (M, N, V, Y)
  const formatValueDisplay = (val?: string | number, isMargin = false): string => {
    if (val === undefined || val === null) return '0,00 грн';
    const str = String(val).trim();
    if (!str || str === '-' || str === '—') return '0,00 грн';

    // If it's already formatted with percentage (e.g. '44,98%' or '35%')
    if (str.includes('%')) {
      return str;
    }

    const num = parseAmount(str);
    if (isNaN(num)) return str;

    // If it's column Y and a decimal ratio between -1 and 1
    if (isMargin && Math.abs(num) > 0 && Math.abs(num) <= 1 && !str.includes(' ') && !str.includes(',')) {
      return `${(num * 100).toFixed(1).replace('.', ',')}%`;
    }

    return `${formatCurrency(num)} грн`;
  };

  // Helper for status badge
  const isStatusDone = (status?: string | null): boolean => {
    if (!status) return false;
    const s = status.toLowerCase().trim();
    return s.includes('здан') || s.includes('заверш') || s.includes('виконан') || s.includes('закрито');
  };

  const getStatusBadge = (status?: string | null) => {
    if (!status) {
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-50 text-slate-500 border border-slate-200">
          Без статусу
        </span>
      );
    }
    const isDone = isStatusDone(status);

    return (
      <span
        className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
          isDone
            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
            : 'bg-blue-50 text-blue-700 border-blue-200'
        }`}
      >
        {status}
      </span>
    );
  };

  // Helper to extract effective budget (Сума проекту / замовлення в грн)
  // Правило перерахунку курсу валют: множимо колонку І на колонку М
  const getProjectBudget = (p: ProjectSheetRow): number => {
    if (p.effectiveProjectSum && p.effectiveProjectSum > 0) {
      return p.effectiveProjectSum;
    }
    const rate = parseAmount(p.colI);
    const isRateActive = rate > 0 && Math.abs(rate - 1) > 0.0001;
    const numM = parseAmount(p.colM);
    const base = numM > 0 ? numM : 0;

    if (isRateActive) {
      return base * rate;
    }

    return base;
  };

  const isRateConverted = (p: ProjectSheetRow): boolean => {
    if (p.isCurrencyConverted !== undefined) return p.isCurrencyConverted;
    const rate = parseAmount(p.colI);
    return rate > 0 && Math.abs(rate - 1) > 0.0001;
  };

  const formatProjectBudget = (p: ProjectSheetRow): string => {
    const budget = getProjectBudget(p);
    if (budget <= 0) return '0 ₴';
    return `${budget.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₴`;
  };

  // Helper to extract margin percentage for dynamic coloring
  const getMarginPercentValue = (p: ProjectSheetRow): number | null => {
    if (p.colY !== undefined && p.colY !== null) {
      const str = String(p.colY).trim();
      if (str && str !== '-' && str !== '—') {
        if (str.includes('%')) {
          const cleaned = str.replace('%', '').replace(/\s+/g, '').replace(',', '.');
          const parsed = parseFloat(cleaned);
          if (!isNaN(parsed)) return parsed;
        }
        const num = parseAmount(str);
        if (!isNaN(num)) {
          // If decimal ratio between -1 and 1
          if (Math.abs(num) > 0 && Math.abs(num) <= 1 && !str.includes(' ') && (!str.includes(',') || num < 1)) {
            return num * 100;
          }
          // If amount greater than 100 and budget is known
          const budget = getProjectBudget(p);
          if (num > 100 && budget > 0 && !str.includes('%')) {
            return (num / budget) * 100;
          }
          return num;
        }
      }
    }

    const budget = getProjectBudget(p);
    const exp = parseAmount(p.colV) > 0 
      ? parseAmount(p.colV) 
      : (p.sumQRST || (parseAmount(p.colQ) + parseAmount(p.colR) + parseAmount(p.colS) + parseAmount(p.colT)));
    if (budget > 0) {
      return ((budget - exp) / budget) * 100;
    }
    return null;
  };

  // Helper for dynamic styles of "МАРЖИНАЛЬНІСТЬ (Y)"
  // < 20% 🔴: Background #FEE2E2, Border #DC2626, Text #991B1B
  // 20% - 25% 🟡: Background #FEF3C7, Border #D97706, Text #92400E
  // > 25% 🟢: Background #E6F9F0, Border #00A86B, Text #059669
  const getMarginBoxStyle = (margin: number | null) => {
    if (margin !== null && margin < 20) {
      return {
        containerStyle: {
          backgroundColor: '#FEE2E2',
          borderColor: '#DC2626',
        },
        labelStyle: {
          color: '#991B1B',
        },
        valueStyle: {
          color: '#991B1B',
        },
      };
    } else if (margin !== null && margin >= 20 && margin <= 25) {
      return {
        containerStyle: {
          backgroundColor: '#FEF3C7',
          borderColor: '#D97706',
        },
        labelStyle: {
          color: '#92400E',
        },
        valueStyle: {
          color: '#92400E',
        },
      };
    } else {
      return {
        containerStyle: {
          backgroundColor: '#E6F9F0',
          borderColor: '#00A86B',
        },
        labelStyle: {
          color: '#059669',
        },
        valueStyle: {
          color: '#059669',
        },
      };
    }
  };

  // 1. Projects metrics calculated from REAL projects using columns M, N, V, Y
  const projectsStats = useMemo(() => {
    const total = projectRows.length;
    let inProgress = 0;
    let completed = 0;
    let totalProjectSum = 0; // Колонка M
    let totalRemainder = 0;  // Колонка N
    let totalExpenses = 0;   // Колонка V

    projectRows.forEach((p) => {
      if (isStatusDone(p.colF)) {
        completed++;
      } else {
        inProgress++;
      }

      // 3. Сума проекту (колонка М з урахуванням курсу валют)
      const sumM = getProjectBudget(p);
      // 4. Залишок (колонка N)
      const remN = parseAmount(p.colN);
      // 5. Загальні витрати (колонка V)
      const expV = parseAmount(p.colV) > 0 
        ? parseAmount(p.colV) 
        : (p.sumQRST || (parseAmount(p.colQ) + parseAmount(p.colR) + parseAmount(p.colS) + parseAmount(p.colT)));

      totalProjectSum += sumM;
      totalRemainder += remN;
      totalExpenses += expV;
    });

    const overallMargin = totalProjectSum > 0 ? (totalProjectSum - totalExpenses) : 0;
    const marginPercent = totalProjectSum > 0 ? Math.round((overallMargin / totalProjectSum) * 100) : 0;

    return {
      total,
      inProgress,
      completed,
      totalProjectSum,
      totalRemainder,
      totalExpenses,
      overallMargin,
      marginPercent,
    };
  }, [projectRows]);

  // Filtered list of real projects for concise view
  const filteredProjects = useMemo(() => {
    return projectRows.filter((p) => {
      // Status filter
      if (statusFilter === 'completed' && !isStatusDone(p.colF)) return false;
      if (statusFilter === 'in_progress' && isStatusDone(p.colF)) return false;

      // Text search
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchNumber = String(p.colA || '').toLowerCase().includes(query);
        const matchTitleB = String(p.colB || '').toLowerCase().includes(query);
        const matchTitleC = String(p.colC || '').toLowerCase().includes(query);
        const matchManager = String(p.colG || '').toLowerCase().includes(query);
        return matchNumber || matchTitleB || matchTitleC || matchManager;
      }

      return true;
    });
  }, [projectRows, statusFilter, searchQuery]);

  // 2. Invoices metrics
  const invoiceStats = useMemo(() => {
    const totalCount = existingInvoices.length;
    let totalAmount = 0;
    let totalPaid = 0;
    let paidCount = 0;
    let pendingCount = 0;
    let partialCount = 0;

    existingInvoices.forEach((inv) => {
      const amt = Number(inv.amount) || 0;
      const pd = Number(inv.paidAmount) || 0;
      totalAmount += amt;
      totalPaid += pd;

      if (inv.paymentStatus === 'Оплачено') {
        paidCount++;
      } else if (inv.paymentStatus === 'Оплачено частково') {
        partialCount++;
      } else {
        pendingCount++;
      }
    });

    const remainingToPay = Math.max(0, totalAmount - totalPaid);
    const paidPercentage = totalAmount > 0 ? Math.round((totalPaid / totalAmount) * 100) : 0;

    return {
      totalCount,
      totalAmount,
      totalPaid,
      remainingToPay,
      paidCount,
      pendingCount,
      partialCount,
      paidPercentage,
    };
  }, [existingInvoices]);

  // 3. Overhead metrics
  const overheadStats = useMemo(() => {
    const totalRecords = overheadExpenses.length;
    let totalAmount = 0;
    let totalPaid = 0;

    overheadExpenses.forEach((exp) => {
      totalAmount += Number(exp.amount) || 0;
      totalPaid += Number(exp.paidAmount) || 0;
    });

    return {
      totalRecords,
      totalAmount,
      totalPaid,
    };
  }, [overheadExpenses]);

  // 4. OCR Documents metrics
  const docStats = useMemo(() => {
    const total = documents.length;
    const pending = documents.filter(d => d.status === 'pending' || d.status === 'scanning' || d.status === 'review_needed').length;
    const ready = documents.filter(d => d.status === 'ready_to_sync').length;
    const synced = documents.filter(d => d.status === 'synced').length;

    return { total, pending, ready, synced };
  }, [documents]);

  return (
    <div className="space-y-6 pb-12 animate-fadeIn">
      {/* Top Banner / Welcome Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center space-x-3.5">
          <div className="w-11 h-11 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
            <BarChart3 className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
                Головний дашборд
              </h1>
              <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                Огляд системи
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              Аналітика реальних проєктів, фінансовий стан рахунків, витрати цеху та черга OCR
            </p>
          </div>
        </div>

        {/* Quick Connection & Real Data Pills */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Projects Data Status Pill */}
          {isLiveProjectsFromSheet ? (
            <div 
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-800 rounded-xl border border-emerald-200 text-xs font-semibold"
              title={`Реальні дані з таблиці «${activeProjectsSource === 'plan' ? 'План відвантажень' : 'Оплати/Борги (Лист1)'}». Оновлено: ${projectsLastSyncTime || 'нещодавно'}`}
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>
                Проєкти: {activeProjectsSource === 'plan' ? 'План' : 'Лист1'} ({projectRows.length})
              </span>
            </div>
          ) : (
            <div 
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-xl border border-blue-200 text-xs font-medium"
              title="Дані проєктів із локального кешу"
            >
              <Briefcase className="w-3.5 h-3.5 text-blue-600" />
              <span>Проєкти: {projectRows.length} записів</span>
            </div>
          )}

          {sheetConfig?.isConfigured ? (
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 text-slate-700 rounded-xl border border-slate-200 text-xs font-semibold">
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
              <span className="max-w-[130px] truncate">{sheetConfig.spreadsheetTitle || 'Таблиця OK'}</span>
            </div>
          ) : (
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 text-slate-600 rounded-xl border border-slate-200 text-xs font-medium">
              <FileSpreadsheet className="w-3.5 h-3.5 text-slate-400" />
              <span>Таблиця не налаштована</span>
            </div>
          )}

          {authState.isAuthenticated ? (
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-xl border border-indigo-200 text-xs font-semibold">
              <ShieldCheck className="w-3.5 h-3.5 text-indigo-600" />
              <span>Google OK</span>
            </div>
          ) : (
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 text-amber-800 rounded-xl border border-amber-200 text-xs font-medium">
              <FolderSync className="w-3.5 h-3.5 text-amber-600" />
              <span>Вхід Google</span>
            </div>
          )}
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Реальні Проєкти */}
        <div 
          onClick={() => onSelectTab('projects')}
          className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs hover:border-blue-300 hover:shadow-md transition-all cursor-pointer group relative overflow-hidden"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Проєкти {isLiveProjectsFromSheet ? '• Real' : ''}
            </span>
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center group-hover:scale-110 transition-transform">
              <Briefcase className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <div className="text-2xl font-bold text-slate-900 font-mono">
              {projectsStats.total}
            </div>
            <div className="flex items-center space-x-1.5">
              <span className="text-[11px] px-1.5 py-0.5 bg-blue-50 text-blue-700 font-semibold rounded border border-blue-200">
                {projectsStats.inProgress} в роботі
              </span>
              <span className="text-[11px] px-1.5 py-0.5 bg-emerald-50 text-emerald-700 font-semibold rounded border border-emerald-200">
                {projectsStats.completed} здано
              </span>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
            <span className="text-slate-500">Сума проєктів (М):</span>
            <span className="font-semibold text-slate-900 font-mono">
              {formatCurrency(projectsStats.totalProjectSum)} грн
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between text-xs">
            <span className="text-slate-500">Загальні витрати (V):</span>
            <span className="font-medium text-rose-700 font-mono">
              {formatCurrency(projectsStats.totalExpenses)} грн
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between text-xs">
            <span className="text-slate-500">Залишок (N):</span>
            <span className="font-medium text-amber-700 font-mono">
              {formatCurrency(projectsStats.totalRemainder)} грн
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between text-xs">
            <span className="text-slate-500">Маржинальність (Y):</span>
            <span className="font-bold text-emerald-600 font-mono">
              +{formatCurrency(projectsStats.overallMargin)} грн ({projectsStats.marginPercent}%)
            </span>
          </div>
        </div>

        {/* KPI 2: Рахунки та Оплати */}
        <div 
          onClick={() => onSelectTab('sheet')}
          className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs hover:border-emerald-300 hover:shadow-md transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Рахунки & Оплати</span>
            <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center group-hover:scale-110 transition-transform">
              <FileSpreadsheet className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <div className="text-2xl font-bold text-slate-900 font-mono">
              {invoiceStats.totalCount}
            </div>
            <span className="text-xs text-slate-500">рахунків у базі</span>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
            <span className="text-slate-500">Загальна сума:</span>
            <span className="font-semibold text-slate-900 font-mono">
              {formatCurrency(invoiceStats.totalAmount)} грн
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between text-xs">
            <span className="text-emerald-700 font-medium">Сплачено:</span>
            <span className="font-bold text-emerald-700 font-mono">
              {formatCurrency(invoiceStats.totalPaid)} грн ({invoiceStats.paidPercentage}%)
            </span>
          </div>
        </div>

        {/* KPI 3: Витрати Цеху */}
        <div 
          onClick={() => onSelectTab('overhead')}
          className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs hover:border-amber-300 hover:shadow-md transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Витрати Цеху</span>
            <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center group-hover:scale-110 transition-transform">
              <Factory className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <div className="text-2xl font-bold text-slate-900 font-mono">
              {overheadStats.totalRecords}
            </div>
            <span className="text-xs text-slate-500">записів витрат</span>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
            <span className="text-slate-500">Всього витрат:</span>
            <span className="font-semibold text-slate-900 font-mono">
              {formatCurrency(overheadStats.totalAmount)} грн
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between text-xs">
            <span className="text-slate-500">Оплачено:</span>
            <span className="font-bold text-amber-700 font-mono">
              {formatCurrency(overheadStats.totalPaid)} грн
            </span>
          </div>
        </div>

        {/* KPI 4: Черга обробки OCR */}
        <div 
          onClick={() => onSelectTab('process')}
          className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs hover:border-indigo-300 hover:shadow-md transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Черга OCR</span>
            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center group-hover:scale-110 transition-transform">
              <FileText className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <div className="text-2xl font-bold text-slate-900 font-mono">
              {docStats.total}
            </div>
            <span className="text-xs text-slate-500">документів</span>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
            <span className="text-slate-500">Очікують / готові:</span>
            <span className="font-semibold text-indigo-700 font-mono">
              {docStats.pending + docStats.ready} в черзі
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between text-xs">
            <span className="text-slate-500">Внесено в Таблицю:</span>
            <span className="font-bold text-emerald-600 font-mono">
              {docStats.synced} документів
            </span>
          </div>
        </div>
      </div>

      {/* Main Analytics Grid: Real Projects Concise Monitor (2 cols) & Invoices Balance (1 col) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Module 1: Реальні дані проєктів у стислому вигляді (2 cols) */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs flex flex-col justify-between">
          <div>
            {/* Section Header with Data Source Switcher & Refresh */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-100 gap-3">
              <div className="flex items-center space-x-2.5">
                <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                  <Briefcase className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <span>Моніторинг виконання та бюджету проєктів</span>
                    {isLiveProjectsFromSheet && (
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" title="Дані з Google Таблиці" />
                    )}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Джерело: {activeProjectsSource === 'plan' ? 'Таблиця «План відвантажень» (від рядка 2094)' : 'Таблиця «Оплати/Борги» (Лист1, від рядка 111)'}
                    {projectsLastSyncTime && ` • Оновлено о ${projectsLastSyncTime}`}
                  </p>
                </div>
              </div>

              {/* Data Controls: Source Switcher & Refresh Button */}
              <div className="flex items-center space-x-1.5 self-end sm:self-center">
                {onSwitchProjectsSource && (
                  <div className="flex items-center p-0.5 bg-slate-100 rounded-lg border border-slate-200 text-xs">
                    <button
                      type="button"
                      onClick={() => onSwitchProjectsSource('payments')}
                      className={`px-2 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer ${
                        activeProjectsSource === 'payments'
                          ? 'bg-white text-slate-900 shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Лист1
                    </button>
                    <button
                      type="button"
                      onClick={() => onSwitchProjectsSource('plan')}
                      className={`px-2 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer ${
                        activeProjectsSource === 'plan'
                          ? 'bg-white text-slate-900 shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      План
                    </button>
                  </div>
                )}

                {onRefreshProjects && (
                  <button
                    type="button"
                    onClick={() => onRefreshProjects(activeProjectsSource)}
                    disabled={isLoadingProjects || !authState.accessToken}
                    className="p-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-600 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                    title="Оновити дані проєктів з Google Sheets"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoadingProjects ? 'animate-spin text-blue-600' : ''}`} />
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => onSelectTab('projects')}
                  className="text-xs text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-1 pl-1 cursor-pointer transition-colors"
                >
                  <span>Усі</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Status distribution ratio bar */}
            <div className="mt-4 p-3.5 bg-slate-50/80 rounded-xl border border-slate-200/80">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-700 mb-2">
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span>
                  В роботі: {projectsStats.inProgress} ({Math.round((projectsStats.inProgress / (projectsStats.total || 1)) * 100)}%)
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                  Здано: {projectsStats.completed} ({Math.round((projectsStats.completed / (projectsStats.total || 1)) * 100)}%)
                </span>
              </div>
              <div className="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden flex">
                <div 
                  className="bg-blue-500 transition-all duration-500"
                  style={{ width: `${(projectsStats.inProgress / (projectsStats.total || 1)) * 100}%` }}
                  title={`В роботі: ${projectsStats.inProgress}`}
                />
                <div 
                  className="bg-emerald-500 transition-all duration-500"
                  style={{ width: `${(projectsStats.completed / (projectsStats.total || 1)) * 100}%` }}
                  title={`Здано: ${projectsStats.completed}`}
                />
              </div>
            </div>

            {/* Quick Filters & Search for Concise List */}
            <div className="mt-3.5 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
              {/* Filter Pills */}
              <div className="flex items-center space-x-1 overflow-x-auto no-scrollbar pb-1 sm:pb-0">
                <button
                  type="button"
                  onClick={() => setStatusFilter('all')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    statusFilter === 'all'
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  Всі ({projectRows.length})
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('in_progress')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    statusFilter === 'in_progress'
                      ? 'bg-blue-600 text-white'
                      : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                  }`}
                >
                  В роботі ({projectsStats.inProgress})
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('completed')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    statusFilter === 'completed'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                  }`}
                >
                  Здано ({projectsStats.completed})
                </button>
              </div>

              {/* Compact Search Input */}
              <div className="relative min-w-[180px] sm:w-48">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Пошук проєкту..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-2.5 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-hidden focus:bg-white focus:border-blue-500 transition-colors"
                />
              </div>
            </div>

            {/* Concise Real Projects List */}
            <div className="mt-3.5 space-y-2.5">
              {filteredProjects.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                  За запитом не знайдено проєктів
                </div>
              ) : (
                filteredProjects.slice(0, visibleCount).map((p, idx) => {
                  const budget = getProjectBudget(p);
                  const exp = parseAmount(p.colV) > 0 
                    ? parseAmount(p.colV) 
                    : (p.sumQRST || (parseAmount(p.colQ) + parseAmount(p.colR) + parseAmount(p.colS) + parseAmount(p.colT)));
                  const expPercent = budget > 0 ? Math.min(100, Math.round((exp / budget) * 100)) : 0;
                  const marginCalc = Math.max(0, budget - exp);
                  const marginPercentCalc = budget > 0 ? Math.round((marginCalc / budget) * 100) : 0;

                  return (
                    <div 
                      key={p.rowNumber || idx}
                      onClick={() => setSelectedProject(p)}
                      className="p-3.5 bg-white hover:bg-slate-50/90 rounded-xl border border-slate-200/90 transition-all cursor-pointer hover:shadow-xs group hover:border-blue-300"
                    >
                      {/* Top Row: 1. Номер (кол. А) + 2. Назва (кол. В) + Статус */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 pb-2.5 border-b border-slate-100">
                        <div className="flex items-center space-x-2 truncate">
                          {/* 1. Номер проекта - колонка А */}
                          <span className="font-bold text-slate-900 font-mono shrink-0 bg-slate-100 group-hover:bg-blue-50 group-hover:text-blue-700 group-hover:border-blue-200 px-2 py-0.5 rounded text-xs border border-slate-200 transition-colors">
                            #{p.colA || p.rowNumber}
                          </span>
                          {/* 2. Назва проекту - колонка В */}
                          <div className="truncate">
                            <span className="font-semibold text-slate-900 text-xs sm:text-sm truncate block">
                              {p.colB || p.colC || 'Без назви'}
                            </span>
                            {p.colC && p.colB && p.colC !== p.colB && (
                              <span className="text-[11px] text-slate-500 truncate block">
                                {p.colC}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center space-x-2 self-start sm:self-auto shrink-0">
                          {getStatusBadge(p.colF)}
                          {p.colG && (
                            <span className="hidden md:inline-flex text-[11px] text-slate-500 items-center gap-1">
                              <User className="w-3 h-3 text-slate-400" />
                              <span className="truncate max-w-[110px]">{p.colG}</span>
                            </span>
                          )}
                          {p.colE && (
                            <span className="text-[10px] text-slate-500 font-mono hidden sm:inline-flex items-center gap-0.5">
                              <Calendar className="w-2.5 h-2.5 text-slate-400" />
                              {p.colE}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* 4 Financial Columns Grid: M, N, V, Y */}
                      <div className="mt-2.5 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                        {/* 3. Сума проекту - колонка М */}
                        <div className="p-2 rounded-lg bg-slate-50 border border-slate-100 group-hover:border-blue-100 transition-colors">
                          <span className="text-[10px] uppercase font-semibold text-slate-500 tracking-wider block">
                            Сума проєкту (М)
                          </span>
                          <span className="font-bold font-mono text-slate-900 text-xs sm:text-[13px] block mt-0.5 truncate">
                            {formatProjectBudget(p)}
                          </span>
                          {isRateConverted(p) && (
                            <span className="text-[10px] text-blue-600 font-mono block mt-0.5 font-medium truncate" title="Сума проєкту (М) помножена на курс валют (І)">
                              ({formatValueDisplay(p.colM)} × {p.colI})
                            </span>
                          )}
                        </div>

                        {/* 4. Залишок - колонка N */}
                        <div className="p-2 rounded-lg bg-slate-50 border border-slate-100 group-hover:border-amber-100 transition-colors">
                          <span className="text-[10px] uppercase font-semibold text-slate-500 tracking-wider block">
                            Залишок (N)
                          </span>
                          <span className="font-bold font-mono text-amber-800 text-xs sm:text-[13px] block mt-0.5 truncate">
                            {formatValueDisplay(p.colN)}
                          </span>
                        </div>

                        {/* 5. Загальні витрати - колонка V */}
                        <div className="p-2 rounded-lg bg-slate-50 border border-slate-100 group-hover:border-rose-100 transition-colors">
                          <span className="text-[10px] uppercase font-semibold text-slate-500 tracking-wider block">
                            Загальні витрати (V)
                          </span>
                          <span className="font-bold font-mono text-rose-700 text-xs sm:text-[13px] block mt-0.5 truncate">
                            {formatValueDisplay(p.colV || p.sumQRST)}
                          </span>
                        </div>

                        {/* 6. Маржинальність - колонка Y (динамічні кольори: <20% червоний, 20-25% жовтий, >25% зелений) */}
                        {(() => {
                          const marginVal = getMarginPercentValue(p);
                          const mStyle = getMarginBoxStyle(marginVal);
                          return (
                            <div 
                              className="p-2 rounded-lg border transition-all duration-200"
                              style={mStyle.containerStyle}
                            >
                              <span 
                                className="text-[10px] uppercase font-semibold tracking-wider block"
                                style={mStyle.labelStyle}
                              >
                                Маржинальність (Y)
                              </span>
                              <span 
                                className="font-bold font-mono text-xs sm:text-[13px] block mt-0.5 truncate"
                                style={mStyle.valueStyle}
                              >
                                {formatValueDisplay(p.colY || (marginPercentCalc ? `${marginPercentCalc}%` : ''), true)}
                              </span>
                            </div>
                          );
                        })()}
                      </div>

                      {/* Visual progress indicator of expenses vs project sum */}
                      {budget > 0 && (
                        <div className="mt-2.5 w-full bg-slate-100 rounded-full h-1.5 overflow-hidden flex">
                          <div 
                            className={`h-full rounded-full transition-all duration-300 ${
                              expPercent > 95 ? 'bg-rose-500' : expPercent > 80 ? 'bg-amber-500' : 'bg-blue-600'
                            }`}
                            style={{ width: `${expPercent}%` }}
                            title={`Витрати: ${expPercent}% від суми проєкту`}
                          />
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Bottom Actions of Projects Module */}
          <div className="mt-4 pt-3 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-2.5">
            <span className="text-xs text-slate-500">
              Показано {Math.min(visibleCount, filteredProjects.length)} із {filteredProjects.length} реальних проєктів
            </span>

            <div className="flex items-center space-x-2">
              {filteredProjects.length > visibleCount && (
                <button
                  type="button"
                  onClick={() => setVisibleCount((prev) => prev + 6)}
                  className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <span>Показати ще</span>
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              )}

              <button
                type="button"
                onClick={() => onSelectTab('projects')}
                className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <span>Відкрити повну таблицю</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Module 2: Фінансовий баланс Рахунків (1 col) */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center space-x-2">
                <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                <h3 className="text-sm font-bold text-slate-900">
                  Баланс оплати рахунків
                </h3>
              </div>
              <button
                onClick={() => onSelectTab('sheet')}
                className="text-xs text-emerald-700 hover:text-emerald-900 font-semibold flex items-center gap-1 cursor-pointer transition-colors"
              >
                <span>Деталі</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Visual breakdown cards */}
            <div className="mt-4 space-y-3">
              <div className="p-3.5 bg-emerald-50/60 rounded-xl border border-emerald-200/80">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-emerald-900 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    Оплачено постачальникам
                  </span>
                  <span className="font-mono font-bold text-emerald-800 text-sm">
                    {formatCurrency(invoiceStats.totalPaid)} грн
                  </span>
                </div>
                <div className="w-full bg-emerald-200/60 rounded-full h-2 mt-2.5 overflow-hidden">
                  <div 
                    className="bg-emerald-600 h-full rounded-full"
                    style={{ width: `${invoiceStats.paidPercentage}%` }}
                  />
                </div>
                <div className="mt-1 text-right text-[10px] text-emerald-700 font-mono font-semibold">
                  {invoiceStats.paidPercentage}% від загальної суми
                </div>
              </div>

              <div className="p-3.5 bg-amber-50/60 rounded-xl border border-amber-200/80">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-amber-900 flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-amber-600" />
                    Залишок до сплати
                  </span>
                  <span className="font-mono font-bold text-amber-900 text-sm">
                    {formatCurrency(invoiceStats.remainingToPay)} грн
                  </span>
                </div>
                <div className="w-full bg-amber-200/60 rounded-full h-2 mt-2.5 overflow-hidden">
                  <div 
                    className="bg-amber-500 h-full rounded-full"
                    style={{ width: `${100 - invoiceStats.paidPercentage}%` }}
                  />
                </div>
                <div className="mt-1 text-right text-[10px] text-amber-700 font-mono font-semibold">
                  {100 - invoiceStats.paidPercentage}% очікує оплати
                </div>
              </div>

              {/* Status Breakdown Counters */}
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80 space-y-2">
                <div className="text-xs font-semibold text-slate-700">
                  Розподіл за статусами:
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-600 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    Повністю оплачено
                  </span>
                  <span className="font-mono font-bold text-slate-900">{invoiceStats.paidCount}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-600 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                    Оплачено частково
                  </span>
                  <span className="font-mono font-bold text-slate-900">{invoiceStats.partialCount}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-600 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                    Не оплачено
                  </span>
                  <span className="font-mono font-bold text-slate-900">{invoiceStats.pendingCount}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100">
            <button
              onClick={() => onSelectTab('sheet')}
              className="w-full py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <span>Перейти до реєстру рахунків</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Quick Navigation Shortcuts Section */}
      <div className="bg-slate-50/80 rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs">
        <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
          <Layers className="w-4 h-4 text-indigo-600" />
          <span>Швидкий перехід до модулів ETS PROJECTS</span>
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <button
            onClick={() => onSelectTab('projects')}
            className="p-3 bg-white hover:bg-blue-50 border border-slate-200 hover:border-blue-200 rounded-xl text-left transition-all group cursor-pointer"
          >
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center mb-2 group-hover:scale-105 transition-transform">
              <Briefcase className="w-4 h-4" />
            </div>
            <div className="text-xs font-bold text-slate-900">Проєкти</div>
            <div className="text-[11px] text-slate-500 mt-0.5">Лист1 & План</div>
          </button>

          <button
            onClick={() => onSelectTab('sheet')}
            className="p-3 bg-white hover:bg-emerald-50 border border-slate-200 hover:border-emerald-200 rounded-xl text-left transition-all group cursor-pointer"
          >
            <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center mb-2 group-hover:scale-105 transition-transform">
              <FileSpreadsheet className="w-4 h-4" />
            </div>
            <div className="text-xs font-bold text-slate-900">Рахунки & Оплати</div>
            <div className="text-[11px] text-slate-500 mt-0.5">Синхронізація</div>
          </button>

          <button
            onClick={() => onSelectTab('overhead')}
            className="p-3 bg-white hover:bg-amber-50 border border-slate-200 hover:border-amber-200 rounded-xl text-left transition-all group cursor-pointer"
          >
            <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center mb-2 group-hover:scale-105 transition-transform">
              <Factory className="w-4 h-4" />
            </div>
            <div className="text-xs font-bold text-slate-900">Витрати Цеху</div>
            <div className="text-[11px] text-slate-500 mt-0.5">Загальновиробничі</div>
          </button>

          <button
            onClick={() => onSelectTab('process')}
            className="p-3 bg-white hover:bg-indigo-50 border border-slate-200 hover:border-indigo-200 rounded-xl text-left transition-all group cursor-pointer"
          >
            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center mb-2 group-hover:scale-105 transition-transform">
              <FileText className="w-4 h-4" />
            </div>
            <div className="text-xs font-bold text-slate-900">Черга обробки</div>
            <div className="text-[11px] text-slate-500 mt-0.5">OCR рахунків</div>
          </button>

          <button
            onClick={() => onSelectTab('companies')}
            className="p-3 bg-white hover:bg-purple-50 border border-slate-200 hover:border-purple-200 rounded-xl text-left transition-all group cursor-pointer"
          >
            <div className="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center mb-2 group-hover:scale-105 transition-transform">
              <Building2 className="w-4 h-4" />
            </div>
            <div className="text-xs font-bold text-slate-900">Компанії</div>
            <div className="text-[11px] text-slate-500 mt-0.5">Довідник юросіб</div>
          </button>
        </div>
      </div>

      {/* Quick Project Detail Modal */}
      {selectedProject && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full p-6 animate-scaleIn relative">
            <button
              onClick={() => setSelectedProject(null)}
              className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center space-x-2.5 mb-3">
              {/* 1. Номер проекта - колонка А */}
              <span className="font-bold text-slate-900 font-mono bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-1 rounded-lg text-sm">
                #{selectedProject.colA || selectedProject.rowNumber}
              </span>
              {getStatusBadge(selectedProject.colF)}
              {selectedProject.colE && (
                <span className="text-xs text-slate-500 font-mono flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  {selectedProject.colE}
                </span>
              )}
            </div>

            {/* 2. Назва проекту - колонка В */}
            <div className="mb-4">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block">
                Назва проєкту (кол. B)
              </span>
              <h3 className="text-base font-bold text-slate-900 leading-snug mt-0.5">
                {selectedProject.colB || selectedProject.colC || 'Проєкт без назви'}
              </h3>
              {selectedProject.colC && selectedProject.colB && selectedProject.colC !== selectedProject.colB && (
                <p className="text-xs text-slate-500 mt-1">
                  Об'єкт / деталі: {selectedProject.colC}
                </p>
              )}
            </div>

            {/* 4 Core Financial Columns: 3 (M), 4 (N), 5 (V), 6 (Y) */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              {/* 3. Сума проекту - колонка М */}
              <div className="p-2.5 bg-blue-50/60 rounded-xl border border-blue-100">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-blue-800 block truncate" title={getHeaderTitle('colM', 'M')}>
                  3. {getHeaderTitle('colM', 'M')} (кол. М)
                </span>
                <div className="font-bold text-blue-950 font-mono text-sm mt-0.5">
                  {formatProjectBudget(selectedProject)}
                </div>
                {isRateConverted(selectedProject) && (
                  <div className="text-[11px] text-blue-700 font-mono mt-1 flex items-center gap-1.5 flex-wrap">
                    <span className="px-1.5 py-0.5 bg-blue-100/90 text-blue-800 rounded text-[10px] font-semibold">
                      Конвертовано за курсом (М × І)
                    </span>
                    <span>{formatValueDisplay(selectedProject.colM)} × {selectedProject.colI}</span>
                  </div>
                )}
              </div>

              {/* 4. Залишок - колонка N */}
              <div className="p-2.5 bg-amber-50/60 rounded-xl border border-amber-100">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-800 block truncate" title={getHeaderTitle('colN', 'N')}>
                  4. {getHeaderTitle('colN', 'N')} (кол. N)
                </span>
                <div className="font-bold text-amber-950 font-mono text-sm mt-0.5">
                  {formatValueDisplay(selectedProject.colN)}
                </div>
              </div>

              {/* 5. Загальні витрати - колонка V */}
              <div className="p-2.5 bg-rose-50/60 rounded-xl border border-rose-100">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-rose-800 block truncate" title={getHeaderTitle('colV', 'V')}>
                  5. {getHeaderTitle('colV', 'V')} (кол. V)
                </span>
                <div className="font-bold text-rose-950 font-mono text-sm mt-0.5">
                  {formatValueDisplay(selectedProject.colV || selectedProject.sumQRST)}
                </div>
              </div>

              {/* 6. Маржинальність - колонка Y (динамічні кольори: <20% червоний, 20-25% жовтий, >25% зелений) */}
              {(() => {
                const marginVal = getMarginPercentValue(selectedProject);
                const mStyle = getMarginBoxStyle(marginVal);
                return (
                  <div 
                    className="p-2.5 rounded-xl border transition-all duration-200"
                    style={mStyle.containerStyle}
                  >
                    <span 
                      className="text-[10px] font-semibold uppercase tracking-wider block truncate"
                      style={mStyle.labelStyle}
                      title={getHeaderTitle('colY', 'Y')}
                    >
                      6. {getHeaderTitle('colY', 'Y')} (кол. Y)
                    </span>
                    <div 
                      className="font-bold font-mono text-sm mt-0.5"
                      style={mStyle.valueStyle}
                    >
                      {formatValueDisplay(selectedProject.colY, true)}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Additional info: Manager (col G), Invoice date (col H), Currency rate (col I) */}
            {(selectedProject.colG || selectedProject.colH || selectedProject.colI) && (
              <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                {selectedProject.colG && (
                  <div className="p-2 bg-slate-50 rounded-lg border border-slate-100">
                    <span className="text-[10px] text-slate-500">{getHeaderTitle('colG', 'G')}:</span>
                    <div className="font-semibold text-slate-800 truncate mt-0.5">{selectedProject.colG}</div>
                  </div>
                )}
                {selectedProject.colH && (
                  <div className="p-2 bg-slate-50 rounded-lg border border-slate-100">
                    <span className="text-[10px] text-slate-500 flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-slate-400" />
                      {getHeaderTitle('colH', 'H')}:
                    </span>
                    <div className="font-semibold text-slate-800 font-mono truncate mt-0.5">
                      {formatInvoiceDate(selectedProject.colH)}
                    </div>
                  </div>
                )}
                {selectedProject.colI && (
                  <div className={`p-2 rounded-lg border ${isRateConverted(selectedProject) ? 'bg-amber-50/80 border-amber-200' : 'bg-slate-50 border-slate-100'}`}>
                    <div className="text-[10px] text-slate-500 flex items-center justify-between">
                      <span>{getHeaderTitle('colI', 'I')}:</span>
                      {isRateConverted(selectedProject) && (
                        <span className="text-[9px] font-bold text-amber-700 bg-amber-100 px-1 py-0.5 rounded">
                          Курс ≠ 1
                        </span>
                      )}
                    </div>
                    <div className="font-semibold text-slate-800 font-mono truncate mt-0.5">
                      {selectedProject.colI}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Real Project Expenses Breakdown */}
            <div className="mt-3 p-3.5 bg-slate-50 rounded-xl border border-slate-200/80 text-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-800 text-[11px] uppercase tracking-wider">
                  Розподіл витрат проєкту:
                </span>
                <span className="text-[11px] text-slate-400 font-mono">
                  Рядок {selectedProject.rowNumber}
                </span>
              </div>

              <div className="space-y-1.5 pt-1">
                {/* 1. Колонка O */}
                <div className="flex justify-between items-center text-slate-700">
                  <span className="text-slate-600 truncate max-w-[65%]" title={getHeaderTitle('colO', 'O')}>
                    {getHeaderTitle('colO', 'O')} <span className="text-slate-400 text-[10px]">(кол. O):</span>
                  </span>
                  <span className="font-mono font-medium">{formatValueDisplay(selectedProject.colO)}</span>
                </div>

                {/* 2. Колонка P */}
                <div className="flex justify-between items-center text-slate-700">
                  <span className="text-slate-600 truncate max-w-[65%]" title={getHeaderTitle('colP', 'P')}>
                    {getHeaderTitle('colP', 'P')} <span className="text-slate-400 text-[10px]">(кол. P):</span>
                  </span>
                  <span className="font-mono font-medium">{formatValueDisplay(selectedProject.colP)}</span>
                </div>

                {/* 3. Заробітня плата (Q + R + S + T) */}
                <div className="bg-emerald-50/70 rounded-lg p-2.5 border border-emerald-100/80 space-y-1.5">
                  <div className="flex justify-between items-center font-semibold text-emerald-950">
                    <span className="flex items-center gap-1 truncate max-w-[65%]" title={getHeaderTitle('sumQRST', 'Q+R+S+T')}>
                      <span>{getHeaderTitle('sumQRST', 'Q+R+S+T')}</span>
                      <span className="text-emerald-700 text-[10px] font-normal shrink-0">(кол. Q+R+S+T):</span>
                    </span>
                    <span className="font-mono font-bold text-emerald-900 shrink-0">
                      {formatCurrency(selectedProject.sumQRST)} грн
                    </span>
                  </div>
                  {(selectedProject.colQ || selectedProject.colR || selectedProject.colS || selectedProject.colT) && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 pt-1 text-[10px] text-slate-600">
                      <div className="bg-white/90 px-2 py-1 rounded border border-emerald-100 shadow-2xs">
                        <span className="text-slate-400 block truncate" title={getHeaderTitle('colQ', 'Q')}>
                          {getHeaderTitle('colQ', 'Q')} (Q):
                        </span>
                        <span className="font-mono font-semibold text-slate-800">
                          {selectedProject.colQ || '0'}
                        </span>
                      </div>
                      <div className="bg-white/90 px-2 py-1 rounded border border-emerald-100 shadow-2xs">
                        <span className="text-slate-400 block truncate" title={getHeaderTitle('colR', 'R')}>
                          {getHeaderTitle('colR', 'R')} (R):
                        </span>
                        <span className="font-mono font-semibold text-slate-800">
                          {selectedProject.colR || '0'}
                        </span>
                      </div>
                      <div className="bg-white/90 px-2 py-1 rounded border border-emerald-100 shadow-2xs">
                        <span className="text-slate-400 block truncate" title={getHeaderTitle('colS', 'S')}>
                          {getHeaderTitle('colS', 'S')} (S):
                        </span>
                        <span className="font-mono font-semibold text-slate-800">
                          {selectedProject.colS || '0'}
                        </span>
                      </div>
                      <div className="bg-white/90 px-2 py-1 rounded border border-emerald-100 shadow-2xs">
                        <span className="text-slate-400 block truncate" title={getHeaderTitle('colT', 'T')}>
                          {getHeaderTitle('colT', 'T')} (T):
                        </span>
                        <span className="font-mono font-semibold text-slate-800">
                          {selectedProject.colT || '0'}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* 4. Колонка U (якщо є) */}
                {selectedProject.colU && (
                  <div className="flex justify-between items-center text-slate-700">
                    <span className="text-slate-600 truncate max-w-[65%]" title={getHeaderTitle('colU', 'U')}>
                      {getHeaderTitle('colU', 'U')} <span className="text-slate-400 text-[10px]">(кол. U):</span>
                    </span>
                    <span className="font-mono font-medium">{formatValueDisplay(selectedProject.colU)}</span>
                  </div>
                )}
              </div>

              {/* Загальні витрати (V) */}
              <div className="pt-2 border-t border-slate-200 flex justify-between items-center font-bold text-slate-900">
                <span className="flex items-center gap-1">
                  <span>{getHeaderTitle('colV', 'V')}</span>
                  <span className="text-slate-400 text-[10px] font-normal">(кол. V):</span>
                </span>
                <span className="font-mono text-rose-700 text-sm">
                  {formatValueDisplay(selectedProject.colV || selectedProject.sumQRST)}
                </span>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-end space-x-2">
              <button
                type="button"
                onClick={() => setSelectedProject(null)}
                className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
              >
                Закрити
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedProject(null);
                  onSelectTab('projects');
                }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <span>Перейти в таблицю Проєктів</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
