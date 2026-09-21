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
} from 'lucide-react';
import {
  ProjectSheetRow,
  ExistingSheetRow,
  SheetCompanyLists,
  SheetConfig,
  WeeklyCashFlow,
  CashFlowInflowItem,
  CashFlowOutflowItem,
  CompanyWeeklyCashFlow,
} from '../types';
import { aggregateCashFlow } from '../services/cashFlowService';
import { CASH_FLOW_COMPANIES } from '../utils/weekUtils';
import { DEFAULT_OUR_COMPANIES } from '../data/sampleDocuments';

interface Props {
  projects: ProjectSheetRow[];
  invoices: ExistingSheetRow[];
  companyLists?: SheetCompanyLists;
  sheetConfig?: SheetConfig | null;
  onRefresh?: () => Promise<void>;
  isLoading?: boolean;
}

// Realistic fallback unpaid invoices if none exist in Google Sheet yet
const FALLBACK_UNPAID_INVOICES: ExistingSheetRow[] = [
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
  companyLists,
  sheetConfig,
  onRefresh,
  isLoading = false,
}) => {
  // Use fallback sample invoices if no invoices in state
  const effectiveInvoices = useMemo(() => {
    if (invoices && invoices.length > 0) return invoices;
    return FALLBACK_UNPAID_INVOICES;
  }, [invoices]);

  // Selected Legal Entity (ТОВ/ФОП)
  // 'all' represents "Всі компанії"
  const [selectedCompany, setSelectedCompany] = useState<string>('all');

  // Year filter
  const [selectedYear, setSelectedYear] = useState<number>(2026);

  // Filter: all weeks vs active weeks only (weeks with inflow or outflow)
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
    // 1. Source companies: from Google Sheets tab "Наші компанії", fallback to DEFAULT_OUR_COMPANIES
    const rawList =
      companyLists?.ourCompanies && companyLists.ourCompanies.length > 0
        ? companyLists.ourCompanies
        : DEFAULT_OUR_COMPANIES;

    // 2. Map keyed by core name to eliminate duplicates (e.g., prevents "Шоп Інтеріор" vs "ТОВ ШОП ІНТЕРІОР")
    const companyMap = new Map<string, string>();

    // Seed with standard canonical companies from specification
    for (const std of CASH_FLOW_COMPANIES) {
      const core = getCompanyCoreKey(std);
      companyMap.set(core, std);
    }

    // Process companies from "Наші компанії"
    for (const raw of rawList) {
      const trimmed = (raw || '').trim();
      if (!trimmed || trimmed.length < 2) continue;

      const core = getCompanyCoreKey(trimmed);
      if (!companyMap.has(core)) {
        companyMap.set(core, trimmed);
      } else {
        // If current candidate has full legal prefix (ТОВ/ФОП) and existing doesn't, upgrade to full name
        const existing = companyMap.get(core)!;
        const hasLegalPrefix = /^(тов|фоп|пат|прат|пп|тдв)\s*/i.test(trimmed);
        const existingHasPrefix = /^(тов|фоп|пат|прат|пп|тдв)\s*/i.test(existing);
        if (hasLegalPrefix && !existingHasPrefix) {
          companyMap.set(core, trimmed);
        }
      }
    }

    return Array.from(companyMap.values());
  }, [companyLists?.ourCompanies]);

  // Run aggregation service
  const cashFlowSummary = useMemo(() => {
    return aggregateCashFlow(projects, effectiveInvoices, {
      targetYear: selectedYear,
      daysToAddForPayment: 5,
    });
  }, [projects, effectiveInvoices, selectedYear]);

  // Format currency in Ukrainian locale
  const formatMoney = (val: number): string => {
    return new Intl.NumberFormat('uk-UA', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(val) + ' ₴';
  };

  // Helper to extract company-specific or all-company numbers for a week
  const getWeekDataForSelectedCompany = (week: WeeklyCashFlow) => {
    if (selectedCompany === 'all') {
      return {
        inflow: week.totalInflow,
        outflow: week.totalOutflow,
        balance: week.netBalance,
        inflowCount: Object.values(week.byCompany).reduce((sum, c) => sum + c.inflowItems.length, 0),
        outflowCount: Object.values(week.byCompany).reduce((sum, c) => sum + c.outflowItems.length, 0),
        inflowItems: Object.values(week.byCompany).flatMap((c) => c.inflowItems),
        outflowItems: Object.values(week.byCompany).flatMap((c) => c.outflowItems),
      };
    }

    // 1. Try finding exact matching company in week.byCompany
    let compData: CompanyWeeklyCashFlow | undefined = week.byCompany[selectedCompany];

    // 2. If not found by exact string key, match by normalized core name
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
      return {
        inflow: compData.inflow,
        outflow: compData.outflow,
        balance: compData.balance,
        inflowCount: compData.inflowItems.length,
        outflowCount: compData.outflowItems.length,
        inflowItems: compData.inflowItems,
        outflowItems: compData.outflowItems,
      };
    }

    return {
      inflow: 0,
      outflow: 0,
      balance: 0,
      inflowCount: 0,
      outflowCount: 0,
      inflowItems: [] as CashFlowInflowItem[],
      outflowItems: [] as CashFlowOutflowItem[],
    };
  };

  // Filter weeks based on search, active status, and status filter
  const filteredWeeks = useMemo(() => {
    return cashFlowSummary.weeks.filter((week) => {
      const { inflow, outflow, balance, inflowItems, outflowItems } = getWeekDataForSelectedCompany(week);

      // Active weeks filter (hide empty weeks unless it's the current week)
      if (showOnlyActiveWeeks) {
        if (inflow === 0 && outflow === 0 && !week.isCurrentWeek) {
          return false;
        }
      }

      // Status filter
      if (statusFilter === 'gap' && balance >= 0) return false;
      if (statusFilter === 'ok' && balance < 0) return false;

      // Search query filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesWeek = week.weekLabel.toLowerCase().includes(query) ||
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
    let totalInflow = 0;
    let totalOutflow = 0;
    let cashGapWeeksCount = 0;
    let normalWeeksCount = 0;

    for (const week of filteredWeeks) {
      const { inflow, outflow, balance } = getWeekDataForSelectedCompany(week);
      totalInflow += inflow;
      totalOutflow += outflow;
      if (balance < 0) {
        cashGapWeeksCount++;
      } else if (inflow > 0 || outflow > 0) {
        normalWeeksCount++;
      }
    }

    const netBalance = Math.round((totalInflow - totalOutflow) * 100) / 100;

    return {
      totalInflow: Math.round(totalInflow * 100) / 100,
      totalOutflow: Math.round(totalOutflow * 100) / 100,
      netBalance,
      cashGapWeeksCount,
      normalWeeksCount,
      totalWeeks: filteredWeeks.length,
    };
  }, [filteredWeeks, selectedCompany]);

  // Render two-column details (left: Inflows, right: Outflows)
  // Left column: #Проєкт, Назва, Номер оплати, Сума грн
  // Right column: Постачальник, #Проєкт, Сума грн, Статус погодження
  // Mobile responsive layout
  const renderTwoColumnDetails = (week: WeeklyCashFlow, isInline = false) => {
    const weekDetails = getWeekDataForSelectedCompany(week);
    const isCashGap = weekDetails.balance < 0;

    return (
      <div className="space-y-4">
        {/* Mobile column tabs switch: visible on small screens to easily switch between columns */}
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
          {/* ЛІВА КОЛОНКА: Деталізація надходжень */}
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
                      <span>Деталізація надходжень</span>
                      <span className="px-1.5 py-0.2 text-[10px] font-bold rounded-full bg-emerald-200/70 text-emerald-900">
                        {weekDetails.inflowItems.length}
                      </span>
                    </h4>
                    <p className="text-[11px] text-emerald-700">
                      Очікується оплата за проєктами у цей тиждень
                    </p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-xs sm:text-sm font-bold font-mono text-emerald-700 block">
                    +{formatMoney(weekDetails.inflow)} грн
                  </span>
                  <span className="text-[10px] text-emerald-600 font-medium">Разом вхід</span>
                </div>
              </div>

              {/* Inflows Content */}
              <div className="p-3 sm:p-4">
                {weekDetails.inflowItems.length === 0 ? (
                  <div className="py-8 px-4 text-center rounded-xl bg-slate-50 border border-dashed border-slate-200 text-slate-400">
                    <Info className="w-6 h-6 mx-auto mb-1.5 opacity-60" />
                    <p className="text-xs font-semibold text-slate-700">Очікуваних надходжень на цей тиждень немає</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">В таблиці проєктів графік оплат на {week.shortLabel} не заплановано</p>
                  </div>
                ) : (
                  <>
                    {/* Desktop / Tablet Table */}
                    <div className="hidden sm:block overflow-x-auto border border-slate-200 rounded-xl">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="bg-slate-100/80 text-slate-700 font-bold border-b border-slate-200 select-none">
                            <th className="py-2.5 px-3 whitespace-nowrap">#Проєкт</th>
                            <th className="py-2.5 px-3">Назва</th>
                            <th className="py-2.5 px-3 whitespace-nowrap">Номер оплати</th>
                            <th className="py-2.5 px-3 text-right whitespace-nowrap">Сума грн</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {weekDetails.inflowItems.map((item, idx) => (
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
                                {item.client && item.projectName && item.client !== item.projectName && (
                                  <div className="text-[11px] text-slate-400 mt-0.5">
                                    {item.client}
                                  </div>
                                )}
                              </td>
                              <td className="py-2.5 px-3 whitespace-nowrap">
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                                  Оплата {item.trancheNumber}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-700 whitespace-nowrap">
                                +{formatMoney(item.amount)} грн
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="bg-emerald-50/50 border-t border-emerald-200 font-bold text-emerald-950 text-xs">
                            <td colSpan={3} className="py-2.5 px-3">
                              Разом за надходженнями ({weekDetails.inflowItems.length}):
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
                      {weekDetails.inflowItems.map((item, idx) => (
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
                          {item.client && item.projectName && item.client !== item.projectName && (
                            <div className="text-[11px] text-slate-500">
                              {item.client}
                            </div>
                          )}
                          <div className="flex items-center justify-between pt-1.5 border-t border-slate-200/60 text-[11px]">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                              Оплата {item.trancheNumber}
                            </span>
                            {item.company && (
                              <span className="text-slate-400 text-[10px]">
                                {item.company}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                      <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-950 flex items-center justify-between">
                        <span>Разом надходження:</span>
                        <span className="font-mono text-emerald-700">+{formatMoney(weekDetails.inflow)} грн</span>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* ПРАВА КОЛОНКА: Деталізація витрат */}
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
                      <span>Деталізація витрат</span>
                      <span className="px-1.5 py-0.2 text-[10px] font-bold rounded-full bg-rose-200/70 text-rose-900">
                        {weekDetails.outflowItems.length}
                      </span>
                    </h4>
                    <p className="text-[11px] text-rose-700">
                      Рахунки постачальників на цей тиждень
                    </p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-xs sm:text-sm font-bold font-mono text-rose-700 block">
                    -{formatMoney(weekDetails.outflow)} грн
                  </span>
                  <span className="text-[10px] text-rose-600 font-medium">Разом вихід</span>
                </div>
              </div>

              {/* Outflows Content */}
              <div className="p-3 sm:p-4">
                {weekDetails.outflowItems.length === 0 ? (
                  <div className="py-8 px-4 text-center rounded-xl bg-slate-50 border border-dashed border-slate-200 text-slate-400">
                    <Info className="w-6 h-6 mx-auto mb-1.5 opacity-60" />
                    <p className="text-xs font-semibold text-slate-700">Рахунків до сплати на цей тиждень немає</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">Неоплачених рахунків постачальників із планом оплати на {week.shortLabel} не виявлено</p>
                  </div>
                ) : (
                  <>
                    {/* Desktop / Tablet Table */}
                    <div className="hidden sm:block overflow-x-auto border border-slate-200 rounded-xl">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="bg-slate-100/80 text-slate-700 font-bold border-b border-slate-200 select-none">
                            <th className="py-2.5 px-3">Постачальник</th>
                            <th className="py-2.5 px-3 whitespace-nowrap">#Проєкт</th>
                            <th className="py-2.5 px-3 text-right whitespace-nowrap">Сума грн</th>
                            <th className="py-2.5 px-3 text-center whitespace-nowrap">Статус погодження</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {weekDetails.outflowItems.map((item, idx) => (
                            <tr key={idx} className="hover:bg-rose-50/25 transition-colors">
                              <td className="py-2.5 px-3">
                                <div className="font-semibold text-slate-900 leading-snug">
                                  {item.supplier}
                                </div>
                                <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1.5">
                                  <span>№ {item.invoiceNumber}</span>
                                  {item.invoiceDate && (
                                    <span>• від {item.invoiceDate}</span>
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
                              <td className="py-2.5 px-3 text-right font-mono font-bold text-rose-700 whitespace-nowrap">
                                -{formatMoney(item.amount)} грн
                              </td>
                              <td className="py-2.5 px-3 text-center whitespace-nowrap">
                                {getApprovalBadge(item.approvalStatus)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="bg-rose-50/50 border-t border-rose-200 font-bold text-rose-950 text-xs">
                            <td colSpan={2} className="py-2.5 px-3">
                              Разом за витратами ({weekDetails.outflowItems.length}):
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
                            <div className="flex items-center space-x-1.5">
                              <span className="text-slate-500 text-[10px]">#Проєкт:</span>
                              {item.orderNumber ? (
                                <span className="font-mono font-bold text-slate-700 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded text-[10px]">
                                  #{item.orderNumber.replace(/^#/, '')}
                                </span>
                              ) : (
                                <span className="text-slate-400 font-mono text-[10px]">—</span>
                              )}
                            </div>
                            <div>
                              {getApprovalBadge(item.approvalStatus)}
                            </div>
                          </div>
                        </div>
                      ))}
                      <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs font-bold text-rose-950 flex items-center justify-between">
                        <span>Разом витрати:</span>
                        <span className="font-mono text-rose-700">-{formatMoney(weekDetails.outflow)} грн</span>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Net Balance Summary Strip */}
        <div className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
          isCashGap
            ? 'bg-rose-50/90 border-rose-200 text-rose-900'
            : 'bg-emerald-50/90 border-emerald-200 text-emerald-900'
        }`}>
          <div className="flex items-start sm:items-center space-x-3">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-white shrink-0 ${
              isCashGap ? 'bg-rose-600' : 'bg-emerald-600'
            }`}>
              {isCashGap ? <AlertTriangle className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5" />}
            </div>
            <div>
              <div className="text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                <span>{isCashGap ? '⚠️ Касовий розрив на тиждень' : '🟢 Профіцит коштів (Норма)'}</span>
                <span className="text-[11px] font-normal opacity-75">
                  (Вхід - Вихід)
                </span>
              </div>
              <p className="text-[11px] opacity-85 mt-0.5">
                {isCashGap
                  ? `Дефіцит становить ${formatMoney(Math.abs(weekDetails.balance))} грн. Рекомендовано змістити дату оплати рахунків постачальників або прискорити надходження траншу.`
                  : 'Поточних надходжень достатньо для повної та своєчасної оплати рахунків.'}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3 shrink-0 self-end sm:self-center font-mono">
            <div className="text-right">
              <span className="text-[10px] uppercase font-bold text-slate-500 block">Підсумок сальдо</span>
              <span className={`text-base sm:text-lg font-extrabold ${isCashGap ? 'text-rose-700' : 'text-emerald-700'}`}>
                {weekDetails.balance > 0 && '+'}
                {formatMoney(weekDetails.balance)} грн
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* 1. Header Bar with Title, Spreadsheet Link, and Refresh */}
      <div className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center space-x-3.5">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 text-white flex items-center justify-center shadow-xs shrink-0">
              <TrendingUp className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center flex-wrap gap-2">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
                  Календар платежів (Cash Flow)
                </h1>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200/80">
                  Потижневий баланс
                </span>
                {selectedCompany !== 'all' && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                    <Building2 className="w-3 h-3 mr-1 text-slate-500" />
                    {selectedCompany}
                  </span>
                )}
              </div>
              <p className="text-xs sm:text-sm text-slate-500 mt-1">
                Зведення надходжень за графіками проєктів (Вхід) та неоплачених рахунків постачальників (Вихід: дата завантаження + 5 днів).
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center flex-wrap gap-2.5 shrink-0">
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

        {/* 2. Filters & Company Selection Bar */}
        <div className="mt-5 pt-5 border-t border-slate-100 flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4">
          {/* Company Selector & "Всі компанії" Switch */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 w-full xl:w-auto">
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wider whitespace-nowrap flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-indigo-600" />
              Юридична особа:
            </span>

            {/* Quick Toggle: "Всі компанії" vs Specific */}
            <div className="inline-flex p-1 bg-slate-100 rounded-xl border border-slate-200/80 shrink-0">
              <button
                type="button"
                onClick={() => setSelectedCompany('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  selectedCompany === 'all'
                    ? 'bg-white text-indigo-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Всі компанії
              </button>
              <button
                type="button"
                onClick={() => {
                  if (selectedCompany === 'all') {
                    setSelectedCompany(availableCompanies[0] || 'ТОВ ПРЕМІУМ ШОП');
                  }
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  selectedCompany !== 'all'
                    ? 'bg-white text-indigo-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Обрати ТОВ/ФОП
              </button>
            </div>

            {/* Dropdown list for selecting specific company */}
            <div className="relative w-full sm:w-72">
              <select
                value={selectedCompany}
                onChange={(e) => setSelectedCompany(e.target.value)}
                className="w-full pl-3 pr-8 py-2 text-xs font-semibold bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-slate-900 cursor-pointer appearance-none shadow-2xs"
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
          </div>

          {/* Additional Filter Controls: Status, Year, Active Weeks, Search */}
          <div className="flex flex-wrap items-center gap-2.5 w-full xl:w-auto">
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
                title="Показати тільки тижні з дефіцитом"
              >
                <span>⚠️ Розриви</span>
                {aggregatedTotals.cashGapWeeksCount > 0 && (
                  <span className={`px-1 rounded text-[10px] ${statusFilter === 'gap' ? 'bg-rose-800 text-white' : 'bg-rose-100 text-rose-800'}`}>
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
                title="Показати тільки тижні з позитивним балансом"
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
              title="Перемикач: тільки тижні з операціями чи весь рік (52 тижні)"
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
                <option value={2025}>2025 рік</option>
                <option value={2026}>2026 рік</option>
                <option value={2027}>2027 рік</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            {/* Search Input */}
            <div className="relative min-w-[180px] sm:w-56">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Пошук (тиждень, замовлення...)"
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

      {/* 3. KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Inflow (Вхід) */}
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
            <p className="text-[11px] text-slate-400 mt-0.5">
              Графік траншів замовлень (Оплата 1-4)
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 border border-emerald-100">
            <ArrowDownRight className="w-5 h-5" />
          </div>
        </div>

        {/* Total Outflow (Вихід) */}
        <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <div className="flex items-center space-x-1.5">
              <span className="w-2 h-2 rounded-full bg-rose-500"></span>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                🔴 Витрати (Вихід)
              </span>
            </div>
            <p className="text-xl sm:text-2xl font-bold font-mono text-rose-700 mt-1.5">
              {formatMoney(aggregatedTotals.totalOutflow)}
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Неоплачені рахунки (+5 днів від завантаження)
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0 border border-rose-100">
            <ArrowUpRight className="w-5 h-5" />
          </div>
        </div>

        {/* Net Balance (Баланс) */}
        <div className={`rounded-2xl p-4 sm:p-5 border shadow-xs flex items-center justify-between transition-colors ${
          aggregatedTotals.netBalance < 0
            ? 'bg-rose-50/70 border-rose-200 text-rose-950'
            : 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
        }`}>
          <div>
            <div className="flex items-center space-x-1.5">
              <Scale className={`w-3.5 h-3.5 ${aggregatedTotals.netBalance < 0 ? 'text-rose-600' : 'text-emerald-600'}`} />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                ⚖️ Підсумковий Баланс
              </span>
            </div>
            <p className={`text-xl sm:text-2xl font-bold font-mono mt-1.5 ${
              aggregatedTotals.netBalance < 0 ? 'text-rose-700' : 'text-emerald-700'
            }`}>
              {formatMoney(aggregatedTotals.netBalance)}
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {aggregatedTotals.netBalance < 0 ? '⚠️ Загальний дефіцит коштів' : '🟢 Позитивний грошовий потік'}
            </p>
          </div>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
            aggregatedTotals.netBalance < 0
              ? 'bg-rose-100 text-rose-700 border-rose-200'
              : 'bg-emerald-100 text-emerald-700 border-emerald-200'
          }`}>
            {aggregatedTotals.netBalance < 0 ? (
              <AlertTriangle className="w-5 h-5" />
            ) : (
              <CheckCircle2 className="w-5 h-5" />
            )}
          </div>
        </div>

        {/* Cash Gap Alert / Summary */}
        <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <div className="flex items-center space-x-1.5">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Тижні з розривом
              </span>
            </div>
            <div className="flex items-baseline space-x-2 mt-1.5">
              <p className={`text-xl sm:text-2xl font-bold font-mono ${
                aggregatedTotals.cashGapWeeksCount > 0 ? 'text-rose-700' : 'text-slate-800'
              }`}>
                {aggregatedTotals.cashGapWeeksCount}
              </p>
              <span className="text-xs text-slate-400">
                з {filteredWeeks.length} тижнів
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {aggregatedTotals.cashGapWeeksCount > 0
                ? 'Потрібне коригування термінів оплат'
                : 'Касових розривів не виявлено'}
            </p>
          </div>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
            aggregatedTotals.cashGapWeeksCount > 0
              ? 'bg-amber-50 text-amber-600 border-amber-200'
              : 'bg-slate-50 text-slate-400 border-slate-200'
          }`}>
            <AlertTriangle className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* 4. Main Summary Table by Weeks */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/50">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <span>Зведена таблиця по тижнях ({selectedYear})</span>
              <span className="text-xs font-normal text-slate-500">
                (показано {filteredWeeks.length} тижнів)
              </span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Якщо баланс &lt; 0 грн, тиждень позначається як касовий розрив і підсвічується червоним кольором.
            </p>
          </div>

          <div className="flex items-center space-x-2 text-xs">
            <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold">
              🟢 Норма (Баланс ≥ 0)
            </span>
            <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-rose-50 text-rose-800 border border-rose-200 font-semibold">
              ⚠️ Касовий розрив (Баланс &lt; 0)
            </span>
          </div>
        </div>

        {/* Table Content */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100/80 text-slate-700 font-bold border-b border-slate-200 select-none">
                <th className="py-3 px-4 sm:px-6 w-56">Тиждень</th>
                <th className="py-3 px-4 text-right">🟢 Надходження (Вхід)</th>
                <th className="py-3 px-4 text-right">🔴 Витрати (Вихід)</th>
                <th className="py-3 px-4 text-right">⚖️ Баланс тижня</th>
                <th className="py-3 px-4 text-center w-40">Статус</th>
                <th className="py-3 px-4 sm:px-6 text-center w-28">Дія</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredWeeks.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    <div className="max-w-sm mx-auto flex flex-col items-center">
                      <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mb-2">
                        <Search className="w-6 h-6" />
                      </div>
                      <p className="font-semibold text-slate-700 text-sm">Тижнів за вказаними фільтрами не знайдено</p>
                      <p className="text-xs text-slate-400 mt-1">
                        Спробуйте вимкнути фільтр "Тільки активні тижні" або змінити параметри пошуку.
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
                    inflow,
                    outflow,
                    balance,
                    inflowCount,
                    outflowCount,
                  } = getWeekDataForSelectedCompany(week);

                  const isCashGap = balance < 0;
                  const isZeroActivity = inflow === 0 && outflow === 0;

                  return (
                    <React.Fragment key={week.weekKey}>
                      <tr
                        className={`hover:bg-slate-50/80 transition-colors ${
                          week.isCurrentWeek ? 'bg-indigo-50/30 font-medium' : ''
                        } ${isCashGap ? 'bg-rose-50/20' : ''}`}
                      >
                      {/* Column 1: Week name and date range */}
                      <td className="py-3 px-4 sm:px-6">
                        <div className="flex items-center space-x-2">
                          <div className={`w-2 h-2 rounded-full shrink-0 ${
                            isZeroActivity
                              ? 'bg-slate-300'
                              : isCashGap
                              ? 'bg-rose-500'
                              : 'bg-emerald-500'
                          }`} />
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

                      {/* Column 2: Inflow (🟢 Вхід) */}
                      <td className="py-3 px-4 text-right">
                        <div className="font-mono font-bold text-emerald-700 text-xs sm:text-sm">
                          {inflow > 0 ? `+${formatMoney(inflow)}` : '0,00 ₴'}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          {inflowCount > 0 ? `${inflowCount} ${inflowCount === 1 ? 'транш' : inflowCount < 5 ? 'транші' : 'траншів'}` : '—'}
                        </div>
                      </td>

                      {/* Column 3: Outflow (🔴 Вихід) */}
                      <td className="py-3 px-4 text-right">
                        <div className="font-mono font-bold text-rose-700 text-xs sm:text-sm">
                          {outflow > 0 ? `-${formatMoney(outflow)}` : '0,00 ₴'}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          {outflowCount > 0 ? `${outflowCount} ${outflowCount === 1 ? 'рахунок' : outflowCount < 5 ? 'рахунки' : 'рахунків'}` : '—'}
                        </div>
                      </td>

                      {/* Column 4: Weekly Balance (⚖️ Баланс тижня) */}
                      <td className="py-3 px-4 text-right">
                        <div className="inline-block">
                          <span
                            className={`font-mono font-bold text-xs sm:text-sm px-2.5 py-1 rounded-lg inline-flex items-center gap-1 border ${
                              isCashGap
                                ? 'bg-rose-100/80 text-rose-800 border-rose-300 shadow-2xs font-extrabold'
                                : balance > 0
                                ? 'bg-emerald-100/80 text-emerald-800 border-emerald-300'
                                : 'bg-slate-100 text-slate-600 border-slate-200'
                            }`}
                          >
                            {balance > 0 && '+'}
                            {formatMoney(balance)}
                          </span>
                        </div>
                      </td>

                      {/* Column 5: Status (Статус: ⚠️ Касовий розрив vs 🟢 Норма) */}
                      <td className="py-3 px-4 text-center">
                        {isCashGap ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200/90 shadow-2xs">
                            <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                            <span>⚠️ Касовий розрив</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/90">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            <span>🟢 Норма</span>
                          </span>
                        )}
                      </td>

                      {/* Column 6: Action button [👁 Деталі] & Inline Expansion [▼] */}
                      <td className="py-3 px-4 sm:px-6 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedWeekModal(week);
                              setDetailsActiveTab('all');
                            }}
                            className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-slate-700 border border-slate-200/90 hover:border-indigo-200 transition-all cursor-pointer shadow-2xs"
                            title={`Відкрити модальне вікно деталей для ${week.shortLabel}`}
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
                    {/* Inline Details Expansion Row */}
                    {expandedWeekKeys.has(week.weekKey) && (
                      <tr className="bg-slate-50/80 border-b border-indigo-100">
                        <td colSpan={6} className="p-3 sm:p-5">
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

            {/* Table Footer with Grand Totals */}
            {filteredWeeks.length > 0 && (
              <tfoot>
                <tr className="bg-slate-100/90 font-bold border-t-2 border-slate-300 text-slate-900 text-xs sm:text-sm">
                  <td className="py-4 px-4 sm:px-6">
                    <div className="flex items-center space-x-2">
                      <Scale className="w-4 h-4 text-indigo-600" />
                      <span>РАЗОМ ЗА ОБРАНИМ ФІЛЬТРОМ:</span>
                    </div>
                  </td>
                  <td className="py-4 px-4 text-right font-mono text-emerald-800 text-sm sm:text-base">
                    +{formatMoney(aggregatedTotals.totalInflow)}
                  </td>
                  <td className="py-4 px-4 text-right font-mono text-rose-800 text-sm sm:text-base">
                    -{formatMoney(aggregatedTotals.totalOutflow)}
                  </td>
                  <td className="py-4 px-4 text-right">
                    <span className={`font-mono px-3 py-1 rounded-lg inline-block border text-sm sm:text-base font-extrabold ${
                      aggregatedTotals.netBalance < 0
                        ? 'bg-rose-200 text-rose-900 border-rose-400'
                        : 'bg-emerald-200 text-emerald-900 border-emerald-400'
                    }`}>
                      {aggregatedTotals.netBalance > 0 && '+'}
                      {formatMoney(aggregatedTotals.netBalance)}
                    </span>
                  </td>
                  <td className="py-4 px-4 text-center">
                    {aggregatedTotals.netBalance < 0 ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-300">
                        ⚠️ Дефіцит коштів
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                        🟢 Позитивний баланс
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
        const isCashGap = weekDetails.balance < 0;

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

              {/* Modal Summary KPI Strip */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 sm:p-5 bg-slate-100/70 border-b border-slate-200 shrink-0 text-xs">
                <div className="bg-white p-3 sm:p-3.5 rounded-xl border border-slate-200 shadow-2xs">
                  <span className="text-[11px] font-bold text-slate-500 uppercase">🟢 Надходження (Вхід)</span>
                  <p className="text-base sm:text-lg font-bold font-mono text-emerald-700 mt-0.5">
                    +{formatMoney(weekDetails.inflow)} грн
                  </p>
                  <span className="text-[11px] text-slate-400">
                    {weekDetails.inflowItems.length} оплат за проєктами
                  </span>
                </div>

                <div className="bg-white p-3 sm:p-3.5 rounded-xl border border-slate-200 shadow-2xs">
                  <span className="text-[11px] font-bold text-slate-500 uppercase">🔴 Витрати (Вихід)</span>
                  <p className="text-base sm:text-lg font-bold font-mono text-rose-700 mt-0.5">
                    -{formatMoney(weekDetails.outflow)} грн
                  </p>
                  <span className="text-[11px] text-slate-400">
                    {weekDetails.outflowItems.length} рахунків постачальників
                  </span>
                </div>

                <div
                  className={`p-3 sm:p-3.5 rounded-xl border shadow-2xs ${
                    isCashGap ? 'bg-rose-50 border-rose-200' : 'bg-emerald-50 border-emerald-200'
                  }`}
                >
                  <span className="text-[11px] font-bold uppercase text-slate-600">⚖️ Баланс тижня</span>
                  <p
                    className={`text-base sm:text-lg font-bold font-mono mt-0.5 ${
                      isCashGap ? 'text-rose-800' : 'text-emerald-800'
                    }`}
                  >
                    {weekDetails.balance > 0 && '+'}
                    {formatMoney(weekDetails.balance)} грн
                  </p>
                  <span className="text-[11px] font-bold text-slate-600">
                    {isCashGap ? '⚠️ Касовий розрив' : '🟢 Норма'}
                  </span>
                </div>
              </div>

              {/* Modal Scrollable Body: 2-Column Responsive Inflows & Outflows */}
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
    </div>
  );
};
