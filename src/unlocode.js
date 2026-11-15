const COLUMN_COUNT = 12
const MAX_PARSE_ERRORS = 8
function parseCsvRows(input) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('UN/LOCODE CSV 文件内容为空。')
  const text = input.replace(/^\uFEFF/, '')
  const rows = []
  let fields = [], field = '', quoted = false, line = 1, recordLine = 1
  const pushField = () => { fields.push(field.trim()); field = '' }
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1 }
        else quoted = false
      } else if (ch === '\r' || ch === '\n') {
        if (ch === '\r' && text[i + 1] === '\n') i += 1
        field += '\n'; line += 1
      } else field += ch
      continue
    }
    if (ch === '"') {
      if (field.length !== 0) throw new Error('CSV 第 ' + line + ' 行存在未转义的引号。')
      quoted = true
    } else if (ch === ',') pushField()
    else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1
      pushField()
      if (fields.some(value => value !== '')) rows.push({ line: recordLine, fields })
      fields = []; line += 1; recordLine = line
    } else field += ch
  }
  if (quoted) throw new Error('CSV 第 ' + recordLine + ' 行开始的引号没有闭合。')
  if (field !== '' || fields.length > 0) {
    pushField()
    if (fields.some(value => value !== '')) rows.push({ line: recordLine, fields })
  }
  return rows
}
function isHeader(fields) {
  const values = fields.map(value => value.toLocaleLowerCase().replace(/[ _]/g, ''))
  return values.includes('country') && values.includes('location') && values.includes('function')
}
function validateRow(row) {
  const f = row.fields
  if (f.length !== COLUMN_COUNT) throw new Error('应为 12 列，实际为 ' + f.length + ' 列')
  const [change, countryRaw, locationRaw, name, nameWithoutDiacritics, subdivision, functionRaw, statusRaw, date, iata, coordinates, remarks] = f
  const country = countryRaw.toUpperCase(), location = locationRaw.toUpperCase()
  if (!location && name.startsWith('.')) return { skipped: true }
  if (!/^[A-Z]{2}$/.test(country)) throw new Error('国家代码必须是 ISO 3166-1 两位字母代码')
  if (!/^[A-Z0-9]{3}$/.test(location)) throw new Error('地点代码必须为 3 位大写字母或数字')
  if (!name) throw new Error('地点名称不能为空')
  if (subdivision && !/^[A-Z0-9]{1,3}$/i.test(subdivision)) throw new Error('Subdivision 必须为 1–3 位字母或数字')
  const functionCode = functionRaw.toUpperCase()
  if (!/^[0-8A-]{8}$/.test(functionCode) || !/^[0-8A]/.test(functionCode)) throw new Error('Function 必须是含有效功能位的 8 位位置编码')
  const status = statusRaw.toUpperCase()
  if (!/^[A-Z]{2}$/.test(status)) throw new Error('Status 必须为两位字母状态代码')
  if (date && !/^\d{4}$/.test(date)) throw new Error('Date 必须使用 YYMM 四位格式')
  const iataCode = iata.toUpperCase()
  if (iataCode && !/^[A-Z0-9]{3}$/.test(iataCode)) throw new Error('IATA 字段必须为空或 3 位代码')
  if (coordinates && !/^\d{4}[NS]\s+\d{5}[EW]$/i.test(coordinates)) throw new Error('Coordinates 必须类似 3114N 12129E')
  if (change && !['+', '#', 'X', '|', '=', '!'].includes(change)) throw new Error('Change 字段包含未知变更标记')
  return { skipped: false, entry: {
    code: country + location, country_code: country, location_code: location, name,
    name_without_diacritics: nameWithoutDiacritics || name, subdivision: subdivision || null,
    function: functionCode, status, date: date || null, iata: iataCode || null,
    coordinates: coordinates || null, remarks: remarks || null, change: change || null
  } }
}
// Parses the published UNECE UN/LOCODE 12-column CSV/TXT layout.
export function parseUNLOCODECsv(input) {
  const rows = parseCsvRows(input), entries = [], seen = new Set(), errors = []
  let skippedRows = 0, firstDataRow = true
  for (const row of rows) {
    if (firstDataRow && isHeader(row.fields)) { firstDataRow = false; skippedRows += 1; continue }
    firstDataRow = false
    try {
      const parsed = validateRow(row)
      if (parsed.skipped) { skippedRows += 1; continue }
      if (seen.has(parsed.entry.code)) throw new Error('地点代码 ' + parsed.entry.code + ' 在文件中重复')
      seen.add(parsed.entry.code); entries.push(parsed.entry)
    } catch (error) {
      if (errors.length < MAX_PARSE_ERRORS) errors.push('第 ' + row.line + ' 行：' + error.message)
    }
  }
  if (errors.length) throw new Error('UN/LOCODE 文件校验失败，未导入任何记录：\n' + errors.join('\n'))
  if (!entries.length) throw new Error('文件中没有可导入的 UN/LOCODE 地点记录。')
  return { entries, skipped_rows: skippedRows, source_row_count: rows.length }
}
