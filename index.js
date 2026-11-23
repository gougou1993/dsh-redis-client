/**
 * Host half of the Redis client bundle.
 *
 * Talks to Redis over the wire with ioredis (pure JavaScript), so no local
 * `redis-cli` install is required. Connection details come per request from the
 * Client; passwords never leave the Host (they live in the DSH credential store).
 */
import Redis from 'ioredis'

export const name = 'dsh-redis-client'
export const inject = ['connection', 'credentials']

const API = '/api/dsh-redis-client'
const CONNECT_TIMEOUT = 8000
const COMMAND_TIMEOUT = 8000
const MAX_LIVE_CLIENTS = 8

class RedisError extends Error {
  constructor(message, status = 400) { super(message); this.status = status }
}
function json(value, status = 200) {
  return Response.json(value, { status, headers: { 'cache-control': 'no-store' } })
}
function failure(error, fallback) {
  const message = error instanceof RedisError ? error.message : (error && error.message) || fallback
  const status = error instanceof RedisError ? error.status : 500
  return json({ error: message }, status)
}
function route(path, methods, fetch) {
  return { path: `${API}/${path}`, methods, requestBody: 'buffered', fetch }
}
async function readBody(request) {
  try {
    const text = await request.text()
    return JSON.parse(text || '{}')
  } catch (_) { throw new RedisError('请求内容不是合法的 JSON。') }
}

// Credential reference for one connection. DSH refs must match /^[A-Za-z_][A-Za-z0-9_]*$/,
// so a connection id like "c-abc-123" becomes REDIS_CONN_C_ABC_123.
function refOf(connId) {
  const safe = String(connId || '').replace(/[^A-Za-z0-9]/g, '_')
  return 'REDIS_CONN_' + (safe || 'DEFAULT').toUpperCase()
}
async function getStoredPassword(ctx, connId) {
  if (!connId) return ''
  try {
    const resolved = await ctx.credentials.resolve(refOf(connId))
    // resolve() returns { value, source }, not a bare string.
    if (resolved && typeof resolved === 'object' && typeof resolved.value === 'string') return resolved.value
    if (typeof resolved === 'string') return resolved
    return ''
  } catch (_) { return '' }
}
async function withStoredPassword(ctx, cfg) {
  const merged = { ...cfg }
  if (!merged.password && merged.id) {
    const stored = await getStoredPassword(ctx, merged.id)
    if (stored) merged.password = stored
    else if (merged.hasPassword) throw new RedisError('该连接的密码未保存，请重新编辑连接并填写密码。', 401)
  }
  return merged
}

