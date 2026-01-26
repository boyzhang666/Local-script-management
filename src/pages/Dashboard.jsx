import { useState, useEffect, useRef } from 'react';
import { listProjects, createProject, updateProject, deleteProject } from "@/api/localProjects";
import { startProject as startProcess, stopProject as stopProcess, getProjectStatus, getProjectLogs, searchProcessesByName, listProcessesByPort, killProcess } from "@/api/processControl";
import { showSuccess, showError, showInfo, MESSAGES } from "@/utils/notification";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search, LayoutGrid, List, Layers } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import ProjectCard from "../components/projects/ProjectCard";
import ProjectForm from "../components/projects/ProjectForm";
import LogsModal from "../components/projects/LogsModal";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export default function Dashboard() {
  const [showForm, setShowForm] = useState(false);
  const [editingProject, setEditingProject] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [viewMode, setViewMode] = useState("grid");
  const [groupBy, setGroupBy] = useState("none"); // none | group
  const [sortOption, setSortOption] = useState("name_asc"); // updated_desc | updated_asc | name_asc | name_desc | status | group_name
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState(null);
  const [procQueryOpen, setProcQueryOpen] = useState(false);
  const [portQueryOpen, setPortQueryOpen] = useState(false);
  const [procQueryName, setProcQueryName] = useState("");
  const [portQueryValue, setPortQueryValue] = useState("");
  const [procResults, setProcResults] = useState([]);
  const [portResults, setPortResults] = useState([]);
  const [procLoading, setProcLoading] = useState(false);
  const [portLoading, setPortLoading] = useState(false);
  const [logsModalOpen, setLogsModalOpen] = useState(false);
  const [viewingLogsProject, setViewingLogsProject] = useState(null);
  // 顶部反馈卡片不再使用，改为右侧 Toast 自动消失
  
  const queryClient = useQueryClient();
  const syncedOnceRef = useRef(false); // 首次进入页面时的状态同步
  const [runtimeStatus, setRuntimeStatus] = useState({});
  const [runtimePid, setRuntimePid] = useState({});

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => listProjects(),
    initialData: [],
  });

  // 渲染时从后端同步运行时状态，仅用于显示
  useEffect(() => {
    (async () => {
      if (!projects || projects.length === 0) {
        setRuntimeStatus({});
        setRuntimePid({});
        return;
      }
      try {
        const entries = await Promise.all(
          projects.map(p => getProjectStatus(p.id)
            .then(s => [p.id, s])
            .catch(() => [p.id, null]))
        );
        const statusMap = {};
        const pidMap = {};
        for (const [id, s] of entries) {
          const running = s && s.running;
          statusMap[id] = running ? 'running' : 'stopped';
          pidMap[id] = s && s.pid ? s.pid : null;
        }
        setRuntimeStatus(statusMap);
        setRuntimePid(pidMap);
      } catch { /* ignore */ }
    })();
  }, [projects]);

  // 每 5 秒轮询运行状态，所有显示状态都来自后端
  useEffect(() => {
    const fetchStatuses = async () => {
      if (!projects || projects.length === 0) {
        setRuntimeStatus({});
        setRuntimePid({});
        return;
      }
      try {
        const entries = await Promise.all(
          projects.map(p => getProjectStatus(p.id)
            .then(s => [p.id, s])
            .catch(() => [p.id, null]))
        );
        const nextStatus = {};
        const nextPid = {};
        for (const [id, s] of entries) {
          const running = s && s.running;
          nextStatus[id] = running ? 'running' : 'stopped';
          nextPid[id] = s && s.pid ? s.pid : null;
        }
        const prevStatus = runtimeStatus || {};
        const prevPid = runtimePid || {};
        let changed = false;
        const keys = new Set([
          ...Object.keys(prevStatus),
          ...Object.keys(nextStatus),
          ...Object.keys(prevPid),
          ...Object.keys(nextPid),
        ]);
        for (const k of keys) {
          if ((prevStatus[k] ?? '') !== (nextStatus[k] ?? '') ||
              (prevPid[k] ?? null) !== (nextPid[k] ?? null)) {
            changed = true;
            break;
          }
        }
        if (changed) {
          setRuntimeStatus(nextStatus);
          setRuntimePid(nextPid);
        }
      } catch { /* ignore */ }
    };
    const timer = setInterval(fetchStatuses, 5000);
    fetchStatuses(); // 初始化时立即执行一次
    return () => clearInterval(timer);
  }, [projects]); // 移除 runtimeStatus 依赖，避免定时器频繁重启

  // 新增：项目重启后的状态自愈机制
  useEffect(() => {
    if (!projects || projects.length === 0) return;
    if (!syncedOnceRef.current) {
      (async () => {
        for (const p of projects) {
          try {
            const s = await getProjectStatus(p.id);
            const newStatus = s?.running ? 'running' : 'stopped';
            if (p.status !== newStatus) {
              // 显示用，不写回持久化状态
            }
          } catch { /* ignore */ }
        }
        syncedOnceRef.current = true;
      })();
    }
    (async () => {
      for (const p of projects) {
        // 使用 runtimeStatus 来展示运行态，无需写入后端
      }
    })();
  }, [projects]);

  const createMutation = useMutation({
    mutationFn: (data) => createProject(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setShowForm(false);
      setEditingProject(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => updateProject(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setShowForm(false);
      setEditingProject(null);
    },
  });

  // 新增：删除项目的 mutation
  const deleteMutation = useMutation({
    mutationFn: (id) => deleteProject(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      showSuccess(MESSAGES.TASK_DELETED, '该任务已从列表移除');
    },
    onError: (error) => {
      showError(MESSAGES.TASK_DELETE_ERROR, error?.message || '请稍后再试');
    }
  });

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function checkPortReady() {
    return false;
  }

  async function waitForRunningStatus(id, attempts = 10, intervalMs = 800) {
    for (let i = 0; i < attempts; i++) {
      try {
        const status = await getProjectStatus(id);
        if (status?.running) return true;
      } catch {
        // ignore and retry
      }
      await delay(intervalMs);
    }
    return false;
  }

  // 立即从后端获取某个任务的最新运行态，用于操作成功后的快速同步
  async function refreshRuntimeFor(id) {
    if (!id) return;
    try {
      const status = await getProjectStatus(id);
      const running = !!status?.running;
      const pid = status?.pid ?? null;
      setRuntimeStatus((prev) => ({
        ...prev,
        [id]: running ? 'running' : 'stopped',
      }));
      setRuntimePid((prev) => ({
        ...prev,
        [id]: pid,
      }));
    } catch {
      // 忽略单次刷新失败，后续轮询会继续尝试
    }
  }

  const handleSave = (data) => {
    if (editingProject) {
      updateMutation.mutate({ id: editingProject.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleStart = async (project) => {
    try {
      if (!project.start_command || !String(project.start_command).trim()) {
        showError('无法启动', '请先在任务设置中填写启动命令（start_command）');
        return;
      }
      // 用户主动点击“启动”视为重新允许守护，将 manual_stopped 置为 false
      updateMutation.mutate({ id: project.id, data: { manual_stopped: false } });
      showInfo('正在启动…', `${project.name} 正在启动并进行健康检查`, 1000);

      const startResult = await startProcess(project);

      // 后端早期校验：若启动命令在启动窗口内失败，返回真实错误和日志
      if (startResult && startResult.ok === false) {
        const lastErr = (startResult.logs?.stderr || []).slice(-10).join('\n');
        await stopProcess(project.id).catch(() => {});
        showError(MESSAGES.START_ERROR, `已终止进程。${lastErr || startResult.error || '未知错误'}`, 4000);
        return;
      }

      const ok = await waitForRunningStatus(project.id);

      if (ok) {
        updateMutation.mutate({
          id: project.id,
          data: {
            last_started: new Date().toISOString(),
            manual_stopped: false,
            restart_count: 0,
          },
        });
        showSuccess(MESSAGES.START_SUCCESS, `${project.name} 已启动并通过健康检查`, 1000);
        // 启动成功后立即从后端刷新一次运行态
        await refreshRuntimeFor(project.id);
      } else {
        await stopProcess(project.id).catch(() => {});
        // 取后端日志作为真实错误信息
        const logs = await getProjectLogs(project.id).catch(() => ({ stdout: [], stderr: [] }));
        const lastErr = logs.stderr?.slice(-10).join('\n') || logs.stdout?.slice(-10).join('\n') || '健康检查未通过';
        showError(MESSAGES.START_ERROR, `健康检查超时，已终止进程。${lastErr}`, 4000);
      }
    } catch (e) {
      // 如果后端返回了结构化错误（通过 startProject 返回），e 可能是字符串；已在上面处理
      showError(MESSAGES.START_ERROR, String(e).slice(0, 300), 4000);
    }
  };

  const handleStop = async (project) => {
    const id = project?.id;
    if (!id) return;

    try {
      await stopProcess(project);
      updateMutation.mutate({ id, data: { manual_stopped: true } });
      showSuccess(MESSAGES.STOP_SUCCESS, `${project.name} 已停止`, 1000);
      // 停止成功后立即从后端刷新一次运行态
      await refreshRuntimeFor(id);
    } catch (e) {
      showError(MESSAGES.STOP_ERROR, String(e).slice(0, 200), 1000);
    }
  };

  const handleRestart = async (project) => {
    try {
      if (!project.start_command || !String(project.start_command).trim()) {
        showError('无法重启', '请先在任务设置中填写启动命令（start_command）');
        return;
      }
      await stopProcess(project).catch(() => {});
      showInfo('正在重启…', `${project.name} 正在重启并进行健康检查`, 1000);
      const startResult = await startProcess(project);

      if (startResult && startResult.ok === false) {
        const lastErr = (startResult.logs?.stderr || []).slice(-10).join('\n');
        await stopProcess(project).catch(() => {});
        showError(MESSAGES.RESTART_ERROR, `已终止进程。${lastErr || startResult.error || '未知错误'}`, 4000);
        return;
      }

      const ok = await waitForRunningStatus(project.id);
      // 重启操作同样视为重新允许守护；仅在成功时更新 last_started / restart_count
      const updateData = { manual_stopped: false };
      if (ok) {
        updateData.last_started = new Date().toISOString();
        updateData.restart_count = 0;
      }
      updateMutation.mutate({ id: project.id, data: updateData });

      if (ok) {
        showSuccess(MESSAGES.RESTART_SUCCESS, `${project.name} 已重启并通过健康检查`, 1000);
        // 重启成功后立即从后端刷新一次运行态
        await refreshRuntimeFor(project.id);
      } else {
        await stopProcess(project.id).catch(() => {});
        const logs = await getProjectLogs(project.id).catch(() => ({ stdout: [], stderr: [] }));
        const lastErr = logs.stderr?.slice(-10).join('\n') || logs.stdout?.slice(-10).join('\n') || '健康检查未通过';
        showError(MESSAGES.RESTART_ERROR, `健康检查超时，已终止进程。${lastErr}`, 4000);
      }
    } catch (e) {
      showError(MESSAGES.RESTART_ERROR, String(e).slice(0, 300), 4000);
    }
  };

  const handleEdit = (project) => {
    setEditingProject(project);
    setShowForm(true);
  };

  // 新增：删除处理
  const handleDelete = (project) => {
    if (!project?.id) return;
    setProjectToDelete(project);
    setDeleteConfirmOpen(true);
  };

  // 查看日志处理
  const handleViewLogs = (project) => {
    if (!project?.id) return;
    setViewingLogsProject(project);
    setLogsModalOpen(true);
  };

  const confirmDelete = async () => {
    if (!projectToDelete?.id) return;
    try {
      await deleteMutation.mutateAsync(projectToDelete.id);
      setDeleteConfirmOpen(false);
      setProjectToDelete(null);
    } catch {
      // 错误在 mutation 的 onError 中处理
    }
  };

  const runProcQuery = async () => {
    const q = String(procQueryName || '').trim();
    if (!q) { setProcResults([]); return; }
    setProcLoading(true);
    try {
      const arr = await searchProcessesByName(q);
      setProcResults(Array.isArray(arr) ? arr : []);
    } catch (e) {
      showError('查询失败', String(e?.message || e));
    } finally {
      setProcLoading(false);
    }
  };

  const runPortQuery = async () => {
    const p = parseInt(String(portQueryValue || '').trim(), 10);
    if (!Number.isFinite(p) || p <= 0) { setPortResults([]); return; }
    setPortLoading(true);
    try {
      const arr = await listProcessesByPort(p);
      setPortResults(Array.isArray(arr) ? arr : []);
    } catch (e) {
      showError('查询失败', String(e?.message || e));
    } finally {
      setPortLoading(false);
    }
  };

  const handleStopFromQuery = async (pid, kind) => {
    try {
      await killProcess(pid);
      showSuccess('已发送停止信号', `PID ${pid}`);

      if (kind === 'name') await runProcQuery();
      if (kind === 'port') await runPortQuery();
    } catch (e) {
      showError('停止失败', String(e?.message || e));
    }
  };

  const displayProjects = projects;
  const filteredProjects = displayProjects.filter(project => {
    const matchesSearch = project.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         project.description?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = categoryFilter === "all" || project.category === categoryFilter;
    const dispStatus = runtimeStatus[project.id] ?? 'stopped';
    const matchesStatus = statusFilter === "all" || dispStatus === statusFilter;
    
    return matchesSearch && matchesCategory && matchesStatus;
  });

  function statusRank(s) {
    // 状态排序优先级：运行中 > 已停止
    const order = { running: 2, stopped: 1 };
    return order[s] || 0;
  }

  function sortProjects(items) {
    const arr = items.slice();
    switch (sortOption) {
      case 'updated_asc':
        return arr.sort((a, b) => (a.updated_date || '').localeCompare(b.updated_date || ''));
      case 'name_asc':
        return arr.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      case 'name_desc':
        return arr.sort((a, b) => (b.name || '').localeCompare(a.name || ''));
      case 'status':
        return arr.sort((a, b) => {
          const sr = statusRank(b.status) - statusRank(a.status);
          if (sr !== 0) return sr;
          return (a.name || '').localeCompare(b.name || '');
        });
      case 'group_name':
        return arr.sort((a, b) => {
          const ga = (a.group || '').localeCompare(b.group || '');
          if (ga !== 0) return ga;
          return (a.name || '').localeCompare(b.name || '');
        });
      case 'updated_desc':
      default:
        return arr.sort((a, b) => (b.updated_date || '').localeCompare(a.updated_date || ''));
    }
  }

  const sortedProjects = sortProjects(
    filteredProjects.map((p) => ({
      ...p,
      status: runtimeStatus[p.id] ?? 'stopped',
      runtime_pid: runtimePid[p.id] ?? p.runtime_pid ?? null,
    })),
  );

  const stats = {
    total: displayProjects.length,
    running: displayProjects.filter(p => (runtimeStatus[p.id] ?? 'stopped') === 'running').length,
    stopped: displayProjects.filter(p => (runtimeStatus[p.id] ?? 'stopped') === 'stopped').length,
    withGuard: projects.filter(p => p.auto_restart).length,
  };

  // 前端不在生命周期事件中写入任何状态，严格由后端提供
  useEffect(() => {}, []);

  // 保守策略：应用重启后仅展示现有运行进程，不在前端自动触发任何任务的守护启动
  useEffect(() => {
    if (!projects || projects.length === 0) return;
    // 不做自动干预，只依赖后端状态接口（/api/projects/status）进行展示和手动控制
  }, [projects]);

  if (showForm) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 p-6">
        <ProjectForm
          project={editingProject}
          existingGroups={Array.from(new Set(projects.map(p => p.group).filter(g => typeof g === 'string' && g.trim().length > 0))).sort((a, b) => a.localeCompare(b))}
          onSave={handleSave}
          onCancel={() => {
            setShowForm(false);
            setEditingProject(null);
          }}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      {/* 头部 */}
      <div className="bg-white/80 backdrop-blur-md border-b sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                脚本管理中心
              </h1>
              <p className="text-gray-600 mt-1">管理和监控你的本地脚本</p>
            </div>
            <Button
              onClick={() => setShowForm(true)}
              className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700"
            >
              <Plus className="w-4 h-4 mr-2" />
              新建任务
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* 右侧 Toast 自动提示，顶部不再显示状态卡片 */}
        <div className="flex gap-2 mb-4">
          <Button variant="outline" onClick={() => setProcQueryOpen(true)}>
            查询任务进程
          </Button>
          <Button variant="outline" onClick={() => setPortQueryOpen(true)}>
            查询端口
          </Button>
        </div>
        {/* 统计卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-xl p-6 shadow-sm border-2 border-blue-100"
          >
            <div className="text-3xl font-bold text-blue-600">{stats.total}</div>
            <div className="text-sm text-gray-600 mt-1">总任务数</div>
          </motion.div>
          
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-white rounded-xl p-6 shadow-sm border-2 border-green-100"
          >
            <div className="text-3xl font-bold text-green-600">{stats.running}</div>
            <div className="text-sm text-gray-600 mt-1">运行中</div>
          </motion.div>
          
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-white rounded-xl p-6 shadow-sm border-2 border-gray-100"
          >
            <div className="text-3xl font-bold text-gray-600">{stats.stopped}</div>
            <div className="text-sm text-gray-600 mt-1">已停止</div>
          </motion.div>
          
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-white rounded-xl p-6 shadow-sm border-2 border-purple-100"
          >
            <div className="text-3xl font-bold text-purple-600">{stats.withGuard}</div>
            <div className="text-sm text-gray-600 mt-1">守护进程</div>
          </motion.div>
        </div>

        {/* 搜索和筛选 */}
        <div className="bg-white rounded-xl p-4 mb-6 shadow-sm">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input
                placeholder="搜索任务..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-full md:w-40">
                <SelectValue placeholder="任务类型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部类型</SelectItem>
                <SelectItem value="frontend">前端</SelectItem>
                <SelectItem value="backend">后端</SelectItem>
                <SelectItem value="desktop">应用</SelectItem>
                <SelectItem value="script">脚本</SelectItem>
                <SelectItem value="other">其他</SelectItem>
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full md:w-32">
                <SelectValue placeholder="状态" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="running">运行中</SelectItem>
                <SelectItem value="stopped">已停止</SelectItem>
              </SelectContent>
            </Select>

            {/* 排序放在图标左侧 */}
            <Select value={sortOption} onValueChange={setSortOption}>
              <SelectTrigger className="w-full md:w-48">
                <SelectValue placeholder="排序方式" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="updated_desc">最近更新（降序）</SelectItem>
                <SelectItem value="updated_asc">最近更新（升序）</SelectItem>
                <SelectItem value="name_asc">名称（A→Z）</SelectItem>
                <SelectItem value="name_desc">名称（Z→A）</SelectItem>
                <SelectItem value="status">状态（运行中优先）</SelectItem>
                <SelectItem value="group_name">组+名称</SelectItem>
              </SelectContent>
            </Select>

            {/* 视图与分组图标切换 */}
            <div className="flex gap-2">
              <Button
                variant={viewMode === 'grid' ? 'default' : 'outline'}
                size="icon"
                onClick={() => setViewMode('grid')}
                title="网格视图"
                aria-label="网格视图"
              >
                <LayoutGrid className="w-4 h-4" />
              </Button>
              <Button
                variant={viewMode === 'list' ? 'default' : 'outline'}
                size="icon"
                onClick={() => setViewMode('list')}
                title="列表视图"
                aria-label="列表视图"
              >
                <List className="w-4 h-4" />
              </Button>
              <Button
                variant={groupBy === 'group' ? 'default' : 'outline'}
                size="icon"
                onClick={() => setGroupBy(groupBy === 'group' ? 'none' : 'group')}
                title={groupBy === 'group' ? '按分组显示' : '不分组'}
                aria-label="分组切换"
              >
                <Layers className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* 项目列表 */}
        {sortedProjects.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-6xl mb-4">📦</div>
            <h3 className="text-xl font-semibold text-gray-700 mb-2">
              {searchQuery || categoryFilter !== "all" || statusFilter !== "all" 
                ? "没有找到匹配的任务" 
                : "还没有任务"}
            </h3>
            <p className="text-gray-500 mb-6">
              {searchQuery || categoryFilter !== "all" || statusFilter !== "all"
                ? "尝试调整搜索条件"
                : "点击上方按钮创建你的第一个任务"}
            </p>
            {!searchQuery && categoryFilter === "all" && statusFilter === "all" && (
              <Button
                onClick={() => setShowForm(true)}
                className="bg-gradient-to-r from-blue-600 to-indigo-600"
              >
                <Plus className="w-4 h-4 mr-2" />
                新建任务
              </Button>
            )}
          </div>
        ) : (
          groupBy === 'group' ? (
            <div className="space-y-8">
              {Object.entries(sortedProjects.reduce((acc, p) => {
                const key = p.group || '未分组';
                acc[key] = acc[key] || [];
                acc[key].push(p);
                return acc;
              }, {})).sort(([a], [b]) => a.localeCompare(b)).map(([groupName, items]) => (
                <div key={groupName}>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-gray-800">{groupName}</h3>
                    <span className="text-xs text-gray-500">{items.length} 个任务</span>
                  </div>
                  <div className={viewMode === 'grid'
                    ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
                    : "space-y-4"
                  }>
                    <AnimatePresence>
                      {items.map((project) => (
                        <ProjectCard
                          key={project.id}
                          project={project}
                          onStart={handleStart}
                          onStop={handleStop}
                          onRestart={handleRestart}
                          onEdit={handleEdit}
                          onDelete={handleDelete}
                          onViewLogs={handleViewLogs}
                          viewMode={viewMode}
                        />
                      ))}
                    </AnimatePresence>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className={viewMode === 'grid' 
              ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" 
              : "space-y-4"
            }>
              <AnimatePresence>
                {sortedProjects.map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    onStart={handleStart}
                    onStop={handleStop}
                    onRestart={handleRestart}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onViewLogs={handleViewLogs}
                    viewMode={viewMode}
                  />
                ))}
              </AnimatePresence>
            </div>
          )
        )}
      </div>

      {/* 已移除命令提示弹窗 */}

      {/* 删除确认对话框 */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader className="space-y-3">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
              <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            </div>
            <AlertDialogTitle className="text-center text-xl">删除任务</AlertDialogTitle>
            <AlertDialogDescription className="text-center text-base">
              确定要删除任务 <span className="font-semibold text-gray-900">「{projectToDelete?.name || '未命名'}」</span> 吗？
              <br />
              <span className="text-red-600">此操作无法撤销</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="sm:space-x-2">
            <AlertDialogCancel onClick={() => { setDeleteConfirmOpen(false); setProjectToDelete(null); }}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">确认删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={procQueryOpen} onOpenChange={setProcQueryOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>查询任务进程</DialogTitle>
            <DialogDescription>输入任务名称关键词</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input
              value={procQueryName}
              onChange={(e) => setProcQueryName(e.target.value)}
              placeholder="任务名称关键词"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  runProcQuery();
                }
              }}
            />
            <Button onClick={runProcQuery}>查询</Button>
          </div>
          <div className="grid grid-cols-[120px_120px_1fr_80px] items-center px-2 py-2 text-xs text-gray-500">
            <div>PID</div>
            <div>进程名</div>
            <div>命令行</div>
            <div className="text-right">操作</div>
          </div>
          <div className="space-y-2 max-h-72 overflow-auto">
            {procLoading && (
              <div className="text-sm text-gray-500">查询中…</div>
            )}
            {!procLoading && procResults.length === 0 && (
              <div className="text-sm text-gray-500">无匹配进程</div>
            )}
            {procResults.map((item) => (
              <div
                key={`${item.pid}-${item.command}`}
                className="grid grid-cols-[120px_120px_1fr_80px] items-center gap-2 px-2 py-2 rounded text-sm hover:bg-accent"
              >
                <div className="font-mono">{item.pid}</div>
                <div className="truncate font-mono">
                  {item.command ? String(item.command).split(/\s+/)[0] : ''}
                </div>
                <div className="truncate font-mono" title={item.command}>
                  {item.command}
                </div>
                <div className="text-right">
                  <Button size="sm" variant="destructive" onClick={() => handleStopFromQuery(item.pid, 'name')}>停止</Button>
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProcQueryOpen(false)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={portQueryOpen} onOpenChange={setPortQueryOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>查询端口</DialogTitle>
            <DialogDescription>输入端口号</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input
              value={portQueryValue}
              onChange={(e) => setPortQueryValue(e.target.value)}
              placeholder="端口号"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  runPortQuery();
                }
              }}
            />
            <Button onClick={runPortQuery}>查询</Button>
          </div>
          <div className="grid grid-cols-[120px_100px_1fr_80px] items-center px-2 py-2 text-xs text-gray-500">
            <div>PID</div>
            <div>进程名</div>
            <div>详情</div>
            <div className="text-right">操作</div>
          </div>
          <div className="space-y-2 max-h-72 overflow-auto">
            {portLoading && (
              <div className="text-sm text-gray-500">查询中…</div>
            )}
            {!portLoading && portResults.length === 0 && (
              <div className="text-sm text-gray-500">无占用记录</div>
            )}
            {portResults.map((item) => (
              <div
                key={`${item.pid}-${item.name || item.command}`}
                className="grid grid-cols-[120px_100px_1fr_80px] items-center gap-2 px-2 py-2 rounded text-sm hover:bg-accent"
              >
                <div className="font-mono">{item.pid}</div>
                <div className="truncate font-mono">
                  {item.command ? String(item.command).split(/\s+/)[0] : ''}
                </div>
                <div
                  className="truncate font-mono"
                  title={`${item.command || ''}${item.name ? ` ${item.name}` : ''}`}
                >
                  {item.command}{item.name ? ` ${item.name}` : ''}
                </div>
                <div className="text-right">
                  <Button size="sm" variant="destructive" onClick={() => handleStopFromQuery(item.pid, 'port')}>停止</Button>
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPortQueryOpen(false)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 日志查看模态框 */}
      <LogsModal
        project={viewingLogsProject}
        isOpen={logsModalOpen}
        onClose={() => {
          setLogsModalOpen(false);
          setViewingLogsProject(null);
        }}
      />
    </div>
  );
}
