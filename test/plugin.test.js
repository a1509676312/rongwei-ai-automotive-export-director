import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../src/index.js'

test('Harness plugin registers three working local customer tools', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rongwei-plugin-test-'))
  const previous = process.env.RONGWEI_DATA_DIR
  process.env.RONGWEI_DATA_DIR = directory
  try {
    const tools = new Map()
    apply({ tools: { register(definition) { tools.set(definition.name, definition) } } })
    assert.deepEqual([...tools.keys()].sort(), [
      'rongwei_customer_capture',
      'rongwei_customer_search',
      'rongwei_record_followup'
    ])
    const captured = JSON.parse(await tools.get('rongwei_customer_capture').execute({
      conversation_text: 'Customer asks about exporting a vehicle to Kenya',
      customer_name: 'Test Buyer',
      country: 'Kenya'
    }))
    assert.equal(captured.status, 'created')
    assert.equal(captured.profile.country, 'Kenya')
    assert.equal(captured.event_count, 1)
    const followup = JSON.parse(await tools.get('rongwei_record_followup').execute({
      customer_id: captured.customer_id,
      summary: 'Discussed destination and quantity',
      intent_level: 'B',
      purchase_power: 'unclear',
      customer_commitment: 'Confirm target quantity',
      company_commitment: 'Send vehicle details',
      mutual_commitment: 'Review shipping options'
    }))
    assert.equal(followup.commitments_added, 3)
    const found = JSON.parse(await tools.get('rongwei_customer_search').execute({ query: 'Kenya' }))
    assert.equal(found.count, 1)
    assert.equal(found.customers[0].event_count, 2)
  } finally {
    if (previous === undefined) delete process.env.RONGWEI_DATA_DIR
    else process.env.RONGWEI_DATA_DIR = previous
    await rm(directory, { recursive: true, force: true })
  }
})
