import React, { useState, useMemo, useEffect } from 'react';
import {
  TrendingUp,
  Calendar,
  Building2,
  AlertTriangle,
  CheckCircle2,
  Eye,
  RefreshCw,
  Search,
  Filter,
  ArrowDownRight,
  ArrowUpRight,
  Scale,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  X,
  FileSpreadsheet,
  Layers,
  Info,
  CalendarClock,
  Sparkles,
  ArrowUpDown,
  Download,
  Check,
  Clock,
  AlertCircle,
  Edit3,
  DollarSign,
  Wallet,
  ShieldCheck,
} from 'lucide-react';
import {
  ProjectSheetRow,
  ExistingSheetRow,
  ExistingPaymentRow,
  SheetCompanyLists,
  SheetConfig,
  WeeklyCashFlow,
  CashFlowInflowItem,
  CashFlowOutflowItem,
  CompanyWeeklyCashFlow,
  CashFlowViewMode,
} from '../types';
import { aggregateCashFlow } from '../services/cashFlowService';
import { DEFAULT_OUR_COMPANIES } from '../data/sampleDocuments';

interface Props {
  projects: ProjectSheetRow[];
  invoices: ExistingSheetRow[];
  payments?: ExistingPaymentRow[];
  companyLists?: SheetCompanyLists;
  sheetConfig?: SheetConfig | null;
  onRefresh?: () => Promise<void>;
  isLoading?: boolean;
}

// Storage keys for persistence
const STARTING_BALANCE_STORAGE_KEY = 'cashflow_starting_balance_v2';
const RECEIVED_TRANCHES_STORAGE_KEY = 'cashflow_received_tranches_v2';
const VIEW_MODE_STORAGE_KEY = 'cashflow_view_mode_v2';

// Realistic fallback invoices showcasing both Paid (Fact) and Unpaid (Plan) items
const FALLBACK_INVOICES: ExistingSheetRow[] = [
  // Factual payment of 2 000 000 грн in Week T39 (21.09 – 27.09.2026)
  {
    rowIndex: 1,
    uploadedAt: '24.09.2026 10:00',
    invoiceDate: '23.09.2026',
    invoiceNumber: 'СФ-00170',
    supplier: 'ТОВ МЕТІНВЕСТ-СМЦ',
    buyer: 'ТОВ ШОП ІНТЕРІОР',
    amount: 2000000,
    currency: 'UAH',
    paidAmount: 2000000,
    paymentStatus: 'Оплачено',
    approvalStatus: 'ПОГОДЖЕНО',
    orderNumber: '216',
    paymentDate: '24.09.2026',
  },
  {
    rowIndex: 2,
    uploadedAt: '16.09.2026 14:20',
    invoiceDate: '15.09.2026',
    invoiceNumber: 'СФ-00192',
    supplier: 'ТОВ МЕТІНВЕСТ-СМЦ',
    buyer: 'ТОВ ШОП ІНТЕРІОР',
    amount: 94500,
    currency: 'UAH',
    paidAmount: 0,
    paymentStatus: 'Не оплачено',
    approvalStatus: 'ПОГОДЖЕНО',
    orderNumber: '216',
  },
  {
    rowIndex: 3,
    uploadedAt: '23.09.2026 11:15',
    invoiceDate: '22.09.2026',
    invoiceNumber: 'ЕП-48821',
    supplier: 'ТОВ ЕПІЦЕНТР К',
    buyer: 'ТОВ ГАЛА ПРОДАКШН',
    amount: 128400,
    currency: 'UAH',
    paidAmount: 0,
    paymentStatus: 'Не оплачено',
    approvalStatus: 'НЕ ПОГОДЖЕНО',
    orderNumber: '234-26',
  },
  {
    rowIndex: 4,
    uploadedAt: '24.09.2026 16:45',
    invoiceDate: '24.09.2026',
    invoiceNumber: 'ІН-8890',
    supplier: 'ТОВ БАСТІОН-С',
    buyer: 'ТОВ ІНОКС УКРАЇНА',
    amount: 315000,
    currency: 'UAH',
    paidAmount: 0,
    paymentStatus: 'Не оплачено',
    approvalStatus: 'ПОГОДЖЕНО',
    orderNumber: '229-26',
  },
  {
    rowIndex: 5,
    uploadedAt: '30.09.2026 10:00',
    invoiceDate: '29.09.2026',
    invoiceNumber: 'КЗ-1092',
    supplier: 'ТОВ КОВАЛЬСЬКА ЗАЛІЗОБЕТОН',
    buyer: 'ТОВ ПРЕМІУМ ШОП',
    amount: 420000,
    currency: 'UAH',
    paidAmount: 0,
    paymentStatus: 'Не оплачено',
    approvalStatus: 'ПОГОДЖЕНО',
    orderNumber: '208',
  },
  {
    rowIndex: 6,
    uploadedAt: '01.10.2026 09:30',
    invoiceDate: '01.10.2026',
    invoiceNumber: 'ЛП-3401',
    supplier: 'ТОВ ЛЕГНОПРОМ',
    buyer: 'ФОП Ільїнський Костянтин Владиславович',
    amount: 112000,
    currency: 'UAH',
    paidAmount: 0,
    paymentStatus: 'Не оплачено',
    approvalStatus: 'НЕ ПОГОДЖЕНО',
    orderNumber: '166',
  },
  {
    rowIndex: 7,
    uploadedAt: '07.10.2026 15:10',
    invoiceDate: '06.10.2026',
    invoiceNumber: 'ПТ-5503',
    supplier: 'ТДВ ПРОМТЕХКОМПЛЕКТ',
    buyer: 'ТОВ ШОП ІНТЕРІОР',
    amount: 240000,
    currency: 'UAH',
    paidAmount: 0,
    paymentStatus: 'Не оплачено',
    approvalStatus: 'ПОГОДЖЕНО',
    orderNumber: '216',
  },
  {
    rowIndex: 8,
    uploadedAt: '12.10.2026 12:40',
    invoiceDate: '11.10.2026',
    invoiceNumber: 'ХБ-9012',
    supplier: 'ТОВ ХЕНКЕЛЬ БАУТЕХНІК (УКРАЇНА)',
    buyer: 'ТОВ ГАЛА ПРОДАКШН',
    amount: 185000,
    currency: 'UAH',
    paidAmount: 0,
    paymentStatus: 'Не оплачено',
    approvalStatus: 'ПОГОДЖЕНО',
    orderNumber: '234-26',
  },
];

