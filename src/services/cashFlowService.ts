/**
 * Cash Flow Aggregation Service (Календар платежів по тижнях)
 * 
 * 🟢 Вхід (Надходження): витягує суми та тижні з полів Оплата 1...4 усіх проєктів,
 *    згруповані за обраним тижнем та ТОВ/ФОП:
 *    - колонка G починається на ШІ -> "Шоп Інтеріор"
 *    - починається на ГП -> "Гала Продакшн"
 *    - починається на ІН -> "Інокс Україна"
 *    - починається на ПШ -> "Преміум Шоп"
 *    - починається на ІКВ -> "Ільїнський Костянтин Владиславович"
 * 
 * 🔴 Вихід (Витрати): витягує суми рахунків постачальників зі статусом "Не оплачено",
 *    згруповані за плановим тижнем оплати (дата завантаження + 5 днів) та ТОВ/ФОП.
 * 
 * ⚖️ Підсумковий Тижневий Баланс: (Вхід - Вихід)
 */

import {
  ProjectSheetRow,
  ExistingSheetRow,
  CashFlowInflowItem,
  CashFlowOutflowItem,
  CompanyWeeklyCashFlow,
  WeeklyCashFlow,
  CashFlowSummary,
} from '../types';
import {
  getIsoWeekDetails,
  parseWeekString,
  calculatePlannedPaymentDate,
  getCompanyFromProjectColG,
  getCompanyFromInvoice,
  generateWeekOptions,
  CASH_FLOW_COMPANIES,
} from '../utils/weekUtils';

export interface CashFlowAggregationOptions {
  targetYear?: number;
  daysToAddForPayment?: number; // default: 5
  includeOnlyStrictlyUnpaid?: boolean; // default: true ('Не оплачено')
  includePartiallyPaidBalance?: boolean; // default: true
  minWeekNumber?: number; // Filter weeks if desired
  maxWeekNumber?: number;
}

/**
 * Parses any amount representation into a clean number.
 */
