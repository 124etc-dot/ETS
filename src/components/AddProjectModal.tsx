import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
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
  AlertTriangle,
  RefreshCw,
  FileSpreadsheet,
  ExternalLink,
  Edit2,
  Layers,
  Bookmark,
  Sparkles,
  Info,
} from 'lucide-react';
import { ProjectSheetRow, SheetConfig } from '../types';
import {
  GoogleSheetsService,
  DEFAULT_PROJECTS_SPREADSHEET_ID,
} from '../services/googleSheets';
import { generateWeekOptions } from '../utils/weekUtils';

interface AddProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingManagers?: string[];
  existingProjectNumbers?: string[];
  existingProjects?: ProjectSheetRow[];
  planSheetConfig?: {
    id: string;
    title: string;
    url: string;
  } | null;
  onPlanSheetConfigChange?: (cfg: { id: string; title: string; url: string } | null) => void;
  sheetConfig?: SheetConfig | null;
  accessToken?: string | null;
  spreadsheetId?: string;
  onProjectAdded?: (targetRow: number, projectNumber: string) => void;
  canWriteToSheets?: boolean;
}

export const PLAN_SPREADSHEET_STORAGE_KEY = 'plan_shipments_spreadsheet_config';
export const LAST_RECORDED_PROJECT_NUMBER_KEY = 'last_recorded_project_number';

export interface ProjectNumberResult {
  latestNumber: string;
  latestRow?: number | null;
  latestTab?: string | null;
}

/**
 * Robust algorithm to determine the true latest project number:
 * 1. Checks tab "План" (where active projects start at row 2094 downwards).
 *    Identifies the entry with the highest row index (e.g. row 2095: 245-26).
 * 2. Checks across all known sources (Plan, Payments, existing rows) for the current year (e.g. 26).
 *    Finds the maximum sequence number (e.g. 245 > 107).
 * 3. Reconciles both strategies to ensure row 2095 (245-26) or the true highest number is chosen,
 *    preventing accidental pick of historical or random rows like 107-26.
 */
