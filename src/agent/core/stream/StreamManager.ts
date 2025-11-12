import { EventEmitter } from 'events';

export interface StreamEvent {
  sessionId: string;
  conversationId: string;
  event: {
    id: string;
    role: string;
    type: string;
    [key: string]: any;
  };
  timestamp: number;
}

/**
 * 流式输出管理器
 */
export class StreamManager extends EventEmitter {
  private isStreaming = false;
  private readonly eventBuffer: StreamEvent[] = [];

  constructor(private readonly maxBufferSize = 100) {
    super();
  }

  startStream(): void {
    this.isStreaming = true;
    this.eventBuffer.length = 0;
    this.emit('stream_start');
  }

  endStream(): void {
    this.isStreaming = false;
    this.emit('stream_end');
  }

  emitStreamEvent(event: StreamEvent): void {
    this.eventBuffer.push(event);
    this.emit('stream_event', event);

    if (this.eventBuffer.length > this.maxBufferSize) {
      this.eventBuffer.shift();
    }
  }

  get buffer(): readonly StreamEvent[] {
    return this.eventBuffer;
  }

  get streaming(): boolean {
    return this.isStreaming;
  }

  clearBuffer(): void {
    this.eventBuffer.length = 0;
  }
}

/**
 * 流式输出装饰器
 */
export function withStreaming<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  streamManager: StreamManager
): T {
  return (async (...args: any[]) => {
    streamManager.startStream();
    try {
      return await fn(...args);
    } finally {
      streamManager.endStream();
    }
  }) as T;
}

/**
 * 创建控制台流式输出处理器
 */
export function createConsoleStreamHandler(prefix = '[STREAM]'): (event: StreamEvent) => void {
  const typeColors: Record<string, string> = {
    normal_event: '\x1b[36m',
    task_plan_event: '\x1b[33m',
    tool_call_event: '\x1b[32m',
    error: '\x1b[31m'
  };

  return (event: StreamEvent) => {
    const timestamp = new Date(event.timestamp).toISOString();
    const color = typeColors[event.event.type] || '\x1b[37m';
    console.log(`${prefix} ${timestamp} ${color}[${event.event.type.toUpperCase()}]\x1b[0m`, event.event);
  };
}