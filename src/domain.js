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
  if (input.intent_level || input.purchase_power) {
    if (typeof input.evidence !== 'string' || input.evidence.trim().length < 5) {
      throw new Error('填写意向等级或购买力判断时，必须提供至少 5 个字符的原话或事实证据；证据不足请留空不评级。')
    }
  }
  if (input.next_followup_at && !/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(input.next_followup_at)) throw new Error('下次跟进时间必须使用 ISO 日期或日期时间。')
  const commitments = input.commitments || []
  if (!Array.isArray(commitments) || commitments.length > 20) throw new Error('承诺事项最多 20 条。')
  for (const item of commitments) {
    if (!COMMITMENT_CATEGORIES.includes(item.category)) throw new Error('承诺事项类别必须是 customer/company/mutual。')
    if (typeof item.description !== 'string' || !item.description.trim()) throw new Error('每条承诺事项都必须填写内容。')
  }
  return input
}

export function calculateQuote(input) {
  if (!input || !['FOB', 'CIF', 'CIP'].includes(input.incoterm)) throw new Error('贸易术语仅支持 FOB/CIF/CIP（Incoterms 2020）。')
  if (typeof input.currency !== 'string' || !/^[A-Z]{3}$/.test(input.currency)) throw new Error('必须提供三位大写货币代码，例如 USD。')
  const required = ['vehicle_cost', 'sale_price']
  for (const key of required) {
    if (!Number.isFinite(input[key]) || input[key] < 0) throw new Error(`${key} 必须是大于或等于 0 的数字。`)
  }
  const costFields = ['origin_inland', 'export_clearance', 'loading', 'freight', 'insurance']
  for (const key of costFields) {
    if (input[key] !== undefined && (!Number.isFinite(input[key]) || input[key] < 0)) throw new Error(`${key} 必须是大于或等于 0 的数字。`)
  }
  if (['CIF', 'CIP'].includes(input.incoterm) && (!Number.isFinite(input.freight) || !Number.isFinite(input.insurance))) {
    throw new Error('CIF/CIP 计算必须提供实际运输费用和保险费用；不得自动估算。')
  }
  const sellerCosts = input.vehicle_cost + (input.origin_inland || 0) + (input.export_clearance || 0) + (input.loading || 0)
  const totalSellerCost = sellerCosts + (['CIF', 'CIP'].includes(input.incoterm) ? input.freight + input.insurance : 0)
  const grossProfit = input.sale_price - totalSellerCost
  const marginPercent = input.sale_price > 0 ? grossProfit / input.sale_price * 100 : null
  const minimum = input.minimum_margin_percent ?? 0
  if (!Number.isFinite(minimum) || minimum < 0 || minimum > 100) throw new Error('最低利润率必须在 0 到 100 之间。')
  const warnings = []
  if (input.incoterm === 'FOB') warnings.push('FOB：卖方费用通常计至装运港货物装上船；风险在货物装上船时转移。海运费与保险费不计入本次卖方 FOB 成本。')
  if (input.incoterm === 'CIF') warnings.push('CIF：卖方支付至指定目的港的运费并按规则投保最低保险保障（通常为 ICC(C)，保险金额通常至少为合同价的 110%，除非另有约定）；风险仍在装运港货物装上船时转移。')
  if (input.incoterm === 'CIP') warnings.push('CIP：卖方支付至指定目的地的运输并按规则投保较高保险保障（通常为 ICC(A)，保险金额通常至少为合同价的 110%，除非另有约定）；风险在货物交给第一承运人时转移。')
  if (marginPercent !== null && marginPercent < minimum) warnings.push('当前毛利率低于设定的最低利润率门槛。')
  if (input.incoterm === 'FOB' && ((input.freight || 0) > 0 || (input.insurance || 0) > 0)) warnings.push('已输入的海运费/保险费未计入 FOB 卖方成本；请确认它们是否应作为买方承担费用或另行列示。')
  return {
    incoterm: input.incoterm, incoterms_version: '2020', currency: input.currency,
    seller_costs: { vehicle: input.vehicle_cost, origin_inland: input.origin_inland || 0, export_clearance: input.export_clearance || 0, loading: input.loading || 0, freight: ['CIF', 'CIP'].includes(input.incoterm) ? input.freight : 0, insurance: ['CIF', 'CIP'].includes(input.incoterm) ? input.insurance : 0 },
    total_seller_cost: Number(totalSellerCost.toFixed(2)), sale_price: input.sale_price,
    gross_profit: Number(grossProfit.toFixed(2)), gross_margin_percent: marginPercent === null ? null : Number(marginPercent.toFixed(2)),
    minimum_margin_percent: minimum, meets_minimum_margin: marginPercent !== null && marginPercent >= minimum,
    warnings, customer_quote_generated: false
  }
}

export function validateSalesLesson(input) {
  if (!input || typeof input.situation !== 'string' || !input.situation.trim()) throw new Error('必须填写经验发生的销售情境。')
  if (typeof input.lesson !== 'string' || !input.lesson.trim()) throw new Error('必须填写总结出的经验。')
  if (!['won', 'lost', 'pending', 'unknown'].includes(input.outcome || 'unknown')) throw new Error('经验结果只能是 won/lost/pending/unknown。')
  if (!['single_case', 'repeated', 'verified'].includes(input.confidence || 'single_case')) throw new Error('经验可信级别只能是 single_case/repeated/verified。')
  return { ...input, situation: input.situation.trim(), lesson: input.lesson.trim() }
}

export function validateDestinationFact(input) {
  if (!input || typeof input.country !== 'string' || !input.country.trim()) throw new Error('目的地资料必须填写国家。')
  if (typeof input.content !== 'string' || !input.content.trim()) throw new Error('目的地资料内容不能为空。')
  if (!['verified', 'historical', 'ai_estimate', 'expired'].includes(input.evidence_status)) throw new Error('资料状态只能是 verified/historical/ai_estimate/expired。')
  if (input.evidence_status === 'verified' && (!input.source || !String(input.source).trim())) throw new Error('标记为已核实的资料必须填写来源。')
  if (input.expires_at && !/^\\d{4}-\\d{2}-\\d{2}$/.test(input.expires_at)) throw new Error('资料有效期必须使用 YYYY-MM-DD。')
  return { ...input, country: input.country.trim(), content: input.content.trim() }
}
