const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const storage = new Map();
const localStorage = {
  getItem: key => storage.has(key) ? storage.get(key) : null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key),
};
const context = {window:{},localStorage,console,setTimeout,Date,JSON,Math};
vm.createContext(context);
vm.runInContext(fs.readFileSync('data-manager.js','utf8'),context);
const data = context.window.RijiData;

const migrated = data.load({region:'上海',records:[{date:'2026-08-15',start:'09:00',end:'10:00',name:'阅读',category:'学习'}]});
assert.equal(migrated.schemaVersion,7);
assert.deepEqual([...migrated.archivedRegions],[]);
assert.equal(migrated.records[0].timeNature,'positive');
assert.equal(migrated.records[0].source,'日迹');
assert.ok(migrated.records[0].id);
assert.deepEqual(Object.keys(migrated.sceneTrees),[]);
const migratedTimer=data.load({...migrated,activeTimer:{name:'旧计时',start:1234}}).activeTimer;
assert.equal(migratedTimer.sessionId,'timer_1234');
assert.deepEqual(JSON.parse(JSON.stringify(migratedTimer.segments)),[{start:1234,end:null}]);

data.save(migrated);
assert.equal(JSON.parse(localStorage.getItem('riji-state')).schemaVersion,7);
assert.equal(data.backups().length,1);

const exported = data.envelope(migrated);
const imported = data.parseImport(JSON.stringify(exported));
assert.equal(imported.records.length,1);
assert.equal(imported.records[0].name,'阅读');

const manual = data.createBackup(imported,'manual');
assert.equal(data.restore(manual.id).records[0].name,'阅读');
assert.throws(()=>data.parseImport('{"records":[{"date":"bad"}]}'),/日期无效/);

const local={...imported,records:[{...imported.records[0],id:'shared',name:'旧名称',updatedAt:'2026-08-15T10:00:00.000Z'}],deletedRecordIds:[],regions:['上海'],meta:{...imported.meta,updatedAt:'2026-08-15T10:00:00.000Z'}};
const remote={...imported,records:[{...imported.records[0],id:'shared',name:'新名称',updatedAt:'2026-08-15T11:00:00.000Z'},{...imported.records[0],id:'remote-only'}],deletedRecordIds:['remote-only'],regions:['杭州'],meta:{...imported.meta,updatedAt:'2026-08-15T11:00:00.000Z'}};
const merged=data.merge(local,remote);
assert.equal(merged.records.length,1);
assert.equal(merged.records[0].name,'新名称');
assert.deepEqual([...merged.regions],['上海']);
assert.ok(merged.sync.sceneConflict, 'competing region structures should require an explicit choice');
assert.ok(merged.deletedRecordIds.includes('remote-only'));
assert.equal(merged.sync.revision,1);

const sceneBase={...imported,sceneMaps:{上海:{home:{title:'家'}}},sceneTrees:{上海:{home:{parent:null,children:[]}}},regions:['上海']};
const localScenes={...sceneBase,sceneMaps:{上海:{home:{title:'本机的家'}}},sync:{sceneRevision:2},meta:{...sceneBase.meta,updatedAt:'2026-08-15T12:00:00.000Z'}};
const olderRemoteScenes={...sceneBase,sceneMaps:{上海:{home:{title:'云端旧家'}}},sync:{sceneRevision:1},meta:{...sceneBase.meta,updatedAt:'2026-08-15T13:00:00.000Z'}};
assert.equal(data.merge(localScenes,olderRemoteScenes).sceneMaps.上海.home.title,'本机的家');
const newerRemoteScenes={...olderRemoteScenes,sync:{sceneRevision:3}};
assert.equal(data.merge(localScenes,newerRemoteScenes).sceneMaps.上海.home.title,'云端旧家');
const competingRemoteScenes={...olderRemoteScenes,sync:{sceneRevision:2}};
const conflicted=data.merge(localScenes,competingRemoteScenes);
assert.equal(conflicted.sceneMaps.上海.home.title,'本机的家');
assert.equal(conflicted.sync.sceneConflict.remoteConfig.sceneMaps.上海.home.title,'云端旧家');
const resolved={...conflicted,sync:{...conflicted.sync,sceneRevision:3,sceneConflict:null}};
assert.equal(data.merge(resolved,conflicted).sync.sceneConflict,null);

