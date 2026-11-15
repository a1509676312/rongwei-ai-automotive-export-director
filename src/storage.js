import { mkdir, readFile, rename, chmod, writeFile, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { randomUUID, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'

const EMPTY = Object.freeze({ schemaVersion: 1, customers: [], audit: [] })
const ENVELOPE = 'rongwei-aes-256-gcm-v1'
const AAD = Buffer.from('RongweiAI:customers:v1', 'utf8')

export function dataDirectory(env = process.env, home = homedir()) {
  return path.resolve(env.RONGWEI_DATA_DIR || path.join(home, '.rongwei-ai'))
}

function encryptDatabase(db, keyText) {
  const key = Buffer.from(keyText, 'base64')
  if (key.length !== 32) throw new Error('Rongwei 本地加密密钥格式错误。')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(AAD)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(db), 'utf8'), cipher.final()])
  return { format: ENVELOPE, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') }
}

function decryptDatabase(envelope, keyText) {
  if (envelope?.format !== ENVELOPE) throw new Error('本地客户库格式不受支持或不是加密文件；原文件已保留。')
  const key = Buffer.from(keyText, 'base64')
  if (key.length !== 32) throw new Error('Rongwei 本地加密密钥格式错误。')
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'))
    decipher.setAAD(AAD)
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
    const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString('utf8')
    const db = JSON.parse(plaintext)
    if (db?.schemaVersion !== 1 || !Array.isArray(db.customers) || !Array.isArray(db.audit)) throw new Error('数据库结构不受支持。')
    return db
  } catch {
    throw new Error('无法解密 Rongwei 本地客户库：密钥不匹配或文件已损坏。')
  }
}

function normalizeContact(field, value) {
  const normalized = String(value || '').normalize('NFKC').trim().toLocaleLowerCase()
  return field === 'email' ? normalized : normalized.replace(/[^\p{L}\p{N}]/gu, '')
}

function findContactMatches(customers, input) {
  const fields = ['phone', 'whatsapp', 'email']
  const identifiers = fields.flatMap(field => {
    const value = normalizeContact(field, input[field])
    return value ? [{ field, value }] : []
  })
  if (!identifiers.length) return []
  return customers.filter(customer => identifiers.some(({ field, value }) =>
    normalizeContact(field, customer.profile?.[field]) === value
  ))
}

