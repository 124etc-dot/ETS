/**
 * Cash Flow Aggregation Service (Календар платежів План-Факт)
 * 
 * 🟢 Надходження (Вхід):
 *    - Факт: реально отримані аванси/транші та банківські надходження
 *    - План: очікувані надходження за графіками замовлень (Оплата 1...4)
 * 
 * 🔴 Витрати (Вихід):
 *    - Сплачено (Факт): виплачені рахунки та банківські проведення за датою фактичної оплати
 *    - До сплати (План): залишок неоплачених рахунків (дата завантаження + 5 днів)
 *    - Загальні витрати = Сплачено (Факт) + До сплати (План)
 * 
 * 💰 Залишок на кінець тижня (Накопичувальний Cash Balance):
 *    Кінцевий Залишок = Початковий Залишок + Усі Надходження - Усі Витрати
 *    Перехід між тижнями: Кінцевий залишок тижня Т39 стає Початковим залишком для тижня Т40.
 * 
 * ⚠️ Касовий розрив:
 *    Спрацьовує ТІЛЬКИ якщо Накопичувальний Кінцевий Залишок тижня < 0 грн.
 */

import {
  ProjectSheetRow,
  ExistingSheetRow,
  ExistingPaymentRow,
  CashFlowInflowItem,
  CashFlowOutflowItem,
  CompanyWeeklyCashFlow,
  WeeklyCashFlow,
  CashFlowSummary,
  CashFlowViewMode,
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
  startingBalance?: number; // Початковий залишок живих грошей на початок періоду
  companyStartingBalances?: Record<string, number>;
  payments?: ExistingPaymentRow[]; // Фактичні банківські платіжки з виписки
  receivedTrancheKeys?: string[]; // IDs/keys траншів, позначених як отримані (Факт)
  mode?: CashFlowViewMode; // 'plan-fact' | 'fact-only' | 'plan-only'
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
 * Parses diverse Ukrainian date strings into a JavaScript Date object.
 */
export function parseDateStringToDate(dateStr?: string): Date | null {
  if (!dateStr) return null;
  const clean = dateStr.trim();
  if (!clean) return null;

  // DD.MM.YYYY or DD.MM.YYYY HH:mm
  const dmyMatch = clean.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10) - 1;
    const year = parseInt(dmyMatch[3], 10);
    const d = new Date(year, month, day);
    if (!isNaN(d.getTime())) return d;
  }

  // YYYY-MM-DD
  const ymdMatch = clean.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (ymdMatch) {
    const year = parseInt(ymdMatch[1], 10);
    const month = parseInt(ymdMatch[2], 10) - 1;
    const day = parseInt(ymdMatch[3], 10);
    const d = new Date(year, month, day);
    if (!isNaN(d.getTime())) return d;
  }

  const parsed = new Date(clean);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Formats a Date object into DD.MM.YYYY string
 */