const timerA={name:'游戏',start:1000,sessionId:'timer_a',segments:[{start:1000,end:null}]};
const timerB={name:'休息',start:2000,sessionId:'timer_b',segments:[{start:2000,end:null}]};
const localTimerState={...sceneBase,activeTimer:timerA,sync:{timerRevision:2},meta:{...sceneBase.meta,updatedAt:'2026-08-15T12:00:00.000Z'}};
const remoteTimerState={...sceneBase,activeTimer:timerB,sync:{timerRevision:2},meta:{...sceneBase.meta,updatedAt:'2026-08-15T13:00:00.000Z'}};
const timerConflict=data.merge(localTimerState,remoteTimerState);
assert.equal(timerConflict.activeTimer.sessionId,'timer_a');
assert.equal(timerConflict.sync.timerConflict.remoteTimer.sessionId,'timer_b');
const newerRemoteTimer={...remoteTimerState,sync:{timerRevision:3}};
assert.equal(data.merge(localTimerState,newerRemoteTimer).activeTimer.sessionId,'timer_b');
const resolvedTimer={...timerConflict,sync:{...timerConflict.sync,timerRevision:3,timerConflict:null}};
assert.equal(data.merge(resolvedTimer,timerConflict).sync.timerConflict,null);
const endedTimer={...localTimerState,activeTimer:null,sync:{timerRevision:4}};
assert.equal(data.merge(endedTimer,newerRemoteTimer).activeTimer,null);
const equalEndedTimer={...localTimerState,activeTimer:null,sync:{timerRevision:2}};
assert.ok(data.merge(equalEndedTimer,remoteTimerState).sync.timerConflict);

const currentTime=new Date(2026,7,17,18,42);
assert.equal(data.validateTimeWindow('2026-08-17','18:00','19:00',currentTime),'结束时间尚未到来');
assert.equal(data.validateTimeWindow('2026-08-17','21:00','21:30',currentTime),'开始时间尚未到来');
assert.equal(data.validateTimeWindow('2026-08-18','09:00','10:00',currentTime),'不能记录尚未到来的日期');
assert.equal(data.validateTimeWindow('2026-08-17','17:00','18:00',currentTime),null);
assert.equal(data.validateTimeWindow('2026-08-16','23:30','00:30',currentTime),null);

const overnight=data.splitTimeWindow(new Date(2026,7,16,23,30),new Date(2026,7,17,1,0));
assert.deepEqual(JSON.parse(JSON.stringify(overnight)),[
  {date:'2026-08-16',start:'23:30',end:'24:00',durationMinutes:30},
  {date:'2026-08-17',start:'00:00',end:'01:00',durationMinutes:60}
]);
assert.deepEqual(JSON.parse(JSON.stringify(data.splitTimeWindow(currentTime,currentTime))),[]);

const overlaps=data.findRecordOverlaps([
  {id:'a',date:'2026-08-17',start:'18:00',end:'19:00',region:'上海',name:'阅读'},
  {id:'b',date:'2026-08-17',start:'18:40',end:'19:20',region:'上海',name:'游戏'},
  {id:'c',date:'2026-08-17',start:'18:30',end:'19:00',region:'杭州',name:'散步'},
  {id:'d',date:'2026-08-17',start:'23:30',end:'00:30',region:'上海',name:'夜间活动'},
  {id:'e',date:'2026-08-18',start:'00:15',end:'00:45',region:'上海',name:'继续活动'}
]);
assert.equal(overlaps.length,2);
assert.equal(overlaps[0].minutes,20);
assert.deepEqual([overlaps[1].first.id,overlaps[1].second.id],['d','e']);

const sourceMap={a:{title:'卧室',options:[{name:'内部',kind:'navigate',target:'b'},{name:'外部',kind:'navigate',target:'outside'}]},b:{title:'书桌',options:[{name:'阅读',kind:'学习'}]},outside:{title:'客厅',options:[]}};
const sourceTree={a:{parent:null,children:['b']},b:{parent:'a',children:[]},outside:{parent:null,children:[]}};
const targetMap={region:{title:'杭州',options:[]},home:{title:'家',options:[]}};
const targetTree={region:{parent:null,children:['home']},home:{parent:'region',children:[]}};
const copied=data.copySceneBranch(sourceMap,sourceTree,'a',targetMap,targetTree,'home','test');
assert.equal(targetMap[copied.rootKey].title,'卧室 副本');
assert.equal(targetTree[copied.rootKey].parent,'home');
assert.equal(targetTree[copied.rootKey].children.length,1);
assert.equal(targetMap[copied.rootKey].options.length,1);
assert.equal(targetMap[copied.rootKey].options[0].target,targetTree[copied.rootKey].children[0]);

const filtered=data.filterRecords([
  {id:'1',date:'2026-08-10',start:'09:00',name:'概率论',tag:'学习',region:'上海',timeNature:'positive'},
  {id:'2',date:'2026-08-12',start:'22:00',name:'游戏',tag:'放松',region:'杭州',timeNature:'neutral'},
  {id:'3',date:'2026-08-11',start:'08:00',name:'阅读',source:'外部软件',region:'上海',timeNature:'positive'}
],{from:'2026-08-10',to:'2026-08-11',region:'上海',nature:'positive',query:'外部'});
assert.deepEqual(filtered.map(record=>record.id),['3']);

assert.equal(data.coveredMinutes([
  {date:'2026-08-17',start:'09:00',end:'10:00'},
  {date:'2026-08-17',start:'09:30',end:'10:30'},
  {date:'2026-08-17',start:'11:00',end:'11:15'},
  {date:'2026-08-18',start:'09:00',end:'09:30'}
]),135);

console.log('data-manager tests passed');
