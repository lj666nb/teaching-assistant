/**
 * 消息通知 — Edu-TA 智教星 全系统统一消息中枢
 *
 * 功能：五类消息聚合/未读标记/一键已读/消息溯源/批量操作
 * 联动：作业/批改/学情/系统全模块自动推送
 * 无AI操作，永久开放
 */

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Card, Typography, Space, List, Tag, Avatar, Row, Col, Statistic, Tabs, Badge, Button, message, Tooltip, Select, Input, Popconfirm, Checkbox, Divider } from 'antd';
import {
  NotificationOutlined, BellOutlined, CheckCircleOutlined, WarningOutlined,
  InfoCircleOutlined, CheckOutlined, DeleteOutlined, SearchOutlined,
  ClockCircleOutlined, EyeOutlined, HomeOutlined, ReloadOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { notificationApi } from '../api/client';
import { BRAND } from '../utils/brand';
import './../styles/brand.css';
import { useDataVisibility } from '../context/DataVisibilityContext';

const { Text } = Typography;

const BrandBadge: React.FC<{ size?: number; color?: string }> = ({ size = 14, color }) => (
  <span dangerouslySetInnerHTML={{ __html: BRAND.badgeSvg.replace('currentColor', color || BRAND.colors.primary) }}
    style={{ width: size, height: size, display: 'inline-flex', verticalAlign: 'middle' }} />
);

interface NotificationItem {
  id: string; type: string; title: string; desc: string; time: string;
  time_raw: string; unread: boolean; route?: string;
}

const typeConfig: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  '作业': { label: '作业', color: BRAND.colors.primary, icon: <BellOutlined /> },
  '批改': { label: '批改', color: BRAND.colors.green, icon: <CheckCircleOutlined /> },
  '预警': { label: '预警', color: BRAND.colors.error, icon: <WarningOutlined /> },
  '系统': { label: '系统', color: BRAND.colors.purple, icon: <InfoCircleOutlined /> },
};

