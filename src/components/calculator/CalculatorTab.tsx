import React, { useState, useEffect, useMemo } from 'react';
import {
  Calculator,
  Plus,
  Layers,
  FileSpreadsheet,
  TrendingUp,
  Save,
  Copy,
  Printer,
  Sparkles,
  ExternalLink,
  Trash2,
  FolderOpen,
  Calendar,
  User,
  Building,
  CheckCircle2,
  AlertCircle,
  FileText,
  Clock,
  Briefcase,
  ChevronRight,
  ArrowRight,
  Download,
} from 'lucide-react';
import {
  ConstructiveItem,
  MaterialItem,
  CalculatorCoefficients,
  CalculationProject,
  CalculationSummary,
  ProjectTemplatePreset,
  ProjectAssemblyUnit,
  ProjectServicesConfig,
} from '../../types/calculator';
import { ProjectSheetRow, SheetConfig } from '../../types';
import { AuthState } from '../../services/googleAuth';
import { CalculatorStorageService } from '../../services/calculatorStorage';
import { CALCULATOR_PRESETS } from '../../data/calculatorDefaults';
import { MasterDataModal } from './MasterDataModal';
import { ExportGoogleSheetModal } from './ExportGoogleSheetModal';
import { GenerationResult, SpecificationSheetGenerator } from '../../services/specificationSheetGenerator';
import { AddProjectModal, AddProjectInitialData } from '../AddProjectModal';
import { DEFAULT_PROJECTS_SPREADSHEET_ID } from '../../services/googleSheets';
import { BomEditorWindow } from './windows/BomEditorWindow';
import { CatalogWindow } from './windows/CatalogWindow';
import { ProjectTreeWindow } from './windows/ProjectTreeWindow';
import { FinancialSummaryWindow } from './windows/FinancialSummaryWindow';

interface Props {
  projects: ProjectSheetRow[];
  onProjectsChange: (updatedProjects: ProjectSheetRow[]) => void;
  sheetConfig?: SheetConfig | null;
  authState: AuthState;
  driveFolderId?: string;
  onOpenAuthModal: () => void;
  onNavigateToCashFlow: () => void;
  onNavigateToProjects?: () => void;
  onRefreshProjects?: (source?: 'payments' | 'plan') => Promise<void>;
  canWriteToSheets?: boolean;
}

