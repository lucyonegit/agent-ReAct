import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { CODING_AGENT_PROMPTS } from '../config/prompt.js';

export class BDDDecomposer {
    private llm: BaseChatModel;

    constructor(llm: BaseChatModel) {
        this.llm = llm;
    }

    async decompose(requirement: string): Promise<any[]> {
        const prompt = CODING_AGENT_PROMPTS.BDD_DECOMPOSER_PROMPT.replace('{requirement}', requirement);

        const messages = [
            new SystemMessage(CODING_AGENT_PROMPTS.SYSTEM_PERSONA),
            new HumanMessage(prompt)
        ];

        const response = await this.llm.invoke(messages);
        const content = response.content as string;
        try {
            const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/) || content.match(/```\n([\s\S]*?)\n```/);
            const jsonStr = jsonMatch ? jsonMatch[1] : content;
            const arr = JSON.parse(jsonStr);
            return Array.isArray(arr) ? arr : [];
        } catch {
            return [
                {
                    id: 'scenario_1',
                    title: 'Fallback scenario',
                    given: ['User opens the page'],
                    when: ['User interacts with the component'],
                    then: ['Expected UI updates occur']
                }
            ];
        }
    }
}
