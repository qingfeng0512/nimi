// nimi background.js (Service Worker V3)
// 处理快捷键、右键菜单等后台任务

// 监听快捷键命令
chrome.commands.onCommand.addListener((command) => {
  if (command === 'kimi-open') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'toggleWindow' }, (response) => {
          if (chrome.runtime.lastError) {
            console.log('发送消息失败:', chrome.runtime.lastError.message);
          }
        });
      }
    });
  }
});

// 安装时创建右键菜单
chrome.runtime.onInstalled.addListener(() => {
  try {
    chrome.contextMenus.create({
      id: 'kimi-mini-summarize',
      title: '✨ 用nimi生成摘要',
      contexts: ['page']
    });

    chrome.contextMenus.create({
      id: 'kimi-mini-selection',
      title: '✨ 用nimi解释选中文本',
      contexts: ['selection']
    });

    chrome.contextMenus.create({
      id: 'kimi-mini-toggle',
      title: '✨ 打开/关闭nimi',
      contexts: ['page']
    });

    // 打开设置页面（新安装时）
    chrome.tabs.create({
      url: chrome.runtime.getURL('popup.html')
    });
  } catch (error) {
    console.error('创建右键菜单失败:', error);
  }
});

// 处理右键菜单点击
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (!tab) return;

    switch (info.menuItemId) {
      case 'kimi-mini-summarize':
        chrome.tabs.sendMessage(tab.id, { action: 'generateSummary' });
        break;

      case 'kimi-mini-selection':
        chrome.tabs.sendMessage(tab.id, {
          action: 'handleSelection',
          selectionText: info.selectionText
        });
        break;

      case 'kimi-mini-toggle':
        chrome.tabs.sendMessage(tab.id, { action: 'toggleWindow' });
        break;
    }
  } catch (error) {
    console.error('右键菜单点击处理失败:', error);
  }
});

// 统一的消息监听器
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  try {
    if (request.action === 'getCurrentTab') {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        sendResponse(tabs[0]);
      });
      return true;
    }

    if (request.action === 'captureVisibleTab') {
      chrome.tabs.captureVisibleTab(null, {
        format: 'png',
        quality: 100
      }, (dataUrl) => {
        if (chrome.runtime.lastError) {
          sendResponse({ error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ dataUrl });
        }
      });
      return true;
    }

    if (request.action === 'saveSettings') {
      chrome.storage.sync.set(request.settings, () => {
        sendResponse({ success: true });
      });
      return true;
    }
  } catch (error) {
    console.error('消息处理失败:', error);
    sendResponse({ error: error.message });
  }
});

// Service Worker 启动时执行
chrome.runtime.onStartup.addListener(() => {
  console.log('nimi Service Worker 已启动');
});
