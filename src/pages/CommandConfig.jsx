import { useState, useEffect } from 'react';
import { getCommandConfig, updateCommandConfig, resetCommandConfig } from '@/api/commandConfig';
import { showSuccess, showError } from '@/utils/notification';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Plus, Trash2, RotateCcw, Save } from "lucide-react";
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

const platformDisplayNames = {
  windows: 'Windows',
  macos: 'MacOS',
  linux: 'Linux',
};

export default function CommandConfig({ onBack }) {
  const [config, setConfig] = useState(null);
  const [currentPlatform, setCurrentPlatform] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [activePlatform, setActivePlatform] = useState('');

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      setLoading(true);
      const data = await getCommandConfig();
      setConfig(data.config);
      setCurrentPlatform(data.currentPlatform);
      setActivePlatform(data.currentPlatform);
    } catch (e) {
      showError('加载配置失败', String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      await updateCommandConfig(config);
      showSuccess('保存成功', '命令配置已更新');
    } catch (e) {
      showError('保存失败', String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    try {
      const result = await resetCommandConfig();
      setConfig(result.config);
      showSuccess('重置成功', '命令配置已恢复默认值');
      setResetConfirmOpen(false);
    } catch (e) {
      showError('重置失败', String(e));
    }
  };

  const updateCategory = (platform, index, field, value) => {
    setConfig(prev => {
      const newConfig = { ...prev };
      newConfig[platform] = { ...newConfig[platform] };
      newConfig[platform].categories = [...newConfig[platform].categories];
      newConfig[platform].categories[index] = {
        ...newConfig[platform].categories[index],
        [field]: value,
      };
      return newConfig;
    });
  };

  const updateCommandTemplate = (platform, categoryValue, field, value) => {
    setConfig(prev => {
      const newConfig = { ...prev };
      newConfig[platform] = { ...newConfig[platform] };
      newConfig[platform].commandTemplates = { ...newConfig[platform].commandTemplates };
      newConfig[platform].commandTemplates[categoryValue] = {
        ...newConfig[platform].commandTemplates[categoryValue],
        [field]: value,
      };
      return newConfig;
    });
  };

  const addCategory = (platform) => {
    const newValue = `custom_${Date.now()}`;
    setConfig(prev => {
      const newConfig = { ...prev };
      newConfig[platform] = { ...newConfig[platform] };
      newConfig[platform].categories = [
        ...newConfig[platform].categories,
        { value: newValue, label: '新类型' },
      ];
      newConfig[platform].commandTemplates = {
        ...newConfig[platform].commandTemplates,
        [newValue]: { pattern: '{cmd}', description: '直接执行命令' },
      };
      return newConfig;
    });
  };

  const removeCategory = (platform, index) => {
    const categoryValue = config[platform].categories[index].value;
    setConfig(prev => {
      const newConfig = { ...prev };
      newConfig[platform] = { ...newConfig[platform] };
      newConfig[platform].categories = newConfig[platform].categories.filter((_, i) => i !== index);
      const { [categoryValue]: removed, ...rest } = newConfig[platform].commandTemplates;
      newConfig[platform].commandTemplates = rest;
      return newConfig;
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 p-6 flex items-center justify-center">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 p-6 flex flex-col items-center justify-center gap-4">
        <div className="text-red-500">加载配置失败</div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onBack}>返回</Button>
          <Button onClick={loadConfig}>重试</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      {/* 头部 */}
      <div className="bg-white/80 backdrop-blur-md border-b sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" onClick={onBack}>
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                  命令管理
                </h1>
                <p className="text-gray-600 mt-1">
                  管理不同平台下的任务类型和执行命令
                  <span className="ml-2 text-sm bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                    当前平台: {platformDisplayNames[currentPlatform]}
                  </span>
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setResetConfirmOpen(true)}>
                <RotateCcw className="w-4 h-4 mr-2" />
                重置为默认
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving}
                className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700"
              >
                <Save className="w-4 h-4 mr-2" />
                {saving ? '保存中...' : '保存配置'}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        <Tabs value={activePlatform} onValueChange={setActivePlatform}>
          <TabsList className="mb-6">
            {Object.keys(config).map(platform => (
              <TabsTrigger key={platform} value={platform} className="gap-2">
                {platformDisplayNames[platform]}
                {platform === currentPlatform && (
                  <span className="text-xs bg-green-500 text-white px-1.5 py-0.5 rounded">当前</span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>

          {Object.keys(config).map(platform => (
            <TabsContent key={platform} value={platform}>
              <div className="space-y-6">
                {/* 任务类型列表 */}
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="text-lg">任务类型配置</CardTitle>
                    <Button variant="outline" size="sm" onClick={() => addCategory(platform)}>
                      <Plus className="w-4 h-4 mr-1" />
                      添加类型
                    </Button>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {config[platform].categories.map((category, index) => (
                        <div key={category.value} className="border rounded-lg p-4 space-y-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4 flex-1">
                              <div className="w-32">
                                <Label className="text-xs text-gray-500">类型标识</Label>
                                <Input
                                  value={category.value}
                                  onChange={(e) => updateCategory(platform, index, 'value', e.target.value)}
                                  className="font-mono text-sm"
                                />
                              </div>
                              <div className="w-40">
                                <Label className="text-xs text-gray-500">显示名称</Label>
                                <Input
                                  value={category.label}
                                  onChange={(e) => updateCategory(platform, index, 'label', e.target.value)}
                                />
                              </div>
                              <div className="flex-1">
                                <Label className="text-xs text-gray-500">执行命令模板</Label>
                                <Input
                                  value={config[platform].commandTemplates[category.value]?.pattern || '{cmd}'}
                                  onChange={(e) => updateCommandTemplate(platform, category.value, 'pattern', e.target.value)}
                                  placeholder="使用 {cmd} 表示用户输入的命令"
                                  className="font-mono text-sm"
                                />
                              </div>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-red-500 hover:text-red-700 hover:bg-red-50"
                              onClick={() => removeCategory(platform, index)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                          <div>
                            <Label className="text-xs text-gray-500">命令说明</Label>
                            <Input
                              value={config[platform].commandTemplates[category.value]?.description || ''}
                              onChange={(e) => updateCommandTemplate(platform, category.value, 'description', e.target.value)}
                              placeholder="描述这个命令模板的作用"
                              className="text-sm"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* 使用说明 */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">使用说明</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm text-gray-600 space-y-2">
                    <p><strong>执行命令模板：</strong>使用 <code className="bg-gray-100 px-1 rounded">{'{cmd}'}</code> 占位符表示用户在新建任务时填写的启动命令。</p>
                    <p><strong>示例：</strong></p>
                    <ul className="list-disc list-inside space-y-1 ml-4">
                      <li><code className="bg-gray-100 px-1 rounded">bash {'{cmd}'}</code> - 用户填写 <code>script.sh</code>，实际执行 <code>bash script.sh</code></li>
                      <li><code className="bg-gray-100 px-1 rounded">python3 {'{cmd}'}</code> - 用户填写 <code>main.py</code>，实际执行 <code>python3 main.py</code></li>
                      <li><code className="bg-gray-100 px-1 rounded">{'{cmd}'}</code> - 直接执行用户填写的命令，不做任何转换</li>
                    </ul>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </div>

      {/* 重置确认对话框 */}
      <AlertDialog open={resetConfirmOpen} onOpenChange={setResetConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>重置配置</AlertDialogTitle>
            <AlertDialogDescription>
              确定要重置所有命令配置为默认值吗？此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleReset} className="bg-red-600 hover:bg-red-700">
              确认重置
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
