import React, { useCallback, useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { RotateCw, Loader2 } from "lucide-react";
import { getProjectLogs } from "@/api/processControl";

export default function LogsModal({ project, isOpen, onClose }) {
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState({ stdout: [], stderr: [] });
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const id = project?.id;
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const data = await getProjectLogs(id);
      setLogs({
        stdout: Array.isArray(data?.stdout) ? data.stdout : [],
        stderr: Array.isArray(data?.stderr) ? data.stderr : [],
      });
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [project?.id]);

  useEffect(() => {
    if (!isOpen) return;
    load();
  }, [isOpen, load]);

  if (!project) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-2">
            <span>运行日志 - {project.name}</span>
            <Button size="sm" variant="outline" onClick={load} disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  加载中
                </>
              ) : (
                <>
                  <RotateCw className="w-3 h-3 mr-1" />
                  刷新
                </>
              )}
            </Button>
          </DialogTitle>
          <DialogDescription>
            这里展示后端捕获的 stdout/stderr（仅保留最近一段输出）。
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">
            {error}
          </div>
        ) : null}

        <Tabs defaultValue="stderr" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="stderr">stderr</TabsTrigger>
            <TabsTrigger value="stdout">stdout</TabsTrigger>
          </TabsList>

          <TabsContent value="stderr" className="mt-3">
            <pre className="bg-gray-900 text-green-200 rounded p-3 text-xs overflow-auto max-h-[60vh] whitespace-pre-wrap break-words font-mono">
              {(logs.stderr || []).join('\n') || '(empty)'}
            </pre>
          </TabsContent>
          <TabsContent value="stdout" className="mt-3">
            <pre className="bg-gray-900 text-green-200 rounded p-3 text-xs overflow-auto max-h-[60vh] whitespace-pre-wrap break-words font-mono">
              {(logs.stdout || []).join('\n') || '(empty)'}
            </pre>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
