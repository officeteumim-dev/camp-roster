// A small .xlsx reader with no dependencies: reads the first worksheet into rows of strings.
// Works in Deno (server functions), Node 18+ (tests) and modern browsers. An .xlsx file is a zip of XML files.

const td = new TextDecoder();

async function inflateRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const out = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

// Returns { "xl/workbook.xml": Uint8Array, ... } for the entries we ask for.
async function unzip(buf, wanted) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 66000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('This file is not an Excel (.xlsx) file.');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = {};
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('The Excel file is damaged.');
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = td.decode(b.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted(name)) continue;
    const lnLen = dv.getUint16(local + 26, true), lxLen = dv.getUint16(local + 28, true);
    const start = local + 30 + lnLen + lxLen;
    const data = b.subarray(start, start + csize);
    if (method === 0) files[name] = data;
    else if (method === 8) files[name] = await inflateRaw(data);
    else throw new Error('The Excel file uses an unsupported compression.');
  }
  return files;
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function xmlText(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENT[e] ?? m;
  });
}

function colIndex(ref) {
  const letters = ref.replace(/\d+/g, '');
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// Cell text: shared strings, inline strings, formula strings. For a HYPERLINK formula with no useful cached value,
// the link's display text (or its address) is returned, since that is what a person sees in Excel.
function cellValue(attrs, inner, shared) {
  const t = (attrs.match(/\bt="(\w+)"/) || [])[1] || 'n';
  const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
  const f = (inner.match(/<f[^>]*>([\s\S]*?)<\/f>/) || [])[1];
  if (f && /^HYPERLINK\(/i.test(xmlText(f))) {
    const args = [...xmlText(f).matchAll(/"((?:[^"]|"")*)"/g)].map(m => m[1].replace(/""/g, '"'));
    if (args.length) return args[args.length - 1];
  }
  if (t === 's') return v == null ? '' : shared[Number(v)] ?? '';
  if (t === 'inlineStr') return xmlText([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => m[1]).join(''));
  if (t === 'b') return v === '1' ? 'TRUE' : 'FALSE';
  return v == null ? '' : xmlText(v);
}

// Reads the first worksheet. Returns { sheet, rows: string[][] } with the header row first.
export async function readXlsx(buf) {
  const files = await unzip(buf, n => n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/[^/]+\.xml$/.test(n));
  const wb = files['xl/workbook.xml'] ? td.decode(files['xl/workbook.xml']) : '';
  const first = wb.match(/<sheet\b[^>]*\bname="([^"]*)"[^>]*\br:id="([^"]+)"/) || wb.match(/<sheet\b[^>]*\br:id="([^"]+)"[^>]*\bname="([^"]*)"/);
  let sheetPath = 'xl/worksheets/sheet1.xml', sheetName = 'Sheet1';
  if (first) {
    const [name, rid] = first[0].indexOf('name=') < first[0].indexOf('r:id=') ? [first[1], first[2]] : [first[2], first[1]];
    sheetName = xmlText(name);
    const rels = files['xl/_rels/workbook.xml.rels'] ? td.decode(files['xl/_rels/workbook.xml.rels']) : '';
    const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map(m => m[0]).find(r => r.includes(`Id="${rid}"`));
    const target = rel && (rel.match(/Target="([^"]+)"/) || [])[1];
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
  }
  if (!files[sheetPath]) throw new Error('The Excel file has no worksheet.');
  const sst = files['xl/sharedStrings.xml'] ? td.decode(files['xl/sharedStrings.xml']) : '';
  const shared = [...sst.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => xmlText([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join('')));
  const xml = td.decode(files[sheetPath]);
  const rows = [];
  for (const rm of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const row = [];
    for (const cm of (rm[1] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = (cm[1].match(/\br="([A-Z]+)\d+"/) || [])[1];
      const idx = ref ? colIndex(ref) : row.length;
      while (row.length < idx) row.push('');
      row[idx] = cellValue(cm[1], cm[2] || '', shared).trim();
    }
    rows.push(row);
  }
  while (rows.length && rows[rows.length - 1].every(c => !c)) rows.pop();
  return { sheet: sheetName, rows };
}
