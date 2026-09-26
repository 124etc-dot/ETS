import {
  ConstructiveItem,
  GlassEdgeOption,
  GlassEdgeProcessingType,
  GLASS_EDGE_OPTIONS,
  MaterialItem,
} from '../types/calculator';

export interface GlassGeometry {
  widthMm: number;
  heightMm: number;
  count: number;
  areaSqm: number;
  perimeterM: number;
}

export interface GlassCostBreakdown {
  widthMm: number;
  heightMm: number;
  count: number;
  areaSqm: number;
  perimeterM: number;
  wasteFactor: number;
  effectiveQuantity: number;
  complexityFactor: number;
  pricePerSqm: number;
  edgeProcessingType: GlassEdgeProcessingType;
  edgeProcessingPricePerM: number;
  // Financial breakdown
  glassPureMaterialCost: number; // Площа * Ціна * Відхід * Складність
  edgeProcessingCost: number; // Периметр * Ціна обробки * Складність
  combinedTotalCost: number; // glassPureMaterialCost + edgeProcessingCost
  itemTotalCost: number; // totalCost for the glass item itself
  itemMaterialCost: number;
  clientPrice: number;
}

export class GlassCalculatorService {
  /**
   * Find edge processing option by ID
   */
  public static getEdgeOption(type?: GlassEdgeProcessingType): GlassEdgeOption {
    const found = GLASS_EDGE_OPTIONS.find((opt) => opt.id === type);
    return found || GLASS_EDGE_OPTIONS[0]; // defaults to 'none'
  }

  /**
   * Get edge processing price per linear meter (м.п.) pulled from materials price list if available
   */
  public static getEdgePriceFromMaterials(
    type?: GlassEdgeProcessingType,
    materials?: MaterialItem[]
  ): number {
    if (!type || type === 'none') return 0;
    if (materials && materials.length > 0) {
      const match = materials.find((m) => {
        if (m.category !== 'services') return false;
        const n = m.name.toLowerCase();
        if (type === 'grinding') {
          return n.includes('шліфування') && (n.includes('єврокромк') || n.includes('скл') || n.includes('фаск'));
        }
        if (type === 'polishing') {
          return n.includes('полірування') && (n.includes('єврокромк') || n.includes('скл') || n.includes('глянець'));
        }
        if (type === 'bevel_10') {
          return n.includes('фацет') && n.includes('10');
        }
        if (type === 'bevel_20') {
          return n.includes('фацет') && n.includes('20');
        }
        return false;
      });
      if (match && typeof match.basePrice === 'number' && match.basePrice > 0) {
        return match.basePrice;
      }
    }
    return this.getEdgeOption(type).pricePerM;
  }

  /**
   * Check if an item is a glass or mirror item
   */
  public static isGlassItem(item: {
    category?: string;
    materialName?: string;
    unit?: string;
    glassWidthMm?: number;
  }): boolean {
    if (item.glassWidthMm && item.glassWidthMm > 0) return true;
    if (item.category === 'glass_mirror') return true;
    const name = (item.materialName || '').toLowerCase();
    return name.includes('скло') || name.includes('дзеркал') || name.includes('glass') || name.includes('mirror');
  }

  /**
   * Calculate glass geometry:
   * 1. Площа заготовки (м²): (Ширина / 1000) * (Висота / 1000) * Кількість
   * 2. Периметр обробки (м.п.): ((Ширина + Висота) * 2 / 1000) * Кількість
   */
  public static calculateGeometry(
    widthMm: number,
    heightMm: number,
    count: number = 1
  ): GlassGeometry {
    const w = Math.max(1, Number(widthMm) || 0);
    const h = Math.max(1, Number(heightMm) || 0);
    const cnt = Math.max(1, Math.round(Number(count) || 1));

    // Площа (м²): (Ш/1000) * (В/1000) * Кількість
    const rawArea = (w / 1000) * (h / 1000) * cnt;
    const areaSqm = parseFloat(Number(rawArea.toFixed(4)).toString());

    // Периметр (м.п.): ((Ш + В) * 2 / 1000) * Кількість
    const rawPerimeter = (((w + h) * 2) / 1000) * cnt;
    const perimeterM = parseFloat(Number(rawPerimeter.toFixed(3)).toString());

    return {
      widthMm: w,
      heightMm: h,
      count: cnt,
      areaSqm,
      perimeterM,
    };
  }

