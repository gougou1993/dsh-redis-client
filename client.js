/**
 * Client half of the Redis client bundle.
 *
 * Registers a left sidebar entry + panel. Connections are kept in localStorage
 * and each operation calls the Host's /api/dsh-redis-client routes.
 */
window.__ModuleLoader__.load({
  id: '@oakzhong/dsh-redis-client',
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
      import: '导入连接', export: '导出连接', confirmImport: '导入将追加到现有连接列表，继续？',
      importOk: '成功导入 {n} 个连接', importFail: '导入失败：文件格式不正确', exported: '已导出 {n} 个连接（不含密码）', back: '返回',
      pwdSaved: '密码已保存到本机凭证库', pwdHint: '密码保存在本机凭证库，不写入浏览器存储', pwdEmpty: '留空则不修改已存密码',
      secretClearFail: '删除连接失败：密码未能从凭证库清除', pruneSecret: '清理孤立密码', prunedN: '已清理 {n} 条孤立密码', pruneNone: '没有孤立密码',
      group: '分组', groupPlaceholder: '分组名称（留空=未分组）', ungrouped: '未分组', collapseAll: '全部折叠', expandAll: '全部展开',
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
      import: 'Import', export: 'Export', confirmImport: 'Import will append to existing connections. Continue?',
      importOk: 'Imported {n} connections', importFail: 'Import failed: invalid file format', exported: 'Exported {n} connections (no passwords)', back: 'Back',
      pwdSaved: 'Password saved to the local credential store', pwdHint: 'Passwords live in the local credential store, not browser storage', pwdEmpty: 'Leave blank to keep the stored password',
      secretClearFail: 'Delete aborted: the stored password could not be cleared', pruneSecret: 'Prune orphaned passwords', prunedN: 'Pruned {n} orphaned passwords', pruneNone: 'No orphaned passwords',
      group: 'Group', groupPlaceholder: 'Group name (blank = ungrouped)', ungrouped: 'Ungrouped', collapseAll: 'Collapse all', expandAll: 'Expand all',
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
      const fileRef = useRef(null)
      const [conns, setConns] = useState(readConns)
      const [activeId, setActiveId] = useState(readActive)
      const [editing, setEditing] = useState(null)
      const [form, setForm] = useState({ name: '', host: '127.0.0.1', port: 6379, password: '', username: '', db: 0, group: '' })
      const [ping, setPing] = useState('')
      const [pingOk, setPingOk] = useState(false)
      const [collapsed, setCollapsed] = useState({})
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
      // Group connections by their `group` field; empty group renders as "Ungrouped".
      const grouped = useMemo(() => {
        const map = new Map()
        for (const c of conns) {
          const g = (c.group || '').trim()
          if (!map.has(g)) map.set(g, [])
          map.get(g).push(c)
        }
        return Array.from(map.entries()).sort((a, b) => {
          if (a[0] === '') return 1
          if (b[0] === '') return -1
          return a[0].localeCompare(b[0])
        })
      }, [conns])

      const connCfg = active ? { id: active.id, host: active.host, port: active.port, username: active.username, db: active.db, hasPassword: Boolean(active.hasPassword) } : null

      useEffect(() => { writeConns(conns) }, [conns])
      useEffect(() => { writeActive(activeId) }, [activeId])

      // One-time migration: older versions kept the plaintext password in localStorage.
      // Move any such value into the Host credential store, then drop it locally.
      useEffect(() => {
        let cancelled = false
        ;(async () => {
          const legacy = conns.filter((c) => typeof c.password === 'string' && c.password)
          if (!legacy.length) return
          for (const c of legacy) {
            try { await api('/secret_set', { id: c.id, password: c.password }) } catch (_) { return }
          }
          if (cancelled) return
          setConns((prev) => prev.map((c) => {
            if (typeof c.password !== 'string' || !c.password) return c
            const { password, ...rest } = c
            return { ...rest, hasPassword: true }
          }))
        })()
        return () => { cancelled = true }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      const saveConn = useCallback(async () => {
        const id = editing || makeId()
        const password = form.password || ''
        // Passwords never enter localStorage: they go to the Host credential store.
        const c = {
          id,
          name: form.name.trim() || (form.host + ':' + form.port),
          host: form.host.trim() || '127.0.0.1',
          port: Number(form.port) || 6379,
          hasPassword: Boolean(password) || Boolean(editing && conns.find((x) => x.id === editing)?.hasPassword),
          username: form.username || '',
          db: Number(form.db) || 0,
          group: (form.group || '').trim(),
        }
        setConns((prev) => editing ? prev.map((x) => x.id === editing ? c : x) : [...prev, c])
        setActiveId(id)
        setEditing(null)
        setPing('')
        setErr('')
        try {
          if (password) await api('/secret_set', { id, password })
          else if (editing) await api('/secret_set', { id, password: '' })
        } catch (e) { setErr(e.message) }
      }, [form, editing, conns])

      const exportConns = useCallback(() => {
        const payload = {
          app: 'dsh-redis-client', version: 1,
          exportedAt: new Date().toISOString(),
          // Passwords are never exported by default: they live only in the Host credential store.
          connections: conns.map(({ id, ...rest }) => ({ ...rest, password: '', hasPassword: Boolean(rest.hasPassword) })),
        }
        try {
          const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url; a.download = 'redis-connections.json'
          document.body.appendChild(a); a.click(); a.remove()
          setTimeout(() => URL.revokeObjectURL(url), 1000)
          setErr(fmt(t('exported'), { n: conns.length }))
        } catch (e) { setErr(e.message) }
      }, [conns])

      const importConns = useCallback(async (e) => {
        const file = e.target.files && e.target.files[0]
        if (!file) return
        try {
          const text = await file.text()
          const data = JSON.parse(text)
          const list = Array.isArray(data) ? data : (data && Array.isArray(data.connections) ? data.connections : null)
          if (!list) { setErr(t('importFail')); return }
          const pending = []
          const clean = list.filter((x) => x && x.host)
            .map((x) => {
              const id = makeId()
              const pwd = typeof x.password === 'string' ? x.password : ''
              if (pwd) pending.push({ id, password: pwd })
              return {
                id,
                name: x.name || (x.host + ':' + (x.port || 6379)),
                host: String(x.host), port: Number(x.port) || 6379,
                hasPassword: Boolean(pwd) || Boolean(x.hasPassword),
                username: x.username || '', db: Number(x.db) || 0,
              }
            })
          if (!clean.length) { setErr(t('importFail')); return }
          if (!window.confirm(t('confirmImport'))) return
          // Move any passwords carried by the file into the Host credential store.
          for (const item of pending) {
            try { await api('/secret_set', item) } catch (_) {}
          }
          setConns((prev) => [...prev, ...clean])
          setActiveId(clean[0].id)
          setErr(fmt(t('importOk'), { n: clean.length }))
        } catch (_) { setErr(t('importFail')) }
        e.target.value = ''
      }, [])

      const pruneSecrets = useCallback(async () => {
        setBusy(true); setErr('')
        try {
          const d = await api('/secret_prune', { ids: conns.map((c) => c.id) })
          const n = Number(d && d.removed) || 0
          setErr(n > 0 ? fmt(t('prunedN'), { n }) : t('pruneNone'))
        } catch (e) { setErr(e.message) }
        finally { setBusy(false) }
      }, [conns])

      const editConn = useCallback((c) => {
        setEditing(c.id)
        setForm({ name: c.name, host: c.host, port: c.port, password: '', username: c.username || '', db: c.db || 0, group: c.group || '' })
      }, [])

      const removeConn = useCallback(async (id) => {
        if (!window.confirm(t('confirmDelete'))) return
        // Clear the stored password first; if that fails the user must know, otherwise a secret is orphaned.
        try {
          await api('/secret_clear', { id })
        } catch (e) {
          setErr(t('secretClearFail') + (e.message ? ': ' + e.message : ''))
          return
        }
        setConns((prev) => prev.filter((c) => c.id !== id))
        if (activeId === id) { setActiveId(''); setKeys([]); setSelected(''); setDetail(null); setPing(''); setPingOk(false) }
      }, [activeId])

      const testConn = useCallback(async () => {
        if (!connCfg) return
        setBusy(true); setErr(''); setPing(''); setPingOk(false)
        try {
          const d = await api('/ping', { connection: connCfg })
          setPingOk(Boolean(d.ok))
          setPing(d.ok ? t('pingOk') : (t('pingFail') + (d.raw ? ': ' + d.raw : '')))
        } catch (e) { setPingOk(false); setPing(t('pingFail') + (e.message ? ': ' + e.message : '')) }
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
        const layout = ctx && ctx.layout
        if (!layout || typeof layout.selectPanel !== 'function') return
        try { layout.selectPanel(null) } catch (_) {
          try { layout.selectPanel('conversation') } catch (_) {}
        }
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
              h('div', { className: 'dshRds-cardTitleRow' },
                h('span', { className: 'dshRds-cardTitle' }, t('connections')),
                grouped.length > 1
                  ? h('button', {
                      type: 'button', className: 'dshRds-mini',
                      onClick: () => setCollapsed((prev) => {
                        const allCollapsed = grouped.every(([g]) => prev[g || '__ungrouped__'])
                        const next = {}
                        for (const [g] of grouped) next[g || '__ungrouped__'] = !allCollapsed
                        return next
                      }),
                    }, grouped.every(([g]) => collapsed[g || '__ungrouped__']) ? t('expandAll') : t('collapseAll'))
                  : null
              ),
              h('div', { className: 'dshRds-connList' },
                conns.length === 0
                  ? h('div', { className: 'dshRds-note' }, t('noConn'))
                  : grouped.map(([groupName, list]) => {
                      const key = groupName || '__ungrouped__'
                      const isCollapsed = Boolean(collapsed[key])
                      return h('div', { key, className: 'dshRds-group' },
                        h('div', {
                          className: 'dshRds-groupHead',
                          onClick: () => setCollapsed((prev) => ({ ...prev, [key]: !prev[key] })),
                        },
                          h('span', { className: 'dshRds-groupArrow' }, isCollapsed ? '▸' : '▾'),
                          h('span', { className: 'dshRds-groupName' },
                            (groupName || t('ungrouped')),
                            h('span', { className: 'dshRds-groupCount' }, ' (' + list.length + ')')
                          )
                        ),
                        isCollapsed
                          ? null
                          : list.map((c) =>
                              h('div', {
                                key: c.id,
                                className: 'dshRds-conn' + (activeId === c.id ? ' dshRds-connOn' : ''),
                                onClick: () => { setActiveId(c.id); setKeys([]); setSelected(''); setDetail(null); setPing(''); setPingOk(false) },
                              },
                                h('span', { className: 'dshRds-name' }, c.name),
                                h('span', { className: 'dshRds-addr' }, `${c.host}:${c.port}`),
                                c.hasPassword ? h('span', { className: 'dshRds-lock', title: t('pwdSaved') }, '🔒') : null,
                                h('button', { type: 'button', className: 'dshRds-mini', onClick: (e) => { e.stopPropagation(); editConn(c) } }, t('edit')),
                                h('button', { type: 'button', className: 'dshRds-mini dshRds-del', onClick: (e) => { e.stopPropagation(); removeConn(c.id) } }, '×')
                              )
                            )
                      )
                    })
              ),
              h('div', { className: 'dshRds-btnRow' },
                h('button', { type: 'button', className: 'dshRds-btn dshRds-btnPrimary', onClick: () => { setEditing(null); setForm({ name: '', host: '127.0.0.1', port: 6379, password: '', username: '', db: 0, group: '' }) } }, '+ ' + t('newConn')),
                h('button', { type: 'button', className: 'dshRds-btn', disabled: !active || busy, onClick: testConn }, t('test'))
              ),
              h('div', { className: 'dshRds-btnRow' },
                h('button', { type: 'button', className: 'dshRds-btn', title: t('export'), onClick: exportConns }, t('export')),
                h('button', { type: 'button', className: 'dshRds-btn', title: t('import'), onClick: () => fileRef.current && fileRef.current.click() }, t('import'))
              ),
              h('button', { type: 'button', className: 'dshRds-btn dshRds-btnWide', disabled: busy, title: t('pruneSecret'), onClick: pruneSecrets }, t('pruneSecret')),
              h('input', { ref: fileRef, type: 'file', accept: '.json,application/json', style: { display: 'none' }, onChange: importConns }),
              ping
                ? h('div', { className: 'dshRds-ping ' + (pingOk ? 'dshRds-pingOk' : 'dshRds-pingFail') }, ping)
                : null
            ),
            // connection form
            h('div', { className: 'dshRds-card' },
              h('div', { className: 'dshRds-cardTitle' }, editing ? t('edit') : t('newConn')),
              h('div', { className: 'dshRds-form' },
                formRow('name', 'name'), formRow('host', 'host'),
                formRow('port', 'port', 'number'), formRow('password', 'password', 'password'),
                formRow('username', 'username'), formRow('db', 'db', 'number'),
                h('label', { className: 'dshRds-field' },
                  h('span', { className: 'dshRds-label' }, t('group')),
                  h('input', {
                    className: 'dshRds-input', list: 'dshRds-groupOptions', value: form.group || '',
                    placeholder: t('groupPlaceholder'),
                    onChange: (e) => setForm((f) => ({ ...f, group: e.target.value })),
                  }),
                  h('datalist', { id: 'dshRds-groupOptions' },
                    Array.from(new Set(conns.map((c) => (c.group || '').trim()).filter(Boolean)))
                      .map((g) => h('option', { key: g, value: g }))
                  )
                ),
                h('div', { className: 'dshRds-note' }, editing ? t('pwdEmpty') : t('pwdHint')),
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
.dshRds-btnRow{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.dshRds-btnRow .dshRds-btn{width:100%}
.dshRds-btnWide{width:100%}
.dshRds-ping{font-size:11px;line-height:1.5;font-weight:600;padding:4px 0}
.dshRds-pingOk{color:#2e7d32}
.dshRds-pingFail{color:var(--dsw-alias-state-error-primary)}
.dshRds-btn{padding:7px 11px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;cursor:pointer;font-family:inherit;white-space:nowrap}
.dshRds-btn:hover{border-color:var(--dsw-alias-brand-primary)}
.dshRds-btn:disabled{opacity:.45;cursor:not-allowed}
.dshRds-btnPrimary{background:#d82c20;color:#fff;border-color:transparent;font-weight:600}
.dshRds-del{color:var(--dsw-alias-state-error-primary)}
.dshRds-connList{display:flex;flex-direction:column;gap:6px}
.dshRds-group{display:flex;flex-direction:column;gap:4px}
.dshRds-cardTitleRow{display:flex;align-items:center;justify-content:space-between;gap:8px}
.dshRds-groupHead{display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);cursor:pointer;font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.dshRds-groupHead:hover{color:var(--dsw-alias-label-primary)}
.dshRds-groupArrow{width:10px;flex:0 0 auto}
.dshRds-groupName{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshRds-groupCount{font-weight:500;font-size:10px;opacity:.65;margin-left:1px}
.dshRds-conn{display:flex;align-items:center;gap:6px;padding:7px 8px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1);cursor:pointer;font-size:12px;flex-wrap:wrap}
.dshRds-connOn{border-color:#d82c20;background:var(--dsw-alias-bg-layer-2)}
.dshRds-name{font-weight:600;flex:1 1 auto}
.dshRds-addr{font-size:10px;color:var(--dsw-alias-label-secondary)}
.dshRds-lock{font-size:10px;margin-left:2px}
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

    return { inject: ['slots', 'locale', 'layout'], apply }
  },
})
