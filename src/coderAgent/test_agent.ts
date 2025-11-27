import { CodingAgent } from './index.js';
import { AgentConfig } from '../agent/types/index.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Try to load .env from project root (agent/.env)
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function main() {
    const config: AgentConfig = {
        model: 'qwen-max', // Or 'gpt-4'
        temperature: 0,
        maxTokens: 2000,
        language: 'chinese',
        maxIterations: 10,
        streamOutput: true,
        pauseAfterEachStep: false,
        autoPlanOnStart: false,
        strictActionUntilDone: true
    };

    const agent = new CodingAgent(config);

    const input = "创建一个登录表单，包含用户名和密码输入框，以及一个登录按钮。使用内部组件库。";

    console.log('🚀 Starting Coding Agent Test...');
    console.log(`📝 Input: ${input}\n`);

    try {
        const result = await agent.run(input, {
            onStream: (event) => {
                const e: any = event.event;
                if (e?.type === 'normal_event') {
                    console.log(`[${e.id}] ${e.content}`);
                } else if (e?.type === 'task_plan_event') {
                    console.log(`[plan] steps: ${e.data.step.length}`);
                } else if (e?.type === 'tool_call_event') {
                    console.log(`[tool] ${e.data.tool_name} ${e.data.status}`);
                }
            }
        });

        console.log('\n✅ Final Answer (Generated Code):');
        console.log('-----------------------------------');
        console.log(result.finalAnswer);
        console.log('-----------------------------------');

    } catch (error) {
        console.error('❌ Test Failed:', error);
    }
}

main().catch(console.error);
