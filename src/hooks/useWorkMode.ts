'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  getNextWorkSkin,
  getWorkSkin,
  WORK_MODE_CHANGE_EVENT,
  WORK_MODE_STORAGE_KEY,
  WORK_SKIN_STORAGE_KEY,
} from '@/lib/disguiseMode';

function applyDocumentState(enabled: boolean, skinId: string) {
  document.documentElement.dataset.workMode = enabled ? 'true' : 'false';
  document.documentElement.dataset.workSkin = skinId;
}

export function useWorkMode() {
  const [enabled, setEnabledState] = useState(false);
  const [skin, setSkin] = useState(() => getWorkSkin(null));

  const sync = useCallback(() => {
    const nextEnabled = window.localStorage.getItem(WORK_MODE_STORAGE_KEY) === '1';
    const nextSkin = getWorkSkin(window.localStorage.getItem(WORK_SKIN_STORAGE_KEY));
    setEnabledState(nextEnabled);
    setSkin(nextSkin);
    applyDocumentState(nextEnabled, nextSkin.id);
  }, []);

  useEffect(() => {
    sync();
    window.addEventListener(WORK_MODE_CHANGE_EVENT, sync);
    return () => window.removeEventListener(WORK_MODE_CHANGE_EVENT, sync);
  }, [sync]);

  const setEnabled = useCallback((nextEnabled: boolean) => {
    window.localStorage.setItem(WORK_MODE_STORAGE_KEY, nextEnabled ? '1' : '0');
    applyDocumentState(nextEnabled, skin.id);
    window.dispatchEvent(new Event(WORK_MODE_CHANGE_EVENT));
  }, [skin.id]);

  const rotateSkin = useCallback(() => {
    const nextSkin = getNextWorkSkin(skin.id);
    window.localStorage.setItem(WORK_SKIN_STORAGE_KEY, nextSkin.id);
    applyDocumentState(enabled, nextSkin.id);
    window.dispatchEvent(new Event(WORK_MODE_CHANGE_EVENT));
  }, [enabled, skin.id]);

  return { enabled, skin, setEnabled, rotateSkin };
}
