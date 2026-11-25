# Redis Client (dsh-redis-client)

A Redis management plugin for DSH (DeepSeek Harness). It provides a left-sidebar entry for managing multiple Redis connections, browsing keys and values, and running commands. Redis interaction uses the pure-JavaScript `ioredis` client over the wire — **no `redis-cli` install required**, and it works the same on Windows, macOS and Linux.

## Plugin Info

- **Package**: `@oakzhong/dsh-redis-client`
- **Version**: 1.2.2
- **Entry**: left sidebar panel "Redis client" (slot id `redis-client`)
- **Type**: Host + Client two-half Cordis bundle

## Tech Stack

| Layer | Technology |
|---|---|
| Plugin framework | DSH Cordis bundle (`cordis.patch.yml` inserts the Loader line) |
| Module format | ESM (`"type": "module"`) |
| Host half | ESM `apply(ctx)`, registers 7 API routes via `ctx.connection.fetch.register` |
| Client half | `window.__ModuleLoader__` registration, React without JSX (`React.createElement`) |
| Redis interaction | `ioredis` (pure JavaScript RESP client); one pooled connection per `host:port:db:user`, commands sent over the wire without spawning any external process |
| Connection config | Stored in browser `localStorage` (`dsh-redis-client.connections.v1`, `dsh-redis-client.active.v1`); nothing persisted on the Host |
| UI styling | Injected `<style>` using DSH theme tokens |
| Internationalization | `ctx.locale.register` / `bind`, zh / en dictionaries |

## Features

### 1. Connection management
- Create, edit, and delete multiple Redis connections
- Fields: name, host, port, password, username (optional), database index, **group**
- **Grouping**: connections are listed under collapsible group headers (count shown per group); a blank group renders as "Ungrouped"; the form offers existing group names for reuse, and a control collapses/expands all groups at once
- Test connection via PING; the result is shown inline — **green for success, red for failure** — for quick scanning
- Connection actions are laid out two per row: New/Test on the first row, Export/Import on the second
- Connections persist in localStorage across refreshes
- **Password storage**: passwords are stored in the DSH credential store (`$DSH_HOME/.credentials.yaml`), never in browser `localStorage` and never returned to the UI; connections only carry a `hasPassword` flag
- **Export**: download all connections as a JSON file (`redis-connections.json`); **passwords are excluded by default**, so shared files are safe to hand to others who will supply their own password
- **Deleting a connection also deletes its stored password**; if the credential store cannot be cleared the delete is aborted with an error, so no orphaned secret is left behind
- **Prune orphaned passwords**: removes any `REDIS_CONN_*` entry whose connection no longer exists
- **Import**: load connections from a JSON file; entries are appended with regenerated ids after confirmation, and any password present in the file is moved into the credential store instead of being kept in the browser

### 2. Databases & key browsing
- Read keyspace info for all 16 databases via `INFO keyspace`
- Scan keys by pattern using cursor-based `SCAN ... MATCH ... COUNT 500` (capped at 10000 keys per query)
- Display key type, TTL, and value for each key

### 3. Key value reading
- Read values by type: string (`GET`), hash (`HGETALL`), list (`LRANGE 0 199`), set (`SMEMBERS`), zset (`ZRANGE 0 199 WITHSCORES`)
- TTL in seconds, or "permanent" when no expiry is set

### 4. Key operations
- Delete keys via `DEL` (with confirmation)
- Set expiry via `EXPIRE` (seconds); `-1` uses `PERSIST` to make a key permanent

### 5. Command line
- Run arbitrary Redis commands and show raw stdout output (plus stderr warnings)
- Quote-aware command tokenization
- Quick-command hints: `GET key`, `SET key val`, `DBSIZE`, `INFO`

### Host API routes

All routes are prefixed with `/api/dsh-redis-client/`:

| Route | Method | Description |
|---|---|---|
| `ping` | POST | Test connection (PING) |
| `dbs` | POST | Read keyspace info for the 16 databases |
| `keys` | POST | Scan keys (supports pattern) |
| `get` | POST | Read a key's value (by type) |
| `delete` | POST | Delete keys |
| `expire` | POST | Set a key's TTL |
| `command` | POST | Run an arbitrary Redis command |

## Directory Structure

```
dsh-redis-client/
├── package.json          # Manifest (scoped package), bundle config, client inject declaration
├── cordis.patch.yml      # Loader insertion line
├── index.js              # Host half: routes over ioredis (no redis-cli needed)
├── client.js             # Client half: connection management, key browsing, command line, styles
├── locale/
│   ├── zh.json           # Chinese display metadata
│   └── en.json           # English display metadata
├── icon.svg              # Plugin icon
├── README.md             # English documentation
└── README.zh.md          # Chinese documentation
```

## Installation & Usage

1. Make sure `redis-cli` is available on the Host (set `REDIS_CLI_PATH` or have `redis-cli` on PATH) and the target Redis server is reachable.
2. Install the bundle through the plugin manager (`install_bundle` pointing at this directory).
3. Click "Redis client" in the left sidebar.
4. Create a connection and test it; once connected, scan keys, inspect values, and run commands.
5. After changing Host-side code, disable → enable the plugin to reload routes (`unlag_refresh` only refreshes the front end).

### Server information
- Click **Server info** next to **Test connection** to fetch and display live Redis `INFO` statistics.
- Shows: Redis version, running mode, OS / architecture, process ID, port, uptime, connected clients, used / peak memory, key count (DB0), total commands processed, and cache hit rate.
- Click **Hide info** to collapse the panel; switching connections clears it automatically.
- Connection action buttons use a uniform 2-column grid (equal size, aligned); click **Hide info** again to close the panel.
- The left column can be collapsed/expanded as a whole: click the «/» button in the header; the remaining columns expand to fill the width.
