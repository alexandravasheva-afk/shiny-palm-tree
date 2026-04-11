import React, { useState, useEffect, useRef, Component } from 'react';
import { io, Socket } from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';
import { format } from 'date-fns';
import { QRCodeSVG } from 'qrcode.react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { motion } from 'motion/react';
import { Shield, ShieldCheck, Send, User, Lock, Key, MessageSquare, LogOut, Check, CheckCheck, Settings, UserPlus, Copy, X, SplitSquareHorizontal, Trash2, ArrowLeft, Paperclip, Bot, Monitor, File, Download, Smartphone, RefreshCw, Trash, Camera, AlertTriangle, Eye, EyeOff, BadgeCheck, QrCode, Users, Link, Phone, PhoneOff, Mic, MicOff, Menu, Smile, Plus } from 'lucide-react';
import EmojiPicker, { Theme as EmojiTheme, EmojiStyle } from 'emoji-picker-react';
import { cn } from './lib/utils';
import { translations, Language } from './translations';
import {
  generateKeyPair,
  exportPublicKey,
  importPublicKey,
  exportPrivateKey,
  importPrivateKey,
  base64ToArrayBuffer,
  deriveSharedKey,
  encryptMessageBinary,
  decryptMessageBinary,
  hashString,
  encryptWithPassword,
  decryptWithPassword,
} from './lib/crypto';

console.log("safeMS App.tsx script executing...");

const APP_URL = (process.env.SHARED_APP_URL as string) || (process.env.APP_URL as string) || (typeof window !== 'undefined' ? window.location.origin : '');

// Types
interface UserData {
  id: string;
  username: string;
  displayName?: string;
  publicKey: string;
  avatar?: string;
  online?: boolean;
  lastSeen?: number;
  password?: string;
  isGroup?: boolean;
  isBot?: boolean;
  members?: string[];
  adminId?: string;
  isNotFound?: boolean;
}

interface LogEntry {
  id: string;
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  details?: string;
}

interface Message {
  id: string;
  senderId: string;
  receiverId: string;
  content: string;
  timestamp: number;
  isSent: boolean;
  type?: 'text' | 'file';
  fileName?: string;
  fileSize?: number;
  isGroup?: boolean;
}

interface Group {
  id: string;
  name: string;
  avatar?: string;
  adminId: string;
  members: string[];
  createdAt: number;
}

interface EncryptedMessagePayload {
  id: string;
  senderId: string;
  receiverId: string;
  encryptedContent: string | ArrayBuffer;
  iv: string | ArrayBuffer;
  timestamp: number;
}

// Obfuscated Local Storage helpers to prevent casual tampering
const saveToStorage = (key: string, data: any) => {
  try {
    const str = JSON.stringify(data);
    localStorage.setItem(key, btoa(encodeURIComponent(str)));
  } catch (e) {
    console.error('Failed to save to storage', e);
  }
};

const loadFromStorage = (key: string) => {
  try {
    const val = localStorage.getItem(key);
    if (!val) return null;
    return JSON.parse(decodeURIComponent(atob(val)));
  } catch (e) {
    console.error('Failed to load from storage', e);
    return null;
  }
};

const removeFromStorage = (key: string) => {
  localStorage.removeItem(key);
};

const SAFEMS_BOT = {
  id: 'bot-safems',
  username: 'safeMS',
  publicKey: 'bot-key',
  online: true,
  isBot: true
};

const getDeviceModel = () => {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return 'Android Device';
  if (/iphone|ipad|ipod/i.test(ua)) return 'iOS Device';
  if (/windows/i.test(ua)) return 'Windows PC';
  if (/mac/i.test(ua)) return 'Mac';
  if (/linux/i.test(ua)) return 'Linux';
  return 'Unknown Device';
};

const QrScanner = ({ onScan, onClose }: { onScan: (data: string) => void; onClose: () => void }) => {
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);

  useEffect(() => {
    scannerRef.current = new Html5QrcodeScanner(
      "qr-reader",
      { fps: 10, qrbox: { width: 250, height: 250 } },
      /* verbose= */ false
    );
    
    const handleScan = (decodedText: string) => {
      if (scannerRef.current) {
        scannerRef.current.clear().then(() => {
          onScan(decodedText);
        }).catch(err => {
          console.error("Failed to clear scanner", err);
          onScan(decodedText);
        });
      }
    };

    scannerRef.current.render(handleScan, (err) => {
      // Ignore errors
    });

    return () => {
      if (scannerRef.current) {
        scannerRef.current.clear().catch(error => console.error("Failed to clear scanner", error));
      }
    };
  }, [onScan]);

  return (
    <div className="fixed inset-0 bg-black/95 backdrop-blur-md z-[100] flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#121212] border border-white/10 rounded-2xl overflow-hidden shadow-2xl relative">
        <div className="p-4 border-b border-white/5 flex items-center justify-between bg-black/20">
          <h3 className="text-white font-bold flex items-center gap-2">
            <Camera className="w-5 h-5 text-emerald-500" /> QR Scanner
          </h3>
          <button onClick={onClose} className="p-2 text-zinc-400 hover:text-white transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>
        <div id="qr-reader" className="w-full"></div>
        <div className="p-6 text-center space-y-2">
          <p className="text-zinc-300 text-sm font-medium">Point your camera at a safeMS QR code</p>
          <p className="text-zinc-500 text-[10px]">The scanner will automatically detect the code</p>
        </div>
      </div>
    </div>
  );
};

