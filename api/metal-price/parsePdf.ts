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

СТРОГІ ПРАВИЛА ЗЧИТУВАННЯ КОЛОНОК (читати ТІЛЬКИ 3 колонки, все інше ігнорувати):
1. Група (Підкатегорія / groupHeader):
   Рядок із заголовком групи (наприклад: «Арматура мірної довжини», «Труба профільна квадратна», «Кутник сталевий», «Листовий прокат»). Очистити від приміток (без сталь..., без ГОСТ).
2. Назва товару (name):
   Колонка "Назва товара" / "Найменування товару". Беруться ВСІ слова повністю: «Арматура 6 міра», «Арматура 8 міра», «Арматура 10 міра», «Труба профільна 40х40х2 мм ст.3» тощо.
   ❌ КАТЕГОРИЧНО ЗАБОРОНЕНО обрізати назву (не робити "6 міра" або "8 міра")!
   ❌ НЕ зчитувати дані з колонки «Одиниця виміру» («т», «од.») як назву!
3. Ціна за метр / лист (pricePerMeterOrSheet):
   Колонка "за 1 м/ лист" (підзаголовок колонки «Ціна роздрібна з ПДВ»).
   ❌ НЕ брати першу колонку ціни (за од., де вказано 58 785 грн / 51 180 грн / 32 500 грн).
   ✅ Брати СТРOГО другу колонку ціни (за 1 м/ лист, де вказано роздрібну ціну: 14.05 грн, 22.98 грн, 33.10 грн, 47.02 грн тощо).

Поверни структурований JSON згідно зі схемою.`;

  const candidateModels = [
    'gemini-2.5-flash',
    'gemini-3.8-flash',
    'gemini-3.7-flash',
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
    let groupName = String(sec.groupHeader || 'Загальний прокат')
      .replace(/^[📁📂\s\-_:;]+/, '')
      .replace(/\s*\([^)]*\)/g, '')
      .replace(/[:;\.]$/, '')
      .trim();

    if (!groupName) groupName = 'Загальний прокат';
    if (!groupHeadersFound.includes(groupName)) {
      groupHeadersFound.push(groupName);
    }

    const items = Array.isArray(sec.items) ? sec.items : [];
    for (const it of items) {
      let name = String(it.name || '').trim();
      if (!name) continue;

      // Filter out unit accidentally captured as name
      if (/^(т|т\.|од|од\.|м|м\.п\.|шт|кг)$/i.test(name)) {
        continue;
      }

      // If name is just "6 міра", "8 міра" etc., prefix with group base name (e.g. "Арматура")
      if (/^[0-9]+\s*міра$/i.test(name) && groupName.toLowerCase().includes('арматура')) {
        name = `Арматура ${name}`;
      }

      const norm = normalizeName(name);
      const existing = existingMap.get(norm);

      let price = Number(it.pricePerMeterOrSheet) || 0;
      let tonPrice = Number(it.tonPrice) > 0 ? Number(it.tonPrice) : undefined;

      // Safeguard: if price is > 10,000 (ton price) and tonPrice was put as the smaller number, swap
      if (price > 10000 && tonPrice && tonPrice < 2000) {
        const swap = price;
        price = tonPrice;
        tonPrice = swap;
      }

      if (price <= 0) continue;

      const isSheet =
        name.toLowerCase().includes('лист') ||
        name.toLowerCase().includes('бляха') ||
        name.toLowerCase().includes('плита');

      const unit = isSheet ? 'м²' : (it.unit === 'м²' ? 'м²' : 'м.п.');
      const category: MaterialCategory = isSheet ? 'sheet_metal' : 'metal_profile';

      const cuttingPrice = Number(it.cuttingPrice) > 0 ? Number(it.cuttingPrice) : undefined;
      const article = it.article ? String(it.article).trim() : undefined;

      let subcategory = mainCategory || 'Чорний метал';
      if (mainCategory.toLowerCase().includes('чорн') || mainCategory.toLowerCase().includes('метал')) {
        if (!mainCategory.toLowerCase().includes('нержав') && !mainCategory.toLowerCase().includes('алюмін')) {
          subcategory = 'Чорний метал';
        }
      }

      recognizedItems.push({
        name,
        category,
        parentCategory: 'Металопрокат',
        subcategory,
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
