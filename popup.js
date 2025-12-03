// nimi popup.js
// 处理设置页面的交互逻辑

class SettingsManager {
  constructor() {
    this.settings = {};
    this.init();
  }

  async init() {
    await this.loadSettings();
    this.bindEvents();
    this.renderTemplates();
    this.updateDisplayMode();
  }

  // 加载设置
  async loadSettings() {
    const result = await chrome.storage.sync.get([
      'modelUrl',
      'apiKey',
      'modelName',
      'apiType',
      'userTemplates',
      'displayMode'
    ]);

    this.settings = {
      modelUrl: result.modelUrl || 'https://api.siliconflow.cn/v1/chat/completions',
      apiKey: result.apiKey || '',
      modelName: result.modelName || 'MiniMaxAI/MiniMax-M2',
      apiType: result.apiType || 'anthropic',
      userTemplates: result.userTemplates || [
        '总结→中文→不超过 5 句',
        '解释→给 10 岁小孩能听懂',
        '翻译→英文'
      ],
      displayMode: result.displayMode || 'floating'
    };

    // 填充表单
    document.getElementById('apiType').value = this.settings.apiType;
    document.getElementById('modelUrl').value = this.settings.modelUrl;
    document.getElementById('apiKey').value = this.settings.apiKey;

    // 如果有保存的模型名称，尝试获取模型列表
    if (this.settings.modelName && this.settings.modelUrl) {
      this.populateModelSelect();
    }
  }

  // 绑定事件
  bindEvents() {
    // 保存按钮
    document.getElementById('saveBtn').addEventListener('click', () => {
      this.saveSettings();
    });

    // 添加模板按钮
    document.getElementById('addTemplateBtn').addEventListener('click', () => {
      this.settings.userTemplates.push('新的模板...');
      this.renderTemplates();
    });

    // 显示模式选择
    document.getElementById('floatingOption').addEventListener('click', () => {
      this.selectDisplayMode('floating');
    });

    document.getElementById('sidebarOption').addEventListener('click', () => {
      this.selectDisplayMode('sidebar');
    });

    // 刷新模型按钮
    document.getElementById('refreshModelsBtn').addEventListener('click', () => {
      this.fetchModels();
    });

    // 当模型接口地址改变时，清空模型列表
    document.getElementById('modelUrl').addEventListener('input', () => {
      this.clearModelList();
    });

    // 测试接口按钮
    document.getElementById('testApiBtn').addEventListener('click', () => {
      this.testApiConnection();
    });
  }

  // 渲染模板列表
  renderTemplates() {
    const container = document.getElementById('templatesContainer');
    container.innerHTML = '';

    this.settings.userTemplates.forEach((template, index) => {
      const item = document.createElement('div');
      item.className = 'template-item';
      item.innerHTML = `
        <input type="text" value="${template}" data-index="${index}">
        <button data-index="${index}">删除</button>
      `;

      // 输入框事件
      const input = item.querySelector('input');
      input.addEventListener('input', (e) => {
        this.settings.userTemplates[index] = e.target.value;
      });

      // 删除按钮事件
      const deleteBtn = item.querySelector('button');
      deleteBtn.addEventListener('click', () => {
        this.settings.userTemplates.splice(index, 1);
        this.renderTemplates();
      });

      container.appendChild(item);
    });
  }

  // 选择显示模式
  selectDisplayMode(mode) {
    this.settings.displayMode = mode;
    this.updateDisplayMode();
  }

  // 更新显示模式UI
  updateDisplayMode() {
    const floatingOption = document.getElementById('floatingOption');
    const sidebarOption = document.getElementById('sidebarOption');

    floatingOption.classList.remove('selected');
    sidebarOption.classList.remove('selected');

    if (this.settings.displayMode === 'floating') {
      floatingOption.classList.add('selected');
    } else {
      sidebarOption.classList.add('selected');
    }
  }

