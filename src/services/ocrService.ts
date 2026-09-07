import { GoogleGenAI, Type, Schema } from '@google/genai';
import { OCRResult, InvoicePaymentStatus, ExistingSheetRow, ExistingPaymentRow, ProcessedDocument, DuplicateRowMatch } from '../types';

// WARNING: Client-side Gemini API key usage requested by user for fully autonomous Vercel SPA deployment.
// Key is retrieved from import.meta.env.VITE_GEMINI_API_KEY or localStorage.

function getClientGeminiApiKey(): string {
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GEMINI_API_KEY) {
    const key = String(import.meta.env.VITE_GEMINI_API_KEY).trim();
    if (key && key !== 'MY_GEMINI_API_KEY') return key;
  }
  if (typeof window !== 'undefined') {
    const fromStorage = localStorage.getItem('VITE_GEMINI_API_KEY') || localStorage.getItem('GEMINI_API_KEY');
    if (fromStorage && fromStorage.trim()) return fromStorage.trim();
  }
  return '';
}

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

async function executeClientSideGeminiOcr(params: {
  fileData: string;
  mimeType: string;
  fileName: string;
  ourCompanies: string[];
  suppliers: string[];
  knownOrders?: any[];
  apiKey: string;
}): Promise<OCRResult> {
  const {
    fileData,
    mimeType: rawMimeType,
    fileName,
    ourCompanies,
    suppliers,
    knownOrders,
    apiKey,
  } = params;

  const cleanBase64 = fileData.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
  const finalMimeType = detectAndNormalizeMimeType(cleanBase64, rawMimeType, fileName);

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-client-spa',
      },
    },
  });

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
   - referencedInvoiceNumbers: МАСИВ УСІХ виявлених номерів рахунків (наприклад ["142", "143"] або ["СФ-000142", "СФ-000143", "125"]).
   - referencedOrderNumber: внутрішній номер замовлення (ххх-хх), якщо згаданий у призначенні платежу

