import { z } from 'zod';
import { promises as fs } from 'fs';
import { join, dirname, basename, extname } from 'path';
import { ToolDefinition } from '../../types/index.js';

// ============= 文件读取工具 =============
const ReadFileInputSchema = z.object({
  filePath: z.string().describe('要读取的文件路径'),
  encoding: z.enum(['utf-8', 'ascii', 'base64', 'hex']).optional().default('utf-8').describe('文件编码格式')
});

export const ReadFileTool: ToolDefinition = {
  name: 'read_file',
  description: '读取文件内容，支持多种编码格式',
  parameters: [
    {
      name: 'filePath',
      type: 'string',
      description: '要读取的文件路径（相对路径或绝对路径）',
      required: true,
      schema: z.string()
    },
    {
      name: 'encoding',
      type: 'string',
      description: '文件编码格式，默认为utf-8',
      required: false,
      schema: z.enum(['utf-8', 'ascii', 'base64', 'hex']).optional()
    }
  ],
  execute: async (input: any) => {
    try {
      const { filePath, encoding = 'utf-8' } = ReadFileInputSchema.parse(input);
      
      const content = await fs.readFile(filePath, { encoding: encoding as BufferEncoding });
      
      return {
        result: content,
        formatted: `文件路径: ${filePath}\n编码: ${encoding}\n内容长度: ${content.length} 字符`
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`读取文件失败: ${error.message}`);
      }
      throw new Error('读取文件失败: 未知错误');
    }
  }
};

// ============= 文件写入/创建工具 =============
const WriteFileInputSchema = z.object({
  filePath: z.string().describe('要写入的文件路径'),
  content: z.string().describe('要写入的内容'),
  encoding: z.enum(['utf-8', 'ascii', 'base64', 'hex']).optional().default('utf-8').describe('文件编码格式'),
  createDirectories: z.boolean().optional().default(true).describe('如果目录不存在是否自动创建')
});

export const WriteFileTool: ToolDefinition = {
  name: 'write_file',
  description: '创建或覆盖写入文件内容，支持自动创建目录',
  parameters: [
    {
      name: 'filePath',
      type: 'string',
      description: '要写入的文件路径',
      required: true,
      schema: z.string()
    },
    {
      name: 'content',
      type: 'string',
      description: '要写入的内容',
      required: true,
      schema: z.string()
    },
    {
      name: 'encoding',
      type: 'string',
      description: '文件编码格式，默认为utf-8',
      required: false,
      schema: z.enum(['utf-8', 'ascii', 'base64', 'hex']).optional()
    },
    {
      name: 'createDirectories',
      type: 'boolean',
      description: '如果目录不存在是否自动创建，默认为true',
      required: false,
      schema: z.boolean().optional()
    }
  ],
  execute: async (input: any) => {
    try {
      const { filePath, content, encoding = 'utf-8', createDirectories = true } = WriteFileInputSchema.parse(input);
      
      // 如果需要，创建目录
      if (createDirectories) {
        const dir = dirname(filePath);
        await fs.mkdir(dir, { recursive: true });
      }
      
      await fs.writeFile(filePath, content, { encoding: encoding as BufferEncoding });
      
      return {
        result: true,
        formatted: `文件已成功写入: ${filePath}\n内容长度: ${content.length} 字符`
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`写入文件失败: ${error.message}`);
      }
      throw new Error('写入文件失败: 未知错误');
    }
  }
};

// ============= 文件追加工具 =============
const AppendFileInputSchema = z.object({
  filePath: z.string().describe('要追加内容的文件路径'),
  content: z.string().describe('要追加的内容'),
  encoding: z.enum(['utf-8', 'ascii', 'base64', 'hex']).optional().default('utf-8').describe('文件编码格式')
});

export const AppendFileTool: ToolDefinition = {
  name: 'append_file',
  description: '向文件末尾追加内容，如果文件不存在则创建',
  parameters: [
    {
      name: 'filePath',
      type: 'string',
      description: '要追加内容的文件路径',
      required: true,
      schema: z.string()
    },
    {
      name: 'content',
      type: 'string',
      description: '要追加的内容',
      required: true,
      schema: z.string()
    },
    {
      name: 'encoding',
      type: 'string',
      description: '文件编码格式，默认为utf-8',
      required: false,
      schema: z.enum(['utf-8', 'ascii', 'base64', 'hex']).optional()
    }
  ],
  execute: async (input: any) => {
    try {
      const { filePath, content, encoding = 'utf-8' } = AppendFileInputSchema.parse(input);
      
      await fs.appendFile(filePath, content, { encoding: encoding as BufferEncoding });
      
      return {
        result: true,
        formatted: `内容已成功追加到文件: ${filePath}\n追加内容长度: ${content.length} 字符`
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`追加文件失败: ${error.message}`);
      }
      throw new Error('追加文件失败: 未知错误');
    }
  }
};

// ============= 文件删除工具 =============
const DeleteFileInputSchema = z.object({
  filePath: z.string().describe('要删除的文件路径')
});

