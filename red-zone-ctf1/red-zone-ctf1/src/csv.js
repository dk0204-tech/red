"use strict";

/**
 * Minimal RFC-4180 style CSV reader/writer.
 * Handles quoted fields, escaped quotes, CRLF/LF line endings and a UTF-8 BOM.
 * No dependencies.
 */

function parse(text) {
  const src = String(text).replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"' && field === "") {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function toObjects(text) {
  const rows = parse(text);
  if (rows.length < 2) return [];
  const header = rows[0];
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const line = rows[r];
    if (line.length === 1 && line[0] === "") continue; // trailing blank line
    const obj = {};
    for (let i = 0; i < header.length; i++) {
      obj[header[i]] = line[i] !== undefined ? line[i] : "";
    }
    out.push(obj);
  }
  return out;
}

function escapeField(value) {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function stringify(rows) {
  return rows.map((row) => row.map(escapeField).join(",")).join("\r\n") + "\r\n";
}

module.exports = { parse, toObjects, stringify };
