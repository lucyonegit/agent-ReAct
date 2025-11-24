
// 系统提示词 - 优化版 ReAct 格式
const GENSYSTEM_PROMPT = (language: string, toolsDescription?: string) => `You are a ReAct (Reasoning + Acting) agent. Follow this STRICT format:

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

${toolsDescription ? toolsDescription : ''}

Use the following English section labels EXACTLY as written: "Thought", "Action", "Input", "Final Answer".

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

// 任务规划提示词
const PLANNER_PROMPT_WITH_TOOL = (input: string)=>`
You are a planner. Create a concise step-by-step plan (2-5 steps) to solve the user's question. you can use some tools to gather information.
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
  - Write all content in Chinese (中文)
  - Keep the section labels in English EXACTLY: Thought / Action / Input / Final Answer
  - Use Chinese for all reasoning, tool inputs (values), and the final answer`,
  english: `Language Requirement:
  - Write all content in English
  - Keep the section labels in English EXACTLY: Thought / Action / Input / Final Answer
  - Use English for all reasoning, tool inputs (values), and the final answer`,
  auto: `Language Requirement:
  - Respond in the same language as the user's question (Chinese or English)
  - Keep the section labels in English EXACTLY: Thought / Action / Input / Final Answer
  - Maintain language consistency for content throughout the conversation`
}


export const prompt = {
  createPlannerPrompt: (input:string) => PLANNER_PROMPT(input),
  createLanguagePrompt(language?: keyof typeof languageMap) {
    if(language) return languageMap[language];
    return languageMap.auto;
  },
  createSystemPrompt(languagePrompt?: string, toolsDescription?: string) {
    const base = languagePrompt ? GENSYSTEM_PROMPT(languagePrompt) : GENSYSTEM_PROMPT(languageMap.auto);
    if (toolsDescription && toolsDescription.trim()) {
      return `${base}\n\nAvailable tools:\n${toolsDescription}\nUse tools when needed. If using a tool, output Action and Input.`;
    }
    return base;
  },
  createPreActionPrompt(input:string) {
    return PRE_ACTION_PROMPT(input);
  },
  createPlannerPromptWithTool: (input:string) => PLANNER_PROMPT_WITH_TOOL(input)
}
