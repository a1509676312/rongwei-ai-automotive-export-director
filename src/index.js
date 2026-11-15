import { defineTool } from '@deepseek-ai/dsh-tools'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { randomBytes } from 'node:crypto'
import { createStore } from './storage.js'
import { validateCapture, validateFollowup, calculateQuote, validateSalesLesson, validateDestinationFact } from './domain.js'

export const name = 'rongwei-ai-automotive-export-director'
export const inject = ['tools', 'systemPrompt', 'credentials']

const stringOutput = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: value }]
}

export function apply(ctx) {
  const encryptionKeyRef = credentialRef('RONGWEI_CUSTOMER_DB_KEY')
  let encryptionKeyPromise
  const getEncryptionKey = () => {
    if (!encryptionKeyPromise) {
      encryptionKeyPromise = (async () => {
        const existing = await ctx.credentials.resolve(encryptionKeyRef)
        if (existing?.value) return existing.value
        const generated = randomBytes(32).toString('base64')
        await ctx.credentials.set(encryptionKeyRef, generated)
        const saved = await ctx.credentials.resolve(encryptionKeyRef)
        if (!saved?.value) throw new Error('无法在 DeepSeek Harness 本地凭据库中保存 Rongwei 加密密钥。')
        return saved.value
      })()
    }
    return encryptionKeyPromise
  }
  const store = createStore({ keyProvider: getEncryptionKey })

  ctx.systemPrompt.section({
    name: 'rongwei-sales-director-guidance',
    order: 9500,
    text: `你是 Rongwei AI 汽车出口销售总监，协助用户分析客户、推进成交并沉淀可复用的销售经验。默认用简体中文与用户沟通，表达专业、直接、简洁，不写官腔。

客户聊天处理：用户主动提交客户聊天、截图文字或业务资料后，先调用 rongwei_customer_search，使用电话、WhatsApp、邮箱等强标识核对已有档案；只有在无匹配或用户确认是新客户时才新建。若搜索到唯一匹配，必须使用该 customer_id 追加；若有多个匹配，先向用户澄清，不得新建。然后调用 rongwei_customer_capture 保存原始内容和可确认字段。不得把推测写成事实，不得覆盖或改写原始记录。缺失信息保持未知。

销售判断：分别判断购买意向等级 S/A/B/C/D 与购买力（confirmed/likely/unclear/low），两者不可混为一谈。每个判断必须列出客户原话或事实依据；证据不足就明确说不确定。分析客户类型、采购需求、顾虑、谈判阶段、关键决策人、下一步成交动作。

客户回复：每次用户要求拟写客户回复，必须提供至少三种不同策略的草稿；每条先写策略说明，再写客户原语言版本，并附简体中文解释。语气自然，像真实业务人员。只生成草稿，绝不自动发送。不得主动报价、编造价格、承诺库存/交期/认证/配置/运输条件或其他未经用户确认的事实；不确定时先向用户指出缺口。

跟进闭环：记录跟进时，分别保存客户承诺、我方承诺、双方约定，并尽量给出明确的下一次跟进时间。调用 rongwei_record_followup 时，只要填写意向等级或购买力，必须提供证据：至少 5 个字符的客户原话或可核实事实；证据不足时两个评级字段都留空。

目的地知识：调用 rongwei_destination_fact_add 保存用户提供或核实的国家/港口/内陆目的地资料，并标注 verified/historical/ai_estimate/expired 状态；查询时必须展示资料状态、来源和有效期，不得把历史参考或 AI 推测说成已核实事实。销售经验：用户明确选择/修改回复或提供成交/丢单结果后，可调用 rongwei_sales_lesson_add 记录去客户化的情境、策略和结果；查询时区分单次经验、重复规律和已验证经验，不自动将单次案例推广成通用规律。汽车出口专业性：区分贸易术语中的费用承担与风险转移；涉及 FOB/CIF/CIP 时不得混淆。用户提供实际成本和售价时，调用 rongwei_quote_calculate 进行内部成本/毛利计算；不得自行估算缺失成本，也不得把内部计算结果自动当作客户报价。目的国、港口、内陆运输、海关或法规信息如未核实，应标明待核实，不得凭空给出确定结论。当前没有自动报价、港口实时数据库或外部车辆识别能力时，必须坦诚说明。

算力与隐私：优先分析用户本轮新增内容和必要的客户摘要，不重复处理整段历史。供应商成本、公司资料和广告来源归因仅保存在当前用户本机。只有用户明确要求时才调用 rongwei_data_export 生成可读 JSON；导出包含敏感客户资料，必须提醒妥善保管。客户原文只写入当前用户本机 Rongwei 数据目录；不要要求或尝试上传 GitHub、公共知识库或其他用户空间。云端模型处理用户主动提交的内容仍可能涉及模型供应商的数据政策。只有用户明确要求时才创建或恢复备份；恢复前会自动保留当前数据库快照。`
  })

  ctx.tools.register(defineTool({
    name: 'rongwei_customer_capture',
    description: '在用户主动提交客户聊天、客户资料或业务内容后，自动创建或更新本地客户档案。必须保留原始内容，不得编造缺失字段；必须先搜索已有档案；电话/WhatsApp/邮箱完全匹配时可自动追加到唯一匹配档案；多个匹配必须人工澄清；若已有匹配客户，使用其 customer_id。数据只写入本机 Rongwei 数据目录，不上传 GitHub。',
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
      source: { type: 'string', description: '客户来源或内容来源' },
      ad_platform: { type: 'string', description: '广告平台，可选' },
      ad_source: { type: 'string', description: '广告来源，可选' },
      ad_campaign: { type: 'string', description: '广告活动/推广计划，可选' },
      ad_id: { type: 'string', description: '广告素材或广告编号，可选' },
      ad_content: { type: 'string', description: '广告内容标识，可选' }
    },
    output: stringOutput,
    async execute(args) {
      const result = await store.capture(validateCapture(args))
      return JSON.stringify({ customer_id: result.customer_id, status: result.status, profile: result.customer.profile, event_count: result.customer.events.length, local_file: store.file, privacy: '客户库使用 AES-256-GCM 本地加密；密钥由 DeepSeek Harness 本地凭据服务保存，不上传公共仓库' })
    }
  }))

  ctx.tools.register(defineTool({
    name: 'rongwei_customer_search',
    description: '在本机 Rongwei 客户档案中搜索。仅返回当前安装用户自己的本地数据；不访问公共客户库。',
    parameters: {
      query: { type: 'string', description: '客户姓名、公司、电话、国家、车型或关键词；留空列出最近客户' },
      limit: { type: 'integer', description: '返回客户条数，1 到 50，默认 20' },
      history_limit: { type: 'integer', description: '每位客户返回最近历史事件数，1 到 20，默认 10' }
    },
    output: stringOutput,
    async execute(args) {
      const results = await store.search(args.query || '', args.limit ?? 20, args.history_limit ?? 10)
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
      intent_level: { type: 'string', description: '销售意向等级 S/A/B/C/D；填写时 evidence 必填' },
      purchase_power: { type: 'string', description: '购买力判断 confirmed/likely/unclear/low；填写时 evidence 必填' },
      evidence: { type: 'string', description: '支持任一评级的客户原话或可核实事实；评级时至少 5 个字符' },
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

  ctx.tools.register(defineTool({
    name: 'rongwei_sales_lesson_add',
    description: '仅在用户明确选择/修改销售回复或提供客户成交、丢单结果后，保存一条去客户化的本地销售经验。单次经验不得自动视为通用规律。',
    parameters: {
      situation: { type: 'string', required: true, description: '销售情境，禁止包含客户姓名、电话等个人身份信息' },
      lesson: { type: 'string', required: true, description: '可复用的策略经验' },
      outcome: { type: 'string', description: 'won/lost/pending/unknown' },
      confidence: { type: 'string', description: 'single_case/repeated/verified' },
      country: { type: 'string', description: '国家，可选' },
      vehicle: { type: 'string', description: '车型，可选' },
      evidence: { type: 'string', description: '支持经验的去标识化结果或事实' },
      source: { type: 'string', description: '经验来源说明' }
    },
    output: stringOutput,
    async execute(args) {
      return JSON.stringify(await store.recordSalesLesson(validateSalesLesson(args)))
    }
  }))

  ctx.tools.register(defineTool({
    name: 'rongwei_sales_lesson_search',
    description: '检索当前安装用户本机的销售经验库；必须区分 single_case 单次经验、repeated 重复规律和 verified 已验证经验。',
    parameters: { query: { type: 'string', description: '情境、国家、车型或经验关键词' }, limit: { type: 'integer', description: '返回 1 到 50 条' } },
    output: stringOutput,
    async execute(args) {
      return JSON.stringify({ lessons: await store.searchSalesLessons(args.query || '', args.limit ?? 20) })
    }
  }))

  ctx.tools.register(defineTool({
    name: 'rongwei_destination_fact_add',
    description: '保存本地目的国、港口或内陆目的地参考资料。verified 必须提供来源；区分已核实、历史参考、AI 推测和过期资料。',
    parameters: {
      country: { type: 'string', required: true, description: '国家' },
      city: { type: 'string', description: '城市' },
      port: { type: 'string', description: '港口' },
      inland_destination: { type: 'string', description: '内陆目的地' },
      content: { type: 'string', required: true, description: '资料内容' },
      evidence_status: { type: 'string', required: true, description: 'verified/historical/ai_estimate/expired' },
      source: { type: 'string', description: '来源名称或文件' },
      source_url: { type: 'string', description: '来源链接' },
      checked_at: { type: 'string', description: '核实日期' },
      expires_at: { type: 'string', description: '失效日期 YYYY-MM-DD' }
    },
    output: stringOutput,
    async execute(args) {
      return JSON.stringify(await store.recordDestinationFact(validateDestinationFact(args)))
    }
  }))

  ctx.tools.register(defineTool({
    name: 'rongwei_destination_fact_search',
    description: '检索本地目的国、港口及内陆目的地知识。必须保留资料状态、来源和有效期，不得把推测说成已核实。',
    parameters: { query: { type: 'string', description: '国家、城市、港口或运输关键词' }, limit: { type: 'integer', description: '返回 1 到 100 条' } },
    output: stringOutput,
    async execute(args) {
      return JSON.stringify({ facts: await store.searchDestinationFacts(args.query || '', args.limit ?? 30) })
    }
  }))

  ctx.tools.register(defineTool({
    name: 'rongwei_quote_calculate',
    description: '按 Incoterms 2020 对 FOB/CIF/CIP 进行内部成本、毛利和利润率计算。必须使用用户提供的实际成本和售价，不估价、不生成客户报价；缺少 CIF/CIP 运费或保险费时拒绝计算。',
    parameters: {
      incoterm: { type: 'string', required: true, description: 'FOB、CIF 或 CIP' },
      currency: { type: 'string', required: true, description: '三位大写货币代码，例如 USD' },
      vehicle_cost: { type: 'number', required: true, description: '车辆采购成本' },
      sale_price: { type: 'number', required: true, description: '用户提供的内部销售价' },
      origin_inland: { type: 'number', description: '起运地内陆运输费用' },
      export_clearance: { type: 'number', description: '出口报关及相关费用' },
      loading: { type: 'number', description: '装载及装船前费用' },
      freight: { type: 'number', description: '实际国际运输费用；CIF/CIP 必填' },
      insurance: { type: 'number', description: '实际保险费用；CIF/CIP 必填' },
      transport_mode: { type: 'string', description: 'sea/inland_waterway/road/air/rail/multimodal' },
      inspection: { type: 'number', description: '检验费用' },
      bank_fee: { type: 'number', description: '银行及收款费用' },
      commission: { type: 'number', description: '销售佣金' },
      other_seller_costs: { type: 'number', description: '其他由卖方承担的实际费用' },
      insurance_clause: { type: 'string', description: '实际保险条款，例如 ICC(A) 或 ICC(C)' },
      insurance_coverage_percent: { type: 'number', description: '保险金额占合同价比例，通常至少 110%' },
      minimum_margin_percent: { type: 'number', description: '公司最低毛利率门槛，百分比' }
    },
    output: stringOutput,
    async execute(args) {
      return JSON.stringify(calculateQuote(args))
    }
  }))

  ctx.tools.register(defineTool({
    name: 'rongwei_company_profile_set',
    description: '仅根据用户提供的真实资料保存本机公司资料和默认利润门槛；不自动对客户披露。',
    parameters: {
      legal_name: { type: 'string', description: '公司法定名称' },
      display_name: { type: 'string', description: '公司对外名称' },
      country: { type: 'string', description: '注册国家' },
      address: { type: 'string', description: '公司地址' },
      export_license_notes: { type: 'string', description: '出口资质备注' },
      default_currency: { type: 'string', description: '默认核算货币' },
      minimum_margin_percent: { type: 'number', description: '默认最低毛利率门槛' },
      bank_details_note: { type: 'string', description: '仅作内部备注，不建议保存完整账号或密码' }
    },
    output: stringOutput,
    async execute(args) {
      if (args.minimum_margin_percent !== undefined && (!Number.isFinite(args.minimum_margin_percent) || args.minimum_margin_percent < 0 || args.minimum_margin_percent > 100)) throw new Error('最低毛利率必须在 0 到 100 之间。')
      return JSON.stringify(await store.upsertCompanyProfile(args))
    }
  }))

  ctx.tools.register(defineTool({
    name: 'rongwei_supplier_save',
    description: '保存用户提供的供应商和车型成本信息，记录币种、来源及有效期；过期成本不可视为当前报价。',
    parameters: {
      supplier_id: { type: 'string', description: '已有供应商 ID，用于更新' },
      name: { type: 'string', required: true, description: '供应商名称' },
      country: { type: 'string', description: '供应商国家' },
      contact: { type: 'string', description: '供应商联系人或联系方式' },
      notes: { type: 'string', description: '供应商备注' },
      vehicle_model: { type: 'string', description: '对应车型' },
      vehicle_cost: { type: 'number', description: '供应商提供的车辆成本' },
      currency: { type: 'string', description: '成本货币代码' },
      cost_valid_until: { type: 'string', description: '成本有效期 YYYY-MM-DD' },
      source: { type: 'string', description: '成本来源或报价单编号' }
    },
    output: stringOutput,
    async execute(args) {
      if (!args.name?.trim()) throw new Error('必须填写供应商名称。')
      if (args.vehicle_cost !== undefined && (!Number.isFinite(args.vehicle_cost) || args.vehicle_cost < 0)) throw new Error('供应商成本必须是大于或等于 0 的数字。')
      if (args.currency && !/^[A-Z]{3}$/.test(args.currency)) throw new Error('币种必须是三位大写代码。')
      if (args.cost_valid_until && !/^\\d{4}-\\d{2}-\\d{2}$/.test(args.cost_valid_until)) throw new Error('成本有效期必须使用 YYYY-MM-DD。')
      return JSON.stringify(await store.saveSupplier(args))
    }
  }))

  ctx.tools.register(defineTool({
    name: 'rongwei_supplier_search',
    description: '检索本机供应商和车型成本；回答时必须检查成本有效期、币种和来源。',
    parameters: { query: { type: 'string', description: '供应商、国家或车型关键词' }, limit: { type: 'integer', description: '最多返回 100 条' } },
    output: stringOutput,
    async execute(args) {
      return JSON.stringify({ suppliers: await store.searchSuppliers(args.query || '', args.limit ?? 50) })
    }
  }))

  ctx.tools.register(defineTool({
    name: 'rongwei_ad_attribution_summary',
    description: '汇总本机记录的广告来源、活动及素材带来的客户建档数量；不把客户数量等同成交数量。',
    parameters: {},
    output: stringOutput,
    async execute() {
      return JSON.stringify({ attribution: await store.adAttributionSummary(), note: '该统计是客户建档归因，不代表成交或回款。' })
    }
  }))

  ctx.tools.register(defineTool({
    name: 'rongwei_data_export',
    description: '仅在用户明确要求导出/迁移数据时调用。生成包含可读客户个人信息、跟进、供应商、公司资料和知识记录的 JSON 文件；必须在调用前告知用户这是明文敏感数据文件。',
    parameters: { confirm_plaintext_export: { type: 'boolean', required: true, description: '用户已明确确认需要生成明文数据导出文件时传 true' } },
    output: stringOutput,
    async execute(args) {
      if (args.confirm_plaintext_export !== true) throw new Error('必须先向用户说明明文导出包含敏感客户资料，并取得明确确认。')
      return JSON.stringify(await store.exportPlainJson())
    }
  }))

  ctx.tools.register(defineTool({
    name: 'rongwei_backup_create',
    description: '仅在用户明确要求备份时，创建当前加密客户数据库的本地备份。备份文件仍为 AES-256-GCM 密文。',
    parameters: {},
    output: stringOutput,
    async execute() {
      return JSON.stringify(await store.createBackup())
    }
  }))

  ctx.tools.register(defineTool({
    name: 'rongwei_backup_list',
    description: '列出当前用户本机 Rongwei 加密备份文件。',
    parameters: { limit: { type: 'integer', description: '返回条数，1 到 50，默认 20' } },
    output: stringOutput,
    async execute(args) {
      return JSON.stringify({ backups: await store.listBackups(args.limit ?? 20) })
    }
  }))

  ctx.tools.register(defineTool({
    name: 'rongwei_backup_restore',
    description: '仅在用户明确指定要恢复某个备份时调用。会先验证备份密钥和完整性，并在覆盖当前数据库前自动保存一份安全快照。',
    parameters: { backup_id: { type: 'string', required: true, description: '由 rongwei_backup_list 返回的备份文件编号' } },
    output: stringOutput,
    async execute(args) {
      return JSON.stringify(await store.restoreBackup(args.backup_id))
    }
  }))

  ctx.logger?.info?.('[Rongwei AI] local customer tools registered')
}