export function createStore({ directory = dataDirectory(), clock = () => new Date(), keyProvider } = {}) {
  const file = path.join(directory, 'customers.json')
  const backupDirectory = path.join(directory, 'backups')
  let queue = Promise.resolve()

  async function load() {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await chmod(directory, 0o700).catch(() => {})
    try {
      const raw = await readFile(file, 'utf8')
      const parsed = JSON.parse(raw)
      if (typeof keyProvider !== 'function') throw new Error('未配置本地加密密钥提供方，已拒绝读取客户资料。')
      return decryptDatabase(parsed, await keyProvider())
    } catch (error) {
      if (error.code === 'ENOENT') return structuredClone(EMPTY)
      if (error instanceof SyntaxError) throw new Error('Rongwei 本地客户库 JSON 已损坏；原文件已保留，没有覆盖。')
      throw error
    }
  }

  async function save(db) {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    if (typeof keyProvider !== 'function') throw new Error('未配置本地加密密钥提供方，已拒绝写入客户资料。')
    const encrypted = encryptDatabase(db, await keyProvider())
    const temp = `${file}.${randomUUID()}.tmp`
    await writeFile(temp, `${JSON.stringify(encrypted, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
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
        let customer = input.customer_id ? db.customers.find(item => item.id === input.customer_id) : null
        if (input.customer_id && !customer) throw new Error('指定的 customer_id 不存在；为避免误建重复客户，本次未写入。')
        let matchedByContact = false
        if (!input.customer_id) {
          const matches = findContactMatches(db.customers, input)
          if (matches.length > 1) throw new Error('联系方式匹配到多个客户档案，存在身份冲突；请先搜索并人工确认 customer_id，本次未写入。')
          if (matches.length === 1) {
            customer = matches[0]
            matchedByContact = true
          }
        }
        const created = !customer
        const id = customer?.id || randomUUID()
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
        return { customer_id: id, status: created ? 'created' : 'updated', matched_by_contact: matchedByContact, customer: structuredClone(customer) }
      })
    },
    async search(query = '', limit = 20, historyLimit = 10) {
      const db = await load()
      const q = String(query).trim().toLocaleLowerCase()
      const safeLimit = Math.max(1, Math.min(50, Number.isInteger(limit) ? limit : 20))
      const safeHistoryLimit = Math.max(1, Math.min(20, Number.isInteger(historyLimit) ? historyLimit : 10))
      const matches = db.customers.filter(customer => {
        if (!q) return true
        const haystack = [customer.id, ...Object.values(customer.profile), ...customer.events.map(event => event.rawText || event.summary || '')].join(' ').toLocaleLowerCase()
        return haystack.includes(q)
      })
      return matches.slice(-safeLimit).reverse().map(customer => ({
        customer_id: customer.id,
        profile: customer.profile,
        created_at: customer.createdAt,
        updated_at: customer.updatedAt,
        event_count: customer.events.length,
        history: customer.events.slice(-safeHistoryLimit).map(event => ({
          type: event.type, at: event.at, summary: event.summary || null,
          raw_text: event.rawText ? event.rawText.slice(0, 4000) : null,
          customer_response: event.customer_response || null,
          intent_level: event.intent_level || null, purchase_power: event.purchase_power || null,
          evidence: event.evidence || null, next_followup_at: event.next_followup_at || null
        })),
        open_commitments: customer.commitments.filter(item => item.status === 'open')
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
    async exportAll() { return load() },
    async createBackup() {
      return serialized(async () => {
        await load()
        let current
        try { current = await readFile(file) }
        catch (error) { if (error.code === 'ENOENT') throw new Error('当前还没有客户数据，无需备份。'); throw error }
        await mkdir(backupDirectory, { recursive: true, mode: 0o700 })
        await chmod(backupDirectory, 0o700).catch(() => {})
        const stamp = clock().toISOString().replace(/[-:.]/g, '')
        const backupId = `customers-${stamp}-${randomUUID().slice(0, 8)}.rwbackup`
        const target = path.join(backupDirectory, backupId)
        await writeFile(target, current, { flag: 'wx', mode: 0o600 })
        await chmod(target, 0o600).catch(() => {})
        return { backup_id: backupId, path: target, encrypted: true }
      })
    },
    async listBackups(limit = 20) {
      await mkdir(backupDirectory, { recursive: true, mode: 0o700 })
      const names = await readdir(backupDirectory)
      const items = []
      for (const name of names) {
        if (!/^customers-[0-9TZ]+-[a-f0-9]{8}[.]rwbackup$/.test(name)) continue
        const target = path.join(backupDirectory, name)
        const info = await stat(target)
        if (info.isFile()) items.push({ backup_id: name, size_bytes: info.size, modified_at: info.mtime.toISOString(), encrypted: true })
      }
      items.sort((a, b) => b.modified_at.localeCompare(a.modified_at))
      return items.slice(0, Math.max(1, Math.min(50, Number.isInteger(limit) ? limit : 20)))
    },
    async restoreBackup(backupId) {
      return serialized(async () => {
        if (typeof backupId !== 'string' || path.basename(backupId) !== backupId || !/^customers-[0-9TZ]+-[a-f0-9]{8}[.]rwbackup$/.test(backupId)) throw new Error('备份文件编号无效。')
        const source = path.join(backupDirectory, backupId)
        const backupBytes = await readFile(source)
        const envelope = JSON.parse(backupBytes.toString('utf8'))
        decryptDatabase(envelope, await keyProvider())
        let snapshotId = null
        try {
          const current = await readFile(file)
          await mkdir(backupDirectory, { recursive: true, mode: 0o700 })
          const stamp = clock().toISOString().replace(/[-:.]/g, '')
          snapshotId = `customers-${stamp}-${randomUUID().slice(0, 8)}.rwbackup`
          await writeFile(path.join(backupDirectory, snapshotId), current, { flag: 'wx', mode: 0o600 })
        } catch (error) { if (error.code !== 'ENOENT') throw error }
        const temp = `${file}.${randomUUID()}.restore.tmp`
        await writeFile(temp, backupBytes, { flag: 'wx', mode: 0o600 })
        await rename(temp, file)
        await chmod(file, 0o600).catch(() => {})
        const restored = decryptDatabase(envelope, await keyProvider())
        return { restored_customer_count: restored.customers.length, safety_snapshot_id: snapshotId }
      })
    }
  }
}
