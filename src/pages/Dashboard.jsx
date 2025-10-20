import { useState, useEffect, useRef } from 'react';
import { listProjects, createProject, updateProject, deleteProject } from "@/api/localProjects";
import { startProject as startProcess, stopProject as stopProcess, getProjectStatus, getProjectLogs } from "@/api/processControl";
import { toast } from "@/components/ui/use-toast";
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

export default function Dashboard() {
  const [showForm, setShowForm] = useState(false);
  const [editingProject, setEditingProject] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [viewMode, setViewMode] = useState("grid");
  const [groupBy, setGroupBy] = useState("none"); // none | group
  const [sortOption, setSortOption] = useState("name_asc"); // updated_desc | updated_asc | name_asc | name_desc | status | group_name
  // 顶部反馈卡片不再使用，改为右侧 Toast 自动消失
  
  const queryClient = useQueryClient();
  const notifiedMaxIdsRef = useRef(new Set());
  const bootGuardRanRef = useRef(false); // 本次应用会话是否已运行过“系统重启后的守护流程”
  const guardianTimersRef = useRef(new Map()); // 记录守护定时器：id -> timer
  const guardianActiveIdsRef = useRef(new Set()); // 会话内被守护的任务记录

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => listProjects(),
    initialData: [],
  });

  // 自愈：若有任务卡在 executing，自动核对后端状态并修正
  useEffect(() => {
    const needCheck = projects.some(p => p.status === 'executing');
    if (!needCheck) return;
    (async () => {
      for (const p of projects) {
        if (p.status !== 'executing') continue;
        try {
          const status = await getProjectStatus(p.id);
          if (status?.running) {
            updateMutation.mutate({ id: p.id, data: { status: 'running' } });
          } else {
            updateMutation.mutate({ id: p.id, data: { status: 'error' } });
            toast({ title: '启动异常', description: `任务「${p.name || p.id}」状态已校正为错误`, duration: 2500 });
          }
        } catch {
          // 查询失败时，标记为错误以避免长时间停留在执行中
          updateMutation.mutate({ id: p.id, data: { status: 'error' } });
        }
      }
    })();
  }, [projects]);

  // 新增：项目重启后的状态自愈机制
  useEffect(() => {
    if (!projects || projects.length === 0) return;
    (async () => {
      for (const p of projects) {
        if (p.status === 'running') {
          try {
            let isActuallyRunning = false;
            if (p.port) {
              isActuallyRunning = await checkPortReady(p.port, 3, 500);
            } else {
              const status = await getProjectStatus(p.id);
              isActuallyRunning = status?.running || false;
            }
            if (!isActuallyRunning) {
              updateMutation.mutate({ id: p.id, data: { status: 'stopped' } });
            }
          } catch {
            updateMutation.mutate({ id: p.id, data: { status: 'stopped' } });
          }
        }
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
      toast({ title: '任务已删除', description: '该任务已从列表移除' });
    },
    onError: (error) => {
      toast({ title: '删除失败', description: error?.message || '请稍后再试', variant: 'destructive' });
    }
  });

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function checkPortReady(port, attempts = 10, intervalMs = 800, path = '/') {
    const url = `http://127.0.0.1:${port}${path}`;
    for (let i = 0; i < attempts; i++) {
      try {
        // Use no-cors so that even without CORS headers, we can detect reachability
        await fetch(url, { method: 'GET', mode: 'no-cors' });
        return true;
      } catch {
        await delay(intervalMs);
      }
    }
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

  // 系统重启守护：辅助函数，取消某任务的定时器并移除守护记录
  const cancelGuardianFor = (id) => {
    const t = guardianTimersRef.current.get(id);
    if (t) {
      clearTimeout(t);
      guardianTimersRef.current.delete(id);
    }
    guardianActiveIdsRef.current.delete(id);
  };

  // 系统重启守护：为单个任务执行按间隔重试的启动流程（仅在会话启动时触发）
  const runGuardian = (id) => {
    guardianActiveIdsRef.current.add(id);
    const attempt = async () => {
      let arr = [];
      try { arr = listProjects(); } catch { arr = []; }
      const p = arr.find(x => x.id === id);
      if (!p) { cancelGuardianFor(id); return; }
      if (p.manual_stopped || !p.auto_restart) { cancelGuardianFor(id); return; }
      const max = typeof p.max_restarts === 'number' ? p.max_restarts : 5;
      const intervalSec = typeof p.restart_interval === 'number' ? p.restart_interval : 15;
      const count = typeof p.restart_count === 'number' ? p.restart_count : 0;

      if (count >= max) {
        if (!notifiedMaxIdsRef.current.has(id)) {
          notifiedMaxIdsRef.current.add(id);
          toast({ title: '守护已停止', description: `任务「${p.name || id}」已达到最大重启次数（${max}次）`, variant: 'destructive', duration: 3000 });
        }
        cancelGuardianFor(id);
        return;
      }

      // 尝试启动（无需触发手动逻辑）
      updateMutation.mutate({ id, data: { status: 'executing' } });
      const startResult = await startProcess(p).catch((e) => ({ ok: false, error: String(e) }));
      if (startResult && startResult.ok === false) {
        const newCount = count + 1;
        updateMutation.mutate({ id, data: { status: 'error', restart_count: newCount } });
        if (newCount >= max) {
          if (!notifiedMaxIdsRef.current.has(id)) {
            notifiedMaxIdsRef.current.add(id);
            toast({ title: '守护已停止', description: `任务「${p.name || id}」已达到最大重启次数（${max}次）`, variant: 'destructive', duration: 3000 });
          }
          cancelGuardianFor(id);
        } else {
          const t = setTimeout(attempt, Math.max(1, intervalSec) * 1000);
          guardianTimersRef.current.set(id, t);
        }
        return;
      }

      // 健康检查
      let ok = false;
      if (p.port) {
        ok = await checkPortReady(p.port, 10, 800);
      } else {
        ok = await waitForRunningStatus(id, 10, 800);
      }

      if (ok) {
        updateMutation.mutate({ id, data: { status: 'running', restart_count: 0, manual_stopped: false, last_started: new Date().toISOString() } });
        notifiedMaxIdsRef.current.delete(id);
        toast({ title: '守护启动成功', description: `任务「${p.name || id}」已恢复运行`, duration: 2000 });
        cancelGuardianFor(id);
      } else {
        await stopProcess(p).catch(() => {});
        const newCount = count + 1;
        updateMutation.mutate({ id, data: { status: 'error', restart_count: newCount } });
        if (newCount >= max) {
          if (!notifiedMaxIdsRef.current.has(id)) {
            notifiedMaxIdsRef.current.add(id);
            toast({ title: '守护已停止', description: `任务「${p.name || id}」已达到最大重启次数（${max}次）`, variant: 'destructive', duration: 3000 });
          }
          cancelGuardianFor(id);
        } else {
          const t = setTimeout(attempt, Math.max(1, intervalSec) * 1000);
          guardianTimersRef.current.set(id, t);
        }
      }
    };
    attempt();
  };
  const handleSave = (data) => {
    if (editingProject) {
      updateMutation.mutate({ id: editingProject.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleStart = async (project) => {
    try {
      // 手动操作前，取消该任务的守护定时器
      cancelGuardianFor(project.id);
      if (!project.start_command || !String(project.start_command).trim()) {
        toast({ title: '无法启动', description: '请先在任务设置中填写启动命令（start_command）', duration: 3000 });
        return;
      }
      // 立即标记为"执行中"
      updateMutation.mutate({
        id: project.id,
        data: { 
          status: 'executing', 
          last_started: new Date().toISOString(),
          manual_stopped: false
        }
      });
      toast({ title: '正在启动…', description: `${project.name} 正在启动并进行健康检查`, duration: 1000 });

      const startResult = await startProcess(project);

      // 后端早期校验：若启动命令在启动窗口内失败，返回真实错误和日志
      if (startResult && startResult.ok === false) {
        const lastErr = (startResult.logs?.stderr || []).slice(-10).join('\n');
        await stopProcess(project.id).catch(() => {});
        updateMutation.mutate({ id: project.id, data: { status: 'error' } });
        toast({ title: '启动失败', description: `已终止进程。${lastErr || startResult.error || '未知错误'}`, duration: 4000 });
        return;
      }

      let ok = false;
      if (project.port) {
        ok = await checkPortReady(project.port);
      } else {
        ok = await waitForRunningStatus(project.id);
      }

      if (ok) {
        updateMutation.mutate({
          id: project.id,
          data: { 
            status: 'running', 
            last_started: new Date().toISOString(),
            manual_stopped: false,  // 确保清除手动停止标记
            restart_count: 0  // 手动启动成功后重置守护进程重启计数
          }
        });
        notifiedMaxIdsRef.current.delete(project.id);
        toast({ title: '启动成功', description: `${project.name} 已启动并通过健康检查`, duration: 1000 });
      } else {
        await stopProcess(project.id).catch(() => {});
        updateMutation.mutate({ id: project.id, data: { status: 'error' } });
        // 取后端日志作为真实错误信息
        const logs = await getProjectLogs(project.id).catch(() => ({ stdout: [], stderr: [] }));
        const lastErr = logs.stderr?.slice(-10).join('\n') || logs.stdout?.slice(-10).join('\n') || '健康检查未通过';
        toast({ title: '启动失败', description: `健康检查超时，已终止进程。${lastErr}`, duration: 4000 });
      }
    } catch (e) {
      updateMutation.mutate({ id: project.id, data: { status: 'error' } });
      // 如果后端返回了结构化错误（通过 startProject 返回），e 可能是字符串；已在上面处理
      toast({ title: '启动失败', description: String(e).slice(0, 300), duration: 4000 });
    }
  };

  const handleStop = async (project) => {
    try {
      // 手动操作前，取消该任务的守护定时器
      cancelGuardianFor(project.id);
      await stopProcess(project);
      updateMutation.mutate({
        id: project.id,
        data: { 
          status: 'stopped',
          manual_stopped: true
        }
      });
      toast({ title: '已停止', description: `${project.name} 已停止`, duration: 1000 });
    } catch (e) {
      toast({ title: '停止失败', description: String(e).slice(0, 200), duration: 1000 });
    }
  };

  const handleRestart = async (project) => {
    try {
      // 手动操作前，取消该任务的守护定时器
      cancelGuardianFor(project.id);
      if (!project.start_command || !String(project.start_command).trim()) {
        toast({ title: '无法重启', description: '请先在任务设置中填写启动命令（start_command）', duration: 3000 });
        return;
      }
      await stopProcess(project).catch(() => {});
      updateMutation.mutate({
          id: project.id,
          data: { 
            status: 'executing'
          }
        });
      toast({ title: '正在重启…', description: `${project.name} 正在重启并进行健康检查`, duration: 1000 });
      const startResult = await startProcess(project);

      if (startResult && startResult.ok === false) {
        const lastErr = (startResult.logs?.stderr || []).slice(-10).join('\n');
        await stopProcess(project).catch(() => {});
        updateMutation.mutate({ id: project.id, data: { status: 'error' } });
        toast({ title: '重启失败', description: `已终止进程。${lastErr || startResult.error || '未知错误'}`, duration: 4000 });
        return;
      }

      let ok = false;
      if (project.port) {
        ok = await checkPortReady(project.port);
      } else {
        ok = await waitForRunningStatus(project.id);
      }

      updateMutation.mutate({
        id: project.id,
        data: { 
          last_started: new Date().toISOString(),
          status: ok ? 'running' : 'error',
          manual_stopped: false,  // 清除手动停止标记
          ...(ok && { restart_count: 0 }) // 成功时才重置守护进程重启计数
          // 注意：手动重启不增加 restart_count，该计数仅用于守护进程自动重启
        }
      });

      if (ok) {
        notifiedMaxIdsRef.current.delete(project.id);
        toast({ title: '重启成功', description: `${project.name} 已重启并通过健康检查`, duration: 1000 });
      } else {
        await stopProcess(project.id).catch(() => {});
        const logs = await getProjectLogs(project.id).catch(() => ({ stdout: [], stderr: [] }));
        const lastErr = logs.stderr?.slice(-10).join('\n') || logs.stdout?.slice(-10).join('\n') || '健康检查未通过';
        toast({ title: '重启失败', description: `健康检查超时，已终止进程。${lastErr}`, duration: 4000 });
      }
    } catch (e) {
      toast({ title: '重启失败', description: String(e).slice(0, 300), duration: 4000 });
    }
  };

  const handleEdit = (project) => {
    setEditingProject(project);
    setShowForm(true);
  };

  // 新增：删除处理
  const handleDelete = async (project) => {
    if (!project?.id) return;
    const name = project.name || project.id;
    const confirmDelete = window.confirm(`确认删除任务「${name}」？此操作不可撤销。`);
    if (!confirmDelete) return;
    try {
      await deleteMutation.mutateAsync(project.id);
    } catch {
      // 错误在 mutation 的 onError 中处理
    }
  };

  const filteredProjects = projects.filter(project => {
    const matchesSearch = project.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         project.description?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = categoryFilter === "all" || project.category === categoryFilter;
    const matchesStatus = statusFilter === "all" || project.status === statusFilter;
    
    return matchesSearch && matchesCategory && matchesStatus;
  });

  function statusRank(s) {
    // 状态排序优先级：运行中 > 执行中 > 已停止 > 错误
    const order = { running: 4, executing: 3, stopped: 2, error: 1 };
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

  const sortedProjects = sortProjects(filteredProjects);

  const stats = {
    total: projects.length,
    running: projects.filter(p => p.status === 'running').length,
    stopped: projects.filter(p => p.status === 'stopped').length,
    withGuard: projects.filter(p => p.auto_restart).length,
  };

  // 记录当前会话结束时哪些任务处于运行状态，以便下次系统重启后执行守护恢复
  useEffect(() => {
    const onBeforeUnload = () => {
      let arr = [];
      try { arr = listProjects(); } catch { arr = []; }
      for (const p of arr) {
        try {
          // 直接写入本地存储，确保在刷新/关闭页面时可靠落盘
          updateProject(p.id, { was_running_before_shutdown: p.status === 'running' });
        } catch (e) { /* ignore */ void e; }
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // 会话启动时的“一次性系统重启守护流程”：仅针对上次会话处于运行状态、开启守护且未被手动停止的任务
  useEffect(() => {
    if (!projects || projects.length === 0) return;
    if (bootGuardRanRef.current) return;
    bootGuardRanRef.current = true;

    const candidates = projects.filter(p => p.auto_restart && p.was_running_before_shutdown && !p.manual_stopped && p.status !== 'running');
    for (const p of candidates) {
      runGuardian(p.id);
    }
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
                <SelectItem value="executing">执行中</SelectItem>
                <SelectItem value="running">运行中</SelectItem>
                <SelectItem value="stopped">已停止</SelectItem>
                <SelectItem value="error">错误</SelectItem>
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
                  />
                ))}
              </AnimatePresence>
            </div>
          )
        )}
      </div>

      {/* 已移除命令提示弹窗 */}
    </div>
  );
}