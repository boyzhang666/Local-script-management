# Server 代码拆分与功能梳理

## 目录结构
- `server/index.js`：应用入口，挂载路由、静态资源、端口回退启动，注册优雅退出。
- `server/routes/`：按资源划分的路由层
  - `projects.js`：任务 CRUD、启动/停止/重启、状态、日志、去重。
  - `processes.js`：按名称/端口查询进程、发送 kill。
  - `commandConfig.js`：命令模板的读取、更新、重置。
- `server/services/`
  - `processManager.js`：核心进程管控（启动、停止、重启、守护、自检、日志缓存、kill PID）。
  - `storage.js`：任务配置的读写、补丁更新、运行态恢复。
  - `commandConfig.js`：命令模板默认值、读写、平台检测、按类别包装启动命令。
  - `portInspector.js`：跨平台端口占用查询、端口可用性校验、按名称查进程。
- `server/lib/`
  - `env.js`：运行目录、工作目录解析、子任务环境变量（去除管理端 PORT）。
  - `pid.js`：PID/端口归一化、存活探测、树形 kill。
  - `paths.js`：数据/配置文件路径与目录保障。
  - `misc.js`：ID 生成、去重、RingBuffer、睡眠、子进程运行态判断。
- `server/utils/collectOutput.js`：同步执行外部查询命令并收集输出。

## 功能逻辑

### 任务持久化（`services/storage`）
- `readProjectsFile` / `writeProjectsFile`：读写 `task/tasks.json`，持久化时剔除运行态字段 `status`。
- `patchProject`：基于 id 部分更新，默认刷新 `updated_date`。
- `resetPersistedRuntimeStateOnBoot`：启动时清理无效的 `runtime_pid`，保留仍存活的 PID 但关闭 `was_running_before_shutdown`。

### 命令模板（`services/commandConfig`）
- `getDefaultCommandConfig`：按平台提供类别、命令模板。
- `processCommandByCategory`：根据平台和类别包装启动命令（已包含解释器或包含 shell 运算符则原样使用）。
- `isFireAndForgetCategory`：`app` 类型视为一次性任务，退出码 0 视为成功。

### 端口/进程查询（`services/portInspector`）
- `processesByPort`：Windows 用 `netstat+tasklist`，Unix 用 `lsof`，输出占用该端口的 PID/命令。
- `checkPortAvailability`：判定端口是否空闲；若被记录的 `runtime_pid` 占用则视为已运行；否则返回冲突列表。
- `searchProcessesByName`：按命令行包含关键词过滤（Windows 用 WMI，Unix 用 `ps`）。

### 进程管控（`services/processManager`）
- 内存注册表：`processes` 保存子进程、命令、日志 RingBuffer。
- `startTask`：
  - 校验端口占用（含“已记录 PID 占用端口”接管逻辑）。
  - 按类别包装命令，使用安全工作目录与清洗后的环境（去掉管理端 PORT）。
  - 启动后在超时时间内探测存活，成功持久化 `runtime_pid`/`last_started`/`was_running_before_shutdown`。
  - fire-and-forget 类型退出码 0 视为成功；失败返回 stderr/stdout 片段。
- `stopTask`：
  - 先运行自定义 `stop_command`（若提供）。
  - 尝试终止内存跟踪 PID 与持久化 PID（树形 kill，防孤儿进程）。
  - 清空 `runtime_pid`。
- `restartTask`：先停止已跟踪进程/可选 stop_command，再执行与 start 相同的启动与端口校验流程。
- `getStatus`：优先检查内存子进程；若无则检查持久化 PID 是否存活，返回 PID/运行态。
- `getLogs`：返回缓存的 stdout/stderr。
- `killProcessByPid` / `listProcessesByPort` / `searchProcesses`：用于通用进程查询与终止。
- 守护：`setupGuardian` 每 5 秒扫描任务，依据 `auto_restart && !manual_stopped && was_running_before_shutdown` 进行重启，遵循最大次数与间隔，失败重试并累加 `restart_count`。
- 退出：`shutdown` 对当前跟踪的所有子进程发送 SIGTERM（树形），同步清理持久化的 runtime_pid。

### 路由层
- `/api/projects/*`：启动、停止、重启、状态、日志、列表、创建、更新、删除、去重。
- `/api/processes/*`：按名称查询、按端口查询、kill。
- `/api/command-config/*`：读取、更新、重置命令模板。

### 启动与静态服务（`server/index.js`）
- 入口初始化：JSON 解析、中跨域、注册路由、静态资源（多来源探测），端口回退（默认 3001，最多 +9）。
- 启动前：`resetPersistedRuntimeStateOnBoot()`，`setupGuardian()`。
- 优雅退出：SIGINT/SIGTERM 调用 `shutdown`。
