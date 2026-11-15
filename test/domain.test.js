import test from 'node:test'
import assert from 'node:assert/strict'
import { validateCapture, validateFollowup, calculateQuote } from '../src/domain.js'

test('capture requires non-empty original content', () => {
  assert.throws(() => validateCapture({ conversation_text: '  ' }), /必须包含/)
  assert.equal(validateCapture({ conversation_text: ' 客户询问车型 ' }).conversation_text, '客户询问车型')
})

test('capture rejects oversized content', () => {
  assert.throws(() => validateCapture({ conversation_text: 'x'.repeat(30001) }), /30,000/)
})

test('followup keeps intent and purchasing power as separate validated fields', () => {
  assert.throws(() => validateFollowup({ customer_id: 'c1', summary: 'call', intent_level: 'X' }), /S\/A\/B\/C\/D/)
  assert.throws(() => validateFollowup({ customer_id: 'c1', summary: 'call', purchase_power: 'rich' }), /购买力/)
  assert.throws(() => validateFollowup({ customer_id: 'c1', summary: 'call', intent_level: 'A' }), /证据/)
  assert.throws(() => validateFollowup({ customer_id: 'c1', summary: 'call', purchase_power: 'unclear', evidence: '好' }), /证据/)
  assert.equal(validateFollowup({ customer_id: 'c1', summary: 'call', intent_level: 'A', purchase_power: 'unclear', evidence: '客户确认先采购5台' }).intent_level, 'A')
  assert.equal(validateFollowup({ customer_id: 'c1', summary: 'call' }).purchase_power, undefined)
})

test('followup rejects invalid commitment categories', () => {
  assert.throws(() => validateFollowup({ customer_id: 'c1', summary: 'call', commitments: [{ category: 'other', description: 'x' }] }), /类别/)
})

test('quote calculator applies FOB, CIF and CIP seller-cost boundaries without inventing prices', () => {
  const fob = calculateQuote({ incoterm: 'FOB', currency: 'USD', transport_mode: 'sea', vehicle_cost: 10000.10, sale_price: 12000.10, origin_inland: 500.20, freight: 1000, insurance: 100, minimum_margin_percent: 10 })
  assert.equal(fob.total_seller_cost, '10500.30')
  assert.equal(fob.gross_profit, '1499.80')
  assert.equal(fob.meets_minimum_margin, true)
  assert.equal(fob.customer_quote_generated, false)
  const cif = calculateQuote({ incoterm: 'CIF', currency: 'USD', transport_mode: 'sea', vehicle_cost: 10000, sale_price: 12000, freight: 1000, insurance: 100, insurance_clause: 'ICC(C)', insurance_coverage_percent: 110 })
  assert.equal(cif.total_seller_cost, '11100.00')
  const cip = calculateQuote({ incoterm: 'CIP', currency: 'USD', vehicle_cost: 10000, sale_price: 12000, freight: 800, insurance: 200, insurance_clause: 'ICC(A)', insurance_coverage_percent: 110 })
  assert.equal(cip.total_seller_cost, '11000.00')
  assert.throws(() => calculateQuote({ incoterm: 'CIF', currency: 'USD', transport_mode: 'sea', vehicle_cost: 10000, sale_price: 12000, freight: 100 }), /实际运输费用和保险费用/)
  assert.throws(() => calculateQuote({ incoterm: 'FOB', currency: 'USD', transport_mode: 'air', vehicle_cost: 10000, sale_price: 12000 }), /仅适用于海运/)
  assert.throws(() => calculateQuote({ incoterm: 'CIF', currency: 'USD', transport_mode: 'sea', vehicle_cost: 10000, sale_price: 12000, freight: 1000, insurance: 100, insurance_coverage_percent: 100 }), /至少为合同价的 110%/)
  const jpy = calculateQuote({ incoterm: 'FOB', currency: 'JPY', transport_mode: 'sea', vehicle_cost: 100000, sale_price: 120000 })
  assert.equal(jpy.total_seller_cost, '100000')
  assert.throws(() => calculateQuote({ incoterm: 'DAP', currency: 'USD', vehicle_cost: 1, sale_price: 2 }), /FOB\/CIF\/CIP/)
})

test('sales lesson and destination fact validation keeps confidence and evidence status explicit', async () => {
  const { validateSalesLesson, validateDestinationFact } = await import('../src/domain.js')
  assert.equal(validateSalesLesson({ situation: 'Customer delayed decision', lesson: 'Ask for exact decision date' }).confidence, undefined)
  assert.throws(() => validateSalesLesson({ situation: 's', lesson: 'l', outcome: 'guaranteed' }), /结果/)
  assert.throws(() => validateSalesLesson({ situation: 's', lesson: 'l', confidence: 'verified' }), /证据/)
  assert.throws(() => validateSalesLesson({ situation: 'buyer@example.com', lesson: 'do not store PII' }), /去标识化/)
  assert.throws(() => validateSalesLesson({ situation: 'buyer contact 1234567890', lesson: 'follow up' }), /去标识化/)
  assert.throws(() => validateDestinationFact({ country: 'Kenya', content: 'Port notes', evidence_status: 'verified' }), /来源/)
  assert.equal(validateDestinationFact({ country: 'Kenya', content: 'Port notes', evidence_status: 'historical' }).evidence_status, 'historical')
  assert.throws(() => validateDestinationFact({ country: 'Kenya', content: 'Port notes', evidence_status: 'historical', expires_at: 'not-a-date' }), /YYYY-MM-DD/)
})