export function parseCashFlowAmount(val: unknown): number {
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (!val) return 0;
  const str = String(val).trim();
  const cleaned = str
    .replace(/\s/g, '')
    .replace(',', '.')
    .replace(/[^0-9.-]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : Math.round(num * 100) / 100;
}

/**
 * Aggregates projects inflows and supplier invoices outflows into weekly cash flow.
 */
export function aggregateCashFlow(
  projects: ProjectSheetRow[] = [],
  invoices: ExistingSheetRow[] = [],
  options: CashFlowAggregationOptions = {}
): CashFlowSummary {
  const targetYear = options.targetYear || 2026;
  const daysToAdd = options.daysToAddForPayment ?? 5;
  const includePartiallyPaid = options.includePartiallyPaidBalance ?? true;

  // Map to store weekly data by weekKey e.g. "2026-W40"
  const weeksMap = new Map<string, WeeklyCashFlow>();

  // Helper to ensure a week entry exists in the map
  const getOrCreateWeek = (
    weekKey: string,
    weekNumber: number,
    year: number,
    weekLabel: string,
    shortLabel: string,
    startDate: string,
    endDate: string,
    isCurrentWeek: boolean
  ): WeeklyCashFlow => {
    let entry = weeksMap.get(weekKey);
    if (!entry) {
      entry = {
        weekKey,
        weekNumber,
        year,
        weekLabel,
        shortLabel,
        startDate,
        endDate,
        isCurrentWeek,
        totalInflow: 0,
        totalOutflow: 0,
        netBalance: 0,
        byCompany: {},
      };
      weeksMap.set(weekKey, entry);
    }
    return entry;
  };

  // Helper to ensure company entry exists in a week
  const getOrCreateCompanyWeek = (
    week: WeeklyCashFlow,
    company: string
  ): CompanyWeeklyCashFlow => {
    if (!week.byCompany[company]) {
      week.byCompany[company] = {
        company,
        inflow: 0,
        outflow: 0,
        balance: 0,
        inflowItems: [],
        outflowItems: [],
      };
    }
    return week.byCompany[company];
  };

  // 1. Pre-populate calendar weeks for the target year (e.g. standard active weeks range)
  const standardWeekOptions = generateWeekOptions(targetYear);
  for (const opt of standardWeekOptions) {
    const key = `${opt.year}-W${String(opt.weekNumber).padStart(2, '0')}`;
    getOrCreateWeek(
      key,
      opt.weekNumber,
      opt.year,
      opt.fullLabel,
      opt.shortLabel,
      opt.startDate,
      opt.endDate,
      opt.isCurrentWeek
    );
  }

  let unmatchedInflowsCount = 0;
  let unmatchedOutflowsCount = 0;

  // 2. 🟢 Process INFLOWS (Вхід) from Projects' 4 tranches
  for (const project of projects) {
    const company = getCompanyFromProjectColG(project.colG);
    const projectCode = project.colA || `Рядок ${project.rowNumber}`;
    const client = project.colB || '';
    const projectName = project.colC || '';
    const colG = project.colG || '';

    // Define the 4 tranches (amount column & week column)
    const tranches: Array<{
      num: 1 | 2 | 3 | 4;
      amountRaw?: string;
      weekRaw?: string;
    }> = [
      { num: 1, amountRaw: project.colZ, weekRaw: project.colAA },
      { num: 2, amountRaw: project.colAB, weekRaw: project.colAC },
      { num: 3, amountRaw: project.colAD, weekRaw: project.colAE },
      { num: 4, amountRaw: project.colAF, weekRaw: project.colAG },
    ];

    for (const tranche of tranches) {
      const amount = parseCashFlowAmount(tranche.amountRaw);
      const weekRaw = (tranche.weekRaw || '').trim();

      if (amount <= 0 || !weekRaw) continue;

      const weekInfo = parseWeekString(weekRaw, targetYear);
      if (!weekInfo) {
        unmatchedInflowsCount++;
        continue;
      }

      const weekEntry = getOrCreateWeek(
        weekInfo.weekKey,
        weekInfo.weekNumber,
        weekInfo.year,
        weekInfo.fullLabel,
        weekInfo.shortLabel,
        '',
        '',
        false
      );

      const compEntry = getOrCreateCompanyWeek(weekEntry, company);

      const item: CashFlowInflowItem = {
        projectRowNumber: project.rowNumber,
        projectCode,
        client,
        projectName,
        colG,
        company,
        trancheNumber: tranche.num,
        amount,
        rawAmount: tranche.amountRaw || '',
        rawWeek: weekRaw,
        weekKey: weekInfo.weekKey,
        weekNumber: weekInfo.weekNumber,
        year: weekInfo.year,
        weekLabel: weekInfo.fullLabel,
      };

      compEntry.inflowItems.push(item);
      compEntry.inflow += amount;
      weekEntry.totalInflow += amount;
    }
  }

  // 3. 🔴 Process OUTFLOWS (Вихід) from Unpaid Supplier Invoices
  for (const invoice of invoices) {
    const isUnpaid = invoice.paymentStatus === 'Не оплачено';
    const isPartiallyPaid = invoice.paymentStatus === 'Оплачено частково';

    if (!isUnpaid && !(includePartiallyPaid && isPartiallyPaid)) {
      continue;
    }

    const totalAmount = parseCashFlowAmount(invoice.amount);
    const paidAmount = parseCashFlowAmount(invoice.paidAmount);
    const unpaidAmount = isPartiallyPaid
      ? Math.max(0, totalAmount - paidAmount)
      : totalAmount;

    if (unpaidAmount <= 0) continue;

    // Company determination for our paying entity (ТОВ/ФОП)
    const company = getCompanyFromInvoice(invoice);

    // Planned payment date = (дата завантаження + 5 днів)
    const { plannedDate, plannedDateIso } = calculatePlannedPaymentDate(
      invoice.uploadedAt,
      invoice.invoiceDate,
      daysToAdd
    );

    const weekDetails = getIsoWeekDetails(plannedDate);
    if (!weekDetails) {
      unmatchedOutflowsCount++;
      continue;
    }

    const weekEntry = getOrCreateWeek(
      weekDetails.weekKey,
      weekDetails.weekNumber,
      weekDetails.year,
      weekDetails.fullLabel,
      weekDetails.shortLabel,
      weekDetails.startDate,
      weekDetails.endDate,
      false
    );

    const compEntry = getOrCreateCompanyWeek(weekEntry, company);

    const item: CashFlowOutflowItem = {
      invoiceRowIndex: invoice.rowIndex,
      invoiceNumber: invoice.invoiceNumber || 'б/н',
      supplier: invoice.supplier || 'Невідомий постачальник',
      buyer: invoice.buyer || '',
      company,
      orderNumber: invoice.orderNumber,
      amount: unpaidAmount,
      totalInvoiceAmount: totalAmount,
      paidAmount,
      approvalStatus: invoice.approvalStatus || 'ПОГОДЖЕНО',
      uploadedAt: invoice.uploadedAt || '',
      invoiceDate: invoice.invoiceDate,
      plannedPaymentDate: plannedDateIso,
      weekKey: weekDetails.weekKey,
      weekNumber: weekDetails.weekNumber,
      year: weekDetails.year,
      weekLabel: weekDetails.fullLabel,
    };

    compEntry.outflowItems.push(item);
    compEntry.outflow += unpaidAmount;
    weekEntry.totalOutflow += unpaidAmount;
  }

  // 4. Compute Net Balance (Вхід - Вихід) and clean up each week
  const companyTotalsMap: Record<
    string,
    {
      company: string;
      inflow: number;
      outflow: number;
      balance: number;
      inflowCount: number;
      outflowCount: number;
    }
  > = {};

  // Initialize company totals for primary companies
  for (const c of CASH_FLOW_COMPANIES) {
    companyTotalsMap[c] = {
      company: c,
      inflow: 0,
      outflow: 0,
      balance: 0,
      inflowCount: 0,
      outflowCount: 0,
    };
  }

  let grandTotalInflow = 0;
  let grandTotalOutflow = 0;

  for (const week of weeksMap.values()) {
    week.totalInflow = Math.round(week.totalInflow * 100) / 100;
    week.totalOutflow = Math.round(week.totalOutflow * 100) / 100;
    // ⚖️ Підсумковий тижневий баланс = Вхід - Вихід
    week.netBalance = Math.round((week.totalInflow - week.totalOutflow) * 100) / 100;

    grandTotalInflow += week.totalInflow;
    grandTotalOutflow += week.totalOutflow;

    for (const [compName, compData] of Object.entries(week.byCompany)) {
      compData.inflow = Math.round(compData.inflow * 100) / 100;
      compData.outflow = Math.round(compData.outflow * 100) / 100;
      compData.balance = Math.round((compData.inflow - compData.outflow) * 100) / 100;

      if (!companyTotalsMap[compName]) {
        companyTotalsMap[compName] = {
          company: compName,
          inflow: 0,
          outflow: 0,
          balance: 0,
          inflowCount: 0,
          outflowCount: 0,
        };
      }
      companyTotalsMap[compName].inflow += compData.inflow;
      companyTotalsMap[compName].outflow += compData.outflow;
      companyTotalsMap[compName].inflowCount += compData.inflowItems.length;
      companyTotalsMap[compName].outflowCount += compData.outflowItems.length;
    }
  }

  // Calculate balances for company totals
  for (const record of Object.values(companyTotalsMap)) {
    record.inflow = Math.round(record.inflow * 100) / 100;
    record.outflow = Math.round(record.outflow * 100) / 100;
    record.balance = Math.round((record.inflow - record.outflow) * 100) / 100;
  }

  // Sort weeks chronologically by year, then by weekNumber
  const sortedWeeks = Array.from(weeksMap.values()).sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    return a.weekNumber - b.weekNumber;
  });

  return {
    weeks: sortedWeeks,
    grandTotalInflow: Math.round(grandTotalInflow * 100) / 100,
    grandTotalOutflow: Math.round(grandTotalOutflow * 100) / 100,
    grandTotalBalance: Math.round((grandTotalInflow - grandTotalOutflow) * 100) / 100,
    companyTotals: companyTotalsMap,
    unmatchedInflowsCount,
    unmatchedOutflowsCount,
  };
}

/**
 * Static Cash Flow Service utility
 */
export class CashFlowService {
  /**
   * Aggregates cash flow from project list and invoice list
   */
  public static aggregate(
    projects: ProjectSheetRow[],
    invoices: ExistingSheetRow[],
    options?: CashFlowAggregationOptions
  ): CashFlowSummary {
    return aggregateCashFlow(projects, invoices, options);
  }

  /**
   * Helper to detect company for a project from Column G
   */
  public static getCompanyFromColG(colG?: string): string {
    return getCompanyFromProjectColG(colG);
  }

  /**
   * Helper to detect company for an invoice
   */
  public static getCompanyFromInvoice(invoice: { buyer?: string; orderNumber?: string }): string {
    return getCompanyFromInvoice(invoice);
  }

  /**
   * Helper to calculate planned payment date (uploadedAt + 5 days)
   */
  public static getPlannedPaymentDate(uploadedAt?: string, invoiceDate?: string, daysToAdd = 5) {
    return calculatePlannedPaymentDate(uploadedAt, invoiceDate, daysToAdd);
  }
}