export function formatDateToUk(date: Date): string {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${d}.${m}.${y}`;
}

/**
 * Aggregates projects inflows, invoices, and bank payments into weekly cash flow.
 */
export function aggregateCashFlow(
  projects: ProjectSheetRow[] = [],
  invoices: ExistingSheetRow[] = [],
  options: CashFlowAggregationOptions = {}
): CashFlowSummary {
  const targetYear = options.targetYear || 2026;
  const daysToAdd = options.daysToAddForPayment ?? 5;
  const initialStartingBalance = Math.max(0, options.startingBalance ?? 0);
  const mode = options.mode || 'plan-fact';
  const payments = options.payments || [];
  const receivedTrancheKeysSet = new Set(options.receivedTrancheKeys || []);

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
        isPastWeek: false,
        startBalance: 0,
        endBalance: 0,
        inflowFact: 0,
        inflowPlan: 0,
        totalInflow: 0,
        outflowFact: 0,
        outflowPlan: 0,
        totalOutflow: 0,
        netBalance: 0,
        isCashGap: false,
        deficitAmount: 0,
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
        inflowFact: 0,
        inflowPlan: 0,
        inflow: 0,
        outflowFact: 0,
        outflowPlan: 0,
        outflow: 0,
        balance: 0,
        startBalance: 0,
        endBalance: 0,
        inflowItems: [],
        outflowItems: [],
      };
    }
    return week.byCompany[company];
  };

  // 1. Pre-populate calendar weeks for the target year (e.g. 52 standard weeks)
  const standardWeekOptions = generateWeekOptions(targetYear);
  for (const opt of standardWeekOptions) {
    const key = `${opt.year}-W${String(opt.weekNumber).padStart(2, '0')}`;
    const week = getOrCreateWeek(
      key,
      opt.weekNumber,
      opt.year,
      opt.fullLabel,
      opt.shortLabel,
      opt.startDate,
      opt.endDate,
      opt.isCurrentWeek
    );
    // Mark past weeks
    if (opt.isCurrentWeek) {
      week.isPastWeek = false;
    }
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

      // Check if this tranche is marked as received (Fact) or scheduled (Plan)
      const trancheUniqueKey = `${project.rowNumber}_t${tranche.num}`;
      const isMarkedFact = receivedTrancheKeysSet.has(trancheUniqueKey);

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
        status: isMarkedFact ? 'fact' : 'plan',
        isFact: isMarkedFact,
      };

      compEntry.inflowItems.push(item);
      if (isMarkedFact) {
        compEntry.inflowFact += amount;
        weekEntry.inflowFact += amount;
      } else {
        compEntry.inflowPlan += amount;
        weekEntry.inflowPlan += amount;
      }
    }
  }

  // 3. 🔴 Process OUTFLOWS (Витрати) from Invoices & Bank Payments
  // To avoid duplicate counting between paid invoices and bank payment slips,
  // we index payments and match them to invoices.
  const matchedPaymentRowIndexes = new Set<number>();

  for (const invoice of invoices) {
    const totalAmount = parseCashFlowAmount(invoice.amount);
    const paidAmount = parseCashFlowAmount(invoice.paidAmount);
    const isFullyPaid = invoice.paymentStatus === 'Оплачено' || (totalAmount > 0 && paidAmount >= totalAmount);
    const isPartiallyPaid = invoice.paymentStatus === 'Оплачено частково' && paidAmount > 0 && paidAmount < totalAmount;
    const isUnpaid = invoice.paymentStatus === 'Не оплачено' || (!isFullyPaid && !isPartiallyPaid);

    const company = getCompanyFromInvoice(invoice);

    // Try to find matching bank payment in payments tab to get exact payment date and payment number
    let matchedPayment: ExistingPaymentRow | undefined;
    if (isFullyPaid || isPartiallyPaid) {
      matchedPayment = payments.find((p) => {
        if (matchedPaymentRowIndexes.has(p.rowIndex)) return false;
        // Check invoice number reference
        if (
          invoice.invoiceNumber &&
          p.referencedInvoiceNumber &&
          invoice.invoiceNumber.trim().toLowerCase() === p.referencedInvoiceNumber.trim().toLowerCase()
        ) {
          return true;
        }
        // Check order number & amount
        if (
          invoice.orderNumber &&
          p.orderNumber &&
          invoice.orderNumber.trim() === p.orderNumber.trim() &&
          Math.abs(p.amountPaid - (isFullyPaid ? totalAmount : paidAmount)) < 1.0
        ) {
          return true;
        }
        return false;
      });

      if (matchedPayment) {
        matchedPaymentRowIndexes.add(matchedPayment.rowIndex);
      }
    }

    // A. 🔴 Сплачено (Факт) - if invoice is paid or partially paid
    if (isFullyPaid || isPartiallyPaid) {
      const factAmount = isFullyPaid ? totalAmount : paidAmount;

      // Determine exact date money actually left bank (Дата фактичної оплати)
      const exactPaymentDateStr =
        matchedPayment?.paymentDate ||
        (invoice as any).paymentDate ||
        (invoice as any).paidDate ||
        invoice.uploadedAt ||
        invoice.invoiceDate ||
        '';

      const paymentDateObj = parseDateStringToDate(exactPaymentDateStr) || new Date();
      const weekDetails = getIsoWeekDetails(paymentDateObj);

      if (weekDetails) {
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
          supplier: invoice.supplier || 'Постачальник',
          buyer: invoice.buyer || '',
          company,
          orderNumber: invoice.orderNumber,
          amount: factAmount,
          totalInvoiceAmount: totalAmount,
          paidAmount: factAmount,
          approvalStatus: invoice.approvalStatus || 'ПОГОДЖЕНО',
          uploadedAt: invoice.uploadedAt || '',
          invoiceDate: invoice.invoiceDate,
          plannedPaymentDate: exactPaymentDateStr,
          actualPaymentDate: exactPaymentDateStr ? formatDateToUk(paymentDateObj) : undefined,
          paymentNumber: matchedPayment?.paymentNumber,
          status: 'fact',
          isFact: true,
          weekKey: weekDetails.weekKey,
          weekNumber: weekDetails.weekNumber,
          year: weekDetails.year,
          weekLabel: weekDetails.fullLabel,
        };

        compEntry.outflowItems.push(item);
        compEntry.outflowFact += factAmount;
        weekEntry.outflowFact += factAmount;
      } else {
        unmatchedOutflowsCount++;
      }
    }

    // B. ⏳ До сплати (План) - unpaid amount of invoice
    if (isUnpaid || isPartiallyPaid) {
      const unpaidAmount = isPartiallyPaid
        ? Math.max(0, totalAmount - paidAmount)
        : totalAmount;

      if (unpaidAmount > 0) {
        const { plannedDate, plannedDateIso } = calculatePlannedPaymentDate(
          invoice.uploadedAt,
          invoice.invoiceDate,
          daysToAdd
        );

        const weekDetails = getIsoWeekDetails(plannedDate);
        if (weekDetails) {
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
            supplier: invoice.supplier || 'Постачальник',
            buyer: invoice.buyer || '',
            company,
            orderNumber: invoice.orderNumber,
            amount: unpaidAmount,
            totalInvoiceAmount: totalAmount,
            paidAmount: isPartiallyPaid ? paidAmount : 0,
            approvalStatus: invoice.approvalStatus || 'ПОГОДЖЕНО',
            uploadedAt: invoice.uploadedAt || '',
            invoiceDate: invoice.invoiceDate,
            plannedPaymentDate: plannedDateIso,
            actualPaymentDate: undefined,
            status: 'plan',
            isFact: false,
            weekKey: weekDetails.weekKey,
            weekNumber: weekDetails.weekNumber,
            year: weekDetails.year,
            weekLabel: weekDetails.fullLabel,
          };

          compEntry.outflowItems.push(item);
          compEntry.outflowPlan += unpaidAmount;
          weekEntry.outflowPlan += unpaidAmount;
        } else {
          unmatchedOutflowsCount++;
        }
      }
    }
  }

  // 4. 🔴 Direct Bank Payments from "Платіжки" not matched to an existing invoice
  // (e.g. rent, taxes, utilities, direct wire transfers to vendors)
  for (const payment of payments) {
    if (matchedPaymentRowIndexes.has(payment.rowIndex)) continue;
    const amount = parseCashFlowAmount(payment.amountPaid);
    if (amount <= 0) continue;

    const company =
      getCompanyFromProjectColG(payment.payer) ||
      getCompanyFromProjectColG(payment.orderNumber) ||
      'ТОВ ШОП ІНТЕРІОР';

    const paymentDateObj = parseDateStringToDate(payment.paymentDate) || new Date();
    const weekDetails = getIsoWeekDetails(paymentDateObj);

    if (weekDetails) {
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
        invoiceRowIndex: -payment.rowIndex,
        invoiceNumber: payment.referencedInvoiceNumber || `Пл. №${payment.paymentNumber || payment.rowIndex}`,
        supplier: payment.payee || 'Банківський переказ',
        buyer: payment.payer || company,
        company,
        orderNumber: payment.orderNumber,
        amount,
        totalInvoiceAmount: amount,
        paidAmount: amount,
        approvalStatus: 'ПОГОДЖЕНО',
        uploadedAt: payment.uploadedAt || payment.paymentDate,
        invoiceDate: payment.paymentDate,
        plannedPaymentDate: payment.paymentDate,
        actualPaymentDate: formatDateToUk(paymentDateObj),
        paymentNumber: payment.paymentNumber,
        status: 'fact',
        isFact: true,
        weekKey: weekDetails.weekKey,
        weekNumber: weekDetails.weekNumber,
        year: weekDetails.year,
        weekLabel: weekDetails.fullLabel,
      };

      compEntry.outflowItems.push(item);
      compEntry.outflowFact += amount;
      weekEntry.outflowFact += amount;
    }
  }

  // 5. Sort weeks chronologically by year, then by weekNumber
  const sortedWeeks = Array.from(weeksMap.values()).sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    return a.weekNumber - b.weekNumber;
  });

  // 6. Cumulative transition & calculation: Starting_Balance -> End_Balance (T39 -> T40)
  // End Balance = Start Balance + Total Inflow - Total Outflow
  let runningBalance = initialStartingBalance;
  let cumulativeFactInflow = 0;
  let cumulativeFactOutflow = 0;

  let grandTotalInflowFact = 0;
  let grandTotalInflowPlan = 0;
  let grandTotalInflow = 0;

  let grandTotalOutflowFact = 0;
  let grandTotalOutflowPlan = 0;
  let grandTotalOutflow = 0;

  let cashGapWeeksCount = 0;

  const companyTotalsMap: CashFlowSummary['companyTotals'] = {};
  for (const c of CASH_FLOW_COMPANIES) {
    companyTotalsMap[c] = {
      company: c,
      inflowFact: 0,
      inflowPlan: 0,
      inflow: 0,
      outflowFact: 0,
      outflowPlan: 0,
      outflow: 0,
      balance: 0,
      inflowCount: 0,
      outflowCount: 0,
    };
  }

  for (let i = 0; i < sortedWeeks.length; i++) {
    const week = sortedWeeks[i];

    // Starting Balance for the week is the End Balance of previous week
    week.startBalance = Math.round(runningBalance * 100) / 100;

    // Clean decimals for weekly metrics
    week.inflowFact = Math.round(week.inflowFact * 100) / 100;
    week.inflowPlan = Math.round(week.inflowPlan * 100) / 100;
    week.outflowFact = Math.round(week.outflowFact * 100) / 100;
    week.outflowPlan = Math.round(week.outflowPlan * 100) / 100;

    // Determine total inflow & outflow according to View Mode:
    // 'plan-fact' (Default): Inflow = Fact + Plan | Outflow = Paid (Fact) + To Pay (Plan)
    // 'fact-only': Inflow = Fact | Outflow = Paid (Fact)
    // 'plan-only': Inflow = Plan | Outflow = To Pay (Plan)
    if (mode === 'fact-only') {
      week.totalInflow = week.inflowFact;
      week.totalOutflow = week.outflowFact;
    } else if (mode === 'plan-only') {
      week.totalInflow = week.inflowPlan;
      week.totalOutflow = week.outflowPlan;
    } else {
      week.totalInflow = Math.round((week.inflowFact + week.inflowPlan) * 100) / 100;
      week.totalOutflow = Math.round((week.outflowFact + week.outflowPlan) * 100) / 100;
    }

    // Weekly operational net flow = Inflow - Outflow
    week.netBalance = Math.round((week.totalInflow - week.totalOutflow) * 100) / 100;

    // 💰 Cumulative Ending Cash Balance = Start Balance + Total Inflow - Total Outflow
    week.endBalance = Math.round((week.startBalance + week.netBalance) * 100) / 100;
    runningBalance = week.endBalance;

    // ⚠️ New Cash Gap Condition:
    // "Помилка/символ ⚠️ Касовий розрив спрацьовує ТІЛЬКИ якщо Накопичувальний Кінцевий Залишок тижня < 0 грн."
    week.isCashGap = week.endBalance < 0;
    week.deficitAmount = week.endBalance < 0 ? Math.abs(week.endBalance) : 0;

    if (week.isCashGap) {
      cashGapWeeksCount++;
    }

    // Accumulate grand totals
    grandTotalInflowFact += week.inflowFact;
    grandTotalInflowPlan += week.inflowPlan;
    grandTotalInflow += week.totalInflow;

    grandTotalOutflowFact += week.outflowFact;
    grandTotalOutflowPlan += week.outflowPlan;
    grandTotalOutflow += week.totalOutflow;

    cumulativeFactInflow += week.inflowFact;
    cumulativeFactOutflow += week.outflowFact;

    // Clean decimals for companies
    for (const [compName, compData] of Object.entries(week.byCompany)) {
      compData.inflowFact = Math.round(compData.inflowFact * 100) / 100;
      compData.inflowPlan = Math.round(compData.inflowPlan * 100) / 100;
      compData.outflowFact = Math.round(compData.outflowFact * 100) / 100;
      compData.outflowPlan = Math.round(compData.outflowPlan * 100) / 100;

      if (mode === 'fact-only') {
        compData.inflow = compData.inflowFact;
        compData.outflow = compData.outflowFact;
      } else if (mode === 'plan-only') {
        compData.inflow = compData.inflowPlan;
        compData.outflow = compData.outflowPlan;
      } else {
        compData.inflow = Math.round((compData.inflowFact + compData.inflowPlan) * 100) / 100;
        compData.outflow = Math.round((compData.outflowFact + compData.outflowPlan) * 100) / 100;
      }

      compData.balance = Math.round((compData.inflow - compData.outflow) * 100) / 100;

      if (!companyTotalsMap[compName]) {
        companyTotalsMap[compName] = {
          company: compName,
          inflowFact: 0,
          inflowPlan: 0,
          inflow: 0,
          outflowFact: 0,
          outflowPlan: 0,
          outflow: 0,
          balance: 0,
          inflowCount: 0,
          outflowCount: 0,
        };
      }

      companyTotalsMap[compName].inflowFact += compData.inflowFact;
      companyTotalsMap[compName].inflowPlan += compData.inflowPlan;
      companyTotalsMap[compName].inflow += compData.inflow;
      companyTotalsMap[compName].outflowFact += compData.outflowFact;
      companyTotalsMap[compName].outflowPlan += compData.outflowPlan;
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

  // 🏦 Live Money: Starting Balance + All Fact Inflow - All Fact Outflow
  const liveMoney = Math.round((initialStartingBalance + cumulativeFactInflow - cumulativeFactOutflow) * 100) / 100;

  // 🔮 Projected Balance: Cumulative balance at end of period
  const projectedBalance = sortedWeeks.length > 0 ? sortedWeeks[sortedWeeks.length - 1].endBalance : initialStartingBalance;

  return {
    weeks: sortedWeeks,
    startingBalance: initialStartingBalance,
    liveMoney,
    projectedBalance,
    grandTotalInflowFact: Math.round(grandTotalInflowFact * 100) / 100,
    grandTotalInflowPlan: Math.round(grandTotalInflowPlan * 100) / 100,
    grandTotalInflow: Math.round(grandTotalInflow * 100) / 100,
    grandTotalOutflowFact: Math.round(grandTotalOutflowFact * 100) / 100,
    grandTotalOutflowPlan: Math.round(grandTotalOutflowPlan * 100) / 100,
    grandTotalOutflow: Math.round(grandTotalOutflow * 100) / 100,
    grandTotalBalance: Math.round((grandTotalInflow - grandTotalOutflow) * 100) / 100,
    cashGapWeeksCount,
    companyTotals: companyTotalsMap,
    unmatchedInflowsCount,
    unmatchedOutflowsCount,
    mode,
  };
}

/**
 * Static Cash Flow Service utility
 */
export class CashFlowService {
  public static aggregate(
    projects: ProjectSheetRow[],
    invoices: ExistingSheetRow[],
    options?: CashFlowAggregationOptions
  ): CashFlowSummary {
    return aggregateCashFlow(projects, invoices, options);
  }

  public static getCompanyFromColG(colG?: string): string {
    return getCompanyFromProjectColG(colG);
  }

  public static getCompanyFromInvoice(invoice: { buyer?: string; orderNumber?: string }): string {
    return getCompanyFromInvoice(invoice);
  }

  public static getPlannedPaymentDate(uploadedAt?: string, invoiceDate?: string, daysToAdd = 5) {
    return calculatePlannedPaymentDate(uploadedAt, invoiceDate, daysToAdd);
  }
}
