// Run with: node --test tests/maintenance-checklists.test.cjs
const test=require('node:test');
const assert=require('node:assert/strict');
const helper=require('../src/GarageLog.Web/wwwroot/maintenance-checklists.js');
const {recordCompletion,completionHistory}=require('../src/GarageLog.Web/wwwroot/maintenance-cycles.js');
const {classify}=require('../src/GarageLog.Web/wwwroot/maintenance-filters.js');
const day=new Date(2026,10,1);
function sample(completed=0,total=5,more={}){
 return {id:'s1',vehicleId:'v1',name:'Emergency kit',interval:'6 months',due:'2027-05-01',status:'Upcoming',checklist:Array.from({length:total},(_,i)=>({id:`c${i}`,label:`Task ${i}`,completed:i<completed})),...more};
}
test('untouched checklist on track has no warning or fill',()=>{
 const view=helper.presentation(sample(),'scheduled',day);
 assert.deepEqual([view.percent,view.warning,view.complete,view.tone],[0,false,false,'gauge-progress']);
});
test('untouched checklist near due shows red exclamation (no fabricated progress)',()=>{
 const view=helper.presentation(sample(),'upcoming',day);
 assert.equal(view.percent,0);assert.equal(view.warning,true);assert.equal(view.label,'Approaching due');
});
test('partially completed checklist stays blue but alerts near due',()=>{
 const view=helper.presentation(sample(3,7),'due',day);
 assert.equal(view.percent,43);assert.equal(view.tone,'gauge-progress');assert.equal(view.warning,true);
});
test('due today shows an explicit warning',()=>{
 const view=helper.presentation(sample(0,5,{due:'2026-11-01'}),'due',day);
 assert.equal(view.label,'Due today');assert.equal(view.warning,true);
});
test('overdue partial checklist progress is red',()=>{
 const view=helper.presentation(sample(1),'overdue',day);
 assert.equal(view.tone,'gauge-danger');assert.equal(view.warning,true);assert.equal(view.percent,20);
});
test('overdue untouched checklist displays red warning with zero progress',()=>{
 const view=helper.presentation(sample(),'overdue',day);
 assert.equal(view.percent,0);assert.equal(view.tone,'gauge-danger');assert.equal(view.label,'Overdue');
});
test('fully checked checklist shows Completed even on a one-time completed schedule',()=>{
 const view=helper.presentation(sample(5,5,{status:'Completed'}),'completed',day);
 assert.equal(view.complete,true);assert.equal(view.warning,false);
});
test('prior-cycle Completed badge is locked until Upcoming; then resets visually',()=>{
 const after=sample(0,5,{checklistCyclePending:true});
 assert.equal(helper.presentation(after,'scheduled',day).complete,true);
 assert.equal(helper.presentation(after,'scheduled',day).locked,true);
 assert.equal(helper.presentation(after,'upcoming',day).complete,false);
 assert.equal(helper.presentation(after,'upcoming',day).locked,false);
 assert.equal(helper.presentation(after,'upcoming',day).warning,true);
});
test('last checked step is recognized exactly once, edits do not mutate originals',()=>{
 const before=sample(4);const updated=helper.progressUpdated(before,[true,true,true,true,true],'2026-11-01T12:00:00Z');
 assert.equal(helper.finalStepJustChecked(before,updated),true);
 assert.equal(helper.finalStepJustChecked(updated,updated),false);
 assert.equal(before.checklist[4].completed,false);
 assert.equal(updated.checklist[4].completed,true);
});
test('completing a time-based checklist preserves snapshot, advances due, resets tasks, and links reminder',()=>{
 const before=helper.progressUpdated(sample(4,5,{due:'2026-11-01'}),[true,true,true,true,true],'2026-11-01T12:00:00Z');
 const reminder={id:'r1',maintenanceId:'s1',rule:'Every 6 months',due:'2026-11-01',checklist:before.checklist.map(x=>({...x})),status:'Upcoming'};
 const result=recordCompletion(before,reminder,{date:'2026-11-01',id:'cycle1'});
 assert.equal(result.item.due,'2027-05-01');
 assert.equal(result.reminder.due,'2027-05-01');
 assert.equal(result.item.checklist.every(x=>!x.completed),true);
 assert.equal(result.reminder.checklist.every(x=>!x.completed),true);
 assert.equal(result.item.checklistCyclePending,true);
 assert.equal(result.item.completions[0].checklist.filter(x=>x.completed).length,5);
 assert.equal(result.item.completions[0].previousDue,'2026-11-01');
 assert.equal(classify({status:'Upcoming',dueDate:result.item.due,isChecklist:true,hasProgress:true,percent:0,now:day.getTime()}),'scheduled');
 assert.equal(helper.presentation(result.item,'scheduled',day).complete,true);
});
test('corrections retain the completed checklist snapshot and avoid duplicate history',()=>{
 const before=sample(5,5,{due:'2026-11-01'});
 const first=recordCompletion(before,null,{date:'2026-11-01',id:'first'});
 const corrected=recordCompletion(first.item,null,{date:'2026-10-31',correction:true});
 assert.equal(completionHistory(corrected.item).length,1);
 assert.equal(corrected.item.completions[0].checklist.filter(x=>x.completed).length,5);
 assert.equal(corrected.item.due,'2027-04-30');
});
test('completions clear active follow-up but preserve postponement log',()=>{
 const before=sample(5,5,{due:'2026-11-01',postponedUntil:'2026-11-02',postponeReason:'Awaiting supplies',postponements:[{date:'2026-11-02',originalDue:'2026-11-01'}]});
 const result=recordCompletion(before,null,{date:'2026-11-01'});
 assert.equal(result.item.postponedUntil,null);assert.equal(result.item.postponeReason,null);
 assert.equal(result.item.postponements.length,1);
});

test('fuel gauge changes to yellow below half life, red at 20%, without changing due-soon bucket',()=>{
 const {serviceGaugeTone,classify}=require('../src/GarageLog.Web/wwwroot/maintenance-filters.js');
 assert.equal(serviceGaugeTone(98.7),'gauge-healthy');
 assert.equal(serviceGaugeTone(39.8),'gauge-warning');
 assert.equal(serviceGaugeTone(20),'gauge-danger');
 assert.equal(serviceGaugeTone(0),'gauge-danger');
 assert.equal(classify({status:'Upcoming',hasProgress:true,percent:39.8,mileage:{percent:39.8,beforeStart:false}}),'upcoming');
});
