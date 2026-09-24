import {
  MaterialCategory,
  MaterialItem,
  CalculatorCoefficients,
  ConstructiveItem,
  CalculationSummary,
  CalculationProject,
} from '../types/calculator';
import {
  DEFAULT_MATERIALS,
  DEFAULT_COEFFICIENTS,
  DEFAULT_CATEGORY_WASTE_FACTORS,
} from '../data/calculatorDefaults';

const STORAGE_KEYS = {
  MATERIALS: 'ets_calc_materials_v1',
  COEFFICIENTS: 'ets_calc_coefficients_v1',
  SAVED_PROJECTS: 'ets_calc_saved_projects_v1',
  CURRENT_DRAFT: 'ets_calc_current_draft_v1',
};

export class CalculatorStorageService {
  /**
   * Load materials catalog from localStorage or fallback to default
   */
  public static loadMaterials(): MaterialItem[] {
    if (typeof window === 'undefined') return [...DEFAULT_MATERIALS];
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.MATERIALS);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (e) {
      console.error('Failed to load materials from localStorage', e);
    }
    return [...DEFAULT_MATERIALS];
  }

  /**
   * Save materials catalog
   */
  public static saveMaterials(materials: MaterialItem[]): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEYS.MATERIALS, JSON.stringify(materials));
    } catch (e) {
      console.error('Failed to save materials to localStorage', e);
    }
  }

  /**
   * Reset materials to initial defaults
   */
  public static resetMaterialsToDefault(): MaterialItem[] {
    this.saveMaterials(DEFAULT_MATERIALS);
    return [...DEFAULT_MATERIALS];
  }

  /**
   * Load coefficients settings
   */
  public static loadCoefficients(): CalculatorCoefficients {
    if (typeof window === 'undefined') return { ...DEFAULT_COEFFICIENTS };
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.COEFFICIENTS);
      if (stored) {
        const parsed = JSON.parse(stored);
        return {
          wasteFactorsByCategory: {
            ...DEFAULT_CATEGORY_WASTE_FACTORS,
            ...(parsed.wasteFactorsByCategory || {}),
          },
          complexityMultiplier: Number(parsed.complexityMultiplier) || DEFAULT_COEFFICIENTS.complexityMultiplier,
          marginPercent: Number(parsed.marginPercent) || DEFAULT_COEFFICIENTS.marginPercent,
          overheadPercent: Number(parsed.overheadPercent) ?? DEFAULT_COEFFICIENTS.overheadPercent,
          vatRatePercent: Number(parsed.vatRatePercent) ?? DEFAULT_COEFFICIENTS.vatRatePercent,
        };
      }
    } catch (e) {
      console.error('Failed to load coefficients from localStorage', e);
    }
    return { ...DEFAULT_COEFFICIENTS };
  }

  /**
   * Save coefficients settings
   */
  public static saveCoefficients(coeffs: CalculatorCoefficients): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEYS.COEFFICIENTS, JSON.stringify(coeffs));
    } catch (e) {
      console.error('Failed to save coefficients to localStorage', e);
    }
  }

  /**
   * Load all saved calculation specifications
   */
  public static loadSavedProjects(): CalculationProject[] {
    if (typeof window === 'undefined') return [];
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.SAVED_PROJECTS);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {
      console.error('Failed to load saved projects from localStorage', e);
    }
    return [];
  }

  /**
   * Save or update calculation project
   */
  public static saveProject(project: CalculationProject): void {
    if (typeof window === 'undefined') return;
    try {
      const existing = this.loadSavedProjects();
      const idx = existing.findIndex((p) => p.id === project.id);
      const updated = [...existing];
      if (idx >= 0) {
        updated[idx] = { ...project, updatedAt: new Date().toISOString() };
      } else {
        updated.unshift({ ...project, updatedAt: new Date().toISOString() });
      }
      localStorage.setItem(STORAGE_KEYS.SAVED_PROJECTS, JSON.stringify(updated));
    } catch (e) {
      console.error('Failed to save project to localStorage', e);
    }
  }

  /**
   * Save entire list of projects
   */
  public static saveProjects(projects: CalculationProject[]): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEYS.SAVED_PROJECTS, JSON.stringify(projects));
    } catch (e) {
      console.error('Failed to save projects to localStorage', e);
    }
  }

  /**
   * Delete calculation project
   */
  public static deleteProject(id: string): void {
    if (typeof window === 'undefined') return;
    try {
      const existing = this.loadSavedProjects();
      const filtered = existing.filter((p) => p.id !== id);
      localStorage.setItem(STORAGE_KEYS.SAVED_PROJECTS, JSON.stringify(filtered));
    } catch (e) {
      console.error('Failed to delete project from localStorage', e);
    }
  }

  /**
   * Save draft calculation
   */
  public static saveDraft(project: Partial<CalculationProject>): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEYS.CURRENT_DRAFT, JSON.stringify(project));
    } catch {}
  }

  /**
   * Load draft calculation
   */
  public static loadDraft(): Partial<CalculationProject> | null {
    if (typeof window === 'undefined') return null;
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.CURRENT_DRAFT);
      if (raw) return JSON.parse(raw);
    } catch {}
    return null;
  }

  /**
   * Real-time calculation of a single constructive item
   */
  public static recalculateItem(
    item: Omit<ConstructiveItem, 'effectiveQuantity' | 'materialCost' | 'totalCost' | 'clientPrice'>,
    globalComplexity: number,
    marginPercent: number
  ): ConstructiveItem {
    const qty = Math.max(0, Number(item.quantity) || 0);
    const wasteFactor = Math.max(1, Number(item.wasteFactor) || 1);
    const price = Math.max(0, Number(item.basePrice) || 0);
    const complexity = Math.max(1, Number(item.complexityFactor) || globalComplexity || 1);

    // If it's services (labour/machine work), waste is not applied to hours
    const isService = item.category === 'services';
    const effectiveQuantity = isService ? qty : Math.round(qty * wasteFactor * 1000) / 1000;
    const materialCost = Math.round(effectiveQuantity * price * 100) / 100;
    const totalCost = Math.round(materialCost * complexity * 100) / 100;

    // Margin calculation: Price = Cost / (1 - margin/100)
    // If margin is 35%, price is cost / 0.65
    const clampedMargin = Math.min(95, Math.max(0, marginPercent || 0));
    const marginMultiplier = clampedMargin >= 95 ? 2.5 : 1 / (1 - clampedMargin / 100);
    const clientPrice = Math.round(totalCost * marginMultiplier * 100) / 100;

    return {
      ...item,
      quantity: qty,
      wasteFactor,
      basePrice: price,
      effectiveQuantity,
      materialCost,
      complexityFactor: complexity,
      totalCost,
      clientPrice,
    };
  }

  /**
   * Real-time calculation of overall project summary
   */
  public static calculateSummary(
    items: ConstructiveItem[],
    coefficients: CalculatorCoefficients
  ): CalculationSummary {
    let rawMaterialCost = 0;
    let wasteAddedCost = 0;
    let materialsSubtotal = 0;
    let servicesSubtotal = 0;
    let complexityAddedCost = 0;
    let baseProductionCost = 0;

    items.forEach((item) => {
      const isService = item.category === 'services';
      const cleanRawCost = Math.round(item.quantity * item.basePrice * 100) / 100;
      const wasteDiff = isService ? 0 : Math.max(0, item.materialCost - cleanRawCost);

      if (isService) {
        servicesSubtotal += item.materialCost;
      } else {
        rawMaterialCost += cleanRawCost;
        wasteAddedCost += wasteDiff;
        materialsSubtotal += item.materialCost;
      }

      const complexityDiff = Math.max(0, item.totalCost - item.materialCost);
      complexityAddedCost += complexityDiff;
      baseProductionCost += item.totalCost;
    });

    const overheadRate = Math.max(0, Number(coefficients.overheadPercent) || 0) / 100;
    const overheadCost = Math.round(baseProductionCost * overheadRate * 100) / 100;
    const totalPrimeCost = Math.round((baseProductionCost + overheadCost) * 100) / 100;

    const clampedMargin = Math.min(95, Math.max(0, Number(coefficients.marginPercent) || 0));
    const marginDivisor = clampedMargin >= 95 ? 0.05 : 1 - clampedMargin / 100;
    const clientTotalWithoutVat = Math.round((totalPrimeCost / marginDivisor) * 100) / 100;
    const marginAmount = Math.round((clientTotalWithoutVat - totalPrimeCost) * 100) / 100;

    const vatRate = Math.max(0, Number(coefficients.vatRatePercent) || 0) / 100;
    const vatAmount = Math.round(clientTotalWithoutVat * vatRate * 100) / 100;
    const clientTotalWithVat = Math.round((clientTotalWithoutVat + vatAmount) * 100) / 100;

    const effectiveMarginPercent = clientTotalWithoutVat > 0
      ? Math.round((marginAmount / clientTotalWithoutVat) * 1000) / 10
      : clampedMargin;

    return {
      rawMaterialCost: Math.round(rawMaterialCost * 100) / 100,
      wasteAddedCost: Math.round(wasteAddedCost * 100) / 100,
      materialsSubtotal: Math.round(materialsSubtotal * 100) / 100,
      servicesSubtotal: Math.round(servicesSubtotal * 100) / 100,
      complexityAddedCost: Math.round(complexityAddedCost * 100) / 100,
      baseProductionCost: Math.round(baseProductionCost * 100) / 100,
      overheadCost,
      totalPrimeCost,
      marginAmount,
      effectiveMarginPercent,
      clientTotalWithoutVat,
      vatAmount,
      clientTotalWithVat,
      itemsCount: items.length,
    };
  }
}
