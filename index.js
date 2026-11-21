/**
 * Host half of the Redis client bundle.
 *
 * Runs redis-cli via a child process for each operation. Connection details
 * are supplied per request by the Client (stored locally there); nothing is
 * persisted on the Host. Args are passed as an argv array so values are never
 * interpreted by a shell.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

export const name = 'dsh-redis-client'
export const inject = ['connection']

const execFileAsync = promisify(execFile)
const API = '/api/dsh-redis-client'
const CLI = process.env.REDIS_CLI_PATH || 'redis-cli'
const TIMEOUT = 8000

class RedisError extends Error {
  constructor(message, status = 400) { super(message); this.status = status }
}
function json(value, status = 200) {
  return Response.json(value, { status, headers: { 'cache-control': 'no-store' } })
}
function failure(error, fallback) {
  const message = error instanceof RedisError ? error.message : fallback
  const status = error instanceof RedisError ? error.status : 500
  return json({ error: message }, status)
}
function route(path, methods, fetch) {
  return { path: `${API}/${path}`, methods, requestBody: 'buffered', fetch }
}

// Build the argv prefix for a connection.
function connArgs(cfg) {
  const args = []
  if (cfg.host) args.push('-h', String(cfg.host))
  if (cfg.port) args.push('-p', String(cfg.port))
  if (cfg.password) args.push('-a', String(cfg.password))
  if (cfg.username) args.push('--user', String(cfg.username))
  if (cfg.db !== undefined && cfg.db !== null && cfg.db !== '') args.push('-n', String(cfg.db))
  if (cfg.timeout) args.push('-t', String(cfg.timeout))
  return args
}
async function readBody(request) {
  try {
    const text = await request.text()
    return JSON.parse(text || '{}')
  } catch (_) { throw new RedisError('请求内容不是合法的 JSON。') }
}
// Run redis-cli with command args and return raw stdout.
async function run(cfg, commandArgs) {
  const argv = [...connArgs(cfg), ...commandArgs]
  try {
    const { stdout, stderr } = await execFileAsync(CLI, argv, { timeout: TIMEOUT, maxBuffer: 8 * 1024 * 1024 })
    // redis-cli may print warnings to stderr (e.g. AUTH warning) alongside valid stdout.
    return { out: stdout, err: stderr }
  } catch (error) {
    const msg = (error && error.message) || String(error)
    if (msg.includes('ENOENT')) throw new RedisError('找不到 redis-cli，请确认已安装。', 500)
    if (msg.includes('timed out') || msg.includes('ETIMEDOUT')) throw new RedisError('连接超时，请检查地址与端口。', 504)
    // redis-cli often exits non-zero with a useful stderr message.
    const detail = (error && error.stderr) ? String(error.stderr).trim() : msg
    throw new RedisError(detail || '命令执行失败。')
  }
}
function clean(s) { return String(s == null ? '' : s).replace(/\r/g, '') }

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
        const { out } = await run(body.connection || {}, ['PING'])
        const text = clean(out).trim()
        return json({ ok: /PONG/i.test(text), raw: text })
      } catch (error) { return failure(error, '连接测试失败。') }
    }))

    // List all 16 databases via INFO keyspace (best effort).
    register(route('dbs', ['POST'], async (request) => {
      try {
        const body = await readBody(request)
        const cfg = body.connection || {}
        const base = { ...cfg, db: 0 }
        const { out } = await run(base, ['INFO', 'keyspace'])
        const keyspace = {}
        for (const line of clean(out).split('\n')) {
          const m = line.match(/^db(\d+):(.*)$/)
          if (m) keyspace[m[1]] = m[2].trim()
        }
        const dbs = Array.from({ length: 16 }, (_, i) => ({ index: i, info: keyspace[String(i)] || '' }))
        return json({ dbs })
      } catch (error) { return failure(error, '无法读取数据库信息。') }
    }))

    // Scan keys with MATCH using redis-cli --scan (iterator mode).
    // Note: redis-cli 6.x supports --pattern but NOT --count; omit it.
    register(route('keys', ['POST'], async (request) => {
      try {
        const body = await readBody(request)
        const cfg = body.connection || {}
        const pattern = typeof body.pattern === 'string' && body.pattern ? body.pattern : '*'
        const args = [...connArgs(cfg), '--scan', '--pattern', pattern]
        let stdout
        try {
          const r = await execFileAsync(CLI, args, { timeout: TIMEOUT, maxBuffer: 16 * 1024 * 1024 })
          stdout = r.stdout
        } catch (error) {
          const detail = (error && error.stderr) ? String(error.stderr).trim() : ''
          if (detail) throw new RedisError(detail)
          throw error
        }
        const keys = clean(stdout).split('\n').map((k) => k.trim()).filter(Boolean).sort()
        return json({ keys, total: keys.length, pattern })
      } catch (error) { return failure(error, '无法扫描键。') }
    }))

    // Read a key: TYPE + value by type + TTL.
    register(route('get', ['POST'], async (request) => {
      try {
        const body = await readBody(request)
        const cfg = body.connection || {}
        const key = body.key
        if (typeof key !== 'string' || !key) throw new RedisError('缺少键名。')
        const { out: typeOut } = await run(cfg, ['TYPE', key])
        const type = clean(typeOut).trim().replace(/^"|"$/g, '') || 'none'
        if (type === 'none') return json({ key, type: 'none', value: null, ttl: -2 })
        const { out: ttlOut } = await run(cfg, ['TTL', key])
        const ttl = parseInt(clean(ttlOut).trim(), 10)
        let value = null
        if (type === 'string') {
          const r = await run(cfg, ['GET', key]); value = clean(r.out).replace(/\n$/, '')
        } else if (type === 'hash') {
          const r = await run(cfg, ['HGETALL', key]); value = parsePairs(r.out)
        } else if (type === 'list') {
          const r = await run(cfg, ['LRANGE', key, '0', '199']); value = parseLines(r.out)
        } else if (type === 'set') {
          const r = await run(cfg, ['SMEMBERS', key]); value = parseLines(r.out)
        } else if (type === 'zset') {
          const r = await run(cfg, ['ZRANGE', key, '0', '199', 'WITHSCORES']); value = parsePairs(r.out)
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
        const cfg = body.connection || {}
        const keys = Array.isArray(body.keys) ? body.keys.filter((k) => typeof k === 'string' && k) : []
        if (!keys.length) throw new RedisError('缺少键名。')
        const { out } = await run(cfg, ['DEL', ...keys])
        return json({ ok: true, deleted: parseInt(clean(out).trim(), 10) || 0 })
      } catch (error) { return failure(error, '删除失败。') }
    }))

    // Set TTL on a key.
    register(route('expire', ['POST'], async (request) => {
      try {
        const body = await readBody(request)
        const cfg = body.connection || {}
        const key = body.key
        const seconds = Number(body.seconds)
        if (typeof key !== 'string' || !key) throw new RedisError('缺少键名。')
        if (!Number.isFinite(seconds)) throw new RedisError('缺少有效期。')
        const { out } = await run(cfg, ['EXPIRE', key, String(Math.round(seconds))])
        return json({ ok: clean(out).trim() === '1' })
      } catch (error) { return failure(error, '设置过期时间失败。') }
    }))

    // Run an arbitrary read-only-ish command (user typed).
    register(route('command', ['POST'], async (request) => {
      try {
        const body = await readBody(request)
        const cfg = body.connection || {}
        const line = typeof body.command === 'string' ? body.command.trim() : ''
        if (!line) throw new RedisError('请输入命令。')
        const parts = splitCommand(line)
        const { out, err } = await run(cfg, parts)
        return json({ output: clean(out), warning: clean(err).trim() })
      } catch (error) { return failure(error, '命令执行失败。') }
    }))

    return () => {
      for (const dispose of disposers) {
        try {
          const result = dispose()
          if (result && typeof result.then === 'function') result.catch(() => {})
        } catch (_) {}
      }
    }
  }, 'dsh-redis-client: routes')
}

function parseLines(text) {
  return clean(text).split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
}
function parsePairs(text) {
  const lines = parseLines(text)
  const out = []
  for (let i = 0; i < lines.length; i += 2) out.push({ field: lines[i], value: lines[i + 1] === undefined ? '' : lines[i + 1] })
  return out
}
function splitCommand(line) {
  // Simple quote-aware tokenizer for typed redis commands.
  const out = []
  let cur = ''
  let quote = null
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quote) {
      if (ch === quote && line[i - 1] !== '\\') { quote = null }
      else cur += ch
    } else if (ch === '"' || ch === "'") quote = ch
    else if (/\s/.test(ch)) { if (cur) { out.push(cur); cur = '' } }
    else cur += ch
  }
  if (cur) out.push(cur)
  return out
}
