export const INTENT_LEVELS = Object.freeze(['S', 'A', 'B', 'C', 'D'])
export const PURCHASE_POWER_LEVELS = Object.freeze(['confirmed', 'likely', 'unclear', 'low'])
export const COMMITMENT_CATEGORIES = Object.freeze(['customer', 'company', 'mutual'])

export function validateCapture(input) {
  if (!input || typeof input !== 'object') throw new Error('提交内容无效。')
  if (typeof input.conversation_text !== 'string' || !input.conversation_text.trim()) throw new Error('必须包含客户聊天或业务内容。')
  if (input.conversation_text.length > 30000) throw new Error('单次提交内容不能超过 30,000 个字符，请分段提交。')
  if (input.customer_id && (typeof input.customer_id !== 'string' || input.customer_id.length > 100)) throw new Error('customer_id 格式无效。')
  return { ...input, conversation_text: input.conversation_text.trim() }
}

export function validateFollowup(input) {
  if (!input || typeof input.customer_id !== 'string' || !input.customer_id.trim()) throw new Error('必须提供 customer_id。')
  if (typeof input.summary !== 'string' || !input.summary.trim()) throw new Error('必须填写本次跟进摘要。')
  if (input.intent_level && !INTENT_LEVELS.includes(input.intent_level)) throw new Error('意向等级只能为 S/A/B/C/D。')
  if (input.purchase_power && !PURCHASE_POWER_LEVELS.includes(input.purchase_power)) throw new Error('购买力只能为 confirmed/likely/unclear/low。')
  if (input.next_followup_at && !/^\\d{4}-\\d{2}-\\d{2}(T.*)?$/.test(input.next_followup_at)) throw new Error('下次跟进时间必须使用 ISO 日期或日期时间。')
  const commitments = input.commitments || []
  if (!Array.isArray(commitments) || commitments.length > 20) throw new Error('承诺事项最多 20 条。')
  for (const item of commitments) {
    if (!COMMITMENT_CATEGORIES.includes(item.category)) throw new Error('承诺事项类别必须是 customer/company/mutual。')
    if (typeof item.description !== 'string' || !item.description.trim()) throw new Error('每条承诺事项都必须填写内容。')
  }
  return input
}
