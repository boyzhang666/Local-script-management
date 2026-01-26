import { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FileText, Trash2, Download } from "lucide-react";
import { getProjectLogs, clearProjectLogs } from "@/api/processControl";
import { showSuccess, showError } from "@/utils/notification";

// 根据日志内容判断日志级别并返回对应的颜色类名
const getLogColor = (content) => {
  const upperContent = content.toUpperCase();

  if (upperContent.includes('ERROR') || upperContent.includes('FATAL') || upperContent.includes('EXCEPTION')) {
    return 'text-red-400'; // 错误 - 红色
  }
  if (upperContent.includes('WARN') || upperContent.includes('WARNING')) {
    return 'text-yellow-400'; // 警告 - 黄色
  }
  if (upperContent.includes('INFO')) {
    return 'text-blue-400'; // 信息 - 蓝色
  }
  if (upperContent.includes('DEBUG') || upperContent.includes('TRACE')) {
    return 'text-gray-400'; // 调试 - 灰色
  }
  if (upperContent.includes('SUCCESS') || upperContent.includes('DONE') || upperContent.includes('COMPLETE')) {
    return 'text-green-400'; // 成功 - 绿色
  }

  return 'text-green-400'; // 默认 - 绿色
};

export default function LogsModal({ project, isOpen, onClose }) {
  const [logs, setLogs] = useState([]);
  const [totalLines, setTotalLines] = useState(0);
  const scrollContainerRef = useRef(null);
  const isUserScrollingRef = useRef(false); // 标记用户是否正在查看历史日志

  // 检测用户是否在底部（容差 50px）
  const isAtBottom = () => {
    const container = scrollContainerRef.current;
    if (!container) return true;

    const threshold = 50; // 距离底部的容差
    const isBottom = container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
    return isBottom;
  };

  // 监听用户滚动事件
  const handleScroll = () => {
    if (scrollContainerRef.current) {
      isUserScrollingRef.current = !isAtBottom();
    }
  };

  const fetchLogs = async () => {
    if (!project?.id) return;

    try {
      const data = await getProjectLogs(project.id);
      // 后端现在返回单一的日志数组
      const allLogs = (data.logs || []).map(line => ({ content: line }));
      setLogs(allLogs);
      setTotalLines(allLogs.length);
    } catch (error) {
      showError('获取日志失败', error.message);
    }
  };

  const handleClearLogs = async () => {
    if (!project?.id) return;

    try {
      await clearProjectLogs(project.id);
      setLogs([]);
      setTotalLines(0);
      showSuccess('日志已清除', '日志文件已成功清除');
    } catch (error) {
      showError('清除日志失败', error.message);
    }
  };

  const handleDownloadLogs = () => {
    const content = logs.map(log => log.content).join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name}_${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showSuccess('下载成功', '日志文件已保存');
  };

  // 初次打开时加载日志
  useEffect(() => {
    if (isOpen && project?.id) {
      fetchLogs();
    }
  }, [isOpen, project?.id]);

  // 实时自动刷新日志（每1.5秒）
  useEffect(() => {
    if (!isOpen || !project?.id) return;

    const interval = setInterval(() => {
      fetchLogs();
    }, 1500);

    return () => clearInterval(interval);
  }, [isOpen, project?.id]);

  // 自动滚动到底部（只在用户位于底部时）
  useEffect(() => {
    // 如果用户正在查看历史日志，则不自动滚动
    if (isUserScrollingRef.current) return;

    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [logs]);

  if (!project) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-[85vw] w-[85vw] h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            终端日志 - {project.name}
          </DialogTitle>
          <DialogDescription className="flex items-center gap-2">
            查看任务运行时的终端输出日志（实时自动刷新）
            {totalLines > 0 && (
              <span className="ml-2 px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded-full">
                {totalLines} 行
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* 日志显示区域 - 使用原生滚动 */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 w-full rounded-lg border bg-gray-900 overflow-auto p-4 font-mono text-sm"
          style={{ minHeight: 0 }} // 确保 flex 子元素可以正确滚动
        >
          {logs.length > 0 ? (
            logs.map((log, idx) => (
              <div
                key={idx}
                className={`whitespace-pre hover:bg-gray-800/50 ${getLogColor(log.content)}`}
              >
                {log.content}
              </div>
            ))
          ) : (
            <div className="text-gray-500">暂无日志输出</div>
          )}
        </div>

        <DialogFooter className="flex justify-between items-center sm:justify-between">
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleDownloadLogs}
              disabled={logs.length === 0}
            >
              <Download className="w-3 h-3 mr-1" />
              下载日志
            </Button>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              onClick={handleClearLogs}
              disabled={logs.length === 0}
            >
              <Trash2 className="w-3 h-3 mr-1" />
              清除日志
            </Button>
            <Button size="sm" onClick={onClose}>
              关闭
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
