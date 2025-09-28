import { z } from 'zod';
import { ToolDefinition } from '../../types/index.js';

// 计算器操作的Zod schema
const CalculatorInputSchema = z.object({
  expression: z.string().describe('Mathematical expression to evaluate (e.g., "2 + 3 * 4")')
});

/**
 * 计算器工具 - 用于执行数学计算
 */
export const CalculatorTool: ToolDefinition = {
  name: 'calculator',
  description: 'Performs mathematical calculations. Supports basic arithmetic operations (+, -, *, /), parentheses, and common mathematical functions.',
  parameters: [
    {
      name: 'expression',
      type: 'string',
      description: 'Mathematical expression to evaluate (e.g., "2 + 3 * 4", "(10 + 5) / 3")',
      required: true,
      schema: z.string().min(1)
    }
  ],
  execute: async (input: any) => {
    try {
      const { expression } = CalculatorInputSchema.parse(input);
      
      // 安全的数学表达式求值
      const result = evaluateMathExpression(expression);
      
      return {
        expression,
        result,
        formatted: `${expression} = ${result}`
      };
    } catch (error) {
      throw new Error(`Calculator error: ${error instanceof Error ? error.message : 'Invalid expression'}`);
    }
  }
};

/**
 * 安全的数学表达式求值函数
 * 只允许基本的数学操作，防止代码注入
 */
function evaluateMathExpression(expression: string): number {
  // 移除空格
  const cleanExpression = expression.replace(/\\s+/g, '');
  
  // 验证表达式只包含允许的字符
  const allowedChars = /^[0-9+\-*/.()\\s]+$/;
  if (!allowedChars.test(cleanExpression)) {
    throw new Error('Invalid characters in expression. Only numbers, +, -, *, /, (, ) are allowed.');
  }
  
  // 检查括号匹配
  if (!isValidParentheses(cleanExpression)) {
    throw new Error('Mismatched parentheses in expression.');
  }
  
  try {
    // 使用Function构造器安全求值
    const result = Function(`"use strict"; return (${cleanExpression})`)();
    
    if (typeof result !== 'number' || !isFinite(result)) {
      throw new Error('Expression did not evaluate to a valid number.');
    }
    
    return Math.round(result * 1000000) / 1000000; // 保留6位小数精度
  } catch (error) {
    throw new Error('Failed to evaluate mathematical expression.');
  }
}

/**
 * 检查括号是否匹配
 */
function isValidParentheses(expression: string): boolean {
  let count = 0;
  for (const char of expression) {
    if (char === '(') count++;
    if (char === ')') count--;
    if (count < 0) return false;
  }
  return count === 0;
}