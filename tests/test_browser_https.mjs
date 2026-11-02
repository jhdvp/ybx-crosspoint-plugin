import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync('ybx.crosspoint-plugin/plugin.js','utf8');
const start=source.indexOf('  const relay = async (path, auth) => {');
const end=source.indexOf('  const number =',start);
assert.ok(start>0 && end>start);
const code=source.slice(start,end)+'\nglobalThis.getProfile = relay;';

function browser({status=200, data={hello:'ybx'}, error=null}={}) {
 const calls=[];
 const context=vm.createContext({
  API:'https://my.ybx.app',JSON,Error,
  fetch:async(url,options)=>{
   calls.push({kind:'browser',url,options});
   if(error) throw error;
   return {ok:status>=200&&status<300,status,
    json:async()=>status>=200&&status<300?data:{detail:'not allowed'}};
  },
  api:{relay:async()=>{calls.push({kind:'deviceRelay'});throw Error('must not use device TLS');}},
 });
 vm.runInContext(code,context);
 return {calls,run:(path='/api/v1/crosspoint/reading/summary?limit=10')=>context.getProfile(path,'cp_secret_fixture')};
}

test('phone/browser HTTPS retrieves summary without ESP32 TLS or staging files',async()=>{
 const {calls,run}=browser();
 const res=await run();
 assert.deepEqual(JSON.parse(JSON.stringify(res)),{hello:'ybx'});
 assert.equal(calls.length,1);
 assert.equal(calls[0].url,'https://my.ybx.app/api/v1/crosspoint/reading/summary?limit=10');
 assert.equal(calls[0].options.headers.Authorization,'Bearer cp_secret_fixture');
 assert.equal(calls[0].options.credentials,'omit');
 assert.equal(calls[0].options.mode,'cors');
});
test('calendar, achievements, book details stay direct HTTPS',async()=>{
 for(const path of ['/api/v1/crosspoint/reading/calendar?month=2026-11',
    '/api/v1/crosspoint/achievements?limit=20',
    '/api/v1/crosspoint/reading/books/123']) {
  const h=browser();
  await h.run(path);
  assert.equal(h.calls.length,1);
  assert.equal(h.calls[0].kind,'browser');
 }
});
test('authorization failure propagates as 401, never falls back to device',async()=>{
 const h=browser({status:401});
 await assert.rejects(h.run(),e=>e.status===401);
 assert.equal(h.calls.length,1);
});
test('CORS/network rejection is actionable and never leaks bearer to device',async()=>{
 const h=browser({error:Error('Failed to fetch')});
 await assert.rejects(h.run(),e=>e.network===true && /HTTPS/.test(e.message));
 assert.equal(h.calls.length,1);
});
test('unrelated device requests retain normal relay behavior',async()=>{
 const context=vm.createContext({
  API:'https://my.ybx.app',JSON,Error,
  fetch:async()=>{throw Error('wrong')},
  api:{relay:async()=>({status:200,body:'{"other":true}'})},
 });
 vm.runInContext(code,context);
 const res=await context.getProfile('/api/v1/crosspoint/ping','cp_secret_fixture');
 assert.equal(res.other,true);
});
