// js/i18n.js
// Ultra-lean, zero-dependency internationalization (i18n) engine for ZenMux Chat.
// Supports runtime zero-reload locale switching, declarative DOM hydration,
// nested dot-notation dictionaries, dynamic interpolation, and custom event dispatching.

import { state, LS } from './state.js';

export const TRANSLATIONS = {
  zh: {
    common: {
      save: '保存',
      cancel: '取消',
      close: '关闭',
      copy: '复制',
      copied: '已复制到剪贴板',
      copyFailed: '复制失败，请手动选取',
      clear: '清空',
      delete: '删除',
      edit: '修改',
      add: '添加',
      loading: '加载中…',
      error: '异常',
      default: '默认',
      recommended: '推荐',
    },
    sidebar: {
      brand: 'ZenChat',
      newChat: '＋　新建对话',
      collapse: '收起侧边栏',
      expand: '展开侧边栏',
      resizeTitle: '左右拖动调整侧边栏宽度，双击恢复默认',
      localOnly: '会话仅存于本机浏览器',
      localTokens: '会话仅存于本机 · 消耗 {total} Tokens',
      deleteConfirm: '确定要删除对话「{title}」吗？此操作不可撤销。',
      deleteFailed: '删除失败: {error}',
      newChatTitle: '新对话',
      doubleClickToRename: '双击可修改标题',
      rename: '重命名',
      deleteTooltip: '删除对话',
    },
    topbar: {
      modelPickerTitle: '选择模型',
      modelLoading: '载入模型中…',
      modelSearchPlaceholder: '搜索模型或厂商...',
      modelSearchClear: '清除搜索',
      modelEmpty: '未找到匹配的模型',
      modelFetchFailed: '模型列表拉取失败：{error}（可手动输入/选择）',
      shareTitle: '保存与分享会话快照',
      settingsTitle: '偏好与系统指令设置',
      logout: '退出',
    },
    models: {
      selectModelPlaceholder: '选择模型…',
      noModelsAvailable: '无可用模型',
      imageGenGroup: '图像生成 (Image Generation)',
      imageGen: '生图',
      vision: '视觉',
      reasoning: '推理',
      free: '免费',
      otherGroup: '其他',
    },
    params: {
      effortTitleSupported: '推理强度：ZenMux 不传此参数时默认 medium',
      effortTitleLoading: '推理强度（模型信息载入中）',
      effortTitleUnsupported: '当前模型不支持推理',
      effortTitle: '推理强度：仅对支持推理的模型生效',
      effortDefault: '推理 默认',
      effortMinimal: '推理 最低',
      effortLow: '推理 低',
      effortMedium: '推理 中',
      effortHigh: '推理 高',
      effortOff: '推理 关闭',

      searchDepthTitle: '联网搜索检索深度：精炼、标准、深度或全面',
      searchDepthStandard: '搜索 标准',
      searchDepthQuick: '搜索 精炼',
      searchDepthDeep: '搜索 深度',
      searchDepthPro: '搜索 全面',

      toolTurnsTitle: '单轮工具最大调用次数：默认20次、深度50次、全面100次或无限制',
      toolTurns20: '工具 20次',
      toolTurns50: '工具 50次',
      toolTurns100: '工具 100次',
      toolTurnsUnlimited: '工具 不限',

      ctxTitle: '对话历史记忆长度：简洁、标准、较长或完整',
      ctx10: '上下文 简洁',
      ctx20: '上下文 标准',
      ctx40: '上下文 较长',
      ctx0: '上下文 完整',

      imageSizeTitle: '图像生成尺寸与纵横比',
      imageSizeAuto: '尺寸 自适应',
      imageSize1024: '尺寸 1:1 正方 (1K)',
      imageSize1536x1024: '尺寸 3:2 横屏',
      imageSize1024x1536: '尺寸 2:3 竖屏',
      imageSize2k: '尺寸 2K 超清',

      imageQualityTitle: '图像精度与画质',
      imageQualityAuto: '画质 自动',
      imageQualityHigh: '画质 高清',
      imageQualityMedium: '画质 标准',
      imageQualityLow: '画质 极速',

      imageBgTitle: '背景透明度设置',
      imageBgAuto: '背景 默认',
      imageBgTransparent: '背景 透明(PNG)',
      imageBgOpaque: '背景 实心',
    },
    composer: {
      attachTitle: '添加图片或文件（支持代码、文本、数据表格、PDF等）',
      pluginsTitle: '扩展插件与智能工具库',
      pluginsText: '插件',
      voiceTitle: '语音输入（点击说话，实时转为文字）',
      inputPlaceholder: '发消息或粘贴/拖拽文件、图片，Enter 发送，Shift+Enter 换行',
      voiceListening: '正在聆听…',
      voiceApproachingLimit: '即将达到上限 (还剩 {remaining}秒)',
      voiceLimitReached: '已达上限，正在转录…',
      voiceTranscribing: '正在转录文本...',
      voiceCompleted: '语音识别完成',
      voiceNoAudio: '未检测到有效声音输入',
      voiceHoldToSpeak: '按住 说话',
      voiceReleaseToSend: '松开 结束',
      voiceShortTapWarning: '按住说话，松开结束',
      voiceSwitchToText: '切换为键盘输入',
      voiceSwitchToVoice: '切换为按住说话',
      voiceRecording: '正在录音',
      voiceSlideToCancel: '▲ 上滑取消 · 松开发送',
      voiceReleaseToCancel: '✕ 松开手指，取消发送',
      voiceCancelled: '已取消录音',
      stopTitle: '停止',
      sendTitle: '发送',
      startImageGen: '开始生图 (Enter)',
      imageInputPlaceholder: '描述你想生成的画面 (Prompt)，Enter 开始绘制…',
      dropHint: '松开鼠标添加图片或文件',
    },
    chat: {
      emptyWithModel: '开始一段对话，支持拖拽代码文件、数据表格与图片分析',
      emptyNoModel: '请先在上方选择模型',
      thinkingProcess: '思考过程',
      sourcesTitle: '参考来源 ({count} 个网页)',
      linesCount: '{count}行',
      imageAlt: '图片',
      imageExpired: '图片数据已失效',
      imageExpiredDesc1: '· 本地未保留二进制图像（IndexedDB 离线缓存已清理或未写入）',
      imageExpiredDesc2: '· 远程图床链接已过期或未提供',
      copyPrompt: '复制提示词',
      promptCopied: '提示词已复制到剪贴板',
      imageReadError: '读取本地图片异常',
      copyResponse: '复制',
      copyResponseTooltip: '复制回复内容',
      regenerate: '重新生成',
      regenerateTooltip: '使用当前模型重新生成回答',
      busyWaiting: 'AI 正在回答中，请稍候…',
      readAloud: '朗读',
      readAloudTooltip: '展开语音朗读播放器',
      share: '分享',
      shareTooltip: '分享或保存此交互至独立网页快照',
      usageBtnTooltip: '展开/折叠 Token 消耗与模型详情',
      usageInput: '输入',
      usageOutput: '输出',
      usageTurnTotal: '本轮总计',
      usageSessionTotal: '会话累计',
      usageModel: '响应模型: {model}',
      selectModelFirst: '请先选择模型',
      noVisionSupport: '当前模型不支持图片输入，请切换至支持视觉的模型',
      noPreviousUserMsg: '未找到上一轮提问',
      themeSwitchedLight: '已切换至浅色外观',
      themeSwitchedDark: '已切换至深色外观',
      imageRenderingProgress: '正在调度生图引擎渲染画面 ({elapsed}s)...',
      imageCancelled: '已取消图像生成。',
      imageFailed: '图像生成失败：{message}',
    },
    pluginsModal: {
      title: '扩展插件与智能工具',
      desc: '开启的插件将注入模型决策流，模型在思考时可自主调度并执行。',
      activeSummary: '已启用 {count} 个插件',
      enableAll: '全部启用',
      disableAll: '全部关闭',
      closeTooltip: '关闭 (Esc)',
    },
    settings: {
      title: '偏好设置',
      closeTooltip: '关闭 (Esc)',
      languageTitle: '界面语言',
      languageHint: '选择界面显示语言',
      langZh: '简体中文',
      langEn: 'English',

      appearanceTitle: '界面外观',
      appearanceHint: '选择适合你的显示主题',
      themeDark: '深色模式',
      themeLight: '浅色模式',
      themeAuto: '跟随系统',

      shareRetentionTitle: '分享链接默认保留时长',
      shareRetentionHint: '新建分享链接时的默认有效期限，可随时在分享弹窗中微调',

      instructionsTitle: '定制你的专属 AI (个性化设定)',
      instructionsToggleTitle: '开启或暂停个性化设定',
      instructionsHint: '告诉 AI 你的身份背景或期望的回答风格，AI 在每次对话中都会记住并遵循。',
      presetsLabel: '常用预设：',
      presetEngineer: '资深工程师',
      presetEngineerPrompt: '你是一位资深全栈工程师。回答时请遵循最佳实践，给出精炼、无赘述的高质量代码与清晰要点解析。',
      presetScholar: '严谨学者',
      presetScholarPrompt: '请以严谨、客观、论据充分的学者口吻回答，注重逻辑推演与结构化表达。',
      presetMinimal: '极简要点',
      presetMinimalPrompt: '回答务必言简意赅、直奔重点，去除一切客套寒暄，优先使用分点列表和表格呈现结论。',
      presetTranslator: '专业翻译',
      presetTranslatorPrompt: '你是一位专业的中英双语翻译专家。请准确、地道、优雅地翻译内容，并附带关键术语对照。',
      instructionsPlaceholder: '例如：我是一名全栈开发者。回答时请直接给出清晰的代码与核心结论，不需要客套寒暄...',
      charCount: '{count} 字符',

      memoryTitle: '长期记忆 (Memory)',
      memoryToggleTitle: '开启或关闭长期记忆',
      memoryHint: '开启后，AI 会在聊天中自动记住关于你的重要偏好和背景。点击任意内容即可直接修改，数据仅保存在你的本地浏览器中。',
      memoryPlaceholder: '输入一条想让 AI 记住的事（例如：回答时多用中文、平时常用 Python）',
      memoryAddBtn: '＋ 添加',
      memoryEmpty: '暂无存储的长期记忆。可在对话中告诉 AI“记住...”或在上方手动添加。',
      memoryCount: '已记住 {count} 条内容',
      memoryClearAll: '清空所有记忆',
      memoryClearConfirm: '确定要清空全部 {count} 条长期记忆吗？此操作不可恢复。',
      memoryDeleted: '已删除该条记忆',
      memoryEmptyWarning: '记忆内容不能为空，若需删除请点击右侧删除按钮',
      memoryUpdated: '已更新记忆内容',
      memoryAdded: '已添加新记忆',
      memoryCleared: '已清空所有长期记忆',
      memoryToggleToastOn: '已开启长程记忆功能',
      memoryToggleToastOff: '已关闭长程记忆功能',

      asrTitle: '语音识别模型 (ASR)',
      asrHint: '点击输入框麦克风时，强制启用端侧 VAD 智能降噪并调度高精度云端 ASR。',
      asrOptgroupChinese: '推荐中文大模型 (高精度 · 强抗噪 · 极致性价比)',
      asrOptgroupGlobal: '国际通用与多语言大模型',
      asrDoubao: '火山引擎 豆包大模型 ASR (Doubao-Seed-ASR-2.0) · 推荐',
      asrQwen: '阿里 Qwen3 ASR Flash (非自回归毫秒级秒出)',
      asrMimo: '小米 MiMo-V2.5-ASR (中英双语 · 方言抗噪)',
      asrGrok: 'xAI Grok Voice STT 1.0 (词级时间戳 · 超高性价比)',
      asrGpt: 'OpenAI GPT Transcribe (高精度多语种转写 · 标点纠错)',
      vadEngineLabel: '端侧切音 (VAD):',
      vadEngineEnergy: '端侧能量自适应引擎 (内置 · 零消耗 · 秒开) · 默认',
      vadEngineSilero: 'Silero 深度神经网络引擎 (ONNX · 极致抗噪 · 深度学习)',
      vadStatusText: '端侧 VAD 智能静音切除已强制启用（自动滤除环境杂音与死寂停顿，大幅降低调用时长并根除幻觉）',

      ttsTitle: '语音朗读模型 (TTS)',
      ttsHint: 'AI 回复朗读时的发音引擎，支持超自然拟真云端模型与免消耗本地引擎。',
      ttsOptgroupCloud: '推荐云端大模型 (超自然音色 · 细腻拟真)',
      ttsOptgroupLocal: '本地设备原生引擎 (零网络消耗 · 离线可用)',
      ttsGemini: 'Google Gemini 3.1 Flash TTS Preview (70+ 多语言 · 细腻情感) · 推荐',
      ttsQwen: '阿里通义千问 Qwen-Audio-3.0-TTS-Plus (顶级中文与方言)',
      ttsGrok: 'xAI Grok Voice TTS 1.0 (拟真语调 · 动态表达)',
      ttsVoiceLabel: '发音音色 (Voice):',
      ttsVoiceOptgroupGoogle: 'Google 拟真音色 (Gemini)',
      ttsVoiceOptgroupXai: 'xAI 拟真音色 (Grok)',
      ttsVoiceOptgroupQwen: '阿里通义音色 (Qwen)',
      ttsVoiceKore: 'Kore (知性自然女声 · 推荐)',
      ttsVoicePuck: 'Puck (活力生动男声)',
      ttsVoiceAoede: 'Aoede (温和优雅女声)',
      ttsVoiceFenrir: 'Fenrir (沉稳磁性男声)',
      ttsVoiceCharon: 'Charon (深沉专业男声)',
      ttsVoiceAra: 'Ara (亲切温暖女声 · 推荐)',
      ttsVoiceEve: 'Eve (活力明快女声)',
      ttsVoiceLeo: 'Leo (沉稳权威男声)',
      ttsVoiceRex: 'Rex (自信清晰男声)',
      ttsVoiceSal: 'Sal (平衡自然男声)',
      ttsVoiceLingxin: '灵心 (温暖亲切女声 · 推荐)',
      ttsVoiceLufeng: '陆峰 (阳光明快男声)',
      ttsVoiceAlexander: 'Alexander (沉稳从容男声)',
      ttsVoiceIvy: 'Ivy (知性干练女声)',
      ttsBrowserOption: '浏览器本地原生语音 (Web Speech API)',
      ttsBadge: '默认启用本地原生语音引擎（零 Token 计费）；选择云端大模型可体验细腻拟真音色。',
      selectOption: '选择配置项',

      versionTitle: '系统与版本',
      versionHint: '检查版本更新',
      versionLatest: '当前已是最新版本',
      versionHasUpdate: '发现新版本 v{version}，点击设置中的按钮即可更新',
      versionCheckBtn: '检查更新',
      versionRestartBtn: '立即重启更新',
      versionChecking: '正在检查…',
      versionApplying: '正在应用更新…',
      versionCheckFail: '检查更新失败，请稍后重试',

      resetSettings: '清空设定',
      saveSettings: '保存并应用',
      settingsSaved: '偏好设置已保存并应用',
    },
    gate: {
      title: '工作台身份验证',
      desc: '请输入管理员分配的访问口令 (Access Token) 以解锁个人 AI 工作台',
      placeholder: '输入访问口令…',
      btn: '验证并进入',
      emptyToken: '请输入访问口令',
    },
    updateBanner: {
      title: '发现新版本',
      currentVer: '（当前 v{version}）',
      reloadBtn: '立即更新',
      updatingBtn: '正在更新…',
      laterBtn: '稍后',
      laterTooltip: '2小时后再次提醒',
      closeTooltip: '关闭 (稍后提醒)',
    },
    tts: {
      voiceLabel: '音色:',
      speed: '倍速:',
      loadingVoice: '载入音色中…',
      loadingAudio: '正在加载音频…',
      play: '播放',
      pause: '暂停',
      emptyContent: '回复内容为空，无法朗读',
      stopped: '朗读已停止',
      notSupported: '当前浏览器不支持 Web Speech API',
      error: '云端音频播放异常',
    },
    attachments: {
      maxFiles: '单次提问最多附加 8 个附件',
      unsupportedImage: '当前模型不支持图片，已忽略 "{name}"',
      imageFail: '处理图片 "{name}" 失败: {error}',
      fileFail: '读取文件 "{name}" 失败: {error}',
      removeTooltip: '移除此附件',
      truncatedText: '[... 文件过长，已自动截取前 {max} 字符 ...]',
      pdfPageHeader: '--- 第 {page} 页 ---',
      truncatedPdf: '[... PDF 内容过长，已自动截取前 {max} 字符 ...]',
      invalidImageFormat: '所选文件不是有效的图片格式',
      imageTooLarge: '图片大小超过 {max}MB 上限',
      imageDecodeError: '无法解码该图片文件',
      imageReadError: '读取图片文件失败',
      fileTooLarge: '文件超过 {max}MB 上限',
      fileReadError: '读取文件失败',
      pdfReadError: '读取 PDF 失败',
      pdfJsError: '无法动态载入 PDF.js 模块，请检查网络',
    },
    errors: {
      noCredit: '该模型要求账户余额大于 0（ZenMux 的防滥用策略，不是扣费）。充一点余额即可解锁。',
      rateLimit: '该模型当前访问量过大被限流，稍后重试或换一个模型。',
      unauthorized: '访问口令不正确，请点右上角退出后重新输入。',
      rejected: '请求被上游拒绝：{message}',
      unsupportedFormat: '参数格式不被该模型支持',
      imageTimeout: '生图超时 (HTTP 504)：上游模型渲染耗时过长，超出了边缘函数执行时限。建议稍后重试或尝试切换其他生图模型。',
      gateway502: '网关异常 (HTTP 502)：{error}',
      edgeFail: '边缘节点连接 ZenMux 失败，稍后重试。',
      missingApiKey: '服务端未配置 ZENMUX_API_KEY，请到 EdgeOne 控制台补上环境变量并重新部署。',
      serviceUnavailable: '边缘网关返回异常状态 (HTTP {status})，服务暂时不可用，请稍后重试。',
      noStreamBody: '服务端未返回流，反代可能不支持 SSE',
      imageGenFailed: '生图失败 (HTTP {status}): {detail}',
      imageServiceError: '图像生成服务异常',
      noValidImageData: '上游未返回有效的图像数据',
    },
    share: {
      modalTitle: '保存与分享',
      modalSubtitle: '将当前会话生成精美的独立静态网页快照，托管于 here.now',
      selectCurrent: '仅选当前轮',
      selectAll: '全选会话',
      selectAllLink: '全选会话',
      clearAll: '清空选择',
      selectedBadge: '已选 {selected} / {total} 轮交互',
      drawerHint: '点击上方任意对话即可自由选入或移出分享内容。',
      retentionLabel: '保留策略',
      ttl7d: '7 天有效 (推荐)',
      ttl14d: '14 天有效',
      ttl30d: '30 天有效',
      ttlPermanent: '永久保留',
      includeReasoning: '包含思考过程 (Reasoning)',
      includeMetrics: '包含模型与 Token 统计',
      publishBtn: '生成并发布分享链接',
      publishing: '正在生成并发布快照…',
      publishSuccess: '分享链接已就绪',
      statusPermanent: '永久有效',
      statusDaysRemain: '剩余 {days} 天',
      statusHoursRemain: '剩余不到 1 天',
      statusExpired: '已过期',
      copyLink: '复制链接',
      openLink: '在新标签页打开',
      expiresNotice: '该快照将于 {date} 自动过期。',
      shareFailed: '分享发布失败: {error}',
      emptySelection: '请至少选择一轮对话进行分享',
      copied: '分享链接已复制到剪贴板',
      retrievedSuccess: '链接已复制到剪贴板',
      updateSnapshot: '重新选择',
      updateBtn: '更新此分享链接内容',
      updating: '正在更新并同步快照…',
      updateSuccess: '分享链接内容已更新并已复制到剪贴板',
      alreadySharedNotice: '该回答已存在分享链接，您可以直接复制或调整选择后更新原网页。',
      emptySession: '当前会话没有可分享的内容',
      noDyads: '当前会话暂无完整的问答交互',
      turnNumber: '第 {number} 轮交互',
      userRole: '用户',
      asstRole: 'AI 助手',
      forkBtn: '在 ZenChat 中继续',
      importing: '正在导入会话...',
      importSuccess: '会话已成功导入',
      importFailed: '导入会话失败',
    }
  },

  en: {
    common: {
      save: 'Save',
      cancel: 'Cancel',
      close: 'Close',
      copy: 'Copy',
      copied: 'Copied to clipboard',
      copyFailed: 'Copy failed, please copy manually',
      clear: 'Clear',
      delete: 'Delete',
      edit: 'Edit',
      add: 'Add',
      loading: 'Loading...',
      error: 'Error',
      default: 'Default',
      recommended: 'Recommended',
    },
    sidebar: {
      brand: 'ZenChat',
      newChat: '+ New Chat',
      collapse: 'Collapse sidebar',
      expand: 'Expand sidebar',
      resizeTitle: 'Drag to resize sidebar width, double-click to reset',
      localOnly: 'Chats stored locally in browser',
      localTokens: 'Stored locally · {total} Tokens used',
      deleteConfirm: 'Are you sure you want to delete chat "{title}"? This cannot be undone.',
      deleteFailed: 'Failed to delete: {error}',
      newChatTitle: 'New Chat',
      doubleClickToRename: 'Double-click to rename',
      rename: 'Rename',
      deleteTooltip: 'Delete chat',
    },
    topbar: {
      modelPickerTitle: 'Select Model',
      modelLoading: 'Loading models...',
      modelSearchPlaceholder: 'Search models or providers...',
      modelSearchClear: 'Clear search',
      modelEmpty: 'No matching models found',
      modelFetchFailed: 'Failed to fetch model list: {error} (manual entry supported)',
      shareTitle: 'Save & Share Session Snapshot',
      settingsTitle: 'Preferences and System Instructions',
      logout: 'Log out',
    },
    models: {
      selectModelPlaceholder: 'Select model...',
      noModelsAvailable: 'No models available',
      imageGenGroup: 'Image Generation',
      imageGen: 'Image',
      vision: 'Vision',
      reasoning: 'Reasoning',
      free: 'Free',
      otherGroup: 'Other',
    },
    params: {
      effortTitleSupported: 'Reasoning Effort: ZenMux defaults to medium if omitted',
      effortTitleLoading: 'Reasoning Effort (Loading model info)',
      effortTitleUnsupported: 'Current model does not support reasoning',
      effortTitle: 'Reasoning Effort: Only applies to reasoning models',
      effortDefault: 'Reasoning Default',
      effortMinimal: 'Reasoning Minimal',
      effortLow: 'Reasoning Low',
      effortMedium: 'Reasoning Medium',
      effortHigh: 'Reasoning High',
      effortOff: 'Reasoning Off',

      searchDepthTitle: 'Web Search Depth: Quick, Standard, Deep, or Pro',
      searchDepthStandard: 'Search Standard',
      searchDepthQuick: 'Search Quick',
      searchDepthDeep: 'Search Deep',
      searchDepthPro: 'Search Pro',

      toolTurnsTitle: 'Max Tool Turns: Default 20, Deep 50, Pro 100, or Unlimited',
      toolTurns20: 'Tools 20',
      toolTurns50: 'Tools 50',
      toolTurns100: 'Tools 100',
      toolTurnsUnlimited: 'Tools Unlimited',

      ctxTitle: 'Context Length: Compact, Standard, Long, or Full',
      ctx10: 'Context Compact',
      ctx20: 'Context Standard',
      ctx40: 'Context Long',
      ctx0: 'Context Full',

      imageSizeTitle: 'Image Size and Aspect Ratio',
      imageSizeAuto: 'Size Auto',
      imageSize1024: 'Size 1:1 Square (1K)',
      imageSize1536x1024: 'Size 3:2 Landscape',
      imageSize1024x1536: 'Size 2:3 Portrait',
      imageSize2k: 'Size 2K Ultra',

      imageQualityTitle: 'Image Quality and Fidelity',
      imageQualityAuto: 'Quality Auto',
      imageQualityHigh: 'Quality High',
      imageQualityMedium: 'Quality Standard',
      imageQualityLow: 'Quality Fast',

      imageBgTitle: 'Background Transparency',
      imageBgAuto: 'Background Default',
      imageBgTransparent: 'Background Transparent (PNG)',
      imageBgOpaque: 'Background Opaque',
    },
    composer: {
      attachTitle: 'Attach images or files (code, text, spreadsheets, PDF, etc.)',
      pluginsTitle: 'Extensions and Smart Tools',
      pluginsText: 'Plugins',
      voiceTitle: 'Voice input (click to speak, real-time speech-to-text)',
      inputPlaceholder: 'Type a message or drop files/images. Enter to send',
      voiceListening: 'Listening...',
      voiceApproachingLimit: 'Approaching time limit ({remaining}s remaining)',
      voiceLimitReached: 'Time limit reached, transcribing...',
      voiceTranscribing: 'Transcribing speech...',
      voiceCompleted: 'Speech recognition complete',
      voiceNoAudio: 'No speech detected',
      voiceHoldToSpeak: 'Hold to Speak',
      voiceReleaseToSend: 'Release to Finish',
      voiceShortTapWarning: 'Hold to speak, release to finish',
      voiceSwitchToText: 'Switch to keyboard input',
      voiceSwitchToVoice: 'Switch to push-to-talk',
      voiceRecording: 'Recording',
      voiceSlideToCancel: '▲ Slide up to cancel · Release to send',
      voiceReleaseToCancel: '✕ Release to cancel',
      voiceCancelled: 'Recording cancelled',
      stopTitle: 'Stop',
      sendTitle: 'Send',
      startImageGen: 'Generate Image (Enter)',
      imageInputPlaceholder: 'Describe the image you want to generate (Prompt), Enter to start drawing...',
      dropHint: 'Drop files or images here',
    },
    chat: {
      emptyWithModel: 'Start a conversation. Drag and drop code, spreadsheets, or images to analyze',
      emptyNoModel: 'Please select a model above first',
      thinkingProcess: 'Thinking Process',
      sourcesTitle: 'Sources ({count} web pages)',
      linesCount: '{count} lines',
      imageAlt: 'Image',
      imageExpired: 'Image data expired',
      imageExpiredDesc1: '· Local binary image not retained (IndexedDB cache cleared or omitted)',
      imageExpiredDesc2: '· Remote image link expired or not provided',
      copyPrompt: 'Copy Prompt',
      promptCopied: 'Prompt copied to clipboard',
      imageReadError: 'Failed to read local image',
      copyResponse: 'Copy',
      copyResponseTooltip: 'Copy response content',
      regenerate: 'Regenerate',
      regenerateTooltip: 'Regenerate response with current model',
      busyWaiting: 'AI is generating a response, please wait...',
      readAloud: 'Read',
      readAloudTooltip: 'Open audio speech player',
      share: 'Share',
      shareTooltip: 'Share or save this interaction as a web snapshot',
      usageBtnTooltip: 'Toggle Token usage and model details',
      usageInput: 'Input',
      usageOutput: 'Output',
      usageTurnTotal: 'Turn Total',
      usageSessionTotal: 'Session Total',
      usageModel: 'Responding Model: {model}',
      selectModelFirst: 'Please select a model first',
      noVisionSupport: 'Current model does not support images. Switch to a vision-capable model',
      noPreviousUserMsg: 'Previous user message not found',
      themeSwitchedLight: 'Switched to light theme',
      themeSwitchedDark: 'Switched to dark theme',
      imageRenderingProgress: 'Scheduling rendering engine ({elapsed}s)...',
      imageCancelled: 'Image generation cancelled.',
      imageFailed: 'Image generation failed: {message}',
    },
    pluginsModal: {
      title: 'Extensions & Smart Tools',
      desc: 'Active plugins are injected into model decision flows, enabling autonomous execution during reasoning.',
      activeSummary: '{count} plugins enabled',
      enableAll: 'Enable All',
      disableAll: 'Disable All',
      closeTooltip: 'Close (Esc)',
    },
    settings: {
      title: 'Preferences',
      closeTooltip: 'Close (Esc)',
      languageTitle: 'Interface Language',
      languageHint: 'Select interface display language',
      langZh: '简体中文',
      langEn: 'English',

      appearanceTitle: 'Appearance',
      appearanceHint: 'Choose your preferred display theme',
      themeDark: 'Dark Mode',
      themeLight: 'Light Mode',
      themeAuto: 'System',

      shareRetentionTitle: 'Default Share Retention',
      shareRetentionHint: 'Default lifespan for newly created share links, adjustable per share',

      instructionsTitle: 'Custom Instructions',
      instructionsToggleTitle: 'Enable or pause custom instructions',
      instructionsHint: 'Tell the AI your background or desired style to follow in every conversation.',
      presetsLabel: 'Presets:',
      presetEngineer: 'Senior Engineer',
      presetEngineerPrompt: 'You are a senior full-stack engineer. Follow best practices, providing concise, high-quality code and clear technical analysis without fluff.',
      presetScholar: 'Rigorous Scholar',
      presetScholarPrompt: 'Respond in a rigorous, objective, and scholarly tone, emphasizing logical deduction and structured arguments.',
      presetMinimal: 'Concise Bullets',
      presetMinimalPrompt: 'Be concise and direct. Eliminate all pleasantries and present conclusions using bullet points and tables.',
      presetTranslator: 'Translator',
      presetTranslatorPrompt: 'You are a professional bilingual translator. Translate accurately, idiomatically, and elegantly, with key terminology comparisons.',
      instructionsPlaceholder: 'e.g., I am a full-stack developer. Provide clear code and core conclusions directly without pleasantries...',
      charCount: '{count} characters',

      memoryTitle: 'Long-Term Memory',
      memoryToggleTitle: 'Enable or disable long-term memory',
      memoryHint: 'When enabled, the AI remembers your key preferences across chats. Click any item to edit. Data is saved only in your local browser.',
      memoryPlaceholder: 'Enter something for AI to remember (e.g. prefer concise answers, use Python)...',
      memoryAddBtn: '+ Add',
      memoryEmpty: 'No long-term memories saved. Tell the AI to remember things in chat or add manually above.',
      memoryCount: '{count} memories saved',
      memoryClearAll: 'Clear All Memories',
      memoryClearConfirm: 'Are you sure you want to clear all {count} memories? This cannot be undone.',
      memoryDeleted: 'Memory deleted',
      memoryEmptyWarning: 'Memory content cannot be empty. Click the delete button to remove it.',
      memoryUpdated: 'Memory updated',
      memoryAdded: 'New memory added',
      memoryCleared: 'All memories cleared',
      memoryToggleToastOn: 'Long-term memory enabled',
      memoryToggleToastOff: 'Long-term memory disabled',

      asrTitle: 'Speech Recognition (ASR)',
      asrHint: 'Triggers on-device VAD noise suppression and high-accuracy cloud ASR when clicking the microphone.',
      asrOptgroupChinese: 'Recommended Chinese Models (High Accuracy · Robust · Cost-Effective)',
      asrOptgroupGlobal: 'Global & Multilingual Models',
      asrDoubao: 'ByteDance Doubao ASR (Doubao-Seed-ASR-2.0) · Recommended',
      asrQwen: 'Alibaba Qwen3 ASR Flash (Non-autoregressive ms latency)',
      asrMimo: 'Xiaomi MiMo-V2.5-ASR (Bilingual CN/EN · Noise-robust)',
      asrGrok: 'xAI Grok Voice STT 1.0 (Word timestamps · High cost-performance)',
      asrGpt: 'OpenAI GPT Transcribe (High accuracy multilingual · Punctuation)',
      vadEngineLabel: 'On-Device VAD:',
      vadEngineEnergy: 'On-Device Energy Adaptive (Built-in · Zero Cost · Instant) · Default',
      vadEngineSilero: 'Silero Neural Network Engine (ONNX · Superior Noise Rejection · Deep Learning)',
      vadStatusText: 'On-device VAD silence trimming active (cuts ambient noise and dead pauses to lower latency and prevent hallucinations)',

      ttsTitle: 'Speech Synthesis (TTS)',
      ttsHint: 'Voice engine for reading responses aloud, supporting neural cloud voices and local engines.',
      ttsOptgroupCloud: 'Recommended Cloud Models (Ultra-Natural · Expressive)',
      ttsOptgroupLocal: 'On-Device Native Engine (Zero Network Cost · Offline)',
      ttsGemini: 'Google Gemini 3.1 Flash TTS Preview (70+ Languages · Expressive) · Recommended',
      ttsQwen: 'Alibaba Qwen-Audio-3.0-TTS-Plus (Premium Chinese & Dialects)',
      ttsGrok: 'xAI Grok Voice TTS 1.0 (Lifelike prosody · Dynamic expression)',
      ttsVoiceLabel: 'Voice Tone:',
      ttsVoiceOptgroupGoogle: 'Google Neural Voices (Gemini)',
      ttsVoiceOptgroupXai: 'xAI Neural Voices (Grok)',
      ttsVoiceOptgroupQwen: 'Alibaba Qwen Voices',
      ttsVoiceKore: 'Kore (Natural & Warm Female · Recommended)',
      ttsVoicePuck: 'Puck (Energetic & Vivid Male)',
      ttsVoiceAoede: 'Aoede (Gentle & Elegant Female)',
      ttsVoiceFenrir: 'Fenrir (Deep & Resonant Male)',
      ttsVoiceCharon: 'Charon (Authoritative Professional Male)',
      ttsVoiceAra: 'Ara (Friendly & Warm Female · Recommended)',
      ttsVoiceEve: 'Eve (Lively & Crisp Female)',
      ttsVoiceLeo: 'Leo (Calm & Authoritative Male)',
      ttsVoiceRex: 'Rex (Confident & Articulate Male)',
      ttsVoiceSal: 'Sal (Balanced & Natural Male)',
      ttsVoiceLingxin: 'Lingxin (Warm & Affectionate Female · Recommended)',
      ttsVoiceLufeng: 'Lufeng (Sunny & Cheerful Male)',
      ttsVoiceAlexander: 'Alexander (Composed & Steady Male)',
      ttsVoiceIvy: 'Ivy (Intellectual & Capable Female)',
      ttsBrowserOption: 'Native Browser Speech (Web Speech API)',
      ttsBadge: 'Local speech engine enabled by default (zero token cost). Select cloud models for expressive voices.',
      selectOption: 'Select Option',

      versionTitle: 'System & Version',
      versionHint: 'Check for version updates',
      versionLatest: 'Up to date',
      versionHasUpdate: 'New version v{version} available. Click button to update',
      versionCheckBtn: 'Check for Updates',
      versionRestartBtn: 'Restart to Update',
      versionChecking: 'Checking...',
      versionApplying: 'Applying update...',
      versionCheckFail: 'Failed to check for updates, please try again later',

      resetSettings: 'Reset All',
      saveSettings: 'Save & Apply',
      settingsSaved: 'Preferences saved and applied',
    },
    gate: {
      title: 'Workspace Authentication',
      desc: 'Please enter your assigned Access Token to unlock your AI workspace',
      placeholder: 'Enter access token...',
      btn: 'Verify & Enter',
      emptyToken: 'Please enter an access token',
    },
    updateBanner: {
      title: 'New version available',
      currentVer: '(Current v{version})',
      reloadBtn: 'Update Now',
      updatingBtn: 'Updating...',
      laterBtn: 'Later',
      laterTooltip: 'Remind me in 2 hours',
      closeTooltip: 'Close (remind later)',
    },
    tts: {
      voiceLabel: 'Voice:',
      speed: 'Speed:',
      loadingVoice: 'Loading voices...',
      loadingAudio: 'Loading audio...',
      play: 'Play',
      pause: 'Pause',
      emptyContent: 'Response is empty, cannot read aloud',
      stopped: 'Playback stopped',
      notSupported: 'Web Speech API is not supported in this browser',
      error: 'Cloud audio playback error',
    },
    attachments: {
      maxFiles: 'Maximum 8 attachments per message',
      unsupportedImage: 'Current model does not support images, ignored "{name}"',
      imageFail: 'Failed to process image "{name}": {error}',
      fileFail: 'Failed to read file "{name}": {error}',
      removeTooltip: 'Remove attachment',
      truncatedText: '[... File too long, truncated to first {max} characters ...]',
      pdfPageHeader: '--- Page {page} ---',
      truncatedPdf: '[... PDF too long, truncated to first {max} characters ...]',
      invalidImageFormat: 'Selected file is not a valid image format',
      imageTooLarge: 'Image size exceeds {max}MB limit',
      imageDecodeError: 'Unable to decode image file',
      imageReadError: 'Failed to read image file',
      fileTooLarge: 'File exceeds {max}MB limit',
      fileReadError: 'Failed to read file',
      pdfReadError: 'Failed to read PDF',
      pdfJsError: 'Unable to dynamically load PDF.js module, please check connection',
    },
    errors: {
      noCredit: 'This model requires an account balance > 0 (ZenMux anti-abuse policy, not billing). Add a small balance to unlock.',
      rateLimit: 'Rate limit exceeded for this model. Please try again later or switch to another model.',
      unauthorized: 'Invalid access token. Please log out and re-enter your token.',
      rejected: 'Request rejected by upstream: {message}',
      unsupportedFormat: 'Parameter format is not supported by this model',
      imageTimeout: 'Image generation timed out (HTTP 504): upstream took too long. Please try again or switch models.',
      gateway502: 'Gateway error (HTTP 502): {error}',
      edgeFail: 'Failed to connect to ZenMux edge node. Please try again later.',
      missingApiKey: 'Server missing ZENMUX_API_KEY. Please configure environment variable in EdgeOne console and redeploy.',
      serviceUnavailable: 'Edge gateway returned status (HTTP {status}). Service temporarily unavailable, please try again later.',
      noStreamBody: 'Server returned no stream body; reverse proxy might not support SSE',
      imageGenFailed: 'Image generation failed (HTTP {status}): {detail}',
      imageServiceError: 'Image generation service error',
      noValidImageData: 'Upstream returned no valid image data',
    },
    share: {
      modalTitle: 'Save & Share',
      modalSubtitle: 'Generate an elegant standalone web snapshot hosted on here.now',
      selectCurrent: 'Current Turn Only',
      selectAll: 'Select All',
      selectAllLink: 'Select All',
      clearAll: 'Clear Selection',
      selectedBadge: '{selected} / {total} turns selected',
      drawerHint: 'Click any message turn above to toggle inclusion.',
      retentionLabel: 'Retention Policy',
      ttl7d: '7 Days (Recommended)',
      ttl14d: '14 Days',
      ttl30d: '30 Days',
      ttlPermanent: 'Permanent',
      includeReasoning: 'Include Thinking Process',
      includeMetrics: 'Include Model & Token Metrics',
      publishBtn: 'Generate & Publish Share Link',
      publishing: 'Generating & publishing snapshot…',
      publishSuccess: 'Share Link Ready',
      statusPermanent: 'Permanent',
      statusDaysRemain: '{days} days remain',
      statusHoursRemain: '< 24h remain',
      statusExpired: 'Expired',
      copyLink: 'Copy Link',
      openLink: 'Open in New Tab',
      expiresNotice: 'This snapshot will expire on {date}.',
      shareFailed: 'Failed to share session: {error}',
      emptySelection: 'Please select at least one interaction to share',
      copied: 'Share link copied to clipboard',
      retrievedSuccess: 'Link copied to clipboard.',
      updateSnapshot: 'Reselect',
      updateBtn: 'Update Share Link Content',
      updating: 'Updating snapshot in-place…',
      updateSuccess: 'Share link updated in-place and copied to clipboard',
      alreadySharedNotice: 'A share link already exists for this response. You can copy it directly or modify selections and update.',
      emptySession: 'Current session has no content to share',
      noDyads: 'No complete prompt-response interactions found',
      turnNumber: 'Turn #{number}',
      userRole: 'User',
      asstRole: 'Assistant',
      forkBtn: 'Continue in ZenChat',
      importing: 'Importing conversation...',
      importSuccess: 'Conversation successfully imported',
      importFailed: 'Failed to import conversation',
    }
  }
};

