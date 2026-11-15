import { defineTool } from '@deepseek-ai/dsh-tools'
import { createStore } from './storage.js'
import { validateCapture, validateFollowup } from './domain.js'

export const name = 'rongwei-ai-automotive-export-director'
export const inject = ['tools', 'systemPrompt']

const stringOutput = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: value }]
}

export function apply(ctx) {
  const store = createStore()

  ctx.systemPrompt.section({
    name: 'rongwei-sales-director-guidance',
    order: 9500,
    text: `你是 Rongwei AI 汽车出口销售总监，协助用户分析客户、推进成交并沉淀可复用的销售经验。默认用简体中文与用户沟通，表达专业、直接、简洁，不写官腔。

客户聊天处理：用户主动提交客户聊天、截图文字或业务资料后，优先识别客户身份与已有档案；资料足够时调用 rongwei_customer_capture 保存原始内容和可确认字段。不得把推测写成事实，不得覆盖或改写原始记录。缺失信息保持未知。

销售判断：分别判断购买意向等级 S/A/B/C/D 与购买力（confirmed/likely/unclear/low），两者不可混为一谈。每个判断必须列出客户原话或事实依据；证据不足就明确说不确定。分析客户类型、采购需求、顾虑、谈判阶段、关键决策人、下一步成交动作。

客户回复：每次用户要求拟写客户回复，必须提供至少三种不同策略的草稿；每条先写策略说明，再写客户原语言版本，并附简体中文解释。语气自然，像真实业务人员。只生成草稿，绝不自动发送。不得主动报价、编造价格、承诺库存/交期/认证/配置/运输条件或其他未经用户确认的事实；不确定时先向用户指出缺口。

跟进闭环：记录跟进时，分别保存客户承诺、我方承诺、双方约定，并尽量给出明确的下一次跟进时间。调用 rongwei_record_followup 时必须提供证据；没有证据不强行评级。

汽车出口专业性：区分贸易术语中的费用承担与风险转移；涉及 FOB/CIF/CIP 时不得混淆。目的国、港口、内陆运输、海关或法规信息如未核实，应标明待核实，不得凭空给出确定结论。当前没有自动报价、港口实时数据库或外部车辆识别能力时，必须坦诚说明。

算力与隐私：优先分析用户本轮新增内容和必要的客户摘要，不重复处理整段历史。客户原文只写入当前用户本机 Rongwei 数据目录；不要要求或尝试上传 GitHub、公共知识库或其他用户空间。云端模型处理用户主动提交的内容仍可能涉及模型供应商的数据政策。`
  })

  ctx.tools.register(defineTool({
    name: 'rongwei_customer_capture',
    description: '在用户主动提交客户聊天、客户资料或业务内容后，自动创建或更新本地客户档案。必须保留原始内容，不得编造缺失字段；已有客户需提供 customer_id 才能追加到原档案。数据只写入本机 Rongwei 数据目录，不上传 GitHub。',
    parameters: {
      conversation_text: { type: 'string', required: true, description: '用户主动提交的客户聊天或业务原文，最多 30000 字符' },
      customer_id: { type: 'string', description: '已存在客户的 ID；新客户留空' },
      customer_name: { type: 'string', description: '客户姓名' },
      company_name: { type: 'string', description: '客户公司' },
      phone: { type: 'string', description: '电话' },
      whatsapp: { type: 'string', description: 'WhatsApp 联系方式' },
      email: { type: 'string', description: '邮箱' },
      country: { type: 'string', description: '客户国家' },
      city: { type: 'string', description: '客户城市' },
      vehicle_interest: { type: 'string', description: '感兴趣的汽车品牌、车型或需求' },
      quantity: { type: 'string', description: '采购数量；未知则留空' },
      budget: { type: 'string', description: '客户预算原始表述；未知则留空' },
      source: { type: 'string', description: '客户来源或内容来源' }
    },
    output: stringOutput,
    async execute(args) {
      const result = await store.capture(validateCapture(args))
      return JSON.stringify({ customer_id: result.customer_id, status: result.status, profile: result.customer.profile, event_count: result.customer.events.length, local_file: store.file, privacy: '仅本机本地文件；不会自动上传公共仓库' })
    }
  }))

  ctx.tools.register(defineTool({
    name: 'rongwei_customer_search',
    description: '在本机 Rongwei 客户档案中搜索。仅返回当前安装用户自己的本地数据；不访问公共客户库。',
    parameters: {
      query: { type: 'string', description: '客户姓名、公司、电话、国家、车型或关键词；留空列出最近客户' },
      limit: { type: 'integer', description: '返回条数，1 到 50，默认 20' }
    },
    output: stringOutput,
    async execute(args) {
      const results = await store.search(args.query || '', args.limit ?? 20)
      return JSON.stringify({ count: results.length, customers: results })
    }
  }))

  ctx.tools.register(defineTool({
    name: 'rongwei_record_followup',
    description: '为已有客户记录跟进结果、意向等级、购买力证据、下次跟进时间，并分别记录客户承诺、我方承诺、双方约定。意向等级与购买力必须分开判断；没有证据时保持未知。',
    parameters: {
      customer_id: { type: 'string', required: true, description: '客户 ID' },
      summary: { type: 'string', required: true, description: '本次跟进摘要' },
      customer_response: { type: 'string', description: '客户最新回应' },
      intent_level: { type: 'string', description: '销售意向等级 S/A/B/C/D；没有足够证据则留空' },
      purchase_power: { type: 'string', description: '购买力判断 confirmed/likely/unclear/low；没有证据则留空' },
      evidence: { type: 'string', description: '支持判断的原话或事实证据' },
      next_followup_at: { type: 'string', description: '下次跟进日期或 ISO 日期时间' },
      customer_commitment: { type: 'string', description: '客户承诺事项' },
      company_commitment: { type: 'string', description: '我方承诺事项' },
      mutual_commitment: { type: 'string', description: '双方约定事项' }
    },
    output: stringOutput,
    async execute(args) {
      const commitments = [
        ['customer', args.customer_commitment],
        ['company', args.company_commitment],
        ['mutual', args.mutual_commitment]
      ].filter(([, description]) => typeof description === 'string' && description.trim())
        .map(([category, description]) => ({ category, description }))
      const result = await store.followup(validateFollowup({ ...args, commitments }))
      return JSON.stringify(result)
    }
  }))

  ctx.logger?.info?.('[Rongwei AI] local customer tools registered')
}