export function determineLatestProjectNumber(
  sheetItems: Array<{ number: string; row: number; tab?: string }>,
  fallbackNumbers: string[] = [],
  fallbackProjects: ProjectSheetRow[] = []
): ProjectNumberResult {
  interface Candidate {
    clean: string;
    seq: number;
    year: number;
    row?: number;
    tab?: string;
    isFromPlan2094?: boolean;
  }

  const parseNumber = (
    numStr: string,
    row?: number,
    tab?: string
  ): Candidate | null => {
    if (!numStr) return null;
    const clean = numStr.trim().replace(/^[№#]\s*/, '');
    const match = clean.match(/^(\d+)-(\d{2})$/);
    if (match) {
      const seq = parseInt(match[1], 10);
      const year = parseInt(match[2], 10);
      const isPlanTab = Boolean(tab && tab.toLowerCase().includes('план'));
      const isFromPlan2094 = isPlanTab && typeof row === 'number' && row >= 2094;
      return { clean, seq, year, row, tab, isFromPlan2094 };
    }
    return null;
  };

  const candidates: Candidate[] = [];

  // 1. Sheet items retrieved directly with row numbers and tab info
  for (const item of sheetItems) {
    const c = parseNumber(item.number, item.row, item.tab);
    if (c) candidates.push(c);
  }

  // 2. Existing projects from props (with row numbers if available)
  for (const p of fallbackProjects) {
    if (p.colA) {
      const c = parseNumber(p.colA, p.rowNumber, 'План');
      if (c) candidates.push(c);
    }
  }

  // 3. Fallback number strings
  for (const num of fallbackNumbers) {
    const c = parseNumber(num);
    if (c) candidates.push(c);
  }

  if (candidates.length === 0) {
    return { latestNumber: '', latestRow: null, latestTab: null };
  }

  // Identify highest year (e.g. 26 for 2026)
  const maxYear = Math.max(...candidates.map((c) => c.year));

  // Strategy A: Latest row in tab "План" with row >= 2094 (active section of "План відвантажень")
  const planRowsFrom2094 = candidates
    .filter((c) => c.isFromPlan2094 && typeof c.row === 'number' && c.year === maxYear)
    .sort((a, b) => (a.row! - b.row!));

  let planRowCandidate: Candidate | null = null;
  if (planRowsFrom2094.length > 0) {
    planRowCandidate = planRowsFrom2094[planRowsFrom2094.length - 1];
  }

  // Strategy B: Maximum sequence number for the active year (e.g. 245 > 107)
  const yearCandidates = candidates.filter((c) => c.year === maxYear);
  yearCandidates.sort((a, b) => b.seq - a.seq);
  const maxSeqCandidate = yearCandidates[0];

  // Pick the winner:
  let chosen: Candidate = maxSeqCandidate;
  if (planRowCandidate) {
    if (planRowCandidate.seq >= maxSeqCandidate.seq) {
      chosen = planRowCandidate;
    } else {
      chosen = maxSeqCandidate;
    }
  }

  return {
    latestNumber: chosen.clean,
    latestRow: chosen.row || null,
    latestTab: chosen.tab || null,
  };
}

export const AddProjectModal: React.FC<AddProjectModalProps> = ({
  isOpen,
  onClose,
  existingManagers = [],
  existingProjectNumbers = [],
  existingProjects = [],
  planSheetConfig: propPlanSheetConfig,
  onPlanSheetConfigChange,
  sheetConfig,
  accessToken,
  spreadsheetId,
  onProjectAdded,
  canWriteToSheets = true,
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
  const [currencyRate, setCurrencyRate] = useState('1');
  const [tranches, setTranches] = useState<Array<{ amount: string; week: string }>>([
    { amount: '', week: '' },
    { amount: '', week: '' },
    { amount: '', week: '' },
    { amount: '', week: '' },
  ]);
  const [showTranches, setShowTranches] = useState(false);
  const weekOptions = useMemo(() => generateWeekOptions(2026), []);

  // Target Spreadsheets configuration
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

  // Effective Payments spreadsheet
  const effectivePaymentsId =
    spreadsheetId || sheetConfig?.spreadsheetId || DEFAULT_PROJECTS_SPREADSHEET_ID;
  const effectivePaymentsTitle =
    sheetConfig?.spreadsheetTitle || 'Оплати/Борги';
  const effectivePaymentsUrl =
    sheetConfig?.spreadsheetUrl ||
    `https://docs.google.com/spreadsheets/d/${effectivePaymentsId}/edit`;

  // Validation & Input Refs
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const projectNumberRef = useRef<HTMLInputElement>(null);
  const projectNameRef = useRef<HTMLInputElement>(null);
  const startDateRef = useRef<HTMLInputElement>(null);
  const managerRef = useRef<HTMLInputElement>(null);
  const invoiceNumberRef = useRef<HTMLInputElement>(null);
  const invoiceDateRef = useRef<HTMLInputElement>(null);
  const contractAmountRef = useRef<HTMLInputElement>(null);

  // Execution & Feedback State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<{
    projectNumber: string;
    plan: {
      row: number;
      tab: string;
      title: string;
      id: string;
    };
    payments: {
      row?: number;
      rowG: number;
      rowH: number;
      rowM: number;
      tab: string;
      title: string;
      id: string;
    } | null;
  } | null>(null);

  // Manager suggestions & memory
  const [savedManagers, setSavedManagers] = useState<string[]>([]);
  const [showManagerSuggestions, setShowManagerSuggestions] = useState(false);
  const managerContainerRef = useRef<HTMLDivElement>(null);

  // Sync planSheetConfig if prop changes
  useEffect(() => {
    if (propPlanSheetConfig) {
      setPlanSheetConfig(propPlanSheetConfig);
    }
  }, [propPlanSheetConfig]);

  // Stable refs for props and external state to prevent callback recreation and re-render loops
  const existingProjectNumbersRef = useRef(existingProjectNumbers);
  existingProjectNumbersRef.current = existingProjectNumbers;

  const existingProjectsRef = useRef(existingProjects);
  existingProjectsRef.current = existingProjects;

  const planSheetConfigRef = useRef(planSheetConfig);
  planSheetConfigRef.current = planSheetConfig;

  const onPlanSheetConfigChangeRef = useRef(onPlanSheetConfigChange);
  onPlanSheetConfigChangeRef.current = onPlanSheetConfigChange;

  const accessTokenRef = useRef(accessToken);
  accessTokenRef.current = accessToken;

  const effectivePaymentsIdRef = useRef(effectivePaymentsId);
  effectivePaymentsIdRef.current = effectivePaymentsId;

  const isFetchingRef = useRef(false);
  const hasLoadedOnOpenRef = useRef(false);

  // Project Numbers & Duplicate Prevention State
  const [knownProjectNumbers, setKnownProjectNumbers] = useState<string[]>([]);
  const [lastRecordedNumber, setLastRecordedNumber] = useState<string>('');
  const [lastRecordedRow, setLastRecordedRow] = useState<number | null>(null);
  const [isCheckingNumbers, setIsCheckingNumbers] = useState(false);
  const [lastCheckNotice, setLastCheckNotice] = useState<string | null>(null);

  // Format validation for Project Number: strictly "ххх-хх", where x are digits (e.g. 235-26)
  const isNumberFormatValid =
    projectNumber.trim().length > 0 && GoogleSheetsService.isProjectNumberValid(projectNumber);

  // Cleaned entered number
  const cleanEnteredNumber = projectNumber.trim().replace(/^[№#]\s*/, '');

  // Is Department MK selected?
  // When MK is chosen: Section 2 ("Оплати/Борги") is disabled, not required, and not written to.
  const isMk = department === 'МК';

  // Duplicate Check against all known project numbers currently present in Google Sheets (case-insensitive)
  const isDuplicateNumber = useMemo(() => {
    if (!cleanEnteredNumber) return false;
    const lower = cleanEnteredNumber.toLowerCase();
    return knownProjectNumbers.some(
      (n) => n.trim().replace(/^[№#]\s*/, '').toLowerCase() === lower
    );
  }, [cleanEnteredNumber, knownProjectNumbers]);

  // Calculate suggested next project number based on lastRecordedNumber (e.g. 245-26 -> 246-26)
  const suggestedNextNumber = useMemo(() => {
    if (!lastRecordedNumber) return null;
    const match = lastRecordedNumber.trim().match(/^(\d+)-(\d+)$/);
    if (!match) return null;
    const baseVal = parseInt(match[1], 10);
    const yearPart = match[2];
    let val = baseVal + 1;
    let candidate = `${String(val).padStart(3, '0')}-${yearPart}`;

    const isTaken = (cand: string) =>
      knownProjectNumbers.some(
        (n) => n.trim().replace(/^[№#]\s*/, '').toLowerCase() === cand.toLowerCase()
      );

    while (isTaken(candidate) && val < baseVal + 100) {
      val++;
      candidate = `${String(val).padStart(3, '0')}-${yearPart}`;
    }

    return candidate;
  }, [lastRecordedNumber, knownProjectNumbers]);

  /**
   * Authoritative Live Check: Queries Google Sheets directly in real-time
   * to discover the actual existing project numbers and the true last recorded number.
   * Runs strictly once on modal opening or upon manual click on refresh.
   */
  const refreshProjectNumbersFromSheets = useCallback(async () => {
    const token = accessTokenRef.current;
    if (!token || isFetchingRef.current) return;
    isFetchingRef.current = true;
    setIsCheckingNumbers(true);
    setLastCheckNotice('Опитування Google Таблиць наживо...');
    try {
      // 1. Resolve or auto-discover "План відвантажень" spreadsheet ID
      let targetPlanId = planSheetConfigRef.current?.id;
      if (!targetPlanId) {
        try {
          const found = await GoogleSheetsService.findSpreadsheetByName(token, 'План відвантажень');
          if (found?.id) {
            targetPlanId = found.id;
            const cfg = {
              id: found.id,
              title: found.title,
              url: found.webViewLink || `https://docs.google.com/spreadsheets/d/${found.id}/edit`,
            };
            setPlanSheetConfig(cfg);
            onPlanSheetConfigChangeRef.current?.(cfg);
            try {
              localStorage.setItem(PLAN_SPREADSHEET_STORAGE_KEY, JSON.stringify(cfg));
            } catch {}
          }
        } catch (e) {
          console.warn('Auto-discovery of plan spreadsheet error:', e);
        }
      }

      if (!targetPlanId) {
        targetPlanId = effectivePaymentsIdRef.current;
      }

      const fetchTasks: Promise<{ number: string; row: number; tab: string }[]>[] = [];

      // 1. Target Plan spreadsheet ("План відвантажень", tab "План")
      if (targetPlanId) {
        fetchTasks.push(
          GoogleSheetsService.getExistingProjectNumbersWithRows(targetPlanId, token, 'План')
            .then((res) => res.map((r) => ({ ...r, tab: 'План' })))
        );
      }

      // 2. Payments spreadsheet ("Оплати/Борги", tab "Лист1") if distinct from Plan
      const paymentsId = effectivePaymentsIdRef.current;
      if (paymentsId && paymentsId !== targetPlanId) {
        fetchTasks.push(
          GoogleSheetsService.getExistingProjectNumbersWithRows(paymentsId, token, 'Лист1')
            .then((res) => res.map((r) => ({ ...r, tab: 'Лист1' })))
        );
      }

      const results = await Promise.all(fetchTasks);
      const allFound = results.flat();

      // Deduplicate numbers while collecting all known project numbers
      const liveNumbers: string[] = [];
      const seen = new Set<string>();
      for (const item of allFound) {
        const clean = item.number.trim().replace(/^[№#]\s*/, '');
        const key = clean.toLowerCase();
        if (clean && !seen.has(key)) {
          seen.add(key);
          liveNumbers.push(clean);
        }
      }

      // Merge with initial fallback numbers so knownProjectNumbers is comprehensive
      const initialPropsNumbers = (existingProjectNumbersRef.current || [])
        .map((p) => p.trim().replace(/^[№#]\s*/, ''))
        .filter(Boolean);
      for (const pNum of initialPropsNumbers) {
        const key = pNum.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          liveNumbers.push(pNum);
        }
      }

      // Determine true latest project number matching standard xxx-xx format (e.g. 245-26 in row 2095)
      const latestResult = determineLatestProjectNumber(allFound, initialPropsNumbers, existingProjectsRef.current);
      const trueLatestNumber = latestResult.latestNumber;

      // Direct assignment — Google Sheets is the single source of truth!
      setKnownProjectNumbers(liveNumbers);
      setLastRecordedNumber(trueLatestNumber);
      setLastRecordedRow(latestResult.latestRow || null);

      // Update or clear localStorage cache so deleted numbers never persist
      if (trueLatestNumber) {
        try {
          localStorage.setItem(LAST_RECORDED_PROJECT_NUMBER_KEY, trueLatestNumber);
        } catch {}
      } else {
        try {
          localStorage.removeItem(LAST_RECORDED_PROJECT_NUMBER_KEY);
        } catch {}
      }

      const timeStr = new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      setLastCheckNotice(
        latestResult.latestRow
          ? `Перевірено з Google Таблиць о ${timeStr}: останній ${trueLatestNumber} (рядок ${latestResult.latestRow})`
          : `Перевірено з Google Таблиць о ${timeStr}: останній ${trueLatestNumber || 'не знайдено'}`
      );
    } catch (err) {
      console.warn('Real-time project numbers check error:', err);
      setLastCheckNotice('Помилка підключення під час перевірки');
    } finally {
      isFetchingRef.current = false;
      setIsCheckingNumbers(false);
    }
  }, []);

  // Reset and trigger live check EXACTLY ONCE when modal opens
  useEffect(() => {
    if (!isOpen) {
      hasLoadedOnOpenRef.current = false;
      return;
    }

    // Guard: strictly execute only once per modal open
    if (hasLoadedOnOpenRef.current) {
      return;
    }
    hasLoadedOnOpenRef.current = true;

    setErrorMessage(null);
    setSuccessInfo(null);
    setValidationErrors({});
    setIsEditingPlanSheet(false);
    if (!startDate) {
      setStartDate(getTodayString());
    }

    const initialPropsNumbers = (existingProjectNumbersRef.current || [])
      .map((p) => p.trim().replace(/^[№#]\s*/, ''))
      .filter(Boolean);

    // Immediately calculate the best known latest number from existingProjects and existingProjectNumbers
    const initialLatest = determineLatestProjectNumber([], initialPropsNumbers, existingProjectsRef.current);
    const storedLast = localStorage.getItem(LAST_RECORDED_PROJECT_NUMBER_KEY) || '';

    let effectiveInitialLast = initialLatest.latestNumber || storedLast;
    if (storedLast && initialLatest.latestNumber) {
      const matchStored = storedLast.match(/^(\d+)-(\d+)$/);
      const matchInit = initialLatest.latestNumber.match(/^(\d+)-(\d+)$/);
      if (matchStored && matchInit) {
        const seqStored = parseInt(matchStored[1], 10);
        const seqInit = parseInt(matchInit[1], 10);
        effectiveInitialLast = seqInit >= seqStored ? initialLatest.latestNumber : storedLast;
      }
    }

    setLastRecordedNumber(effectiveInitialLast);
    setLastRecordedRow(initialLatest.latestRow || null);
    setKnownProjectNumbers(initialPropsNumbers);

    // Immediately run real-time live check directly against Google Sheets exactly 1 time!
    if (accessToken) {
      refreshProjectNumbersFromSheets();
    }
  }, [isOpen, accessToken, refreshProjectNumbersFromSheets]);

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
    clearFieldError('manager');
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

  const clearFieldError = (fieldKey: string) => {
    if (validationErrors[fieldKey]) {
      setValidationErrors((prev) => {
        const next = { ...prev };
        delete next[fieldKey];
        return next;
      });
    }
    if (errorMessage) {
      setErrorMessage(null);
    }
  };

  const handleSaveCustomPlanSheet = () => {
    const trimmed = planSheetInput.trim();
    if (!trimmed) {
      setIsEditingPlanSheet(false);
      return;
    }
    const cleanId = GoogleSheetsService.extractSpreadsheetId(trimmed);
    const newCfg = {
      id: cleanId,
      title: 'План відвантажень',
      url: `https://docs.google.com/spreadsheets/d/${cleanId}/edit`,
    };
    setPlanSheetConfig(newCfg);
    try {
      localStorage.setItem(PLAN_SPREADSHEET_STORAGE_KEY, JSON.stringify(newCfg));
    } catch (e) {
      console.warn('Failed to save plan spreadsheet to storage:', e);
    }
    setIsEditingPlanSheet(false);
    setPlanSheetInput('');
  };

  const handleDistributeTranches = () => {
    const raw = contractAmount.trim().replace(/\s/g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
    const total = parseFloat(raw);
    const target = !isNaN(total) && total > 0 ? total : 0;
    const part = Math.round(target / 4);

    const nowIdx = weekOptions.findIndex((w) => w.isCurrentWeek);
    const startIdx = nowIdx >= 0 ? nowIdx : 38;

    setTranches([
      { amount: target > 0 ? String(part) : '', week: weekOptions[startIdx]?.fullLabel || '' },
      { amount: target > 0 ? String(part) : '', week: weekOptions[startIdx + 1]?.fullLabel || '' },
      { amount: target > 0 ? String(part) : '', week: weekOptions[startIdx + 2]?.fullLabel || '' },
      { amount: target > 0 ? String(target - part * 3) : '', week: weekOptions[startIdx + 3]?.fullLabel || '' },
    ]);
    setShowTranches(true);
  };

  // Submit with dual bindings:
  // 1. Номер проекту, Назва проекту, Старт проекту, Відділ, Менеджер проекту -> "План відвантажень" вкладка План (колонки А, В, D, C, H).
  // 2. Рахунок, Дата рахунку, Сума Договору -> "Оплати/Борги" вкладка Лист1 (перші пусті ячейки колонок відповідно G, H, M).
  const handleSaveProject = async (isUpdateMode = false) => {
    if (!canWriteToSheets) {
      setErrorMessage('У вас обліковий запис з правами тільки перегляду. Додавання проектів заборонено.');
      return;
    }
    setErrorMessage(null);
    setSuccessInfo(null);

    const errors: Record<string, string> = {};
    const cleanNumber = projectNumber.trim().replace(/^[№#]\s*/, '');

    // Check each field sequentially for emptiness and issue specific warning for the empty field
    if (!cleanNumber) {
      errors.projectNumber = 'Поле «Номер проекту» не заповнено';
    } else if (!/^\d{3}-\d{2}$/.test(cleanNumber)) {
      errors.projectNumber = 'Формат має бути ххх-хх, де х — цифри (напр. 235-26)';
    } else if (isDuplicateNumber && !isUpdateMode) {
      errors.projectNumber = `Номер «${cleanNumber}» вже існує в базі даних (дублікат заборонено)`;
    }

    if (!projectName.trim()) {
      errors.projectName = 'Поле «Назва проекту» не заповнено';
    }

    if (!startDate.trim()) {
      errors.startDate = 'Поле «Старт проекту» не заповнено';
    }

    if (!department) {
      errors.department = 'Оберіть «Відділ» (ЕТС або МК)';
    }

    if (!manager.trim()) {
      errors.manager = 'Поле «Менеджер проекту» не заповнено';
    }

    // Section 2 fields ("Оплати/Борги") validation:
    // User directive: "при внесенні нового проекту при виборі Відділу МК - поле 2. Таблиця 'Оплати/Борги' де вноситься Рахунок Дата Рахунку зробити неактивним, не перевіряти обов'язковість заповнення та не робити запис в Таблицю цього поля 2. Запис виконуємо тільки з першого поля для Таблиці План Відвантажень."
    if (!isMk) {
      if (!invoiceNumber.trim()) {
        errors.invoiceNumber = 'Поле «Рахунок» не заповнено';
      }

      if (!invoiceDate.trim()) {
        errors.invoiceDate = 'Поле «Дата рахунку» не заповнено';
      }

      if (!contractAmount.trim()) {
        errors.contractAmount = 'Поле «Сума Договору» не заповнено';
      }
    }

    // If any field is empty or invalid, do NOT record and issue specific warning
    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);

      if (errors.projectNumber) {
        if (!cleanNumber) {
          setErrorMessage('Будь ласка, заповніть поле «Номер проекту». Поле не може бути пустим.');
        } else if (isDuplicateNumber) {
          setErrorMessage(
            `Номер проекту «${cleanNumber}» вже існує в системі! Дублювання індивідуальних номерів заборонено. Введіть інший унікальний номер.`
          );
        } else {
          setErrorMessage('Номер проекту має бути у форматі ххх-хх, де х — це цифри (наприклад: 235-26).');
        }
        projectNumberRef.current?.focus();
        return;
      }
      if (errors.projectName) {
        setErrorMessage('Будь ласка, заповніть поле «Назва проекту». Поле не може бути пустим.');
        projectNameRef.current?.focus();
        return;
      }
      if (errors.startDate) {
        setErrorMessage('Будь ласка, заповніть поле «Старт проекту». Поле не може бути пустим.');
        startDateRef.current?.focus();
        return;
      }
      if (errors.department) {
        setErrorMessage('Будь ласка, оберіть «Відділ» (ЕТС або МК).');
        return;
      }
      if (errors.manager) {
        setErrorMessage('Будь ласка, заповніть поле «Менеджер проекту». Поле не може бути пустим.');
        managerRef.current?.focus();
        return;
      }
      if (!isMk && errors.invoiceNumber) {
        setErrorMessage('Будь ласка, заповніть поле «Рахунок». Поле не може бути пустим.');
        invoiceNumberRef.current?.focus();
        return;
      }
      if (!isMk && errors.invoiceDate) {
        setErrorMessage('Будь ласка, заповніть поле «Дата рахунку». Поле не може бути пустим.');
        invoiceDateRef.current?.focus();
        return;
      }
      if (!isMk && errors.contractAmount) {
        setErrorMessage('Будь ласка, заповніть поле «Сума Договору». Поле не може бути пустим.');
        contractAmountRef.current?.focus();
        return;
      }
      return;
    }

    // Google Authentication check
    if (!accessToken) {
      setErrorMessage(
        'Відсутня авторизація в Google акаунті. Будь ласка, підключіть Google акаунт у верхній панелі для запису в Google Таблиці.'
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await GoogleSheetsService.addProjectDualBindings(accessToken, {
        projectNumber: cleanNumber,
        projectName: projectName.trim(),
        department: department,
        startDate: startDate.trim(),
        manager: manager.trim(),
        invoiceNumber: isMk ? '' : invoiceNumber.trim(),
        invoiceDate: isMk ? '' : invoiceDate.trim(),
        contractAmount: isMk ? '0' : contractAmount.trim(),
        currencyRate: isMk ? '1' : (currencyRate.trim() || '1'),
        paymentSchedule: isMk ? [] : tranches,
        planSpreadsheetId: planSheetConfig?.id || undefined,
        paymentsSpreadsheetId: effectivePaymentsId,
        planTabName: 'План',
        paymentsTabName: 'Лист1',
        allowExistingInPlan: isUpdateMode,
      });

      // Update duplicate cache and last recorded number
      setLastRecordedNumber(cleanNumber);
      setLastRecordedRow(result.plan.row);
      setKnownProjectNumbers((prev) => Array.from(new Set([...prev, cleanNumber])));
      try {
        localStorage.setItem(LAST_RECORDED_PROJECT_NUMBER_KEY, cleanNumber);
      } catch (e) {
        console.warn('Failed to persist last recorded project number:', e);
      }

      setSuccessInfo({
        projectNumber: cleanNumber,
        plan: {
          row: result.plan.row,
          tab: result.plan.tab,
          title: result.plan.spreadsheetTitle || 'План відвантажень',
          id: result.plan.spreadsheetId,
        },
        payments: result.payments
          ? {
              row: result.payments.row,
              rowG: result.payments.rowG,
              rowH: result.payments.rowH,
              rowM: result.payments.rowM,
              tab: result.payments.tab,
              title: result.payments.spreadsheetTitle || 'Оплати/Борги',
              id: result.payments.spreadsheetId,
            }
          : null,
      });

      // Update planSheetConfig if discovery returned an ID
      if (!planSheetConfig && result.plan.spreadsheetId) {
        const newCfg = {
          id: result.plan.spreadsheetId,
          title: result.plan.spreadsheetTitle || 'План відвантажень',
          url: `https://docs.google.com/spreadsheets/d/${result.plan.spreadsheetId}/edit`,
        };
        setPlanSheetConfig(newCfg);
        try {
          localStorage.setItem(PLAN_SPREADSHEET_STORAGE_KEY, JSON.stringify(newCfg));
        } catch {
          // ignore
        }
      }

      // Notify parent to refresh project list from sheet
      if (onProjectAdded) {
        onProjectAdded(result.plan.row, cleanNumber);
      }

      // Reset fields after successful entry
      setProjectNumber('');
      setProjectName('');
      setStartDate(getTodayString());
      setManager('');
      setInvoiceNumber('');
      setInvoiceDate('');
      setContractAmount('');
      setCurrencyRate('1');
      setTranches([
        { amount: '', week: '' },
        { amount: '', week: '' },
        { amount: '', week: '' },
        { amount: '', week: '' },
      ]);
      setShowTranches(false);
      setValidationErrors({});
    } catch (err: any) {
      console.error('Failed to write project with dual bindings:', err);
      setErrorMessage(err?.message || 'Помилка під час запису в Google Таблиці.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/65 backdrop-blur-xs">
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden border border-slate-200 flex flex-col max-h-[92vh] animate-in fade-in zoom-in-95 duration-150"
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
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-bold text-slate-900">
                  Додати новий проект
                </h2>
                <span className="text-[11px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-md">
                  «План відвантажень» [План]
                </span>
                {isMk ? (
                  <span
                    className="text-[11px] font-semibold text-slate-500 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-md"
                    title="Для Відділу МК таблиця «Оплати/Борги» не заповнюється"
                  >
                    «Оплати/Борги» [не записується для МК]
                  </span>
                ) : (
                  <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
                    «Оплати/Борги» [Лист1]
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {isMk
                  ? "Запис здійснюється виключно в таблицю «План відвантажень» (від рядка 2094)"
                  : "Запис у дві цільові таблиці згідно з новими прив'язками колонок"}
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

        {/* Target Spreadsheets Status Bar */}
        <div className="px-6 py-2.5 bg-slate-100/90 border-b border-slate-200 text-[11px] space-y-1.5 shrink-0">
          {/* Destination 1: План відвантажень */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 truncate">
              <span className="inline-block w-2 h-2 rounded-full bg-blue-500 shrink-0"></span>
              <span className="font-semibold text-slate-700 shrink-0">
                1. «План відвантажень» (Вкладка «План» • від рядка 2094):
              </span>
              {planSheetConfig ? (
                <a
                  href={planSheetConfig.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline inline-flex items-center gap-1 truncate font-medium"
                  title="Відкрити таблицю Плану відвантажень"
                >
                  <span className="truncate">{planSheetConfig.title} ({planSheetConfig.id.slice(0, 10)}...)</span>
                  <ExternalLink className="w-3 h-3 shrink-0" />
                </a>
              ) : (
                <span className="text-slate-500 italic truncate">
                  (Авто-пошук на Google Drive або поточна таблиця)
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setIsEditingPlanSheet(!isEditingPlanSheet);
                setPlanSheetInput(planSheetConfig?.id || '');
              }}
              className="text-[10px] text-slate-500 hover:text-blue-600 hover:underline flex items-center gap-1 shrink-0 cursor-pointer"
            >
              <Edit2 className="w-2.5 h-2.5" />
              {planSheetConfig ? 'Змінити ID' : 'Вказати ID/URL'}
            </button>
          </div>

          {/* Quick Edit for Plan Sheet ID/URL */}
          {isEditingPlanSheet && (
            <div className="p-2 bg-white rounded-lg border border-blue-200 flex items-center gap-2 animate-in fade-in">
              <input
                type="text"
                value={planSheetInput}
                onChange={(e) => setPlanSheetInput(e.target.value)}
                placeholder="Вставте URL або ID Google Таблиці «План відвантажень»"
                className="flex-1 px-2 py-1 text-xs border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={handleSaveCustomPlanSheet}
                className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-[11px] font-bold cursor-pointer"
              >
                Зберегти
              </button>
              <button
                type="button"
                onClick={() => setIsEditingPlanSheet(false)}
                className="px-2 py-1 text-slate-500 hover:bg-slate-100 rounded text-[11px] cursor-pointer"
              >
                Скасувати
              </button>
            </div>
          )}

          {/* Destination 2: Оплати/Борги */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 truncate">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 shrink-0"></span>
              <span className="font-semibold text-slate-700 shrink-0">
                2. «Оплати/Борги» (Вкладка «Лист1» • від рядка 127):
              </span>
              <a
                href={effectivePaymentsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-emerald-700 hover:underline inline-flex items-center gap-1 truncate font-medium"
                title="Відкрити таблицю Оплати/Борги"
              >
                <span className="truncate">{effectivePaymentsTitle} ({effectivePaymentsId.slice(0, 10)}...)</span>
                <ExternalLink className="w-3 h-3 shrink-0" />
              </a>
            </div>
            <span className="text-[10px] text-slate-400 shrink-0 hidden sm:inline">
              Колонки: G, H, M (перші пусті від рядка 127)
            </span>
          </div>
        </div>

        {/* Notifications & Feedback */}
        {errorMessage && (
          <div className="mx-6 mt-4 p-3.5 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2.5 text-xs text-red-800 animate-in fade-in">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-bold text-red-900">Попередження про поле:</p>
              <p className="mt-0.5 text-red-800 font-medium">{errorMessage}</p>
            </div>
          </div>
        )}

        {successInfo && (
          <div className="mx-6 mt-4 p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900 animate-in fade-in space-y-2.5">
            <div className="flex items-center gap-2 font-bold text-emerald-950 text-sm">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <span>
                {successInfo.payments
                  ? `Проект № ${successInfo.projectNumber} успішно записано в дві Google Таблиці!`
                  : `Проект № ${successInfo.projectNumber} (відділ МК) успішно збережено в «План відвантажень»!`}
              </span>
            </div>

            <div className={`grid gap-2.5 pt-1 text-[11px] ${successInfo.payments ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
              {/* Plan shipment result */}
              <div className="bg-white/90 border border-blue-200 rounded-lg p-2.5 space-y-1">
                <div className="font-bold text-blue-950 flex items-center justify-between">
                  <span>🚚 «План відвантажень»</span>
                  <span className="text-[10px] bg-blue-100 text-blue-800 px-1.5 py-0.2 rounded font-mono">
                    Вкладка «{successInfo.plan.tab}»
                  </span>
                </div>
                <p className="text-slate-600">
                  Записано в першу пусту ячейку колонки А від 2094 рядка — <b>Рядок {successInfo.plan.row}</b>:
                </p>
                <div className="bg-blue-50/60 p-1.5 rounded border border-blue-100 text-[10px] font-mono text-slate-700 space-y-0.5">
                  <div>• Кол. A: {successInfo.projectNumber}</div>
                  <div>• Кол. B: Назва проекту</div>
                  <div>• Кол. C: Відділ</div>
                  <div>• Кол. D: Старт проекту</div>
                  <div>• Кол. H: Менеджер проекту</div>
                </div>
                <a
                  href={`https://docs.google.com/spreadsheets/d/${successInfo.plan.id}/edit`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pt-1 inline-flex items-center gap-1 text-blue-600 font-semibold hover:underline"
                >
                  Переглянути в Google Таблиці <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              {/* Payments result if ETS or Note if MK */}
              {successInfo.payments ? (
                <div className="bg-white/90 border border-emerald-200 rounded-lg p-2.5 space-y-1">
                  <div className="font-bold text-emerald-950 flex items-center justify-between">
                    <span>💳 «Оплати/Борги»</span>
                    <span className="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.2 rounded font-mono">
                      Вкладка «{successInfo.payments.tab}»
                    </span>
                  </div>
                  <p className="text-slate-600">
                    Записано єдиним запитом у порожній <b>рядок {successInfo.payments.row || successInfo.payments.rowG}</b>:
                  </p>
                  <div className="bg-emerald-50/60 p-1.5 rounded border border-emerald-100 text-[10px] font-mono text-slate-700 space-y-0.5">
                    <div>• Кол. A, B, C: № Проєкту, Назва та Дата старту</div>
                    <div>• Кол. G, H, I: Рахунок, Дата рахунку та Курс валют</div>
                    <div>• Кол. M: Сума Договору</div>
                    <div>• Кол. Z..AG: Графік оплат (Оплата 1–4 та Тижні)</div>
                  </div>
                  <a
                    href={`https://docs.google.com/spreadsheets/d/${successInfo.payments.id}/edit`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="pt-1 inline-flex items-center gap-1 text-emerald-700 font-semibold hover:underline"
                  >
                    Переглянути в Google Таблиці <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              ) : (
                <div className="bg-blue-50/70 border border-blue-200 rounded-lg p-2.5 text-[11px] text-blue-900 flex items-start gap-2">
                  <span className="font-bold text-blue-700 text-xs mt-0.5">ℹ️</span>
                  <div>
                    <div className="font-bold text-blue-950">Відділ МК (Металоконструкції)</div>
                    <p className="mt-0.5 text-blue-800 leading-relaxed">
                      Проєкти з позначкою МК не відображаються у вкладці «Проекти» та не переносяться до списку проектів. Дані зафіксовані виключно в таблиці «План відвантажень».
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Form Body */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSaveProject();
          }}
          className="p-6 overflow-y-auto space-y-5 text-xs"
        >
          {/* SECTION 1: План відвантажень (вкладка План) */}
          <div className="p-4 bg-blue-50/50 border border-blue-200/90 rounded-2xl space-y-3.5">
            <div className="flex items-center justify-between pb-2 border-b border-blue-200/70">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-600"></span>
                <span className="text-xs font-bold text-blue-950 uppercase tracking-wide">
                  1. Таблиця «План відвантажень» • Вкладка «План»
                </span>
              </div>
              <span className="text-[10px] font-bold text-blue-700 bg-blue-100/80 px-2 py-0.5 rounded-md">
                Колонки: A, B, C, D, H • Запис від рядка 2094
              </span>
            </div>

            {/* Row 1: Номер проекту & Назва проекту */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
              <div className="sm:col-span-1">
                {/* Header of field with label, badge, and prominent last recorded number highlight */}
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-slate-800 font-semibold">
                    Номер проекту <span className="text-red-500 font-bold">*</span>
                  </label>
                  <span className="text-[10px] text-blue-700 font-mono font-bold bg-blue-100/80 px-1.5 py-0.2 rounded">
                    Кол. A (з рядка 2094)
                  </span>
                </div>

                {/* Highlight of Last Recorded Number & Live Check Status */}
                <div className="mb-1.5 px-2 py-1.5 bg-amber-50/90 border border-amber-300 rounded-lg flex items-center justify-between gap-1 shadow-2xs">
                  <div className="flex items-center gap-1.5 text-[11px] text-amber-900 truncate min-w-0">
                    <Bookmark className="w-3 h-3 text-amber-600 shrink-0" />
                    <span className="font-medium shrink-0">Останній:</span>
                    {lastRecordedNumber ? (
                      <span className="font-mono font-extrabold text-amber-950 bg-amber-200/80 px-1.5 py-0.2 rounded border border-amber-300/80 shrink-0">
                        {lastRecordedNumber}
                        {lastRecordedRow ? (
                          <span className="text-[10px] text-amber-800 font-semibold ml-1">
                            (рядок {lastRecordedRow})
                          </span>
                        ) : null}
                      </span>
                    ) : isCheckingNumbers ? (
                      <span className="text-[10px] text-blue-700 font-semibold italic shrink-0">
                        перевірка...
                      </span>
                    ) : (
                      <span className="text-slate-500 italic text-[10px] shrink-0">—</span>
                    )}

                    {isCheckingNumbers && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-700 bg-blue-100/90 px-1.5 py-0.2 rounded animate-pulse shrink-0">
                        <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                        Перевірка...
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => refreshProjectNumbersFromSheets()}
                      disabled={isCheckingNumbers}
                      className="p-1 text-slate-500 hover:text-blue-700 hover:bg-white/80 rounded transition cursor-pointer disabled:opacity-50"
                      title={lastCheckNotice || "Оновити перевірку номерів з Google Таблиць наживо"}
                    >
                      <RefreshCw className={`w-3 h-3 ${isCheckingNumbers ? 'animate-spin text-blue-600' : ''}`} />
                    </button>

                    {suggestedNextNumber && !projectNumber.trim() && (
                      <button
                        type="button"
                        onClick={() => {
                          setProjectNumber(suggestedNextNumber);
                          clearFieldError('projectNumber');
                        }}
                        className="text-[10px] font-bold text-blue-700 hover:text-blue-900 bg-white hover:bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5 flex items-center gap-1 cursor-pointer transition shadow-2xs shrink-0"
                        title={`Підставити наступний номер ${suggestedNextNumber}`}
                      >
                        <Sparkles className="w-2.5 h-2.5 text-blue-600" />
                        +{suggestedNextNumber}
                      </button>
                    )}
                  </div>
                </div>

                <div className="relative">
                  <input
                    ref={projectNumberRef}
                    type="text"
                    value={projectNumber}
                    onChange={(e) => {
                      setProjectNumber(e.target.value);
                      clearFieldError('projectNumber');
                    }}
                    placeholder={suggestedNextNumber || "246-26"}
                    disabled={isSubmitting}
                    className={`w-full px-3 py-2 border rounded-lg text-xs font-mono font-bold transition-colors focus:outline-none focus:ring-2 ${
                      isDuplicateNumber
                        ? 'border-red-500 bg-red-50/70 text-red-900 focus:ring-red-500'
                        : validationErrors.projectNumber
                        ? 'border-red-400 bg-red-50/40 text-slate-800 focus:ring-red-500'
                        : cleanEnteredNumber
                        ? isNumberFormatValid
                          ? 'border-emerald-400 bg-emerald-50/30 text-emerald-950 focus:ring-emerald-500'
                          : 'border-amber-400 bg-white text-slate-800 focus:ring-amber-500'
                        : 'border-slate-300 bg-white text-slate-800 focus:ring-blue-500'
                    }`}
                  />
                  {cleanEnteredNumber && (
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center">
                      {isDuplicateNumber ? (
                        <AlertTriangle className="w-4 h-4 text-red-600" />
                      ) : isNumberFormatValid ? (
                        <Check className="w-4 h-4 text-emerald-600" />
                      ) : null}
                    </span>
                  )}
                </div>

                {/* Duplicate check & validation status feedback */}
                <div className="mt-1.5">
                  {isDuplicateNumber ? (
                    <div className="p-2.5 bg-red-50 border border-red-300 rounded-lg text-[11px] text-red-900 animate-in fade-in shadow-2xs space-y-1.5">
                      <div className="flex items-start gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-bold">Дублювання індивідуального номера!</p>
                          <p className="text-[10px] text-red-800 mt-0.5">
                            Номер <b className="font-mono">{cleanEnteredNumber}</b> вже записано в таблиці. Дублювання заборонено.
                          </p>
                        </div>
                      </div>
                      <div className="pt-1 flex items-center justify-between gap-1 flex-wrap">
                        <button
                          type="button"
                          onClick={() => refreshProjectNumbersFromSheets()}
                          disabled={isCheckingNumbers}
                          className="px-2 py-1 bg-white hover:bg-red-100 text-red-900 border border-red-300 rounded text-[10px] font-bold flex items-center gap-1 cursor-pointer shadow-2xs transition disabled:opacity-50"
                          title="Оновити перевірку якщо ви видалили цей рядок з таблиці"
                        >
                          <RefreshCw className={`w-3 h-3 ${isCheckingNumbers ? 'animate-spin text-red-600' : 'text-red-500'}`} />
                          <span>Я видалив цей номер з таблиці — Перевірити знову</span>
                        </button>
                        {lastCheckNotice && (
                          <span className="text-[9px] text-slate-500 italic">
                            {lastCheckNotice}
                          </span>
                        )}
                      </div>
                    </div>
                  ) : validationErrors.projectNumber ? (
                    <span className="text-[10px] text-red-600 font-medium flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> {validationErrors.projectNumber}
                    </span>
                  ) : cleanEnteredNumber ? (
                    isNumberFormatValid ? (
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-emerald-700 font-semibold flex items-center gap-1">
                          <Check className="w-3 h-3 text-emerald-600" /> Номер унікальний (вільний для запису)
                        </span>
                        {lastCheckNotice && (
                          <span className="text-slate-400 italic text-[9px]">{lastCheckNotice}</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-[10px] text-amber-700 font-medium">
                        Формат: ххх-хх, де х — цифри (напр. 235-26)
                      </span>
                    )
                  ) : (
                    <div className="flex items-center justify-between text-[10px] text-slate-400">
                      <span>Формат: ххх-хх (наприклад: 235-26)</span>
                      {lastCheckNotice && (
                        <span className="text-slate-400 italic text-[9px]">{lastCheckNotice}</span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="sm:col-span-2">
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-slate-800 font-semibold">
                    Назва проекту <span className="text-red-500 font-bold">*</span>
                  </label>
                  <span className="text-[10px] text-blue-700 font-mono font-bold bg-blue-100/80 px-1.5 py-0.2 rounded">
                    Кол. B
                  </span>
                </div>
                <input
                  ref={projectNameRef}
                  type="text"
                  value={projectName}
                  onChange={(e) => {
                    setProjectName(e.target.value);
                    clearFieldError('projectName');
                  }}
                  disabled={isSubmitting}
                  placeholder="напр. Ресторан 'Zafferano' (оздоблювальні роботи)"
                  className={`w-full px-3 py-2 border rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 transition-colors ${
                    validationErrors.projectName
                      ? 'border-red-400 bg-red-50/40 focus:ring-red-500'
                      : 'border-slate-300 bg-white focus:ring-blue-500'
                  }`}
                />
                {validationErrors.projectName && (
                  <p className="mt-1 text-[10px] text-red-600 font-medium flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> {validationErrors.projectName}
                  </p>
                )}
              </div>
            </div>

            {/* Row 2: Відділ & Старт проекту */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-slate-800 font-semibold flex items-center gap-1.5">
                    <Building className="w-3.5 h-3.5 text-blue-600" />
                    Відділ <span className="text-red-500 font-bold">*</span>
                  </label>
                  <span className="text-[10px] text-blue-700 font-mono font-bold bg-blue-100/80 px-1.5 py-0.2 rounded">
                    Кол. C
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setDepartment('ЕТС');
                      clearFieldError('department');
                    }}
                    disabled={isSubmitting}
                    className={`py-2 px-3 rounded-lg border text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                      department === 'ЕТС'
                        ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    {department === 'ЕТС' && <Check className="w-3.5 h-3.5" />}
                    ЕТС
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDepartment('МК');
                      clearFieldError('department');
                      clearFieldError('invoiceNumber');
                      clearFieldError('invoiceDate');
                      clearFieldError('contractAmount');
                    }}
                    disabled={isSubmitting}
                    className={`py-2 px-3 rounded-lg border text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                      department === 'МК'
                        ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    {department === 'МК' && <Check className="w-3.5 h-3.5" />}
                    МК
                  </button>
                </div>
                {validationErrors.department && (
                  <p className="mt-1 text-[10px] text-red-600 font-medium flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> {validationErrors.department}
                  </p>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-slate-800 font-semibold flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-blue-600" />
                    Старт проекту <span className="text-red-500 font-bold">*</span>
                  </label>
                  <span className="text-[10px] text-blue-700 font-mono font-bold bg-blue-100/80 px-1.5 py-0.2 rounded">
                    Кол. D
                  </span>
                </div>
                <input
                  ref={startDateRef}
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    clearFieldError('startDate');
                  }}
                  disabled={isSubmitting}
                  className={`w-full px-3 py-2 border rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 transition-colors ${
                    validationErrors.startDate
                      ? 'border-red-400 bg-red-50/40 focus:ring-red-500'
                      : 'border-slate-300 bg-white focus:ring-blue-500'
                  }`}
                />
                {validationErrors.startDate && (
                  <p className="mt-1 text-[10px] text-red-600 font-medium flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> {validationErrors.startDate}
                  </p>
                )}
              </div>
            </div>

            {/* Row 3: Менеджер проекту */}
            <div ref={managerContainerRef} className="relative">
              <div className="flex items-center justify-between mb-1">
                <label className="block text-slate-800 font-semibold flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 text-blue-600" />
                  Менеджер проекту <span className="text-red-500 font-bold">*</span>
                </label>
                <span className="text-[10px] text-blue-700 font-mono font-bold bg-blue-100/80 px-1.5 py-0.2 rounded">
                  Кол. H
                </span>
              </div>
              <input
                ref={managerRef}
                type="text"
                value={manager}
                onChange={(e) => {
                  setManager(e.target.value);
                  setShowManagerSuggestions(true);
                  clearFieldError('manager');
                }}
                onFocus={() => setShowManagerSuggestions(true)}
                onBlur={handleManagerBlur}
                disabled={isSubmitting}
                placeholder="Введіть ім'я менеджера (напр. Олексій С.)"
                className={`w-full px-3 py-2 border rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 transition-colors ${
                  validationErrors.manager
                    ? 'border-red-400 bg-red-50/40 focus:ring-red-500'
                    : 'border-slate-300 bg-white focus:ring-blue-500'
                }`}
              />
              {validationErrors.manager && (
                <p className="mt-1 text-[10px] text-red-600 font-medium flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> {validationErrors.manager}
                </p>
              )}

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
          </div>

          {/* SECTION 2: Оплати/Борги (вкладка Лист1) */}
          <div
            className={`p-4 rounded-2xl space-y-3.5 transition-all duration-200 ${
              isMk
                ? 'bg-slate-100/80 border border-slate-200/90'
                : 'bg-emerald-50/50 border border-emerald-200/90'
            }`}
          >
            <div className={`flex items-center justify-between pb-2 border-b ${isMk ? 'border-slate-200' : 'border-emerald-200/70'}`}>
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${isMk ? 'bg-slate-400' : 'bg-emerald-600'}`}></span>
                <span className={`text-xs font-bold uppercase tracking-wide ${isMk ? 'text-slate-600' : 'text-emerald-950'}`}>
                  2. Таблиця «Оплати/Борги» • Вкладка «Лист1»
                </span>
              </div>
              {isMk ? (
                <span className="text-[10px] font-bold text-slate-600 bg-slate-200/80 px-2 py-0.5 rounded-md flex items-center gap-1">
                  Неактивно для Відділу МК (без запису)
                </span>
              ) : (
                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100/80 px-2 py-0.5 rounded-md">
                  Перші пусті ячейки колонок: G, H, M • Запис від рядка 127
                </span>
              )}
            </div>

            {/* Inactive notice when MK department is selected */}
            {isMk && (
              <div className="flex items-start gap-2.5 p-3 bg-amber-50/90 border border-amber-200/90 rounded-xl text-amber-900 text-xs animate-in fade-in">
                <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="leading-relaxed">
                  <span className="font-bold">Поле 2 неактивне для Відділу МК:</span> заповнення полів «Рахунок», «Дата рахунку» та «Сума Договору» не вимагається, і запис у таблицю «Оплати/Борги» <b>не виконується</b>. Запис проекту здійснюється виключно з першого поля в таблицю «План відвантажень».
                </div>
              </div>
            )}

            {/* Row: Рахунок та Дата рахунку */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className={`block font-semibold flex items-center gap-1.5 ${isMk ? 'text-slate-400' : 'text-slate-800'}`}>
                    <Receipt className={`w-3.5 h-3.5 ${isMk ? 'text-slate-400' : 'text-emerald-600'}`} />
                    Рахунок {!isMk && <span className="text-red-500 font-bold">*</span>}
                  </label>
                  <span className={`text-[10px] font-mono font-bold px-1.5 py-0.2 rounded ${isMk ? 'text-slate-400 bg-slate-200/60' : 'text-emerald-700 bg-emerald-100/80'}`}>
                    Кол. G (від рядка 127)
                  </span>
                </div>
                <input
                  ref={invoiceNumberRef}
                  type="text"
                  value={invoiceNumber}
                  onChange={(e) => {
                    setInvoiceNumber(e.target.value);
                    clearFieldError('invoiceNumber');
                  }}
                  disabled={isSubmitting || isMk}
                  placeholder={isMk ? 'Не заповнюється для Відділу МК' : "напр. № 142 від ТОВ '...'"}
                  className={`w-full px-3 py-2 border rounded-lg text-xs font-medium focus:outline-none focus:ring-2 transition-colors ${
                    isMk
                      ? 'border-slate-200 bg-slate-200/50 text-slate-400 cursor-not-allowed'
                      : validationErrors.invoiceNumber
                      ? 'border-red-400 bg-red-50/40 focus:ring-red-500 text-slate-800'
                      : 'border-slate-300 bg-white focus:ring-emerald-500 text-slate-800'
                  }`}
                />
                {!isMk && validationErrors.invoiceNumber && (
                  <p className="mt-1 text-[10px] text-red-600 font-medium flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> {validationErrors.invoiceNumber}
                  </p>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className={`block font-semibold flex items-center gap-1.5 ${isMk ? 'text-slate-400' : 'text-slate-800'}`}>
                    <Calendar className={`w-3.5 h-3.5 ${isMk ? 'text-slate-400' : 'text-emerald-600'}`} />
                    Дата рахунку {!isMk && <span className="text-red-500 font-bold">*</span>}
                  </label>
                  <span className={`text-[10px] font-mono font-bold px-1.5 py-0.2 rounded ${isMk ? 'text-slate-400 bg-slate-200/60' : 'text-emerald-700 bg-emerald-100/80'}`}>
                    Кол. H (від рядка 127)
                  </span>
                </div>
                <input
                  ref={invoiceDateRef}
                  type="date"
                  value={invoiceDate}
                  onChange={(e) => {
                    setInvoiceDate(e.target.value);
                    clearFieldError('invoiceDate');
                  }}
                  disabled={isSubmitting || isMk}
                  className={`w-full px-3 py-2 border rounded-lg text-xs font-medium focus:outline-none focus:ring-2 transition-colors ${
                    isMk
                      ? 'border-slate-200 bg-slate-200/50 text-slate-400 cursor-not-allowed'
                      : validationErrors.invoiceDate
                      ? 'border-red-400 bg-red-50/40 focus:ring-red-500 text-slate-800'
                      : 'border-slate-300 bg-white focus:ring-emerald-500 text-slate-800'
                  }`}
                />
                {!isMk && validationErrors.invoiceDate && (
                  <p className="mt-1 text-[10px] text-red-600 font-medium flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> {validationErrors.invoiceDate}
                  </p>
                )}
              </div>
            </div>

            {/* Row: Сума Договору & Курс валют */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <div className="flex items-center justify-between mb-1">
                  <label className={`block font-semibold flex items-center gap-1.5 ${isMk ? 'text-slate-400' : 'text-slate-800'}`}>
                    <DollarSign className={`w-3.5 h-3.5 ${isMk ? 'text-slate-400' : 'text-emerald-600'}`} />
                    Сума Договору {!isMk && <span className="text-red-500 font-bold">*</span>}
                  </label>
                  <span className={`text-[10px] font-mono font-bold px-1.5 py-0.2 rounded ${isMk ? 'text-slate-400 bg-slate-200/60' : 'text-emerald-700 bg-emerald-100/80'}`}>
                    Кол. M (від рядка 127)
                  </span>
                </div>
                <div className="relative">
                  <input
                    ref={contractAmountRef}
                    type="text"
                    value={contractAmount}
                    onChange={(e) => {
                      setContractAmount(e.target.value);
                      clearFieldError('contractAmount');
                    }}
                    disabled={isSubmitting || isMk}
                    placeholder={isMk ? 'Не заповнюється для Відділу МК' : '0.00'}
                    className={`w-full pl-3 pr-8 py-2 border rounded-lg text-xs font-mono font-bold focus:outline-none focus:ring-2 transition-colors ${
                      isMk
                        ? 'border-slate-200 bg-slate-200/50 text-slate-400 cursor-not-allowed'
                        : validationErrors.contractAmount
                        ? 'border-red-400 bg-red-50/40 focus:ring-red-500 text-slate-900'
                        : 'border-slate-300 bg-white focus:ring-emerald-500 text-slate-900'
                    }`}
                  />
                  <span className={`absolute right-3 top-1/2 -translate-y-1/2 font-bold ${isMk ? 'text-slate-300' : 'text-slate-400'}`}>
                    ₴
                  </span>
                </div>
                {!isMk && validationErrors.contractAmount ? (
                  <p className="mt-1 text-[10px] text-red-600 font-medium flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> {validationErrors.contractAmount}
                  </p>
                ) : !isMk ? (
                  <p className="text-[11px] text-slate-500 mt-1">
                    Вноситься у перший порожній рядок колонки M вкладки «Лист1»
                  </p>
                ) : null}
              </div>

              {/* Курс валют (Колонка I) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className={`block font-semibold flex items-center gap-1.5 ${isMk ? 'text-slate-400' : 'text-slate-800'}`}>
                    Курс валют
                  </label>
                  <span className={`text-[10px] font-mono font-bold px-1.5 py-0.2 rounded ${isMk ? 'text-slate-400 bg-slate-200/60' : 'text-slate-700 bg-slate-200/80'}`}>
                    Кол. I
                  </span>
                </div>
                <input
                  type="text"
                  value={currencyRate}
                  onChange={(e) => setCurrencyRate(e.target.value)}
                  disabled={isSubmitting || isMk}
                  placeholder="1"
                  className={`w-full px-3 py-2 border rounded-lg text-xs font-mono focus:outline-none focus:ring-2 transition-colors ${
                    isMk
                      ? 'border-slate-200 bg-slate-200/50 text-slate-400 cursor-not-allowed'
                      : 'border-slate-300 bg-white focus:ring-emerald-500 text-slate-900'
                  }`}
                />
                <p className="text-[10px] text-slate-400 mt-1">За замовчуванням 1</p>
              </div>
            </div>

            {/* Графік оплат (Транші: Колонки Z..AG) */}
            {!isMk && (
              <div className="mt-4 pt-3 border-t border-slate-200/80">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-4 h-4 text-emerald-700" />
                    <span className="font-bold text-slate-800 text-xs">
                      Графік оплат (Колонки Z..AG)
                    </span>
                    <span className="text-[10px] font-mono text-emerald-700 bg-emerald-100/70 px-1.5 py-0.5 rounded font-semibold">
                      Оплата 1-4
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (!showTranches) {
                        handleDistributeTranches();
                      } else {
                        setShowTranches(false);
                      }
                    }}
                    className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    {showTranches ? 'Приховати транші' : '⚡ Заповнити транші (4 по 25%)'}
                  </button>
                </div>

                {showTranches && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 p-3 bg-emerald-50/40 rounded-xl border border-emerald-200/70 animate-in fade-in">
                    {[0, 1, 2, 3].map((idx) => {
                      const amountCol = idx === 0 ? 'Z' : idx === 1 ? 'AB' : idx === 2 ? 'AD' : 'AF';
                      const weekCol = idx === 0 ? 'AA' : idx === 1 ? 'AC' : idx === 2 ? 'AE' : 'AG';
                      return (
                        <div key={idx} className="p-2.5 bg-white rounded-lg border border-emerald-100 shadow-2xs space-y-1.5">
                          <div className="flex items-center justify-between text-[11px] font-bold text-slate-700">
                            <span>Платіж #{idx + 1}</span>
                            <span className="text-[10px] font-mono text-slate-400">
                              Кол. {amountCol} / {weekCol}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-[10px] text-slate-500 block mb-0.5 font-medium">Сума (₴)</label>
                              <input
                                type="text"
                                value={tranches[idx]?.amount ?? ''}
                                onChange={(e) => {
                                  const next = [...tranches];
                                  next[idx] = { ...next[idx], amount: e.target.value };
                                  setTranches(next);
                                }}
                                placeholder="0"
                                className="w-full px-2 py-1 border border-slate-200 rounded text-xs font-mono font-medium focus:ring-1 focus:ring-emerald-500"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-slate-500 block mb-0.5 font-medium">Тиждень</label>
                              <select
                                value={tranches[idx]?.week ?? ''}
                                onChange={(e) => {
                                  const next = [...tranches];
                                  next[idx] = { ...next[idx], week: e.target.value };
                                  setTranches(next);
                                }}
                                className="w-full px-1.5 py-1 border border-slate-200 rounded text-[11px] font-mono focus:ring-1 focus:ring-emerald-500 bg-white"
                              >
                                <option value="">— Оберіть —</option>
                                {weekOptions.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.fullLabel} {opt.isCurrentWeek ? '• зараз' : ''}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </form>

        {/* Modal Footer with Actions */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 text-[11px] text-slate-600 truncate">
            <Layers className="w-3.5 h-3.5 text-blue-600 shrink-0" />
            <span className="truncate">
              <b>«План»</b>: A, B, C, D, H (від рядка 2094){' '}
              <span className="text-slate-400">•</span>{' '}
              {isMk ? (
                <b className="text-slate-500">«Лист1»: без запису (відділ МК)</b>
              ) : (
                <b>«Лист1»: G, H, M (від рядка 127)</b>
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

            {/* Action button: "+Записати проект" or "Оновити в Лист1" */}
            {isDuplicateNumber ? (
              <button
                type="button"
                onClick={() => handleSaveProject(true)}
                disabled={isSubmitting}
                className="px-4 py-2 rounded-xl text-xs font-bold cursor-pointer transition shadow-xs flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50"
                title="Оновити проект та перенести/записати дані в Лист1 (перший вільний рядок 131)"
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Оновлення прив'язок...</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4" />
                    <span>Оновити / прив'язати в Лист1</span>
                  </>
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleSaveProject(false)}
                disabled={isSubmitting}
                className="px-5 py-2 rounded-xl text-xs font-bold cursor-pointer transition shadow-xs flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white"
                title={
                  isMk
                    ? 'Записати проект у таблицю «План відвантажень» (без запису в Оплати/Борги)'
                    : "Записати проект згідно з новими прив'язками"
                }
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Запис у Google Таблиці...</span>
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4" />
                    <span>{isMk ? 'Записати проект (тільки План)' : 'Записати проект'}</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
