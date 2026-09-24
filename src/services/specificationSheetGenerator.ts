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
              rowCount: Math.max(180, (project.items?.length || 20) + 120),
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
              rowCount: Math.max(150, (project.items?.length || 20) + 100),
              columnCount: 8,
              frozenRowCount: 5,
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

    // Track styling metadata for batch formatting
    const stylingMeta = {
      tab0UnitHeaders: [] as number[],
      tab0UnitSubtotals: [] as number[],
      tab0ServiceHeaders: [] as number[],
      tab0ServiceSubtotals: [] as number[],
      tab0SummaryHeaders: [] as number[],
      tab0GrandTotals: [] as number[],
      tab1UnitHeaders: [] as number[],
      tab1UnitSubtotals: [] as number[],
      tab1ServiceHeaders: [] as number[],
      tab1ServiceSubtotals: [] as number[],
      tab1GrandTotals: [] as number[],
    };

    // 3. Prepare data for Tab 1: «Специфікація цеху»
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

    // Units from Project Tree (Requirement 1: Ієрархічне групування за об'єктами з Project Tree)
    const unitsToRender = (project.units && project.units.length > 0)
      ? project.units
      : [
          {
            id: 'unit_default',
            name: project.projectName || 'Основний виріб',
            quantity: 1,
            items: project.items || [],
          }
        ];

    // Helper to get non-duplicate constructive element name
    const getConstructiveNodeName = (item: ConstructiveItem): string => {
      let constructiveNode = (item.constructive || '').trim();
      const materialName = (item.materialName || '').trim();

      // If empty or identical to materialName, do NOT duplicate material name:
      if (!constructiveNode || constructiveNode.toLowerCase() === materialName.toLowerCase()) {
        switch (item.category) {
          case 'metal_profile':
          case 'sheet_metal':
            return 'Опорний металокаркас';
          case 'plate_wood':
            return 'Корпус / Фасад';
          case 'glass_mirror':
            return 'Скляне наповнення / Полиця';
          case 'lighting':
            return 'Контурне LED підсвічування';
          case 'hardware':
            return 'Фурнітура та кріплення';
          case 'coating':
            return 'Порошкове / захисне фарбування';
          case 'services':
            return 'Виробнича операція / Обробка';
          default:
            return 'Конструктивний вузол';
        }
      }
      return constructiveNode;
    };

    // Iterate through each assembly unit
    unitsToRender.forEach((unit, unitIdx) => {
      const cleanUnitName = unit.name.replace(/^\d+[\.\)]\s*/, '').trim();
      const unitSectionTitle = `${unitIdx + 1}. ${cleanUnitName}${unit.quantity > 1 ? ` (Кількість: ${unit.quantity} шт)` : ''}`;

      // Unit Header Section (Requirement 1: Заголовок-секція для кожного Виробу)
      stylingMeta.tab0UnitHeaders.push(internalValues.length);
      internalValues.push([
        `${unitIdx + 1}`,
        unitSectionTitle,
        '', '', '', '', '', '', '', '', '', '', '', ''
      ]);

      let unitPrimeSum = 0;
      let unitClientSum = 0;

      // Constructive item rows within this unit
      (unit.items || []).forEach((item, itemIdx) => {
        const catLabel = MATERIAL_CATEGORIES[item.category]?.name || item.category;
        unitPrimeSum += item.totalCost || 0;
        unitClientSum += item.clientPrice || 0;

        // Requirement 2: Виводити назву вузла/деталі, вказану користувачем у Вікні 1, а НЕ дублювати назву самого матеріалу
        const constructiveNode = getConstructiveNodeName(item);

        internalValues.push([
          `${unitIdx + 1}.${itemIdx + 1}`,
          constructiveNode,
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

      // Unit Subtotal row (Requirement 1: Під кожним виробом додавати рядок підсумку «Разом за виробом [Назва]: X грн»)
      stylingMeta.tab0UnitSubtotals.push(internalValues.length);
      internalValues.push([
        '',
        `Разом за виробом ${cleanUnitName}: ${Math.round(unitPrimeSum).toLocaleString('uk-UA')} грн`,
        '', '', '', '', '', '', '', '', '',
        Math.round(unitPrimeSum * 100) / 100,
        Math.round(unitClientSum * 100) / 100,
        ''
      ]);
    });

    // Requirement 3: Окремий блок для Доставки та Монтажу
    const servicesConfig = project.servicesConfig;
    const deliveryEnabled = Boolean(servicesConfig?.delivery?.enabled);
    const deliveryCost = deliveryEnabled
      ? (servicesConfig?.delivery?.trips || 1) * (servicesConfig?.delivery?.ratePerTrip || 0)
      : (project.summary.deliveryCost || 0);

    const installationEnabled = Boolean(servicesConfig?.installation?.enabled);
    const installationCost = installationEnabled
      ? (servicesConfig?.installation?.workers || 1) *
        (servicesConfig?.installation?.hours || 0) *
        (servicesConfig?.installation?.ratePerHour || 0)
      : (project.summary.installationCost || 0);

    const hasLogisticsOrInstallation = deliveryCost > 0 || installationCost > 0 || deliveryEnabled || installationEnabled;

    if (hasLogisticsOrInstallation) {
      internalValues.push(['']);
      stylingMeta.tab0ServiceHeaders.push(internalValues.length);
      internalValues.push([
        'Д/М',
        'ДОСТАВКА ТА МОНТАЖ (Послуги доставки та виїзні роботи на обʼєкті)',
        '', '', '', '', '', '', '', '', '', '', '', ''
      ]);

      if (deliveryCost > 0 || deliveryEnabled) {
        internalValues.push([
          'Д.1',
          'Послуги доставки',
          servicesConfig?.delivery?.name || 'Вантажне авто (Київ та область)',
          'Логістика',
          servicesConfig?.delivery?.trips || 1,
          'рейс',
          1.0,
          servicesConfig?.delivery?.trips || 1,
          servicesConfig?.delivery?.ratePerTrip || deliveryCost,
          deliveryCost,
          1.0,
          deliveryCost,
          deliveryCost,
          servicesConfig?.delivery?.notes || 'Доставка готових виробів на локацію'
        ]);
      }

      if (installationCost > 0 || installationEnabled) {
        const workers = servicesConfig?.installation?.workers || 1;
        const hours = servicesConfig?.installation?.hours || 0;
        const totalManHours = workers * hours;
        internalValues.push([
          'М.1',
          'Послуги монтажу',
          `${servicesConfig?.installation?.name || 'Монтажна бригада'} (${workers} монтажн. х ${hours} год)`,
          'Монтаж',
          totalManHours > 0 ? totalManHours : 1,
          'люд.-год',
          1.0,
          totalManHours > 0 ? totalManHours : 1,
          servicesConfig?.installation?.ratePerHour || installationCost,
          installationCost,
          1.0,
          installationCost,
          installationCost,
          servicesConfig?.installation?.notes || 'Монтаж, нівелювання та фіксація конструкцій'
        ]);
      }

      stylingMeta.tab0ServiceSubtotals.push(internalValues.length);
      const totalLogisticsAndInstallation = Math.round((deliveryCost + installationCost) * 100) / 100;
      internalValues.push([
        '',
        `Разом за доставку та монтаж: ${totalLogisticsAndInstallation.toLocaleString('uk-UA')} грн`,
        '', '', '', '', '', '', '', '', '',
        totalLogisticsAndInstallation,
        totalLogisticsAndInstallation,
        ''
      ]);
    }

    // Summary block rows
    internalValues.push(['']);
    stylingMeta.tab0SummaryHeaders.push(internalValues.length);
    internalValues.push([
      '', '', '', '', '', '', '', '', 'ПІДСУМКОВИЙ ФІНАНСОВИЙ РОЗРАХУНОК:', '', '', '', '', ''
    ]);
    internalValues.push([
      '', '', '', '', '', '', '', '',
      'Чиста вартість матеріалів (з відходом):',
      project.summary.materialsSubtotal,
      '', '', '', ''
    ]);
    if (project.summary.servicesSubtotal > 0) {
      internalValues.push([
        '', '', '', '', '', '', '', '',
        'Послуги та роботи цеху/підрядників:',
        project.summary.servicesSubtotal,
        '', '', '', ''
      ]);
    }
    if (deliveryCost > 0) {
      internalValues.push([
        '', '', '', '', '', '', '', '',
        'Послуги доставки:',
        deliveryCost,
        '', '', '', ''
      ]);
    }
    if (installationCost > 0) {
      internalValues.push([
        '', '', '', '', '', '', '', '',
        'Монтажні роботи на обʼєкті:',
        installationCost,
        '', '', '', ''
      ]);
    }
    if (project.summary.complexityAddedCost > 0) {
      internalValues.push([
        '', '', '', '', '', '', '', '',
        'Надбавка за виробничу складність:',
        project.summary.complexityAddedCost,
        '', '', '', ''
      ]);
    }
    internalValues.push([
      '', '', '', '', '', '', '', '',
      `Загальновиробничі накладні (${project.coefficients.overheadPercent}%):`,
      project.summary.overheadCost,
      '', '', '', ''
    ]);
    stylingMeta.tab0GrandTotals.push(internalValues.length);
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
    stylingMeta.tab0GrandTotals.push(internalValues.length);
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
      stylingMeta.tab0GrandTotals.push(internalValues.length);
      internalValues.push([
        '', '', '', '', '', '', '', '',
        'ВСЬОГО ДО СПЛАТИ З ПДВ:',
        project.summary.clientTotalWithVat,
        '', '', '', ''
      ]);
    }

    // 4. Prepare data for Tab 2: «Кошторис клієнта»
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

    // Group items by units for client estimate
    unitsToRender.forEach((unit, unitIdx) => {
      const cleanUnitName = unit.name.replace(/^\d+[\.\)]\s*/, '').trim();
      stylingMeta.tab1UnitHeaders.push(clientValues.length);
      clientValues.push([
        `${unitIdx + 1}`,
        `${unitIdx + 1}. ${cleanUnitName}${unit.quantity > 1 ? ` (${unit.quantity} шт)` : ''}`,
        '', '', '', '', '', ''
      ]);

      let clientUnitSum = 0;

      (unit.items || []).forEach((item, itemIdx) => {
        clientUnitSum += item.clientPrice || 0;
        const unitClientPrice = item.quantity > 0
          ? Math.round((item.clientPrice / item.quantity) * 100) / 100
          : item.clientPrice;

        const constructiveNode = getConstructiveNodeName(item);

        clientValues.push([
          `${unitIdx + 1}.${itemIdx + 1}`,
          constructiveNode,
          `${item.materialName} (${MATERIAL_CATEGORIES[item.category]?.name || ''})`,
          item.quantity,
          item.unit,
          unitClientPrice,
          item.clientPrice,
          item.notes || ''
        ]);
      });

      stylingMeta.tab1UnitSubtotals.push(clientValues.length);
      clientValues.push([
        '',
        `Разом за виробом ${cleanUnitName}: ${Math.round(clientUnitSum).toLocaleString('uk-UA')} грн`,
        '', '', '', '',
        Math.round(clientUnitSum * 100) / 100,
        ''
      ]);
    });

    // Delivery and installation block for Tab 2
    if (hasLogisticsOrInstallation) {
      clientValues.push(['']);
      stylingMeta.tab1ServiceHeaders.push(clientValues.length);
      clientValues.push([
        'Д/М',
        'ПОСЛУГИ ДОСТАВКИ ТА МОНТАЖУ',
        '', '', '', '', '', ''
      ]);

      if (deliveryCost > 0 || deliveryEnabled) {
        clientValues.push([
          'Д.1',
          'Послуги доставки на обʼєкт',
          `${servicesConfig?.delivery?.name || 'Вантажне авто'} (${servicesConfig?.delivery?.trips || 1} рейс.)`,
          servicesConfig?.delivery?.trips || 1,
          'рейс',
          servicesConfig?.delivery?.ratePerTrip || deliveryCost,
          deliveryCost,
          servicesConfig?.delivery?.notes || 'Транспортні послуги'
        ]);
      }

      if (installationCost > 0 || installationEnabled) {
        const workers = servicesConfig?.installation?.workers || 1;
        const hours = servicesConfig?.installation?.hours || 0;
        const totalManHours = workers * hours;
        clientValues.push([
          'М.1',
          'Монтажні та пусконалагоджувальні роботи',
          `${servicesConfig?.installation?.name || 'Монтажна бригада'} (${workers} монтажн. х ${hours} год)`,
          totalManHours > 0 ? totalManHours : 1,
          'люд.-год',
          servicesConfig?.installation?.ratePerHour || installationCost,
          installationCost,
          servicesConfig?.installation?.notes || 'Встановлення та закріплення на обʼєкті'
        ]);
      }

      stylingMeta.tab1ServiceSubtotals.push(clientValues.length);
      const totalLogisticsAndInstallation = Math.round((deliveryCost + installationCost) * 100) / 100;
      clientValues.push([
        '',
        `Разом за доставку та монтаж: ${totalLogisticsAndInstallation.toLocaleString('uk-UA')} грн`,
        '', '', '', '',
        totalLogisticsAndInstallation,
        ''
      ]);
    }

    // Client commercial totals
    clientValues.push(['']);
    stylingMeta.tab1GrandTotals.push(clientValues.length);
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
    stylingMeta.tab1GrandTotals.push(clientValues.length);
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
      await this.applySheetStyling(spreadsheetId, project, accessToken, stylingMeta);
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
    accessToken: string,
    meta?: {
      tab0UnitHeaders: number[];
      tab0UnitSubtotals: number[];
      tab0ServiceHeaders: number[];
      tab0ServiceSubtotals: number[];
      tab0SummaryHeaders: number[];
      tab0GrandTotals: number[];
      tab1UnitHeaders: number[];
      tab1UnitSubtotals: number[];
      tab1ServiceHeaders: number[];
      tab1ServiceSubtotals: number[];
      tab1GrandTotals: number[];
    }
  ): Promise<void> {
    const requests: any[] = [];

    // --- Styling Tab 0 («Специфікація цеху») ---
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

    // Format Tab 0 Unit Headers
    meta?.tab0UnitHeaders?.forEach((rowIdx) => {
      requests.push({
        repeatCell: {
          range: { sheetId: 0, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 0, endColumnIndex: 14 },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.91, green: 0.93, blue: 0.97 }, // Ice Indigo #E8EDF8
              textFormat: { foregroundColor: { red: 0.12, green: 0.18, blue: 0.35 }, bold: true, fontSize: 10 },
              horizontalAlignment: 'LEFT',
              verticalAlignment: 'MIDDLE',
            },
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
        },
      });
    });

    // Format Tab 0 Unit Subtotals
    meta?.tab0UnitSubtotals?.forEach((rowIdx) => {
      requests.push({
        repeatCell: {
          range: { sheetId: 0, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 0, endColumnIndex: 14 },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.96, green: 0.97, blue: 0.98 },
              textFormat: { foregroundColor: { red: 0.15, green: 0.2, blue: 0.25 }, bold: true, fontSize: 10 },
              borders: {
                top: { style: 'SOLID', color: { red: 0.8, green: 0.83, blue: 0.88 } },
                bottom: { style: 'SOLID', color: { red: 0.8, green: 0.83, blue: 0.88 } },
              },
            },
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat,borders)',
        },
      });
    });

    // Format Tab 0 Delivery & Installation Header
    meta?.tab0ServiceHeaders?.forEach((rowIdx) => {
      requests.push({
        repeatCell: {
          range: { sheetId: 0, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 0, endColumnIndex: 14 },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.99, green: 0.95, blue: 0.88 }, // Light Warm Amber
              textFormat: { foregroundColor: { red: 0.5, green: 0.25, blue: 0.05 }, bold: true, fontSize: 10 },
              horizontalAlignment: 'LEFT',
              verticalAlignment: 'MIDDLE',
            },
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
        },
      });
    });

    // Format Tab 0 Delivery & Installation Subtotals
    meta?.tab0ServiceSubtotals?.forEach((rowIdx) => {
      requests.push({
        repeatCell: {
          range: { sheetId: 0, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 0, endColumnIndex: 14 },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.99, green: 0.97, blue: 0.93 },
              textFormat: { bold: true, fontSize: 10 },
              borders: {
                top: { style: 'SOLID', color: { red: 0.85, green: 0.75, blue: 0.6 } },
                bottom: { style: 'SOLID', color: { red: 0.85, green: 0.75, blue: 0.6 } },
              },
            },
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat,borders)',
        },
      });
    });

    // Format Tab 0 Summary Headers
    meta?.tab0SummaryHeaders?.forEach((rowIdx) => {
      requests.push({
        repeatCell: {
          range: { sheetId: 0, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 0, endColumnIndex: 14 },
          cell: {
            userEnteredFormat: {
              textFormat: { bold: true, fontSize: 10, foregroundColor: { red: 0.15, green: 0.2, blue: 0.3 } },
            },
          },
          fields: 'userEnteredFormat(textFormat)',
        },
      });
    });

    // Format Tab 0 Grand Totals
    meta?.tab0GrandTotals?.forEach((rowIdx) => {
      requests.push({
        repeatCell: {
          range: { sheetId: 0, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 0, endColumnIndex: 14 },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.93, green: 0.97, blue: 0.94 }, // Light Mint
              textFormat: { bold: true, fontSize: 10.5, foregroundColor: { red: 0.05, green: 0.35, blue: 0.15 } },
            },
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat)',
        },
      });
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

    // --- Styling Tab 1 («Кошторис клієнта») ---
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

    // Format Tab 1 Unit Headers
    meta?.tab1UnitHeaders?.forEach((rowIdx) => {
      requests.push({
        repeatCell: {
          range: { sheetId: 1, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 0, endColumnIndex: 8 },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.92, green: 0.96, blue: 0.95 },
              textFormat: { foregroundColor: { red: 0.05, green: 0.35, blue: 0.3 }, bold: true, fontSize: 10 },
              horizontalAlignment: 'LEFT',
              verticalAlignment: 'MIDDLE',
            },
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
        },
      });
    });

    // Format Tab 1 Unit Subtotals
    meta?.tab1UnitSubtotals?.forEach((rowIdx) => {
      requests.push({
        repeatCell: {
          range: { sheetId: 1, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 0, endColumnIndex: 8 },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.96, green: 0.98, blue: 0.97 },
              textFormat: { bold: true, fontSize: 10 },
              borders: {
                top: { style: 'SOLID', color: { red: 0.75, green: 0.85, blue: 0.8 } },
                bottom: { style: 'SOLID', color: { red: 0.75, green: 0.85, blue: 0.8 } },
              },
            },
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat,borders)',
        },
      });
    });

    // Format Tab 1 Delivery & Installation Header
    meta?.tab1ServiceHeaders?.forEach((rowIdx) => {
      requests.push({
        repeatCell: {
          range: { sheetId: 1, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 0, endColumnIndex: 8 },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.99, green: 0.95, blue: 0.88 },
              textFormat: { foregroundColor: { red: 0.5, green: 0.25, blue: 0.05 }, bold: true, fontSize: 10 },
              horizontalAlignment: 'LEFT',
              verticalAlignment: 'MIDDLE',
            },
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
        },
      });
    });

    // Format Tab 1 Delivery & Installation Subtotals
    meta?.tab1ServiceSubtotals?.forEach((rowIdx) => {
      requests.push({
        repeatCell: {
          range: { sheetId: 1, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 0, endColumnIndex: 8 },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.99, green: 0.97, blue: 0.93 },
              textFormat: { bold: true, fontSize: 10 },
              borders: {
                top: { style: 'SOLID', color: { red: 0.85, green: 0.75, blue: 0.6 } },
                bottom: { style: 'SOLID', color: { red: 0.85, green: 0.75, blue: 0.6 } },
              },
            },
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat,borders)',
        },
      });
    });

    // Format Tab 1 Grand Totals
    meta?.tab1GrandTotals?.forEach((rowIdx) => {
      requests.push({
        repeatCell: {
          range: { sheetId: 1, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 0, endColumnIndex: 8 },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.88, green: 0.96, blue: 0.92 }, // Mint Green
              textFormat: { bold: true, fontSize: 11, foregroundColor: { red: 0.02, green: 0.35, blue: 0.2 } },
            },
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat)',
        },
      });
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
