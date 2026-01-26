import React from 'react';
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Play,
  Square,
  RotateCw,
  Settings,
  Terminal,
  Folder,
  Clock,
  Shield,
  Loader2,
  Trash,
  Timer,
  Layers,
  FileText,
} from "lucide-react";
import { motion } from "framer-motion";

const categoryConfig = {
  frontend: { label: "前端", color: "bg-blue-100 text-blue-700", icon: "🎨" },
  backend: { label: "后端", color: "bg-green-100 text-green-700", icon: "⚙️" },
  database: { label: "数据库", color: "bg-purple-100 text-purple-700", icon: "💾" },
  microservice: { label: "微服务", color: "bg-orange-100 text-orange-700", icon: "🔗" },
  mobile: { label: "移动端", color: "bg-pink-100 text-pink-700", icon: "📱" },
  desktop: { label: "桌面应用", color: "bg-indigo-100 text-indigo-700", icon: "🖥️" },
  script: { label: "脚本", color: "bg-yellow-100 text-yellow-700", icon: "📜" },
  other: { label: "其他", color: "bg-gray-100 text-gray-700", icon: "📦" },
};

const statusConfig = {
  running: { label: "运行中", color: "bg-green-500", textColor: "text-green-700" },
  stopped: { label: "已停止", color: "bg-gray-400", textColor: "text-gray-700" },
};

/**
 * 从中间截断路径，保留首尾部分
 * @param {string} path - 完整路径
 * @param {number} maxLen - 最大显示长度
 * @returns {string} 截断后的路径
 */
function truncatePath(path, maxLen = 60) {
  if (!path || path.length <= maxLen) return path;
  const ellipsis = '...';
  const availableLen = maxLen - ellipsis.length;
  const headLen = Math.ceil(availableLen * 0.4);
  const tailLen = availableLen - headLen;
  return path.slice(0, headLen) + ellipsis + path.slice(-tailLen);
}

