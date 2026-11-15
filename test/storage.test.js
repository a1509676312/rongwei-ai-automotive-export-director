import test from 'node:test'
import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createStore } from '../src/storage.js'

const TEST_KEY = Buffer.alloc(32, 7).toString('base64')
const makeStore = options => createStore({ ...options, keyProvider: async () => TEST_KEY })

test('capture creates a local encrypted customer and preserves raw source events', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rongwei-test-'))
  try {
    const store = makeStore({ directory, clock: () => new Date('2026-11-15T13:00:00.000Z') })
    const created = await store.capture({ conversation_text: '客户询问出口到肯尼亚', customer_name: 'Test Buyer', country: 'Kenya' })
    assert.equal(created.status, 'created')
    assert.equal(created.customer.events[0].rawText, '客户询问出口到肯尼亚')
    const found = await store.search('Kenya')
    assert.equal(found.length, 1)
    assert.equal(found[0].history[0].raw_text, '客户询问出口到肯尼亚')
    const saved = JSON.parse(await readFile(store.file, 'utf8'))
    assert.equal(saved.format, 'rongwei-aes-256-gcm-v1')
    assert.equal(JSON.stringify(saved).includes('客户询问出口到肯尼亚'), false)
    assert.equal((await stat(store.file)).mode & 0o777, 0o600)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('exact contact match updates existing customer instead of creating duplicate', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rongwei-test-'))
  try {
    const store = makeStore({ directory })
    const first = await store.capture({ conversation_text: 'first message', customer_name: 'Buyer A', phone: '+254 700-123-456', country: 'Kenya' })
    const second = await store.capture({ conversation_text: 'second message', phone: '+254700123456', customer_name: 'Buyer A' })
    assert.equal(second.status, 'updated')
    assert.equal(second.matched_by_contact, true)
    assert.equal(second.customer_id, first.customer_id)
    assert.equal((await store.exportAll()).customers.length, 1)
    assert.equal((await store.search('Buyer A'))[0].history.length, 2)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('multiple contact matches are rejected instead of guessing customer identity', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rongwei-test-'))
  try {
    const store = makeStore({ directory })
    await store.capture({ conversation_text: 'first', phone: '10001' })
    await store.capture({ conversation_text: 'second', whatsapp: '10002' })
    await assert.rejects(() => store.capture({ conversation_text: 'ambiguous', phone: '10001', whatsapp: '10002' }), /多个客户/)
    assert.equal((await store.exportAll()).customers.length, 2)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('matching customer and company names without contact details requires manual identity confirmation', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rongwei-test-'))
  try {
    const store = makeStore({ directory })
    await store.capture({ conversation_text: 'first', customer_name: 'Buyer A', company_name: 'Auto Trading Ltd' })
    await assert.rejects(() => store.capture({ conversation_text: 'second', customer_name: 'Buyer A', company_name: 'Auto Trading Ltd' }), /人工确认 customer_id/)
    assert.equal((await store.exportAll()).customers.length, 1)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('unknown explicit customer id is rejected instead of creating a duplicate', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rongwei-test-'))
  try {
    const store = makeStore({ directory })
    await assert.rejects(() => store.capture({ customer_id: 'missing-id', conversation_text: 'new text' }), /不存在/)
    assert.equal((await store.exportAll()).customers.length, 0)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('followup stores customer, company and mutual commitments separately', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rongwei-test-'))
  try {
    const store = makeStore({ directory })
    const customer = await store.capture({ conversation_text: 'first message' })
    const result = await store.followup({ customer_id: customer.customer_id, summary: 'Sent vehicle details', intent_evidence: '客户确认收到车型资料', intent_level: 'B', commitments: [
      { category: 'customer', description: 'Confirm quantity' },
      { category: 'company', description: 'Send inspection video' },
      { category: 'mutual', description: 'Review shipping options' }
    ] })
    assert.equal(result.commitments_added, 3)
    const exported = await store.exportAll()
    assert.deepEqual(exported.customers[0].commitments.map(x => x.category), ['customer', 'company', 'mutual'])
    const history = await store.search(customer.customer_id)
    assert.equal(history[0].history.length, 2)
    assert.equal(history[0].history[1].intent_evidence, '客户确认收到车型资料')
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('sales lessons and destination facts persist locally with evidence classifications', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rongwei-test-'))
  try {
    const store = makeStore({ directory })
    await store.recordSalesLesson({ situation: 'Buyer delays after quotation', lesson: 'Ask who approves and by what date', outcome: 'pending', confidence: 'single_case', country: 'Kenya' })
    await store.recordDestinationFact({ country: 'Kenya', port: 'Mombasa', content: 'Port handling reference from carrier document', evidence_status: 'verified', source: 'Carrier tariff 2026', checked_at: '2026-11-15' })
    assert.equal((await store.searchSalesLessons('Kenya'))[0].confidence, 'single_case')
    const fact = (await store.searchDestinationFacts('Mombasa'))[0]
    assert.equal(fact.evidence_status, 'verified')
    assert.equal(fact.source, 'Carrier tariff 2026')
    assert.equal(fact.effective_status, 'verified')
    const exported = await store.exportAll()
    assert.equal(exported.salesLessons.length, 1)
    assert.equal(exported.destinationFacts.length, 1)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('supplier, company profile, ad attribution and explicit plaintext export are stored locally', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rongwei-test-'))
  try {
    const store = makeStore({ directory })
    await store.upsertCompanyProfile({ display_name: 'Rongwei Auto', minimum_margin_percent: 12 })
    await store.saveSupplier({ name: 'Supplier A', vehicle_model: 'RAV4 Hybrid', vehicle_cost: 18000, currency: 'USD', cost_valid_until: '2026-12-31', source: 'Supplier quotation' })
    await store.capture({ conversation_text: 'Customer from Instagram ad', customer_name: 'Buyer Ad', ad_platform: 'Instagram', ad_source: 'paid', ad_campaign: 'Kenya RAV4 Nov', ad_id: 'creative-01' })
    assert.equal((await store.searchSuppliers('RAV4'))[0].vehicle_cost, 18000)
    assert.equal((await store.searchSuppliers('RAV4'))[0].cost_status, 'valid_or_unspecified')
    await store.capture({ conversation_text: 'Same customer followup from same campaign', customer_id: (await store.search('Buyer Ad'))[0].customer_id, ad_platform: 'Instagram', ad_campaign: 'Kenya RAV4' })
    assert.equal((await store.adAttributionSummary())[0].customer_count, 1)
    const exported = await store.exportPlainJson()
    const file = await readFile(exported.path, 'utf8')
    assert.match(file, /rongwei-plaintext-export-v1/)
    assert.match(file, /Buyer Ad/)
    assert.equal(exported.encrypted, false)
    assert.equal((await stat(exported.path)).mode & 0o777, 0o600)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('commitment status can be completed without deleting its history', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rongwei-test-'))
  try {
    const store = makeStore({ directory })
    const customer = await store.capture({ conversation_text: 'initial' })
    await store.followup({ customer_id: customer.customer_id, summary: 'follow up', commitments: [{ category: 'company', description: 'Send photos' }] })
    const commitment = (await store.search(customer.customer_id))[0].open_commitments[0]
    const result = await store.updateCommitment({ customer_id: customer.customer_id, commitment_id: commitment.id, status: 'completed', note: 'Sent to buyer' })
    assert.equal(result.status, 'completed')
    assert.equal((await store.search(customer.customer_id))[0].open_commitments.length, 0)
    assert.equal((await store.exportAll()).customers[0].commitments[0].update_note, 'Sent to buyer')
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('plaintext export can be imported with merge and an encrypted pre-import snapshot', async () => {
  const sourceDirectory = await mkdtemp(path.join(os.tmpdir(), 'rongwei-source-'))
  const targetDirectory = await mkdtemp(path.join(os.tmpdir(), 'rongwei-target-'))
  try {
    const source = makeStore({ directory: sourceDirectory })
    await source.capture({ conversation_text: 'source customer', customer_name: 'Source Buyer' })
    const exported = await source.exportPlainJson()
    const target = makeStore({ directory: targetDirectory })
    await target.capture({ conversation_text: 'local customer', customer_name: 'Local Buyer' })
    const targetExports = path.join(targetDirectory, 'exports')
    await mkdir(targetExports, { recursive: true })
    await copyFile(exported.path, path.join(targetExports, exported.export_id))
    const imported = await target.importPlainJson(exported.export_id, 'merge')
    assert.equal(imported.imported_customer_count, 1)
    assert.equal(imported.final_customer_count, 2)
    assert.ok(imported.safety_snapshot_id)
    const repeat = await target.importPlainJson(exported.export_id, 'merge')
    assert.equal(repeat.final_customer_count, 2)
    assert.equal((await target.search('Source Buyer')).length, 1)
  } finally {
    await rm(sourceDirectory, { recursive: true, force: true })
    await rm(targetDirectory, { recursive: true, force: true })
  }
})

test('encrypted backup restores safely and snapshots the current database first', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rongwei-test-'))
  try {
    const store = makeStore({ directory })
    await store.capture({ conversation_text: 'first customer' })
    const backup = await store.createBackup()
    await store.capture({ conversation_text: 'second customer' })
    const restored = await store.restoreBackup(backup.backup_id)
    assert.equal(restored.restored_customer_count, 1)
    assert.ok(restored.safety_snapshot_id)
    assert.equal((await store.search('second customer')).length, 0)
    const backups = await store.listBackups()
    assert.ok(backups.some(item => item.backup_id === backup.backup_id))
    assert.ok(backups.some(item => item.backup_id === restored.safety_snapshot_id))
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('backup restore rejects path traversal identifiers', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rongwei-test-'))
  try {
    const store = makeStore({ directory })
    await assert.rejects(() => store.restoreBackup('../customers.json'), /无效/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('wrong encryption key cannot read the customer database', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rongwei-test-'))
  try {
    const store = makeStore({ directory })
    await store.capture({ conversation_text: 'private customer note' })
    const wrong = createStore({ directory, keyProvider: async () => Buffer.alloc(32, 9).toString('base64') })
    await assert.rejects(() => wrong.search('private'), /无法解密/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('corrupt local data is not overwritten', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rongwei-test-'))
  try {
    const file = path.join(directory, 'customers.json')
    await writeFile(file, '{broken', 'utf8')
    const store = makeStore({ directory })
    await assert.rejects(() => store.capture({ conversation_text: 'new data' }), /已损坏/)
    assert.equal(await readFile(file, 'utf8'), '{broken')
  } finally { await rm(directory, { recursive: true, force: true }) }
})
