/* Pure checklist cycle helpers used by browser and regression tests. */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.GarageLogMaintenanceChecklists=api;
})(typeof globalThis!=='undefined'?globalThis:null,function(){
 'use strict';
 function entries(item){return Array.isArray(item?.checklist)?item.checklist:[]}
 function counts(item){const items=entries(item),total=items.length,done=items.filter(x=>Boolean(x?.completed)).length;return{total,done}}
 function awaitingNextCycle(item,bucket){
  const {total,done}=counts(item);
  // The pending badge is visible until the next due point enters the Upcoming window.
  return total>0&&done===0&&Boolean(item?.checklistCyclePending)&&bucket==='scheduled';
 }
 function presentation(item,bucket,now=new Date()){
  const {total,done}=counts(item);
  const complete=total>0&&done===total;
  const pending=awaitingNextCycle(item,bucket);
  const overdue=bucket==='overdue';
  const approaching=bucket==='upcoming'||bucket==='due';
  const dueToday=/^\d{4}-\d{2}-\d{2}$/.test(String(item?.due||''))&&String(item.due)===[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
  return{
   done,total,complete:complete||pending,locked:pending,
   percent:total?Math.round(done/total*100):0,
   tone:overdue&&!complete?'gauge-danger':'gauge-progress',
   warning:!complete&&(overdue||approaching),
   label:pending?'Completed · next cycle scheduled':complete?'Completed':overdue?'Overdue':dueToday?'Due today':approaching?'Approaching due':null
  };
 }
 function finalStepJustChecked(before,after){
  const old=counts(before),next=counts(after);
  return next.total>0&&next.done===next.total&&old.done<old.total;
 }
 function progressUpdated(item,checked,now){
  const previous=entries(item);
  if(previous.length!==checked.length)throw new Error('Checklist changed while editing. Reopen the checklist.');
  const updated={...item,checklist:previous.map((entry,i)=>typeof entry==='string'?{id:`item-${i+1}`,label:entry,completed:Boolean(checked[i])}:{...entry,completed:Boolean(checked[i])}),checklistUpdatedAt:now};
  const {done,total}=counts(updated);
  updated.progress=done;updated.max=total;updated.checklistProgress=true;
  if(done>0)updated.checklistCyclePending=false;
  return updated;
 }
 return{entries,counts,awaitingNextCycle,presentation,finalStepJustChecked,progressUpdated};
});
