
const GENSYSTEM_PROMPT = (language: string, toolsDescription?: string) => `你是一个基于 ReAct（推理 + 执行动作）架构的智能体。严格遵守以下输出格式：

格式：
Thought: [简短推理，最多 1-2 句]
Action: [tool_name] 或 Final Answer: [answer]
Input: [JSON 对象，仅当执行 Action 时填写]

规则：
1. Thought 必须简洁
2. 只能二选一：Action 或 Final Answer
3. 需要信息时使用工具；完成当前计划步骤后再继续下一步
4. 在所有计划步骤完成后再输出 Final Answer
5. 严格按照上述格式输出，不要添加多余文本

${language}

${toolsDescription ? toolsDescription : ''}

注意：区块标签必须使用以下英文单词并保持一致："Thought", "Action", "Input", "Final Answer"。`

const PLANNER_PROMPT = (input: string)=>`
你是规划器。请为下面的需求创建一个精炼的执行计划（2-5 步）。
只返回一个紧凑的 JSON 数组，如：
[
  {"title":"步骤 1 ..."},
  {"title":"步骤 2 ..."}
]
不要包含任何额外文本。
用户目标如下：
---
${input}
---
`;

const PLANNER_PROMPT_WITH_TOOL = (input: string)=>`
你是规划器。请为下面的需求创建一个精炼的执行计划（2-5 步），在必要时可以使用工具获取信息。
用户目标如下：
---
${input}
---
`;

const PRE_ACTION_PROMPT = (input: string) => `请针对以下用户请求生成一段自然的确认语，说明你将开始执行任务：${input}
要求：简短、自然、礼貌。`

const languageMap = {
  chinese: `语言要求：
  - 所有内容均使用中文
  - 区块标签必须使用英文并保持一致：Thought / Action / Input / Final Answer`,
  english: `语言要求：
  - 所有内容均使用中文
  - 区块标签必须使用英文并保持一致：Thought / Action / Input / Final Answer`,
  auto: `语言要求：
  - 所有内容均使用中文
  - 区块标签必须使用英文并保持一致：Thought / Action / Input / Final Answer`
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
