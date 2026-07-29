/**
 * 师生通信 — 教师端消息中心
 *
 * 左侧会话列表 + 右侧聊天区，通过 SSE 实时接收新消息。
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Layout,
  List,
  Input,
  Button,
  Badge,
  Typography,
  Space,
  Avatar,
  Modal,
  Empty,
  Spin,
  message,
  Tooltip,
} from 'antd';
import {
  PlusOutlined,
  SendOutlined,
  DeleteOutlined,
  UserOutlined,
  TeamOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL } from '../api/base';
import axios from 'axios';

const { Sider, Content } = Layout;
const { Text, Paragraph } = Typography;
const { TextArea } = Input;

// ═══════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════

interface Conversation {
  id: string;
  title: string;
  student_name: string;
  teacher_name: string;
  last_message: string;
  last_message_role: string;
  unread_count: number;
  created_at: string;
  updated_at: string;
}

interface Msg {
  id: number;
  conversation_id: string;
  sender_name: string;
  sender_role: string;
  content: string;
  is_read: boolean;
  created_at: string;
}

// ═══════════════════════════════════════════════════════════
// API 工具函数
// ═══════════════════════════════════════════════════════════

const api = axios.create({ baseURL: API_BASE_URL, timeout: 30000 });

function buildHeaders(): Record<string, string> {
  const raw = localStorage.getItem('edu_ta_auth');
  if (!raw) return {};
  try {
    const { username } = JSON.parse(raw);
    return { 'X-Teacher-Username': username || '' };
  } catch {
    return {};
  }
}

const fetchConversations = (username: string) =>
  api.get('/messaging/conversations', { params: { username, role: 'teacher' }, headers: buildHeaders() });

const createConversation = (data: { title: string; student_name: string; teacher_name: string }) =>
  api.post('/messaging/conversations', data, { headers: buildHeaders() });

const deleteConversation = (id: string) =>
  api.delete(`/messaging/conversations/${id}`, { headers: buildHeaders() });

const fetchMessages = (convId: string, page = 1) =>
  api.get(`/messaging/conversations/${convId}/messages`, { params: { page, page_size: 50 }, headers: buildHeaders() });

const sendMessageApi = (convId: string, data: { sender_name: string; sender_role: string; content: string }) =>
  api.post(`/messaging/conversations/${convId}/messages`, data, { headers: buildHeaders() });

const markRead = (convId: string) =>
  api.put(`/messaging/conversations/${convId}/read`, null, { params: { reader_role: 'teacher' }, headers: buildHeaders() });

const fetchUnread = (username: string) =>
  api.get('/messaging/unread-count', { params: { username, role: 'teacher' }, headers: buildHeaders() });

// ═══════════════════════════════════════════════════════════
// 组件
// ═══════════════════════════════════════════════════════════

const MessagingCenter: React.FC = () => {
  const { username } = useAuth();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [msgLoading, setMsgLoading] = useState(false);
  const [totalUnread, setTotalUnread] = useState(0);

  // 新建会话弹窗
  const [modalOpen, setModalOpen] = useState(false);
  const [newStudentName, setNewStudentName] = useState('');
  const [newConvTitle, setNewConvTitle] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sseRef = useRef<EventSource | null>(null);
  const convIdRef = useRef<string>('');

  // 滚动到底部
  const scrollToBottom = useCallback(() => {
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  }, []);

  // ── 加载会话列表 ──
  const loadConversations = useCallback(async () => {
    if (!username) return;
    try {
      const res = await fetchConversations(username);
      const list = res.data?.data?.conversations || [];
      setConversations(list);
      // 计算总未读数
      const total = list.reduce((s: number, c: Conversation) => s + (c.unread_count || 0), 0);
      setTotalUnread(total);
    } catch {
      // 静默失败
    }
  }, [username]);

  // ── 加载消息 ──
  const loadMessages = useCallback(async (conv: Conversation) => {
    setMsgLoading(true);
    try {
      const res = await fetchMessages(conv.id);
      setMessages(res.data?.data?.messages || []);
      // 标记已读
      await markRead(conv.id);
      loadConversations();
    } catch {
      message.error('加载消息失败');
    } finally {
      setMsgLoading(false);
    }
  }, [loadConversations]);

  // ── 选择会话 ──
  const handleSelectConv = (conv: Conversation) => {
    setSelectedConv(conv);
    convIdRef.current = conv.id;
    loadMessages(conv);
  };

  // ── 发送消息 ──
  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || !selectedConv || !username) return;
    setInputText('');
    try {
      await sendMessageApi(selectedConv.id, {
        sender_name: username,
        sender_role: 'teacher',
        content: text,
      });
      // 刷新消息列表
      await loadMessages(selectedConv);
    } catch {
      message.error('发送失败');
    }
  };

  // ── 新建会话 ──
  const handleCreateConv = async () => {
    const name = newStudentName.trim();
    if (!name || !username) return;
    try {
      const res = await createConversation({
        title: newConvTitle.trim() || `与 ${name} 的对话`,
        student_name: name,
        teacher_name: username,
      });
      const newConv = res.data?.data;
      setModalOpen(false);
      setNewStudentName('');
      setNewConvTitle('');
      loadConversations();
      if (newConv) {
        setSelectedConv(newConv);
        convIdRef.current = newConv.id;
        loadMessages(newConv);
      }
    } catch {
      message.error('创建失败');
    }
  };

  // ── 删除会话 ──
  const handleDeleteConv = async (convId: string) => {
    try {
      await deleteConversation(convId);
      if (selectedConv?.id === convId) {
        setSelectedConv(null);
        setMessages([]);
      }
      loadConversations();
      message.success('会话已删除');
    } catch {
      message.error('删除失败');
    }
  };

  // ── SSE 实时监听 ──
  useEffect(() => {
    if (!username) return;

    const streamUrl = `${API_BASE_URL}/messaging/stream?username=${encodeURIComponent(username)}&role=teacher`;

    const connectSSE = () => {
      const es = new EventSource(streamUrl);
      sseRef.current = es;

      es.addEventListener('new_message', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          if (data.conversation_id === convIdRef.current) {
            // 当前会话 → 直接追加
            setMessages(prev => {
              const exists = prev.find(m => m.id === data.message?.id);
              if (exists) return prev;
              return [...prev, data.message];
            });
            scrollToBottom();
            // 标记已读
            if (convIdRef.current) markRead(convIdRef.current);
          }
          // 刷新会话列表
          loadConversations();
        } catch { /* ignore parse errors */ }
      });

      es.onerror = () => {
        es.close();
        // 3 秒后重连
        setTimeout(connectSSE, 3000);
      };
    };

    connectSSE();

    return () => {
      sseRef.current?.close();
    };
  }, [username, loadConversations, scrollToBottom]);

  // ── 初始加载 ──
  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // ── 消息变化时滚动 ──
  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // ── 格式化时间 ──
  const formatTime = (iso: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) {
      return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    }
    return `${d.getMonth() + 1}/${d.getDate()} ${d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  };

  return (
    <Layout style={{ height: 'calc(100vh - 112px)', background: '#fff', borderRadius: 8, overflow: 'hidden' }}>
      {/* ── 左侧会话列表 ── */}
      <Sider
        width={280}
        style={{
          background: '#fafbfc',
          borderRight: '1px solid #f0f0f0',
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
        }}
      >
        <div style={{ padding: '14px 16px', borderBottom: '1px solid #f0f0f0' }}>
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Text strong style={{ fontSize: 15 }}>
              会话列表
              {totalUnread > 0 && (
                <Badge count={totalUnread} style={{ marginLeft: 8 }} size="small" />
              )}
            </Text>
            <Space size={4}>
              <Tooltip title="刷新">
                <Button size="small" type="text" icon={<ReloadOutlined />} onClick={loadConversations} />
              </Tooltip>
              <Button
                size="small"
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => setModalOpen(true)}
              >
                新建
              </Button>
            </Space>
          </Space>
        </div>

        <div style={{ flex: 1, overflow: 'auto' }}>
          {loading ? (
            <Spin style={{ display: 'block', margin: '40px auto' }} />
          ) : conversations.length === 0 ? (
            <Empty
              description="暂无会话"
              style={{ marginTop: 60 }}
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            >
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
                发起新对话
              </Button>
            </Empty>
          ) : (
            <List
              dataSource={conversations}
              renderItem={(conv) => (
                <div
                  onClick={() => handleSelectConv(conv)}
                  style={{
                    padding: '12px 16px',
                    cursor: 'pointer',
                    background: selectedConv?.id === conv.id ? '#e6f0ff' : 'transparent',
                    borderBottom: '1px solid #f5f5f5',
                    transition: 'background 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    if (selectedConv?.id !== conv.id)
                      (e.currentTarget as HTMLElement).style.background = '#f5f7fa';
                  }}
                  onMouseLeave={(e) => {
                    if (selectedConv?.id !== conv.id)
                      (e.currentTarget as HTMLElement).style.background = 'transparent';
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Space>
                      <Avatar size={36} icon={<TeamOutlined />} style={{ backgroundColor: '#1890ff' }} />
                      <div>
                        <Text strong style={{ fontSize: 13, maxWidth: 140, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {conv.title}
                        </Text>
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          {conv.student_name}
                        </Text>
                      </div>
                    </Space>
                    <Space size={2}>
                      {conv.unread_count > 0 && (
                        <Badge count={conv.unread_count} size="small" />
                      )}
                      <Tooltip title="删除">
                        <Button
                          size="small"
                          type="text"
                          danger
                          icon={<DeleteOutlined />}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteConv(conv.id);
                          }}
                        />
                      </Tooltip>
                    </Space>
                  </div>
                  {conv.last_message && (
                    <Paragraph
                      type="secondary"
                      ellipsis={{ rows: 1 }}
                      style={{ fontSize: 11, margin: '6px 0 0 44px', color: '#999' }}
                    >
                      {conv.last_message}
                    </Paragraph>
                  )}
                </div>
              )}
            />
          )}
        </div>
      </Sider>

      {/* ── 右侧聊天区 ── */}
      <Content style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {!selectedConv ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Empty
              description="选择一个会话开始交流"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          </div>
        ) : (
          <>
            {/* 聊天头部 */}
            <div
              style={{
                padding: '12px 20px',
                borderBottom: '1px solid #f0f0f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: '#fff',
              }}
            >
              <Space>
                <Avatar size={32} icon={<UserOutlined />} style={{ backgroundColor: '#52c41a' }} />
                <div>
                  <Text strong>{selectedConv.title}</Text>
                  <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
                    学生: {selectedConv.student_name}
                  </Text>
                </div>
              </Space>
            </div>

            {/* 消息列表 */}
            <div
              style={{
                flex: 1,
                overflow: 'auto',
                padding: '16px 20px',
                background: '#f5f7fa',
              }}
            >
              {msgLoading ? (
                <Spin style={{ display: 'block', margin: '40px auto' }} />
              ) : messages.length === 0 ? (
                <Empty description="暂无消息，发送第一条消息吧" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                messages.map((msg) => {
                  const isMe = msg.sender_role === 'teacher';
                  return (
                    <div
                      key={msg.id}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: isMe ? 'flex-end' : 'flex-start',
                        marginBottom: 14,
                      }}
                    >
                      <Text
                        type="secondary"
                        style={{ fontSize: 10, marginBottom: 2, color: '#bbb' }}
                      >
                        {isMe ? '我' : msg.sender_name}
                        {' · '}
                        {formatTime(msg.created_at)}
                      </Text>
                      <div
                        style={{
                          maxWidth: '65%',
                          padding: '10px 14px',
                          borderRadius: isMe ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                          background: isMe ? '#1890ff' : '#fff',
                          color: isMe ? '#fff' : '#333',
                          boxShadow: isMe
                            ? '0 2px 6px rgba(24,144,255,0.2)'
                            : '0 1px 3px rgba(0,0,0,0.08)',
                          wordBreak: 'break-word',
                          whiteSpace: 'pre-wrap',
                          fontSize: 14,
                          lineHeight: 1.7,
                        }}
                      >
                        {msg.content}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* 输入区 */}
            <div
              style={{
                padding: '12px 20px',
                borderTop: '1px solid #f0f0f0',
                background: '#fff',
              }}
            >
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                <TextArea
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onPressEnter={(e) => {
                    if (!e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="输入消息，Enter 发送，Shift+Enter 换行"
                  autoSize={{ minRows: 1, maxRows: 4 }}
                  style={{ flex: 1 }}
                />
                <Button
                  type="primary"
                  icon={<SendOutlined />}
                  onClick={handleSend}
                  disabled={!inputText.trim()}
                >
                  发送
                </Button>
              </div>
            </div>
          </>
        )}
      </Content>

      {/* ── 新建会话弹窗 ── */}
      <Modal
        title="发起新对话"
        open={modalOpen}
        onOk={handleCreateConv}
        onCancel={() => {
          setModalOpen(false);
          setNewStudentName('');
          setNewConvTitle('');
        }}
        okText="创建"
        cancelText="取消"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 8 }}>
          <div>
            <Text strong style={{ display: 'block', marginBottom: 6 }}>学生姓名</Text>
            <Input
              placeholder="输入学生姓名（如：demo）"
              value={newStudentName}
              onChange={(e) => setNewStudentName(e.target.value)}
            />
          </div>
          <div>
            <Text strong style={{ display: 'block', marginBottom: 6 }}>对话标题（可选）</Text>
            <Input
              placeholder="默认：与 xxx 的对话"
              value={newConvTitle}
              onChange={(e) => setNewConvTitle(e.target.value)}
            />
          </div>
        </div>
      </Modal>
    </Layout>
  );
};

export default MessagingCenter;
