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

    let itemsMarkdown = '';
    if (list.length > 0) {
      itemsMarkdown = list.map((m) => `- [ID: ${m.id}] ${m.content}`).join('\n');
    } else {
      itemsMarkdown = '- (暂无记录的长期记忆)';
    }

    return `## 用户长期记忆库 (User Persistent Long-Term Memory)
以下是跨会话沉淀的关于用户的持久个人事实、工作技术栈背景与偏好约定：
${itemsMarkdown}

### 记忆管理规范 (Memory Directives):
1. 当用户在对话中明确表述了新的个人偏好、业务场景、技术栈约定或明确说“记住...”时，请自主调用 \`manage_memory\` 工具 (\`action: "add"\`) 进行持久化记录。
2. 当用户纠正或更新之前的某项记忆时，请调用 \`manage_memory\` (\`action: "update"\`) 并指定对应 \`memory_id\`。
3. 当用户明确要求“忘记...”或删除某项偏好时，请调用 \`manage_memory\` (\`action: "delete"\`)。
4. 严禁记录临时的对话闲聊或与用户个人偏好无关的一次性事实。记录的记忆语句必须简洁、客观、自成一体。`;
  },

  getToolSchema() {
    return {
      type: 'function',
      function: {
        name: 'manage_memory',
        description: 'Manage the user\'s persistent long-term memory across chat sessions. Use this tool whenever the user asks to remember, update, forget, or clear personal facts, tech stack preferences, professional background, or coding style guidelines.',
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['add', 'update', 'delete', 'clear'],
              description: 'The memory operation: "add" to store a new fact, "update" to modify an existing fact, "delete" to remove a specific fact, "clear" to wipe all memories.'
            },
            content: {
              type: 'string',
              description: 'The concise, objective, self-contained fact statement to remember or update (required for "add" and "update").'
            },
            memory_id: {
              type: 'string',
              description: 'The specific memory ID to modify or delete (required for "update" and "delete").'
            }
          },
          required: ['action']
        }
      }
    };
  },

  executeTool(args) {
    const action = (args && args.action) ? String(args.action).trim() : 'add';
    const content = (args && args.content) ? String(args.content).trim() : '';
    const memoryId = (args && args.memory_id) ? String(args.memory_id).trim() : '';

    if (action === 'add') {
      if (!content) throw new Error('缺少要记录的记忆内容 content');
      const item = this.add(content);
      return {
        success: true,
        action: 'add',
        item,
        message: `已成功将该事实存入用户长期记忆库: [${item.id}] ${item.content}`
      };
    }

    if (action === 'update') {
      if (!memoryId) throw new Error('缺少要更新的记忆 ID (memory_id)');
      if (!content) throw new Error('缺少更新后的记忆内容 content');
      const item = this.update(memoryId, content);
      if (!item) throw new Error(`未找到 ID 为 ${memoryId} 的记忆项`);
      return {
        success: true,
        action: 'update',
        item,
        message: `已成功更新长期记忆 [${item.id}] 为: ${item.content}`
      };
    }

    if (action === 'delete') {
      if (!memoryId) throw new Error('缺少要删除的记忆 ID (memory_id)');
      const ok = this.delete(memoryId);
      if (!ok) throw new Error(`未找到 ID 为 ${memoryId} 的记忆项`);
      return {
        success: true,
        action: 'delete',
        memoryId,
        message: `已成功从长期记忆库中删除该项: ${memoryId}`
      };
    }

    if (action === 'clear') {
      this.clear();
      return {
        success: true,
        action: 'clear',
        message: '已清空用户所有长期记忆。'
      };
    }

    throw new Error(`不支持的记忆操作类型: ${action}`);
  }
};
