import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
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
    assert.deepEqual([...tools.keys()].sort(), ['rongwei_ad_attribution_summary', 'rongwei_attachment_capture', 'rongwei_backup_create', 'rongwei_backup_list', 'rongwei_backup_restore', 'rongwei_commitment_update', 'rongwei_company_profile_set', 'rongwei_customer_capture', 'rongwei_customer_search', 'rongwei_data_export', 'rongwei_data_import', 'rongwei_destination_fact_add', 'rongwei_destination_fact_search', 'rongwei_quote_calculate', 'rongwei_record_followup', 'rongwei_sales_lesson_add', 'rongwei_sales_lesson_search', 'rongwei_supplier_save', 'rongwei_supplier_search', 'rongwei_unlocode_import', 'rongwei_unlocode_search'])
    assert.equal(sections.length, 1)
    assert.match(sections[0].text, /至少三种不同策略/)
    assert.match(sections[0].text, /绝不自动发送/)
    assert.match(sections[0].text, /先调用 rongwei_customer_search/)
    assert.match(sections[0].text, /intent_evidence/)
    assert.match(sections[0].text, /purchase_power_evidence/)
    assert.match(sections[0].text, /目的地知识/)
    assert.match(sections[0].text, /销售经验/)
    const company = JSON.parse(await tools.get('rongwei_company_profile_set').execute({ display_name: 'Rongwei Auto', minimum_margin_percent: 12 }))
    assert.equal(company.minimum_margin_percent, 12)
    const supplier = JSON.parse(await tools.get('rongwei_supplier_save').execute({ name: 'Supplier A', vehicle_model: 'RAV4 Hybrid', vehicle_cost: 18000, currency: 'USD', cost_valid_until: '2026-12-31' }))
    assert.equal(supplier.vehicle_cost, 18000)
    assert.equal(JSON.parse(await tools.get('rongwei_supplier_search').execute({ query: 'RAV4' })).suppliers.length, 1)
    const lesson = JSON.parse(await tools.get('rongwei_sales_lesson_add').execute({ situation: 'Buyer delayed decision', lesson: 'Ask for decision date', outcome: 'pending', confidence: 'single_case' }))
    assert.equal(lesson.confidence, 'single_case')
    const lessonSearch = JSON.parse(await tools.get('rongwei_sales_lesson_search').execute({ query: 'decision date' }))
    assert.equal(lessonSearch.lessons.length, 1)
    const destination = JSON.parse(await tools.get('rongwei_destination_fact_add').execute({ country: 'Kenya', port: 'Mombasa', content: 'Carrier-sourced handling note', evidence_status: 'verified', source: 'Carrier tariff 2026' }))
    assert.equal(destination.evidence_status, 'verified')
    const destinationSearch = JSON.parse(await tools.get('rongwei_destination_fact_search').execute({ query: 'Mombasa' }))
    assert.equal(destinationSearch.facts.length, 1)
    const importsDirectory = path.join(directory, 'imports')
    await mkdir(importsDirectory, { recursive: true })
    const unlocodeCsv = [
      'Change,Country,Location,Name,NameWoDiacritics,SubDiv,Function,Status,Date,IATA,Coordinates,Remarks',
      '+,CN,SHA,Shanghai,Shanghai,31,1-------,AI,2501,,3114N 12129E,"Main port, verified code"',
      ',CN,NGB,Ningbo,Ningbo,33,1-------,AI,2501,,2952N 12133E,'
    ].join('\n')
    await writeFile(path.join(importsDirectory, 'unlocode.csv'), unlocodeCsv, 'utf8')
    const sourceUrl = 'https://unlocode.unece.org/publications/'
    const importedLocations = JSON.parse(await tools.get('rongwei_unlocode_import').execute({ file_name: 'unlocode.csv', release_label: 'UN/LOCODE 2025-1', source_url: sourceUrl }))
    assert.equal(importedLocations.imported_count, 2)
    assert.equal(importedLocations.inserted_count, 2)
    const locationSearch = JSON.parse(await tools.get('rongwei_unlocode_search').execute({ query: 'Shanghai' }))
    assert.equal(locationSearch.entries[0].code, 'CNSHA')
    assert.equal(locationSearch.entries[0].remarks, 'Main port, verified code')
    const importedAgain = JSON.parse(await tools.get('rongwei_unlocode_import').execute({ file_name: 'unlocode.csv', release_label: 'UN/LOCODE 2025-1', source_url: sourceUrl }))
    assert.equal(importedAgain.inserted_count, 0)
    assert.equal(importedAgain.updated_count, 2)
    await assert.rejects(() => tools.get('rongwei_unlocode_import').execute({ file_name: '../unlocode.csv', release_label: 'bad', source_url: sourceUrl }), /文件名无效/)
    await assert.rejects(() => tools.get('rongwei_unlocode_import').execute({ file_name: 'unlocode.csv', release_label: 'bad', source_url: 'https://example.com/' }), /官方域名/)
    const quote = JSON.parse(await tools.get('rongwei_quote_calculate').execute({ incoterm: 'CIF', currency: 'USD', vehicle_cost: 10000, sale_price: 12000, freight: 1000, insurance: 100 }))
    assert.equal(quote.total_seller_cost, '11100.00')
    assert.equal(quote.customer_quote_generated, false)
    const captured = JSON.parse(await tools.get('rongwei_customer_capture').execute({ conversation_text: 'Customer asks about exporting a vehicle to Kenya', customer_name: 'Test Buyer', country: 'Kenya', phone: '+254 700 123 456', ad_platform: 'Instagram', ad_campaign: 'Kenya RAV4' }))
    assert.equal(captured.status, 'created')
    assert.equal(captured.profile.country, 'Kenya')
    assert.equal(captured.event_count, 1)
    assert.equal(credentialsStore.size, 1)
    assert.equal(JSON.parse(await tools.get('rongwei_ad_attribution_summary').execute({})).attribution[0].customer_count, 1)
    const attachment = JSON.parse(await tools.get('rongwei_attachment_capture').execute({ conversation_text: 'Vehicle registration shows Toyota RAV4 Hybrid', document_name: 'registration.pdf', mime_type: 'application/pdf', extraction_method: 'document_text_layer', confidence: 0.96, customer_id: captured.customer_id }))
    assert.equal(attachment.attachment.document_name, 'registration.pdf')
    await assert.rejects(() => tools.get('rongwei_attachment_capture').execute({ conversation_text: 'unknown', document_name: 'scan.pdf', extraction_method: 'model_ocr', confidence: 2 }), /confidence/)
    const duplicate = JSON.parse(await tools.get('rongwei_customer_capture').execute({ conversation_text: 'Customer sent new details', phone: '+254700123456' }))
    assert.equal(duplicate.status, 'updated')
    assert.equal(duplicate.customer_id, captured.customer_id)
    await assert.rejects(() => tools.get('rongwei_record_followup').execute({ customer_id: captured.customer_id, summary: 'Discussed destination and quantity', intent_level: 'B', purchase_power: 'unclear' }), /意向证据/)
    const followup = JSON.parse(await tools.get('rongwei_record_followup').execute({ customer_id: captured.customer_id, summary: 'Discussed destination and quantity', intent_level: 'B', purchase_power: 'unclear', intent_evidence: 'Customer confirmed first batch of five', purchase_power_evidence: 'Buyer confirmed budget approval by finance', customer_commitment: 'Confirm target quantity', company_commitment: 'Send vehicle details', mutual_commitment: 'Review shipping options' }))
    assert.equal(followup.commitments_added, 3)
    const commitment = JSON.parse(await tools.get('rongwei_customer_search').execute({ query: 'Kenya' })).customers[0].open_commitments[0]
    const updatedCommitment = JSON.parse(await tools.get('rongwei_commitment_update').execute({ customer_id: captured.customer_id, commitment_id: commitment.id, status: 'completed', note: 'Confirmed sent' }))
    assert.equal(updatedCommitment.status, 'completed')
    await assert.rejects(() => tools.get('rongwei_data_export').execute({ confirm_plaintext_export: false }), /明确确认/)
    await assert.rejects(() => tools.get('rongwei_data_import').execute({ export_id: 'bad.json', mode: 'merge', confirm_import: false }), /明确确认/)
    const exportResult = JSON.parse(await tools.get('rongwei_data_export').execute({ confirm_plaintext_export: true }))
    assert.equal(exportResult.encrypted, false)
    const found = JSON.parse(await tools.get('rongwei_customer_search').execute({ query: 'Kenya' }))
    assert.equal(found.count, 1)
    assert.equal(found.customers[0].event_count, 4)
    assert.equal(found.customers[0].history.length, 4)
  } finally {
    if (previous === undefined) delete process.env.RONGWEI_DATA_DIR
    else process.env.RONGWEI_DATA_DIR = previous
    await rm(directory, { recursive: true, force: true })
  }
})
