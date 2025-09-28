import { ReActAgent } from '../src/index.js';
import { ExampleTools } from '../src/tools/examples/index.js';
import dotenv from 'dotenv';

// ANSI 颜色代码
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m'
};

// 颜色化输出函数
const colorize = (text: string, color: string) => `${color}${text}${colors.reset}`;
const highlight = (text: string, bgColor: string, textColor: string = colors.white) => 
  `${bgColor}${textColor}${colors.bright} ${text} ${colors.reset}`;

// 加载环境变量
dotenv.config();


async function basicQwenUsage() {
  console.log(highlight('=== 基础千问模型使用 ===', colors.bgBlue));
  
  // 创建使用千问模型的Agent
  const agent = new ReActAgent({
    model: 'qwen-max',  // 使用千问Plus模型
    temperature: 0.7,
    maxTokens: 2000,
    streamOutput: false,
  });

  // 注册示例工具
  agent.getToolRegistry().registerTools(ExampleTools);

  try {
    const result = await agent.run('帮我计算 15 * 23 的结果');
    console.log(colorize('结果:', colors.green), result);
  } catch (error) {
    console.error(colorize('错误:', colors.red), error);
  }
}

async function streamingQwenUsage() {
  console.log(highlight('基础千问模型使用', colors.bgBlue));
  
  const agent = new ReActAgent({
    model: 'qwen-plus',  // 使用千问Turbo模型（更快）
    temperature: 0.8,
    streamOutput: true,
    language: 'chinese',
  });

  agent.getToolRegistry().registerTools(ExampleTools);

  try {
    const result = await agent.run(
      '帮我基于React写一个Button组件',
      (event) => {
        const conversationId = event.conversationId;
        const streamManager = agent.getStreamManager();
        
        switch (event.type) {
          case 'thought_chunk':
            // 使用StreamManager获取增量内容
            const newThoughtContent = streamManager.getIncrementalContent(conversationId, 'thought_chunk');
            if (newThoughtContent) {
              process.stdout.write(newThoughtContent);
            }
            break;
          case 'thought':
              console.log(highlight('\n[思考完成]', colors.bgGreen));
              break;
          case 'action':
            console.log(highlight(`[执行动作]`, colors.bgYellow, colors.red), colorize(JSON.stringify(event.data), colors.cyan));
            break;
          case 'observation':
            console.log(highlight(`[观察结果]`, colors.bgCyan, colors.red), colorize(JSON.stringify(event.data), colors.yellow), '\n');
            break;
          case 'final_answer_chunk':
              // 使用StreamManager获取增量内容
              const newFinalContent = streamManager.getIncrementalContent(conversationId, 'final_answer_chunk');
              if (newFinalContent) {
                process.stdout.write(newFinalContent);
              }
              break;
            case 'final_answer':
              console.log(highlight('\n[最终答案完成]', colors.bgGreen));
              break;
          case 'error':
            console.log(highlight(`[错误]`, colors.bgRed), colorize(event.data, colors.red));
            break;
          default:
            console.log(colorize(`[${event.type}]:`, colors.dim), event.data);
        }
      }
    );

    // 流式输出已经显示了完整的结果，不需要再次输出result
    console.log(highlight('\n执行完成!', colors.bgBlue));
  } catch (error) {
    console.error(colorize('错误:', colors.red), error);
  }
}

streamingQwenUsage();
// basicQwenUsage();