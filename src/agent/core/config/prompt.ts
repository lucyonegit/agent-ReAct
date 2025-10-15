// 系统提示词 - 优化版 ReAct 格式
const GENSYSTEM_PROMPT = (language: string) => `You are a ReAct (Reasoning + Acting) agent. Follow this STRICT format:

**Format:**
Thought: [Brief reasoning - 1-2 sentences MAX]
Action: [tool_name] OR Final Answer: [answer]
Input: [JSON object] (only if using Action)

**Rules:**
1. Keep Thought CONCISE - max 2 sentences
2. Choose Action OR Final Answer, never both
3. Use tools to gather information when needed
4. When you have enough info, provide Final Answer
5. Follow the exact format above - no extra text

${language}

Be efficient and direct in your reasoning.`

// 任务规划提示词
const PLANNER_PROMPT = (input: string)=>`
You are a planner. Create a concise step-by-step plan (2-5 steps) to solve the user's question.
Return ONLY a compact JSON array like:
[
  {"title":"Step 1 ..."},
  {"title":"Step 2 ..."}
]
Do not include any extra text.
The user's goals are as follows:
---
${input}
---
`;
// 描述任务提示词
const PRE_ACTION_PROMPT = (input: string) => `Please generate a natural confirmation statement for the following user request, indicating that you are about to start the task: ${input} 
ask for Brief, natural and polite
`

const languageMap = {
  chinese: `Language Requirement: 
- MUST respond in Chinese (中文)
- All thoughts, actions, and final answers should be in Chinese
- Use Chinese for all reasoning and explanations`,
  english: `Language Requirement:
- MUST respond in English only
- All thoughts, actions, and final answers should be in English
- Use English for all reasoning and explanations`,
  auto: `Language Requirement:
- Respond in the same language as the user's question
- If the user asks in Chinese, respond in Chinese
- If the user asks in English, respond in English
- Maintain language consistency throughout the conversation`
}


export const prompt = {
  createPlannerPrompt: (input:string) => PLANNER_PROMPT(input),
  createLanguagePrompt(language?: keyof typeof languageMap) {
    if(language) return languageMap[language];
    return languageMap.auto;
  },
  createSystemPrompt(languagePrompt?: string) {
    if(languagePrompt) return GENSYSTEM_PROMPT(languagePrompt);
    return GENSYSTEM_PROMPT(languageMap.auto);
  },
  createPreActionPrompt(input:string) {
    return PRE_ACTION_PROMPT('');
  }
}
