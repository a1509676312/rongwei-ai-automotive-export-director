import { defineTool } from '@deepseek-ai/dsh-tools'
import { createStore } from './storage.js'
import { validateCapture, validateFollowup } from './domain.js'

export const name = 'rongwei-ai-automotive-export-director'
export const inject = ['tools']

const stringOutput = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: value }]
}

export function apply(ctx) {
  const store = createStore()

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
