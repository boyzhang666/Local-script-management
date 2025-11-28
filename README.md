# Dev Deck

一个用于管理本地开发项目的轻量级前端应用（Vite + React）。

## Running the app

```bash
npm install
npm run dev
```

## Building the app

```bash
npm run build
```

## Deploying the app

```bash
./deploy.sh
```



## 功能说明

- 项目列表查看、搜索、筛选
- 新建、编辑项目（名称、类型、工作目录、启动/停止命令、端口、环境变量等）
- 项目启动/停止/重启（会自动检查端口是否被占用）
- 会在后台持续检查已添加守护进程的任务，直到手动停止
- streamlit 项目类型，会自动在启动命令中使用 `Python -m streamlit run` 命令，若需指定 conda 环境，需使用 `conda run -n <env_name> Python -m streamlit run`


## 界面预览

![应用界面预览](fig/2025-10-23_14-11-00.jpg)