// --- client pool -------------------------------------------------------------
// One ioredis instance per host:port:db:user, reused across requests.
const pool = new Map()
function poolKey(cfg) {
  return [cfg.host || '127.0.0.1', cfg.port || 6379, cfg.db || 0, cfg.username || '', cfg.password ? 'auth' : 'noauth'].join('|')
}
function createClient(cfg) {
  const options = {
    host: cfg.host || '127.0.0.1',
    port: Number(cfg.port) || 6379,
    db: Number(cfg.db) || 0,
    connectTimeout: CONNECT_TIMEOUT,
    commandTimeout: COMMAND_TIMEOUT,
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
    lazyConnect: true,
  }
  if (cfg.password) options.password = String(cfg.password)
  if (cfg.username) options.username = String(cfg.username)
  const client = new Redis(options)
  // Errors are surfaced per command; keep the emitter quiet to avoid unhandled noise.
  client.on('error', () => {})
  return client
}
async function getClient(cfg) {
  const key = poolKey(cfg)
  const existing = pool.get(key)
  if (existing && existing.status === 'ready') return existing
  if (existing) { try { existing.disconnect() } catch (_) {}; pool.delete(key) }
  const client = createClient(cfg)
  pool.set(key, client)
  // Evict the oldest entries when the pool grows too large.
  if (pool.size > MAX_LIVE_CLIENTS) {
    for (const [k, c] of pool) {
      if (pool.size <= MAX_LIVE_CLIENTS) break
      if (k === key) continue
      try { c.disconnect() } catch (_) {}
      pool.delete(k)
    }
  }
  try {
    await client.connect()
  } catch (error) {
    try { client.disconnect() } catch (_) {}
    pool.delete(key)
    const t = translateError(error)
    // ioredis reports a refused port as a bare "Connection is closed." with no code,
    // which is not actionable; describe the target instead.
    if (/连接已断开|Connection is closed/i.test(t.message)) {
      const host = cfg.host || '127.0.0.1'
      const port = Number(cfg.port) || 6379
      throw new RedisError(`无法连接到 ${host}:${port}，请确认 Redis 服务已启动且地址端口正确。`, 502)
    }
    throw t
  }
  return client
}
function translateError(error) {
  const msg = (error && error.message) || String(error)
  const code = (error && error.code) || ''
  if (/ECONNREFUSED/.test(code + msg)) return new RedisError('连接被拒绝，请检查地址与端口。', 502)
  if (/ENOTFOUND/.test(code + msg)) return new RedisError('无法解析主机地址。', 502)
  if (/ETIMEDOUT|connectTimeout/.test(code + msg)) return new RedisError('连接超时，请检查地址与端口。', 504)
  if (/WRONGPASS|NOAUTH|invalid password/i.test(msg)) return new RedisError('密码错误或未授权。', 401)
  if (/commandTimeout/i.test(code + msg)) return new RedisError('命令执行超时。', 504)
  if (/Connection is closed|ECONNRESET|EPIPE|socket closed/i.test(code + msg)) {
    return new RedisError('连接已断开，请检查 Redis 服务是否可用。', 502)
  }
  return new RedisError(msg || '命令执行失败。')
}
// Run one command through the pooled client.
async function run(cfg, command, ...args) {
  const client = await getClient(cfg)
  try {
    return await client.call(command, ...args)
  } catch (error) {
    throw translateError(error)
  }
}

function toText(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (Buffer.isBuffer(value)) return value.toString('utf8')
  return String(value)
}
function toLines(value) {
  if (!Array.isArray(value)) return []
  return value.map((v) => toText(v))
}
function toPairs(value) {
  // ioredis returns different shapes per command: nested pairs for ZRANGE ... WITHSCORES
  // ([["one","1"],["two","2"]]), a flat array for RESP2 HGETALL, or an object for RESP3.
  if (!Array.isArray(value)) {
    if (value && typeof value === 'object') {
      return Object.entries(value).map(([field, v]) => ({ field, value: toText(v) }))
    }
    return []
  }
  if (value.length === 0) return []
  // Nested case: every element is itself a [field, value] tuple.
  if (Array.isArray(value[0])) {
    return value
      .filter((pair) => Array.isArray(pair) && pair.length >= 2)
      .map((pair) => ({ field: toText(pair[0]), value: toText(pair[1]) }))
  }
  // Flat case: [field, value, field, value, ...]
  const out = []
  for (let i = 0; i < value.length; i += 2) {
    out.push({ field: toText(value[i]), value: toText(value[i + 1]) })
  }
  return out
}
function parseLine(line) {
  // Minimal shell-like split: honour single and double quotes.
  const out = []
  let cur = ''
  let quote = ''
  let has = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (quote) {
      if (ch === quote) { quote = '' } else { cur += ch }
      has = true
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; has = true; continue }
    if (/\s/.test(ch)) {
      if (has) { out.push(cur); cur = ''; has = false }
      continue
    }
    cur += ch
    has = true
  }
  if (has) out.push(cur)
  return out
}

