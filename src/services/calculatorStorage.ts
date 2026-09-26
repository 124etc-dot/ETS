import {
  MaterialCategory,
  MaterialItem,
  CalculatorCoefficients,
  ConstructiveItem,
  CalculationSummary,
  CalculationProject,
  LdspItem,
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
   * Load materials catalog from database API (/api/materials) with localStorage fallback
   */
  public static async loadMaterialsFromApi(): Promise<MaterialItem[]> {
    try {
      const res = await fetch('/api/materials');
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.materials) && data.materials.length > 0) {
          this.saveMaterials(data.materials, false);
          return data.materials;
        }
      }
    } catch (e) {
      console.warn('Could not fetch materials from /api/materials, using local fallback:', e);
    }
    return this.loadMaterials();
  }

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
          // Ensure all default materials (specifically 'services' items) are present
          const existingIds = new Set(parsed.map((p: MaterialItem) => p.id));
          const missingDefaults = DEFAULT_MATERIALS.filter((dm) => !existingIds.has(dm.id));
          if (missingDefaults.length > 0) {
            const merged = [...parsed, ...missingDefaults];
            this.saveMaterials(merged, false);
            return merged;
          }
          return parsed;
        }
      }
    } catch (e) {
      console.error('Failed to load materials from localStorage', e);
    }
    return [...DEFAULT_MATERIALS];
  }

  /**
   * Save materials catalog to localStorage and sync to database API
   */
  public static saveMaterials(materials: MaterialItem[], syncToApi: boolean = true): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEYS.MATERIALS, JSON.stringify(materials));
    } catch (e) {
      console.error('Failed to save materials to localStorage', e);
    }

    if (syncToApi) {
      this.saveMaterialsToApi(materials).catch((err) =>
        console.warn('Background save to /api/materials failed:', err)
      );
    }
  }

  /**
   * Sync materials to database API (/api/materials)
   */
  public static async saveMaterialsToApi(materials: MaterialItem[]): Promise<boolean> {
    try {
      const res = await fetch('/api/materials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ materials }),
      });
      if (res.ok) {
        this.notifyMaterialsChanged(materials);
        return true;
      }
    } catch (err) {
      console.warn('saveMaterialsToApi error:', err);
    }
    return false;
  }

  /**
   * Batch import price items to database API (/api/materials/batch)
   */
  public static async importPriceItemsApi(items: any[], supplier?: string): Promise<MaterialItem[] | null> {
    try {
      const res = await fetch('/api/materials/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, supplier }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.materials)) {
          this.saveMaterials(data.materials, false);
          this.notifyMaterialsChanged(data.materials);
          return data.materials;
        }
      }
    } catch (err) {
      console.warn('importPriceItemsApi error:', err);
    }
    return null;
  }

  /**
   * Import and upsert LDSP items from Excel price list
   * Rule: name is unique key. Updates price_sheet and price_sqm if exists, else creates new.
   */
  public static async importLdspItemsApi(
    items: LdspItem[],
    supplier: string = 'KRONAS'
  ): Promise<{
    updatedMaterials: MaterialItem[];
    addedCount: number;
    updatedCount: number;
  }> {
    try {
      const res = await fetch('/api/materials/ldsp/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, supplier }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.materials)) {
          this.saveMaterials(data.materials, false);
          this.notifyMaterialsChanged(data.materials);
          return {
            updatedMaterials: data.materials,
            addedCount: data.addedCount || 0,
            updatedCount: data.updatedCount || 0,
          };
        }
      }
    } catch (err) {
      console.warn('importLdspItemsApi API failed, running local upsert:', err);
    }

    // Local fallback if API is unreachable
    const currentMaterials = this.loadMaterials();
    const materialsList = [...currentMaterials];
    let addedCount = 0;
    let updatedCount = 0;
    const nowIso = new Date().toISOString();

    for (const item of items) {
      const itemBrand = item.brand && !/^\d+$/.test(item.brand) ? item.brand : 'ДСП';
      const existingIdx = materialsList.findIndex(
        (m) => m.name.trim().toLowerCase() === item.name.trim().toLowerCase()
      );

      if (existingIdx !== -1) {
        const existing = materialsList[existingIdx];
        materialsList[existingIdx] = {
          ...existing,
          price_sheet: item.price_sheet,
          price_sqm: item.price_sqm,
          sheet_area_sqm: item.sheet_area_sqm,
          basePrice: item.price_sqm,
          brand: itemBrand,
          groupHeader: itemBrand,
          supplier: supplier || existing.supplier || 'KRONAS',
          unit: item.unit || existing.unit || 'м²',
          updatedAt: nowIso,
        };
        updatedCount++;
      } else {
        const newItem: MaterialItem = {
          id: `mat_ldsp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          name: item.name,
          category: 'plate_wood',
          parentCategory: 'Плитні матеріали',
          subcategory: 'ДСП',
          groupHeader: itemBrand,
          brand: itemBrand,
          unit: item.unit || 'м²',
          basePrice: item.price_sqm,
          price_sheet: item.price_sheet,
          price_sqm: item.price_sqm,
          sheet_area_sqm: item.sheet_area_sqm,
          defaultWasteFactor: 1.18,
          supplier: supplier || 'KRONAS',
          updatedAt: nowIso,
        };
        materialsList.push(newItem);
        addedCount++;
      }
    }

    this.saveMaterials(materialsList, true);
    this.notifyMaterialsChanged(materialsList);

    return {
      updatedMaterials: materialsList,
      addedCount,
      updatedCount,
    };
  }

  /**
   * Notify components that materials were revalidated / updated
   */
  public static notifyMaterialsChanged(materials: MaterialItem[]): void {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('materials-revalidated', { detail: materials }));
      window.dispatchEvent(new CustomEvent('materials-updated', { detail: materials }));
    }
  }

  /**
   * Reset materials to initial defaults
   */
  public static async resetMaterialsToDefault(): Promise<MaterialItem[]> {
    try {
      await fetch('/api/materials/reset', { method: 'POST' });
    } catch (e) {
      console.warn('Reset API failed, resetting locally:', e);
    }
    this.saveMaterials(DEFAULT_MATERIALS, false);
    this.notifyMaterialsChanged(DEFAULT_MATERIALS);
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
    const rawQty = Math.max(0, Number(item.quantity) || 0);
    const qty = parseFloat((Math.round(rawQty * 10000) / 10000).toFixed(4));

    const isService = item.category === 'services';
    const rawWaste = isService ? 1.0 : Math.max(1, Number(item.wasteFactor) || 1);
    const wasteFactor = isService ? 1.0 : parseFloat((Math.round(rawWaste * 1000) / 1000).toFixed(3));

    const rawPrice = Math.max(0, Number(item.basePrice) || 0);
    const price = parseFloat((Math.round(rawPrice * 100) / 100).toFixed(2));

    const rawComplexity = Math.max(1, Number(item.complexityFactor) || globalComplexity || 1);
    const complexity = parseFloat((Math.round(rawComplexity * 100) / 100).toFixed(2));

    // If it's services (labour/machine work), waste is not applied to hours
    const effectiveQuantity = isService ? qty : parseFloat((Math.round(qty * wasteFactor * 10000) / 10000).toFixed(4));
    const materialCost = parseFloat((Math.round(effectiveQuantity * price * 100) / 100).toFixed(2));
    const totalCost = parseFloat((Math.round(materialCost * complexity * 100) / 100).toFixed(2));

    // Check if this item is configured as a glass item with geometry (Width, Height, Count)
    const hasGlassGeometry =
      Boolean(item.glassWidthMm && item.glassWidthMm > 0) &&
      Boolean(item.glassHeightMm && item.glassHeightMm > 0) &&
      Boolean(item.glassCount && item.glassCount > 0);

    let finalQty = qty;
    let finalEffQty = effectiveQuantity;
    let finalMatCost = materialCost;
    let finalTotalCost = totalCost;
    let glassArea = item.glassAreaSqm;
    let glassPerimeter = item.glassPerimeterM;
    let edgeCost = item.edgeProcessingCost;
    let glassMatCost = item.glassPureMaterialCost;

    if (hasGlassGeometry) {
      const w = item.glassWidthMm!;
      const h = item.glassHeightMm!;
      const cnt = item.glassCount!;

      // 1. Площа заготовки (м²): (Ш/1000) * (В/1000) * Кількість
      glassArea = parseFloat(Number(((w / 1000) * (h / 1000) * cnt).toFixed(4)).toString());
      finalQty = glassArea; // Системне поле «Кількість» для скла автоматично заповнюється обчисленою площею в м²

      // 2. Периметр обробки (м.п.): ((Ш + В) * 2 / 1000) * Кількість
      glassPerimeter = parseFloat(Number((((w + h) * 2 / 1000) * cnt).toFixed(3)).toString());

      // 3. Собівартість
      finalEffQty = parseFloat(Number((finalQty * wasteFactor).toFixed(4)).toString());
      glassMatCost = parseFloat((finalEffQty * price * complexity).toFixed(2));

      const edgePrice = Math.max(0, Number(item.edgeProcessingPricePerM) || 0);
      edgeCost = parseFloat((glassPerimeter * edgePrice * complexity).toFixed(2));

      const isSeparateRow = Boolean(item.addProcessingAsSeparateRow);
      if (isSeparateRow) {
        finalTotalCost = glassMatCost;
        finalMatCost = parseFloat((finalEffQty * price).toFixed(2));
      } else {
        finalTotalCost = parseFloat((glassMatCost + edgeCost).toFixed(2));
        finalMatCost = parseFloat(((finalEffQty * price) + (glassPerimeter * edgePrice)).toFixed(2));
      }
    }

    // Margin calculation: Price = Cost / (1 - margin/100)
    // If margin is 35%, price is cost / 0.65
    const clampedMargin = Math.min(95, Math.max(0, marginPercent || 0));
    const marginMultiplier = clampedMargin >= 95 ? 2.5 : 1 / (1 - clampedMargin / 100);
    const clientPrice = parseFloat((Math.round(finalTotalCost * marginMultiplier * 100) / 100).toFixed(2));

    return {
      ...item,
      quantity: finalQty,
      wasteFactor,
      basePrice: price,
      effectiveQuantity: finalEffQty,
      materialCost: finalMatCost,
      complexityFactor: complexity,
      totalCost: finalTotalCost,
      clientPrice,
      glassAreaSqm: hasGlassGeometry ? glassArea : item.glassAreaSqm,
      glassPerimeterM: hasGlassGeometry ? glassPerimeter : item.glassPerimeterM,
      glassPureMaterialCost: hasGlassGeometry ? glassMatCost : item.glassPureMaterialCost,
      edgeProcessingCost: hasGlassGeometry ? edgeCost : item.edgeProcessingCost,
    };
  }

  /**
   * Real-time calculation of overall project summary
   */
  public static calculateSummary(
    items: ConstructiveItem[],
    coefficients: CalculatorCoefficients,
    deliveryCost: number = 0,
    installationCost: number = 0
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
    const logisticsAndInstallation = (deliveryCost || 0) + (installationCost || 0);
    const clientTotalWithoutVat = Math.round(((totalPrimeCost / marginDivisor) + logisticsAndInstallation) * 100) / 100;
    const marginAmount = Math.round((clientTotalWithoutVat - (totalPrimeCost + logisticsAndInstallation)) * 100) / 100;

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
      deliveryCost,
      installationCost,
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
