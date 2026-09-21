/**
 * Week Picker utilities for project payment schedule planning.
 * Generates ISO-8601 weeks with Ukrainian formatted week numbers and date ranges:
 * e.g. "Т40 (28.09 – 04.10.2026)"
 */

export interface WeekOption {
  value: string; // e.g. "Т40 (28.09 – 04.10.2026)"
  weekNumber: number; // 40
  year: number; // 2026
  startDate: string; // "28.09.2026"
  endDate: string; // "04.10.2026"
  shortLabel: string; // "Т40"
  fullLabel: string; // "Т40 (28.09 – 04.10.2026)"
  altLabel: string; // "Тиждень 40 (28.09 - 04.10)"
  isCurrentWeek: boolean;
}

/**
 * Returns Monday of ISO week 1 for a given year.
 * In ISO-8601, week 1 is the week with the first Thursday of the year,
 * or equivalently the week containing January 4.
 */
function getIsoWeek1Monday(year: number): Date {
  const jan4 = new Date(year, 0, 4);
  const dayOfWeek = jan4.getDay(); // 0 = Sunday, 1 = Monday, ... 6 = Saturday
  const isoDay = dayOfWeek === 0 ? 7 : dayOfWeek;
  const monday = new Date(year, 0, 4 - (isoDay - 1));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

/**
 * Pads a number with leading zero if needed
 */
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Formats a Date as DD.MM
 */
function formatShortDate(d: Date): string {
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}`;
}

/**
 * Formats a Date as DD.MM.YYYY
 */
function formatFullDate(d: Date): string {
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/**
 * Generates a list of week options for multiple years (default: current year - 1, current year, next year).
 * Each option is formatted as: "Т{W} ({DD.MM} – {DD.MM.YYYY})"
 */
export function generateWeekOptions(targetYear = 2026): WeekOption[] {
  const options: WeekOption[] = [];
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  // We generate weeks for 2025 (late weeks), 2026 (all weeks), and 2027 (all weeks)
  const years = [targetYear - 1, targetYear, targetYear + 1];

  for (const yr of years) {
    const week1Monday = getIsoWeek1Monday(yr);
    const startWeek = yr === targetYear - 1 ? 35 : 1; // Prior year: show Q4
    const totalWeeks = 52; // Standard 52 weeks

    for (let w = startWeek; w <= totalWeeks; w++) {
      const mon = new Date(week1Monday.getTime() + (w - 1) * 7 * 86400000);
      const sun = new Date(mon.getTime() + 6 * 86400000);

      // Check if current date falls in this week
      const isCurrent = now >= mon && now <= sun;

      const fullLabel = `Т${w} (${formatShortDate(mon)} – ${formatFullDate(sun)})`;
      const altLabel = `Тиждень ${w} (${formatShortDate(mon)} - ${formatShortDate(sun)})`;

      options.push({
        value: fullLabel,
        weekNumber: w,
        year: yr,
        startDate: formatFullDate(mon),
        endDate: formatFullDate(sun),
        shortLabel: `Т${w}`,
        fullLabel,
        altLabel,
        isCurrentWeek: isCurrent,
      });
    }
  }

  return options;
}

/**
 * Finds or synthesizes a week option for a given string value
 */
export function matchOrCreateWeekOption(rawVal: string, options: WeekOption[]): WeekOption | null {
  if (!rawVal || !rawVal.trim()) return null;
  const clean = rawVal.trim();

  // 1. Direct exact match
  const exact = options.find((opt) => opt.value === clean || opt.fullLabel === clean);
  if (exact) return exact;

  // 2. Case-insensitive or partial match
  const lower = clean.toLowerCase();
  const partial = options.find(
    (opt) =>
      opt.value.toLowerCase() === lower ||
      opt.altLabel.toLowerCase() === lower ||
      opt.shortLabel.toLowerCase() === lower
  );
  if (partial) return partial;

  // 3. Match by week number e.g. "Т39", "Тиждень 39", "39"
  const weekNumMatch = clean.match(/(?:т|тиждень|\b)(\d{1,2})\b/i);
  if (weekNumMatch) {
    const num = parseInt(weekNumMatch[1], 10);
    const byNum = options.find((opt) => opt.weekNumber === num && opt.year === 2026);
    if (byNum) return byNum;
  }

  return null;
}

/**
 * Calculates standard ISO-8601 week number and ISO year for any Date.
 * In ISO-8601, week 1 is the week with the first Thursday of the year.
 */
export function getIsoWeek(date: Date): { weekNumber: number; year: number } {
  const target = new Date(date.valueOf());
  // Thursday in current week decides the year (0 = Mon, ..., 6 = Sun)
  const dayNr = (date.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
  }
  const weekNumber = 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
  const isoYear = new Date(firstThursday).getFullYear();
  return { weekNumber, year: isoYear };
}

/**
 * Generates comprehensive week metadata for a given Date.
 */
export function getIsoWeekDetails(date: Date): {
  weekKey: string; // e.g. "2026-W40"
  weekNumber: number;
  year: number;
  fullLabel: string; // "Т40 (28.09 – 04.10.2026)"
  shortLabel: string; // "Т40"
  startDate: string; // "28.09.2026"
  endDate: string; // "04.10.2026"
  monday: Date;
  sunday: Date;
} {
  const { weekNumber, year } = getIsoWeek(date);
  const week1Monday = getIsoWeek1Monday(year);
  const monday = new Date(week1Monday.getTime() + (weekNumber - 1) * 7 * 86400000);
  const sunday = new Date(monday.getTime() + 6 * 86400000);
  const fullLabel = `Т${weekNumber} (${formatShortDate(monday)} – ${formatFullDate(sunday)})`;
  const shortLabel = `Т${weekNumber}`;
  const weekKey = `${year}-W${pad2(weekNumber)}`;

  return {
    weekKey,
    weekNumber,
    year,
    fullLabel,
    shortLabel,
    startDate: formatFullDate(monday),
    endDate: formatFullDate(sunday),
    monday,
    sunday,
  };
}

/**
 * Parses arbitrary week strings (e.g. "Т40 (28.09 – 04.10.2026)", "Т40", "Тиждень 40", "W40", "40")
 * and extracts { weekNumber, year, weekKey, fullLabel, shortLabel }.
 */
export function parseWeekString(
  rawVal: string,
  defaultYear = 2026
): {
  weekKey: string;
  weekNumber: number;
  year: number;
  fullLabel: string;
  shortLabel: string;
} | null {
  if (!rawVal || !rawVal.trim()) return null;
  const clean = rawVal.trim();

  // Try extracting 4-digit year if present
  let year = defaultYear;
  const yearMatch = clean.match(/\b(202[4-9]|203[0-9])\b/);
  if (yearMatch) {
    year = parseInt(yearMatch[1], 10);
  }

  // Try extracting week number (e.g. "Т40", "Тиждень 40", "W40", "40")
  const weekMatch = clean.match(/(?:т|тиждень|w|\b)(\d{1,2})\b/i);
  if (!weekMatch) return null;

  const weekNumber = parseInt(weekMatch[1], 10);
  if (isNaN(weekNumber) || weekNumber < 1 || weekNumber > 53) return null;

  const week1Monday = getIsoWeek1Monday(year);
  const monday = new Date(week1Monday.getTime() + (weekNumber - 1) * 7 * 86400000);
  const sunday = new Date(monday.getTime() + 6 * 86400000);
  const fullLabel = `Т${weekNumber} (${formatShortDate(monday)} – ${formatFullDate(sunday)})`;
  const shortLabel = `Т${weekNumber}`;
  const weekKey = `${year}-W${pad2(weekNumber)}`;

  return {
    weekKey,
    weekNumber,
    year,
    fullLabel,
    shortLabel,
  };
}

/**
 * Normalizes any date string (ISO YYYY-MM-DD, DD.MM.YYYY, timestamp) to a JavaScript Date object.
 */
export function parseAnyDateToDate(dateInput?: string | number | Date | null): Date | null {
  if (!dateInput) return null;
  if (dateInput instanceof Date) {
    return isNaN(dateInput.getTime()) ? null : dateInput;
  }
  if (typeof dateInput === 'number') {
    const d = new Date(dateInput);
    return isNaN(d.getTime()) ? null : d;
  }

  const str = String(dateInput).trim();
  if (!str) return null;

  // 1. ISO: YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss
  const isoMatch = str.match(/^(\d{4})[./\-](\d{1,2})[./\-](\d{1,2})/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1], 10);
    const m = parseInt(isoMatch[2], 10);
    const d = parseInt(isoMatch[3], 10);
    return new Date(y, m - 1, d);
  }

  // 2. Ukrainian: DD.MM.YYYY or DD.MM.YY
  const dmyMatch = str.match(/^(\d{1,2})[./\-](\d{1,2})[./\-](\d{2,4})/);
  if (dmyMatch) {
    const d = parseInt(dmyMatch[1], 10);
    const m = parseInt(dmyMatch[2], 10);
    let y = parseInt(dmyMatch[3], 10);
    if (y < 100) y += y >= 70 ? 1900 : 2000;
    return new Date(y, m - 1, d);
  }

  // 3. Fallback standard Date.parse
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }

  return null;
}

/**
 * Calculates planned payment date: (дата завантаження + 5 днів)
 * Fallback to invoice date + 5 days, or today + 5 days.
 */
export function calculatePlannedPaymentDate(
  uploadedAt?: string,
  invoiceDate?: string,
  daysToAdd = 5
): {
  plannedDate: Date;
  plannedDateIso: string;
  plannedDateFormatted: string;
} {
  let baseDate = parseAnyDateToDate(uploadedAt);
  if (!baseDate) {
    baseDate = parseAnyDateToDate(invoiceDate);
  }
  if (!baseDate) {
    baseDate = new Date();
    baseDate.setHours(0, 0, 0, 0);
  }

  const planned = new Date(baseDate.getTime() + daysToAdd * 86400000);
  const plannedIso = `${planned.getFullYear()}-${pad2(planned.getMonth() + 1)}-${pad2(planned.getDate())}`;
  const plannedDateFormatted = formatFullDate(planned);

  return {
    plannedDate: planned,
    plannedDateIso: plannedIso,
    plannedDateFormatted,
  };
}

/**
 * Standard list of canonical company keys for Cash Flow (збігаються з вкладкою "Наші компанії")
 */
export const CASH_FLOW_COMPANIES = [
  'ТОВ ПРЕМІУМ ШОП',
  'ТОВ ШОП ІНТЕРІОР',
  'ТОВ ГАЛА ПРОДАКШН',
  'ТОВ ІНОКС УКРАЇНА',
  'ФОП Ільїнський Костянтин Владиславович',
] as const;

/**
 * Логіка визначення нашої компанії для замовлення:
 * перевіряємо колонку G таблиці Оплати/Борги вкладка Лист1:
 * - якщо запис починається на ПШ -> це "ТОВ ПРЕМІУМ ШОП"
 * - якщо на ШІ -> це "ТОВ ШОП ІНТЕРІОР"
 * - якщо на ГП -> це "ТОВ ГАЛА ПРОДАКШН"
 * - якщо на ІН -> це "ТОВ ІНОКС УКРАЇНА"
 * - якщо ІКВ -> це "ФОП Ільїнський Костянтин Владиславович"
 */
export function getCompanyFromProjectColG(colG?: string): string {
  if (!colG) return 'Інші';
  const clean = colG.trim().replace(/^[№#\s"«]+/, '');

  // Case-insensitive prefix matching with Cyrillic & Latin character support
  // ПШ -> ТОВ ПРЕМІУМ ШОП
  if (/^ПШ/i.test(clean)) {
    return 'ТОВ ПРЕМІУМ ШОП';
  }
  // ШІ / ШI (Latin I) -> ТОВ ШОП ІНТЕРІОР
  if (/^Ш[ІI]/i.test(clean)) {
    return 'ТОВ ШОП ІНТЕРІОР';
  }
  // ГП / ГP (Latin P) -> ТОВ ГАЛА ПРОДАКШН
  if (/^Г[ПP]/i.test(clean)) {
    return 'ТОВ ГАЛА ПРОДАКШН';
  }
  // ІН / IH / IN / ІN -> ТОВ ІНОКС УКРАЇНА
  if (/^[ІI][НHN]/i.test(clean)) {
    return 'ТОВ ІНОКС УКРАЇНА';
  }
  // ІКВ / IKB / ICB -> ФОП Ільїнський Костянтин Владиславович
  if (/^[ІI][КKC][ВVB]/i.test(clean)) {
    return 'ФОП Ільїнський Костянтин Владиславович';
  }

  // Substring search fallback
  const upper = clean.toUpperCase();
  if (upper.includes('ПРЕМІУМ') || upper.includes('PREMIUM')) {
    return 'ТОВ ПРЕМІУМ ШОП';
  }
  if ((upper.includes('ШОП') && upper.includes('ІНТЕР')) || upper.includes('SHOP INTERIOR')) {
    return 'ТОВ ШОП ІНТЕРІОР';
  }
  if (upper.includes('ГАЛА') || upper.includes('GALA')) {
    return 'ТОВ ГАЛА ПРОДАКШН';
  }
  if (upper.includes('ІНОКС') || upper.includes('INOX')) {
    return 'ТОВ ІНОКС УКРАЇНА';
  }
  if (upper.includes('ІЛЬЇН') || upper.includes('ИЛЬИН') || upper.includes('ILYIN')) {
    return 'ФОП Ільїнський Костянтин Владиславович';
  }

  return clean || 'Інші';
}

/**
 * Нормалізація платника (нашої компанії ТОВ/ФОП) з рахунку постачальника для синхронізації з Календарем платежів
 */
export function getCompanyFromInvoice(invoice: {
  buyer?: string;
  orderNumber?: string;
}): string {
  const buyer = (invoice.buyer || '').trim();
  if (buyer) {
    const upper = buyer.toUpperCase();
    if (/^ПШ/i.test(upper) || upper.includes('ПРЕМІУМ') || upper.includes('PREMIUM')) {
      return 'ТОВ ПРЕМІУМ ШОП';
    }
    if (/^Ш[ІI]/i.test(upper) || (upper.includes('ШОП') && upper.includes('ІНТЕР')) || upper.includes('SHOP INTERIOR')) {
      return 'ТОВ ШОП ІНТЕРІОР';
    }
    if (/^Г[ПP]/i.test(upper) || upper.includes('ГАЛА') || upper.includes('GALA')) {
      return 'ТОВ ГАЛА ПРОДАКШН';
    }
    if (/^[ІI][НHN]/i.test(upper) || upper.includes('ІНОКС') || upper.includes('INOX')) {
      return 'ТОВ ІНОКС УКРАЇНА';
    }
    if (/^[ІI][КKC][ВVB]/i.test(upper) || upper.includes('ІЛЬЇН') || upper.includes('ИЛЬИН') || upper.includes('ILYIN')) {
      return 'ФОП Ільїнський Костянтин Владиславович';
    }
  }

  // Fallback: check if orderNumber has company prefix
  if (invoice.orderNumber) {
    const fromOrder = getCompanyFromProjectColG(invoice.orderNumber);
    if (fromOrder !== 'Інші' && fromOrder !== invoice.orderNumber) {
      return fromOrder;
    }
  }

  return buyer || 'Інші';
}