/**
 * Resolve translation key using dot notation and interpolate variable placeholders.
 * E.g., t('composer.voiceApproachingLimit', { remaining: 5 })
 */
export function t(path, params = {}) {
  const lang = (state && state.lang) || 'zh';
  const dict = TRANSLATIONS[lang] || TRANSLATIONS.zh;
  const fallbackDict = TRANSLATIONS.en || TRANSLATIONS.zh;

  let val = path.split('.').reduce((acc, part) => (acc && acc[part] !== undefined ? acc[part] : undefined), dict);

  // Fallback to secondary locale if missing
  if (val === undefined) {
    val = path.split('.').reduce((acc, part) => (acc && acc[part] !== undefined ? acc[part] : undefined), fallbackDict);
  }

  if (typeof val !== 'string') {
    return path;
  }

  // Parameter interpolation: {variable}
  if (params && typeof params === 'object') {
    return val.replace(/\{(\w+)\}/g, (match, key) => (params[key] !== undefined ? params[key] : match));
  }

  return val;
}

/**
 * Returns current active language code ('zh' or 'en').
 */
export function getLanguage() {
  return (state && state.lang) || 'zh';
}

/**
 * Switch application language, persist to localStorage, synchronize HTML tag,
 * trigger declarative DOM translation, and fire 'languagechange' event.
 */
