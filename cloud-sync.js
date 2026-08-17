(function(){
  'use strict';
  const SUPABASE_URL='https://uzstnvnwtvrazcwzhprv.supabase.co';
  const SUPABASE_KEY='sb_publishable_H47zIMu2MQHHfbcuDt1mAg_VIwC8nM9';
  const APP_URL='https://bp8s8n5kd9-crypto.github.io/origin2/';
  const SESSION_KEY='riji-cloud-session';
  let syncTimer=null,syncing=false;

  function emit(status,message){window.dispatchEvent(new CustomEvent('riji-cloud-status',{detail:{status,message}}))}
  function readSession(){try{return JSON.parse(localStorage.getItem(SESSION_KEY)||'null')}catch{return null}}
  function writeSession(session){if(session)localStorage.setItem(SESSION_KEY,JSON.stringify(session));else localStorage.removeItem(SESSION_KEY)}
  function session(){return readSession()}
  function comparable(value){const copy=RijiData.clone(value);delete copy.sync;if(copy.meta)delete copy.meta.updatedAt;return JSON.stringify(copy)}
  function headers(token,extra={}){return {apikey:SUPABASE_KEY,...(token?{Authorization:`Bearer ${token}`}:{}) ,...extra}}
  async function request(path,options={}){
    const response=await fetch(`${SUPABASE_URL}${path}`,options),text=await response.text();let body=null;try{body=text?JSON.parse(text):null}catch{body=text}
    if(!response.ok){const message=body?.msg||body?.message||body?.error_description||`云端请求失败（${response.status}）`;const error=new Error(message);error.status=response.status;error.code=body?.code||'';throw error}
    return body;
  }
  async function authenticate(email,password,mode){
    const path=mode==='signup'?`/auth/v1/signup?redirect_to=${encodeURIComponent(APP_URL)}`:'/auth/v1/token?grant_type=password';
    const result=await request(path,{method:'POST',headers:headers(null,{'Content-Type':'application/json'}),body:JSON.stringify({email,password})});
    const authSession=result.session||result;
    if(authSession?.access_token){writeSession({access_token:authSession.access_token,refresh_token:authSession.refresh_token,expires_at:authSession.expires_at||Math.floor(Date.now()/1000)+(authSession.expires_in||3600),user:authSession.user||result.user});emit('ready','云同步已连接')}
    return {session:session(),needsConfirmation:!authSession?.access_token};
  }
  async function refresh(){
    const current=session();if(!current)return null;if((current.expires_at||0)*1000>Date.now()+60000)return current;
    const result=await request('/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:headers(null,{'Content-Type':'application/json'}),body:JSON.stringify({refresh_token:current.refresh_token})});
    const next={access_token:result.access_token,refresh_token:result.refresh_token,expires_at:result.expires_at||Math.floor(Date.now()/1000)+(result.expires_in||3600),user:result.user||current.user};writeSession(next);return next;
  }
  async function sync(localData){
    if(syncing)return {skipped:true};const auth=await refresh();if(!auth)return {signedOut:true};syncing=true;emit('syncing','正在同步');
    try{
      const rows=await request(`/rest/v1/riji_snapshots?user_id=eq.${encodeURIComponent(auth.user.id)}&select=payload,revision,updated_at`,{headers:headers(auth.access_token)}),remote=rows?.[0],merged=remote?RijiData.merge(localData,remote.payload):RijiData.clone(localData),changed=Boolean(remote)&&(comparable(localData)!==comparable(merged)||JSON.stringify(localData.sync?.sceneConflict||null)!==JSON.stringify(merged.sync?.sceneConflict||null)||JSON.stringify(localData.sync?.timerConflict||null)!==JSON.stringify(merged.sync?.timerConflict||null));
      merged.sync={...(merged.sync||{}),revision:Math.max(merged.sync?.revision||0,remote?.revision||0)+1,lastSyncedAt:new Date().toISOString()};
      if(changed)RijiData.createBackup(localData,'before-cloud-merge');
      const normalized=RijiData.save(merged);
      await request('/rest/v1/riji_snapshots?on_conflict=user_id',{method:'POST',headers:headers(auth.access_token,{'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'}),body:JSON.stringify({user_id:auth.user.id,payload:normalized,revision:normalized.sync.revision,updated_at:normalized.sync.lastSyncedAt})});
      emit('ready','已同步');return {changed,data:normalized};
    }catch(error){emit(navigator.onLine?'error':'offline',navigator.onLine?'同步失败':'等待联网');if(error.status===401){writeSession(null);emit('signed-out','登录已失效')}throw error}finally{syncing=false}
  }
  function schedule(provider,onRemoteChange){clearTimeout(syncTimer);if(!session())return;syncTimer=setTimeout(async()=>{try{const result=await sync(provider());if(result.changed)onRemoteChange?.(result.data)}catch{}},1800)}
  function signOut(){writeSession(null);emit('signed-out','仅保存在此设备')}
  window.RijiCloud={authenticate,sync,schedule,signOut,session};
})();
