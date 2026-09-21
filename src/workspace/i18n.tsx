import { useEffect, type ReactNode } from 'react';
import { useWorkspaceLanguage } from './useWorkspaceLanguage';
import type { Locale } from './locale';
export function WorkspaceLanguage({children}: {children:ReactNode}) {
  const {locale} = useWorkspaceLanguage();
  useEffect(() => { document.documentElement.lang = locale === 'zh' ? 'zh-CN' : locale; }, [locale]);
  return children;
}
export function WorkspaceLanguageSelect() {
  const {locale,setLocale,w}=useWorkspaceLanguage();
  return <label className="block mb-4">{w('Interface language','Idioma de la interfaz','界面语言')} <select value={locale} onChange={e=>setLocale(e.target.value as Locale)}><option value="en">English</option><option value="es">Español</option><option value="zh">简体中文</option></select></label>;
}