  // 保存设置
  async saveSettings() {
    try {
      // 更新设置对象
      this.settings.apiType = document.getElementById('apiType').value;
      this.settings.modelUrl = document.getElementById('modelUrl').value.trim();
      this.settings.modelName = document.getElementById('modelName').value;
      this.settings.apiKey = document.getElementById('apiKey').value.trim();

      // 验证必填项
      if (!this.settings.modelUrl) {
        this.showStatus('请填写模型接口地址', 'error');
        return;
      }
      if (!this.settings.modelName) {
        this.showStatus('请选择模型名称', 'error');
        return;
      }
      if (!this.settings.apiKey) {
        this.showStatus('请填写API Key', 'error');
        return;
      }

      // 保存到storage
      await chrome.storage.sync.set({
        apiType: this.settings.apiType,
        modelUrl: this.settings.modelUrl,
        modelName: this.settings.modelName,
        apiKey: this.settings.apiKey,
        userTemplates: this.settings.userTemplates,
        displayMode: this.settings.displayMode
      });

      this.showStatus('✅ 设置已保存', 'success');

      // 3秒后关闭弹窗
      setTimeout(() => {
        window.close();
      }, 1500);

    } catch (error) {
      this.showStatus('❌ 保存失败: ' + error.message, 'error');
    }
  }

  // 清空模型列表
  clearModelList() {
    const modelSelect = document.getElementById('modelName');
    modelSelect.innerHTML = '<option value="">请先获取模型列表</option>';
  }

  // 填充模型选择框
  populateModelSelect() {
    const modelSelect = document.getElementById('modelName');
    const savedModelName = this.settings.modelName;

    // 如果已经有选项，先清空
    if (modelSelect.options.length > 1) {
      return; // 已经填充过了
    }

    // 添加一个临时选项
    modelSelect.innerHTML = '<option value="">正在获取模型列表...</option>';

    // 尝试获取模型列表
    this.fetchModels();
  }

