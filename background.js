// nimi background.js (Service Worker V3)
// 处理快捷键、右键菜单等后台任务

// 监听快捷键命令
chrome.commands.onCommand.addListener((command) => {
  if (command === 'nimi-open') {
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

// 安装时创建右键菜单并设置事件监听器
chrome.runtime.onInstalled.addListener(() => {
  try {
    chrome.contextMenus.create({
      id: 'nimi-mini-summarize',
      title: '✨ 用nimi生成摘要',
      contexts: ['page']
    });

    chrome.contextMenus.create({
      id: 'nimi-mini-selection',
      title: '✨ 用nimi解释选中文本',
      contexts: ['selection']
    });

    chrome.contextMenus.create({
      id: 'nimi-mini-toggle',
      title: '✨ 打开/关闭nimi',
      contexts: ['page']
    });

    // 设置右键菜单事件监听器
    setupContextMenus();

    // 打开设置页面（新安装时）
    chrome.tabs.create({
      url: chrome.runtime.getURL('popup.html')
    });

    console.log('nimi 插件已安装，右键菜单已创建');
  } catch (error) {
    console.error('安装插件时出错:', error);
  }
});

// 处理右键菜单点击
function setupContextMenus() {
  try {
    // 检查 contextMenus API 是否可用
    if (!chrome.contextMenus) {
      console.error('contextMenus API 不可用，请检查 manifest.json 权限配置');
      return;
    }

    // 移除可能已存在的监听器（避免重复注册）
    if (chrome.contextMenus.onClicked.hasListeners()) {
      chrome.contextMenus.onClicked.removeListener(contextMenuClickHandler);
    }

    // 定义点击处理函数
    async function contextMenuClickHandler(info, tab) {
      try {
        if (!tab) return;

        switch (info.menuItemId) {
          case 'nimi-mini-summarize':
            chrome.tabs.sendMessage(tab.id, { action: 'generateSummary' });
            break;

          case 'nimi-mini-selection':
            chrome.tabs.sendMessage(tab.id, {
              action: 'handleSelection',
              selectionText: info.selectionText
            });
            break;

          case 'nimi-mini-toggle':
            chrome.tabs.sendMessage(tab.id, { action: 'toggleWindow' });
            break;
        }
      } catch (error) {
        console.error('右键菜单点击处理失败:', error);
      }
    }

    // 注册事件监听器
    chrome.contextMenus.onClicked.addListener(contextMenuClickHandler);

    console.log('右键菜单事件监听器已注册');
  } catch (error) {
    console.error('注册右键菜单事件监听器失败:', error);
  }
}

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
  setupContextMenus();
});

// 确保 Service Worker 激活时也设置事件监听器
self.addEventListener('activate', () => {
  console.log('nimi Service Worker 已激活');
  setupContextMenus();
});
