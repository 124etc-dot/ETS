import fs from 'fs';
import path from 'path';
import { MaterialItem, ParsedPriceItem, LdspItem } from '../../src/types/calculator';
import { DEFAULT_MATERIALS } from '../../src/data/calculatorDefaults';
import {
  areMaterialsMatching,
  inferMaterialFolder,
} from '../../src/services/metalPriceParser';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'materials.json');
const LDSP_DB_FILE = path.join(DATA_DIR, 'ldsp_materials.json');

function ensureDbFile(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT_MATERIALS, null, 2), 'utf-8');
  }
}

export function getLdspItemsFromDb(): LdspItem[] {
  try {
    ensureDbFile();
    if (fs.existsSync(LDSP_DB_FILE)) {
      const raw = fs.readFileSync(LDSP_DB_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch (err) {
    console.error('Error reading LDSP DB:', err);
  }
  return [];
}

export function saveLdspItemsToDb(items: LdspItem[]): LdspItem[] {
  try {
    ensureDbFile();
    fs.writeFileSync(LDSP_DB_FILE, JSON.stringify(items, null, 2), 'utf-8');
    return items;
  } catch (err) {
    console.error('Error writing LDSP DB:', err);
    throw err;
  }
}

export function importLdspItemsToDb(
  items: LdspItem[],
  supplierName: string = 'KRONAS'
): {
  updatedMaterials: MaterialItem[];
  ldspItems: LdspItem[];
  addedCount: number;
  updatedCount: number;
} {
  const currentMaterials = getMaterialsFromDb();
  const materialsList: MaterialItem[] = [...currentMaterials];
  const currentLdsp = getLdspItemsFromDb();
  const ldspList: LdspItem[] = [...currentLdsp];

  let addedCount = 0;
  let updatedCount = 0;
  const nowIso = new Date().toISOString();

  for (const item of items) {
    // RULE 4: Унікальний ключ товару: Повна назва (name)
    const existingIndex = materialsList.findIndex(
      (m) => m.name.trim().toLowerCase() === item.name.trim().toLowerCase()
    );

    if (existingIndex !== -1) {
      // RULE 4: Якщо назва name є в базі — оновлюються поля price_sheet та price_sqm
      const existing = materialsList[existingIndex];
      const updatedItem: MaterialItem = {
        ...existing,
        price_sheet: item.price_sheet,
        price_sqm: item.price_sqm,
        sheet_area_sqm: item.sheet_area_sqm,
        basePrice: item.price_sqm, // Used in BOM calculation (effectiveQuantity * basePrice)
        brand: item.brand || existing.brand,
        groupHeader: item.brand || existing.groupHeader || 'ДСП',
        supplier: supplierName || existing.supplier || 'KRONAS',
        unit: item.unit || existing.unit || 'м²',
        updatedAt: nowIso,
      };
      materialsList[existingIndex] = updatedItem;
      updatedCount++;
    } else {
      // RULE 4: Якщо немає — створюється новий запис
      const newItem: MaterialItem = {
        id: `mat_ldsp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: item.name, // Повна назва з Excel 1 в 1 без змін
        category: 'plate_wood',
        parentCategory: 'Плитні матеріали',
        subcategory: 'ДСП',
        groupHeader: item.brand || 'ДСП',
        brand: item.brand,
        unit: item.unit || 'м²',
        basePrice: item.price_sqm,
        price_sheet: item.price_sheet,
        price_sqm: item.price_sqm,
        sheet_area_sqm: item.sheet_area_sqm,
        defaultWasteFactor: 1.18,
        supplier: supplierName || 'KRONAS',
        updatedAt: nowIso,
      };
      materialsList.push(newItem);
      addedCount++;
    }

    // Upsert into dedicated ldspList
    const existingLdspIdx = ldspList.findIndex(
      (l) => l.name.trim().toLowerCase() === item.name.trim().toLowerCase()
    );
    if (existingLdspIdx !== -1) {
      ldspList[existingLdspIdx] = {
        ...ldspList[existingLdspIdx],
        brand: item.brand || ldspList[existingLdspIdx].brand,
        price_sheet: item.price_sheet,
        price_sqm: item.price_sqm,
        sheet_area_sqm: item.sheet_area_sqm,
        unit: item.unit,
      };
    } else {
      ldspList.push({
        brand: item.brand,
        name: item.name,
        price_sheet: item.price_sheet,
        price_sqm: item.price_sqm,
        sheet_area_sqm: item.sheet_area_sqm,
        unit: item.unit,
      });
    }
  }

  saveMaterialsToDb(materialsList);
  saveLdspItemsToDb(ldspList);

  return {
    updatedMaterials: materialsList,
    ldspItems: ldspList,
    addedCount,
    updatedCount,
  };
}

export function getMaterialsFromDb(): MaterialItem[] {
  try {
    ensureDbFile();
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
  } catch (err) {
    console.error('Error reading materials DB:', err);
  }
  return [...DEFAULT_MATERIALS];
}

export function saveMaterialsToDb(materials: MaterialItem[]): MaterialItem[] {
  try {
    ensureDbFile();
    fs.writeFileSync(DB_FILE, JSON.stringify(materials, null, 2), 'utf-8');
    return materials;
  } catch (err) {
    console.error('Error writing materials DB:', err);
    throw err;
  }
}

export function resetMaterialsDb(): MaterialItem[] {
  return saveMaterialsToDb([...DEFAULT_MATERIALS]);
}

export function importPriceItemsToDb(
  items: (ParsedPriceItem | MaterialItem)[],
  supplierName: string = 'ТОВ «Метал Холдінг»'
): { updatedMaterials: MaterialItem[]; addedCount: number; updatedCount: number } {
  const currentMaterials = getMaterialsFromDb();
  
  // Clean all previous cutting prices and cutting notes from existing database entries
  const materialsList: MaterialItem[] = currentMaterials.map((m) => ({
    ...m,
    cuttingPrice: undefined,
    notes: m.notes && m.notes.includes('Різка:') ? undefined : m.notes,
  }));

  let addedCount = 0;
  let updatedCount = 0;
  const nowIso = new Date().toISOString();

  for (const item of items) {
    // Strict duplicate protection: match existing by full name, spec, or steel grade
    const existingIndex = materialsList.findIndex((em) => areMaterialsMatching(em, item));

    // Normalize subcategory
    let subcategory = item.subcategory || 'Чорний метал';
    if (subcategory.toLowerCase().includes('чорн') || subcategory.toLowerCase().includes('метал')) {
      if (!subcategory.toLowerCase().includes('нержав') && !subcategory.toLowerCase().includes('алюмін')) {
        subcategory = 'Чорний метал';
      }
    }

    if (existingIndex !== -1) {
      const existing = materialsList[existingIndex];
      // STRICT RULE: Update ONLY basePrice per meter/sheet. No duplicates!
      const updatedItem: MaterialItem = {
        ...existing,
        basePrice: item.basePrice,
        cuttingPrice: undefined, // Exclude cutting price completely
        unit: item.unit || existing.unit,
        parentCategory: item.parentCategory || existing.parentCategory || 'Металопрокат',
        subcategory,
        groupHeader: inferMaterialFolder(existing.name, item.groupHeader || existing.groupHeader),
        supplier: supplierName || (item as any).supplier || existing.supplier,
        sourceArticle: (item as any).sourceArticle || existing.sourceArticle,
        tonPrice: (item as any).tonPrice || existing.tonPrice,
        notes: existing.notes && existing.notes.includes('Різка:') ? undefined : existing.notes,
        updatedAt: nowIso,
      };
      materialsList[existingIndex] = updatedItem;
      updatedCount++;
    } else {
      const defaultWaste = item.category === 'sheet_metal' ? 1.15 : 1.10;
      const newItem: MaterialItem = {
        id: `mat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: item.name,
        category: item.category,
        parentCategory: item.parentCategory || 'Металопрокат',
        subcategory,
        groupHeader: inferMaterialFolder(item.name, item.groupHeader),
        unit: item.unit || 'м.п.',
        basePrice: item.basePrice,
        cuttingPrice: undefined, // Exclude cutting price completely
        defaultWasteFactor: defaultWaste,
        supplier: supplierName || (item as any).supplier,
        sourceArticle: (item as any).sourceArticle,
        tonPrice: (item as any).tonPrice,
        notes: undefined,
        updatedAt: nowIso,
      };
      materialsList.push(newItem);
      addedCount++;
    }
  }

  saveMaterialsToDb(materialsList);

  return {
    updatedMaterials: materialsList,
    addedCount,
    updatedCount,
  };
}
