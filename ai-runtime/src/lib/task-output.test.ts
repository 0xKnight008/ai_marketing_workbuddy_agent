import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTaskOutput} from './task-output';
const answer={action:'answer',query:'',markdown:'## Report\n\nEvidence preserved.',citations:[]};
test('accepts valid JSON and a single JSON fence without changing Markdown',()=>{
 for(const text of [JSON.stringify(answer),'```json\n'+JSON.stringify(answer)+'\n```'])assert.deepEqual(parseTaskOutput(text,'stop'),answer);
});
test('rejects non-JSON, empty, truncated and structurally invalid responses instead of saving false success',()=>{
 for(const [text,reason,code] of [['','stop','empty'],['Here is your report','stop','invalid_json'],['{"action":"answer"','length','truncated'],[JSON.stringify(answer),'content-filter','filtered'],[JSON.stringify({...answer,citations:null}),'stop','invalid_schema'],[JSON.stringify({...answer,markdown:''}),'stop','missing_content'],[JSON.stringify({...answer,action:'search',query:''}),'stop','missing_content'],[JSON.stringify(answer),'error','incomplete']])assert.throws(()=>parseTaskOutput(text!,reason),new RegExp('task_output_'+code));
});
