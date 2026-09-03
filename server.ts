import express from 'express';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type, Schema } from '@google/genai';

dotenv.config();

const app = express();
const PORT = 3000;

// Enable CORS for local app wrappers, PWAs, or alternate dev ports
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Set high limits for base64 file payloads (PDFs and high-res phone camera photos)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Lazy initializer for Gemini client
let geminiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!geminiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn('GEMINI_API_KEY environment variable is missing.');
    }
    geminiClient = new GoogleGenAI({
      apiKey: apiKey || '',
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return geminiClient;
}

// Auto-detect and normalize MIME type from base64 magic bytes or filename
function detectAndNormalizeMimeType(base64: string, fallbackMime: string, fileName?: string): string {
  const cleanHead = base64.replace(/\s+/g, '').slice(0, 30);
  if (cleanHead.startsWith('JVBERi')) return 'application/pdf';
  if (cleanHead.startsWith('/9j/') || cleanHead.startsWith('/9J/')) return 'image/jpeg';
  if (cleanHead.startsWith('iVBORw')) return 'image/png';
  if (cleanHead.startsWith('UklGR')) return 'image/webp';
  if (cleanHead.startsWith('R0lGO')) return 'image/gif';

  if (fileName) {
    const ext = fileName.toLowerCase().split('.').pop() || '';
    if (ext === 'pdf') return 'application/pdf';
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
    if (ext === 'png') return 'image/png';
    if (ext === 'webp') return 'image/webp';
    if (ext === 'gif') return 'image/gif';
  }

  if (fallbackMime === 'image/jpg' || fallbackMime === 'image/pjpeg' || fallbackMime === 'image/heic' || fallbackMime === 'image/heif') {
    return 'image/jpeg';
  }
  if (fallbackMime === 'image/x-png') {
    return 'image/png';
  }

  return fallbackMime || 'application/pdf';
}

// Clean and normalize company name strictly to format "ТОВ НАЗВА КОМПАНІЇ" (ALL UPPERCASE, NO QUOTES)
function normalizeCompanyName(input: string): string {
  if (!input) return '';
  let val = String(input).trim();

  // 1. Remove all quotes (single, double, guillemets, curly, backticks)
  val = val.replace(/["'«»“”„‟`]/g, ' ');

  // 2. Expand/normalize full legal forms in Ukrainian
  val = val.replace(/Товариство\s+з\s+обмеженою\s+відповідальністю/gi, 'ТОВ');
  val = val.replace(/Приватне\s+підприємство/gi, 'ПП');
  val = val.replace(/Фізична\s+особа\s*[-–—]?\s*підприємець/gi, 'ФОП');
  val = val.replace(/Товариство\s+з\s+додатковою\s+відповідальністю/gi, 'ТДВ');
  val = val.replace(/Приватне\s+акціонерне\s+товариство/gi, 'ПРАТ');
  val = val.replace(/Публічне\s+акціонерне\s+товариство/gi, 'ПАТ');
  val = val.replace(/Акціонерне\s+товариство/gi, 'АТ');
  val = val.replace(/Державне\s+підприємство/gi, 'ДП');

  // 3. Remove punctuation around legal forms
  val = val.replace(/^(ТОВ|ФОП|ПП|ТДВ|ПРАТ|ПАТ|АТ|ДП)[.,\s]+/i, '$1 ');
  val = val.replace(/,\s*(ТОВ|ФОП|ПП|ТДВ|ПРАТ|ПАТ|АТ|ДП)$/i, ' $1');

  // 4. If legal form is at the end (e.g. "ЛЕГНОПРОМ ТОВ"), move it to front
  const trailingFormMatch = val.match(/^(.+?)\s+(ТОВ|ФОП|ПП|ТДВ|ПРАТ|ПАТ|АТ|ДП)$/i);
  if (trailingFormMatch) {
    val = `${trailingFormMatch[2]} ${trailingFormMatch[1]}`;
  }

  // 5. Clean up multiple spaces and trim
  val = val.replace(/\s+/g, ' ').trim();

  // 6. Convert entirely to UPPERCASE
  return val.toUpperCase();
}

// Extract numeric amount from string or formatted text (e.g. "96 932,88 грн" -> 96932.88)
function parseAmountToNumber(val: any): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  const cleanStr = String(val)
    .replace(/[^\d.,]/g, '')
    .replace(/\s+/g, '')
    .replace(',', '.');
  const num = parseFloat(cleanStr);
  return isNaN(num) ? 0 : num;
}

// Structured output schema for OCR results (relaxed required fields to prevent validation aborts on diverse document types)
const ocrResponseSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    documentType: {
      type: Type.STRING,
      enum: ['invoice', 'payment', 'other'],
      description: 'Document type: invoice (Рахунок, Рахунок-фактура, Акт) or payment (Платіжна інструкція, Платіжне доручення, Квитанція)',
    },
    documentTypeUkrainian: {
      type: Type.STRING,
      description: 'Ukrainian title of the document, e.g. "Рахунок на оплату" or "Платіжна інструкція"',
    },
    handwrittenOrderNumber: {
      type: Type.STRING,
      description: 'Handwritten internal order number strictly in format "xxx-xx" without the "№" symbol (e.g. "142-26", "089-26", "45-26", "1054-26"). Look for pen/pencil handwriting anywhere on the document. If no handwriting is found, return empty string "".',
    },
    handwrittenRawText: {
      type: Type.STRING,
      description: 'The exact raw handwritten text as seen on the document before normalization (e.g. "№ 123-26", "123-26", "зам. 45-26")',
    },
    handwrittenLocation: {
      type: Type.STRING,
      description: 'Location on the page where handwritten order was spotted, e.g. "Верхній правий кут", "Біля суми", "На полях", "Внизу біля підпису"',
    },
    handwrittenConfidence: {
      type: Type.STRING,
      enum: ['high', 'medium', 'low', 'none'],
      description: 'Confidence in reading the handwritten internal order number',
    },
    supplierName: {
      type: Type.STRING,
      description: 'Supplier company name in strict format: "ТОВ НАЗВА КОМПАНІЇ" (ALL UPPERCASE, NO QUOTES). E.g. "ТОВ ЛЕГНОПРОМ", "ТОВ ЕПІЦЕНТР К", "ТОВ ШОП ІНТЕРІОР", "ФОП ШЕВЧЕНКО І.В.". MUST NOT be our company name.',
    },
    supplierTaxId: {
      type: Type.STRING,
      description: 'Supplier EDRPOU / IPN code (ЄДРПОУ / ІПН постачальника)',
    },
    supplierIban: {
      type: Type.STRING,
      description: 'Supplier IBAN account number if visible',
    },
    buyerName: {
      type: Type.STRING,
      description: 'Buyer / Our company name in strict format: "ТОВ НАЗВА КОМПАНІЇ" (ALL UPPERCASE, NO QUOTES). Matches one of the companies in our companies list.',
    },
    buyerTaxId: {
      type: Type.STRING,
      description: 'Buyer EDRPOU / IPN code',
    },
    invoiceNumber: {
      type: Type.STRING,
      description: 'Invoice number (Номер рахунку, e.g. "СФ-000452", "125")',
    },
    invoiceDate: {
      type: Type.STRING,
      description: 'Invoice issue date in YYYY-MM-DD format (e.g. "2026-03-15")',
    },
    invoiceDateOriginal: {
      type: Type.STRING,
      description: 'Original date string as printed on document, e.g. "15 березня 2026 р."',
    },
    totalAmount: {
      type: Type.NUMBER,
      description: 'Total payable amount as a float number (e.g. 14500.50)',
    },
    currency: {
      type: Type.STRING,
      description: 'Currency code, e.g. "UAH", "USD", "EUR", "PLN"',
    },
    vatAmount: {
      type: Type.NUMBER,
      description: 'VAT amount (ПДВ) if specified',
    },
    paymentNumber: {
      type: Type.STRING,
      description: 'Payment document number if doc is payment order / квитанція',
    },
    paymentDate: {
      type: Type.STRING,
      description: 'Payment execution date in YYYY-MM-DD format',
    },
    payerName: {
      type: Type.STRING,
      description: 'Payer company name in payment order',
    },
    payeeName: {
      type: Type.STRING,
      description: 'Payee company name in payment order',
    },
    amountPaid: {
      type: Type.NUMBER,
      description: 'Amount paid in payment order',
    },
    paymentPurpose: {
      type: Type.STRING,
      description: 'Payment purpose (Призначення платежу) from bank receipt',
    },
    referencedInvoiceNumber: {
      type: Type.STRING,
      description: 'Invoice number referenced in payment purpose, e.g. "СФ-000452" (if multiple, the first or joined by comma)',
    },
    referencedInvoiceNumbers: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'List of ALL invoice numbers referenced in payment purpose (e.g. ["124", "125", "126"] when accountant combines multiple paid invoices of the same supplier in one payment)',
    },
    referencedOrderNumber: {
      type: Type.STRING,
      description: 'Internal order number referenced in payment purpose if any',
    },
    notes: {
      type: Type.STRING,
      description: 'Helpful OCR notes or observations regarding handwriting quality, stamps, etc.',
    },
    confidenceScore: {
      type: Type.NUMBER,
      description: 'Overall OCR confidence percentage from 0 to 100',
    },
  },
  required: [
    'documentType',
    'documentTypeUkrainian',
  ],
};

