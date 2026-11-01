/* Shared, side-effect-free maintenance filter definitions for browser and regression tests. */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.GarageLogMaintenanceFilters=api;
})(typeof globalThis!=='undefined'?globalThis:null,function(){
 const WARNING_PERCENT=25;
 const UPCOMING_PERCENT=50;
 const UPCOMING_DAYS=90;
 const DAY_MS=86400000;
 // Gauge color thresholds are independent of the warning/due classification.
 function serviceGaugeTone(percent,overdue=false){
   const remaining=Math.max(0,Math.min(100,Number(percent)||0));
   return overdue||remaining<=20?'gauge-danger':remaining<=50?'gauge-warning':'gauge-healthy';
 }
 function classify({status='',priority='',percent=null,hasProgress=false,isChecklist=false,
   mileage=null,dueDate=null,now=Date.now()}={}){
   const normalized=String(status||'').trim().toLowerCase();
   if(normalized==='completed')return 'completed';
   if(normalized==='overdue')return 'overdue';
   const urgent=String(priority||'').trim().toLowerCase()==='urgent';
   if(urgent||normalized==='due'||normalized.includes('soon'))return 'due';
   // Checklist completion measures work done, not maintenance life remaining.
   // Only a schedule (or a non-checklist remaining-life gauge) can trigger warnings.
   const remaining=Number(percent);
   const hasLife=hasProgress&&!isChecklist&&percent!==null&&percent!==undefined&&Number.isFinite(remaining);
   if(hasLife&&remaining<=WARNING_PERCENT)return 'due';
   if(mileage){
     if(mileage.beforeStart)return 'scheduled';
     const life=Number(mileage.percent);
     return Number.isFinite(life)&&life<=UPCOMING_PERCENT?'upcoming':'scheduled';
   }
   if(dueDate){
     const timestamp=dueDate instanceof Date?dueDate.getTime():Date.parse(`${dueDate}T12:00:00`);
     const nowDate=new Date(now);
     const today=new Date(nowDate.getFullYear(),nowDate.getMonth(),nowDate.getDate(),12).getTime();
     if(Number.isFinite(timestamp)){
       const days=Math.ceil((timestamp-today)/DAY_MS);
       return days>=0&&days<=UPCOMING_DAYS?'upcoming':'scheduled';
     }
   }
   if(hasLife&&remaining<=UPCOMING_PERCENT)return 'upcoming';
   return 'scheduled';
 }
 // Keep active schedule health mutually exclusive; historical completions are
 // counted by maintenance schedule, not combined with expenses (which can overlap).
 function summarize(records=[]){
   return records.reduce((counts,record)=>{
     const bucket=record?.bucket;
     if(bucket==='overdue')counts.overdue++;
     else if(bucket==='due')counts.due++;
     else if(bucket==='upcoming')counts.upcoming++;
     else if(bucket==='scheduled')counts.track++;
     if(bucket==='completed'||record?.hasHistory)counts.completed++;
     counts.total++;
     return counts;
   },{overdue:0,due:0,upcoming:0,track:0,completed:0,total:0});
 }
 function matchesFilter(bucket,filter,{custom=false,hasHistory=false}={}){
   if(filter==='All')return true;
   if(filter==='Needs Attention')return bucket==='overdue'||bucket==='due';
   if(filter==='Upcoming')return bucket==='upcoming';
   if(filter==='Completed')return bucket==='completed'||hasHistory;
   if(filter==='Custom')return custom;
   return false;
 }
 return{classify,matchesFilter,summarize,serviceGaugeTone,WARNING_PERCENT,UPCOMING_PERCENT,UPCOMING_DAYS};
});
