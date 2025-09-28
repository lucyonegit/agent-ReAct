import { z } from 'zod';
import { ToolDefinition } from '../../types/index.js';

// RAG查询输入的Zod schema
const RagQueryInputSchema = z.object({
  query: z.string().describe('RAG查询字符串'),
  limit: z.number().optional().default(5).describe('返回结果的最大数量')
});

// RAG查询响应的类型定义
interface RagQueryResponse {
  answer: string;
  sources: Array<{
    content: string;
    metadata: Record<string, any>;
  }>;
}

interface ErrorResponse {
  error?: string;
}

/**
 * RAG查询工具 - 用于执行RAG检索增强生成查询
 */
export const RagQueryTool: ToolDefinition = {
  name: 'rag_query',
  description: '执行RAG检索增强生成查询，从向量数据库中搜索相关文档并生成回答',
  parameters: [
    {
      name: 'query',
      type: 'string',
      description: 'RAG查询字符串',
      required: true,
      schema: z.string()
    },
    {
      name: 'limit',
      type: 'number',
      description: '返回结果的最大数量，默认为5',
      required: false,
      schema: z.number().optional()
    }
  ],
  execute: async (input: any) => {
    try {
      const { query, limit = 5 } = RagQueryInputSchema.parse(input);
      
      // 构建请求体
      const requestBody = {
        query,
        limit
      };

      // 调用RAG查询接口
      const response = await fetch('http://192.168.20.132:3000/query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})) as ErrorResponse;
        throw new Error(`RAG查询失败: ${response.status} ${response.statusText}${errorData.error ? ` - ${errorData.error}` : ''}`);
      }

      const data = await response.json() as RagQueryResponse;
      
      return {
        result: data.answer,
        sources: data.sources,
        formatted: `查询: ${query}\n回答: ${data.answer}\n来源数量: ${data.sources?.length || 0}`
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`RAG查询执行失败: ${error.message}`);
      }
      throw new Error('RAG查询执行失败: 未知错误');
    }
  }
};


