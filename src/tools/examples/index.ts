// 导出所有示例工具
export { CalculatorTool } from './CalculatorTool.js';
export { WeatherTool } from './WeatherTool.js';
export { SearchTool } from './SearchTool.js';

// 导出工具数组，方便批量注册
import { CalculatorTool } from './CalculatorTool.js';
import { WeatherTool } from './WeatherTool.js';
import { SearchTool } from './SearchTool.js';
import { RagQueryTool } from './RagTool.js';

export const ExampleTools = [
  CalculatorTool,
  WeatherTool,
  SearchTool,
  RagQueryTool
];

// 工具描述信息
export const ToolDescriptions = {
  calculator: 'Performs mathematical calculations with support for basic arithmetic operations',
  weather: 'Gets current weather information for any location (mock implementation)',
  search: 'Searches the internet for information on any topic (mock implementation)',
  rag_query: 'Executes RAG retrieval-augmented generation queries, searching a vector database for relevant documents and generating answers'
};