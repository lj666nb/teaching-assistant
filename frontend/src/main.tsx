/**
 * 应用入口 — 含错误捕获
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { AuthProvider } from './context/AuthContext';
import App from './App';

// 创建错误显示区域
const errDiv = document.createElement('div');
errDiv.id = 'err-box';
errDiv.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:999999;background:#1a1a2e;color:#ff6b6b;padding:16px 20px;font-family:monospace;font-size:13px;line-height:1.6;max-height:200px;overflow:auto;display:none';
document.body.appendChild(errDiv);

// 捕获全局错误
window.onerror = function(msg, src, line, col, err) {
  const d = document.getElementById('err-box');
  if (!d) return;
  d.style.display = 'block';
  d.innerHTML += '<div style="border-bottom:1px solid #333;padding:4px 0">❌ ' +
    String(msg).substring(0, 200) + '<br><span style="color:#999;font-size:11px">' +
    (src || '') + ':' + line + ':' + col + '</span></div>';
  return true;
};

// 捕获未处理的 Promise 错误
window.addEventListener('unhandledrejection', function(e) {
  const d = document.getElementById('err-box');
  if (!d) return;
  d.style.display = 'block';
  d.innerHTML += '<div style="border-bottom:1px solid #333;padding:4px 0">⚠️ Promise: ' +
    String(e.reason).substring(0, 200) + '</div>';
});

// 标记 JS 引擎已启动
document.title = 'JS运行中...';

try {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#1677ff', borderRadius: 8 } }}>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ConfigProvider>,
  );
  // 标记渲染成功
  document.title = 'Edu-TA 智教星';
} catch (e) {
  const d = document.getElementById('err-box');
  if (d) {
    d.style.display = 'block';
    d.innerHTML += '<div style="color:#fff;font-weight:bold">🔥 React 渲染崩溃:</div>' +
      '<div style="color:#ff6b6b">' + String(e).substring(0, 500) + '</div>';
  }
}
