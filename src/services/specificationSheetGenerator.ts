import {
  CalculationProject,
  ConstructiveItem,
  MATERIAL_CATEGORIES,
} from '../types/calculator';
import { ProjectSheetRow, SheetConfig } from '../types';
import { GoogleSheetsService, DEFAULT_PROJECTS_SPREADSHEET_ID } from './googleSheets';
import { GoogleDriveService } from './googleDrive';
import { generateWeekOptions } from '../utils/weekUtils';

export interface GenerationResult {
  spreadsheetId: string;
  spreadsheetUrl: string;
  driveFolderId?: string;
  driveFolderName?: string;
  cashFlowUpdated: boolean;
  targetProjectRow?: number;
}

export class SpecificationSheetGenerator {
  /**
   * Helper to perform authenticated Sheets API requests
   */
  private static async sheetsRequest<T>(
    endpoint: string,
    accessToken: string,
    options: RequestInit = {}
  ): Promise<T> {
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });

    if (!res.ok) {
      const errText = await res.text();
      let msg = `Google Sheets API Error ${res.status}: ${res.statusText}`;
      try {
        const json = JSON.parse(errText);
        if (json.error?.message) msg = json.error.message;
      } catch {}
      throw new Error(msg);
    }

    return res.json();
  }

  /**
   * Helper to find or create a project folder in Google Drive
   */
  public static async getOrCreateProjectFolder(
    accessToken: string,
    parentFolderId: string,
    projectNumber: string,
    projectName: string
  ): Promise<{ folderId: string; folderName: string }> {
    const folderName = `[${projectNumber}] ${projectName}`.trim();
    const cleanParentId = (parentFolderId || '').trim();

    try {
      // 1. Search if folder already exists in Drive
      let q = `mimeType = 'application/vnd.google-apps.folder' and trashed = false and name contains '${projectNumber}'`;
      if (cleanParentId && cleanParentId !== 'root') {
        q += ` and '${cleanParentId}' in parents`;
      }

      const searchRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=5`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );

      if (searchRes.ok) {
        const data = await searchRes.json();
        if (data.files && data.files.length > 0) {
          return { folderId: data.files[0].id, folderName: data.files[0].name };
        }
      }

      // 2. Create new folder in parent folder
      const createRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?fields=id,name`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: cleanParentId && cleanParentId !== 'root' ? [cleanParentId] : undefined,
          }),
        }
      );

      if (createRes.ok) {
        const created = await createRes.json();
        return { folderId: created.id, folderName: created.name };
      }
    } catch (e) {
      console.warn('Could not create or find Drive folder, will use default parent folder', e);
    }

    return { folderId: cleanParentId || 'root', folderName: 'Google Drive' };
  }

  /**
   * Move created spreadsheet into target folder in Google Drive
   */
  public static async moveFileToFolder(
    fileId: string,
    targetFolderId: string,
    accessToken: string
  ): Promise<void> {
    if (!targetFolderId || targetFolderId === 'root') return;
    try {
      // Get current parents
      const metaRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?fields=parents`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      let previousParents = '';
      if (metaRes.ok) {
        const meta = await metaRes.json();
        if (meta.parents && meta.parents.length > 0) {
          previousParents = meta.parents.join(',');
        }
      }

      let patchUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?addParents=${targetFolderId}`;
      if (previousParents) {
        patchUrl += `&removeParents=${previousParents}`;
      }

      await fetch(patchUrl, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch (e) {
      console.warn('Failed to move file to target folder:', e);
    }
  }

  /**
   * Generates the complete Google Spreadsheet with two tabs:
   * 1. «Внутрішня специфікація»
   * 2. «Кошторис для клієнта»
   */
  public static async generateSpecificationSheet(
    project: CalculationProject,
    accessToken: string,
    options?: {
      targetFolderId?: string;
      createProjectFolder?: boolean;
    }
  ): Promise<GenerationResult> {
    const spreadsheetTitle = `[${project.projectNumber}] Специфікація та кошторис - ${project.projectName}`;

    // 1. Create spreadsheet with 2 sheets
    const createPayload = {
      properties: {
        title: spreadsheetTitle,
        locale: 'uk_UA',
        autoRecalc: 'ON_CHANGE',
      },
      sheets: [
        {
          properties: {
            sheetId: 0,
            title: 'Специфікація цеху',
            gridProperties: {
              rowCount: Math.max(80, project.items.length + 40),
              columnCount: 14,
              frozenRowCount: 7,
            },
          },
        },
        {
          properties: {
            sheetId: 1,
            title: 'Кошторис клієнта',
            gridProperties: {
              rowCount: Math.max(60, project.items.length + 30),
              columnCount: 8,
              frozenRowCount: 6,
            },
          },
        },
      ],
    };

    const createdSheet = await this.sheetsRequest<{
      spreadsheetId: string;
      spreadsheetUrl: string;
    }>('', accessToken, {
      method: 'POST',
      body: JSON.stringify(createPayload),
    });

    const spreadsheetId = createdSheet.spreadsheetId;
    const spreadsheetUrl = createdSheet.spreadsheetUrl;

    // 2. Folder management in Google Drive
    let finalFolderId = options?.targetFolderId;
    let finalFolderName: string | undefined;

    if (accessToken && options?.createProjectFolder && options?.targetFolderId) {
      try {
        const folderInfo = await this.getOrCreateProjectFolder(
          accessToken,
          options.targetFolderId,
          project.projectNumber,
          project.projectName
        );
        finalFolderId = folderInfo.folderId;
        finalFolderName = folderInfo.folderName;
        await this.moveFileToFolder(spreadsheetId, finalFolderId, accessToken);
      } catch (e) {
        console.warn('Folder placement failed, spreadsheet remains in root:', e);
      }
    } else if (accessToken && options?.targetFolderId) {
      await this.moveFileToFolder(spreadsheetId, options.targetFolderId, accessToken);
    }

    // 3. Prepare data for Tab 1: «Внутрішня специфікація»
    const internalValues: any[][] = [];

    // Header block
    internalValues.push(['ETS PROJECTS', '', '', '', '', '', '', '', '', '', '', '', '', '']);
    internalValues.push([
      'СПЕЦИФІКАЦІЯ ЦЕХУ ТА РОЗРАХУНОК СОБІВАРТОСТІ',
      '', '', '', '', '', '', '', '', '', '', '', '', ''
    ]);
    internalValues.push([
      `Проєкт №: ${project.projectNumber}`,
      `Назва: ${project.projectName}`,
      `Замовник: ${project.client}`,
      `Менеджер: ${project.manager}`,
      `Дата: ${project.date}`,
      '', '', '', '', '', '', '', '', ''
    ]);
    internalValues.push(['']);

    // Applied coefficients block
    internalValues.push([
      'ЗАСТОСОВАНІ КОЕФІЦІЄНТИ ТА СТАВКИ:',
      '',
      `Коеф. складності: ${project.coefficients.complexityMultiplier}x`,
      `Планова маржинальність: ${project.coefficients.marginPercent}%`,
      `Накладні цеху: ${project.coefficients.overheadPercent}%`,
      `Ставка ПДВ: ${project.coefficients.vatRatePercent}%`,
      '', '', '', '', '', '', '', ''
    ]);
    internalValues.push(['']);

    // Table Column Headers (Row 7 in 1-based index)
    internalValues.push([
      '№',
      'Конструктивний вузол / Елемент',
      'Матеріал / Найменування',
      'Категорія',
      'К-сть (креслення)',
      'Од. вим.',
      'Коеф. відходу',
      'К-сть з відходом',
      'Базова ціна (грн)',
      'Вартість матеріалу (грн)',
      'Коеф. складності',
      'Виробнича собівартість (грн)',
      'Ціна для клієнта (грн)',
      'Примітки'
    ]);

    // Constructive item rows
    project.items.forEach((item, index) => {
      const catLabel = MATERIAL_CATEGORIES[item.category]?.name || item.category;
      internalValues.push([
        index + 1,
        item.constructive,
        item.materialName,
        catLabel,
        item.quantity,
        item.unit,
        item.wasteFactor,
        item.effectiveQuantity,
        item.basePrice,
        item.materialCost,
        item.complexityFactor,
        item.totalCost,
        item.clientPrice,
        item.notes || ''
      ]);
    });

    // Summary block rows
    internalValues.push(['']);
    internalValues.push([
      '', '', '', '', '', '', '', '', 'ПІДСУМКОВИЙ ФІНАНСОВИЙ РОЗРАХУНОК:', '', '', '', '', ''
    ]);
    internalValues.push([
      '', '', '', '', '', '', '', '',
      'Чиста вартість матеріалів:',
      project.summary.rawMaterialCost,
      '', '', '', ''
    ]);
    internalValues.push([
      '', '', '', '', '', '', '', '',
      'Технологічний відхід матеріалів:',
      project.summary.wasteAddedCost,
      '', '', '', ''
    ]);
    internalValues.push([
      '', '', '', '', '', '', '', '',
      'Послуги та роботи цеху/підрядників:',
      project.summary.servicesSubtotal,
      '', '', '', ''
    ]);
    internalValues.push([
      '', '', '', '', '', '', '', '',
      'Надбавка за виробничу складність:',
      project.summary.complexityAddedCost,
      '', '', '', ''
    ]);
    internalValues.push([
      '', '', '', '', '', '', '', '',
      `Загальновиробничі накладні (${project.coefficients.overheadPercent}%):`,
      project.summary.overheadCost,
      '', '', '', ''
    ]);
    internalValues.push([
      '', '', '', '', '', '', '', '',
      'ПОВНА ВИРОБНИЧА СОБІВАРТІСТЬ:',
      project.summary.totalPrimeCost,
      '', '', '', ''
    ]);
    internalValues.push([
      '', '', '', '', '', '', '', '',
      `Плановий прибуток / маржа (${project.summary.effectiveMarginPercent}%):`,
      project.summary.marginAmount,
      '', '', '', ''
    ]);
    internalValues.push([
      '', '', '', '', '', '', '', '',
      'ПІДСУМКОВА ВАРТІСТЬ ДЛЯ КЛІЄНТА (БЕЗ ПДВ):',
      project.summary.clientTotalWithoutVat,
      '', '', '', ''
    ]);
    if (project.coefficients.vatRatePercent > 0) {
      internalValues.push([
        '', '', '', '', '', '', '', '',
        `ПДВ (${project.coefficients.vatRatePercent}%):`,
        project.summary.vatAmount,
        '', '', '', ''
      ]);
    }
    internalValues.push([
      '', '', '', '', '', '', '', '',
      'ВСЬОГО ДО СПЛАТИ З ПДВ:',
      project.summary.clientTotalWithVat,
      '', '', '', ''
    ]);

    // 4. Prepare data for Tab 2: «Кошторис для клієнта»
    const clientValues: any[][] = [];

    clientValues.push(['ETS PROJECTS', '', '', '', '', '', '', '']);
    clientValues.push([
      'КОМЕРЦІЙНА ПРОПОЗИЦІЯ / КОШТОРИС НА ВИГОТОВЛЕННЯ ВИРОБІВ',
      '', '', '', '', '', '', ''
    ]);
    clientValues.push([
      `Замовлення №: ${project.projectNumber}`,
      `Замовник: ${project.client}`,
      `Об'єкт / Виріб: ${project.projectName}`,
      `Дата: ${project.date}`,
      `Контактна особа: ${project.manager}`,
      '', '', ''
    ]);
    clientValues.push(['']);
    clientValues.push([
      '№',
      'Найменування конструктиву / виробу',
      'Опис конструктиву та матеріали',
      'К-сть',
      'Од. вим.',
      'Ціна за од. (грн без ПДВ)',
      'Загальна сума (грн без ПДВ)',
      'Примітки'
    ]);

    // Group or list constructive positions
    project.items.forEach((item, index) => {
      const unitClientPrice = item.quantity > 0
        ? Math.round((item.clientPrice / item.quantity) * 100) / 100
        : item.clientPrice;

      clientValues.push([
        index + 1,
        item.constructive,
        `${item.materialName} (${MATERIAL_CATEGORIES[item.category]?.name || ''})`,
        item.quantity,
        item.unit,
        unitClientPrice,
        item.clientPrice,
        item.notes || ''
      ]);
    });

    // Client commercial totals
    clientValues.push(['']);
    clientValues.push([
      '', '', '', '', '',
      'Разом без ПДВ:',
      project.summary.clientTotalWithoutVat,
      ''
    ]);
    if (project.coefficients.vatRatePercent > 0) {
      clientValues.push([
        '', '', '', '', '',
        `ПДВ ${project.coefficients.vatRatePercent}%:`,
        project.summary.vatAmount,
        ''
      ]);
    }
    clientValues.push([
      '', '', '', '', '',
      'ВСЬОГО ДО СПЛАТИ:',
      project.summary.clientTotalWithVat,
      ''
    ]);
    clientValues.push(['']);
    clientValues.push([
      'Умови оплати:',
      '70% — авансовий платіж для запуску у виробництво та закупівлі матеріалів',
      '', '', '', '', '', ''
    ]);
    clientValues.push([
      '',
      '30% — залишковий платіж після завершення виготовлення перед доставкою/монтажем',
      '', '', '', '', '', ''
    ]);
    clientValues.push([
      'Термін виготовлення:',
      '15–20 робочих днів з моменту затвердження креслень та надходження авансу',
      '', '', '', '', '', ''
    ]);

    // 5. Write data to both sheets using values:batchUpdate
    await this.sheetsRequest(
      `${spreadsheetId}/values:batchUpdate`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({
          valueInputOption: 'USER_ENTERED',
          data: [
            {
              range: `'Специфікація цеху'!A1`,
              values: internalValues,
            },
            {
              range: `'Кошторис клієнта'!A1`,
              values: clientValues,
            },
          ],
        }),
      }
    );

    // 6. Apply professional styling (batchUpdate format requests)
    try {
      await this.applySheetStyling(spreadsheetId, project, accessToken);
    } catch (e) {
      console.warn('Styling failed, data was successfully saved:', e);
    }

    return {
      spreadsheetId,
      spreadsheetUrl,
      driveFolderId: finalFolderId,
      driveFolderName: finalFolderName,
      cashFlowUpdated: false,
    };
  }

  /**
   * Applies corporate styling to the created spreadsheet
   */
  private static async applySheetStyling(
    spreadsheetId: string,
    project: CalculationProject,
    accessToken: string
  ): Promise<void> {
    const requests: any[] = [];

    // --- Styling Tab 0 («Внутрішня специфікація») ---
    // Title format (Row 1-2)
    requests.push({
      repeatCell: {
        range: { sheetId: 0, startRowIndex: 0, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 14 },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.08, green: 0.12, blue: 0.22 }, // Dark Slate Navy
            textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true, fontSize: 13 },
            horizontalAlignment: 'LEFT',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
      },
    });

    // Table Headers format (Row 7: 0-based index 6)
    requests.push({
      repeatCell: {
        range: { sheetId: 0, startRowIndex: 6, endRowIndex: 7, startColumnIndex: 0, endColumnIndex: 14 },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.15, green: 0.23, blue: 0.36 }, // Navy Slate
            textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true, fontSize: 10 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
            wrapStrategy: 'WRAP',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)',
      },
    });

    // Column widths for Tab 0
    const colWidthsTab0 = [
      { col: 0, width: 45 },   // №
      { col: 1, width: 230 },  // Конструктив
      { col: 2, width: 250 },  // Матеріал
      { col: 3, width: 140 },  // Категорія
      { col: 4, width: 85 },   // К-сть
      { col: 5, width: 65 },   // Од.
      { col: 6, width: 85 },   // Коеф. відходу
      { col: 7, width: 95 },   // Ефективна к-сть
      { col: 8, width: 105 },  // Базова ціна
      { col: 9, width: 120 },  // Вартість матеріалу
      { col: 10, width: 85 },  // Коеф. складності
      { col: 11, width: 130 }, // Виробнича собівартість
      { col: 12, width: 130 }, // Ціна для клієнта
      { col: 13, width: 160 }, // Примітки
    ];

    colWidthsTab0.forEach(({ col, width }) => {
      requests.push({
        updateDimensionProperties: {
          range: { sheetId: 0, dimension: 'COLUMNS', startIndex: col, endIndex: col + 1 },
          properties: { pixelSize: width },
          fields: 'pixelSize',
        },
      });
    });

    // --- Styling Tab 1 («Кошторис для клієнта») ---
    // Title format
    requests.push({
      repeatCell: {
        range: { sheetId: 1, startRowIndex: 0, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 8 },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.05, green: 0.38, blue: 0.33 }, // Dark Teal
            textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true, fontSize: 13 },
            horizontalAlignment: 'LEFT',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
      },
    });

    // Client Table Headers (Row 5: index 4)
    requests.push({
      repeatCell: {
        range: { sheetId: 1, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 0, endColumnIndex: 8 },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.09, green: 0.45, blue: 0.39 }, // Teal
            textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true, fontSize: 10 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
            wrapStrategy: 'WRAP',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)',
      },
    });

    // Column widths for Tab 1
    const colWidthsTab1 = [
      { col: 0, width: 45 },   // №
      { col: 1, width: 240 },  // Конструктив
      { col: 2, width: 280 },  // Опис матеріалів
      { col: 3, width: 75 },   // К-сть
      { col: 4, width: 65 },   // Од. вим.
      { col: 5, width: 130 },  // Ціна за од.
      { col: 6, width: 145 },  // Загальна сума
      { col: 7, width: 180 },  // Примітки
    ];

    colWidthsTab1.forEach(({ col, width }) => {
      requests.push({
        updateDimensionProperties: {
          range: { sheetId: 1, dimension: 'COLUMNS', startIndex: col, endIndex: col + 1 },
          properties: { pixelSize: width },
          fields: 'pixelSize',
        },
      });
    });

    // Execute styling batch
    if (requests.length > 0) {
      await this.sheetsRequest(
        `${spreadsheetId}:batchUpdate`,
        accessToken,
        {
          method: 'POST',
          body: JSON.stringify({ requests }),
        }
      );
    }
  }

  /**
   * Requirement 3.4: Pass final project sum into Cash Flow financial calendar
   */
  public static async passToCashFlow(
    project: CalculationProject,
    existingProjects: ProjectSheetRow[],
    accessToken?: string | null,
    sheetConfig?: SheetConfig | null
  ): Promise<{ updatedProjects: ProjectSheetRow[]; targetRow: number }> {
    const finalSum = project.summary.clientTotalWithVat || project.summary.clientTotalWithoutVat;
    const finalSumStr = Math.round(finalSum).toString();

    // Check if project already exists in existing projects (by project code / number in colA)
    const existingIndex = existingProjects.findIndex(
      (p) =>
        p.colA?.trim().toLowerCase() === project.projectNumber.trim().toLowerCase() ||
        p.colA?.trim().replace(/^[№#]\s*/, '').toLowerCase() ===
          project.projectNumber.trim().replace(/^[№#]\s*/, '').toLowerCase()
    );

    const weekOptions = generateWeekOptions();
    const currentWeekKey = weekOptions[1]?.value || weekOptions[0]?.value || 'Т40';
    const nextWeekKey = weekOptions[2]?.value || weekOptions[1]?.value || 'Т41';
    const futureWeekKey = weekOptions[4]?.value || weekOptions[3]?.value || 'Т43';

    // 4 standard tranches: 50% advance, 20% intermediate, 20% pre-shipment, 10% closing
    const t1 = Math.round(finalSum * 0.5);
    const t2 = Math.round(finalSum * 0.2);
    const t3 = Math.round(finalSum * 0.2);
    const t4 = finalSum - (t1 + t2 + t3);

    let updatedProjects = [...existingProjects];
    let targetRow = 135;

    if (existingIndex >= 0) {
      // Update existing project row
      const existing = existingProjects[existingIndex];
      targetRow = existing.rowNumber;

      const updatedRow: ProjectSheetRow = {
        ...existing,
        colB: project.client || existing.colB,
        colC: project.projectName || existing.colC,
        colM: finalSumStr,
        rawProjectSum: finalSum,
        effectiveProjectSum: finalSum,
        // If tranches weren't set yet, configure them
        colZ: existing.colZ || t1.toString(),
        colAA: existing.colAA || currentWeekKey,
        colAB: existing.colAB || t2.toString(),
        colAC: existing.colAC || nextWeekKey,
        colAD: existing.colAD || t3.toString(),
        colAE: existing.colAE || futureWeekKey,
        colAF: existing.colAF || t4.toString(),
        colAG: existing.colAG || futureWeekKey,
      };

      updatedProjects[existingIndex] = updatedRow;

      // Update in Google Sheets if connected
      if (accessToken && sheetConfig?.spreadsheetId) {
        try {
          await GoogleSheetsService.updateProjectFinancials(
            sheetConfig.spreadsheetId,
            accessToken,
            'Лист1',
            {
              projectNumber: project.projectNumber,
              fallbackRow: existing.rowNumber,
              contractAmount: finalSumStr,
              schedule: [
                { amount: updatedRow.colZ || t1, week: updatedRow.colAA || currentWeekKey },
                { amount: updatedRow.colAB || t2, week: updatedRow.colAC || nextWeekKey },
                { amount: updatedRow.colAD || t3, week: updatedRow.colAE || futureWeekKey },
                { amount: updatedRow.colAF || t4, week: updatedRow.colAG || futureWeekKey },
              ],
            }
          );
        } catch (e) {
          console.warn('Failed to update project financials in Google Sheets:', e);
        }
      }
    } else {
      // Create new project row
      const maxRow = existingProjects.reduce((max, p) => Math.max(max, p.rowNumber || 0), 130);
      targetRow = maxRow + 1;

      const newRow: ProjectSheetRow = {
        rowNumber: targetRow,
        colA: project.projectNumber,
        colB: project.client,
        colC: project.projectName,
        colD: project.date,
        colE: '',
        colF: project.manager,
        colG: `КП-${project.projectNumber}`,
        colH: project.date,
        colI: '1',
        colM: finalSumStr,
        colN: '',
        colO: '',
        colP: '',
        colQ: '',
        colR: '',
        colS: '',
        colT: '',
        sumQRST: 0,
        colU: '',
        colV: '',
        colW: '',
        colX: '',
        colY: '',
        colZ: t1.toString(),
        colAA: currentWeekKey,
        colAB: t2.toString(),
        colAC: nextWeekKey,
        colAD: t3.toString(),
        colAE: futureWeekKey,
        colAF: t4.toString(),
        colAG: futureWeekKey,
        currencyRate: 1,
        rawProjectSum: finalSum,
        effectiveProjectSum: finalSum,
      };

      updatedProjects.unshift(newRow);

      // Add to Google Sheets if connected
      if (accessToken && (sheetConfig?.spreadsheetId || DEFAULT_PROJECTS_SPREADSHEET_ID)) {
        try {
          const targetSpreadsheetId = sheetConfig?.spreadsheetId || DEFAULT_PROJECTS_SPREADSHEET_ID;
          await GoogleSheetsService.addProjectToSheet(
            targetSpreadsheetId,
            accessToken,
            {
              projectNumber: project.projectNumber,
              projectName: project.projectName,
              startDate: project.date,
              invoiceNumber: `КП-${project.projectNumber}`,
              invoiceDate: project.date,
              contractAmount: finalSumStr,
              manager: project.manager,
            }
          );
        } catch (e) {
          console.warn('Failed to add project to Google Sheets:', e);
        }
      }
    }

    return { updatedProjects, targetRow };
  }
}
