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
assert.equal(migrated.schemaVersion,4);
assert.equal(migrated.records[0].timeNature,'positive');
assert.equal(migrated.records[0].source,'日迹');
assert.ok(migrated.records[0].id);
assert.deepEqual(Object.keys(migrated.sceneTrees),[]);

data.save(migrated);
assert.equal(JSON.parse(localStorage.getItem('riji-state')).schemaVersion,4);
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

const currentTime=new Date(2026,7,17,18,42);
assert.equal(data.validateTimeWindow('2026-08-17','18:00','19:00',currentTime),'结束时间尚未到来');
assert.equal(data.validateTimeWindow('2026-08-17','21:00','21:30',currentTime),'开始时间尚未到来');
assert.equal(data.validateTimeWindow('2026-08-18','09:00','10:00',currentTime),'不能记录尚未到来的日期');
assert.equal(data.validateTimeWindow('2026-08-17','17:00','18:00',currentTime),null);
assert.equal(data.validateTimeWindow('2026-08-16','23:30','00:30',currentTime),null);

console.log('data-manager tests passed');