const NotificationCenter: React.FC = () => {
  const { visible } = useDataVisibility();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);

  const loadNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const res = await notificationApi.list();
      if (res.data.success) setNotifications(res.data.data.items || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadNotifications(); }, [loadNotifications]);

  const [activeTab, setActiveTab] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [timeFilter, setTimeFilter] = useState('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const markAllAsRead = async () => {
    try { await notificationApi.readAll(); setNotifications(prev => prev.map(n => ({ ...n, unread: false }))); setSelectedIds([]); message.success('已全部标记为已读'); }
    catch { message.error('操作失败'); }
  };
  const markAsRead = async (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, unread: false } : n));
    try { await notificationApi.markRead(id); } catch {}
  };
  const deleteItem = async (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
    try { await notificationApi.delete(id); message.success('已删除'); } catch { message.error('删除失败'); }
  };
  const batchMarkRead = async () => {
    for (const id of selectedIds) { try { await notificationApi.markRead(id); } catch {} }
    setNotifications(prev => prev.map(n => selectedIds.includes(n.id) ? { ...n, unread: false } : n));
    setSelectedIds([]); message.success(`已标记 ${selectedIds.length} 条为已读`);
  };
  const batchDelete = async () => {
    try { await notificationApi.batchDelete(selectedIds); setNotifications(prev => prev.filter(n => !selectedIds.includes(n.id))); setSelectedIds([]); message.success(`已删除 ${selectedIds.length} 条`); }
    catch { message.error('批量删除失败'); }
  };

  const filtered = useMemo(() => {
    let data = notifications;
    // 隐藏模式下仅隐藏种子通知，保留用户生成的通知
    if (!visible) data = data.filter(n => !n.id.startsWith('seed_'));
    if (activeTab === 'unread') data = data.filter(n => n.unread);
    else if (activeTab === 'homework') data = data.filter(n => n.type === '作业' || n.type === '批改');
    else if (activeTab === 'warning') data = data.filter(n => n.type === '预警');
    else if (activeTab === 'system') data = data.filter(n => n.type === '系统');
    if (searchText) data = data.filter(n => n.title.includes(searchText) || n.desc.includes(searchText));
    if (timeFilter === 'today') data = data.filter(n => n.time.includes('小时前') || n.time.includes('分钟前') || n.time === '刚刚');
    else if (timeFilter === 'week') data = data.filter(n => n.time.includes('小时前') || n.time.includes('分钟前') || n.time.includes('昨天'));
    else if (timeFilter === 'month') data = data;
    return data;
  }, [notifications, activeTab, searchText, timeFilter, visible]);

  // 所有统计数字基于全部可见通知（不受当前Tab/搜索/时间筛选影响）
  const visibleNotifications = visible ? notifications : notifications.filter(n => !n.id.startsWith('seed_'));
  const displayUnread = visibleNotifications.filter(n => n.unread).length;
  const displayToday = visibleNotifications.filter(n => n.time?.includes('小时前') || n.time?.includes('分钟前') || n.time === '刚刚').length;
  const displayTotal = visibleNotifications.length;

  const handleViewDetail = (item: NotificationItem) => {
    if (item.unread) markAsRead(item.id);
    if (item.route) navigate(item.route);
    else message.info(item.desc);
  };

  const typeTagColor = (t: string) => {
    const map: Record<string, string> = { '作业': 'blue', '批改': 'green', '预警': 'red', '系统': 'purple' };
    return map[t] || 'default';
  };

  return (
    <div className="page-enter">
      <div style={{ marginBottom: 16 }}>
        <Space align="center" size={10}>
          <span dangerouslySetInnerHTML={{ __html: BRAND.logoSvg }} style={{ width: 32, height: 32, display: 'inline-flex', animation: 'logoPulse 0.8s ease-out' }} />
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: BRAND.colors.textPrimary }}>智教星 · 消息通知</div>
            <Text type="secondary" style={{ fontSize: 11 }}>全系统消息中枢 · 实时推送 · 一键溯源</Text>
          </div>
        </Space>
      </div>

      {/* 统计卡 */}
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        {[
          { value: displayUnread, label: '未读消息', icon: <BellOutlined />, color: displayUnread > 0 ? BRAND.colors.error : BRAND.colors.primary, tip: visible ? `作业:${notifications.filter(n=>n.unread&&(n.type==='作业'||n.type==='批改')).length} 预警:${notifications.filter(n=>n.unread&&n.type==='预警').length} 系统:${notifications.filter(n=>n.unread&&n.type==='系统').length}` : '', action: () => { setActiveTab('unread'); setSearchText(''); setTimeFilter('all'); } },
          { value: displayToday, label: '今日通知', icon: <NotificationOutlined />, color: BRAND.colors.green, tip: visible ? `当前显示 ${displayToday} 条` : '', action: () => { setActiveTab('all'); setSearchText(''); setTimeFilter('today'); } },
          { value: displayTotal, label: '总提醒数', icon: <InfoCircleOutlined />, color: BRAND.colors.primary, tip: visible ? `终身累计 ${notifications.length} 条消息` : '', action: () => { setActiveTab('all'); setSearchText(''); setTimeFilter('all'); } },
        ].map((item, i) => (
          <Col span={8} key={i}>
            <Tooltip title={item.tip}>
              <Card hoverable className="brand-card" bodyStyle={{ padding: '14px 18px', position: 'relative' }}
                onClick={item.action}>
                <span style={{ position: 'absolute', top: 6, right: 8, color: item.color, opacity: 0.3 }}><BrandBadge /></span>
                {i === 0 && visible && displayUnread > 0 && (
                  <span style={{ position: 'absolute', top: 4, left: 4, width: 8, height: 8, borderRadius: '50%', background: BRAND.colors.error, boxShadow: `0 0 6px ${BRAND.colors.error}` }} />
                )}
                <Statistic title={<Text style={{ fontSize: 12, color: BRAND.colors.textSecondary }}>{item.label}</Text>}
                  value={item.value} suffix={<Text style={{ fontSize: 12, color: BRAND.colors.textTertiary }}>条</Text>}
                  prefix={React.cloneElement(item.icon as any, { style: { color: item.color, fontSize: 18 } })}
                  valueStyle={{ fontSize: 26, fontWeight: 700, color: item.value > 0 && i === 0 ? BRAND.colors.error : BRAND.colors.textPrimary }} />
              </Card>
            </Tooltip>
          </Col>
        ))}
      </Row>

      {/* 消息列表 */}
      <Card className="brand-card" bodyStyle={{ padding: '12px 16px' }}
        title={<Space><BrandBadge /><NotificationOutlined style={{ color: BRAND.colors.primary }} /><Text strong>消息通知</Text></Space>}
        extra={
          <Space size={8}>
            <Button size="small" icon={<ReloadOutlined />} onClick={loadNotifications} loading={loading} style={{ borderRadius: 6 }}>刷新</Button>
            <Input placeholder="搜索通知..." prefix={<SearchOutlined />} style={{ width: 160, borderRadius: 6 }} value={searchText} onChange={e => setSearchText(e.target.value)} allowClear />
            <Select style={{ width: 120, borderRadius: 6 }} value={timeFilter} onChange={setTimeFilter}
              options={[{ value: 'all', label: '全部时间' }, { value: 'today', label: '今日' }, { value: 'week', label: '近7天' }, { value: 'month', label: '近30天' }]} />
            {visible && displayUnread > 0 && <Button type="primary" size="small" icon={<CheckOutlined />} onClick={markAllAsRead}
              style={{ borderRadius: 6, border: 'none', background: BRAND.colors.primaryGradient }}>全部已读</Button>}
          </Space>
        }>
        <Tabs activeKey={activeTab} onChange={v => { setActiveTab(v); setSelectedIds([]); }}
          items={[
            { key: 'all', label: `全部(${displayTotal})` },
            { key: 'unread', label: `未读(${displayUnread})` },
            { key: 'homework', label: '作业' },
            { key: 'warning', label: '预警' },
            { key: 'system', label: '系统' },
          ]} />

        {/* 批量操作栏 — 始终显示 */}
        {filtered.length > 0 && (
          <div style={{ marginBottom: 8, padding: '6px 12px', background: `${BRAND.colors.primary}08`, borderRadius: 6 }}>
            <Space>
              <Checkbox checked={selectedIds.length === filtered.length && filtered.length > 0} onChange={e => {
                if (e.target.checked) setSelectedIds(filtered.map(n => n.id));
                else setSelectedIds([]);
              }}>全选</Checkbox>
              <Text style={{ fontSize: 12 }}>{selectedIds.length > 0 ? `已选 ${selectedIds.length} 条` : '勾选通知进行批量操作'}</Text>
              <Button size="small" icon={<CheckOutlined />} disabled={selectedIds.length === 0}
                onClick={batchMarkRead} style={{ borderRadius: 6, borderColor: BRAND.colors.primary, color: BRAND.colors.primary }}>标记已读</Button>
              <Popconfirm title={`删除 ${selectedIds.length} 条通知？`} onConfirm={batchDelete} disabled={selectedIds.length === 0}>
                <Button size="small" danger icon={<DeleteOutlined />} disabled={selectedIds.length === 0} style={{ borderRadius: 6 }}>批量删除</Button>
              </Popconfirm>
            </Space>
          </div>
        )}

        <List dataSource={filtered} loading={loading}
          locale={{ emptyText: visible ? '暂无通知，发布作业后将自动推送' : '暂无通知' }} renderItem={item => {
          const tc = typeConfig[item.type] || typeConfig['系统'];
          return (
            <List.Item
              style={{
                padding: '10px 12px', borderRadius: 8, marginBottom: 2, cursor: 'pointer',
                background: item.unread ? `${BRAND.colors.primary}04` : 'transparent',
                borderLeft: item.unread ? `3px solid ${BRAND.colors.primary}` : '3px solid transparent',
                transition: 'all 0.2s',
              }}
              onClick={() => handleViewDetail(item)}
              onMouseEnter={e => { e.currentTarget.style.background = `${BRAND.colors.primary}08`; }}
              onMouseLeave={e => { e.currentTarget.style.background = item.unread ? `${BRAND.colors.primary}04` : 'transparent'; }}
              actions={[
                <Tooltip title="查看详情" key="view">
                  <Button type="link" size="small" icon={<EyeOutlined />} style={{ fontSize: 11, color: BRAND.colors.primary }}
                    onClick={(e) => { e.stopPropagation(); handleViewDetail(item); }}>详情</Button>
                </Tooltip>,
                <Popconfirm title="删除此通知？" onConfirm={() => deleteItem(item.id)} key="del">
                  <Button type="link" size="small" danger icon={<DeleteOutlined />} style={{ fontSize: 11 }}
                    onClick={(e) => e.stopPropagation()} />
                </Popconfirm>,
              ]}
            >
              <Checkbox style={{ marginRight: 8 }}
                checked={selectedIds.includes(item.id)}
                onClick={(e) => e.stopPropagation()}
                onChange={e => {
                  if (e.target.checked) setSelectedIds([...selectedIds, item.id]);
                  else setSelectedIds(selectedIds.filter(id => id !== item.id));
                }} />
              <Badge dot={item.unread} color={BRAND.colors.primary} offset={[-2, 2]}>
                <Avatar icon={tc.icon} style={{ backgroundColor: tc.color, flexShrink: 0 }} />
              </Badge>
              <div style={{ flex: 1, marginLeft: 10 }}>
                <Space>
                  <Text strong={item.unread} style={{ fontSize: 13, color: BRAND.colors.textPrimary }}>{item.title}</Text>
                  <Tag color={typeTagColor(item.type)} style={{ borderRadius: 6, fontSize: 9, lineHeight: '18px' }}>{item.type}</Tag>
                </Space>
                <div style={{ fontSize: 12, color: BRAND.colors.textSecondary, marginTop: 1 }}>{item.desc}</div>
                <Text type="secondary" style={{ fontSize: 10 }}>{item.time}</Text>
              </div>
            </List.Item>
          );
        }} />
        {(filtered.length === 0 || !visible) && (
          <div style={{ textAlign: 'center', padding: 60, color: BRAND.colors.textTertiary }}>
            <BellOutlined style={{ fontSize: 40, color: BRAND.colors.textTertiary, opacity: 0.3 }} />
            <div style={{ marginTop: 8, fontSize: 13 }}>{visible ? '暂无符合条件的通知' : '暂无通知'}</div>
          </div>
        )}
      </Card>

      <div className="brand-watermark">Edu-TA 消息通知 · 实时推送</div>
    </div>
  );
};

export default NotificationCenter;