export const DeleteFileTool: ToolDefinition = {
  name: 'delete_file',
  description: '删除指定的文件',
  parameters: [
    {
      name: 'filePath',
      type: 'string',
      description: '要删除的文件路径',
      required: true,
      schema: z.string()
    }
  ],
  execute: async (input: any) => {
    try {
      const { filePath } = DeleteFileInputSchema.parse(input);
      
      await fs.unlink(filePath);
      
      return {
        result: true,
        formatted: `文件已成功删除: ${filePath}`
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`删除文件失败: ${error.message}`);
      }
      throw new Error('删除文件失败: 未知错误');
    }
  }
};

// ============= 文件重命名/移动工具 =============
const MoveFileInputSchema = z.object({
  sourcePath: z.string().describe('源文件路径'),
  destinationPath: z.string().describe('目标文件路径')
});

export const MoveFileTool: ToolDefinition = {
  name: 'move_file',
  description: '移动或重命名文件',
  parameters: [
    {
      name: 'sourcePath',
      type: 'string',
      description: '源文件路径',
      required: true,
      schema: z.string()
    },
    {
      name: 'destinationPath',
      type: 'string',
      description: '目标文件路径',
      required: true,
      schema: z.string()
    }
  ],
  execute: async (input: any) => {
    try {
      const { sourcePath, destinationPath } = MoveFileInputSchema.parse(input);
      
      await fs.rename(sourcePath, destinationPath);
      
      return {
        result: true,
        formatted: `文件已成功移动/重命名:\n从: ${sourcePath}\n到: ${destinationPath}`
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`移动文件失败: ${error.message}`);
      }
      throw new Error('移动文件失败: 未知错误');
    }
  }
};

// ============= 文件复制工具 =============
const CopyFileInputSchema = z.object({
  sourcePath: z.string().describe('源文件路径'),
  destinationPath: z.string().describe('目标文件路径')
});

export const CopyFileTool: ToolDefinition = {
  name: 'copy_file',
  description: '复制文件到新位置',
  parameters: [
    {
      name: 'sourcePath',
      type: 'string',
      description: '源文件路径',
      required: true,
      schema: z.string()
    },
    {
      name: 'destinationPath',
      type: 'string',
      description: '目标文件路径',
      required: true,
      schema: z.string()
    }
  ],
  execute: async (input: any) => {
    try {
      const { sourcePath, destinationPath } = CopyFileInputSchema.parse(input);
      
      await fs.copyFile(sourcePath, destinationPath);
      
      return {
        result: true,
        formatted: `文件已成功复制:\n从: ${sourcePath}\n到: ${destinationPath}`
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`复制文件失败: ${error.message}`);
      }
      throw new Error('复制文件失败: 未知错误');
    }
  }
};

// ============= 文件信息获取工具 =============
const FileInfoInputSchema = z.object({
  filePath: z.string().describe('要获取信息的文件路径')
});

export const FileInfoTool: ToolDefinition = {
  name: 'file_info',
  description: '获取文件的详细信息（大小、创建时间、修改时间等）',
  parameters: [
    {
      name: 'filePath',
      type: 'string',
      description: '要获取信息的文件路径',
      required: true,
      schema: z.string()
    }
  ],
  execute: async (input: any) => {
    try {
      const { filePath } = FileInfoInputSchema.parse(input);
      
      const stats = await fs.stat(filePath);
      const fileName = basename(filePath);
      const fileExt = extname(filePath);
      
      const fileInfo = {
        path: filePath,
        name: fileName,
        extension: fileExt,
        size: stats.size,
        sizeInKB: (stats.size / 1024).toFixed(2),
        sizeInMB: (stats.size / 1024 / 1024).toFixed(2),
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
        createdAt: stats.birthtime,
        modifiedAt: stats.mtime,
        accessedAt: stats.atime
      };
      
      return {
        result: fileInfo,
        formatted: `文件信息:
路径: ${fileInfo.path}
名称: ${fileInfo.name}
大小: ${fileInfo.sizeInKB} KB
创建时间: ${fileInfo.createdAt}
修改时间: ${fileInfo.modifiedAt}`
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`获取文件信息失败: ${error.message}`);
      }
      throw new Error('获取文件信息失败: 未知错误');
    }
  }
};

// ============= 文件存在性检查工具 =============
const FileExistsInputSchema = z.object({
  filePath: z.string().describe('要检查的文件路径')
});

export const FileExistsTool: ToolDefinition = {
  name: 'file_exists',
  description: '检查文件或目录是否存在',
  parameters: [
    {
      name: 'filePath',
      type: 'string',
      description: '要检查的文件路径',
      required: true,
      schema: z.string()
    }
  ],
  execute: async (input: any) => {
    try {
      const { filePath } = FileExistsInputSchema.parse(input);
      
      try {
        await fs.access(filePath);
        return {
          result: true,
          formatted: `文件存在: ${filePath}`
        };
      } catch {
        return {
          result: false,
          formatted: `文件不存在: ${filePath}`
        };
      }
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`检查文件存在性失败: ${error.message}`);
      }
      throw new Error('检查文件存在性失败: 未知错误');
    }
  }
};

