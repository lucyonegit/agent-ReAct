import express, { type Request, type Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { ReActAgent } from '../agent/index.js';
import type { StreamEvent } from '../agent/types/index.js';

dotenv.config();

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 3333;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

/**
 * SSE headers helper
 */
function initSSE(res: Response) {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // for nginx
  res.flushHeaders?.();
}

/**
 * Send SSE event
 */
function sendSSE(res: Response, event: string, data: any) {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  res.write(`event: ${event}\n`);
  res.write(`data: ${payload}\n\n`);
}

/**
 * Health check
 */
app.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true });
});

/**
 * SSE endpoint
 * GET /api/agent/stream?prompt=...&language=chinese|english&model=...&sessionId=...&conversationId=...&pauseAfterEachStep=true
 */
type LanguageOption = 'chinese' | 'english' | 'auto';

app.get('/api/agent/stream', async (req: Request, res: Response) => {
  const prompt = (req.query.prompt as string) || '';
  const language = ((req.query.language as string) || 'chinese') as LanguageOption;
  const model = (req.query.model as string) || 'qwen-plus';
  const temperature = req.query.temperature !== undefined ? Number(req.query.temperature) : 0.7;
  const sessionId = (req.query.sessionId as string) || undefined; // 支持传入 sessionId 继续会话
  const conversationId = (req.query.conversationId as string) || undefined; // 支持传入 conversationId 恢复暂停的对话
  const pauseAfterEachStep = req.query.pauseAfterEachStep === 'true'; // 是否在每步后暂停

  if (!prompt) {
    res.status(400).json({ error: 'prompt is required' });
    return;
  }

  initSSE(res);

  // 初始化 Agent（开启流式输出）
  const agent = new ReActAgent({
    model,
    temperature,
    streamOutput: true,
    language,
    pauseAfterEachStep  // 传递暂停配置
  });

  // 注册示例工具（若存在）
  try {
    // 动态 import，避免因缺少示例工具导致的构建失败
    const { ExampleTools } = await import('../agent/tools/collection/index.js');
    agent.getToolRegistry().registerTools(ExampleTools);
  } catch {
    // 忽略，无工具也可运行
  }

  // 监听客户端断开
  req.on('close', () => {
    try {
      res.end();
    } catch { }
  });

  // 将 Agent 的流式事件转发为 SSE
  const onStream = (event: StreamEvent) => {
    // 发送新的 StreamEvent 格式
    sendSSE(res, 'stream_event', event);
  };

  try {
    // 使用 runWithSession 支持多轮对话和暂停/恢复
    const result = await agent.runWithSession(prompt, { sessionId, conversationId, onStream });

    // 发送结束信号，带上 sessionId、conversationId 和 isPaused 状态
    sendSSE(res, 'done', {
      ok: true,
      sessionId: result.sessionId,
      conversationId: result.conversationId,
      isPaused: result.isPaused,  // 告诉前端是否处于暂停状态
      message: result.isPaused ? '等待用户输入...' : '对话完成'
    });
    res.end();
  } catch (err: any) {
    // 发送错误事件
    const errorEvent: StreamEvent = {
      sessionId: sessionId || 'error',
      conversationId: 'error',
      event: {
        id: `error_${Date.now()}`,
        role: 'assistant',
        type: 'normal_event',
        content: err?.message || 'unknown error'
      },
      timestamp: Date.now()
    };
    sendSSE(res, 'stream_event', errorEvent);
    sendSSE(res, 'done', { ok: false });
    res.end();
  }
});

/**
 * Coding Agent SSE endpoint
 * GET /api/coding-agent/stream?prompt=...&model=...
 */
import { CodingAgent } from '../coderAgent/index.js';

app.get('/api/coding-agent/stream', async (req: Request, res: Response) => {
  const prompt = (req.query.prompt as string) || '';
  const model = (req.query.model as string) || 'qwen-plus';
  const temperature = req.query.temperature !== undefined ? Number(req.query.temperature) : 0;
  const sessionId = (req.query.sessionId as string) || undefined;
  const conversationId = (req.query.conversationId as string) || undefined;

  if (!prompt) {
    res.status(400).json({ error: 'prompt is required' });
    return;
  }

  initSSE(res);

  const agent = new CodingAgent({
    model,
    temperature,
    streamOutput: true,
    language: 'chinese', // Default to Chinese for now
    maxTokens: 4000,
    maxIterations: 10,
    pauseAfterEachStep: false,
    autoPlanOnStart: false,
    strictActionUntilDone: true
  });

  req.on('close', () => {
    try {
      res.end();
    } catch { }
  });

  const onStream = (event: StreamEvent) => {
    sendSSE(res, 'stream_event', event);
  };

  try {
    const result = await agent.run(prompt, { sessionId, conversationId, onStream });

    sendSSE(res, 'done', {
      ok: true,
      result: result.finalAnswer
    });
    res.end();
  } catch (err: any) {
    const errorEvent: StreamEvent = {
      sessionId: sessionId || 'error',
      conversationId: 'error',
      event: {
        id: `error_${Date.now()}`,
        role: 'assistant',
        type: 'normal_event',
        content: err?.message || 'unknown error'
      },
      timestamp: Date.now()
    };
    sendSSE(res, 'stream_event', errorEvent);
    sendSSE(res, 'done', { ok: false });
    res.end();
  }
});

app.listen(port, () => {
  console.log(`\n✅ SSE Server started successfully!`);
  console.log(`\n🌐 Server URL: http://localhost:${port}`);
  console.log(`\n📡 API Endpoints:`);
  console.log(`   - Health Check: http://localhost:${port}/health`);
  console.log(`   - Agent Stream: http://localhost:${port}/api/agent/stream?prompt=<your_question>`);
  console.log(`\n📝 Example:`);
  console.log(`   http://localhost:${port}/api/agent/stream?prompt=你好&language=chinese`);
  console.log(`\n⏳ Waiting for requests...\n`);
});