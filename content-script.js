// nimi content-script.js
// 实现全文摘要、划词点问、浮窗/侧边栏功能

// 动态加载加密工具
let CryptoUtils = null;
try {
  // 尝试从全局作用域获取CryptoUtils
  if (typeof CryptoUtils === 'undefined') {
    // 如果popup已经加载了crypto-utils.js，它可能在全局作用域
    CryptoUtils = window.CryptoUtils || null;
  }
} catch (error) {
  console.warn('无法加载CryptoUtils:', error);
}

// 如果CryptoUtils不可用，创建一个简单的替代版本
if (!CryptoUtils) {
  console.warn('CryptoUtils不可用，使用简单替代版本');
  CryptoUtils = {
    secureDecode: function(encodedKey) {
      // 简单替代：如果是安全格式，尝试解码，否则返回原值
      if (!encodedKey) return '';
      if (encodedKey.startsWith('nimi_secure_')) {
        try {
          // 简单解码逻辑
          const withoutPrefix = encodedKey.substring('nimi_secure_'.length);
          const reversed = withoutPrefix.split('').reverse().join('');
          return decodeURIComponent(escape(atob(reversed)));
        } catch (error) {
          console.warn('简单解码失败:', error);
          return encodedKey;
        }
      }
      return encodedKey;
    },
    isSecureFormat: function(str) {
      return str && str.startsWith('nimi_secure_');
    },
    migrateToSecureFormat: function(oldKey) {
      if (!oldKey) return '';
      if (this.isSecureFormat(oldKey)) return oldKey;
      // 简单编码
      try {
        const base64 = btoa(unescape(encodeURIComponent(oldKey)));
        const reversed = base64.split('').reverse().join('');
        return 'nimi_secure_' + reversed;
      } catch (error) {
        console.error('简单编码失败:', error);
        return oldKey;
      }
    }
  };
}

class NimiMini {
  constructor() {
    this.isFloatingWindowOpen = false;
    this.isSidebarOpen = false;
    this.currentTab = null;
    this.settings = null;
    this.tooltipHistory = new Map(); // 存储历史tooltip，避免刷新丢失
    this.currentChatSession = null; // 当前对话会话ID
    this.chatSessions = new Map(); // 对话会话管理
    this.init();
  }

  async init() {
    await this.loadSettings();
    this.setupUI();
    this.bindEvents();
    this.bindEscapeKey();
    this.restoreState();

    // 自动迁移API Key到安全格式
    await this.migrateApiKeyToSecureFormat();
  }

  // 加载设置
  async loadSettings() {
    try {
      const result = await chrome.storage.sync.get(['modelUrl', 'apiKey', 'modelName', 'apiType', 'userTemplates', 'displayMode']);

      // 安全解码API Key
      let decodedApiKey = '';
      if (result.apiKey) {
        try {
          decodedApiKey = CryptoUtils.secureDecode(result.apiKey);
        } catch (error) {
          console.warn('API Key解码失败，使用原值:', error);
          decodedApiKey = result.apiKey;
        }
      }

      this.settings = {
        modelUrl: result.modelUrl || 'https://api.siliconflow.cn/v1/chat/completions',
        apiKey: decodedApiKey || '',
        modelName: result.modelName || 'MiniMaxAI/MiniMax-M2',
        apiType: result.apiType || 'anthropic', // 默认使用Anthropic格式
        userTemplates: result.userTemplates || [
          '总结→中文→不超过 5 句',
          '解释→给 10 岁小孩能听懂',
          '翻译→英文'
        ],
        displayMode: result.displayMode || 'floating'
      };
    } catch (e) {
      console.error('加载设置失败:', e);
    }
  }

  // 初始化对话会话
  initChatSession() {
    if (!this.currentChatSession) {
      const sessionId = this.generateSessionId();
      this.currentChatSession = sessionId;
      this.chatSessions.set(sessionId, {
        id: sessionId,
        title: '新对话',
        messages: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        url: window.location.href
      });
      this.saveChatSessions();
    }
  }

  // 生成会话ID
  generateSessionId() {
    return 'chat_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  // 保存对话会话
  async saveChatSessions() {
    try {
      const sessionsData = Array.from(this.chatSessions.values());
      await chrome.storage.local.set({
        chatSessions: sessionsData,
        currentChatSession: this.currentChatSession
      });
    } catch (e) {
      console.error('保存对话会话失败:', e);
    }
  }

  // 加载对话会话
  async loadChatSessions() {
    try {
      const result = await chrome.storage.local.get(['chatSessions', 'currentChatSession']);
      if (result.chatSessions) {
        this.chatSessions.clear();
        result.chatSessions.forEach(session => {
          this.chatSessions.set(session.id, session);
        });
      }
      if (result.currentChatSession) {
        this.currentChatSession = result.currentChatSession;
      }
    } catch (e) {
      console.error('加载对话会话失败:', e);
    }
  }

  // 添加对话消息
  async addMessage(role, content) {
    if (!this.currentChatSession) {
      this.initChatSession();
    }

    const session = this.chatSessions.get(this.currentChatSession);
    if (session) {
      session.messages.push({
        role,
        content,
        timestamp: new Date().toISOString()
      });
      session.updatedAt = new Date().toISOString();

      // 自动生成会话标题（基于第一条用户消息）
      if (role === 'user' && session.messages.length === 1) {
        const title = content.length > 50 ? content.substring(0, 50) + '...' : content;
        session.title = title;
      }

      await this.saveChatSessions();
    }
  }

  // 获取当前对话上下文
  getChatContext() {
    if (!this.currentChatSession) {
      return [];
    }

    const session = this.chatSessions.get(this.currentChatSession);
    if (!session) {
      return [];
    }

    return session.messages;
  }

  // 获取AI上下文（限制最多10轮对话）
  getAIContext() {
    if (!this.currentChatSession) {
      return [];
    }

    const session = this.chatSessions.get(this.currentChatSession);
    if (!session) {
      return [];
    }

    // 限制最多10轮对话（20条消息）
    const maxMessages = 20; // 10轮对话，每轮用户和AI各一条
    if (session.messages.length <= maxMessages) {
      return session.messages;
    }

    // 返回最近20条消息
    return session.messages.slice(-maxMessages);
  }

  // 创建新对话
  createNewChat() {
    this.currentChatSession = null;
    this.initChatSession();
    return this.currentChatSession;
  }

  // 清除当前对话
  clearCurrentChat() {
    if (!this.currentChatSession) {
      return;
    }

    const session = this.chatSessions.get(this.currentChatSession);
    if (session) {
      // 清空消息，但保留会话
      session.messages = [];
      session.updatedAt = new Date().toISOString();
      session.title = '新对话';
      this.saveChatSessions();
    }
  }

  // 切换对话会话
  switchChatSession(sessionId) {
    if (this.chatSessions.has(sessionId)) {
      this.currentChatSession = sessionId;
      this.saveChatSessions();
      return true;
    }
    return false;
  }

  // 获取对话列表
  getChatList() {
    return Array.from(this.chatSessions.values())
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  // 恢复状态
  async restoreState() {
    try {
      const result = await chrome.storage.sync.get(['isFloatingOpen', 'isSidebarOpen']);
      if (result.isFloatingOpen) {
        this.showFloatingWindow();
      }
      if (result.isSidebarOpen) {
        this.showSidebar();
      }

      // 加载对话会话
      await this.loadChatSessions();
    } catch (e) {
      console.error('恢复状态失败:', e);
    }
  }

  // 设置UI
  setupUI() {
    // 创建浮动按钮（摘要触发器）
    this.floatingButton = document.createElement('div');
    this.floatingButton.id = 'nimi-mini-trigger';
    this.floatingButton.innerHTML = `
      <div class="nimi-trigger-btn">✨</div>
      <style>
        #nimi-mini-trigger {
          position: fixed;
          bottom: 20px;
          right: 20px;
          z-index: 10000;
        }
        .nimi-trigger-btn {
          width: 50px;
          height: 50px;
          border-radius: 50%;
          background: linear-gradient(135deg, #49bccf 0%, #3aa8c8 50%, #2d9ab7 100%);
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          box-shadow: 0 4px 15px rgba(73, 188, 207, 0.4);
          font-size: 20px;
          transition: transform 0.2s;
        }
        .nimi-trigger-btn:hover {
          transform: scale(1.1);
        }
      </style>
    `;
    document.body.appendChild(this.floatingButton);

    // 点击浮动按钮触发摘要
    this.floatingButton.addEventListener('click', () => {
      if (this.settings.displayMode === 'floating') {
        this.toggleFloatingWindow();
      } else {
        this.toggleSidebar();
      }
    });
  }

  // 绑定事件
  bindEvents() {
    // 接收来自background的消息
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'toggleWindow') {
        if (this.settings.displayMode === 'floating') {
          this.toggleFloatingWindow();
        } else {
          this.toggleSidebar();
        }
      }
    });

