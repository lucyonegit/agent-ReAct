# 文件系统工具集 (FileSystem Tools)

这是一套完整的文件系统操作工具，使用 Node.js 原生的 `fs/promises` API 实现，遵循 LangChain 工具设计模式。

## 🚀 快速开始

### 注册工具

```typescript
import { ToolRegistry } from '../../tools/ToolRegistry.js';
import { FileSystemTools } from './fileSystem.js';

const registry = new ToolRegistry();
registry.registerTools(FileSystemTools);
```

### 执行工具

```typescript
const result = await registry.executeTool('read_file', {
  filePath: './example.txt',
  encoding: 'utf-8'
});

if (result.success) {
  console.log(result.result.formatted);
  console.log('内容:', result.result.result);
} else {
  console.error(result.error);
}
```

## 📚 工具列表

### 1. read_file - 读取文件
读取文件内容，支持多种编码格式。

**参数：**
- `filePath` (string, required): 文件路径
- `encoding` (string, optional): 编码格式 (utf-8, ascii, base64, hex)，默认 utf-8

**返回：**
```typescript
{
  result: string,  // 文件内容
  formatted: string  // 格式化的信息
}
```

**示例：**
```typescript
await registry.executeTool('read_file', {
  filePath: './data.txt',
  encoding: 'utf-8'
});
```

---

### 2. write_file - 写入/创建文件
创建新文件或覆盖现有文件，自动创建目录。

**参数：**
- `filePath` (string, required): 文件路径
- `content` (string, required): 要写入的内容
- `encoding` (string, optional): 编码格式，默认 utf-8
- `createDirectories` (boolean, optional): 是否自动创建目录，默认 true

**返回：**
```typescript
{
  result: true,
  formatted: string
}
```

**示例：**
```typescript
await registry.executeTool('write_file', {
  filePath: './output/result.txt',
  content: 'Hello World!',
  createDirectories: true
});
```

---

### 3. append_file - 追加文件
向文件末尾追加内容，文件不存在则创建。

**参数：**
- `filePath` (string, required): 文件路径
- `content` (string, required): 要追加的内容
- `encoding` (string, optional): 编码格式，默认 utf-8

**示例：**
```typescript
await registry.executeTool('append_file', {
  filePath: './log.txt',
  content: '\n[INFO] New log entry'
});
```

---

### 4. delete_file - 删除文件
删除指定的文件。

**参数：**
- `filePath` (string, required): 文件路径

**示例：**
```typescript
await registry.executeTool('delete_file', {
  filePath: './temp.txt'
});
```

---

### 5. move_file - 移动/重命名文件
移动文件到新位置或重命名文件。

**参数：**
- `sourcePath` (string, required): 源文件路径
- `destinationPath` (string, required): 目标文件路径

**示例：**
```typescript
// 重命名
await registry.executeTool('move_file', {
  sourcePath: './old-name.txt',
  destinationPath: './new-name.txt'
});

// 移动
await registry.executeTool('move_file', {
  sourcePath: './file.txt',
  destinationPath: './archive/file.txt'
});
```

---

### 6. copy_file - 复制文件
复制文件到新位置。

**参数：**
- `sourcePath` (string, required): 源文件路径
- `destinationPath` (string, required): 目标文件路径

**示例：**
```typescript
await registry.executeTool('copy_file', {
  sourcePath: './original.txt',
  destinationPath: './backup.txt'
});
```

---

### 7. file_info - 获取文件信息
获取文件的详细元数据（大小、时间戳等）。

**参数：**
- `filePath` (string, required): 文件路径

**返回：**
```typescript
{
  result: {
    path: string,
    name: string,
    extension: string,
    size: number,
    sizeInKB: string,
    sizeInMB: string,
    isFile: boolean,
    isDirectory: boolean,
    createdAt: Date,
    modifiedAt: Date,
    accessedAt: Date
  },
  formatted: string
}
```

**示例：**
```typescript
const info = await registry.executeTool('file_info', {
  filePath: './document.pdf'
});
```

---

### 8. file_exists - 检查文件存在性
检查文件或目录是否存在。

**参数：**
- `filePath` (string, required): 文件路径