export function setLanguage(lang) {
  const target = (lang === 'en' ? 'en' : 'zh');
  state.lang = target;
  try {
    localStorage.setItem(LS.lang, target);
  } catch (_) { }

  // Synchronize HTML lang attribute
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.setAttribute('lang', target === 'zh' ? 'zh-CN' : 'en');
  }

  // Synchronize declarative DOM elements
  applyTranslations();

  // Dispatch custom event for components requiring imperative re-rendering
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('languagechange', { detail: { lang: target } }));
  }
}

/**
 * Declaratively hydrates all elements matching [data-i18n*] attributes within given root container.
 */
export function applyTranslations(root = document) {
  if (!root || typeof root.querySelectorAll !== 'function') return;

  // 1. Text content: [data-i18n="key"]
  root.querySelectorAll('[data-i18n]').forEach((node) => {
    const key = node.getAttribute('data-i18n');
    if (key) {
      const translated = t(key);
      if (translated && translated !== key) {
        node.textContent = translated;
      }
    }
  });

  // 2. Input placeholders: [data-i18n-placeholder="key"]
  root.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
    const key = node.getAttribute('data-i18n-placeholder');
    if (key) {
      const translated = t(key);
      if (translated && translated !== key) {
        node.placeholder = translated;
      }
    }
  });

  // 3. Tooltips & titles: [data-i18n-title="key"]
  root.querySelectorAll('[data-i18n-title]').forEach((node) => {
    const key = node.getAttribute('data-i18n-title');
    if (key) {
      const translated = t(key);
      if (translated && translated !== key) {
        node.title = translated;
      }
    }
  });

  // 4. Accessibility aria labels: [data-i18n-aria="key"]
  root.querySelectorAll('[data-i18n-aria]').forEach((node) => {
    const key = node.getAttribute('data-i18n-aria');
    if (key) {
      const translated = t(key);
      if (translated && translated !== key) {
        node.setAttribute('aria-label', translated);
      }
    }
  });

  // 5. Optgroup labels: [data-i18n-label="key"]
  root.querySelectorAll('[data-i18n-label]').forEach((node) => {
    const key = node.getAttribute('data-i18n-label');
    if (key) {
      const translated = t(key);
      if (translated && translated !== key) {
        node.label = translated;
      }
    }
  });

  // 6. Image alt text: [data-i18n-alt="key"]
  root.querySelectorAll('[data-i18n-alt]').forEach((node) => {
    const key = node.getAttribute('data-i18n-alt');
    if (key) {
      const translated = t(key);
      if (translated && translated !== key) {
        node.alt = translated;
      }
    }
  });
}

/**
 * Initialize application language on boot:
 * 1. Inspect localStorage ('zm.lang').
 * 2. Fall back to navigator.language.
 * 3. Synchronize HTML lang attribute and apply initial translations.
 */
export function initI18n() {
  let stored = null;
  try {
    stored = localStorage.getItem(LS.lang);
  } catch (_) { }

  let lang = stored;
  if (!lang || (lang !== 'zh' && lang !== 'en')) {
    lang = (typeof navigator !== 'undefined' && navigator.language && navigator.language.startsWith('zh')) ? 'zh' : 'en';
  }

  state.lang = lang;
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.setAttribute('lang', lang === 'zh' ? 'zh-CN' : 'en');
  }

  applyTranslations();
  return lang;
}