export default function ProjectCard({
  project,
  onStart,
  onStop,
  onRestart,
  onEdit,
  onDelete,
  onViewLogs,
  viewMode = "grid",
}) {
  const category = categoryConfig[project.category] || categoryConfig.other;
  const status = statusConfig[project.status] || statusConfig.stopped;

  const formatDateTime = (iso) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const yyyy = d.getFullYear();
    const MM = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${yyyy}-${MM}-${dd} ${hh}:${mm}:${ss}`;
  };

  const formatDuration = (ms) => {
    const sec = Math.floor(ms / 1000);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(
      s
    ).padStart(2, "0")}`;
  };

  const [runtimeText, setRuntimeText] = React.useState("");
  React.useEffect(() => {
    if (
      project?.status === "running" &&
      project?.last_started
    ) {
      const update = () => {
        const start = new Date(project.last_started).getTime();
        if (!isNaN(start)) {
          const now = Date.now();
          setRuntimeText(formatDuration(now - start));
        }
      };
      update();
      const timer = setInterval(update, 1000);
      return () => clearInterval(timer);
    }
    setRuntimeText("");
  }, [project?.status, project?.last_started]);

  const renderActions = () => (
    <>
      {project.status === "running" ? (
        <>
          <Button
            size="sm"
            variant="destructive"
            className="w-20"
            onClick={() => onStop(project)}
          >
            <Square className="w-3 h-3 mr-1" />
            停止
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onRestart(project)}
            title="重启"
          >
            <RotateCw className="w-3 h-3" />
          </Button>
        </>
      ) : (
        <>
          <Button
            size="sm"
            className="w-20 bg-green-600 hover:bg-green-700"
            onClick={() => onStart(project)}
          >
            <Play className="w-3 h-3 mr-1" />
            启动
          </Button>
          <Button
            size="sm"
            variant="outline"
            title="重启"
            onClick={() => onRestart(project)}
          >
            <RotateCw className="w-3 h-3" />
          </Button>
        </>
      )}
      <Button
        size="sm"
        variant="outline"
        onClick={() => onEdit(project)}
        title="编辑"
      >
        <Settings className="w-3 h-3" />
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => onViewLogs(project)}
        title="查看日志"
      >
        <FileText className="w-3 h-3" />
      </Button>
      <Button
        size="sm"
        variant="outline"
        title="删除任务"
        aria-label="删除任务"
        onClick={() => onDelete(project)}
      >
        <Trash className="w-3 h-3" />
      </Button>
    </>
  );

  // 列表视图
  if (viewMode === "list") {
    return (
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.2 }}
      >
        <Card className="group hover:shadow-lg transition-all duration-300 border-2 hover:border-blue-300 bg-white/80 backdrop-blur-sm">
          <CardContent className="p-4">
            {/* 顶部：名称 / 类型 / 状态 + 命令块 + 操作按钮 */}
            <div className="flex flex-col gap-2">
              <div className="flex items-start gap-4">
                {/* 左侧：图标 + 基本信息 */}
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div className="text-2xl mt-1 flex-shrink-0">
                    {category.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-bold text-base text-gray-900 truncate">
                        {project.name}
                      </h3>
                      <Badge className={`${category.color} flex-shrink-0`}>
                        {category.label}
                      </Badge>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <div
                          className={`w-2 h-2 rounded-full ${status.color} ${
                            project.status === "running" ? "animate-pulse" : ""
                          }`}
                        />
                        <span className={`text-xs font-medium ${status.textColor}`}>
                          {status.label}
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 truncate">
                      {project.description || "暂无描述"}
                    </p>
                  </div>
                </div>

                {/* 右侧：操作按钮（垂直居中） */}
                <div className="flex gap-2 flex-shrink-0 md:ml-auto self-center">
                  {renderActions()}
                </div>
              </div>
            </div>

            {/* 底部信息：两行，从左到右紧凑排列 */}
            <div className="mt-2 text-xs text-gray-600 space-y-1">
              {/* 第一行：文件路径  任务组  端口  守护进程 */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <div className="flex items-center gap-1" title={project.working_directory || "未设置路径"}>
                  <Folder className="w-3 h-3" />
                  <span>
                    {truncatePath(project.working_directory, 70) || "未设置路径"}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Layers className="w-3 h-3" />
                  <span>任务组: {project.group || "未分组"}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Terminal className="w-3 h-3" />
                  <span>端口: {project.port || "未设置"}</span>
                </div>
                <div
                  className={`flex items-center gap-1 ${
                    project.auto_restart ? "text-green-600" : "text-gray-400"
                  }`}
                  title={project.auto_restart ? "守护进程已开启" : "守护进程未开启"}
                >
                  <Shield className="w-3 h-3" />
                  <span>守护进程</span>
                </div>
              </div>

              {/* 第二行：开始时间  已运行  PID  黑色命令行块 */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <div className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  <span>
                    开始:{" "}
                    {project.last_started
                      ? formatDateTime(project.last_started)
                      : "未启动"}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Timer className="w-3 h-3" />
                  <span>
                    已运行:{" "}
                    {project.status === "running" && project.last_started
                      ? runtimeText
                      : "--:--:--"}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Terminal className="w-3 h-3" />
                  <span>PID: {project.runtime_pid || "N/A"}</span>
                </div>
                <div className="flex-1 min-w-[160px] max-w-[260px] sm:max-w-[360px] md:max-w-[480px]">
                  <div
                    className="bg-gray-900 rounded px-3 py-1.5 text-xs font-mono text-green-400 truncate"
                    title={project.start_command}
                  >
                    $ {project.start_command}
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  // 网格视图
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2 }}
    >
      <Card className="group hover:shadow-xl transition-all duration-300 border-2 hover:border-blue-300 bg-white/80 backdrop-blur-sm min-h-[280px] flex flex-col">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3 flex-1">
              <div className="text-3xl">{category.icon}</div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-lg text-gray-900 truncate">
                  {project.name}
                </h3>
                <p className="text-sm text-gray-500 line-clamp-2 mt-1">
                  {project.description || "暂无描述"}
                </p>
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <Badge className={category.color}>{category.label}</Badge>
              <div className="flex items-center gap-2">
                <div
                  className={`w-2 h-2 rounded-full ${status.color} ${
                    project.status === "running" ? "animate-pulse" : ""
                  }`}
                />
                <span className={`text-xs font-medium ${status.textColor}`}>
                  {status.label}
                </span>
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-3 flex-1 flex flex-col">
          {/* 网格信息：行列对齐 */}
          <div className="grid grid-cols-2 gap-1 text-xs text-gray-600">
            {/* 第一行：文件路径（独占一行） */}
            <div className="flex items-center gap-1 col-span-2" title={project.working_directory || "未设置路径"}>
              <Folder className="w-3 h-3" />
              <span>
                {truncatePath(project.working_directory, 50) || "未设置路径"}
              </span>
            </div>

            {/* 第二行：任务组 label + 任务组值 */}
            <div className="flex items-center gap-1">
              <Layers className="w-3 h-3" />
              <span>任务组</span>
            </div>
            <div className="flex items-center gap-1">
              <span>{project.group || "未分组"}</span>
            </div>

            {/* 第三行：端口   PID */}
            <div className="flex items-center gap-1">
              <Terminal className="w-3 h-3" />
              <span>端口: {project.port || "未设置"}</span>
            </div>
            <div className="flex items-center gap-1">
              <Terminal className="w-3 h-3" />
              <span>PID: {project.runtime_pid || "N/A"}</span>
            </div>

            {/* 第四行：开始    已运行 */}
            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              <span>
                开始:{" "}
                {project.last_started
                  ? formatDateTime(project.last_started)
                  : "未启动"}
              </span>
            </div>
              <div
              className={`flex items-center gap-1 ${
                project.status === "running" ? "text-green-600" : "text-gray-400"
              }`}
            >
              <Timer className="w-3 h-3" />
              <span>
                已运行:{" "}
                {project.status === "running" && project.last_started
                  ? runtimeText
                  : "--:--:--"}
              </span>
            </div>
          </div>

          {/* 命令预览 */}
          <div className="bg-gray-900 rounded-lg p-2 text-xs font-mono text-green-400 truncate">
            $ {project.start_command}
          </div>

          {/* 操作按钮 */}
          <div className="flex gap-2 pt-2 mt-auto">
            {renderActions()}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