export const CalculatorTab: React.FC<Props> = ({
  projects,
  onProjectsChange,
  sheetConfig,
  authState,
  driveFolderId,
  onOpenAuthModal,
  onNavigateToCashFlow,
  onNavigateToProjects,
  onRefreshProjects,
  canWriteToSheets = true,
}) => {
  // Navigation inside calculator
  const [activeSubView, setActiveSubView] = useState<'calculator' | 'saved'>('calculator');
  const [isMasterDataOpen, setIsMasterDataOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isAddProjectModalOpen, setIsAddProjectModalOpen] = useState(false);
  const [addProjectInitialData, setAddProjectInitialData] = useState<AddProjectInitialData | null>(null);
  const [isApproved, setIsApproved] = useState<boolean>(false);

  // Master Data state
  const [materials, setMaterials] = useState<MaterialItem[]>(() =>
    CalculatorStorageService.loadMaterials()
  );
  const [coefficients, setCoefficients] = useState<CalculatorCoefficients>(() =>
    CalculatorStorageService.loadCoefficients()
  );

  // Saved calculations history
  const [savedProjects, setSavedProjects] = useState<CalculationProject[]>(() =>
    CalculatorStorageService.loadSavedProjects()
  );

  // Known managers extracted from existing projects
  const existingManagers = useMemo(() => {
    const managers = new Set<string>();
    projects.forEach((p) => {
      if (p.colH && p.colH.trim() && p.colH.trim() !== '—') managers.add(p.colH.trim());
      if (p.colE && p.colE.trim() && p.colE.trim() !== '—') managers.add(p.colE.trim());
    });
    return Array.from(managers);
  }, [projects]);

  // Active Project Form State
  const [projectNumber, setProjectNumber] = useState<string>(() => {
    // Generate next candidate number based on existing projects
    const maxNumber = projects.reduce((max, p) => {
      const match = p.colA?.match(/^(\d+)-/);
      if (match) {
        const num = parseInt(match[1], 10);
        return num > max ? num : max;
      }
      return max;
    }, 245);
    return `${maxNumber + 1}-26`;
  });

  const [projectName, setProjectName] = useState('Острівний торговий стелаж');
  const [client, setClient] = useState('ТОВ «ЦУМ Київ»');
  const [manager, setManager] = useState('Олексій С.');
  const [projectDate, setProjectDate] = useState(() => new Date().toISOString().slice(0, 10));

  // Project Furniture Assemblies (Units) - Window 1 & Window 3
  const [units, setUnits] = useState<ProjectAssemblyUnit[]>(() => {
    const preset = CALCULATOR_PRESETS[0];
    const initialCoeffs = CalculatorStorageService.loadCoefficients();
    const loadedMats = CalculatorStorageService.loadMaterials();

    const initialItems = preset.items.map((pi, idx) => {
      const mat = loadedMats.find((m) => m.name === pi.materialName) || loadedMats[0];
      const raw: Omit<ConstructiveItem, 'effectiveQuantity' | 'materialCost' | 'totalCost' | 'clientPrice'> = {
        id: `item_init_${idx}`,
        constructive: pi.constructive,
        materialId: mat.id,
        materialName: mat.name,
        category: pi.category,
        unit: pi.unit,
        quantity: parseFloat(Number(pi.quantity).toFixed(4)),
        basePrice: parseFloat(Number(mat.basePrice).toFixed(2)),
        wasteFactor: parseFloat(Number(initialCoeffs.wasteFactorsByCategory[pi.category] || mat.defaultWasteFactor).toFixed(3)),
        complexityFactor: parseFloat(Number(preset.defaultComplexity).toFixed(2)),
        notes: pi.notes || '',
      };
      return CalculatorStorageService.recalculateItem(
        raw,
        preset.defaultComplexity,
        preset.defaultMargin
      );
    });

    return [
      {
        id: 'unit_default_1',
        name: 'Острівний стелаж 2000х1200х450',
        quantity: 1,
        items: initialItems,
      },
    ];
  });

  const [activeUnitId, setActiveUnitId] = useState<string>('unit_default_1');

  // Additional Services (Delivery & Installation) - Window 3
  const [servicesConfig, setServicesConfig] = useState<ProjectServicesConfig>({
    delivery: {
      enabled: true,
      name: 'Вантажне авто (Київ та область)',
      trips: 1,
      ratePerTrip: 1800,
      notes: '',
    },
    installation: {
      enabled: true,
      name: 'Монтажні роботи на обʼєкті',
      hours: 8,
      workers: 2,
      ratePerHour: 350,
      notes: '',
    },
  });

  // Export / Sync metadata
  const [createdSheetUrl, setCreatedSheetUrl] = useState<string | null>(null);
  const [createdSheetId, setCreatedSheetId] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'info'; message: string } | null>(
    null
  );

  const showToast = (message: string, type: 'success' | 'info' = 'success') => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 4000);
  };

  // Active assembly unit for Window 1
  const activeUnit = useMemo(() => {
    return (
      units.find((u) => u.id === activeUnitId) ||
      units[0] || {
        id: 'unit_default',
        name: 'Основний виріб',
        quantity: 1,
        items: [],
      }
    );
  }, [units, activeUnitId]);

  // All constructive items across all units in the project
  const allProjectItems = useMemo(() => {
    return units.flatMap((u) => u.items || []);
  }, [units]);

  // Delivery total cost
  const deliveryCost = useMemo(() => {
    return servicesConfig.delivery.enabled
      ? (servicesConfig.delivery.trips || 1) * (servicesConfig.delivery.ratePerTrip || 0)
      : 0;
  }, [servicesConfig.delivery]);

  // Installation total cost
  const installationCost = useMemo(() => {
    return servicesConfig.installation.enabled
      ? (servicesConfig.installation.workers || 1) *
          (servicesConfig.installation.hours || 0) *
          (servicesConfig.installation.ratePerHour || 0)
      : 0;
  }, [servicesConfig.installation]);

  // Real-time calculation summary (Window 4)
  const summary: CalculationSummary = useMemo(() => {
    return CalculatorStorageService.calculateSummary(
      allProjectItems,
      coefficients,
      deliveryCost,
      installationCost
    );
  }, [allProjectItems, coefficients, deliveryCost, installationCost]);

  // Current full project object
  const currentProject: CalculationProject = useMemo(() => {
    return {
      id: `calc_${projectNumber.replace(/\s+/g, '_')}_${projectDate}`,
      projectNumber: projectNumber.trim() || '246-26',
      projectName: projectName.trim() || 'Новий виріб',
      client: client.trim() || 'Замовник',
      manager: manager.trim() || 'Менеджер',
      date: projectDate,
      items: allProjectItems,
      units,
      servicesConfig,
      coefficients,
      summary,
      googleSheetId: createdSheetId || undefined,
      googleSheetUrl: createdSheetUrl || undefined,
      isInCashFlow: projects.some(
        (p) => p.colA?.trim().toLowerCase() === projectNumber.trim().toLowerCase()
      ),
      isApproved,
      isInProjects: projects.some(
        (p) => p.colA?.trim().toLowerCase() === projectNumber.trim().toLowerCase()
      ),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: isApproved
        ? 'approved'
        : createdSheetId
        ? 'exported'
        : 'calculated',
    };
  }, [
    projectNumber,
    projectName,
    client,
    manager,
    projectDate,
    allProjectItems,
    units,
    servicesConfig,
    coefficients,
    summary,
    createdSheetId,
    createdSheetUrl,
    projects,
    isApproved,
  ]);

  // Handle updating coefficients
  const handleUpdateCoefficients = (newCoeffs: CalculatorCoefficients) => {
    setCoefficients(newCoeffs);
    CalculatorStorageService.saveCoefficients(newCoeffs);

    // Recalculate all items in all units with new global complexity / margin
    setUnits((prevUnits) =>
      prevUnits.map((u) => ({
        ...u,
        items: (u.items || []).map((item) => {
          const raw: Omit<ConstructiveItem, 'effectiveQuantity' | 'materialCost' | 'totalCost' | 'clientPrice'> = {
            ...item,
            complexityFactor: newCoeffs.complexityMultiplier,
          };
          return CalculatorStorageService.recalculateItem(
            raw,
            newCoeffs.complexityMultiplier,
            newCoeffs.marginPercent
          );
        }),
      }))
    );
  };

  // Window 1: Add item to active unit
  const handleAddItemToActiveUnit = (newItem: ConstructiveItem) => {
    setUnits((prevUnits) =>
      prevUnits.map((u) =>
        u.id === activeUnit.id ? { ...u, items: [...(u.items || []), newItem] } : u
      )
    );
    showToast(`Позицію «${newItem.constructive}» додано до «${activeUnit.name}»`);
  };

  // Window 1: Update item in active unit
  const handleUpdateItemInActiveUnit = (updatedItem: ConstructiveItem) => {
    setUnits((prevUnits) =>
      prevUnits.map((u) =>
        u.id === activeUnit.id
          ? {
              ...u,
              items: (u.items || []).map((item) =>
                item.id === updatedItem.id ? updatedItem : item
              ),
            }
          : u
      )
    );
  };

  // Window 1: Delete item from active unit
  const handleDeleteItemInActiveUnit = (id: string) => {
    setUnits((prevUnits) =>
      prevUnits.map((u) =>
        u.id === activeUnit.id
          ? { ...u, items: (u.items || []).filter((item) => item.id !== id) }
          : u
      )
    );
  };

  // Window 1: Duplicate item in active unit
  const handleDuplicateItemInActiveUnit = (itemToDup: ConstructiveItem) => {
    const duplicated: ConstructiveItem = {
      ...itemToDup,
      id: `item_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      constructive: `${itemToDup.constructive} (копія)`,
    };
    handleAddItemToActiveUnit(duplicated);
  };

  // Window 1 & 2: Drop material from Window 2 into active unit in Window 1
  const handleDropMaterialToActiveUnit = (mat: MaterialItem) => {
    const isService = mat.category === 'services';
    const defaultWaste = isService
      ? 1.0
      : coefficients.wasteFactorsByCategory[mat.category] || mat.defaultWasteFactor || 1.10;

    const rawItem: Omit<ConstructiveItem, 'effectiveQuantity' | 'materialCost' | 'totalCost' | 'clientPrice'> = {
      id: `item_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      constructive: mat.name,
      materialId: mat.id,
      materialName: mat.name,
      category: mat.category,
      unit: mat.unit,
      quantity: 1,
      basePrice: mat.basePrice,
      wasteFactor: defaultWaste,
      complexityFactor: coefficients.complexityMultiplier,
      notes: '',
    };

    const recalculated = CalculatorStorageService.recalculateItem(
      rawItem,
      coefficients.complexityMultiplier,
      coefficients.marginPercent
    );

    handleAddItemToActiveUnit(recalculated);
  };

  // Window 3: Unit management
  const handleAddUnit = (name: string) => {
    const newUnit: ProjectAssemblyUnit = {
      id: `unit_${Date.now()}`,
      name,
      quantity: 1,
      items: [],
    };
    setUnits((prev) => [...prev, newUnit]);
    setActiveUnitId(newUnit.id);
    showToast(`Створено новий виріб «${name}»`);
  };

  const handleRenameUnit = (unitId: string, newName: string) => {
    setUnits((prev) =>
      prev.map((u) => (u.id === unitId ? { ...u, name: newName } : u))
    );
    showToast('Назву виробу оновлено');
  };

  const handleDuplicateUnit = (unitId: string) => {
    const original = units.find((u) => u.id === unitId);
    if (!original) return;
    const newUnitId = `unit_${Date.now()}`;
    const duplicatedItems = (original.items || []).map((it) => ({
      ...it,
      id: `item_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    }));
    const duplicatedUnit: ProjectAssemblyUnit = {
      ...original,
      id: newUnitId,
      name: `${original.name} (копія)`,
      items: duplicatedItems,
    };
    setUnits((prev) => [...prev, duplicatedUnit]);
    setActiveUnitId(newUnitId);
    showToast(`Створено копію виробу «${original.name}»`);
  };

  const handleDeleteUnit = (unitId: string) => {
    if (units.length <= 1) {
      showToast('Не можна видалити єдиний виріб у замовленні', 'info');
      return;
    }
    const nextUnits = units.filter((u) => u.id !== unitId);
    setUnits(nextUnits);
    if (activeUnitId === unitId) {
      setActiveUnitId(nextUnits[0].id);
    }
    showToast('Виріб видалено із замовлення');
  };

  const handleUpdateServicesConfig = (cfg: ProjectServicesConfig) => {
    setServicesConfig(cfg);
  };

  // Load a preset template
  const handleApplyPreset = (preset: ProjectTemplatePreset) => {
    const newCoeffs: CalculatorCoefficients = {
      ...coefficients,
      complexityMultiplier: preset.defaultComplexity,
      marginPercent: preset.defaultMargin,
    };
    setCoefficients(newCoeffs);
    CalculatorStorageService.saveCoefficients(newCoeffs);

    const presetItems = preset.items.map((pi, idx) => {
      const mat = materials.find((m) => m.name === pi.materialName) || materials[0];
      const raw: Omit<ConstructiveItem, 'effectiveQuantity' | 'materialCost' | 'totalCost' | 'clientPrice'> = {
        id: `preset_item_${idx}_${Date.now()}`,
        constructive: pi.constructive,
        materialId: mat.id,
        materialName: mat.name,
        category: pi.category,
        unit: pi.unit,
        quantity: parseFloat(Number(pi.quantity).toFixed(4)),
        basePrice: parseFloat(Number(mat.basePrice).toFixed(2)),
        wasteFactor: parseFloat(Number(newCoeffs.wasteFactorsByCategory[pi.category] || mat.defaultWasteFactor).toFixed(3)),
        complexityFactor: parseFloat(Number(preset.defaultComplexity).toFixed(2)),
        notes: pi.notes || '',
      };
      return CalculatorStorageService.recalculateItem(
        raw,
        preset.defaultComplexity,
        preset.defaultMargin
      );
    });

    setProjectName(preset.title);
    setUnits((prev) =>
      prev.map((u) =>
        u.id === activeUnit.id
          ? {
              ...u,
              name: preset.title.split(' (')[0],
              items: presetItems,
            }
          : u
      )
    );
    showToast(`Завантажено шаблон «${preset.title}»`);
  };

  // Clear current active unit items
  const handleClearItems = () => {
    if (activeUnit.items.length === 0 || window.confirm(`Очистити специфікацію виробу «${activeUnit.name}»?`)) {
      setUnits((prev) =>
        prev.map((u) => (u.id === activeUnit.id ? { ...u, items: [] } : u))
      );
      showToast(`Очищено специфікацію «${activeUnit.name}»`);
    }
  };

  // Save current project calculation locally
  const handleSaveCalculation = () => {
    CalculatorStorageService.saveProject(currentProject);
    setSavedProjects(CalculatorStorageService.loadSavedProjects());
    showToast('Прорахунок успішно збережено в історію');
  };

  // Load saved project from history
  const handleLoadSavedProject = (proj: CalculationProject) => {
    setProjectNumber(proj.projectNumber);
    setProjectName(proj.projectName);
    setClient(proj.client);
    setManager(proj.manager);
    setProjectDate(proj.date);

    if (proj.coefficients) {
      setCoefficients(proj.coefficients);
    }

    if (proj.servicesConfig) {
      setServicesConfig(proj.servicesConfig);
    }

    if (proj.units && proj.units.length > 0) {
      const loadedUnits = proj.units.map((u) => ({
        ...u,
        items: (u.items || []).map((it) => {
          const q = parseFloat(Number(it.quantity).toFixed(4));
          const p = parseFloat(Number(it.basePrice).toFixed(2));
          const w = it.category === 'services' ? 1.0 : parseFloat(Number(it.wasteFactor).toFixed(3));
          const c = parseFloat(Number(it.complexityFactor).toFixed(2));
          return CalculatorStorageService.recalculateItem(
            { ...it, quantity: q, basePrice: p, wasteFactor: w, complexityFactor: c },
            c,
            proj.coefficients?.marginPercent || 35
          );
        }),
      }));
      setUnits(loadedUnits);
      setActiveUnitId(loadedUnits[0].id);
    } else {
      const cleanedItems = (proj.items || []).map((item) => {
        const q = parseFloat(Number(item.quantity).toFixed(4));
        const p = parseFloat(Number(item.basePrice).toFixed(2));
        const w = item.category === 'services' ? 1.0 : parseFloat(Number(item.wasteFactor).toFixed(3));
        const c = parseFloat(Number(item.complexityFactor).toFixed(2));
        return CalculatorStorageService.recalculateItem(
          {
            ...item,
            quantity: q,
            basePrice: p,
            wasteFactor: w,
            complexityFactor: c,
          },
          c,
          proj.coefficients?.marginPercent || 35
        );
      });
      const singleUnit: ProjectAssemblyUnit = {
        id: `unit_${Date.now()}`,
        name: proj.projectName || 'Основний виріб',
        quantity: 1,
        items: cleanedItems,
      };
      setUnits([singleUnit]);
      setActiveUnitId(singleUnit.id);
    }

    setCreatedSheetId(proj.googleSheetId || null);
    setCreatedSheetUrl(proj.googleSheetUrl || null);
    setIsApproved(Boolean(proj.isApproved || proj.status === 'approved' || proj.status === 'in_projects'));
    setActiveSubView('calculator');
    showToast(`Завантажено проєкт № ${proj.projectNumber}`);
  };

  // Transfer to Projects workflow via AddProjectModal
  const handleTransferToProjects = (targetProj?: CalculationProject) => {
    const projToUse = targetProj || currentProject;
    const finalAmount = Math.round(
      projToUse.summary.clientTotalWithVat || projToUse.summary.clientTotalWithoutVat || 0
    );
    const tranche1 = Math.round(finalAmount * 0.7);
    const tranche2 = finalAmount - tranche1;

    setAddProjectInitialData({
      projectNumber: projToUse.projectNumber.trim(),
      projectName: projToUse.projectName.trim(),
      manager: projToUse.manager.trim(),
      contractAmount: String(finalAmount),
      startDate: projToUse.date,
      invoiceNumber: projToUse.projectNumber.trim(),
      client: projToUse.client.trim(),
      department: 'ЕТС',
      tranches: [
        { amount: String(tranche1), week: '' },
        { amount: String(tranche2), week: '' },
        { amount: '', week: '' },
        { amount: '', week: '' },
      ],
      sourceNote: `Погоджений розрахунок №${projToUse.projectNumber.trim()}`,
    });
    setIsAddProjectModalOpen(true);
  };

  // One-click approve and open Add Project modal
  const handleApproveAndTransferToProjects = (targetProj?: CalculationProject) => {
    setIsApproved(true);
    handleTransferToProjects(targetProj);
    showToast('Проєкт погоджено! Відкрито вікно «Додати проект» для внесення в систему.', 'success');
  };

  // Delete saved project
  const handleDeleteSavedProject = (id: string) => {
    if (window.confirm('Видалити цей збережений кошторис?')) {
      CalculatorStorageService.deleteProject(id);
      setSavedProjects(CalculatorStorageService.loadSavedProjects());
      showToast('Кошторис видалено з історії');
    }
  };

  // Direct pass to Cash Flow
  const handleDirectPassToCashFlow = async () => {
    try {
      const res = await SpecificationSheetGenerator.passToCashFlow(
        currentProject,
        projects,
        authState.accessToken,
        sheetConfig
      );
      onProjectsChange(res.updatedProjects);
      handleSaveCalculation();
      showToast(
        `Суму ${(currentProject.summary.clientTotalWithVat || currentProject.summary.clientTotalWithoutVat).toLocaleString('uk-UA')} ₴ успішно передано в Cash Flow!`,
        'success'
      );
    } catch (err: any) {
      showToast(`Помилка синхронізації з Cash Flow: ${err.message}`, 'info');
    }
  };

  // Copy commercial offer to clipboard
  const handleCopyCommercialOffer = () => {
    const finalSum = currentProject.summary.clientTotalWithVat || currentProject.summary.clientTotalWithoutVat;
    let text = `КОМЕРЦІЙНА ПРОПОЗИЦІЯ / КОШТОРИС\n`;
    text += `Замовлення №: ${projectNumber} — ${projectName}\n`;
    text += `Замовник: ${client} | Менеджер: ${manager} | Дата: ${projectDate}\n\n`;

    units.forEach((u, uIdx) => {
      text += `══ ВИРІБ ${uIdx + 1}: ${u.name} ══\n`;
      (u.items || []).forEach((it, idx) => {
        text += `  ${idx + 1}. ${it.constructive} (${it.quantity} ${it.unit}) — ${it.clientPrice.toLocaleString('uk-UA')} ₴\n`;
      });
      const uTotal = (u.items || []).reduce((acc, i) => acc + (i.clientPrice || 0), 0);
      text += `  Підсумок виробу: ${uTotal.toLocaleString('uk-UA')} ₴\n\n`;
    });

    if (servicesConfig.delivery.enabled && deliveryCost > 0) {
      text += `Доставка (${servicesConfig.delivery.name}, ${servicesConfig.delivery.trips} рейс.): ${deliveryCost.toLocaleString('uk-UA')} ₴\n`;
    }
    if (servicesConfig.installation.enabled && installationCost > 0) {
      text += `Монтаж (${servicesConfig.installation.name}, ${servicesConfig.installation.workers} ос. х ${servicesConfig.installation.hours} год.): ${installationCost.toLocaleString('uk-UA')} ₴\n`;
    }

    text += `\nРАЗОМ БЕЗ ПДВ: ${currentProject.summary.clientTotalWithoutVat.toLocaleString('uk-UA')} ₴\n`;
    if (coefficients.vatRatePercent > 0) {
      text += `ПДВ 20%: ${currentProject.summary.vatAmount.toLocaleString('uk-UA')} ₴\n`;
      text += `ВСЬОГО ДО СПЛАТИ З ПДВ: ${currentProject.summary.clientTotalWithVat.toLocaleString('uk-UA')} ₴\n`;
    } else {
      text += `ВСЬОГО ДО СПЛАТИ: ${finalSum.toLocaleString('uk-UA')} ₴\n`;
    }
    text += `Умови оплати: 70% аванс, 30% перед відвантаженням/монтажем.`;

    navigator.clipboard.writeText(text);
    showToast('Комерційну пропозицію скопійовано в буфер обміну');
  };

  // Success callback from Google Sheets modal
  const handleExportSuccess = (res: GenerationResult, updatedProjectsList?: ProjectSheetRow[]) => {
    setCreatedSheetId(res.spreadsheetId);
    setCreatedSheetUrl(res.spreadsheetUrl);

    if (updatedProjectsList) {
      onProjectsChange(updatedProjectsList);
    }

    const updatedWithSheet: CalculationProject = {
      ...currentProject,
      googleSheetId: res.spreadsheetId,
      googleSheetUrl: res.spreadsheetUrl,
      isInCashFlow: res.cashFlowUpdated,
      cashFlowRowNumber: res.targetProjectRow,
      status: 'exported',
    };

    CalculatorStorageService.saveProject(updatedWithSheet);
    setSavedProjects(CalculatorStorageService.loadSavedProjects());
  };

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {notification && (
        <div className="bg-emerald-600 text-white px-4 py-2.5 rounded-xl shadow-lg flex items-center justify-between gap-3 text-xs font-semibold animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-200" />
            <span>{notification.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setNotification(null)}
            className="text-emerald-200 hover:text-white"
          >
            ×
          </button>
        </div>
      )}

      {/* Main Top Header Card with Metadata & Action Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-200">
          {/* Title & Branding */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-indigo-600 to-blue-600 text-white flex items-center justify-center shadow-md shadow-indigo-100">
              <Calculator className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg font-extrabold text-slate-900 tracking-tight">
                  Калькулятор замовлень & Генератор специфікацій
                </h1>
                <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                  PWA Workstation
                </span>
                {createdSheetUrl && (
                  <a
                    href={createdSheetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-300 hover:bg-emerald-100 transition"
                  >
                    <FileSpreadsheet className="w-3 h-3 text-emerald-600" />
                    <span>Google Sheets підключено</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Швидкий розрахунок вартості виробів за кресленнями, застосування коефіцієнтів та генерація Google Таблиць
              </p>
            </div>
          </div>

          {/* Top Sub-Navigation Tabs */}
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200">
              <button
                type="button"
                onClick={() => setActiveSubView('calculator')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition cursor-pointer ${
                  activeSubView === 'calculator'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Calculator className="w-3.5 h-3.5 text-indigo-600" />
                <span>Калькулятор</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveSubView('saved')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition cursor-pointer ${
                  activeSubView === 'saved'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <FolderOpen className="w-3.5 h-3.5 text-blue-600" />
                <span>Збережені ({savedProjects.length})</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => setIsMasterDataOpen(true)}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold border border-slate-200 flex items-center gap-1.5 transition cursor-pointer"
              title="Налаштування довідника матеріалів, цін та коефіцієнтів відходу"
            >
              <Layers className="w-3.5 h-3.5 text-indigo-600" />
              <span className="hidden sm:inline">Довідники & Коефіцієнти</span>
              <span className="sm:hidden">Довідники</span>
            </button>
          </div>
        </div>

        {/* Project Metadata Inputs (Project Number, Title, Client, Manager, Date, Approval Status) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 pt-1">
          {/* Project Number */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-bold text-slate-800 flex items-center gap-1">
                <Briefcase className="w-3.5 h-3.5 text-indigo-600" />
                <span>№ проєкту / код</span>
              </label>
              <span className="text-[10px] text-slate-400 font-mono">напр. 246-26</span>
            </div>
            <input
              type="text"
              value={projectNumber}
              onChange={(e) => setProjectNumber(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-mono font-bold text-slate-900 focus:ring-2 focus:ring-indigo-500"
              placeholder="246-26"
            />
          </div>

          {/* Project / Object Title */}
          <div className="lg:col-span-2">
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-bold text-slate-800 flex items-center gap-1">
                <FileText className="w-3.5 h-3.5 text-blue-600" />
                <span>Назва виробу / об'єкту</span>
              </label>
              <span className="text-[10px] text-slate-400">за кресленнями</span>
            </div>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-semibold text-slate-900 focus:ring-2 focus:ring-indigo-500"
              placeholder="напр. Острівний стелаж метал + дерево"
            />
          </div>

          {/* Client / Customer */}
          <div>
            <label className="block text-xs font-bold text-slate-800 mb-1 flex items-center gap-1">
              <Building className="w-3.5 h-3.5 text-emerald-600" />
              <span>Замовник / Клієнт</span>
            </label>
            <input
              type="text"
              value={client}
              onChange={(e) => setClient(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-medium text-slate-900 focus:ring-2 focus:ring-indigo-500"
              placeholder="напр. ТОВ «ЦУМ Київ»"
            />
          </div>

          {/* Manager & Date */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-bold text-slate-800 mb-1 flex items-center gap-1">
                <User className="w-3 h-3 text-slate-500" />
                <span>Менеджер</span>
              </label>
              <input
                type="text"
                value={manager}
                onChange={(e) => setManager(e.target.value)}
                className="w-full px-2.5 py-2 border border-slate-300 rounded-xl text-xs font-medium text-slate-900 focus:ring-2 focus:ring-indigo-500"
                placeholder="ПІБ"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-800 mb-1 flex items-center gap-1">
                <Calendar className="w-3 h-3 text-slate-500" />
                <span>Дата</span>
              </label>
              <input
                type="date"
                value={projectDate}
                onChange={(e) => setProjectDate(e.target.value)}
                className="w-full px-2 py-2 border border-slate-300 rounded-xl text-xs font-medium text-slate-900 focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* Project Status & Approval Toggle */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-bold text-slate-800 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>Статус погодження</span>
              </label>
              <span className="text-[10px] text-slate-400">клієнт</span>
            </div>
            <button
              type="button"
              onClick={() => {
                const nextApproved = !isApproved;
                setIsApproved(nextApproved);
                showToast(
                  nextApproved
                    ? 'Проєкт погоджено! Кнопка «Передати в Проєкти» готова до внесення.'
                    : 'Статус змінено на «На прорахунку»',
                  nextApproved ? 'success' : 'info'
                );
              }}
              className={`w-full px-2.5 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border transition cursor-pointer shadow-2xs ${
                isApproved
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100'
                  : 'bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100'
              }`}
              title="Натисніть для зміни статусу: Погоджений / На прорахунку"
            >
              {isApproved ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span className="truncate font-extrabold">Погоджений ✓</span>
                </>
              ) : (
                <>
                  <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span className="truncate">На прорахунку</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Template Presets Bar */}
        <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider shrink-0 flex items-center gap-1 mr-1">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              Шаблони за кресленнями:
            </span>
            {CALCULATOR_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => handleApplyPreset(preset)}
                className="px-2.5 py-1 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-slate-700 rounded-lg text-xs font-medium border border-slate-200/80 transition shrink-0 cursor-pointer"
                title={preset.description}
              >
                {preset.title.split(' (')[0]}
              </button>
            ))}
            <button
              type="button"
              onClick={handleClearItems}
              className="px-2 py-1 text-slate-400 hover:text-rose-600 rounded-lg text-xs transition cursor-pointer"
            >
              Очистити
            </button>
          </div>

          {/* Action buttons on the right */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={handleSaveCalculation}
              className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-bold border border-slate-300 flex items-center gap-1.5 transition cursor-pointer shadow-2xs"
              title="Зберегти поточний прорахунок у локальну історію"
            >
              <Save className="w-3.5 h-3.5 text-slate-600" />
              <span>Зберегти</span>
            </button>

            <button
              type="button"
              onClick={handleCopyCommercialOffer}
              className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-bold border border-slate-300 flex items-center gap-1.5 transition cursor-pointer shadow-2xs"
              title="Скопіювати комерційну пропозицію для відправки в месенджер/email"
            >
              <Copy className="w-3.5 h-3.5 text-slate-600" />
              <span>Копіювати КП</span>
            </button>

            <button
              type="button"
              onClick={handleDirectPassToCashFlow}
              className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-xs"
              title="Передати підсумкову суму проєкту у фінансовий календар (Cash Flow)"
            >
              <TrendingUp className="w-3.5 h-3.5" />
              <span>Передати в Cash Flow</span>
            </button>

            {/* ПОГОДЖЕНИЙ ПРОЄКТ: ПЕРЕДАТИ В ПРОЄКТИ */}
            {isApproved ? (
              <button
                type="button"
                onClick={() => handleTransferToProjects()}
                className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-xs animate-in fade-in"
                title="Внести погоджений проєкт через вікно «Додати проект» (Назва та Менеджер підтягнуться з розрахунку)"
              >
                <Briefcase className="w-3.5 h-3.5 text-blue-200" />
                <span>Передати в Проєкти</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleApproveAndTransferToProjects()}
                className="px-3 py-1.5 bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-800 border border-slate-300 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                title="Погодити проєкт та відкрити вікно «Додати проект»"
              >
                <Briefcase className="w-3.5 h-3.5 text-slate-500" />
                <span>Погодити та в Проєкти</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsExportModalOpen(true)}
              className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-xs"
              title="Створити Google Sheets файл у Google Drive з двома вкладками та передати в Cash Flow"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Створити Google Таблицю</span>
            </button>
          </div>
        </div>
      </div>

      {/* VIEW 1: ACTIVE 4-WINDOW 2x2 GRID WORKSPACE */}
      {activeSubView === 'calculator' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 lg:gap-5 items-stretch">
          {/* WINDOW 1 (Top-Left): Конструктор елемента (BOM Editor) */}
          <div className="h-full min-h-[500px]">
            <BomEditorWindow
              activeUnitName={activeUnit.name}
              items={activeUnit.items || []}
              coefficients={coefficients}
              onAddItem={handleAddItemToActiveUnit}
              onUpdateItem={handleUpdateItemInActiveUnit}
              onDeleteItem={handleDeleteItemInActiveUnit}
              onDuplicateItem={handleDuplicateItemInActiveUnit}
              onDropMaterial={handleDropMaterialToActiveUnit}
            />
          </div>

          {/* WINDOW 2 (Top-Right): Ієрархічний Каталог (Master Catalog) */}
          <div className="h-full min-h-[500px]">
            <CatalogWindow
              materials={materials}
              onOpenMasterData={() => setIsMasterDataOpen(true)}
              onAddMaterial={handleDropMaterialToActiveUnit}
            />
          </div>

          {/* WINDOW 3 (Bottom-Left): Структура замовлення (Project Tree) */}
          <div className="h-full min-h-[480px]">
            <ProjectTreeWindow
              units={units}
              activeUnitId={activeUnit.id}
              servicesConfig={servicesConfig}
              onSelectUnit={(unitId) => setActiveUnitId(unitId)}
              onAddUnit={handleAddUnit}
              onRenameUnit={handleRenameUnit}
              onDuplicateUnit={handleDuplicateUnit}
              onDeleteUnit={handleDeleteUnit}
              onUpdateServicesConfig={handleUpdateServicesConfig}
            />
          </div>

          {/* WINDOW 4 (Bottom-Right): Фінансовий підсумок & Експорт */}
          <div className="h-full min-h-[480px]">
            <FinancialSummaryWindow
              summary={summary}
              coefficients={coefficients}
              isApproved={isApproved}
              createdSheetUrl={createdSheetUrl}
              onToggleApproval={() => {
                const nextApproved = !isApproved;
                setIsApproved(nextApproved);
                showToast(
                  nextApproved
                    ? 'Проєкт погоджено!'
                    : 'Статус змінено на «На прорахунку»'
                );
              }}
              onUpdateCoefficients={handleUpdateCoefficients}
              onExportGoogleSheet={() => setIsExportModalOpen(true)}
              onPassToCashFlow={handleDirectPassToCashFlow}
              onTransferToProjects={() => handleTransferToProjects()}
              onCopyCommercialOffer={handleCopyCommercialOffer}
              onSaveCalculation={handleSaveCalculation}
            />
          </div>
        </div>
      )}

      {/* VIEW 2: SAVED SPECIFICATIONS & ESTIMATES HISTORY */}
      {activeSubView === 'saved' && (
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-200">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Збережені прорахунки та специфікації ({savedProjects.length})
              </h3>
              <p className="text-xs text-slate-500">
                Історія виконаних кошторисів проєктного відділу з прямим доступом до Google Таблиць
              </p>
            </div>

            <button
              type="button"
              onClick={() => setActiveSubView('calculator')}
              className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Новий розрахунок</span>
            </button>
          </div>

          {savedProjects.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-xs">
              Ще немає збережених кошторисів. Натисніть «Зберегти» у калькуляторі, щоб додати прорахунок сюди.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {savedProjects.map((p) => {
                const total = p.summary.clientTotalWithVat || p.summary.clientTotalWithoutVat;
                return (
                  <div
                    key={p.id}
                    className="p-4 rounded-xl border border-slate-200 hover:border-indigo-300 hover:shadow-md transition bg-slate-50/50 flex flex-col justify-between space-y-3"
                  >
                    <div>
                      <div className="flex items-center justify-between pb-2 border-b border-slate-200/80">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-mono font-bold text-xs text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">
                            № {p.projectNumber}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const nextApproved = !(p.isApproved || p.status === 'approved' || p.status === 'in_projects');
                              const updated = savedProjects.map((item) =>
                                item.id === p.id
                                  ? {
                                      ...item,
                                      isApproved: nextApproved,
                                      status: (nextApproved ? 'approved' : 'calculated') as any,
                                    }
                                  : item
                              );
                              setSavedProjects(updated);
                              CalculatorStorageService.saveProjects(updated);
                              showToast(nextApproved ? 'Проєкт позначено як «Погоджено»' : 'Статус: на розрахунку');
                            }}
                            className={`px-2 py-0.5 rounded text-[10px] font-bold border transition cursor-pointer ${
                              p.isApproved || p.status === 'approved' || p.status === 'in_projects'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                                : 'bg-amber-50 text-amber-700 border-amber-300'
                            }`}
                            title="Змінити статус погодження проєкту"
                          >
                            {p.isApproved || p.status === 'approved' || p.status === 'in_projects'
                              ? '🟢 Погоджений'
                              : '🟡 Розрахунок'}
                          </button>
                        </div>
                        <span className="text-[10px] text-slate-400">{p.date}</span>
                      </div>

                      <h4 className="font-bold text-sm text-slate-900 mt-2 line-clamp-1">
                        {p.projectName}
                      </h4>
                      <div className="text-xs text-slate-600 mt-0.5">{p.client}</div>

                      <div className="mt-3 pt-2 border-t border-slate-200/60 grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-[10px] text-slate-400 block">Собівартість:</span>
                          <span className="font-mono font-semibold text-slate-800">
                            {p.summary.totalPrimeCost.toLocaleString('uk-UA')} ₴
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 block">Ціна для клієнта:</span>
                          <span className="font-mono font-bold text-emerald-700">
                            {total.toLocaleString('uk-UA')} ₴
                          </span>
                        </div>
                      </div>

                      <div className="mt-2 text-[11px] text-slate-500 flex items-center justify-between">
                        <span>
                          {p.items?.length || p.units?.reduce((a, u) => a + (u.items?.length || 0), 0) || 0} конструктивних поз.
                        </span>
                        <span className="font-semibold text-indigo-600">
                          Маржа: {p.coefficients?.marginPercent ?? 35}%
                        </span>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-200/80 flex items-center justify-between gap-2 flex-wrap">
                      {p.googleSheetUrl ? (
                        <a
                          href={p.googleSheetUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] font-bold text-emerald-700 hover:underline flex items-center gap-1"
                        >
                          <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Google Таблиця</span>
                          <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      ) : (
                        <span className="text-[10px] text-slate-400">Таблицю не створено</span>
                      )}

                      <div className="flex items-center gap-1.5">
                        {/* Кнопка швидкої передачі в Проєкти для погодженого розрахунку */}
                        {(p.isApproved || p.status === 'approved' || p.status === 'in_projects') && (
                          <button
                            type="button"
                            onClick={() => handleTransferToProjects(p)}
                            className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-bold border border-blue-200 transition flex items-center gap-1 cursor-pointer"
                            title="Внести цей погоджений проєкт через вікно «Додати проект»"
                          >
                            <Briefcase className="w-3.5 h-3.5 text-blue-600" />
                            <span>В Проєкти</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleLoadSavedProject(p)}
                          className="px-2.5 py-1 bg-white hover:bg-indigo-50 hover:text-indigo-700 text-slate-700 rounded-lg text-xs font-bold border border-slate-200 transition cursor-pointer"
                        >
                          Відкрити
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteSavedProject(p.id)}
                          className="p-1 text-slate-400 hover:text-rose-600 rounded cursor-pointer"
                          title="Видалити"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Master Data Modal (Settings / Materials / Coefficients) */}
      <MasterDataModal
        isOpen={isMasterDataOpen}
        onClose={() => setIsMasterDataOpen(false)}
        materials={materials}
        coefficients={coefficients}
        onMaterialsChange={(mats) => setMaterials(mats)}
        onCoefficientsChange={(coeffs) => handleUpdateCoefficients(coeffs)}
      />

      {/* Export to Google Sheets & Drive Modal */}
      <ExportGoogleSheetModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        project={currentProject}
        accessToken={authState.accessToken}
        defaultDriveFolderId={driveFolderId}
        existingProjects={projects}
        sheetConfig={sheetConfig}
        onSuccess={handleExportSuccess}
        onOpenAuthModal={onOpenAuthModal}
        onNavigateToCashFlow={onNavigateToCashFlow}
      />

      {/* Add Project Modal populated from Calculator */}
      <AddProjectModal
        isOpen={isAddProjectModalOpen}
        onClose={() => setIsAddProjectModalOpen(false)}
        existingManagers={existingManagers}
        existingProjectNumbers={projects.map((p) => p.colA).filter(Boolean)}
        existingProjects={projects}
        sheetConfig={sheetConfig}
        accessToken={authState.accessToken}
        spreadsheetId={sheetConfig?.spreadsheetId || DEFAULT_PROJECTS_SPREADSHEET_ID}
        canWriteToSheets={canWriteToSheets}
        initialData={addProjectInitialData}
        onProjectAdded={async (targetRow, newProjectNumber) => {
          setIsApproved(true);
          const updatedProj: CalculationProject = {
            ...currentProject,
            projectNumber: newProjectNumber || currentProject.projectNumber,
            isApproved: true,
            status: 'in_projects',
            isInProjects: true,
            projectsRowNumber: targetRow,
          };
          CalculatorStorageService.saveProject(updatedProj);
          setSavedProjects(CalculatorStorageService.loadSavedProjects());

          if (onRefreshProjects) {
            try {
              await onRefreshProjects();
            } catch (err) {
              console.warn('Could not refresh projects after adding from calculator:', err);
            }
          }

          showToast(
            `Проєкт «${newProjectNumber || projectNumber} — ${projectName}» успішно внесено до переліку проєктів та Google Таблиць!`,
            'success'
          );
        }}
      />
    </div>
  );
};
