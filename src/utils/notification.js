/**
 * 统一消息通知系统
 *
 * 用于在应用程序中显示各种类型的通知消息
 * 所有消息默认在右上角显示 3 秒后自动消失
 *
 * 使用示例：
 * import { showSuccess, showError, showInfo, MESSAGES } from '@/utils/notification';
 *
 * showSuccess(MESSAGES.TASK_CREATED);
 * showError('操作失败', error.message);
 */

import { toast } from '@/components/ui/use-toast';

/**
 * 显示成功消息
 * @param {string} title - 消息标题
 * @param {string} description - 消息描述（可选）
 * @param {number} duration - 显示时长（毫秒），默认 3000ms
 */
export const showSuccess = (title, description = '', duration = 3000) => {
  toast({
    title,
    description,
    duration,
    variant: 'default',
  });
};

/**
 * 显示错误消息
 * @param {string} title - 消息标题
 * @param {string} description - 消息描述（可选）
 * @param {number} duration - 显示时长（毫秒），默认 3000ms
 */
export const showError = (title, description = '', duration = 3000) => {
  toast({
    title,
    description,
    duration,
    variant: 'destructive',
  });
};

/**
 * 显示信息消息
 * @param {string} title - 消息标题
 * @param {string} description - 消息描述（可选）
 * @param {number} duration - 显示时长（毫秒），默认 3000ms
 */
export const showInfo = (title, description = '', duration = 3000) => {
  toast({
    title,
    description,
    duration,
  });
};

/**
 * 预定义的消息常量
 * 便于统一管理和维护常用消息文本
 */
export const MESSAGES = {
  // 任务创建
  TASK_CREATED: '任务创建成功',
  TASK_CREATE_ERROR: '创建任务失败',

  // 任务更新
  TASK_UPDATED: '任务更新成功',
  TASK_UPDATE_ERROR: '更新任务失败',

  // 任务删除
  TASK_DELETED: '任务已删除',
  TASK_DELETE_ERROR: '删除任务失败',

  // 任务启动
  START_SUCCESS: '任务启动成功',
  START_ERROR: '启动失败',
  START_PENDING: '任务正在启动...',

  // 任务停止
  STOP_SUCCESS: '任务已停止',
  STOP_ERROR: '停止失败',

  // 任务重启
  RESTART_SUCCESS: '任务重启成功',
  RESTART_ERROR: '重启失败',

  // 端口检测
  PORT_CHECK_SUCCESS: '端口检测成功',
  PORT_CHECK_ERROR: '端口检测失败',

  // 系统消息
  LOADING: '加载中...',
  LOADING_ERROR: '加载失败',
  NETWORK_ERROR: '网络错误，请检查连接',
  UNKNOWN_ERROR: '发生未知错误',
};
