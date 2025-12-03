// crypto-utils.js
// API Key安全存储工具模块（Base64+混淆）

class CryptoUtils {
  // 混淆前缀，增加安全性
  static OBFUSCATION_PREFIX = 'nimi_secure_';

  // Base64编码
  static encodeBase64(text) {
    try {
      return btoa(unescape(encodeURIComponent(text)));
    } catch (error) {
      console.error('Base64编码失败:', error);
      return text; // 编码失败时返回原文本
    }
  }

  // Base64解码
  static decodeBase64(encoded) {
    try {
      return decodeURIComponent(escape(atob(encoded)));
    } catch (error) {
      // 如果不是有效的base64，返回原字符串（向后兼容）
      console.warn('Base64解码失败，返回原字符串:', error);
      return encoded;
    }
  }

  // 检查是否为有效的base64字符串
  static isBase64(str) {
    try {
      return btoa(atob(str)) === str;
    } catch (error) {
      return false;
    }
  }

  // 简单混淆：字符串反转 + 添加前缀
  static obfuscate(text) {
    if (!text) return '';
    // 反转字符串
    const reversed = text.split('').reverse().join('');
    // 添加混淆前缀
    return this.OBFUSCATION_PREFIX + reversed;
  }

  // 去除混淆：移除前缀 + 反转字符串
  static deobfuscate(obfuscated) {
    if (!obfuscated) return '';

    // 检查是否有混淆前缀
    if (obfuscated.startsWith(this.OBFUSCATION_PREFIX)) {
      // 移除前缀
      const withoutPrefix = obfuscated.substring(this.OBFUSCATION_PREFIX.length);
      // 反转字符串恢复原状
      return withoutPrefix.split('').reverse().join('');
    }

    // 如果没有混淆前缀，直接返回（向后兼容）
    return obfuscated;
  }

  // 安全编码：Base64编码 + 混淆
  static secureEncode(plainKey) {
    if (!plainKey) return '';

    try {
      // 1. 先进行Base64编码
      const base64Encoded = this.encodeBase64(plainKey);
      // 2. 再进行混淆
      return this.obfuscate(base64Encoded);
    } catch (error) {
      console.error('安全编码失败:', error);
      return plainKey; // 失败时返回原文本
    }
  }

  // 安全解码：去除混淆 + Base64解码
  static secureDecode(encodedKey) {
    if (!encodedKey) return '';

    try {
      // 1. 先去除混淆
      const deobfuscated = this.deobfuscate(encodedKey);
      // 2. 再进行Base64解码
      return this.decodeBase64(deobfuscated);
    } catch (error) {
      console.warn('安全解码失败，尝试旧格式:', error);

      // 尝试旧格式：可能是纯Base64或明文
      if (this.isBase64(encodedKey)) {
        // 如果是Base64，直接解码
        return this.decodeBase64(encodedKey);
      }

      // 否则返回原字符串（可能是明文）
      return encodedKey;
    }
  }

  // 检查是否为安全格式（有混淆前缀）
  static isSecureFormat(str) {
    return str && str.startsWith(this.OBFUSCATION_PREFIX);
  }

  // 自动迁移：将旧格式转换为安全格式
  static migrateToSecureFormat(oldKey) {
    if (!oldKey) return '';

    // 如果已经是安全格式，直接返回
    if (this.isSecureFormat(oldKey)) {
      return oldKey;
    }

    // 否则转换为安全格式
    return this.secureEncode(oldKey);
  }

  // 迁移存储中的API Key到安全格式
  static async migrateStorage() {
    try {
      // 从存储中获取当前的API Key
      const result = await chrome.storage.sync.get(['apiKey']);
      const oldKey = result.apiKey;

      if (!oldKey) {
        console.log('没有找到API Key，无需迁移');
        return;
      }

      // 如果已经是安全格式，无需迁移
      if (this.isSecureFormat(oldKey)) {
        console.log('API Key已经是安全格式，无需迁移');
        return;
      }

      console.log('开始迁移API Key到安全格式...');

      // 迁移到安全格式
      const newKey = this.migrateToSecureFormat(oldKey);

      // 保存回存储
      await chrome.storage.sync.set({ apiKey: newKey });

      console.log('API Key迁移完成');

    } catch (error) {
      console.error('API Key迁移失败:', error);
    }
  }
}

// 导出供其他文件使用
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CryptoUtils;
}