**返回：**
```typescript
{
  result: boolean,  // true 表示存在，false 表示不存在
  formatted: string
}
```

**示例：**
```typescript
const exists = await registry.executeTool('file_exists', {
  filePath: './config.json'
});
```

---

### 9. create_directory - 创建目录
创建新目录，支持递归创建。

**参数：**
- `directoryPath` (string, required): 目录路径
- `recursive` (boolean, optional): 是否递归创建父目录，默认 true

**示例：**
```typescript
await registry.executeTool('create_directory', {
  directoryPath: './data/cache/temp',
  recursive: true
});
```

---

### 10. list_directory - 列出目录内容
列出目录中的所有文件和子目录。

**参数：**
- `directoryPath` (string, required): 目录路径
- `detailed` (boolean, optional): 是否返回详细信息，默认 false

**返回（详细模式）：**
```typescript
{
  result: Array<{
    name: string,
    path: string,
    isDirectory: boolean,
    isFile: boolean,
    size: number,
    modifiedAt: Date
  }>,
  formatted: string
}
```

**示例：**
```typescript
// 简单列表
await registry.executeTool('list_directory', {
  directoryPath: './src'
});

// 详细信息
await registry.executeTool('list_directory', {
  directoryPath: './src',
  detailed: true
});
```

---

### 11. delete_directory - 删除目录
删除目录，可选择是否递归删除。

**参数：**
- `directoryPath` (string, required): 目录路径
- `recursive` (boolean, optional): 是否递归删除（删除非空目录），默认 false

**示例：**
```typescript
// 删除空目录
await registry.executeTool('delete_directory', {
  directoryPath: './temp'
});

// 删除目录及其所有内容
await registry.executeTool('delete_directory', {
  directoryPath: './old-data',
  recursive: true
});
```

---

## 🎯 使用场景

### 场景1: 日志管理
```typescript
// 检查日志文件是否存在
const exists = await registry.executeTool('file_exists', {
  filePath: './app.log'
});

if (!exists.result) {
  // 创建新日志文件
  await registry.executeTool('write_file', {
    filePath: './app.log',
    content: `[${new Date().toISOString()}] Log started\n`
  });
} else {
  // 追加日志
  await registry.executeTool('append_file', {
    filePath: './app.log',
    content: `[${new Date().toISOString()}] New log entry\n`
  });
}
```

### 场景2: 文件备份
```typescript
// 获取文件信息
const info = await registry.executeTool('file_info', {
  filePath: './important-data.json'
});

// 创建备份目录
await registry.executeTool('create_directory', {
  directoryPath: './backups'
});

// 复制文件
await registry.executeTool('copy_file', {
  sourcePath: './important-data.json',
  destinationPath: `./backups/backup-${Date.now()}.json`
});
```

### 场景3: 文件处理流程
```typescript
// 读取文件
const readResult = await registry.executeTool('read_file', {
  filePath: './input.txt'
});

// 处理内容
const processedContent = readResult.result.result.toUpperCase();

// 写入新文件
await registry.executeTool('write_file', {
  filePath: './output.txt',
  content: processedContent
});

// 移动原文件到归档
await registry.executeTool('move_file', {
  sourcePath: './input.txt',
  destinationPath: './archive/input.txt'
});
```

## 🔒 安全注意事项

1. **路径验证**: 在生产环境中，建议添加路径白名单验证
2. **权限检查**: 确保应用有足够的文件系统权限
3. **错误处理**: 始终检查 `result.success` 并处理错误
4. **递归删除**: 使用 `delete_directory` 的递归模式时要特别小心

## 🧪 运行示例

```bash
# 运行完整示例
npm run dev -- examples/filesystem-usage.ts
# 或
tsx examples/filesystem-usage.ts
```

## 📝 技术细节

- **实现**: 使用 Node.js `fs/promises` API
- **验证**: 使用 Zod 进行参数验证
- **错误处理**: 统一的错误处理机制
- **类型安全**: 完整的 TypeScript 类型定义

## 🔗 相关资源

- [Node.js fs/promises 文档](https://nodejs.org/api/fs.html#promises-api)
- [Zod 验证库](https://github.com/colinhacks/zod)
- [LangChain 工具指南](https://js.langchain.com/docs/modules/agents/tools/)
