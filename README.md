# 财富罗盘

Windows 本地个人财富增长看板。当前版本支持将真实账户、资产、负债、投资持仓、收支流水和月度目标保存到 SQLCipher 加密数据库。

## 本地运行

```powershell
npm.cmd install
npm.cmd run dev
```

桌面构建还需要 Rust stable、Visual Studio C++ Build Tools 及 WebView2：

```powershell
npm.cmd run tauri dev
```

Docker 迁移和源码校验方式见 [docs/docker.md](docs/docker.md)。

## 安全边界

- 主密码只在输入和 Tauri IPC 调用期间短暂存在，不会持久化到浏览器存储。
- Rust 模块使用 Argon2id 派生密钥，并使用 XChaCha20-Poly1305 封装随机数据库密钥。
- SQLite 数据库使用 SQLCipher 加密，并在首次初始化时创建第一阶段表结构。
- 恢复密钥仅在首次初始化后完整展示一次，磁盘只保存校验值及其封装的数据库密钥。
- 解锁后数据库密钥仅保存在 Rust 内存中，手动或自动锁定时立即清除。
- 保存采用单个数据库事务，并记录保存前后的审计快照。

## 当前录入能力

- 多个银行卡、支付宝、证券、期权及自定义账户
- 多套房产、房贷和其他负债
- A 股股票与股指/ETF 期权持仓
- 收入、分类支出和内部转账
- 2026-07-01 期初净资产与三类月度目标
- 标准 Excel 模板导出、数据导入预览和完整数据导出
