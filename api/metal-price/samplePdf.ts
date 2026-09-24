import fs from 'fs';
import { jsPDF } from 'jspdf';

export function generateMetalHoldingSamplePdf(): Buffer {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  // Load FreeSans font for Cyrillic characters
  const fontPath = '/usr/share/fonts/truetype/freefont/FreeSans.ttf';
  if (fs.existsSync(fontPath)) {
    const fontBytes = fs.readFileSync(fontPath).toString('base64');
    doc.addFileToVFS('FreeSans.ttf', fontBytes);
    doc.addFont('FreeSans.ttf', 'FreeSans', 'normal');
    doc.setFont('FreeSans');
  }

  // Header Banner
  doc.setFillColor(15, 76, 129); // Deep classic blue
  doc.rect(0, 0, 210, 24, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.text('ТОВАРИСТВО З ОБМЕЖЕНОЮ ВІДПОВІДАЛЬНІСТЮ «МЕТАЛ ХОЛДІНГ»', 12, 11);
  doc.setFontSize(8);
  doc.text('Офіційний прайс-лист сервісного металоцентру • metal-holding.com.ua • Тел: +38 (044) 490-67-67', 12, 18);

  // Document Title
  doc.setTextColor(30, 41, 59);
  doc.setFontSize(13);
  doc.text('ЧОРНИЙ МЕТАЛОПРОКАТ (РОЗДРІБНІ ЦІНИ ТА ПОРІЗКА)', 12, 33);

  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(`Діє з: ${new Date().toLocaleDateString('uk-UA')} | Всі ціни вказані в гривнях з урахуванням ПДВ 20%`, 12, 38);

  // Table Columns Setup
  const startY = 43;
  const colX = [12, 32, 102, 114, 134, 154, 184];
  const colWidths = [20, 70, 12, 20, 20, 30, 18];
  const headers = ['Артикул', 'Назва товару', 'Од.', 'Ціна за од.', 'Довжина', 'за 1 м/ лист', 'Порізка'];

  // Draw Table Header
  doc.setFillColor(241, 245, 249);
  doc.rect(12, startY, 186, 7, 'F');
  doc.setDrawColor(203, 213, 225);
  doc.rect(12, startY, 186, 7, 'S');

  doc.setFontSize(7.5);
  doc.setTextColor(51, 65, 85);
  headers.forEach((h, i) => {
    doc.text(h, colX[i] + 1, startY + 4.8);
  });

  let currentY = startY + 7;

  interface SampleRow {
    isGroup?: boolean;
    art?: string;
    name: string;
    unit?: string;
    tonPrice?: number;
    len?: number;
    meterPrice?: number;
    cutPrice?: number;
  }

  const rows: SampleRow[] = [
    // Group 1
    { isGroup: true, name: 'Арматура мірної довжини' },
    { art: 'ARM-006', name: 'Арматура 6 міра', unit: 'т', tonPrice: 58785, len: 6, meterPrice: 14.05, cutPrice: 10.80 },
    { art: 'ARM-008', name: 'Арматура 8 міра', unit: 'т', tonPrice: 51180, len: 6, meterPrice: 22.98, cutPrice: 12.00 },
    { art: 'ARM-010', name: 'Арматура 10 міра', unit: 'т', tonPrice: 49500, len: 6, meterPrice: 33.10, cutPrice: 13.20 },
    { art: 'ARM-012', name: 'Арматура 12 міра', unit: 'т', tonPrice: 48900, len: 6, meterPrice: 47.02, cutPrice: 14.40 },

    // Group 2
    { isGroup: true, name: 'Труба профільна квадратна (ГОСТ 8639-82, ст. 3)' },
    { art: 'TR-20202', name: 'Труба профільна 20х20х2 мм ст.3', unit: 'Т', tonPrice: 36200, len: 6, meterPrice: 52.40, cutPrice: 8.50 },
    { art: 'TR-25252', name: 'Труба профільна 25х25х2 мм ст.3', unit: 'Т', tonPrice: 36000, len: 6, meterPrice: 66.80, cutPrice: 9.50 },
    { art: 'TR-40402', name: 'Труба профільна 40х40х2 мм ст.3', unit: 'Т', tonPrice: 35800, len: 6, meterPrice: 95.80, cutPrice: 11.20 },
    { art: 'TR-50503', name: 'Труба профільна 50х50х3 мм ст.3', unit: 'Т', tonPrice: 35400, len: 6, meterPrice: 168.00, cutPrice: 16.00 },

    // Group 3
    { isGroup: true, name: 'Труба профільна прямокутна (ГОСТ 8645-68, ст. 3)' },
    { art: 'TR-40202', name: 'Труба профільна 40х20х2 мм ст.3', unit: 'Т', tonPrice: 36000, len: 6, meterPrice: 71.50, cutPrice: 9.00 },
    { art: 'TR-50252', name: 'Труба профільна 50х25х2 мм ст.3', unit: 'Т', tonPrice: 35900, len: 6, meterPrice: 91.20, cutPrice: 10.50 },
    { art: 'TR-60402', name: 'Труба профільна 60х40х2 мм ст.3', unit: 'Т', tonPrice: 35800, len: 6, meterPrice: 124.50, cutPrice: 13.50 },

    // Group 4
    { isGroup: true, name: 'Кутник рівнополичний гарячекатаний (ГОСТ 8509-93)' },
    { art: 'KUT-25253', name: 'Кутник сталевий 25х25х3 мм ст.3', unit: 'Т', tonPrice: 34800, len: 6, meterPrice: 42.10, cutPrice: 8.00 },
    { art: 'KUT-32323', name: 'Кутник сталевий 32х32х3 мм ст.3', unit: 'Т', tonPrice: 34500, len: 6, meterPrice: 58.20, cutPrice: 9.00 },
    { art: 'KUT-40404', name: 'Кутник сталевий 40х40х4 мм ст.3', unit: 'Т', tonPrice: 34200, len: 6, meterPrice: 88.60, cutPrice: 11.50 },
    { art: 'KUT-50504', name: 'Кутник сталевий 50х50х4 мм ст.3', unit: 'Т', tonPrice: 33900, len: 6, meterPrice: 112.40, cutPrice: 13.00 },

    // Group 5
    { isGroup: true, name: 'Листовий прокат гарячекатаний (розмір 1250х2500 мм)' },
    { art: 'LST-02', name: 'Лист г/к 2.0 мм ст.3 (розмір 1250х2500)', unit: 'Т', tonPrice: 38000, len: 1, meterPrice: 890.00, cutPrice: 25.00 },
    { art: 'LST-03', name: 'Лист г/к 3.0 мм ст.3 (розмір 1250х2500)', unit: 'Т', tonPrice: 37500, len: 1, meterPrice: 1340.00, cutPrice: 35.00 },
    { art: 'LST-04', name: 'Лист г/к 4.0 мм ст.3 (розмір 1250х2500)', unit: 'Т', tonPrice: 37000, len: 1, meterPrice: 1780.00, cutPrice: 45.00 },

    // Group 6
    { isGroup: true, name: 'Швелер сталевий гарячекатаний (ГОСТ 8240-97)' },
    { art: 'SHV-08', name: 'Швелер сталевий 8У ст.3', unit: 'Т', tonPrice: 37500, len: 12, meterPrice: 245.00, cutPrice: 18.00 },
    { art: 'SHV-10', name: 'Швелер сталевий 10У ст.3', unit: 'Т', tonPrice: 37200, len: 12, meterPrice: 318.50, cutPrice: 22.00 },
  ];

  rows.forEach((r, idx) => {
    // Page overflow check
    if (currentY > 270) {
      doc.addPage();
      currentY = 20;

      // Re-draw header on new page
      doc.setFillColor(241, 245, 249);
      doc.rect(12, currentY, 186, 7, 'F');
      doc.setDrawColor(203, 213, 225);
      doc.rect(12, currentY, 186, 7, 'S');
      doc.setFontSize(7.5);
      doc.setTextColor(51, 65, 85);
      headers.forEach((h, i) => {
        doc.text(h, colX[i] + 1, currentY + 4.8);
      });
      currentY += 7;
    }

    if (r.isGroup) {
      // Group header banner row
      doc.setFillColor(226, 232, 240);
      doc.rect(12, currentY, 186, 6.5, 'F');
      doc.setDrawColor(203, 213, 225);
      doc.rect(12, currentY, 186, 6.5, 'S');

      doc.setFontSize(8.5);
      doc.setTextColor(15, 23, 42);
      doc.text(`📁 ${r.name}`, 14, currentY + 4.6);
      currentY += 6.5;
    } else {
      // Data row
      const isEven = idx % 2 === 0;
      doc.setFillColor(isEven ? 255 : 248, isEven ? 255 : 250, isEven ? 255 : 252);
      doc.rect(12, currentY, 186, 5.8, 'F');
      doc.setDrawColor(226, 232, 240);
      doc.rect(12, currentY, 186, 5.8, 'S');

      doc.setFontSize(7.5);
      doc.setTextColor(30, 41, 59);

      // Art
      doc.text(r.art || '', colX[0] + 1, currentY + 4.1);
      // Name
      doc.text(r.name || '', colX[1] + 1, currentY + 4.1);
      // Unit
      doc.text(r.unit || 'Т', colX[2] + 1, currentY + 4.1);
      // Ton Price
      doc.text(r.tonPrice ? `${r.tonPrice} грн` : '', colX[3] + 1, currentY + 4.1);
      // Length
      doc.text(r.len ? `${r.len} м` : '', colX[4] + 1, currentY + 4.1);
      // Retail price per 1m / sheet (HIGHLIGHTED)
      doc.setTextColor(15, 118, 110); // emerald-700
      doc.text(r.meterPrice ? `${r.meterPrice.toFixed(2)} грн` : '', colX[5] + 1, currentY + 4.1);
      // Cutting price
      doc.setTextColor(71, 85, 105);
      doc.text(r.cutPrice ? `${r.cutPrice.toFixed(2)} грн` : '—', colX[6] + 1, currentY + 4.1);

      currentY += 5.8;
    }
  });

  // Footer notes
  currentY += 5;
  if (currentY > 275) {
    doc.addPage();
    currentY = 20;
  }
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text('* Примітка: Для розрахунку меблевих виробів використовується роздрібна ціна за 1 м.п. або за 1 лист з ПДВ.', 12, currentY);
  doc.text('  Послуги порізки стрічкопильним верстатом або плазмою враховуються додатково.', 12, currentY + 4);

  return Buffer.from(doc.output('arraybuffer'));
}