    // 划词事件
    document.addEventListener('mouseup', (e) => this.handleSelection(e));
    document.addEventListener('touchend', (e) => this.handleSelection(e));

    // 监听设置变化
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === 'sync') {
        this.loadSettings();
      }
    });
  }

  // 处理选中文本（划词点问）
  handleSelection(e) {
    const selection = window.getSelection();
    const selectedText = selection.toString().trim();

    if (selectedText.length > 3 && selectedText.length < 800) {
      // 移除之前的按钮
      const existingBtn = document.querySelector('.nimi-selection-btn');
      if (existingBtn) {
        existingBtn.remove();
      }

      // 创建按钮
      const btn = document.createElement('div');
      btn.className = 'nimi-selection-btn';
      btn.innerHTML = '💡 点我问';
      btn.style.cssText = `
        position: absolute;
        background: linear-gradient(135deg, #49bccf 0%, #3aa8c8 100%);
        color: white;
        padding: 6px 12px;
        border-radius: 15px;
        cursor: pointer;
        font-size: 12px;
        z-index: 10001;
        box-shadow: 0 2px 10px rgba(73, 188, 207, 0.4);
      `;

      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      btn.style.left = `${rect.left + window.scrollX}px`;
      btn.style.top = `${rect.top + window.scrollY - 30}px`;

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handleQuestion(selectedText, range);
      });

      document.body.appendChild(btn);

      // 点击其他地方移除按钮
      setTimeout(() => {
        document.addEventListener('click', (e) => {
          if (!btn.contains(e.target)) {
            btn.remove();
          }
        }, { once: true });
      }, 100);
    }
  }

  // 处理提问
  async handleQuestion(selectedText, range) {
    // 获取上下文（前后300字）
    const fullText = document.body.innerText;
    const selectionStart = fullText.indexOf(selectedText);
    const contextStart = Math.max(0, selectionStart - 300);
    const contextEnd = Math.min(fullText.length, selectionStart + selectedText.length + 300);
    const context = fullText.substring(contextStart, contextEnd);

    const prompt = `${selectedText}\n\n上下文：${context}\n\n请解释或回答问题。`;

    await this.callModel(prompt, range.commonAncestorContainer);
  }

  // 切换浮窗
  toggleFloatingWindow() {
    if (this.isFloatingWindowOpen) {
      this.hideFloatingWindow();
    } else {
      this.showFloatingWindow();
    }
  }

  // 显示浮窗
  showFloatingWindow() {
    if (!this.floatingWindow) {
      this.floatingWindow = document.createElement('div');
      this.floatingWindow.id = 'nimi-mini-floating';
      this.floatingWindow.style.width = '360px';
      this.floatingWindow.style.height = '480px';
      this.floatingWindow.innerHTML = `
        <div class="nimi-header">
          <span>✨ nimi</span>
          <div class="nimi-header-actions">
            <button class="nimi-copy-btn" title="复制结果 (Ctrl+C)">📋 复制</button>
            <button class="nimi-close-btn">×</button>
          </div>
        </div>
        <div class="nimi-tabs">
          <button class="nimi-tab active" data-tab="summary">📄 摘要</button>
          <!-- 对话功能暂不对外，隐藏标签页 -->
          <!-- <button class="nimi-tab" data-tab="chat">💬 对话</button> -->
        </div>
        <div class="nimi-content">
          <div class="nimi-tab-content nimi-summary-tab active">
            <button class="nimi-summarize-btn">📄 生成全文摘要</button>
            <div class="nimi-result"></div>
          </div>
          <!-- 对话功能暂不对外，隐藏面板 -->
          <!--
          <div class="nimi-tab-content nimi-chat-tab">
            <div class="nimi-chat-container">
              <div class="nimi-chat-messages"></div>
              <div class="nimi-chat-input-area">
                <textarea class="nimi-chat-input" placeholder="输入消息... (Shift+Enter换行，Enter发送)"></textarea>
                <div class="nimi-chat-actions">
                  <button class="nimi-clear-chat-btn" title="清除当前对话">🗑️</button>
                  <button class="nimi-new-chat-btn" title="新建对话">🆕</button>
                  <button class="nimi-send-btn" title="发送消息 (Enter)">发送</button>
                </div>
              </div>
            </div>
          </div>
          -->
        </div>
        <div class="nimi-copyright">@世界那么哒</div>
        <div class="nimi-resize-handle" title="拖拽调整大小"></div>
        <style>
          #nimi-mini-floating {
            position: fixed;
            bottom: 90px;
            right: 20px;
            width: 360px;
            height: 480px;
            background: white;
            border-radius: 12px;
            box-shadow: 0 8px 30px rgba(0,0,0,0.3);
            z-index: 10002;
            display: flex;
            flex-direction: column;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          }
          .nimi-header {
            padding: 12px 16px;
            border-bottom: 1px solid #eee;
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-weight: 600;
            color: #333;
            background: white;
            border-radius: 12px 12px 0 0;
          }
          .nimi-header-actions {
            display: flex;
            gap: 8px;
          }
          .nimi-copy-btn {
            background: linear-gradient(135deg, #49bccf 0%, #3aa8c8 100%);
            color: white;
            border: none;
            border-radius: 6px;
            padding: 4px 10px;
            font-size: 12px;
            cursor: pointer;
            transition: opacity 0.2s;
            box-shadow: 0 2px 8px rgba(73, 188, 207, 0.3);
          }
          .nimi-copy-btn:hover {
            opacity: 0.8;
          }
          .nimi-copy-btn:active {
            transform: scale(0.95);
          }
          .nimi-close-btn {
            background: none;
            border: none;
            font-size: 20px;
            cursor: pointer;
            color: #999;
            padding: 0;
            width: 24px;
            height: 24px;
            transition: color 0.2s;
          }
          .nimi-close-btn:hover {
            color: #ff6b6b;
          }
          .nimi-content {
            flex: 1;
            padding: 16px;
            overflow-y: auto;
          }
          .nimi-summarize-btn {
            width: 100%;
            padding: 12px;
            background: linear-gradient(135deg, #49bccf 0%, #3aa8c8 50%, #2d9ab7 100%);
            color: white;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 16px;
            box-shadow: 0 4px 15px rgba(73, 188, 207, 0.3);
          }
          .nimi-summarize-btn:hover {
            opacity: 0.9;
          }
          .nimi-result {
            font-size: 14px;
            line-height: 1.6;
            color: #333;
          }
          .nimi-result h1,
          .nimi-result h2,
          .nimi-result h3 {
            color: #2d9ab7;
            margin: 16px 0 12px 0;
            font-weight: 600;
          }
          .nimi-result h1 { font-size: 20px; }
          .nimi-result h2 { font-size: 18px; }
          .nimi-result h3 { font-size: 16px; }
          .nimi-result p {
            margin: 12px 0;
            line-height: 1.8;
          }
          .nimi-result strong {
            font-weight: 600;
            color: #2d9ab7;
          }
          .nimi-result code {
            background: #f0f8fa;
            padding: 2px 6px;
            border-radius: 4px;
            font-family: Monaco, monospace;
            font-size: 13px;
            color: #2d9ab7;
          }
          .nimi-result li {
            margin: 8px 0;
            padding-left: 8px;
          }
          .nimi-result a {
            color: #49bccf;
            text-decoration: none;
            border-bottom: 1px solid #49bccf;
          }
          .nimi-loading {
            text-align: center;
            color: #999;
            padding: 20px;
          }
          .nimi-resize-handle {
            position: absolute;
            bottom: 0;
            right: 0;
            width: 20px;
            height: 20px;
            cursor: nwse-resize;
            background: linear-gradient(135deg, transparent 50%, #ddd 50%);
            border-radius: 0 0 12px 0;
            transition: background 0.2s;
          }
          .nimi-resize-handle:hover {
            background: linear-gradient(135deg, transparent 50%, #49bccf 50%);
          }

          /* 标签页样式 */
          .nimi-tabs {
            display: flex;
            border-bottom: 1px solid #eee;
            background: #f8f9fa;
          }
          .nimi-tab {
            flex: 1;
            padding: 12px 16px;
            background: none;
            border: none;
            border-bottom: 2px solid transparent;
            cursor: pointer;
            font-size: 14px;
            color: #666;
            transition: all 0.2s;
          }
          .nimi-tab:hover {
            background: #e9ecef;
          }
          .nimi-tab.active {
            color: #49bccf;
            border-bottom-color: #49bccf;
            font-weight: 600;
          }

          /* 标签页内容 */
          .nimi-tab-content {
            display: none;
            flex: 1;
            flex-direction: column;
          }
          .nimi-tab-content.active {
            display: flex;
          }

          /* 对话样式 */
          .nimi-chat-container {
            flex: 1;
            display: flex;
            flex-direction: column;
            height: 100%;
          }
          .nimi-chat-messages {
            flex: 1;
            overflow-y: auto;
            padding: 16px;
            display: flex;
            flex-direction: column;
            gap: 12px;
          }
          .nimi-chat-message {
            max-width: 85%;
            padding: 10px 14px;
            border-radius: 12px;
            line-height: 1.5;
            font-size: 14px;
            word-wrap: break-word;
          }
          .nimi-chat-message.user {
            align-self: flex-end;
            background: linear-gradient(135deg, #49bccf 0%, #3aa8c8 100%);
            color: white;
            border-bottom-right-radius: 4px;
          }
          .nimi-chat-message.assistant {
            align-self: flex-start;
            background: #f0f8fa;
            color: #333;
            border-bottom-left-radius: 4px;
          }

          /* 对话消息中的Markdown样式 */
          .nimi-chat-message.assistant h1,
          .nimi-chat-message.assistant h2,
          .nimi-chat-message.assistant h3 {
            color: #2d9ab7;
            margin: 16px 0 12px 0;
            font-weight: 600;
          }
          .nimi-chat-message.assistant h1 { font-size: 20px; }
          .nimi-chat-message.assistant h2 { font-size: 18px; }
          .nimi-chat-message.assistant h3 { font-size: 16px; }
          .nimi-chat-message.assistant p {
            margin: 12px 0;
            line-height: 1.8;
          }
          .nimi-chat-message.assistant strong {
            font-weight: 600;
            color: #2d9ab7;
          }
          .nimi-chat-message.assistant code {
            background: linear-gradient(135deg, #f0f8fa 0%, #e8f8fa 100%);
            padding: 2px 6px;
            border-radius: 4px;
            font-family: Monaco, monospace;
            font-size: 13px;
            color: #2d9ab7;
            border: 1px solid #49bccf;
          }
          .nimi-chat-message.assistant li {
            margin: 8px 0;
            padding-left: 8px;
          }
          .nimi-chat-message.assistant a {
            color: #49bccf;
            text-decoration: none;
            border-bottom: 1px solid #49bccf;
            padding: 0 2px;
            transition: all 0.2s;
          }
          .nimi-chat-message.assistant a:hover {
            background: #e8f8fa;
            border-radius: 2px;
          }

          .nimi-chat-message .timestamp {
            font-size: 11px;
            opacity: 0.7;
            margin-top: 4px;
            text-align: right;
          }
          .nimi-chat-input-area {
            border-top: 1px solid #eee;
            padding: 12px 16px;
            background: white;
          }
          .nimi-chat-input {
            width: 100%;
            min-height: 60px;
            max-height: 120px;
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 8px;
            resize: vertical;
            font-size: 14px;
            font-family: inherit;
            margin-bottom: 8px;
          }
          .nimi-chat-input:focus {
            outline: none;
            border-color: #49bccf;
            box-shadow: 0 0 0 2px rgba(73, 188, 207, 0.2);
          }
          .nimi-chat-actions {
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .nimi-clear-chat-btn {
            background: #fff5f5;
            border: 1px solid #ffd1d1;
            border-radius: 6px;
            padding: 6px 12px;
            font-size: 12px;
            cursor: pointer;
            color: #ff6b6b;
            transition: all 0.2s;
          }
          .nimi-clear-chat-btn:hover {
            background: #ffeaea;
            color: #ff3b3b;
          }
          .nimi-new-chat-btn {
            background: #f0f8fa;
            border: 1px solid #ddd;
            border-radius: 6px;
            padding: 6px 12px;
            font-size: 12px;
            cursor: pointer;
            color: #666;
            transition: all 0.2s;
          }
          .nimi-new-chat-btn:hover {
            background: #e0f0f5;
            color: #49bccf;
          }
          .nimi-send-btn {
            background: linear-gradient(135deg, #49bccf 0%, #3aa8c8 100%);
            color: white;
            border: none;
            border-radius: 6px;
            padding: 8px 20px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: opacity 0.2s;
          }
          .nimi-send-btn:hover {
            opacity: 0.9;
          }
          .nimi-send-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }
          .nimi-chat-loading {
            text-align: center;
            padding: 10px;
            color: #999;
            font-size: 13px;
          }

          /* 版权信息 */
          .nimi-copyright {
            text-align: center;
            padding: 8px;
            color: #a0a0a0;
            font-size: 11px;
            border-top: 1px solid #f0f0f0;
            background: #fafafa;
          }

          /* 流式响应打字机效果 */
          .ai-streaming-content.streaming {
            position: relative;
          }
          .ai-streaming-content.streaming::after {
            content: '▋';
            animation: blink 1s infinite;
            color: #49bccf;
            font-weight: bold;
            margin-left: 2px;
          }
          @keyframes blink {
            0%, 100% { opacity: 1; }
            50% { opacity: 0; }
          }
        </style>
      `;
      document.body.appendChild(this.floatingWindow);

      // 绑定关闭事件
      this.floatingWindow.querySelector('.nimi-close-btn').addEventListener('click', () => {
        this.hideFloatingWindow();
      });

      // 绑定复制事件
      this.floatingWindow.querySelector('.nimi-copy-btn').addEventListener('click', (e) => {
        this.copyToClipboard(e.currentTarget);
      });

      // 绑定摘要事件
      this.floatingWindow.querySelector('.nimi-summarize-btn').addEventListener('click', () => {
        this.generateSummary();
      });

      // 绑定标签页切换事件
      this.floatingWindow.querySelectorAll('.nimi-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
          const tabName = e.currentTarget.dataset.tab;
          this.switchTab(tabName, false);
        });
      });

      // 对话功能暂不对外，注释事件绑定
      /*
      const chatInput = this.floatingWindow.querySelector('.nimi-chat-input');
      const sendBtn = this.floatingWindow.querySelector('.nimi-send-btn');
      const newChatBtn = this.floatingWindow.querySelector('.nimi-new-chat-btn');
      const clearChatBtn = this.floatingWindow.querySelector('.nimi-clear-chat-btn');

      sendBtn.addEventListener('click', () => {
        this.sendChatMessage(chatInput.value, false);
      });

      newChatBtn.addEventListener('click', () => {
        this.createNewChat();
        this.refreshChatMessages(false);
      });

      clearChatBtn.addEventListener('click', () => {
        this.clearCurrentChat();
        this.refreshChatMessages(false);
      });

      chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.sendChatMessage(chatInput.value, false);
        }
      });
      */

      // 可拖拽
      this.makeDraggable(this.floatingWindow);

      // 添加调整大小功能
      this.makeResizable(this.floatingWindow);
    }

    this.floatingWindow.style.display = 'flex';
    this.isFloatingWindowOpen = true;
    chrome.storage.sync.set({ isFloatingOpen: true });
  }

  // 隐藏浮窗
  hideFloatingWindow() {
    if (this.floatingWindow) {
      this.floatingWindow.style.display = 'none';
      this.isFloatingWindowOpen = false;
      chrome.storage.sync.set({ isFloatingOpen: false });
    }
  }

  // 切换侧边栏
  toggleSidebar() {
    if (this.isSidebarOpen) {
      this.hideSidebar();
    } else {
      this.showSidebar();
    }
  }

  // 显示侧边栏
  showSidebar() {
    if (!this.sidebar) {
      this.sidebar = document.createElement('div');
      this.sidebar.id = 'nimi-mini-sidebar';
      this.sidebar.style.width = '340px';
      this.sidebar.innerHTML = `
        <div class="nimi-sidebar-header">
          <span>✨ nimi</span>
          <div class="nimi-sidebar-header-actions">
            <button class="nimi-sidebar-copy-btn" title="复制结果 (Ctrl+C)">📋 复制</button>
            <button class="nimi-sidebar-close">×</button>
          </div>
        </div>
        <div class="nimi-sidebar-tabs">
          <button class="nimi-sidebar-tab active" data-tab="summary">📄 摘要</button>
          <!-- 对话功能暂不对外，隐藏标签页 -->
          <!-- <button class="nimi-sidebar-tab" data-tab="chat">💬 对话</button> -->
        </div>
        <div class="nimi-sidebar-content">
          <div class="nimi-sidebar-tab-content nimi-sidebar-summary-tab active">
            <button class="nimi-sidebar-summarize">📄 生成全文摘要</button>
            <div class="nimi-sidebar-result"></div>
          </div>
          <!-- 对话功能暂不对外，隐藏面板 -->
          <!--
          <div class="nimi-sidebar-tab-content nimi-sidebar-chat-tab">
            <div class="nimi-sidebar-chat-container">
              <div class="nimi-sidebar-chat-messages"></div>
              <div class="nimi-sidebar-chat-input-area">
                <textarea class="nimi-sidebar-chat-input" placeholder="输入消息... (Shift+Enter换行，Enter发送)"></textarea>
                <div class="nimi-sidebar-chat-actions">
                  <button class="nimi-sidebar-clear-chat-btn" title="清除当前对话">🗑️</button>
                  <button class="nimi-sidebar-new-chat-btn" title="新建对话">🆕</button>
                  <button class="nimi-sidebar-send-btn" title="发送消息 (Enter)">发送</button>
                </div>
              </div>
            </div>
          </div>
          -->
        </div>
        <div class="nimi-sidebar-copyright">@世界那么哒</div>
        <div class="nimi-sidebar-resize-handle" title="拖拽调整大小"></div>
        <style>
          #nimi-mini-sidebar {
            position: fixed;
            top: 0;
            right: 0;
            width: 340px;
            height: 100vh;
            background: white;
            box-shadow: -4px 0 20px rgba(0,0,0,0.1);
            z-index: 10002;
            display: flex;
            flex-direction: column;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          }
          .nimi-sidebar-header {
            padding: 16px;
            border-bottom: 1px solid #eee;
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-weight: 600;
            color: #333;
          }
          .nimi-sidebar-header-actions {
            display: flex;
            gap: 8px;
          }
          .nimi-sidebar-copy-btn {
            background: linear-gradient(135deg, #49bccf 0%, #3aa8c8 100%);
            color: white;
            border: none;
            border-radius: 6px;
            padding: 4px 10px;
            font-size: 12px;
            cursor: pointer;
            transition: opacity 0.2s;
            box-shadow: 0 2px 8px rgba(73, 188, 207, 0.3);
          }
          .nimi-sidebar-copy-btn:hover {
            opacity: 0.8;
          }
          .nimi-sidebar-copy-btn:active {
            transform: scale(0.95);
          }
          .nimi-sidebar-close {
            background: none;
            border: none;
            font-size: 24px;
            cursor: pointer;
            color: #999;
          }
          .nimi-sidebar-close:hover {
            color: #333;
          }
          .nimi-sidebar-content {
            flex: 1;
            padding: 16px;
            overflow-y: auto;
          }
          .nimi-sidebar-summarize {
            width: 100%;
            padding: 12px;
            background: linear-gradient(135deg, #49bccf 0%, #3aa8c8 50%, #2d9ab7 100%);
            color: white;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 16px;
            box-shadow: 0 4px 15px rgba(73, 188, 207, 0.3);
          }
          .nimi-sidebar-result {
            font-size: 14px;
            line-height: 1.8;
            color: #333;
          }
          .nimi-sidebar-result h1,
          .nimi-sidebar-result h2,
          .nimi-sidebar-result h3 {
            color: #2d9ab7;
            margin: 16px 0 12px 0;
            font-weight: 600;
          }
          .nimi-sidebar-result h1 { font-size: 20px; }
          .nimi-sidebar-result h2 { font-size: 18px; }
          .nimi-sidebar-result h3 { font-size: 16px; }
          .nimi-sidebar-result p {
            margin: 12px 0;
            line-height: 1.8;
          }
          .nimi-sidebar-result strong {
            font-weight: 600;
            color: #2d9ab7;
          }
          .nimi-sidebar-result code {
            background: #f0f8fa;
            padding: 2px 6px;
            border-radius: 4px;
            font-family: Monaco, monospace;
            font-size: 13px;
            color: #2d9ab7;
          }
          .nimi-sidebar-result li {
            margin: 8px 0;
            padding-left: 8px;
          }
          .nimi-sidebar-result a {
            color: #49bccf;
            text-decoration: none;
            border-bottom: 1px solid #49bccf;
          }
          .nimi-sidebar-resize-handle {
            position: absolute;
            top: 50%;
            left: 0;
            transform: translateY(-50%);
            width: 6px;
            height: 60px;
            cursor: ew-resize;
            background: linear-gradient(to right, #ddd, transparent);
            border-radius: 3px 0 0 3px;
            transition: background 0.2s;
          }
          .nimi-sidebar-resize-handle:hover {
            background: linear-gradient(to right, #49bccf, transparent);
          }

          /* 侧边栏标签页样式 */
          .nimi-sidebar-tabs {
            display: flex;
            border-bottom: 1px solid #eee;
            background: #f8f9fa;
          }
          .nimi-sidebar-tab {
            flex: 1;
            padding: 12px 16px;
            background: none;
            border: none;
            border-bottom: 2px solid transparent;
            cursor: pointer;
            font-size: 14px;
            color: #666;
            transition: all 0.2s;
          }
          .nimi-sidebar-tab:hover {
            background: #e9ecef;
          }
          .nimi-sidebar-tab.active {
            color: #49bccf;
            border-bottom-color: #49bccf;
            font-weight: 600;
          }

          /* 侧边栏标签页内容 */
          .nimi-sidebar-tab-content {
            display: none;
            flex: 1;
            flex-direction: column;
          }
          .nimi-sidebar-tab-content.active {
            display: flex;
          }

          /* 侧边栏对话样式 */
          .nimi-sidebar-chat-container {
            flex: 1;
            display: flex;
            flex-direction: column;
            height: 100%;
          }
          .nimi-sidebar-chat-messages {
            flex: 1;
            overflow-y: auto;
            padding: 16px;
            display: flex;
            flex-direction: column;
            gap: 12px;
          }
          .nimi-sidebar-chat-message {
            max-width: 85%;
            padding: 10px 14px;
            border-radius: 12px;
            line-height: 1.5;
            font-size: 14px;
            word-wrap: break-word;
          }
          .nimi-sidebar-chat-message.user {
            align-self: flex-end;
            background: linear-gradient(135deg, #49bccf 0%, #3aa8c8 100%);
            color: white;
            border-bottom-right-radius: 4px;
          }
          .nimi-sidebar-chat-message.assistant {
            align-self: flex-start;
            background: #f0f8fa;
            color: #333;
            border-bottom-left-radius: 4px;
          }
          .nimi-sidebar-chat-message .timestamp {
            font-size: 11px;
            opacity: 0.7;
            margin-top: 4px;
            text-align: right;
          }
          .nimi-sidebar-chat-input-area {
            border-top: 1px solid #eee;
            padding: 12px 16px;
            background: white;
          }
          .nimi-sidebar-chat-input {
            width: 100%;
            min-height: 60px;
            max-height: 120px;
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 8px;
            resize: vertical;
            font-size: 14px;
            font-family: inherit;
            margin-bottom: 8px;
          }
          .nimi-sidebar-chat-input:focus {
            outline: none;
            border-color: #49bccf;
            box-shadow: 0 0 0 2px rgba(73, 188, 207, 0.2);
          }
          .nimi-sidebar-chat-actions {
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .nimi-sidebar-clear-chat-btn {
            background: #fff5f5;
            border: 1px solid #ffd1d1;
            border-radius: 6px;
            padding: 6px 12px;
            font-size: 12px;
            cursor: pointer;
            color: #ff6b6b;
            transition: all 0.2s;
          }
          .nimi-sidebar-clear-chat-btn:hover {
            background: #ffeaea;
            color: #ff3b3b;
          }
          .nimi-sidebar-new-chat-btn {
            background: #f0f8fa;
            border: 1px solid #ddd;
            border-radius: 6px;
            padding: 6px 12px;
            font-size: 12px;
            cursor: pointer;
            color: #666;
            transition: all 0.2s;
          }
          .nimi-sidebar-new-chat-btn:hover {
            background: #e0f0f5;
            color: #49bccf;
          }
          .nimi-sidebar-send-btn {
            background: linear-gradient(135deg, #49bccf 0%, #3aa8c8 100%);
            color: white;
            border: none;
            border-radius: 6px;
            padding: 8px 20px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: opacity 0.2s;
          }
          .nimi-sidebar-send-btn:hover {
            opacity: 0.9;
          }
          .nimi-sidebar-send-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }
          .nimi-sidebar-chat-loading {
            text-align: center;
            padding: 10px;
            color: #999;
            font-size: 13px;
          }

          /* 侧边栏版权信息 */
          .nimi-sidebar-copyright {
            text-align: center;
            padding: 8px;
            color: #a0a0a0;
            font-size: 11px;
            border-top: 1px solid #f0f0f0;
            background: #fafafa;
            margin-top: auto;
          }

          /* 侧边栏流式响应打字机效果 */
          .ai-streaming-content.streaming {
            position: relative;
          }
          .ai-streaming-content.streaming::after {
            content: '▋';
            animation: blink 1s infinite;
            color: #49bccf;
            font-weight: bold;
            margin-left: 2px;
          }
          @keyframes blink {
            0%, 100% { opacity: 1; }
            50% { opacity: 0; }
          }
        </style>
      `;
      document.body.appendChild(this.sidebar);

      // 给原页面添加右边距
      document.body.style.marginRight = '340px';

      // 绑定事件
      this.sidebar.querySelector('.nimi-sidebar-close').addEventListener('click', () => {
        this.hideSidebar();
      });

      // 绑定复制事件
      this.sidebar.querySelector('.nimi-sidebar-copy-btn').addEventListener('click', (e) => {
        this.copyToClipboard(e.currentTarget, true);
      });

      this.sidebar.querySelector('.nimi-sidebar-summarize').addEventListener('click', () => {
        this.generateSummary();
      });

      // 绑定标签页切换事件
      this.sidebar.querySelectorAll('.nimi-sidebar-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
          const tabName = e.currentTarget.dataset.tab;
          this.switchTab(tabName, true);
        });
      });

      // 对话功能暂不对外，注释事件绑定
      /*
      const chatInput = this.sidebar.querySelector('.nimi-sidebar-chat-input');
      const sendBtn = this.sidebar.querySelector('.nimi-sidebar-send-btn');
      const newChatBtn = this.sidebar.querySelector('.nimi-sidebar-new-chat-btn');
      const clearChatBtn = this.sidebar.querySelector('.nimi-sidebar-clear-chat-btn');

      sendBtn.addEventListener('click', () => {
        this.sendChatMessage(chatInput.value, true);
      });

      newChatBtn.addEventListener('click', () => {
        this.createNewChat();
        this.refreshChatMessages(true);
      });

      clearChatBtn.addEventListener('click', () => {
        this.clearCurrentChat();
        this.refreshChatMessages(true);
      });

      chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.sendChatMessage(chatInput.value, true);
        }
      });
      */

      // 添加调整大小功能
      this.makeResizable(this.sidebar, true);
    }

    this.sidebar.style.display = 'flex';
    this.isSidebarOpen = true;
    chrome.storage.sync.set({ isSidebarOpen: true });
  }

  // 隐藏侧边栏
  hideSidebar() {
    if (this.sidebar) {
      this.sidebar.style.display = 'none';
      document.body.style.marginRight = '';
      this.isSidebarOpen = false;
      chrome.storage.sync.set({ isSidebarOpen: false });
    }
  }

  // 生成全文摘要
  async generateSummary() {
    const resultArea = this.settings.displayMode === 'floating'
      ? this.floatingWindow.querySelector('.nimi-result')
      : this.sidebar.querySelector('.nimi-sidebar-result');

    resultArea.innerHTML = '<div class="nimi-loading">🤔 正在生成摘要...</div>';

    // 提取页面文本
    const pageText = this.extractPageText();
    const prompt = `${this.settings.userTemplates[0]}\n\n请对以下内容进行总结：\n\n${pageText}`;

    try {
      const response = await this.callModel(prompt);
      resultArea.innerHTML = this.renderMarkdown(response);
    } catch (error) {
      resultArea.innerHTML = `<div style="color: #ff6b6b;">❌ 生成摘要失败: ${error.message}</div>`;
    }
  }

  // 提取页面文本
  extractPageText() {
    // 克隆body以避免修改原页面
    const clone = document.body.cloneNode(true);

    // 移除不需要的元素
    const removeSelectors = [
      'script', 'style', 'nav', 'header', 'footer', 'aside',
      '.nav', '.menu', '.ad', '.advertisement', '.sidebar',
      'iframe', 'svg'
    ];

    removeSelectors.forEach(selector => {
      clone.querySelectorAll(selector).forEach(el => el.remove());
    });

    // 获取纯文本，限制4k token
    let text = clone.innerText.replace(/\s+/g, ' ').trim();

    // 粗略计算token数（1 token ≈ 4字符）
    if (text.length > 16000) {
      text = text.substring(0, 16000);
    }

    return text;
  }

  // 渲染Markdown
  renderMarkdown(markdownText) {
    if (!markdownText) return '';

    let html = markdownText
      // 转义HTML
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      // 标题 (增强样式：h1-h4)
      .replace(/^#### (.*$)/gim, '<h4 style="font-size: 14px; margin: 12px 0 6px 0; color: #2d9ab7; font-weight: 600; font-style: italic; border-left: 3px solid #49bccf; padding-left: 8px;">$1</h4>')
      .replace(/^### (.*$)/gim, '<h3 style="font-size: 16px; margin: 16px 0 8px 0; color: #2d9ab7; font-weight: 700; border-bottom: 2px solid #e8f8fa; padding-bottom: 4px;">$1</h3>')
      .replace(/^## (.*$)/gim, '<h2 style="font-size: 18px; margin: 20px 0 12px 0; color: #2d9ab7; font-weight: 700; background: linear-gradient(to right, #f0f8fa, transparent); padding: 8px 12px; border-radius: 4px;">$1</h2>')
      .replace(/^# (.*$)/gim, '<h1 style="font-size: 20px; margin: 24px 0 16px 0; color: #2d9ab7; font-weight: 700; font-style: italic; text-align: center; padding: 12px; border-bottom: 3px solid #49bccf;">$1</h1>')
      // 粗体
      .replace(/\*\*(.*?)\*\*/g, '<strong style="font-weight: 600; color: #2d9ab7;">$1</strong>')
      // 斜体
      .replace(/\*(.*?)\*/g, '<em style="font-style: italic; color: #3aa8c8;">$1</em>')
      // 行内代码
      .replace(/`([^`]+)`/g, '<code style="background: linear-gradient(135deg, #f0f8fa 0%, #e8f8fa 100%); padding: 3px 8px; border-radius: 4px; font-family: Monaco, monospace; font-size: 13px; color: #2d9ab7; border: 1px solid #49bccf;">$1</code>')
      // 列表项 (带样式)
      .replace(/^\s*[-*+] (.*)$/gim, '<li style="margin: 8px 0; padding-left: 8px; color: #333; position: relative;"><span style="position: absolute; left: -12px; color: #49bccf;">▶</span>$1</li>')
      // 链接
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" style="color: #49bccf; text-decoration: none; border-bottom: 1px solid #49bccf; padding: 0 2px; transition: all 0.2s;">$1</a>')
      // 段落
      .split('\n\n')
      .map(paragraph => {
        if (paragraph.trim() && !paragraph.includes('<')) {
          return `<p style="margin: 12px 0; line-height: 1.8; color: #333;">${paragraph}</p>`;
        }
        return paragraph;
      })
      .join('\n');

    return html;
  }

  // 调用模型
  async callModel(prompt, targetElement = null) {
    try {
      let response;

      if (this.settings.apiType === 'anthropic') {
        // 使用Anthropic API格式
        response = await fetch(this.settings.modelUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.settings.apiKey}`,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: this.settings.modelName,
            max_tokens: 2000,
            temperature: 0.7,
            messages: [
              {
                role: 'user',
                content: prompt
              }
            ]
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Anthropic API调用失败 (${response.status}): ${errorText}`);
        }

        const data = await response.json();
        // Anthropic响应格式: data.content[0].text
        const content = data.content && data.content[0] ? data.content[0].text : '';

        // 如果是划词提问，显示tooltip
        if (targetElement) {
          this.showTooltip(targetElement, content);
        }

        return content;

      } else {
        // 使用OpenAI兼容格式
        response = await fetch(this.settings.modelUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.settings.apiKey}`
          },
          body: JSON.stringify({
            model: this.settings.modelName || 'default',
            messages: [
              {
                role: 'user',
                content: prompt
              }
            ],
            stream: false,
            temperature: 0.7,
            max_tokens: 2000
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`OpenAI API调用失败 (${response.status}): ${errorText}`);
        }

        const data = await response.json();
        // OpenAI响应格式: data.choices[0].message.content
        const content = data.choices && data.choices[0] ? data.choices[0].message.content : '';

        // 如果是划词提问，显示tooltip
        if (targetElement) {
          this.showTooltip(targetElement, content);
        }

        return content;
      }
    } catch (error) {
      console.error('模型调用失败:', error);
      throw error;
    }
  }

  // 显示tooltip
  showTooltip(element, content) {
    // 生成唯一ID
    const tooltipId = 'tooltip-' + Date.now();
    const range = document.createRange();
    range.selectNodeContents(element);

    // 创建tooltip
    const tooltip = document.createElement('div');
    tooltip.id = tooltipId;
    tooltip.className = 'nimi-tooltip';
    tooltip.innerHTML = `
      <div class="nimi-tooltip-content">${this.renderMarkdown(content)}</div>
      <div class="nimi-tooltip-actions">
        <button class="nimi-tooltip-close">×</button>
      </div>
      <style>
        .nimi-tooltip {
          position: absolute;
          background: white;
          border: 1px solid #ddd;
          border-radius: 8px;
          padding: 12px;
          max-width: 300px;
          box-shadow: 0 4px 20px rgba(73, 188, 207, 0.2);
          z-index: 10003;
          font-size: 14px;
          line-height: 1.6;
          margin-top: 8px;
        }
        .nimi-tooltip-content {
          color: #333;
          margin-bottom: 8px;
        }
        .nimi-tooltip-content h1,
        .nimi-tooltip-content h2,
        .nimi-tooltip-content h3 {
          color: #2d9ab7;
          margin: 8px 0 4px 0;
        }
        .nimi-tooltip-content p {
          margin: 8px 0;
        }
        .nimi-tooltip-content code {
          background: #f0f8fa;
          padding: 2px 6px;
          border-radius: 4px;
          font-family: Monaco, monospace;
          font-size: 12px;
          color: #2d9ab7;
        }
        .nimi-tooltip-content a {
          color: #49bccf;
          text-decoration: none;
        }
        .nimi-tooltip-actions {
          text-align: right;
        }
        .nimi-tooltip-close {
          background: none;
          border: none;
          color: #999;
          cursor: pointer;
          font-size: 16px;
          padding: 0;
        }
        .nimi-tooltip-close:hover {
          color: #333;
        }
      </style>
    `;

    // 定位tooltip
    const rect = range.getBoundingClientRect();
    tooltip.style.left = `${rect.left + window.scrollX}px`;
    tooltip.style.top = `${rect.bottom + window.scrollY}px`;

    // 绑定关闭事件
    tooltip.querySelector('.nimi-tooltip-close').addEventListener('click', () => {
      tooltip.remove();
      this.tooltipHistory.delete(tooltipId);
    });

    document.body.appendChild(tooltip);

    // 保存到历史记录
    this.tooltipHistory.set(tooltipId, tooltip);

    return tooltipId;
  }

  // 可拖拽功能
  makeDraggable(element) {
    let isDragging = false;
    let currentX;
    let currentY;
    let initialX;
    let initialY;

    element.addEventListener('mousedown', (e) => {
      // 避免从调整手柄开始拖拽
      if (e.target.classList.contains('nimi-resize-handle')) return;
      isDragging = true;
      initialX = e.clientX - element.offsetLeft;
      initialY = e.clientY - element.offsetTop;
    });

    document.addEventListener('mousemove', (e) => {
      if (isDragging) {
        e.preventDefault();
        currentX = e.clientX - initialX;
        currentY = e.clientY - initialY;
        element.style.left = currentX + 'px';
        element.style.top = currentY + 'px';
      }
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
    });
  }

  // 可调整大小功能
  makeResizable(element, isSidebar = false) {
    const selector = isSidebar ? '.nimi-sidebar-resize-handle' : '.nimi-resize-handle';
    const resizeHandle = element.querySelector(selector);
    let isResizing = false;
    let initialWidth;
    let initialHeight;
    let initialX;
    let initialY;

    resizeHandle.addEventListener('mousedown', (e) => {
      isResizing = true;
      initialWidth = element.offsetWidth;
      initialHeight = element.offsetHeight;
      initialX = e.clientX;
      initialY = e.clientY;
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (isResizing) {
        if (isSidebar) {
          // 侧边栏只调整宽度
          const width = initialWidth + (e.clientX - initialX);
          element.style.width = Math.max(280, Math.min(600, width)) + 'px';
        } else {
          // 浮窗调整宽高
          const width = initialWidth + (e.clientX - initialX);
          const height = initialHeight + (e.clientY - initialY);
          element.style.width = Math.max(300, width) + 'px';
          element.style.height = Math.max(350, height) + 'px';
        }
      }
    });

    document.addEventListener('mouseup', () => {
      isResizing = false;
    });
  }

  // 复制到剪贴板
  async copyToClipboard(button, isSidebar = false) {
    const selector = isSidebar ? '.nimi-sidebar-result' : '.nimi-result';
    const resultArea = isSidebar ? this.sidebar.querySelector(selector) : this.floatingWindow.querySelector(selector);
    const content = resultArea.textContent;

    if (!content || content.trim() === '') {
      button.textContent = '⚠️ 无内容';
      setTimeout(() => {
        button.textContent = '📋 复制';
      }, 1500);
      return;
    }

    try {
      await navigator.clipboard.writeText(content);
      const originalText = button.textContent;
      button.textContent = '✅ 已复制';
      setTimeout(() => {
        button.textContent = originalText;
      }, 1500);
    } catch (err) {
      console.error('复制失败:', err);
      button.textContent = '❌ 失败';
      setTimeout(() => {
        button.textContent = '📋 复制';
      }, 1500);
    }
  }

  // ESC键关闭
  bindEscapeKey() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.isFloatingWindowOpen && this.floatingWindow) {
          this.hideFloatingWindow();
        } else if (this.isSidebarOpen && this.sidebar) {
          this.hideSidebar();
        }
      }
    });
  }

  // 切换标签页
  switchTab(tabName, isSidebar) {
    const tabPrefix = isSidebar ? 'nimi-sidebar-' : 'nimi-';
    const container = isSidebar ? this.sidebar : this.floatingWindow;

    // 更新标签按钮状态
    container.querySelectorAll(`.${tabPrefix}tab`).forEach(tab => {
      tab.classList.toggle('active', tab.dataset.tab === tabName);
    });

    // 更新标签页内容状态
    container.querySelectorAll(`.${tabPrefix}tab-content`).forEach(content => {
      const isActive = content.classList.contains(`${tabPrefix}${tabName}-tab`);
      content.classList.toggle('active', isActive);
    });

    // 如果是对话标签页，刷新消息显示
    if (tabName === 'chat') {
      this.refreshChatMessages(isSidebar);
    }
  }

  // 刷新聊天消息显示
  refreshChatMessages(isSidebar) {
    const messagesContainer = isSidebar
      ? this.sidebar.querySelector('.nimi-sidebar-chat-messages')
      : this.floatingWindow.querySelector('.nimi-chat-messages');

    if (!messagesContainer) return;

    // 清空现有消息
    messagesContainer.innerHTML = '';

    // 获取当前对话消息
    const messages = this.getChatContext();

    if (messages.length === 0) {
      const emptyMsg = document.createElement('div');
      emptyMsg.className = isSidebar ? 'nimi-sidebar-chat-message assistant' : 'nimi-chat-message assistant';
      emptyMsg.textContent = '开始新的对话吧！';
      messagesContainer.appendChild(emptyMsg);
      return;
    }

    // 显示所有消息
    messages.forEach(msg => {
      const messageEl = document.createElement('div');
      messageEl.className = isSidebar
        ? `nimi-sidebar-chat-message ${msg.role}`
        : `nimi-chat-message ${msg.role}`;

      messageEl.innerHTML = `
        <div>${this.escapeHtml(msg.content)}</div>
        <div class="timestamp">${this.formatTime(msg.timestamp)}</div>
      `;

      messagesContainer.appendChild(messageEl);
    });

    // 滚动到底部
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  // HTML转义
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // 格式化时间
  formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  // 发送聊天消息（支持流式响应）
  async sendChatMessage(content, isSidebar) {
    content = content.trim();
    if (!content) return;

    const chatInput = isSidebar
      ? this.sidebar.querySelector('.nimi-sidebar-chat-input')
      : this.floatingWindow.querySelector('.nimi-chat-input');

    const sendBtn = isSidebar
      ? this.sidebar.querySelector('.nimi-sidebar-send-btn')
      : this.floatingWindow.querySelector('.nimi-send-btn');

    // 清空输入框并禁用发送按钮
    chatInput.value = '';
    sendBtn.disabled = true;

    // 创建AI消息占位符
    let aiMessageId = null;
    let aiMessageContent = '';

    try {
      // 添加用户消息
      await this.addMessage('user', content);
      this.refreshChatMessages(isSidebar);

      // 显示加载状态
      this.showChatLoading(isSidebar, true);

      // 创建AI消息占位符
      aiMessageId = this.createAIMessagePlaceholder(isSidebar);

      // 调用AI API（流式）
      await this.callChatAPI(
        content,
        // 流式数据块回调
        (chunk, fullContent) => {
          aiMessageContent = fullContent;
          this.updateAIMessageContent(isSidebar, aiMessageId, fullContent);
        },
        // 流式完成回调
        (fullContent) => {
          aiMessageContent = fullContent;
          this.finalizeAIMessage(isSidebar, aiMessageId, fullContent);
        }
      );

    } catch (error) {
      console.error('发送消息失败:', error);

      // 显示错误消息
      if (aiMessageId) {
        this.updateAIMessageContent(isSidebar, aiMessageId, `抱歉，发送消息时出现错误：${error.message}`);
        this.finalizeAIMessage(isSidebar, aiMessageId, `抱歉，发送消息时出现错误：${error.message}`);
      } else {
        await this.addMessage('assistant', `抱歉，发送消息时出现错误：${error.message}`);
        this.refreshChatMessages(isSidebar);
      }
    } finally {
      // 恢复发送按钮
      sendBtn.disabled = false;
      this.showChatLoading(isSidebar, false);

      // 如果AI消息已创建但未保存，则保存到对话历史
      if (aiMessageId && aiMessageContent) {
        await this.saveAIMessageToHistory(aiMessageContent);
      }
    }
  }

  // 创建AI消息占位符
  createAIMessagePlaceholder(isSidebar) {
    const messagesContainer = isSidebar
      ? this.sidebar.querySelector('.nimi-sidebar-chat-messages')
      : this.floatingWindow.querySelector('.nimi-chat-messages');

    const messageId = 'ai-message-' + Date.now();
    const messageEl = document.createElement('div');
    messageEl.id = messageId;
    messageEl.className = isSidebar ? 'nimi-sidebar-chat-message assistant' : 'nimi-chat-message assistant';
    messageEl.innerHTML = `
      <div class="ai-streaming-content"></div>
      <div class="timestamp">${this.formatTime(new Date().toISOString())}</div>
    `;

    messagesContainer.appendChild(messageEl);

    // 滚动到底部
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    return messageId;
  }

  // 更新AI消息内容（流式）
  updateAIMessageContent(isSidebar, messageId, content) {
    const messagesContainer = isSidebar
      ? this.sidebar.querySelector('.nimi-sidebar-chat-messages')
      : this.floatingWindow.querySelector('.nimi-chat-messages');

    const messageEl = messagesContainer.querySelector(`#${messageId}`);
    if (messageEl) {
      const contentEl = messageEl.querySelector('.ai-streaming-content');
      if (contentEl) {
        // 使用Markdown渲染
        contentEl.innerHTML = this.renderMarkdown(content);

        // 添加打字机效果类
        contentEl.classList.add('streaming');

        // 滚动到底部
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }
    }
  }

  // 完成AI消息（流式结束）
  finalizeAIMessage(isSidebar, messageId, content) {
    const messagesContainer = isSidebar
      ? this.sidebar.querySelector('.nimi-sidebar-chat-messages')
      : this.floatingWindow.querySelector('.nimi-chat-messages');

    const messageEl = messagesContainer.querySelector(`#${messageId}`);
    if (messageEl) {
      const contentEl = messageEl.querySelector('.ai-streaming-content');
      if (contentEl) {
        // 移除打字机效果类
        contentEl.classList.remove('streaming');

        // 更新内容
        contentEl.innerHTML = this.renderMarkdown(content);

        // 更新消息类名
        messageEl.className = isSidebar ? 'nimi-sidebar-chat-message assistant' : 'nimi-chat-message assistant';

        // 滚动到底部
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }
    }
  }

  // 保存AI消息到对话历史
  async saveAIMessageToHistory(content) {
    if (!this.currentChatSession) {
      this.initChatSession();
    }

    const session = this.chatSessions.get(this.currentChatSession);
    if (session) {
      // 检查是否已经存在相同的AI消息
      const lastMessage = session.messages[session.messages.length - 1];
      if (lastMessage && lastMessage.role === 'assistant') {
        // 更新最后一条AI消息
        lastMessage.content = content;
        lastMessage.timestamp = new Date().toISOString();
      } else {
        // 添加新的AI消息
        session.messages.push({
          role: 'assistant',
          content: content,
          timestamp: new Date().toISOString()
        });
      }

      session.updatedAt = new Date().toISOString();
      await this.saveChatSessions();
    }
  }

  // 显示/隐藏聊天加载状态
  showChatLoading(isSidebar, show) {
    const messagesContainer = isSidebar
      ? this.sidebar.querySelector('.nimi-sidebar-chat-messages')
      : this.floatingWindow.querySelector('.nimi-chat-messages');

    const loadingClass = isSidebar ? 'nimi-sidebar-chat-loading' : 'nimi-chat-loading';
    let loadingEl = messagesContainer.querySelector(`.${loadingClass}`);

    if (show) {
      if (!loadingEl) {
        loadingEl = document.createElement('div');
        loadingEl.className = loadingClass;
        loadingEl.textContent = 'AI正在思考...';
        messagesContainer.appendChild(loadingEl);
      }
    } else if (loadingEl) {
      loadingEl.remove();
    }
  }

  // 调用聊天API（流式响应）
  async callChatAPI(userMessage, onStreamChunk, onStreamComplete) {
    // 获取当前对话上下文（限制最多10轮对话）
    const messages = this.getAIContext();

    // 确保消息格式正确
    const formattedMessages = messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    // 构建API请求 - 使用nimi设置中的接口地址
    const requestData = {
      model: this.settings.modelName || 'gpt-3.5-turbo',
      messages: formattedMessages,
      temperature: 0.7,
      max_tokens: 2000,
      stream: true  // 启用流式响应
    };

    try {
      const response = await fetch(this.settings.modelUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.settings.apiKey}`
        },
        body: JSON.stringify(requestData)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API请求失败 (${response.status}): ${errorText}`);
      }

      // 处理流式响应
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullResponse = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n').filter(line => line.trim() !== '');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);

              if (data === '[DONE]') {
                // 流结束
                if (onStreamComplete) {
                  onStreamComplete(fullResponse);
                }
                return fullResponse;
              }

              try {
                const parsed = JSON.parse(data);
                if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta) {
                  const content = parsed.choices[0].delta.content || '';
                  if (content) {
                    fullResponse += content;
                    if (onStreamChunk) {
                      onStreamChunk(content, fullResponse);
                    }
                  }
                }
              } catch (e) {
                // 忽略解析错误，继续处理下一个数据块
                console.debug('解析流数据失败:', e, '原始数据:', data);
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      return fullResponse;
    } catch (error) {
      console.error('调用聊天API失败:', error);
      throw error;
    }
  }

  // 创建新对话
  createNewChat(isSidebar) {
    this.createNewChat();

    // 刷新消息显示
    this.refreshChatMessages(isSidebar);

    // 清空输入框
    const chatInput = isSidebar
      ? this.sidebar.querySelector('.nimi-sidebar-chat-input')
      : this.floatingWindow.querySelector('.nimi-chat-input');
    chatInput.value = '';
    chatInput.focus();
  }

  // 迁移API Key到安全格式
  async migrateApiKeyToSecureFormat() {
    try {
      // 从存储中获取当前的API Key
      const result = await chrome.storage.sync.get(['apiKey']);
      const oldKey = result.apiKey;

      if (!oldKey) {
        console.log('没有找到API Key，无需迁移');
        return;
      }

      // 如果已经是安全格式，无需迁移
      if (CryptoUtils.isSecureFormat(oldKey)) {
        console.log('API Key已经是安全格式，无需迁移');
        return;
      }

      console.log('开始迁移API Key到安全格式...');

      // 迁移到安全格式
      const newKey = CryptoUtils.migrateToSecureFormat(oldKey);

      // 保存回存储
      await chrome.storage.sync.set({ apiKey: newKey });

      console.log('API Key迁移完成');

      // 重新加载设置以使用新的安全格式
      await this.loadSettings();

    } catch (error) {
      console.error('API Key迁移失败:', error);
    }
  }
}

// 初始化插件
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new NimiMini();
  });
} else {
  new NimiMini();
}
