import test from 'node:test';
import assert from 'node:assert/strict';
import { POST_PLATFORMS, readRecentPosts } from './posts';
import { supportedReadPlatform, type FeedbackAccount } from './reader';
const account:FeedbackAccount={id:'local',externalId:'remote',profileId:'profile',platform:'tiktok',displayName:'Dora',status:'connected'};
test('documented ten platforms read at most 25 posts through the account-scoped endpoint',async()=>{
  for(const platform of POST_PLATFORMS){
    const posts=await readRecentPosts({readInboxPage:async(path,workspace)=>{
      assert.equal(path,'/v1/accounts/remote/posts');assert.equal(workspace,'tenant');
      return {status:'success',posts:[{id:'native',platform,message:'Text',permalink:'https://example.com/post',createdTime:'2026-11-01T00:00:00Z'}]};
    }},'tenant',{...account,platform});
    assert.equal(posts[0]?.text,'Text');assert.equal(posts[0]?.publishedAt,'2026-11-01T00:00:00.000Z');
    assert.equal(supportedReadPlatform(platform),platform!=='pinterest');
  }
});
test('unsafe links, malformed pages, foreign accounts and unsupported platforms fail safely',async()=>{
  for(const page of [{},{posts:[{}]},{posts:Array(26).fill({id:'p'})},{posts:[{id:'p',accountId:'foreign'}]},{posts:[{id:'p',platform:'twitter'}]}])await assert.rejects(readRecentPosts({readInboxPage:async()=>page},'w',account),/feedback_/);
  for(const permalink of ['javascript:alert(1)','http://example.com','https://secret:key@example.com']){
    const posts=await readRecentPosts({readInboxPage:async()=>({posts:[{id:'p',permalink}]})},'w',account);assert.equal(posts[0]?.url,null);
  }
  const pins=await readRecentPosts({readInboxPage:async()=>({posts:[{id:'p',title:'Pin title',description:'Pin description'}]})},'w',{...account,platform:'pinterest'});assert.equal(pins[0]?.text,'Pin title\nPin description');
  await assert.rejects(readRecentPosts({readInboxPage:async()=>{throw new Error('must not call')}},'w',{...account,platform:'telegram'}),/feedback_posts_unavailable/);
});
