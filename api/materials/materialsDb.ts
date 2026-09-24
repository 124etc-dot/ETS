import fs from 'fs';
import path from 'path';
import { MaterialItem, ParsedPriceItem } from '../../src/types/calculator';
import { DEFAULT_MATERIALS } from '../../src/data/calculatorDefaults';
import {
  areMaterialsMatching,
  inferMaterialFolder,
} from '../../src/services/metalPriceParser';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'materials.json');

function ensureDbFile(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT_MATERIALS, null, 2), 'utf-8');
  }
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
