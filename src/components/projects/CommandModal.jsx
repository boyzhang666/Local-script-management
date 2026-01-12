import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, Check, Terminal } from "lucide-react";
import { useCommandConfig } from "@/hooks/useCommandConfig";
import { resolveCommand } from "@/utils/commandResolution";

export default function CommandModal({ project, isOpen, onClose }) {
  const [copied, setCopied] = useState(false);
  const commandConfigQuery = useCommandConfig();

  if (!project) return null;

  const platform = commandConfigQuery.data?.currentPlatform || null;
  const config = commandConfigQuery.data?.config || null;
  const resolvedStartCommand = resolveCommand(project.start_command, project.category, config, platform);

  const generateFullCommand = () => {
    let command = "";
    
    if (project.working_directory) {
      command += `cd ${project.working_directory} && `;
    }
    
    if (project.environment_variables && Object.keys(project.environment_variables).length > 0) {
      const envVars = Object.entries(project.environment_variables)
        .map(([key, value]) => `${key}="${value}"`)
        .join(' ');
      command += `${envVars} `;
    }
    
    command += resolvedStartCommand || project.start_command;
    
    return command;
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(generateFullCommand());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Terminal className="w-5 h-5" />
            启动命令 - {project.name}
          </DialogTitle>
          <DialogDescription>
            复制以下命令到你的终端执行
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* 项目信息 */}
          <div className="flex gap-2 flex-wrap">
            <Badge variant="outline">端口: {project.port || "未设置"}</Badge>
            {project.auto_restart && <Badge className="bg-green-100 text-green-700">守护进程</Badge>}
            {project.scheduled_start && <Badge className="bg-blue-100 text-blue-700">定时启动</Badge>}
          </div>

          {/* 完整命令 */}
          <div className="relative">
            <div className="bg-gray-900 text-green-400 p-4 rounded-lg font-mono text-sm overflow-x-auto">
              <pre className="whitespace-pre-wrap break-all">
                {generateFullCommand()}
              </pre>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="absolute top-2 right-2 bg-white/90"
              onClick={copyToClipboard}
            >
              {copied ? (
                <>
                  <Check className="w-3 h-3 mr-1" />
                  已复制
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3 mr-1" />
                  复制
                </>
              )}
            </Button>
          </div>

          {/* 分步说明 */}
          <div className="space-y-2">
            <h4 className="font-semibold text-sm">执行步骤：</h4>
            <ol className="space-y-2 text-sm text-gray-600">
              {project.working_directory && (
                <li className="flex gap-2">
                  <span className="font-semibold">1.</span>
                  <span>切换到工作目录: <code className="bg-gray-100 px-2 py-0.5 rounded">{project.working_directory}</code></span>
                </li>
              )}
              {project.environment_variables && Object.keys(project.environment_variables).length > 0 && (
                <li className="flex gap-2">
                  <span className="font-semibold">{project.working_directory ? "2" : "1"}.</span>
                  <span>设置环境变量: {Object.keys(project.environment_variables).length} 个</span>
                </li>
              )}
              <li className="flex gap-2">
                <span className="font-semibold">
                  {(project.working_directory ? 1 : 0) + (Object.keys(project.environment_variables || {}).length > 0 ? 1 : 0) + 1}.
                </span>
                <span>执行启动命令: <code className="bg-gray-100 px-2 py-0.5 rounded font-mono">{resolvedStartCommand || project.start_command}</code></span>
              </li>
            </ol>
          </div>

          {/* 提示信息 */}
          <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p className="text-sm text-yellow-800">
              ⚠️ 提示：应用已支持一键启动/停止（需要本地执行器运行：npm run server）。若启动失败，可复制上述命令到终端手动执行。
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
