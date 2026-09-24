import { GoogleGenAI, Type, Schema } from '@google/genai';
import { OCRResult, InvoicePaymentStatus, ExistingSheetRow, ExistingPaymentRow, ProcessedDocument, DuplicateRowMatch, OverheadExpenseRow } from '../types';
import { DEFAULT_OUR_COMPANIES, KNOWN_PROJECT_ORDERS } from '../data/sampleDocuments';
import { ensureOcrDates, normalizeDateToIso, extractDateFromText } from '../utils/dateUtils';

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
    documentTitle: {
      type: Type.STRING,
      description: 'Exact main title or header printed at top of document, e.g. "ПЛАТІЖНА ІНСТРУКЦІЯ В НАЦІОНАЛЬНІЙ ВАЛЮТІ", "РАХУНОК НА ОПЛАТУ №...", "АКТ"',
    },
    bankExecutionStamp: {
      type: Type.STRING,
      description: 'Bank processing/execution stamps or digital signature markers if present, e.g. "Дата виконання БАНК 09.09.2026", "iBank2UA ЕП Є КОРЕКТНИМ", "Проведено банком", "UETR"',
    },
    expenseCategory: {
      type: Type.STRING,
      enum: ['PROJECT', 'OVERHEAD'],
      description: 'Category of expense: "OVERHEAD" if marked with "ЦЕХ", "Цєх", "ЦЕК", "ЦEХ", "ЦУХ", "цехові", "на цех" etc. (рукописна позначка Цех або загальновиробничі накладні витрати цеху без конкретного номера проекту). Otherwise "PROJECT" if having project order number (e.g. 142-26) or regular project expense.',
    },
    isOverhead: {
      type: Type.BOOLEAN,
      description: 'Set to true if document has a handwritten or printed mark "ЦЕХ" or fuzzy handwriting variations ("Цєх", "ЦЕК", "ЦEХ", "ЦУХ", "цехові", etc.) indicating workshop overhead expense. Otherwise false.',
    },
    handwrittenOrderNumber: {
      type: Type.STRING,
      description: 'Handwritten internal order number strictly in format "xxx-xx" without the "№" symbol (e.g. "142-26", "089-26", "45-26", "1054-26") OR "ЦЕХ" if marked with "ЦЕХ" / "Цєх" / "ЦЕК" / "ЦEХ" / "ЦУХ" / "цехові" / "на цех" (рукописні варіації слова цех/цехові/накладні). Look for pen/pencil handwriting anywhere on the document. If no handwriting is found, return empty string "".',
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
      description: 'Buyer / Our company name in strict format: "ТОВ НАЗВА КОМПАНІЇ" (ALL UPPERCASE, NO QUOTES). Extract from "Покупець", "Платник" (if "той самий", take from "Покупець" or "Одержувач"), "Замовник", "Одержувач", "Вантажоодержувач", delivery block, or handwritten text/stamps. Prioritize matching our companies list (e.g. ТОВ ШОП ІНТЕРІОР, ТОВ ПРЕСТИЖБУД, ТОВ ГОЛДЕН ПОІНТ, ТОВ БУДМОНТАЖ-2026). Never leave empty if any buyer company is present.',
    },
    buyerTaxId: {
      type: Type.STRING,
      description: 'Buyer EDRPOU / IPN code',
    },
    invoiceNumber: {
      type: Type.STRING,
      description: 'Invoice number (Номер рахунку, e.g. "227763", "СФ-000452", "125"). NEVER return words like "рахунок", "рахунка", "рахунку", "інвойс", "згідно" - extract ONLY the alphanumeric number or code itself.',
    },
    invoiceDate: {
      type: Type.STRING,
      description: 'Invoice issue date strictly in YYYY-MM-DD format (e.g. "2026-09-15"). Look in header after word "від" ("від 15.09.2026", "від 15 вересня 2026 р.", "від «15» вересня 2026"), or "Дата:", "Дата рахунку:", "Дата складання:". Convert any written or numeric date to strict YYYY-MM-DD.',
    },
    invoiceDateOriginal: {
      type: Type.STRING,
      description: 'Original date string as printed on document, e.g. "15 вересня 2026 р.", "15.09.2026", "від 12.09.2026 р."',
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
    'expenseCategory',
    'isOverhead',
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
  docTypeHint?: 'auto' | 'invoice' | 'payment';
}): Promise<OCRResult> {
  const {
    fileData,
    mimeType: rawMimeType,
    fileName,
    ourCompanies,
    suppliers,
    knownOrders,
    apiKey,
    docTypeHint,
  } = params;

  // Safely strip ANY data URL prefix regardless of attributes (e.g. data:...;charset=...;base64,)
  const commaIndex = fileData.indexOf(',');
  const rawBase64 = (fileData.startsWith('data:') && commaIndex !== -1)
    ? fileData.slice(commaIndex + 1)
    : fileData;
  const cleanBase64 = rawBase64.replace(/\s+/g, '');
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
    ? `\nДОВІДНИК АКТИВНИХ ВНУТРІШНІХ ЗАМОВЛЕНЬ:\n${knownOrders.map((o: any) => `- Код: ${typeof o === 'string' ? o : o.code + (o.title ? ' (' + o.title + ')' : '')}`).join('\n')}\n(УВАГА: Цей довідник надано ВИКЛЮЧНО як допоміжний орієнтир для уточнення неоднозначних рукописних цифр на документі! КАТЕГОРИЧНО ЗАБОРОНЕНО вигадувати або підставляти номер з довідника, якщо таких цифр насправді немає на зображенні документа!)`
    : '';

  const docTypeHintInstruction = docTypeHint === 'invoice'
    ? '\nВКАЗІВКА ВІД КОРИСТУВАЧА: Цей файл є РАХУНКОМ НА ОПЛАТУ (invoice). Обов\'язково встанови documentType="invoice", documentTypeUkrainian="Рахунок на оплату". Визнач точний числовий номер рахунку (invoiceNumber), дату (invoiceDate), постачальника (supplierName), покупця (buyerName) та суму (totalAmount).\n'
    : docTypeHint === 'payment'
    ? '\nВКАЗІВКА ВІД КОРИСТУВАЧА: Цей файл є ПЛАТІЖНИМ ДОКУМЕНТОМ (payment). Обов\'язково встанови documentType="payment".\n'
    : '';

  const systemPrompt = `Ти високоточний експертний модуль автоматичного розпізнавання (OCR) первинних фінансових документів (Рахунків на оплату, Банківських платіжок/квитанцій, чеків, скріншотів мобільного банкінгу) для українського та міжнародного бізнесу.

Перед тобою документ (PDF або фото) з ім'ям "${fileName}".
ЗВЕРНИ УВАГУ: Документ може бути фотографією роздрукованого рахунку, квитанції про оплату, чеку або скріншоту додатку інтернет-банкінгу (Приват24, Монобанк тощо), завантаженим через телефон чи месенджер (WhatsApp/Viber/Telegram). Ретельно прочитай кожне поле, цифру та літеру навіть якщо зображення стиснене чи сфотографоване під кутом.

${ourCompaniesPromptList}
${suppliersPromptList}
${knownOrdersPromptList}
${docTypeHintInstruction}

================================================================================
ЕТАП 1 (НАЙВИЩИЙ ПРІОРИТЕТ): ПЕРВИННИЙ СКАНІНГ РУКОПИСНОГО ТЕКСТУ ТА КЛАСИФІКАЦІЯ «ЦЕХ» (OVERHEAD) ПРОТИ «ЗАМОВЛЕННЯ ПРОЕКТУ»:
================================================================================
1. ПРІОРИТЕТ АНАЛІЗУ РУКОПИСНОГО ТЕКСТУ:
   - Перед розпізнаванням друкованого тексту рахунку, ЗРОБИ ПЕРВИННИЙ СКАЙНИНГ ЗОБРАЖЕННЯ на наявність будь-яких рукописних позначок (зроблених маркером, ручкою будь-якого кольору, олівцем).
   - Шукай слово "ЦЕХ" (у будь-якому регістрі: "Цех", "цех", "ЦЕХ") або схожі рукописні варіації у кутках (особливо верхній правий або верхній лівий кут), на полях (margins) або зверху документа над назвою чи біля суми.

2. ПОКРАЩЕННЯ ТОЧНОСТІ (FUZZY MATCHING / ВРАХУВАННЯ ПОЧЕРКУ):
   - Враховуй особливості людського почерку: якщо бачиш рукописні літери, схожі на "ЦЕХ", "Цєх", "ЦЕК", "ЦEХ" (із заміною латинськими літерами C, E, X, K), "ЦУХ", "Цэx", "Цук", "Цек", "CEX", "CEK", "CEH", "CUH", "TSEH", або фрази "на цех", "для цеху", "в цех", "цехові", "цехові витрати" — НЕ ВИМАГАЙ ідеальної друкарської точності від рукописного слова!
   - АВТОМАТИЧНО класифікуй такий документ як категорію OVERHEAD (Цех / Загальновиробничі накладні витрати цеху).
   - При виявленні позначки «ЦЕХ» / схожих рукописних варіацій ОБОВ'ЯЗКОВО встанови:
     * "isOverhead": true
     * "expenseCategory": "OVERHEAD"
     * "handwrittenOrderNumber": "ЦЕХ"
     * "handwrittenRawText": точний рукописний напис, який ти бачиш (наприклад "ЦЕХ", "Цех", "ЦУХ", "Цєх", "ЦЕК", "ЦEХ")
     * "handwrittenLocation": місце знаходження позначки (наприклад "Верхній правий кут", "На полях", "Вгорі над заголовком")
     * "handwrittenConfidence": "high"

3. РУКОПИСНИЙ НОМЕР ЗАМОВЛЕННЯ ПРОЕКТУ (ЯКЩО ПОЗНАЧКИ «ЦЕХ» НЕМАЄ):
   - Якщо на рахунку від руки написано номер замовлення проекту (наприклад "142-26", "232-26", "089-26", "45-26", або число "232" -> "232-26"):
     * "isOverhead": false
     * "expenseCategory": "PROJECT"
     * "handwrittenOrderNumber": "ххх-26" (стандартизовано до формату з роком)
     * "handwrittenRawText": точний напис (наприклад "№ 232-26")
     * "handwrittenConfidence": "high" або "medium"

4. ВІДСУТНІСТЬ РУКОПИСНИХ ПОЗНАЧОК:
   - Якщо на рахунку немає жодних рукописних позначок:
     * "isOverhead": false
     * "expenseCategory": "PROJECT"
     * "handwrittenOrderNumber": ""
     * "handwrittenConfidence": "none"

5. СУВОРА ЕКОНОМІЯ API ЗАПИТІВ:
   - Здійсни аналіз зображення, класифікацію (Замовлення/Цех) та розпізнавання всіх реквізитів за ОДИН ЄДИНИЙ ЗАПИТ до Gemini API, без повторних спроб або перерозпізнавання!
   - Повертай підсумковий валідний JSON строго за схемою з обов'язковим прапорцем "isOverhead": true або false та "expenseCategory": "OVERHEAD" або "PROJECT".

================================================================================
ЕТАП 2: ОСНОВНІ ПРАВИЛА РОЗПІЗНАВАННЯ ДОКУМЕНТА:
================================================================================
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
   - СТРОГИЙ СТАНДАРТИЗОВАНИЙ ФОРМАТ: "ТОВ НАЗВА КОМПАНІЇ" АБО "ФОП ПРІЗВИЩЕ І.Б.", ВСІ БУКВИ ВЕЛИКІ, БЕЗ ЛАПОК!
   - Приклади: "ТОВ ШОП ІНТЕРІОР", "ТОВ ЛЕГНОПРОМ", "ТОВ ЕПІЦЕНТР К", "ФОП ШЕВЧЕНКО І.В.", "ФОП ІВАНОВ І.І.".
   - КАТЕГОРИЧНО ЗАБОРОНЕНО ставити будь-які лапки (", ', «, ») чи залишати маленькі букви!
   - supplierName: Це компанія, яка виставила рахунок (продавець / постачальник / виконавець).
     ВАЖЛИВО: Назва постачальника НЕ МОЖЕ співпадати з назвою наших компаній!
   
   - buyerName (НАША КОМПАНІЯ — ПОКУПЕЦЬ / ПЛАТНИК / ОДЕРЖУВАЧ):
     * КРИТИЧНО: Якщо в рахунку фігурує 'ФОП БОДНАР ЛАРИСА ВАЛЕНТИНІВНА' (або 'Боднар Лариса', 'Боднар Л.В.', 'ФОП Боднар') чи будь-яка з НАШИХ КОМПАНІЙ — вона ЗАВЖДИ є buyerName (Покупець / Одержувач / Платник), і КАТЕГОРИЧНО НЕ постачальник (supplierName)!
     * ДЕ ШУКАТИ В РАХУНКАХ:
       1. Рядок "Покупець:" (найчастіше розташований під або праворуч від "Постачальник:").
       2. Рядок "Платник:"
          КРИТИЧНО ДЛЯ РАХУНКІВ (як у ПрАТ "СОЛДІ І КО" / METALVIS, Епіцентр тощо): якщо в рядку "Платник" написано "той самий", "той же" або стоїть прочерк — це означає, що платником є компанія з рядка "Покупець"! ОБОВ'ЯЗКОВО візьми назву з рядка "Покупець"!
       3. Рядки "Замовник:", "Одержувач:", "Вантажоодержувач:".
       4. У блоці реквізитів для оплати вгорі або внизу рахунку ("Платник: ...").
     * ОСОБЛИВОСТІ РОЗРАХУНКІВ ФОП НА ФОП:
       - Якщо обидві сторони є фізичними особами-підприємцями (ФОП):
         * У рахунку: Постачальник — це ФОП постачальника (supplierName), а Покупець/Платник — це наш ФОП (buyerName).
         * У платіжці: Платник — це наш ФОП (payerName), а Отримувач — це ФОП постачальника (payeeName).
         * Завжди зберігай ініціали та прізвище у форматі "ФОП ПРІЗВИЩЕ І.Б." або "ФОП ПРІЗВИЩЕ ІМ'Я ПО БАТЬКОВІ".
     * ЗІСТАВЛЕННЯ ЗІ СПИСКОМ НАШИХ КОМПАНІЙ:
       - Наші компанії строго відповідають 4 юридичним особам: "ТОВ ПРЕМІУМ ШОП", "ТОВ ШОП ІНТЕРІОР", "ТОВ ГАЛА ПРОДАКШН", "ТОВ ІНОКС УКРАЇНА".
       - Навіть якщо на рахунку надруковано повну форму "Товариство з обмеженою відповідальністю «Шоп Інтеріор»" або просто "Преміум Шоп" чи назва без лапок або без ТОВ — зістав її з компанією зі СПИСКУ НАШИХ КОМПАНІЙ і поверни стандартизований варіант обов'язково з ТОВ: "ТОВ ПРЕМІУМ ШОП", "ТОВ ШОП ІНТЕРІОР", "ТОВ ГАЛА ПРОДАКШН" або "ТОВ ІНОКС УКРАЇНА"!
       - Якщо компанії чи нашого ФОПа ще немає в списку, все одно поверни точну назву покупця з рахунку у форматі "ТОВ НАЗВА" чи "ФОП ПРІЗВИЩЕ І.Б." великими літерами.
       - КАТЕГОРИЧНО ЗАБОРОНЕНО залишати поле buyerName порожнім або ставити "той самий", якщо в рахунку зазначено покупця!

4. НОМЕР ТА ДАТА РАХУНКУ (invoiceNumber, invoiceDate, invoiceDateOriginal):
   - invoiceNumber: Номер рахунку (наприклад "СФ-000124", "452-М", "227763", "125").
     * КАТЕГОРИЧНО ЗАБОРОНЕНО повертати слова "рахунок", "рахунка", "рахунку", "рахунком", "інвойс", "invoice", "згідно", "номер", "б/н"!
     * Якщо на документі написано "Рахунок на оплату № 227763" чи "Призначення платежу: згідно рахунка № 227763", номером є ВИКЛЮЧНО число/код "227763"!
     * Якщо перед номером стоїть префікс "№", "No", "N", "номер", "рах." — обов'язково відкинь цей префікс і повертай тільки сам номер.
   - invoiceDate: Дата виставлення рахунку ОБОВ'ЯЗКОВО у форматі РРРР-ММ-ДД (YYYY-MM-DD, наприклад "2026-09-15").
     * ДЕ ШУКАТИ ДАТУ РАХУНКУ (обов'язково оглянь!):
       1. У назві / шапці рахунку поруч із номером: "Рахунок на оплату № ... від 15 вересня 2026 р.", "від 15.09.2026", "від «15» вересня 2026 року", "Рахунок-фактура № ... від 15.09.26", "Рахунок № ... від ...". Слово "від" (або "от") завжди вказує на дату складання рахунку!
       2. В окремих рядках: "Дата:", "Дата рахунку:", "Дата складання:", "Дата виписки:", "Дата оформлення:", "Date:".
       3. У таблиці або реквізитах рахунку вгорі чи внизу.
     * ЯК ПРАВИЛЬНО ЗАПОВНИТИ:
       - Якщо на документі надруковано "від 15 вересня 2026 р.", або "15.09.2026", або "15.09.26" — ОБОВ'ЯЗКОВО перетвори у формат YYYY-MM-DD ("2026-09-15") та запиши в invoiceDate!
       - Запиши точний текст дати як є (наприклад "15 вересня 2026 р." чи "15.09.2026") у поле invoiceDateOriginal!
       - КАТЕГОРИЧНО ЗАБОРОНЕНО залишати invoiceDate порожнім або ставити "—", якщо на рахунку є хоч якась дата виставлення чи складання!
       - Також продублюй цю дату в поле paymentDate.

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
   - referencedInvoiceNumber: номер(и) рахунку, які оплачуються цією платіжкою.
     Шукати комбінації виключно після ключових слів-тригерів: рахунок, рах., рах, Счет, сч., №, дог., договір.
     Патерни номерів: числові або альфа-нумеричні коди (наприклад: 1815, 1301, 169, 730), або з префіксами/дефісами/підкресленнями (наприклад: Р2608535, RF26_1611, Ц-000117212, СФ-0042, 142/26).
     Якщо вказано декілька номерів (через кому, пробіл або та) — витягни ВСІ окремі номери та розділи строго комою з пробілом (наприклад "RF26_1611, RF26_1642, RF26_1645").
     СУВОРО ЗАБОРОНЕНО писати сміття:
     - ПДВ та відсотки: т.ч., в т.ч., ПДВ, 20%, без ПДВ.
     - Суми та валюту: 1369.18, 24195.30, грн, грн., UAH.
     - Загальні описові слова: фарбу, фарба, матер, матеріали, товар, послуги, оплата, згідно, аванс.
     Якщо в призначенні немає жодного конкретного номера рахунку (наприклад "Оплата за товар" або "за матер") — записуй строго порожній рядок "", але НІКОЛИ не записуй слова "товар" чи "матер" у поле номера рахунку!
   - referencedInvoiceNumbers: МАСИВ УСІХ окремих виявлених номерів рахунків (наприклад ["RF26_1611", "RF26_1642", "RF26_1645"] або ["1815"]). Якщо платіжка оплачує декілька рахунків — обов'язково витягни ВСІ окремі номери в цей масив! Якщо рахунків немає — поверни порожній масив [].
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

  // 1. Strictly format handwritten order number as xxx-xx without № (or "ЦЕХ" for overhead)
  if (parsedResult.handwrittenOrderNumber) {
    parsedResult.handwrittenOrderNumber = OCRService.normalizeOrderNumber(parsedResult.handwrittenOrderNumber);
  } else if (parsedResult.handwrittenRawText) {
    const candidate = OCRService.normalizeOrderNumber(parsedResult.handwrittenRawText);
    if (/^\d{1,6}-\d{2}$/.test(candidate) || OCRService.isOverheadMarker(candidate)) {
      parsedResult.handwrittenOrderNumber = candidate === 'ЦЕХ' ? 'ЦЕХ' : candidate;
    }
  }

  // 1.1 Robust Detection of OVERHEAD / Workshop Expense ("ЦЕХ" / "ЦУХ"):
  const allOcrCandidateTexts = [
    parsedResult.handwrittenRawText,
    parsedResult.handwrittenOrderNumber,
    parsedResult.handwrittenLocation,
    parsedResult.notes,
    parsedResult.documentTitle,
    parsedResult.paymentPurpose,
    parsedResult.lineItems?.map((l: any) => l.description).join(' '),
    fileName,
  ].filter(Boolean).join(' ');

  const hasExplicitCeHMark = OCRService.isOverheadMarker(allOcrCandidateTexts) ||
    OCRService.isOverheadMarker(parsedResult.handwrittenOrderNumber) ||
    OCRService.isOverheadMarker(parsedResult.handwrittenRawText) ||
    OCRService.isOverheadMarker(fileName);

  const hasProjectOrderNumber = /^\d{1,6}-\d{2}$/.test(parsedResult.handwrittenOrderNumber || '') &&
    parsedResult.handwrittenOrderNumber !== 'ЦЕХ';

  if (hasExplicitCeHMark || parsedResult.expenseCategory === 'OVERHEAD' || parsedResult.isOverhead) {
    parsedResult.expenseCategory = 'OVERHEAD';
    parsedResult.isOverhead = true;
    if (!hasProjectOrderNumber || parsedResult.handwrittenOrderNumber === 'ЦЕХ') {
      parsedResult.handwrittenOrderNumber = 'ЦЕХ';
      parsedResult.handwrittenConfidence = parsedResult.handwrittenConfidence && parsedResult.handwrittenConfidence !== 'none' ? parsedResult.handwrittenConfidence : 'high';
      parsedResult.handwrittenLocation = parsedResult.handwrittenLocation || 'Позначка на рахунку';
    }
  } else if (hasProjectOrderNumber) {
    parsedResult.expenseCategory = 'PROJECT';
    parsedResult.isOverhead = false;
  } else {
    parsedResult.expenseCategory = parsedResult.expenseCategory || 'PROJECT';
    parsedResult.isOverhead = false;
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
    docTypeHint === 'invoice' ||
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
  if (docTypeHint === 'invoice') {
    isPayment = false;
  } else if (docTypeHint === 'payment') {
    isPayment = true;
  } else if (hasPaymentTitle || hasPaymentFileName) {
    isPayment = true;
  } else if (isExplicitInvoice) {
    // If the document explicitly identifies as an invoice or has goods line items,
    // it can only be considered a payment if there is an unequivocal bank execution stamp AND no line items.
    isPayment = Boolean(hasBankExecutionStamp && (!parsedResult.lineItems || parsedResult.lineItems.length === 0));
  } else {
    isPayment = Boolean(
      parsedResult.documentType === 'payment' ||
      hasBankExecutionStamp ||
      hasPaymentPurposePattern
    );
  }

  if (isPayment) {
    parsedResult.documentType = 'payment';
    if (!parsedResult.documentTypeUkrainian || parsedResult.documentTypeUkrainian.toLowerCase().includes('рахунок')) {
      parsedResult.documentTypeUkrainian = 'Платіжна інструкція';
    }
    parsedResult.paymentStatus = 'Оплачено';

    // 1. Extract referenced invoice number from payment purpose if present (e.g. "згідно рах. № 4104")
    const extractedInvs = OCRService.extractAllInvoiceNumbers(
      parsedResult.referencedInvoiceNumber,
      parsedResult.referencedInvoiceNumbers,
      parsedResult.paymentPurpose
    );
    if (extractedInvs.length > 0) {
      parsedResult.referencedInvoiceNumbers = extractedInvs;
      parsedResult.referencedInvoiceNumber = extractedInvs.join(', ');
      parsedResult.invoiceNumber = extractedInvs[0];
    } else {
      parsedResult.referencedInvoiceNumbers = [];
      parsedResult.referencedInvoiceNumber = '';
      if (parsedResult.invoiceNumber && OCRService.isPlaceholderNumber(parsedResult.invoiceNumber)) {
        parsedResult.invoiceNumber = '';
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

    // If payee/payer were filled from the payment box instead of supplier/buyer, cross-fill:
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
    const allOurComps = Array.from(new Set([...ourCompanies, ...DEFAULT_OUR_COMPANIES])).filter(Boolean);
    const isPayeeBodnar = /боднар/i.test(parsedResult.payeeName || '');
    const isPayerBodnar = /боднар/i.test(parsedResult.payerName || '');

    if (parsedResult.payeeName && parsedResult.payerName && (allOurComps.length > 0 || isPayeeBodnar)) {
      const isPayeeOurCompany = isPayeeBodnar || allOurComps.some((c) => OCRService.isCompanyNameMatch(c, parsedResult.payeeName!));
      const isPayerOurCompany = isPayerBodnar || allOurComps.some((c) => OCRService.isCompanyNameMatch(c, parsedResult.payerName!));
      const isPayerSupplier = suppliers.some((s) => OCRService.isCompanyNameMatch(s, parsedResult.payerName!));

      if (isPayeeOurCompany && (!isPayerOurCompany || isPayerSupplier)) {
        console.log(`[OCR Smart Swap] Swapping payerName "${parsedResult.payerName}" and payeeName "${parsedResult.payeeName}" because payee matches ourCompanies!`);
        const temp = parsedResult.payerName;
        parsedResult.payerName = isPayeeBodnar ? 'ФОП БОДНАР ЛАРИСА ВАЛЕНТИНІВНА' : parsedResult.payeeName;
        parsedResult.payeeName = temp;
      }
    }

    if (isPayerBodnar || /боднар/i.test(parsedResult.payerName || '')) {
      parsedResult.payerName = 'ФОП БОДНАР ЛАРИСА ВАЛЕНТИНІВНА';
    }

    // 2. Rescue missing payeeName (Отримувач / Постачальник)
    if (!parsedResult.payeeName || parsedResult.payeeName === '—') {
      const purpose = parsedResult.paymentPurpose || '';
      const notes = parsedResult.notes || '';
      const fullText = `${purpose} ${notes}`;

      // A) Try matching against suppliers list
      for (const sup of suppliers) {
        if (sup && sup.length >= 3 && OCRService.isCompanyNameMatch(fullText, sup)) {
          parsedResult.payeeName = OCRService.normalizeCompanyName(sup);
          break;
        }
      }

      // B) Try regex extraction for company name in paymentPurpose
      if (!parsedResult.payeeName || parsedResult.payeeName === '—') {
        const compMatch = purpose.match(/(?:отримувач|одержувач|постачальник|продавець)?\s*[:=]?\s*(ТОВ|ПП|ФОП|ПрАТ|ПАТ|АТ|ТДВ)\s+["'«»]?[A-Za-zА-Яа-яІіЇїЄєҐґ0-9\s\-–—]{2,40}["'«»]?/i);
        if (compMatch && compMatch[0]) {
          const candidate = OCRService.normalizeCompanyName(compMatch[0]);
          if (!ourCompanies.some((c) => OCRService.isCompanyNameMatch(c, candidate))) {
            parsedResult.payeeName = candidate;
          }
        }
      }
    }

    // 3. Rescue missing payerName (Платник / Наша компанія)
    if (!parsedResult.payerName || parsedResult.payerName === '—') {
      const fullText = `${parsedResult.paymentPurpose || ''} ${parsedResult.notes || ''}`;
      for (const ourComp of ourCompanies) {
        if (ourComp && OCRService.isCompanyNameMatch(fullText, ourComp)) {
          parsedResult.payerName = OCRService.normalizeCompanyName(ourComp);
          break;
        }
      }
      if ((!parsedResult.payerName || parsedResult.payerName === '—') && ourCompanies.length === 1) {
        parsedResult.payerName = OCRService.normalizeCompanyName(ourCompanies[0]);
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

    // Payment number / invoice number alignment
    if (parsedResult.referencedInvoiceNumber && parsedResult.invoiceNumber === parsedResult.referencedInvoiceNumber && !parsedResult.paymentNumber) {
      // Look for payment slip number in notes, raw text, or file name
      const pNumMatch = `${parsedResult.notes || ''} ${parsedResult.handwrittenRawText || ''} ${fileName || ''}`.match(/(?:платіжна інструкція|доручення|від)?\s*(?:N|№)\s*(\d{1,10})/i);
      if (pNumMatch && pNumMatch[1]) {
        parsedResult.paymentNumber = pNumMatch[1].trim();
      }
    } else if (parsedResult.invoiceNumber && !parsedResult.paymentNumber && !parsedResult.referencedInvoiceNumber) {
      parsedResult.paymentNumber = parsedResult.invoiceNumber;
    }

    if (parsedResult.invoiceDate && !parsedResult.paymentDate) {
      parsedResult.paymentDate = parsedResult.invoiceDate;
    } else if (parsedResult.paymentDate && !parsedResult.invoiceDate) {
      parsedResult.invoiceDate = parsedResult.paymentDate;
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
      parsedResult.referencedInvoiceNumber = uniqueInvoices.join(', ');
      parsedResult.invoiceNumber = uniqueInvoices[0];
    } else {
      parsedResult.referencedInvoiceNumbers = [];
      parsedResult.referencedInvoiceNumber = '';
      if (parsedResult.invoiceNumber && OCRService.isPlaceholderNumber(parsedResult.invoiceNumber)) {
        parsedResult.invoiceNumber = '';
      }
    }

    // In a payment, invoiceNumber should represent the referenced invoice being paid (if known) or remain empty
    if (parsedResult.referencedInvoiceNumber) {
      parsedResult.invoiceNumber = parsedResult.referencedInvoiceNumber;
    } else if (parsedResult.invoiceNumber === parsedResult.paymentNumber) {
      parsedResult.invoiceNumber = '';
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
    parsedResult.approvalStatus = 'НЕ ПОГОДЖЕНО';

    // Synchronize and normalize dates for invoices:
    ensureOcrDates(parsedResult, fileName);
    if (parsedResult.invoiceDate && !parsedResult.paymentDate) {
      parsedResult.paymentDate = parsedResult.invoiceDate;
    } else if (parsedResult.paymentDate && !parsedResult.invoiceDate) {
      parsedResult.invoiceDate = parsedResult.paymentDate;
    }

    // Cross-fill from payment fields if Gemini placed buyer/supplier in payer/payee
    if (!parsedResult.buyerName && parsedResult.payerName) {
      parsedResult.buyerName = parsedResult.payerName;
    }
    if (!parsedResult.supplierName && parsedResult.payeeName) {
      parsedResult.supplierName = parsedResult.payeeName;
    }

    // 1. Smart Anti-Swap Check for Invoices:
    // If supplierName matches ourCompanies (e.g. ФОП БОДНАР ЛАРИСА ВАЛЕНТИНІВНА, ТОВ ШОП ІНТЕРІОР, etc.)
    // or contains "БОДНАР" / "Боднар", it is guaranteed to be our company (Buyer / Recipient), NOT the supplier!
    const allOurComps = Array.from(new Set([...ourCompanies, ...DEFAULT_OUR_COMPANIES])).filter(Boolean);
    const isSupplierBodnar = /боднар/i.test(parsedResult.supplierName || '');
    const isSupplierOurComp = isSupplierBodnar || allOurComps.some((c) => OCRService.isCompanyNameMatch(c, parsedResult.supplierName || ''));
    const isBuyerBodnar = /боднар/i.test(parsedResult.buyerName || '');
    const isBuyerOurComp = isBuyerBodnar || allOurComps.some((c) => OCRService.isCompanyNameMatch(c, parsedResult.buyerName || ''));
    const isBuyerKnownSupplier = suppliers.some((s) => OCRService.isCompanyNameMatch(s, parsedResult.buyerName || ''));

    if (isSupplierOurComp && (!isBuyerOurComp || isBuyerKnownSupplier)) {
      console.log(`[OCR Smart Swap Invoice] Moving "${parsedResult.supplierName}" from supplier to buyer because it matches our companies!`);
      const temp = parsedResult.buyerName;
      parsedResult.buyerName = isSupplierBodnar ? 'ФОП БОДНАР ЛАРИСА ВАЛЕНТИНІВНА' : OCRService.normalizeCompanyName(parsedResult.supplierName!);
      parsedResult.supplierName = temp || '';
    } else if (isSupplierBodnar && !isBuyerBodnar) {
      parsedResult.buyerName = 'ФОП БОДНАР ЛАРИСА ВАЛЕНТИНІВНА';
    }

    // Ensure buyerName is valid and not a placeholder or supplier
    if (OCRService.isInvalidBuyerName(parsedResult.buyerName, parsedResult.supplierName)) {
      parsedResult.buyerName = '';
    }

    // Try finding buyer from notes, raw text, filename, or description if empty
    if (!parsedResult.buyerName) {
      const fullText = `${parsedResult.notes || ''} ${parsedResult.handwrittenRawText || ''} ${fileName || ''}`;
      if (/боднар/i.test(fullText)) {
        parsedResult.buyerName = 'ФОП БОДНАР ЛАРИСА ВАЛЕНТИНІВНА';
      } else {
        for (const ourComp of allOurComps) {
          if (ourComp && OCRService.isCompanyNameMatch(fullText, ourComp)) {
            parsedResult.buyerName = OCRService.normalizeCompanyName(ourComp);
            break;
          }
        }
      }
    }

    // Canonical match against ourCompanies
    if (parsedResult.buyerName) {
      if (/боднар/i.test(parsedResult.buyerName)) {
        parsedResult.buyerName = 'ФОП БОДНАР ЛАРИСА ВАЛЕНТИНІВНА';
      } else if (allOurComps.length > 0) {
        const match = allOurComps.find((c: string) => OCRService.isCompanyNameMatch(c, parsedResult.buyerName!));
        if (match) {
          parsedResult.buyerName = OCRService.normalizeCompanyName(match);
        }
      }
    }

    // If still empty, check if handwrittenOrderNumber maps to any known project order
    if (!parsedResult.buyerName && parsedResult.handwrittenOrderNumber) {
      const cleanNum = OCRService.normalizeOrderNumber(parsedResult.handwrittenOrderNumber);
      const orderConfig = KNOWN_PROJECT_ORDERS.find(
        (o) => o.code === cleanNum || o.invoiceCode?.includes(cleanNum)
      );
      if (orderConfig?.invoiceCode?.startsWith('ШІ-') || orderConfig?.title?.toLowerCase().includes('шоп')) {
        parsedResult.buyerName = 'ТОВ ШОП ІНТЕРІОР';
      } else if (orderConfig?.invoiceCode?.startsWith('ПШ-') || orderConfig?.title?.toLowerCase().includes('преміум') || orderConfig?.title?.toLowerCase().includes('престиж')) {
        parsedResult.buyerName = 'ТОВ ПРЕМІУМ ШОП';
      } else if (orderConfig?.invoiceCode?.startsWith('ГП-') || orderConfig?.title?.toLowerCase().includes('гала')) {
        parsedResult.buyerName = 'ТОВ ГАЛА ПРОДАКШН';
      } else if (orderConfig?.invoiceCode?.startsWith('ІУ-') || orderConfig?.title?.toLowerCase().includes('інокс')) {
        parsedResult.buyerName = 'ТОВ ІНОКС УКРАЇНА';
      }
    }

    // Default to our sole company if only 1 exists and buyer is empty
    if (!parsedResult.buyerName && ourCompanies.length === 1) {
      parsedResult.buyerName = OCRService.normalizeCompanyName(ourCompanies[0]);
    }
  }

  // 3. Local Amount fallback if 0 (single-pass, no secondary API queries)
  if ((parsedResult.totalAmount || 0) <= 0 && (parsedResult.amountPaid || 0) <= 0) {
    const textToScan = `${parsedResult.paymentPurpose || ''} ${parsedResult.notes || ''} ${parsedResult.documentTitle || ''}`;
    const amountRegex = /(?:сума|в сумі|на суму|у т\.ч\.|разом|списано|грн\.?|UAH)\s*[:=]?\s*([0-9\s]{1,12}[,\.][0-9]{2})/i;
    const match = textToScan.match(amountRegex);
    if (match && match[1]) {
      const parsed = parseAmountToNumber(match[1]);
      if (parsed > 0) {
        parsedResult.totalAmount = parsed;
        parsedResult.amountPaid = parsed;
      }
    }
  }

  // 4. Local Handwritten Order Number / Overhead fallback if empty
  if (parsedResult.documentType === 'invoice' && !parsedResult.handwrittenOrderNumber) {
    const textToScan = `${parsedResult.handwrittenRawText || ''} ${parsedResult.notes || ''}`;
    if (OCRService.isOverheadMarker(textToScan)) {
      parsedResult.handwrittenOrderNumber = 'ЦЕХ';
      parsedResult.expenseCategory = 'OVERHEAD';
      parsedResult.isOverhead = true;
    } else {
      const numMatch = textToScan.match(/(?:№|No|N|#|зам\.?|код)?\s*([0-9]{1,5}[-/.][0-9]{2})/i);
      if (numMatch && numMatch[1]) {
        parsedResult.handwrittenOrderNumber = OCRService.normalizeOrderNumber(numMatch[1]);
      }
    }
  }

  // Final date normalization and fallback cascade
  ensureOcrDates(parsedResult, fileName);

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

  if (parsedResult.invoiceNumber) {
    parsedResult.invoiceNumber = OCRService.sanitizeInvoiceNumber(parsedResult.invoiceNumber);
  }
  if (parsedResult.referencedInvoiceNumber || parsedResult.paymentPurpose) {
    const cleanInvs = OCRService.extractAllInvoiceNumbers(
      parsedResult.referencedInvoiceNumber,
      parsedResult.referencedInvoiceNumbers,
      parsedResult.paymentPurpose
    );
    if (cleanInvs.length > 0) {
      parsedResult.referencedInvoiceNumbers = cleanInvs;
      parsedResult.referencedInvoiceNumber = cleanInvs.join(', ');
      if (parsedResult.documentType === 'payment') {
        parsedResult.invoiceNumber = cleanInvs[0];
      }
    } else {
      parsedResult.referencedInvoiceNumbers = [];
      parsedResult.referencedInvoiceNumber = '';
      if (parsedResult.documentType === 'payment' && OCRService.isPlaceholderNumber(parsedResult.invoiceNumber)) {
        parsedResult.invoiceNumber = '';
      }
    }
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
   * Checks if a buyer name is invalid, placeholder, or mistakenly matches the supplier
   */
  public static isInvalidBuyerName(name: string | undefined | null, supplierName?: string): boolean {
    if (!name) return true;
    const s = String(name).trim();
    if (!s || s === '—' || s === '-' || s === '...' || s === 'null' || s === 'undefined') return true;

    const lower = s.toLowerCase();
    const genericPlaceholders = new Set([
      'той самий', 'той же', 'він же', 'тойже', 'тойсамий',
      'клієнт', 'приватна особа', 'фізична особа', 'кінцевий споживач',
      'не вказано', 'відсутній', 'невідомо', 'none', 'n/a',
      'покупець', 'платник', 'замовник', 'одержувач', 'вантажоодержувач',
      'б/н', '—', '-', '...'
    ]);
    if (genericPlaceholders.has(lower)) return true;

    if (supplierName && this.isCompanyNameMatch(s, supplierName)) {
      return true;
    }

    return false;
  }

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

    // 0a. Strip document field label prefixes if present
    val = val.replace(/^(Покупець|Платник|Одержувач|Отримувач|Замовник|Вантажоодержувач|Клієнт|Сторона|Компанія)\s*[:=–—\-]?\s*/gi, '');

    // 0b. If text indicates "the same" or empty placeholders, return empty string
    if (/^(той\s+самий|той\s+же|він\s+же|тойже|тойсамий|—|-|немає|відсутній)$/i.test(val.trim())) {
      return '';
    }

    // 0c. Normalize Latin homoglyphs to Cyrillic
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
    val = val.replace(/^(ТзОВ|ТзДВ)\b/gi, 'ТОВ');

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
    val = val.toUpperCase();

    // 7. Strict normalization to exactly 4 target entities (always with "ТОВ", removing duplicate "Преміум Шоп" without ТОВ)
    const upper = val;
    const core = upper
      .replace(/^(ТОВ|ТОV|ТзОВ|ПП|ФОП|ТДВ|LLC)\s+/i, '')
      .replace(/[-_]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // 1. "ТОВ ПРЕМІУМ ШОП" (strictly standardizes "Преміум Шоп", "ПРЕМІУМ ШОП", "PREMIUM SHOP", etc.)
    if (
      core === 'ПРЕМІУМ ШОП' ||
      core === 'ПРЕМИУМ ШОП' ||
      core === 'PREMIUM SHOP' ||
      core === 'ПРЕМІУМШОП' ||
      core.includes('ПРЕМІУМ ШОП') ||
      core.includes('ПРЕМИУМ ШОП') ||
      core.includes('PREMIUM SHOP') ||
      upper.includes('ПРЕМІУМ ШОП') ||
      upper.includes('ПРЕМИУМ ШОП')
    ) {
      return 'ТОВ ПРЕМІУМ ШОП';
    }

    // 2. "ТОВ ШОП ІНТЕРІОР" (strictly standardizes "Шоп Інтеріор", "ШОП ІНТЕРІОР", "SHOP INTERIOR", etc.)
    if (
      core === 'ШОП ІНТЕРІОР' ||
      core === 'ШОП ИНТЕРИОР' ||
      core === 'SHOP INTERIOR' ||
      core.includes('ШОП ІНТЕРІОР') ||
      core.includes('ШОП ИНТЕРИОР') ||
      core.includes('SHOP INTERIOR') ||
      upper.includes('ШОП ІНТЕРІОР')
    ) {
      return 'ТОВ ШОП ІНТЕРІОР';
    }

    // 3. "ТОВ ГАЛА ПРОДАКШН" (strictly standardizes "Гала Продакшн", "ГАЛА ПРОДАКШН", "GALA PRODUCTION", etc.)
    if (
      core === 'ГАЛА ПРОДАКШН' ||
      core === 'ГАЛА ПРОДАКШИН' ||
      core === 'ГАЛА ПРОДАКШЕН' ||
      core === 'GALA PRODUCTION' ||
      core.includes('ГАЛА ПРОДАКШН') ||
      core.includes('ГАЛА ПРОДАКШИН') ||
      core.includes('GALA PRODUCTION') ||
      upper.includes('ГАЛА ПРОДАКШН')
    ) {
      return 'ТОВ ГАЛА ПРОДАКШН';
    }

    // 4. "ТОВ ІНОКС УКРАЇНА" (strictly standardizes "Інокс Україна", "ІНОКС УКРАЇНА", "INOX UKRAINE", etc.)
    if (
      core === 'ІНОКС УКРАЇНА' ||
      core === 'ИНОКС УКРАИНА' ||
      core === 'ІНОКС УКРАИНА' ||
      core === 'INOX UKRAINE' ||
      core.includes('ІНОКС УКРАЇНА') ||
      core.includes('ИНОКС УКРАИНА') ||
      core.includes('INOX UKRAINE') ||
      upper.includes('ІНОКС УКРАЇНА')
    ) {
      return 'ТОВ ІНОКС УКРАЇНА';
    }

    return val;
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

    // FOP check: If both are FOP or person names, match by surname
    const words1 = core1.split(' ').filter(Boolean);
    const words2 = core2.split(' ').filter(Boolean);
    if (words1.length > 0 && words2.length > 0) {
      const surname1 = words1[0];
      const surname2 = words2[0];
      if (surname1 === surname2 && surname1.length >= 4 && !genericWords.has(surname1)) {
        return true;
      }
    }

    // High confidence substring match for specific company names (e.g. "КОМПАНІЯ ЛІНА ТД" and "ЛІНА ТД")
    if (core1.length >= 4 && core2.length >= 4) {
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
      const distinctiveShared = common.filter((t) => t.length >= 4 && !genericWords.has(t));
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
    if (!cleanInvNum || !purpose || cleanInvNum.length < 1) return false;
    const lowerPurpose = this.normalizeHomoglyphs(purpose).toLowerCase();
    const targetClean = this.normalizeHomoglyphs(cleanInvNum).toLowerCase();

    // Check extracted invoice tokens from purpose
    const extracted = this.extractAllInvoiceNumbers(undefined, undefined, purpose);
    const cleanExtracted = extracted.map((e) => this.normalizeInvoiceNumber(e)).filter(Boolean);
    if (cleanExtracted.some((ce) => this.isInvoiceNumberMatch(targetClean, ce))) return true;

    // Check keyword-based pattern: e.g. "рах 3540", "№ 3540", "рахунку 3540", "рахунка 3540", "сф 3540", "р-к 3540"
    const escaped = targetClean.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(
      `(?:рахун(?:ок|ка|ку|ком|ки|ків)?|рах(?:унок|\\.?)|сф[-_]?|р[-/]к|счет[а-я]*|інвойс(?:и|ів)?|№|no\\.?|n\\.?)\\s*[:#№]?\\s*(?:[A-Za-zА-Яа-я0-9\\-_]*[/\\-_])?0*${escaped}(?!\\d)`,
      'i'
    );
    if (regex.test(lowerPurpose)) return true;

    // Standalone number surrounded by word boundaries or non-digits (for 3+ digit numbers)
    if (targetClean.length >= 3 && /^\d+$/.test(targetClean)) {
      const standaloneRegex = new RegExp(`(?:^|[^\\d])0*${escaped}(?:[^\\d]|$)`);
      if (standaloneRegex.test(lowerPurpose)) {
        // Exclude dates (e.g. dd.mm.yyyy or yyyy-mm-dd)
        const dateContextRegex = new RegExp(`(?:\\d{2}\\.\\d{2}\\.|\\d{4}[-./])0*${escaped}|0*${escaped}[-./]\\d{2}[-./]`);
        if (!dateContextRegex.test(lowerPurpose)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check if a text string matches workshop overhead marker ("ЦЕХ", "ЦУХ", "цехові", etc.)
   * Covers typos and variations like "ЦУХ" (common handwriting misread of "ЦЕХ"),
   * spaced letters ("ц е х", "ц у х"), prefixes ("на цех", "для цеху", "в цех"),
   * case variations, and transliteration ("ceh", "cuh", "tseh", "tsekh").
   */
  public static isOverheadMarker(input?: string | null): boolean {
    if (!input) return false;
    const raw = String(input).trim();
    if (!raw) return false;
    const s = raw.toLowerCase();

    // Direct exact keywords and fuzzy variations (Cyrillic + Latin)
    if (/^(?:цех|цух|цєх|цэх|цек|цук|цєк|цэk|ceh|cuh|cex|cek|cuk|tseh|tsekh)$/i.test(s)) return true;

    // Mixed Cyrillic / Latin character variations: [ц or c] + [е, є, э, e, у, y, u] + [х, x, k, к]
    // with optional spaces/dots/dashes in between (e.g. "Ц.Е.Х.", "Ц Е Х", "Ц Е К", "C E X", "Ц-Е-Х")
    if (/^[цc][\s._-]*[еєэeуyu][\s._-]*[хxkк][\s._-]*$/i.test(s)) return true;

    // Whole-word regex for word boundaries in Ukrainian / Cyrillic / Latin
    if (/(?:^|[^а-яіїєґa-z0-9])([цc][еєэeуyu][хxkк]|[цc][еєэeуyu][хxkк][а-яіїєґa-z]*|tseh|tsekh)(?:$|[^а-яіїєґa-z0-9])/i.test(s)) {
      return true;
    }

    // Contextual phrases: "на цех", "для цеху", "в цех", "під цех", "цехові витрати", "матеріали на цех"
    if (/(?:на|для|в|до|під)\s+(?:[цc][еєэeуyu][хxkк]|[цc][еєэeуyu][хxkк]у)/i.test(s)) return true;
    if (/(?:[цc][еєэeуyu][хxkк]|[цc][еєэeуyu][хxkк]ові|[цc][еєэeуyu][хxkк]ова|[цc][еєэeуyu][хxkк]ове)\s+(?:витрати|потреби|матеріали|розхідники)/i.test(s)) return true;

    return false;
  }

  /**
   * Check if a document is an overhead / workshop expense ("ЦЕХ" tab candidate).
   */
  public static isOverheadDocument(
    ocr?: Partial<OCRResult> | null,
    fileName?: string
  ): boolean {
    if (!ocr && !fileName) return false;
    if (ocr?.expenseCategory === 'OVERHEAD' || ocr?.isOverhead === true) return true;
    if (this.isOverheadMarker(ocr?.handwrittenOrderNumber)) return true;
    if (this.isOverheadMarker(ocr?.handwrittenRawText)) return true;
    if (this.isOverheadMarker(ocr?.handwrittenLocation)) return true;
    if (this.isOverheadMarker(ocr?.notes)) return true;
    if (this.isOverheadMarker(ocr?.documentTitle)) return true;
    if (this.isOverheadMarker(ocr?.paymentPurpose)) return true;
    if (fileName && this.isOverheadMarker(fileName)) return true;
    return false;
  }

  /**
   * Clean and normalize handwritten order number strictly to format xxx-xx WITHOUT symbol №
   * E.g. "№142-26" -> "142-26", "зам. 89-26" -> "89-26", "12326" -> "123-26"
   * For workshop markers ("ЦЕХ", "ЦУХ", "цехові") -> strictly returns "ЦЕХ"
   */
  public static normalizeOrderNumber(input: string): string {
    if (!input) return '';
    let val = input.trim();
    
    // Support workshop overhead marker ("ЦЕХ", "ЦУХ", "цехові", etc.)
    if (this.isOverheadMarker(val)) {
      return 'ЦЕХ';
    }

    // Remove leading symbols and keywords: №, No, N, #, зам, замовлення, код, з., з-
    val = val.replace(/^(?:№|No|N|#|зам\.?|замовлення|замовл\.?|код|з\.?|з-)\s*/i, '');
    val = val.replace(/[№#]/g, '');
    val = val.replace(/\s+/g, '');
    
    // Check again after removing № prefix (e.g. "№ ЦЕХ", "№ ЦУХ")
    if (this.isOverheadMarker(val)) {
      return 'ЦЕХ';
    }
    
    // If format is like "232/26" or "232.26"
    val = val.replace(/^(\d+)[/.](\d{2})$/, '$1-$2');

    // Check if it already has dash (e.g. 142-26, 232-26)
    if (/^\d{1,6}-\d{2}$/.test(val)) {
      return val;
    }

    // If pure digits without year (e.g. "232" or "108" or "45") - in business year 2026, normalize to "232-26"
    if (/^\d{1,4}$/.test(val)) {
      return `${val}-26`;
    }

    // If 4-6 digits without dash ending in 26, 25, or 24 (e.g. "23226" -> "232-26")
    if (/^\d{3,6}$/.test(val) && (val.endsWith('26') || val.endsWith('25') || val.endsWith('24'))) {
      const order = val.slice(0, -2);
      const year = val.slice(-2);
      return `${order}-${year}`;
    }

    return val;
  }

  /**
   * Universal stop-words and invalid labels that should NEVER be treated as an invoice number.
   * Filters out VAT, percentages, amounts, currencies, general descriptive words, and metadata.
   */
  public static readonly INVALID_INVOICE_WORDS = new Set([
    // Invoices and payment documents
    'рахунок', 'рахунка', 'рахунку', 'рахунком', 'рахунки', 'рахунків', 'рахунками', 'рахунках',
    'рах', 'рах.', 'р-к', 'р/к',
    'счет', 'счета', 'счету', 'счетом', 'счете', 'счетов', 'сч', 'сч.',
    'договір', 'договору', 'договором', 'договори', 'договорів', 'договор', 'договора', 'дог', 'дог.',
    'інвойс', 'інвойса', 'інвойсу', 'інвойси', 'інвойсів', 'invoice', 'inv', 'inv.',
    'номер', 'номеру', 'номером', 'номери', 'номерів', '№', 'no', 'no.', 'n', 'n.', '#',
    'платіжка', 'платіж', 'платіжне', 'доручення', 'інструкція', 'квитанція', 'чек',

    // Descriptive words & actions
    'фарбу', 'фарба', 'фарби', 'фарбою', 'краску', 'краска',
    'матер', 'матеріал', 'матеріали', 'матеріалів', 'материали', 'материалы', 'будматеріали', 'буд',
    'товар', 'товари', 'товару', 'товаром', 'товаров', 'товарах',
    'послуги', 'послуга', 'послуг', 'послугами', 'услуги', 'услуга', 'услуг',
    'оплата', 'оплачено', 'оплатити', 'сплата', 'розрахунок', 'перерахунок',
    'згідно', 'згідноз', 'зг', 'по', 'за', 'для', 'від', 'до', 'без', 'з', 'у', 'в', 'на', 'та', 'і',
    'аванс', 'доплата', 'остаточний', 'транш', 'попередня',
    'комплектуючі', 'фурнітура', 'метал', 'сталь', 'деталі', 'вироби', 'продукція',
    'виготовлення', 'монтаж', 'доставка', 'порізка', 'кромкування', 'фарбування',

    // VAT, percentages & currency
    'т.ч.', 'т.ч', 'в т.ч.', 'в т.ч', 'у т.ч.', 'у т.ч', 'втч', 'утч',
    'пдв', 'без пдв', 'з пдв', '20%', '7%', '0%',
    'грн', 'грн.', 'гривень', 'гривні', 'uah', 'usd', 'eur', 'коп', 'коп.', 'копійок',

    // Placeholders & nulls
    'б/н', 'бн', 'б.н.', 'б/н.', 'без', 'безномера', 'без_номера', 'без-номера',
    'n/a', 'na', 'none', 'null', 'undefined', '-', '--', '—', '0', '00', '000'
  ]);

  /**
   * Checks whether a string represents a calendar date (e.g. 12.08.2026, 12.08.26, 2026-08-12)
   */
  public static isDateString(str?: string): boolean {
    if (!str) return false;
    const clean = str.trim();
    const m1 = clean.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
    if (m1) {
      const d = parseInt(m1[1], 10);
      const m = parseInt(m1[2], 10);
      if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
        return true;
      }
    }
    const m2 = clean.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
    if (m2) {
      const m = parseInt(m2[2], 10);
      const d = parseInt(m2[3], 10);
      if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
        return true;
      }
    }
    return false;
  }

  /**
   * Helper to check if a string is a placeholder or invalid number (e.g. "б/н", "-", "none", "матер", "товар", decimal amounts, percentages, dates)
   */
  public static isPlaceholderNumber(num?: string): boolean {
    if (!num) return true;
    const s = num.trim().toLowerCase();
    if (s.length < 1) return true;
    // An invoice number must contain at least one digit
    if (!/\d/.test(s)) return true;
    // Reject decimals/amounts like 1369.18, 24195.30 or 1500,00
    if (/^\d+[,.]\d+$/.test(s)) return true;
    // Reject percentages like 20%
    if (s.includes('%')) return true;
    // Date strings like 2026-08-25 or 25.08.2026 or 15.09.26
    if (OCRService.isDateString(s)) return true;
    return OCRService.INVALID_INVOICE_WORDS.has(s);
  }

  /**
   * Sanitizes an invoice number string.
   * Strips prefix labels ("рахунок на оплату", "згідно рахунка №", "№", etc.).
   * If the string contains multiple numbers separated by commas/spaces, sanitizes all and joins strictly with ', '.
   * If the string is solely a stop-word like "рахунка", "матер", an amount (1369.18), VAT (20%), or has no digits, returns "".
   */
  public static sanitizeInvoiceNumber(input?: string): string {
    if (!input) return '';
    let val = String(input).trim();
    if (!val) return '';

    // If input contains multiple items separated by commas, semicolons or conjunctions, process via extractAllInvoiceNumbers
    if (/[,\s+&|]+|\s+(?:та|і|також)\s+/i.test(val)) {
      const found = OCRService.extractAllInvoiceNumbers(val);
      if (found.length > 0) {
        return found.join(', ');
      }
    }

    // Remove common prefixes
    val = val.replace(/^(?:оплата\s+(?:за\s+[^;,\n]+?)?\s*згідно(?:\s+з)?|згідно(?:\s+з)?|по|за)\s+/i, '');
    val = val.replace(/^(?:рахунок\s+на\s+оплату|рахунок[-_\s]*фактура|рахун(?:ок|ка|ку|ком|ки|ків)|рах(?:\.|\b|(?=[^а-яіїєґa-z0-9]|$))|догов(?:ір|ору|ором|ори|орів|ор[а-я]*)?|дог(?:\.|\b|(?=[^а-яіїєґa-z0-9]|$))|счет[-_\s]*фактура|счет[а-я]*|сч(?:\.|\b|(?=[^а-яіїєґa-z0-9]|$))|invoice|інвойс[а-я]*)\s*/i, '');
    val = val.replace(/^(?:номер|№|no|n|#)\s*[:.]?\s*/i, '');
    val = val.replace(/^[№#:]\s*/, '');
    val = val.trim();

    // Secondary pass in case of stacked prefixes like "згідно рахунка № 227763"
    val = val.replace(/^(?:рахунок\s+на\s+оплату|рахун(?:ок|ка|ку|ком|ки|ків)|рах(?:\.|\b|(?=[^а-яіїєґa-z0-9]|$))|догов(?:ір|ору|ором|ори|орів|ор[а-я]*)?|дог(?:\.|\b|(?=[^а-яіїєґa-z0-9]|$))|счет[а-я]*|сч(?:\.|\b|(?=[^а-яіїєґa-z0-9]|$))|invoice|інвойс[а-я]*)\s*/i, '');
    val = val.replace(/^(?:номер|№|no|n|#)\s*[:.]?\s*/i, '');
    val = val.replace(/^[№#:]\s*/, '');
    val = val.trim();

    // Strip trailing punctuation
    val = val.replace(/[.,;)"'\-\s]+$/, '').trim();

    const lower = val.toLowerCase().replace(/\s+/g, '');
    if (OCRService.INVALID_INVOICE_WORDS.has(lower) || OCRService.isPlaceholderNumber(val)) {
      return '';
    }

    // A valid invoice number MUST contain at least one digit (reject purely alphabetical words like "матер", "товар")
    if (!/\d/.test(val)) {
      return '';
    }

    // Reject amounts / decimals
    if (/^\d+[,.]\d+$/.test(val)) {
      return '';
    }

    // Reject percentages
    if (val.includes('%')) {
      return '';
    }

    // Reject dates
    if (OCRService.isDateString(val)) {
      return '';
    }

    return val;
  }

  /**
   * Reliably extracts invoice numbers from payment purpose or notes text according to strict parsing rules.
   * If multiple invoices are present, returns them joined strictly with comma and space (e.g. "RF26_1611, RF26_1642, RF26_1645").
   * Completely avoids false captures of words like "фарбу", "матер", "товар", VAT percentages, sums, or currencies.
   */
  public static extractInvoiceNumberFromText(text?: string): string {
    if (!text) return '';
    const invoices = OCRService.extractAllInvoiceNumbers(undefined, undefined, text);
    return invoices.join(', ');
  }

  /**
   * Clean and normalize invoice number for fuzzy/exact matching.
   * Strips prefix "№", "No", "рах", "СФ-000", leading zeroes, spaces.
   * Handles Latin/Cyrillic homoglyphs.
   * E.g. "СФ-000452" -> "452", "№ 124-М" -> "124-м"
   */
  public static normalizeInvoiceNumber(input: string): string {
    if (!input) return '';
    let val = String(input).trim().toLowerCase();
    val = this.normalizeHomoglyphs(val);
    // Remove "№", "no", "n", "#", "рах.", "рахунок", "рахунка", "рахунку", "сф-", "сф", "інвойс", "счет", "р-к", "р/к"
    val = val.replace(/^(?:№|no|n|#|рах\.?|рахун(?:ок|ка|ку|ком|ки|ків)|сф[-_]?|інвойс[а-я]*|счет[а-я]*|р[-/]к)\s*/i, '');
    val = val.replace(/[№#]/g, '');
    val = val.replace(/\s+/g, '');
    // Strip leading zeroes before digits (e.g. 000452 -> 452)
    val = val.replace(/^0+([1-9]\d*)/, '$1');
    if (OCRService.INVALID_INVOICE_WORDS.has(val) || !/\d/.test(val)) {
      return '';
    }
    return val;
  }

  /**
   * Compare two invoice numbers for equality, ignoring prefix (СФ-, №, 000), case, and homoglyphs
   */
  public static isInvoiceNumberMatch(a?: string, b?: string): boolean {
    if (!a || !b) return false;
    const cleanA = this.normalizeInvoiceNumber(a);
    const cleanB = this.normalizeInvoiceNumber(b);
    if (!cleanA || !cleanB) return false;
    if (cleanA === cleanB) return true;

    // Compare without any alphabetic prefix (e.g. "СФ-54" and "54", "Р-12" and "12")
    const coreA = cleanA.replace(/^[a-zа-яіїєґ]+[-_./]/i, '');
    const coreB = cleanB.replace(/^[a-zа-яіїєґ]+[-_./]/i, '');
    if (coreA && coreB && coreA === coreB) return true;

    if (cleanA.length >= 3 && cleanB.length >= 3) {
      if (cleanA.includes(cleanB) || cleanB.includes(cleanA)) return true;
    }
    return false;
  }

  /**
   * Extract all invoice number identifiers from referencedInvoiceNumber, referencedInvoiceNumbers,
   * or payment purpose text according to strict parsing logic:
   * 1. Trigger keywords: рахунок, рах., рах, Счет, сч., №, дог., договір (and variants).
   * 2. Patterns: Numeric or alphanumeric codes (1815, 1301, 169, 730),
   *    or with prefixes/hyphens/underscores (Р2608535, RF26_1611, Ц-000117212, СФ-0042, 142/26).
   * 3. Multiple invoices separated by comma, space, or "та" / "і" -> extracted and joined by ", ".
   * 4. Exclusions / Stop-words: completely ignores VAT/percentages (20%, т.ч., в т.ч., без ПДВ),
   *    sums and currencies (1369.18, 24195.30, грн, грн., UAH),
   *    descriptive words (фарбу, фарба, матер, матеріали, товар, послуги, оплата, згідно, аванс).
   * 5. If no valid invoice identifier is present, returns [].
   */
  public static extractAllInvoiceNumbers(
    referencedInvoiceNumber?: string,
    referencedInvoiceNumbers?: string[],
    paymentPurpose?: string
  ): string[] {
    const found = new Set<string>();

    const addCandidateToken = (val?: string) => {
      if (!val) return;
      let token = String(val).trim();
      // Strip leading and trailing punctuation/symbols
      token = token.replace(/^[№#№:.,;("'\-\s]+/, '').replace(/[.,;)"'\-\s]+$/, '').trim();
      if (!token) return;

      // 1. Must contain at least one digit (reject purely alphabetic descriptive words like "матер", "фарбу", "товар")
      if (!/\d/.test(token)) return;

      // 2. Reject decimal amounts like 1369.18 or 24195.30 or 1500,00
      if (/^\d+[,.]\d+$/.test(token)) return;

      // 3. Reject percentages like 20%
      if (token.includes('%')) return;

      // 4. Reject dates like 12.08.2026 or 15.09.26 or 2026-08-12
      if (OCRService.isDateString(token)) return;

      // 5. Reject stop words or currency
      const lower = token.toLowerCase();
      if (OCRService.INVALID_INVOICE_WORDS.has(lower)) return;
      if (OCRService.isPlaceholderNumber(token)) return;
      if (/^(?:пдв|грн|uah|usd|eur|коп|без|з|від|от|до|за|по|договір|контракт|матер|товар|послуг)/i.test(lower)) return;

      // 6. Valid invoice code check:
      // Pattern: numeric or alphanumeric code, optionally with prefixes, dashes, slashes, underscores
      // e.g. 1815, 1301, 169, 730, Р2608535, RF26_1611, Ц-000117212, СФ-0042, 124/26
      if (/^[A-Za-zА-Яа-яІіЇїЄєҐґ0-9][A-Za-zА-Яа-яІіЇїЄєҐґ0-9\-_/]*\d[A-Za-zА-Яа-яІіЇїЄєҐґ0-9\-_/]*$/i.test(token)) {
        found.add(token);
      }
    };

    // Process referencedInvoiceNumbers array if provided
    if (Array.isArray(referencedInvoiceNumbers)) {
      for (const n of referencedInvoiceNumbers) {
        if (n && typeof n === 'string') {
          const subTokens = n.split(/[,;\s+&|]+|\s+(?:та|і|також|а\s+також)\s+/i);
          for (const st of subTokens) {
            addCandidateToken(st);
          }
        }
      }
    }

    // Process referencedInvoiceNumber string if provided
    if (referencedInvoiceNumber) {
      const subTokens = String(referencedInvoiceNumber).split(/[,;\s+&|]+|\s+(?:та|і|також|а\s+також)\s+/i);
      for (const st of subTokens) {
        addCandidateToken(st);
      }
    }

    // Process paymentPurpose string if provided
    if (paymentPurpose) {
      const cleanPurpose = String(paymentPurpose);

      // Trigger regex: matches keywords (рахунок, рах., рах, Счет, сч., №, дог., договір, сф)
      // Captures the segment following the trigger until a date (від 12.08.2026),
      // VAT / amount clauses (в т.ч., у т.ч., без пдв, пдв, 20%, грн, сума),
      // descriptive clauses (за товар, за матер), semicolons, or line ends.
      const triggerRegex = /(?:(?:рахун(?:ок|ка|ку|ком|ки|ків)?|рах(?:\.|\b|(?=[^а-яіїєґa-z0-9]|$))|счет[а-я]*|сч(?:\.|\b|(?=[^а-яіїєґa-z0-9]|$))|догов(?:ір|ору|ором|ори|орів|ор[а-я]*)?|дог(?:\.|\b|(?=[^а-яіїєґa-z0-9]|$))|сф[-_]?(?:\.|\b|(?=[^а-яіїєґa-z0-9]|$))|інвойс[а-я]*|invoice)\s*(?:[-_–—]\s*фактур[а-я]*)?\s*(?:на\s+оплату\s*)?(?:(?:№|no\.?|n\.?|#)\s*[:.]?\s*)?|(?:№|no\.?|n\.?|#)\s*[:.]?\s*)([A-Za-zА-Яа-яІіЇїЄєҐґ0-9\-_/,.\s+&;іта№#:]+?)(?=(?:\s+(?:від|от)\s+\d{1,2}[./-]\d{1,2}|\s+(?:в\s+т\.?ч\.?|у\s+т\.?ч\.?|т\.?ч\.?|без\s+пдв|пдв|\d+%|сума|грн|за\s+[а-яіїєґ]+)|;|\n|$))/gi;

      let match: RegExpExecArray | null;
      while ((match = triggerRegex.exec(cleanPurpose)) !== null) {
        const segment = match[1];
        if (!segment) continue;

        // Split segment into candidate tokens by commas, spaces, and conjunctions
        const rawTokens = segment.split(/[,;\s+&|]+|\s+(?:та|і|також|а\s+також)\s+/i);
        for (const raw of rawTokens) {
          addCandidateToken(raw);
        }
      }
    }

    return Array.from(found);
  }

  /**
   * Match payment with multiple invoices.
   * In Ukrainian accounting, an accountant may combine several invoices from the same supplier in one payment order.
   * This method finds ALL matching invoices from the "Рахунки" sheet, the "Цех" sheet, and local docs,
   * checks if the total payment covers each invoice (or all of them combined),
   * and calculates the proper payment status ("Оплачено" / "Оплачено частково") for each.
   */
  public static matchPaymentWithAllInvoices(
    paymentOcr: OCRResult,
    existingInvoices: ExistingSheetRow[] = [],
    localDocuments: ProcessedDocument[] = [],
    existingOverheadExpenses: OverheadExpenseRow[] = []
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
    supplier?: string;
    buyer?: string;
    isClosedPair?: boolean;
    isAlreadyClosed?: boolean;
    targetTab?: 'Рахунки' | 'Цех';
    isOverhead?: boolean;
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

    let matches: Array<{
      invoiceNumber: string;
      orderNumber?: string;
      invoiceAmount: number;
      previousPaidAmount?: number;
      paidAmount?: number;
      computedStatus: InvoicePaymentStatus;
      matchedRowIndex?: number;
      matchedDocId?: string;
      matchReason?: string;
      supplier?: string;
      buyer?: string;
      isClosedPair?: boolean;
      isAlreadyClosed?: boolean;
      targetTab?: 'Рахунки' | 'Цех';
      isOverhead?: boolean;
      matchMethod?: 'invoice_number' | 'order_number' | 'overhead_context' | 'supplier_amount' | 'combo_amount';
    }> = [];

    const matchedInvoiceRowIndices = new Set<number>();
    const matchedOverheadRowIndices = new Set<number>();
    const matchedDocIds = new Set<string>();

    // 1. Scan existing sheet rows from "Рахунки" for matches
    for (const inv of existingInvoices) {
      const isInvOverhead = inv.isOverhead || inv.orderNumber === 'ЦЕХ';
      if (isInvOverhead) {
        if (inv.rowIndex && matchedOverheadRowIndices.has(inv.rowIndex)) continue;
      } else {
        if (inv.rowIndex && matchedInvoiceRowIndices.has(inv.rowIndex)) continue;
      }

      const rawInvNum = (inv.invoiceNumber || '').trim();
      const cleanInvNum = this.normalizeInvoiceNumber(rawInvNum);
      const cleanOrderNum = this.normalizeOrderNumber(inv.orderNumber || '').toLowerCase();
      const invSupplier = this.normalizeCompanyName(inv.supplier || '');
      const invAmount = inv.amount || 0;

      // RULE 1: If invoice is ALREADY FULLY CLOSED ("Оплачено" and 100% paid),
      // we CANNOT link a new payment to an already closed invoice!
      // Linking is ONLY allowed if the invoice is currently partially paid ("Оплачено частково"),
      // in which case it is waiting for an additional payment (доплата).
      const isAlreadyClosed =
        inv.paymentStatus === 'Оплачено' ||
        (invAmount > 0 && (inv.paidAmount || 0) >= invAmount - 0.50);

      if (isAlreadyClosed) {
        continue;
      }

      const isDateString = (s: string) => /^\d{4}[-./]\d{2}[-./]\d{2}$/.test(s.trim()) || /^\d{2}[-./]\d{2}[-./]\d{4}$/.test(s.trim());
      const isInvNumActuallyDate = isDateString(rawInvNum);

      // Criterion A: Match against any extracted invoice number from the payment (ignore if invoiceNumber is just a date)
      const isDirectRefMatch = cleanRefNumbers.some((crn) => this.isInvoiceNumberMatch(cleanInvNum, crn));
      const hasInvNumMatch =
        !isInvNumActuallyDate &&
        cleanInvNum.length >= 1 &&
        (isDirectRefMatch ||
          this.isInvoiceNumberMentionedInPurpose(cleanInvNum, purpose) ||
          (refOrder && this.isInvoiceNumberMatch(cleanInvNum, refOrder)));

      // Criterion B: Match by Supplier / Payee
      const isSupplierMatch = Boolean(
        payeeName &&
        invSupplier &&
        (this.isCompanyNameMatch(invSupplier, payeeName) ||
          (invSupplier.length >= 4 && purpose.includes(invSupplier.toLowerCase())))
      );

      // Criterion C: Match by Amount
      const isAmountMatch = paymentAmount > 0 && invAmount > 0 && Math.abs(paymentAmount - invAmount) <= 0.50;
      const isPartialAmountMatch = paymentAmount > 0 && invAmount > 0 && paymentAmount < invAmount - 0.50;

      // Criterion D: Match by Order Number
      const isOrderMatch = Boolean(
        cleanOrderNum &&
        (cleanOrderNum === refOrder ||
          purpose.includes(cleanOrderNum) ||
          (refOrder && (cleanOrderNum.includes(refOrder) || refOrder.includes(cleanOrderNum))))
      );

      // Check if payment specifies a genuinely different invoice number
      const isCleanInvPlaceholder = this.isPlaceholderNumber(cleanInvNum);
      const hasContradictingInvoice =
        !isCleanInvPlaceholder &&
        refOrder &&
        !this.isPlaceholderNumber(refOrder) &&
        !this.isInvoiceNumberMatch(cleanInvNum, refOrder) &&
        !hasInvNumMatch;

      const hasContradictingOrder =
        Boolean(cleanOrderNum && refOrder && cleanOrderNum !== refOrder && !purpose.includes(cleanOrderNum));

      // Valid conditions:
      // When payment references invoice numbers, direct match does NOT require isAmountMatch (for multi-invoice payments)
      const matchByInvoiceNum = hasInvNumMatch && (isDirectRefMatch || cleanInvNum.length >= 3 || !payeeName || !invSupplier || isSupplierMatch);
      const canFallbackMatch = cleanRefNumbers.length === 0;
      const matchBySupplierAndAmount = canFallbackMatch && isSupplierMatch && isAmountMatch && !hasContradictingInvoice && !hasContradictingOrder;
      const matchByOrderSupplierAndAmount = canFallbackMatch && isOrderMatch && isSupplierMatch && (isAmountMatch || isPartialAmountMatch) && !hasContradictingInvoice;
      const matchByOrderAndAmount = canFallbackMatch && isOrderMatch && isAmountMatch && !hasContradictingInvoice && (!payeeName || !invSupplier || isSupplierMatch);

      if (matchByInvoiceNum || matchBySupplierAndAmount || matchByOrderSupplierAndAmount || matchByOrderAndAmount) {
        let reason = '';
        let matchMethod: 'invoice_number' | 'order_number' | 'supplier_amount' = 'supplier_amount';
        if (matchByInvoiceNum) {
          matchMethod = 'invoice_number';
          reason = `Співпадіння за номером рахунку "${inv.invoiceNumber}"`;
        } else if (matchByOrderSupplierAndAmount) {
          matchMethod = 'order_number';
          reason = `Співпадіння за замовленням "${inv.orderNumber}", постачальником "${inv.supplier}" та сумою (${inv.amount} грн)`;
        } else if (matchByOrderAndAmount) {
          matchMethod = 'order_number';
          reason = `Співпадіння за замовленням "${inv.orderNumber}" та сумою (${inv.amount} грн)`;
        } else {
          reason = `Співпадіння за постачальником "${inv.supplier}" та сумою (${inv.amount} грн)`;
        }

        if (isInvOverhead) {
          if (inv.rowIndex) matchedOverheadRowIndices.add(inv.rowIndex);
        } else {
          if (inv.rowIndex) matchedInvoiceRowIndices.add(inv.rowIndex);
        }

        matches.push({
          invoiceNumber: inv.invoiceNumber,
          orderNumber: isInvOverhead ? 'ЦЕХ' : inv.orderNumber,
          invoiceAmount: invAmount,
          previousPaidAmount: inv.paidAmount || 0,
          paidAmount: invAmount, // will be computed in step 3
          computedStatus: 'Оплачено',
          matchedRowIndex: inv.rowIndex,
          matchReason: isInvOverhead ? `${reason} (вкладка «ЦЕХ»)` : reason,
          supplier: inv.supplier,
          buyer: inv.buyer,
          isAlreadyClosed: false,
          isClosedPair: true,
          targetTab: isInvOverhead ? 'Цех' : 'Рахунки',
          isOverhead: isInvOverhead,
          matchMethod,
        });
      }
    }

    // 1.5. Scan existing rows from "ЦЕХ" (overhead expenses) for matches
    if (existingOverheadExpenses && existingOverheadExpenses.length > 0) {
      for (const exp of existingOverheadExpenses) {
        if (exp.rowIndex && matchedOverheadRowIndices.has(exp.rowIndex)) continue;

        const rawInvNum = (exp.invoiceNumber || '').trim();
        const cleanInvNum = this.normalizeInvoiceNumber(rawInvNum);
        const invSupplier = this.normalizeCompanyName(exp.supplier || '');
        const invAmount = exp.amount || 0;

        // RULE 1: If overhead expense is ALREADY FULLY CLOSED ("Оплачено" and 100% paid), skip!
        const isExpAlreadyClosed =
          exp.paymentStatus === 'Оплачено' ||
          (invAmount > 0 && (exp.paidAmount || 0) >= invAmount - 0.50);

        if (isExpAlreadyClosed) {
          continue;
        }

        const isDateString = (s: string) => /^\d{4}[-./]\d{2}[-./]\d{2}$/.test(s.trim()) || /^\d{2}[-./]\d{2}[-./]\d{4}$/.test(s.trim());
        const isInvNumActuallyDate = isDateString(rawInvNum);

        // Criterion A: Match against any extracted invoice number from the payment
        const isDirectRefMatch = cleanRefNumbers.some((crn) => this.isInvoiceNumberMatch(cleanInvNum, crn));
        const hasInvNumMatch =
          !isInvNumActuallyDate &&
          cleanInvNum.length >= 1 &&
          (isDirectRefMatch ||
            this.isInvoiceNumberMentionedInPurpose(cleanInvNum, purpose) ||
            (refOrder && this.isInvoiceNumberMatch(cleanInvNum, refOrder)));

        // Criterion B: Match by Supplier / Payee
        const isSupplierMatch = Boolean(
          payeeName &&
          invSupplier &&
          (this.isCompanyNameMatch(invSupplier, payeeName) ||
            (invSupplier.length >= 4 && purpose.includes(invSupplier.toLowerCase())))
        );

        // Criterion C: Match by Amount
        const isAmountMatch = paymentAmount > 0 && invAmount > 0 && Math.abs(paymentAmount - invAmount) <= 0.50;
        const isPartialAmountMatch = paymentAmount > 0 && invAmount > 0 && paymentAmount < invAmount - 0.50;

        // Criterion D: Overhead Context (keyword "цех", "цехові", "накладні" or order "ЦЕХ")
        const isOverheadContext =
          refOrder === 'цех' ||
          purpose.includes('цех') ||
          purpose.includes('цехові') ||
          purpose.includes('накладні') ||
          purpose.includes('загальновиробничі');

        const isCleanInvPlaceholder = this.isPlaceholderNumber(cleanInvNum);
        const hasContradictingInvoice =
          !isCleanInvPlaceholder &&
          refOrder &&
          refOrder !== 'цех' &&
          !this.isPlaceholderNumber(refOrder) &&
          !this.isInvoiceNumberMatch(cleanInvNum, refOrder) &&
          !hasInvNumMatch;

        const hasContradictingProjectOrder =
          Boolean(refOrder && refOrder !== 'цех' && !this.isPlaceholderNumber(refOrder) && !hasInvNumMatch && !isOverheadContext);

        const matchByInvoiceNum = hasInvNumMatch && (isDirectRefMatch || cleanInvNum.length >= 3 || !payeeName || !invSupplier || isSupplierMatch);
        const canFallbackMatch = cleanRefNumbers.length === 0;
        const matchBySupplierAndAmount = canFallbackMatch && isSupplierMatch && isAmountMatch && !hasContradictingInvoice && !hasContradictingProjectOrder;
        const matchByOverheadSupplierAndAmount = canFallbackMatch && isOverheadContext && isSupplierMatch && (isAmountMatch || isPartialAmountMatch) && !hasContradictingInvoice;

        if (matchByInvoiceNum || matchBySupplierAndAmount || matchByOverheadSupplierAndAmount) {
          let reason = '';
          let matchMethod: 'invoice_number' | 'overhead_context' | 'supplier_amount' = 'supplier_amount';
          if (matchByInvoiceNum) {
            matchMethod = 'invoice_number';
            reason = `Співпадіння за номером рахунку "${exp.invoiceNumber}" (вкладка «ЦЕХ»)`;
          } else if (matchByOverheadSupplierAndAmount) {
            matchMethod = 'overhead_context';
            reason = `Співпадіння за витратами цеху, постачальником "${exp.supplier}" та сумою (${exp.amount} грн) (вкладка «ЦЕХ»)`;
          } else {
            reason = `Співпадіння за постачальником "${exp.supplier}" та сумою (${exp.amount} грн) (вкладка «ЦЕХ»)`;
          }

          if (exp.rowIndex) matchedOverheadRowIndices.add(exp.rowIndex);

          matches.push({
            invoiceNumber: exp.invoiceNumber || `Рахунок (${exp.supplier})`,
            orderNumber: 'ЦЕХ',
            invoiceAmount: invAmount,
            previousPaidAmount: exp.paidAmount || 0,
            paidAmount: invAmount,
            computedStatus: 'Оплачено',
            matchedRowIndex: exp.rowIndex,
            matchReason: reason,
            supplier: exp.supplier,
            buyer: exp.buyer,
            isAlreadyClosed: false,
            isClosedPair: true,
            targetTab: 'Цех',
            isOverhead: true,
            matchMethod,
          });
        }
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
      const isDocOverhead =
        doc.isOverhead ||
        doc.expenseCategory === 'OVERHEAD' ||
        ocr.isOverhead ||
        ocr.expenseCategory === 'OVERHEAD' ||
        cleanOrderNum === 'цех';

      // RULE 1: If local invoice is ALREADY FULLY CLOSED ("Оплачено" and 100% paid), skip!
      const isDocAlreadyClosed =
        ocr.paymentStatus === 'Оплачено' ||
        (invAmount > 0 && ((doc.editedData?.amountPaid || ocr.amountPaid || 0) >= invAmount - 0.50));

      if (isDocAlreadyClosed) {
        continue;
      }

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
          existingSheetMatch.orderNumber = isDocOverhead ? 'ЦЕХ' : ocr.handwrittenOrderNumber;
        }
        continue;
      }

      const isDirectRefMatch = cleanRefNumbers.some((crn) => this.isInvoiceNumberMatch(cleanInvNum, crn));
      const hasInvNumMatch =
        !isDatePattern(rawInvNum) &&
        cleanInvNum.length >= 1 &&
        (isDirectRefMatch ||
          this.isInvoiceNumberMentionedInPurpose(cleanInvNum, purpose) ||
          (refOrder && this.isInvoiceNumberMatch(cleanInvNum, refOrder)));

      const isSupplierMatch = Boolean(
        payeeName &&
        invSupplier &&
        (this.isCompanyNameMatch(invSupplier, payeeName) ||
          (invSupplier.length >= 4 && purpose.includes(invSupplier.toLowerCase())))
      );

      const isAmountMatch = paymentAmount > 0 && invAmount > 0 && Math.abs(paymentAmount - invAmount) <= 0.50;
      const isPartialAmountMatch = paymentAmount > 0 && invAmount > 0 && paymentAmount < invAmount - 0.50;

      const isOrderMatch = Boolean(
        cleanOrderNum &&
        (cleanOrderNum === refOrder ||
          purpose.includes(cleanOrderNum) ||
          (refOrder && (cleanOrderNum.includes(refOrder) || refOrder.includes(cleanOrderNum))))
      );

      const isCleanInvPlaceholder = this.isPlaceholderNumber(cleanInvNum);
      const hasContradictingInvoice =
        !isCleanInvPlaceholder &&
        refOrder &&
        !this.isPlaceholderNumber(refOrder) &&
        !this.isInvoiceNumberMatch(cleanInvNum, refOrder) &&
        !hasInvNumMatch;

      const hasContradictingOrder =
        Boolean(cleanOrderNum && refOrder && cleanOrderNum !== refOrder && !purpose.includes(cleanOrderNum));

      const matchByInvoiceNum = hasInvNumMatch && (isDirectRefMatch || cleanInvNum.length >= 3 || !payeeName || !invSupplier || isSupplierMatch);
      const canFallbackMatch = cleanRefNumbers.length === 0;
      const matchBySupplierAndAmount = canFallbackMatch && isSupplierMatch && isAmountMatch && !hasContradictingInvoice && !hasContradictingOrder;
      const matchByOrderSupplierAndAmount = canFallbackMatch && isOrderMatch && isSupplierMatch && (isAmountMatch || isPartialAmountMatch) && !hasContradictingInvoice;
      const matchByOrderAndAmount = canFallbackMatch && isOrderMatch && isAmountMatch && !hasContradictingInvoice && (!payeeName || !invSupplier || isSupplierMatch);

      if (matchByInvoiceNum || matchBySupplierAndAmount || matchByOrderSupplierAndAmount || matchByOrderAndAmount) {
        let reason = '';
        let matchMethod: 'invoice_number' | 'order_number' | 'overhead_context' | 'supplier_amount' = 'supplier_amount';
        if (matchByInvoiceNum) {
          matchMethod = 'invoice_number';
          reason = `Співпадіння за локальним рахунком "${ocr.invoiceNumber}"`;
        } else if (matchByOrderSupplierAndAmount) {
          matchMethod = isDocOverhead ? 'overhead_context' : 'order_number';
          reason = `Співпадіння за замовленням "${ocr.handwrittenOrderNumber}", постачальником "${ocr.supplierName}" та сумою (${ocr.totalAmount} грн)`;
        } else if (matchByOrderAndAmount) {
          matchMethod = isDocOverhead ? 'overhead_context' : 'order_number';
          reason = `Співпадіння за замовленням "${ocr.handwrittenOrderNumber}" та сумою (${ocr.totalAmount} грн)`;
        } else {
          reason = `Співпадіння за постачальником "${ocr.supplierName}" та сумою (${ocr.totalAmount} грн)`;
        }

        if (isDocOverhead) {
          reason += ' (вкладка «ЦЕХ»)';
        }

        matchedDocIds.add(doc.id);

        matches.push({
          invoiceNumber: ocr.invoiceNumber,
          orderNumber: isDocOverhead ? 'ЦЕХ' : ocr.handwrittenOrderNumber,
          invoiceAmount: invAmount,
          previousPaidAmount: (doc.editedData?.amountPaid || ocr.amountPaid || 0),
          paidAmount: invAmount,
          computedStatus: 'Оплачено',
          matchedDocId: doc.id,
          matchReason: reason,
          supplier: ocr.supplierName,
          buyer: ocr.buyerName,
          isAlreadyClosed: false,
          isClosedPair: true,
          targetTab: isDocOverhead ? 'Цех' : 'Рахунки',
          isOverhead: isDocOverhead,
          matchMethod,
        });
      }
    }

    // 2.5. Combo / Subset-sum matching:
    // If no direct invoice number matches were identified, check if a single payment covers
    // multiple unpaid invoices from the same supplier across "Рахунки" and "Цех".
    if (matches.length === 0 && paymentAmount > 0 && payeeName) {
      interface CandidateInvoice {
        invoiceNumber: string;
        orderNumber: string;
        amount: number;
        paidAmount: number;
        rowIndex: number;
        supplier: string;
        buyer: string;
        targetTab: 'Рахунки' | 'Цех';
        isOverhead: boolean;
      }
      const candidates: CandidateInvoice[] = [];

      for (const inv of existingInvoices) {
        if (!inv.rowIndex || inv.paymentStatus === 'Оплачено') continue;
        const invSup = this.normalizeCompanyName(inv.supplier || '');
        if (invSup && this.isCompanyNameMatch(invSup, payeeName)) {
          const isInvOverhead = inv.isOverhead || inv.orderNumber === 'ЦЕХ';
          candidates.push({
            invoiceNumber: inv.invoiceNumber || '',
            orderNumber: isInvOverhead ? 'ЦЕХ' : (inv.orderNumber || ''),
            amount: inv.amount || 0,
            paidAmount: inv.paidAmount || 0,
            rowIndex: inv.rowIndex,
            supplier: inv.supplier,
            buyer: inv.buyer || '',
            targetTab: isInvOverhead ? 'Цех' : 'Рахунки',
            isOverhead: isInvOverhead,
          });
        }
      }

      for (const exp of existingOverheadExpenses) {
        if (!exp.rowIndex || exp.paymentStatus === 'Оплачено') continue;
        const expSup = this.normalizeCompanyName(exp.supplier || '');
        if (expSup && this.isCompanyNameMatch(expSup, payeeName)) {
          candidates.push({
            invoiceNumber: exp.invoiceNumber || `Рахунок (${exp.supplier})`,
            orderNumber: 'ЦЕХ',
            amount: exp.amount || 0,
            paidAmount: exp.paidAmount || 0,
            rowIndex: exp.rowIndex,
            supplier: exp.supplier,
            buyer: exp.buyer || '',
            targetTab: 'Цех',
            isOverhead: true,
          });
        }
      }

      if (candidates.length >= 2 && candidates.length <= 25) {
        const totalCandidateAmount = candidates.reduce((s, c) => s + c.amount, 0);
        if (Math.abs(totalCandidateAmount - paymentAmount) <= 0.50) {
          for (const c of candidates) {
            matches.push({
              invoiceNumber: c.invoiceNumber,
              orderNumber: c.orderNumber,
              invoiceAmount: c.amount,
              previousPaidAmount: c.paidAmount,
              paidAmount: c.amount,
              computedStatus: 'Оплачено',
              matchedRowIndex: c.rowIndex,
              matchReason: `Співпадіння за групою рахунків постачальника "${c.supplier}" на суму ${this.formatCurrency(paymentAmount)}${c.isOverhead ? ' (вкладка «ЦЕХ»)' : ''}`,
              supplier: c.supplier,
              buyer: c.buyer,
              isAlreadyClosed: false,
              isClosedPair: true,
              targetTab: c.targetTab,
              isOverhead: c.isOverhead,
              matchMethod: 'combo_amount',
            });
          }
        } else {
          // Subset sum search (sizes 2 through min(candidates.length, 6))
          const findCombo = (
            items: CandidateInvoice[],
            target: number,
            start: number,
            count: number,
            current: CandidateInvoice[]
          ): CandidateInvoice[] | null => {
            if (current.length === count) {
              const sum = current.reduce((a, b) => a + b.amount, 0);
              if (Math.abs(sum - target) <= 0.50) return current;
              return null;
            }
            for (let i = start; i < items.length; i++) {
              const res = findCombo(items, target, i + 1, count, [...current, items[i]]);
              if (res) return res;
            }
            return null;
          };

          let matchedSubset: CandidateInvoice[] | null = null;
          for (let size = 2; size <= Math.min(candidates.length, 6); size++) {
            matchedSubset = findCombo(candidates, paymentAmount, 0, size, []);
            if (matchedSubset) break;
          }

          if (matchedSubset) {
            for (const c of matchedSubset) {
              matches.push({
                invoiceNumber: c.invoiceNumber,
                orderNumber: c.orderNumber,
                invoiceAmount: c.amount,
                previousPaidAmount: c.paidAmount,
                paidAmount: c.amount,
                computedStatus: 'Оплачено',
                matchedRowIndex: c.rowIndex,
                matchReason: `Співпадіння за групою рахунків постачальника "${c.supplier}" на суму ${this.formatCurrency(paymentAmount)}${c.isOverhead ? ' (вкладка «ЦЕХ»)' : ''}`,
                supplier: c.supplier,
                buyer: c.buyer,
                isAlreadyClosed: false,
                isClosedPair: true,
                targetTab: c.targetTab,
                isOverhead: c.isOverhead,
                matchMethod: 'combo_amount',
              });
            }
          }
        }
      }
    }

    // 3. Compute status for all matched invoices based on payment amount & cumulative partial payments (доплати)
    // Safety check: if specific matches exist (by invoice number, order number, overhead context, or combo),
    // drop purely generic supplier+amount matches.
    const hasSpecific = matches.some(
      (m) =>
        m.matchMethod === 'invoice_number' ||
        m.matchMethod === 'order_number' ||
        m.matchMethod === 'overhead_context' ||
        m.matchMethod === 'combo_amount'
    );
    if (hasSpecific) {
      const specificMatches = matches.filter((m) => m.matchMethod !== 'supplier_amount');
      if (specificMatches.length > 0) {
        matches = specificMatches;
      }
    } else if (matches.length > 1) {
      // Multiple matches purely by supplier + single amount (ambiguous collision):
      matches = [];
    }

    if (matches.length > 0) {
      if (matches.length === 1) {
        // Single invoice in payment order: can be full payment, partial/prepayment, or additional payment (доплата)
        const single = matches[0];
        const prevPaid = single.previousPaidAmount || 0;

        // GOLDEN RULE: If invoice is already closed ("Оплачено" or prevPaid covers invoiceAmount):
        // It is closed and deactivated! Do not accumulate payment or multiply amounts.
        const isAlreadyClosed =
          single.isAlreadyClosed ||
          (single.invoiceAmount > 0 && prevPaid >= single.invoiceAmount - 0.50);

        if (isAlreadyClosed) {
          single.computedStatus = 'Оплачено';
          single.paidAmount = single.invoiceAmount; // STRICT: capped at invoice amount
          single.isClosedPair = true;
          single.matchReason = `${single.matchReason || ''} (🔒 Пара закрита: статус «Оплачено», сума ${this.formatCurrency(single.invoiceAmount)}). Подальшу обробку деактивовано.`.trim();
        } else if (paymentAmount > 0) {
          const newTotalPaid = prevPaid + paymentAmount;

          if (newTotalPaid >= (single.invoiceAmount - 0.50)) {
            // Reached 100% full payment: close the pair and strictly cap at invoice amount
            single.computedStatus = 'Оплачено';
            single.paidAmount = single.invoiceAmount; // STRICT: NEVER exceed invoiceAmount!
            single.isClosedPair = true;
            if (prevPaid > 0) {
              single.matchReason = `${single.matchReason || ''} (Доплата до повного розрахунку: було ${prevPaid} грн + ${paymentAmount} грн = ${single.invoiceAmount} грн. Пара закрита.)`.trim();
            } else {
              single.matchReason = `${single.matchReason || ''} (Оплачено на 100%. Пара закрита.)`.trim();
            }
          } else {
            // Partial payment / Additional partial payment (доплата)
            single.computedStatus = 'Оплачено частково';
            single.paidAmount = Math.min(newTotalPaid, single.invoiceAmount);
            single.isClosedPair = false;
            if (prevPaid > 0) {
              single.matchReason = `${single.matchReason || ''} (Чергова доплата: було ${prevPaid} грн + нова доплата ${paymentAmount} грн = разом ${single.paidAmount} грн з ${single.invoiceAmount} грн)`.trim();
            }
          }
        } else {
          single.computedStatus = 'Оплачено';
          single.paidAmount = single.invoiceAmount;
          single.isClosedPair = true;
        }
      } else {
        // Multiple invoices in single payment order:
        // Бізнес-правило: якщо рахунок є в груповій платіжці, він автоматично вважається
        // оплаченим на 100%, а сума оплати береться суворо з суми самого рахунку.
        for (const m of matches) {
          m.computedStatus = 'Оплачено';
          m.paidAmount = m.invoiceAmount;
          m.isClosedPair = true;
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
    localDocuments: ProcessedDocument[] = [],
    existingOverheadExpenses: OverheadExpenseRow[] = []
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
    matchedSupplier?: string;
    matchedBuyer?: string;
    isClosedPair?: boolean;
    targetTab?: 'Рахунки' | 'Цех';
    isOverhead?: boolean;
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
      supplier?: string;
      buyer?: string;
      isClosedPair?: boolean;
      targetTab?: 'Рахунки' | 'Цех';
      isOverhead?: boolean;
    }>;
  } {
    const paymentAmount = paymentOcr.amountPaid || paymentOcr.totalAmount || 0;
    const allMatches = this.matchPaymentWithAllInvoices(paymentOcr, existingInvoices, localDocuments, existingOverheadExpenses);

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
    const supplierList = Array.from(new Set(allMatches.map((m) => m.supplier).filter(Boolean))).join(', ');
    const buyerList = Array.from(new Set(allMatches.map((m) => m.buyer).filter(Boolean))).join(', ');

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
      matchedSupplier: supplierList || first.supplier,
      matchedBuyer: buyerList || first.buyer,
      isClosedPair: first.isClosedPair,
      targetTab: first.targetTab,
      isOverhead: first.isOverhead,
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
    localDocuments: ProcessedDocument[] = [],
    existingInvoices: ExistingSheetRow[] = []
  ): {
    matchedPaymentNumbers: string[];
    totalPaidAmount: number;
    computedStatus: InvoicePaymentStatus;
    matchedPaymentRows: ExistingPaymentRow[];
    matchReason?: string;
    isClosedPair?: boolean;
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
        cleanInvNum.length >= 1 &&
        (cleanPRefNumbers.some((cpn) => this.isInvoiceNumberMatch(cleanInvNum, cpn)) ||
          (refInv && this.isInvoiceNumberMatch(cleanInvNum, refInv)) ||
          this.isInvoiceNumberMentionedInPurpose(cleanInvNum, p.paymentPurpose || ''));

      // Check payee against supplier
      const isSupplierMatch = Boolean(
        supplier &&
        payee &&
        (this.isCompanyNameMatch(supplier, payee) ||
          (supplier.length >= 4 && purpose.includes(supplier.toLowerCase())))
      );

      // Check amount match
      const isAmountMatch = invAmount > 0 && pAmount > 0 && Math.abs(invAmount - pAmount) <= 0.50;
      const isPartialAmountMatch = invAmount > 0 && pAmount > 0 && pAmount < invAmount - 0.50;

      // Check order match
      const isOrderMatch = Boolean(
        cleanOrderNum &&
        ((refOrd && (refOrd === cleanOrderNum || cleanOrderNum === refOrd || refOrd.includes(cleanOrderNum) || cleanOrderNum.includes(refOrd))) ||
          purpose.includes(cleanOrderNum))
      );

      // Check if payment has an explicit referenced invoice that conflicts with this one
      const isCleanInvPlaceholder = this.isPlaceholderNumber(cleanInvNum);
      const hasContradictingInvoice =
        !isCleanInvPlaceholder &&
        refInv &&
        !this.isPlaceholderNumber(refInv) &&
        !this.isInvoiceNumberMatch(cleanInvNum, refInv) &&
        !hasDirectInvNumMatch;

      const hasContradictingOrder =
        Boolean(cleanOrderNum && refOrd && cleanOrderNum !== refOrd && !purpose.includes(cleanOrderNum));

      // RULE 1: If a payment is already paired and fully closed with another invoice,
      // it CANNOT be linked to this new invoice!
      // Exceptions:
      //  - Payment explicitly lists multiple invoice numbers and THIS invoice is one of them (hasDirectInvNumMatch);
      //  - Or the existing invoice was only partially paid ("Оплачено частково") and is waiting for more payments.
      if (existingInvoices.length > 0) {
        if (cleanPRefNumbers.length > 0) {
          if (!hasDirectInvNumMatch) {
            continue;
          }
        } else {
          const isClaimedByClosedInvoice = existingInvoices.some((ei) => {
            const isEiClosed = ei.paymentStatus === 'Оплачено' || (ei.amount > 0 && (ei.paidAmount || 0) >= ei.amount - 0.50);
            if (!isEiClosed) return false;
            const eiSup = this.normalizeCompanyName(ei.supplier || '');
            const eiAmt = ei.amount || 0;
            const eiOrd = this.normalizeOrderNumber(ei.orderNumber || '').toLowerCase();
            return (
              (eiSup && payee && this.isCompanyNameMatch(eiSup, payee) && Math.abs(eiAmt - pAmount) <= 0.50) ||
              (eiOrd && refOrd && (eiOrd === refOrd || refOrd.includes(eiOrd)) && Math.abs(eiAmt - pAmount) <= 0.50)
            );
          });
          if (isClaimedByClosedInvoice) {
            continue;
          }
        }
      }

      // Condition 1: Direct match by invoice number
      const matchByInvoiceNum = hasDirectInvNumMatch && (!payee || !supplier || isSupplierMatch || isAmountMatch);

      // Fallback matching ONLY when payment does NOT have explicit invoice numbers:
      const canFallbackMatch = cleanPRefNumbers.length === 0 && !refInv;
      const matchByPayeeAndAmount = canFallbackMatch && isSupplierMatch && isAmountMatch && !hasContradictingInvoice && !hasContradictingOrder;
      const matchByOrderSupplierAndAmount = canFallbackMatch && isOrderMatch && isSupplierMatch && (isAmountMatch || isPartialAmountMatch) && !hasContradictingInvoice;
      const matchByOrderAndAmount = canFallbackMatch && isOrderMatch && isAmountMatch && !hasContradictingInvoice && (!payee || !supplier || isSupplierMatch);

      if (matchByInvoiceNum || matchByPayeeAndAmount || matchByOrderSupplierAndAmount || matchByOrderAndAmount) {
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
        cleanInvNum.length >= 1 &&
        (cleanPRefNumbers.some((cpn) => this.isInvoiceNumberMatch(cleanInvNum, cpn)) ||
          (refInv && this.isInvoiceNumberMatch(cleanInvNum, refInv)) ||
          this.isInvoiceNumberMentionedInPurpose(cleanInvNum, ocr.paymentPurpose || ''));

      const isSupplierMatch = Boolean(
        supplier &&
        payee &&
        (this.isCompanyNameMatch(supplier, payee) ||
          (supplier.length >= 4 && purpose.includes(supplier.toLowerCase())))
      );

      const isAmountMatch = invAmount > 0 && pAmount > 0 && Math.abs(invAmount - pAmount) <= 0.50;
      const isPartialAmountMatch = invAmount > 0 && pAmount > 0 && pAmount < invAmount - 0.50;

      const isOrderMatch = Boolean(
        cleanOrderNum &&
        ((refOrd && (refOrd === cleanOrderNum || cleanOrderNum === refOrd || refOrd.includes(cleanOrderNum) || cleanOrderNum.includes(refOrd))) ||
          purpose.includes(cleanOrderNum))
      );

      const isCleanInvPlaceholder = this.isPlaceholderNumber(cleanInvNum);
      const hasContradictingInvoice =
        !isCleanInvPlaceholder &&
        refInv &&
        !this.isPlaceholderNumber(refInv) &&
        !this.isInvoiceNumberMatch(cleanInvNum, refInv) &&
        !hasDirectInvNumMatch;

      const hasContradictingOrder =
        Boolean(cleanOrderNum && refOrd && cleanOrderNum !== refOrd && !purpose.includes(cleanOrderNum));

      // RULE 1: If a payment is already paired and fully closed with another invoice,
      // it CANNOT be linked to this new invoice!
      // Exceptions:
      //  - Payment explicitly lists multiple invoice numbers and THIS invoice is one of them (hasDirectInvNumMatch);
      //  - Or the existing invoice was only partially paid ("Оплачено частково") and is waiting for more payments.
      if (existingInvoices.length > 0) {
        if (cleanPRefNumbers.length > 0) {
          if (!hasDirectInvNumMatch) {
            continue;
          }
        } else {
          const isClaimedByClosedInvoice = existingInvoices.some((ei) => {
            const isEiClosed = ei.paymentStatus === 'Оплачено' || (ei.amount > 0 && (ei.paidAmount || 0) >= ei.amount - 0.50);
            if (!isEiClosed) return false;
            const eiSup = this.normalizeCompanyName(ei.supplier || '');
            const eiAmt = ei.amount || 0;
            const eiOrd = this.normalizeOrderNumber(ei.orderNumber || '').toLowerCase();
            return (
              (eiSup && payee && this.isCompanyNameMatch(eiSup, payee) && Math.abs(eiAmt - pAmount) <= 0.50) ||
              (eiOrd && refOrd && (eiOrd === refOrd || refOrd.includes(eiOrd)) && Math.abs(eiAmt - pAmount) <= 0.50)
            );
          });
          if (isClaimedByClosedInvoice) {
            continue;
          }
        }
      }

      const matchByInvoiceNum = hasDirectInvNumMatch && (!payee || !supplier || isSupplierMatch || isAmountMatch);
      const canFallbackMatch = cleanPRefNumbers.length === 0 && !refInv;
      const matchByPayeeAndAmount = canFallbackMatch && isSupplierMatch && isAmountMatch && !hasContradictingInvoice && !hasContradictingOrder;
      const matchByOrderSupplierAndAmount = canFallbackMatch && isOrderMatch && isSupplierMatch && (isAmountMatch || isPartialAmountMatch) && !hasContradictingInvoice;
      const matchByOrderAndAmount = canFallbackMatch && isOrderMatch && isAmountMatch && !hasContradictingInvoice && (!payee || !supplier || isSupplierMatch);

      if (matchByInvoiceNum || matchByPayeeAndAmount || matchByOrderSupplierAndAmount || matchByOrderAndAmount) {
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

    // RULE: If payment explicitly specifies this invoice number in purpose or referenced numbers,
    // (e.g. multi-invoice payment "Оплачено згідно рах. № 1, 2, 3..."), this invoice is 100% paid ("Оплачено")!
    const isExplicitlyReferencedInMatchedPayment = matchedPayments.some((p) => {
      const pRef = this.extractAllInvoiceNumbers(p.referencedInvoiceNumber, undefined, p.paymentPurpose);
      return pRef.some((prn) => this.isInvoiceNumberMatch(cleanInvNum, this.normalizeInvoiceNumber(prn)));
    });

    let computedStatus: InvoicePaymentStatus = 'Не оплачено';
    if (invAmount > 0) {
      if (totalPaid >= invAmount - 0.50 || isExplicitlyReferencedInMatchedPayment) {
        computedStatus = 'Оплачено';
      } else if (totalPaid > 0) {
        computedStatus = 'Оплачено частково';
      }
    } else if (totalPaid > 0) {
      computedStatus = 'Оплачено';
    }

    // STRICT GOLDEN RULE: When invoice is fully paid (status is "Оплачено"),
    // totalPaidAmount is strictly capped at invoiceAmount (100%).
    const finalPaidAmount = computedStatus === 'Оплачено' && invAmount > 0 ? invAmount : effectivePaidAmount;

    const first = matchedPayments[0];
    const locationStr = first.rowIndex ? `рядок ${first.rowIndex} у вкладці "Платіжки"` : `файл ${first.fileName}`;
    const reason = `Знайдено платіжку №${first.paymentNumber || ''} на суму ${this.formatCurrency(first.amountPaid || totalPaid)} (${locationStr})`;

    return {
      matchedPaymentNumbers: payNumbers,
      totalPaidAmount: finalPaidAmount,
      computedStatus,
      matchedPaymentRows: matchedPayments,
      matchReason: reason,
      isClosedPair: computedStatus === 'Оплачено',
    };
  }

  /**
   * Reconciles existing invoices with existing payments using closed-pair deactivation.
   * Business Rule:
   * "якщо є рахунок, є платіжка по ньому, всі дані співпадають і статус Оплачено,
   * на цьому все, деактивуємо роботу з цією парою, вони закриті фактично"
   *
   * Pass 1: Identifies all invoices already marked "Оплачено" and pairs them with their payments.
   *         These pairs are closed/deactivated: payments are marked as consumed and cannot be
   *         reused, and the invoice paid amount is strictly capped at the invoice amount.
   * Pass 2: Reconciles remaining open invoices against only unconsumed payments.
   */
  public static reconcileInvoicesWithPayments(
    existingInvoices: ExistingSheetRow[] = [],
    existingPayments: ExistingPaymentRow[] = [],
    existingOverheadExpenses: OverheadExpenseRow[] = []
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
    isClosedPair?: boolean;
    allMatchedInvoiceRowIndices?: number[];
    siblingUnpaidInvoiceRowIndices?: number[];
    multiInvoiceCount?: number;
    targetTab?: 'Рахунки' | 'Цех';
    isOverhead?: boolean;
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
      isClosedPair?: boolean;
      allMatchedInvoiceRowIndices?: number[];
      siblingUnpaidInvoiceRowIndices?: number[];
      multiInvoiceCount?: number;
      targetTab?: 'Рахунки' | 'Цех';
      isOverhead?: boolean;
    }> = [];

    // 1. Analyze every payment in existingPayments to determine which invoices it matches,
    // identifying multi-invoice payments covering "Рахунки" and/or "Цех".
    interface ReconcileTarget {
      targetKey: string; // e.g. "inv_5" or "overhead_7"
      targetTab: 'Рахунки' | 'Цех';
      rowIndex: number;
      invoiceNumber: string;
      orderNumber?: string;
      supplier: string;
      invoiceAmount: number;
      computedStatus: InvoicePaymentStatus;
      paidAmount: number;
      matchReason?: string;
      isOverhead: boolean;
      isUnpaid: boolean;
    }

    const paymentMatchedInvoicesMap = new Map<
      number,
      {
        targets: ReconcileTarget[];
        allTargetKeys: string[];
        unpaidTargetKeys: string[];
        isMultiInvoice: boolean;
        totalInvoiceCount: number;
      }
    >();

    const targetToPaymentsMap = new Map<
      string,
      Array<{
        payment: ExistingPaymentRow;
        target: ReconcileTarget;
      }>
    >();

    for (const p of existingPayments) {
      if (!p.rowIndex) continue;
      const pOcr: OCRResult = {
        documentType: 'payment',
        documentTypeUkrainian: 'Платіжна інструкція',
        paymentNumber: p.paymentNumber,
        paymentDate: p.paymentDate,
        invoiceNumber: p.referencedInvoiceNumber || '',
        invoiceDate: p.paymentDate || '',
        supplierName: p.payee,
        buyerName: p.payer,
        payerName: p.payer,
        payeeName: p.payee,
        amountPaid: p.amountPaid,
        totalAmount: p.amountPaid,
        currency: p.currency || 'UAH',
        paymentPurpose: p.paymentPurpose,
        referencedInvoiceNumber: p.referencedInvoiceNumber,
        referencedInvoiceNumbers: this.extractAllInvoiceNumbers(p.referencedInvoiceNumber, undefined, p.paymentPurpose),
        referencedOrderNumber: p.orderNumber,
        handwrittenOrderNumber: p.orderNumber,
        handwrittenConfidence: 'high',
        confidenceScore: 100,
      };

      const matchedInvs = this.matchPaymentWithAllInvoices(pOcr, existingInvoices, [], existingOverheadExpenses);

      const targets: ReconcileTarget[] = [];
      for (const m of matchedInvs) {
        if (!m.matchedRowIndex) continue;
        const isExp = m.targetTab === 'Цех' || m.isOverhead;
        const targetKey = isExp ? `overhead_${m.matchedRowIndex}` : `inv_${m.matchedRowIndex}`;
        const currentStatus = isExp
          ? existingOverheadExpenses.find((e) => e.rowIndex === m.matchedRowIndex)?.paymentStatus || 'Не оплачено'
          : existingInvoices.find((i) => i.rowIndex === m.matchedRowIndex)?.paymentStatus || 'Не оплачено';

        const t: ReconcileTarget = {
          targetKey,
          targetTab: isExp ? 'Цех' : 'Рахунки',
          rowIndex: m.matchedRowIndex,
          invoiceNumber: m.invoiceNumber,
          orderNumber: isExp ? 'ЦЕХ' : m.orderNumber,
          supplier: m.supplier || '',
          invoiceAmount: m.invoiceAmount,
          computedStatus: m.computedStatus,
          paidAmount: m.paidAmount || m.invoiceAmount,
          matchReason: m.matchReason,
          isOverhead: Boolean(isExp),
          isUnpaid: currentStatus !== 'Оплачено',
        };
        targets.push(t);

        const existingList = targetToPaymentsMap.get(targetKey) || [];
        existingList.push({ payment: p, target: t });
        targetToPaymentsMap.set(targetKey, existingList);
      }

      const allTargetKeys = targets.map((t) => t.targetKey);
      const unpaidTargetKeys = targets.filter((t) => t.isUnpaid).map((t) => t.targetKey);
      const extractedRefNums = this.extractAllInvoiceNumbers(p.referencedInvoiceNumber, undefined, p.paymentPurpose);
      const isMultiInvoice = targets.length > 1 || extractedRefNums.length > 1;

      paymentMatchedInvoicesMap.set(p.rowIndex, {
        targets,
        allTargetKeys,
        unpaidTargetKeys,
        isMultiInvoice,
        totalInvoiceCount: Math.max(targets.length, extractedRefNums.length),
      });
    }

    const consumedPaymentRowIndices = new Set<number>();
    const consumedPaymentSemanticKeys = new Set<string>();

    // Pass 1: Process invoices that ALREADY have status "Оплачено" in Google Sheets.
    // They are closed pairs. Deactivate further accumulation, but DO NOT consume multi-invoice payments
    // if there are other invoices from that same payment that are still unpaid!
    for (const inv of existingInvoices) {
      if (!inv.rowIndex) continue;
      if (inv.paymentStatus === 'Оплачено') {
        const targetKey = `inv_${inv.rowIndex}`;
        const matchedPaymentEntries = targetToPaymentsMap.get(targetKey) || [];
        let firstPay = matchedPaymentEntries[0]?.payment;
        let payInfo = firstPay?.rowIndex ? paymentMatchedInvoicesMap.get(firstPay.rowIndex) : undefined;

        if (!firstPay) {
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
            approvalStatus: inv.approvalStatus || (inv.paymentStatus !== 'Оплачено' ? 'НЕ ПОГОДЖЕНО' : undefined),
          };
          const match = this.matchInvoiceWithPayments(mockOcr, existingPayments);
          firstPay = match.matchedPaymentRows[0];
          payInfo = firstPay?.rowIndex ? paymentMatchedInvoicesMap.get(firstPay.rowIndex) : undefined;
        }

        if (firstPay?.rowIndex) {
          const pInfo = paymentMatchedInvoicesMap.get(firstPay.rowIndex);
          const hasUnpaidRemaining = pInfo && pInfo.unpaidTargetKeys.some((k) => k !== targetKey);
          // Only consume if all invoices for this payment are fully closed
          if (!hasUnpaidRemaining) {
            consumedPaymentRowIndices.add(firstPay.rowIndex);
            const semKey = `${(firstPay.paymentNumber || '').trim().toLowerCase()}_${firstPay.amountPaid || 0}_${this.normalizeCompanyName(firstPay.payee || '')}_${firstPay.paymentDate || ''}`;
            consumedPaymentSemanticKeys.add(semKey);
          }
        }

        const allIndices = payInfo?.targets ? payInfo.targets.map((t) => t.rowIndex) : (firstPay?.rowIndex ? [inv.rowIndex] : []);
        const unpaidIndices = payInfo?.targets ? payInfo.targets.filter((t) => t.isUnpaid).map((t) => t.rowIndex) : [];
        const multiCount = payInfo?.totalInvoiceCount || (allIndices.length > 1 ? allIndices.length : 1);
        const isOverhead = inv.isOverhead || inv.orderNumber === 'ЦЕХ';

        results.push({
          invoiceRowIndex: inv.rowIndex,
          invoiceNumber: inv.invoiceNumber,
          orderNumber: isOverhead ? 'ЦЕХ' : inv.orderNumber,
          supplier: inv.supplier,
          invoiceAmount: inv.amount,
          currentStatus: inv.paymentStatus,
          computedStatus: 'Оплачено',
          paidAmount: inv.amount, // STRICT: capped at 100% of invoice amount
          matchedPaymentRowIndex: firstPay?.rowIndex,
          matchedPaymentNumber: firstPay?.paymentNumber,
          matchedPaymentDate: firstPay?.paymentDate,
          matchedPaymentAmount: firstPay?.amountPaid,
          matchedPaymentPayee: firstPay?.payee,
          matchReason: firstPay
            ? payInfo?.isMultiInvoice
              ? `🔒 Пара закрита: рахунок №${inv.invoiceNumber || ''} оплачено груповою платіжкою №${firstPay.paymentNumber || ''} (сума ${this.formatCurrency(inv.amount)})`
              : `🔒 Пара закрита (деактивована): рахунок №${inv.invoiceNumber || ''} оплачено платіжкою №${firstPay.paymentNumber || ''} на суму ${this.formatCurrency(inv.amount)}`
            : `🔒 Рахунок закрито (статус «Оплачено», сума ${this.formatCurrency(inv.amount)})`,
          isClosedPair: true,
          allMatchedInvoiceRowIndices: allIndices,
          siblingUnpaidInvoiceRowIndices: unpaidIndices.filter((idx) => idx !== inv.rowIndex),
          multiInvoiceCount: multiCount,
          targetTab: isOverhead ? 'Цех' : 'Рахунки',
          isOverhead,
        });
      }
    }

    // Pass 1.5: Process overhead expenses from "Цех" already marked "Оплачено"
    if (existingOverheadExpenses && existingOverheadExpenses.length > 0) {
      for (const exp of existingOverheadExpenses) {
        if (!exp.rowIndex) continue;
        if (exp.paymentStatus === 'Оплачено') {
          const targetKey = `overhead_${exp.rowIndex}`;
          const matchedPaymentEntries = targetToPaymentsMap.get(targetKey) || [];
          let firstPay = matchedPaymentEntries[0]?.payment;
          let payInfo = firstPay?.rowIndex ? paymentMatchedInvoicesMap.get(firstPay.rowIndex) : undefined;

          if (!firstPay) {
            const mockOcr: OCRResult = {
              invoiceNumber: exp.invoiceNumber || '',
              invoiceDate: exp.date || '',
              handwrittenOrderNumber: 'ЦЕХ',
              supplierName: exp.supplier,
              buyerName: exp.buyer || '',
              totalAmount: exp.amount,
              currency: 'UAH',
              documentType: 'invoice',
              documentTypeUkrainian: 'Витрати цеху',
              handwrittenConfidence: 'high',
              confidenceScore: 1,
              paymentStatus: 'Оплачено',
              expenseCategory: 'OVERHEAD',
              isOverhead: true,
            };
            const match = this.matchInvoiceWithPayments(mockOcr, existingPayments);
            firstPay = match.matchedPaymentRows[0];
            payInfo = firstPay?.rowIndex ? paymentMatchedInvoicesMap.get(firstPay.rowIndex) : undefined;
          }

          if (firstPay?.rowIndex) {
            const pInfo = paymentMatchedInvoicesMap.get(firstPay.rowIndex);
            const hasUnpaidRemaining = pInfo && pInfo.unpaidTargetKeys.some((k) => k !== targetKey);
            if (!hasUnpaidRemaining) {
              consumedPaymentRowIndices.add(firstPay.rowIndex);
              const semKey = `${(firstPay.paymentNumber || '').trim().toLowerCase()}_${firstPay.amountPaid || 0}_${this.normalizeCompanyName(firstPay.payee || '')}_${firstPay.paymentDate || ''}`;
              consumedPaymentSemanticKeys.add(semKey);
            }
          }

          const allIndices = payInfo?.targets ? payInfo.targets.map((t) => t.rowIndex) : (firstPay?.rowIndex ? [exp.rowIndex] : []);
          const unpaidIndices = payInfo?.targets ? payInfo.targets.filter((t) => t.isUnpaid).map((t) => t.rowIndex) : [];
          const multiCount = payInfo?.totalInvoiceCount || (allIndices.length > 1 ? allIndices.length : 1);

          results.push({
            invoiceRowIndex: exp.rowIndex,
            invoiceNumber: exp.invoiceNumber || `Рахунок (${exp.supplier})`,
            orderNumber: 'ЦЕХ',
            supplier: exp.supplier,
            invoiceAmount: exp.amount,
            currentStatus: 'Оплачено',
            computedStatus: 'Оплачено',
            paidAmount: exp.amount,
            matchedPaymentRowIndex: firstPay?.rowIndex,
            matchedPaymentNumber: firstPay?.paymentNumber,
            matchedPaymentDate: firstPay?.paymentDate,
            matchedPaymentAmount: firstPay?.amountPaid,
            matchedPaymentPayee: firstPay?.payee,
            matchReason: firstPay
              ? payInfo?.isMultiInvoice
                ? `🔒 Пара закрита (вкладка «ЦЕХ»): рахунок цеху оплачено груповою платіжкою №${firstPay.paymentNumber || ''} (сума ${this.formatCurrency(exp.amount)})`
                : `🔒 Пара закрита (вкладка «ЦЕХ»): рахунок цеху оплачено платіжкою №${firstPay.paymentNumber || ''}`
              : `🔒 Витрату цеху закрито (статус «Оплачено», сума ${this.formatCurrency(exp.amount)})`,
            isClosedPair: true,
            allMatchedInvoiceRowIndices: allIndices,
            siblingUnpaidInvoiceRowIndices: unpaidIndices.filter((idx) => idx !== exp.rowIndex),
            multiInvoiceCount: multiCount,
            targetTab: 'Цех',
            isOverhead: true,
          });
        }
      }
    }

    // Pass 2: Process remaining open invoices (status is "Не оплачено" or "Оплачено частково").
    // Reconcile against available payments.
    for (const inv of existingInvoices) {
      if (!inv.rowIndex) continue;
      if (inv.paymentStatus === 'Оплачено') continue; // already handled in Pass 1

      const targetKey = `inv_${inv.rowIndex}`;
      const matchedPaymentEntries = targetToPaymentsMap.get(targetKey) || [];

      // Look for a payment specifically matched to this invoice that is either not consumed or specifically covers it
      const directEntry = matchedPaymentEntries.find((entry) => {
        if (!entry.payment.rowIndex) return true;
        const pInfo = paymentMatchedInvoicesMap.get(entry.payment.rowIndex);
        if (pInfo && pInfo.allTargetKeys.includes(targetKey)) return true;
        return !consumedPaymentRowIndices.has(entry.payment.rowIndex);
      });

      let firstPay: ExistingPaymentRow | undefined;
      let computedStatus: InvoicePaymentStatus = 'Не оплачено';
      let matchReason = '';
      let payInfo: any;

      if (directEntry) {
        firstPay = directEntry.payment;
        computedStatus = directEntry.target.computedStatus || 'Оплачено';
        matchReason = directEntry.target.matchReason || '';
        payInfo = firstPay.rowIndex ? paymentMatchedInvoicesMap.get(firstPay.rowIndex) : undefined;
      } else {
        const availablePayments = existingPayments.filter((p) => {
          if (!p.rowIndex) return true;
          const pInfo = paymentMatchedInvoicesMap.get(p.rowIndex);
          if (pInfo && pInfo.allTargetKeys.includes(targetKey)) {
            return true;
          }
          if (consumedPaymentRowIndices.has(p.rowIndex)) return false;
          const semKey = `${(p.paymentNumber || '').trim().toLowerCase()}_${p.amountPaid || 0}_${this.normalizeCompanyName(p.payee || '')}_${p.paymentDate || ''}`;
          if (consumedPaymentSemanticKeys.has(semKey)) return false;
          return true;
        });

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
          approvalStatus: inv.approvalStatus || 'НЕ ПОГОДЖЕНО',
        };

        const match = this.matchInvoiceWithPayments(mockOcr, availablePayments);
        if (match.computedStatus && match.computedStatus !== 'Не оплачено') {
          firstPay = match.matchedPaymentRows[0];
          computedStatus = match.computedStatus;
          matchReason = match.matchReason;
          payInfo = firstPay?.rowIndex ? paymentMatchedInvoicesMap.get(firstPay.rowIndex) : undefined;
        }
      }

      if (firstPay && computedStatus !== 'Не оплачено') {
        if (computedStatus === 'Оплачено' && firstPay.rowIndex) {
          const pInfo = paymentMatchedInvoicesMap.get(firstPay.rowIndex);
          const remainingSiblingsUnpaid = pInfo ? pInfo.unpaidTargetKeys.filter((k) => k !== targetKey) : [];
          if (!pInfo?.isMultiInvoice || remainingSiblingsUnpaid.length === 0) {
            consumedPaymentRowIndices.add(firstPay.rowIndex);
            const semKey = `${(firstPay.paymentNumber || '').trim().toLowerCase()}_${firstPay.amountPaid || 0}_${this.normalizeCompanyName(firstPay.payee || '')}_${firstPay.paymentDate || ''}`;
            consumedPaymentSemanticKeys.add(semKey);
          }
        }

        const allIndices = payInfo?.targets ? payInfo.targets.map((t: ReconcileTarget) => t.rowIndex) : (firstPay.rowIndex ? [inv.rowIndex] : []);
        const unpaidIndices = payInfo?.targets ? payInfo.targets.filter((t: ReconcileTarget) => t.isUnpaid).map((t: ReconcileTarget) => t.rowIndex) : [];
        const multiCount = payInfo?.totalInvoiceCount || (allIndices.length > 1 ? allIndices.length : 1);

        let customMatchReason = matchReason;
        if (payInfo?.isMultiInvoice && firstPay) {
          customMatchReason = `Платіжка №${firstPay.paymentNumber || ''} (рядок ${firstPay.rowIndex}) містить ${multiCount} рахунки. За цим рахунком сума: ${this.formatCurrency(inv.amount)}.`;
        }

        const isOverhead = inv.isOverhead || inv.orderNumber === 'ЦЕХ';

        results.push({
          invoiceRowIndex: inv.rowIndex,
          invoiceNumber: inv.invoiceNumber,
          orderNumber: isOverhead ? 'ЦЕХ' : inv.orderNumber,
          supplier: inv.supplier,
          invoiceAmount: inv.amount,
          currentStatus: inv.paymentStatus,
          computedStatus,
          paidAmount: computedStatus === 'Оплачено' ? inv.amount : Math.min(firstPay.amountPaid || inv.amount, inv.amount),
          matchedPaymentRowIndex: firstPay.rowIndex,
          matchedPaymentNumber: firstPay.paymentNumber,
          matchedPaymentDate: firstPay.paymentDate,
          matchedPaymentAmount: firstPay.amountPaid,
          matchedPaymentPayee: firstPay.payee,
          matchReason: customMatchReason || `Знайдено платіжку на суму ${this.formatCurrency(firstPay.amountPaid || inv.amount)}`,
          isClosedPair: computedStatus === 'Оплачено',
          allMatchedInvoiceRowIndices: allIndices,
          siblingUnpaidInvoiceRowIndices: unpaidIndices.filter((idx: number) => idx !== inv.rowIndex),
          multiInvoiceCount: multiCount,
          targetTab: isOverhead ? 'Цех' : 'Рахунки',
          isOverhead,
        });
      }
    }

    // Pass 2.5: Process remaining open overhead expenses from "Цех"
    if (existingOverheadExpenses && existingOverheadExpenses.length > 0) {
      for (const exp of existingOverheadExpenses) {
        if (!exp.rowIndex) continue;
        if (exp.paymentStatus === 'Оплачено') continue;

        const targetKey = `overhead_${exp.rowIndex}`;
        const matchedPaymentEntries = targetToPaymentsMap.get(targetKey) || [];

        // Direct lookup from Step 1 matches
        const directEntry = matchedPaymentEntries.find((entry) => {
          if (!entry.payment.rowIndex) return true;
          const pInfo = paymentMatchedInvoicesMap.get(entry.payment.rowIndex);
          if (pInfo && pInfo.allTargetKeys.includes(targetKey)) return true;
          return !consumedPaymentRowIndices.has(entry.payment.rowIndex);
        });

        let firstPay: ExistingPaymentRow | undefined;
        let computedStatus: InvoicePaymentStatus = 'Не оплачено';
        let matchReason = '';
        let payInfo: any;

        if (directEntry) {
          firstPay = directEntry.payment;
          computedStatus = directEntry.target.computedStatus || 'Оплачено';
          matchReason = directEntry.target.matchReason || '';
          payInfo = firstPay.rowIndex ? paymentMatchedInvoicesMap.get(firstPay.rowIndex) : undefined;
        } else {
          const availablePayments = existingPayments.filter((p) => {
            if (!p.rowIndex) return true;
            const pInfo = paymentMatchedInvoicesMap.get(p.rowIndex);
            if (pInfo && pInfo.allTargetKeys.includes(targetKey)) {
              return true;
            }
            if (consumedPaymentRowIndices.has(p.rowIndex)) return false;
            const semKey = `${(p.paymentNumber || '').trim().toLowerCase()}_${p.amountPaid || 0}_${this.normalizeCompanyName(p.payee || '')}_${p.paymentDate || ''}`;
            if (consumedPaymentSemanticKeys.has(semKey)) return false;
            return true;
          });

          const mockOcr: OCRResult = {
            invoiceNumber: exp.invoiceNumber || '',
            invoiceDate: exp.date || '',
            handwrittenOrderNumber: 'ЦЕХ',
            supplierName: exp.supplier,
            buyerName: exp.buyer || '',
            totalAmount: exp.amount,
            currency: 'UAH',
            documentType: 'invoice',
            documentTypeUkrainian: 'Витрати цеху',
            handwrittenConfidence: 'high',
            confidenceScore: 1,
            paymentStatus: exp.paymentStatus || 'Не оплачено',
            expenseCategory: 'OVERHEAD',
            isOverhead: true,
          };

          const match = this.matchInvoiceWithPayments(mockOcr, availablePayments);
          if (match.computedStatus && match.computedStatus !== 'Не оплачено') {
            firstPay = match.matchedPaymentRows[0];
            computedStatus = match.computedStatus;
            matchReason = match.matchReason;
            payInfo = firstPay?.rowIndex ? paymentMatchedInvoicesMap.get(firstPay.rowIndex) : undefined;
          }
        }

        if (firstPay && computedStatus !== 'Не оплачено') {
          if (computedStatus === 'Оплачено' && firstPay.rowIndex) {
            const pInfo = paymentMatchedInvoicesMap.get(firstPay.rowIndex);
            const remainingSiblingsUnpaid = pInfo ? pInfo.unpaidTargetKeys.filter((k) => k !== targetKey) : [];
            if (!pInfo?.isMultiInvoice || remainingSiblingsUnpaid.length === 0) {
              consumedPaymentRowIndices.add(firstPay.rowIndex);
              const semKey = `${(firstPay.paymentNumber || '').trim().toLowerCase()}_${firstPay.amountPaid || 0}_${this.normalizeCompanyName(firstPay.payee || '')}_${firstPay.paymentDate || ''}`;
              consumedPaymentSemanticKeys.add(semKey);
            }
          }

          const allIndices = payInfo?.targets ? payInfo.targets.map((t: ReconcileTarget) => t.rowIndex) : (firstPay.rowIndex ? [exp.rowIndex] : []);
          const unpaidIndices = payInfo?.targets ? payInfo.targets.filter((t: ReconcileTarget) => t.isUnpaid).map((t: ReconcileTarget) => t.rowIndex) : [];
          const multiCount = payInfo?.totalInvoiceCount || (allIndices.length > 1 ? allIndices.length : 1);

          let customMatchReason = matchReason;
          if (payInfo?.isMultiInvoice && firstPay) {
            customMatchReason = `Платіжка №${firstPay.paymentNumber || ''} (рядок ${firstPay.rowIndex}) містить кілька рахунків. За цим рахунком цеху сума: ${this.formatCurrency(exp.amount)}.`;
          }

          results.push({
            invoiceRowIndex: exp.rowIndex,
            invoiceNumber: exp.invoiceNumber || `Рахунок (${exp.supplier})`,
            orderNumber: 'ЦЕХ',
            supplier: exp.supplier,
            invoiceAmount: exp.amount,
            currentStatus: exp.paymentStatus || 'Не оплачено',
            computedStatus,
            paidAmount: computedStatus === 'Оплачено' ? exp.amount : Math.min(firstPay.amountPaid || exp.amount, exp.amount),
            matchedPaymentRowIndex: firstPay.rowIndex,
            matchedPaymentNumber: firstPay.paymentNumber,
            matchedPaymentDate: firstPay.paymentDate,
            matchedPaymentAmount: firstPay.amountPaid,
            matchedPaymentPayee: firstPay.payee,
            matchReason: customMatchReason || `Знайдено платіжку для рахунку цеху на суму ${this.formatCurrency(firstPay.amountPaid || exp.amount)} (вкладка «ЦЕХ»)`,
            isClosedPair: computedStatus === 'Оплачено',
            allMatchedInvoiceRowIndices: allIndices,
            siblingUnpaidInvoiceRowIndices: unpaidIndices.filter((idx: number) => idx !== exp.rowIndex),
            multiInvoiceCount: multiCount,
            targetTab: 'Цех',
            isOverhead: true,
          });
        }
      }
    }

    return results;
  }

  /**
   * Check if a document is already present in Google Sheets:
   * - For Invoices: checks by (InvoiceNumber + Supplier) OR (OrderNumber + InvoiceNumber + Amount)
   * - For Payments: checks by (PaymentNumber + Payee + Amount) OR (PaymentDate + Amount + Payee)
   * - For Overhead ("Цех"): checks in existingOverheadExpenses by (InvoiceNumber + Supplier) OR (Date + Amount + Supplier)
   */
  public static checkExistingDocumentInSheet(
    docOcr: OCRResult,
    existingInvoices: ExistingSheetRow[] = [],
    existingPayments: any[] = [],
    existingOverheadExpenses: OverheadExpenseRow[] = []
  ): {
    alreadyInSheet: boolean;
    rowIndex?: number;
    tabName?: string;
    reason?: string;
    matchedInvoice?: ExistingSheetRow;
    matchedPayment?: any;
    matchedOverhead?: OverheadExpenseRow;
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
            matchedPayment: p,
          };
        }

        // Condition 2: Exact same payment purpose + payee + amount match
        const existPurpose = (p.paymentPurpose || '').trim().toLowerCase();
        const docPurpose = (docOcr.paymentPurpose || '').trim().toLowerCase();
        if (docPurpose && existPurpose && docPurpose === existPurpose && amountMatch) {
          return {
            alreadyInSheet: true,
            rowIndex: p.rowIndex,
            tabName: 'Платіжки',
            reason: `Платіжка з ідентичним призначенням від ${existPayee} на суму ${amount} грн вже є у вкладці "Платіжки" (рядок ${p.rowIndex})`,
            matchedPayment: p,
          };
        }
      }
    } else {
      // Invoices
      if ((docOcr as any)?.replacedRowIndex) {
        const repRowIndex = (docOcr as any).replacedRowIndex;
        const repInv = existingInvoices.find((i) => i.rowIndex === repRowIndex);
        if (repInv) {
          return {
            alreadyInSheet: true,
            rowIndex: repRowIndex,
            tabName: 'Рахунки',
            reason: `Рахунок внесено (заміна рядка ${repRowIndex})`,
            matchedInvoice: repInv,
          };
        }
      }

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
            matchedInvoice: inv,
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
            matchedInvoice: inv,
          };
        }

        // Condition 3: Exact amount + date match + supplier match
        if (amountMatch && dateMatch) {
          return {
            alreadyInSheet: true,
            rowIndex: inv.rowIndex,
            tabName: 'Рахунки',
            reason: `Рахунок від ${existSupplier} на суму ${amount} грн від ${existDate} вже є у вкладці "Рахунки" (рядок ${inv.rowIndex})`,
            matchedInvoice: inv,
          };
        }
      }

      // Check existing overhead expenses ("Цех" tab)
      if (existingOverheadExpenses && existingOverheadExpenses.length > 0) {
        for (const exp of existingOverheadExpenses) {
          const existInvNum = (exp.invoiceNumber || '').trim();
          const cleanExistInvNum = this.normalizeInvoiceNumber(existInvNum);
          const isExistInvPlaceholder = isPlaceholderNumber(cleanExistInvNum);
          const existSupplier = this.normalizeCompanyName(exp.supplier || '');
          const existAmount = exp.amount || 0;
          const existDate = (exp.date || '').trim();

          if (!cleanExistInvNum && !existAmount && !existSupplier) continue;

          const supplierMatch = supplier && existSupplier && this.isCompanyNameMatch(supplier, existSupplier);
          const amountMatch = amount > 0 && existAmount > 0 && Math.abs(amount - existAmount) <= 0.50;
          const dateMatch = Boolean(invDate && existDate && invDate === existDate);

          const validInvNumbersMatch =
            !isCleanInvPlaceholder &&
            !isExistInvPlaceholder &&
            cleanInvNum === cleanExistInvNum;

          if (supplierMatch && validInvNumbersMatch && (amountMatch || amount === 0 || existAmount === 0)) {
            return {
              alreadyInSheet: true,
              rowIndex: exp.rowIndex,
              tabName: 'Цех',
              reason: `Рахунок №${exp.invoiceNumber} від ${existSupplier} на суму ${existAmount || amount} грн вже є у вкладці "Цех" (рядок ${exp.rowIndex})`,
              matchedOverhead: exp,
            };
          }

          if (supplierMatch && amountMatch && dateMatch) {
            return {
              alreadyInSheet: true,
              rowIndex: exp.rowIndex,
              tabName: 'Цех',
              reason: `Рахунок від ${existSupplier} на суму ${amount} грн від ${existDate} вже є у вкладці "Цех" (рядок ${exp.rowIndex})`,
              matchedOverhead: exp,
            };
          }
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
        // Duplicate Case 2: Same supplier + same order number + same valid invoice number + amount match
        else if (supMatch && orderNumMatch && validInvNumbersMatch && amountMatch) {
          isDuplicate = true;
          matchReason = `Однакові постачальник (${b.supplier}), замовлення (${b.orderNumber}), рахунок (№${b.invoiceNumber}) та сума (${this.formatCurrency(bAmount)})`;
        }
        // Duplicate Case 3: Same Drive link or file name with amount match
        else if (
          ((a.driveLink && b.driveLink && a.driveLink === b.driveLink) ||
           (a.fileName && b.fileName && a.fileName === b.fileName)) &&
          amountMatch
        ) {
          isDuplicate = true;
          matchReason = `Однаковий файл або посилання Google Drive (${b.fileName || 'файл'}) та сума (${this.formatCurrency(bAmount)})`;
        }
        // Duplicate Case 4: Completely identical row content
        else if (aSup === bSup && aInv === bInv && aOrd === bOrd && aDate === bDate && Math.abs(aAmount - bAmount) < 0.01) {
          isDuplicate = true;
          matchReason = `Повністю ідентичні дані рядків рахунку`;
        }
        // Duplicate Case 5: Same supplier + same order number + amount match, where one has an invalid/placeholder/OCR error number (e.g. "рахунка" vs "227763")
        else if (supMatch && orderNumMatch && amountMatch && (aIsPlaceholderInv || bIsPlaceholderInv)) {
          isDuplicate = true;
          const validNum = !bIsPlaceholderInv ? (b.invoiceNumber || '').trim() : (a.invoiceNumber || '').trim();
          const wrongNum = aIsPlaceholderInv ? (a.invoiceNumber || '').trim() : (b.invoiceNumber || '').trim();
          matchReason = `Задвоєння рахунку: замовлення ${b.orderNumber}, ${b.supplier}, сума ${this.formatCurrency(bAmount)}. Рядок ${a.rowIndex} містить помилкове розпізнавання ("${wrongNum || 'порожньо'}"), а рядок ${b.rowIndex} має точний номер №${validNum}`;
        }
        // Duplicate Case 6: Same supplier + same order number + amount match + same date
        else if (supMatch && orderNumMatch && amountMatch && dateMatch) {
          isDuplicate = true;
          matchReason = `Задвоєння одного рахунку: однакові постачальник (${b.supplier}), замовлення (${b.orderNumber}), дата (${b.invoiceDate}) та сума (${this.formatCurrency(bAmount)})`;
        }

        if (isDuplicate) {
          alreadyFlagged.add(b.rowIndex);
          const needsMergeFix = aIsPlaceholderInv && !bIsPlaceholderInv && Boolean(b.invoiceNumber);
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
            suggestedAction: needsMergeFix ? 'merge_fix_number' : 'delete',
            suggestedCorrectInvoiceNumber: needsMergeFix ? (b.invoiceNumber || '').trim() : undefined,
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
        // Case 2: Same payee + same non-empty purpose + exact amount
        else if (payeeMatch && aPurpose && bPurpose && aPurpose === bPurpose && exactAmountMatch) {
          isDuplicate = true;
          matchReason = `Однакові отримувач (${b.payee}), призначення платежу та сума (${this.formatCurrency(bAmount)})`;
        }
        // Case 3: Same Drive link or file name with amount match
        else if (
          ((a.driveLink && b.driveLink && a.driveLink === b.driveLink) ||
           (a.fileName && b.fileName && a.fileName === b.fileName)) &&
          amountMatch
        ) {
          isDuplicate = true;
          matchReason = `Однаковий файл або посилання Google Drive (${b.fileName || 'файл'}) та сума (${this.formatCurrency(bAmount)})`;
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

  /**
   * Find all invoices in "Рахунки" that have inflated or duplicate paid amounts (Column J > Column F).
   * As per the business rule: when an invoice is fully paid and status is "Оплачено",
   * the maximum paid amount is strictly capped at the invoice amount (100%).
   * Any amount exceeding the invoice amount represents duplicate/triplicate payment accumulation.
   */
  public static findOverpaidInvoices(
    existingInvoices: ExistingSheetRow[]
  ): Array<{
    rowIndex: number;
    invoiceNumber: string;
    orderNumber: string;
    supplier: string;
    invoiceAmount: number;
    currentPaidAmount: number;
    excessAmount: number;
    correctPaidAmount: number;
    paymentStatus: InvoicePaymentStatus;
    multiplier: number;
  }> {
    const overpaid: Array<{
      rowIndex: number;
      invoiceNumber: string;
      orderNumber: string;
      supplier: string;
      invoiceAmount: number;
      currentPaidAmount: number;
      excessAmount: number;
      correctPaidAmount: number;
      paymentStatus: InvoicePaymentStatus;
      multiplier: number;
    }> = [];

    if (!existingInvoices || existingInvoices.length === 0) return overpaid;

    for (const inv of existingInvoices) {
      if (!inv.rowIndex || (inv.amount || 0) <= 0) continue;
      const invAmount = inv.amount || 0;
      const currentPaid = inv.paidAmount || 0;

      // Detect inflated payments (e.g. 2x, 3x, 4x): paid amount is significantly higher than invoice amount
      if (inv.paymentStatus === 'Оплачено' && currentPaid > invAmount + 0.50) {
        const excess = currentPaid - invAmount;
        const multiplier = Math.round((currentPaid / invAmount) * 10) / 10;
        overpaid.push({
          rowIndex: inv.rowIndex,
          invoiceNumber: inv.invoiceNumber || 'б/н',
          orderNumber: inv.orderNumber || 'б/н',
          supplier: inv.supplier || '—',
          invoiceAmount: invAmount,
          currentPaidAmount: currentPaid,
          excessAmount: excess,
          correctPaidAmount: invAmount,
          paymentStatus: inv.paymentStatus,
          multiplier,
        });
      }
    }

    return overpaid;
  }
}