const FileAttachment = ({ msg }: { msg: Message }) => {
  const ext = msg.fileName?.split('.').pop()?.toLowerCase() || '';
  const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext);
  const isExecutable = ['apk', 'exe'].includes(ext);

  const [showWarning, setShowWarning] = useState(false);

  const getFileIcon = (fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase();
    if (ext === 'apk') return <Bot className="w-8 h-8 text-emerald-500" />;
    if (ext === 'exe') return <Monitor className="w-8 h-8 text-blue-500" />;
    if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'gif' || ext === 'webp') return <Camera className="w-8 h-8 text-purple-400" />;
    return <File className="w-8 h-8 text-zinc-400" />;
  };

  const handleDownloadClick = (e: React.MouseEvent) => {
    if (isExecutable) {
      e.preventDefault();
      setShowWarning(true);
    }
  };

  const confirmDownload = () => {
    setShowWarning(false);
    const a = document.createElement('a');
    a.href = msg.content;
    a.download = msg.fileName || 'download';
    a.target = '_blank'; // Help with iframe restrictions
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  if (isImage) {
    return (
      <div className="flex flex-col gap-2">
        <div className="relative group rounded-xl overflow-hidden bg-black/20">
          <img src={msg.content} alt={msg.fileName} className="max-w-full max-h-64 object-contain" />
          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <a href={msg.content} download={msg.fileName} target="_blank" rel="noopener noreferrer" className="p-3 bg-white/20 hover:bg-white/30 rounded-full text-white transition-colors backdrop-blur-sm">
              <Download className="w-6 h-6" />
            </a>
          </div>
        </div>
        <div className="flex items-center justify-between px-1">
          <span className="text-xs truncate max-w-[150px]" title={msg.fileName}>{msg.fileName}</span>
          <span className="text-[10px] opacity-70">{(msg.fileSize! / 1024 / 1024).toFixed(2)} MB</span>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-2 min-w-[250px]">
        <div className="flex items-center gap-3 bg-black/20 p-3 rounded-xl">
          {getFileIcon(msg.fileName || '')}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate" title={msg.fileName}>{msg.fileName}</p>
            <p className="text-xs opacity-70">{(msg.fileSize! / 1024 / 1024).toFixed(2)} MB</p>
          </div>
          <a 
            href={msg.content} 
            download={msg.fileName} 
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleDownloadClick}
            className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors flex-shrink-0"
            title="Download File"
          >
            <Download className="w-4 h-4" />
          </a>
        </div>
      </div>

      {showWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[#1a1a1a] border border-white/10 p-6 rounded-2xl max-w-sm w-full shadow-2xl flex flex-col gap-4">
            <div className="flex items-center gap-3 text-yellow-500">
              <AlertTriangle className="w-8 h-8" />
              <h3 className="text-lg font-semibold text-white">Предупреждение</h3>
            </div>
            <p className="text-sm text-zinc-300 leading-relaxed">
              Файл <strong>{msg.fileName}</strong> может представлять риск для вашего устройства. Скачивайте на свой страх и риск, мы не несем ответственности за возможные последствия.
            </p>
            <div className="flex justify-end gap-3 mt-2">
              <button 
                onClick={() => setShowWarning(false)}
                className="px-4 py-2 rounded-xl text-sm font-medium bg-white/5 hover:bg-white/10 transition-colors"
              >
                Отмена
              </button>
              <button 
                onClick={confirmDownload}
                className="px-4 py-2 rounded-xl text-sm font-medium bg-yellow-500/20 text-yellow-500 hover:bg-yellow-500/30 transition-colors"
              >
                Скачать
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

const MessageItem = React.memo(({ msg, activeUser, showAvatar }: { msg: Message, activeUser: UserData | null, showAvatar: boolean }) => {
  if (!activeUser) return null;
  
  const isGroup = activeUser.isGroup;
  
  return (
    <div
      className={cn(
        "flex gap-2 max-w-[85%] group",
        msg.isSent ? "ml-auto flex-row-reverse" : "flex-row"
      )}
    >
      {!msg.isSent && isGroup && (
        <div className="w-8 flex-shrink-0 self-end mb-1">
          {showAvatar && (
            <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-[10px] font-bold text-zinc-400 uppercase overflow-hidden ring-1 ring-white/5">
              {activeUser.avatar ? (
                <img src={activeUser.avatar} alt={activeUser.username} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                activeUser.username.charAt(0)
              )}
            </div>
          )}
        </div>
      )}
      
      <div className={cn(
        "relative flex flex-col min-w-[60px] max-w-full",
        msg.isSent ? "items-end" : "items-start"
      )}>
        {isGroup && !msg.isSent && showAvatar && (
          <span className="text-[11px] text-emerald-500 font-bold mb-0.5 ml-2">
            {msg.senderId.substring(0, 8)}
          </span>
        )}
        <div
          className={cn(
            "px-3 py-1.5 rounded-2xl text-[14px] leading-snug break-words whitespace-pre-wrap shadow-sm relative",
            msg.isSent
              ? "bg-[#2b5278] text-white rounded-br-none"
              : "bg-[#182533] text-zinc-100 rounded-bl-none border border-white/5"
          )}
        >
          {msg.type === 'file' ? (
            <FileAttachment msg={msg} />
          ) : (
            <div className="flex flex-col">
              <span>{msg.content}</span>
              <div className="flex items-center justify-end gap-1 -mb-0.5 mt-0.5 ml-2 self-end">
                <span className="text-[9px] text-zinc-400/80 font-medium">
                  {format(msg.timestamp, 'HH:mm')}
                </span>
                {msg.isSent && (
                  <CheckCheck className="w-3 h-3 text-emerald-400/80" />
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: any;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      const errorMessage = this.state.error?.message || String(this.state.error) || "Something went wrong.";
      return (
        <div className="h-full w-full bg-[#0a0a0a] flex items-center justify-center p-6 text-center">
          <div className="max-w-md w-full bg-[#121212] p-8 rounded-2xl border border-red-500/20 shadow-2xl space-y-6">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-500/10 text-red-400 ring-1 ring-red-500/20">
              <AlertTriangle className="w-8 h-8" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-white">Application Error</h2>
              <p className="text-zinc-400 text-sm">{errorMessage}</p>
            </div>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-3 bg-white/5 hover:bg-white/10 text-white font-medium rounded-xl transition-colors border border-white/10"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function ChatClient({ storagePrefix, onClose, titleSuffix = '' }: { storagePrefix: string, onClose?: () => void, titleSuffix?: string }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [currentUser, setCurrentUser] = useState<{ id: string; username: string; displayName?: string; avatar?: string; keyPair: CryptoKeyPair } | null>(null);
  const [users, setUsers] = useState<UserData[]>([]);
  const [activeChat, setActiveChat] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [inputText, setInputText] = useState('');
  const [isBotTyping, setIsBotTyping] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [contactKeyInput, setContactKeyInput] = useState('');
  const [copySuccess, setCopySuccess] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [language, setLanguage] = useState<Language>(() => {
    const saved = localStorage.getItem('safems_lang');
    return (saved as Language) || 'ru';
  });

  const t = translations[language];

  const handleLanguageChange = (lang: Language) => {
    setLanguage(lang);
    localStorage.setItem('safems_lang', lang);
    addLog(`Language changed to ${lang === 'ru' ? 'Russian' : 'English'}`, 'info');
  };

  const handleBotMessage = (text: string) => {
    if (!currentUser) return;
    const userMsg: Message = {
      id: uuidv4(),
      senderId: currentUser.id,
      receiverId: 'bot-safems',
      content: text,
      timestamp: Date.now(),
      isSent: true,
      type: 'text'
    };
    
    setMessages(prev => ({
      ...prev,
      'bot-safems': [...(prev['bot-safems'] || []), userMsg]
    }));

    setIsBotTyping(true);

    setTimeout(() => {
      let reply = "Я бот поддержки safeMS. Чем могу помочь? Выберите один из вариантов ниже.";
      const lowerText = text.toLowerCase();
      
      if (lowerText.includes('взлом') || lowerText.includes('проверить')) {
        reply = "🔍 Проверка безопасности...\n\n✅ Ваш аккаунт в безопасности.\n\nВ safeMS используется сквозное (End-to-End) шифрование. Никто, даже сервер, не может прочитать ваши сообщения. \n\nРекомендуем зайти в «Настройки» и проверить список «Active Devices». Если вы видите там незнакомые устройства — немедленно удалите их (кнопка LogOut) и смените ключ шифрования (Change Encryption Key).";
      } else if (lowerText.includes('как работает') || lowerText.includes('сайт')) {
        reply = "safeMS — это защищенный мессенджер. Все ваши сообщения шифруются прямо на вашем устройстве (RSA + AES) и расшифровываются только у получателя. Мы не храним ваши ключи на сервере.";
      } else if (lowerText.includes('удалить')) {
        reply = "Чтобы удалить свои данные, нажмите на значок шестеренки (Настройки) в левом нижнем углу и выберите «Delete Account» или «Clear Contacts & Chats».";
      } else if (lowerText.includes('групп')) {
        reply = "👥 **Групповые чаты**\n\nВы можете создавать группы, нажав на иконку «+» в верхней части боковой панели. \n\nПосле создания группы вы получите ссылку-приглашение, которую можно отправить друзьям. Все сообщения в группах также защищены шифрованием.";
      } else if (lowerText.includes('контакт')) {
        reply = "👤 **Добавление контактов**\n\nЧтобы добавить друга, просто введите его имя пользователя в строку поиска в верхней части боковой панели. \n\nМы больше не используем длинные ключи чата — теперь всё работает по никнеймам!";
      } else if (lowerText.includes('устроен') || lowerText.includes('файлы') || lowerText.includes('на чем') || lowerText.includes('архитектура')) {
        reply = "🏗️ **Архитектура safeMS**\n\nМессенджер построен на современных технологиях:\n\n🔹 **Frontend:** React + TypeScript. Это обеспечивает быструю и надежную работу интерфейса.\n🔹 **Стиль:** Tailwind CSS для современного и адаптивного дизайна.\n🔹 **Real-time:** Socket.io для мгновенной передачи сообщений.\n🔹 **Шифрование:** Web Crypto API. Используются алгоритмы RSA (для обмена ключами) и AES (для самих сообщений).\n\n📂 **Основные файлы проекта:**\n• `App.tsx` — «сердце» приложения, здесь вся логика интерфейса и шифрования.\n• `server.ts` — серверная часть, отвечающая за передачу зашифрованных пакетов между пользователями.\n• `package.json` — список всех библиотек и инструментов.\n• `index.css` — настройки внешнего вида и тем.\n\nВся переписка хранится только в памяти вашего браузера (LocalStorage), сервер лишь передает зашифрованные данные.";
      }

      const botMsg: Message = {
        id: uuidv4(),
        senderId: 'bot-safems',
        receiverId: currentUser.id,
        content: reply,
        timestamp: Date.now(),
        isSent: false,
        type: 'text'
      };

      setMessages(prev => ({
        ...prev,
        'bot-safems': [...(prev['bot-safems'] || []), botMsg]
      }));
      setIsBotTyping(false);
    }, 1000);
  };

  const [showForgetConfirm, setShowForgetConfirm] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [authMode, setAuthMode] = useState<'register' | 'login'>('register');
  const [regUsername, setRegUsername] = useState('');
  const [regPassword, setRegPassword] = useState(''); // Added password for registration
  const [contacts, setContacts] = useState<string[]>([]);
  const [contactInfo, setContactInfo] = useState<Record<string, UserData>>(() => {
    const saved = loadFromStorage(`${storagePrefix}contact_info`);
    return saved || {};
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UserData[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [groupNameInput, setGroupNameInput] = useState('');
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [showJoinGroup, setShowJoinGroup] = useState<Group | null>(null);
  const [showGroupMembers, setShowGroupMembers] = useState(false);
  const [showGroupSettings, setShowGroupSettings] = useState(false);
  const [groupSettingsName, setGroupSettingsName] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [broadcastText, setBroadcastText] = useState('');
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    const handler = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
    }
  };
  const [newDisplayName, setNewDisplayName] = useState('');
  const [activeSessions, setActiveSessions] = useState<any[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]); // Added logs state
  const [isAdminMode, setIsAdminMode] = useState(false); // Added admin mode state
  const [isLocked, setIsLocked] = useState(false); // Added lock state
  const [unlockPassword, setUnlockPassword] = useState(''); // Added unlock password state
  const [unlockError, setUnlockError] = useState(false);
  const [showUnlockPassword, setShowUnlockPassword] = useState(false);
  const [showPassword, setShowPassword] = useState(false); // Added show password state
  const [confirmModal, setConfirmModal] = useState<{
    show: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    type: 'danger' | 'info';
  }>({
    show: false,
    title: '',
    message: '',
    onConfirm: () => {},
    type: 'info'
  });

  const showConfirm = (title: string, message: string, onConfirm: () => void, type: 'danger' | 'info' = 'info') => {
    setConfirmModal({ show: true, title, message, onConfirm, type });
  };

  const handleUpdateDisplayName = () => {
    if (!currentUser || !(newDisplayName || '').trim()) return;
    
    const updatedUser = { ...currentUser, displayName: (newDisplayName || '').trim() };
    setCurrentUser(updatedUser);

    const savedUser = loadFromStorage(`${storagePrefix}user`);
    saveToStorage(`${storagePrefix}user`, {
      ...savedUser,
      displayName: (newDisplayName || '').trim()
    });

    if (socket) {
      socket.emit('update_profile', { id: currentUser.id, displayName: (newDisplayName || '').trim() });
    }
    addLog('Display name updated', 'success');
  };

  const handleForgetAccount = () => {
    setShowForgetConfirm(true);
  };

  const confirmForget = () => {
    localStorage.removeItem(`${storagePrefix}user`);
    localStorage.removeItem(`${storagePrefix}contacts`);
    localStorage.removeItem(`${storagePrefix}messages`);
    localStorage.removeItem(`${storagePrefix}groups`);
    setCurrentUser(null);
    setMessages({});
    setContacts([]);
    setGroups([]);
    setIsLoaded(false);
    window.location.reload();
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentUser) return;

    if (file.size > 500 * 1024) {
      addLog('Avatar image too large (max 500KB)', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64 = reader.result as string;
      const updatedUser = { ...currentUser, avatar: base64 };
      setCurrentUser(updatedUser);

      const savedUser = loadFromStorage(`${storagePrefix}user`);
      saveToStorage(`${storagePrefix}user`, {
        ...savedUser,
        avatar: base64
      });

      if (socket) {
        socket.emit('update_profile', { id: currentUser.id, avatar: base64 });
      }
      addLog('Profile avatar updated', 'success');
    };
    reader.readAsDataURL(file);
  };
  
  const addLog = (message: string, level: LogEntry['level'] = 'info', details?: string) => {
    const newLog: LogEntry = {
      id: uuidv4(),
      timestamp: Date.now(),
      level,
      message,
      details
    };
    setLogs(prev => [newLog, ...prev].slice(0, 100)); // Keep last 100 logs
    if (level === 'error') console.error(message, details);
    else console.log(`[${level.toUpperCase()}] ${message}`, details || '');
  };

  const sharedKeyCache = useRef<Map<string, CryptoKey>>(new Map());

  const getSharedKey = async (otherUserId: string, otherPublicKeyBase64: string, myPrivateKey: CryptoKey) => {
    const cacheKey = `${otherUserId}:${otherPublicKeyBase64}`;
    if (sharedKeyCache.current.has(cacheKey)) {
      return sharedKeyCache.current.get(cacheKey)!;
    }
    const otherPubKey = await importPublicKey(otherPublicKeyBase64);
    const sharedKey = await deriveSharedKey(myPrivateKey, otherPubKey);
    sharedKeyCache.current.set(cacheKey, sharedKey);
    return sharedKey;
  };
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  // Call State
  const [callStatus, setCallStatus] = useState<'idle' | 'calling' | 'incoming' | 'active'>('idle');
  const [callPartner, setCallPartner] = useState<UserData | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const callTimerRef = useRef<NodeJS.Timeout | null>(null);
  const notificationSoundRef = useRef<HTMLAudioElement | null>(null);
  const ringtoneSoundRef = useRef<HTMLAudioElement | null>(null);

  const stopRingtone = () => {
    if (ringtoneSoundRef.current) {
      ringtoneSoundRef.current.pause();
      ringtoneSoundRef.current.currentTime = 0;
    }
  };

  // Sync media streams with video/audio elements
  useEffect(() => {
    if (callStatus !== 'idle') {
      if (localStreamRef.current && localVideoRef.current) {
        localVideoRef.current.srcObject = localStreamRef.current;
      }
      if (remoteStreamRef.current && remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStreamRef.current;
      }
      if (remoteStreamRef.current && remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = remoteStreamRef.current;
      }
    }
  }, [callStatus, isVideoEnabled]);

  // Initialize socket and load user from local storage
  useEffect(() => {
    const newSocket = io({
      transports: ['websocket'],
    });
    setSocket(newSocket);

    const loadData = async () => {
      const savedUser = loadFromStorage(`${storagePrefix}user`);
      if (savedUser) {
        addLog('User data found in storage', 'info');
        if (savedUser.password) {
          setIsLocked(true);
          addLog('App is locked with password', 'warn');
        }
        try {
          const privateKey = await importPrivateKey(savedUser.privateKeyBase64);
          const publicKey = await importPublicKey(savedUser.publicKeyBase64);
          setCurrentUser({
            id: savedUser.id,
            username: savedUser.username,
            displayName: savedUser.displayName,
            avatar: savedUser.avatar,
            keyPair: { privateKey, publicKey }
          });
          setNewDisplayName(savedUser.displayName || savedUser.username || '');
          addLog('Keys imported successfully', 'success');
        } catch (e) {
          addLog('Failed to load user keys', 'error', String(e));
        }
      } else {
        addLog('No user data found, registration required', 'info');
      }
      
      const savedContacts = loadFromStorage(`${storagePrefix}contacts`);
      if (savedContacts && Array.isArray(savedContacts)) {
        setContacts(savedContacts);
      }
      
      setIsLoaded(true);
    };

    loadData();

    return () => {
      newSocket.close();
    };
  }, [storagePrefix]);

  // Save contacts when they change
  useEffect(() => {
    if (isLoaded) {
      saveToStorage(`${storagePrefix}contacts`, contacts);
      if (socket && currentUser) {
        socket.emit('sync_contacts', { userId: currentUser.id, contacts });
      }
    }
  }, [contacts, isLoaded, storagePrefix, socket, currentUser]);

  // Save messages to local storage (optional, as server now persists)
  useEffect(() => {
    if (currentUser && isLoaded) {
      saveToStorage(`${storagePrefix}messages`, messages);
    }
  }, [messages, currentUser, isLoaded]);

  // Load messages from server on startup
  useEffect(() => {
    if (socket && currentUser && isLoaded) {
      socket.emit('get_history', currentUser.id, (history: Message[]) => {
        const loadedMsgs: Record<string, Message[]> = {};
        history.forEach(msg => {
          const chatId = msg.isGroup ? msg.receiverId : (msg.senderId === currentUser.id ? msg.receiverId : msg.senderId);
          if (!loadedMsgs[chatId]) loadedMsgs[chatId] = [];
          loadedMsgs[chatId].push(msg);
        });

        setMessages(prev => {
          const merged = { ...prev };
          for (const chatId in loadedMsgs) {
            const existing = merged[chatId] || [];
            const combined = [...existing, ...loadedMsgs[chatId]];
            const unique = Array.from(new Map(combined.map(m => [m.id, m])).values());
            merged[chatId] = unique.sort((a, b) => a.timestamp - b.timestamp);
          }
          return merged;
        });
        addLog('Messages synced from server', 'success');
      });
    }
  }, [socket, currentUser, isLoaded]);

  const usersRef = useRef(users);
  useEffect(() => {
    usersRef.current = users;
  }, [users]);

  useEffect(() => {
    if (!socket || !currentUser) return;

    const onConnect = async () => {
      addLog('Socket connected to server', 'success');
      const pubKeyBase64 = await exportPublicKey(currentUser.keyPair.publicKey);
      
      // Get password from storage to send hash for persistence
      const savedUser = loadFromStorage(`${storagePrefix}user`);
      let passwordHash = undefined;
      let encryptedPrivateKey = undefined;
      
      if (savedUser && savedUser.password) {
        passwordHash = await hashString(savedUser.password);
        encryptedPrivateKey = await encryptWithPassword(savedUser.privateKeyBase64, savedUser.password);
      }

      socket.emit('register', {
        id: currentUser.id,
        username: currentUser.username,
        displayName: currentUser.displayName,
        publicKey: pubKeyBase64,
        passwordHash,
        encryptedPrivateKey,
        avatar: currentUser.avatar,
        deviceModel: getDeviceModel()
      });
    };

    socket.on('connect', onConnect);
    if (socket.connected) onConnect();

    socket.on('disconnect', () => {
      addLog('Socket disconnected', 'warn');
    });

    socket.on('error', (err) => {
      addLog('Socket error', 'error', String(err));
    });

    socket.on('kicked', () => {
      addLog('Session kicked by another device', 'error');
      showConfirm(
        t.sessionTerminated,
        t.kickedMessage,
        () => {
          removeFromStorage(`${storagePrefix}user`);
          removeFromStorage(`${storagePrefix}contacts`);
          window.location.reload();
        },
        'danger'
      );
    });

    socket.on('users', (serverUsers: UserData[]) => {
      addLog(`Received ${serverUsers.length} users from server`, 'info');
      setUsers(serverUsers.filter(u => u.id !== currentUser.id));
    });

    socket.on('user_offline', ({ id, lastSeen }) => {
      setUsers(prev => prev.map(u => u.id === id ? { ...u, online: false, lastSeen } : u));
    });

    socket.on('groups', (serverGroups: Group[]) => {
      setGroups(serverGroups);
    });

    socket.emit('get_groups', (serverGroups: Group[]) => {
      setGroups(serverGroups);
    });

    socket.on('message', async (payload: any) => {
      // Play notification sound
      if (notificationSoundRef.current) {
        notificationSoundRef.current.currentTime = 0;
        notificationSoundRef.current.play().catch(e => console.warn('Failed to play notification sound:', e));
      }

      try {
        // Handle bot or system messages (not encrypted)
        if (payload.senderId === 'bot-safems' || payload.isSystem || payload.isGroup) {
          const newMessage: Message = {
            id: payload.id,
            senderId: payload.senderId,
            receiverId: payload.receiverId,
            content: payload.content,
            timestamp: payload.timestamp,
            isSent: false,
            type: payload.type || 'text',
            isGroup: payload.isGroup,
            fileName: payload.fileName,
            fileSize: payload.fileSize,
          };

          const chatId = payload.isGroup ? payload.groupId : payload.senderId;

          setMessages(prev => {
            const chatHistory = prev[chatId] || [];
            if (chatHistory.some(m => m.id === payload.id)) return prev;
            return {
              ...prev,
              [chatId]: [...chatHistory, newMessage],
            };
          });
          return;
        }

        const sender = usersRef.current.find(u => u.id === payload.senderId);
        if (!sender) {
          console.warn('Received message from unknown sender:', payload.senderId);
          return;
        }

        const sharedKey = await getSharedKey(payload.senderId, sender.publicKey, currentUser.keyPair.privateKey);
        
        let decryptedContent;
        if (typeof payload.encryptedContent === 'string') {
          // Fallback for older messages
          decryptedContent = await decryptMessageBinary(sharedKey, await base64ToArrayBuffer(payload.encryptedContent), await base64ToArrayBuffer(payload.iv as string));
        } else {
          decryptedContent = await decryptMessageBinary(sharedKey, payload.encryptedContent, payload.iv as ArrayBuffer);
        }

        let innerPayload;
        try {
          innerPayload = JSON.parse(decryptedContent);
        } catch {
          // Fallback for older plain text messages
          innerPayload = { type: 'text', text: decryptedContent };
        }

        const newMessage: Message = {
          id: payload.id,
          senderId: payload.senderId,
          receiverId: payload.receiverId,
          content: innerPayload.type === 'file' ? innerPayload.fileData : innerPayload.text,
          timestamp: payload.timestamp,
          isSent: false,
          type: innerPayload.type || 'text',
          fileName: innerPayload.fileName,
          fileSize: innerPayload.fileSize,
        };

        setContacts(prev => prev.includes(payload.senderId) ? prev : [...prev, payload.senderId]);

        setMessages(prev => {
          const chatHistory = prev[payload.senderId] || [];
          if (chatHistory.some(m => m.id === payload.id)) return prev;
          return {
            ...prev,
            [payload.senderId]: [...chatHistory, newMessage],
          };
        });
      } catch (err) {
        console.error('Failed to decrypt incoming message', err);
      }
    });

    // Call Signaling Listeners
    socket.on('incoming_call', ({ offer, from, video }) => {
      const caller = usersRef.current.find(u => u.id === from);
      if (caller) {
        setCallPartner(caller);
        setCallStatus('incoming');
        
        // Play ringtone
        if (ringtoneSoundRef.current) {
          ringtoneSoundRef.current.currentTime = 0;
          ringtoneSoundRef.current.loop = true;
          ringtoneSoundRef.current.play().catch(e => console.warn('Failed to play ringtone:', e));
        }

        // Store offer for later
        (window as any).pendingOffer = offer;
        (window as any).callVideoRequested = video;
      }
    });

    socket.on('call_answered', async ({ answer }) => {
      if (pcRef.current) {
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
        setCallStatus('active');
        startCallTimer();
      }
    });

    socket.on('ice_candidate', async ({ candidate }) => {
      if (pcRef.current) {
        try {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.error('Error adding ice candidate', e);
        }
      }
    });

    socket.on('call_rejected', () => {
      cleanupCall();
      addLog('Call rejected', 'warn');
    });

    socket.on('call_ended', () => {
      cleanupCall();
      addLog('Call ended by partner', 'info');
    });

    return () => {
      socket.off('connect', onConnect);
      socket.off('kicked');
      socket.off('users');
      socket.off('user_offline');
      socket.off('groups');
      socket.off('message');
    };
  }, [socket, currentUser]);

  // Handle Join Group Link
  useEffect(() => {
    if (!isLoaded || !socket || !currentUser) return;

    const urlParams = new URLSearchParams(window.location.search);
    const joinGroupId = urlParams.get('join');
    
    if (joinGroupId) {
      socket.emit('get_groups', (allGroups: Group[]) => {
        const groupToJoin = allGroups.find(g => g.id === joinGroupId);
        if (groupToJoin) {
          if (groupToJoin.members.includes(currentUser.id)) {
            setActiveChat(groupToJoin.id);
            addLog(`Already a member of ${groupToJoin.name}`, 'info');
          } else {
            setShowJoinGroup(groupToJoin);
          }
        } else {
          addLog('Group not found', 'error');
        }
        // Clear URL param
        window.history.replaceState({}, document.title, window.location.pathname);
      });
    }
  }, [isLoaded, socket, currentUser]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeChat]);

  useEffect(() => {
    if (showSettings && socket && currentUser) {
      socket.emit('get_sessions', currentUser.id, (sessions: any[]) => {
        setActiveSessions(sessions);
      });
    }
  }, [showSettings, socket, currentUser]);

  const handleCopyKey = () => {
    if (currentUser) {
      navigator.clipboard.writeText(currentUser.id);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }
  };

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    if (!query.trim() || !socket) {
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    socket.emit('search_user', query.trim(), (user: UserData | null) => {
      setIsSearching(false);
      if (user) {
        setSearchResults([user]);
      } else {
        setSearchResults([]);
      }
    });
  };

  const handleAddContact = (user: UserData) => {
    if (!contacts.includes(user.id)) {
      setContacts(prev => [...prev, user.id]);
    }
    setContactInfo(prev => ({ ...prev, [user.id]: user }));
    setSearchQuery('');
    setSearchResults([]);
    setActiveChat(user.id);
  };

  const handleDeleteContact = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setContacts(prev => prev.filter(c => c !== id));
    if (activeChat === id) setActiveChat(null);
  };

  const handleDeleteAccount = () => {
    showConfirm(
      t.confirmDeleteTitle,
      t.confirmDeleteDesc,
      () => {
        removeFromStorage(`${storagePrefix}user`);
        removeFromStorage(`${storagePrefix}contacts`);
        setCurrentUser(null);
        setContacts([]);
        setMessages({});
        setActiveChat(null);
        setShowSettings(false);
        addLog('Account deleted from device', 'warn');
      },
      'danger'
    );
  };

  const handleChangeKey = async () => {
    showConfirm(
      t.confirmChangeKeyTitle,
      t.confirmChangeKeyDesc,
      async () => {
        try {
          const newKeyPair = await generateKeyPair();
          sharedKeyCache.current.clear();
          const pubKeyBase64 = await exportPublicKey(newKeyPair.publicKey);
          const privKeyBase64 = await exportPrivateKey(newKeyPair.privateKey);

          if (currentUser) {
            const updatedUser = { ...currentUser, keyPair: newKeyPair };
            setCurrentUser(updatedUser);

            const savedUser = loadFromStorage(`${storagePrefix}user`);
            saveToStorage(`${storagePrefix}user`, {
              id: updatedUser.id,
              username: updatedUser.username,
              publicKeyBase64: pubKeyBase64,
              privateKeyBase64: privKeyBase64,
              password: savedUser?.password
            });

            setMessages({}); // Clear messages as they can't be decrypted
            if (socket) {
              socket.emit('update_key', { id: updatedUser.id, publicKey: pubKeyBase64 });
            }
            addLog('Encryption key changed', 'success');
          }
        } catch (err) {
          addLog('Failed to change key', 'error', String(err));
        }
      },
      'danger'
    );
  };

  const handleBroadcast = () => {
    if (!(broadcastText || '').trim() || !socket || !currentUser) return;
    setIsBroadcasting(true);
    
    const timestamp = Date.now();
    const content = (broadcastText || '').trim();
    
    socket.emit('admin_broadcast', {
      senderId: currentUser.id,
      content,
      timestamp
    });

    // Add to local bot chat for admin to see
    const newMessage: Message = {
      id: `broadcast-local-${timestamp}`,
      senderId: 'bot-safems',
      receiverId: currentUser.id,
      content,
      timestamp,
      isSent: true,
      type: 'text',
    };

    setMessages(prev => ({
      ...prev,
      ['bot-safems']: [...(prev['bot-safems'] || []), newMessage]
    }));

    setTimeout(() => {
      setIsBroadcasting(false);
      setBroadcastText('');
      addLog('Broadcast sent', 'success');
    }, 500);
  };

  const handleCreateGroup = () => {
    if (!(groupNameInput || '').trim() || !socket || !currentUser) return;
    setIsCreatingGroup(true);
    const groupId = uuidv4();
    socket.emit('create_group', {
      id: groupId,
      name: (groupNameInput || '').trim(),
      adminId: currentUser.id
    }, (newGroup: Group) => {
      setGroups(prev => {
        if (prev.some(g => g.id === newGroup.id)) return prev;
        return [...prev, newGroup];
      });
      setIsCreatingGroup(false);
      setShowCreateGroup(false);
      setGroupNameInput('');
      setActiveChat(newGroup.id);
      addLog(`Group ${newGroup.name} created`, 'success');
    });
  };

  const handleJoinGroup = () => {
    if (!showJoinGroup || !socket || !currentUser) return;
    socket.emit('join_group', {
      groupId: showJoinGroup.id,
      userId: currentUser.id
    }, (response: { success: boolean; group?: Group; message?: string }) => {
      if (response.success && response.group) {
        const joinedGroup = response.group;
        setGroups(prev => {
          if (prev.some(g => g.id === joinedGroup.id)) {
            return prev.map(g => g.id === joinedGroup.id ? joinedGroup : g);
          }
          return [...prev, joinedGroup];
        });
        setActiveChat(joinedGroup.id);
        setShowJoinGroup(null);
        addLog(`Joined group ${joinedGroup.name}`, 'success');
      } else {
        addLog(response.message || 'Failed to join group', 'error');
      }
    });
  };

  const handleUpdateGroup = (groupId: string, updates: Partial<Group>) => {
    if (!socket) return;
    socket.emit('update_group', { groupId, updates }, (response: { success: boolean; group?: Group }) => {
      if (response.success && response.group) {
        const updatedGroup = response.group;
        setGroups(prev => prev.map(g => g.id === updatedGroup.id ? updatedGroup : g));
        addLog(`Group ${updatedGroup.name} updated`, 'success');
      }
    });
  };

  const handleGroupAvatarChange = async (groupId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 500 * 1024) {
      addLog('Group avatar image too large (max 500KB)', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      handleUpdateGroup(groupId, { avatar: base64 });
    };
    reader.readAsDataURL(file);
  };

  const handleClearContacts = () => {
    showConfirm(
      t.confirmClearTitle,
      t.confirmClearDesc,
      () => {
        setContacts([]);
        setMessages({});
        setActiveChat(null);
        saveToStorage(`${storagePrefix}contacts`, []);
        addLog('Contacts and history cleared', 'warn');
      },
      'danger'
    );
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regUsername.trim() || !regPassword || !socket) {
      alert(t.requiredFields);
      return;
    }
    setIsRegistering(true);
    addLog(`Checking availability for ${regUsername}`, 'info');

    socket.emit('check_username', regUsername.trim(), async (available: boolean) => {
      if (!available) {
        addLog('Username already taken', 'error');
        alert('Username already taken');
        setIsRegistering(false);
        return;
      }

      try {
        const keyPair = await generateKeyPair();
        const pubKeyBase64 = await exportPublicKey(keyPair.publicKey);
        const privKeyBase64 = await exportPrivateKey(keyPair.privateKey);
        
        const passwordHash = await hashString(regPassword);
        const encryptedPrivateKey = await encryptWithPassword(privKeyBase64, regPassword);
        
        const id = uuidv4();

        const user = { id, username: regUsername.trim(), displayName: regUsername.trim(), avatar: undefined, keyPair };
        
        // Save to obfuscated local storage
        saveToStorage(`${storagePrefix}user`, {
          id,
          username: user.username,
          displayName: user.displayName,
          avatar: user.avatar,
          publicKeyBase64: pubKeyBase64,
          privateKeyBase64: privKeyBase64,
          password: regPassword
        });

        setCurrentUser(user);
        setNewDisplayName(user.displayName);
        addLog('Registration successful', 'success');

        socket.emit('register', {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          publicKey: pubKeyBase64,
          passwordHash,
          encryptedPrivateKey,
          avatar: user.avatar,
        });
      } catch (err) {
        addLog('Registration failed', 'error', String(err));
        alert(`${t.regFailed}: ` + (err instanceof Error ? err.message : String(err)));
      } finally {
        setIsRegistering(false);
      }
    });
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regUsername.trim() || !regPassword || !socket) {
      alert(t.requiredFields);
      return;
    }
    setIsLoggingIn(true);
    addLog(`Starting login for ${regUsername}`, 'info');

    try {
      const passwordHash = await hashString(regPassword);
      
      socket.emit('login', { username: regUsername.trim(), passwordHash }, async (response: { success: boolean; user?: any; message?: string }) => {
        if (!response.success) {
          addLog('Login failed: ' + response.message, 'error');
          alert(`${t.loginFailed}: ` + response.message);
          setIsLoggingIn(false);
          return;
        }

        try {
          const userData = response.user;
          const privKeyBase64 = await decryptWithPassword(userData.encryptedPrivateKey, regPassword);
          
          const privateKey = await importPrivateKey(privKeyBase64);
          const publicKey = await importPublicKey(userData.publicKey);
          const keyPair = { publicKey, privateKey };

          const user = { 
            id: userData.id, 
            username: userData.username, 
            displayName: userData.displayName || userData.username, 
            avatar: userData.avatar, 
            keyPair 
          };

          saveToStorage(`${storagePrefix}user`, {
            id: user.id,
            username: user.username,
            displayName: user.displayName,
            avatar: user.avatar,
            publicKeyBase64: userData.publicKey,
            privateKeyBase64: privKeyBase64,
            password: regPassword
          });

          if (userData.contacts && Array.isArray(userData.contacts)) {
            setContacts(userData.contacts);
            saveToStorage(`${storagePrefix}contacts`, userData.contacts);
          }

          setCurrentUser(user);
          setNewDisplayName(user.displayName);
          addLog('Login successful', 'success');
        } catch (err) {
          addLog('Decryption failed during login', 'error', String(err));
          alert(t.decryptFailed);
        } finally {
          setIsLoggingIn(false);
        }
      });
    } catch (err) {
      addLog('Login failed', 'error', String(err));
      alert(`${t.loginFailed}: ` + (err instanceof Error ? err.message : String(err)));
      setIsLoggingIn(false);
    }
  };

  const handleUnlock = (e: React.FormEvent) => {
    e.preventDefault();
    const savedUser = loadFromStorage(`${storagePrefix}user`);
    const trimmedUnlock = (unlockPassword || '').trim();
    
    if (savedUser && savedUser.password === trimmedUnlock) {
      setIsLocked(false);
      setUnlockError(false);
      setUnlockPassword('');
      addLog('App unlocked successfully', 'success');
    } else {
      setUnlockError(true);
      // Reset error after a while to allow retry without red border if they want
      setTimeout(() => setUnlockError(false), 3000);
      addLog('Unlock attempt failed: incorrect password', 'error');
    }
  };

  const sendPayload = async (innerPayload: any) => {
    if (!activeChat || !socket || !currentUser) return;

    const isGroup = groups.some(g => g.id === activeChat);
    
    if (isGroup) {
      const payload = {
        id: uuidv4(),
        senderId: currentUser.id,
        groupId: activeChat,
        content: innerPayload.type === 'file' ? innerPayload.fileData : innerPayload.text,
        timestamp: Date.now(),
        type: innerPayload.type || 'text',
        fileName: innerPayload.fileName,
        fileSize: innerPayload.fileSize,
        isGroup: true
      };
      socket.emit('group_message', payload);

      const newMessage: Message = {
        ...payload,
        receiverId: activeChat,
        isSent: true
      };

      setMessages(prev => ({
        ...prev,
        [activeChat]: [...(prev[activeChat] || []), newMessage],
      }));
      return;
    }

    const receiver = users.find(u => u.id === activeChat) || contactInfo[activeChat];
    if (!receiver || !receiver.publicKey) {
      addLog('Cannot send message: recipient public key unknown', 'error');
      return;
    }

    setIsSending(true);
    try {
      const sharedKey = await getSharedKey(receiver.id, receiver.publicKey, currentUser.keyPair.privateKey);
      
      const jsonString = JSON.stringify(innerPayload);
      const { ciphertext, iv } = await encryptMessageBinary(sharedKey, jsonString);

      const payload: EncryptedMessagePayload = {
        id: uuidv4(),
        senderId: currentUser.id,
        receiverId: receiver.id,
        encryptedContent: ciphertext,
        iv: iv.buffer,
        timestamp: Date.now(),
      };

      socket.emit('message', payload);

      const newMessage: Message = {
        id: payload.id,
        senderId: currentUser.id,
        receiverId: receiver.id,
        content: innerPayload.type === 'file' ? innerPayload.fileData : innerPayload.text,
        timestamp: payload.timestamp,
        isSent: true,
        type: innerPayload.type,
        fileName: innerPayload.fileName,
        fileSize: innerPayload.fileSize,
      };

      setMessages(prev => ({
        ...prev,
        [receiver.id]: [...(prev[receiver.id] || []), newMessage],
      }));
    } catch (err) {
      console.error('Failed to send message', err);
      alert('Failed to send message. Please try again.');
    } finally {
      setIsSending(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!(inputText || '').trim()) return;
    const text = (inputText || '').trim();
    setInputText('');
    
    if (activeChat === 'bot-safems') {
      handleBotMessage(text);
      return;
    }
    
    await sendPayload({ type: 'text', text });
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // Limit file size to 5MB to prevent proxy connection drops
    if (file.size > 5 * 1024 * 1024) {
      alert('Файл слишком большой. Лимит 5MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64Data = event.target?.result as string;
      await sendPayload({
        type: 'file',
        fileData: base64Data,
        fileName: file.name,
        fileSize: file.size
      });
    };
    reader.readAsDataURL(file);
    
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Call Functions
  const formatLastSeen = (timestamp: number) => {
    if (!timestamp) return t.offline;
    const now = Date.now();
    const diff = now - timestamp;
    
    if (diff < 60000) return t.online; // Less than a minute
    
    const date = new Date(timestamp);
    const today = new Date();
    const isToday = date.getDate() === today.getDate() && 
                    date.getMonth() === today.getMonth() && 
                    date.getFullYear() === today.getFullYear();
    
    if (isToday) {
      return `${t.lastSeenAt} ${format(timestamp, 'HH:mm')}`;
    }
    
    return `${t.lastSeen} ${format(timestamp, 'dd.MM HH:mm')}`;
  };

  const startCallTimer = () => {
    setCallDuration(0);
    if (callTimerRef.current) clearInterval(callTimerRef.current);
    callTimerRef.current = setInterval(() => {
      setCallDuration(prev => prev + 1);
    }, 1000);
  };

  const cleanupCall = () => {
    stopRingtone();
    if (callTimerRef.current) clearInterval(callTimerRef.current);
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    remoteStreamRef.current = null;
    setCallStatus('idle');
    setCallPartner(null);
    setCallDuration(0);
    setIsMuted(false);
  };

  const initPeerConnection = (partnerId: string) => {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
      ]
    });

    pc.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit('ice_candidate', { candidate: event.candidate, to: partnerId });
      }
    };

    pc.ontrack = (event) => {
      remoteStreamRef.current = event.streams[0];
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = event.streams[0];
      }
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    pcRef.current = pc;
    return pc;
  };

  const startCall = async (partner: UserData, video: boolean = false) => {
    if (!socket || !currentUser) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: true, 
        video: video 
      });
      localStreamRef.current = stream;
      setIsVideoEnabled(video);
      setCallPartner(partner);
      setCallStatus('calling');

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      const pc = initPeerConnection(partner.id);
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socket.emit('call_user', { offer, to: partner.id, from: currentUser.id, video });
      addLog(`Initiating ${video ? 'video' : 'audio'} call to ${partner.username}`, 'info');
    } catch (e) {
      console.error('Error starting call', e);
      alert('Could not access media devices');
    }
  };

  const acceptCall = async () => {
    if (!socket || !currentUser || !callPartner) return;
    stopRingtone();
    try {
      const videoRequested = (window as any).callVideoRequested;
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: true, 
        video: videoRequested 
      });
      localStreamRef.current = stream;
      setIsVideoEnabled(videoRequested);

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      const pc = initPeerConnection(callPartner.id);
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      const offer = (window as any).pendingOffer;
      await pc.setRemoteDescription(new RTCSessionDescription(offer));

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socket.emit('answer_call', { answer, to: callPartner.id });
      setCallStatus('active');
      startCallTimer();
      addLog(`Call accepted from ${callPartner.username}`, 'info');
    } catch (e) {
      console.error('Error accepting call', e);
      alert('Could not access media devices');
      rejectCall();
    }
  };

  const rejectCall = () => {
    if (socket && callPartner) {
      socket.emit('reject_call', { to: callPartner.id });
    }
    cleanupCall();
  };

  const endCall = () => {
    if (socket && callPartner) {
      socket.emit('end_call', { to: callPartner.id });
    }
    cleanupCall();
  };

  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (!isLoaded) {
    return <div className="h-full w-full bg-[#0a0a0a] flex items-center justify-center text-emerald-500"><div className="w-8 h-8 border-2 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" /></div>;
  }

  if (isLocked) {
    return (
      <div className="h-full w-full bg-[#0a0a0a] flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-[#121212] p-8 rounded-2xl border border-white/5 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-32 bg-emerald-500/10 blur-[60px] rounded-full pointer-events-none" />
          
          <div className="relative z-10 space-y-6 text-center">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-emerald-500/10 text-emerald-400 mb-2 ring-1 ring-emerald-500/20">
              <Lock className="w-10 h-10" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white mb-2">{t.unlockTitle}</h1>
              <p className="text-zinc-400 text-sm">{t.unlockDesc}</p>
            </div>

            <form onSubmit={handleUnlock} className="space-y-4 pt-4">
              <div className="space-y-2 text-left">
                <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{t.loginPasswordLabel}</label>
                <div className="relative">
                  <input
                    type={showUnlockPassword ? "text" : "password"}
                    value={unlockPassword}
                    onChange={(e) => setUnlockPassword(e.target.value)}
                    placeholder="••••••••"
                    className={cn(
                      "w-full bg-black/50 border rounded-xl pl-4 pr-10 py-3 text-white focus:outline-none transition-all",
                      unlockError ? "border-red-500/50 ring-1 ring-red-500/50" : "border-white/10 focus:ring-2 focus:ring-emerald-500/50"
                    )}
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowUnlockPassword(!showUnlockPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-zinc-500 hover:text-zinc-300"
                  >
                    {showUnlockPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
                {unlockError && <p className="text-xs text-red-400 mt-1">{t.incorrectPassword}</p>}
              </div>
              <button
                type="submit"
                className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 text-black font-medium rounded-xl transition-colors"
              >
                {t.unlockBtn}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="h-full w-full bg-[#313338] text-zinc-100 flex items-center justify-center p-4 font-sans selection:bg-[#5865F2]/30 relative">
        <div className="absolute top-4 right-4 flex gap-2 z-50">
          <button 
            onClick={() => handleLanguageChange('ru')} 
            className={cn("px-2 py-1 text-[10px] font-bold rounded border transition-all", language === 'ru' ? "bg-[#5865F2] text-white border-[#5865F2]" : "text-zinc-500 border-white/10 hover:border-white/20")}
          >
            RU
          </button>
          <button 
            onClick={() => handleLanguageChange('en')} 
            className={cn("px-2 py-1 text-[10px] font-bold rounded border transition-all", language === 'en' ? "bg-[#5865F2] text-white border-[#5865F2]" : "text-zinc-500 border-white/10 hover:border-white/20")}
          >
            EN
          </button>
        </div>
        {onClose && (
          <button onClick={onClose} className="absolute top-4 left-4 p-2 text-zinc-500 hover:text-white hover:bg-white/5 rounded-lg transition-colors flex items-center gap-2">
            <ArrowLeft className="w-4 h-4" /> {t.cancel}
          </button>
        )}
        <div className="max-w-[480px] w-full space-y-6 bg-[#2b2d31] p-8 rounded-lg shadow-2xl relative overflow-hidden">
          <div className="text-center space-y-2 relative z-10">
            <h1 className="text-2xl font-bold text-white">
              {authMode === 'register' ? "Create an account" : "Welcome back!"}
            </h1>
            <p className="text-[#b5bac1] text-sm">
              {authMode === 'register' ? "Join the most secure community" : "We're so excited to see you again!"}
            </p>
          </div>

          <div className="space-y-4 relative z-10">
            {authMode === 'register' ? (
              <form onSubmit={handleRegister} className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="username" className="text-[12px] font-bold text-[#b5bac1] uppercase tracking-wider">
                    {t.usernameLabel} <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="username"
                    type="text"
                    required
                    value={regUsername}
                    onChange={(e) => setRegUsername(e.target.value)}
                    className="block w-full px-3 py-2.5 rounded bg-[#1e1f22] text-[#dbdee1] placeholder-[#4e5058] focus:outline-none transition-all sm:text-sm"
                    disabled={isRegistering}
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor="password" className="text-[12px] font-bold text-[#b5bac1] uppercase tracking-wider">
                    {t.passwordLabel} <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      required
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      className="block w-full px-3 py-2.5 rounded bg-[#1e1f22] text-[#dbdee1] placeholder-[#4e5058] focus:outline-none transition-all sm:text-sm"
                      disabled={isRegistering}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-[#b5bac1] hover:text-white"
                    >
                      {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isRegistering || !(regUsername || '').trim() || !(regPassword || '').trim()}
                  className="w-full py-2.5 px-4 rounded bg-[#5865F2] hover:bg-[#4752c4] text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-4"
                >
                  {isRegistering ? t.registering : t.registerBtn}
                </button>

                <p className="text-[14px] text-[#949ba4]">
                  Already have an account?{" "}
                  <button 
                    type="button" 
                    onClick={() => setAuthMode('login')}
                    className="text-[#00a8fc] hover:underline"
                  >
                    Login
                  </button>
                </p>
              </form>
            ) : (
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="loginUsername" className="text-[12px] font-bold text-[#b5bac1] uppercase tracking-wider">
                    {t.loginUsernameLabel} <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="loginUsername"
                    type="text"
                    required
                    value={regUsername}
                    onChange={(e) => setRegUsername(e.target.value)}
                    className="block w-full px-3 py-2.5 rounded bg-[#1e1f22] text-[#dbdee1] placeholder-[#4e5058] focus:outline-none transition-all sm:text-sm"
                    disabled={isLoggingIn}
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor="loginPassword" className="text-[12px] font-bold text-[#b5bac1] uppercase tracking-wider">
                    {t.loginPasswordLabel} <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      id="loginPassword"
                      type={showPassword ? "text" : "password"}
                      required
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      className="block w-full px-3 py-2.5 rounded bg-[#1e1f22] text-[#dbdee1] placeholder-[#4e5058] focus:outline-none transition-all sm:text-sm"
                      disabled={isLoggingIn}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-[#b5bac1] hover:text-white"
                    >
                      {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isLoggingIn || !(regUsername || '').trim() || !(regPassword || '').trim()}
                  className="w-full py-2.5 px-4 rounded bg-[#5865F2] hover:bg-[#4752c4] text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-4"
                >
                  {isLoggingIn ? t.loggingIn : t.loginBtn}
                </button>

                <p className="text-[14px] text-[#949ba4]">
                  Need an account?{" "}
                  <button 
                    type="button" 
                    onClick={() => setAuthMode('register')}
                    className="text-[#00a8fc] hover:underline"
                  >
                    Register
                  </button>
                </p>

                <button
                  type="button"
                  onClick={handleForgetAccount}
                  className="w-full py-2 px-4 text-[12px] text-[#949ba4] hover:text-white transition-colors mt-2"
                >
                  {t.forgetAccount}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    );
  }

  const activeUser = activeChat === 'bot-safems' 
    ? { id: 'bot-safems', username: 'safeMS', publicKey: 'bot-key', online: true, isBot: true }
    : users.find(u => u.id === activeChat) || contactInfo[activeChat as string] || (groups.find(g => g.id === activeChat) ? {
        ...groups.find(g => g.id === activeChat),
        id: groups.find(g => g.id === activeChat)!.id,
        username: groups.find(g => g.id === activeChat)!.name,
        displayName: groups.find(g => g.id === activeChat)!.name,
        avatar: groups.find(g => g.id === activeChat)!.avatar,
        isGroup: true,
        publicKey: 'group-key' // Dummy key to satisfy encryption checks for UI
      } : (activeChat && messages[activeChat] ? {
        id: activeChat,
        username: 'Contact',
        publicKey: '',
        online: false
      } : null));
  const activeMessages = activeChat ? (messages[activeChat] || []) : [];

  return (
    <div className="flex h-full w-full bg-[#0e1621] text-zinc-100 font-sans overflow-hidden relative">
      {/* Sidebar */}
      <div className={cn(
        "w-full md:w-[350px] flex-shrink-0 border-r border-[#0e1621] bg-[#17212b] flex flex-col transition-all duration-300",
        activeChat ? "hidden md:flex" : "flex"
      )}>
        {/* Sidebar Header */}
        <div className="p-2 flex items-center gap-2">
          <button onClick={() => setShowSettings(true)} className="p-2.5 text-zinc-400 hover:text-white hover:bg-white/5 rounded-full transition-colors">
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex-1 relative">
            <input 
              type="text"
              placeholder={t.search}
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              className="w-full bg-[#242f3d] border-none rounded-full py-1.5 pl-10 pr-4 text-[13px] text-white placeholder-zinc-500 focus:ring-0 transition-all"
            />
            <MessageSquare className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            {isSearching && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <RefreshCw className="w-3 h-3 text-emerald-500 animate-spin" />
              </div>
            )}
          </div>
          <button 
            onClick={() => setShowCreateGroup(true)}
            className="p-2.5 text-emerald-500 hover:text-emerald-400 hover:bg-emerald-500/10 rounded-full transition-colors"
            title={t.createGroup}
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>

        {/* Chat List */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {searchQuery.trim() ? (
            <div className="p-2">
              <h3 className="px-3 py-2 text-xs font-semibold text-emerald-500 uppercase tracking-wider">{t.searchResults}</h3>
              {searchResults.length === 0 && !isSearching ? (
                <p className="px-3 py-4 text-sm text-zinc-500 text-center">{t.noResults}</p>
              ) : (
                searchResults.map(user => (
                  <button
                    key={user.id}
                    onClick={() => {
                      setActiveChat(user.id);
                      setContactInfo(prev => ({ ...prev, [user.id]: user }));
                      setSearchQuery('');
                      setSearchResults([]);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-white/5 transition-all text-left"
                  >
                    <div className="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-500">
                      {user.avatar ? <img src={user.avatar} className="w-full h-full rounded-full object-cover" /> : <User className="w-6 h-6" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{user.displayName || user.username}</p>
                      <p className="text-xs text-zinc-500 truncate">@{user.username}</p>
                    </div>
                  </button>
                ))
              )}
            </div>
          ) : (
            <div className="p-1">
              {/* Pinned / Bot */}
              <button
                onClick={() => setActiveChat('bot-safems')}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left",
                  activeChat === 'bot-safems' ? "bg-[#2b5278]" : "hover:bg-white/5"
                )}
              >
                <div className="w-11 h-11 rounded-full bg-emerald-500 flex items-center justify-center text-white flex-shrink-0">
                  <Bot className="w-6 h-6" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-baseline">
                    <p className="text-[14px] font-semibold text-white truncate">safeMS</p>
                    {messages['bot-safems']?.length > 0 && (
                      <span className="text-[11px] text-zinc-400">
                        {format(messages['bot-safems'][messages['bot-safems'].length - 1].timestamp, 'HH:mm')}
                      </span>
                    )}
                  </div>
                  <p className="text-[13px] text-zinc-400 truncate">{t.systemAssistant}</p>
                </div>
              </button>

              {/* Groups */}
              {groups.filter(g => g.members.includes(currentUser.id)).map(group => (
                <button
                  key={group.id}
                  onClick={() => setActiveChat(group.id)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left",
                    activeChat === group.id ? "bg-[#2b5278]" : "hover:bg-white/5"
                  )}
                >
                  <div className="w-11 h-11 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-500 font-bold uppercase overflow-hidden flex-shrink-0">
                    {group.avatar ? (
                      <img src={group.avatar} alt={group.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      group.name.charAt(0)
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-baseline">
                      <p className="text-[14px] font-semibold text-white truncate">{group.name}</p>
                      {messages[group.id]?.length > 0 && (
                        <span className="text-[11px] text-zinc-400">
                          {format(messages[group.id][messages[group.id].length - 1].timestamp, 'HH:mm')}
                        </span>
                      )}
                    </div>
                    <p className="text-[13px] text-zinc-400 truncate">
                      {messages[group.id]?.length > 0 
                        ? messages[group.id][messages[group.id].length - 1].content 
                        : t.groupChat}
                    </p>
                  </div>
                </button>
              ))}

              {/* Contacts */}
              {contacts.map(contactId => {
                const serverUser = users.find(u => u.id === contactId);
                const user = serverUser || contactInfo[contactId] || {
                  id: contactId,
                  username: contactId.substring(0, 8) + '...',
                  publicKey: '',
                  online: false,
                  lastSeen: 0,
                  isNotFound: true
                };
                
                return (
                <div key={user.id} className="group relative">
                  <button
                    onClick={() => setActiveChat(user.id)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left",
                      activeChat === user.id ? "bg-[#2b5278]" : "hover:bg-white/5"
                    )}
                  >
                    <div className="relative flex-shrink-0">
                      <div className="w-11 h-11 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-300 font-bold uppercase overflow-hidden ring-1 ring-white/5">
                        {user.avatar ? (
                          <img src={user.avatar} alt={user.username} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        ) : (
                          user.username.charAt(0)
                        )}
                      </div>
                      {!user.isNotFound && user.online && (
                        <div className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 rounded-full border-2 border-[#17212b]" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-baseline">
                        <p className={cn(
                          "text-[14px] font-semibold truncate flex items-center gap-1",
                          user.isNotFound ? "text-zinc-500 italic" : "text-white"
                        )}>
                          {user.displayName || user.username}
                          {user.username === 'admin' && <BadgeCheck className="w-3.5 h-3.5 text-emerald-500 fill-emerald-500/10" />}
                        </p>
                        {messages[user.id]?.length > 0 && (
                          <span className="text-[11px] text-zinc-400">
                            {format(messages[user.id][messages[user.id].length - 1].timestamp, 'HH:mm')}
                          </span>
                        )}
                      </div>
                      <p className="text-[13px] text-zinc-400 truncate">
                        {messages[user.id]?.length > 0 
                          ? messages[user.id][messages[user.id].length - 1].content 
                          : (user.isNotFound ? t.userNotFound : (user.online ? t.online : formatLastSeen(user.lastSeen || 0)))}
                      </p>
                    </div>
                  </button>
                  <button
                    onClick={(e) => handleDeleteContact(user.id, e)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white rounded-lg opacity-0 group-hover:opacity-100 transition-all z-10"
                    title={t.deleteContact}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )})}
            </div>
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className={cn(
        "flex-1 flex flex-col bg-[#0a0a0a] relative min-w-0 transition-all duration-300",
        !activeChat ? "hidden md:flex" : "flex"
      )}>
        {activeChat && activeUser ? (
          <React.Fragment>
            {/* Chat Header */}
            <div className="h-14 border-b border-white/5 flex items-center px-4 md:px-6 bg-[#17212b] sticky top-0 z-10">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <button 
                  onClick={() => setActiveChat(null)}
                  className="md:hidden p-2 -ml-2 text-zinc-400 hover:text-white hover:bg-white/5 rounded-full transition-colors"
                >
                  <ArrowLeft className="w-6 h-6" />
                </button>

                <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-300 font-medium uppercase overflow-hidden">
                  {activeUser.avatar ? (
                    <img src={activeUser.avatar} alt={activeUser.username} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    activeUser.username.charAt(0)
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-bold text-white truncate flex items-center gap-1">
                    {activeUser.displayName || activeUser.username}
                    {activeUser.username === 'admin' && <BadgeCheck className="w-3.5 h-3.5 text-emerald-500 fill-emerald-500/10" />}
                  </h3>
                  <p className="text-[11px] text-emerald-500">
                    {activeUser.isBot ? t.systemAssistant : (activeUser.online ? t.online : formatLastSeen(activeUser.lastSeen || 0))}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1">
                {!activeUser.isGroup && !activeUser.isBot && (
                  <>
                    <button onClick={() => startCall(activeUser as UserData, true)} className="p-2 text-zinc-400 hover:text-emerald-500 hover:bg-white/5 rounded-full transition-colors">
                      <Camera className="w-5 h-5" />
                    </button>
                    <button onClick={() => startCall(activeUser as UserData, false)} className="p-2 text-zinc-400 hover:text-emerald-500 hover:bg-white/5 rounded-full transition-colors">
                      <Phone className="w-5 h-5" />
                    </button>
                  </>
                )}
                
                {activeUser.isGroup && (
                  <>
                    <button
                      onClick={() => setShowGroupMembers(true)}
                      className="p-2 text-zinc-400 hover:text-emerald-500 hover:bg-white/5 rounded-lg transition-all flex items-center gap-2 text-xs font-medium"
                      title={t.groupMembers}
                    >
                      <Users className="w-4 h-4" />
                    </button>
                    
                    <button
                      onClick={() => {
                        const inviteLink = `${window.location.origin}${window.location.pathname}?join=${activeUser.id}`;
                        navigator.clipboard.writeText(inviteLink);
                        addLog('Invite link copied to clipboard', 'success');
                      }}
                      className="p-2 text-zinc-400 hover:text-emerald-500 hover:bg-white/5 rounded-lg transition-all flex items-center gap-2 text-xs font-medium"
                      title={t.inviteLink}
                    >
                      <Link className="w-4 h-4" />
                    </button>

                    {activeUser.adminId === currentUser.id && (
                      <button
                        onClick={() => {
                          setGroupSettingsName(activeUser.username);
                          setShowGroupSettings(true);
                        }}
                        className="p-2 text-zinc-400 hover:text-emerald-500 hover:bg-white/5 rounded-lg transition-all flex items-center gap-2 text-xs font-medium"
                        title={t.groupSettings}
                      >
                        <Settings className="w-4 h-4" />
                      </button>
                    )}
                  </>
                )}
                <button className="p-2 text-zinc-400 hover:text-white hover:bg-white/5 rounded-full transition-colors">
                  <Copy className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Add to Contacts Banner */}
            {!contacts.includes(activeUser.id) && !activeUser.isBot && !activeUser.isGroup && (
              <div className="bg-[#242f3d] p-3 flex items-center justify-between border-b border-white/5">
                <p className="text-xs text-zinc-300">{t.userNotFound}</p>
                <button 
                  onClick={() => handleAddContact(activeUser as UserData)}
                  className="px-4 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold rounded-full transition-colors"
                >
                  {t.addToContacts}
                </button>
              </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-[#0e1621] custom-scrollbar" style={{ backgroundImage: 'url("https://picsum.photos/seed/chat/1920/1080?blur=10")', backgroundSize: 'cover', backgroundBlendMode: 'overlay' }}>
              <div className="flex justify-center mb-4">
                <div className="bg-black/40 backdrop-blur-md text-zinc-300 text-[10px] px-3 py-1 rounded-full flex items-center gap-2">
                  <Lock className="w-3 h-3" />
                  {activeUser.isBot ? "Local system bot. No network traffic." : "End-to-end encrypted."}
                </div>
              </div>

              {activeMessages.map((msg, idx) => {
                const showAvatar = idx === 0 || activeMessages[idx - 1].senderId !== msg.senderId;
                return (
                  <MessageItem 
                    key={msg.id} 
                    msg={msg} 
                    activeUser={activeUser} 
                    showAvatar={showAvatar} 
                  />
                );
              })}
              {isBotTyping && activeChat === 'bot-safems' && (
                <div className="flex justify-start">
                  <div className="bg-[#17212b] rounded-2xl p-3 shadow-sm">
                    <div className="flex gap-1">
                      <div className="w-1.5 h-1.5 bg-emerald-500/50 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <div className="w-1.5 h-1.5 bg-emerald-500/50 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <div className="w-1.5 h-1.5 bg-emerald-500/50 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="bg-[#17212b] p-2 md:p-3 flex flex-col gap-2 relative">
              {showEmojiPicker && (
                <div className="absolute bottom-full left-0 z-50">
                  <EmojiPicker 
                    onEmojiClick={(emojiData) => {
                      setInputText(prev => prev + emojiData.emoji);
                      setShowEmojiPicker(false);
                    }}
                    theme={EmojiTheme.DARK}
                    emojiStyle={EmojiStyle.GOOGLE}
                    lazyLoadEmojis={true}
                  />
                </div>
              )}
              {activeChat === 'bot-safems' && (
                <div className="flex flex-wrap gap-1.5 mb-1">
                  <button onClick={() => handleBotMessage('Как работает сайт?')} className="px-3 py-1 bg-white/5 hover:bg-white/10 text-[10px] text-zinc-300 rounded-full transition-colors border border-white/10">
                    ℹ️ Как работает сайт?
                  </button>
                  <button onClick={() => handleBotMessage('Проверить аккаунт на взлом')} className="px-3 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-[10px] text-emerald-400 rounded-full transition-colors border border-emerald-500/20">
                    🛡️ Проверить на взлом
                  </button>
                  <button onClick={() => handleBotMessage('Как устроен проект?')} className="px-3 py-1 bg-white/5 hover:bg-white/10 text-[10px] text-zinc-300 rounded-full transition-colors border border-white/10">
                    🏗️ Архитектура
                  </button>
                  <button onClick={() => handleBotMessage('Как удалить аккаунт?')} className="px-3 py-1 bg-red-500/10 hover:bg-red-500/20 text-[10px] text-red-400 rounded-full transition-colors border border-red-500/20">
                    🗑️ Удаление
                  </button>
                  <button onClick={() => handleBotMessage('Как создать группу?')} className="px-3 py-1 bg-blue-500/10 hover:bg-blue-500/20 text-[10px] text-blue-400 rounded-full transition-colors border border-blue-500/20">
                    👥 Группы
                  </button>
                </div>
              )}
              <form
                onSubmit={handleSendMessage}
                className="flex items-end gap-2 max-w-5xl mx-auto w-full"
              >
                <button
                  type="button"
                  onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                  className="p-2.5 text-zinc-400 hover:text-white hover:bg-white/5 rounded-full transition-colors"
                >
                  <Smile className="w-6 h-6" />
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="p-2.5 text-zinc-400 hover:text-white hover:bg-white/5 rounded-full transition-colors"
                >
                  <Paperclip className="w-6 h-6" />
                </button>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <div className="flex-1 bg-[#242f3d] rounded-2xl overflow-hidden flex items-center pr-2">
                  <input
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder={isSending ? 'Encrypting...' : t.messagePlaceholder || "Write a message..."}
                    disabled={isSending}
                    className="w-full bg-transparent text-white px-4 py-3 focus:outline-none text-sm"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!inputText.trim() || isSending}
                  className={cn(
                    "p-3 rounded-full transition-all flex items-center justify-center",
                    inputText.trim() ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/20" : "bg-zinc-800 text-zinc-500"
                  )}
                >
                  <Send className="w-5 h-5" />
                </button>
              </form>
            </div>
          </React.Fragment>
        ) : (
          <div className="flex-1 hidden md:flex flex-col items-center justify-center p-8 text-center bg-[#0a0a0a]">
          <div className="w-20 h-20 rounded-3xl bg-emerald-500/10 flex items-center justify-center text-emerald-500 mb-6 ring-1 ring-emerald-500/20">
            <Shield className="w-10 h-10" />
          </div>
          <h3 className="text-xl font-bold text-white mb-2">{t.welcome}</h3>
          <p className="text-zinc-500 max-w-sm">
            {t.selectContact}
          </p>
        </div>
      )}
    </div>

      {/* Modals */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#121212] border border-white/10 rounded-2xl p-6 w-full max-w-md space-y-6 relative shadow-2xl max-h-[90vh] overflow-y-auto">
            <button onClick={() => setShowSettings(false)} className="absolute top-4 right-4 p-2 text-zinc-500 hover:text-white transition-colors">
              <X className="w-6 h-6" />
            </button>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Settings className="w-5 h-5 text-emerald-500" /> {t.settings}
            </h2>
            <div className="space-y-6">
              {/* Profile Section */}
              <div className="flex flex-col items-center gap-4 pb-6 border-b border-white/10">
                <div className="relative group">
                  <div className="w-24 h-24 rounded-full bg-emerald-500/10 border-2 border-emerald-500/20 flex items-center justify-center overflow-hidden">
                    {currentUser.avatar ? (
                      <img src={currentUser.avatar} alt="Avatar" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <User className="w-12 h-12 text-emerald-500" />
                    )}
                  </div>
                  <button 
                    onClick={() => avatarInputRef.current?.click()}
                    className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-full"
                  >
                    <Camera className="w-6 h-6 text-white" />
                  </button>
                  <input 
                    type="file" 
                    ref={avatarInputRef} 
                    onChange={handleAvatarChange} 
                    accept="image/*" 
                    className="hidden" 
                  />
                </div>
                <div className="text-center w-full space-y-3">
                  <div className="space-y-1">
                    <h3 className="text-lg font-bold text-white flex items-center justify-center gap-1.5">
                      {currentUser.displayName || currentUser.username}
                      {currentUser.username === 'admin' && <BadgeCheck className="w-5 h-5 text-emerald-500 fill-emerald-500/10" />}
                    </h3>
                    <p className="text-xs text-zinc-500">@{currentUser.username}</p>
                  </div>
                  
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newDisplayName}
                      onChange={(e) => setNewDisplayName(e.target.value)}
                      placeholder={t.displayNameLabel}
                      className="flex-1 bg-black/50 border border-white/10 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500/50 transition-all"
                    />
                    <button
                      onClick={handleUpdateDisplayName}
                      className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium rounded-xl transition-colors"
                    >
                      {t.save}
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-3 pt-4 border-t border-white/10">
                <h3 className="text-xs font-medium text-emerald-500 uppercase tracking-wider">{t.language}</h3>
                <div className="flex gap-2">
                  <button 
                    onClick={() => handleLanguageChange('ru')} 
                    className={cn(
                      "flex-1 py-2 text-xs font-bold rounded-xl border transition-all", 
                      language === 'ru' ? "bg-emerald-500 text-black border-emerald-500" : "text-zinc-500 border-white/10 hover:border-white/20"
                    )}
                  >
                    {t.russian}
                  </button>
                  <button 
                    onClick={() => handleLanguageChange('en')} 
                    className={cn(
                      "flex-1 py-2 text-xs font-bold rounded-xl border transition-all", 
                      language === 'en' ? "bg-emerald-500 text-black border-emerald-500" : "text-zinc-500 border-white/10 hover:border-white/20"
                    )}
                  >
                    {t.english}
                  </button>
                </div>
              </div>

              {currentUser.username === 'admin' && (
                <div className="space-y-4 pt-6 border-t border-emerald-500/20">
                  <div className="flex items-center gap-2 text-emerald-500">
                    <ShieldCheck className="w-4 h-4" />
                    <h3 className="text-xs font-bold uppercase tracking-widest">{t.adminMode}</h3>
                  </div>
                  
                  <div className="space-y-3 bg-emerald-500/5 p-4 rounded-2xl border border-emerald-500/10">
                    <div>
                      <h4 className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider mb-2">{t.broadcast}</h4>
                      <p className="text-[10px] text-zinc-500 mb-3">{t.broadcastDesc}</p>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={broadcastText}
                          onChange={(e) => setBroadcastText(e.target.value)}
                          placeholder={t.broadcastPlaceholder}
                          className="flex-1 bg-black/40 border border-white/5 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
                        />
                        <button
                          onClick={handleBroadcast}
                          disabled={isBroadcasting || !(broadcastText || '').trim()}
                          className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-black text-[10px] font-bold rounded-xl transition-all"
                        >
                          {isBroadcasting ? '...' : t.send}
                        </button>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-white/5">
                      <h4 className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider mb-2">Database Management</h4>
                      <a 
                        href="/api/admin/db" 
                        download="db.json"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full flex items-center justify-center gap-2 py-2 bg-white/5 hover:bg-white/10 text-emerald-500 text-[10px] font-bold rounded-xl transition-all border border-emerald-500/20"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Download db.json
                      </a>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-3 pt-4 border-t border-white/10">
                <h3 className="text-xs font-medium text-emerald-500 uppercase tracking-wider flex items-center gap-2">
                  <QrCode className="w-4 h-4" /> {t.mobileAccess}
                </h3>
                <div className="bg-white p-3 rounded-xl inline-block mx-auto shadow-lg ring-1 ring-black/5">
                  <QRCodeSVG 
                    value={APP_URL} 
                    size={160} 
                    level="H"
                    includeMargin={true}
                  />
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <input 
                    readOnly 
                    value={APP_URL}
                    className="flex-1 bg-black/30 border border-white/5 rounded-lg px-2 py-1 text-[10px] text-zinc-400 truncate"
                  />
                  <button 
                    onClick={() => {
                      navigator.clipboard.writeText(APP_URL);
                      setCopySuccess(true);
                      setTimeout(() => setCopySuccess(false), 2000);
                    }}
                    className="p-1.5 bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
                  >
                    {copySuccess ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5 text-zinc-500" />}
                  </button>
                </div>
                <p className="text-[10px] text-zinc-500 text-center">{t.scanQrHint}</p>
              </div>

              <div className="space-y-3 pt-4 border-t border-white/10">
                {deferredPrompt && (
                  <button
                    onClick={handleInstall}
                    className="w-full flex items-center justify-center gap-2 py-3 bg-emerald-500 hover:bg-emerald-600 text-white font-medium rounded-xl transition-colors mb-4"
                  >
                    <Smartphone className="w-5 h-5" />
                    {t.installApp}
                  </button>
                )}
                <h3 className="text-xs font-medium text-emerald-500 uppercase tracking-wider">{t.activeDevices}</h3>
                <div className="space-y-2">
                  {activeSessions.map(session => (
                    <div key={session.socketId} className="flex items-center justify-between bg-black/20 p-3 rounded-xl border border-white/5">
                      <div className="flex items-center gap-3">
                        {session.deviceModel.includes('PC') || session.deviceModel.includes('Mac') ? <Monitor className="w-5 h-5 text-zinc-400" /> : <Smartphone className="w-5 h-5 text-zinc-400" />}
                        <div>
                          <p className="text-sm font-medium text-zinc-200">{session.deviceModel}</p>
                          <p className="text-xs text-zinc-500">{t.connected}: {new Date(session.connectedAt).toLocaleTimeString()}</p>
                        </div>
                      </div>
                      {session.socketId !== socket?.id && (
                        <button
                          onClick={() => {
                            socket?.emit('kick_session', { userId: currentUser.id, socketIdToKick: session.socketId });
                            setActiveSessions(prev => prev.filter(s => s.socketId !== session.socketId));
                          }}
                          className="p-2 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                          title={t.kickDevice}
                        >
                          <LogOut className="w-4 h-4" />
                        </button>
                      )}
                      {session.socketId === socket?.id && (
                        <span className="text-xs text-emerald-500 font-medium px-2">{t.current}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              
              <div className="pt-4 border-t border-white/10 space-y-3">
                <h3 className="text-xs font-medium text-red-500 uppercase tracking-wider">{t.dangerZone}</h3>
                
                <button
                  onClick={handleChangeKey}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-black/20 hover:bg-white/5 text-zinc-300 rounded-xl transition-colors border border-white/5 text-left"
                >
                  <RefreshCw className="w-5 h-5 text-zinc-400 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium">{t.changeKey}</p>
                    <p className="text-xs text-zinc-500">{t.changeKeyDesc}</p>
                  </div>
                </button>

                <button
                  onClick={handleClearContacts}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-black/20 hover:bg-white/5 text-zinc-300 rounded-xl transition-colors border border-white/5 text-left"
                >
                  <Trash className="w-5 h-5 text-zinc-400 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium">{t.clearChats}</p>
                    <p className="text-xs text-zinc-500">{t.clearChatsDesc}</p>
                  </div>
                </button>

                <button
                  onClick={() => {
                    setIsLocked(true);
                    setShowSettings(false);
                    addLog('App locked manually', 'warn');
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-black/20 hover:bg-white/5 text-zinc-300 rounded-xl transition-colors border border-white/5 text-left"
                >
                  <Lock className="w-5 h-5 text-zinc-400 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium">{t.lockApp}</p>
                    <p className="text-xs text-zinc-500">{t.lockAppDesc}</p>
                  </div>
                </button>

                <div className="flex items-center justify-between px-4 py-3 bg-black/20 rounded-xl border border-white/5">
                  <div className="flex items-center gap-3">
                    <Monitor className="w-5 h-5 text-emerald-500" />
                    <div>
                      <p className="text-sm font-medium text-zinc-200">{t.adminMode}</p>
                      <p className="text-xs text-zinc-500">{t.adminModeDesc}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setIsAdminMode(!isAdminMode)}
                    className={cn(
                      "w-12 h-6 rounded-full transition-all relative",
                      isAdminMode ? "bg-emerald-500" : "bg-zinc-700"
                    )}
                  >
                    <div className={cn(
                      "absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
                      isAdminMode ? "right-1" : "left-1"
                    )} />
                  </button>
                </div>

                <button 
                  onClick={handleForgetAccount}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-white/5 hover:bg-white/10 text-zinc-300 rounded-xl transition-colors border border-white/5 text-left"
                >
                  <LogOut className="w-5 h-5 text-zinc-400 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium">{t.forgetAccount}</p>
                    <p className="text-xs text-zinc-500">{t.forgetAccountDesc}</p>
                  </div>
                </button>

                <button 
                  onClick={handleDeleteAccount}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-xl transition-colors border border-red-500/20 text-left"
                >
                  <Trash2 className="w-5 h-5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium">{t.deleteAccount}</p>
                    <p className="text-xs text-red-400/70">{t.deleteAccountDesc}</p>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isAdminMode && (
        <div className="fixed bottom-0 right-0 md:bottom-4 md:right-4 w-full md:w-96 max-h-[400px] bg-[#121212] border-t md:border border-emerald-500/30 rounded-t-2xl md:rounded-2xl shadow-2xl z-[60] flex flex-col overflow-hidden backdrop-blur-xl">
          <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between bg-emerald-500/5">
            <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold uppercase tracking-widest">
              <Monitor className="w-4 h-4" />
              {t.systemLogs}
            </div>
            <button onClick={() => setIsAdminMode(false)} className="text-zinc-500 hover:text-white transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-2 font-mono text-[10px]">
            {logs.length === 0 ? (
              <div className="text-zinc-600 italic text-center py-4">{t.noLogs}</div>
            ) : (
              logs.map(log => (
                <div key={log.id} className="border-l-2 border-white/5 pl-2 py-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-zinc-600">{new Date(log.timestamp).toLocaleTimeString()}</span>
                    <span className={cn(
                      "px-1 rounded uppercase font-bold text-[8px]",
                      log.level === 'success' ? "bg-emerald-500/20 text-emerald-400" :
                      log.level === 'error' ? "bg-red-500/20 text-red-400" :
                      log.level === 'warn' ? "bg-yellow-500/20 text-yellow-400" :
                      "bg-blue-500/20 text-blue-400"
                    )}>
                      {log.level}
                    </span>
                  </div>
                  <div className="text-zinc-300 break-all">{log.message}</div>
                  {log.details && <div className="text-zinc-500 mt-1 italic opacity-70">{log.details}</div>}
                </div>
              ))
            )}
          </div>
          <div className="px-4 py-2 border-t border-white/5 bg-black/20 flex justify-between items-center">
            <span className="text-[9px] text-zinc-500">{logs.length} events logged</span>
            <button onClick={() => setLogs([])} className="text-[9px] text-emerald-500 hover:underline">Clear Logs</button>
          </div>
        </div>
      )}

      {confirmModal.show && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-[#121212] border border-white/10 rounded-2xl p-6 w-full max-w-sm space-y-6 relative shadow-2xl text-center">
            <div className={cn(
              "inline-flex items-center justify-center w-16 h-16 rounded-full mb-2 ring-1",
              confirmModal.type === 'danger' ? "bg-red-500/10 text-red-400 ring-red-500/20" : "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20"
            )}>
              {confirmModal.type === 'danger' ? <AlertTriangle className="w-8 h-8" /> : <Check className="w-8 h-8" />}
            </div>
            <div>
              <h2 className="text-xl font-bold text-white mb-2">{confirmModal.title}</h2>
              <p className="text-zinc-400 text-sm">{confirmModal.message}</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmModal(prev => ({ ...prev, show: false }))}
                className="flex-1 py-3 bg-white/5 hover:bg-white/10 text-white font-medium rounded-xl transition-colors border border-white/10"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  confirmModal.onConfirm();
                  setConfirmModal(prev => ({ ...prev, show: false }));
                }}
                className={cn(
                  "flex-1 py-3 font-medium rounded-xl transition-colors",
                  confirmModal.type === 'danger' ? "bg-red-500 hover:bg-red-400 text-white" : "bg-emerald-500 hover:bg-emerald-400 text-black"
                )}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Group Modal */}
      {showCreateGroup && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md bg-[#121212] border border-white/10 rounded-3xl shadow-2xl overflow-hidden"
          >
            <div className="p-6 space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <Users className="w-6 h-6 text-emerald-500" />
                  {t.createGroup}
                </h2>
                <button onClick={() => setShowCreateGroup(false)} className="p-2 hover:bg-white/5 rounded-xl transition-colors">
                  <X className="w-5 h-5 text-zinc-500" />
                </button>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">{t.groupName}</label>
                  <input
                    type="text"
                    value={groupNameInput}
                    onChange={(e) => setGroupNameInput(e.target.value)}
                    placeholder={t.groupNamePlaceholder || "Enter group name"}
                    className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
                  />
                </div>
                
                <button
                  onClick={handleCreateGroup}
                  disabled={isCreatingGroup || !(groupNameInput || '').trim()}
                  className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-black font-bold rounded-xl transition-all shadow-lg shadow-emerald-500/20"
                >
                  {isCreatingGroup ? '...' : t.createGroup}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Join Group Modal */}
      {showJoinGroup && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md bg-[#121212] border border-white/10 rounded-3xl shadow-2xl overflow-hidden"
          >
            <div className="p-6 space-y-6 text-center">
              <div className="w-20 h-20 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500 mx-auto">
                <Users className="w-10 h-10" />
              </div>
              
              <div className="space-y-2">
                <h2 className="text-xl font-bold text-white">{t.joinGroup}</h2>
                <p className="text-zinc-400">
                  {t.joinGroupConfirm || "Do you want to join"} <span className="text-emerald-400 font-bold">{showJoinGroup.name}</span>?
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowJoinGroup(null)}
                  className="flex-1 py-3 bg-white/5 hover:bg-white/10 text-white font-bold rounded-xl transition-all"
                >
                  {t.cancel}
                </button>
                <button
                  onClick={handleJoinGroup}
                  className="flex-1 py-3 bg-emerald-500 hover:bg-emerald-600 text-black font-bold rounded-xl transition-all shadow-lg shadow-emerald-500/20"
                >
                  {t.joinGroup}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
      {/* Group Members Modal */}
      {showGroupMembers && activeChat && groups.find(g => g.id === activeChat) && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md bg-[#121212] border border-white/10 rounded-3xl shadow-2xl overflow-hidden"
          >
            <div className="p-6 space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <Users className="w-6 h-6 text-emerald-500" />
                  {t.groupMembers}
                </h2>
                <button onClick={() => setShowGroupMembers(false)} className="p-2 hover:bg-white/5 rounded-xl transition-colors">
                  <X className="w-5 h-5 text-zinc-500" />
                </button>
              </div>

              <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                {groups.find(g => g.id === activeChat)?.members.map(memberId => {
                  const member = users.find(u => u.id === memberId) || (memberId === currentUser?.id ? currentUser : null);
                  return (
                    <div key={memberId} className="flex items-center justify-between p-3 rounded-2xl bg-white/5 border border-white/5">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400 font-bold uppercase overflow-hidden">
                          {member?.avatar ? (
                            <img src={member.avatar} alt={member.username} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          ) : (
                            member?.username?.charAt(0) || '?'
                          )}
                        </div>
                        <div>
                          <p className="text-sm font-bold text-white">{member?.displayName || member?.username || memberId.substring(0, 8)}</p>
                          <p className="text-[10px] text-zinc-500 font-mono">{memberId}</p>
                        </div>
                      </div>
                      {groups.find(g => g.id === activeChat)?.adminId === memberId && (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 text-[10px] font-bold uppercase tracking-wider border border-emerald-500/20">
                          Admin
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Group Settings Modal */}
      {showGroupSettings && activeChat && groups.find(g => g.id === activeChat) && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md bg-[#121212] border border-white/10 rounded-3xl shadow-2xl overflow-hidden"
          >
            <div className="p-6 space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <Settings className="w-6 h-6 text-emerald-500" />
                  {t.groupSettings}
                </h2>
                <button onClick={() => setShowGroupSettings(false)} className="p-2 hover:bg-white/5 rounded-xl transition-colors">
                  <X className="w-5 h-5 text-zinc-500" />
                </button>
              </div>

              <div className="space-y-6">
                {/* Group Avatar */}
                <div className="flex flex-col items-center gap-4">
                  <div className="relative group">
                    <div className="w-24 h-24 rounded-full bg-emerald-500/10 border-2 border-emerald-500/20 flex items-center justify-center overflow-hidden">
                      {groups.find(g => g.id === activeChat)?.avatar ? (
                        <img src={groups.find(g => g.id === activeChat)?.avatar} alt="Group Avatar" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <Users className="w-10 h-10 text-emerald-500/50" />
                      )}
                    </div>
                    <label className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer rounded-full">
                      <Camera className="w-6 h-6 text-white" />
                      <input 
                        type="file" 
                        className="hidden" 
                        accept="image/*"
                        onChange={(e) => handleGroupAvatarChange(activeChat, e)}
                      />
                    </label>
                  </div>
                  <p className="text-xs text-zinc-500">{t.changeGroupAvatar}</p>
                </div>

                {/* Group Name */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">{t.groupNameLabel}</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={groupSettingsName}
                      onChange={(e) => setGroupSettingsName(e.target.value)}
                      className="flex-1 bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
                    />
                    <button
                      onClick={() => handleUpdateGroup(activeChat, { name: groupSettingsName })}
                      className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-black font-bold rounded-xl transition-all"
                    >
                      {t.save}
                    </button>
                  </div>
                </div>

                {/* Invite Link */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">{t.inviteLink}</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      readOnly
                      value={`${window.location.origin}${window.location.pathname}?join=${activeChat}`}
                      className="flex-1 bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-zinc-400 text-xs focus:outline-none"
                    />
                    <button
                      onClick={() => {
                        const inviteLink = `${window.location.origin}${window.location.pathname}?join=${activeChat}`;
                        navigator.clipboard.writeText(inviteLink);
                        addLog('Invite link copied to clipboard', 'success');
                      }}
                      className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white font-bold rounded-xl transition-all border border-white/10"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {showForgetConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-[#121212] border border-white/10 rounded-2xl p-6 max-w-sm w-full shadow-2xl"
          >
            <div className="flex items-center gap-3 text-red-400 mb-4">
              <AlertTriangle className="w-6 h-6" />
              <h3 className="text-lg font-bold">{t.forgetAccount}</h3>
            </div>
            <p className="text-zinc-400 text-sm mb-6">
              {t.confirmForgetAccount}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowForgetConfirm(false)}
                className="flex-1 py-3 px-4 bg-white/5 hover:bg-white/10 text-white font-medium rounded-xl transition-colors border border-white/5"
              >
                {t.cancel}
              </button>
              <button
                onClick={confirmForget}
                className="flex-1 py-3 px-4 bg-red-500 hover:bg-red-600 text-white font-medium rounded-xl transition-colors"
              >
                {t.forgetAccount}
              </button>
            </div>
          </motion.div>
        </div>
      )}
      {/* Media elements for WebRTC */}
      <audio ref={remoteAudioRef} autoPlay />
      <audio ref={notificationSoundRef} src="https://cdn.pixabay.com/audio/2022/03/15/audio_78390a2431.mp3" preload="auto" />
      <audio ref={ringtoneSoundRef} src="https://cdn.pixabay.com/audio/2022/03/10/audio_c8c8a73053.mp3" preload="auto" />

      {/* Incoming Call Modal */}
      {callStatus === 'incoming' && callPartner && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-[#121212] border border-emerald-500/20 rounded-3xl p-8 max-w-sm w-full shadow-2xl text-center ring-1 ring-emerald-500/10"
          >
            <div className="relative mb-6 inline-block">
              <div className="w-24 h-24 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-400 ring-4 ring-emerald-500/20 overflow-hidden mx-auto">
                {callPartner.avatar ? (
                  <img src={callPartner.avatar} alt={callPartner.username} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <User className="w-10 h-10" />
                )}
              </div>
              <div className="absolute -bottom-2 -right-2 w-10 h-10 bg-emerald-500 rounded-full flex items-center justify-center animate-bounce shadow-lg">
                <Phone className="w-5 h-5 text-black" />
              </div>
            </div>
            
            <h3 className="text-2xl font-bold text-white mb-1">{callPartner.displayName || callPartner.username}</h3>
            <p className="text-emerald-400 text-sm font-medium animate-pulse mb-8 uppercase tracking-widest">
              {(window as any).callVideoRequested ? t.videoCall : t.audioCall}
            </p>
            
            <div className="flex gap-4">
              <button
                onClick={rejectCall}
                className="flex-1 py-4 px-4 bg-red-500/10 hover:bg-red-500/20 text-red-500 font-bold rounded-2xl transition-all border border-red-500/20 flex flex-col items-center gap-2"
              >
                <PhoneOff className="w-6 h-6" />
                <span className="text-[10px] uppercase tracking-tighter">{t.reject}</span>
              </button>
              <button
                onClick={acceptCall}
                className="flex-1 py-4 px-4 bg-emerald-500 hover:bg-emerald-400 text-black font-bold rounded-2xl transition-all shadow-[0_0_20px_rgba(16,185,129,0.3)] flex flex-col items-center gap-2"
              >
                <Phone className="w-6 h-6" />
                <span className="text-[10px] uppercase tracking-tighter">{t.accept}</span>
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Active Call Overlay */}
      {(callStatus === 'active' || callStatus === 'calling') && callPartner && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/95 backdrop-blur-xl">
          {/* Video Background if enabled */}
          {isVideoEnabled && (
            <div className="absolute inset-0 overflow-hidden">
              <video 
                ref={remoteVideoRef} 
                autoPlay 
                playsInline 
                className="w-full h-full object-cover opacity-40"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/50" />
            </div>
          )}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-emerald-500/5 blur-[120px] rounded-full" />
          </div>
          
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative z-10 max-w-md w-full text-center"
          >
            {/* Local Video Preview */}
            {isVideoEnabled && (
              <div className="absolute top-0 right-0 w-32 aspect-video bg-zinc-900 rounded-xl overflow-hidden border border-white/10 shadow-2xl z-20">
                <video 
                  ref={localVideoRef} 
                  autoPlay 
                  muted 
                  playsInline 
                  className="w-full h-full object-cover"
                />
              </div>
            )}
            <div className="mb-8 relative inline-block">
              <div className="w-32 h-32 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400 ring-4 ring-white/5 overflow-hidden mx-auto shadow-2xl">
                {callPartner.avatar ? (
                  <img src={callPartner.avatar} alt={callPartner.username} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <User className="w-12 h-12" />
                )}
              </div>
              {callStatus === 'active' && (
                <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-emerald-500 text-black text-[10px] font-black px-3 py-1 rounded-full shadow-lg uppercase tracking-tighter">
                  {formatDuration(callDuration)}
                </div>
              )}
            </div>

            <h3 className="text-3xl font-bold text-white mb-2">{callPartner.displayName || callPartner.username}</h3>
            <p className="text-zinc-500 text-sm font-medium mb-12 uppercase tracking-[0.2em]">
              {callStatus === 'calling' ? t.calling : t.online}
            </p>

            <div className="flex items-center justify-center gap-6">
              <button
                onClick={toggleMute}
                className={cn(
                  "w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300 border",
                  isMuted 
                    ? "bg-red-500/10 border-red-500/20 text-red-500" 
                    : "bg-white/5 border-white/10 text-white hover:bg-white/10"
                )}
              >
                {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
              </button>

              {isVideoEnabled && (
                <button
                  onClick={() => {
                    if (localStreamRef.current) {
                      const videoTrack = localStreamRef.current.getVideoTracks()[0];
                      if (videoTrack) {
                        videoTrack.enabled = !videoTrack.enabled;
                      }
                    }
                  }}
                  className="w-16 h-16 rounded-full bg-white/5 border border-white/10 text-white flex items-center justify-center hover:bg-white/10 transition-all"
                >
                  <Camera className="w-6 h-6" />
                </button>
              )}

              <button
                onClick={endCall}
                className="w-20 h-20 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center transition-all duration-300 shadow-[0_0_30px_rgba(239,68,68,0.3)] hover:scale-105"
              >
                <PhoneOff className="w-8 h-8" />
              </button>

              <div className="w-16 h-16 rounded-full bg-white/5 border border-white/10 text-zinc-500 flex items-center justify-center opacity-50">
                <Smartphone className="w-6 h-6" />
              </div>
            </div>

            <div className="mt-16 flex flex-col items-center gap-4">
              <div className="flex gap-1">
                {[...Array(5)].map((_, i) => (
                  <div 
                    key={i} 
                    className={cn(
                      "w-1 h-4 rounded-full transition-all duration-500",
                      callStatus === 'active' ? "bg-emerald-500/40 animate-pulse" : "bg-zinc-800"
                    )}
                    style={{ animationDelay: `${i * 150}ms` }}
                  />
                ))}
              </div>
              <p className="text-[10px] text-zinc-600 uppercase tracking-widest font-bold flex items-center gap-2">
                <ShieldCheck className="w-3 h-3" /> Secure Encrypted Channel
              </p>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [mode, setMode] = useState<'menu' | 'single' | 'double'>('menu');

  if (mode === 'menu') {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-zinc-100 flex items-center justify-center p-4 font-sans selection:bg-emerald-500/30">
        <div className="max-w-md w-full space-y-8 bg-[#121212] p-8 rounded-2xl border border-white/5 shadow-2xl relative overflow-hidden text-center">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-32 bg-emerald-500/10 blur-[60px] rounded-full pointer-events-none" />
          
          <div className="relative z-10 space-y-6">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-emerald-500/10 text-emerald-400 mb-2 ring-1 ring-emerald-500/20">
              <Shield className="w-10 h-10" />
            </div>
            <div>
              <h1 className="text-4xl font-bold tracking-tight text-white mb-2">safeMS</h1>
              <p className="text-zinc-400 text-sm">Select how you want to launch the app.</p>
            </div>

            <div className="space-y-3 pt-4">
              <button
                onClick={() => setMode('single')}
                className="w-full flex items-center justify-center gap-3 py-4 px-4 border border-transparent rounded-xl shadow-sm text-sm font-medium text-black bg-emerald-500 hover:bg-emerald-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 focus:ring-offset-[#121212] transition-colors"
              >
                <User className="w-5 h-5" />
                Standard Mode
              </button>
              
              <button
                onClick={() => setMode('double')}
                className="w-full flex items-center justify-center gap-3 py-4 px-4 border border-white/10 rounded-xl shadow-sm text-sm font-medium text-white bg-white/5 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-white/20 focus:ring-offset-[#121212] transition-colors"
              >
                <SplitSquareHorizontal className="w-5 h-5" />
                Double Test Mode (Split Screen)
              </button>
            </div>
            
            <p className="text-xs text-zinc-500 pt-4">
              Double Test Mode opens two independent chat windows side-by-side so you can test the encryption yourself without opening multiple tabs.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (mode === 'single') {
    return (
      <div className="h-screen w-full">
        <ErrorBoundary>
          <ChatClient storagePrefix="safeMS_main_" onClose={() => setMode('menu')} />
        </ErrorBoundary>
      </div>
    );
  }

  if (mode === 'double') {
    return (
      <div className="flex flex-col md:flex-row h-screen w-full bg-[#0a0a0a] divide-y md:divide-y-0 md:divide-x divide-white/10">
        <div className="flex-1 relative min-w-0 h-1/2 md:h-full">
          <ErrorBoundary>
            <ChatClient storagePrefix="safeMS_test1_" onClose={() => setMode('menu')} titleSuffix="(User 1)" />
          </ErrorBoundary>
        </div>
        <div className="flex-1 relative min-w-0 h-1/2 md:h-full">
          <ErrorBoundary>
            <ChatClient storagePrefix="safeMS_test2_" onClose={() => setMode('menu')} titleSuffix="(User 2)" />
          </ErrorBoundary>
        </div>
      </div>
    );
  }

  return null;
}
