/**
 * Client half of the Redis client bundle.
 *
 * Registers a left sidebar entry + panel. Connections are kept in localStorage
 * and each operation calls the Host's /api/dsh-redis-client routes.
 */
window.__ModuleLoader__.load({
  id: 'dsh-redis-client',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useCallback, useMemo } = React

    const NS = 'dsh-redis-client'
    const PANEL_ID = 'redis-client'
    const STYLE_ID = 'dsh-redis-client/css'
    const API = '/api/dsh-redis-client'
    const CONN_KEY = 'dsh-redis-client.connections.v1'
    const ACTIVE_KEY = 'dsh-redis-client.active.v1'

    const zh = {
      title: 'Redis 客户端', subtitle: '管理 Redis 连接，浏览键与值。',
      connections: '连接', newConn: '新建连接', edit: '编辑', delete: '删除', save: '保存', cancel: '取消',
      name: '名称', host: '地址', port: '端口', password: '密码', username: '用户名(可选)', db: '数据库',
      test: '测试连接', connected: '已连接', disconnected: '未连接', pingOk: '连接成功', pingFail: '连接失败',
      keys: '键', refresh: '刷新', filter: '筛选键 (*)', count: '共 {n} 个键',
      type: '类型', ttl: '过期(秒)', value: '值', field: '字段', noKeys: '暂无匹配键，点刷新扫描。',
      selectKey: '选择一个键查看内容', permanent: '永久', expire: '设置过期', deleteKey: '删除键',
      command: '命令行', run: '执行', output: '输出', noConn: '请先新建并选择一个连接。',
      noWorkspace: '', listFailed: '操作失败', confirmDelete: '确定删除该连接？', confirmDelKey: '确定删除这个键？',
      expireHint: '秒数，-1 表示永久', quickCmd: '常用：GET key / SET key val / DBSIZE / INFO',
    }
    const en = {
      title: 'Redis client', subtitle: 'Manage Redis connections and browse keys and values.',
      connections: 'Connections', newConn: 'New connection', edit: 'Edit', delete: 'Delete', save: 'Save', cancel: 'Cancel',
      name: 'Name', host: 'Host', port: 'Port', password: 'Password', username: 'Username (optional)', db: 'Database',
      test: 'Test connection', connected: 'Connected', disconnected: 'Disconnected', pingOk: 'Connected', pingFail: 'Connection failed',
      keys: 'Keys', refresh: 'Refresh', filter: 'Filter keys (*)', count: '{n} keys',
      type: 'Type', ttl: 'TTL (s)', value: 'Value', field: 'Field', noKeys: 'No matching keys. Click Refresh to scan.',
      selectKey: 'Select a key to view its value', permanent: 'Permanent', expire: 'Set TTL', deleteKey: 'Delete key',
      command: 'Command', run: 'Run', output: 'Output', noConn: 'Create and select a connection first.',
      noWorkspace: '', listFailed: 'Operation failed', confirmDelete: 'Delete this connection?', confirmDelKey: 'Delete this key?',
      expireHint: 'Seconds, -1 for permanent', quickCmd: 'Try: GET key / SET key val / DBSIZE / INFO',
    }
    let t = (key) => (zh[key] || key)
    const fmt = (s, v) => String(s || '').replace(/\{(\w+)\}/g, (_, k) => (v && v[k] != null ? v[k] : ''))

    function readConns() {
      try {
        const raw = window.localStorage.getItem(CONN_KEY)
        const p = raw ? JSON.parse(raw) : []
        return Array.isArray(p) ? p : []
      } catch (_) { return [] }
    }
    function writeConns(c) { try { window.localStorage.setItem(CONN_KEY, JSON.stringify(c)) } catch (_) {} }
    function readActive() { try { return window.localStorage.getItem(ACTIVE_KEY) || '' } catch (_) { return '' } }
    function writeActive(id) { try { window.localStorage.setItem(ACTIVE_KEY, id) } catch (_) {} }
    function makeId() { return 'c-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7) }

    async function api(path, body) {
      const res = await fetch(API + path, {
        method: body === undefined ? 'GET' : 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      let data = null
      try { data = await res.json() } catch (_) {}
      if (!res.ok) throw new Error((data && data.error) || ('HTTP ' + res.status))
      return data
    }

    function SidebarIcon(props) {
      const size = typeof props.size === 'number' ? props.size : 20
      return h('svg', {
        viewBox: '0 0 24 24', width: size, height: size, fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.6, 'aria-hidden': true,
        style: { opacity: props.active ? 1 : 0.82 },
      },
        h('ellipse', { cx: 12, cy: 6, rx: 8, ry: 3 }),
        h('path', { d: 'M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6' }),
        h('path', { d: 'M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6' })
      )
    }

    function RedisPanel({ ctx }) {
      const [conns, setConns] = useState(readConns)
      const [activeId, setActiveId] = useState(readActive)
      const [editing, setEditing] = useState(null)
      const [form, setForm] = useState({ name: '', host: '127.0.0.1', port: 6379, password: '', username: '', db: 0 })
      const [ping, setPing] = useState('')
      const [keys, setKeys] = useState([])
      const [pattern, setPattern] = useState('*')
      const [selected, setSelected] = useState('')
      const [detail, setDetail] = useState(null)
      const [cmd, setCmd] = useState('')
      const [output, setOutput] = useState('')
      const [busy, setBusy] = useState(false)
      const [err, setErr] = useState('')
      const [expireVal, setExpireVal] = useState('-1')

      const active = useMemo(() => conns.find((c) => c.id === activeId) || null, [conns, activeId])
      const connCfg = active ? { host: active.host, port: active.port, password: active.password, username: active.username, db: active.db } : null

      useEffect(() => { writeConns(conns) }, [conns])
      useEffect(() => { writeActive(activeId) }, [activeId])

      const saveConn = useCallback(() => {
        const c = {
          id: editing || makeId(),
          name: form.name.trim() || (form.host + ':' + form.port),
          host: form.host.trim() || '127.0.0.1',
          port: Number(form.port) || 6379,
          password: form.password || '', username: form.username || '',
          db: Number(form.db) || 0,
        }
        setConns((prev) => editing ? prev.map((x) => x.id === editing ? c : x) : [...prev, c])
        setActiveId(c.id)
        setEditing(null)
        setPing('')
        setErr('')
      }, [form, editing])

      const editConn = useCallback((c) => {
        setEditing(c.id)
        setForm({ name: c.name, host: c.host, port: c.port, password: c.password || '', username: c.username || '', db: c.db || 0 })
      }, [])

      const removeConn = useCallback((id) => {
        if (!window.confirm(t('confirmDelete'))) return
        setConns((prev) => prev.filter((c) => c.id !== id))
        if (activeId === id) { setActiveId(''); setKeys([]); setSelected(''); setDetail(null) }
      }, [activeId])

      const testConn = useCallback(async () => {
        if (!connCfg) return
        setBusy(true); setErr(''); setPing('')
        try {
          const d = await api('/ping', { connection: connCfg })
          setPing(d.ok ? t('pingOk') : (t('pingFail') + ': ' + d.raw))
        } catch (e) { setPing(t('pingFail')); setErr(e.message) }
        finally { setBusy(false) }
      }, [connCfg])

      const scanKeys = useCallback(async () => {
        if (!connCfg) return
        setBusy(true); setErr('')
        try {
          const d = await api('/keys', { connection: connCfg, pattern: pattern || '*' })
          setKeys(d.keys || [])
        } catch (e) { setErr(e.message) }
        finally { setBusy(false) }
      }, [connCfg, pattern])

      const openKey = useCallback(async (key) => {
        if (!connCfg) return
        setSelected(key); setErr(''); setExpireVal('-1')
        try {
          const d = await api('/get', { connection: connCfg, key })
          setDetail(d)
          setExpireVal(d.ttl >= 0 ? String(d.ttl) : '-1')
        } catch (e) { setErr(e.message); setDetail(null) }
      }, [connCfg])

      const delKey = useCallback(async () => {
        if (!connCfg || !selected) return
        if (!window.confirm(t('confirmDelKey'))) return
        setBusy(true)
        try {
          await api('/delete', { connection: connCfg, keys: [selected] })
          setSelected(''); setDetail(null); await scanKeys()
        } catch (e) { setErr(e.message) }
        finally { setBusy(false) }
      }, [connCfg, selected, scanKeys])

      const setExpire = useCallback(async () => {
        if (!connCfg || !selected) return
        setBusy(true)
        try {
          const n = Number(expireVal)
          if (n < 0) await api('/command', { connection: connCfg, command: 'PERSIST ' + JSON.stringify(selected) })
          else await api('/expire', { connection: connCfg, key: selected, seconds: n })
          await openKey(selected)
        } catch (e) { setErr(e.message) }
        finally { setBusy(false) }
      }, [connCfg, selected, expireVal, openKey])

      const runCmd = useCallback(async () => {
        if (!connCfg || !cmd.trim()) return
        setBusy(true); setErr('')
        try {
          const d = await api('/command', { connection: connCfg, command: cmd })
          setOutput(d.output || '')
        } catch (e) { setErr(e.message); setOutput('') }
        finally { setBusy(false) }
      }, [connCfg, cmd])

      const goBack = useCallback(() => {
        try { if (ctx && ctx.layout) ctx.layout.selectPanel('conversation') } catch (_) {}
      }, [ctx])

      const formRow = (label, key, type) =>
        h('label', { className: 'dshRds-field' },
          h('span', null, t(label)),
          h('input', {
            className: 'dshRds-input', type: type || 'text',
            value: form[key],
            onChange: (e) => setForm((f) => ({ ...f, [key]: e.target.value })),
          })
        )

      const valueNode = detail && detail.value != null
        ? (Array.isArray(detail.value)
            ? (detail.type === 'hash' || detail.type === 'zset'
                ? h('div', { className: 'dshRds-pairs' }, detail.value.map((p, i) =>
                    h('div', { key: i, className: 'dshRds-pair' },
                      h('span', { className: 'dshRds-badge' }, p.field),
                      h('span', null, p.value))))
                : h('div', { className: 'dshRds-list' }, detail.value.map((v, i) => h('div', { key: i }, v))))
            : h('pre', { className: 'dshRds-value' }, String(detail.value)))
        : null

      return h('div', { className: 'dshRds-root' },
        h('div', { className: 'dshRds-head' },
          h('div', null,
            h('div', { className: 'dshRds-title' }, t('title')),
            h('div', { className: 'dshRds-sub' }, t('subtitle'))
          ),
          h('button', { type: 'button', className: 'dshRds-back', onClick: goBack }, t('back'))
        ),
        err ? h('div', { className: 'dshRds-err' }, err) : null,
        h('div', { className: 'dshRds-cols' },
          // left: connections
          h('div', { className: 'dshRds-col' },
            h('div', { className: 'dshRds-card' },
              h('div', { className: 'dshRds-cardTitle' }, t('connections')),
              h('div', { className: 'dshRds-connList' },
                conns.length === 0
                  ? h('div', { className: 'dshRds-note' }, t('noConn'))
                  : conns.map((c) =>
                      h('div', {
                        key: c.id,
                        className: 'dshRds-conn' + (activeId === c.id ? ' dshRds-connOn' : ''),
                        onClick: () => { setActiveId(c.id); setKeys([]); setSelected(''); setDetail(null); setPing('') },
                      },
                        h('span', { className: 'dshRds-name' }, c.name),
                        h('span', { className: 'dshRds-addr' }, `${c.host}:${c.port}`),
                        h('button', { type: 'button', className: 'dshRds-mini', onClick: (e) => { e.stopPropagation(); editConn(c) } }, t('edit')),
                        h('button', { type: 'button', className: 'dshRds-mini dshRds-del', onClick: (e) => { e.stopPropagation(); removeConn(c.id) } }, '×')
                      )
                    )
              ),
              h('button', { type: 'button', className: 'dshRds-btn dshRds-btnPrimary', onClick: () => { setEditing(null); setForm({ name: '', host: '127.0.0.1', port: 6379, password: '', username: '', db: 0 }) } }, '+ ' + t('newConn')),
              active
                ? h('button', { type: 'button', className: 'dshRds-btn', disabled: busy, onClick: testConn }, t('test'))
                : null,
              ping ? h('div', { className: 'dshRds-note' }, ping) : null
            ),
            // connection form
            h('div', { className: 'dshRds-card' },
              h('div', { className: 'dshRds-cardTitle' }, editing ? t('edit') : t('newConn')),
              h('div', { className: 'dshRds-form' },
                formRow('name', 'name'), formRow('host', 'host'),
                formRow('port', 'port', 'number'), formRow('password', 'password', 'password'),
                formRow('username', 'username'), formRow('db', 'db', 'number'),
                h('button', { type: 'button', className: 'dshRds-btn dshRds-btnPrimary', onClick: saveConn }, t('save'))
              )
            )
          ),
          // middle: keys
          h('div', { className: 'dshRds-col' },
            h('div', { className: 'dshRds-card dshRds-fill' },
              h('div', { className: 'dshRds-cardTitle' }, t('keys')),
              h('div', { className: 'dshRds-searchRow' },
                h('input', {
                  className: 'dshRds-input', value: pattern, placeholder: t('filter'),
                  onChange: (e) => setPattern(e.target.value),
                  onKeyDown: (e) => { if (e.key === 'Enter') scanKeys() },
                }),
                h('button', { type: 'button', className: 'dshRds-btn', disabled: busy || !connCfg, onClick: scanKeys }, t('refresh'))
              ),
              h('div', { className: 'dshRds-note' }, fmt(t('count'), { n: keys.length })),
              h('div', { className: 'dshRds-keyList' },
                keys.length === 0
                  ? h('div', { className: 'dshRds-note' }, t('noKeys'))
                  : keys.map((k) =>
                      h('div', {
                        key: k, className: 'dshRds-key' + (selected === k ? ' dshRds-keyOn' : ''),
                        onClick: () => openKey(k), title: k,
                      }, k)
                    )
              )
            )
          ),
          // right: value + command
          h('div', { className: 'dshRds-col' },
            h('div', { className: 'dshRds-card' },
              h('div', { className: 'dshRds-cardTitle' }, selected || t('selectKey')),
              detail && detail.type !== 'none'
                ? h('div', { className: 'dshRds-detail' },
                    h('div', { className: 'dshRds-meta' },
                      h('span', null, t('type') + ': ' + detail.type),
                      h('span', null, t('ttl') + ': ' + (detail.ttl >= 0 ? detail.ttl : t('permanent')))
                    ),
                    valueNode,
                    h('div', { className: 'dshRds-actions' },
                      h('input', {
                        className: 'dshRds-input', type: 'number', value: expireVal,
                        onChange: (e) => setExpireVal(e.target.value), title: t('expireHint'),
                      }),
                      h('button', { type: 'button', className: 'dshRds-btn', disabled: busy, onClick: setExpire }, t('expire')),
                      h('button', { type: 'button', className: 'dshRds-btn dshRds-del', disabled: busy, onClick: delKey }, t('deleteKey'))
                    )
                  )
                : h('div', { className: 'dshRds-note' }, t('selectKey'))
            ),
            h('div', { className: 'dshRds-card' },
              h('div', { className: 'dshRds-cardTitle' }, t('command')),
              h('div', { className: 'dshRds-searchRow' },
                h('input', {
                  className: 'dshRds-input', value: cmd, placeholder: t('quickCmd'),
                  onChange: (e) => setCmd(e.target.value),
                  onKeyDown: (e) => { if (e.key === 'Enter') runCmd() },
                }),
                h('button', { type: 'button', className: 'dshRds-btn', disabled: busy || !connCfg, onClick: runCmd }, t('run'))
              ),
              output ? h('pre', { className: 'dshRds-value' }, output) : null
            )
          )
        )
      )
    }

    function apply(ctx) {
      ctx.effect(() => installStyles(), 'dsh-redis-client: styles')
      if (ctx.locale !== undefined) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-redis-client: dictionaries')
        t = ctx.locale.bind(NS)
      }
      ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist', id: PANEL_ID, order: 26, label: () => t('title'), locale: NS,
      }, SidebarIcon)), 'dsh-redis-client: sidebar entry')
      ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main', key: PANEL_ID, locale: NS,
      }, (props) => h(RedisPanel, { ctx }))), 'dsh-redis-client: panel')
    }

    function installStyles() {
      if (typeof document === 'undefined') return () => {}
      const existing = document.querySelector('style[data-plugin-css="' + STYLE_ID + '"]')
      if (existing) return () => {}
      const style = document.createElement('style')
      style.dataset.plugin = NS
      style.dataset.pluginCss = STYLE_ID
      style.textContent = `
.dshRds-root{display:flex;flex-direction:column;height:100%;box-sizing:border-box;padding:16px 18px 18px;gap:12px;overflow:hidden;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base)}
.dshRds-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex:0 0 auto}
.dshRds-title{font-size:20px;font-weight:700;line-height:1.3}
.dshRds-sub{font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:3px}
.dshRds-back{display:inline-flex;align-items:center;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;padding:5px 11px;border-radius:8px;cursor:pointer;font-family:inherit;white-space:nowrap}
.dshRds-err{font-size:11px;color:var(--dsw-alias-state-error-primary);flex:0 0 auto}
.dshRds-cols{display:grid;grid-template-columns:minmax(220px,1.1fr) minmax(200px,1fr) minmax(220px,1.2fr);gap:12px;flex:1 1 auto;min-height:0}
.dshRds-col{display:flex;flex-direction:column;gap:10px;min-height:0;overflow-y:auto}
.dshRds-card{padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:8px}
.dshRds-fill{flex:1 1 auto;min-height:0}
.dshRds-cardTitle{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.dshRds-note{font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.5}
.dshRds-btn{padding:7px 11px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;cursor:pointer;font-family:inherit;white-space:nowrap}
.dshRds-btn:hover{border-color:var(--dsw-alias-brand-primary)}
.dshRds-btn:disabled{opacity:.45;cursor:not-allowed}
.dshRds-btnPrimary{background:#d82c20;color:#fff;border-color:transparent;font-weight:600}
.dshRds-del{color:var(--dsw-alias-state-error-primary)}
.dshRds-connList{display:flex;flex-direction:column;gap:4px}
.dshRds-conn{display:flex;align-items:center;gap:6px;padding:7px 8px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1);cursor:pointer;font-size:12px;flex-wrap:wrap}
.dshRds-connOn{border-color:#d82c20;background:var(--dsw-alias-bg-layer-2)}
.dshRds-name{font-weight:600;flex:1 1 auto}
.dshRds-addr{font-size:10px;color:var(--dsw-alias-label-secondary)}
.dshRds-mini{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:11px;cursor:pointer;padding:0 3px;font-family:inherit}
.dshRds-form{display:flex;flex-direction:column;gap:7px}
.dshRds-field{display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.dshRds-input{padding:6px 9px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:12px;outline:none;font-family:inherit;min-width:0}
.dshRds-input:focus{border-color:var(--dsw-alias-brand-primary)}
.dshRds-searchRow{display:flex;gap:6px}
.dshRds-searchRow .dshRds-input{flex:1 1 auto}
.dshRds-keyList{flex:1 1 auto;min-height:120px;overflow-y:auto;display:flex;flex-direction:column;gap:2px}
.dshRds-key{padding:6px 8px;border-radius:6px;font-size:12px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshRds-key:hover{background:var(--dsw-alias-bg-layer-2)}
.dshRds-keyOn{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-brand-primary);font-weight:600}
.dshRds-detail{display:flex;flex-direction:column;gap:8px}
.dshRds-meta{display:flex;gap:14px;font-size:11px;color:var(--dsw-alias-label-secondary);flex-wrap:wrap}
.dshRds-value{margin:0;padding:10px;border-radius:8px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);font-family:ui-monospace,monospace;font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-all;max-height:280px;overflow:auto}
.dshRds-pairs,.dshRds-list{display:flex;flex-direction:column;gap:4px;max-height:280px;overflow:auto;font-size:12px}
.dshRds-pair{display:flex;gap:8px;padding:4px 6px;border-radius:6px;background:var(--dsw-alias-bg-base)}
.dshRds-badge{font-weight:600;color:var(--dsw-alias-brand-primary);min-width:60px}
.dshRds-actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.dshRds-actions .dshRds-input{width:80px}
@media(max-width:1000px){.dshRds-cols{grid-template-columns:1fr;overflow-y:auto}.dshRds-col{overflow:visible}}
`
      document.head.appendChild(style)
      return () => { style.remove() }
    }

    return { inject: ['slots', 'locale'], apply }
  },
})
