// Run with: node --test tests/maintenance-filters.test.cjs
const test=require('node:test');
const assert=require('node:assert/strict');
const {classify,matchesFilter,UPCOMING_DAYS,UPCOMING_PERCENT}=require('../src/GarageLog.Web/wwwroot/maintenance-filters.js');
const TODAY=new Date(2026,10,1,12).getTime();
const check=(dueDate,completed,total)=>({status:'Upcoming',dueDate,isChecklist:true,percent:completed/total*100,hasProgress:true,now:TODAY});
const miles=(remaining,interval,beforeStart=false)=>({status:'Upcoming',percent:remaining/interval*100,hasProgress:true,mileage:{percent:remaining/interval*100,beforeStart},now:TODAY});

test('incomplete checklists are not due soon when schedule is safely in future',()=>{
 for(const completed of [0,3,5])assert.equal(classify(check('2027-04-06',completed,5)),'scheduled');
});
test('incomplete checklist becomes upcoming within 90 days and due soon via actual status',()=>{
 assert.equal(classify(check('2027-01-30',0,5)),'upcoming');
 assert.equal(classify({...check('2027-04-06',0,5),status:'Due Soon'}),'due');
 assert.equal(classify({...check('2027-04-06',5,5),status:'Overdue'}),'overdue');
});
test('new recurring mileage cycles are scheduled, not due or near-term upcoming',()=>{
 assert.equal(classify(miles(7400,7500)),'scheduled');
 assert.equal(classify(miles(14900,15000)),'scheduled');
 assert.equal(classify(miles(67004,60000,true)),'scheduled');
});
test('mileage warning uses remaining service life, not checklist completion',()=>{
 assert.equal(classify(miles(4777,12000)),'upcoming');
 assert.equal(classify(miles(2400,12000)),'due');
 assert.equal(classify({...miles(-5,12000),status:'Overdue'}),'overdue');
 assert.equal(classify({...miles(10000,12000),priority:'urgent'}),'due');
});
test('legacy non-checklist remaining-life gauge can still warn',()=>{
 assert.equal(classify({status:'Upcoming',percent:14,hasProgress:true,isChecklist:false}),'due');
 assert.equal(classify({status:'Upcoming',percent:14,hasProgress:true,isChecklist:true}),'scheduled');
});
test('completed one-time services do not appear due',()=>{
 assert.equal(classify({status:'Completed',percent:0,hasProgress:true,priority:'urgent'}),'completed');
});
test('all badge counts equal the number of matching filtered rows',()=>{
 const records=[
   check('2027-09-30',3,7), miles(67004,60000,true), check('2027-06-06',5,5),
   check('2027-04-06',0,5),miles(14900,15000),miles(4777,12000),
   check('2027-08-01',0,5),miles(7400,7500),miles(7400,7500)
 ];
 const buckets=records.map(classify);
 const match=filter=>buckets.filter(bucket=>matchesFilter(bucket,filter)).length;
 assert.equal(match('All'),9);
 assert.equal(match('Needs Attention'),0);
 assert.equal(match('Upcoming'),1);
 assert.equal(match('Completed'),0);
 assert.equal(buckets.filter(x=>x==='scheduled'||x==='upcoming').length,9);
 assert.equal(UPCOMING_DAYS,90);assert.equal(UPCOMING_PERCENT,50);
});
test('recurring services remain in completed history without disappearing from active schedule',()=>{
 assert.equal(matchesFilter('scheduled','Completed',{hasHistory:true}),true);
 assert.equal(matchesFilter('scheduled','All',{hasHistory:true}),true);
 assert.equal(matchesFilter('completed','Needs Attention'),false);
 assert.equal(matchesFilter('due','Needs Attention'),true);
 assert.equal(matchesFilter('overdue','Needs Attention'),true);
});
test('filtered search badges can use the same matching logic as the displayed rows',()=>{
 const records=[{name:'Brake',bucket:'upcoming'},{name:'Oil',bucket:'scheduled'},{name:'Wipers',bucket:'scheduled'}];
 const search=records.filter(x=>x.name.toLowerCase().includes('brake'));
 const visible=search.filter(x=>matchesFilter(x.bucket,'Upcoming'));
 const badgeCount=search.filter(x=>matchesFilter(x.bucket,'Upcoming')).length;
 assert.equal(visible.length,badgeCount);
 assert.equal(badgeCount,1);
});
