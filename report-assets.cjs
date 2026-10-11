// Native assets are generated before export and publishing from the same typed rows as HTML.
const pathModule = require('node:path');
const ExcelJS = require('exceljs');
const QRCode = require('qrcode');
const { validateReportBundle } = require('./report-bundle.cjs');
const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );
const XLSX =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
async function prepareReportBundle(source) {
  const bundle = structuredClone(source),
    links = [];
  for (const descriptor of bundle.workbooks || []) {
    const book = new ExcelJS.Workbook();
    book.creator = 'TourneyLab';
    const used = new Set();
    for (const table of descriptor.sheets) {
      let name =
          String(table.id)
            .replace(/[\\/*?:\[\]]/g, '-')
            .slice(0, 28) || 'Report',
        suffix = 1;
      while (used.has(name)) name = `${name.slice(0, 25)}-${suffix++}`;
      used.add(name);
      const sheet = book.addWorksheet(name, {
        views: [{ state: 'frozen', ySplit: 1 }],
        pageSetup: {
          orientation: 'landscape',
          fitToPage: true,
          fitToWidth: 1,
          fitToHeight: 0,
          paperSize: 9,
        },
      });
      sheet.addRow(table.headers);
      sheet.addRows(table.rows);
      sheet.getRow(1).font = { bold: true };
      sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: Math.max(1, sheet.rowCount), column: table.headers.length },
      };
      sheet.columns.forEach((column, i) => {
        column.width = Math.min(
          45,
          Math.max(
            12,
            ...[table.headers, ...table.rows.slice(0, 200)].map(
              (row) => String(row[i] ?? '').length + 2,
            ),
          ),
        );
      });
      sheet.pageSetup.printTitlesRow = '1:1';
    }
    bundle.files.push({
      path: descriptor.path,
      contentType: XLSX,
      contentBase64: Buffer.from(await book.xlsx.writeBuffer()).toString(
        'base64',
      ),
    });
    links.push(
      `<li><a href="${esc(descriptor.path)}">${esc(descriptor.title)} — Excel workbook</a></li>`,
    );
    const prefix = descriptor.path.slice(
      0,
      descriptor.path.lastIndexOf('/') + 1,
    );
    for (const f of bundle.files)
      if (f.path.startsWith(prefix) && f.contentType.startsWith('text/html'))
        f.content = f.content.replace(
          '</main>',
          `<p class="no-print"><a href="${esc(pathModule.posix.relative(pathModule.posix.dirname(f.path), descriptor.path))}">Download Excel workbook</a> · Print this page to save a PDF.</p></main>`,
        );
  }
  for (const [i, attachment] of (bundle.attachments || []).entries()) {
    const path = `downloads/document-${i + 1}.pdf`;
    bundle.files.push({
      path,
      contentType: 'application/pdf',
      contentBase64: attachment.contentBase64,
    });
    links.push(
      `<li><a href="${path}">${esc(attachment.label || attachment.name || `Document ${i + 1}`)}</a></li>`,
    );
  }
  let qr = '';
  if (/^https?:\/\//i.test(bundle.qrUrl || '')) {
    bundle.files.push({
      path: 'assets/event-qr.png',
      contentType: 'image/png',
      contentBase64: (
        await QRCode.toBuffer(bundle.qrUrl, { width: 220, margin: 2 })
      ).toString('base64'),
    });
    qr = `<figure><img src="assets/event-qr.png" width="180" height="180" alt="QR code for this tournament’s public page"><figcaption>Scan for the latest published report.</figcaption></figure>`;
  }
  const home = bundle.files.find((f) => f.path === bundle.entry);
  if (home && (links.length || qr))
    home.content = home.content.replace(
      '</main>',
      `<section><h2>Downloads & sharing</h2><ul>${links.join('')}</ul>${qr}</section></main>`,
    );
  delete bundle.workbooks;
  delete bundle.attachments;
  delete bundle.qrUrl;
  validateReportBundle(bundle);
  return bundle;
}
module.exports = { prepareReportBundle };
