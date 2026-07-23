/**
 * 全局数据可见性 Context
 *
 * 隐藏模式下所有页面的用例数据（成绩、文件、课程信息等）归零，
 * 只保留功能操作界面。
 *
 * 状态通过 localStorage 持久化，跨页面 / 刷新保持。
 */

import React, { createContext, useContext, useState, useCallback } from 'react';

interface DataVisibilityContextType {
  /** 是否显示用例数据 */
  visible: boolean;
  /** 切换显示/隐藏 */
  toggleVisibility: () => void;
}

const DataVisibilityContext = createContext<DataVisibilityContextType>({
  visible: true,
  toggleVisibility: () => {},
});

export const DataVisibilityProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [visible, setVisible] = useState(() => {
    // 默认为 true，初始时显示种子/示例数据
    const stored = localStorage.getItem('showUseCaseData');
    return stored === null ? true : stored === 'true';
  });

  const toggleVisibility = useCallback(() => {
    setVisible(prev => {
      const next = !prev;
      localStorage.setItem('showUseCaseData', String(next));
      return next;
    });
  }, []);

  return (
    <DataVisibilityContext.Provider value={{ visible, toggleVisibility }}>
      {children}
    </DataVisibilityContext.Provider>
  );
};

/** 获取当前数据可见性状态 */
export const useDataVisibility = () => useContext(DataVisibilityContext);

export default DataVisibilityContext;
