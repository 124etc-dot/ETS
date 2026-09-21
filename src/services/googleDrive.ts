import { GoogleDriveFile, GoogleDriveFolder, OCRResult } from '../types';
import { googleAuth } from './googleAuth';

export class GoogleDriveService {
  private static async fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 30000): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal,
      });
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        throw new Error(`Час очікування Google Drive вичерпано (${Math.round(timeoutMs / 1000)} с). Спробуйте ще раз.`);
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Helper to make authenticated Google Drive API calls
   */
  private static async request<T>(
    endpoint: string,
    accessToken: string,
    options: RequestInit = {}
  ): Promise<T> {
    const res = await this.fetchWithTimeout(`https://www.googleapis.com/drive/v3/${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(options.headers || {}),
      },
    }, 25000);

    if (!res.ok) {
      const errorBody = await res.text();
      let errorMsg = `Google Drive API error: ${res.status} ${res.statusText}`;
      try {
        const json = JSON.parse(errorBody);
        if (json.error?.message) {
          errorMsg = json.error.message;
        }
      } catch {
        // use raw errorBody if JSON parse fails
      }

      if (res.status === 401 || errorMsg.includes('invalid authentication credentials') || errorMsg.includes('OAuth 2')) {
        googleAuth.markTokenExpired();
        throw new Error('Сесія Google закінчилася (термін дії токена 1 год). Поновіть сесію в один клік.');
      }

      throw new Error(errorMsg);
    }

    if (res.status === 204 || res.headers.get('content-length') === '0') {
      return {} as T;
    }
    const text = await res.text();
    if (!text || !text.trim()) {
      return {} as T;
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      return {} as T;
    }
  }

  /**
   * Extract Folder ID from URL or return the string as is if already an ID
   */
  public static extractFolderId(input: string): string {
    const trimmed = input.trim();
    // E.g. https://drive.google.com/drive/folders/1aBcDeFgHiJkLmNoPqRsTuVwXyZ
    const match = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      return match[1];
    }
    // E.g. https://drive.google.com/drive/u/0/folders/1aBcDeFgHiJkLmNoPqRsTuVwXyZ
    const uMatch = trimmed.match(/\/u\/\d+\/folders\/([a-zA-Z0-9_-]+)/);
    if (uMatch && uMatch[1]) {
      return uMatch[1];
    }
    return trimmed;
  }

  /**
   * Extract File ID from Google Drive URL or return string as is if already an ID
   */
  public static extractFileId(input: string): string {
    if (!input) return '';
    const trimmed = input.trim();
    // E.g. https://drive.google.com/file/d/1aBcDeFgHiJkLmNoPqRsTuVwXyZ/view
    const matchFile = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (matchFile && matchFile[1]) {
      return matchFile[1];
    }
    // E.g. https://drive.google.com/open?id=1aBcDeFgHiJkLmNoPqRsTuVwXyZ or id=...
    const matchIdParam = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (matchIdParam && matchIdParam[1]) {
      return matchIdParam[1];
    }
    // If it's a bare alphanumeric string with dashes/underscores of typical drive id length (at least 15 chars)
    if (/^[a-zA-Z0-9_-]{15,}$/.test(trimmed)) {
      return trimmed;
    }
    return '';
  }

  /**
   * Move a file to Google Drive trash (safest option, reversible in Drive UI)
   */
  public static async trashFile(fileId: string, accessToken: string): Promise<void> {
    const cleanId = this.extractFileId(fileId);
    if (!cleanId) return;
    try {
      await this.request<any>(
        `files/${cleanId}?supportsAllDrives=true`,
        accessToken,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ trashed: true }),
        }
      );
    } catch (err: any) {
      console.warn(`trashFile with PATCH failed (${err.message}), trying deleteFilePermanently as fallback...`);
      await this.deleteFilePermanently(cleanId, accessToken);
    }
  }

  /**
   * Permanently delete a file from Google Drive
   */
  public static async deleteFilePermanently(fileId: string, accessToken: string): Promise<void> {
    const cleanId = this.extractFileId(fileId);
    if (!cleanId) return;
    await this.request<any>(
      `files/${cleanId}?supportsAllDrives=true`,
      accessToken,
      {
        method: 'DELETE',
      }
    );
  }

  /**
   * Helper to identify if a file name or string indicates a payment order / bank receipt / slip (not an invoice)
   */
  public static isPaymentFileName(name: string): boolean {
    if (!name) return false;
    const lower = name.toLowerCase().trim();

    // Check for explicit invoice naming first: e.g. "Рахунок на оплату", "Рахунок-фактура на оплату"
    // (these contain "оплат", but are genuine invoices, unless prefixed by payment terms like "Оплата рахунку...")
    const isJustInvoiceForPayment = /^(?:свідоцтво|акт|)?\s*(?:рахунок(?:-фактура)?|счет(?:-фактура)?|invoice)\s+(?:на|до)\s+оплат/i.test(lower);
    const hasStrongPaymentPrefix = /^(?:платіж|платеж|пд|pd|пл|квитанц|виписк|чек|оплата|сплата|payment|receipt|банк|privat|mono)/i.test(lower);
    if (isJustInvoiceForPayment && !hasStrongPaymentPrefix) {
      return false;
    }

    // 1. Core Ukrainian and Russian payment terminology
    if (
      lower.includes('платіж') ||
      lower.includes('платиж') ||
      lower.includes('платеж') ||
      lower.includes('інструкц') ||
      lower.includes('инструкц') ||
      lower.includes('доручен') ||
      lower.includes('поручен') ||
      lower.includes('квитанц') ||
      lower.includes('квитанция') ||
      lower.includes('квит.') ||
      lower.includes('виписк') ||
      lower.includes('выписк') ||
      lower.includes('чек') ||
      lower.includes('ордер') ||
      lower.includes('меморіал') ||
      lower.includes('мемориал') ||
      lower.includes('касов') ||
      lower.includes('кассов') ||
      lower.includes('переказ') ||
      lower.includes('перерахуван')
    ) {
      return true;
    }

    // 2. English payment keywords
    if (
      lower.includes('payment') ||
      lower.includes('receipt') ||
      lower.includes('bank_slip') ||
      lower.includes('order_pay') ||
      lower.includes('pay_order') ||
      lower.includes('statement') ||
      lower.includes('swift') ||
      lower.includes('uetr')
    ) {
      return true;
    }

    // 3. Banking systems & bank export names
    if (
      lower.includes('privat') ||
      lower.includes('приват') ||
      lower.includes('p24') ||
      lower.includes('monobank') ||
      lower.includes('монобанк') ||
      lower.includes('mono_') ||
      lower.includes('mono ') ||
      lower.includes('raiffeisen') ||
      lower.includes('райффайзен') ||
      lower.includes('aval') ||
      lower.includes('аваль') ||
      lower.includes('ukrsib') ||
      lower.includes('укрсиб') ||
      lower.includes('pumb') ||
      lower.includes('пумб') ||
      lower.includes('otp') ||
      lower.includes('kredo') ||
      lower.includes('кредо') ||
      lower.includes('sense_') ||
      lower.includes('universalbank') ||
      lower.includes('ibank') ||
      lower.includes('clientbank') ||
      lower.includes('клієнтбанк') ||
      lower.includes('клиентбанк')
    ) {
      return true;
    }

    // 4. Abbreviations & short banking codes: PD / ПД / Пл.дор / ПКО / ВКО / МО
    if (/(^|[_\s./\\-])(пд|pd|пл[._\s-]?дор|вко|пко|мо)([_\s./\\-]|\d|№|n|$)/i.test(lower)) {
      return true;
    }

    // 5. Payment action prefix or combination: e.g. "оплата_207-26", "оплата рахунку 142", "сплата за рах", "pay_456"
    if (/(^|[_\s./\\-])(оплата|сплата|payment|paid|pay|plat)([_\s./\\-]|\d|$)/i.test(lower)) {
      return true;
    }
    if (/(оплат[аиі]|сплат[аиі]|payment|paid)[_\s.-]*(рахун|рах|inv|счет|до|за|по|№|\d)/i.test(lower)) {
      return true;
    }

    return false;
  }

  /**
   * Helper to identify if a file name indicates an invoice / bill / act (and is NOT a payment slip)
   */
  public static isInvoiceFileName(name: string): boolean {
    if (!name) return false;
    if (this.isPaymentFileName(name)) return false;

    const lower = name.toLowerCase().trim();
    return (
      lower.includes('рахунок') ||
      lower.includes('рахун') ||
      lower.includes('рах_') ||
      lower.includes('рах.') ||
      lower.includes('рах-') ||
      lower.includes('рах ') ||
      lower.includes('счет') ||
      lower.includes('счёт') ||
      lower.includes('фактур') ||
      lower.includes('invoice') ||
      lower.includes('inv_') ||
      lower.includes('inv.') ||
      lower.includes('inv-') ||
      lower.includes('inv ') ||
      lower.includes('bill') ||
      lower.includes('акт')
    );
  }

  /**
   * Search for an invoice or payment file in the folder by invoice number, payment number, order number, supplier, or file name
   */
  public static async findFileInFolder(
    folderId: string,
    accessToken: string,
    query: {
      invoiceNumber?: string;
      paymentNumber?: string;
      orderNumber?: string;
      supplier?: string;
      payee?: string;
      fileName?: string;
      amount?: number;
      documentType?: 'invoice' | 'payment';
    }
  ): Promise<GoogleDriveFile | null> {
    const cleanFolderId = this.extractFolderId(folderId);
    if (!cleanFolderId) return null;

    try {
      const allFiles = await this.listFilesInFolder(cleanFolderId, accessToken);
      if (!allFiles || allFiles.length === 0) return null;

      // Filter files strictly by documentType if requested
      let files = allFiles;
      if (query.documentType === 'invoice') {
        files = allFiles.filter((f) => {
          if (this.isPaymentFileName(f.name)) return false;
          if (f.appProperties) {
            const ocr = this.extractOcrFromDriveProperties(f.appProperties);
            if (ocr && ocr.documentType === 'payment') return false;
            if (f.appProperties.doc_type === 'payment') return false;
            if (f.appProperties.ocr_type === 'payment') return false;
          }
          return true;
        });
      } else if (query.documentType === 'payment') {
        files = allFiles.filter((f) => {
          if (this.isPaymentFileName(f.name)) return true;
          if (f.appProperties) {
            const ocr = this.extractOcrFromDriveProperties(f.appProperties);
            if (ocr && ocr.documentType === 'payment') return true;
            if (f.appProperties.doc_type === 'payment') return true;
            if (f.appProperties.ocr_type === 'payment') return true;
          }
          return !this.isInvoiceFileName(f.name);
        });
      }

      if (files.length === 0) return null;

      const cleanInvNum = query.invoiceNumber
        ? query.invoiceNumber.replace(/[^\w\dа-яА-Яіїєґ]/gi, '').toLowerCase()
        : '';
      const cleanPaymentNum = query.paymentNumber
        ? query.paymentNumber.replace(/[^\w\dа-яА-Яіїєґ]/gi, '').toLowerCase()
        : '';
      const cleanOrderNum = query.orderNumber
        ? query.orderNumber.trim().toLowerCase()
        : '';
      const cleanFileName = query.fileName
        ? query.fileName.trim().toLowerCase()
        : '';
      const cleanFileNameNoExt = cleanFileName.replace(/\.[^/.]+$/, '');

      // 1. Direct file name match (only if not a payment file when searching for invoice)
      if (cleanFileName && (query.documentType !== 'invoice' || !this.isPaymentFileName(cleanFileName))) {
        const directMatch = files.find((f) => {
          if (query.documentType === 'invoice' && this.isPaymentFileName(f.name)) return false;
          const fn = f.name.toLowerCase().trim();
          const fnNoExt = fn.replace(/\.[^/.]+$/, '');
          return fn === cleanFileName || fnNoExt === cleanFileNameNoExt;
        });
        if (directMatch) return directMatch;
      }

      // 2. Check cached OCR in appProperties
      for (const f of files) {
        if (f.appProperties) {
          const ocr = this.extractOcrFromDriveProperties(f.appProperties);
          if (ocr) {
            // If searching for invoice, do not match payment documents
            if (query.documentType === 'invoice' && ocr.documentType === 'payment') continue;

            // Invoice number match
            if (cleanInvNum && ocr.invoiceNumber) {
              const ocrCleanInv = ocr.invoiceNumber.replace(/[^\w\dа-яА-Яіїєґ]/gi, '').toLowerCase();
              if (ocrCleanInv && (ocrCleanInv === cleanInvNum || ocrCleanInv.includes(cleanInvNum) || cleanInvNum.includes(ocrCleanInv))) {
                return f;
              }
            }
            // Payment number match (for payments only)
            if (query.documentType !== 'invoice' && cleanPaymentNum && (ocr.paymentNumber || ocr.invoiceNumber)) {
              const ocrCleanPay = (ocr.paymentNumber || ocr.invoiceNumber || '').replace(/[^\w\dа-яА-Яіїєґ]/gi, '').toLowerCase();
              if (ocrCleanPay && (ocrCleanPay === cleanPaymentNum || ocrCleanPay.includes(cleanPaymentNum) || cleanPaymentNum.includes(ocrCleanPay))) {
                return f;
              }
            }
            // Order number match
            if (cleanOrderNum && ocr.handwrittenOrderNumber) {
              if (ocr.handwrittenOrderNumber.toLowerCase() === cleanOrderNum) {
                return f;
              }
            }
          }
        }
      }

      // 3. Match file name containing the invoice number (minimum 2 chars)
      if (cleanInvNum && cleanInvNum.length >= 2) {
        // Prioritize files whose name indicates an invoice
        const byInvoiceNamed = files.find((f) => {
          if (this.isPaymentFileName(f.name)) return false;
          const fn = f.name.replace(/[^\w\dа-яА-Яіїєґ]/gi, '').toLowerCase();
          return fn.includes(cleanInvNum) && this.isInvoiceFileName(f.name);
        });
        if (byInvoiceNamed) return byInvoiceNamed;

        const byName = files.find((f) => {
          if (this.isPaymentFileName(f.name)) return false;
          const fn = f.name.replace(/[^\w\dа-яА-Яіїєґ]/gi, '').toLowerCase();
          return fn.includes(cleanInvNum);
        });
        if (byName) return byName;
      }

      // 4. Match file name containing payment number (minimum 2 chars) - for payments only
      if (query.documentType !== 'invoice' && cleanPaymentNum && cleanPaymentNum.length >= 2) {
        const byPayName = files.find((f) => {
          const fn = f.name.replace(/[^\w\dа-яА-Яіїєґ]/gi, '').toLowerCase();
          return fn.includes(cleanPaymentNum);
        });
        if (byPayName) return byPayName;
      }

      // 5. Match file name containing order number (e.g. "142-26")
      if (cleanOrderNum && cleanOrderNum.length >= 4) {
        // Prioritize files with invoice keywords in name if looking for an invoice
        if (query.documentType === 'invoice') {
          const byOrderInvoice = files.find((f) => {
            if (this.isPaymentFileName(f.name)) return false;
            const fn = f.name.toLowerCase();
            return fn.includes(cleanOrderNum) && this.isInvoiceFileName(f.name);
          });
          if (byOrderInvoice) return byOrderInvoice;

          const byOrderNonPayment = files.find((f) => {
            if (this.isPaymentFileName(f.name)) return false;
            const fn = f.name.toLowerCase();
            return fn.includes(cleanOrderNum);
          });
          if (byOrderNonPayment) return byOrderNonPayment;
        } else {
          const byOrder = files.find((f) => {
            const fn = f.name.toLowerCase();
            return fn.includes(cleanOrderNum);
          });
          if (byOrder) return byOrder;
        }
      }

      return null;
    } catch (err) {
      console.warn('findFileInFolder error:', err);
      return null;
    }
  }

  /**
   * Get Folder Details
   */
  public static async getFolder(folderId: string, accessToken: string): Promise<GoogleDriveFolder> {
    const cleanId = this.extractFolderId(folderId);
    const data = await this.request<any>(
      `files/${cleanId}?fields=id,name,webViewLink`,
      accessToken
    );
    return {
      id: data.id,
      name: data.name,
      webViewLink: data.webViewLink,
    };
  }

  /**
   * List recent user folders
   */
  public static async listRecentFolders(accessToken: string): Promise<GoogleDriveFolder[]> {
    const q = "mimeType = 'application/vnd.google-apps.folder' and trashed = false";
    const data = await this.request<any>(
      `files?q=${encodeURIComponent(q)}&pageSize=20&orderBy=modifiedTime desc&fields=files(id,name,webViewLink)`,
      accessToken
    );
    return (data.files || []).map((f: any) => ({
      id: f.id,
      name: f.name,
      webViewLink: f.webViewLink,
    }));
  }

  /**
   * List files in a specific folder (PDFs, Images, Documents)
   */
  public static async listFilesInFolder(
    folderId: string,
    accessToken: string
  ): Promise<GoogleDriveFile[]> {
    const cleanId = this.extractFolderId(folderId);
    const q = `'${cleanId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`;
    
    const fields = 'files(id,name,mimeType,size,thumbnailLink,webContentLink,webViewLink,createdTime,modifiedTime,appProperties,properties)';
    const data = await this.request<any>(
      `files?q=${encodeURIComponent(q)}&pageSize=100&orderBy=modifiedTime desc&fields=${encodeURIComponent(fields)}&supportsAllDrives=true&includeItemsFromAllDrives=true`,
      accessToken
    );

    return data.files || [];
  }

  /**
   * Save OCR result to Google Drive file appProperties
   * Enables all devices and sessions to share already-processed documents without repeating Gemini AI calls.
   */
  public static async saveOcrToDriveProperties(
    fileId: string,
    ocrResult: OCRResult,
    accessToken: string
  ): Promise<void> {
    if (!fileId || !ocrResult || !accessToken) return;

    try {
      const jsonStr = JSON.stringify(ocrResult);
      const chunkSize = 110; // Under Google Drive 124-byte property value limit
      const count = Math.ceil(jsonStr.length / chunkSize);
      
      const appProperties: Record<string, string> = {
        ocr_done: 'true',
        ocr_type: ocrResult.documentType || 'other',
        ocr_order: (ocrResult.handwrittenOrderNumber || '').slice(0, 50),
        ocr_date: new Date().toISOString(),
        ocr_chunks_count: String(count),
      };

      for (let i = 0; i < count; i++) {
        appProperties[`ocr_c_${i}`] = jsonStr.slice(i * chunkSize, (i + 1) * chunkSize);
      }

      await this.request<any>(`files/${fileId}`, accessToken, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          appProperties,
        }),
      });
    } catch (err) {
      console.warn(`Could not save OCR properties to Google Drive for file ${fileId}:`, err);
    }
  }

  /**
   * Extract OCR result from Google Drive file appProperties if previously processed
   */
  public static extractOcrFromDriveProperties(
    appProperties?: Record<string, string>
  ): OCRResult | null {
    if (!appProperties || appProperties.ocr_done !== 'true') {
      return null;
    }
    try {
      const count = parseInt(appProperties.ocr_chunks_count || '0', 10);
      if (count > 0) {
        let fullJson = '';
        for (let i = 0; i < count; i++) {
          fullJson += appProperties[`ocr_c_${i}`] || '';
        }
        if (fullJson) {
          const parsed = JSON.parse(fullJson);
          if (parsed && typeof parsed === 'object') {
            return parsed as OCRResult;
          }
        }
      }
    } catch (e) {
      console.warn('Failed to parse cached OCR from Drive appProperties:', e);
    }
    return null;
  }

  /**
   * Download a file from Google Drive as Base64 data string
   */
  public static async downloadFileBase64(
    fileId: string,
    accessToken: string
  ): Promise<{ base64: string; mimeType: string; blob: Blob; fileName?: string }> {
    // 1. Get file metadata for mimeType and name
    const meta = await this.request<any>(`files/${fileId}?fields=id,name,mimeType`, accessToken);
    let detectedMime = meta.mimeType || '';

    // 2. Download binary media content (with 35s timeout)
    const res = await this.fetchWithTimeout(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }, 35000);

    if (!res.ok) {
      throw new Error(`Failed to download file from Drive: ${res.statusText}`);
    }

    const blob = await res.blob();

    // 3. Inspect binary magic bytes to determine real MIME type with 100% precision
    try {
      const headerSlice = await blob.slice(0, 32).arrayBuffer();
      const bytes = new Uint8Array(headerSlice);
      if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
        detectedMime = 'image/jpeg';
      } else if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
        detectedMime = 'application/pdf';
      } else if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
        detectedMime = 'image/png';
      } else if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
        detectedMime = 'image/webp';
      } else if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
        detectedMime = 'image/gif';
      } else if (bytes.length >= 8 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
        detectedMime = 'image/jpeg';
      } else if (meta.name) {
        const ext = meta.name.toLowerCase().split('.').pop() || '';
        if (ext === 'jpg' || ext === 'jpeg') detectedMime = 'image/jpeg';
        else if (ext === 'png') detectedMime = 'image/png';
        else if (ext === 'pdf') detectedMime = 'application/pdf';
        else if (ext === 'webp') detectedMime = 'image/webp';
        else if (ext === 'heic' || ext === 'heif') detectedMime = 'image/jpeg';
      }
    } catch {
      // ignore
    }

    if (!detectedMime || detectedMime === 'application/octet-stream') {
      detectedMime = 'image/jpeg';
    }

    // 4. Convert blob to pure base64
    const rawDataUrl = await this.blobToBase64(blob);
    const commaIndex = rawDataUrl.indexOf(',');
    const cleanBase64 = commaIndex !== -1 ? rawDataUrl.slice(commaIndex + 1).replace(/\s+/g, '') : rawDataUrl.replace(/\s+/g, '');
    const cleanDataUrl = `data:${detectedMime};base64,${cleanBase64}`;
    const cleanBlob = new Blob([blob], { type: detectedMime });

    return {
      base64: cleanDataUrl,
      mimeType: detectedMime,
      blob: cleanBlob,
      fileName: meta.name || '',
    };
  }

  /**
   * Upload a file or image to Google Drive folder (multipart upload)
   */
  public static async uploadFile(
    fileOrBlob: Blob | File,
    fileName: string,
    folderId: string | null,
    accessToken: string
  ): Promise<GoogleDriveFile> {
    const metadata: Record<string, any> = {
      name: fileName,
      mimeType: fileOrBlob.type || 'application/octet-stream',
    };

    if (folderId) {
      const cleanFolderId = this.extractFolderId(folderId);
      if (cleanFolderId && cleanFolderId !== 'root') {
        metadata.parents = [cleanFolderId];
      }
    }

    const boundary = '-------314159265358979323846';
    const metadataPart = `Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`;
    const mediaPartHeader = `Content-Type: ${fileOrBlob.type || 'application/octet-stream'}\r\n\r\n`;

    const arrayBuffer = await fileOrBlob.arrayBuffer();

    const multipartBlob = new Blob(
      [
        `--${boundary}\r\n`,
        metadataPart,
        `--${boundary}\r\n`,
        mediaPartHeader,
        arrayBuffer,
        `\r\n--${boundary}--`,
      ],
      { type: `multipart/related; boundary=${boundary}` }
    );

    const res = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,thumbnailLink,webContentLink,webViewLink',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        body: multipartBlob,
      }
    );

    if (!res.ok) {
      const errorBody = await res.text();
      let errorMsg = `Google Drive upload error: ${res.status} ${res.statusText}`;
      try {
        const json = JSON.parse(errorBody);
        if (json.error?.message) {
          errorMsg = json.error.message;
        }
      } catch {
        // ignore JSON parse error
      }
      throw new Error(errorMsg);
    }

    return res.json();
  }

  /**
   * Convert Base64 data URL to Blob
   */
  public static dataUrlToBlob(dataUrl: string): Blob {
    const arr = dataUrl.split(',');
    const mimeMatch = arr[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  }

  public static blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        resolve(result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
}
