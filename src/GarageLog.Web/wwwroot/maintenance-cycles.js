/* Recurring service-cycle calculations. Kept independent of the UI for regression testing. */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.GarageLogMaintenanceCycles=api;
})(typeof globalThis!=='undefined'?globalThis:null,function(){
 'use strict';
 const mileageNumber=value=>{
  const match=String(value??'').replaceAll(',','').match(/(-?\d+(?:\.\d+)?)/);
  return match?Number(match[1]):null;
 };
 const finiteMileage=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))&&Number(value)>=0?Number(value):null;
 const isoDate=value=>{
  const text=String(value||'').trim().slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(text))return null;
  const parsed=new Date(`${text}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===text?text:null;
 };
 const interval=(item,reminder)=>{
  const rule=String(item?.interval||reminder?.rule||'').trim();
  const milesRule=/\b(mi|miles?)\b/i.test(rule)||reminder?.triggerType==='mileage';
  const miles=finiteMileage(item?.repeatMiles)??finiteMileage(reminder?.repeatMiles)??(milesRule?mileageNumber(rule):null);
  if(milesRule&&miles>0)return{kind:'mileage',count:miles};
  if(reminder?.triggerType==='date'||/one[- ]time/i.test(rule))return null;
  const match=rule.match(/(?:every\s+)?([\d,]+)\s*(days?|weeks?|months?|years?)\b/i);
  if(!match)return null;
  const count=Number(match[1].replaceAll(',',''));
  return count>0?{kind:'date',count,unit:match[2].toLowerCase()}:null;
 };
 function advanceDate(date,repeat){
  const input=isoDate(date);
  if(!input||!repeat||repeat.kind!=='date')return null;
  const [year,month,day]=input.split('-').map(Number);
  const value=new Date(Date.UTC(year,month-1,day,12));
  if(repeat.unit.startsWith('month')||repeat.unit.startsWith('year')){
   value.setUTCDate(1);
   value.setUTCMonth(value.getUTCMonth()+repeat.count*(repeat.unit.startsWith('year')?12:1));
   const lastDay=new Date(Date.UTC(value.getUTCFullYear(),value.getUTCMonth()+1,0)).getUTCDate();
   value.setUTCDate(Math.min(day,lastDay));
  }else value.setUTCDate(value.getUTCDate()+repeat.count*(repeat.unit.startsWith('week')?7:1));
  return value.toISOString().slice(0,10);
 }
 function completionHistory(item){return Array.isArray(item?.completions)?item.completions:[]}
 function recordCompletion(item,reminder,{date,mileage,id,legacy=false,correction=false}={}){
  const schedule=interval(item,reminder);
  const actualDate=isoDate(date);
  const actualMileage=finiteMileage(mileage);
  if(!actualDate&&!legacy&&!(correction&&schedule?.kind==='mileage'&&!existing?.date))throw new Error('Enter a valid service date.');
  if(schedule?.kind==='mileage'&&actualMileage===null)throw new Error('Enter the mileage when the service was performed.');
  const previous=completionHistory(item),existing=correction?previous.at(-1):null;
  if(correction&&!existing)throw new Error('There is no completed service to correct.');
  if(!correction&&previous.some(x=>x.date===actualDate&&x.mileage===actualMileage))throw new Error('This service completion is already recorded.');
  const completion={id:existing?.id||id||`completed-${Date.now()}`,date:actualDate,mileage:actualMileage,legacy:Boolean(legacy),mileageSource:legacy?'previous-due':'recorded',previousDue:existing?.previousDue||String(item.due||''),recordedAt:existing?.recordedAt||new Date().toISOString()};
  const completions=correction?[...previous.slice(0,-1),completion]:[...previous,completion];
  const nextItem={...item,completions,lastCompletedAt:actualDate,lastCompletedMileage:actualMileage,completedAt:actualDate||item.completedAt||null};
  const nextReminder=reminder?{...reminder}:null;
  for(const target of [nextItem,nextReminder]){
   if(!target)continue;
   target.completedAt=actualDate||target.completedAt||null;
   target.lastCompletedAt=actualDate;
   target.lastCompletedMileage=actualMileage;
   if(schedule?.kind==='mileage'){
    target.serviceMileage=actualMileage;
    target.due=`${(Math.round((actualMileage+schedule.count)*100)/100).toLocaleString('en-US')} mi`;
    target.repeatMiles=schedule.count;
    target.progress=0;
    target.max=schedule.count;
    target.status='Upcoming';
   }else if(schedule?.kind==='date'){
    if(!actualDate)throw new Error('A recorded service date is required for time-based maintenance.');
    target.due=advanceDate(actualDate,schedule);
    target.progress=0;
    target.status='Upcoming';
   }else target.status='Completed';
   if(schedule&&Array.isArray(target.checklist))target.checklist=target.checklist.map(entry=>({...entry,completed:false}));
  }
  return{item:nextItem,reminder:nextReminder,recurring:Boolean(schedule),completion};
 }
 function migrateLegacy(item,reminder){
  if(!item||String(item.status||'').toLowerCase()!=='completed'||completionHistory(item).length)return null;
  const schedule=interval(item,reminder);
  if(!schedule)return null;
  const recordedDate=isoDate(item.completedAt||reminder?.completedAt);
  if(schedule.kind==='date'&&!recordedDate)return null; // Never guess the date of a past service.
  const mileage=finiteMileage(item.completedMileage)??finiteMileage(reminder?.completedMileage)??
   (schedule.kind==='mileage'?mileageNumber(item.due||reminder?.due):null);
  if(schedule.kind==='mileage'&&mileage===null)return null;
  return recordCompletion(item,reminder,{date:recordedDate,mileage,legacy:true,id:`legacy-${item.id||reminder?.id||'service'}`});
 }
 return{interval,advanceDate,completionHistory,recordCompletion,migrateLegacy,isoDate,finiteMileage,mileageNumber};
});
