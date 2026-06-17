# Docker 迁移说明

财富罗盘是 Tauri Windows 桌面应用。Docker 适合用来固定源码校验环境，迁移到新电脑后可以快速跑前端构建、lint、测试和 Rust 测试；Windows MSI 安装包仍建议在 Windows 主机上构建。

## 适合放进 Docker 的工作

- 安装 Node 依赖
- 安装 Rust stable 工具链
- 跑 `npm run test`
- 跑 `npm run lint`
- 跑 `npm run build`
- 跑 `cargo test`
- 验证源码在干净环境中能编译

## 不建议放进普通 Docker 的工作

- Windows MSI 打包
- 调试 WebView2 桌面窗口
- 调用 Windows Installer / WiX 生成安装包

这些步骤依赖 Windows 桌面环境、MSVC、WebView2 和 WiX。普通 Linux 容器无法完全复现。

## 首次构建容器

```powershell
docker compose build
```

## 进入容器

```powershell
docker compose run --rm wealth-compass
```

进入后可运行：

```bash
npm run test
npm run lint
npm run build
cd src-tauri
cargo test
```

## 一次性校验

```powershell
docker compose run --rm wealth-compass bash -lc "npm run test && npm run lint && npm run build && cd src-tauri && cargo test"
```

## 新电脑迁移建议

1. 安装 Git、Docker Desktop、Node.js、Rust、Visual Studio Build Tools、WebView2。
2. 克隆仓库。
3. 用 Docker 跑一次源码校验。
4. 在 Windows 主机上运行 `npm.cmd install`。
5. 在 Windows 主机上运行 `npm.cmd run tauri build` 生成 MSI。

Docker 负责“环境可复现”，Windows 主机负责“桌面安装包发布”。这样迁移最稳。
