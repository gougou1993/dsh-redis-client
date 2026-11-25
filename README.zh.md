# Redis 客户端（dsh-redis-client）

一款运行在 DSH（DeepSeek Harness）中的 Redis 管理插件。左侧栏提供入口，可管理多个 Redis 连接、浏览键值、执行命令。Redis 交互使用纯 JavaScript 的 `ioredis` 直连协议——**不需要安装 `redis-cli`**，在 Windows、macOS、Linux 上表现一致。

## 插件信息

- **包名**：`@oakzhong/dsh-redis-client`
- **版本**：1.2.4
- **入口**：左侧栏面板「Redis 客户端」（slot id `redis-client`）
- **类型**：Host + Client 双半部 Cordis bundle

## 使用技术

| 层面 | 技术 |
|---|---|
| 插件框架 | DSH Cordis bundle（`cordis.patch.yml` 插入 Loader 行） |
| 模块格式 | ESM（`"type": "module"`） |
| Host 半部 | ESM `apply(ctx)`，通过 `ctx.connection.fetch.register` 注册 7 条 API 路由 |
| Client 半部 | `window.__ModuleLoader__` 注册，React 无 JSX（`React.createElement`） |
| Redis 交互 | 使用 `ioredis`（纯 JavaScript RESP 客户端）；按 `host:port:db:user` 复用连接，命令直连发送，不启动任何外部进程 |
| 连接配置 | 保存在浏览器 `localStorage`（`dsh-redis-client.connections.v1` / `dsh-redis-client.active.v1`），Host 侧不持久化 |
| UI 样式 | 组件内注入 `<style>`，使用 DSH 主题 token |
| 国际化 | `ctx.locale.register` / `bind`，中英双语（zh / en）字典 |

## 功能

### 1. 连接管理
- 新建 / 编辑 / 删除多个 Redis 连接
- 配置项：名称、主机、端口、密码、用户名（可选）、数据库索引、**分组**
- **分组管理**：连接按分组折叠展示（每组显示数量）；分组名为空归入「未分组」；表单提供已有分组名可选，并有「全部折叠 / 全部展开」快捷操作
- 通过 PING 测试连接，结果内联显示——**成功绿色、失败红色**，便于快速判断
- 连接操作按钮两两一行：第一行「新建 / 测试连接」，第二行「导出 / 导入」
- 连接配置保存在 localStorage，刷新不丢失
- **密码存储**：密码保存在 DSH 凭证库（`$DSH_HOME/.credentials.yaml`），不写入浏览器 `localStorage`，也不回显到界面；连接本身只带 `hasPassword` 标记
- **导出**：将所有连接下载为 JSON 文件（`redis-connections.json`），**默认不含密码**，适合分享给他人在各自环境填写密码后使用
- **删除连接会同时删除其密码**；若凭证库清理失败则中止删除并报错，不会留下孤立密码
- **清理孤立密码**：移除已不存在的连接所对应的 `REDIS_CONN_*` 记录
- **导入**：从 JSON 文件加载连接，确认后追加到现有列表（重新生成 id 避免冲突）；文件中若含密码会转存到凭证库，不留在浏览器

### 2. 数据库与键浏览
- 通过 `INFO keyspace` 读取全部 16 个数据库的 keyspace 信息
- 基于游标的 `SCAN ... MATCH ... COUNT 500` 按模式扫描键（单次最多 10000 个键）
- 展示每个键的类型、TTL 与值

### 3. 键值读取
- 按类型读取值：string（`GET`）、hash（`HGETALL`）、list（`LRANGE 0 199`）、set（`SMEMBERS`）、zset（`ZRANGE 0 199 WITHSCORES`）
- TTL 以秒显示，未设置过期时显示「永久」

### 4. 键值操作
- 删除键（`DEL`，带确认）
- 设置过期时间（`EXPIRE`，秒数）；`-1` 使用 `PERSIST` 设为永久

### 5. 命令行
- 执行任意 Redis 命令，显示原始 stdout 输出（以及 stderr 警告）
- 支持引号感知的命令分词
- 常用命令提示：`GET key`、`SET key val`、`DBSIZE`、`INFO`

### Host API 路由

所有路由前缀为 `/api/dsh-redis-client/`：

| 路由 | 方法 | 说明 |
|---|---|---|
| `ping` | POST | 测试连接（PING） |
| `dbs` | POST | 读取 16 个数据库的 keyspace 信息 |
| `keys` | POST | 扫描键（支持 pattern） |
| `get` | POST | 读取键值（按类型） |
| `delete` | POST | 删除键 |
| `expire` | POST | 设置键的 TTL |
| `command` | POST | 执行任意 Redis 命令 |

## 目录结构

```
dsh-redis-client/
├── package.json          # 清单（命名空间包）、bundle 配置、client 注入声明
├── cordis.patch.yml      # Loader 插入行
├── index.js              # Host 半部：基于 ioredis 的路由（无需 redis-cli）
├── client.js             # Client 半部：连接管理、键浏览、命令行、样式
├── locale/
│   ├── zh.json           # 中文显示元信息
│   └── en.json           # 英文显示元信息
├── icon.svg              # 插件图标
├── README.md             # 英文文档
└── README.zh.md          # 中文文档
```

## 安装与使用

1. 无需安装 `redis-cli`：插件内置 `ioredis`，只要目标 Redis 服务网络可达即可。
2. 通过插件管理器安装该 bundle（`install_bundle` 指向本目录）。
3. 在左侧栏点击「Redis 客户端」。
4. 新建连接并测试，成功后即可扫描键、查看值、执行命令。
5. Host 侧代码修改后需 disable → enable 插件以重载路由（`unlag_refresh` 只刷新前端）。

### 服务器信息
- 点击「测试连接」旁的**服务器信息**按钮，获取并展示 Redis `INFO` 实时统计。
- 展示：Redis 版本、运行模式、操作系统/架构、进程 ID、端口、运行时间、已连接客户端数、已用/峰值内存、键数量（DB0）、已处理命令总数、缓存命中率。
- 点击「收起信息」可折叠面板；切换连接时会自动清空。
- 连接操作按钮统一为 2 列网格布局，大小一致、对齐排列；再次点击「收起信息」可关闭信息面板。
- 左侧栏可整体收起/展开：点击标题区的 «/» 按钮，收起后其余区域自动占满宽度。
