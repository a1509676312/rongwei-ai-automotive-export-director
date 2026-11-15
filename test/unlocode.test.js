import test from 'node:test'
import assert from 'node:assert/strict'
import { parseUNLOCODECsv } from '../src/unlocode.js'
const header = 'Change,Country,Location,Name,NameWoDiacritics,SubDiv,Function,Status,Date,IATA,Coordinates,Remarks'
test('parses UNECE 12-column records, quoted commas and escaped quotes', () => {
  const csv = [header, '+,CN,SHA,Shanghai,Shanghai,31,1-------,AI,2501,,3114N 12129E,"Main, ""deep-water"" port"', ',CN,NGB,Ningbo,Ningbo,33,1-------,AI,2501,,2952N 12133E,'].join('\n')
  const parsed = parseUNLOCODECsv(csv)
  assert.equal(parsed.entries.length, 2)
  assert.equal(parsed.entries[0].code, 'CNSHA')
  assert.equal(parsed.entries[0].remarks, 'Main, "deep-water" port')
  assert.equal(parsed.entries[1].function, '1-------')
})
test('skips country marker rows and accepts a headerless release file', () => {
  const parsed = parseUNLOCODECsv([',CN,,.CHINA,,,,,,,,', ',CN,SHA,Shanghai,Shanghai,31,1-------,AI,2501,,3114N 12129E,'].join('\n'))
  assert.equal(parsed.entries.length, 1)
  assert.equal(parsed.skipped_rows, 1)
})
test('rejects invalid fields and duplicate location codes without partial results', () => {
  const bad = [header, ',CN,SHA,Shanghai,Shanghai,31,1-------,AI,2501,,bad-coordinates,', ',CN,SHA,Shanghai duplicate,Shanghai,31,1-------,AI,2501,,3114N 12129E,'].join('\n')
  assert.throws(() => parseUNLOCODECsv(bad), /未导入任何记录/)
})
