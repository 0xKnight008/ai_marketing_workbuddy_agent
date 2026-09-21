import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewImport } from '../src/workspace/import-preview';
test('CSV preview preserves quoted source evidence, BOM and supported column aliases', () => {
 assert.deepEqual(previewImport('\uFEFFauthor,review\r\nMarco,"a,b\nsecond line"','csv'),['a,b\nsecond line']);
 assert.deepEqual(previewImport('text\n"escaped ""quote"""','csv'),['escaped "quote"']);
 assert.deepEqual(previewImport(' One\n\n Two\r\n','paste'),['One','Two']);
});
test('malformed or oversized imports are rejected before any API action', () => {
 for(const [content,source,error] of [['text\n"open','csv','quotes'],['other\ntext','csv','headers'],['text\n','csv','empty'],['x'.repeat(2001),'paste','length'],[Array(5001).fill('item').join('\n'),'paste','count'],['x'.repeat(2*1024*1024+1),'csv','size']] as const)assert.throws(()=>previewImport(content,source),new RegExp(error));
});
