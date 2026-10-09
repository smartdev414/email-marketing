import Papa from "papaparse";

/**
 * Reads an uploaded contact file in the browser: CSV/TSV/TXT via PapaParse
 * (which detects the delimiter and handles quotes, line breaks inside cells
 * and Excel's UTF-8 byte-order mark), and .xlsx via read-excel-file.
 */

export type ParsedFile = { headers: string[]; rows: string[][] };

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

function finish(table: unknown[][]): ParsedFile {
  // The header is the first row with anything in it; blank rows are dropped.
  const rows = table
    .map((row) => row.map(cellText))
    .filter((row) => row.some((cell) => cell !== ""));
  const [header = [], ...data] = rows;
  return { headers: header.map((cell) => cell.replace(/^﻿/, "")), rows: data };
}

function parseCsv(file: File) {
  return new Promise<ParsedFile>((resolve, reject) => {
    Papa.parse<string[]>(file, {
      skipEmptyLines: "greedy",
      complete: (result) => resolve(finish(result.data)),
      error: (error) => reject(error),
    });
  });
}

async function parseXlsx(file: File) {
  const { readSheet } = await import("read-excel-file/browser");
  return finish(await readSheet(file));
}

export async function parseContactFile(file: File): Promise<ParsedFile> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx")) return parseXlsx(file);
  if (name.endsWith(".xls")) {
    throw new Error("Old .xls files are not supported. In Excel, use Save As → .xlsx or .csv.");
  }
  return parseCsv(file);
}
