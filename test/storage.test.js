import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createStore } from '../src/storage.js'

test('capture creates a local customer and preserves raw source events', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rongwei-test-'))
  try {
    const store = createStore({ directory, clock: () => new Date('2026-11-15T13:00:00.000Z') })
    const created = await store.capture({ conversation_text: '客户询问出口到肯尼亚', customer_name: 'Test Buyer', country: 'Kenya' })
    assert.equal(created.status, 'created')
    assert.equal(created.customer.events[0].rawText, '客户询问出口到肯尼亚')
    const found = await store.search('Kenya')
    assert.equal(found.length, 1)
    const saved = JSON.parse(await readFile(store.file, 'utf8'))
    assert.equal(saved.customers[0].profile.customer_name, 'Test Buyer')
    assert.equal((await stat(store.file)).mode & 0o777, 0o600)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('unknown explicit customer id is rejected instead of creating a duplicate', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rongwei-test-'))
  try {
    const store = createStore({ directory })
    await assert.rejects(() => store.capture({ customer_id: 'missing-id', conversation_text: 'new text' }), /不存在/)
    assert.equal((await store.exportAll()).customers.length, 0)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('followup stores customer, company and mutual commitments separately', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rongwei-test-'))
  try {
    const store = createStore({ directory })
    const customer = await store.capture({ conversation_text: 'first message' })
    const result = await store.followup({ customer_id: customer.customer_id, summary: 'Sent vehicle details', commitments: [
      { category: 'customer', description: 'Confirm quantity' },
      { category: 'company', description: 'Send inspection video' },
      { category: 'mutual', description: 'Review shipping options' }
    ] })
    assert.equal(result.commitments_added, 3)
    const exported = await store.exportAll()
    assert.deepEqual(exported.customers[0].commitments.map(x => x.category), ['customer', 'company', 'mutual'])
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('corrupt local data is not overwritten', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rongwei-test-'))
  try {
    const file = path.join(directory, 'customers.json')
    await writeFile(file, '{broken', 'utf8')
    const store = createStore({ directory })
    await assert.rejects(() => store.capture({ conversation_text: 'new data' }), /已损坏/)
    assert.equal(await readFile(file, 'utf8'), '{broken')
  } finally { await rm(directory, { recursive: true, force: true }) }
})
