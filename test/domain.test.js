import test from 'node:test'
import assert from 'node:assert/strict'
import { validateCapture, validateFollowup } from '../src/domain.js'

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
  assert.equal(validateFollowup({ customer_id: 'c1', summary: 'call', intent_level: 'A', purchase_power: 'unclear' }).intent_level, 'A')
})

test('followup rejects invalid commitment categories', () => {
  assert.throws(() => validateFollowup({ customer_id: 'c1', summary: 'call', commitments: [{ category: 'other', description: 'x' }] }), /类别/)
})
