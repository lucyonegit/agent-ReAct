import { z } from 'zod';
import { ToolDefinition, ToolDefinitionSchema, ToolResult, ToolResultSchema } from '../types/index';

/**
 * 工具注册表 - 管理所有可用的工具
 */
export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  /**
   * 注册一个新工具
   * @param tool 工具定义
   */
  registerTool(tool: ToolDefinition): void {
    // 使用Zod验证工具定义
    const validatedTool = ToolDefinitionSchema.parse(tool);
    
    if (this.tools.has(validatedTool.name)) {
      throw new Error(`Tool with name "${validatedTool.name}" already exists`);
    }
    
    this.tools.set(validatedTool.name, validatedTool);
    console.log(`Tool "${validatedTool.name}" registered successfully`);
  }

  /**
   * 批量注册工具
   * @param tools 工具定义数组
   */
  registerTools(tools: ToolDefinition[]): void {
    tools.forEach(tool => this.registerTool(tool));
  }

  /**
   * 获取工具
   * @param name 工具名称
   * @returns 工具定义或undefined
   */
  getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * 获取所有工具
   * @returns 所有工具的Map
   */
  getAllTools(): Map<string, ToolDefinition> {
    return new Map(this.tools);
  }

  /**
   * 获取工具列表
   * @returns 工具名称数组
   */
  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * 检查工具是否存在
   * @param name 工具名称
   * @returns 是否存在
   */
  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * 执行工具
   * @param name 工具名称
   * @param input 输入参数
   * @returns 工具执行结果
   */
  async executeTool(name: string, input: any): Promise<ToolResult> {
    try {
      const tool = this.getTool(name);
      if (!tool) {
        return {
          success: false,
          result: null,
          error: `Tool "${name}" not found`
        };
      }

      // 验证输入参数
      const validatedInput = this.validateToolInput(tool, input);
      
      // 执行工具
      const result = await tool.execute(validatedInput);
      
      return ToolResultSchema.parse({
        success: true,
        result: result
      });
    } catch (error) {
      return {
        success: false,
        result: null,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * 验证工具输入参数
   * @param tool 工具定义
   * @param input 输入参数
   * @returns 验证后的输入参数
   */
  private validateToolInput(tool: ToolDefinition, input: any): any {
    // 检查必需参数
    const requiredParams = tool.parameters.filter(param => param.required);
    for (const param of requiredParams) {
      if (!(param.name in input)) {
        throw new Error(`Required parameter "${param.name}" is missing`);
      }
    }

    // 验证参数类型
    const validatedInput: any = {};
    for (const param of tool.parameters) {
      if (param.name in input) {
        const value = input[param.name];
        
        // 如果有自定义schema，使用它验证
        if (param.schema) {
          try {
            validatedInput[param.name] = param.schema.parse(value);
          } catch (error) {
            throw new Error(`Parameter "${param.name}" validation failed: ${error}`);
          }
        } else {
          // 基本类型验证
          validatedInput[param.name] = this.validateBasicType(param.name, value, param.type);
        }
      }
    }

    return validatedInput;
  }

  /**
   * 验证基本类型
   * @param paramName 参数名
   * @param value 值
   * @param expectedType 期望类型
   * @returns 验证后的值
   */
  private validateBasicType(paramName: string, value: any, expectedType: string): any {
    switch (expectedType) {
      case 'string':
        if (typeof value !== 'string') {
          throw new Error(`Parameter "${paramName}" must be a string`);
        }
        return value;
      case 'number':
        if (typeof value !== 'number') {
          throw new Error(`Parameter "${paramName}" must be a number`);
        }
        return value;
      case 'boolean':
        if (typeof value !== 'boolean') {
          throw new Error(`Parameter "${paramName}" must be a boolean`);
        }
        return value;
      case 'object':
        if (typeof value !== 'object' || value === null) {
          throw new Error(`Parameter "${paramName}" must be an object`);
        }
        return value;
      case 'array':
        if (!Array.isArray(value)) {
          throw new Error(`Parameter "${paramName}" must be an array`);
        }
        return value;
      default:
        return value;
    }
  }

  /**
   * 获取工具的描述信息（用于LLM）
   * @returns 工具描述字符串
   */
  getToolsDescription(): string {
    const toolDescriptions = Array.from(this.tools.values()).map(tool => {
      const params = tool.parameters.map(param => {
        const required = param.required ? ' (required)' : ' (optional)';
        return `  - ${param.name}: ${param.type}${required} - ${param.description}`;
      }).join('\n');
      
      return `${tool.name}: ${tool.description}\nParameters:\n${params}`;
    });

    return toolDescriptions.join('\n\n');
  }

  /**
   * 移除工具
   * @param name 工具名称
   * @returns 是否成功移除
   */
  unregisterTool(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * 清空所有工具
   */
  clear(): void {
    this.tools.clear();
  }
}