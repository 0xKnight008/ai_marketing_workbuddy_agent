type ReportFile = {id:string;template:string;report:Record<string,unknown>|null};
const label=(key:string)=>key.replace(/([a-z])([A-Z])/g,'$1 $2').replaceAll('_',' ');
function markdown(value:unknown,depth=2):string {
 if(value==null)return '—';
 if(Array.isArray(value))return value.map((entry,index)=>typeof entry==='object'&&entry!==null?`### ${index+1}\n\n${markdown(entry,depth+1)}`:`- ${String(entry)}`).join('\n\n');
 if(typeof value==='object')return Object.entries(value).filter(([key])=>!key.startsWith('_')).map(([key,entry])=>{
  if(key==='citations'&&Array.isArray(entry))return entry.map(c=>`> [${String(c.ref)}] ${String(c.snippet).replaceAll('\n','\n> ')}`).join('\n\n');
  return typeof entry==='object'&&entry!==null?`${'#'.repeat(Math.min(depth,6))} ${label(key)}\n\n${markdown(entry,depth+1)}`:`**${label(key)}:** ${String(entry??'—')}`;
 }).join('\n\n');
 return String(value);
}
export function reportMarkdown(report:ReportFile&{title:string}) {return `# ${report.title}\n\nreport_id: ${report.id}\ntemplate: ${report.template}\n\n${markdown(report.report)}\n`;}
export function reportEvidenceCsv(report:ReportFile) {
 const cell=(v:unknown)=>'"'+String(v??'').replace(/^\s*[=+\-@]/,"'$&").replaceAll('"','""')+'"';
 const rows:unknown[][]=[['report_id','finding_key','evidence_ref','validated_excerpt']];
 function visit(value:unknown,path:string){if(Array.isArray(value))return value.forEach((entry,i)=>visit(entry,`${path}/${i}`));if(!value||typeof value!=='object')return;for(const [key,entry] of Object.entries(value)){if(key==='citations'&&Array.isArray(entry)){for(const c of entry)if(c&&typeof c.ref==='string'&&typeof c.snippet==='string')rows.push([report.id,path,c.ref,c.snippet]);}else if(!key.startsWith('_'))visit(entry,`${path}/${key}`)}}
 visit(report.report,'report');return '\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n')+'\r\n';
}
export function downloadReport(filename:string,text:string,type='text/markdown;charset=utf-8'){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
