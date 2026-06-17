import JSZip from "jszip";
import type {
  Account,
  InvestmentPosition,
  Liability,
  PropertyAsset,
  Transaction,
  WealthState,
} from "../domain/types";
import { emptyWealthState } from "../security/api";

type CellValue = string | number | undefined;
type Row = CellValue[];

interface SheetSpec {
  name: string;
  file: string;
  rows: Row[];
}

const sheetFiles = {
  Summary: "sheet1.xml",
  Accounts: "sheet2.xml",
  Properties: "sheet3.xml",
  Liabilities: "sheet4.xml",
  Positions: "sheet5.xml",
  Transactions: "sheet6.xml",
} as const;

export async function exportWealthWorkbook(
  data: WealthState,
  mode: "data" | "template" = "data",
): Promise<Blob> {
  const zip = new JSZip();
  const workbook = mode === "template" ? emptyWealthState() : data;
  const sheets = buildSheets(workbook);

  zip.file("[Content_Types].xml", contentTypesXml(sheets));
  zip.folder("_rels")?.file(".rels", rootRelsXml());
  zip.folder("xl")?.file("workbook.xml", workbookXml(sheets));
  zip.folder("xl")?.folder("_rels")?.file("workbook.xml.rels", workbookRelsXml(sheets));
  zip.folder("xl")?.file("styles.xml", stylesXml());

  const worksheets = zip.folder("xl")?.folder("worksheets");
  for (const sheet of sheets) {
    worksheets?.file(sheet.file, sheetXml(sheet.rows));
  }

  return zip.generateAsync({
    type: "blob",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export async function importWealthWorkbook(file: File): Promise<WealthState> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const workbook = emptyWealthState();

  const summary = await readSheet(zip, `xl/worksheets/${sheetFiles.Summary}`);
  const summaryMap = new Map(summary.slice(1).map((row) => [text(row[0]), row[1]]));
  workbook.openingNetWorth = number(summaryMap.get("openingNetWorth"));
  workbook.targets = {
    month: text(summaryMap.get("targetMonth")) || "2026-07",
    netWorthGrowth: number(summaryMap.get("targetNetWorthGrowth")),
    netCashFlow: number(summaryMap.get("targetNetCashFlow")),
    investmentReturn: number(summaryMap.get("targetInvestmentReturn")),
  };

  workbook.accounts = rowsToObjects<Account>(
    await readSheet(zip, `xl/worksheets/${sheetFiles.Accounts}`),
    (row) => ({
      id: id(row[0]),
      name: text(row[1]),
      kind: accountKind(text(row[2])),
      balance: number(row[3]),
      updatedAt: text(row[4]) || "2026-07-01",
    }),
  );
  workbook.properties = rowsToObjects<PropertyAsset>(
    await readSheet(zip, `xl/worksheets/${sheetFiles.Properties}`),
    (row) => ({
      id: id(row[0]),
      name: text(row[1]),
      valuation: number(row[2]),
      updatedAt: text(row[3]) || "2026-07-01",
    }),
  );
  workbook.liabilities = rowsToObjects<Liability>(
    await readSheet(zip, `xl/worksheets/${sheetFiles.Liabilities}`),
    (row) => ({
      id: id(row[0]),
      name: text(row[1]),
      balance: number(row[2]),
      propertyId: optionalText(row[3]),
      updatedAt: text(row[4]) || "2026-07-01",
    }),
  );
  workbook.positions = rowsToObjects<InvestmentPosition>(
    await readSheet(zip, `xl/worksheets/${sheetFiles.Positions}`),
    (row) => ({
      id: id(row[0]),
      accountId: text(row[1]),
      symbol: text(row[2]),
      name: text(row[3]),
      marketValue: number(row[4]),
      costBasis: number(row[5]),
      realizedProfit: number(row[6]),
      assetClass: text(row[7]) === "option" ? "option" : "stock",
    }),
  );
  workbook.transactions = rowsToObjects<Transaction>(
    await readSheet(zip, `xl/worksheets/${sheetFiles.Transactions}`),
    (row) => ({
      id: id(row[0]),
      date: text(row[1]) || "2026-07-01",
      kind: transactionKind(text(row[2])),
      amount: number(row[3]),
      category: text(row[4]) || "其他",
      accountId: text(row[5]),
      targetAccountId: optionalText(row[6]),
      note: optionalText(row[7]),
    }),
  );

  return workbook;
}

export function downloadWorkbook(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildSheets(data: WealthState): SheetSpec[] {
  return [
    {
      name: "Summary",
      file: sheetFiles.Summary,
      rows: [
        ["field", "value"],
        ["openingNetWorth", data.openingNetWorth],
        ["targetMonth", data.targets.month],
        ["targetNetWorthGrowth", data.targets.netWorthGrowth],
        ["targetNetCashFlow", data.targets.netCashFlow],
        ["targetInvestmentReturn", data.targets.investmentReturn],
      ],
    },
    {
      name: "Accounts",
      file: sheetFiles.Accounts,
      rows: [
        ["id", "name", "kind", "balance", "updatedAt"],
        ...data.accounts.map((item) => [
          item.id,
          item.name,
          item.kind,
          item.balance,
          item.updatedAt,
        ]),
      ],
    },
    {
      name: "Properties",
      file: sheetFiles.Properties,
      rows: [
        ["id", "name", "valuation", "updatedAt"],
        ...data.properties.map((item) => [
          item.id,
          item.name,
          item.valuation,
          item.updatedAt,
        ]),
      ],
    },
    {
      name: "Liabilities",
      file: sheetFiles.Liabilities,
      rows: [
        ["id", "name", "balance", "propertyId", "updatedAt"],
        ...data.liabilities.map((item) => [
          item.id,
          item.name,
          item.balance,
          item.propertyId ?? "",
          item.updatedAt,
        ]),
      ],
    },
    {
      name: "Positions",
      file: sheetFiles.Positions,
      rows: [
        [
          "id",
          "accountId",
          "symbol",
          "name",
          "marketValue",
          "costBasis",
          "realizedProfit",
          "assetClass",
        ],
        ...data.positions.map((item) => [
          item.id,
          item.accountId,
          item.symbol,
          item.name,
          item.marketValue,
          item.costBasis,
          item.realizedProfit,
          item.assetClass,
        ]),
      ],
    },
    {
      name: "Transactions",
      file: sheetFiles.Transactions,
      rows: [
        [
          "id",
          "date",
          "kind",
          "amount",
          "category",
          "accountId",
          "targetAccountId",
          "note",
        ],
        ...data.transactions.map((item) => [
          item.id,
          item.date,
          item.kind,
          item.amount,
          item.category,
          item.accountId,
          item.targetAccountId ?? "",
          item.note ?? "",
        ]),
      ],
    },
  ];
}

async function readSheet(zip: JSZip, path: string): Promise<string[][]> {
  const file = zip.file(path);
  if (!file) {
    throw new Error(`Excel 缺少工作表：${path}`);
  }
  const xml = await file.async("string");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const rows = Array.from(doc.getElementsByTagName("row"));
  return rows.map((row) => {
    const cells = Array.from(row.getElementsByTagName("c"));
    const values: string[] = [];
    for (const cell of cells) {
      const index = columnIndex(cell.getAttribute("r") ?? "");
      values[index] = cellValue(cell);
    }
    return values.map((value) => value ?? "");
  });
}

function rowsToObjects<T>(rows: string[][], mapper: (row: string[]) => T): T[] {
  return rows
    .slice(1)
    .filter((row) => row.some((cell) => text(cell)))
    .map(mapper);
}

function sheetXml(rows: Row[]): string {
  const dimension = `A1:${columnName(Math.max(...rows.map((row) => row.length), 1) - 1)}${Math.max(rows.length, 1)}`;
  return xmlHeader(
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="${dimension}"/><sheetData>${rows
      .map((row, rowIndex) => rowXml(row, rowIndex))
      .join("")}</sheetData></worksheet>`,
  );
}

function rowXml(row: Row, rowIndex: number): string {
  const rowNumber = rowIndex + 1;
  return `<row r="${rowNumber}">${row
    .map((value, columnIndexValue) =>
      cellXml(value, `${columnName(columnIndexValue)}${rowNumber}`),
    )
    .join("")}</row>`;
}

function cellXml(value: CellValue, ref: string): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${ref}"><v>${value}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(String(value ?? ""))}</t></is></c>`;
}

function workbookXml(sheets: SheetSpec[]): string {
  return xmlHeader(
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
      .map(
        (sheet, index) =>
          `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
      )
      .join("")}</sheets></workbook>`,
  );
}

function workbookRelsXml(sheets: SheetSpec[]): string {
  return xmlHeader(
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
      .map(
        (sheet, index) =>
          `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/${sheet.file}"/>`,
      )
      .join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  );
}

function rootRelsXml(): string {
  return xmlHeader(
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  );
}

function contentTypesXml(sheets: SheetSpec[]): string {
  return xmlHeader(
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets
      .map(
        (sheet) =>
          `<Override PartName="/xl/worksheets/${sheet.file}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join("")}</Types>`,
  );
}

function stylesXml(): string {
  return xmlHeader(
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Microsoft YaHei"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellXfs></styleSheet>',
  );
}

function xmlHeader(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${body}`;
}

function cellValue(cell: Element): string {
  if (cell.getAttribute("t") === "inlineStr") {
    return cell.getElementsByTagName("t")[0]?.textContent ?? "";
  }
  return cell.getElementsByTagName("v")[0]?.textContent ?? "";
}

function columnIndex(ref: string): number {
  const letters = ref.match(/[A-Z]+/)?.[0] ?? "A";
  return [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function columnName(index: number): string {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function id(value: unknown): string {
  return text(value) || crypto.randomUUID();
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function optionalText(value: unknown): string | undefined {
  const result = text(value);
  return result || undefined;
}

function number(value: unknown): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function accountKind(value: string): Account["kind"] {
  return ["bank", "alipay", "brokerage", "options", "custom"].includes(value)
    ? (value as Account["kind"])
    : "custom";
}

function transactionKind(value: string): Transaction["kind"] {
  return ["income", "expense", "transfer"].includes(value)
    ? (value as Transaction["kind"])
    : "expense";
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
