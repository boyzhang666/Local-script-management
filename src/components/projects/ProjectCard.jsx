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
  Layers
} from "lucide-react";
import { motion } from "framer-motion";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction, AlertDialogTrigger } from "@/components/ui/alert-dialog";

const categoryConfig = {
  frontend: { label: "前端", color: "bg-blue-100 text-blue-700", icon: "🎨" },
  backend: { label: "后端", color: "bg-green-100 text-green-700", icon: "⚙️" },
  database: { label: "数据库", color: "bg-purple-100 text-purple-700", icon: "💾" },
  microservice: { label: "微服务", color: "bg-orange-100 text-orange-700", icon: "🔗" },
  mobile: { label: "移动端", color: "bg-pink-100 text-pink-700", icon: "📱" },
  desktop: { label: "桌面应用", color: "bg-indigo-100 text-indigo-700", icon: "🖥️" },
  script: { label: "脚本", color: "bg-yellow-100 text-yellow-700", icon: "📜" },
  other: { label: "其他", color: "bg-gray-100 text-gray-700", icon: "📦" }
};

const statusConfig = {
  running: { label: "运行中", color: "bg-green-500", textColor: "text-green-700" },
  stopped: { label: "已停止", color: "bg-gray-400", textColor: "text-gray-700" },
  executing: { label: "执行中", color: "bg-blue-500", textColor: "text-blue-700" },
  error: { label: "错误", color: "bg-red-500", textColor: "text-red-700" }
};

export default function ProjectCard({ project, onStart, onStop, onRestart, onEdit, onDelete }) {
  const category = categoryConfig[project.category] || categoryConfig.other;
  const status = statusConfig[project.status] || statusConfig.stopped;

  const formatDateTime = (iso) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const yyyy = d.getFullYear();
    const MM = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${yyyy}-${MM}-${dd} ${hh}:${mm}:${ss}`;
  };

  const formatDuration = (ms) => {
    const sec = Math.floor(ms / 1000);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const [runtimeText, setRuntimeText] = React.useState('');
  React.useEffect(() => {
    if ((project?.status === 'running' || project?.status === 'executing') && project?.last_started) {
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
    } else {
      setRuntimeText('');
    }
  }, [project?.status, project?.last_started]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2 }}
    >
      {/* 固定最小高度，允许内容自适应增长，避免按钮溢出 */}
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
              <Badge className={category.color}>
                {category.label}
              </Badge>
              <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${status.color} ${(project.status === 'running' || project.status === 'executing') ? 'animate-pulse' : ''}`} />
              <span className={`text-xs font-medium ${status.textColor}`}>
                {status.label}
              </span>
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-3 flex-1 flex flex-col">
          {/* 项目信息 */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            {project.working_directory && (
              <div className="flex items-center gap-1 text-gray-600">
                <Folder className="w-3 h-3" />
                <span className="truncate">{project.working_directory}</span>
              </div>
            )}
            {project.port && (
              <div className="flex items-center gap-1 text-gray-600">
                <Terminal className="w-3 h-3" />
                <span>端口: {project.port}</span>
              </div>
            )}
            {project.scheduled_start && (
              <div className="flex items-center gap-1 text-gray-600">
                <Clock className="w-3 h-3" />
                <span>定时: {project.scheduled_start}</span>
              </div>
            )}
            <div
              className={`flex items-center gap-1 ${project.auto_restart ? 'text-green-600' : 'text-gray-400'}`}
              title={project.auto_restart ? '守护进程已开启' : '守护进程未开启'}
            >
              <Shield className="w-3 h-3" />
              <span>守护进程</span>
            </div>
            <div className="flex items-center gap-1 text-gray-600">
              <Layers className="w-3 h-3" />
              <span>任务组: {project.group || '未分组'}</span>
            </div>
            {project.last_started && (
              <div className="flex items-center gap-1 text-gray-600">
                <Clock className="w-3 h-3" />
                <span>开始: {formatDateTime(project.last_started)}</span>
              </div>
            )}
            {(project.status === 'running' || project.status === 'executing') && project.last_started && (
              <div className="flex items-center gap-1 text-gray-600">
                <Timer className="w-3 h-3" />
                <span>已运行: {runtimeText}</span>
              </div>
            )}
          </div>

          {/* 命令预览 */}
          <div className="bg-gray-900 rounded-lg p-2 text-xs font-mono text-green-400 truncate">
            $ {project.start_command}
          </div>

          {/* 操作按钮 */}
          <div className="flex gap-2 pt-2 mt-auto">
            {project.status === 'running' ? (
              <>
                <Button
                  size="sm"
                  variant="destructive"
                  className="flex-1"
                  onClick={() => onStop(project)}
                >
                  <Square className="w-3 h-3 mr-1" />
                  停止
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onRestart(project)}
                >
                  <RotateCw className="w-3 h-3" />
                </Button>
              </>
            ) : project.status === 'executing' ? (
              <>
                <Button
                  size="sm"
                  className="flex-1 bg-blue-600 hover:bg-blue-700"
                  disabled
                >
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  启动中…
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  title="取消启动"
                  onClick={() => onStop(project)}
                >
                  <Square className="w-3 h-3" />
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  className="flex-1 bg-green-600 hover:bg-green-700"
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
            >
              <Settings className="w-3 h-3" />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  title="删除任务"
                  aria-label="删除任务"
                >
                  <Trash className="w-3 h-3" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>确认删除</AlertDialogTitle>
                  <AlertDialogDescription>
                    将删除任务「{project.name || '未命名'}」，此操作不可撤销。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => onDelete(project)}>
                    删除
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>


          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}