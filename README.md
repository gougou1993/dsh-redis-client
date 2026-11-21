# Redis 客户端（dsh-redis-client）

一款运行在 DSH（DeepSeek Harness）中的 Redis 管理插件。左侧栏提供入口，可管理多个 Redis 连接、浏览键值、执行命令。基于系统 `redis-cli`，无需额外 npm 依赖。

## 插件信息

- **包名**：`dsh-redis-client`
- **版本**：1.0.0
- **入口**：左侧栏「Redis 客户端」
- **类型**：Host + Client 双半部插件（bundle）

## 使用技术

| 层面 | 技术 |
|---|---|
| 插件框架 | DSH Cordis bundle（`cordis.patch.yml` 插入 Loader 行） |
| Host 半部 | ESM `apply(ctx)`，通过 `ctx.connection.fetch.register` 注册 7 条 API 路由 |
| Redis 交互 | 调用系统 `redis-cli`（本机 `/usr/local/bin/redis-cli`，v6.0.8），零 npm 依赖 |
| 命令执行 | Node `child_process.execFile`，参数数组传递避免注入 |
| 连接配置 | Client 保存在 `localStorage`（`dsh-redis-client.connections.v1` / `.active.v1`） |
| Client 半部 | `window.__ModuleLoader__` 注册，React 无 JSX（`React.createElement`） |
| UI 样式 | 组件内注入 `<style>`，使用 DSH 主题 token |
| 国际化 | `ctx.locale.register / bind`，中英双语（zh / en） |

## 功能

### 1. 连接管理
- 新建 / 编辑 / 删除多个 Redis 连接
- 配置项：名称、主机、端口、密码、数据库索引
- 测试连接（PING），显示已连接/断开状态
- 连接配置保存在本机 localStorage，刷新不丢失

### 2. 数据库与键浏览
- 查看数据库列表（DBSIZE / 库切换）
- 按模式扫描键（`--scan --pattern`，兼容 redis-cli 6.x，不用 `--count`）
- 显示每个键的类型、TTL、值
- 支持不同数据类型读取（string / hash / list / set / zset）

### 3. 键值操作
- 读取键值（GET / HGETALL / LRANGE 等按类型）
- 删除键
- 设置过期时间（TTL 秒数，-1 表示永久）

### 4. 命令行
- 直接输入 Redis 命令执行，显示原始输出
- 常用命令提示：GET / SET / DBSIZE / INFO 等

## Host API 路由

所有路由前缀 `/api/dsh-redis-client/`：

| 路由 | 方法 | 说明 |
|---|---|---|
| `ping` | POST | 测试连接（PING） |
| `dbs` | POST | 查询数据库信息 |
| `keys` | POST | 扫描键（支持 pattern） |
| `get` | POST | 读取键值（按类型） |
| `delete` | POST | 删除键 |
| `expire` | POST | 设置过期时间 |
| `command` | POST | 执行任意 Redis 命令 |

## 依赖与环境

- 需要本机安装 `redis-cli`（默认路径 `/usr/local/bin/redis-cli`）
- 目标 Redis 服务网络可达
- 连接密码等敏感信息仅保存在本机 localStorage，不上传

## 注意事项

- redis-cli 6.0.8 的 `--scan` 支持 `--pattern`，**不支持 `--count`**（旧版写法会报 "Unrecognized option"）
- 命令通过参数数组传递，避免 shell 注入
- Host 侧修改后需通过插件管理器 disable→enable 重新加载路由，`unlag_refresh` 只刷新前端

## 目录结构

```
dsh-redis-client/
├── package.json          # 清单（命名空间包）、bundle 配置、client 注入声明
├── cordis.patch.yml      # Loader 插入行
├── index.js              # Host 半部：7 条 Redis 路由（redis-cli 封装）
├── client.js             # Client 半部：连接管理、键浏览、命令行、样式
├── locale/
│   ├── zh.json           # 中文显示元信息
│   └── en.json           # 英文显示元信息
├── icon.svg              # 插件图标
└── README.md             # 本文档
```

## 安装与使用

1. 确认本机有 `redis-cli`
2. 通过插件管理器安装该 bundle（`install_bundle` 指向本目录）
3. 左侧栏点击「Redis 客户端」
4. 新建连接并测试，成功后即可浏览键、执行命令
