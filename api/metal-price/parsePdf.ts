import { GoogleGenAI, Type, Schema } from '@google/genai';
import { MaterialItem, MaterialCategory, ParsedPriceItem, PriceParseResult } from '../../src/types/calculator';

// Lazy initializer for Gemini client
let geminiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!geminiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    geminiClient = new GoogleGenAI({
      apiKey: apiKey || '',
      httpOptions: {
        headers: {
          'User-Agent': 'metal-holding-pdf-parser',
        },
      },
    });
  }
  return geminiClient;
}

export const metalPriceResponseSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    supplier: {
      type: Type.STRING,
      description: 'Name of the supplier identified from the document header, e.g. "ТОВ «Метал Холдінг»"',
    },
    mainCategory: {
      type: Type.STRING,
      description: 'Top-level category, e.g. "Чорний металопрокат", "Нержавіючий металопрокат", "Алюмінієвий прокат"',
    },
    sections: {
      type: Type.ARRAY,
      description: 'List of product subcategory folders found in the price list',
      items: {
        type: Type.OBJECT,
        properties: {
          groupHeader: {
            type: Type.STRING,
            description: 'Name of the folder/subcategory, e.g. "Арматура мірної довжини", "Труба профільна квадратна", "Листовий прокат", "Кутник сталевий", "Швелер сталевий"',
          },
          items: {
            type: Type.ARRAY,
            description: 'Metal items belonging to this folder',
            items: {
              type: Type.OBJECT,
              properties: {
                article: {
                  type: Type.STRING,
                  description: 'SKU / Article code if present, e.g. "ARM-012" or "TR-40402" or empty string',
                },
                name: {
                  type: Type.STRING,
                  description: 'Clear item name, e.g. "Арматура 12 міра", "Труба профільна 40х40х2 мм ст.3", "Лист г/к 2.0 мм ст.3"',
                },
                unit: {
                  type: Type.STRING,
                  description: 'Unit of measure for calculating furniture: "м.п." for profiles/pipes/bars/angles/channels, "м²" for sheets/plates',
                },
                pricePerMeterOrSheet: {
                  type: Type.NUMBER,
                  description: 'Retail price per 1 meter or per 1 sheet with VAT (Ціна роздрібна з ПДВ / за 1 м/ лист). Crucial: this must be a positive number per meter or per sheet, NOT per ton!',
                },
                cuttingPrice: {
                  type: Type.NUMBER,
                  description: 'Cutting cost per cut in UAH if specified in the table (Різка / вартість 1 різу), or 0 if not present',
                },
                tonPrice: {
                  type: Type.NUMBER,
                  description: 'Price per metric ton in UAH if listed, or 0 if not present',
                },
              },
              required: ['name', 'unit', 'pricePerMeterOrSheet'],
            },
          },
        },
        required: ['groupHeader', 'items'],
      },
    },
  },
  required: ['supplier', 'mainCategory', 'sections'],
};

