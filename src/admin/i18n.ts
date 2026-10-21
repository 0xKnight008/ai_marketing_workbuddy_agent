import {useSyncExternalStore} from 'react';
import messages from './messages.json';
export type AdminLocale='zh'|'en';
function initial():AdminLocale{try{const q=new URLSearchParams(location.search).get('adminLocale');if(q==='zh'||q==='en')return q;return localStorage.getItem('piggybot.admin.locale')==='zh'?'zh':'en'}catch{return 'en'}}
let locale=initial();const listeners=new Set<()=>void>();
export function setAdminLocale(value:AdminLocale){locale=value;try{localStorage.setItem('piggybot.admin.locale',value)}catch{};listeners.forEach(fn=>fn())}
export function useAdminLocale(){return useSyncExternalStore(fn=>{listeners.add(fn);return()=>{listeners.delete(fn)}},()=>locale)}
export function at(text:string){if(locale==='en')return text;const leading=text.match(/^\s*/)?.[0]??'',trailing=text.match(/\s*$/)?.[0]??'';return leading+((messages as Record<string,string>)[text.trim()]??text.trim())+trailing}
