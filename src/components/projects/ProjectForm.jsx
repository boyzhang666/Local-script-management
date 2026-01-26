import { useState } from 'react';
import PropTypes from 'prop-types';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { X, Plus } from "lucide-react";

const categories = [
  { value: "frontend", label: "前端" },
  { value: "backend", label: "后端" },
  { value: "desktop", label: "应用" },
  { value: "script", label: "脚本" },
  { value: "other", label: "其他" }
];

export default function ProjectForm({ project, existingGroups = [], onSave, onCancel }) {
  // 为避免旧数据缺少字段导致 Select/Inputs 受控状态报错，统一提供默认值并与传入的 project 合并
  const defaultForm = {
    name: "",
    description: "",
    group: "",
    category: "other",
    working_directory: "",
    start_command: "",
    stop_command: "",
    port: "",
    environment_variables: {},
    status: "stopped",
    auto_restart: false,
    max_restarts: 5,
    restart_interval: 15,
    scheduled_start: "",
    scheduled_stop: "",
    restart_count: 0,
    notes: "",
  };

  const [formData, setFormData] = useState(project ? { ...defaultForm, ...project } : defaultForm);

  const [envKey, setEnvKey] = useState("");
  const [envValue, setEnvValue] = useState("");

  // 当系统里没有任何项目组时，默认进入自定义输入模式；否则默认使用选择模式
  const [customGroupMode, setCustomGroupMode] = useState(existingGroups.length === 0);

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const addEnvVariable = () => {
    if (envKey && envValue) {
      setFormData(prev => ({
        ...prev,
        environment_variables: {
          ...prev.environment_variables,
          [envKey]: envValue
        }
      }));
      setEnvKey("");
      setEnvValue("");
    }
  };

  const removeEnvVariable = (key) => {
    const newEnvVars = { ...formData.environment_variables };
    delete newEnvVars[key];
    setFormData(prev => ({ ...prev, environment_variables: newEnvVars }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <Card className="max-w-4xl mx-auto">
      <CardHeader>
        <CardTitle>{project ? "编辑任务" : "新建任务"}</CardTitle>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent>
          <Tabs defaultValue="basic" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="basic">基本信息</TabsTrigger>
              <TabsTrigger value="advanced">高级配置</TabsTrigger>
              <TabsTrigger value="schedule">定时任务</TabsTrigger>
            </TabsList>

            <TabsContent value="basic" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                {/* 项目名称 与 项目组 同一行 */}
                {/* 任务名称 与 任务组 同一行 */}
                 <div>
                  <Label htmlFor="name">任务名称 *</Label>
                   <Input
                     id="name"
                     value={formData.name}
                     onChange={(e) => handleChange('name', e.target.value)}
                    placeholder="我的任务"
                     required
                   />
                 </div>

                 <div>
                  <Label htmlFor="group">任务组（可选）</Label>
                   {customGroupMode ? (
                     <div className="flex items-center gap-2">
                       <Input
                         id="group"
                         value={formData.group || ''}
                         onChange={(e) => handleChange('group', e.target.value)}
                        placeholder={existingGroups.length === 0 ? "输入新的任务组名称" : "输入新的任务组名称或切换为选择"}
                       />
                       {existingGroups.length > 0 && (
                         <Button type="button" variant="outline" size="sm" onClick={() => setCustomGroupMode(false)}>
                           选择已有
                         </Button>
                       )}
                     </div>
                   ) : (
                    <Select
                      value={formData.group ?? ''}
                      onValueChange={(value) => {
                        if (value === '__custom__') {
                          setCustomGroupMode(true);
                          return;
                        }
                        if (value === '__none__') {
                          handleChange('group', '');
                          return;
                        }
                        handleChange('group', value);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="未分组" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">未分组</SelectItem>
                        {existingGroups.map(g => (
                          <SelectItem key={g} value={g}>{g}</SelectItem>
                        ))}
                        <SelectItem value="__custom__">+ 输入新的组名…</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>

                <div className="col-span-2">
                  <Label htmlFor="description">任务描述</Label>
                   <Textarea
                     id="description"
                     value={formData.description}
                     onChange={(e) => handleChange('description', e.target.value)}
                    placeholder="简单描述这个任务..."
                     rows={3}
                   />
                 </div>

                 <div>
                  <Label htmlFor="category">任务类型</Label>
                   <Select
                     value={formData.category}
                     onValueChange={(value) => handleChange('category', value)}
                   >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map(cat => (
                        <SelectItem key={cat.value} value={cat.value}>
                          {cat.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="port">端口号(仅做记录)</Label>
                  <Input
                    id="port"
                    type="number"
                    value={formData.port ?? ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      handleChange('port', val === '' ? '' : parseInt(val, 10));
                    }}
                    placeholder="3000"
                    min="1"
                    max="65535"
                  />
                </div>

                <div className="col-span-2">
                  <Label htmlFor="working_directory">工作目录</Label>
                  <Input
                    id="working_directory"
                    value={formData.working_directory}
                    onChange={(e) => handleChange('working_directory', e.target.value)}
                    placeholder="/path/to/your/project"
                  />
                </div>

                <div className="col-span-2">
                  <Label htmlFor="start_command">启动命令 *</Label>
                  <Input
                    id="start_command"
                    value={formData.start_command}
                    onChange={(e) => handleChange('start_command', e.target.value)}
                    placeholder="如: python main.py"
                    required
                    className="font-mono"
                  />
                </div>

                <div className="col-span-2">
                  <Label htmlFor="stop_command">停止命令</Label>
                  <Input
                    id="stop_command"
                    value={formData.stop_command}
                    onChange={(e) => handleChange('stop_command', e.target.value)}
                    placeholder="默认不填写"
                    className="font-mono"
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="advanced" className="space-y-4 mt-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <Label className="text-base">自动重启</Label>
                    <p className="text-sm text-gray-500">进程崩溃时自动重启</p>
                  </div>
                  <Switch
                    checked={formData.auto_restart}
                    onCheckedChange={(checked) => handleChange('auto_restart', checked)}
                  />
                </div>

                {formData.auto_restart && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="max_restarts">最大重启次数</Label>
                      <Input
                        id="max_restarts"
                        type="number"
                        value={typeof formData.max_restarts === 'number' ? formData.max_restarts : ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          handleChange('max_restarts', val === '' ? '' : parseInt(val, 10));
                        }}
                        min="1"
                        max="100"
                      />
                    </div>
                    <div>
                      <Label htmlFor="restart_interval">重启间隔时间（秒）</Label>
                      <Input
                        id="restart_interval"
                        type="number"
                        value={typeof formData.restart_interval === 'number' ? formData.restart_interval : ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          handleChange('restart_interval', val === '' ? '' : parseInt(val, 10));
                        }}
                        min="5"
                        max="3600"
                        placeholder="30"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <Label>环境变量</Label>
                  <div className="space-y-2 mt-2">
                    {Object.entries(formData.environment_variables || {}).map(([key, value]) => (
                      <div key={key} className="flex items-center gap-2 p-2 bg-gray-50 rounded">
                        <span className="font-mono text-sm flex-1">{key}={value}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeEnvVariable(key)}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                    <div className="flex gap-2">
                      <Input
                        placeholder="KEY"
                        value={envKey}
                        onChange={(e) => setEnvKey(e.target.value)}
                        className="flex-1"
                      />
                      <Input
                        placeholder="VALUE"
                        value={envValue}
                        onChange={(e) => setEnvValue(e.target.value)}
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={addEnvVariable}
                      >
                        <Plus className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>

                <div>
                  <Label htmlFor="notes">备注</Label>
                  <Textarea
                    id="notes"
                    value={formData.notes}
                    onChange={(e) => handleChange('notes', e.target.value)}
                    placeholder="添加备注信息..."
                    rows={4}
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="schedule" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="scheduled_start">定时启动</Label>
                  <Input
                    id="scheduled_start"
                    type="time"
                    value={formData.scheduled_start}
                    onChange={(e) => handleChange('scheduled_start', e.target.value)}
                  />
                  <p className="text-xs text-gray-500 mt-1">设置每天自动启动的时间</p>
                </div>

                <div>
                  <Label htmlFor="scheduled_stop">定时停止</Label>
                  <Input
                    id="scheduled_stop"
                    type="time"
                    value={formData.scheduled_stop}
                    onChange={(e) => handleChange('scheduled_stop', e.target.value)}
                  />
                  <p className="text-xs text-gray-500 mt-1">设置每天自动停止的时间</p>
                </div>
              </div>

              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-blue-800">
                  💡 提示：定时任务功能需要脚本持续运行才能生效。建议启用后端功能以支持真正的定时调度。
                </p>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>

        <CardFooter className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={onCancel}>
            取消
          </Button>
          <Button type="submit" className="bg-blue-600 hover:bg-blue-700">
            {project ? "保存更改" : "创建任务"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

ProjectForm.propTypes = {
  project: PropTypes.shape({
    name: PropTypes.string,
    description: PropTypes.string,
    group: PropTypes.string,
    category: PropTypes.string,
    working_directory: PropTypes.string,
    start_command: PropTypes.string,
    stop_command: PropTypes.string,
    port: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    environment_variables: PropTypes.object,
    status: PropTypes.string,
    auto_restart: PropTypes.bool,
    max_restarts: PropTypes.number,
    restart_interval: PropTypes.number,
    scheduled_start: PropTypes.string,
    scheduled_stop: PropTypes.string,
    restart_count: PropTypes.number,
    notes: PropTypes.string,
  }),
  existingGroups: PropTypes.arrayOf(PropTypes.string),
  onSave: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
};