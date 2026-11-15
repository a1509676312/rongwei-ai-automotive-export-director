import { mkdir, readFile, rename, chmod, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const EMPTY = Object.freeze({ schemaVersion: 1, customers: [], audit: [] })

export function dataDirectory(env = process.env, home = homedir()) {
  return path.resolve(env.RONGWEI_DATA_DIR || path.join(home, '.rongwei-ai'))
}

export function createStore({ directory = dataDirectory(), clock = () => new Date() } = {}) {
  const file = path.join(directory, 'customers.json')
  let queue = Promise.resolve()

  async function load() {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await chmod(directory, 0o700).catch(() => {})
    try {
      const raw = await readFile(file, 'utf8')
      const parsed = JSON.parse(raw)
      if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.customers) || !Array.isArray(parsed.audit)) {
        throw new Error('Rongwei 本地客户库结构不受支持；原文件已保留，没有覆盖。')
      }
      return parsed
    } catch (error) {
      if (error.code === 'ENOENT') return structuredClone(EMPTY)
      if (error instanceof SyntaxError) throw new Error('Rongwei 本地客户库 JSON 已损坏；原文件已保留，没有覆盖。')
      throw error
    }
  }

  async function save(db) {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const temp = `${file}.${randomUUID()}.tmp`
    await writeFile(temp, `${JSON.stringify(db, null, 2)}\\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    await chmod(temp, 0o600).catch(() => {})
    await rename(temp, file)
    await chmod(file, 0o600).catch(() => {})
  }

  function serialized(work) {
    const next = queue.then(work, work)
    queue = next.then(() => undefined, () => undefined)
    return next
  }

  return {
    file,
    async capture(input) {
      return serialized(async () => {
        const db = await load()
        const now = clock().toISOString()
        const id = input.customer_id || randomUUID()
        let customer = db.customers.find(item => item.id === id)
        const created = !customer
        if (!customer) {
          customer = { id, createdAt: now, updatedAt: now, profile: {}, events: [], commitments: [] }
          db.customers.push(customer)
        }
        const profileFields = ['customer_name', 'company_name', 'phone', 'whatsapp', 'email', 'country', 'city', 'vehicle_interest', 'quantity', 'budget', 'source']
        for (const key of profileFields) {
          if (typeof input[key] === 'string' && input[key].trim()) customer.profile[key] = input[key].trim()
          else if (typeof input[key] === 'number' && Number.isFinite(input[key])) customer.profile[key] = input[key]
        }
        customer.events.push({ id: randomUUID(), type: 'customer_submitted_content', at: now, source: input.source || 'user_submitted', rawText: input.conversation_text.trim() })
        customer.updatedAt = now
        db.audit.push({ id: randomUUID(), customerId: id, action: created ? 'customer_created' : 'customer_content_added', at: now })
        await save(db)
        return { customer_id: id, status: created ? 'created' : 'updated', customer: structuredClone(customer) }
      })
    },
    async search(query = '', limit = 20) {
      const db = await load()
      const q = String(query).trim().toLocaleLowerCase()
      const safeLimit = Math.max(1, Math.min(50, Number.isInteger(limit) ? limit : 20))
      const matches = db.customers.filter(customer => {
        if (!q) return true
        const haystack = [customer.id, ...Object.values(customer.profile), ...customer.events.map(event => event.rawText || '')].join(' ').toLocaleLowerCase()
        return haystack.includes(q)
      })
      return matches.slice(-safeLimit).reverse().map(customer => ({
        customer_id: customer.id,
        profile: customer.profile,
        created_at: customer.createdAt,
        updated_at: customer.updatedAt,
        event_count: customer.events.length,
        latest_note: customer.events.at(-1)?.rawText?.slice(0, 500) || ''
      }))
    },
    async followup(input) {
      return serialized(async () => {
        const db = await load()
        const customer = db.customers.find(item => item.id === input.customer_id)
        if (!customer) throw new Error('未找到该客户。请先使用客户建档工具，或确认 customer_id。')
        const now = clock().toISOString()
        const event = {
          id: randomUUID(), type: 'followup', at: now,
          summary: input.summary.trim(),
          customer_response: input.customer_response || '',
          intent_level: input.intent_level || null,
          purchase_power: input.purchase_power || null,
          evidence: input.evidence || '',
          next_followup_at: input.next_followup_at || null
        }
        customer.events.push(event)
        for (const item of input.commitments || []) {
          customer.commitments.push({ id: randomUUID(), category: item.category, description: item.description, dueAt: item.due_at || null, status: 'open', recordedAt: now })
        }
        customer.updatedAt = now
        db.audit.push({ id: randomUUID(), customerId: customer.id, action: 'followup_recorded', at: now })
        await save(db)
        return { customer_id: customer.id, followup_id: event.id, commitments_added: (input.commitments || []).length, next_followup_at: event.next_followup_at }
      })
    },
    async exportAll() {
      return load()
    }
  }
}