export const CashFlowTab: React.FC<Props> = ({
  projects = [],
  invoices = [],
  payments = [],
  companyLists,
  sheetConfig,
  onRefresh,
  isLoading = false,
}) => {
  // Use fallback sample invoices if none exist in state
  const effectiveInvoices = useMemo(() => {
    if (invoices && invoices.length > 0) return invoices;
    return FALLBACK_INVOICES;
  }, [invoices]);

  // Use payments passed from App
  const effectivePayments = useMemo(() => {
    return payments || [];
  }, [payments]);

  // 1. Starting_Balance (Початковий залишок живих грошей на рахунках/касі)
  // Default: 6 000 000 грн as specified in user's prompt example
  const [startingBalance, setStartingBalance] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(STARTING_BALANCE_STORAGE_KEY);
        if (stored !== null) {
          const num = parseFloat(stored);
          if (!isNaN(num) && num >= 0) return num;
        }
      } catch {}
    }
    return 6000000;
  });

  const [isEditingStartingBalance, setIsEditingStartingBalance] = useState(false);
  const [startingBalanceInput, setStartingBalanceInput] = useState<string>('');

  const handleOpenStartingBalanceModal = () => {
    setStartingBalanceInput(String(startingBalance));
    setIsEditingStartingBalance(true);
  };

  const handleSaveStartingBalance = (val?: number) => {
    const target = val !== undefined ? val : parseFloat(startingBalanceInput.replace(/\s/g, '').replace(',', '.'));
    if (!isNaN(target) && target >= 0) {
      setStartingBalance(target);
      try {
        localStorage.setItem(STARTING_BALANCE_STORAGE_KEY, String(target));
      } catch {}
    }
    setIsEditingStartingBalance(false);
  };

  // 2. View Mode (Тумблер перемикача: План-Факт | Тільки Факт | Тільки План)
  const [viewMode, setViewMode] = useState<CashFlowViewMode>(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(VIEW_MODE_STORAGE_KEY) as CashFlowViewMode;
        if (stored === 'plan-fact' || stored === 'fact-only' || stored === 'plan-only') {
          return stored;
        }
      } catch {}
    }
    return 'plan-fact';
  });

  const handleSetViewMode = (mode: CashFlowViewMode) => {
    setViewMode(mode);
    try {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
    } catch {}
  };

  // 3. User toggle for received/unreceived tranches
  const [receivedTrancheKeys, setReceivedTrancheKeys] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(RECEIVED_TRANCHES_STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) return parsed;
        }
      } catch {}
    }
    return [];
  });

  const [unreceivedTrancheKeys, setUnreceivedTrancheKeys] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('cashflow_unreceived_tranches_v2');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) return parsed;
        }
      } catch {}
    }
    return [];
  });

  const toggleTrancheReceived = (uniqueKey: string, currentlyFact: boolean) => {
    if (currentlyFact) {
      setUnreceivedTrancheKeys((prev) => {
        const next = prev.includes(uniqueKey) ? prev : [...prev, uniqueKey];
        try { localStorage.setItem('cashflow_unreceived_tranches_v2', JSON.stringify(next)); } catch {}
        return next;
      });
      setReceivedTrancheKeys((prev) => {
        const next = prev.filter((k) => k !== uniqueKey);
        try { localStorage.setItem(RECEIVED_TRANCHES_STORAGE_KEY, JSON.stringify(next)); } catch {}
        return next;
      });
    } else {
      setReceivedTrancheKeys((prev) => {
        const next = prev.includes(uniqueKey) ? prev : [...prev, uniqueKey];
        try { localStorage.setItem(RECEIVED_TRANCHES_STORAGE_KEY, JSON.stringify(next)); } catch {}
        return next;
      });
      setUnreceivedTrancheKeys((prev) => {
        const next = prev.filter((k) => k !== uniqueKey);
        try { localStorage.setItem('cashflow_unreceived_tranches_v2', JSON.stringify(next)); } catch {}
        return next;
      });
    }
  };

  // Selected Legal Entity (ТОВ/ФОП)
  const [selectedCompany, setSelectedCompany] = useState<string>('all');

  // Year filter
  const [selectedYear, setSelectedYear] = useState<number>(2026);

  // Filter: all weeks vs active weeks only
  const [showOnlyActiveWeeks, setShowOnlyActiveWeeks] = useState<boolean>(true);

  // Filter: status filter ('all' | 'gap' | 'ok')
  const [statusFilter, setStatusFilter] = useState<'all' | 'gap' | 'ok'>('all');

  // Search query
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Selected week for details modal & inline expansion
  const [selectedWeekModal, setSelectedWeekModal] = useState<WeeklyCashFlow | null>(null);
  const [detailsActiveTab, setDetailsActiveTab] = useState<'all' | 'inflows' | 'outflows'>('all');
  const [expandedWeekKeys, setExpandedWeekKeys] = useState<Set<string>>(new Set());

  const toggleWeekExpand = (weekKey: string) => {
    setExpandedWeekKeys((prev) => {
      const next = new Set(prev);
      if (next.has(weekKey)) {
        next.delete(weekKey);
      } else {
        next.add(weekKey);
      }
      return next;
    });
  };

  // Close modal on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedWeekModal) {
        setSelectedWeekModal(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedWeekModal]);

  // Helper for approval status badge in outflow details
  const getApprovalBadge = (status?: string) => {
    const norm = (status || 'ПОГОДЖЕНО').toUpperCase();
    if (norm.includes('ВІДХИЛ')) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-300 whitespace-nowrap shadow-2xs">
          <AlertCircle className="w-3 h-3 text-rose-600 shrink-0" />
          <span>ВІДХИЛЕНО</span>
        </span>
      );
    }
    if (norm.includes('НЕ ПОГОДЖ') || norm.includes('ОЧІКУ')) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-300 whitespace-nowrap shadow-2xs">
          <Clock className="w-3 h-3 text-amber-600 shrink-0" />
          <span>НЕ ПОГОДЖЕНО</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 whitespace-nowrap shadow-2xs">
        <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
        <span>ПОГОДЖЕНО</span>
      </span>
    );
  };

  // Helper function to extract normalized core key for robust deduplication & matching
  const getCompanyCoreKey = (name: string): string => {
    return name
      .toLowerCase()
      .replace(/^(тов|фоп|пат|прат|пп|тдв)\s*/i, '')
      .replace(/['"«»\s\-_]/g, '')
      .trim();
  };

  // Build clean, deduplicated list of our companies directly from "Наші компанії"
  const availableCompanies = useMemo(() => {
    const rawList =
      companyLists?.ourCompanies && companyLists.ourCompanies.length > 0
        ? companyLists.ourCompanies
        : DEFAULT_OUR_COMPANIES;

    const companyMap = new Map<string, string>();
    for (const raw of rawList) {
      const trimmed = (raw || '').trim();
      if (!trimmed || trimmed.length < 2) continue;

      const core = getCompanyCoreKey(trimmed);
      if (!companyMap.has(core)) {
        companyMap.set(core, trimmed);
      } else {
        const existing = companyMap.get(core)!;
        const hasLegalPrefix = /^(тов|фоп|пат|прат|пп|тдв)\s*/i.test(trimmed);
        const existingHasPrefix = /^(тов|фоп|пат|прат|пп|тдв)\s*/i.test(existing);
        if (hasLegalPrefix && !existingHasPrefix) {
          companyMap.set(core, trimmed);
        } else if (hasLegalPrefix === existingHasPrefix && trimmed.length > existing.length) {
          companyMap.set(core, trimmed);
        }
      }
    }
    return Array.from(companyMap.values());
  }, [companyLists?.ourCompanies]);

  // Run modernized Plan-Fact aggregation service
  const cashFlowSummary = useMemo(() => {
    return aggregateCashFlow(projects, effectiveInvoices, {
      targetYear: selectedYear,
      daysToAddForPayment: 5,
      startingBalance,
      payments: effectivePayments,
      receivedTrancheKeys,
      unreceivedTrancheKeys,
      mode: viewMode,
    });
  }, [projects, effectiveInvoices, effectivePayments, selectedYear, startingBalance, receivedTrancheKeys, unreceivedTrancheKeys, viewMode]);

  // Format currency in Ukrainian locale
  const formatMoney = (val: number): string => {
    return (
      new Intl.NumberFormat('uk-UA', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(val) + ' ₴'
    );
  };

  // Helper to extract company-specific or all-company numbers for a week
  const getWeekDataForSelectedCompany = (week: WeeklyCashFlow) => {
    if (selectedCompany === 'all') {
      return {
        startBalance: week.startBalance,
        endBalance: week.endBalance,
        inflowFact: week.inflowFact,
        inflowPlan: week.inflowPlan,
        inflow: week.totalInflow,
        outflowFact: week.outflowFact,
        outflowPlan: week.outflowPlan,
        outflow: week.totalOutflow,
        netBalance: week.netBalance,
        isCashGap: week.isCashGap,
        deficitAmount: week.deficitAmount,
        inflowCount: Object.values(week.byCompany).reduce((sum, c) => sum + c.inflowItems.length, 0),
        outflowCount: Object.values(week.byCompany).reduce((sum, c) => sum + c.outflowItems.length, 0),
        inflowItems: Object.values(week.byCompany).flatMap((c) => c.inflowItems),
        outflowItems: Object.values(week.byCompany).flatMap((c) => c.outflowItems),
      };
    }

    let compData: CompanyWeeklyCashFlow | undefined = week.byCompany[selectedCompany];
    if (!compData) {
      const selCore = getCompanyCoreKey(selectedCompany);
      for (const [key, data] of Object.entries(week.byCompany)) {
        const keyCore = getCompanyCoreKey(key);
        if (keyCore === selCore || keyCore.includes(selCore) || selCore.includes(keyCore)) {
          compData = data;
          break;
        }
      }
    }

    if (compData) {
      // Company specific end balance
      const compNet = compData.balance;
      const compStart = compData.startBalance ?? 0;
      const compEnd = compData.endBalance ?? compStart + compNet;
      const isCashGap = compEnd < 0;

      return {
        startBalance: compStart,
        endBalance: compEnd,
        inflowFact: compData.inflowFact,
        inflowPlan: compData.inflowPlan,
        inflow: compData.inflow,
        outflowFact: compData.outflowFact,
        outflowPlan: compData.outflowPlan,
        outflow: compData.outflow,
        netBalance: compNet,
        isCashGap,
        deficitAmount: isCashGap ? Math.abs(compEnd) : 0,
        inflowCount: compData.inflowItems.length,
        outflowCount: compData.outflowItems.length,
        inflowItems: compData.inflowItems,
        outflowItems: compData.outflowItems,
      };
    }

    return {
      startBalance: 0,
      endBalance: 0,
      inflowFact: 0,
      inflowPlan: 0,
      inflow: 0,
      outflowFact: 0,
      outflowPlan: 0,
      outflow: 0,
      netBalance: 0,
      isCashGap: false,
      deficitAmount: 0,
      inflowCount: 0,
      outflowCount: 0,
      inflowItems: [] as CashFlowInflowItem[],
      outflowItems: [] as CashFlowOutflowItem[],
    };
  };

  // Filter weeks based on search, active status, and status filter
  const filteredWeeks = useMemo(() => {
    return cashFlowSummary.weeks.filter((week) => {
      const { inflow, outflow, isCashGap, inflowItems, outflowItems } = getWeekDataForSelectedCompany(week);

      // Active weeks filter (hide empty weeks unless it's current week)
      if (showOnlyActiveWeeks) {
        if (inflow === 0 && outflow === 0 && !week.isCurrentWeek) {
          return false;
        }
      }

      // Status filter: gap triggered ONLY when cumulative endBalance < 0
      if (statusFilter === 'gap' && !isCashGap) return false;
      if (statusFilter === 'ok' && isCashGap) return false;

      // Search query filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesWeek =
          week.weekLabel.toLowerCase().includes(query) ||
          week.weekKey.toLowerCase().includes(query) ||
          week.startDate.includes(query) ||
          week.endDate.includes(query);

        const matchesInflows = inflowItems.some(
          (i) =>
            i.projectCode.toLowerCase().includes(query) ||
            i.client.toLowerCase().includes(query) ||
            i.projectName.toLowerCase().includes(query) ||
            i.company.toLowerCase().includes(query)
        );

        const matchesOutflows = outflowItems.some(
          (o) =>
            o.invoiceNumber.toLowerCase().includes(query) ||
            o.supplier.toLowerCase().includes(query) ||
            (o.orderNumber && o.orderNumber.toLowerCase().includes(query)) ||
            (o.paymentNumber && o.paymentNumber.toLowerCase().includes(query)) ||
            o.company.toLowerCase().includes(query)
        );

        if (!matchesWeek && !matchesInflows && !matchesOutflows) {
          return false;
        }
      }

      return true;
    });
  }, [cashFlowSummary.weeks, selectedCompany, showOnlyActiveWeeks, statusFilter, searchQuery]);

  // Overall totals across filtered weeks
  const aggregatedTotals = useMemo(() => {
    let totalInflowFact = 0;
    let totalInflowPlan = 0;
    let totalInflow = 0;
    let totalOutflowFact = 0;
    let totalOutflowPlan = 0;
    let totalOutflow = 0;
    let cashGapWeeksCount = 0;
    let normalWeeksCount = 0;

    for (const week of filteredWeeks) {
      const data = getWeekDataForSelectedCompany(week);
      totalInflowFact += data.inflowFact;
      totalInflowPlan += data.inflowPlan;
      totalInflow += data.inflow;
      totalOutflowFact += data.outflowFact;
      totalOutflowPlan += data.outflowPlan;
      totalOutflow += data.outflow;

      if (data.isCashGap) {
        cashGapWeeksCount++;
      } else {
        normalWeeksCount++;
      }
    }

    const netBalance = Math.round((totalInflow - totalOutflow) * 100) / 100;
    const projectedBalance =
      filteredWeeks.length > 0
        ? getWeekDataForSelectedCompany(filteredWeeks[filteredWeeks.length - 1]).endBalance
        : startingBalance;

    // 🏦 Формула: Початковий залишок + Всі фактичні надходження - Всі фактичні витрати
    const liveMoney = Math.round((startingBalance + totalInflowFact - totalOutflowFact) * 100) / 100;

    return {
      totalInflowFact: Math.round(totalInflowFact * 100) / 100,
      totalInflowPlan: Math.round(totalInflowPlan * 100) / 100,
      totalInflow: Math.round(totalInflow * 100) / 100,
      totalOutflowFact: Math.round(totalOutflowFact * 100) / 100,
      totalOutflowPlan: Math.round(totalOutflowPlan * 100) / 100,
      totalOutflow: Math.round(totalOutflow * 100) / 100,
      netBalance,
      liveMoney,
      projectedBalance,
      cashGapWeeksCount,
      normalWeeksCount,
      totalWeeks: filteredWeeks.length,
    };
  }, [filteredWeeks, selectedCompany, startingBalance]);

  // Render two-column details (left: Inflows, right: Outflows)
  const renderTwoColumnDetails = (week: WeeklyCashFlow, isInline = false) => {
    const weekDetails = getWeekDataForSelectedCompany(week);
    const isCashGap = weekDetails.isCashGap;

    return (
      <div className="space-y-4">
        {/* Mobile column tabs switch */}
        <div className="flex items-center justify-between gap-1.5 lg:hidden bg-slate-100 p-1 rounded-xl">
          <button
            type="button"
            onClick={() => setDetailsActiveTab('all')}
            className={`flex-1 py-1.5 px-2 text-xs font-semibold rounded-lg transition-all cursor-pointer text-center ${
              detailsActiveTab === 'all'
                ? 'bg-white text-slate-900 shadow-2xs font-bold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Всі (2 колонки)
          </button>
          <button
            type="button"
            onClick={() => setDetailsActiveTab('inflows')}
            className={`flex-1 py-1.5 px-2 text-xs font-semibold rounded-lg transition-all cursor-pointer text-center flex items-center justify-center gap-1 ${
              detailsActiveTab === 'inflows'
                ? 'bg-white text-emerald-800 shadow-2xs font-bold'
                : 'text-slate-600 hover:text-emerald-700'
            }`}
          >
            <span>🟢 Надходження</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-100 text-emerald-800 font-bold">
              {weekDetails.inflowItems.length}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setDetailsActiveTab('outflows')}
            className={`flex-1 py-1.5 px-2 text-xs font-semibold rounded-lg transition-all cursor-pointer text-center flex items-center justify-center gap-1 ${
              detailsActiveTab === 'outflows'
                ? 'bg-white text-rose-800 shadow-2xs font-bold'
                : 'text-slate-600 hover:text-rose-700'
            }`}
          >
            <span>🔴 Витрати</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-rose-100 text-rose-800 font-bold">
              {weekDetails.outflowItems.length}
            </span>
          </button>
        </div>

        {/* 2-Column Responsive Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 items-start">
          {/* ЛІВА КОЛОНКА: Деталізація надходжень (Вхід) */}
          {(detailsActiveTab === 'all' || detailsActiveTab === 'inflows') && (
            <div className="bg-white rounded-xl border border-slate-200/90 shadow-2xs overflow-hidden flex flex-col">
              {/* Header */}
              <div className="p-3.5 sm:p-4 bg-emerald-50/80 border-b border-emerald-100 flex items-center justify-between gap-2">
                <div className="flex items-center space-x-2.5">
                  <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center font-bold text-xs shadow-2xs shrink-0">
                    <ArrowDownRight className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs sm:text-sm font-bold text-emerald-950 flex items-center gap-1.5">
                      <span>Надходження (Вхід)</span>
                      <span className="px-1.5 py-0.2 text-[10px] font-bold rounded-full bg-emerald-200/70 text-emerald-900">
                        {weekDetails.inflowItems.length}
                      </span>
                    </h4>
                    <p className="text-[11px] text-emerald-700">
                      Факт: <strong>+{formatMoney(weekDetails.inflowFact)}</strong> | План: <strong>+{formatMoney(weekDetails.inflowPlan)}</strong>
                    </p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-xs sm:text-sm font-bold font-mono text-emerald-700 block">
                    +{formatMoney(weekDetails.inflow)} грн
                  </span>
                  <span className="text-[10px] text-emerald-600 font-medium">Разом надходження</span>
                </div>
              </div>

              {/* Inflows Content */}
              <div className="p-3 sm:p-4">
                {weekDetails.inflowItems.length === 0 ? (
                  <div className="py-8 px-4 text-center rounded-xl bg-slate-50 border border-dashed border-slate-200 text-slate-400">
                    <Info className="w-6 h-6 mx-auto mb-1.5 opacity-60" />
                    <p className="text-xs font-semibold text-slate-700">Очікуваних надходжень на цей тиждень немає</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      У графіку оплат проєктів траншів на {week.shortLabel} не заплановано
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="hidden sm:block overflow-x-auto border border-slate-200 rounded-xl">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="bg-slate-100/80 text-slate-700 font-bold border-b border-slate-200 select-none">
                            <th className="py-2.5 px-3 whitespace-nowrap">#Проєкт</th>
                            <th className="py-2.5 px-3">Назва / Замовник</th>
                            <th className="py-2.5 px-3 text-center whitespace-nowrap">Статус</th>
                            <th className="py-2.5 px-3 text-right whitespace-nowrap">Сума грн</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {weekDetails.inflowItems.map((item, idx) => {
                            const trancheKey = `${item.projectRowNumber}_t${item.trancheNumber}`;
                            const isFact = item.isFact;

                            return (
                              <tr key={idx} className="hover:bg-emerald-50/25 transition-colors">
                                <td className="py-2.5 px-3 whitespace-nowrap">
                                  <span className="font-mono font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded text-xs shadow-2xs">
                                    #{item.projectCode.replace(/^#/, '')}
                                  </span>
                                </td>
                                <td className="py-2.5 px-3">
                                  <div className="font-medium text-slate-900 leading-snug">
                                    {item.projectName || item.client || '—'}
                                  </div>
                                  <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1.5">
                                    <span className="font-semibold text-emerald-800 bg-emerald-50 px-1 rounded">
                                      Оплата {item.trancheNumber}
                                    </span>
                                    {item.company && <span>• {item.company}</span>}
                                  </div>
                                </td>
                                <td className="py-2.5 px-3 text-center whitespace-nowrap">
                                  <button
                                    type="button"
                                    onClick={() => toggleTrancheReceived(trancheKey, isFact)}
                                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold transition-all cursor-pointer shadow-2xs ${
                                      isFact
                                        ? 'bg-emerald-100 text-emerald-800 border border-emerald-300 hover:bg-emerald-200'
                                        : 'bg-slate-100 text-slate-600 border border-slate-300 hover:bg-slate-200'
                                    }`}
                                    title="Натисніть для перемикання статусу: Отримано (Факт) / Очікує (План)"
                                  >
                                    {isFact ? (
                                      <>
                                        <Check className="w-3 h-3 text-emerald-700" />
                                        <span>🟢 Отримано (Факт)</span>
                                      </>
                                    ) : (
                                      <>
                                        <Clock className="w-3 h-3 text-slate-500" />
                                        <span>⏳ Очікує (План)</span>
                                      </>
                                    )}
                                  </button>
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-700 whitespace-nowrap">
                                  +{formatMoney(item.amount)} грн
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="bg-emerald-50/50 border-t border-emerald-200 font-bold text-emerald-950 text-xs">
                            <td colSpan={3} className="py-2.5 px-3">
                              Разом надходження ({weekDetails.inflowItems.length}):
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-emerald-700">
                              +{formatMoney(weekDetails.inflow)} грн
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>

                    {/* Mobile Cards (< sm) */}
                    <div className="block sm:hidden space-y-2.5">
                      {weekDetails.inflowItems.map((item, idx) => {
                        const trancheKey = `${item.projectRowNumber}_t${item.trancheNumber}`;
                        const isFact = item.isFact;

                        return (
                          <div key={idx} className="p-3 rounded-xl border border-slate-200 bg-slate-50/70 shadow-2xs space-y-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded text-xs">
                                #{item.projectCode.replace(/^#/, '')}
                              </span>
                              <span className="font-mono font-bold text-emerald-700 text-xs">
                                +{formatMoney(item.amount)} грн
                              </span>
                            </div>
                            <div className="text-xs font-semibold text-slate-900 leading-snug">
                              {item.projectName || item.client || '—'}
                            </div>
                            <div className="flex items-center justify-between pt-1.5 border-t border-slate-200/60 text-[11px]">
                              <span className="text-slate-500">Оплата {item.trancheNumber}</span>
                              <button
                                type="button"
                                onClick={() => toggleTrancheReceived(trancheKey, isFact)}
                                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  isFact ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'
                                }`}
                              >
                                {isFact ? '🟢 Факт' : '⏳ План'}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* ПРАВА КОЛОНКА: Деталізація витрат (Вихід: Сплачено / До сплати) */}
          {(detailsActiveTab === 'all' || detailsActiveTab === 'outflows') && (
            <div className="bg-white rounded-xl border border-slate-200/90 shadow-2xs overflow-hidden flex flex-col">
              {/* Header */}
              <div className="p-3.5 sm:p-4 bg-rose-50/80 border-b border-rose-100 flex items-center justify-between gap-2">
                <div className="flex items-center space-x-2.5">
                  <div className="w-8 h-8 rounded-lg bg-rose-600 text-white flex items-center justify-center font-bold text-xs shadow-2xs shrink-0">
                    <ArrowUpRight className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs sm:text-sm font-bold text-rose-950 flex items-center gap-1.5">
                      <span>Витрати (Вихід)</span>
                      <span className="px-1.5 py-0.2 text-[10px] font-bold rounded-full bg-rose-200/70 text-rose-900">
                        {weekDetails.outflowItems.length}
                      </span>
                    </h4>
                    <p className="text-[11px] text-rose-700">
                      Сплачено (Факт): <strong>-{formatMoney(weekDetails.outflowFact)}</strong> | До сплати: <strong>-{formatMoney(weekDetails.outflowPlan)}</strong>
                    </p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-xs sm:text-sm font-bold font-mono text-rose-700 block">
                    -{formatMoney(weekDetails.outflow)} грн
                  </span>
                  <span className="text-[10px] text-rose-600 font-medium">Загальні витрати</span>
                </div>
              </div>

              {/* Outflows Content */}
              <div className="p-3 sm:p-4">
                {weekDetails.outflowItems.length === 0 ? (
                  <div className="py-8 px-4 text-center rounded-xl bg-slate-50 border border-dashed border-slate-200 text-slate-400">
                    <Info className="w-6 h-6 mx-auto mb-1.5 opacity-60" />
                    <p className="text-xs font-semibold text-slate-700">Рахунків до сплати на цей тиждень немає</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Витрат та рахунків постачальників на {week.shortLabel} не заплановано
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="hidden sm:block overflow-x-auto border border-slate-200 rounded-xl">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="bg-slate-100/80 text-slate-700 font-bold border-b border-slate-200 select-none">
                            <th className="py-2.5 px-3">Постачальник / Документ</th>
                            <th className="py-2.5 px-3 whitespace-nowrap">#Проєкт</th>
                            <th className="py-2.5 px-3 text-center whitespace-nowrap">Статус</th>
                            <th className="py-2.5 px-3 text-right whitespace-nowrap">Сума грн</th>
                            <th className="py-2.5 px-3 text-center whitespace-nowrap">Погодження</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {weekDetails.outflowItems.map((item, idx) => {
                            const isPaidFact = item.status === 'fact';

                            return (
                              <tr key={idx} className={`hover:bg-rose-50/25 transition-colors ${isPaidFact ? 'bg-slate-50/40' : ''}`}>
                                <td className="py-2.5 px-3">
                                  <div className="font-semibold text-slate-900 leading-snug">
                                    {item.supplier}
                                  </div>
                                  <div className="text-[11px] text-slate-400 mt-0.5 flex items-center flex-wrap gap-1.5">
                                    <span>№ {item.invoiceNumber}</span>
                                    {item.paymentNumber && (
                                      <span className="font-mono text-indigo-600 bg-indigo-50 px-1 rounded text-[10px]">
                                        Пл. №{item.paymentNumber}
                                      </span>
                                    )}
                                    {isPaidFact && item.actualPaymentDate && (
                                      <span className="text-emerald-700 font-medium">
                                        • Оплачено {item.actualPaymentDate}
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="py-2.5 px-3 whitespace-nowrap">
                                  {item.orderNumber ? (
                                    <span className="font-mono font-bold text-slate-700 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded text-xs shadow-2xs">
                                      #{item.orderNumber.replace(/^#/, '')}
                                    </span>
                                  ) : (
                                    <span className="text-slate-400 font-mono text-xs">—</span>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 text-center whitespace-nowrap">
                                  {isPaidFact ? (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                                      <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                      <span>Сплачено (Факт)</span>
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                                      <Clock className="w-3 h-3 text-amber-600" />
                                      <span>До сплати (План)</span>
                                    </span>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono font-bold text-rose-700 whitespace-nowrap">
                                  -{formatMoney(item.amount)} грн
                                </td>
                                <td className="py-2.5 px-3 text-center whitespace-nowrap">
                                  {getApprovalBadge(item.approvalStatus)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="bg-rose-50/50 border-t border-rose-200 font-bold text-rose-950 text-xs">
                            <td colSpan={3} className="py-2.5 px-3">
                              Загальні витрати ({weekDetails.outflowItems.length}):
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-rose-700">
                              -{formatMoney(weekDetails.outflow)} грн
                            </td>
                            <td className="py-2.5 px-3"></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>

                    {/* Mobile Cards (< sm) */}
                    <div className="block sm:hidden space-y-2.5">
                      {weekDetails.outflowItems.map((item, idx) => (
                        <div key={idx} className="p-3 rounded-xl border border-slate-200 bg-slate-50/70 shadow-2xs space-y-1.5">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="text-xs font-semibold text-slate-900 leading-snug">
                                {item.supplier}
                              </div>
                              <div className="text-[11px] text-slate-400 mt-0.5">
                                № {item.invoiceNumber}
                              </div>
                            </div>
                            <span className="font-mono font-bold text-rose-700 text-xs shrink-0">
                              -{formatMoney(item.amount)} грн
                            </span>
                          </div>

                          <div className="flex items-center justify-between pt-1.5 border-t border-slate-200/60 text-[11px]">
                            <span className={item.status === 'fact' ? 'text-emerald-700 font-bold' : 'text-amber-700 font-bold'}>
                              {item.status === 'fact' ? '🟢 Сплачено' : '⏳ До сплати'}
                            </span>
                            {getApprovalBadge(item.approvalStatus)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Weekly Cumulative Cash Balance Summary Strip */}
        <div
          className={`p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
            isCashGap
              ? 'bg-rose-50/90 border-rose-300 text-rose-950'
              : 'bg-emerald-50/90 border-emerald-300 text-emerald-950'
          }`}
        >
          <div className="flex items-start sm:items-center space-x-3.5">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0 shadow-2xs ${
                isCashGap ? 'bg-rose-600' : 'bg-emerald-600'
              }`}
            >
              {isCashGap ? <AlertTriangle className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5" />}
            </div>
            <div>
              <div className="text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                <span>{isCashGap ? '⚠️ Касовий розрив на тиждень' : '🟢 Норма (Профіцит коштів)'}</span>
                <span className="text-[11px] font-normal opacity-80">
                  (Кінцевий залишок = Початковий + Вхід - Вихід)
                </span>
              </div>
              <p className="text-[11px] opacity-90 mt-0.5 leading-relaxed">
                {isCashGap
                  ? `Дефіцит накопичувального залишку становить ${formatMoney(weekDetails.deficitAmount)}. Рекомендовано змістити дату сплати рахунків або прискорити отримання траншу.`
                  : `Накопичувальний залишок становить ${formatMoney(weekDetails.endBalance)}. Наявних грошей на рахунку достатньо для покриття всіх планових та фактичних оплат.`}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-4 shrink-0 self-end sm:self-center font-mono">
            <div className="text-right">
              <span className="text-[10px] uppercase font-bold text-slate-500 block">Початковий залишок</span>
              <span className="text-xs font-bold text-slate-700">
                {formatMoney(weekDetails.startBalance)}
              </span>
            </div>
            <div className="text-right border-l pl-3 border-slate-300">
              <span className="text-[10px] uppercase font-bold text-slate-500 block">Кінцевий залишок</span>
              <span className={`text-base sm:text-lg font-extrabold ${isCashGap ? 'text-rose-700' : 'text-emerald-700'}`}>
                {weekDetails.endBalance > 0 && '+'}
                {formatMoney(weekDetails.endBalance)}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* 1. Header Bar with Title, View Mode Switcher, and Controls */}
      <div className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center space-x-3.5">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 text-white flex items-center justify-center shadow-xs shrink-0">
              <TrendingUp className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center flex-wrap gap-2">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
                  Календар платежів (Cash Flow План-Факт)
                </h1>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200/80">
                  Накопичувальний баланс
                </span>
                {selectedCompany !== 'all' && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                    <Building2 className="w-3 h-3 mr-1 text-slate-500" />
                    {selectedCompany}
                  </span>
                )}
              </div>
              <p className="text-xs sm:text-sm text-slate-500 mt-1">
                Повна прозорість фактичних і планових оплат, перехід залишків між тижнями та точний контроль касових розривів.
              </p>
            </div>
          </div>

          {/* Action Buttons & Starting Balance Quick Trigger */}
          <div className="flex items-center flex-wrap gap-2.5 shrink-0">
            <button
              type="button"
              onClick={handleOpenStartingBalanceModal}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-xl transition-colors cursor-pointer"
              title="Налаштувати початковий залишок живих грошей"
            >
              <Wallet className="w-3.5 h-3.5 text-indigo-600" />
              <span>Початковий залишок:</span>
              <strong className="font-mono">{formatMoney(startingBalance)}</strong>
              <Edit3 className="w-3 h-3 ml-0.5 text-indigo-500" />
            </button>

            {sheetConfig?.spreadsheetUrl && (
              <a
                href={sheetConfig.spreadsheetUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
                title="Відкрити Google Таблицю в новій вкладці"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                <span className="hidden sm:inline">Google Таблиця</span>
                <ExternalLink className="w-3 h-3 text-slate-400" />
              </a>
            )}

            {onRefresh && (
              <button
                type="button"
                onClick={onRefresh}
                disabled={isLoading}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 rounded-xl shadow-xs transition-colors cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                <span>{isLoading ? 'Оновлення...' : 'Оновити дані'}</span>
              </button>
            )}
          </div>
        </div>

        {/* 2. Controls Bar: View Mode Switcher, Company, Status, and Search */}
        <div className="mt-5 pt-5 border-t border-slate-100 flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4">
          {/* View Mode Tumbler (План-Факт | Тільки Факт | Тільки План) */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2.5 w-full xl:w-auto">
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wider whitespace-nowrap flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-indigo-600" />
              Режим:
            </span>
            <div className="inline-flex p-1 bg-slate-100 rounded-xl border border-slate-200 shrink-0">
              <button
                type="button"
                onClick={() => handleSetViewMode('plan-fact')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  viewMode === 'plan-fact'
                    ? 'bg-white text-indigo-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="Враховує і живі гроші, і всі заплановані транші та рахунки (за замовчуванням)"
              >
                <span>📊 План-Факт</span>
              </button>
              <button
                type="button"
                onClick={() => handleSetViewMode('fact-only')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  viewMode === 'fact-only'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="Показує виключно фактично виконані банківські проведення (реальний Cash Flow)"
              >
                <span>🏦 Тільки Факт</span>
              </button>
              <button
                type="button"
                onClick={() => handleSetViewMode('plan-only')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  viewMode === 'plan-only'
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="Календар майбутніх нарахувань та неоплачених боргів"
              >
                <span>📅 Тільки План</span>
              </button>
            </div>
          </div>

          {/* Company Selector */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2.5 w-full xl:w-auto">
            <div className="relative w-full sm:w-64">
              <select
                value={selectedCompany}
                onChange={(e) => setSelectedCompany(e.target.value)}
                className="w-full pl-3 pr-8 py-1.5 text-xs font-semibold bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-slate-900 cursor-pointer appearance-none shadow-2xs"
              >
                <option value="all">🏢 Всі компанії (Зведений Cash Flow)</option>
                <optgroup label="Наші компанії (ТОВ / ФОП)">
                  {availableCompanies.map((comp) => (
                    <option key={comp} value={comp}>
                      {comp}
                    </option>
                  ))}
                </optgroup>
              </select>
              <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            {/* Status Filter Buttons */}
            <div className="inline-flex p-1 bg-slate-100 rounded-xl border border-slate-200 shrink-0">
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                  statusFilter === 'all'
                    ? 'bg-white text-slate-900 shadow-xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Всі ({cashFlowSummary.weeks.length})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('gap')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors cursor-pointer flex items-center gap-1 ${
                  statusFilter === 'gap'
                    ? 'bg-rose-600 text-white shadow-xs font-bold'
                    : 'text-rose-700 hover:bg-rose-50'
                }`}
                title="Показати тільки тижні з накопичувальним касовим розривом (кінцевий залишок < 0)"
              >
                <span>⚠️ Розриви</span>
                {aggregatedTotals.cashGapWeeksCount > 0 && (
                  <span
                    className={`px-1 rounded text-[10px] ${
                      statusFilter === 'gap' ? 'bg-rose-800 text-white' : 'bg-rose-100 text-rose-800'
                    }`}
                  >
                    {aggregatedTotals.cashGapWeeksCount}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('ok')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors cursor-pointer flex items-center gap-1 ${
                  statusFilter === 'ok'
                    ? 'bg-emerald-600 text-white shadow-xs font-bold'
                    : 'text-emerald-700 hover:bg-emerald-50'
                }`}
                title="Показати тільки тижні з позитивним накопичувальним залишком"
              >
                <span>🟢 Норма</span>
              </button>
            </div>

            {/* Toggle: Active Weeks Only */}
            <button
              type="button"
              onClick={() => setShowOnlyActiveWeeks(!showOnlyActiveWeeks)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors cursor-pointer flex items-center gap-1.5 ${
                showOnlyActiveWeeks
                  ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
              title="Перемикач: тільки активні тижні чи весь рік (52 тижні)"
            >
              <CalendarClock className="w-3.5 h-3.5" />
              <span>{showOnlyActiveWeeks ? 'Активні тижні' : 'Весь рік (52)'}</span>
            </button>

            {/* Year Selector */}
            <div className="relative">
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(parseInt(e.target.value, 10) || 2026)}
                className="pl-2.5 pr-7 py-1.5 text-xs font-semibold bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-slate-800 cursor-pointer appearance-none shadow-2xs"
              >
                <option value={2025}>2025</option>
                <option value={2026}>2026</option>
                <option value={2027}>2027</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            {/* Search Input */}
            <div className="relative min-w-[160px] sm:w-52">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Пошук (тиждень, рахунок...)"
                className="w-full pl-8 pr-7 py-1.5 text-xs bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-slate-800 placeholder-slate-400 shadow-2xs"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 3. Modernized Upper KPI Dashboard Panel */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Живі гроші на рахунках (Поточний реальний залишок у банку) */}
        <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <div className="flex items-center space-x-1.5">
              <Wallet className="w-4 h-4 text-indigo-600" />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Живі гроші на рахунках
              </span>
            </div>
            <p className="text-xl sm:text-2xl font-bold font-mono text-indigo-700 mt-1.5">
              {formatMoney(aggregatedTotals.liveMoney)}
            </p>
            <p className="text-[11px] text-slate-500 mt-1">
              Залишок: <span className="font-semibold text-slate-700">{formatMoney(startingBalance)}</span>
              {' + '}
              <span className="font-semibold text-emerald-700">+{formatMoney(aggregatedTotals.totalInflowFact)}</span>
              {' - '}
              <span className="font-semibold text-rose-700">-{formatMoney(aggregatedTotals.totalOutflowFact)}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={handleOpenStartingBalanceModal}
            className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 hover:bg-indigo-100 flex items-center justify-center shrink-0 border border-indigo-100 transition-colors cursor-pointer"
            title="Змінити початковий залишок"
          >
            <Edit3 className="w-5 h-5" />
          </button>
        </div>

        {/* Card 2: Витрати (Вихід) із розбивкою: Всього | Сплачено (Факт) | Очікує (План) */}
        <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <div className="flex items-center space-x-1.5">
              <span className="w-2 h-2 rounded-full bg-rose-500"></span>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                🔴 Витрати
              </span>
            </div>
            <p className="text-xl sm:text-2xl font-bold font-mono text-rose-700 mt-1.5">
              {formatMoney(aggregatedTotals.totalOutflow)}
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5 flex items-center flex-wrap gap-1">
              <span>Сплачено: <strong className="text-emerald-700 font-mono">{formatMoney(aggregatedTotals.totalOutflowFact)}</strong></span>
              <span>•</span>
              <span>Очікує: <strong className="text-rose-700 font-mono">{formatMoney(aggregatedTotals.totalOutflowPlan)}</strong></span>
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0 border border-rose-100">
            <ArrowUpRight className="w-5 h-5" />
          </div>
        </div>

        {/* Card 3: Прогнозний залишок (Сума грошей на кінець періоду після всіх оплат) */}
        <div
          className={`rounded-2xl p-4 sm:p-5 border shadow-xs flex items-center justify-between transition-colors ${
            aggregatedTotals.projectedBalance < 0
              ? 'bg-rose-50/70 border-rose-200 text-rose-950'
              : 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
          }`}
        >
          <div>
            <div className="flex items-center space-x-1.5">
              <Scale className={`w-3.5 h-3.5 ${aggregatedTotals.projectedBalance < 0 ? 'text-rose-600' : 'text-emerald-600'}`} />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                🔮 Прогнозний залишок
              </span>
            </div>
            <p
              className={`text-xl sm:text-2xl font-bold font-mono mt-1.5 ${
                aggregatedTotals.projectedBalance < 0 ? 'text-rose-700' : 'text-emerald-700'
              }`}
            >
              {aggregatedTotals.projectedBalance > 0 && '+'}
              {formatMoney(aggregatedTotals.projectedBalance)}
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {aggregatedTotals.projectedBalance < 0
                ? '⚠️ Ризик касового розриву в кінці періоду'
                : '🟢 Достатньо коштів на всі заплановані рахунки'}
            </p>
          </div>
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
              aggregatedTotals.projectedBalance < 0
                ? 'bg-rose-100 text-rose-700 border-rose-200'
                : 'bg-emerald-100 text-emerald-700 border-emerald-200'
            }`}
          >
            {aggregatedTotals.projectedBalance < 0 ? (
              <AlertTriangle className="w-5 h-5" />
            ) : (
              <CheckCircle2 className="w-5 h-5" />
            )}
          </div>
        </div>

        {/* Card 4: Надходження (Вхід) з розбивкою Факт / План */}
        <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <div className="flex items-center space-x-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                🟢 Надходження (Вхід)
              </span>
            </div>
            <p className="text-xl sm:text-2xl font-bold font-mono text-emerald-700 mt-1.5">
              {formatMoney(aggregatedTotals.totalInflow)}
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5 flex items-center flex-wrap gap-1">
              <span>Факт: <strong className="text-emerald-700 font-mono">{formatMoney(aggregatedTotals.totalInflowFact)}</strong></span>
              <span>•</span>
              <span>План: <strong className="text-indigo-700 font-mono">{formatMoney(aggregatedTotals.totalInflowPlan)}</strong></span>
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 border border-emerald-100">
            <ArrowDownRight className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* 4. Main Summary Table by Weeks (Зведена таблиця по тижнях) */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/50">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <span>Зведена таблиця по тижнях ({selectedYear})</span>
              <span className="text-xs font-normal text-slate-500">
                (показано {filteredWeeks.length} тижнів • режим {viewMode === 'plan-fact' ? 'План-Факт' : viewMode === 'fact-only' ? 'Тільки Факт' : 'Тільки План'})
              </span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Касовий розрив фіксується ТІЛЬКИ якщо Накопичувальний Кінцевий Залишок тижня &lt; 0 грн.
            </p>
          </div>

          <div className="flex items-center space-x-2 text-xs">
            <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold">
              🟢 Норма (Кінцевий залишок ≥ 0)
            </span>
            <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-rose-50 text-rose-800 border border-rose-200 font-semibold">
              ⚠️ Касовий розрив (Кінцевий залишок &lt; 0)
            </span>
          </div>
        </div>

        {/* Table Content */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100/80 text-slate-700 font-bold border-b border-slate-200 select-none">
                <th className="py-3 px-4 sm:px-6 w-52">Тиждень</th>
                <th className="py-3 px-4 text-right">Початковий залишок</th>
                <th className="py-3 px-4 text-right">🟢 Надходження (Вхід)</th>
                <th className="py-3 px-4 text-right">🔴 Витрати (Вихід)</th>
                <th className="py-3 px-4 text-right">⚖️ Сальдо тижня</th>
                <th className="py-3 px-4 text-right">💰 Кінцевий залишок</th>
                <th className="py-3 px-4 text-center w-36">Статус</th>
                <th className="py-3 px-4 sm:px-6 text-center w-28">Дія</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredWeeks.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <div className="max-w-sm mx-auto flex flex-col items-center">
                      <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mb-2">
                        <Search className="w-6 h-6" />
                      </div>
                      <p className="font-semibold text-slate-700 text-sm">Тижнів за вказаними фільтрами не знайдено</p>
                      <p className="text-xs text-slate-400 mt-1">
                        Спробуйте вимкнути фільтр "Активні тижні" або змінити параметри пошуку.
                      </p>
                      {showOnlyActiveWeeks && (
                        <button
                          type="button"
                          onClick={() => setShowOnlyActiveWeeks(false)}
                          className="mt-3 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg font-semibold text-xs transition-colors cursor-pointer"
                        >
                          Показати весь рік (52 тижні)
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredWeeks.map((week) => {
                  const {
                    startBalance,
                    endBalance,
                    inflowFact,
                    inflowPlan,
                    inflow,
                    outflowFact,
                    outflowPlan,
                    outflow,
                    netBalance,
                    isCashGap,
                    deficitAmount,
                  } = getWeekDataForSelectedCompany(week);

                  const isZeroActivity = inflow === 0 && outflow === 0;

                  return (
                    <React.Fragment key={week.weekKey}>
                      <tr
                        className={`hover:bg-slate-50/80 transition-colors ${
                          week.isCurrentWeek ? 'bg-indigo-50/30 font-medium' : ''
                        } ${isCashGap ? 'bg-rose-50/20' : ''}`}
                      >
                        {/* Col 1: Week */}
                        <td className="py-3 px-4 sm:px-6">
                          <div className="flex items-center space-x-2">
                            <div
                              className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                                isCashGap ? 'bg-rose-500' : isZeroActivity ? 'bg-slate-300' : 'bg-emerald-500'
                              }`}
                            />
                            <div>
                              <div className="flex items-center space-x-1.5">
                                <span className="font-bold text-slate-900 text-xs sm:text-sm">
                                  {week.shortLabel}
                                </span>
                                {week.isCurrentWeek && (
                                  <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-indigo-600 text-white tracking-wide">
                                    ПОТОЧНИЙ
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-slate-500 mt-0.5">
                                {week.startDate} – {week.endDate}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Col 2: Starting Balance (Початковий залишок з попереднього тижня) */}
                        <td className="py-3 px-4 text-right">
                          <div className="font-mono font-semibold text-slate-700 text-xs">
                            {formatMoney(startBalance)}
                          </div>
                          <span className="text-[10px] text-slate-400">Вхідний</span>
                        </td>

                        {/* Col 3: Inflow (🟢 Надходження: Факт / План) */}
                        <td className="py-3 px-4 text-right">
                          <div className="font-mono font-bold text-emerald-700 text-xs sm:text-sm">
                            {inflow > 0 ? `+${formatMoney(inflow)}` : '0,00 ₴'}
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5 flex items-center justify-end gap-1">
                            {inflowFact > 0 && <span className="text-emerald-700 font-semibold">Ф: +{formatMoney(inflowFact)}</span>}
                            {inflowFact > 0 && inflowPlan > 0 && <span>|</span>}
                            {inflowPlan > 0 && <span>П: +{formatMoney(inflowPlan)}</span>}
                            {inflow === 0 && <span>—</span>}
                          </div>
                        </td>

                        {/* Col 4: Outflow (🔴 Витрати: Сплачено / До сплати) */}
                        <td className="py-3 px-4 text-right">
                          <div className="font-mono font-bold text-rose-700 text-xs sm:text-sm">
                            {outflow > 0 ? `-${formatMoney(outflow)}` : '0,00 ₴'}
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5 flex items-center justify-end gap-1">
                            {outflowFact > 0 && <span className="text-emerald-700 font-semibold">Факт: -{formatMoney(outflowFact)}</span>}
                            {outflowFact > 0 && outflowPlan > 0 && <span>|</span>}
                            {outflowPlan > 0 && <span className="text-rose-600">План: -{formatMoney(outflowPlan)}</span>}
                            {outflow === 0 && <span>—</span>}
                          </div>
                        </td>

                        {/* Col 5: Weekly Net Balance (Сальдо тижня = Вхід - Вихід) */}
                        <td className="py-3 px-4 text-right">
                          <div className="font-mono text-xs font-semibold">
                            <span className={netBalance < 0 ? 'text-rose-700' : netBalance > 0 ? 'text-emerald-700' : 'text-slate-500'}>
                              {netBalance > 0 && '+'}
                              {formatMoney(netBalance)}
                            </span>
                          </div>
                          <span className="text-[10px] text-slate-400">Операційне</span>
                        </td>

                        {/* Col 6: Cumulative End Balance (Залишок на кінець тижня) */}
                        <td className="py-3 px-4 text-right">
                          <div className="inline-block">
                            <span
                              className={`font-mono font-bold text-xs sm:text-sm px-2.5 py-1 rounded-lg inline-flex items-center gap-1 border ${
                                isCashGap
                                  ? 'bg-rose-100 text-rose-800 border-rose-300 font-extrabold shadow-2xs'
                                  : endBalance > 0
                                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                  : 'bg-slate-100 text-slate-600 border-slate-200'
                              }`}
                            >
                              {endBalance > 0 && '+'}
                              {formatMoney(endBalance)}
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            {isCashGap ? 'Дефіцит' : 'На кінець тижня'}
                          </div>
                        </td>

                        {/* Col 7: Status (🟢 Норма vs ⚠️ Касовий розрив) */}
                        <td className="py-3 px-4 text-center">
                          {isCashGap ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200 shadow-2xs">
                              <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                              <span>⚠️ Розрив</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                              <span>🟢 Норма</span>
                            </span>
                          )}
                        </td>

                        {/* Col 8: Actions */}
                        <td className="py-3 px-4 sm:px-6 text-center whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedWeekModal(week);
                                setDetailsActiveTab('all');
                              }}
                              className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-slate-700 border border-slate-200/90 hover:border-indigo-200 transition-all cursor-pointer shadow-2xs"
                              title={`Відкрити деталі для ${week.shortLabel}`}
                            >
                              <Eye className="w-3.5 h-3.5 text-indigo-600" />
                              <span>Деталі</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleWeekExpand(week.weekKey)}
                              className={`p-1.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
                                expandedWeekKeys.has(week.weekKey)
                                  ? 'bg-indigo-100 text-indigo-800 border-indigo-300'
                                  : 'bg-slate-50 hover:bg-slate-100 text-slate-600 border-slate-200'
                              }`}
                              title={
                                expandedWeekKeys.has(week.weekKey)
                                  ? 'Згорнути деталі'
                                  : 'Розгорнути деталі під рядком'
                              }
                            >
                              {expandedWeekKeys.has(week.weekKey) ? (
                                <ChevronUp className="w-3.5 h-3.5 text-indigo-700" />
                              ) : (
                                <ChevronDown className="w-3.5 h-3.5 text-slate-600" />
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Inline Details Row */}
                      {expandedWeekKeys.has(week.weekKey) && (
                        <tr className="bg-slate-50/80 border-b border-indigo-100">
                          <td colSpan={8} className="p-3 sm:p-5">
                            <div className="bg-white p-4 sm:p-5 rounded-2xl border border-indigo-100 shadow-xs space-y-4">
                              <div className="flex items-center justify-between pb-3 border-b border-slate-200 flex-wrap gap-2">
                                <div className="flex items-center space-x-2">
                                  <span className="font-bold text-slate-900 text-sm">
                                    Розгортка деталей: {week.weekLabel}
                                  </span>
                                  <span className="text-xs text-slate-500">
                                    ({selectedCompany === 'all' ? 'Всі компанії' : selectedCompany})
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedWeekModal(week);
                                    setDetailsActiveTab('all');
                                  }}
                                  className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 cursor-pointer"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                  <span>Відкрити у модальному вікні</span>
                                </button>
                              </div>
                              {renderTwoColumnDetails(week, true)}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>

            {/* Table Footer with Summary */}
            {filteredWeeks.length > 0 && (
              <tfoot>
                <tr className="bg-slate-100/90 font-bold border-t-2 border-slate-300 text-slate-900 text-xs sm:text-sm">
                  <td className="py-4 px-4 sm:px-6">
                    <div className="flex items-center space-x-2">
                      <Scale className="w-4 h-4 text-indigo-600" />
                      <span>РАЗОМ ЗА ПЕРІОД:</span>
                    </div>
                  </td>
                  <td className="py-4 px-4 text-right font-mono text-slate-700 text-xs">
                    {formatMoney(startingBalance)}
                  </td>
                  <td className="py-4 px-4 text-right font-mono text-emerald-800 text-sm">
                    +{formatMoney(aggregatedTotals.totalInflow)}
                  </td>
                  <td className="py-4 px-4 text-right font-mono text-rose-800 text-sm">
                    -{formatMoney(aggregatedTotals.totalOutflow)}
                  </td>
                  <td className="py-4 px-4 text-right font-mono text-xs">
                    <span className={aggregatedTotals.netBalance < 0 ? 'text-rose-700' : 'text-emerald-700'}>
                      {aggregatedTotals.netBalance > 0 && '+'}
                      {formatMoney(aggregatedTotals.netBalance)}
                    </span>
                  </td>
                  <td className="py-4 px-4 text-right">
                    <span
                      className={`font-mono px-3 py-1 rounded-lg inline-block border text-sm sm:text-base font-extrabold ${
                        aggregatedTotals.projectedBalance < 0
                          ? 'bg-rose-200 text-rose-900 border-rose-400'
                          : 'bg-emerald-200 text-emerald-900 border-emerald-400'
                      }`}
                    >
                      {aggregatedTotals.projectedBalance > 0 && '+'}
                      {formatMoney(aggregatedTotals.projectedBalance)}
                    </span>
                  </td>
                  <td className="py-4 px-4 text-center">
                    {aggregatedTotals.cashGapWeeksCount > 0 ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-300">
                        ⚠️ Розриви ({aggregatedTotals.cashGapWeeksCount})
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                        🟢 Норма
                      </span>
                    )}
                  </td>
                  <td className="py-4 px-4 sm:px-6 text-center text-slate-400 text-xs">
                    {filteredWeeks.length} тиж.
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* 5. Modal: Week Details [👁 Деталі] */}
      {selectedWeekModal && (() => {
        const weekDetails = getWeekDataForSelectedCompany(selectedWeekModal);
        const isCashGap = weekDetails.isCashGap;

        return (
          <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-150"
            onClick={(e) => {
              if (e.target === e.currentTarget) setSelectedWeekModal(null);
            }}
          >
            <div className="bg-white w-full max-w-6xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
              {/* Modal Header */}
              <div className="p-4 sm:p-6 border-b border-slate-200 bg-slate-50 flex items-start sm:items-center justify-between gap-4 shrink-0">
                <div className="flex items-start sm:items-center space-x-3">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-white shadow-2xs ${
                      isCashGap ? 'bg-rose-600' : 'bg-emerald-600'
                    }`}
                  >
                    {isCashGap ? <AlertTriangle className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5" />}
                  </div>
                  <div>
                    <div className="flex items-center flex-wrap gap-2">
                      <h3 className="text-base sm:text-xl font-bold text-slate-900">
                        Деталізація: {selectedWeekModal.weekLabel}
                      </h3>
                      {selectedWeekModal.isCurrentWeek && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-600 text-white">
                          Поточний тиждень
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5 flex items-center flex-wrap gap-x-2 gap-y-0.5">
                      <span>
                        Діапазон: <strong>{selectedWeekModal.startDate} – {selectedWeekModal.endDate}</strong>
                      </span>
                      <span>•</span>
                      <span>
                        Компанія: <strong>{selectedCompany === 'all' ? 'Всі компанії' : selectedCompany}</strong>
                      </span>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setSelectedWeekModal(null)}
                  className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-200/70 rounded-xl transition-colors cursor-pointer shrink-0"
                  title="Закрити вікно (Esc)"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Modal Summary Strip */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 p-3.5 sm:p-5 bg-slate-100/70 border-b border-slate-200 shrink-0 text-xs">
                <div className="bg-white p-3 sm:p-3.5 rounded-xl border border-slate-200 shadow-2xs">
                  <span className="text-[11px] font-bold text-slate-500 uppercase">Початковий залишок</span>
                  <p className="text-base sm:text-lg font-bold font-mono text-slate-800 mt-0.5">
                    {formatMoney(weekDetails.startBalance)}
                  </p>
                  <span className="text-[11px] text-slate-400">перейшов з попереднього тижня</span>
                </div>

                <div className="bg-white p-3 sm:p-3.5 rounded-xl border border-slate-200 shadow-2xs">
                  <span className="text-[11px] font-bold text-slate-500 uppercase">🟢 Вхід (Надходження)</span>
                  <p className="text-base sm:text-lg font-bold font-mono text-emerald-700 mt-0.5">
                    +{formatMoney(weekDetails.inflow)}
                  </p>
                  <span className="text-[11px] text-slate-400">
                    Факт: +{formatMoney(weekDetails.inflowFact)} | План: +{formatMoney(weekDetails.inflowPlan)}
                  </span>
                </div>

                <div className="bg-white p-3 sm:p-3.5 rounded-xl border border-slate-200 shadow-2xs">
                  <span className="text-[11px] font-bold text-slate-500 uppercase">🔴 Вихід (Витрати)</span>
                  <p className="text-base sm:text-lg font-bold font-mono text-rose-700 mt-0.5">
                    -{formatMoney(weekDetails.outflow)}
                  </p>
                  <span className="text-[11px] text-slate-400">
                    Факт: -{formatMoney(weekDetails.outflowFact)} | План: -{formatMoney(weekDetails.outflowPlan)}
                  </span>
                </div>

                <div
                  className={`p-3 sm:p-3.5 rounded-xl border shadow-2xs ${
                    isCashGap ? 'bg-rose-50 border-rose-200' : 'bg-emerald-50 border-emerald-200'
                  }`}
                >
                  <span className="text-[11px] font-bold uppercase text-slate-600">💰 Кінцевий залишок</span>
                  <p
                    className={`text-base sm:text-lg font-bold font-mono mt-0.5 ${
                      isCashGap ? 'text-rose-800' : 'text-emerald-800'
                    }`}
                  >
                    {weekDetails.endBalance > 0 && '+'}
                    {formatMoney(weekDetails.endBalance)}
                  </p>
                  <span className="text-[11px] font-bold text-slate-600">
                    {isCashGap ? '⚠️ Касовий розрив' : '🟢 Норма'}
                  </span>
                </div>
              </div>

              {/* Modal Body: 2-Column Responsive */}
              <div className="p-4 sm:p-6 overflow-y-auto flex-1">
                {renderTwoColumnDetails(selectedWeekModal, false)}
              </div>

              {/* Modal Footer */}
              <div className="p-3.5 sm:p-5 border-t border-slate-200 bg-slate-50 flex items-center justify-between shrink-0">
                <div className="text-xs text-slate-500 hidden sm:block">
                  {selectedWeekModal.weekLabel} • {selectedCompany === 'all' ? 'Всі компанії' : selectedCompany}
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedWeekModal(null)}
                  className="w-full sm:w-auto px-5 py-2.5 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer shadow-2xs ml-auto"
                >
                  Закрити
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 6. Starting Balance Edit Modal */}
      {isEditingStartingBalance && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-150"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsEditingStartingBalance(false);
          }}
        >
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="w-9 h-9 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center">
                  <Wallet className="w-5 h-5" />
                </div>
                <h3 className="text-base font-bold text-slate-900">
                  Початковий залишок коштів
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsEditingStartingBalance(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-500">
              Вкажіть фактичну суму живих грошей на розрахункових рахунках / у касі на початок розрахункового періоду ({selectedYear} рік).
            </p>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Сума початкового залишку (грн):
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={startingBalanceInput}
                  onChange={(e) => setStartingBalanceInput(e.target.value)}
                  placeholder="наприклад: 6000000"
                  className="w-full pl-3 pr-8 py-2 text-base font-mono font-bold border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-slate-900"
                  autoFocus
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono font-bold text-slate-400 text-sm">
                  ₴
                </span>
              </div>
            </div>

            {/* Quick Presets */}
            <div>
              <span className="text-[11px] font-semibold text-slate-500 block mb-1.5">
                Швидкий вибір:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {[0, 1000000, 3000000, 5000000, 6000000, 10000000].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setStartingBalanceInput(String(preset))}
                    className="px-2.5 py-1 text-xs font-mono font-semibold rounded-lg bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-slate-700 border border-slate-200 transition-colors cursor-pointer"
                  >
                    {formatMoney(preset)}
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-end space-x-2">
              <button
                type="button"
                onClick={() => setIsEditingStartingBalance(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 rounded-xl cursor-pointer"
              >
                Скасувати
              </button>
              <button
                type="button"
                onClick={() => handleSaveStartingBalance()}
                className="px-5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-xs transition-colors cursor-pointer"
              >
                Зберегти залишок
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
