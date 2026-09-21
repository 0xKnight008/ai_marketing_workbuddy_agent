import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Sprout, Home, SquareCheck, ChartNoAxesColumn, BookOpen, Database, Link, Send, Activity, Settings, Menu, X, Bell, Search, CircleHelp, LogOut, Hash, CreditCard } from 'lucide-react';
import { useWorkspaceLanguage } from './useWorkspaceLanguage';
import './workspace.css';
import { sections, type Section } from './routes';
function useSectionLabels() { const { w } = useWorkspaceLanguage(); return { dashboard:w('Today','Hoy','今日'), review:w('Review','Revisar','待审核'), insights:w('Insights','Análisis','洞察与草稿'), reports:w('Report library','Informes','报告库'), pipelines:w('Publish','Publicar','发布'), imports:w('Sources','Fuentes','数据来源'), accounts:w('Channels','Canales','渠道账号'), topics:w('Topics','Temas','主题'), notifications:w('Notifications','Notificaciones','摘要与提醒'), activity:w('Activity','Actividad','活动'), billing:w('Plan & usage','Plan y uso','套餐与用量'), settings:w('Settings','Ajustes','设置') }; }
const icons = { dashboard: Home, review: SquareCheck, insights:ChartNoAxesColumn, reports:BookOpen, pipelines:Send, imports:Database, accounts:Link, topics:Hash, notifications:Bell, activity:Activity, billing:CreditCard, settings:Settings };
export function WorkspaceShell({ section, navigate, name, email, pending, usage, signOut, children }: { section: Section; navigate:(s:Section)=>void; name:string; email:string; pending:number; usage:{taskUsed:number;taskQuota:number}|null;signOut:()=>void;children:ReactNode }) {
  const {locale,setLocale,w}=useWorkspaceLanguage(); const labels=useSectionLabels();
  const [menu,setMenu]=useState(false); const [search,setSearch]=useState(false); const [query,setQuery]=useState('');
  const menuButton=useRef<HTMLButtonElement>(null); const sidebar=useRef<HTMLElement>(null); const heading=useRef<HTMLHeadingElement>(null);
  const previous=useRef(section);
  const restoreMenuFocus=useRef(false);
  function closeMenu(){restoreMenuFocus.current=true;setMenu(false);}
  useEffect(()=>{if(!menu&&restoreMenuFocus.current){restoreMenuFocus.current=false;menuButton.current?.focus();}},[menu]);
  useEffect(()=>{ if(previous.current!==section){ heading.current?.focus(); previous.current=section; } },[section]);
  useEffect(()=>{ const key=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key==='k'){e.preventDefault();setSearch(true);}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
  useEffect(()=>{if(!menu)return; const old=document.body.style.overflow;document.body.style.overflow='hidden';const panel=sidebar.current;panel?.querySelector<HTMLButtonElement>('button')?.focus();const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){closeMenu();}if(e.key==='Tab'&&panel){const items=Array.from(panel.querySelectorAll<HTMLElement>('button,a,select')).filter(el=>!el.hasAttribute('disabled'));if(e.shiftKey&&document.activeElement===items[0]){e.preventDefault();items.at(-1)?.focus();}else if(!e.shiftKey&&document.activeElement===items.at(-1)){e.preventDefault();items[0]?.focus();}}};window.addEventListener('keydown',key);return()=>{document.body.style.overflow=old;window.removeEventListener('keydown',key);};},[menu]);
  function go(s:Section){setMenu(false);navigate(s);}
  return <div className="workspace-v6">
    <a className="skip-link" href="#workspace-content">{w('Skip to content','Saltar al contenido','跳至主要内容')}</a>
    {menu&&<div className="workspace-scrim" onClick={()=>{closeMenu();}} />}
    <aside ref={sidebar} className={`workspace-sidebar ${menu?'is-open':''}`} aria-label={w('Workspace navigation','Navegación del espacio','工作区导航')}>
      <button className="mobile-only close-menu" onClick={()=>{closeMenu();}} aria-label={w('Close navigation','Cerrar navegación','关闭导航')}><X/></button>
      <a className="workspace-brand" href="/"><Sprout aria-hidden="true"/><span>Piggybot<small>{w('Your thoughtful work buddy','Tu compañero de trabajo','你的贴心工作伙伴')}</small></span></a>
      <div className="workspace-name"><strong>{name}</strong><small>{w('Your workspace','Tu espacio de trabajo','你的工作区')}</small></div>
      <nav>{sections.map(id=>{const Icon=icons[id];return <button key={id} data-nav={id} aria-current={section===id?'page':undefined} onClick={()=>go(id)}><Icon size={18} aria-hidden="true"/><span>{labels[id]}</span>{id==='review'&&pending>0&&<b>{pending}</b>}</button>;})}</nav>
      {usage&&<div className="workspace-meter"><span>{w('Task usage','Uso de tareas','任务用量')}</span><progress aria-label={w('Task usage','Uso de tareas','任务用量')} max={Math.max(usage.taskQuota,1)} value={usage.taskUsed}/><small>{usage.taskUsed.toLocaleString(locale)} / {usage.taskQuota.toLocaleString(locale)}</small></div>}
      <footer><a href="/contact"><CircleHelp size={16}/>{w('Help','Ayuda','帮助')}</a><button onClick={signOut}><LogOut size={16}/>{w('Sign out','Cerrar sesión','退出登录')}</button><small>{email}</small></footer>
    </aside>
    <div className="workspace-main" inert={menu}>
      <header className="workspace-topbar"><button ref={menuButton} className="mobile-only" aria-expanded={menu} aria-label={w('Open navigation','Abrir navegación','打开导航')} onClick={()=>setMenu(true)}><Menu/></button><span className="workspace-breadcrumb">{name} <span>/</span> {labels[section]}</span><div className="workspace-toolbar"><button onClick={()=>setSearch(true)} aria-label={w('Search workspace','Buscar en el espacio','查找工作区')}><Search size={17}/><span className="desktop-only">{w('Find something…','Buscar…','查找内容…')}</span><kbd className="desktop-only">⌘ K</kbd></button><label className="sr-only" htmlFor="workspace-language">{w('Interface language','Idioma de la interfaz','界面语言')}</label><select id="workspace-language" value={locale} onChange={e=>setLocale(e.target.value as typeof locale)}><option value="en">English</option><option value="es">Español</option><option value="zh">简体中文</option></select><button aria-label={w('Review pending items','Revisar pendientes','审核待处理事项')} onClick={()=>go('review')}><Bell size={19}/>{pending>0&&<b>{pending}</b>}</button></div></header>
      <main id="workspace-content" tabIndex={-1}><h1 ref={heading} tabIndex={-1}>{labels[section]}</h1>{children}</main>
    </div>
    {search&&<WorkspaceDialog title={w('Find your next step','Encuentra tu siguiente paso','查找下一步')} onClose={()=>setSearch(false)}><label htmlFor="workspace-search">{w('Search pages','Buscar páginas','搜索页面')}</label><input autoFocus id="workspace-search" value={query} onChange={e=>setQuery(e.target.value)}/><div className="search-results">{sections.filter(id=>labels[id].toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(id=><button key={id} onClick={()=>{setSearch(false);go(id);}}>{labels[id]}</button>)}</div></WorkspaceDialog>}
  </div>;
}
export function WorkspaceDialog({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}){
  const ref=useRef<HTMLDialogElement>(null);const {w}=useWorkspaceLanguage();
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;const dialog=ref.current;dialog?.showModal();return()=>{dialog?.close();if(previous?.isConnected)previous.focus();else document.querySelector<HTMLElement>('#workspace-content h1')?.focus();};},[]);
  return <dialog ref={ref} className="workspace-dialog workspace-v6" onCancel={e=>{e.preventDefault();onClose();}} aria-labelledby="workspace-dialog-title"><header><h2 id="workspace-dialog-title">{title}</h2><button onClick={onClose} aria-label={w('Close','Cerrar','关闭')}><X aria-hidden="true"/></button></header>{children}</dialog>;
}
