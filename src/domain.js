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

function currencyDigits(currency) {
  if (['JPY', 'KRW', 'VND', 'CLP', 'XOF', 'XAF'].includes(currency)) return 0
  if (['KWD', 'BHD', 'OMR', 'JOD', 'TND'].includes(currency)) return 3
  return 2
}

function toMinorUnits(value, digits, field) {
  if (!Number.isFinite(value) || value < 0) throw new Error(\`\${field} 必须是大于或等于 0 的有效数字。\`)
  const text = String(value)
  const match = text.match(/^(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i)
  if (!match) throw new Error(\`\${field} 金额格式无效。\`)
  const fraction = match[2] || ''
  const exponent = Number(match[3] || 0)
  const allDigits = BigInt(match[1] + fraction)
  const scale = fraction.length - exponent
  if (scale <= digits) return allDigits * (10n ** BigInt(digits - scale))
  const divisor = 10n ** BigInt(scale - digits)
  const quotient = allDigits / divisor
  const remainder = allDigits % divisor
  return quotient + (remainder * 2n >= divisor ? 1n : 0n)
}

function fromMinorUnits(value, digits) {
  const base = 10n ** BigInt(digits)
  const whole = value / base
  const fraction = (value % base).toString().padStart(digits, '0')
  return digits ? \`\${whole}.\${fraction}\` : whole.toString()
}

export function calculateQuote(input) {
  if (!input || !['FOB', 'CIF', 'CIP'].includes(input.incoterm)) throw new Error('贸易术语仅支持 FOB/CIF/CIP（Incoterms 2020）。')
  if (typeof input.currency !== 'string' || !/^[A-Z]{3}$/.test(input.currency)) throw new Error('必须提供三位大写货币代码，例如 USD。')
  if (['FOB', 'CIF'].includes(input.incoterm) && input.transport_mode && !['sea', 'inland_waterway'].includes(input.transport_mode)) throw new Error('FOB/CIF 仅适用于海运或内河水运；其他运输方式请评估 FCA/CPT/CIP。')
  const digits = currencyDigits(input.currency)
  const required = ['vehicle_cost', 'sale_price']
  const fields = ['vehicle_cost', 'origin_inland', 'export_clearance', 'loading', 'inspection', 'bank_fee', 'commission', 'other_seller_costs', 'freight', 'insurance']
  const amounts = {}
  for (const field of fields) {
    if (required.includes(field) || input[field] !== undefined) amounts[field] = toMinorUnits(input[field] ?? 0, digits, field)
    else amounts[field] = 0n
  }
  if (['CIF', 'CIP'].includes(input.incoterm) && (input.freight === undefined || input.insurance === undefined)) throw new Error('CIF/CIP 计算必须提供实际运输费用和保险费用；不得自动估算。')
  const sellerCostKeys = ['vehicle_cost', 'origin_inland', 'export_clearance', 'loading', 'inspection', 'bank_fee', 'commission', 'other_seller_costs']
  if (['CIF', 'CIP'].includes(input.incoterm)) sellerCostKeys.push('freight', 'insurance')
  const totalCost = sellerCostKeys.reduce((sum, key) => sum + amounts[key], 0n)
  const profit = amounts.sale_price - totalCost
  const margin = amounts.sale_price > 0n ? Number((profit * 10000n) / amounts.sale_price) / 100 : null
  const minimum = input.minimum_margin_percent ?? 0
  if (!Number.isFinite(minimum) || minimum < 0 || minimum > 100) throw new Error('最低利润率必须在 0 到 100 之间。')
  const warnings = []
  if (input.incoterm === 'FOB') {
    warnings.push('FOB：仅适用于海运/内河水运；卖方费用计至装运港货物装上船，风险在装上船时转移。海运费与保险费不计入 FOB 卖方成本。')
    if (!input.transport_mode) warnings.push('尚未确认运输方式；请核实为海运或内河水运。')
  }
  if (input.incoterm === 'CIF') {
    warnings.push('CIF：仅适用于海运/内河水运；卖方支付至指定目的港的运费和保险费，但风险仍在装运港货物装上船时转移。')
    if (!input.transport_mode) warnings.push('尚未确认运输方式；请核实为海运或内河水运。')
  }
  if (input.incoterm === 'CIP') warnings.push('CIP：适用于任何运输方式；卖方支付至指定目的地的运输和保险，风险在交给第一承运人时转移。')
  const requiredClause = input.incoterm === 'CIF' ? ['ICC(C)', 'ICC C'] : ['ICC(A)', 'ICC A']
  if (['CIF', 'CIP'].includes(input.incoterm)) {
    if (input.insurance_coverage_percent !== undefined && (!Number.isFinite(input.insurance_coverage_percent) || input.insurance_coverage_percent < 110)) throw new Error('Incoterms 2020 通常要求保险金额至少为合同价的 110%；低于该值需核实合同是否另有约定。')
    if (input.insurance_coverage_percent === undefined) warnings.push('未提供保险金额比例；通常至少按合同价 110% 投保，需核对保险凭证和合同约定。')
    if (!input.insurance_clause) warnings.push(\`未提供保险条款；\${input.incoterm} 通常分别要求较低的 ICC(C) 或较高的 ICC(A) 保障，需核对保单及合同。\`)
    else if (!requiredClause.some(item => String(input.insurance_clause).toUpperCase().includes(item.toUpperCase()))) warnings.push(\`所填保险条款与 \${input.incoterm} 通常要求的保障范围不同，请人工核对是否有合同特别约定。\`)
  }
  if (margin !== null && margin < minimum) warnings.push('当前毛利率低于设定的最低利润率门槛。')
  if (input.incoterm === 'FOB' && (amounts.freight > 0n || amounts.insurance > 0n)) warnings.push('已输入的海运费/保险费未计入 FOB 卖方成本；请确认它们是否应作为买方承担费用或另行列示。')
  const costBreakdown = Object.fromEntries(fields.map(key => [key, fromMinorUnits(amounts[key], digits)]))
  return {
    incoterm: input.incoterm, incoterms_version: '2020', currency: input.currency, currency_minor_digits: digits,
    seller_costs: costBreakdown, total_seller_cost: fromMinorUnits(totalCost, digits),
    sale_price: fromMinorUnits(amounts.sale_price, digits), gross_profit: fromMinorUnits(profit, digits),
    gross_margin_percent: margin, minimum_margin_percent: minimum,
    meets_minimum_margin: margin !== null && margin >= minimum,
    insurance_clause: input.insurance_clause || null, insurance_coverage_percent: input.insurance_coverage_percent ?? null,
    warnings, customer_quote_generated: false
  }
}

export function validateSalesLesson(input) {
  if (!input || typeof input.situation !== 'string' || !input.situation.trim()) throw new Error('必须填写经验发生的销售情境。')
  if (typeof input.lesson !== 'string' || !input.lesson.trim()) throw new Error('必须填写总结出的经验。')
  if (!['won', 'lost', 'pending', 'unknown'].includes(input.outcome || 'unknown')) throw new Error('经验结果只能是 won/lost/pending/unknown。')
  if (!['single_case', 'repeated', 'verified'].includes(input.confidence || 'single_case')) throw new Error('经验可信级别只能是 single_case/repeated/verified。')
  if (['repeated', 'verified'].includes(input.confidence) && (typeof input.evidence !== 'string' || input.evidence.trim().length < 5)) throw new Error('重复规律或已验证经验必须提供至少 5 个字符的去标识化结果证据。')
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