  // 从接口获取模型清单
  async fetchModels() {
    const modelUrl = document.getElementById('modelUrl').value.trim();
    const apiKey = document.getElementById('apiKey').value.trim();
    const modelSelect = document.getElementById('modelName');
    const refreshBtn = document.getElementById('refreshModelsBtn');

    if (!modelUrl) {
      this.showStatus('请先填写模型接口地址', 'error');
      this.clearModelList();
      return;
    }

    if (!apiKey) {
      this.showStatus('请先填写API Key', 'error');
      this.clearModelList();
      return;
    }

    try {
      // 禁用按钮，显示加载状态
      refreshBtn.disabled = true;
      refreshBtn.textContent = '获取中...';
      modelSelect.innerHTML = '<option value="">正在获取模型列表...</option>';

      // 构建v1/models接口地址
      const baseUrl = modelUrl.replace(/\/chat\/completions$/, '');
      const modelsUrl = `${baseUrl}/models`;

      // 发送请求
      const response = await fetch(modelsUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      // 清空选择框
      modelSelect.innerHTML = '';

      // 添加默认选项
      const defaultOption = document.createElement('option');
      defaultOption.value = '';
      defaultOption.textContent = '请选择模型';
      modelSelect.appendChild(defaultOption);

      // 解析模型列表
      let models = [];
      if (Array.isArray(data)) {
        // OpenAI兼容格式: [{id: "model1", ...}, {id: "model2", ...}]
        models = data.map(item => item.id || item.name);
      } else if (data.data && Array.isArray(data.data)) {
        // OpenAI兼容格式: {data: [{id: "model1", ...}, {id: "model2", ...}]}
        models = data.data.map(item => item.id || item.name);
      } else if (data.models && Array.isArray(data.models)) {
        // Anthropic格式: {models: [{id: "model1", ...}, {id: "model2", ...}]}
        models = data.models.map(item => item.id || item.name);
      } else {
        throw new Error('无法解析模型列表格式');
      }

      // 去重并排序
      models = [...new Set(models)].sort();

      // 添加到选择框
      models.forEach(model => {
        const option = document.createElement('option');
        option.value = model;
        option.textContent = model;
        modelSelect.appendChild(option);
      });

      // 如果有保存的模型名称，选中它
      if (this.settings.modelName) {
        modelSelect.value = this.settings.modelName;
      }

      this.showStatus(`✅ 成功获取 ${models.length} 个模型`, 'success');

    } catch (error) {
      console.error('获取模型列表失败:', error);
      this.clearModelList();
      this.showStatus(`❌ 获取模型列表失败: ${error.message}`, 'error');
    } finally {
      // 恢复按钮状态
      refreshBtn.disabled = false;
      refreshBtn.textContent = '刷新模型';
    }
  }

  // 测试API接口连接
  async testApiConnection() {
    const modelUrl = document.getElementById('modelUrl').value.trim();
    const apiKey = document.getElementById('apiKey').value.trim();
    const modelName = document.getElementById('modelName').value;
    const apiType = document.getElementById('apiType').value;
    const testBtn = document.getElementById('testApiBtn');
    const testResultDiv = document.getElementById('testApiResult');

    if (!modelUrl) {
      this.showTestResult('请先填写模型接口地址', 'error');
      return;
    }

    if (!apiKey) {
      this.showTestResult('请先填写API Key', 'error');
      return;
    }

    if (!modelName) {
      this.showTestResult('请先选择模型名称', 'error');
      return;
    }

    try {
      // 禁用按钮，显示加载状态
      testBtn.disabled = true;
      testBtn.textContent = '测试中...';
      this.showTestResult('正在测试接口连接...', 'info');

      // 准备请求数据
      const prompt = 'HI';
      let requestData = {};
      let headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      };

      if (apiType === 'anthropic') {
        // Anthropic API格式
        headers['anthropic-version'] = '2023-06-01';
        requestData = {
          model: modelName,
          max_tokens: 100,
          temperature: 0.7,
          messages: [{ role: 'user', content: prompt }]
        };
      } else {
        // OpenAI兼容格式
        requestData = {
          model: modelName,
          messages: [{ role: 'user', content: prompt }],
          stream: false,
          temperature: 0.7,
          max_tokens: 100
        };
      }

      // 发送测试请求
      const response = await fetch(modelUrl, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(requestData)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      // 解析响应
      let responseText = '';
      if (apiType === 'anthropic') {
        // Anthropic格式: data.content[0].text
        responseText = data.content?.[0]?.text || data.content?.[0]?.content || '';
      } else {
        // OpenAI格式: data.choices[0].message.content
        responseText = data.choices?.[0]?.message?.content || '';
      }

      if (responseText) {
        this.showTestResult(`✅ 接口连接成功！\n模型响应: ${responseText}`, 'success');
      } else {
        this.showTestResult('⚠️ 接口连接成功，但未收到有效响应内容', 'warning');
      }

    } catch (error) {
      console.error('测试接口连接失败:', error);
      this.showTestResult(`❌ 接口连接失败: ${error.message}`, 'error');
    } finally {
      // 恢复按钮状态
      testBtn.disabled = false;
      testBtn.textContent = '🔍 测试接口连接';
    }
  }

  // 显示测试结果
  showTestResult(message, type) {
    const testResultDiv = document.getElementById('testApiResult');
    testResultDiv.textContent = message;
    testResultDiv.className = `status ${type}`;
    testResultDiv.style.display = 'block';

    // 设置不同的样式
    if (type === 'success') {
      testResultDiv.style.background = '#d4edda';
      testResultDiv.style.color = '#155724';
      testResultDiv.style.border = '1px solid #c3e6cb';
    } else if (type === 'error') {
      testResultDiv.style.background = '#f8d7da';
      testResultDiv.style.color = '#721c24';
      testResultDiv.style.border = '1px solid #f5c6cb';
    } else if (type === 'warning') {
      testResultDiv.style.background = '#fff3cd';
      testResultDiv.style.color = '#856404';
      testResultDiv.style.border = '1px solid #ffeaa7';
    } else if (type === 'info') {
      testResultDiv.style.background = '#d1ecf1';
      testResultDiv.style.color = '#0c5460';
      testResultDiv.style.border = '1px solid #bee5eb';
    }
  }

  // 显示状态信息
  showStatus(message, type) {
    const statusDiv = document.getElementById('statusMessage');
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
  }
}

// 初始化设置管理器
document.addEventListener('DOMContentLoaded', () => {
  new SettingsManager();
});
