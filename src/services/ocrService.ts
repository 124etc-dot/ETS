import { OCRResult, InvoicePaymentStatus, ExistingSheetRow, ExistingPaymentRow, ProcessedDocument } from '../types';

export class OCRService {
  /**
   * Send file data to backend OCR processing endpoint
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
    const res = await fetch('/api/ocr/process', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      let errorMsg = `Server error ${res.status}: ${res.statusText}`;
      try {
        const json = await res.json();
        if (json.error) {
          errorMsg = json.error;
        }
      } catch {
        // use fallback
      }
      throw new Error(errorMsg);
    }

    const data = await res.json();
    if (!data.success || !data.data) {
      throw new Error(data.error || 'Failed to parse OCR response from server.');
    }

    return data.data as OCRResult;
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

  /**
   * Clean and normalize company name strictly to format: "ТОВ НАЗВА КОМПАНІЇ"
   * - ALL UPPERCASE letters
   * - NO quotation marks (", ', «, », “, ”, „)
   * - Unified legal form prefix (ТОВ, ФОП, ПП, ТДВ, ПРАТ, ПАТ, АТ, ДП)
   */
  public static normalizeCompanyName(input: string): string {
    if (!input) return '';
    let val = String(input).trim();

    // 1. Remove all types of quotes
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

    // 3. Remove punctuation like trailing/leading commas or dots around legal forms
    val = val.replace(/^(ТОВ|ФОП|ПП|ТДВ|ПРАТ|ПАТ|АТ|ДП)[.,\s]+/i, '$1 ');
    val = val.replace(/,\s*(ТОВ|ФОП|ПП|ТДВ|ПРАТ|ПАТ|АТ|ДП)$/i, ' $1');

    // 4. If legal form is at the end (e.g. "ЛЕГНОПРОМ ТОВ" or "ЕПІЦЕНТР К ТОВ"), move it to front
    const trailingFormMatch = val.match(/^(.+?)\s+(ТОВ|ФОП|ПП|ТДВ|ПРАТ|ПАТ|АТ|ДП)$/i);
    if (trailingFormMatch) {
      val = `${trailingFormMatch[2]} ${trailingFormMatch[1]}`;
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
      const generalInvRegex = /(?:рахунк(?:и|ів|ами|ах|у|ом|ок)?|рах(?:унок|\.?)|СФ|СФ-|сч(?:ет|\.?)|інвойс(?:и|ів)?|№)\s*[:№#]?\s*([A-Za-zА-Яа-яІіЇїЄє0-9\-\/_]+(?:\s*(?:,|і|та|також|;|\/)\s*(?:№|No|#)?\s*[A-Za-zА-Яа-яІіЇїЄє0-9\-\/_]+)*)/gi;
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
      const matchByInvoiceNum =
        !isInvNumActuallyDate &&
        ((cleanInvNum &&
          cleanRefNumbers.some(
            (crn) => crn === cleanInvNum || cleanInvNum.includes(crn) || crn.includes(cleanInvNum)
          )) ||
          (cleanInvNum && purpose.includes(cleanInvNum)) ||
          (rawInvNum && purpose.includes(rawInvNum.toLowerCase())));

      // Criterion B: Match by Order Number
      const matchByOrderNum = cleanOrderNum && (
        cleanOrderNum === refOrder ||
        purpose.includes(cleanOrderNum) ||
        (refOrder && cleanOrderNum.includes(refOrder))
      );

      // Criterion C: Match by Supplier / Payee + exact Amount (if only 1 invoice or exact match)
      const matchBySupplierAndAmount =
        paymentAmount > 0 &&
        invAmount > 0 &&
        Math.abs(paymentAmount - invAmount) <= 0.50 &&
        payeeName &&
        invSupplier &&
        (payeeName.includes(invSupplier) || invSupplier.includes(payeeName) || purpose.includes(invSupplier.toLowerCase()));

      if (matchByInvoiceNum || matchByOrderNum || matchBySupplierAndAmount) {
        let reason = '';
        if (matchByInvoiceNum) {
          reason = `Співпадіння за номером рахунку "${inv.invoiceNumber}"`;
        } else if (matchByOrderNum) {
          reason = `Співпадіння за номером замовлення "${inv.orderNumber}"`;
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
        const isDatePattern = (s: string) => /^\d{4}[-./]\d{2}[-./]\d{2}$/.test(s.trim()) || /^\d{2}[-./]\d{2}[-./]\d{4}$/.test(s.trim());
        if ((!existingSheetMatch.invoiceNumber || isDatePattern(existingSheetMatch.invoiceNumber)) && ocr.invoiceNumber) {
          existingSheetMatch.invoiceNumber = ocr.invoiceNumber;
        }
        if (!existingSheetMatch.orderNumber && ocr.handwrittenOrderNumber) {
          existingSheetMatch.orderNumber = ocr.handwrittenOrderNumber;
        }
        continue;
      }

      const matchByInvoiceNum =
        cleanInvNum &&
        cleanRefNumbers.some(
          (crn) => crn === cleanInvNum || cleanInvNum.includes(crn) || crn.includes(cleanInvNum)
        ) ||
        (cleanInvNum && purpose.includes(cleanInvNum)) ||
        (rawInvNum && purpose.includes(rawInvNum.toLowerCase()));

      const matchByOrderNum = cleanOrderNum && (
        cleanOrderNum === refOrder ||
        purpose.includes(cleanOrderNum) ||
        (refOrder && cleanOrderNum.includes(refOrder))
      );

      const matchBySupplierAndAmount =
        paymentAmount > 0 &&
        invAmount > 0 &&
        Math.abs(paymentAmount - invAmount) <= 0.50 &&
        payeeName &&
        invSupplier &&
        (payeeName.includes(invSupplier) || invSupplier.includes(payeeName) || purpose.includes(invSupplier.toLowerCase()));

      if (matchByInvoiceNum || matchByOrderNum || matchBySupplierAndAmount) {
        let reason = '';
        if (matchByInvoiceNum) {
          reason = `Співпадіння за локальним рахунком "${ocr.invoiceNumber}"`;
        } else if (matchByOrderNum) {
          reason = `Співпадіння за номером замовлення "${ocr.handwrittenOrderNumber}"`;
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
      const cleanPurpose = this.normalizeInvoiceNumber(purpose);
      const payee = this.normalizeCompanyName(p.payee || '');
      const pAmount = p.amountPaid || 0;

      // Condition A: Referenced invoice number or payment purpose matches invoice number
      const matchByInvoiceNum =
        !isInvNumActuallyDate &&
        cleanInvNum &&
        ((refInv && (refInv === cleanInvNum || refInv.includes(cleanInvNum) || cleanInvNum.includes(refInv))) ||
          (rawInvNum.length >= 3 && purpose.includes(rawInvNum.toLowerCase())) ||
          (cleanInvNum.length >= 3 && cleanPurpose.includes(cleanInvNum)));

      // Condition B: Order number matches
      const matchByOrderNum =
        cleanOrderNum &&
        ((refOrd && (refOrd === cleanOrderNum || refOrd.includes(cleanOrderNum) || cleanOrderNum.includes(refOrd))) ||
          purpose.includes(cleanOrderNum));

      // Condition C: Same Payee and same Amount
      const matchByPayeeAndAmount =
        supplier &&
        payee &&
        (supplier.includes(payee) || payee.includes(supplier)) &&
        invAmount > 0 &&
        Math.abs(invAmount - pAmount) <= 0.50;

      if (matchByInvoiceNum || matchByOrderNum || matchByPayeeAndAmount) {
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
      const cleanPurpose = this.normalizeInvoiceNumber(purpose);
      const payee = this.normalizeCompanyName(ocr.payeeName || ocr.supplierName || '');
      const pAmount = ocr.amountPaid || ocr.totalAmount || 0;

      const matchByInvoiceNum =
        !isInvNumActuallyDate &&
        cleanInvNum &&
        ((refInv && (refInv === cleanInvNum || refInv.includes(cleanInvNum) || cleanInvNum.includes(refInv))) ||
          (rawInvNum.length >= 3 && purpose.includes(rawInvNum.toLowerCase())) ||
          (cleanInvNum.length >= 3 && cleanPurpose.includes(cleanInvNum)));

      const matchByOrderNum =
        cleanOrderNum &&
        ((refOrd && (refOrd === cleanOrderNum || refOrd.includes(cleanOrderNum) || cleanOrderNum.includes(refOrd))) ||
          purpose.includes(cleanOrderNum));

      const matchByPayeeAndAmount =
        supplier &&
        payee &&
        (supplier.includes(payee) || payee.includes(supplier)) &&
        invAmount > 0 &&
        Math.abs(invAmount - pAmount) <= 0.50;

      if (matchByInvoiceNum || matchByOrderNum || matchByPayeeAndAmount) {
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
    const reason = `Знайдено платіжку №${first.paymentNumber || ''} на суму ${this.formatCurrency(totalPaid)} (${locationStr})`;

    return {
      matchedPaymentNumbers: payNumbers,
      totalPaidAmount: totalPaid,
      computedStatus,
      matchedPaymentRows: matchedPayments,
      matchReason: reason,
    };
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
    const isPayment = docOcr.documentType === 'payment';

    if (isPayment) {
      const payNum = (docOcr.paymentNumber || docOcr.invoiceNumber || '').trim().toLowerCase();
      const cleanPayNum = this.normalizeInvoiceNumber(payNum);
      const payDate = docOcr.paymentDate || docOcr.invoiceDate || '';
      const payee = this.normalizeCompanyName(docOcr.payeeName || docOcr.supplierName || '');
      const amount = docOcr.amountPaid || docOcr.totalAmount || 0;

      for (const p of existingPayments) {
        const existPayNum = (p.paymentNumber || '').trim().toLowerCase();
        const cleanExistPayNum = this.normalizeInvoiceNumber(existPayNum);
        const existDate = p.paymentDate || '';
        const existPayee = this.normalizeCompanyName(p.payee || '');
        const existAmount = p.amountPaid || 0;

        const numMatch = cleanPayNum && cleanExistPayNum && cleanPayNum === cleanExistPayNum;
        const amountMatch = amount > 0 && Math.abs(amount - existAmount) <= 0.05;
        const payeeMatch = payee && existPayee && (payee.includes(existPayee) || existPayee.includes(payee));
        const dateMatch = payDate && existDate && payDate === existDate;

        // Condition 1: Exact payment number match + supplier/amount
        if (numMatch && (payeeMatch || amountMatch)) {
          return {
            alreadyInSheet: true,
            rowIndex: p.rowIndex,
            tabName: 'Платіжки',
            reason: `Платіжка №${p.paymentNumber} вже є у вкладці "Платіжки" (рядок ${p.rowIndex})`,
          };
        }

        // Condition 2: Date + exact amount + payee
        if (dateMatch && amountMatch && payeeMatch) {
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
      const rawOrderNum = (docOcr.handwrittenOrderNumber || '').trim();
      const cleanOrderNum = this.normalizeOrderNumber(rawOrderNum).toLowerCase();
      const supplier = this.normalizeCompanyName(docOcr.supplierName || '');
      const amount = docOcr.totalAmount || 0;

      for (const inv of existingInvoices) {
        const existInvNum = (inv.invoiceNumber || '').trim();
        const cleanExistInvNum = this.normalizeInvoiceNumber(existInvNum);
        const existOrderNum = this.normalizeOrderNumber(inv.orderNumber || '').toLowerCase();
        const existSupplier = this.normalizeCompanyName(inv.supplier || '');
        const existAmount = inv.amount || 0;

        const invNumMatch = cleanInvNum && cleanExistInvNum && cleanInvNum === cleanExistInvNum;
        const orderNumMatch = cleanOrderNum && existOrderNum && cleanOrderNum === existOrderNum;
        const supplierMatch = supplier && existSupplier && (supplier.includes(existSupplier) || existSupplier.includes(supplier));
        const amountMatch = amount > 0 && Math.abs(amount - existAmount) <= 0.05;

        // Condition 1: Exact invoice number + supplier match
        if (invNumMatch && supplierMatch) {
          return {
            alreadyInSheet: true,
            rowIndex: inv.rowIndex,
            tabName: 'Рахунки',
            reason: `Рахунок №${inv.invoiceNumber} від ${existSupplier} вже внесено у вкладку "Рахунки" (рядок ${inv.rowIndex})`,
          };
        }

        // Condition 2: Order number + invoice number match
        if (orderNumMatch && invNumMatch) {
          return {
            alreadyInSheet: true,
            rowIndex: inv.rowIndex,
            tabName: 'Рахунки',
            reason: `Рахунок №${inv.invoiceNumber} за замовленням ${inv.orderNumber} вже є у вкладці "Рахунки" (рядок ${inv.rowIndex})`,
          };
        }

        // Condition 3: Exact invoice number + exact amount
        if (invNumMatch && amountMatch) {
          return {
            alreadyInSheet: true,
            rowIndex: inv.rowIndex,
            tabName: 'Рахунки',
            reason: `Рахунок №${inv.invoiceNumber} на суму ${amount} грн вже є у вкладці "Рахунки" (рядок ${inv.rowIndex})`,
          };
        }
      }
    }

    return {
      alreadyInSheet: false,
    };
  }
}


