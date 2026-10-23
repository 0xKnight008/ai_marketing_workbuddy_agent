import {parseArgs} from 'node:util';
import {z} from 'zod';
import {Database} from '../foundation/database';
import {repairFailedWorkflowRefund} from './repair-ai-refund';
async function main(){
 const {values}=parseArgs({options:{workspace:{type:'string'},run:{type:'string'},'purchased-credits':{type:'string'},reason:{type:'string'},apply:{type:'boolean',default:false}},strict:true});
 const workspace=z.string().uuid().parse(values.workspace),run=z.string().uuid().parse(values.run);
 if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required');
 const db=new Database(process.env.DATABASE_URL);
 try{console.log(JSON.stringify(await db.withWorkspace(workspace,tx=>repairFailedWorkflowRefund(tx,run,values['purchased-credits']===undefined?undefined:Number(values['purchased-credits']),values.reason??'',values.apply)),null,2));}finally{await db.close();}
}
void main().catch(error=>{console.error(error instanceof Error?error.message:'Refund repair failed');process.exitCode=1});
