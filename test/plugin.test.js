import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../src/index.js'

test('Harness plugin registers customer, backup tools, sales guidance and local encryption key', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rongwei-plugin-test-'))
  const previous = process.env.RONGWEI_DATA_DIR
  process.env.RONGWEI_DATA_DIR = directory
  try {
    const tools = new Map()
    const sections = []
    const credentialsStore = new Map()
    apply({
      tools: { register(definition) { tools.set(definition.name, definition) } },
      systemPrompt: { section(section) { sections.push(section) } },
      credentials: {
        async resolve(ref) { const value = credentialsStore.get(ref); return value ? { value } : undefined },
        async set(ref, value) { credentialsStore.set(ref, value) }
      }
    })
    assert.deepEqual([...tools.keys()].sort(), ['rongwei_backup_create', 'rongwei_backup_list', 'rongwei_backup_restore', 'rongwei_customer_capture', 'rongwei_customer_search', 'rongwei_destination_fact_add', 'rongwei_destination_fact_search', 'rongwei_quote_calculate', 'rongwei_record_followup', 'rongwei_sales_lesson_add', 'rongwei_sales_lesson_search'])
    assert.equal(sections.length, 1)
    assert.match(sections[0].text, /至少三种不同策略/)
    assert.match(sections[0].text, /绝不自动发送/)
    assert.match(sections[0].text, /先调用 rongwei_customer_search/)
    assert.match(sections[0].text, /必须提供证据/)
    assert.match(sections[0].text, /目的地知识/)
    assert.match(sections[0].text, /销售经验/)
    const lesson = JSON.parse(await tools.get('rongwei_sales_lesson_add').execute({ situation: 'Buyer delayed decision', lesson: 'Ask for decision date', outcome: 'pending', confidence: 'single_case' }))
    assert.equal(lesson.confidence, 'single_case')
    const lessonSearch = JSON.parse(await tools.get('rongwei_sales_lesson_search').execute({ query: 'decision date' }))
    assert.equal(lessonSearch.lessons.length, 1)
    const destination = JSON.parse(await tools.get('rongwei_destination_fact_add').execute({ country: 'Kenya', port: 'Mombasa', content: 'Carrier-sourced handling note', evidence_status: 'verified', source: 'Carrier tariff 2026' }))
    assert.equal(destination.evidence_status, 'verified')
    const destinationSearch = JSON.parse(await tools.get('rongwei_destination_fact_search').execute({ query: 'Mombasa' }))
    assert.equal(destinationSearch.facts.length, 1)
    const quote = JSON.parse(await tools.get('rongwei_quote_calculate').execute({ incoterm: 'CIF', currency: 'USD', vehicle_cost: 10000, sale_price: 12000, freight: 1000, insurance: 100 }))
    assert.equal(quote.total_seller_cost, 11100)
    assert.equal(quote.customer_quote_generated, false)
    const captured = JSON.parse(await tools.get('rongwei_customer_capture').execute({ conversation_text: 'Customer asks about exporting a vehicle to Kenya', customer_name: 'Test Buyer', country: 'Kenya', phone: '+254 700 123 456' }))
    assert.equal(captured.status, 'created')
    assert.equal(captured.profile.country, 'Kenya')
    assert.equal(captured.event_count, 1)
    assert.equal(credentialsStore.size, 1)
    const duplicate = JSON.parse(await tools.get('rongwei_customer_capture').execute({ conversation_text: 'Customer sent new details', phone: '+254700123456' }))
    assert.equal(duplicate.status, 'updated')
    assert.equal(duplicate.customer_id, captured.customer_id)
    await assert.rejects(() => tools.get('rongwei_record_followup').execute({ customer_id: captured.customer_id, summary: 'Discussed destination and quantity', intent_level: 'B', purchase_power: 'unclear' }), /证据/)
    const followup = JSON.parse(await tools.get('rongwei_record_followup').execute({ customer_id: captured.customer_id, summary: 'Discussed destination and quantity', intent_level: 'B', purchase_power: 'unclear', evidence: 'Customer confirmed first batch of five', customer_commitment: 'Confirm target quantity', company_commitment: 'Send vehicle details', mutual_commitment: 'Review shipping options' }))
    assert.equal(followup.commitments_added, 3)
    const found = JSON.parse(await tools.get('rongwei_customer_search').execute({ query: 'Kenya' }))
    assert.equal(found.count, 1)
    assert.equal(found.customers[0].event_count, 3)
    assert.equal(found.customers[0].history.length, 3)
  } finally {
    if (previous === undefined) delete process.env.RONGWEI_DATA_DIR
    else process.env.RONGWEI_DATA_DIR = previous
    await rm(directory, { recursive: true, force: true })
  }
})
