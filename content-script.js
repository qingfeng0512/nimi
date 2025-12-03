// nimi content-script.js
// 实现全文摘要、划词点问、浮窗/侧边栏功能

class KimiMini {
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
  }

  // 加载设置
  async loadSettings() {
    try {
      const result = await chrome.storage.sync.get(['modelUrl', 'apiKey', 'modelName', 'apiType', 'userTemplates', 'displayMode']);
      this.settings = {
        modelUrl: result.modelUrl || 'https://api.siliconflow.cn/v1/chat/completions',
        apiKey: result.apiKey || '',
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

  // 创建新对话
  createNewChat() {
    this.currentChatSession = null;
    this.initChatSession();
    return this.currentChatSession;
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
    this.floatingButton.id = 'kimi-mini-trigger';
    this.floatingButton.innerHTML = `
      <div class="kimi-trigger-btn">✨</div>
      <style>
        #kimi-mini-trigger {
          position: fixed;
          bottom: 20px;
          right: 20px;
          z-index: 10000;
        }
        .kimi-trigger-btn {
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
        .kimi-trigger-btn:hover {
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
      const existingBtn = document.querySelector('.kimi-selection-btn');
      if (existingBtn) {
        existingBtn.remove();
      }

      // 创建按钮
      const btn = document.createElement('div');
      btn.className = 'kimi-selection-btn';
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
      this.floatingWindow.id = 'kimi-mini-floating';
      this.floatingWindow.style.width = '360px';
      this.floatingWindow.style.height = '480px';
      this.floatingWindow.innerHTML = `
        <div class="kimi-header">
          <span>✨ nimi</span>
          <div class="kimi-header-actions">
            <button class="kimi-copy-btn" title="复制结果 (Ctrl+C)">📋 复制</button>
            <button class="kimi-close-btn">×</button>
          </div>
        </div>
        <div class="kimi-tabs">
          <button class="kimi-tab active" data-tab="summary">📄 摘要</button>
          <button class="kimi-tab" data-tab="chat">💬 对话</button>
        </div>
        <div class="kimi-content">
          <div class="kimi-tab-content kimi-summary-tab active">
            <button class="kimi-summarize-btn">📄 生成全文摘要</button>
            <div class="kimi-result"></div>
          </div>
          <div class="kimi-tab-content kimi-chat-tab">
            <div class="kimi-chat-container">
              <div class="kimi-chat-messages"></div>
              <div class="kimi-chat-input-area">
                <textarea class="kimi-chat-input" placeholder="输入消息... (Shift+Enter换行，Enter发送)"></textarea>
                <div class="kimi-chat-actions">
                  <button class="kimi-new-chat-btn" title="新建对话">🆕</button>
                  <button class="kimi-send-btn" title="发送消息 (Enter)">发送</button>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="kimi-copyright">@世界那么哒</div>
        <div class="kimi-resize-handle" title="拖拽调整大小"></div>
        <style>
          #kimi-mini-floating {
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
          .kimi-header {
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
          .kimi-header-actions {
            display: flex;
            gap: 8px;
          }
          .kimi-copy-btn {
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
          .kimi-copy-btn:hover {
            opacity: 0.8;
          }
          .kimi-copy-btn:active {
            transform: scale(0.95);
          }
          .kimi-close-btn {
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
          .kimi-close-btn:hover {
            color: #ff6b6b;
          }
          .kimi-content {
            flex: 1;
            padding: 16px;
            overflow-y: auto;
          }
          .kimi-summarize-btn {
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
          .kimi-summarize-btn:hover {
            opacity: 0.9;
          }
          .kimi-result {
            font-size: 14px;
            line-height: 1.6;
            color: #333;
          }
          .kimi-result h1,
          .kimi-result h2,
          .kimi-result h3 {
            color: #2d9ab7;
            margin: 16px 0 12px 0;
            font-weight: 600;
          }
          .kimi-result h1 { font-size: 20px; }
          .kimi-result h2 { font-size: 18px; }
          .kimi-result h3 { font-size: 16px; }
          .kimi-result p {
            margin: 12px 0;
            line-height: 1.8;
          }
          .kimi-result strong {
            font-weight: 600;
            color: #2d9ab7;
          }
          .kimi-result code {
            background: #f0f8fa;
            padding: 2px 6px;
            border-radius: 4px;
            font-family: Monaco, monospace;
            font-size: 13px;
            color: #2d9ab7;
          }
          .kimi-result li {
            margin: 8px 0;
            padding-left: 8px;
          }
          .kimi-result a {
            color: #49bccf;
            text-decoration: none;
            border-bottom: 1px solid #49bccf;
          }
          .kimi-loading {
            text-align: center;
            color: #999;
            padding: 20px;
          }
          .kimi-resize-handle {
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
          .kimi-resize-handle:hover {
            background: linear-gradient(135deg, transparent 50%, #49bccf 50%);
          }

          /* 标签页样式 */
          .kimi-tabs {
            display: flex;
            border-bottom: 1px solid #eee;
            background: #f8f9fa;
          }
          .kimi-tab {
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
          .kimi-tab:hover {
            background: #e9ecef;
          }
          .kimi-tab.active {
            color: #49bccf;
            border-bottom-color: #49bccf;
            font-weight: 600;
          }

          /* 标签页内容 */
          .kimi-tab-content {
            display: none;
            flex: 1;
            flex-direction: column;
          }
          .kimi-tab-content.active {
            display: flex;
          }

          /* 对话样式 */
          .kimi-chat-container {
            flex: 1;
            display: flex;
            flex-direction: column;
            height: 100%;
          }
          .kimi-chat-messages {
            flex: 1;
            overflow-y: auto;
            padding: 16px;
            display: flex;
            flex-direction: column;
            gap: 12px;
          }
          .kimi-chat-message {
            max-width: 85%;
            padding: 10px 14px;
            border-radius: 12px;
            line-height: 1.5;
            font-size: 14px;
            word-wrap: break-word;
          }
          .kimi-chat-message.user {
            align-self: flex-end;
            background: linear-gradient(135deg, #49bccf 0%, #3aa8c8 100%);
            color: white;
            border-bottom-right-radius: 4px;
          }
          .kimi-chat-message.assistant {
            align-self: flex-start;
            background: #f0f8fa;
            color: #333;
            border-bottom-left-radius: 4px;
          }
          .kimi-chat-message .timestamp {
            font-size: 11px;
            opacity: 0.7;
            margin-top: 4px;
            text-align: right;
          }
          .kimi-chat-input-area {
            border-top: 1px solid #eee;
            padding: 12px 16px;
            background: white;
          }
          .kimi-chat-input {
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
          .kimi-chat-input:focus {
            outline: none;
            border-color: #49bccf;
            box-shadow: 0 0 0 2px rgba(73, 188, 207, 0.2);
          }
          .kimi-chat-actions {
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .kimi-new-chat-btn {
            background: #f0f8fa;
            border: 1px solid #ddd;
            border-radius: 6px;
            padding: 6px 12px;
            font-size: 12px;
            cursor: pointer;
            color: #666;
            transition: all 0.2s;
          }
          .kimi-new-chat-btn:hover {
            background: #e0f0f5;
            color: #49bccf;
          }
          .kimi-send-btn {
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
          .kimi-send-btn:hover {
            opacity: 0.9;
          }
          .kimi-send-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }
          .kimi-chat-loading {
            text-align: center;
            padding: 10px;
            color: #999;
            font-size: 13px;
          }

          /* 版权信息 */
          .kimi-copyright {
            text-align: center;
            padding: 8px;
            color: #a0a0a0;
            font-size: 11px;
            border-top: 1px solid #f0f0f0;
            background: #fafafa;
          }
        </style>
      `;
      document.body.appendChild(this.floatingWindow);

      // 绑定关闭事件
      this.floatingWindow.querySelector('.kimi-close-btn').addEventListener('click', () => {
        this.hideFloatingWindow();
      });

      // 绑定复制事件
      this.floatingWindow.querySelector('.kimi-copy-btn').addEventListener('click', (e) => {
        this.copyToClipboard(e.currentTarget);
      });

      // 绑定摘要事件
      this.floatingWindow.querySelector('.kimi-summarize-btn').addEventListener('click', () => {
        this.generateSummary();
      });

      // 绑定标签页切换事件
      this.floatingWindow.querySelectorAll('.kimi-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
          const tabName = e.currentTarget.dataset.tab;
          this.switchTab(tabName, false);
        });
      });

      // 绑定对话事件
      const chatInput = this.floatingWindow.querySelector('.kimi-chat-input');
      const sendBtn = this.floatingWindow.querySelector('.kimi-send-btn');
      const newChatBtn = this.floatingWindow.querySelector('.kimi-new-chat-btn');

      sendBtn.addEventListener('click', () => {
        this.sendChatMessage(chatInput.value, false);
      });

      newChatBtn.addEventListener('click', () => {
        this.createNewChat(false);
      });

      chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.sendChatMessage(chatInput.value, false);
        }
      });

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
      this.sidebar.id = 'kimi-mini-sidebar';
      this.sidebar.style.width = '340px';
      this.sidebar.innerHTML = `
        <div class="kimi-sidebar-header">
          <span>✨ nimi</span>
          <div class="kimi-sidebar-header-actions">
            <button class="kimi-sidebar-copy-btn" title="复制结果 (Ctrl+C)">📋 复制</button>
            <button class="kimi-sidebar-close">×</button>
          </div>
        </div>
        <div class="kimi-sidebar-tabs">
          <button class="kimi-sidebar-tab active" data-tab="summary">📄 摘要</button>
          <button class="kimi-sidebar-tab" data-tab="chat">💬 对话</button>
        </div>
        <div class="kimi-sidebar-content">
          <div class="kimi-sidebar-tab-content kimi-sidebar-summary-tab active">
            <button class="kimi-sidebar-summarize">📄 生成全文摘要</button>
            <div class="kimi-sidebar-result"></div>
          </div>
          <div class="kimi-sidebar-tab-content kimi-sidebar-chat-tab">
            <div class="kimi-sidebar-chat-container">
              <div class="kimi-sidebar-chat-messages"></div>
              <div class="kimi-sidebar-chat-input-area">
                <textarea class="kimi-sidebar-chat-input" placeholder="输入消息... (Shift+Enter换行，Enter发送)"></textarea>
                <div class="kimi-sidebar-chat-actions">
                  <button class="kimi-sidebar-new-chat-btn" title="新建对话">🆕</button>
                  <button class="kimi-sidebar-send-btn" title="发送消息 (Enter)">发送</button>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="kimi-sidebar-copyright">@世界那么哒</div>
        <div class="kimi-sidebar-resize-handle" title="拖拽调整大小"></div>
        <style>
          #kimi-mini-sidebar {
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
          .kimi-sidebar-header {
            padding: 16px;
            border-bottom: 1px solid #eee;
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-weight: 600;
            color: #333;
          }
          .kimi-sidebar-header-actions {
            display: flex;
            gap: 8px;
          }
          .kimi-sidebar-copy-btn {
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
          .kimi-sidebar-copy-btn:hover {
            opacity: 0.8;
          }
          .kimi-sidebar-copy-btn:active {
            transform: scale(0.95);
          }
          .kimi-sidebar-close {
            background: none;
            border: none;
            font-size: 24px;
            cursor: pointer;
            color: #999;
          }
          .kimi-sidebar-close:hover {
            color: #333;
          }
          .kimi-sidebar-content {
            flex: 1;
            padding: 16px;
            overflow-y: auto;
          }
          .kimi-sidebar-summarize {
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
          .kimi-sidebar-result {
            font-size: 14px;
            line-height: 1.8;
            color: #333;
          }
          .kimi-sidebar-result h1,
          .kimi-sidebar-result h2,
          .kimi-sidebar-result h3 {
            color: #2d9ab7;
            margin: 16px 0 12px 0;
            font-weight: 600;
          }
          .kimi-sidebar-result h1 { font-size: 20px; }
          .kimi-sidebar-result h2 { font-size: 18px; }
          .kimi-sidebar-result h3 { font-size: 16px; }
          .kimi-sidebar-result p {
            margin: 12px 0;
            line-height: 1.8;
          }
          .kimi-sidebar-result strong {
            font-weight: 600;
            color: #2d9ab7;
          }
          .kimi-sidebar-result code {
            background: #f0f8fa;
            padding: 2px 6px;
            border-radius: 4px;
            font-family: Monaco, monospace;
            font-size: 13px;
            color: #2d9ab7;
          }
          .kimi-sidebar-result li {
            margin: 8px 0;
            padding-left: 8px;
          }
          .kimi-sidebar-result a {
            color: #49bccf;
            text-decoration: none;
            border-bottom: 1px solid #49bccf;
          }
          .kimi-sidebar-resize-handle {
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
          .kimi-sidebar-resize-handle:hover {
            background: linear-gradient(to right, #49bccf, transparent);
          }

          /* 侧边栏标签页样式 */
          .kimi-sidebar-tabs {
            display: flex;
            border-bottom: 1px solid #eee;
            background: #f8f9fa;
          }
          .kimi-sidebar-tab {
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
          .kimi-sidebar-tab:hover {
            background: #e9ecef;
          }
          .kimi-sidebar-tab.active {
            color: #49bccf;
            border-bottom-color: #49bccf;
            font-weight: 600;
          }

          /* 侧边栏标签页内容 */
          .kimi-sidebar-tab-content {
            display: none;
            flex: 1;
            flex-direction: column;
          }
          .kimi-sidebar-tab-content.active {
            display: flex;
          }

          /* 侧边栏对话样式 */
          .kimi-sidebar-chat-container {
            flex: 1;
            display: flex;
            flex-direction: column;
            height: 100%;
          }
          .kimi-sidebar-chat-messages {
            flex: 1;
            overflow-y: auto;
            padding: 16px;
            display: flex;
            flex-direction: column;
            gap: 12px;
          }
          .kimi-sidebar-chat-message {
            max-width: 85%;
            padding: 10px 14px;
            border-radius: 12px;
            line-height: 1.5;
            font-size: 14px;
            word-wrap: break-word;
          }
          .kimi-sidebar-chat-message.user {
            align-self: flex-end;
            background: linear-gradient(135deg, #49bccf 0%, #3aa8c8 100%);
            color: white;
            border-bottom-right-radius: 4px;
          }
          .kimi-sidebar-chat-message.assistant {
            align-self: flex-start;
            background: #f0f8fa;
            color: #333;
            border-bottom-left-radius: 4px;
          }
          .kimi-sidebar-chat-message .timestamp {
            font-size: 11px;
            opacity: 0.7;
            margin-top: 4px;
            text-align: right;
          }
          .kimi-sidebar-chat-input-area {
            border-top: 1px solid #eee;
            padding: 12px 16px;
            background: white;
          }
          .kimi-sidebar-chat-input {
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
          .kimi-sidebar-chat-input:focus {
            outline: none;
            border-color: #49bccf;
            box-shadow: 0 0 0 2px rgba(73, 188, 207, 0.2);
          }
          .kimi-sidebar-chat-actions {
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .kimi-sidebar-new-chat-btn {
            background: #f0f8fa;
            border: 1px solid #ddd;
            border-radius: 6px;
            padding: 6px 12px;
            font-size: 12px;
            cursor: pointer;
            color: #666;
            transition: all 0.2s;
          }
          .kimi-sidebar-new-chat-btn:hover {
            background: #e0f0f5;
            color: #49bccf;
          }
          .kimi-sidebar-send-btn {
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
          .kimi-sidebar-send-btn:hover {
            opacity: 0.9;
          }
          .kimi-sidebar-send-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }
          .kimi-sidebar-chat-loading {
            text-align: center;
            padding: 10px;
            color: #999;
            font-size: 13px;
          }

          /* 侧边栏版权信息 */
          .kimi-sidebar-copyright {
            text-align: center;
            padding: 8px;
            color: #a0a0a0;
            font-size: 11px;
            border-top: 1px solid #f0f0f0;
            background: #fafafa;
            margin-top: auto;
          }
        </style>
      `;
      document.body.appendChild(this.sidebar);

      // 给原页面添加右边距
      document.body.style.marginRight = '340px';

      // 绑定事件
      this.sidebar.querySelector('.kimi-sidebar-close').addEventListener('click', () => {
        this.hideSidebar();
      });

      // 绑定复制事件
      this.sidebar.querySelector('.kimi-sidebar-copy-btn').addEventListener('click', (e) => {
        this.copyToClipboard(e.currentTarget, true);
      });

      this.sidebar.querySelector('.kimi-sidebar-summarize').addEventListener('click', () => {
        this.generateSummary();
      });

      // 绑定标签页切换事件
      this.sidebar.querySelectorAll('.kimi-sidebar-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
          const tabName = e.currentTarget.dataset.tab;
          this.switchTab(tabName, true);
        });
      });

      // 绑定对话事件
      const chatInput = this.sidebar.querySelector('.kimi-sidebar-chat-input');
      const sendBtn = this.sidebar.querySelector('.kimi-sidebar-send-btn');
      const newChatBtn = this.sidebar.querySelector('.kimi-sidebar-new-chat-btn');

      sendBtn.addEventListener('click', () => {
        this.sendChatMessage(chatInput.value, true);
      });

      newChatBtn.addEventListener('click', () => {
        this.createNewChat(true);
      });

      chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.sendChatMessage(chatInput.value, true);
        }
      });

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
      ? this.floatingWindow.querySelector('.kimi-result')
      : this.sidebar.querySelector('.kimi-sidebar-result');

    resultArea.innerHTML = '<div class="kimi-loading">🤔 正在生成摘要...</div>';

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
    tooltip.className = 'kimi-tooltip';
    tooltip.innerHTML = `
      <div class="kimi-tooltip-content">${this.renderMarkdown(content)}</div>
      <div class="kimi-tooltip-actions">
        <button class="kimi-tooltip-close">×</button>
      </div>
      <style>
        .kimi-tooltip {
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
        .kimi-tooltip-content {
          color: #333;
          margin-bottom: 8px;
        }
        .kimi-tooltip-content h1,
        .kimi-tooltip-content h2,
        .kimi-tooltip-content h3 {
          color: #2d9ab7;
          margin: 8px 0 4px 0;
        }
        .kimi-tooltip-content p {
          margin: 8px 0;
        }
        .kimi-tooltip-content code {
          background: #f0f8fa;
          padding: 2px 6px;
          border-radius: 4px;
          font-family: Monaco, monospace;
          font-size: 12px;
          color: #2d9ab7;
        }
        .kimi-tooltip-content a {
          color: #49bccf;
          text-decoration: none;
        }
        .kimi-tooltip-actions {
          text-align: right;
        }
        .kimi-tooltip-close {
          background: none;
          border: none;
          color: #999;
          cursor: pointer;
          font-size: 16px;
          padding: 0;
        }
        .kimi-tooltip-close:hover {
          color: #333;
        }
      </style>
    `;

    // 定位tooltip
    const rect = range.getBoundingClientRect();
    tooltip.style.left = `${rect.left + window.scrollX}px`;
    tooltip.style.top = `${rect.bottom + window.scrollY}px`;

    // 绑定关闭事件
    tooltip.querySelector('.kimi-tooltip-close').addEventListener('click', () => {
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
      if (e.target.classList.contains('kimi-resize-handle')) return;
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
    const selector = isSidebar ? '.kimi-sidebar-resize-handle' : '.kimi-resize-handle';
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
    const selector = isSidebar ? '.kimi-sidebar-result' : '.kimi-result';
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
    const tabPrefix = isSidebar ? 'kimi-sidebar-' : 'kimi-';
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
      ? this.sidebar.querySelector('.kimi-sidebar-chat-messages')
      : this.floatingWindow.querySelector('.kimi-chat-messages');

    if (!messagesContainer) return;

    // 清空现有消息
    messagesContainer.innerHTML = '';

    // 获取当前对话消息
    const messages = this.getChatContext();

    if (messages.length === 0) {
      const emptyMsg = document.createElement('div');
      emptyMsg.className = isSidebar ? 'kimi-sidebar-chat-message assistant' : 'kimi-chat-message assistant';
      emptyMsg.textContent = '开始新的对话吧！';
      messagesContainer.appendChild(emptyMsg);
      return;
    }

    // 显示所有消息
    messages.forEach(msg => {
      const messageEl = document.createElement('div');
      messageEl.className = isSidebar
        ? `kimi-sidebar-chat-message ${msg.role}`
        : `kimi-chat-message ${msg.role}`;

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

  // 发送聊天消息
  async sendChatMessage(content, isSidebar) {
    content = content.trim();
    if (!content) return;

    const chatInput = isSidebar
      ? this.sidebar.querySelector('.kimi-sidebar-chat-input')
      : this.floatingWindow.querySelector('.kimi-chat-input');

    const sendBtn = isSidebar
      ? this.sidebar.querySelector('.kimi-sidebar-send-btn')
      : this.floatingWindow.querySelector('.kimi-send-btn');

    // 清空输入框并禁用发送按钮
    chatInput.value = '';
    sendBtn.disabled = true;

    try {
      // 添加用户消息
      await this.addMessage('user', content);
      this.refreshChatMessages(isSidebar);

      // 显示加载状态
      this.showChatLoading(isSidebar, true);

      // 调用AI API
      const response = await this.callChatAPI(content);

      // 添加AI回复
      await this.addMessage('assistant', response);
      this.refreshChatMessages(isSidebar);

    } catch (error) {
      console.error('发送消息失败:', error);

      // 显示错误消息
      await this.addMessage('assistant', `抱歉，发送消息时出现错误：${error.message}`);
      this.refreshChatMessages(isSidebar);
    } finally {
      // 恢复发送按钮
      sendBtn.disabled = false;
      this.showChatLoading(isSidebar, false);
    }
  }

  // 显示/隐藏聊天加载状态
  showChatLoading(isSidebar, show) {
    const messagesContainer = isSidebar
      ? this.sidebar.querySelector('.kimi-sidebar-chat-messages')
      : this.floatingWindow.querySelector('.kimi-chat-messages');

    const loadingClass = isSidebar ? 'kimi-sidebar-chat-loading' : 'kimi-chat-loading';
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

  // 调用聊天API
  async callChatAPI(userMessage) {
    // 获取当前对话上下文
    const messages = this.getChatContext();

    // 确保消息格式正确
    const formattedMessages = messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    // 构建API请求
    const requestData = {
      model: this.settings.model || 'gpt-3.5-turbo',
      messages: formattedMessages,
      temperature: 0.7,
      max_tokens: 2000
    };

    try {
      const response = await fetch(this.settings.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.settings.apiKey}`
        },
        body: JSON.stringify(requestData)
      });

      if (!response.ok) {
        throw new Error(`API请求失败: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error.message || 'API返回错误');
      }

      return data.choices[0].message.content;
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
      ? this.sidebar.querySelector('.kimi-sidebar-chat-input')
      : this.floatingWindow.querySelector('.kimi-chat-input');
    chatInput.value = '';
    chatInput.focus();
  }
}

// 初始化插件
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new KimiMini();
  });
} else {
  new KimiMini();
}
