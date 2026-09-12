// js/memory.js
// Local-First Long-Term Memory DAO, System Prompt Compiler, and Autonomous Tool Executor.

import { uid, esc, LS, state } from './state.js';

export const MAX_MEMORY_ITEMS = 100;

export const MemoryStore = {
  getAll() {
    try {
      const raw = localStorage.getItem(LS.memoryList);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) return arr;
      }
    } catch (e) { }
    return [];
  },

  saveAll(list) {
    try {
      localStorage.setItem(LS.memoryList, JSON.stringify(list));
      state.memories = list;
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new CustomEvent('zm:memory-updated', { detail: list }));
      }
    } catch (e) { }
  },

  add(content) {
    const text = String(content || '').trim();
    if (!text) return null;

    const list = this.getAll();
    // Prevent duplicate entries
    const existing = list.find((m) => m.content.toLowerCase() === text.toLowerCase());
    if (existing) {
      existing.updatedAt = Date.now();
      this.saveAll(list);
      return existing;
    }

    const newItem = {
      id: 'mem_' + uid(),
      content: text,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    list.unshift(newItem);
    if (list.length > MAX_MEMORY_ITEMS) {
      list.length = MAX_MEMORY_ITEMS;
    }

    this.saveAll(list);
    return newItem;
  },

  update(id, newContent) {
    const text = String(newContent || '').trim();
    if (!id || !text) return null;

    const list = this.getAll();
    const item = list.find((m) => m.id === id);
    if (item) {
      item.content = text;
      item.updatedAt = Date.now();
      this.saveAll(list);
      return item;
    }
    return null;
  },

  delete(id) {
    if (!id) return false;
    const list = this.getAll();
    const initialLen = list.length;
    const filtered = list.filter((m) => m.id !== id);
    if (filtered.length !== initialLen) {
      this.saveAll(filtered);
      return true;
    }
    return false;
  },

  clear() {
    this.saveAll([]);
  },

  isEnabled() {
    return state.memoryEnabled !== false;
  },

  compileSystemPrompt() {
    if (!this.isEnabled()) return '';
    const list = this.getAll();
    const isEn = typeof state !== 'undefined' && state.lang === 'en';

    if (list.length === 0) {
      if (isEn) {
        return `## User Persistent Long-Term Memory
No remembered facts recorded in the memory store yet.
- When the user naturally mentions persistent personal facts, preferences, tech stacks, or explicitly asks to "remember ...", autonomously call \`manage_memory\` (\`action: "add"\`) to record it.`;
      }
      return `## 用户长期记忆库 (User Persistent Long-Term Memory)
当前记忆库中暂无已记录的事实。
- 当用户在日常对话中自然透露了持久性个人偏好、技术栈背景、项目架构或明确要求“记住...”时，请主动调用 \`manage_memory\` (\`action: "add"\`) 进行沉淀。`;
    }

    const itemsMarkdown = list.map((m) => `- [ID: ${m.id}] ${m.content}`).join('\n');

    if (isEn) {
      return `## User Persistent Long-Term Memory
[HIGHEST PRIORITY TRUTH]: Below is the verified persistent memory about the current user (must be treated as ground truth):
${itemsMarkdown}

### Core Memory Principles & Directives:
1. **Direct Reference**: The list above already contains all recorded facts. When the user asks "what do you know about me", "what are my preferences", or "do you remember me", answer directly based on the list above. Never deny existing memories and NEVER call manage_memory to read memories!
2. **Autonomous Implicit Learning**: When the user naturally mentions persistent personal facts, tech stack, architecture, workflows, or preferences, call \`manage_memory\` (\`action: "add"\`) to persist it.
3. **Explicit Commands**: Execute \`action: "add"\` when the user says "remember ..."; execute \`action: "update"\` when updating existing memory; execute \`action: "delete"\` when the user asks to forget something.
4. **Merge & Update**: When new facts relate to existing memory, prefer \`action: "update"\` to avoid contradictory duplicate entries.
5. **Discretion & Safety**: Never record transient chit-chat, error logs, or sensitive API keys/passwords.`;
    }

    return `## 用户长期记忆库 (User Persistent Long-Term Memory)
【最高优先级事实】：以下是系统中真实记录的关于当前用户的长期记忆（无论对话历史如何，必须以此记忆列表为真实基准）：
${itemsMarkdown}

### 核心记忆规范 (Core Memory Principles & Directives):
1. **直接确认与引用 (Direct Reference)**：上方列表已包含当前所有已记录的记忆事实。当用户询问“你了解我什么”、“我有什么偏好”、“你还记得我吗”时，**请直接根据上方列表内容如实回答，绝对不要否认上方已有记忆，严禁调用 manage_memory 工具去查询记忆**！
2. **自主隐式沉淀 (Autonomous Implicit Learning)**：当用户在日常对话中自然透露了**持久性、非一次性的个人事实、技术栈背景、项目架构、工作习惯或偏好**时，主动调用 \`manage_memory\` (\`action: "add"\`) 进行沉淀。
3. **显式指令触发 (Explicit Commands)**：当用户明确说“记住...”、“记录我的偏好...”时执行 \`action: "add"\`；当要求修改或纠正已有记忆时执行 \`action: "update"\`（指定 \`memory_id\`）；当明确要求“忘记某事”时执行 \`action: "delete"\`（指定 \`memory_id\`）。
4. **事实合并与更新 (Merge & Update)**：新事实与已有记忆相关或发生变更时，优先调用 \`action: "update"\` 合并或覆盖已有条目，严禁制造重复矛盾记录。
5. **克制与安全原则 (Discretion & Safety)**：严禁记录临时闲聊（如“今天天气好”、“我正在吃饭”）、报错日志或敏感 Token/密码。严禁随意删除记忆库。`;
  },

  getToolSchema() {
    return {
      type: 'function',
      function: {
        name: 'manage_memory',
        description: 'Record new facts or update/delete existing remembered facts about the user. DO NOT call this tool to read or query memories (all memories are already provided directly in your system prompt above). Use ONLY when: 1. Adding a newly learned persistent fact (action: "add"); 2. Modifying an existing fact (action: "update", requires memory_id); 3. Deleting a specific fact explicitly requested by the user (action: "delete", requires memory_id).',
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['add', 'update', 'delete'],
              description: 'The memory modification operation: "add" to store a newly learned fact, "update" to modify/merge an existing fact, "delete" to remove a specific fact explicitly requested by the user.'
            },
            content: {
              type: 'string',
              description: 'The concise, self-contained, objective fact statement to store or update (required for "add" and "update"). Should describe user profile, habits, tech stack, or preferences.'
            },
            memory_id: {
              type: 'string',
              description: 'The unique ID of the specific existing memory item to modify or delete (required for "update" and "delete").'
            }
          },
          required: ['action']
        }
      }
    };
  },

  executeTool(args) {
    const isEn = typeof state !== 'undefined' && state.lang === 'en';
    const action = (args && args.action) ? String(args.action).trim() : 'add';
    const content = (args && args.content) ? String(args.content).trim() : '';
    const memoryId = (args && args.memory_id) ? String(args.memory_id).trim() : '';

    if (action === 'add') {
      if (!content) throw new Error(isEn ? 'Missing memory content to record' : '缺少要记录的记忆内容 content');
      const item = this.add(content);
      return {
        success: true,
        action: 'add',
        item,
        message: isEn ? 'Successfully saved to user memory store.' : '已成功存入用户记忆库。'
      };
    }

    if (action === 'update') {
      if (!memoryId) throw new Error(isEn ? 'Missing memory ID to update (memory_id)' : '缺少要更新的记忆 ID (memory_id)');
      if (!content) throw new Error(isEn ? 'Missing updated memory content' : '缺少更新后的记忆内容 content');
      const item = this.update(memoryId, content);
      if (!item) throw new Error(isEn ? `Memory item with ID ${memoryId} not found` : `未找到 ID 为 ${memoryId} 的记忆项`);
      return {
        success: true,
        action: 'update',
        item,
        message: isEn ? 'Successfully updated user memory.' : '已成功更新用户记忆。'
      };
    }

    if (action === 'delete') {
      if (!memoryId) throw new Error(isEn ? 'Missing memory ID to delete (memory_id)' : '缺少要删除的记忆 ID (memory_id)');
      const ok = this.delete(memoryId);
      if (!ok) throw new Error(isEn ? `Memory item with ID ${memoryId} not found` : `未找到 ID 为 ${memoryId} 的记忆项`);
      return {
        success: true,
        action: 'delete',
        memoryId,
        message: isEn ? 'Successfully deleted the memory item.' : '已成功删除该条记忆。'
      };
    }

    if (action === 'clear') {
      throw new Error(isEn ? 'Model is not authorized to clear all memories. Clearing all memory must be manually confirmed by the user in settings.' : '模型无权执行清空所有记忆操作，全量清空必须由用户在设置中手动确认。');
    }

    throw new Error(isEn ? `Unsupported memory action: ${action}` : `不支持的记忆操作类型: ${action}`);
  }
};
