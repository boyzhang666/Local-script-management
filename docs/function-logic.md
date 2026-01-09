# 功能逻辑梳理（后端）

## 入口（`server/index.js`）
- 载入 JSON/CORS 中间件，挂载路由：`/api/projects`、`/api/processes`、`/api/command-config`。
- 启动前调用 `resetPersistedRuntimeStateOnBoot()` 清理无效 PID；调用 `setupGuardian()` 启动守护循环。
- 静态文件目录多路径探测（打包、源码、工作目录），命中后兜底路由返回 `index.html`。
- 端口回退：默认 `PORT` 或 3001，若占用则递增尝试至 9 个端口。
- 信号处理：SIGINT/SIGTERM 时调用 `shutdown()` 优雅终止子进程后退出。

## 路由层
- `routes/projects.js`：任务 CRUD、启动/停止/重启、状态、日志、去重。删除时先尝试停止对应任务，再删除配置。
- `routes/processes.js`：按名称查询进程、按端口列出占用、按 PID 发送 kill（透传 `killProcessByPid`）。
- `routes/commandConfig.js`：读取/更新命令模板，重置为默认。

## 任务持久化（`services/storage.js`）
- `readProjectsFile`/`writeProjectsFile`：读写 `task/tasks.json`，写入时移除运行态字段 `status`。
- `patchProject`：按 id 局部更新，默认刷新 `updated_date`（可跳过）。
- `resetPersistedRuntimeStateOnBoot`：启动时若 `runtime_pid` 不存活则清空，并清除 `was_running_before_shutdown`；若 PID 还活着，仅关闭 `was_running_before_shutdown`。

## 命令模板与平台（`services/commandConfig.js`）
- 平台探测：`isWindows`/`isMac`/`isLinux` 与 `getCurrentPlatform`。
- 默认模板：按平台提供类别与命令包装规则。
- `processCommandByCategory`：根据平台+类别包装命令；若已含解释器或含 shell 运算符则不包；`app` 视为 fire-and-forget。
- 读写：`readCommandConfig` 合并默认值；`writeCommandConfig` 持久化 JSON；`getDefaultCommandConfig`/`isFireAndForgetCategory` 辅助。

## 端口与进程探测（`services/portInspector.js`）
- 跨平台端口占用查询：Windows 使用 `netstat + tasklist`，Unix 使用 `lsof`，返回占用 PID/命令/状态。
- `checkPortAvailability`：判定端口是否空闲；若被记录的 `runtime_pid` 占用则视为已运行并允许接管；否则返回冲突列表。
- `searchProcessesByName`：按命令行包含关键词过滤（Windows 用 WMI，Unix 用 `ps`）。

## 进程管控（`services/processManager.js`）
- 内存注册表 `processes` 保存子进程、命令、环境、日志 RingBuffer；`guardianState` 记录守护重试时间。
- `startTask`：端口冲突检查→包装命令→安全工作目录+清洗环境（移除管理端 PORT）→spawn；启动窗口内存活则写入 `runtime_pid`/`last_started`/`was_running_before_shutdown`，fire-and-forget 退出码 0 视为成功。
- `stopTask`：可选执行 `stop_command`；终止内存 PID 与持久化 PID（树形 kill）并清空 `runtime_pid`，收集 kill 成功/错误。
- `restartTask`：先 stop（含 stop_command），再按 start 流程执行并写回 `runtime_pid`。
- `getStatus`：优先内存子进程；否则检查持久化 PID 是否存活，返回 PID/运行态。
- `getLogs`：返回内存日志缓冲。
- `killProcessByPid`/`listProcessesByPort`/`searchProcesses`：通用进程查询与 kill。
- 守护：`setupGuardian` 每 5 秒扫描，满足 `auto_restart && !manual_stopped && was_running_before_shutdown` 才重启；遵循最大次数/间隔，失败累加 `restart_count`。
- 退出：`shutdown` 对内存子进程树形 SIGTERM，并同步清理对应 `runtime_pid`。

## 环境与基础工具
- `lib/env.js`：`baseRunDir`（pkg 与源码兼容）、`safeCwd`（合法目录兜底运行目录）、`buildTaskEnv`（合并 env 并移除自身 `PORT`）。
- `lib/pid.js`：PID/端口归一化、存活探测、树形 kill。
- `lib/paths.js`：确保 `task/` 目录存在，提供 `tasks.json` 与 `command-config.json` 路径。
- `lib/misc.js`：ID 生成、任务去重、RingBuffer、sleep、子进程运行态判断。
- `utils/collectOutput.js`：spawn 外部命令并收集 stdout/stderr/code。