// ============= 目录创建工具 =============
const CreateDirectoryInputSchema = z.object({
  directoryPath: z.string().describe('要创建的目录路径'),
  recursive: z.boolean().optional().default(true).describe('是否递归创建父目录')
});

export const CreateDirectoryTool: ToolDefinition = {
  name: 'create_directory',
  description: '创建新目录，支持递归创建',
  parameters: [
    {
      name: 'directoryPath',
      type: 'string',
      description: '要创建的目录路径',
      required: true,
      schema: z.string()
    },
    {
      name: 'recursive',
      type: 'boolean',
      description: '是否递归创建父目录，默认为true',
      required: false,
      schema: z.boolean().optional()
    }
  ],
  execute: async (input: any) => {
    try {
      const { directoryPath, recursive = true } = CreateDirectoryInputSchema.parse(input);
      
      await fs.mkdir(directoryPath, { recursive });
      
      return {
        result: true,
        formatted: `目录已成功创建: ${directoryPath}`
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`创建目录失败: ${error.message}`);
      }
      throw new Error('创建目录失败: 未知错误');
    }
  }
};

// ============= 目录列表工具 =============
const ListDirectoryInputSchema = z.object({
  directoryPath: z.string().describe('要列出内容的目录路径'),
  detailed: z.boolean().optional().default(false).describe('是否返回详细信息')
});

export const ListDirectoryTool: ToolDefinition = {
  name: 'list_directory',
  description: '列出目录中的所有文件和子目录',
  parameters: [
    {
      name: 'directoryPath',
      type: 'string',
      description: '要列出内容的目录路径',
      required: true,
      schema: z.string()
    },
    {
      name: 'detailed',
      type: 'boolean',
      description: '是否返回详细信息（包括文件大小、修改时间等），默认为false',
      required: false,
      schema: z.boolean().optional()
    }
  ],
  execute: async (input: any) => {
    try {
      const { directoryPath, detailed = false } = ListDirectoryInputSchema.parse(input);
      
      const entries = await fs.readdir(directoryPath);
      
      if (!detailed) {
        return {
          result: entries,
          formatted: `目录内容 (${directoryPath}):\n${entries.join('\n')}`
        };
      }
      
      // 获取详细信息
      const detailedEntries = await Promise.all(
        entries.map(async (entry) => {
          const fullPath = join(directoryPath, entry);
          const stats = await fs.stat(fullPath);
          return {
            name: entry,
            path: fullPath,
            isDirectory: stats.isDirectory(),
            isFile: stats.isFile(),
            size: stats.size,
            modifiedAt: stats.mtime
          };
        })
      );
      
      const formatted = detailedEntries.map(e => 
        `${e.isDirectory ? '[DIR]' : '[FILE]'} ${e.name} (${(e.size / 1024).toFixed(2)} KB)`
      ).join('\n');
      
      return {
        result: detailedEntries,
        formatted: `目录内容 (${directoryPath}):\n${formatted}`
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`列出目录失败: ${error.message}`);
      }
      throw new Error('列出目录失败: 未知错误');
    }
  }
};

// ============= 删除目录工具 =============
const DeleteDirectoryInputSchema = z.object({
  directoryPath: z.string().describe('要删除的目录路径'),
  recursive: z.boolean().optional().default(false).describe('是否递归删除（删除非空目录）')
});

export const DeleteDirectoryTool: ToolDefinition = {
  name: 'delete_directory',
  description: '删除目录，可选择是否递归删除',
  parameters: [
    {
      name: 'directoryPath',
      type: 'string',
      description: '要删除的目录路径',
      required: true,
      schema: z.string()
    },
    {
      name: 'recursive',
      type: 'boolean',
      description: '是否递归删除（删除非空目录），默认为false',
      required: false,
      schema: z.boolean().optional()
    }
  ],
  execute: async (input: any) => {
    try {
      const { directoryPath, recursive = false } = DeleteDirectoryInputSchema.parse(input);
      
      if (recursive) {
        await fs.rm(directoryPath, { recursive: true, force: true });
      } else {
        await fs.rmdir(directoryPath);
      }
      
      return {
        result: true,
        formatted: `目录已成功删除: ${directoryPath}`
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`删除目录失败: ${error.message}`);
      }
      throw new Error('删除目录失败: 未知错误');
    }
  }
};

// 导出所有文件系统工具
export const FileSystemTools = [
  ReadFileTool,
  WriteFileTool,
  AppendFileTool,
  DeleteFileTool,
  MoveFileTool,
  CopyFileTool,
  FileInfoTool,
  FileExistsTool,
  CreateDirectoryTool,
  ListDirectoryTool,
  DeleteDirectoryTool
];

