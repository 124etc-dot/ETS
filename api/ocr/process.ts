import { GoogleGenAI, Type, Schema } from '@google/genai';

// Vercel Serverless Function Configuration
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
  maxDuration: 60,
};

// Lazy initializer for Gemini client in serverless environment
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
          'User-Agent': 'aistudio-build-vercel',
        },
      },
    });
  }
  return geminiClient;
}

// Auto-detect and normalize MIME type from base64 magic bytes or filename
function detectAndNormalizeMimeType(base64: string, fallbackMime: string, fileName?: string): string {
  const cleanHead = base64.replace(/\s+/g, '').slice(0, 40);
  if (cleanHead.startsWith('JVBERi')) return 'application/pdf';
  if (cleanHead.startsWith('/9j/') || cleanHead.startsWith('/9J/') || cleanHead.startsWith('/9f/') || cleanHead.startsWith('/9H/')) return 'image/jpeg';
  if (cleanHead.startsWith('iVBORw')) return 'image/png';
  if (cleanHead.startsWith('UklGR')) return 'image/webp';
  if (cleanHead.startsWith('R0lGO')) return 'image/gif';
  if (cleanHead.startsWith('Qk')) return 'image/bmp';
  if (cleanHead.startsWith('SUkq') || cleanHead.startsWith('TU0A')) return 'image/tiff';
  if (cleanHead.startsWith('AAAA') && (cleanHead.includes('Z0eX') || cleanHead.includes('ftyp'))) return 'image/jpeg';

  if (fileName) {
    const ext = fileName.toLowerCase().split('.').pop() || '';
    if (ext === 'pdf') return 'application/pdf';
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
    if (ext === 'png') return 'image/png';
    if (ext === 'webp') return 'image/webp';
    if (ext === 'gif') return 'image/gif';
    if (ext === 'heic' || ext === 'heif') return 'image/jpeg';
    if (ext === 'bmp') return 'image/bmp';
  }

  if (fallbackMime) {
    const lower = fallbackMime.toLowerCase().trim();
    if (lower === 'image/jpg' || lower === 'image/pjpeg' || lower === 'image/heic' || lower === 'image/heif') {
      return 'image/jpeg';
    }
    if (lower === 'image/x-png') return 'image/png';
    if (['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(lower)) {
      return lower;
    }
  }

  if (cleanHead.startsWith('/')) return 'image/jpeg';

  // For phone/messenger files (e.g. 0-02-05-... without extension), default to image/jpeg
  return 'image/jpeg';
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

function isCompanyNameMatch(name1: string, name2: string): boolean {
  if (!name1 || !name2) return false;
  if (name1.trim().toLowerCase() === name2.trim().toLowerCase()) return true;

  const n1 = normalizeCompanyName(name1);
  const n2 = normalizeCompanyName(name2);
  if (!n1 || !n2) return false;
  if (n1 === n2) return true;

  const clean1 = n1.replace(/[-–—\.,\/\\()]/g, ' ').replace(/\s+/g, ' ').trim();
  const clean2 = n2.replace(/[-–—\.,\/\\()]/g, ' ').replace(/\s+/g, ' ').trim();
  if (clean1 === clean2) return true;

  const legalPrefixRegex = /^(ТОВ|ФОП|ПП|ТДВ|ПРАТ|ПАТ|АТ|ДП|ТД)\s+/i;
  const core1 = clean1.replace(legalPrefixRegex, '').trim();
  const core2 = clean2.replace(legalPrefixRegex, '').trim();

  if (!core1 || !core2) return false;
  if (core1 === core2) return true;

  if (core1.length >= 5 && core2.length >= 5) {
    if (core1.includes(core2) || core2.includes(core1)) {
      return true;
    }
  }

  return false;
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

// Structured output schema for OCR results
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
    documentTitle: {
      type: Type.STRING,
      description: 'Exact main title or header printed at top of document, e.g. "ПЛАТІЖНА ІНСТРУКЦІЯ В НАЦІОНАЛЬНІЙ ВАЛЮТІ", "РАХУНОК НА ОПЛАТУ №...", "АКТ"',
    },
    bankExecutionStamp: {
      type: Type.STRING,
      description: 'Bank processing/execution stamps or digital signature markers if present, e.g. "Дата виконання БАНК 09.09.2026", "iBank2UA ЕП Є КОРЕКТНИМ", "Проведено банком", "UETR"',
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
      description: 'Payer company name in payment order (Платник). CRITICAL FOR BANK FORMS: In many modern bank forms (PrivatBank, Raiffeisen, Oshchad, PUMB etc.), the payer name is NOT in the line "Платник" (which only has code/IBAN or is a block title), but on the line directly BELOW where it says "Найменування" (or "Найменування платника"). This is our company name (Покупець / Платник). Do NOT confuse with payee\'s "Найменування"!',
    },
    payeeName: {
      type: Type.STRING,
      description: 'Payee company name in payment order (Отримувач). CRITICAL FOR BANK FORMS: In many modern bank forms, the payee name is NOT in the line "Отримувач" (which only has code/IBAN or is a block title), but on the line directly BELOW where it says "Найменування" (or "Найменування отримувача"). This is the supplier company (Отримувач коштів / Постачальник). Do NOT confuse with payer\'s "Найменування"!',
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

export async function processOcrDocument(params: {
  fileData: string;
  mimeType?: string;
  fileName?: string;
  ourCompanies?: string[];
  suppliers?: string[];
  knownOrders?: any[];
  docTypeHint?: string;
}): Promise<{
  success: boolean;
  data?: any;
  fileName?: string;
  error?: string;
  statusCode?: number;
}> {
  const {
    fileData,
    mimeType: rawMimeType = 'application/pdf',
    fileName = 'document',
    ourCompanies = [],
    suppliers = [],
    knownOrders = [],
  } = params;

  if (!fileData) {
    return {
      success: false,
      statusCode: 400,
      error: 'Вміст файлу (base64) обовʼязковий для розпізнавання.',
    };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      success: false,
      statusCode: 500,
      error: 'Ключ Gemini API не знайдено в середовищі. Будь ласка, перевірте налаштування GEMINI_API_KEY у панелі Vercel Environment Variables.',
    };
  }

  // Safely strip ANY data URL prefix regardless of attributes (e.g. data:...;charset=...;base64,)
  const commaIndex = fileData.indexOf(',');
  const rawBase64 = (fileData.startsWith('data:') && commaIndex !== -1)
    ? fileData.slice(commaIndex + 1)
    : fileData;
  const cleanBase64 = rawBase64.replace(/\s+/g, '');
  const finalMimeType = detectAndNormalizeMimeType(cleanBase64, rawMimeType, fileName);

  const ai = getGeminiClient();

  const ourCompaniesPromptList = Array.isArray(ourCompanies) && ourCompanies.length > 0
    ? `\nСПИСОК НАШИХ КОМПАНІЙ (Одержувачі рахунків / Покупці / Платники):\n${ourCompanies.map((c: string) => `- ${c}`).join('\n')}`
    : '\nСписок наших компаній не заданий — визнач покупця/платника самостійно.';

  const suppliersPromptList = Array.isArray(suppliers) && suppliers.length > 0
    ? `\nСПИСОК ВІДОМИХ ПОСТАЧАЛЬНИКІВ:\n${suppliers.map((s: string) => `- ${s}`).join('\n')}`
    : '';

  const knownOrdersPromptList = Array.isArray(knownOrders) && knownOrders.length > 0
    ? `\nДОВІДНИК АКТИВНИХ ВНУТРІШНІХ ЗАМОВЛЕНЬ:\n${knownOrders.map((o: any) => `- Код: ${typeof o === 'string' ? o : o.code + (o.title ? ' (' + o.title + ')' : '')}`).join('\n')}\n(УВАГА: Цей довідник надано ВИКЛЮЧНО як допоміжний орієнтир для уточнення неоднозначних рукописних цифр на документі! КАТЕГОРИЧНО ЗАБОРОНЕНО вигадувати або підставляти номер з довідника, якщо таких цифр насправді немає на зображенні документа!)`
    : '';

  const systemPrompt = `Ти високоточний експертний модуль автоматичного розпізнавання (OCR) первинних фінансових документів (Рахунків на оплату, Банківських платіжок/квитанцій, чеків, скріншотів мобільного банкінгу) для українського та міжнародного бізнесу.

Перед тобою документ (PDF або фото) з ім'ям "${fileName}".
ЗВЕРНИ УВАГУ: Документ може бути фотографією роздрукованого рахунку, квитанції про оплату, чеку або скріншоту додатку інтернет-банкінгу (Приват24, Монобанк тощо), завантаженим через телефон чи месенджер (WhatsApp/Viber/Telegram). Ретельно прочитай кожне поле, цифру та літеру навіть якщо зображення стиснене чи сфотографоване під кутом.

${ourCompaniesPromptList}
${suppliersPromptList}
${knownOrdersPromptList}

КРИТИЧНІ ПРАВИЛА РОЗПІЗНАВАННЯ:
1. ТИП ДОКУМЕНТА (invoice, payment, other) — СУВОРЕ РОЗМЕЖУВАННЯ:
   - "invoice" (Рахунок на оплату, Рахунок-фактура, Акт виконаних робіт, Видаткова накладна):
     * Якщо на документі є заголовок "Рахунок", "Рахунок на оплату", "Рахунок-фактура", "Invoice" — це СТРОГО "invoice"!
     * Якщо є таблиця з переліком товарів або послуг (коди УКТЗЕД, номенклатура, одиниці виміру "шт", кількість, ціна, сума, ПДВ) — це 100% "invoice"!
     * Якщо зазначено "Постачальник" (Продавець) та "Покупець" (Замовник) — це "invoice"!
     * КРИТИЧНЕ ЗАСТЕРЕЖЕННЯ: Багато українських постачальників (наприклад, METALVIS / ПрАТ "СОЛДІ І КО", "Епіцентр", "АВ метал груп" тощо) друкують угорі або внизу рахунку блок «Зразок платіжного доручення / Реквізити для оплати» зі словами «Одержувач», «Кредит рах.», «Банк одержувача», «Призначення платежу: згідно рахунка №...».
       ЦЕ НЕ ПЛАТІЖКА! Це реквізити для оплати РАХУНКУ. Такий документ є СТРОГО "invoice" (Рахунок), І КАТЕГОРИЧНО НЕ "payment"!
   - "payment" (Платіжна інструкція, Платіжне доручення, Банківська виписка, Меморіальний ордер, Квитанція про оплату):
     * НАЙГОЛОВНІШЕ ПРАВИЛО: Якщо на документі вгорі або в шапці є заголовок "ПЛАТІЖНА ІНСТРУКЦІЯ" (наприклад "ПЛАТІЖНА ІНСТРУКЦІЯ В НАЦІОНАЛЬНІЙ ВАЛЮТІ"), "ПЛАТІЖНЕ ДОРУЧЕННЯ", "МЕМОPIAЛЬНИЙ ОРДЕР", "КВИТАНЦІЯ", "ЧЕК" — ЦЕ 100% "payment"! КАТЕГОРИЧНО НЕ "invoice"!
     * ОБОВ'ЯЗКОВО вкажи documentTitle (точний заголовок документа вгорі, наприклад "ПЛАТІЖНА ІНСТРУКЦІЯ В НАЦІОНАЛЬНІЙ ВАЛЮТІ") та bankExecutionStamp (будь-які банківські штампи чи позначки виконання).
     * Номер біля заголовка (наприклад "від 09 вересня 2026 р. N 1216", "N 1215", "№ 1216") — це СТРОГО paymentNumber ("1216", "1215")!
     * Згадка рахунку в рядку "Призначення платежу" (наприклад: "Оплата за товар згідно рах. № 4104 від 09.09.26" або "Оплата згідно рахунку № 4373") — це СТРОГО referencedInvoiceNumber ("4104", "4373")!
       ЗАПАМ'ЯТАЙ: Згадка рахунку в призначенні платежу означає, що цей платіжний документ ОПЛАЧУЄ даний рахунок, але сам документ залишається ПЛАТІЖНОЮ ІНСТРУКЦІЄЮ ("payment")! Ніколи не класифікуй такий документ як invoice!
     * Банківські реквізити та штампи ("Платник", "Отримувач", "Надавач платіжних послуг", "UETR", "Дата прийняття до виконання", "Дата виконання БАНК", "iBank2UA", "ЕП Є КОРЕКТНИМ") — це 100% ознака банківської платіжки.
     * documentType повертай "payment", documentTypeUkrainian — "Платіжна інструкція" (або "Платіжне доручення").
     * У банківській платіжці НІКОЛИ НЕМАЄ таблиці номенклатури товарів з кодами УКТЗЕД та кількістю штук!
   - "other": Інший тип документа (сертифікат якості, довіреність, договір).

2. КРИТИЧНО — ВНУТРІШНІЙ НОМЕР ЗАМОВЛЕННЯ (НАПИСАНИЙ ВІД РУКИ, ШТАМПОМ ЧИ РУЧКОЮ):
   - Це ключове поле для обліку! У нашій компанії менеджер або бухгалтер на кожному рахунку пише номер внутрішнього замовлення РУЧКОЮ (синьою, чорною, фіолетовою, червоною), ОЛІВЦЕМ або МАРКЕРОМ.
   - ДЕ ШУКАТИ (оглянь кожен куток і край аркуша!):
     1. Верхній правий кут (найчастіше місце напису!)
     2. Верхній лівий кут або в шапці постачальника поруч з логотипом
     3. Безпосередньо біля, над або під заголовком "Рахунок на оплату", "Рахунок-фактура", "СФ"
     4. На бічних полях (margins) ліворуч або праворуч (навіть якщо напис повернений вертикально!)
     5. Внизу аркуша — біля підписів, печаток або загальної суми до сплати
   - ВАРІАНТИ НАПИСАННЯ ТА СТАНДАРТИЗАЦІЯ ДО ФОРМАТУ "ххх-хх":
     * Повний номер з роком: "142-26", "232-26", "089-26", "229-26", "216-26", "207-26", "45-26" -> "ххх-хх"
     * Номер через скісну риску або крапку: "232/26", "142/26", "232.26" -> стандартизуй до "232-26"
     * Номер з префіксами: "№ 232-26", "№142-26", "зам. 232-26", "з. 232-26", "З-232-26" -> видали букви та №, поверни "232-26"
     * ТІЛЬКИ НОМЕР БЕЗ РОКУ (дуже часто менеджери пишуть просто число!): "232", "142", "45", "108", "89", або число в кружечку чи рамочці. Якщо зазначено лише номер без року — ОБОВ'ЯЗКОВО додай поточний рік "-26" (наприклад, з "232" сформуй "232-26")!
   - У полі "handwrittenOrderNumber": повертай строго стандартизований формат "ххх-хх" (без №, без літер, наприклад "232-26", "089-26").
   - У полі "handwrittenRawText": вкажи точний текст, як він реально написаний (наприклад "№ 232/26", "232", "зам 45-26").
   - У полі "handwrittenLocation": вкажи місце знаходження (наприклад "Верхній правий кут", "На правому полі", "Біля шапки").
   - У полі "handwrittenConfidence": 'high' (якщо чітко видно), 'medium' (якщо є незначні сумніви), 'low' (якщо ледь розбірливо), або 'none' (якщо напису немає взагалі).
   - АНТИ-ГАЛЮЦИНАЦІЯ:
     * Для платіжок ("payment"): банківські квитанції та платіжки зазвичай НЕ мають рукописного номера. Для платіжок бери номер замовлення ТІЛЬКИ якщо він явно написаний у "Призначенні платежу" (наприклад "замовлення 229-26") або дописаний від руки на паперовій квитанції!
     * НІКОЛИ не вигадуй номер замовлення і не обирай навмання з довідника (наприклад "083-26"), якщо його немає на зображенні! Якщо напису немає — повертай порожній рядок "".

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

6. ДЛЯ ПЛАТІЖОК ТА БАНКІВСЬКИХ КВИТАНЦІЙ (payment):
   - paymentNumber: номер платіжки (платіжної інструкції / квитанції / меморіального ордера)
   - paymentDate: дата проведення (РРРР-ММ-ДД)
   - КРИТИЧНО — ЛОГІКА РОЗПІЗНАВАННЯ ПЛАТНИКА ТА ОТРИМУВАЧА В РІЗНИХ ФОРМАХ БАНКІВ:
     Різні українські банки (ПриватБанк, Райффайзен, Ощадбанк, ПУМБ, Укрсиббанк, Монобанк тощо) мають дещо різні форми платіжних документів!
     
     * ФОРМА 1 (Класична): назви компаній вказані безпосередньо в рядках: "Платник: ТОВ НАША КОМПАНІЯ", "Отримувач: ТОВ ПОСТАЧАЛЬНИК".

     * ФОРМА 2 (Нова / Таблична банківська форма — БЛОКИ З ПОЛЕМ "Найменування"):
       У цій формі назва платника та отримувача вказані НЕ в самому рядку "Платник" чи "Отримувач" (де може стояти лише код ЄДРПОУ, IBAN рахунок або заголовок блоку), А РЯДКОМ НИЖЧЕ навпроти підпису "Найменування" (або "Найменування платника", "Найменування отримувача", "Найменування клієнта"):
       
       [БЛОК ПЛАТНИКА / ДЕБЕТ]:
       Рядок: "Платник" (або "Платник / Дебет / Payer")
       Рядок нижче: "Найменування: [НАЗВА НАШОЇ КОМПАНІЇ]"
       ---> ЦЕ СТРОГО payerName (Платник / наша компанія зі СПИСКУ НАШИХ КОМПАНІЙ)!

       [БЛОК ОТРИМУВАЧА / КРЕДИТ]:
       Рядок: "Отримувач" (або "Отримувач / Одержувач / Кредит / Payee")
       Рядок нижче: "Найменування: [НАЗВА ПОСТАЧАЛЬНИКА]"
       ---> ЦЕ СТРОГО payeeName (Отримувач / постачальник зі СПИСКУ ПОСТАЧАЛЬНИКІВ)!

     * СУВОРЕ ПРАВИЛО: НЕ ПЛУТАЙ СЛОВО "Найменування"!
       І у блоці платника, і у блоці отримувача надруковано однакове слово "Найменування":
       - Те "Найменування", яке розташоване безпосередньо під/у блоці "Платник" — це ЗАВЖДИ Платник (payerName, наша компанія)!
       - Те "Найменування", яке розташоване безпосередньо під/у блоці "Отримувач" — це ЗАВЖДИ Отримувач (payeeName, постачальник)!

   - payerName: платник (наша компанія, ВЕЛИКИМИ БУКВАМИ БЕЗ ЛАПОК, наприклад "ТОВ БУДМОНТАЖ-2026", обов'язково звір зі СПИСКОМ НАШИХ КОМПАНІЙ)
   - payeeName: одержувач (постачальник, ВЕЛИКИМИ БУКВАМИ БЕЗ ЛАПОК, наприклад "ТОВ МЕТІНВЕСТ-СМЦ", витягни з блоку Отримувача)
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

        console.warn(
          `Gemini OCR attempt with model ${modelName} (attempt ${attempts}/${maxAttempts}) failed:`,
          errMsg
        );

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
    return {
      success: false,
      statusCode: 500,
      error: lastError?.message || 'Не вдалося розпізнати документ за допомогою Gemini AI. Перевірте якість файлу або формат.',
    };
  }

  // 1. Strictly format handwritten order number as xxx-xx without №
  const normalizeOrderNumberStr = (raw: string): string => {
    if (!raw) return '';
    let norm = String(raw).trim();
    norm = norm.replace(/^(?:№|No|N|#|зам\.?|замовлення|замовл\.?|код|з\.?|з-)\s*/i, '');
    norm = norm.replace(/[№#]/g, '');
    norm = norm.replace(/\s+/g, '');
    // If format is like "232/26" or "232.26"
    norm = norm.replace(/^(\d+)[/.](\d{2})$/, '$1-$2');
    if (/^\d{1,6}-\d{2}$/.test(norm)) {
      return norm;
    }
    // If pure digits without year (e.g. "232", "142", "45", "108")
    if (/^\d{1,4}$/.test(norm)) {
      return `${norm}-26`;
    }
    if (/^\d{3,6}$/.test(norm) && (norm.endsWith('26') || norm.endsWith('25') || norm.endsWith('24'))) {
      const order = norm.slice(0, -2);
      const year = norm.slice(-2);
      return `${order}-${year}`;
    }
    return norm;
  };

  if (parsedResult.handwrittenOrderNumber) {
    parsedResult.handwrittenOrderNumber = normalizeOrderNumberStr(parsedResult.handwrittenOrderNumber);
  } else if (parsedResult.handwrittenRawText) {
    // If rawText has a candidate number
    const candidate = normalizeOrderNumberStr(parsedResult.handwrittenRawText);
    if (/^\d{1,6}-\d{2}$/.test(candidate)) {
      parsedResult.handwrittenOrderNumber = candidate;
    }
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

  // Strict, robust documentType determination:
  const lowerFileName = (fileName || '').toLowerCase();
  const lowerDocTitle = String(parsedResult.documentTitle || '').toLowerCase();
  const lowerDocTypeUkr = String(parsedResult.documentTypeUkrainian || '').toLowerCase();
  const lowerBankStamp = String(parsedResult.bankExecutionStamp || '').toLowerCase();
  const lowerNotes = String(parsedResult.notes || '').toLowerCase();
  const lowerPurpose = String(parsedResult.paymentPurpose || '').toLowerCase();
  const lowerRawText = String(parsedResult.handwrittenRawText || '').toLowerCase();

  // Strong payment markers (NEVER classify as invoice if these match!):
  const hasPaymentTitle = (
    lowerDocTitle.includes('платіж') ||
    lowerDocTitle.includes('інструкц') ||
    lowerDocTitle.includes('доручен') ||
    lowerDocTitle.includes('квитанц') ||
    lowerDocTitle.includes('виписк') ||
    lowerDocTitle.includes('ордер') ||
    lowerDocTitle.includes('чек') ||
    lowerDocTypeUkr.includes('платіж') ||
    lowerDocTypeUkr.includes('інструкц') ||
    lowerDocTypeUkr.includes('доручен') ||
    lowerDocTypeUkr.includes('квитанц') ||
    lowerDocTypeUkr.includes('виписк') ||
    lowerDocTypeUkr.includes('ордер') ||
    lowerDocTypeUkr.includes('чек')
  );

  const hasPaymentFileName = (
    lowerFileName.includes('платіж') ||
    lowerFileName.includes('платеж') ||
    lowerFileName.includes('доручен') ||
    lowerFileName.includes('інструкц') ||
    lowerFileName.includes('квитанц') ||
    lowerFileName.includes('виписк') ||
    lowerFileName.includes('p24') ||
    lowerFileName.includes('receipt') ||
    lowerFileName.includes('payment')
  );

  // Genuine bank execution stamp - must be explicit stamp like "проведено банком", NOT merely words "банк" or "платник"!
  const hasBankExecutionStamp = (
    lowerBankStamp.includes('проведено банком') ||
    lowerBankStamp.includes('прийнято банком') ||
    lowerBankStamp.includes('дата прийняття до виконання') ||
    lowerBankStamp.includes('дата виконання') ||
    lowerNotes.includes('проведено банком') ||
    lowerNotes.includes('прийнято банком') ||
    lowerNotes.includes('дата прийняття до виконання') ||
    lowerNotes.includes('платіжна інструкція') ||
    lowerNotes.includes('платіжне доручення') ||
    lowerRawText.includes('проведено банком') ||
    lowerRawText.includes('прийнято банком') ||
    lowerRawText.includes('платіжна інструкція')
  );

  // Purpose pattern typical of bank payment slips paying an invoice ("Оплата за товар згідно рах. №...")
  const hasPaymentPurposePattern = (
    Boolean(parsedResult.paymentPurpose) &&
    (
      lowerPurpose.includes('оплата за') ||
      lowerPurpose.includes('оплата згідно') ||
      lowerPurpose.includes('перерахування')
    ) &&
    (!parsedResult.lineItems || parsedResult.lineItems.length === 0)
  );

  const isExplicitInvoice = (
    parsedResult.documentType === 'invoice' ||
    lowerDocTitle.includes('рахунок') ||
    lowerDocTypeUkr.includes('рахунок') ||
    lowerDocTitle.includes('invoice') ||
    lowerDocTypeUkr.includes('invoice') ||
    lowerDocTitle.includes('счет') ||
    lowerDocTypeUkr.includes('счет') ||
    Boolean(parsedResult.lineItems && parsedResult.lineItems.length > 0)
  );

  let isPayment = false;
  if (hasPaymentTitle || hasPaymentFileName) {
    isPayment = true;
  } else if (isExplicitInvoice) {
    isPayment = Boolean(hasBankExecutionStamp && (!parsedResult.lineItems || parsedResult.lineItems.length === 0));
  } else {
    isPayment = Boolean(
      parsedResult.documentType === 'payment' ||
      hasBankExecutionStamp ||
      hasPaymentPurposePattern
    );
  }

  const INVALID_WORDS = new Set([
    'рахунок', 'рахунка', 'рахунку', 'рахунком', 'рахунки', 'рахунків',
    'рах', 'счет', 'счета', 'счету', 'згідно', 'зг', 'по', 'за', 'від',
    'до', 'на', 'договір', 'договору', 'дог', 'акт', 'акту', 'накладна',
    'товарний', 'замовлення', 'оплата', 'грн', 'uah', 'пдв'
  ]);

  if (isPayment) {
    parsedResult.documentType = 'payment';
    if (!parsedResult.documentTypeUkrainian || parsedResult.documentTypeUkrainian.toLowerCase().includes('рахунок')) {
      parsedResult.documentTypeUkrainian = 'Платіжна інструкція';
    }
    parsedResult.paymentStatus = 'Оплачено';

    // 1. Extract referenced invoice number from payment purpose if present (e.g. "згідно рах. № 4104")
    if (parsedResult.paymentPurpose) {
      const refMatches = parsedResult.paymentPurpose.matchAll(/(?:(?:згідно|по|за|оплата|сплата)\s+)?(?:рах(?:\.|унк(?:у|а|ом|ів|и|ок)?)?|счет(?:а|у|ом)?|сф-?)\s*(?:№|No|N|#|:|від\s+)?\s*([A-Za-zА-Яа-яІіЇїЄєҐґ0-9\-_/]+)/gi);
      const foundInvs: string[] = [];
      for (const m of refMatches) {
        let cleaned = m[1].replace(/^(?:№|No|N|#|:)\s*/i, '').trim();
        cleaned = cleaned.replace(/^[\.,;:—\-\s]+|[\.,;:—\-\s]+$/g, '');
        if (cleaned && cleaned.length >= 1 && !INVALID_WORDS.has(cleaned.toLowerCase())) {
          foundInvs.push(cleaned);
        }
      }
      if (foundInvs.length > 0) {
        if (!parsedResult.referencedInvoiceNumbers || parsedResult.referencedInvoiceNumbers.length === 0) {
          parsedResult.referencedInvoiceNumbers = Array.from(new Set(foundInvs));
        }
        if (!parsedResult.referencedInvoiceNumber) {
          parsedResult.referencedInvoiceNumber = parsedResult.referencedInvoiceNumbers.join(', ');
        }
      }
    }

    // 2. Payment document number extraction:
    // Look for "N 1216", "№ 1216", "N 1215" in title, notes, raw text, or filename
    if (!parsedResult.paymentNumber) {
      const allText = `${parsedResult.documentTitle || ''} ${parsedResult.notes || ''} ${parsedResult.handwrittenRawText || ''} ${fileName || ''}`;
      const pNumMatch = allText.match(/(?:платіжна інструкція|доручення|від|[N№])\s*(?:N|№)?\s*(\d{1,10})/i);
      if (pNumMatch && pNumMatch[1]) {
        parsedResult.paymentNumber = pNumMatch[1].trim();
      } else if (parsedResult.invoiceNumber && parsedResult.invoiceNumber !== parsedResult.referencedInvoiceNumber) {
        // If invoiceNumber was filled by OCR with the payment slip number
        parsedResult.paymentNumber = parsedResult.invoiceNumber;
      }
    }

    // Ensure invoiceNumber on a payment does not mask paymentNumber
    if (parsedResult.invoiceNumber === parsedResult.paymentNumber) {
      parsedResult.invoiceNumber = parsedResult.referencedInvoiceNumber || undefined;
    }
  } else {
    parsedResult.documentType = 'invoice';
    if (!parsedResult.documentTypeUkrainian || parsedResult.documentTypeUkrainian.includes('Платіж') || parsedResult.documentTypeUkrainian.includes('інструкц')) {
      parsedResult.documentTypeUkrainian = 'Рахунок на оплату';
    }
    if (!parsedResult.paymentStatus) {
      parsedResult.paymentStatus = 'Не оплачено';
    }

    // Cross-fill from payment box if supplier/buyer were placed into payee/payer
    if (!parsedResult.supplierName && parsedResult.payeeName) {
      parsedResult.supplierName = parsedResult.payeeName;
    }
    if (!parsedResult.buyerName && parsedResult.payerName) {
      parsedResult.buyerName = parsedResult.payerName;
    }
    if (!parsedResult.invoiceNumber && parsedResult.paymentNumber) {
      parsedResult.invoiceNumber = parsedResult.paymentNumber;
    }
    parsedResult.paymentNumber = undefined;
  }

  // Payment-specific normalization and cross-filling
  if (parsedResult.documentType === 'payment') {
    // 1. Smart Anti-Swap Check: In bank receipts with two "Найменування" rows (one under Платник, one under Отримувач),
    // models sometimes mix them up. Check against configured ourCompanies and suppliers:
    if (parsedResult.payeeName && parsedResult.payerName && ourCompanies.length > 0) {
      const isPayeeOurCompany = ourCompanies.some((c) => isCompanyNameMatch(c, parsedResult.payeeName!));
      const isPayerOurCompany = ourCompanies.some((c) => isCompanyNameMatch(c, parsedResult.payerName!));
      const isPayerSupplier = suppliers.some((s) => isCompanyNameMatch(s, parsedResult.payerName!));

      if (isPayeeOurCompany && (!isPayerOurCompany || isPayerSupplier)) {
        console.log(`[OCR Smart Swap API] Swapping payerName "${parsedResult.payerName}" and payeeName "${parsedResult.payeeName}" because payee matches ourCompanies!`);
        const temp = parsedResult.payerName;
        parsedResult.payerName = parsedResult.payeeName;
        parsedResult.payeeName = temp;
      }
    }

    // 2. Rescue missing payeeName (Отримувач / Постачальник)
    if (!parsedResult.payeeName || parsedResult.payeeName === '—') {
      const purpose = parsedResult.paymentPurpose || '';
      const notes = parsedResult.notes || '';
      const fullText = `${purpose} ${notes}`;

      // A) Try matching against suppliers list
      for (const sup of suppliers) {
        if (sup && sup.length >= 3 && isCompanyNameMatch(fullText, sup)) {
          parsedResult.payeeName = normalizeCompanyName(sup);
          break;
        }
      }

      // B) Try regex extraction for company name in paymentPurpose
      if (!parsedResult.payeeName || parsedResult.payeeName === '—') {
        const compMatch = purpose.match(/(?:отримувач|одержувач|постачальник|продавець)?\s*[:=]?\s*(ТОВ|ПП|ФОП|ПрАТ|ПАТ|АТ|ТДВ)\s+["'«»]?[A-Za-zА-Яа-яІіЇїЄєҐґ0-9\s\-–—]{2,40}["'«»]?/i);
        if (compMatch && compMatch[0]) {
          const candidate = normalizeCompanyName(compMatch[0]);
          if (!ourCompanies.some((c) => isCompanyNameMatch(c, candidate))) {
            parsedResult.payeeName = candidate;
          }
        }
      }
    }

    // 3. Rescue missing payerName (Платник / Наша компанія)
    if (!parsedResult.payerName || parsedResult.payerName === '—') {
      const fullText = `${parsedResult.paymentPurpose || ''} ${parsedResult.notes || ''}`;
      for (const ourComp of ourCompanies) {
        if (ourComp && isCompanyNameMatch(fullText, ourComp)) {
          parsedResult.payerName = normalizeCompanyName(ourComp);
          break;
        }
      }
      if ((!parsedResult.payerName || parsedResult.payerName === '—') && ourCompanies.length === 1) {
        parsedResult.payerName = normalizeCompanyName(ourCompanies[0]);
      }
    }

    if (parsedResult.payerName && !parsedResult.buyerName) {
      parsedResult.buyerName = parsedResult.payerName;
    } else if (parsedResult.buyerName && !parsedResult.payerName) {
      parsedResult.payerName = parsedResult.buyerName;
    }
    if (parsedResult.payeeName && !parsedResult.supplierName) {
      parsedResult.supplierName = parsedResult.payeeName;
    } else if (parsedResult.supplierName && !parsedResult.payeeName) {
      parsedResult.payeeName = parsedResult.supplierName;
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

    // Try regex extraction of invoice numbers from paymentPurpose
    const purpose = parsedResult.paymentPurpose || '';
    if (purpose) {
      const foundNumbers = new Set<string>();

      if (Array.isArray(parsedResult.referencedInvoiceNumbers)) {
        parsedResult.referencedInvoiceNumbers.forEach((num: any) => {
          if (num && typeof num === 'string' && num.trim()) {
            foundNumbers.add(num.trim());
          }
        });
      }

      if (parsedResult.referencedInvoiceNumber) {
        const parts = String(parsedResult.referencedInvoiceNumber).split(/[,;+&|\s]+/);
        parts.forEach((p) => {
          const clean = p.replace(/^(№|No|N|#)\s*/i, '').trim();
          if (clean.length >= 1) foundNumbers.add(clean);
        });
      }

      const generalInvRegex = /(?:рахунк(?:и|ів|ами|ах|у|ом|ок)?|рах(?:унок|\.?)|СФ|СФ-|сч(?:ет|\.?)|інвойс(?:и|ів)?|№)\s*[:№#]?\s*([A-Za-zА-Яа-яІіЇїЄє0-9\-\/_]+(?:\s*(?:,|і|та|також|;)\s*(?:№|No|#)?\s*[A-Za-zА-Яа-яІіЇїЄє0-9\-\/_]+)*)/gi;
      let match: RegExpExecArray | null;
      while ((match = generalInvRegex.exec(purpose)) !== null) {
        if (match[1]) {
          const tokens = match[1].split(/[\s,;+&|]+|(?:та|і|також)/i);
          tokens.forEach((t) => {
            const cleaned = t.replace(/^(?:№|No|N|#|від|от|\.|\,)\s*/i, '').trim();
            if (cleaned.length >= 1 && !/^(від|от|року|р|грн|коп|без|пдв|до)$/i.test(cleaned)) {
              foundNumbers.add(cleaned);
            }
          });
        }
      }

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

    if (!parsedResult.handwrittenOrderNumber && parsedResult.paymentPurpose) {
      const orderMatch = parsedResult.paymentPurpose.match(/(?:зам(?:овлення|\.?)|код)\s*([0-9]{1,4}-[0-9]{2})/i);
      if (orderMatch && orderMatch[1]) {
        parsedResult.handwrittenOrderNumber = orderMatch[1].trim();
        parsedResult.referencedOrderNumber = orderMatch[1].trim();
      }
    }

    parsedResult.paymentStatus = 'Оплачено';

    // Ensure invoiceNumber points to referencedInvoiceNumber (for cross-matching) or is clean
    if (parsedResult.referencedInvoiceNumber) {
      parsedResult.invoiceNumber = parsedResult.referencedInvoiceNumber;
    } else if (parsedResult.invoiceNumber === parsedResult.paymentNumber) {
      parsedResult.invoiceNumber = '';
    }

    // Synchronize dates if one is missing
    if (parsedResult.paymentDate && !parsedResult.invoiceDate) {
      parsedResult.invoiceDate = parsedResult.paymentDate;
    } else if (parsedResult.invoiceDate && !parsedResult.paymentDate) {
      parsedResult.paymentDate = parsedResult.invoiceDate;
    }
  } else if (parsedResult.documentType === 'invoice') {
    parsedResult.paymentStatus = 'Не оплачено';
  }

  // 3. Targeted Amount Rescue if 0
  if ((parsedResult.totalAmount || 0) <= 0 && (parsedResult.amountPaid || 0) <= 0) {
    try {
      console.log(`[OCR Rescue] Document has 0 amount. Running targeted amount extraction with Gemini Flash...`);
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
      console.warn('Targeted amount rescue error:', rescueErr);
    }
  }

  // 4. Targeted Handwritten Order Number Rescue if missing on an invoice
  if (parsedResult.documentType === 'invoice' && !parsedResult.handwrittenOrderNumber) {
    try {
      console.log(`[OCR Order Rescue] Invoice is missing handwritten order number. Running targeted visual scan with Gemini...`);
      const rescueOrderPrompt = `КРИТИЧНЕ ЗАВДАННЯ ДЛЯ ЗОБРАЖЕННЯ РАХУНКУ:
У первинному аналізі номер замовлення не виявлено. Але на рахунках у нашій компанії менеджер обов'язково пише номер замовлення ВІД РУКИ (ручкою — синьою, фіолетовою чи чорною, олівцем, або маркером).

Уважно оглянь кожен міліметр документа:
1. Верхній правий кут (найчастіше місце написання!)
2. Верхній лівий кут, поруч з логотипом чи реквізитами постачальника
3. На полях (бічних відступах зліва або справа, текст може бути написаний вертикально!)
4. Безпосередньо біля або над назвою документа: "Рахунок на оплату", "Рахунок-фактура", "СФ-..."
5. Внизу документа — біля загальної суми, печатки або підпису

Як може виглядати номер:
- "142-26", "232-26", "083-26", "229-26", "216-26", "207-26", "45-26", "108-26"
- Або з префіксом чи символом: "№ 232-26", "№142-26", "зам. 232", "з. 232-26", "З-232"
- Або через косу риску чи крапку: "232/26", "142/26", "232.26"
- Або просто число без року (наприклад "232", "142", "45", "108", або обведене в кружечок) -> у цьому випадку стандартизуй до формату з поточним роком: "232-26"!

Поверни JSON строго такого формату:
{
  "found": true,
  "orderNumber": "232-26",
  "rawText": "№ 232-26",
  "location": "Верхній правий кут",
  "confidence": "high"
}`;

      const rescueOrderResponse = await ai.models.generateContent({
        model: 'gemini-flash-latest',
        contents: [
          {
            inlineData: {
              mimeType: finalMimeType,
              data: cleanBase64,
            },
          },
          { text: rescueOrderPrompt },
        ],
        config: {
          responseMimeType: 'application/json',
          temperature: 0.1,
        },
      });

      let rOrderText = rescueOrderResponse.text || '';
      rOrderText = rOrderText.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
      if (rOrderText) {
        const parsedRescueOrder = JSON.parse(rOrderText);
        if (parsedRescueOrder.found && (parsedRescueOrder.orderNumber || parsedRescueOrder.rawText)) {
          const rawNum = parsedRescueOrder.orderNumber || parsedRescueOrder.rawText;
          const normalized = normalizeOrderNumberStr(rawNum);
          if (normalized) {
            parsedResult.handwrittenOrderNumber = normalized;
            parsedResult.handwrittenRawText = parsedRescueOrder.rawText || rawNum;
            parsedResult.handwrittenLocation = parsedRescueOrder.location || 'Знайдено при повторному скануванні';
            parsedResult.handwrittenConfidence = parsedRescueOrder.confidence || 'medium';
            console.log(`[OCR Order Rescue] Successfully rescued handwritten order number: ${normalized}`);
          }
        }
      }
    } catch (orderRescueErr) {
      console.warn('Targeted order number rescue error:', orderRescueErr);
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

  return {
    success: true,
    data: parsedResult,
    fileName,
  };
}

// Default export: Vercel Serverless Function Handler
export default async function handler(req: any, res: any) {
  // CORS configuration
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: `Method ${req.method} not allowed. Please use POST.`,
    });
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {
        return res.status(400).json({ success: false, error: 'Invalid JSON body' });
      }
    }

    const {
      fileData,
      mimeType,
      fileName,
      ourCompanies,
      suppliers,
      knownOrders,
      docTypeHint,
    } = body || {};

    const result = await processOcrDocument({
      fileData,
      mimeType,
      fileName,
      ourCompanies,
      suppliers,
      knownOrders,
      docTypeHint,
    });

    if (!result.success) {
      return res.status(result.statusCode || 500).json(result);
    }

    return res.status(200).json(result);
  } catch (error: any) {
    console.error('Vercel Serverless OCR Error:', error);
    let userFriendlyMessage = 'Помилка обробки документа через Gemini OCR на Vercel Serverless.';
    const rawMsg = error?.message || String(error);
    if (rawMsg.includes('503') || rawMsg.includes('high demand') || rawMsg.includes('UNAVAILABLE')) {
      userFriendlyMessage = 'Сервіс Gemini тимчасово перевантажений. Будь ласка, натисніть "Повторити" через кілька секунд.';
    } else if (rawMsg.includes('429') || rawMsg.includes('RESOURCE_EXHAUSTED')) {
      userFriendlyMessage = 'Перевищено ліміт запитів до AI. Зачекайте кілька секунд та спробуйте знову.';
    } else if (rawMsg.includes('API key') || rawMsg.includes('GEMINI_API_KEY')) {
      userFriendlyMessage = 'Ключ Gemini API не знайдено або він недійсний. Перевірте змінні середовища GEMINI_API_KEY у налаштуваннях Vercel.';
    }

    return res.status(500).json({
      success: false,
      error: userFriendlyMessage,
      details: rawMsg,
    });
  }
}
