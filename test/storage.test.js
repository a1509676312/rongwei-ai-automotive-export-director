import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
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
    const result = await store.followup({ customer_id: customer.customer_id, summary: 'Sent vehicle details', evidence: '客户确认收到车型资料', intent_level: 'B', commitments: [
      { category: 'customer', description: 'Confirm quantity' },
      { category: 'company', description: 'Send inspection video' },
      { category: 'mutual', description: 'Review shipping options' }
    ] })
    assert.equal(result.commitments_added, 3)
    const exported = await store.exportAll()
    assert.deepEqual(exported.customers[0].commitments.map(x => x.category), ['customer', 'company', 'mutual'])
    const history = await store.search(customer.customer_id)
    assert.equal(history[0].history.length, 2)
    assert.equal(history[0].history[1].evidence, '客户确认收到车型资料')
  } finally { await rm(directory, { recursive: true, force: true }) }
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
