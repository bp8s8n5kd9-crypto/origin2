(function(){
  'use strict';
  const STORAGE_KEY='riji-state';
  const BACKUP_KEY='riji-backups';
  const SCHEMA_VERSION=7;
  const BACKUP_LIMIT=8;
  const AUTO_BACKUP_INTERVAL=30*60*1000;

  function clone(value){return JSON.parse(JSON.stringify(value))}
  function id(prefix){return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`}
  function normalizeRecord(record){
    return {
      id:record.id||id('record'),date:record.date||new Date().toISOString().slice(0,10),
      start:record.start||'00:00',end:record.end||record.start||'00:00',name:record.name||'未命名记录',
      category:record.category||'生活',timeNature:record.timeNature||(record.category==='睡眠'?'sleep':record.category==='娱乐'?'neutral':'positive'),
      tag:record.tag||'',recordMode:record.recordMode||(record.source?'external':'internal'),source:record.source||'日迹',
      region:record.region||'上海',sceneKey:record.sceneKey||null,path:record.path||'',sleepQuality:record.sleepQuality??null,sessionId:record.sessionId||null,createdAt:record.createdAt||new Date().toISOString(),updatedAt:record.updatedAt||null
    };
  }
  function normalizeTimer(timer){if(!timer)return null;const start=Number(timer.startedAt||timer.start||Date.now()),segments=Array.isArray(timer.segments)&&timer.segments.length?timer.segments:[{start,end:null}];return {...timer,start,startedAt:start,sessionId:timer.sessionId||`timer_${start}`,segments:segments.map(segment=>({start:Number(segment.start),end:segment.end?Number(segment.end):null})),paused:Boolean(timer.paused)}}
  function migrate(input){
    const data=clone(input||{}),from=Number(data.schemaVersion||1);
    data.schemaVersion=SCHEMA_VERSION;
    data.meta={createdAt:data.meta?.createdAt||new Date().toISOString(),updatedAt:data.meta?.updatedAt||new Date().toISOString(),migratedFrom:from<SCHEMA_VERSION?from:(data.meta?.migratedFrom||null)};
    data.region=data.region||'上海';data.currentScenes=data.currentScenes||{};data.records=(data.records||[]).map(normalizeRecord);
    data.sleeping=Boolean(data.sleeping);data.sleepStart=data.sleepStart||null;data.sleepStartedAt=data.sleepStartedAt||null;data.activeTimer=normalizeTimer(data.activeTimer);
    if(data.sleeping&&!data.sleepStartedAt&&data.sleepStart){const [hours,minutes]=data.sleepStart.split(':').map(Number),candidate=new Date();candidate.setHours(hours,minutes,0,0);if(candidate>Date.now())candidate.setDate(candidate.getDate()-1);data.sleepStartedAt=candidate.toISOString()}
    data.settings={timezone:'Asia/Shanghai',autoBackup:true,...data.settings};
    data.sceneMaps=data.sceneMaps||{};data.sceneTrees=data.sceneTrees||{};data.sceneTree=data.sceneTree||null;data.customScenes=data.customScenes||{};
    data.regions=data.regions||Object.keys(data.sceneMaps);data.archivedRegions=[...new Set(data.archivedRegions||[])];data.deletedRecordIds=[...new Set(data.deletedRecordIds||[])];data.sync={lastSyncedAt:null,revision:0,sceneRevision:0,sceneConflict:null,timerRevision:0,timerConflict:null,...data.sync};
    return data;
  }
  function validate(data){
    if(!data||typeof data!=='object')throw new Error('文件中没有有效数据');
    if(!Array.isArray(data.records))throw new Error('记录列表格式不正确');
    for(const record of data.records){if(!/^\d{4}-\d{2}-\d{2}$/.test(record.date||''))throw new Error(`记录日期无效：${record.name||'未命名'}`);if(!/^\d{2}:\d{2}$/.test(record.start||'')||!/^\d{2}:\d{2}$/.test(record.end||''))throw new Error(`记录时间无效：${record.name||'未命名'}`)}
    return true;
  }
  function localDate(date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`}
  function timeMinutes(value){const [hours,minutes]=value.split(':').map(Number);return hours*60+minutes}
  function localTime(date){return `${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`}
  function splitTimeWindow(startValue,endValue){
    const start=new Date(startValue),end=new Date(endValue);if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||end<=start)return[];
    const parts=[];let cursor=new Date(start);
    while(cursor<end){const nextDay=new Date(cursor);nextDay.setHours(24,0,0,0);const boundary=end<nextDay?end:nextDay;parts.push({date:localDate(cursor),start:localTime(cursor),end:boundary.getTime()===nextDay.getTime()?'24:00':localTime(boundary),durationMinutes:Math.max(1,Math.round((boundary-cursor)/60000))});cursor=new Date(boundary)}
    return parts;
  }
  function findRecordOverlaps(records){
    const byRegion=new Map();(records||[]).forEach(record=>{const day=new Date(`${record.date}T00:00:00`).getTime(),start=day+timeMinutes(record.start)*60000;let end=day+timeMinutes(record.end)*60000;if(end<=start)end+=24*60*60000;const region=record.region||'上海',items=byRegion.get(region)||[];items.push({record,start,end});byRegion.set(region,items)});
    const overlaps=[];byRegion.forEach((items,region)=>{items.sort((a,b)=>a.start-b.start||a.end-b.end);for(let i=0;i<items.length;i++){for(let j=i+1;j<items.length&&items[j].start<items[i].end;j++){const minutes=Math.round((Math.min(items[i].end,items[j].end)-items[j].start)/60000);if(minutes>0)overlaps.push({region,minutes,first:clone(items[i].record),second:clone(items[j].record)})}}});return overlaps;
  }
  function filterRecords(records,filters={}){
    const query=String(filters.query||'').trim().toLocaleLowerCase(),from=filters.from||'',to=filters.to||'',region=filters.region||'',nature=filters.nature||'';
    return (records||[]).filter(record=>{
      if(from&&record.date<from)return false;if(to&&record.date>to)return false;
      if(region&&region!=='all'&&(record.region||'上海')!==region)return false;
      const recordNature=record.timeNature||(record.category==='睡眠'?'sleep':record.category==='娱乐'?'neutral':'positive');if(nature&&nature!=='all'&&recordNature!==nature)return false;
      if(query&&!`${record.name||''} ${record.tag||''} ${record.path||''} ${record.source||''}`.toLocaleLowerCase().includes(query))return false;
      return true;
    }).sort((a,b)=>b.date.localeCompare(a.date)||b.start.localeCompare(a.start));
  }
  function validateTimeWindow(date,start,end,now=new Date()){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||!/^\d{2}:\d{2}$/.test(start||'')||!/^\d{2}:\d{2}$/.test(end||''))return'请填写完整有效的日期和时间';
    const today=localDate(now),startMinutes=timeMinutes(start),endMinutes=timeMinutes(end),nowMinutes=now.getHours()*60+now.getMinutes();
    if(date>today)return'不能记录尚未到来的日期';
    if(date===today&&endMinutes<=startMinutes)return'今天的记录不能跨越尚未到来的午夜';
    if(date===today&&startMinutes>nowMinutes)return'开始时间尚未到来';
    if(date===today&&endMinutes>nowMinutes)return'结束时间尚未到来';
    if(startMinutes===endMinutes)return'开始和结束时间不能相同';
    return null;
  }
  function backups(){try{return JSON.parse(localStorage.getItem(BACKUP_KEY)||'[]')}catch{return[]}}
  function writeBackups(items){localStorage.setItem(BACKUP_KEY,JSON.stringify(items.slice(0,BACKUP_LIMIT)))}
  function createBackup(data,reason='manual'){
    const item={id:id('backup'),createdAt:new Date().toISOString(),reason,schemaVersion:SCHEMA_VERSION,recordCount:(data.records||[]).length,data:clone(data)};
    writeBackups([item,...backups()]);localStorage.setItem('riji-last-backup',String(Date.now()));return item;
  }
  function load(fallback){
    let raw=null;try{raw=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null')}catch{}
    const data=migrate(raw||fallback);validate(data);return data;
  }
  function save(data){
    data.meta={...(data.meta||{}),updatedAt:new Date().toISOString()};
    const normalized=migrate(data);validate(normalized);
    const last=Number(localStorage.getItem('riji-last-backup')||0);
    if(normalized.settings.autoBackup&&Date.now()-last>AUTO_BACKUP_INTERVAL)createBackup(normalized,'auto');
    localStorage.setItem(STORAGE_KEY,JSON.stringify(normalized));Object.assign(data,normalized);return normalized;
  }
  function envelope(data){return {format:'riji-backup',schemaVersion:SCHEMA_VERSION,exportedAt:new Date().toISOString(),app:'日迹',data:migrate(data)}}
  function parseImport(text){const parsed=JSON.parse(text),payload=parsed.format==='riji-backup'?parsed.data:parsed;const data=migrate(payload);validate(data);return data}
  function restore(idValue){const item=backups().find(entry=>entry.id===idValue);if(!item)throw new Error('找不到该备份');const data=migrate(item.data);validate(data);localStorage.setItem(STORAGE_KEY,JSON.stringify(data));return data}
  function copySceneBranch(sourceMap,sourceTree,sourceKey,targetMap,targetTree,targetParent,keySeed=`copy_${Date.now().toString(36)}`){
    if(!sourceMap?.[sourceKey]||!sourceTree?.[sourceKey])throw new Error('找不到要复制的场景');
    if(!targetMap?.[targetParent]||!targetTree?.[targetParent])throw new Error('找不到目标父场景');
    const keys=[];function collect(key){keys.push(key);(sourceTree[key]?.children||[]).forEach(collect)}collect(sourceKey);
    const occupied=new Set(Object.keys(targetMap)),keyMap={};keys.forEach((key,index)=>{let candidate=`scene_${keySeed}_${index}`;while(occupied.has(candidate))candidate=`${candidate}_copy`;occupied.add(candidate);keyMap[key]=candidate});
    keys.forEach(key=>{const cloned=clone(sourceMap[key]);cloned.options=(cloned.options||[]).filter(option=>option.kind!=='navigate'||keyMap[option.target]).map(option=>option.kind==='navigate'?{...option,target:keyMap[option.target]}:option);targetMap[keyMap[key]]=cloned;targetTree[keyMap[key]]={parent:key===sourceKey?targetParent:keyMap[sourceTree[key].parent],children:(sourceTree[key].children||[]).map(child=>keyMap[child])}});
    targetMap[keyMap[sourceKey]].title=`${targetMap[keyMap[sourceKey]].title} 副本`;targetTree[targetParent].children.push(keyMap[sourceKey]);
    return {rootKey:keyMap[sourceKey],keyMap};
  }
  const SCENE_FIELDS=['sceneMaps','sceneTrees','sceneTree','regions','archivedRegions','customScenes'];
  function sceneConfig(data){return Object.fromEntries(SCENE_FIELDS.map(field=>[field,clone(data[field])]))}
  function sameSceneConfig(left,right){return JSON.stringify(sceneConfig(left))===JSON.stringify(sceneConfig(right))}
  function merge(localInput,remoteInput){
    const local=migrate(localInput),remote=migrate(remoteInput),deleted=[...new Set([...local.deletedRecordIds,...remote.deletedRecordIds])],deletedSet=new Set(deleted),records=new Map();
    [...local.records,...remote.records].forEach(record=>{if(deletedSet.has(record.id))return;const previous=records.get(record.id),stamp=value=>Date.parse(value.updatedAt||value.createdAt||0)||0;if(!previous||stamp(record)>=stamp(previous))records.set(record.id,record)});
    const localStamp=Date.parse(local.meta.updatedAt||0)||0,remoteStamp=Date.parse(remote.meta.updatedAt||0)||0,newer=remoteStamp>localStamp?remote:local,older=newer===local?remote:local,merged=clone(newer);
    const localSceneRevision=local.sync.sceneRevision||0,remoteSceneRevision=remote.sync.sceneRevision||0,scenesDiffer=!sameSceneConfig(local,remote);
    let sceneSource=local,sceneConflict=null;
    if(remoteSceneRevision>localSceneRevision){sceneSource=remote;sceneConflict=remote.sync.sceneConflict||null}
    else if(localSceneRevision>remoteSceneRevision)sceneConflict=local.sync.sceneConflict||null;
    else if(scenesDiffer){sceneConflict=local.sync.sceneConflict||remote.sync.sceneConflict||{detectedAt:new Date().toISOString(),localRevision:localSceneRevision,remoteRevision:remoteSceneRevision,remoteConfig:sceneConfig(remote)}}
    else sceneConflict=local.sync.sceneConflict||remote.sync.sceneConflict||null;
    SCENE_FIELDS.forEach(field=>{merged[field]=clone(sceneSource[field])});
    const localTimerRevision=local.sync.timerRevision||0,remoteTimerRevision=remote.sync.timerRevision||0,timersDiffer=JSON.stringify(local.activeTimer)!==JSON.stringify(remote.activeTimer);
    let timerSource=local,timerConflict=null;
    if(remoteTimerRevision>localTimerRevision){timerSource=remote;timerConflict=remote.sync.timerConflict||null}
    else if(localTimerRevision>remoteTimerRevision)timerConflict=local.sync.timerConflict||null;
    else if(timersDiffer){timerConflict=local.sync.timerConflict||remote.sync.timerConflict||{detectedAt:new Date().toISOString(),localRevision:localTimerRevision,remoteRevision:remoteTimerRevision,remoteTimer:clone(remote.activeTimer)}}
    else timerConflict=local.sync.timerConflict||remote.sync.timerConflict||null;
    merged.activeTimer=clone(timerSource.activeTimer);merged.records=[...records.values()];merged.deletedRecordIds=deleted;merged.meta={createdAt:[local.meta.createdAt,remote.meta.createdAt].sort()[0],updatedAt:new Date(Math.max(localStamp,remoteStamp)).toISOString(),migratedFrom:Math.min(local.meta.migratedFrom||SCHEMA_VERSION,remote.meta.migratedFrom||SCHEMA_VERSION)};merged.sync={...older.sync,...newer.sync,revision:Math.max(local.sync.revision||0,remote.sync.revision||0)+1,sceneRevision:Math.max(localSceneRevision,remoteSceneRevision),sceneConflict,timerRevision:Math.max(localTimerRevision,remoteTimerRevision),timerConflict,lastSyncedAt:new Date().toISOString()};validate(merged);return merged;
  }
  window.RijiData={SCHEMA_VERSION,STORAGE_KEY,load,save,validate,validateTimeWindow,splitTimeWindow,findRecordOverlaps,filterRecords,copySceneBranch,envelope,parseImport,createBackup,backups,restore,merge,clone};
})();
