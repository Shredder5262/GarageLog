// Run with: node tests/maintenance-cycles.test.cjs
const assert=require('node:assert/strict');
const {
 interval,advanceDate,recordCompletion,migrateLegacy,completionHistory
}=require('../src/GarageLog.Web/wwwroot/maintenance-cycles.js');
let successes=0;
function test(title,fn){try{fn();successes++;console.log(`PASS  ${title}`)}catch(error){console.error(`FAIL  ${title}`);throw error}}
const item=(name,interval,due,extra={})=>({id:'m1',vehicleId:'vehicle-A',name,interval,due,status:'Upcoming',...extra});
const reminder=(maintenance,extra={})=>({id:'r1',maintenanceId:'m1',rule:`Every ${maintenance}`,status:'Upcoming',due:'122,896 mi',triggerType:'mileage',...extra});
test('oil service at 122896 rolls forward by 7500 miles, not current odometer',()=>{
 const source=item('Oil & Filter Change','7,500 mi','122,896 mi',{serviceMileage:115396,repeatMiles:7500});
 const linked=reminder('7500 miles',{serviceMileage:115396,repeatMiles:7500});
 const result=recordCompletion(source,linked,{date:'2026-09-30',mileage:122896,id:'oil-1'});
 assert.equal(result.item.due,'130,396 mi');assert.equal(result.reminder.due,'130,396 mi');
 assert.equal(result.item.serviceMileage,122896);assert.equal(result.reminder.serviceMileage,122896);
 assert.equal(result.item.status,'Upcoming');assert.equal(result.reminder.status,'Upcoming');
 assert.equal(result.item.progress,0);assert.equal(source.due,'122,896 mi');
 assert.equal(result.item.completions[0].mileage,122896);
});
test('tire rotation repeats at 130396 miles',()=>{
 const outcome=recordCompletion(item('Tire Rotation','7,500 mi','122,896 mi'),null,{date:'2026-09-30',mileage:122896,id:'tire-1'});
 assert.equal(outcome.item.due,'130,396 mi');
});
test('air filter repeats at 137896 miles',()=>{
 const outcome=recordCompletion(item('Engine Air Filter','15,000 mi','122,896 mi'),null,{date:'2026-09-30',mileage:122896,id:'filter-1'});
 assert.equal(outcome.item.due,'137,896 mi');
});
test('a second service retains first history and schedules next due',()=>{
 const first=recordCompletion(item('Oil','7500 mi','130,396 mi'),null,{date:'2026-10-05',mileage:122896,id:'one'});
 const second=recordCompletion(first.item,null,{date:'2027-06-01',mileage:130250,id:'two'});
 assert.equal(second.item.due,'137,750 mi');assert.equal(completionHistory(second.item).length,2);
 assert.equal(completionHistory(second.item)[0].mileage,122896);
});
test('a correction replaces the latest completion and recalculates without double counting',()=>{
 const first=recordCompletion(item('Oil','7500 mi','130,396 mi'),null,{date:'2026-09-30',mileage:122996,id:'one'});
 const corrected=recordCompletion(first.item,null,{date:'2026-09-30',mileage:122896,correction:true});
 assert.equal(corrected.item.due,'130,396 mi');assert.equal(corrected.item.completions.length,1);
 assert.equal(corrected.item.completions[0].id,'one');
});
test('duplicate completion at same mileage and date is rejected',()=>{
 const first=recordCompletion(item('Oil','7500 mi','130,396 mi'),null,{date:'2026-09-30',mileage:122896,id:'one'});
 assert.throws(()=>recordCompletion(first.item,null,{date:'2026-09-30',mileage:122896}),/already recorded/);
});
test('time-based maintenance repeats from date of completed service',()=>{
 const source=item('Battery Test','12 months','2026-06-06',{checklist:[{completed:true,label:'Test battery'}]});
 const linked={id:'r1',maintenanceId:'m1',rule:'Every 12 months',due:'2026-06-06',triggerType:'recurring',checklist:[{completed:true,label:'Test battery'}]};
 const result=recordCompletion(source,linked,{date:'2026-09-18',mileage:null,id:'date-1'});
 assert.equal(result.item.due,'2027-09-18');assert.equal(result.reminder.due,'2027-09-18');
 assert.equal(result.item.checklist[0].completed,false);
 assert.equal(result.reminder.checklist[0].completed,false);
});
test('end-of-month date arithmetic and leap years are stable',()=>{
 assert.equal(advanceDate('2024-01-31',{kind:'date',unit:'months',count:1}),'2024-02-29');
 assert.equal(advanceDate('2024-02-29',{kind:'date',unit:'years',count:1}),'2025-02-28');
 assert.equal(advanceDate('2026-11-01',{kind:'date',unit:'weeks',count:2}),'2026-11-15');
});
test('one-time maintenance completes permanently',()=>{
 const result=recordCompletion(item('Repair','One-time','2026-09-30',{checklist:[{label:'Done',completed:true}]}),null,{date:'2026-09-30',id:'repair'});
 assert.equal(result.item.status,'Completed');assert.equal(result.recurring,false);assert.equal(result.item.checklist[0].completed,true);
});
test('legacy completed oil service migrates once using previous due mileage',()=>{
 const old=item('Oil','7,500 mi','122,896 mi',{status:'Completed',serviceMileage:115396,repeatMiles:7500});
 const oldReminder=reminder('7500 miles',{status:'Completed'});
 const migration=migrateLegacy(old,oldReminder);
 assert.equal(migration.item.due,'130,396 mi');assert.equal(migration.reminder.due,'130,396 mi');
 assert.equal(migration.item.completions[0].legacy,true);
 assert.equal(migration.item.completions[0].mileageSource,'previous-due');
 assert.equal(migrateLegacy(migration.item,migration.reminder),null);
});
test('legacy recurring dates without a known completion date are not guessed',()=>{
 assert.equal(migrateLegacy(item('Check','6 months','2027-04-06',{status:'Completed'}),null),null);
});
test('legacy recurring date can be advanced using recorded completion date',()=>{
 const result=migrateLegacy(item('Check','6 months','2027-04-06',{status:'Completed',completedAt:'2026-10-15T10:00:00Z'}),null);
 assert.equal(result.item.due,'2027-04-15');
});
test('completion date and mileage require valid values',()=>{
 assert.throws(()=>recordCompletion(item('Oil','7500 mi','123000 mi'),null,{date:'2026-13-01',mileage:122896}),/valid service date/);
 assert.throws(()=>recordCompletion(item('Oil','7500 mi','123000 mi'),null,{date:'2026-09-30',mileage:''}),/mileage/);
});
test('historical service completion cannot mutate a separate vehicle record',()=>{
 const a=item('Oil','7500 mi','123000 mi',{vehicleId:'A'}),b=item('Oil','7500 mi','234000 mi',{vehicleId:'B'});
 const res=recordCompletion(a,null,{date:'2026-09-30',mileage:122896});
 assert.equal(b.due,'234000 mi');assert.equal(res.item.vehicleId,'A');
});
console.log(`\nAll ${successes} maintenance-cycle tests passed.`);
