# Dev Deck

一个用于管理本地开发项目的轻量级前端应用（Vite + React）。
已移除 Base44 相关依赖与接口，所有数据仅在浏览器本地存储（localStorage）中保存。

## Running the app

```bash
npm install
npm run dev
```

## Building the app

```bash
npm run build
```
## 功能说明

- 项目列表查看、搜索、筛选
- 新建、编辑项目（名称、类型、工作目录、启动/停止命令、端口、环境变量等）
- 启动命令拼接与复制（不会自动执行命令，仅用于辅助）
- 使用 React Query 管理前端数据状态，数据持久化到 localStorage

如需改为真实后端服务存储，可在 `src/api/localProjects.js` 的基础上替换为你的 API 调用。