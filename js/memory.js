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

### 记忆自主管理规范 (Autonomous Memory Directives):
你拥有跨会话持久化记忆能力。在对话过程中，请根据以下准则自主或按需调用 \`manage_memory\` 工具维护记忆库：
1. **显式指令触发 (Explicit Commands)**：当用户明确要求“记住...”、“记录我的偏好...”时，执行 \`action: "add"\`；当要求修改或纠正已有记忆时执行 \`action: "update"\`；当要求“忘记...”时执行 \`action: "delete"\`。
2. **自主隐式沉淀 (Autonomous Implicit Learning)**：当用户在日常对话中自然透露了**持久性、非一次性的个人事实、技术栈背景、项目架构、工作习惯或表达偏好**时（例如提到“我的项目是用 Go 开发的分布式系统”、“我习惯用 pnpm”、“回答请默认用中文”），请主动调用 \`manage_memory\` 进行沉淀，无需等待用户显式命令。
3. **事实合并与更新 (Merge & Update)**：当新的事实与已有记忆相关或发生变更时，优先调用 \`action: "update"\` 覆盖或合并已有条目（指定 \`memory_id\`），避免产生相互矛盾或重复的碎片记忆。
4. **克制与甄别原则 (Discretion & Quality)**：严禁记录临时闲聊、短期状态（如“今天天气真好”、“我正在吃午饭”）、临时性报错排查片段或敏感机密（如密码、Token）。每条记录必须是独立、客观、精炼的陈述句。`;
  },

  getToolSchema() {
    return {
      type: 'function',
      function: {
        name: 'manage_memory',
        description: 'Manage persistent long-term memory about the user across conversations. Call this tool autonomously whenever you learn enduring personal facts, technical stacks, project context, workflows, or stylistic preferences from the dialogue, or when the user explicitly instructs you to remember, update, forget, or clear memory items.',
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['add', 'update', 'delete', 'clear'],
              description: 'The memory operation: "add" to store a newly discovered or instructed fact, "update" to modify or merge an existing fact, "delete" to remove a fact, "clear" to wipe all memories.'
            },
            content: {
              type: 'string',
              description: 'The concise, self-contained, objective fact statement to store or update (required for "add" and "update"). Should describe user profile, habits, tech stack, or preferences.'
            },
            memory_id: {
              type: 'string',
              description: 'The unique ID of the existing memory item to modify or delete (required for "update" and "delete").'
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
        message: '已成功存入用户记忆库。'
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
        message: '已成功更新用户记忆。'
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
        message: '已成功删除该条记忆。'
      };
    }

    if (action === 'clear') {
      this.clear();
      return {
        success: true,
        action: 'clear',
        message: '已清空用户所有记忆。'
      };
    }

    throw new Error(`不支持的记忆操作类型: ${action}`);
  }
};