  /**
   * Full cost calculation according to the formula:
   * 1. Вартість матеріалу (скла): Площа (м²) * Ціна скла за м² * Коефіцієнт відходу * Коефіцієнт складності
   * 2. Вартість обробки кромки: Периметр (м.п.) * Ціна обробки за м.п. * Коефіцієнт складності
   * 3. Загальна собівартість = Вартість матеріалу + Вартість обробки
   */
  public static calculateCostBreakdown(params: {
    widthMm: number;
    heightMm: number;
    count: number;
    pricePerSqm: number;
    wasteFactor: number;
    complexityFactor: number;
    edgeProcessingType: GlassEdgeProcessingType;
    customEdgePricePerM?: number;
    marginPercent: number;
    addProcessingAsSeparateRow?: boolean;
  }): GlassCostBreakdown {
    const geom = this.calculateGeometry(params.widthMm, params.heightMm, params.count);
    const wFactor = Math.max(1, Number(params.wasteFactor) || 1.12);
    const cFactor = Math.max(1, Number(params.complexityFactor) || 1.0);
    const priceSqm = Math.max(0, Number(params.pricePerSqm) || 0);

    const edgeOption = this.getEdgeOption(params.edgeProcessingType);
    let edgePricePerM = edgeOption.pricePerM;
    if (params.edgeProcessingType === 'custom' && params.customEdgePricePerM !== undefined) {
      edgePricePerM = Math.max(0, Number(params.customEdgePricePerM) || 0);
    } else if (params.customEdgePricePerM !== undefined && params.customEdgePricePerM > 0) {
      edgePricePerM = params.customEdgePricePerM;
    }

    // Effective material quantity (with waste factor)
    const effectiveQuantity = parseFloat(Number((geom.areaSqm * wFactor).toFixed(4)).toString());

    // 1. Вартість матеріалу (скла): Площа (м²) * Ціна скла за м² * Коефіцієнт відходу * Коефіцієнт складності
    const glassPureMaterialCost = parseFloat(
      (effectiveQuantity * priceSqm * cFactor).toFixed(2)
    );

    // 2. Вартість обробки кромки: Периметр (м.п.) * Ціна обробки за м.п. * Коефіцієнт складності
    const edgeProcessingCost = parseFloat(
      (geom.perimeterM * edgePricePerM * cFactor).toFixed(2)
    );

    // 3. Загальна собівартість
    const combinedTotalCost = parseFloat(
      (glassPureMaterialCost + edgeProcessingCost).toFixed(2)
    );

    const isSeparate = Boolean(params.addProcessingAsSeparateRow);

    // Item-level totalCost (if separate row, the glass item only holds glass material cost)
    const itemTotalCost = isSeparate ? glassPureMaterialCost : combinedTotalCost;

    // Base cost before complexity
    const itemMaterialCost = isSeparate
      ? parseFloat((effectiveQuantity * priceSqm).toFixed(2))
      : parseFloat(((effectiveQuantity * priceSqm) + (geom.perimeterM * edgePricePerM)).toFixed(2));

    // Client price with margin: Cost / (1 - margin/100)
    const clampedMargin = Math.min(95, Math.max(0, params.marginPercent || 0));
    const marginMultiplier = clampedMargin >= 95 ? 2.5 : 1 / (1 - clampedMargin / 100);
    const clientPrice = parseFloat((itemTotalCost * marginMultiplier).toFixed(2));

    return {
      widthMm: geom.widthMm,
      heightMm: geom.heightMm,
      count: geom.count,
      areaSqm: geom.areaSqm,
      perimeterM: geom.perimeterM,
      wasteFactor: wFactor,
      effectiveQuantity,
      complexityFactor: cFactor,
      pricePerSqm: priceSqm,
      edgeProcessingType: params.edgeProcessingType,
      edgeProcessingPricePerM: edgePricePerM,
      glassPureMaterialCost,
      edgeProcessingCost,
      combinedTotalCost,
      itemTotalCost,
      itemMaterialCost,
      clientPrice,
    };
  }