// Health endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
    time: new Date().toISOString(),
  });
});

// Primary OCR Endpoint (supports both with and without trailing slash)
app.post(['/api/ocr/process', '/api/ocr/process/'], async (req, res) => {
  try {
    const {
      fileData, // base64 string
      mimeType: rawMimeType = 'application/pdf',
      fileName = 'document',
      ourCompanies = [],
      suppliers = [],
      knownOrders = [],
      docTypeHint = 'auto',
    } = req.body;

    if (!fileData) {
      return res.status(400).json({ success: false, error: 'Вміст файлу (base64) обовʼязковий для розпізнавання.' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: 'Ключ Gemini API не знайдено в середовищі. Будь ласка, перевірте налаштування GEMINI_API_KEY.',
      });
    }

    // Clean base64 data header if present (e.g. data:image/png;base64,...) and strip whitespace
    const cleanBase64 = fileData.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
    const finalMimeType = detectAndNormalizeMimeType(cleanBase64, rawMimeType, fileName);

    const ai = getGeminiClient();

    const ourCompaniesPromptList = Array.isArray(ourCompanies) && ourCompanies.length > 0
      ? `\nСПИСОК НАШИХ КОМПАНІЙ (Одержувачі рахунків / Покупці / Платники):\n${ourCompanies.map((c: string) => `- ${c}`).join('\n')}`
      : '\nСписок наших компаній не заданий — визнач покупця/платника самостійно.';

    const suppliersPromptList = Array.isArray(suppliers) && suppliers.length > 0
      ? `\nСПИСОК ВІДОМИХ ПОСТАЧАЛЬНИКІВ:\n${suppliers.map((s: string) => `- ${s}`).join('\n')}`
      : '';

    const knownOrdersPromptList = Array.isArray(knownOrders) && knownOrders.length > 0
      ? `\nДОВІДНИК АКТИВНИХ ВНУТРІШНІХ ЗАМОВЛЕНЬ (для точної перевірки рукописного номера):\n${knownOrders.map((o: any) => `- Код: ${typeof o === 'string' ? o : o.code + ' (' + o.title + ')'}`).join('\n')}`
      : '';

    const systemPrompt = `Ти високоточний експертний модуль автоматичного розпізнавання (OCR) первинних фінансових документів (Рахунків на оплату та Банківських платіжок/квитанцій) для українського та міжнародного бізнесу.

Перед тобою документ (PDF або фото) з ім'ям "${fileName}".

${ourCompaniesPromptList}
${suppliersPromptList}
${knownOrdersPromptList}

КРИТИЧНІ ПРАВИЛА РОЗПІЗНАВАННЯ:
1. ТИП ДОКУМЕНТА:
   - "invoice": Рахунок на оплату, Рахунок-фактура, Акт виконаних робіт, Видаткова накладна.
   - "payment": Платіжна інструкція, Платіжне доручення, Банківська виписка, Меморіальний ордер, Квитанція про оплату.
   - "other": Інший тип документа.

2. КРИТИЧНО — ВНУТРІШНІЙ НОМЕР ЗАМОВЛЕННЯ (НАПИСАНИЙ ТІЛЬКИ ВІД РУКИ!):
   - Це найважливіше поле! У нашій компанії менеджер або бухгалтер пише номер внутрішнього замовлення ВІД РУКИ (ручкою, олівцем, маркером) будь-де на документі (у верхньому кутку, біля шапки, біля підпису, на полях або під назвою "Рахунок").
   - Формат внутрішнього номера: "ххх-хх" БЕЗ СИМВОЛУ "№"! Де "ххх" — це номер замовлення (від 1 до 6 цифр, наприклад 142, 089, 228, 45, 123, 1890), а "хх" — це дві цифри року (наприклад "26" для 2026 року, "25" для 2025 тощо).
   - Приклади того, що може бути написано від руки: "№142-26", "№ 45-26", "142-26", "089-26", "№ 7-26", "зам. 312-26", "228-26".
   - У полі "handwrittenOrderNumber" обов'язково стандартизуй до формату "ххх-хх" (ТІЛЬКИ цифри та дефіс, БЕЗ знаку №, наприклад "142-26", "089-26", "45-26").
   - У полі "handwrittenRawText" вкажи точний текст, як він написаний рукою.
   - У полі "handwrittenLocation" вкажи точне місце, де знайдено рукописний напис.
   - У полі "handwrittenConfidence" вкажи 'high' (якщо чітко видно), 'medium' (якщо є сумніви в окремих цифрах), 'low' (якщо ледь розбірливо), або 'none' (якщо жодного рукописного напису немає).

3. НАЗВА КОМПАНІЇ ПОСТАЧАЛЬНИКА (supplierName) ТА ПОКУПЦЯ (buyerName):
   - СТРОГИЙ СТАНДАРТИЗОВАНИЙ ФОРМАТ: "ТОВ НАЗВА КОМПАНІЇ", ВСІ БУКВИ ВЕЛИКІ, БЕЗ ЛАПОК!
   - Приклади: "ТОВ ЛЕГНОПРОМ", "ТОВ ЕПІЦЕНТР К", "ТОВ ШОП ІНТЕРІОР", "ФОП ШЕВЧЕНКО І.В.".
   - КАТЕГОРИЧНО ЗАБОРОНЕНО ставити будь-які лапки (", ', «, ») чи залишати маленькі букви!
   - supplierName: Це компанія, яка виставила рахунок (продавець / постачальник / виконавець).
     ВАЖЛИВО: Назва постачальника НЕ МОЖЕ співпадати з назвою наших компаній!
   - buyerName: Це компанія-платник або одержувач товару/послуги. Знайди точний збіг зі СПИСКУ НАШИХ КОМПАНІЙ і приведи до формату "ТОВ НАЗВА" великими буквами без лапок.

4. НОМЕР ТА ДАТА РАХУНКУ:
   - invoiceNumber: Номер рахунку (наприклад "СФ-000124", "452-М").
   - invoiceDate: Дата виставлення у форматі РРРР-ММ-ДД (YYYY-MM-DD).

5. СУМА ТА ВАЛЮТА (АПРІОРНЕ ПРАВИЛО: СУМА ДОКУМЕНТА ЗАВЖДИ > 0):
   - У НАШІЙ БАЗІ ТА РОБОЧІЙ ПАПЦІ НЕ МОЖЕ БУТИ РАХУНКІВ АБО ПЛАТІЖОК З НУЛЬОВОЮ СУМОЮ (0 грн)!
   - Кожен фінансовий документ у цій системі має реальну грошову суму (наприклад, 96 932.88 грн, 15 400.00 грн тощо).
   - Шукай у документах поля: "Сума", "Сума цифрами", "Сума платежу", "Всього до сплати", "Разом", "Разом з ПДВ", "Всього", "Списано", "Сума у валюті рахунку", "Сума документа", або "Сума словами" (прописом).
   - УВАГА: В українських банківських платіжках та рахунках сума часто пишеться з пробілами, комами або дефісом (наприклад: "96 932,88", "96932,88 грн", "96 932.88", "96 932-88", "96 932 грн. 88 коп."). ТИ МУСИШ перетворити це на стандартне числове значення з крапкою 96932.88!
   - КАТЕГОРИЧНО ЗАБОРОНЕНО повертати 0, якщо на документі присутні будь-які грошові цифри чи суми словами!
   - ЗАПИШИ ЦЮ СУМУ В ОБИДВА ПОЛЯ: "totalAmount" ТА "amountPaid"!
   - currency: Валюта ("UAH", "USD", "EUR", "PLN").

6. ДЛЯ ПЛАТІЖОК (payment):
   - paymentNumber: номер платіжки (платіжної інструкції / квитанції)
   - paymentDate: дата проведення (РРРР-ММ-ДД)
   - payerName: платник (наша компанія, ВЕЛИКИМИ БУКВАМИ БЕЗ ЛАПОК, наприклад "ТОВ БУДМОНТАЖ-2026")
   - payeeName: одержувач (постачальник, ВЕЛИКИМИ БУКВАМИ БЕЗ ЛАПОК, наприклад "ТОВ МЕТІНВЕСТ-СМЦ")
   - amountPaid: точна сума оплати (наприклад 96932.88)
   - totalAmount: така сама точна сума оплати (наприклад 96932.88)
   - paymentPurpose: повне "Призначення платежу" дослівно
   - referencedInvoiceNumber: номер рахунку (або перелік через кому/дефіс, наприклад "142, 143", "СФ-000142, СФ-000143")
   - referencedInvoiceNumbers: МАСИВ УСІХ виявлених номерів рахунків (наприклад ["142", "143"] або ["СФ-000142", "СФ-000143", "125"]). УВАГА: В цілях економії коштів бухгалтер в одну платіжку часто вносить декілька оплачених рахунків одного й того ж постачальника (наприклад: "Оплата за товар згідно рах. № 142 від 10.02.26, № 143 від 12.02.26", "згідно рахунків 12-26, 15-26, 18-26"). ОБОВ'ЯЗКОВО витягни кожен окремий номер рахунку у цей масив!
   - referencedOrderNumber: внутрішній номер замовлення (ххх-хх), якщо згаданий у призначенні платежу

Виконай ретельний аналіз кожного пікселя документа та поверни валідний JSON згідно зі схемою.`;

    // Strategic model priority: flash-lite first (fastest, high capacity), then flash-latest and 3.7-flash
    const candidateModels = [
      'gemini-3.1-flash-lite',
      'gemini-flash-latest',
      'gemini-3.7-flash',
    ];
    let lastError: any = null;
    let parsedResult: any = null;

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    // Try models in cascade, with retries on 503 (high demand) or 429 (rate limit)
    for (const modelName of candidateModels) {
      let attempts = 0;
      const maxAttempts = 3;

      while (attempts < maxAttempts) {
        attempts++;
        try {
          const response = await ai.models.generateContent({
            model: modelName,
            contents: [
              {
                inlineData: {
                  mimeType: finalMimeType,
                  data: cleanBase64,
                },
              },
              {
                text: systemPrompt,
              },
            ],
            config: {
              responseMimeType: 'application/json',
              responseSchema: ocrResponseSchema,
              temperature: 0.1,
            },
          });

          let responseText = response.text || '';
          responseText = responseText.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();

          if (responseText) {
            parsedResult = JSON.parse(responseText);
            break; // successfully parsed
          }
        } catch (err: any) {
          lastError = err;
          const errMsg = err?.message || String(err);
          const isRetryable =
            errMsg.includes('503') ||
            errMsg.includes('UNAVAILABLE') ||
            errMsg.includes('high demand') ||
            errMsg.includes('429') ||
            errMsg.includes('RESOURCE_EXHAUSTED');

          console.warn(
            `Gemini OCR attempt with model ${modelName} (attempt ${attempts}/${maxAttempts}) failed:`,
            errMsg
          );

          if (isRetryable && attempts < maxAttempts) {
            // Jittered backoff (800ms, 1600ms)
            await sleep(800 * attempts + Math.floor(Math.random() * 300));
            continue;
          }
          break; // move to next candidate model
        }
      }

      if (parsedResult) {
        break;
      }
    }

    if (!parsedResult) {
      throw new Error(
        lastError?.message ||
        'Не вдалося розпізнати документ за допомогою Gemini AI. Перевірте якість файлу або формат.'
      );
    }

    // Additional post-processing & normalization
    // 1. Strictly format handwritten order number as xxx-xx without №
    if (parsedResult.handwrittenOrderNumber) {
      let norm = String(parsedResult.handwrittenOrderNumber).trim();
      norm = norm.replace(/^(№|No|N|#|зам\.?|замовлення)\s*/i, '');
      norm = norm.replace(/[№#]/g, '');
      norm = norm.replace(/\s+/g, '');
      if (!norm.includes('-') && /^\d{3,6}$/.test(norm) && norm.length >= 4) {
        const order = norm.slice(0, -2);
        const year = norm.slice(-2);
        norm = `${order}-${year}`;
      }
      parsedResult.handwrittenOrderNumber = norm;
    }

    // 2. Strictly format all company names to "ТОВ НАЗВА КОМПАНІЇ" (ALL UPPERCASE, NO QUOTES)
    if (parsedResult.supplierName) {
      parsedResult.supplierName = normalizeCompanyName(parsedResult.supplierName);
    }
    if (parsedResult.buyerName) {
      parsedResult.buyerName = normalizeCompanyName(parsedResult.buyerName);
    }
    if (parsedResult.payerName) {
      parsedResult.payerName = normalizeCompanyName(parsedResult.payerName);
    }
    if (parsedResult.payeeName) {
      parsedResult.payeeName = normalizeCompanyName(parsedResult.payeeName);
    }

    // Ensure amounts are properly parsed to numeric floats
    parsedResult.totalAmount = parseAmountToNumber(parsedResult.totalAmount);
    parsedResult.amountPaid = parseAmountToNumber(parsedResult.amountPaid);

    // Payment-specific normalization and cross-filling
    if (parsedResult.documentType === 'payment') {
      if (parsedResult.payerName && !parsedResult.buyerName) {
        parsedResult.buyerName = parsedResult.payerName;
      }
      if (parsedResult.payeeName && !parsedResult.supplierName) {
        parsedResult.supplierName = parsedResult.payeeName;
      }

      // If one is set and the other is not, synchronize them
      if (parsedResult.amountPaid > 0 && parsedResult.totalAmount <= 0) {
        parsedResult.totalAmount = parsedResult.amountPaid;
      } else if (parsedResult.totalAmount > 0 && parsedResult.amountPaid <= 0) {
        parsedResult.amountPaid = parsedResult.totalAmount;
      }

      // Regex fallback for amount in paymentPurpose or notes if still 0
      if (parsedResult.amountPaid <= 0 && (parsedResult.paymentPurpose || parsedResult.notes)) {
        const textToScan = `${parsedResult.paymentPurpose || ''} ${parsedResult.notes || ''}`;
        const amountRegex = /(?:сума|в сумі|на суму|у т\.ч\.|разом|списано|грн\.?|UAH)\s*[:=]?\s*([0-9\s]{1,12}[,\.][0-9]{2})/i;
        const match = textToScan.match(amountRegex);
        if (match && match[1]) {
          const parsed = parseAmountToNumber(match[1]);
          if (parsed > 0) {
            parsedResult.amountPaid = parsed;
            parsedResult.totalAmount = parsed;
          }
        }
      }

      // Try regex extraction of invoice numbers from paymentPurpose if not yet set
      const purpose = parsedResult.paymentPurpose || '';
      if (purpose) {
        // Find all invoice numbers mentioned in purpose
        // Examples: "рах. № 142 від 10.02.26, № 143 від 12.02.26", "згідно рах. 101, 102, 103", "СФ-12, СФ-14", "рах. №15/26"
        const foundNumbers = new Set<string>();

        if (Array.isArray(parsedResult.referencedInvoiceNumbers)) {
          parsedResult.referencedInvoiceNumbers.forEach((num: any) => {
            if (num && typeof num === 'string' && num.trim()) {
              foundNumbers.add(num.trim());
            }
          });
        }

        if (parsedResult.referencedInvoiceNumber) {
          const parts = String(parsedResult.referencedInvoiceNumber).split(/[,;+/&|\s]+/);
          parts.forEach((p) => {
            const clean = p.replace(/^(№|No|N|#)\s*/i, '').trim();
            if (clean.length >= 1) foundNumbers.add(clean);
          });
        }

        // Search patterns in purpose text
        const generalInvRegex = /(?:рахунк(?:и|ів|ами|ах|у|ом|ок)?|рах(?:унок|\.?)|СФ|СФ-|сч(?:ет|\.?)|інвойс(?:и|ів)?|№)\s*[:№#]?\s*([A-Za-zА-Яа-яІіЇїЄє0-9\-\/_]+(?:\s*(?:,|і|та|також|;|\/)\s*(?:№|No|#)?\s*[A-Za-zА-Яа-яІіЇїЄє0-9\-\/_]+)*)/gi;
        let match: RegExpExecArray | null;
        while ((match = generalInvRegex.exec(purpose)) !== null) {
          if (match[1]) {
            const tokens = match[1].split(/[\s,;+/&|]+|(?:та|і|також)/i);
            tokens.forEach((t) => {
              const cleaned = t.replace(/^(?:№|No|N|#|від|от|\.|\,)\s*/i, '').trim();
              if (cleaned.length >= 1 && !/^(від|от|року|р|грн|коп|без|пдв|до)$/i.test(cleaned)) {
                foundNumbers.add(cleaned);
              }
            });
          }
        }

        // Also search for standalone "№ 123" patterns
        const standaloneNoRegex = /(?:№|No|#)\s*([A-Za-zА-Яа-яІіЇїЄє0-9\-\/_]{1,25})/gi;
        while ((match = standaloneNoRegex.exec(purpose)) !== null) {
          if (match[1]) {
            const cleaned = match[1].trim();
            if (cleaned.length >= 1 && !/^(від|от|року|р|грн|коп|без|пдв|до)$/i.test(cleaned)) {
              foundNumbers.add(cleaned);
            }
          }
        }

        const uniqueInvoices = Array.from(foundNumbers);
        if (uniqueInvoices.length > 0) {
          parsedResult.referencedInvoiceNumbers = uniqueInvoices;
          if (!parsedResult.referencedInvoiceNumber) {
            parsedResult.referencedInvoiceNumber = uniqueInvoices.join(', ');
          }
        }
      }

      // Try regex extraction of order number from paymentPurpose if handwrittenOrderNumber is missing
      if (!parsedResult.handwrittenOrderNumber && parsedResult.paymentPurpose) {
        const orderMatch = parsedResult.paymentPurpose.match(/(?:зам(?:овлення|\.?)|код)\s*([0-9]{1,4}-[0-9]{2})/i);
        if (orderMatch && orderMatch[1]) {
          parsedResult.handwrittenOrderNumber = orderMatch[1].trim();
          parsedResult.referencedOrderNumber = orderMatch[1].trim();
        }
      }

      parsedResult.paymentStatus = 'Оплачено';
    } else if (parsedResult.documentType === 'invoice') {
      parsedResult.paymentStatus = 'Не оплачено';
    }

    // 3. TARGETED AMOUNT RESCUE (A priori rule: amount in this workspace can NEVER be 0)
    if ((parsedResult.totalAmount || 0) <= 0 && (parsedResult.amountPaid || 0) <= 0) {
      try {
        console.log(`[OCR Rescue] Document has 0 amount. Running targeted amount extraction with Gemini 3.7 Flash...`);
        const rescuePrompt = `КРИТИЧНО: Первинний аналіз повернув суму 0 грн, але в нашій системі АПРІОРІ НЕ МОЖЕ БУТИ РАХУНКІВ АБО ПЛАТІЖОК З НУЛЬОВОЮ СУМОЮ (0 грн)!
Уважно проскануй зображення цього документа і знайди ТОЧНУ ЧИСЛОВУ СУМУ ДО СПЛАТИ / СУМУ ПЛАТЕЖУ.
Шукай у полях 'Сума', 'Разом', 'Всього до сплати', 'Сума платежу', 'Списано', 'Всього з ПДВ', або 'Сума словами' (прописом).
Поверни JSON строго такого формату:
{
  "amount": 96932.88,
  "currency": "UAH"
}`;
        const rescueResponse = await ai.models.generateContent({
          model: 'gemini-3.7-flash',
          contents: [
            {
              inlineData: {
                mimeType: finalMimeType,
                data: cleanBase64,
              },
            },
            { text: rescuePrompt },
          ],
          config: {
            responseMimeType: 'application/json',
            temperature: 0.1,
          },
        });

        let rText = rescueResponse.text || '';
        rText = rText.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
        if (rText) {
          const parsedRescue = JSON.parse(rText);
          const rescuedAmount = parseAmountToNumber(parsedRescue.amount);
          if (rescuedAmount > 0) {
            parsedResult.totalAmount = rescuedAmount;
            parsedResult.amountPaid = rescuedAmount;
            if (parsedRescue.currency) {
              parsedResult.currency = parsedRescue.currency;
            }
          }
        }
      } catch (rescueErr) {
        console.warn('Targeted amount rescue error:', rescueErr);
      }
    }

    // Validation checks & warnings
    const warnings: string[] = [];

    const effectiveAmount = parsedResult.documentType === 'payment'
      ? (parsedResult.amountPaid || parsedResult.totalAmount || 0)
      : (parsedResult.totalAmount || 0);

    if (effectiveAmount <= 0) {
      warnings.push('Увага: Суму документа не вдалося розпізнати (вказано 0 грн). Будь ласка, перевірте та введіть суму вручну перед збереженням.');
    }

    if (ourCompanies.length > 0) {
      const lowerSupplier = (parsedResult.supplierName || '').toLowerCase();
      const matchedOur = ourCompanies.some((c: string) =>
        lowerSupplier.includes(c.toLowerCase()) || c.toLowerCase().includes(lowerSupplier)
      );
      if (matchedOur) {
        warnings.push('Увага: Постачальник схожий на одну з "Наших компаній". Перевірте коректність визначення сторін!');
      }
    }

    if (!parsedResult.handwrittenOrderNumber || parsedResult.handwrittenConfidence === 'none') {
      warnings.push('Рукописний номер замовлення (ххх-хх) не знайдено на документі або він нерозбірливий. Будь ласка, перевірте документ вручну.');
    }

    parsedResult.validationWarnings = warnings;

    return res.json({
      success: true,
      data: parsedResult,
      fileName,
    });
  } catch (error: any) {
    console.error('OCR Processing error:', error);
    let userFriendlyMessage = 'Помилка обробки документа через Gemini OCR.';
    const rawMsg = error?.message || String(error);
    if (rawMsg.includes('503') || rawMsg.includes('high demand') || rawMsg.includes('UNAVAILABLE')) {
      userFriendlyMessage = 'Сервіс Gemini тимчасово перевантажений. Будь ласка, натисніть "Повторити" через кілька секунд.';
    } else if (rawMsg.includes('429') || rawMsg.includes('RESOURCE_EXHAUSTED')) {
      userFriendlyMessage = 'Перевищено ліміт запитів до AI. Зачекайте кілька секунд та спробуйте знову.';
    } else if (rawMsg.includes('API key') || rawMsg.includes('GEMINI_API_KEY')) {
      userFriendlyMessage = 'Ключ Gemini API не знайдено або він недійсний.';
    } else if (rawMsg && !rawMsg.startsWith('{')) {
      userFriendlyMessage = rawMsg;
    }

    return res.status(500).json({
      success: false,
      error: userFriendlyMessage,
      details: rawMsg,
    });
  }
});

// Start Express and Vite middleware
async function startServer() {
  const distPath = path.join(process.cwd(), 'dist');
  const hasDist = fs.existsSync(path.join(distPath, 'index.html'));
  const isProduction = process.env.NODE_ENV === 'production' || (hasDist && process.env.NODE_ENV !== 'development');

  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Invoice OCR Processor running on http://0.0.0.0:${PORT} (${isProduction ? 'Production static' : 'Development Vite'})`);
  });
}

startServer();