export function apply(ctx) {
  ctx.effect(() => {
    const disposers = []
    const register = (entry) => {
      try {
        const dispose = ctx.connection.fetch.register(entry)
        if (typeof dispose === 'function') disposers.push(dispose)
      } catch (error) {
        console.warn(`[dsh-redis-client] route ${entry.path} rejected: ${(error && error.message) || error}`)
      }
    }

    // Test connection: PING.
    register(route('ping', ['POST'], async (request) => {
      try {
        const body = await readBody(request)
        const cfg = await withStoredPassword(ctx, body.connection || {})
        const reply = await run(cfg, 'PING')
        const text = toText(reply).trim()
        return json({ ok: /PONG/i.test(text), raw: text })
      } catch (error) { return failure(error, '连接测试失败。') }
    }))

    // Server information: parse INFO into a grouped, human-friendly set of fields.
    register(route('info', ['POST'], async (request) => {
      try {
        const body = await readBody(request)
        const cfg = await withStoredPassword(ctx, body.connection || {})
        const raw = toText(await run(cfg, 'INFO'))
        const fields = {}
        let section = ''
        for (const line of raw.split('\n')) {
          const clean = line.replace(/\r$/, '')
          if (!clean) continue
          if (clean.startsWith('#')) { section = clean.replace(/^#+\s*/, '').trim(); continue }
          const idx = clean.indexOf(':')
          if (idx < 0) continue
          const key = clean.slice(0, idx)
          const value = clean.slice(idx + 1)
          fields[key] = value
          if (section) fields[section + '.' + key] = value
        }
        // Humanize uptime (seconds) into days/hours/minutes.
        const uptimeSec = Number(fields.uptime_in_seconds || 0)
        const days = Math.floor(uptimeSec / 86400)
        const hours = Math.floor((uptimeSec % 86400) / 3600)
        const minutes = Math.floor((uptimeSec % 3600) / 60)
        const uptime = [days ? days + 'd' : '', hours ? hours + 'h' : '', minutes + 'm'].filter(Boolean).join(' ') || (uptimeSec + 's')
        // Hit rate from keyspace hits/misses.
        const hits = Number(fields.keyspace_hits || 0)
        const misses = Number(fields.keyspace_misses || 0)
        const total = hits + misses
        const hitRate = total ? (hits / total * 100).toFixed(1) + '%' : '-'
        const info = {
          version: fields.redis_version || '-',
          mode: fields.redis_mode || 'standalone',
          os: fields.os || '-',
          arch: fields.process_arch || '-',
          processId: fields.process_id || '-',
          port: fields.tcp_port || '-',
          uptime, uptimeSec,
          clients: fields.connected_clients || '-',
          memoryUsed: fields.used_memory_human || '-',
          memoryPeak: fields.used_memory_peak_human || '-',
          keys: fields.db0 ? (fields.db0.match(/keys=(\d+)/) || [])[1] || '0' : '0',
          totalCommands: fields.total_commands_processed || '-',
          hittingRate: hitRate,
        }
        return json({ info })
      } catch (error) { return failure(error, '无法读取服务器信息。') }
    }))

    // List all 16 databases via INFO keyspace (best effort).
    register(route('dbs', ['POST'], async (request) => {
      try {
        const body = await readBody(request)
        const cfg = await withStoredPassword(ctx, body.connection || {})
        const info = toText(await run({ ...cfg, db: 0 }, 'INFO', 'keyspace'))
        const keyspace = {}
        for (const line of info.split('\n')) {
          const m = line.replace(/\r$/, '').match(/^db(\d+):(.*)$/)
          if (m) keyspace[m[1]] = m[2].trim()
        }
        const dbs = Array.from({ length: 16 }, (_, i) => ({ index: i, info: keyspace[String(i)] || '' }))
        return json({ dbs })
      } catch (error) { return failure(error, '无法读取数据库信息。') }
    }))

    // Scan keys with MATCH using SCAN cursor iteration.
    register(route('keys', ['POST'], async (request) => {
      try {
        const body = await readBody(request)
        const cfg = await withStoredPassword(ctx, body.connection || {})
        const pattern = typeof body.pattern === 'string' && body.pattern ? body.pattern : '*'
        const client = await getClient(cfg)
        const keys = []
        let cursor = '0'
        const limit = 10000
        do {
          let reply
          try {
            reply = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 500)
          } catch (error) { throw translateError(error) }
          cursor = String(reply[0])
          const batch = reply[1] || []
          for (const k of batch) keys.push(toText(k))
          if (keys.length >= limit) break
        } while (cursor !== '0')
        const unique = Array.from(new Set(keys)).sort()
        return json({ keys: unique, total: unique.length, pattern })
      } catch (error) { return failure(error, '无法扫描键。') }
    }))

    // Read a key: TYPE + value by type + TTL.
    register(route('get', ['POST'], async (request) => {
      try {
        const body = await readBody(request)
        const cfg = await withStoredPassword(ctx, body.connection || {})
        const key = body.key
        if (typeof key !== 'string' || !key) throw new RedisError('缺少键名。')
        const type = toText(await run(cfg, 'TYPE', key)).trim() || 'none'
        if (type === 'none') return json({ key, type: 'none', value: null, ttl: -2 })
        const ttl = Number(await run(cfg, 'TTL', key))
        let value = null
        if (type === 'string') {
          value = toText(await run(cfg, 'GET', key))
        } else if (type === 'hash') {
          value = toPairs(await run(cfg, 'HGETALL', key))
        } else if (type === 'list') {
          value = toLines(await run(cfg, 'LRANGE', key, 0, 199))
        } else if (type === 'set') {
          value = toLines(await run(cfg, 'SMEMBERS', key))
        } else if (type === 'zset') {
          const raw = await run(cfg, 'ZRANGE', key, 0, 199, 'WITHSCORES')
          value = toPairs(raw)
        } else {
          value = '(unsupported type)'
        }
        return json({ key, type, ttl, value })
      } catch (error) { return failure(error, '无法读取键。') }
    }))

    // Delete keys.
    register(route('delete', ['POST'], async (request) => {
      try {
        const body = await readBody(request)
        const cfg = await withStoredPassword(ctx, body.connection || {})
        const keys = Array.isArray(body.keys) ? body.keys.filter((k) => typeof k === 'string' && k) : []
        if (!keys.length) throw new RedisError('缺少键名。')
        const deleted = Number(await run(cfg, 'DEL', ...keys)) || 0
        return json({ ok: true, deleted })
      } catch (error) { return failure(error, '删除失败。') }
    }))

    // Set TTL on a key.
    register(route('expire', ['POST'], async (request) => {
      try {
        const body = await readBody(request)
        const cfg = await withStoredPassword(ctx, body.connection || {})
        const key = body.key
        const seconds = Number(body.seconds)
        if (typeof key !== 'string' || !key) throw new RedisError('缺少键名。')
        if (!Number.isFinite(seconds)) throw new RedisError('缺少有效期。')
        const r = Number(await run(cfg, 'EXPIRE', key, String(Math.round(seconds))))
        return json({ ok: r === 1 })
      } catch (error) { return failure(error, '设置过期时间失败。') }
    }))

    // Run an arbitrary command (user typed).
    register(route('command', ['POST'], async (request) => {
      try {
        const body = await readBody(request)
        const cfg = await withStoredPassword(ctx, body.connection || {})
        const line = typeof body.command === 'string' ? body.command.trim() : ''
        if (!line) throw new RedisError('请输入命令。')
        const parts = parseLine(line)
        if (!parts.length) throw new RedisError('请输入命令。')
        const client = await getClient(cfg)
        let reply
        try {
          reply = await client.call(parts[0], ...parts.slice(1))
        } catch (error) { throw translateError(error) }
        return json({ output: formatReply(reply), warning: '' })
      } catch (error) { return failure(error, '命令执行失败。') }
    }))

    // --- connection secrets: passwords live in DSH credentials, never in the browser ---
    register(route('secret_set', ['POST'], async (request) => {
      try {
        const body = await readBody(request)
        const id = typeof body.id === 'string' ? body.id.trim() : ''
        const password = typeof body.password === 'string' ? body.password : ''
        if (!id) throw new RedisError('缺少连接标识。')
        if (!password) {
          await ctx.credentials.unset(refOf(id))
          const stillThere = Boolean(await getStoredPassword(ctx, id))
          if (stillThere) throw new RedisError('清空密码失败，请重试。', 500)
          return json({ ok: true, stored: false })
        }
        await ctx.credentials.set(refOf(id), password)
        return json({ ok: true, stored: true })
      } catch (error) { return failure(error, '保存密码失败。') }
    }))

    register(route('secret_clear', ['POST'], async (request) => {
      try {
        const body = await readBody(request)
        const id = typeof body.id === 'string' ? body.id.trim() : ''
        if (!id) throw new RedisError('缺少连接标识。')
        // Do not swallow a failed unset: leftover passwords are a real risk.
        await ctx.credentials.unset(refOf(id))
        const stillThere = Boolean(await getStoredPassword(ctx, id))
        if (stillThere) throw new RedisError('密码未能从凭证库删除，请重试。', 500)
        return json({ ok: true, cleared: true })
      } catch (error) { return failure(error, '删除密码失败。') }
    }))

    // Remove stored passwords whose connection no longer exists (housekeeping).
    // The Client sends every live connection id; anything else under REDIS_CONN_* is orphaned.
    register(route('secret_prune', ['POST'], async (request) => {
      try {
        const body = await readBody(request)
        const keepIds = Array.isArray(body.ids) ? body.ids.map((x) => String(x)).filter(Boolean) : []
        let records = []
        try {
          records = await ctx.credentials.listRecords()
        } catch (_) { records = [] }
        const keepRefs = new Set(keepIds.map((id) => refOf(id)))
        let removed = 0
        for (const record of records || []) {
          const key = String((record && (record.key || record.ref || record.id || record.name)) || '')
          if (!key.startsWith('REDIS_CONN_')) continue
          if (keepRefs.has(key)) continue
          try { await ctx.credentials.unset(key); removed += 1 } catch (_) {}
        }
        return json({ ok: true, removed })
      } catch (error) { return failure(error, '清理孤立密码失败。') }
    }))

    // Report which connections have a stored password (never returns the value).
    register(route('secret_has', ['POST'], async (request) => {
      try {
        const body = await readBody(request)
        const ids = Array.isArray(body.ids) ? body.ids.map((x) => String(x)) : []
        const result = {}
        for (const id of ids) {
          if (!id) continue
          result[id] = Boolean(await getStoredPassword(ctx, id))
        }
        return json({ result })
      } catch (error) { return failure(error, '查询密码状态失败。') }
    }))

    return () => {
      for (const client of pool.values()) {
        try { client.disconnect() } catch (_) {}
      }
      pool.clear()
      for (const dispose of disposers) {
        try {
          const result = dispose()
          if (result && typeof result.then === 'function') result.catch(() => {})
        } catch (_) {}
      }
    }
  }, 'dsh-redis-client: routes')
}

// Pretty-print a Redis reply for the command console.
function formatReply(reply) {
  if (reply === null || reply === undefined) return '(nil)'
  if (typeof reply === 'number') return String(reply)
  if (typeof reply === 'string') return reply
  if (Buffer.isBuffer(reply)) return reply.toString('utf8')
  if (Array.isArray(reply)) {
    return reply.map((item, i) => `${String(i + 1)}) ${formatInline(item)}`).join('\n')
  }
  if (typeof reply === 'object') {
    return Object.entries(reply).map(([k, v]) => `${k}: ${formatInline(v)}`).join('\n')
  }
  return String(reply)
}
function formatInline(value) {
  if (value === null || value === undefined) return '(nil)'
  if (Array.isArray(value)) return value.map(formatInline).join(', ')
  if (Buffer.isBuffer(value)) return value.toString('utf8')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