  /**
   * Apply glass calculation directly onto a ConstructiveItem
   */
  public static applyGlassCalculationToItem(
    item: ConstructiveItem,
    glassParams: {
      widthMm: number;
      heightMm: number;
      count: number;
      edgeProcessingType?: GlassEdgeProcessingType;
      edgeProcessingPricePerM?: number;
      addProcessingAsSeparateRow?: boolean;
    },
    marginPercent: number
  ): {
    updatedGlassItem: ConstructiveItem;
    linkedProcessingItem: ConstructiveItem | null;
  } {
    const edgeType = glassParams.edgeProcessingType || item.edgeProcessingType || 'none';
    const edgePrice =
      glassParams.edgeProcessingPricePerM !== undefined
        ? glassParams.edgeProcessingPricePerM
        : item.edgeProcessingPricePerM !== undefined
        ? item.edgeProcessingPricePerM
        : this.getEdgeOption(edgeType).pricePerM;

    const isSeparate =
      glassParams.addProcessingAsSeparateRow !== undefined
        ? glassParams.addProcessingAsSeparateRow
        : Boolean(item.addProcessingAsSeparateRow);

    const breakdown = this.calculateCostBreakdown({
      widthMm: glassParams.widthMm,
      heightMm: glassParams.heightMm,
      count: glassParams.count,
      pricePerSqm: item.basePrice,
      wasteFactor: item.wasteFactor,
      complexityFactor: item.complexityFactor,
      edgeProcessingType: edgeType,
      customEdgePricePerM: edgePrice,
      marginPercent,
      addProcessingAsSeparateRow: isSeparate,
    });

    const linkedId = item.linkedProcessingItemId || `serv_edge_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const updatedGlassItem: ConstructiveItem = {
      ...item,
      // Системне поле «Кількість» для скла автоматично заповнюється обчисленою площею в м²
      quantity: breakdown.areaSqm,
      unit: 'м²',
      effectiveQuantity: breakdown.effectiveQuantity,
      materialCost: breakdown.itemMaterialCost,
      totalCost: breakdown.itemTotalCost,
      clientPrice: breakdown.clientPrice,
      // Glass specific fields
      glassWidthMm: breakdown.widthMm,
      glassHeightMm: breakdown.heightMm,
      glassCount: breakdown.count,
      glassAreaSqm: breakdown.areaSqm,
      glassPerimeterM: breakdown.perimeterM,
      edgeProcessingType: breakdown.edgeProcessingType,
      edgeProcessingPricePerM: breakdown.edgeProcessingPricePerM,
      edgeProcessingCost: breakdown.edgeProcessingCost,
      glassPureMaterialCost: breakdown.glassPureMaterialCost,
      addProcessingAsSeparateRow: isSeparate,
      linkedProcessingItemId: isSeparate && edgeType !== 'none' ? linkedId : undefined,
    };

    let linkedProcessingItem: ConstructiveItem | null = null;
    if (isSeparate && edgeType !== 'none' && breakdown.perimeterM > 0) {
      const edgeOption = this.getEdgeOption(edgeType);
      const edgeCost = breakdown.edgeProcessingCost;
      const clampedMargin = Math.min(95, Math.max(0, marginPercent || 0));
      const marginMultiplier = clampedMargin >= 95 ? 2.5 : 1 / (1 - clampedMargin / 100);
      const edgeClientPrice = parseFloat((edgeCost * marginMultiplier).toFixed(2));

      linkedProcessingItem = {
        id: linkedId,
        constructive: `${edgeOption.name} периметра (${breakdown.widthMm}×${breakdown.heightMm} мм, ${breakdown.count} шт)`,
        materialId: `serv_edge_${edgeType}`,
        materialName: `Послуга: ${edgeOption.name}`,
        category: 'services',
        unit: 'м.п.',
        quantity: breakdown.perimeterM,
        basePrice: breakdown.edgeProcessingPricePerM,
        wasteFactor: 1.0,
        effectiveQuantity: breakdown.perimeterM,
        materialCost: parseFloat((breakdown.perimeterM * breakdown.edgeProcessingPricePerM).toFixed(2)),
        complexityFactor: item.complexityFactor,
        totalCost: edgeCost,
        clientPrice: edgeClientPrice,
        isGlassProcessingRow: true,
        parentGlassItemId: item.id,
        notes: `Пов'язана обробка для «${item.constructive}» (${breakdown.widthMm}×${breakdown.heightMm} мм, ${breakdown.count} шт)`,
      };
    }

    return {
      updatedGlassItem,
      linkedProcessingItem,
    };
  }
}
