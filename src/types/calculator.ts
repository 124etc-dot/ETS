export type MaterialCategory =
  | 'metal_profile'
  | 'sheet_metal'
  | 'plate_wood'
  | 'glass_mirror'
  | 'hardware'
  | 'coating'
  | 'lighting'
  | 'services';

export interface CategoryInfo {
  id: MaterialCategory;
  name: string;
  iconName: string;
  description: string;
  defaultUnit: string;
  defaultWastePercent: number; // e.g. 10 for 10% waste -> factor 1.10
}

export const MATERIAL_CATEGORIES: Record<MaterialCategory, CategoryInfo> = {
  metal_profile: {
    id: 'metal_profile',
    name: 'Металопрокат та профіль',
    iconName: 'Box',
    description: 'Профільні труби, кутники, смуги, алюмінієвий бокс, нержавійка',
    defaultUnit: 'м.п.',
    defaultWastePercent: 10,
  },
  sheet_metal: {
    id: 'sheet_metal',
    name: 'Листовий метал',
    iconName: 'Layers',
    description: 'Сталь г/к, х/к, нержавійка сатин/дзеркало, лист алюмінію',
    defaultUnit: 'м²',
    defaultWastePercent: 15,
  },
  plate_wood: {
    id: 'plate_wood',
    name: 'Дерево та плитні матеріали',
    iconName: 'Grid',
    description: 'ДСП Egger/Kronospan, МДФ під фарбування, шпоновані плити, фанера, масив',
    defaultUnit: 'м²',
    defaultWastePercent: 18,
  },
  glass_mirror: {
    id: 'glass_mirror',
    name: 'Скло та дзеркало',
    iconName: 'Sparkles',
    description: 'Гартоване скло, триплекс, Optiwhite, тоноване графіт/бронза, дзеркала',
    defaultUnit: 'м²',
    defaultWastePercent: 12,
  },
  hardware: {
    id: 'hardware',
    name: 'Фурнітура та кріплення',
    iconName: 'Wrench',
    description: 'Петлі, висувні системи, замки, метизи, регульовані опори, анкери',
    defaultUnit: 'шт',
    defaultWastePercent: 3,
  },
  coating: {
    id: 'coating',
    name: 'Покриття та фарбування',
    iconName: 'Palette',
    description: 'Порошкове фарбування RAL, ґрунтовка, лак, анодування',
    defaultUnit: 'м²',
    defaultWastePercent: 10,
  },
  lighting: {
    id: 'lighting',
    name: 'Електрика та LED',
    iconName: 'Zap',
    description: 'LED-стрічки COB/SMD, блоки живлення, алюмінієві профілі, розсіювачі',
    defaultUnit: 'м.п.',
    defaultWastePercent: 5,
  },
  services: {
    id: 'services',
    name: 'Роботи та послуги',
    iconName: 'Hammer',
    description: 'Лазерна порізка, гнуття ЧПК, зварювання, збирання в цеху, монтаж',
    defaultUnit: 'год',
    defaultWastePercent: 0,
  },
};

export interface MaterialItem {
  id: string;
  name: string;
  category: MaterialCategory;
  subcategory?: string; // e.g. "Чорний метал", "Нержавіючий", "Алюміній", "ДСП", "МДФ", "Фанера", "Скло", "Дзеркало", "Фурнітура", "Електрика", "Порізка", "Фарбування", "Гнуття"
  unit: string;
  basePrice: number; // UAH
  defaultWasteFactor: number; // e.g. 1.10 = +10%
  supplier?: string;
  notes?: string;
  updatedAt: string;
  // Hierarchical price list fields
  groupHeader?: string; // Підкатегорія з рядка-розділювача (напр. "Арматура мірної довжини", "Труба профільна")
  parentCategory?: string; // Головна гілка довідника (напр. "Металопрокат")
  cuttingPrice?: number; // Вартість різки за 1 різ / м.п. (грн)
  sourceArticle?: string; // Артикул з прайсу (довідково)
  tonPrice?: number; // Ціна за тонну (довідково)
}

export interface ParsedPriceItem {
  name: string;
  category: MaterialCategory;
  parentCategory: string; // "Металопрокат"
  subcategory: string; // "Чорний металопрокат"
  groupHeader: string; // "Арматура мірної довжини"
  unit: string; // "м.п." або "м²"
  basePrice: number; // Ціна роздрібна з ПДВ за 1 м / лист
  cuttingPrice?: number; // Вартість різки (грн)
  sourceArticle?: string;
  tonPrice?: number;
  isExisting?: boolean;
  existingId?: string;
  oldPrice?: number;
}

export interface PriceParseResult {
  fileName: string;
  supplier: string;
  mainCategory: string;
  totalRowsRead: number;
  recognizedItems: ParsedPriceItem[];
  groupHeadersFound: string[];
  newItemsCount: number;
  updatedItemsCount: number;
  errors: string[];
}

