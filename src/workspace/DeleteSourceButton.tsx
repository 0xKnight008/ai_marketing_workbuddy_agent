import {useState} from 'react';
import {WorkspaceDialog} from './Shell';
import {useWorkspaceLanguage} from './useWorkspaceLanguage';

export function DeleteSourceButton({id,label,disabled,token,apiBase,onDeleted}:{id:string;label:string;disabled:boolean;token:string;apiBase:string;onDeleted:()=>Promise<void>}) {
  const {w}=useWorkspaceLanguage();
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function remove(){
    if(busy)return;
    setBusy(true);setError('');
    try{
      const response=await fetch(`${apiBase}/api/imports/${id}`,{method:'DELETE',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({confirm:true})});
      const result=await response.json().catch(()=>({}));
      if(!response.ok)throw Error(result.error??'delete_failed');
      await onDeleted();setOpen(false);
    }catch(e){setError((e as Error).message)}finally{setBusy(false)}
  }
  return <><button disabled={disabled} aria-label={`${w('Delete source','Eliminar fuente','删除素材')} · ${label}`} onClick={()=>{setError('');setOpen(true)}}>{w('Delete','Eliminar','删除')}</button>{open&&<WorkspaceDialog title={w('Delete source','Eliminar fuente','删除素材')} onClose={()=>{if(!busy)setOpen(false)}}><p><strong>{label}</strong></p><p>{w('Permanently delete the original items, tags and topic assignments. Saved reports, conversations and credit records remain, but these originals cannot be opened or reused. This cannot be undone.','Elimina permanentemente los originales, etiquetas y asignaciones de temas. Se conservan informes, conversaciones y créditos; los originales no se podrán consultar ni reutilizar. Esta acción no se puede deshacer.','将永久删除原始素材、标签和主题归属。已保存的报告、对话及额度记录保留，但这些原文将无法再核对或复用。删除后不可恢复。')}</p>{error&&<p role="alert">{error==='import_in_use'?w('This source is used by queued or running work. Wait for it to finish before deleting.','La fuente está en uso por tareas pendientes o en curso. Espera a que terminen.','素材仍被排队或执行中的任务使用，请等待任务结束后删除。'):w('Deletion failed. Refresh and retry.','No se pudo eliminar. Actualiza e inténtalo de nuevo.','删除失败，请刷新后重试。')}</p>}<div className="workspace-button-row"><button disabled={busy} onClick={()=>setOpen(false)}>{w('Cancel','Cancelar','取消')}</button><button disabled={busy} onClick={()=>void remove()}>{busy?w('Deleting…','Eliminando…','删除中…'):w('Confirm permanent deletion','Confirmar eliminación permanente','确认永久删除')}</button></div></WorkspaceDialog>}</>;
}