export async function processMetalPricePdf(params: {
  fileData: string; // base64
  fileName?: string;
  existingMaterials?: MaterialItem[];
  customSupplier?: string;
}): Promise<PriceParseResult> {
  const {
    fileData,
    fileName = 'Metal_Holding_Price.pdf',
    existingMaterials = [],
    customSupplier,
  } = params;

  const cleanBase64 = fileData.includes(',') ? fileData.split(',')[1] : fileData;
  const ai = getGeminiClient();

  const prompt = `Ти спеціалізований парсер прайс-листів металопрокату українських металотрейдерів (зокрема ТОВ «Метал Холдінг», «Метінвест-СМЦ», «АВ метал груп», «Вікант»).
Перед тобою PDF-файл прайс-листа металопрокату з назвою "${fileName}".

ТВОЄ ЗАВДАННЯ:
1. Визначити постачальника (за замовчуванням "ТОВ «Метал Холдінг»", або з шапки документа).
2. Визначити головну категорію (зазвичай "Чорний металопрокат", або "Нержавіючий металопрокат", "Алюмінієвий прокат").
3. Побудувати чітке ієрархічне дерево папок-підкатегорій (groupHeader):
   - Кожен підзаголовок у прайсі (наприклад: «Арматура мірної довжини», «Труба профільна квадратна», «Труба профільна прямокутна», «Кутник сталевий гарячекатаний», «Швелер сталевий», «Листовий прокат г/к», «Круг сталевий» тощо) — це ОДНА ПАПКА (groupHeader).
4. Зчитати товари всередині кожної папки:
   - "name": повна, точна комерційна назва матеріалу (наприклад: «Арматура 12 міра», «Труба профільна 40х40х2 мм ст.3», «Кутник 32х32х3 мм ст.3», «Лист г/к 2.0 мм ст.3 (1250х2500)»).
   - "unit": автоматично встанови "м.п." для будь-яких профільних труб, кутників, швелерів, арматури, балок, смуг, кругів; та "м²" для листів або плит.
   - "pricePerMeterOrSheet": роздрібна ціна закупівлі за 1 м.п. (або за 1 лист для листового прокату) з ПДВ. УВАЖНО: бери ціну саме за метр/лист, а НЕ за тонну! (Наприклад, 47.02 грн за 1 м, а не 31800 грн за тонну).
   - "cuttingPrice": вартість різки за 1 різ (якщо колонка є в таблиці, наприклад 14.40 грн), або 0 якщо послуга різки не вказана.
   - "tonPrice": ціна за тонну (якщо є в таблиці, наприклад 31800 грн), або 0.
   - "article": артикул або код товару (якщо є в прайсі), або "".

Проаналізуй усі сторінки прайс-листа ретельно і поверни структурований JSON згідно зі схемою.`;

  const candidateModels = [
    'gemini-flash-latest',
    'gemini-3.8-flash',
    'gemini-3.7-flash',
    'gemini-3.1-flash-lite',
  ];

  let rawJson: any = null;
  let lastError: any = null;

  for (const model of candidateModels) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: [
          {
            inlineData: {
              mimeType: 'application/pdf',
              data: cleanBase64,
            },
          },
          {
            text: prompt,
          },
        ],
        config: {
          responseMimeType: 'application/json',
          responseSchema: metalPriceResponseSchema,
          temperature: 0.1,
        },
      });

      let text = response.text || '';
      text = text.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
      if (text) {
        rawJson = JSON.parse(text);
        break;
      }
    } catch (err: any) {
      lastError = err;
      console.warn(`Gemini PDF parse failed with model ${model}:`, err?.message || err);
    }
  }

  if (!rawJson) {
    throw new Error(
      lastError?.message ||
        'Не вдалося розпізнати PDF-прайс за допомогою AI. Перевірте якість документа або спробуйте знову.'
    );
  }

  // Normalize and transform to ParsedPriceItem[]
  const recognizedItems: ParsedPriceItem[] = [];
  const groupHeadersFound: string[] = [];

  const supplier = customSupplier?.trim() || rawJson.supplier || 'ТОВ «Метал Холдінг»';
  const mainCategory = rawJson.mainCategory || 'Чорний металопрокат';

  // Normalize existing materials map for quick lookup
  const normalizeName = (s: string) =>
    s
      .toLowerCase()
      .replace(/[\s\t\n]+/g, ' ')
      .replace(/[,;:]/g, ' ')
      .replace(/["'«»]/g, '')
      .replace(/x/g, 'х')
      .trim();

  const existingMap = new Map<string, MaterialItem>();
  existingMaterials.forEach((m) => {
    existingMap.set(normalizeName(m.name), m);
  });

  const sections = Array.isArray(rawJson.sections) ? rawJson.sections : [];

  for (const sec of sections) {
    const groupName = String(sec.groupHeader || 'Загальний прокат').trim();
    if (!groupHeadersFound.includes(groupName)) {
      groupHeadersFound.push(groupName);
    }

    const items = Array.isArray(sec.items) ? sec.items : [];
    for (const it of items) {
      const name = String(it.name || '').trim();
      if (!name) continue;

      const norm = normalizeName(name);
      const existing = existingMap.get(norm);

      let price = Number(it.pricePerMeterOrSheet) || 0;
      if (price <= 0) continue;

      const isSheet =
        name.toLowerCase().includes('лист') ||
        name.toLowerCase().includes('бляха') ||
        name.toLowerCase().includes('плита');

      const unit = isSheet ? 'м²' : (it.unit === 'м²' ? 'м²' : 'м.п.');
      const category: MaterialCategory = isSheet ? 'sheet_metal' : 'metal_profile';

      const cuttingPrice = Number(it.cuttingPrice) > 0 ? Number(it.cuttingPrice) : undefined;
      const tonPrice = Number(it.tonPrice) > 0 ? Number(it.tonPrice) : undefined;
      const article = it.article ? String(it.article).trim() : undefined;

      recognizedItems.push({
        name,
        category,
        parentCategory: 'Металопрокат',
        subcategory: mainCategory,
        groupHeader: groupName,
        unit,
        basePrice: Math.round(price * 100) / 100,
        cuttingPrice: cuttingPrice ? Math.round(cuttingPrice * 100) / 100 : undefined,
        sourceArticle: article,
        tonPrice: tonPrice ? Math.round(tonPrice * 100) / 100 : undefined,
        isExisting: !!existing,
        existingId: existing?.id,
        oldPrice: existing?.basePrice,
      });
    }
  }

  return {
    fileName,
    supplier,
    mainCategory,
    totalRowsRead: recognizedItems.length,
    recognizedItems,
    groupHeadersFound,
    newItemsCount: recognizedItems.filter((i) => !i.isExisting).length,
    updatedItemsCount: recognizedItems.filter((i) => i.isExisting).length,
    errors: [],
  };
}