export interface CalculatorCoefficients {
  wasteFactorsByCategory: Record<MaterialCategory, number>; // e.g. { metal_profile: 1.10, ... }
  complexityMultiplier: number; // e.g. 1.15
  marginPercent: number; // e.g. 35%
  overheadPercent: number; // e.g. 5% загальновиробничі витрати
  vatRatePercent: number; // e.g. 20% or 0%
}

export interface ConstructiveItem {
  id: string;
  constructive: string; // Назва конструктиву / вузла (напр. "Опорний каркас", "Полиця МДФ")
  materialId: string;
  materialName: string;
  category: MaterialCategory;
  unit: string;
  quantity: number; // За кресленнями
  basePrice: number; // Базова закупівельна ціна (грн)
  wasteFactor: number; // Коефіцієнт технологічного відходу (напр. 1.15)
  effectiveQuantity: number; // quantity * wasteFactor
  materialCost: number; // effectiveQuantity * basePrice
  complexityFactor: number; // Індивідуальний або загальний коеф. складності
  totalCost: number; // materialCost * complexityFactor
  clientPrice: number; // Розрахункова вартість для клієнта (з маржею)
  notes?: string;
}

export interface ProjectAssemblyUnit {
  id: string;
  name: string; // e.g. "Острівний стелаж 2000х1200", "Пристінна вітрина"
  quantity: number; // e.g. 1
  items: ConstructiveItem[];
  subtotalCost?: number;
  clientPrice?: number;
}

export interface ProjectServicesConfig {
  delivery: {
    enabled: boolean;
    name: string;
    trips: number;
    ratePerTrip: number;
    notes?: string;
  };
  installation: {
    enabled: boolean;
    name: string;
    hours: number;
    workers: number;
    ratePerHour: number;
    notes?: string;
  };
}

export interface CalculationSummary {
  rawMaterialCost: number; // Чиста вартість матеріалів (без відходу)
  wasteAddedCost: number; // Вартість технологічного відходу
  materialsSubtotal: number; // Матеріали + відхід
  servicesSubtotal: number; // Роботи / монтаж / послуги
  deliveryCost?: number; // Доставка по місту / області
  installationCost?: number; // Монтажні роботи на обʼєкті
  complexityAddedCost: number; // Надбавка за складність виробництва
  baseProductionCost: number; // Базова виробнича собівартість
  overheadCost: number; // Загальновиробничі накладні витрати
  totalPrimeCost: number; // Повна собівартість
  marginAmount: number; // Плановий прибуток (грн)
  effectiveMarginPercent: number; // Фактичний % маржі
  clientTotalWithoutVat: number; // Кошторис для клієнта без ПДВ
  vatAmount: number; // ПДВ
  clientTotalWithVat: number; // Разом до сплати з ПДВ
  itemsCount: number;
}

export interface CalculationProject {
  id: string;
  projectNumber: string; // Номер замовлення / код (напр. "246-26")
  projectName: string; // Назва виробу / об'єкту
  client: string; // Замовник / Клієнт
  manager: string; // Менеджер проєкту
  date: string; // YYYY-MM-DD
  driveFolderId?: string; // Папка проєкту на Google Drive
  driveFolderName?: string;
  items: ConstructiveItem[];
  units?: ProjectAssemblyUnit[];
  servicesConfig?: ProjectServicesConfig;
  coefficients: CalculatorCoefficients;
  summary: CalculationSummary;
  googleSheetId?: string; // Створена Google Таблиця
  googleSheetUrl?: string;
  isInCashFlow: boolean; // Чи передано в Cash Flow
  cashFlowRowNumber?: number;
  isApproved?: boolean; // Чи погоджений проєкт клієнтом
  isInProjects?: boolean; // Чи внесено у вкладку «Проєкти» (Google Таблиці План / Оплати)
  projectsRowNumber?: number;
  paymentSchedule?: {
    tranche1Percent: number;
    tranche1Week?: string;
    tranche2Percent: number;
    tranche2Week?: string;
    tranche3Percent: number;
    tranche3Week?: string;
    tranche4Percent: number;
    tranche4Week?: string;
  };
  notes?: string;
  createdAt: string;
  updatedAt: string;
  status: 'draft' | 'calculated' | 'approved' | 'exported' | 'in_cashflow' | 'in_projects';
}

export interface ProjectTemplatePreset {
  id: string;
  title: string;
  description: string;
  category: string;
  defaultComplexity: number;
  defaultMargin: number;
  items: Array<{
    constructive: string;
    materialName: string;
    category: MaterialCategory;
    unit: string;
    quantity: number;
    notes?: string;
  }>;
}
