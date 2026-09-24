import { GoogleGenAI, Type, Schema } from '@google/genai';
import { MaterialItem, MaterialCategory, ParsedPriceItem, PriceParseResult } from '../../src/types/calculator';
import {
  formatFullMaterialName,
  normalizeParsedItems,
  UNIT_ONLY_REGEX,
  isTableHeaderRowOrText,
  inferMaterialFolder,
  areMaterialsMatching,
} from '../../src/services/metalPriceParser';

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
            description: 'Name of the material folder (e.g. "Квадрат", "Дріт", "Балка", "Арматура мірної довжини", "Труба профільна квадратна", "Листовий прокат", "Кутник сталевий", "Швелер сталевий"). FORBIDDEN: never use table header names like "Ціна роздрібна з ПДВ" or "Найменування" as groupHeader!',
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
                  description: 'Full product name, e.g. "Квадрат металевий 20", "Квадрат металевий 20 (ст.45)", "Арматура мірної довжини 12 міра", "Труба профільна 40х40х2 мм ст.3"',
                },
                unit: {
                  type: Type.STRING,
                  description: 'Unit of measure: "м.п." for profiles/pipes/bars/wire/beams/angles/channels, "м²" for sheets/plates',
                },
                pricePerMeterOrSheet: {
                  type: Type.NUMBER,
                  description: 'Single retail price per 1 meter or per 1 sheet with VAT (Ціна роздрібна з ПДВ / за 1 м/ лист). Crucial: this must be a positive number per meter or per sheet, NOT per ton and NOT cutting cost!',
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

ГОЛОВНІ ПРАВИЛА ЗЧИТУВАННЯ ТА СТРУКТУРУВАННЯ:

1. ПОВНЕ ІГНОРУВАННЯ ВАРТОСТІ ПОРІЗКИ:
   - Повністю виключити колонку «Вартість різки» / «Порізка» / «1 різ» з розпізнавання!
   - НЕ зчитувати її, не записувати в ціну товару, не повертати.

2. СТРОГИЙ ФІЛЬТР ШАПКИ ТАБЛИЦІ (ПРИБИТИ ПОМИЛКОВУ КАТЕГОРІЮ «Ціна роздрібна з ПДВ»):
   - Назви колонок з шапки таблиці («Ціна роздрібна з ПДВ», «Найменування», «Одиниця виміру», «Ціна за тонну», «Вартість різки», «Довжина» тощо) НІКОЛИ не повинні ставати папками чи підкатегоріями (groupHeader)!
   - Усі товари мають розподілятися строго за своїми матеріальними папками:
     * «Квадрат» (для всіх квадратів металевих, напр. Квадрат металевий 20, Квадрат 12, Квадрат 20 ст.45)
     * «Дріт» (для дроту в'язального, ВР-1 тощо)
     * «Балка» (для двотаврів та балок)
     * «Арматура мірної довжини» або «Арматура»
     * «Труба профільна квадратна» / «Труба профільна прямокутна»
     * «Кутник» / «Кутник рівнополичний»
     * «Швелер» / «Швелер сталевий»
     * «Круг»
     * «Полоса»
     * «Листовий прокат»

3. ФОРМУВАННЯ ПОВНОЇ НАЗВИ ТОВАРУ:
   - Повна назва матеріалу конкатенується: [Підкатегорія] + [Специфікація/Розмір], з маркою сталі якщо вказана.
   - Наприклад: «Квадрат металевий 20», «Квадрат металевий 20 (ст.45)», «Арматура мірної довжини 6 міра», «Труба профільна 40х40х2 мм ст.3».
   - СУВОРЕ ТАБУ: Ігнорувати букви «т», «м.п.», «шт», «кг»! Вони не є назвою.

4. ЛОГІКА ЄДИНОЇ ЦІНИ:
   - З прайсу зчитується СТРОГО ОДНА цінова колонка — за 1 м/ лист (наприклад: 14.05, 175.36, 273.66, 393.21).
   - ПОВНІСТЮ ІГНОРУВАТИ ціну за тонну (58 785, 51 180 тощо) та вартість різки!
   - Якщо ціна за метр перевищує 3000 грн/м.п. для не-листового прокату — це помилка (підхопилася ціна тонни)! Запиши її в tonPrice, а для pricePerMeterOrSheet візьми ціну за метр із сусідньої колонки.

Поверни валідний структурований JSON згідно зі схемою.`;

  const candidateModels = [
    'gemini-3.8-flash',
    'gemini-3.7-flash',
    'gemini-2.0-flash',
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
  const rawRecognizedItems: ParsedPriceItem[] = [];
  const groupHeadersFound: string[] = [];

  const supplier = customSupplier?.trim() || rawJson.supplier || 'ТОВ «Метал Холдінг»';
  const mainCategory = rawJson.mainCategory || 'Чорний металопрокат';

  const sections = Array.isArray(rawJson.sections) ? rawJson.sections : [];

  for (const sec of sections) {
    let rawGroupName = String(sec.groupHeader || '')
      .replace(/^[📁📂\s\-_:;]+/, '')
      .replace(/\s*\([^)]*\)/g, '')
      .replace(/[:;\.]$/, '')
      .trim();

    // Prevent table headers from being group names
    if (isTableHeaderRowOrText(rawGroupName)) {
      rawGroupName = '';
    }

    const items = Array.isArray(sec.items) ? sec.items : [];
    for (const it of items) {
      const rawItemName = String(it.name || '').trim();
      const article = it.article ? String(it.article).trim() : undefined;

      // Handle column shift and full name formation
      let name = formatFullMaterialName(rawItemName, rawGroupName, article);
      if (!name || UNIT_ONLY_REGEX.test(name) || name === 'т' || name === 'м.п.') {
        continue;
      }

      // Strictly map item into its material folder (Квадрат, Дріт, Балка, etc.)
      const groupName = inferMaterialFolder(name, rawGroupName);
      if (!groupHeadersFound.includes(groupName)) {
        groupHeadersFound.push(groupName);
      }

      // Check against existing materials database using flexible matching with steel grade
      const existing = existingMaterials.find((em) =>
        areMaterialsMatching(em, { name, sourceArticle: article })
      );

      let price = Number(it.pricePerMeterOrSheet) || 0;
      let tonPrice = Number(it.tonPrice) > 0 ? Number(it.tonPrice) : undefined;

      // Safeguard: if price is > 3,000 for rebar/pipe (ton price) and tonPrice was put as the smaller number, swap
      const isSheet =
        name.toLowerCase().includes('лист') ||
        name.toLowerCase().includes('бляха') ||
        name.toLowerCase().includes('плита') ||
        groupName.toLowerCase().includes('лист');

      if (!isSheet && price > 3000) {
        if (tonPrice && tonPrice <= 3000 && tonPrice > 0) {
          const swap = price;
          price = tonPrice;
          tonPrice = swap;
        } else if (!tonPrice) {
          tonPrice = price;
        }
      }

      if (price <= 0) continue;

      const unit = isSheet ? 'м²' : (it.unit === 'м²' ? 'м²' : 'м.п.');
      const category: MaterialCategory = isSheet ? 'sheet_metal' : 'metal_profile';

      let subcategory = mainCategory || 'Чорний метал';
      if (mainCategory.toLowerCase().includes('чорн') || mainCategory.toLowerCase().includes('метал')) {
        if (!mainCategory.toLowerCase().includes('нержав') && !mainCategory.toLowerCase().includes('алюмін')) {
          subcategory = 'Чорний метал';
        }
      }

      rawRecognizedItems.push({
        name,
        category,
        parentCategory: 'Металопрокат',
        subcategory,
        groupHeader: groupName,
        unit,
        basePrice: Math.round(price * 100) / 100,
        cuttingPrice: undefined, // Strictly ignored as per specification
        sourceArticle: article,
        tonPrice: tonPrice ? Math.round(tonPrice * 100) / 100 : undefined,
        isExisting: !!existing,
        existingId: existing?.id,
        oldPrice: existing?.basePrice,
      });
    }
  }

  const recognizedItems = normalizeParsedItems(rawRecognizedItems);

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
