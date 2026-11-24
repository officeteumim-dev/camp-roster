// The Excel writer used for the DCJS registry spreadsheet: a real .xlsx our own reader (and Excel) can open.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { readXlsx } from '../supabase/functions/_shared/xlsx.js';
new Function(readFileSync(new URL('../web/xlsx-write.js', import.meta.url), 'utf8'))();
test('writes an xlsx that reads back exactly', async () => {
  const rows = [['LastName', 'FirstName', 'Birth_Date', 'SSN'], ['O\'Brien & Co', 'Avi', '04/01/2008', ''], ['Stein', 'Ze’ev <Z>', '12/31/2009', '']];
  const bytes = globalThis.XlsxWrite.make(rows, 'Registry search');
  writeFileSync('/tmp/dcjs-test.xlsx', bytes);
  const { rows: back } = await readXlsx(bytes);
  assert.deepEqual(back.map(r => r.slice(0, 4).map(v => v ?? '')), rows);
});