Виконай ретельний аналіз кожного пікселя документа та поверни валідний JSON згідно зі схемою.`;

  const candidateModels = [
    'gemini-flash-latest',
    'gemini-3.8-flash',
    'gemini-3.7-flash',
    'gemini-3.1-flash-lite',
  ];

  let lastError: any = null;
  let parsedResult: any = null;
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  for (const modelName of candidateModels) {
    let attempts = 0;
    const maxAttempts = 2;

    while (attempts < maxAttempts) {
      attempts++;
      try {
        const generatePromise = ai.models.generateContent({
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

        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Таймаут відповіді Gemini AI (${modelName})`)), 25000)
        );

        const response = await Promise.race([generatePromise, timeoutPromise]);

        let responseText = response.text || '';
        responseText = responseText.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();

        if (responseText) {
          parsedResult = JSON.parse(responseText);
          break;
        }
      } catch (err: any) {
        lastError = err;
        const errMsg = err?.message || String(err);
        const isRetryable =
          errMsg.includes('503') ||
          errMsg.includes('UNAVAILABLE') ||
          errMsg.includes('high demand') ||
          errMsg.includes('429') ||
          errMsg.includes('Таймаут') ||
          errMsg.includes('RESOURCE_EXHAUSTED');

        console.warn(`[Client-Side OCR] Model ${modelName} attempt ${attempts} failed:`, errMsg);

        if (isRetryable && attempts < maxAttempts) {
          await sleep(600 * attempts + Math.floor(Math.random() * 200));
          continue;
        }
        break;
      }
    }

    if (parsedResult) {
      break;
    }
  }

  if (!parsedResult) {
    throw new Error(lastError?.message || 'Не вдалося розпізнати документ за допомогою Gemini AI. Перевірте якість файлу або формат.');
  }

  // 1. Strictly format handwritten order number as xxx-xx without №
  if (parsedResult.handwrittenOrderNumber) {
    parsedResult.handwrittenOrderNumber = OCRService.normalizeOrderNumber(parsedResult.handwrittenOrderNumber);
  }

  // 2. Strictly format all company names to "ТОВ НАЗВА КОМПАНІЇ" (ALL UPPERCASE, NO QUOTES)
  if (parsedResult.supplierName) {
    parsedResult.supplierName = OCRService.normalizeCompanyName(parsedResult.supplierName);
  }
  if (parsedResult.buyerName) {
    parsedResult.buyerName = OCRService.normalizeCompanyName(parsedResult.buyerName);
  }
  if (parsedResult.payerName) {
    parsedResult.payerName = OCRService.normalizeCompanyName(parsedResult.payerName);
  }
  if (parsedResult.payeeName) {
    parsedResult.payeeName = OCRService.normalizeCompanyName(parsedResult.payeeName);
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

    const uniqueInvoices = OCRService.extractAllInvoiceNumbers(
      parsedResult.referencedInvoiceNumber,
      parsedResult.referencedInvoiceNumbers,
      parsedResult.paymentPurpose
    );
    if (uniqueInvoices.length > 0) {
      parsedResult.referencedInvoiceNumbers = uniqueInvoices;
      if (!parsedResult.referencedInvoiceNumber) {
        parsedResult.referencedInvoiceNumber = uniqueInvoices.join(', ');
      }
    }

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

  // 3. Targeted Amount Rescue if 0
  if ((parsedResult.totalAmount || 0) <= 0 && (parsedResult.amountPaid || 0) <= 0) {
    try {
      console.log(`[Client OCR Rescue] Document has 0 amount. Running targeted rescue with Gemini 3.7 Flash...`);
      const rescuePrompt = `КРИТИЧНО: Первинний аналіз повернув суму 0 грн, але в нашій системі АПРІОРІ НЕ МОЖЕ БУТИ РАХУНКІВ АБО ПЛАТІЖОК З НУЛЬОВОЮ СУМОЮ (0 грн)!
Уважно проскануй зображення цього документа і знайди ТОЧНУ ЧИСЛОВУ СУМУ ДО СПЛАТИ / СУМУ ПЛАТЕЖУ.
Шукай у полях 'Сума', 'Разом', 'Всього до сплати', 'Сума платежу', 'Списано', 'Всього з ПДВ', або 'Сума словами' (прописом).
Поверни JSON строго такого формату:
{
  "amount": 96932.88,
  "currency": "UAH"
}`;
      const rescueResponse = await ai.models.generateContent({
        model: 'gemini-flash-latest',
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
      console.warn('[Client OCR] Targeted amount rescue warning:', rescueErr);
    }
  }

  // Validation warnings
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

  return parsedResult as OCRResult;
}

export class OCRService {
  /**
   * Analyze document using Client-Side Gemini API directly (or backend fallback if available)
   */
  public static async analyzeDocument(params: {
    fileData: string; // base64 string
    mimeType: string;
    fileName: string;
    ourCompanies: string[];
    suppliers: string[];
    knownOrders?: any[];
    docTypeHint?: 'auto' | 'invoice' | 'payment';
  }): Promise<OCRResult> {
    const clientKey = getClientGeminiApiKey();

    // 1. Pure Client-Side execution using VITE_GEMINI_API_KEY
    if (clientKey) {
      try {
        return await executeClientSideGeminiOcr({
          ...params,
          apiKey: clientKey,
        });
      } catch (clientErr: any) {
        console.error('Client-side Gemini OCR Error:', clientErr);
        const msg = clientErr?.message || String(clientErr);
        if (msg.includes('503') || msg.includes('high demand') || msg.includes('UNAVAILABLE')) {
          throw new Error('Сервіс Google Gemini тимчасово перевантажений. Будь ласка, зачекайте кілька секунд і спробуйте знову.');
        }
        if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('Quota exceeded')) {
          throw new Error('Перевищено ліміт запитів до Gemini API (Rate limit / Quota). Зачекайте хвилину перед наступним розпізнаванням.');
        }
        if (msg.includes('API key not valid') || msg.includes('API_KEY_INVALID')) {
          throw new Error('Вказаний ключ Gemini API недійсний. Будь ласка, перевірте правильність ключа VITE_GEMINI_API_KEY.');
        }
        throw new Error(`Помилка клієнтського розпізнавання: ${msg}`);
      }
    }

    // 2. Fallback to /api/ocr/process (if running in full-stack dev server or Vercel serverless with GEMINI_API_KEY)
    let res: Response | null = null;
    let networkErrorMessage = '';

    const endpoints = ['/api/ocr/process', '/api/ocr'];
    for (const endpoint of endpoints) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 40000);
      try {
        res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(params),
          signal: controller.signal,
        });

        if (res.status !== 404) {
          // If we reached an endpoint that isn't 404, stick with this response
          break;
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          networkErrorMessage = 'Час очікування відповіді від OCR сервера вичерпано (таймаут 40 с).';
        } else {
          networkErrorMessage = err?.message || 'Помилка підключення до сервера';
        }
      } finally {
        clearTimeout(timeoutId);
      }
    }

    if (res) {
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data && data.success && data.data) {
          return data.data as OCRResult;
        }
        throw new Error(data?.error || 'Не вдалося розібрати відповідь від OCR сервера.');
      }

      // Handle non-200 responses with clean error diagnostics
      let serverError = '';
      try {
        const errData = await res.json();
        serverError = errData.error || errData.details || '';
      } catch {
        try {
          const text = await res.text();
          if (text && !text.includes('<!DOCTYPE') && !text.includes('<html')) {
            serverError = text;
          }
        } catch {}
      }

      if (serverError) {
        throw new Error(serverError);
      }

      if (res.status === 404) {
        throw new Error('Маршрут OCR (/api/ocr/process) повернув 404. Перевірте конфігурацію сервера або оновіть сторінку.');
      }
      if (res.status === 503) {
        throw new Error('Сервер або Gemini AI тимчасово перевантажені (503). Зачекайте кілька секунд і спробуйте знову.');
      }
      if (res.status === 413) {
        throw new Error('Файл занадто великий для обробки (413 Payload Too Large).');
      }

      throw new Error(`Помилка сервера OCR: ${res.status} ${res.statusText || ''}`);
    }

    if (networkErrorMessage) {
      throw new Error(`Не вдалося зʼєднатися із сервером: ${networkErrorMessage}`);
    }

    // 3. If neither client key nor backend is available, provide helpful guidance
    throw new Error(
      'Ключ Google Gemini API не налаштовано або сервер недоступний. Перевірте підключення або налаштування API key.'
    );
  }

  /**
   * Health check for client-side Gemini key and backend server
   */
  public static async checkServerHealth(): Promise<{ ok: boolean; hasGeminiKey: boolean; message?: string }> {
    const clientKey = getClientGeminiApiKey();
    if (clientKey) {
      return { 
        ok: true, 
        hasGeminiKey: true, 
        message: 'Клієнтський режим OCR (VITE_GEMINI_API_KEY) активний' 
      };
    }

    try {
      const res = await fetch('/api/health');
      if (res.ok) {
        const data = await res.json();
        return { ok: true, hasGeminiKey: Boolean(data.hasGeminiKey) };
      }
    } catch {
      // Static client without backend
    }

    return { 
      ok: false, 
      hasGeminiKey: false, 
      message: 'Вкажіть VITE_GEMINI_API_KEY у Vercel Environment Variables' 
    };
  }

  /**
   * Helper to format numbers nicely (e.g. 14500.50 -> 14 500,50 ₴)
   */
  public static formatCurrency(amount: number, currency: string = 'UAH'): string {
    const formattedNum = new Intl.NumberFormat('uk-UA', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount || 0);

    const symbols: Record<string, string> = {
      UAH: '₴',
      USD: '$',
      EUR: '€',
      PLN: 'zł',
      GBP: '£',
    };

    const symbol = symbols[currency?.toUpperCase()] || currency || '';
    return `${formattedNum} ${symbol}`.trim();
  }

  private static readonly HOMOGLYPHS: Record<string, string> = {
    'A': 'А', 'a': 'а',
    'B': 'В',
    'C': 'С', 'c': 'с',
    'E': 'Е', 'e': 'е',
    'H': 'Н',
    'I': 'І', 'i': 'і',
    'K': 'К', 'k': 'к',
    'M': 'М', 'm': 'м',
    'O': 'О', 'o': 'о',
    'P': 'Р', 'p': 'р',
    'T': 'Т', 't': 'т',
    'X': 'Х', 'x': 'х',
  };

  /**
   * Replaces common Latin homoglyphs (like Latin I in Ukrainian "ЛIНА") with Cyrillic equivalents
   */
  public static normalizeHomoglyphs(str: string): string {
    if (!str) return '';
    return str.replace(/[AaBCcEeHhIiKkMmOoPpTtXx]/g, (m) => this.HOMOGLYPHS[m] || m);
  }

  /**
   * Clean and normalize company name strictly to format: "ТОВ НАЗВА КОМПАНІЇ"
   * - ALL UPPERCASE letters
   * - NO quotation marks (", ', «, », “, ”, „)
   * - Unified legal form prefix (ТОВ, ФОП, ПП, ТДВ, ПРАТ, ПАТ, АТ, ДП)
   */
  public static normalizeCompanyName(input: string): string {
    if (!input) return '';
    let val = String(input).trim();

    // 0. Normalize Latin homoglyphs to Cyrillic
    val = this.normalizeHomoglyphs(val);

    // 1. Remove all types of quotes and brackets
    val = val.replace(/["'«»“”„‟`\(\)\[\]]/g, ' ');

    // 2. Expand/normalize full legal forms in Ukrainian
    val = val.replace(/Товариство\s+з\s+обмеженою\s+відповідальністю/gi, 'ТОВ');
    val = val.replace(/Приватне\s+підприємство/gi, 'ПП');
    val = val.replace(/Фізична\s+особа\s*[-–—]?\s*підприємець/gi, 'ФОП');
    val = val.replace(/Товариство\s+з\s+додатковою\s+відповідальністю/gi, 'ТДВ');
    val = val.replace(/Приватне\s+акціонерне\s+товариство/gi, 'ПРАТ');
    val = val.replace(/Публічне\s+акціонерне\s+товариство/gi, 'ПАТ');
    val = val.replace(/Акціонерне\s+товариство/gi, 'АТ');
    val = val.replace(/Державне\s+підприємство/gi, 'ДП');
    val = val.replace(/Торгов(?:ий|ого)\s+д(?:ім|ому|ом)/gi, 'ТД');

    // 2b. Remove dots from abbreviations (e.g. Т.Д. -> ТД, Т.О.В. -> ТОВ, Ф.О.П. -> ФОП)
    val = val.replace(/\b([А-Яа-яЇїІіЄєҐґA-Za-z])\.(?=[А-Яа-яЇїІіЄєҐґA-Za-z]\.?)/g, '$1');

    // 3. Remove punctuation like trailing/leading commas or dots around legal forms
    val = val.replace(/^(ТОВ|ФОП|ПП|ТДВ|ПРАТ|ПАТ|АТ|ДП)[.,\s]+/i, '$1 ');
    val = val.replace(/,\s*(ТОВ|ФОП|ПП|ТДВ|ПРАТ|ПАТ|АТ|ДП)$/i, ' $1');

    // 4. If legal form is at the end (e.g. "ЛЕГНОПРОМ ТОВ"), move it to front ONLY if there isn't already a legal form at the front
    const hasLeadingLegal = /^(ТОВ|ФОП|ПП|ТДВ|ПРАТ|ПАТ|АТ|ДП)\b/i.test(val);
    if (!hasLeadingLegal) {
      const trailingFormMatch = val.match(/^(.+?)\s+(ТОВ|ФОП|ПП|ТДВ|ПРАТ|ПАТ|АТ|ДП)$/i);
      if (trailingFormMatch) {
        val = `${trailingFormMatch[2]} ${trailingFormMatch[1]}`;
      }
    }

    // 4b. Remove duplicate repeated legal forms at the front (e.g. "ТОВ ТОВ ЛЕГНОПРОМ" -> "ТОВ ЛЕГНОПРОМ")
    val = val.replace(/^(ТОВ|ФОП|ПП|ТДВ|ПРАТ|ПАТ|АТ|ДП)\s+(?:(ТОВ|ФОП|ПП|ТДВ|ПРАТ|ПАТ|АТ|ДП)\s+)+/i, '$1 ');

    // 4c. Remove repeated identical consecutive words (e.g. "ЛЕГНОПРОМ ЛЕГНОПРОМ" -> "ЛЕГНОПРОМ")
    val = val.replace(/([А-Яа-яЇїІіЄєҐґA-Za-z0-9\-]+)\s+\1(?=\s|$)/gi, '$1');

    // 5. Clean up multiple spaces and trim
    val = val.replace(/\s+/g, ' ').trim();

    // 6. Convert entirely to UPPERCASE
    return val.toUpperCase();
  }

  /**
   * Helper to extract distinctive significant tokens from a company name
   * (filtering out generic legal forms and common business terms like "КОМПАНІЯ", "ФІРМА")
   */
  public static getDistinctiveCompanyTokens(name: string): string[] {
    let s = this.normalizeHomoglyphs(name || '').toUpperCase();
    s = s.replace(/["'«»“”„‟`\.,\/\\()\[\]]/g, ' ');
    s = s.replace(/[-–—]/g, ' ');
    s = s.replace(/\s+/g, ' ').trim();
    const tokens = s.split(' ').filter(Boolean);
    const stopWords = new Set([
      'ТОВ', 'ФОП', 'ПП', 'ТДВ', 'ПРАТ', 'ПАТ', 'АТ', 'ДП', 'LLC',
      'КОМПАНІЯ', 'ФІРМА', 'ПІДПРИЄМСТВО', 'ТОВАРИСТВО', 'ОБМЕЖЕНОЮ', 'ВІДПОВІДАЛЬНІСТЮ',
      'ПРИВАТНЕ', 'ФІЗИЧНА', 'ОСОБА', 'ПІДПРИЄМЕЦЬ', 'ТОРГОВИЙ', 'ДІМ',
      'КИЇВ', 'УКРАЇНА', 'ЦЕНТР', 'ГРУП', 'ТРЕЙД', 'СЕРВІС', 'ПЛЮС', 'ЛТД',
      'ТОРГ', 'БУД', 'МАРКЕТ', 'СВІТ', 'СИСТЕМИ', 'ТЕХНОЛОГІЇ'
    ]);
    return tokens.filter((t) => !stopWords.has(t));
  }

  /**
   * Check if two company names refer to the same company.
   * Strips legal form prefixes (ТОВ, ФОП, ПП, etc.), handles hyphens/dots/homoglyphs,
   * and compares core names and distinctive word tokens.
   */
  public static isCompanyNameMatch(name1: string, name2: string): boolean {
    if (!name1 || !name2) return false;
    if (name1.trim().toLowerCase() === name2.trim().toLowerCase()) return true;

    const n1 = this.normalizeCompanyName(name1);
    const n2 = this.normalizeCompanyName(name2);
    if (!n1 || !n2) return false;
    if (n1 === n2) return true;

    // 1. Compare with all punctuation, hyphens, and dots replaced by spaces
    const clean1 = n1.replace(/[-–—\.,\/\\()]/g, ' ').replace(/\s+/g, ' ').trim();
    const clean2 = n2.replace(/[-–—\.,\/\\()]/g, ' ').replace(/\s+/g, ' ').trim();
    if (clean1 === clean2) return true;

    // 2. Strip legal prefixes (ТОВ, ФОП, ПП, ТДВ, ПРАТ, ПАТ, АТ, ДП, ТД)
    const legalPrefixRegex = /^(ТОВ|ФОП|ПП|ТДВ|ПРАТ|ПАТ|АТ|ДП|ТД)\s+/i;
    const core1 = clean1.replace(legalPrefixRegex, '').trim();
    const core2 = clean2.replace(legalPrefixRegex, '').trim();

    if (!core1 || !core2) return false;
    if (core1 === core2) return true;

    // Generic words that must not match just because both companies contain them
    const genericWords = new Set([
      'КИЇВ', 'УКРАЇНА', 'ЦЕНТР', 'ГРУП', 'ТРЕЙД', 'СЕРВІС',
      'ПЛЮС', 'ЛТД', 'ТОРГ', 'БУД', 'МАРКЕТ', 'СВІТ', 'СИСТЕМИ', 'ТЕХНОЛОГІЇ', 'КОМПАНІЯ'
    ]);
    if (genericWords.has(core1) || genericWords.has(core2)) {
      return core1 === core2;
    }

    // High confidence substring match for specific company names (e.g. "КОМПАНІЯ ЛІНА ТД" and "ЛІНА ТД")
    if (core1.length >= 5 && core2.length >= 5) {
      if (core1.includes(core2) || core2.includes(core1)) {
        return true;
      }
    }

    // 3. Significant distinctive token comparison (e.g. "ТОВ КОМПАНІЯ ЛІНА ТД" vs "ТОВ «КОМПАНІЯ «ЛІНА-ТД»" or "ТОВ ЛІНА ТД")
    const tokens1 = this.getDistinctiveCompanyTokens(name1);
    const tokens2 = this.getDistinctiveCompanyTokens(name2);
    if (tokens1.length > 0 && tokens2.length > 0) {
      const set2 = new Set(tokens2);
      const common = tokens1.filter((t) => set2.has(t));
      // If they share at least one distinctive token of length >= 4 (like "ЛІНА")
      const distinctiveShared = common.filter((t) => t.length >= 4);
      if (distinctiveShared.length > 0) {
        return true;
      }
      // Or if all tokens of the shorter name are contained in the longer name
      const shorter = tokens1.length <= tokens2.length ? tokens1 : tokens2;
      const longer = new Set(tokens1.length <= tokens2.length ? tokens2 : tokens1);
      if (shorter.length > 0 && shorter.every((t) => longer.has(t))) {
        return true;
      }
    }

    return false;
  }

  /**
   * Safely checks if an invoice number is mentioned in a payment purpose string.
   * Avoids matching random substrings (e.g. "26" in year 2026 or account number).
   */
  public static isInvoiceNumberMentionedInPurpose(cleanInvNum: string, purpose: string): boolean {
    if (!cleanInvNum || !purpose || cleanInvNum.length < 2) return false;
    const lowerPurpose = purpose.toLowerCase();

    // Check extracted invoice tokens from purpose
    const extracted = this.extractAllInvoiceNumbers(undefined, undefined, purpose);
    const cleanExtracted = extracted.map((e) => this.normalizeInvoiceNumber(e)).filter(Boolean);
    if (cleanExtracted.includes(cleanInvNum)) return true;

    // Check keyword-based pattern: e.g. "рах 3540", "№ 3540", "рахунку 3540", "сф 3540"
    const escaped = cleanInvNum.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(
      `(?:рахун(?:ок|ку|ком|ки|ків)?|рах(?:унок|\\.?)|сф[-_]?|інвойс(?:и|ів)?|№|no\\.?|n\\.?)\\s*[:#№]?\\s*(?:[A-Za-zА-Яа-я0-9\\-_]*\\/)*${escaped}(?!\\d)`,
      'i'
    );
    if (regex.test(lowerPurpose)) return true;

    // Standalone number surrounded by word boundaries or non-digits (for 4+ digit numbers)
    if (cleanInvNum.length >= 4 && /^\d+$/.test(cleanInvNum)) {
      const standaloneRegex = new RegExp(`(?:^|[^\\d])${escaped}(?:[^\\d]|$)`);
      if (standaloneRegex.test(lowerPurpose)) {
        // Exclude dates (e.g. dd.mm.yyyy or yyyy-mm-dd)
        const dateContextRegex = new RegExp(`(?:\\d{2}\\.\\d{2}\\.|\\d{4}[-./])${escaped}|${escaped}[-./]\\d{2}[-./]`);
        if (!dateContextRegex.test(lowerPurpose)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Clean and normalize handwritten order number strictly to format xxx-xx WITHOUT symbol №
   * E.g. "№142-26" -> "142-26", "зам. 89-26" -> "89-26", "12326" -> "123-26"
   */
  public static normalizeOrderNumber(input: string): string {
    if (!input) return '';
    let val = input.trim();
    
    // Remove leading symbols and keywords: №, No, N, #, зам, замовлення
    val = val.replace(/^(№|No|N|#|зам\.?|замовлення)\s*/i, '');
    val = val.replace(/[№#]/g, '');
    val = val.replace(/\s+/g, '');
    
    // Check if it already has dash (e.g. 142-26)
    if (val.includes('-')) {
      return val;
    }

    // If e.g. 12326 where last 2 digits is year
    if (/^\d{3,6}$/.test(val) && val.length >= 4) {
      const order = val.slice(0, -2);
      const year = val.slice(-2);
      return `${order}-${year}`;
    }

    return val;
  }

  /**
   * Clean and normalize invoice number for fuzzy/exact matching.
   * Strips prefix "№", "No", "рах", "СФ-000", leading zeroes, spaces.
   * E.g. "СФ-000452" -> "452", "№ 124-М" -> "124-м"
   */
  public static normalizeInvoiceNumber(input: string): string {
    if (!input) return '';
    let val = String(input).trim().toLowerCase();
    // Remove "№", "no", "n", "#", "рах.", "рахунок", "сф-", "сф", "інвойс"
    val = val.replace(/^(?:№|no|n|#|рах\.?|рахунок|сф[-_]?|інвойс)\s*/i, '');
    val = val.replace(/[№#]/g, '');
    val = val.replace(/\s+/g, '');
    // Strip leading zeroes if it's purely digits (e.g. 000452 -> 452)
    val = val.replace(/^0+(\d+)/, '$1');
    return val;
  }

  /**
   * Helper to check if a string is a placeholder invoice/payment number (e.g. "б/н", "-", "none")
   */
  public static isPlaceholderNumber(num?: string): boolean {
    if (!num) return true;
    const s = num.trim().toLowerCase();
    if (s.length < 2) return true;
    // Date strings like 2026-08-25 or 25.08.2026
    if (/^\d{4}[-./]\d{2}[-./]\d{2}$/.test(s) || /^\d{2}[-./]\d{2}[-./]\d{4}$/.test(s)) return true;
    const placeholders = new Set([
      'б/н', 'бн', 'б.н.', 'б/н.', 'безномера', 'без_номера', 'без-номера',
      'n/a', 'na', 'none', 'null', '-', '--', '—', '0', '00', '000',
      'рахунок', 'інвойс', 'счет'
    ]);
    return placeholders.has(s);
  }

  /**
   * Extract all invoice number tokens from raw text, strings, or arrays
   */
  public static extractAllInvoiceNumbers(
    referencedInvoiceNumber?: string,
    referencedInvoiceNumbers?: string[],
    paymentPurpose?: string
  ): string[] {
    const found = new Set<string>();

    if (Array.isArray(referencedInvoiceNumbers)) {
      referencedInvoiceNumbers.forEach((n) => {
        if (n && typeof n === 'string' && n.trim()) {
          found.add(n.trim());
        }
      });
    }

    if (referencedInvoiceNumber) {
      // Split by commas, semicolons, slashes, whitespace
      const tokens = String(referencedInvoiceNumber).split(/[,;+/&|\s]+/);
      tokens.forEach((t) => {
        const clean = t.replace(/^(?:№|No|N|#|рах\.?|рахунок|сф[-_]?|інвойс)\s*/i, '').trim();
        if (clean.length >= 1 && !/^(від|от|року|р|грн|коп|без|пдв|до|та|і)$/i.test(clean)) {
          found.add(clean);
        }
      });
    }

    if (paymentPurpose) {
      // Check for invoice keywords: рахунок, рах, СФ, інвойс
      const generalInvRegex = /(?:рахунк(?:и|ів|ами|ах|у|ом|ок)?|рах(?:унок|\.?)|СФ|СФ-|сч(?:ет|\.?)|інвойс(?:и|ів)?)\s*[:№#]?\s*([A-Za-zА-Яа-яІіЇїЄє0-9\-\/_]+(?:\s*(?:,|і|та|також|;|\/)\s*(?:№|No|#)?\s*[A-Za-zА-Яа-яІіЇїЄє0-9\-\/_]+)*)/gi;
      let match: RegExpExecArray | null;
      while ((match = generalInvRegex.exec(paymentPurpose)) !== null) {
        if (match[1]) {
          const tokens = match[1].split(/[\s,;+/&|]+|(?:та|і|також)/i);
          tokens.forEach((t) => {
            const cleaned = t.replace(/^(?:№|No|N|#|від|от|\.|\,)\s*/i, '').trim();
            if (cleaned.length >= 1 && !/^(від|от|року|р|грн|коп|без|пдв|до)$/i.test(cleaned)) {
              found.add(cleaned);
            }
          });
        }
      }

      // Check for standalone "№ 123" only if NOT preceded by contract/order/bank keywords
      const nakedNumRegex = /(?<!(?:договір|договору|договором|контракт|контракту|наказ|наказу|п\/п|п\/р|р\/р|iban|код|єдрпоу|акта|акт)\s*)(?:№|No|#)\s*([A-Za-zА-Яа-яІіЇїЄє0-9\-\/_]+)/gi;
      let nakedMatch: RegExpExecArray | null;
      while ((nakedMatch = nakedNumRegex.exec(paymentPurpose)) !== null) {
        if (nakedMatch[1]) {
          const cleaned = nakedMatch[1].replace(/^(?:від|от|\.|\,)\s*/i, '').trim();
          if (
            cleaned.length >= 1 &&
            !/^(від|от|року|р|грн|коп|без|пдв|до)$/i.test(cleaned) &&
            !/^\d{2}\.\d{2}\.\d{4}$/.test(cleaned)
          ) {
            found.add(cleaned);
          }
        }
      }
    }

    return Array.from(found);
  }

  /**
   * Match payment with multiple invoices.
   * In Ukrainian accounting, an accountant may combine several invoices from the same supplier in one payment order.
   * This method finds ALL matching invoices from the "Рахунки" sheet and local docs,
   * checks if the total payment covers each invoice (or all of them combined),
   * and calculates the proper payment status ("Оплачено" / "Оплачено частково") for each.
   */
  public static matchPaymentWithAllInvoices(
    paymentOcr: OCRResult,
    existingInvoices: ExistingSheetRow[] = [],
    localDocuments: ProcessedDocument[] = []
  ): Array<{
    invoiceNumber: string;
    orderNumber?: string;
    invoiceAmount: number;
    previousPaidAmount?: number;
    paidAmount?: number;
    computedStatus: InvoicePaymentStatus;
    matchedRowIndex?: number;
    matchedDocId?: string;
    matchReason?: string;
  }> {
    const paymentAmount = paymentOcr.amountPaid || paymentOcr.totalAmount || 0;
    const refNumbers = this.extractAllInvoiceNumbers(
      paymentOcr.referencedInvoiceNumber,
      paymentOcr.referencedInvoiceNumbers,
      paymentOcr.paymentPurpose
    );
    const cleanRefNumbers = refNumbers.map((n) => this.normalizeInvoiceNumber(n)).filter(Boolean);
    const refOrder = this.normalizeOrderNumber(paymentOcr.referencedOrderNumber || paymentOcr.handwrittenOrderNumber || '').toLowerCase();
    const purpose = (paymentOcr.paymentPurpose || '').toLowerCase();
    const payeeName = this.normalizeCompanyName(paymentOcr.payeeName || paymentOcr.supplierName || '');

    const matches: Array<{
      invoiceNumber: string;
      orderNumber?: string;
      invoiceAmount: number;
      previousPaidAmount?: number;
      paidAmount?: number;
      computedStatus: InvoicePaymentStatus;
      matchedRowIndex?: number;
      matchedDocId?: string;
      matchReason?: string;
    }> = [];

    const matchedRowIndices = new Set<number>();
    const matchedDocIds = new Set<string>();

    // 1. Scan existing sheet rows for matches
    for (const inv of existingInvoices) {
      if (inv.rowIndex && matchedRowIndices.has(inv.rowIndex)) continue;

      const rawInvNum = (inv.invoiceNumber || '').trim();
      const cleanInvNum = this.normalizeInvoiceNumber(rawInvNum);
      const cleanOrderNum = this.normalizeOrderNumber(inv.orderNumber || '').toLowerCase();
      const invSupplier = this.normalizeCompanyName(inv.supplier || '');
      const invAmount = inv.amount || 0;

      const isDateString = (s: string) => /^\d{4}[-./]\d{2}[-./]\d{2}$/.test(s.trim()) || /^\d{2}[-./]\d{2}[-./]\d{4}$/.test(s.trim());
      const isInvNumActuallyDate = isDateString(rawInvNum);

      // Criterion A: Match against any extracted invoice number from the payment (ignore if invoiceNumber is just a date)
      const hasInvNumMatch =
        !isInvNumActuallyDate &&
        cleanInvNum.length >= 2 &&
        (cleanRefNumbers.includes(cleanInvNum) ||
          this.isInvoiceNumberMentionedInPurpose(cleanInvNum, purpose) ||
          cleanRefNumbers.some(
            (crn) => crn === cleanInvNum || (crn.length >= 4 && cleanInvNum.length >= 4 && (crn.includes(cleanInvNum) || cleanInvNum.includes(crn)))
          ));

      // Criterion B: Match by Supplier / Payee
      const isSupplierMatch = Boolean(
        payeeName &&
        invSupplier &&
        (this.isCompanyNameMatch(invSupplier, payeeName) ||
          (invSupplier.length >= 5 && purpose.includes(invSupplier.toLowerCase())))
      );

      // Criterion C: Match by Amount
      const isAmountMatch = paymentAmount > 0 && invAmount > 0 && Math.abs(paymentAmount - invAmount) <= 0.50;

      // Criterion D: Match by Order Number
      const isOrderMatch = Boolean(
        cleanOrderNum &&
        (cleanOrderNum === refOrder ||
          purpose.includes(cleanOrderNum) ||
          (refOrder && cleanOrderNum.includes(refOrder)))
      );

      // Check if payment purpose specifies a different invoice number
      // If invoice has no real invoice number (placeholder or empty), it CANNOT contradict!
      const isCleanInvPlaceholder = this.isPlaceholderNumber(cleanInvNum);
      const hasContradictingInvoice =
        !isCleanInvPlaceholder &&
        cleanRefNumbers.length > 0 &&
        !cleanRefNumbers.includes(cleanInvNum) &&
        !hasInvNumMatch;

      // Valid conditions:
      const matchByInvoiceNum = hasInvNumMatch && (!payeeName || !invSupplier || isSupplierMatch);
      // When payee/supplier matches and amount matches down to kopecks, it is a definitive match
      const matchBySupplierAndAmount = isSupplierMatch && isAmountMatch && (!hasContradictingInvoice || Math.abs(paymentAmount - invAmount) <= 0.05);
      const matchByOrderSupplierAndAmount = isOrderMatch && isSupplierMatch && isAmountMatch;

      if (matchByInvoiceNum || matchBySupplierAndAmount || matchByOrderSupplierAndAmount) {
        let reason = '';
        if (matchByInvoiceNum) {
          reason = `Співпадіння за номером рахунку "${inv.invoiceNumber}"`;
        } else if (matchByOrderSupplierAndAmount) {
          reason = `Співпадіння за замовленням "${inv.orderNumber}", постачальником "${inv.supplier}" та сумою (${inv.amount} грн)`;
        } else {
          reason = `Співпадіння за постачальником "${inv.supplier}" та сумою (${inv.amount} грн)`;
        }

        if (inv.rowIndex) matchedRowIndices.add(inv.rowIndex);

        matches.push({
          invoiceNumber: inv.invoiceNumber,
          orderNumber: inv.orderNumber,
          invoiceAmount: invAmount,
          previousPaidAmount: inv.paidAmount || 0,
          paidAmount: invAmount, // will be computed in step 3
          computedStatus: 'Оплачено',
          matchedRowIndex: inv.rowIndex,
          matchReason: reason,
        });
      }
    }

    // 2. Scan local document list for any not yet covered in sheet rows
    for (const doc of localDocuments) {
      if (matchedDocIds.has(doc.id)) continue;
      const ocr = doc.editedData || doc.ocrResult;
      if (!ocr || ocr.documentType !== 'invoice') continue;

      const rawInvNum = (ocr.invoiceNumber || '').trim();
      const cleanInvNum = this.normalizeInvoiceNumber(rawInvNum);
      const cleanOrderNum = this.normalizeOrderNumber(ocr.handwrittenOrderNumber || '').toLowerCase();
      const invSupplier = this.normalizeCompanyName(ocr.supplierName || '');
      const invAmount = ocr.totalAmount || 0;
      const isDatePattern = (s: string) => /^\d{4}[-./]\d{2}[-./]\d{2}$/.test(s.trim()) || /^\d{2}[-./]\d{2}[-./]\d{4}$/.test(s.trim());

      // Check if this local document corresponds to an already matched sheet row (prevent duplicate counting)
      const existingSheetMatch = matches.find((m) => {
        const mInv = this.normalizeInvoiceNumber(m.invoiceNumber);
        const mOrd = this.normalizeOrderNumber(m.orderNumber || '').toLowerCase();

        // 1. Same or substring invoice number
        if (cleanInvNum && mInv && (mInv === cleanInvNum || mInv.includes(cleanInvNum) || cleanInvNum.includes(mInv))) {
          return true;
        }

        // 2. Same order number AND same amount (within 0.50 грн)
        if (cleanOrderNum && mOrd && cleanOrderNum === mOrd && Math.abs(invAmount - m.invoiceAmount) <= 0.50) {
          return true;
        }

        // 3. Same supplier and same amount when payment covers just this one
        if (
          Math.abs(invAmount - m.invoiceAmount) <= 0.50 &&
          Math.abs(paymentAmount - invAmount) <= 0.50 &&
          invSupplier &&
          m.matchReason?.toLowerCase().includes(invSupplier.toLowerCase())
        ) {
          return true;
        }

        return false;
      });

      if (existingSheetMatch) {
        // Link docId so this document is known to be matched
        matchedDocIds.add(doc.id);
        existingSheetMatch.matchedDocId = doc.id;

        // If the sheet row's invoice number is missing, empty, or formatted as a date, upgrade it with the document's real invoice number
        if ((!existingSheetMatch.invoiceNumber || isDatePattern(existingSheetMatch.invoiceNumber)) && ocr.invoiceNumber) {
          existingSheetMatch.invoiceNumber = ocr.invoiceNumber;
        }
        if (!existingSheetMatch.orderNumber && ocr.handwrittenOrderNumber) {
          existingSheetMatch.orderNumber = ocr.handwrittenOrderNumber;
        }
        continue;
      }

      const hasInvNumMatch =
        !isDatePattern(rawInvNum) &&
        cleanInvNum.length >= 2 &&
        (cleanRefNumbers.includes(cleanInvNum) ||
          this.isInvoiceNumberMentionedInPurpose(cleanInvNum, purpose) ||
          cleanRefNumbers.some(
            (crn) => crn === cleanInvNum || (crn.length >= 4 && cleanInvNum.length >= 4 && (crn.includes(cleanInvNum) || cleanInvNum.includes(crn)))
          ));

      const isSupplierMatch = Boolean(
        payeeName &&
        invSupplier &&
        (this.isCompanyNameMatch(invSupplier, payeeName) ||
          (invSupplier.length >= 5 && purpose.includes(invSupplier.toLowerCase())))
      );

      const isAmountMatch = paymentAmount > 0 && invAmount > 0 && Math.abs(paymentAmount - invAmount) <= 0.50;

      const isOrderMatch = Boolean(
        cleanOrderNum &&
        (cleanOrderNum === refOrder ||
          purpose.includes(cleanOrderNum) ||
          (refOrder && cleanOrderNum.includes(refOrder)))
      );

      const hasContradictingInvoice =
        cleanRefNumbers.length > 0 &&
        !cleanRefNumbers.includes(cleanInvNum) &&
        !hasInvNumMatch;

      const matchByInvoiceNum = hasInvNumMatch && (!payeeName || !invSupplier || isSupplierMatch);
      const matchBySupplierAndAmount = isSupplierMatch && isAmountMatch && !hasContradictingInvoice;
      const matchByOrderSupplierAndAmount = isOrderMatch && isSupplierMatch && isAmountMatch && !hasContradictingInvoice;

      if (matchByInvoiceNum || matchBySupplierAndAmount || matchByOrderSupplierAndAmount) {
        let reason = '';
        if (matchByInvoiceNum) {
          reason = `Співпадіння за локальним рахунком "${ocr.invoiceNumber}"`;
        } else if (matchByOrderSupplierAndAmount) {
          reason = `Співпадіння за замовленням "${ocr.handwrittenOrderNumber}", постачальником "${ocr.supplierName}" та сумою (${ocr.totalAmount} грн)`;
        } else {
          reason = `Співпадіння за постачальником "${ocr.supplierName}" та сумою (${ocr.totalAmount} грн)`;
        }

        matchedDocIds.add(doc.id);

        matches.push({
          invoiceNumber: ocr.invoiceNumber,
          orderNumber: ocr.handwrittenOrderNumber,
          invoiceAmount: invAmount,
          previousPaidAmount: (doc.editedData?.amountPaid || ocr.amountPaid || 0),
          paidAmount: invAmount,
          computedStatus: 'Оплачено',
          matchedDocId: doc.id,
          matchReason: reason,
        });
      }
    }

    // 3. Compute status for all matched invoices based on payment amount & cumulative partial payments (доплати)
    if (matches.length > 0) {
      if (matches.length === 1) {
        // Single invoice in payment order: can be full payment, partial/prepayment, or additional payment (доплата)
        const single = matches[0];
        const prevPaid = single.previousPaidAmount || 0;

        if (paymentAmount > 0) {
          const newTotalPaid = prevPaid + paymentAmount;

          if (newTotalPaid >= (single.invoiceAmount - 0.50)) {
            // Reached 100% full payment
            single.computedStatus = 'Оплачено';
            single.paidAmount = Math.max(single.invoiceAmount, newTotalPaid);
            if (prevPaid > 0) {
              single.matchReason = `${single.matchReason || ''} (Доплата до повного розрахунку: було ${prevPaid} грн + ${paymentAmount} грн = ${newTotalPaid} грн)`.trim();
            }
          } else {
            // Partial payment / Additional partial payment (доплата)
            single.computedStatus = 'Оплачено частково';
            single.paidAmount = newTotalPaid;
            if (prevPaid > 0) {
              single.matchReason = `${single.matchReason || ''} (Чергова доплата: було ${prevPaid} грн + нова доплата ${paymentAmount} грн = разом ${newTotalPaid} грн з ${single.invoiceAmount} грн)`.trim();
            }
          }
        } else {
          single.computedStatus = 'Оплачено';
          single.paidAmount = single.invoiceAmount;
        }
      } else {
        // Multiple invoices in single payment order:
        // Бізнес-правило: якщо рахунок є в груповій платіжці, він автоматично вважається
        // оплаченим на 100%, а сума оплати береться з суми самого рахунку.
        for (const m of matches) {
          m.computedStatus = 'Оплачено';
          m.paidAmount = m.invoiceAmount;
        }
      }
    }

    return matches;
  }

  /**
   * Determine matching invoice for a payment document and calculate status (backward compatible single-result wrapper)
   */
  public static matchPaymentWithInvoices(
    paymentOcr: OCRResult,
    existingInvoices: ExistingSheetRow[] = [],
    localDocuments: ProcessedDocument[] = []
  ): {
    matchedInvoiceNumber?: string;
    matchedOrderNumber?: string;
    invoiceAmount?: number;
    matchedInvoicePreviousPaid?: number;
    paymentAmount?: number;
    computedStatus: InvoicePaymentStatus;
    matchedRowIndex?: number;
    matchedDocId?: string;
    matchReason?: string;
    matchedInvoices?: Array<{
      invoiceNumber: string;
      orderNumber?: string;
      invoiceAmount: number;
      previousPaidAmount?: number;
      paidAmount?: number;
      computedStatus: InvoicePaymentStatus;
      matchedRowIndex?: number;
      matchedDocId?: string;
      matchReason?: string;
    }>;
  } {
    const paymentAmount = paymentOcr.amountPaid || paymentOcr.totalAmount || 0;
    const allMatches = this.matchPaymentWithAllInvoices(paymentOcr, existingInvoices, localDocuments);

    if (allMatches.length === 0) {
      return {
        paymentAmount,
        computedStatus: 'Не оплачено',
        matchedInvoices: [],
      };
    }

    const first = allMatches[0];
    const totalInvAmount = allMatches.reduce((acc, m) => acc + (m.invoiceAmount || 0), 0);
    const invoiceNumbersList = allMatches.map((m) => m.invoiceNumber).filter(Boolean).join(', ');
    const orderNumbersList = Array.from(new Set(allMatches.map((m) => m.orderNumber).filter(Boolean))).join(', ');

    return {
      matchedInvoiceNumber: invoiceNumbersList || first.invoiceNumber,
      matchedOrderNumber: orderNumbersList || first.orderNumber,
      invoiceAmount: totalInvAmount || first.invoiceAmount,
      matchedInvoicePreviousPaid: first.previousPaidAmount,
      paymentAmount,
      computedStatus: first.computedStatus,
      matchedRowIndex: first.matchedRowIndex,
      matchedDocId: first.matchedDocId,
      matchReason: allMatches.length > 1 
        ? `Знайдено ${allMatches.length} рахунків у таблиці (${invoiceNumbersList})` 
        : first.matchReason,
      matchedInvoices: allMatches,
    };
  }

  /**
   * Determine matching payment(s) for an invoice document and calculate status.
   * Handles the workflow where a payment was uploaded or synced FIRST to "Платіжки",
   * and later the invoice is uploaded. The system automatically links them and sets
   * the invoice status to "Оплачено" or "Оплачено частково".
   */
  public static matchInvoiceWithPayments(
    invoiceOcr: OCRResult,
    existingPayments: ExistingPaymentRow[] = [],
    localDocuments: ProcessedDocument[] = []
  ): {
    matchedPaymentNumbers: string[];
    totalPaidAmount: number;
    computedStatus: InvoicePaymentStatus;
    matchedPaymentRows: ExistingPaymentRow[];
    matchReason?: string;
  } {
    const rawInvNum = (invoiceOcr.invoiceNumber || '').trim();
    const cleanInvNum = this.normalizeInvoiceNumber(rawInvNum);
    const rawOrderNum = (invoiceOcr.handwrittenOrderNumber || '').trim();
    const cleanOrderNum = this.normalizeOrderNumber(rawOrderNum).toLowerCase();
    const supplier = this.normalizeCompanyName(invoiceOcr.supplierName || '');
    const invAmount = invoiceOcr.totalAmount || 0;

    const isDateString = (s: string) =>
      /^\d{4}[-./]\d{2}[-./]\d{2}$/.test(s.trim()) || /^\d{2}[-./]\d{2}[-./]\d{4}$/.test(s.trim());
    const isInvNumActuallyDate = isDateString(rawInvNum);

    const matchedPayments: ExistingPaymentRow[] = [];
    const seenPaymentKeys = new Set<string>();

    // 1. Search in Google Sheets "Платіжки" tab
    for (const p of existingPayments) {
      const pNum = (p.paymentNumber || '').trim();
      const pKey = `sheet_${p.rowIndex}_${pNum}`;
      if (seenPaymentKeys.has(pKey)) continue;

      const refInv = this.normalizeInvoiceNumber(p.referencedInvoiceNumber || '');
      const refOrd = this.normalizeOrderNumber(p.orderNumber || '').toLowerCase();
      const purpose = (p.paymentPurpose || '').toLowerCase();
      const payee = this.normalizeCompanyName(p.payee || '');
      const pAmount = p.amountPaid || 0;

      const pRefNumbers = this.extractAllInvoiceNumbers(
        p.referencedInvoiceNumber,
        undefined,
        p.paymentPurpose
      );
      const cleanPRefNumbers = pRefNumbers.map((n) => this.normalizeInvoiceNumber(n)).filter(Boolean);

      // Check if this payment specifically references our invoice number
      const hasDirectInvNumMatch =
        !isInvNumActuallyDate &&
        cleanInvNum.length >= 2 &&
        (cleanPRefNumbers.includes(cleanInvNum) ||
          (refInv && (refInv === cleanInvNum || (cleanInvNum.length >= 3 && refInv === cleanInvNum))) ||
          this.isInvoiceNumberMentionedInPurpose(cleanInvNum, p.paymentPurpose || ''));

      // Check payee against supplier
      const isSupplierMatch = Boolean(
        supplier &&
        payee &&
        (this.isCompanyNameMatch(supplier, payee) ||
          (supplier.length >= 5 && purpose.includes(supplier.toLowerCase())))
      );

      // Check amount match
      const isAmountMatch = invAmount > 0 && pAmount > 0 && Math.abs(invAmount - pAmount) <= 0.50;

      // Check order match
      const isOrderMatch = Boolean(
        cleanOrderNum &&
        ((refOrd && (refOrd === cleanOrderNum || cleanOrderNum === refOrd)) ||
          purpose.includes(cleanOrderNum))
      );

      // If payment has other referenced invoice numbers that don't match this one, avoid matching
      // If invoice number is empty or placeholder (e.g. б/н), it cannot contradict!
      const isCleanInvPlaceholder = this.isPlaceholderNumber(cleanInvNum);
      const hasContradictingInvoice =
        !isCleanInvPlaceholder &&
        cleanPRefNumbers.length > 0 &&
        !cleanPRefNumbers.includes(cleanInvNum) &&
        !hasDirectInvNumMatch;

      // Condition 1: Direct match by invoice number (payee must not contradict supplier)
      const matchByInvoiceNum = hasDirectInvNumMatch && (!payee || !supplier || isSupplierMatch);

      // Condition 2: Exact Payee + Exact Amount match (e.g. 177.72 грн)
      const matchByPayeeAndAmount = isSupplierMatch && isAmountMatch && (!hasContradictingInvoice || Math.abs(invAmount - pAmount) <= 0.05);

      // Condition 3: Exact Order + Exact Payee + Exact Amount match
      const matchByOrderSupplierAndAmount = isOrderMatch && isSupplierMatch && isAmountMatch;

      if (matchByInvoiceNum || matchByPayeeAndAmount || matchByOrderSupplierAndAmount) {
        seenPaymentKeys.add(pKey);
        matchedPayments.push(p);
      }
    }

    // 2. Search in local documents (in case payment is in the uploaded batch)
    for (const doc of localDocuments) {
      if (doc.id === invoiceOcr.invoiceNumber) continue;
      const ocr = doc.editedData || doc.ocrResult;
      if (!ocr || ocr.documentType !== 'payment') continue;

      const pNum = (ocr.paymentNumber || ocr.invoiceNumber || '').trim();
      const pKey = `local_${doc.id}_${pNum}`;
      if (seenPaymentKeys.has(pKey)) continue;

      const refInv = this.normalizeInvoiceNumber(ocr.referencedInvoiceNumber || '');
      const refOrd = this.normalizeOrderNumber(ocr.referencedOrderNumber || '').toLowerCase();
      const purpose = (ocr.paymentPurpose || '').toLowerCase();
      const payee = this.normalizeCompanyName(ocr.payeeName || ocr.supplierName || '');
      const pAmount = ocr.amountPaid || ocr.totalAmount || 0;

      const pRefNumbers = this.extractAllInvoiceNumbers(
        ocr.referencedInvoiceNumber,
        ocr.referencedInvoiceNumbers,
        ocr.paymentPurpose
      );
      const cleanPRefNumbers = pRefNumbers.map((n) => this.normalizeInvoiceNumber(n)).filter(Boolean);

      const hasDirectInvNumMatch =
        !isInvNumActuallyDate &&
        cleanInvNum.length >= 2 &&
        (cleanPRefNumbers.includes(cleanInvNum) ||
          (refInv && (refInv === cleanInvNum || (cleanInvNum.length >= 3 && refInv === cleanInvNum))) ||
          this.isInvoiceNumberMentionedInPurpose(cleanInvNum, ocr.paymentPurpose || ''));

      const isSupplierMatch = Boolean(
        supplier &&
        payee &&
        (this.isCompanyNameMatch(supplier, payee) ||
          (supplier.length >= 5 && purpose.includes(supplier.toLowerCase())))
      );

      const isAmountMatch = invAmount > 0 && pAmount > 0 && Math.abs(invAmount - pAmount) <= 0.50;

      const isOrderMatch = Boolean(
        cleanOrderNum &&
        ((refOrd && (refOrd === cleanOrderNum || cleanOrderNum === refOrd)) ||
          purpose.includes(cleanOrderNum))
      );

      const isCleanInvPlaceholder = this.isPlaceholderNumber(cleanInvNum);
      const hasContradictingInvoice =
        !isCleanInvPlaceholder &&
        cleanPRefNumbers.length > 0 &&
        !cleanPRefNumbers.includes(cleanInvNum) &&
        !hasDirectInvNumMatch;

      const matchByInvoiceNum = hasDirectInvNumMatch && (!payee || !supplier || isSupplierMatch);
      const matchByPayeeAndAmount = isSupplierMatch && isAmountMatch && (!hasContradictingInvoice || Math.abs(invAmount - pAmount) <= 0.05);
      const matchByOrderSupplierAndAmount = isOrderMatch && isSupplierMatch && isAmountMatch;

      if (matchByInvoiceNum || matchByPayeeAndAmount || matchByOrderSupplierAndAmount) {
        seenPaymentKeys.add(pKey);
        matchedPayments.push({
          rowIndex: doc.syncedRowIndex || 0,
          paymentNumber: pNum || doc.fileName,
          paymentDate: ocr.paymentDate || ocr.invoiceDate || '',
          payer: ocr.payerName || ocr.buyerName || '',
          payee: payee,
          amountPaid: pAmount,
          currency: ocr.currency || 'UAH',
          paymentPurpose: ocr.paymentPurpose || '',
          referencedInvoiceNumber: ocr.referencedInvoiceNumber || '',
          orderNumber: ocr.referencedOrderNumber || '',
          fileName: doc.fileName,
          driveLink: doc.driveLink || '',
          uploadedAt: '',
        });
      }
    }

    if (matchedPayments.length === 0) {
      return {
        matchedPaymentNumbers: [],
        totalPaidAmount: 0,
        computedStatus: 'Не оплачено',
        matchedPaymentRows: [],
      };
    }

    const totalPaid = matchedPayments.reduce((acc, p) => acc + (p.amountPaid || 0), 0);
    const payNumbers = Array.from(new Set(matchedPayments.map((p) => p.paymentNumber).filter(Boolean)));
    const effectivePaidAmount = invAmount > 0 ? Math.min(totalPaid, invAmount) : totalPaid;

    let computedStatus: InvoicePaymentStatus = 'Не оплачено';
    if (invAmount > 0) {
      if (totalPaid >= invAmount - 0.50) {
        computedStatus = 'Оплачено';
      } else if (totalPaid > 0) {
        computedStatus = 'Оплачено частково';
      }
    } else if (totalPaid > 0) {
      computedStatus = 'Оплачено';
    }

    const first = matchedPayments[0];
    const locationStr = first.rowIndex ? `рядок ${first.rowIndex} у вкладці "Платіжки"` : `файл ${first.fileName}`;
    const reason = `Знайдено платіжку №${first.paymentNumber || ''} на суму ${this.formatCurrency(first.amountPaid || totalPaid)} (${locationStr})`;

    return {
      matchedPaymentNumbers: payNumbers,
      totalPaidAmount: effectivePaidAmount,
      computedStatus,
      matchedPaymentRows: matchedPayments,
      matchReason: reason,
    };
  }

  /**
   * Reconciles existing invoices with existing payments.
   * Scans all invoices in "Рахунки" against all payments in "Платіжки".
   * For invoices where status in the sheet is "Не оплачено" or "Оплачено частково",
   * checks if a corresponding payment exists in "Платіжки" (e.g. invoice in row 20
   * from "ТОВ КОМПАНІЯ ЛІНА ТД" on 177,72 грн matching payment in row 24).
   * Returns all detected reconciliation matches with computed status, paid amount, and payment row index.
   */
  public static reconcileInvoicesWithPayments(
    existingInvoices: ExistingSheetRow[] = [],
    existingPayments: ExistingPaymentRow[] = []
  ): Array<{
    invoiceRowIndex: number;
    invoiceNumber: string;
    orderNumber?: string;
    supplier: string;
    invoiceAmount: number;
    currentStatus: InvoicePaymentStatus;
    computedStatus: InvoicePaymentStatus;
    paidAmount: number;
    matchedPaymentRowIndex?: number;
    matchedPaymentNumber?: string;
    matchedPaymentDate?: string;
    matchedPaymentAmount?: number;
    matchedPaymentPayee?: string;
    matchReason: string;
  }> {
    const results: Array<{
      invoiceRowIndex: number;
      invoiceNumber: string;
      orderNumber?: string;
      supplier: string;
      invoiceAmount: number;
      currentStatus: InvoicePaymentStatus;
      computedStatus: InvoicePaymentStatus;
      paidAmount: number;
      matchedPaymentRowIndex?: number;
      matchedPaymentNumber?: string;
      matchedPaymentDate?: string;
      matchedPaymentAmount?: number;
      matchedPaymentPayee?: string;
      matchReason: string;
    }> = [];

    for (const inv of existingInvoices) {
      if (!inv.rowIndex) continue;

      const mockOcr: OCRResult = {
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.invoiceDate,
        handwrittenOrderNumber: inv.orderNumber,
        supplierName: inv.supplier,
        buyerName: inv.buyer,
        totalAmount: inv.amount,
        currency: inv.currency || 'UAH',
        documentType: 'invoice',
        documentTypeUkrainian: 'Рахунок-фактура',
        handwrittenConfidence: 'high',
        confidenceScore: 1,
        paymentStatus: inv.paymentStatus,
      };

      const match = this.matchInvoiceWithPayments(mockOcr, existingPayments);

      if (match.computedStatus && match.computedStatus !== 'Не оплачено') {
        const firstPay = match.matchedPaymentRows[0];
        results.push({
          invoiceRowIndex: inv.rowIndex,
          invoiceNumber: inv.invoiceNumber,
          orderNumber: inv.orderNumber,
          supplier: inv.supplier,
          invoiceAmount: inv.amount,
          currentStatus: inv.paymentStatus,
          computedStatus: match.computedStatus,
          paidAmount: match.totalPaidAmount || inv.amount,
          matchedPaymentRowIndex: firstPay?.rowIndex,
          matchedPaymentNumber: firstPay?.paymentNumber,
          matchedPaymentDate: firstPay?.paymentDate,
          matchedPaymentAmount: firstPay?.amountPaid,
          matchedPaymentPayee: firstPay?.payee,
          matchReason: match.matchReason || `Знайдено платіжку на суму ${this.formatCurrency(match.totalPaidAmount)}`,
        });
      }
    }

    return results;
  }

  /**
   * Check if a document is already present in Google Sheets:
   * - For Invoices: checks by (InvoiceNumber + Supplier) OR (OrderNumber + InvoiceNumber + Amount)
   * - For Payments: checks by (PaymentNumber + Payee + Amount) OR (PaymentDate + Amount + Payee)
   */
  public static checkExistingDocumentInSheet(
    docOcr: OCRResult,
    existingInvoices: ExistingSheetRow[] = [],
    existingPayments: any[] = []
  ): {
    alreadyInSheet: boolean;
    rowIndex?: number;
    tabName?: string;
    reason?: string;
  } {
    const isPlaceholderNumber = (num: string): boolean => {
      if (!num) return true;
      const s = num.trim().toLowerCase();
      if (s.length < 2) return true;
      // Date strings like 2026-08-25 or 25.08.2026
      if (/^\d{4}[-./]\d{2}[-./]\d{2}$/.test(s) || /^\d{2}[-./]\d{2}[-./]\d{4}$/.test(s)) return true;
      const placeholders = new Set([
        'б/н', 'бн', 'б.н.', 'б/н.', 'безномера', 'без_номера', 'без-номера',
        'n/a', 'na', 'none', 'null', '-', '--', '—', '0', '00', '000',
        'рахунок', 'інвойс', 'счет'
      ]);
      return placeholders.has(s);
    };

    const isPayment = docOcr.documentType === 'payment';

    if (isPayment) {
      const payNum = (docOcr.paymentNumber || docOcr.invoiceNumber || '').trim().toLowerCase();
      const cleanPayNum = this.normalizeInvoiceNumber(payNum);
      const isCleanPayPlaceholder = isPlaceholderNumber(cleanPayNum);
      const payDate = docOcr.paymentDate || docOcr.invoiceDate || '';
      const payee = this.normalizeCompanyName(docOcr.payeeName || docOcr.supplierName || '');
      const amount = docOcr.amountPaid || docOcr.totalAmount || 0;

      for (const p of existingPayments) {
        const existPayNum = (p.paymentNumber || '').trim().toLowerCase();
        const cleanExistPayNum = this.normalizeInvoiceNumber(existPayNum);
        const isExistPayPlaceholder = isPlaceholderNumber(cleanExistPayNum);
        const existDate = p.paymentDate || '';
        const existPayee = this.normalizeCompanyName(p.payee || '');
        const existAmount = p.amountPaid || 0;

        const payeeMatch = payee && existPayee && (this.isCompanyNameMatch(payee, existPayee) || (payee.length >= 6 && existPayee.length >= 6 && (payee.includes(existPayee) || existPayee.includes(payee))));
        if (!payeeMatch) continue;

        const amountMatch = amount > 0 && existAmount > 0 && Math.abs(amount - existAmount) <= 0.50;
        const dateMatch = payDate && existDate && payDate === existDate;

        const validPayNumMatch =
          !isCleanPayPlaceholder &&
          !isExistPayPlaceholder &&
          cleanPayNum === cleanExistPayNum;

        // Condition 1: Exact payment number + payee + amount match
        if (validPayNumMatch && amountMatch) {
          return {
            alreadyInSheet: true,
            rowIndex: p.rowIndex,
            tabName: 'Платіжки',
            reason: `Платіжка №${p.paymentNumber} від ${existPayee} на суму ${existAmount || amount} грн вже є у вкладці "Платіжки" (рядок ${p.rowIndex})`,
          };
        }

        // Condition 2: Date + exact amount + payee
        if (dateMatch && amountMatch) {
          return {
            alreadyInSheet: true,
            rowIndex: p.rowIndex,
            tabName: 'Платіжки',
            reason: `Платіжка на суму ${amount} грн від ${payDate} (${existPayee}) вже є у вкладці "Платіжки" (рядок ${p.rowIndex})`,
          };
        }
      }
    } else {
      // Invoices
      const rawInvNum = (docOcr.invoiceNumber || '').trim();
      const cleanInvNum = this.normalizeInvoiceNumber(rawInvNum);
      const isCleanInvPlaceholder = isPlaceholderNumber(cleanInvNum);
      const rawOrderNum = (docOcr.handwrittenOrderNumber || '').trim();
      const cleanOrderNum = this.normalizeOrderNumber(rawOrderNum).toLowerCase();
      const supplier = this.normalizeCompanyName(docOcr.supplierName || '');
      const amount = docOcr.totalAmount || 0;
      const invDate = (docOcr.invoiceDate || '').trim();

      for (const inv of existingInvoices) {
        const existInvNum = (inv.invoiceNumber || '').trim();
        const cleanExistInvNum = this.normalizeInvoiceNumber(existInvNum);
        const isExistInvPlaceholder = isPlaceholderNumber(cleanExistInvNum);
        const existOrderNum = this.normalizeOrderNumber(inv.orderNumber || '').toLowerCase();
        const existSupplier = this.normalizeCompanyName(inv.supplier || '');
        const existAmount = inv.amount || 0;
        const existDate = (inv.invoiceDate || '').trim();

        // Skip blank or invalid rows in sheet
        if (!cleanExistInvNum && !existAmount && !existOrderNum) continue;

        const supplierMatch = supplier && existSupplier && this.isCompanyNameMatch(supplier, existSupplier);
        if (!supplierMatch) continue;

        const amountMatch = amount > 0 && existAmount > 0 && Math.abs(amount - existAmount) <= 0.50;
        const orderNumMatch = Boolean(cleanOrderNum && existOrderNum && cleanOrderNum === existOrderNum);
        const dateMatch = Boolean(invDate && existDate && invDate === existDate);

        // Condition 1: Valid invoice numbers match (not placeholders/dates) + supplier match + amount match
        const validInvNumbersMatch =
          !isCleanInvPlaceholder &&
          !isExistInvPlaceholder &&
          cleanInvNum === cleanExistInvNum;

        if (validInvNumbersMatch && (amountMatch || amount === 0 || existAmount === 0 || Math.abs(amount - existAmount) <= 1.0)) {
          return {
            alreadyInSheet: true,
            rowIndex: inv.rowIndex,
            tabName: 'Рахунки',
            reason: `Рахунок №${inv.invoiceNumber} від ${existSupplier} на суму ${existAmount || amount} грн вже є у вкладці "Рахунки" (рядок ${inv.rowIndex})`,
          };
        }

        // If both have valid invoice numbers, but they are DIFFERENT, they are NOT duplicates
        if (!isCleanInvPlaceholder && !isExistInvPlaceholder && cleanInvNum !== cleanExistInvNum) {
          continue;
        }

        // Condition 2: Handwritten order number + supplier match + amount match
        if (orderNumMatch && (amountMatch || (amount === 0 && existAmount > 0))) {
          return {
            alreadyInSheet: true,
            rowIndex: inv.rowIndex,
            tabName: 'Рахунки',
            reason: `Рахунок від ${existSupplier} за замовленням ${inv.orderNumber} на суму ${amount || existAmount} грн вже є у вкладці "Рахунки" (рядок ${inv.rowIndex})`,
          };
        }

        // Condition 3: Exact amount + date match + supplier match
        if (amountMatch && dateMatch) {
          return {
            alreadyInSheet: true,
            rowIndex: inv.rowIndex,
            tabName: 'Рахунки',
            reason: `Рахунок від ${existSupplier} на суму ${amount} грн від ${existDate} вже є у вкладці "Рахунки" (рядок ${inv.rowIndex})`,
          };
        }
      }
    }

    return {
      alreadyInSheet: false,
    };
  }

  /**
   * Scan existing rows in "Рахунки" to find all duplicate rows.
   * For each duplicate group, keeps the earliest row (lower rowIndex) as canonical
   * and marks later rows as duplicates to be deleted.
   */
  public static findDuplicateInvoices(
    existingInvoices: ExistingSheetRow[]
  ): DuplicateRowMatch[] {
    const duplicates: DuplicateRowMatch[] = [];
    if (!existingInvoices || existingInvoices.length <= 1) return duplicates;

    const isPlaceholderNumber = (num: string): boolean => {
      if (!num) return true;
      const s = num.trim().toLowerCase();
      if (s.length < 2) return true;
      if (/^\d{4}[-./]\d{2}[-./]\d{2}$/.test(s) || /^\d{2}[-./]\d{2}[-./]\d{4}$/.test(s)) return true;
      const placeholders = new Set([
        'б/н', 'бн', 'б.н.', 'б/н.', 'безномера', 'без_номера', 'без-номера',
        'n/a', 'na', 'none', 'null', '-', '--', '—', '0', '00', '000',
        'рахунок', 'інвойс', 'счет'
      ]);
      return placeholders.has(s);
    };

    // Filter valid rows and sort ascending by rowIndex
    const validRows = existingInvoices
      .filter((r) => r.rowIndex > 1 && (r.supplier || r.invoiceNumber || r.orderNumber || (r.amount && r.amount > 0)))
      .sort((a, b) => a.rowIndex - b.rowIndex);

    const alreadyFlagged = new Set<number>();

    for (let i = 0; i < validRows.length; i++) {
      const a = validRows[i];
      if (alreadyFlagged.has(a.rowIndex)) continue;

      const aSup = this.normalizeCompanyName(a.supplier || '');
      const aInvRaw = (a.invoiceNumber || '').trim();
      const aInv = this.normalizeInvoiceNumber(aInvRaw);
      const aIsPlaceholderInv = isPlaceholderNumber(aInv);
      const aOrd = this.normalizeOrderNumber(a.orderNumber || '').toLowerCase();
      const aAmount = a.amount || 0;
      const aDate = (a.invoiceDate || '').trim();

      for (let j = i + 1; j < validRows.length; j++) {
        const b = validRows[j];
        if (alreadyFlagged.has(b.rowIndex)) continue;

        const bSup = this.normalizeCompanyName(b.supplier || '');
        const bInvRaw = (b.invoiceNumber || '').trim();
        const bInv = this.normalizeInvoiceNumber(bInvRaw);
        const bIsPlaceholderInv = isPlaceholderNumber(bInv);
        const bOrd = this.normalizeOrderNumber(b.orderNumber || '').toLowerCase();
        const bAmount = b.amount || 0;
        const bDate = (b.invoiceDate || '').trim();

        // 1. Supplier match check
        const supMatch = Boolean(
          aSup && bSup && (this.isCompanyNameMatch(aSup, bSup) || aSup === bSup || (aSup.length >= 6 && bSup.includes(aSup)))
        );

        // 2. Amount match check
        const amountMatch = (aAmount > 0 && bAmount > 0 && Math.abs(aAmount - bAmount) <= 0.50);
        const exactAmountMatch = (aAmount > 0 && bAmount > 0 && Math.abs(aAmount - bAmount) <= 0.05);

        // 3. Invoice numbers check
        const validInvNumbersMatch = !aIsPlaceholderInv && !bIsPlaceholderInv && aInv === bInv;
        const conflictingInvNumbers = !aIsPlaceholderInv && !bIsPlaceholderInv && aInv !== bInv;

        // 4. Order number match check
        const orderNumMatch = Boolean(aOrd && bOrd && aOrd === bOrd);

        // 5. Date match check
        const dateMatch = Boolean(aDate && bDate && aDate === bDate);

        let isDuplicate = false;
        let matchReason = '';

        // Duplicate Case 1: Same supplier + same valid invoice number + same amount (or one is 0)
        if (supMatch && validInvNumbersMatch && (amountMatch || aAmount === 0 || bAmount === 0)) {
          isDuplicate = true;
          matchReason = `Однакові постачальник (${b.supplier}), номер рахунку (№${b.invoiceNumber}) та сума (${this.formatCurrency(bAmount)})`;
        }
        // Duplicate Case 2: Same supplier + same handwritten order number + amount match (and not conflicting invoice numbers)
        else if (supMatch && orderNumMatch && amountMatch && !conflictingInvNumbers) {
          isDuplicate = true;
          matchReason = `Однакові постачальник (${b.supplier}), замовлення (${b.orderNumber}) та сума (${this.formatCurrency(bAmount)})`;
        }
        // Duplicate Case 3: Same supplier + same date + exact amount match (and not conflicting invoice numbers)
        else if (supMatch && dateMatch && exactAmountMatch && !conflictingInvNumbers) {
          isDuplicate = true;
          matchReason = `Однакові постачальник (${b.supplier}), дата (${b.invoiceDate}) та сума (${this.formatCurrency(bAmount)})`;
        }
        // Duplicate Case 4: Completely identical row content
        else if (aSup === bSup && aInv === bInv && aOrd === bOrd && Math.abs(aAmount - bAmount) < 0.01) {
          isDuplicate = true;
          matchReason = `Повністю ідентичні дані рядків`;
        }

        if (isDuplicate) {
          alreadyFlagged.add(b.rowIndex);
          duplicates.push({
            rowIndex: b.rowIndex,
            originalRowIndex: a.rowIndex,
            tabName: 'Рахунки',
            type: 'invoice',
            identifier: `Рахунок ${b.invoiceNumber ? `№${b.invoiceNumber}` : `(замовл. ${b.orderNumber || 'б/н'})`} від ${b.supplier || '—'}`,
            amount: b.amount,
            reason: matchReason,
            date: b.invoiceDate,
            orderNumber: b.orderNumber,
          });
        }
      }
    }

    return duplicates;
  }

  /**
   * Scan existing rows in "Платіжки" to find all duplicate rows.
   * For each duplicate group, keeps the earliest row (lower rowIndex) as canonical
   * and marks later rows as duplicates to be deleted.
   */
  public static findDuplicatePayments(
    existingPayments: ExistingPaymentRow[]
  ): DuplicateRowMatch[] {
    const duplicates: DuplicateRowMatch[] = [];
    if (!existingPayments || existingPayments.length <= 1) return duplicates;

    const isPlaceholderNumber = (num: string): boolean => {
      if (!num) return true;
      const s = num.trim().toLowerCase();
      if (s.length < 2) return true;
      if (/^\d{4}[-./]\d{2}[-./]\d{2}$/.test(s) || /^\d{2}[-./]\d{2}[-./]\d{4}$/.test(s)) return true;
      const placeholders = new Set([
        'б/н', 'бн', 'б.н.', 'б/н.', 'безномера', 'без_номера', 'без-номера',
        'n/a', 'na', 'none', 'null', '-', '--', '—', '0', '00', '000',
      ]);
      return placeholders.has(s);
    };

    const validRows = existingPayments
      .filter((r) => r.rowIndex > 1 && (r.payee || r.paymentNumber || (r.amountPaid && r.amountPaid > 0)))
      .sort((a, b) => a.rowIndex - b.rowIndex);

    const alreadyFlagged = new Set<number>();

    for (let i = 0; i < validRows.length; i++) {
      const a = validRows[i];
      if (alreadyFlagged.has(a.rowIndex)) continue;

      const aPayee = this.normalizeCompanyName(a.payee || '');
      const aNumRaw = (a.paymentNumber || '').trim();
      const aNum = this.normalizeInvoiceNumber(aNumRaw);
      const aIsPlaceholderNum = isPlaceholderNumber(aNum);
      const aDate = (a.paymentDate || '').trim();
      const aAmount = a.amountPaid || 0;
      const aPurpose = (a.paymentPurpose || '').trim().toLowerCase();

      for (let j = i + 1; j < validRows.length; j++) {
        const b = validRows[j];
        if (alreadyFlagged.has(b.rowIndex)) continue;

        const bPayee = this.normalizeCompanyName(b.payee || '');
        const bNumRaw = (b.paymentNumber || '').trim();
        const bNum = this.normalizeInvoiceNumber(bNumRaw);
        const bIsPlaceholderNum = isPlaceholderNumber(bNum);
        const bDate = (b.paymentDate || '').trim();
        const bAmount = b.amountPaid || 0;
        const bPurpose = (b.paymentPurpose || '').trim().toLowerCase();

        const payeeMatch = Boolean(
          aPayee && bPayee && (this.isCompanyNameMatch(aPayee, bPayee) || aPayee === bPayee || (aPayee.length >= 6 && bPayee.includes(aPayee)))
        );

        const amountMatch = (aAmount > 0 && bAmount > 0 && Math.abs(aAmount - bAmount) <= 0.50);
        const exactAmountMatch = (aAmount > 0 && bAmount > 0 && Math.abs(aAmount - bAmount) <= 0.05);

        const validNumbersMatch = !aIsPlaceholderNum && !bIsPlaceholderNum && aNum === bNum;
        const conflictingNumbers = !aIsPlaceholderNum && !bIsPlaceholderNum && aNum !== bNum;
        const dateMatch = Boolean(aDate && bDate && aDate === bDate);

        let isDuplicate = false;
        let matchReason = '';

        // Case 1: Same payee + same valid payment number + same amount
        if (payeeMatch && validNumbersMatch && (amountMatch || aAmount === 0 || bAmount === 0)) {
          isDuplicate = true;
          matchReason = `Однакові отримувач (${b.payee}), номер платіжки (№${b.paymentNumber}) та сума (${this.formatCurrency(bAmount)})`;
        }
        // Case 2: Same payee + same payment date + exact amount match (and no conflicting numbers)
        else if (payeeMatch && dateMatch && exactAmountMatch && !conflictingNumbers) {
          isDuplicate = true;
          matchReason = `Однакові отримувач (${b.payee}), дата (${b.paymentDate}) та сума (${this.formatCurrency(bAmount)})`;
        }
        // Case 3: Same payee + same purpose + exact amount
        else if (payeeMatch && aPurpose && bPurpose && aPurpose === bPurpose && exactAmountMatch) {
          isDuplicate = true;
          matchReason = `Однакові отримувач (${b.payee}), призначення платежу та сума (${this.formatCurrency(bAmount)})`;
        }
        // Case 4: Completely identical payment row
        else if (aPayee === bPayee && aNum === bNum && aDate === bDate && Math.abs(aAmount - bAmount) < 0.01) {
          isDuplicate = true;
          matchReason = `Повністю ідентичні дані платіжки`;
        }

        if (isDuplicate) {
          alreadyFlagged.add(b.rowIndex);
          duplicates.push({
            rowIndex: b.rowIndex,
            originalRowIndex: a.rowIndex,
            tabName: 'Платіжки',
            type: 'payment',
            identifier: `Платіжка ${b.paymentNumber ? `№${b.paymentNumber}` : 'б/н'} на користь ${b.payee || '—'}`,
            amount: b.amountPaid,
            reason: matchReason,
            date: b.paymentDate,
          });
        }
      }
    }

    return duplicates;
  }
}


