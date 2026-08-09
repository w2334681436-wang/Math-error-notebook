import React, { useEffect, useState } from 'react';
import { CheckCircle2, Download, WifiOff } from 'lucide-react';
import {
  hasOfflineInstallPrompt,
  INSTALL_EVENT,
  promptOfflineInstall,
  STATUS_EVENT,
} from './offlineManager';

export default function OfflineStatus() {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [readyNotice, setReadyNotice] = useState(false);
  const [installAvailable, setInstallAvailable] = useState(hasOfflineInstallPrompt);

  useEffect(() => {
    let hideTimer;
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    const onReady = event => {
      if (!event.detail?.ready) return;
      setReadyNotice(true);
      clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => setReadyNotice(false), 5000);
    };
    const onInstall = event => setInstallAvailable(Boolean(event.detail?.available));

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener(STATUS_EVENT, onReady);
    window.addEventListener(INSTALL_EVENT, onInstall);
    return () => {
      clearTimeout(hideTimer);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener(STATUS_EVENT, onReady);
      window.removeEventListener(INSTALL_EVENT, onInstall);
    };
  }, []);

  if (!online) {
    return (
      <div className="fixed left-1/2 -translate-x-1/2 bottom-24 z-[120] rounded-full bg-slate-900 text-white px-4 py-2.5 shadow-xl flex items-center gap-2 text-xs font-bold whitespace-nowrap">
        <WifiOff size={16} /> 当前离线 · 本地学习正常可用
      </div>
    );
  }

  if (installAvailable) {
    return (
      <button
        type="button"
        onClick={() => promptOfflineInstall().then(() => setInstallAvailable(false))}
        className="fixed left-1/2 -translate-x-1/2 bottom-24 z-[120] rounded-full bg-blue-600 text-white px-4 py-2.5 shadow-xl flex items-center gap-2 text-xs font-black whitespace-nowrap hover:bg-blue-700"
      >
        <Download size={16} /> 安装离线版
      </button>
    );
  }

  if (readyNotice) {
    return (
      <div className="fixed left-1/2 -translate-x-1/2 bottom-24 z-[120] rounded-full bg-emerald-600 text-white px-4 py-2.5 shadow-xl flex items-center gap-2 text-xs font-bold whitespace-nowrap">
        <CheckCircle2 size={16} /> 离线版已准备完成
      </div>
    );
  }

  return null;
}
