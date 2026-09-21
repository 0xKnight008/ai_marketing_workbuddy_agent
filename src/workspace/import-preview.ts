/** Strict local preview; the server independently validates the same submitted bytes. */
export function previewImport(content: string, source: 'paste' | 'csv'): string[] {
  if (new TextEncoder().encode(content).byteLength > 2 * 1024 * 1024) throw new Error('size');
  let items: string[];
  if (source === 'paste') items = content.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  else {
    const rows: string[][]=[]; let row:string[]=[]; let cell=''; let quoted=false; let closed=false;
    for(let i=0;i<content.length;i++){
      const ch=content[i];
      if(quoted){if(ch==='"'&&content[i+1]==='"'){cell+='"';i++;}else if(ch==='"'){quoted=false;closed=true;}else cell+=ch;continue;}
      if(ch==='"'){if(cell||closed)throw new Error('quotes');quoted=true;continue;}
      if(ch===','||ch==='\n'||ch==='\r'){row.push(cell);cell='';closed=false;if(ch!==','){if(ch==='\r'&&content[i+1]==='\n')i++;rows.push(row);row=[];}continue;}
      if(closed&&ch.trim())throw new Error('quotes');if(!closed)cell+=ch;
    }
    if(quoted)throw new Error('quotes');row.push(cell);rows.push(row);
    const headers=rows.shift()?.map(s=>s.replace(/^\uFEFF/,'').trim().toLowerCase())??[];
    const columns=['text','comment','review','title'].map(h=>headers.indexOf(h)).filter(i=>i>=0);
    if(!columns.length)throw new Error('headers');
    items=rows.filter(r=>r.some(s=>s.trim())).map(r=>columns.map(i=>r[i]?.trim()).find(Boolean)||'').filter(Boolean);
  }
  if(!items.length)throw new Error('empty');if(items.length>5000)throw new Error('count');if(items.some(s=>s.length>2000))throw new Error('length');return items;
}
