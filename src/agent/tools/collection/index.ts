// 导出工具数组，方便批量注册
import { RagQueryTool } from './RagTool.js';
import { FileSystemTools } from './fileSystem.js';

export const ExampleTools = [
  RagQueryTool,
  ...FileSystemTools
];