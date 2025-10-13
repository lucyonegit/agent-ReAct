import { EventEmitter } from 'events';
import { StreamEvent } from '../types/index.js';

/**
 * 流式输出管理器
 * 负责管理和分发流式事件，支持内容聚合
 */
export class StreamManager extends EventEmitter {
  private isStreaming: boolean = false;
  private eventBuffer: StreamEvent[] = [];
  private maxBufferSize: number = 100;
  
  // 增量显示状态管理 - 统一管理内容聚合和增量显示
  private incrementalState: Map<string, {
    currentContent: string;
    lastDisplayedLength: number;
  }> = new Map();

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
    this.incrementalState.clear(); // 清理增量显示状态
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
   * 发送流式事件并进行内容聚合
   * @param event 流式事件
   */
  emitStreamEvent(event: StreamEvent): void {
    // 对于chunk类型的事件，进行内容聚合和增量显示处理
    if (event.type.endsWith('_chunk')) {
      const incrementalKey = `${event.conversationId}_${event.type}`;
      
      // 更新增量显示状态
      const incrementalState = this.incrementalState.get(incrementalKey) || {
        currentContent: '',
        lastDisplayedLength: 0
      };
      
      incrementalState.currentContent += event.data;
      this.incrementalState.set(incrementalKey, incrementalState);
      
      // 创建聚合后的事件，发送完整的聚合内容
      const aggregatedEvent: StreamEvent = {
        ...event,
        data: incrementalState.currentContent // 发送聚合后的完整内容
      };
      
      // 添加到缓冲区
      this.eventBuffer.push(aggregatedEvent);
      
      // 发送聚合后的事件
      this.emit('stream_event', aggregatedEvent);
    } else {
      // 非chunk事件直接处理
      this.eventBuffer.push(event);
      this.emit('stream_event', event);
      
      // 如果是完成事件，清理对应的增量状态
      if (event.type === 'thought' || event.type === 'final_answer') {
        const incrementalKey = `${event.conversationId}_${event.type}_chunk`;
        this.incrementalState.delete(incrementalKey);
      }
    }
    
    // 如果缓冲区超过最大大小，移除最旧的事件
    if (this.eventBuffer.length > this.maxBufferSize) {
      this.eventBuffer.shift();
    }
  }
    
  /**
   * 获取增量显示的新内容
   * @param conversationId 对话ID
   * @param eventType 事件类型 (如 'thought_chunk', 'final_answer_chunk')
   * @returns 新增的内容
   */
  getIncrementalContent(conversationId: string, eventType: string): string {
    const incrementalKey = `${conversationId}_${eventType}`;
    const state = this.incrementalState.get(incrementalKey);
    
    if (!state) {
      return '';
    }
    
    const newContent = state.currentContent.slice(state.lastDisplayedLength);
    state.lastDisplayedLength = state.currentContent.length;
    this.incrementalState.set(incrementalKey, state);
    
    return newContent;
  }

  /**
   * 获取当前累积的内容
   * @param conversationId 对话ID
   * @param eventType 事件类型 (如 'thought_chunk', 'final_answer_chunk')
   * @returns 当前累积的完整内容
   */
  getCurrentContent(conversationId: string, eventType: string): string {
    const incrementalKey = `${conversationId}_${eventType}`;
    const state = this.incrementalState.get(incrementalKey);
    return state ? state.currentContent : '';
  }

  /**
   * 重置增量显示状态
   * @param conversationId 对话ID
   * @param eventType 事件类型 (如 'thought_chunk', 'final_answer_chunk')
   */
  resetIncrementalState(conversationId: string, eventType: string): void {
    const incrementalKey = `${conversationId}_${eventType}`;
    this.incrementalState.delete(incrementalKey);
  }

  /**
   * 创建流式事件
   * @param type 事件类型
   * @param data 事件数据
   * @returns 流式事件
   */
  createStreamEvent(type: StreamEvent['type'], data: any, conversationId: string, eventId: string): StreamEvent {
    return {
      type,
      data,
      timestamp: Date.now(),
      conversationId,
      eventId
    };
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
    eventType: StreamEvent['type'] | 'stream_start' | 'stream_end' | 'stream_event',
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
    eventType: StreamEvent['type'] | 'stream_start' | 'stream_end' | 'stream_event',
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
      eventsByType[event.type] = (eventsByType[event.type] || 0) + 1;
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
      streamManager.emitStreamEvent(
        streamManager.createStreamEvent('error', {
          message: error instanceof Error ? error.message : 'Unknown error',
          error
        }, 'system', `error_${Date.now()}`)
      );
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
    const typeColor = getTypeColor(event.type);
    
    console.log(`${prefix} ${timestamp} ${typeColor}[${event.type.toUpperCase()}]\\x1b[0m`, event.data);
  };
}

/**
 * 获取事件类型对应的颜色代码
 * @param type 事件类型
 * @returns ANSI颜色代码
 */
function getTypeColor(type: StreamEvent['type']): string {
  const colors: Record<StreamEvent['type'], string> = {
    thought: '\\x1b[36m', // 青色
    action: '\\x1b[33m', // 黄色
    observation: '\\x1b[32m', // 绿色
    final_answer: '\\x1b[35m', // 紫色
    error: '\\x1b[31m' // 红色
    ,
    thought_chunk: '',
    final_answer_chunk: ''
  };
  
  return colors[type] || '\\x1b[37m'; // 默认白色
}