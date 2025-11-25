// 导出工具数组，方便批量注册
import { RagQueryTool,RagQueryAvailableComponents } from './RagTool.js';
import { FileSystemTools } from './fileSystem.js';

export const ExampleTools = [
  RagQueryTool,
  RagQueryAvailableComponents,
  ...FileSystemTools
];
