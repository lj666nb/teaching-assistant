/**
 * 认证上下文 — 管理登录/注册状态。
 *
 * 支持默认 admin 账号 + 用户自行注册账号，
 * 注册信息持久化存储于 localStorage。
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

interface AuthState {
  isLoggedIn: boolean;
  username: string;
}

interface AuthContextType extends AuthState {
  login: (username: string, password: string) => Promise<{ success: boolean; message: string }>;
  register: (data: { username: string; password: string; name: string; course: string }) => Promise<{ success: boolean; message: string }>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  isLoggedIn: false,
  username: '',
  login: async () => ({ success: false, message: '' }),
  register: async () => ({ success: false, message: '' }),
  logout: () => {},
});

export const useAuth = () => useContext(AuthContext);

// 默认管理员账号
const DEFAULT_ADMIN = { username: 'admin', password: 'admin123' };

// localStorage 键名
const STORAGE_KEY_AUTH = 'edu_ta_auth';
const STORAGE_KEY_USERS = 'edu_ta_users';

/** 获取所有注册用户 */
const getRegisteredUsers = (): Record<string, { password: string; name: string; course: string }> => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY_USERS) || '{}');
  } catch {
    return {};
  }
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [username, setUsername] = useState('');

  // 初始化时检查登录状态
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY_AUTH);
    if (saved) {
      try {
        const data = JSON.parse(saved);
        if (data.username) {
          setIsLoggedIn(true);
          setUsername(data.username);
        }
      } catch {
        localStorage.removeItem(STORAGE_KEY_AUTH);
      }
    }
  }, []);

  /** 登录 */
  const login = useCallback(async (inputUser: string, inputPwd: string) => {
    await new Promise(resolve => setTimeout(resolve, 800));

    // 1. 检查默认管理员
    if (inputUser === DEFAULT_ADMIN.username && inputPwd === DEFAULT_ADMIN.password) {
      setIsLoggedIn(true);
      setUsername(inputUser);
      localStorage.setItem(STORAGE_KEY_AUTH, JSON.stringify({ username: inputUser, loginTime: Date.now() }));
      return { success: true, message: '登录成功' };
    }

    // 2. 检查注册用户
    const users = getRegisteredUsers();
    const user = users[inputUser];
    if (user && user.password === inputPwd) {
      setIsLoggedIn(true);
      setUsername(inputUser);
      localStorage.setItem(STORAGE_KEY_AUTH, JSON.stringify({ username: inputUser, loginTime: Date.now() }));
      return { success: true, message: '登录成功' };
    }

    // 3. 账号不存在
    if (!user && inputUser !== DEFAULT_ADMIN.username) {
      return { success: false, message: '账号不存在，请先注册' };
    }

    // 4. 密码错误
    return { success: false, message: '密码错误，请重新输入' };
  }, []);

  /** 注册 */
  const register = useCallback(async (data: { username: string; password: string; name: string; course: string }) => {
    await new Promise(resolve => setTimeout(resolve, 800));

    // 检查是否与默认管理员冲突
    if (data.username === DEFAULT_ADMIN.username) {
      return { success: false, message: '该账号已被占用，请更换' };
    }

    // 检查是否已注册
    const users = getRegisteredUsers();
    if (users[data.username]) {
      return { success: false, message: '该账号已被注册' };
    }

    // 保存新用户
    users[data.username] = { password: data.password, name: data.name, course: data.course };
    localStorage.setItem(STORAGE_KEY_USERS, JSON.stringify(users));
    return { success: true, message: '注册成功，请登录' };
  }, []);

  /** 退出 */
  const logout = useCallback(() => {
    setIsLoggedIn(false);
    setUsername('');
    localStorage.removeItem(STORAGE_KEY_AUTH);
  }, []);

  return (
    <AuthContext.Provider value={{ isLoggedIn, username, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthContext;
