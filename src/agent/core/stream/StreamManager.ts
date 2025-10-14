import { EventEmitter } from 'events';
import { StreamEvent } from '../types/index.js';

/**
 * 流式输出管理器
 * 负责管理和分发流式事件，支持新的对话结构
 */
export class StreamManager extends EventEmitter {
  private isStreaming: boolean = false;
  private eventBuffer: StreamEvent[] = [];
  private maxBufferSize: number = 100;
  
  constructor(maxBufferSize: number = 100) {
    super();
    this.maxBufferSize = maxBufferSize;
  }

  /**
   * 开始流式输出
   */
  startStream(): void {
    this.isStreaming = true;
    this.eventBuffer = [];
    this.emit('stream_start');
  }

  /**
   * 结束流式输出
   */
  endStream(): void {
    this.isStreaming = false;
    this.emit('stream_end');
  }

  /**
   * 发送流式事件
   * @param event 流式事件
   */
  emitStreamEvent(event: StreamEvent): void {
    // 添加到缓冲区
    this.eventBuffer.push(event);
    
    // 发送事件
    this.emit('stream_event', event);
    
    // 如果缓冲区超过最大大小，移除最旧的事件
    if (this.eventBuffer.length > this.maxBufferSize) {
      this.eventBuffer.shift();
    }
  }
  /**
   * 获取事件缓冲区
   * @returns 事件数组
   */
  getEventBuffer(): StreamEvent[] {
    return [...this.eventBuffer];
  }

  /**
   * 清空事件缓冲区
   */
  clearBuffer(): void {
    this.eventBuffer = [];
  }

  /**
   * 检查是否正在流式输出
   * @returns 是否正在流式输出
   */
  getIsStreaming(): boolean {
    return this.isStreaming;
  }

  /**
   * 创建流式输出处理器
   * @returns 流式输出处理函数
   */
  createStreamHandler(): (event: StreamEvent) => void {
    return (event: StreamEvent) => {
      this.emitStreamEvent(event);
    };
  }

  /**
   * 监听特定类型的事件
   * @param eventType 事件类型
   * @param callback 回调函数
   */
  onStreamEvent(
    eventType: 'stream_start' | 'stream_end' | 'stream_event',
    callback: (data?: any) => void
  ): void {
    this.on(eventType, callback);
  }

  /**
   * 移除事件监听器
   * @param eventType 事件类型
   * @param callback 回调函数
   */
  offStreamEvent(
    eventType: 'stream_start' | 'stream_end' | 'stream_event',
    callback: (data?: any) => void
  ): void {
    this.off(eventType, callback);
  }

  /**
   * 获取事件统计信息
   * @returns 事件统计
   */
  getEventStats(): {
    totalEvents: number;
    eventsByType: Record<string, number>;
    bufferSize: number;
    isStreaming: boolean;
  } {
    const eventsByType: Record<string, number> = {};
    
    for (const event of this.eventBuffer) {
      const eventType = event.event.type;
      eventsByType[eventType] = (eventsByType[eventType] || 0) + 1;
    }

    return {
      totalEvents: this.eventBuffer.length,
      eventsByType,
      bufferSize: this.eventBuffer.length,
      isStreaming: this.isStreaming
    };
  }
}

/**
 * 流式输出装饰器
 * 用于包装函数以支持流式输出
 */
export function withStreaming<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  streamManager: StreamManager
): T {
  return (async (...args: any[]) => {
    streamManager.startStream();
    
    try {
      const result = await fn(...args);
      streamManager.endStream();
      return result;
    } catch (error) {
      // 创建错误事件
      const errorEvent: StreamEvent = {
        sessionId: 'system',
        conversationId: 'system',
        event: {
          id: `error_${Date.now()}`,
          role: 'assistant',
          type: 'normal_event',
          content: error instanceof Error ? error.message : 'Unknown error'
        },
        timestamp: Date.now()
      };
      streamManager.emitStreamEvent(errorEvent);
      streamManager.endStream();
      throw error;
    }
  }) as T;
}

/**
 * 创建控制台流式输出处理器
 * @param prefix 输出前缀
 * @returns 流式输出处理函数
 */
export function createConsoleStreamHandler(prefix: string = '[STREAM]'): (event: StreamEvent) => void {
  return (event: StreamEvent) => {
    const timestamp = new Date(event.timestamp).toISOString();
    const eventType = event.event.type;
    const typeColor = getTypeColor(eventType);
    
    console.log(`${prefix} ${timestamp} ${typeColor}[${eventType.toUpperCase()}]\x1b[0m`, event.event);
  };
}

/**
 * 获取事件类型对应的颜色代码
 * @param type 事件类型
 * @returns ANSI颜色代码
 */
function getTypeColor(type: string): string {
  const colors: Record<string, string> = {
    normal_event: '\x1b[36m', // 青色
    task_plan_event: '\x1b[33m', // 黄色
    tool_call_event: '\x1b[32m', // 绿色
    error: '\x1b[31m' // 红色
  };
  
  return colors[type] || '\x1b[37m'; // 默认白色
}