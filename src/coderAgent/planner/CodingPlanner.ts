import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { CODING_AGENT_PROMPTS } from '../config/prompt.js';

export interface PlanStep {
    id: string;
    title: string;
    description: string;
}

export interface CodingPlan {
    summary: string;
    steps: PlanStep[];
}

export class CodingPlanner {
    private llm: BaseChatModel;

    constructor(llm: BaseChatModel) {
        this.llm = llm;
    }

    async createPlan(input: string): Promise<CodingPlan> {
        const prompt = CODING_AGENT_PROMPTS.PLANNER_PROMPT.replace('{input}', input);

        const messages = [
            new SystemMessage(CODING_AGENT_PROMPTS.SYSTEM_PERSONA),
            new HumanMessage(prompt)
        ];

        const response = await this.llm.invoke(messages);
        const content = response.content as string;

        try {
            // Extract JSON from markdown code block if present
            const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/) || content.match(/```\n([\s\S]*?)\n```/);
            const jsonStr = jsonMatch ? jsonMatch[1] : content;

            return JSON.parse(jsonStr);
        } catch (error) {
            console.warn('Failed to parse plan JSON:', error);
            // Fallback plan
            return {
                summary: 'Plan generation failed to parse, proceeding with default plan.',
                steps: [
                    {
                        id: 'step_1',
                        title: 'Implement Feature',
                        description: input
                    }
                ]
            };
        }
    }
}
