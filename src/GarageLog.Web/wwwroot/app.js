let state=null;
let saveTimer=null;
let current='Dashboard';
let currentFilter='All';
let currentGarageFilter='All Vehicles';
let currentGarageSort='Service Due';
let documentSearchQuery='';
let topSearchQuery='';
let documentIndexProgress={running:false,completed:0,total:0,currentName:''};
let expenseChartPeriod='this-year';
let expenseCustomRange={start:'',end:''};
let expenseCategoryPeriod='this-year';
let expenseCategoryCustomRange={start:'',end:''};
let expenseRangeTarget='monthly';
let reportPeriod='this-year';
let reportCustomRange={start:'',end:''};
let reportViewMode='dashboard';
let selectedReportTemplateId='ownership-cost';
let notificationPanelOpen=false;
let expenseViewMode='expenses';
let editingRecurringExpenseId=null;
let dashboardExpenseRange='this-year';
let dashboardExpenseCustomRange={start:'',end:''};
let dashboardFuelRange='this-year';
let dashboardFuelCustom={label:'Custom Range',months:6};
let editing=null;
let pendingVehicleLifecycleToast=null;
let documentUploadPreviewUrl=null;
let checklistDialogContext=null;
let reminderWizardState=null;
let reminderTimelineOffset=0;
let reminderViewMode='list';
let reminderCalendarCursor=new Date(new Date().getFullYear(),new Date().getMonth(),1,12);
let infoModalAction=null;
let authSession=null;
let managedUsers=[];
let managedUsersLoading=false;
let managedUserEditorId=null;
let managedUserEditorOpen=false;
let firstRunSetupState=null;
let availableUpdate=null;
let applicationVersion='';
const listSortState={
 maintenance:{key:null,direction:'asc'},
 expenses:{key:'date',direction:'desc'},
 documents:{key:'dateAdded',direction:'desc'},
 reminders:{key:'due',direction:'asc'}
};
const navItems=['Dashboard','Garage','Reminders','Maintenance','Expenses','Documents','Reports'];
const nav=document.getElementById('nav');
const content=document.getElementById('content');
const SIDEBAR_LOGO_PATH='/assets/garagelog-logo.png';
const APP_FAVICON_PATH='/assets/favicon-32x32.png';
const NAV_ICON_PATHS={
 Dashboard:'/assets/navigation/dashboard.png',
 Garage:'/assets/navigation/garage.png',
 Maintenance:'/assets/navigation/maintenance.png',
 Expenses:'/assets/navigation/expenses.png',
 Documents:'/assets/navigation/documents.png',
 Reminders:'/assets/navigation/reminders.png',
 Reports:'/assets/navigation/reports.png'
};
const MAINTENANCE_WARNING_PERCENT=25;
const MAINTENANCE_DANGER_PERCENT=10;
const nativeGarageLogFetch=window.fetch.bind(window);
window.fetch=function(input,init={}){
 const requestUrl=new URL(typeof input==='string'?input:input.url,window.location.href),method=String(init.method||(typeof input==='object'&&input?.method)||'GET').toUpperCase();
 if(requestUrl.origin===window.location.origin&&requestUrl.pathname.startsWith('/api/')&&!['GET','HEAD','OPTIONS'].includes(method)){
  const headers=new Headers(typeof input==='object'&&input?.headers?input.headers:undefined);new Headers(init.headers||{}).forEach((value,key)=>headers.set(key,value));headers.set('X-GarageLog-Request','1');
  return nativeGarageLogFetch(input,{...init,headers,credentials:init.credentials||'same-origin'});
 }
 return nativeGarageLogFetch(input,init);
};

async function getApplicationVersion(){
 if(applicationVersion)return applicationVersion;
 try{
  const response=await fetch('/healthz',{cache:'no-store'});
  if(response.ok){
   const payload=await response.json();
   const version=String(payload?.version||'').trim();
   if(version)applicationVersion=version
  }
 }catch(error){console.warn('Unable to read GarageLog runtime version.',error)}
 return applicationVersion||'Unknown'
}

const REPORT_TEMPLATES=[
 {id:'ownership-cost',icon:'dollar',name:'Cost & Spending',description:'Transaction-date spending totals, category shares, and expense detail for the selected period.',sources:['Expenses','Transaction dates']},
 {id:'maintenance-history',icon:'wrench',name:'Maintenance History',description:'Completed maintenance, repairs, parts, vendors, and recorded costs.',sources:['Maintenance expenses','Service records']},
 {id:'maintenance-schedule',icon:'calendar',name:'Maintenance Schedule',description:'Current maintenance intervals, due points, remaining life, and status.',sources:['Maintenance schedules','Odometer']},
 {id:'fuel-efficiency',icon:'fuel',name:'Fuel & Efficiency',description:'Fuel purchases and calculable MPG points from gallons and odometer data.',sources:['Fuel expenses','MPG readings']},
 {id:'mileage-history',icon:'gauge',name:'Mileage History',description:'Dated odometer readings and the recorded mileage change between readings.',sources:['Mileage history']},
 {id:'tax-expense',icon:'receipt',name:'Tax & Expense Summary',description:'Calendar-year expense summary for recordkeeping; not a tax determination.',sources:['Expenses','Attachments']},
 {id:'document-inventory',icon:'file',name:'Document Inventory',description:'Stored vehicle documents, categories, tags, sizes, and expiration dates.',sources:['Documents']},
 {id:'registration-insurance',icon:'shield',name:'Registration & Insurance',description:'Registration and insurance records, documents, reminders, and expenses.',sources:['Expenses','Documents','Reminders']},
 {id:'vehicle-health',icon:'warning',name:'Vehicle Health',description:'Overdue, due-soon, upcoming, and completed maintenance and reminder status.',sources:['Maintenance','Reminders']},
 {id:'complete-vehicle',icon:'car',name:'Complete Vehicle Record',description:'Vehicle details with maintenance, expenses, documents, reminders, and mileage.',sources:['All visible vehicle records']}
];

const ICONS={
 shield:'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="M9 12l2 2 4-4"/>',
 dashboard:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
 car:'<path d="M5 17h14l-1.5-6h-11z"/><path d="m7 11 1.4-4h7.2l1.4 4"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/><path d="M3 13h2m14 0h2"/>',
 wrench:'<path d="M14.7 6.3a4 4 0 0 0-5-5L7 4 4 1a4 4 0 0 0 5 5l-6.7 6.7a2 2 0 0 0 2.8 2.8z" transform="translate(2 4)"/>',
 receipt:'<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6m-6 4h6m-6 4h3"/>',
 file:'<path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5"/>',
 bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
 chart:'<path d="M4 19V9m6 10V5m6 14v-7m4 7H2"/>',
 search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
 plus:'<path d="M12 5v14M5 12h14"/>',
 'bell-plus':'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h11"/><path d="M10 21h4m5-5v6m-3-3h6"/>',
 'file-plus':'<path d="M6 2h8l4 4v7"/><path d="M14 2v5h5M12 18h8m-4-4v8"/><path d="M6 22V2"/>',
 gauge:'<path d="M4 15a8 8 0 1 1 16 0"/><path d="m12 15 3-4"/><path d="M6 19h12"/>',
 calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
 dollar:'<path d="M12 2v20m5-16H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H7"/>',
 oil:'<path d="M4 14h12l3-4h2v7h-3"/><path d="M5 10V7h5l2 3"/><path d="M4 14v4h12v-4"/><path d="M20 18c0 1.1-.9 2-2 2"/>',
 tire:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 3v5m0 8v5M3 12h5m8 0h5"/>',
 filter:'<path d="M4 6h16M6 10h12M8 14h8M10 18h4"/>',
 transmission:'<circle cx="5" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><path d="M7 12h10M12 5v14m-3-9h6m-6 4h6"/>',
 coolant:'<path d="M8 4v10a4 4 0 1 0 8 0V4"/><path d="M8 9h8M4 20h16"/>',
 edit:'<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/>',
 trash:'<path d="M3 6h18M8 6V4h8v2m-9 0 1 15h8l1-15M10 10v7m4-7v7"/>',
 more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
 upload:'<path d="M12 16V4m-5 5 5-5 5 5"/><path d="M5 20h14"/>',
 download:'<path d="M12 4v12m-5-5 5 5 5-5"/><path d="M5 20h14"/>',
 check:'<path d="m5 12 4 4L19 6"/>',
 close:'<path d="M6 6l12 12M18 6 6 18"/>',
 clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
 fuel:'<path d="M5 3h9v18H5z"/><path d="M8 7h3m3 3h2l3 3v6a2 2 0 0 0 2 2"/>',
 folder:'<path d="M3 6h7l2 2h9v11H3z"/>',
 info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
 warning:'<path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v5"/><path d="M12 17h.01"/>',
 chevronDown:'<path d="m7 10 5 5 5-5"/>',
 brake:'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M4 8h2m12 0h2M4 16h2m12 0h2"/>',
 battery:'<rect x="4" y="7" width="16" height="12" rx="2"/><path d="M9 7V4h6v3M8 13h3m5 0h-3"/>',
 spark:'<path d="M14 2 8 11h5l-3 11 7-12h-5z"/>',
 belt:'<path d="M6 7c-2 2-2 8 0 10s10 2 12 0 2-8 0-10-10-2-12 0Z"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="12" r="2"/>',
 differential:'<circle cx="6" cy="12" r="3"/><circle cx="18" cy="12" r="3"/><path d="M9 12h6M12 9v6"/>',
 wiper:'<path d="M4 17c3-7 13-9 16-3"/><path d="m6 15 10-5M16 10l3 7"/>',
 image:'<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m21 15-5-5L5 20"/>',
 fileText:'<path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5M9 12h6m-6 4h6"/>',
 table:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16m6-16v16"/>',
 presentation:'<rect x="3" y="3" width="18" height="13" rx="2"/><path d="M8 21l4-5 4 5M12 16v5"/>',
 archive:'<path d="M5 4h14v16H5zM8 4v5h8V4M9 13h6"/>',
 printer:'<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/>',
 share:'<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4"/>',
 external:'<path d="M14 3h7v7M10 14 21 3"/><path d="M18 13v7H4V6h7"/>',
 user:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
 help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.7 2.7 0 1 1 4.2 2.2c-1 .7-1.7 1.1-1.7 2.3"/><path d="M12 17h.01"/>',
 logout:'<path d="M10 4H5v16h5"/><path d="m14 8 4 4-4 4M18 12H9"/>',
 printer:'<path d="M6 9V3h12v6"/><rect x="6" y="14" width="12" height="7"/><path d="M6 17H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/>',
 json:'<path d="M8 3c-2 0-3 1-3 3v3c0 1-.5 2-2 2 1.5 0 2 1 2 2v3c0 2 1 3 3 3M16 3c2 0 3 1 3 3v3c0 1 .5 2 2 2-1.5 0-2 1-2 2v3c0 2-1 3-3 3"/>',
 qr:'<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM18 18h3v3h-3zM14 19h2M19 14h2"/>',
 chevronRight:'<path d="m9 18 6-6-6-6"/>'
};
function svg(name,cls=''){return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]||ICONS.file}</svg>`}
function listSortDirection(page,key){const config=listSortState[page];return config?.key===key?config.direction:null}
function listSortHeader(label,page,key){const direction=listSortDirection(page,key),glyph=direction==='asc'?'↑':direction==='desc'?'↓':'↕';return `<button type="button" class="column-sort-button ${direction?'active':''}" onclick="setListSort('${page}','${key}')" aria-label="Sort ${esc(label)} ${direction==='asc'?'descending':direction==='desc'?'ascending':'ascending'}">${esc(label)}<span class="column-sort-glyph" aria-hidden="true">${glyph}</span></button>`}
window.setListSort=function(page,key){const config=listSortState[page];if(!config)return;if(config.key===key)config.direction=config.direction==='asc'?'desc':'asc';else{config.key=key;config.direction=(page==='expenses'&&key==='date')||(page==='documents'&&key==='dateAdded')?'desc':'asc'}render()}
function compareListValues(a,b,direction='asc'){const missing=value=>value===null||value===undefined||value===''||(typeof value==='number'&&!Number.isFinite(value));const aMissing=missing(a),bMissing=missing(b);if(aMissing||bMissing)return aMissing===bMissing?0:aMissing?1:-1;let result;if(typeof a==='number'&&typeof b==='number')result=a-b;else result=String(a).localeCompare(String(b),undefined,{numeric:true,sensitivity:'base'});return direction==='desc'?-result:result}
function compareListTuples(a,b,direction='asc'){const length=Math.max(a?.length||0,b?.length||0);for(let i=0;i<length;i++){const result=compareListValues(a?.[i],b?.[i],direction);if(result)return result}return 0}
function navIcon(name){const src=NAV_ICON_PATHS[name];return src?`<img class="nav-menu-icon" src="${src}" alt="" aria-hidden="true">`:svg('file')}
function esc(v=''){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function money(n){return Number(n||0).toLocaleString('en-US',{style:'currency',currency:'USD'})}
function number(n){return Number(n||0).toLocaleString('en-US')}
function toast(message){const el=document.getElementById('toast');el.textContent=message;el.classList.add('show');clearTimeout(el._timer);el._timer=setTimeout(()=>el.classList.remove('show'),2200)}
function applySidebarBranding(){const brand=document.querySelector('.brand');if(!brand)return;brand.classList.add('brand-with-logo');brand.innerHTML=`<img class="brand-logo" src="${SIDEBAR_LOGO_PATH}" alt="GarageLog">`}
function sessionUser(){return authSession?.user||null}
function canWrite(){return Boolean(sessionUser()?.permissions?.canWrite)}
function isAdministrator(){return Boolean(sessionUser()?.permissions?.canManageUsers)}
function profileInitials(user=sessionUser()){const parts=String(user?.displayName||user?.username||'User').trim().split(/\s+/).filter(Boolean);return (parts.length>1?parts[0][0]+parts.at(-1)[0]:parts[0]?.slice(0,2)||'U').toUpperCase()}
function profileAvatarMarkup(user=sessionUser(),large=false){const cls=large?'account-profile-photo':'avatar';return user?.profileImageUrl?`<span class="${cls} has-image"><img src="${esc(user.profileImageUrl)}" alt="${esc(user.displayName||user.username)} profile picture"></span>`:`<span class="${cls}">${esc(profileInitials(user))}</span>`}
function updateProfileChrome(){const user=sessionUser(),trigger=document.getElementById('profileTrigger');if(!user||!trigger)return;const avatar=trigger.querySelector('.avatar');if(avatar){avatar.className='avatar'+(user.profileImageUrl?' has-image':'');avatar.innerHTML=user.profileImageUrl?`<img src="${esc(user.profileImageUrl)}" alt="${esc(user.displayName||user.username)} profile picture">`:esc(profileInitials(user))}const label=trigger.querySelector('.profile-label');if(label)label.textContent=user.displayName||user.username;trigger.title=`${user.role} · ${user.accessLevel==='ReadOnly'?'Read only':'Read and write'}`;}
function permissionNotice(){const user=sessionUser();if(!user||canWrite())return'';return `<div class="permission-notice">${svg('info')}<div><strong>Read-only access</strong><span>You can view the GarageLog records available to this account, but changes are disabled.</span></div></div>`}
async function authRequest(url,options={}){const response=await fetch(url,{cache:'no-store',...options});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||`Request failed (${response.status})`);return data}
async function checkForGarageLogUpdates(){
 if(!isAdministrator())return;
 try{const result=await authRequest('/api/update/status');availableUpdate=result?.updateAvailable?result:null;if(state)render()}catch(error){console.warn('GarageLog update check unavailable',error)}
}
function updateNoticeId(){return availableUpdate?.latestVersion?`system:update:${availableUpdate.latestVersion}`:''}
function updateNoticeDismissed(){const id=updateNoticeId();return Boolean(id&&(notificationSettings().dismissedIds||[]).includes(id))}
function updateAvailableBanner(){if(current!=='Dashboard'||!availableUpdate?.updateAvailable||updateNoticeDismissed())return'';return `<section class="update-available-banner"><span class="notification-item-icon indigo">${svg('download')}</span><div><strong>GarageLog ${esc(availableUpdate.latestVersion)} is available</strong><small>${esc(availableUpdate.releaseName||'A newer GarageLog release is available on GitHub.')}</small></div><a class="secondary" href="${esc(availableUpdate.releaseUrl||'#')}" target="_blank" rel="noopener noreferrer">${svg('external')} View release</a><button class="icon-button" type="button" aria-label="Dismiss update notice" onclick="dismissUpdateNotice()">${svg('close')}</button></section>`}
window.dismissUpdateNotice=async function(){const id=updateNoticeId();if(!id)return;const settings=notificationSettings();settings.dismissedIds=[...new Set([...(settings.dismissedIds||[]),id])].slice(-500);render();if(canWrite())try{await saveNow()}catch(error){toast(error.message)}}
function removeAuthScreen(){document.getElementById('garageLogAuthScreen')?.remove();const shell=document.querySelector('.app-shell');if(shell)shell.hidden=false}
function renderAuthScreen(mode='login',message=''){
 const shell=document.querySelector('.app-shell');if(shell)shell.hidden=true;document.getElementById('garageLogAuthScreen')?.remove();
 const setup=mode==='setup',root=document.createElement('main');root.id='garageLogAuthScreen';root.className='auth-screen';
 root.innerHTML=`<section class="auth-card"><img class="auth-logo" src="${SIDEBAR_LOGO_PATH}" alt="GarageLog"><div class="auth-heading"><span>${setup?'FIRST-RUN SECURITY':'LOCAL ACCOUNT'}</span><h1>${setup?'Create the administrator account':'Sign in to GarageLog'}</h1>${setup?`<p>After this account is created, GarageLog will guide you through adding the first vehicle and choosing the initial local settings.</p>`:''}</div><div class="auth-message" ${message?'':'hidden'}>${esc(message)}</div><form id="garageLogAuthForm" class="auth-form">${setup?`<label>Display name<input name="displayName" maxlength="80" autocomplete="name" required placeholder="Garage administrator"></label>`:''}<label>Username<input name="username" minlength="3" maxlength="40" autocomplete="username" required autofocus></label><label>Password<input name="password" type="password" ${setup?'minlength="12"':''} maxlength="128" autocomplete="${setup?'new-password':'current-password'}" required></label>${setup?`<label>Confirm password<input name="confirmPassword" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></label>`:`<label class="auth-remember"><input name="rememberMe" type="checkbox"><span>Keep me signed in on this browser</span></label>`}<button class="primary auth-submit" type="submit">${setup?'Create administrator':'Sign in'}</button></form></section>`;
 document.body.appendChild(root);root.querySelector('form').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('button[type=submit]'),fd=new FormData(form),error=root.querySelector('.auth-message');error.hidden=true;if(setup&&fd.get('password')!==fd.get('confirmPassword')){error.textContent='The passwords do not match.';error.hidden=false;return}button.disabled=true;button.textContent=setup?'Creating account…':'Signing in…';try{authSession=await authRequest(setup?'/api/auth/setup':'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(setup?{displayName:fd.get('displayName'),username:fd.get('username'),password:fd.get('password')}:{username:fd.get('username'),password:fd.get('password'),rememberMe:fd.get('rememberMe')==='on'})});removeAuthScreen();await loadState();current='Dashboard';render();checkForGarageLogUpdates()}catch(err){error.textContent=err.message;error.hidden=false}finally{button.disabled=false;button.textContent=setup?'Create administrator':'Sign in'}})
}
async function bootstrapGarageLog(){try{authSession=await authRequest('/api/auth/session');if(!authSession.configured){renderAuthScreen('setup');return}if(!authSession.authenticated){renderAuthScreen('login');return}removeAuthScreen();await loadState();render();checkForGarageLogUpdates()}catch(error){console.error(error);renderAuthScreen('login',error.message||'GarageLog could not verify the local account session.')}}
function categoryIcon(category){return ({Maintenance:'wrench',Repair:'wrench',Fuel:'fuel',Registration:'calendar',Insurance:'shield',Parts:'receipt'}[category]||'receipt')}
function taskVisual(name){
 const n=String(name||'').toLowerCase();
 if(n.includes('oil'))return{icon:'oil',tone:'orange'};
 if(n.includes('tire')||n.includes('tyre')||n.includes('wheel')||n.includes('alignment')||n.includes('lug nut'))return{icon:'tire',tone:'blue'};
 if(n.includes('brake')||n.includes('breakaway'))return{icon:'brake',tone:'red'};
 if(n.includes('battery')||n.includes('charging system')||n.includes('electrical')||n.includes('light')||n.includes('horn')||n.includes('switch'))return{icon:'battery',tone:'gold'};
 if(n.includes('pre-summer')||n.includes('cooling')||n.includes('coolant')||n.includes('antifreeze')||n.includes('a/c')||n.includes('air conditioning'))return{icon:'coolant',tone:'cyan'};
 if(n.includes('engine air filter'))return{icon:'filter',tone:'green'};
 if(n.includes('cabin air filter')||n.includes('cabin filter'))return{icon:'filter',tone:'teal'};
 if(n.includes('filter'))return{icon:'filter',tone:'green'};
 if(n.includes('wiper')||n.includes('washer'))return{icon:'wiper',tone:'sky'};
 if(n.includes('spark')||n.includes('ignition'))return{icon:'spark',tone:'gold'};
 if(n.includes('transmission'))return{icon:'transmission',tone:'purple'};
 if(n.includes('differential')||n.includes('transfer case')||n.includes('final drive'))return{icon:'differential',tone:'violet'};
 if(n.includes('belt')||n.includes('chain')||n.includes('coupler')||n.includes('hitch')||n.includes('bearing')||n.includes('axle')||n.includes('suspension')||n.includes('steering'))return{icon:'belt',tone:'violet'};
 if(n.includes('registration')||n.includes('title')||n.includes('license'))return{icon:'calendar',tone:'green'};
 if(n.includes('insurance'))return{icon:'shield',tone:'rose'};
 if(n.includes('recall'))return{icon:'shield',tone:'indigo'};
 if(n.includes('inspection')||n.includes('safety check')||n.includes('pre-trip')||n.includes('pre-ride')||n.includes('return-to-road'))return{icon:'shield',tone:'purple'};
 if(n.includes('emergency kit'))return{icon:'bell',tone:'amber'};
 if(n.includes('pre-winter')||n.includes('winter'))return{icon:'shield',tone:'indigo'};
 if(n.includes('storage'))return{icon:'calendar',tone:'slate'};
 if(n.includes('underbody')||n.includes('corrosion')||n.includes('wash'))return{icon:'coolant',tone:'teal'};
 if(n.includes('fuel')||n.includes('def'))return{icon:'fuel',tone:'orange'};
 if(n.includes('software')||n.includes('update'))return{icon:'bell',tone:'indigo'};
 return{icon:'bell',tone:'blue'}
}
function maintenanceIcon(name){return taskVisual(name).icon}
function statusClass(status){return status==='Overdue'?'bad':status==='Due soon'||status==='Due Soon'?'warn':''}
function statusBadge(status){const c=status==='Overdue'?'red':status.toLowerCase().includes('soon')?'orange':status==='Completed'?'green':'blue';return `<span class="badge ${c}">${esc(status)}</span>`}

async function loadState(){
 const r=await fetch('/api/state',{cache:'no-store'});if(!r.ok)throw new Error(`Unable to load GarageLog data (${r.status})`);
 state=await r.json();const migrated=normalizeState();
 // Startup migrations should never turn a successful sign-in into a login error.
 // If persistence of a compatibility normalization fails, keep the loaded state
 // usable and let the next explicit save retry it.
 if(migrated&&canWrite()){try{await saveNow()}catch(error){console.warn('GarageLog startup normalization could not be persisted.',error)}}
}
function makeVehicleId(){return globalThis.crypto?.randomUUID?.()||`vehicle-${Date.now()}-${Math.random().toString(16).slice(2)}`}
function makeRecordId(prefix='record'){return globalThis.crypto?.randomUUID?.()||`${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`}
function jsQuote(value){return JSON.stringify(String(value??'')).replace(/</g,'\u003c')}
function attrJs(value){return jsQuote(value).replaceAll('\"','&quot;')}
function normalizeState(){
 let migrated=false;
 const defaults={year:'',make:'',model:'',name:'',trim:'',type:'Car',powertrain:'Gasoline / Internal Combustion',lifecycleStatus:'Active',engine:'',transmission:'',vin:'',drivetrain:'',color:'',acquiredDate:'',acquiredMileage:null,imageStoredName:null};
 state=state&&typeof state==='object'?state:{};
 state.expenses=Array.isArray(state.expenses)?state.expenses:[];
 state.maintenance=Array.isArray(state.maintenance)?state.maintenance:[];
 state.documents=Array.isArray(state.documents)?state.documents:[];
 state.reminders=Array.isArray(state.reminders)?state.reminders:[];
 state.documentFolders=Array.isArray(state.documentFolders)?state.documentFolders.slice(0,10):[];
 state.documentStorageBytes=Number(state.documentStorageBytes||0);
 const expenseDefaults={monthlyBudget:500,alertPercent:85,rollover:false,categoryBudgets:{},recurringItems:[]};
 state.expenseSettings={...expenseDefaults,...(state.expenseSettings||{})};
 state.expenseSettings.monthlyBudget=Math.max(0,Number(state.expenseSettings.monthlyBudget||500));
 state.expenseSettings.alertPercent=Math.min(100,Math.max(50,Number(state.expenseSettings.alertPercent||85)));
 state.expenseSettings.rollover=Boolean(state.expenseSettings.rollover);
 state.expenseSettings.categoryBudgets=state.expenseSettings.categoryBudgets&&typeof state.expenseSettings.categoryBudgets==='object'?state.expenseSettings.categoryBudgets:{};
 state.expenseSettings.recurringItems=Array.isArray(state.expenseSettings.recurringItems)?state.expenseSettings.recurringItems.filter(item=>item&&item.id&&item.name).map(item=>({...item,id:String(item.id),vehicleId:String(item.vehicleId||state.activeVehicleId||''),amount:Math.max(0,Number(item.amount||0)),frequency:['Monthly','Quarterly','Annually'].includes(item.frequency)?item.frequency:'Monthly'})):[];
 state.metrics={averageMpg:0,...(state.metrics||{})};
 if(!Array.isArray(state.savedReports)){state.savedReports=[];migrated=true}
 const notificationDefaults={emailEnabled:false,localAlertsEnabled:true,readIds:[],dismissedIds:[]};
 if(!state.notificationSettings||typeof state.notificationSettings!=='object'){state.notificationSettings={...notificationDefaults};migrated=true}else state.notificationSettings={...notificationDefaults,...state.notificationSettings,readIds:Array.isArray(state.notificationSettings.readIds)?state.notificationSettings.readIds.map(String).slice(-250):[],dismissedIds:Array.isArray(state.notificationSettings.dismissedIds)?state.notificationSettings.dismissedIds.map(String).slice(-500):[]};
 const appearanceDefaults={sidebarColor:'#ffffff',topbarColor:'#ffffff',highlightColor:'#2563eb'};
 if(!state.appearanceSettings||typeof state.appearanceSettings!=='object'){state.appearanceSettings={...appearanceDefaults};migrated=true}else state.appearanceSettings={...appearanceDefaults,...state.appearanceSettings,sidebarColor:normalizePanelColor(state.appearanceSettings.sidebarColor,appearanceDefaults.sidebarColor),topbarColor:normalizePanelColor(state.appearanceSettings.topbarColor,appearanceDefaults.topbarColor),highlightColor:normalizePanelColor(state.appearanceSettings.highlightColor,appearanceDefaults.highlightColor)};
 if(!Array.isArray(state.systemNotices)){state.systemNotices=[];migrated=true}
 state.systemNotices=state.systemNotices.filter(item=>item&&item.id&&item.title).slice(-100);
 if(!Array.isArray(state.vehicles)){state.vehicles=[];migrated=true}
 const legacyVehicle=state.vehicle&&typeof state.vehicle==='object'?state.vehicle:null;
 const hasLegacyVehicle=Boolean(legacyVehicle&&(legacyVehicle.id||legacyVehicle.make||legacyVehicle.model||legacyVehicle.name||Number(state.mileage||legacyVehicle.mileage||0)>0));
 if(!state.vehicles.length&&hasLegacyVehicle){
   const mileage=Number(state.mileage||legacyVehicle.mileage||0),history=Array.isArray(state.mileageHistory)&&state.mileageHistory.length?state.mileageHistory:Array.isArray(legacyVehicle.mileageHistory)&&legacyVehicle.mileageHistory.length?legacyVehicle.mileageHistory:[{date:new Date().toISOString(),mileage,source:'Initial record'}];
   state.vehicles=[{...defaults,...legacyVehicle,id:String(legacyVehicle.id||makeVehicleId()),mileage,mileageHistory:history,metrics:{averageMpg:0,...(state.metrics||legacyVehicle.metrics||{})}}];migrated=true
 }
 if(!state.vehicles.length){
   state.activeVehicleId='';state.vehicle=null;state.mileage=0;state.mileageHistory=[];state.metrics={averageMpg:0};state.setupStatus='pending';state.stateSchemaVersion=2;
   state.savedReports=[];
   state.documents=state.documents.map(doc=>({...doc,originalName:doc.originalName||(fileExtension(doc.name)?doc.name:(doc.storedName||doc.name)),tags:Array.isArray(doc.tags)?doc.tags:documentTags(doc),folderId:doc.folderId||null,ocrText:doc.ocrText||'',ocrStatus:doc.ocrStatus||'not-indexed',linkedExpenseId:doc.linkedExpenseId||null}));
   return migrated
 }
 state.vehicles=state.vehicles.map((vehicle,index)=>{const v={...defaults,...vehicle};if(!v.id){v.id=makeVehicleId();migrated=true}v.id=String(v.id);v.name=v.name||[v.year,v.make,v.model].filter(Boolean).join(' ')||`Vehicle ${index+1}`;v.type=v.type||inferVehicleType(v);v.lifecycleStatus=['Active','Sold','Decommissioned'].includes(v.lifecycleStatus)?v.lifecycleStatus:'Active';v.acquiredDate=String(v.acquiredDate||'');const acquiredMileageRaw=v.acquiredMileage;v.acquiredMileage=acquiredMileageRaw===null||acquiredMileageRaw===undefined||acquiredMileageRaw===''?null:Math.max(0,Number(acquiredMileageRaw)||0);v.mileage=Number((v.mileage??(index===0?state.mileage:0))||0);v.mileageHistory=Array.isArray(v.mileageHistory)&&v.mileageHistory.length?v.mileageHistory:[{date:new Date().toISOString(),mileage:v.mileage,source:'Initial record'}];v.metrics={averageMpg:0,...(v.metrics||{})};return v});
 const validIds=new Set(state.vehicles.map(v=>String(v.id)));
 const legacyId=String(state.vehicle?.id||'');
 let preferredId=validIds.has(String(state.activeVehicleId))?String(state.activeVehicleId):validIds.has(legacyId)?legacyId:String(state.vehicles.find(v=>!isVehicleArchived(v))?.id||state.vehicles[0].id);
 const recordContextVersion=1;
 if(Number(state.recordContextVersion||0)<recordContextVersion){
   const linkedCollections=['expenses','maintenance','documents','reminders'],ownerCounts=new Map();
   for(const collection of linkedCollections){for(const item of state[collection]){const ownerId=String(item?.vehicleId||'');if(validIds.has(ownerId))ownerCounts.set(ownerId,(ownerCounts.get(ownerId)||0)+1)}}
   const activeLinkedCount=ownerCounts.get(preferredId)||0,recordOwners=[...ownerCounts.entries()].filter(([,count])=>count>0);
   if(activeLinkedCount===0&&recordOwners.length===1)preferredId=recordOwners[0][0];state.recordContextVersion=recordContextVersion;migrated=true
 }
 if(String(state.activeVehicleId)!==preferredId){state.activeVehicleId=preferredId;migrated=true}
 state.savedReports=state.savedReports.filter(item=>item&&item.id&&item.templateId).map(item=>({...item,vehicleId:String(item.vehicleId||preferredId),ownerUserId:String(item.ownerUserId||''),customRange:item.customRange&&typeof item.customRange==='object'?item.customRange:{start:'',end:''}}));
 state.maintenance=state.maintenance.filter(x=>String(x?.name||'').trim().toLowerCase()!=='test');
 for(const collection of ['expenses','maintenance','documents','reminders'])state[collection]=state[collection].map(item=>{const x={...item};if(!x.id){x.id=makeRecordId(collection.slice(0,-1));migrated=true}const linkedVehicleId=String(x.vehicleId||'');if(!linkedVehicleId||!validIds.has(linkedVehicleId)){x.vehicleId=preferredId;migrated=true}else if(x.vehicleId!==linkedVehicleId){x.vehicleId=linkedVehicleId;migrated=true}return x});
 state.documents=state.documents.map(doc=>({...doc,originalName:doc.originalName||(fileExtension(doc.name)?doc.name:(doc.storedName||doc.name)),tags:Array.isArray(doc.tags)?doc.tags:documentTags(doc),folderId:doc.folderId||null,ocrText:doc.ocrText||'',ocrStatus:doc.ocrStatus||'not-indexed',linkedExpenseId:doc.linkedExpenseId||null}));
 state.setupStatus='complete';state.stateSchemaVersion=2;activateVehicle(state.activeVehicleId,false);state.vehicle={...activeVehicle()};return migrated
}

function initialSetupDefaults(){return{step:1,type:'Car',powertrain:'Gasoline / Internal Combustion',year:'',make:'',model:'',trim:'',vin:'',engine:'',drivetrain:'',color:'',acquiredDate:'',acquiredMileage:'',mileage:'0',mileageDate:new Date().toISOString().slice(0,10),localAlerts:true,emailEnabled:false,odometerReminder:true,registrationDate:'',insuranceDate:''}}
function firstRunSetup(){return firstRunSetupState||(firstRunSetupState=initialSetupDefaults())}
function collectFirstRunSetup(){const s=firstRunSetup();document.querySelectorAll('[data-first-run-field]').forEach(control=>{s[control.dataset.firstRunField]=control.type==='checkbox'?control.checked:control.value})}
function firstRunProgress(step){return `<div class="first-run-progress">${['Welcome','Vehicle','Tracking','Finish'].map((label,index)=>`<span class="${index+1<=step?'active':''}"><b>${index+1}</b><small>${label}</small></span>`).join('<i></i>')}</div>`}
function firstRunVehicleDetailsFields(s){
 const isTrailer=s.type==='Trailer',drivetrainLabel=s.type==='Motorcycle'?'Final Drive / Drivetrain':'Drivetrain';
 return `<div class="first-run-form-grid">
  <label>Vehicle type<select data-first-run-field="type" onchange="firstRunVehicleTypeChanged(this.value)">${['Car','Truck','Motorcycle','Trailer'].map(value=>`<option ${s.type===value?'selected':''}>${value}</option>`).join('')}</select></label>
  <label>Powertrain<select data-first-run-field="powertrain">${VEHICLE_POWERTRAINS.map(value=>`<option ${s.powertrain===value?'selected':''}>${value}</option>`).join('')}</select></label>
  <label>Year<input data-first-run-field="year" inputmode="numeric" maxlength="4" value="${esc(s.year)}" placeholder="2020"></label>
  <label>Make<input data-first-run-field="make" maxlength="50" value="${esc(s.make)}" placeholder="Vehicle make" required></label>
  <label>Model<input data-first-run-field="model" maxlength="50" value="${esc(s.model)}" placeholder="Vehicle model" required></label>
  <label>Trim <span>Optional</span><input data-first-run-field="trim" maxlength="60" value="${esc(s.trim)}" placeholder="Optional trim"></label>
  <label class="first-run-wide">VIN <span>Optional</span><input data-first-run-field="vin" maxlength="32" value="${esc(s.vin)}" placeholder="Vehicle identification number"></label>
  <label>Color <span>Optional</span><input data-first-run-field="color" maxlength="50" value="${esc(s.color)}" placeholder="Exterior color"></label>
  <label>Purchase / Acquired Date <span>Optional</span><input data-first-run-field="acquiredDate" type="date" value="${esc(s.acquiredDate)}"></label>
  ${isTrailer?'':`<label>Mileage at Acquisition <span>Optional</span><input data-first-run-field="acquiredMileage" type="number" min="0" step="1" value="${esc(s.acquiredMileage)}" placeholder="Odometer when acquired"></label><label>Engine / Motor <span>Optional</span><input data-first-run-field="engine" maxlength="100" value="${esc(s.engine)}" placeholder="Engine or motor"></label><label>${drivetrainLabel} <span>Optional</span><input data-first-run-field="drivetrain" maxlength="100" value="${esc(s.drivetrain)}" placeholder="${s.type==='Motorcycle'?'Belt, chain, shaft, etc.':'FWD, RWD, AWD, 4WD, etc.'}"></label>`}
 </div>`
}
function firstRunStepContent(s){
 if(s.step===1)return `<div class="first-run-welcome"><span class="first-run-hero-icon">${svg('car')}</span><span class="wizard-eyebrow">FIRST VEHICLE SETUP</span><h1>Set up GarageLog</h1><p>This short guide creates the first vehicle and explains the settings that affect reminders and local access.</p><div class="first-run-feature-grid"><article>${svg('shield')}<div><strong>Stored locally</strong><small>Vehicle records, documents, and account data stay on this GarageLog instance.</small></div></article><article>${svg('gauge')}<div><strong>Mileage drives forecasts</strong><small>An accurate starting odometer helps calculate service intervals and tracked cost per mile.</small></div></article><article>${svg('bell')}<div><strong>Bell notifications</strong><small>Due reminders, maintenance alerts, document tasks, and system notices appear in the top-right bell.</small></div></article><article>${svg('info')}<div><strong>No GPS tracking</strong><small>GarageLog does not need or collect location data for vehicle maintenance tracking.</small></div></article></div></div>`;
 if(s.step===2)return `<div class="first-run-form-step"><span class="wizard-eyebrow">VEHICLE DETAILS</span><h1>Add your first vehicle</h1><p>Enter the vehicle identity and configuration you know now. These values can be changed later from My Garage.</p>${firstRunVehicleDetailsFields(s)}</div>`;
 if(s.step===3)return `<div class="first-run-form-step"><span class="wizard-eyebrow">TRACKING & ALERTS</span><h1>Choose the starting point</h1><p>GarageLog uses recorded values only. It does not estimate mileage that was never entered.</p><div class="first-run-tracking-grid"><section><h3>Odometer</h3><div class="first-run-form-grid"><label>Current mileage<input data-first-run-field="mileage" type="number" min="0" step="1" value="${esc(s.mileage)}"></label><label>Reading date<input data-first-run-field="mileageDate" type="date" value="${esc(s.mileageDate)}"></label></div><label class="first-run-check"><input data-first-run-field="odometerReminder" type="checkbox" ${s.odometerReminder?'checked':''}><span><strong>Create a monthly odometer reminder</strong><small>Keeping mileage current improves maintenance and cost-per-mile calculations.</small></span></label></section><section><h3>Optional renewal dates</h3><div class="first-run-form-grid"><label>Registration expires <span>Optional</span><input data-first-run-field="registrationDate" type="date" value="${esc(s.registrationDate)}"></label><label>Insurance renews <span>Optional</span><input data-first-run-field="insuranceDate" type="date" value="${esc(s.insuranceDate)}"></label></div><h3>Notification preferences</h3><label class="first-run-check"><input data-first-run-field="localAlerts" type="checkbox" ${s.localAlerts?'checked':''}><span><strong>Bell and pop-up alerts</strong><small>Shows due reminders and local system tasks inside GarageLog.</small></span></label><label class="first-run-check"><input data-first-run-field="emailEnabled" type="checkbox" ${s.emailEnabled?'checked':''}><span><strong>Email notification preference</strong><small>This stores the preference only. Email delivery still needs a future SMTP configuration.</small></span></label></section></div></div>`;
 const acquisitionDetails=[s.acquiredDate?`Acquired: ${new Date(`${s.acquiredDate}T12:00:00`).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`:'',s.type!=='Trailer'&&s.acquiredMileage!==''?`At ${number(Number(s.acquiredMileage||0))} mi`:'' ].filter(Boolean);
 const identityDetails=[s.color?`Color: ${s.color}`:'',s.vin?`VIN: ${s.vin}`:'',s.type!=='Trailer'&&s.engine?`Engine: ${s.engine}`:'',s.type!=='Trailer'&&s.drivetrain?`${s.type==='Motorcycle'?'Final drive':'Drivetrain'}: ${s.drivetrain}`:'',...acquisitionDetails].filter(Boolean);
 return `<div class="first-run-review"><span class="wizard-eyebrow">REVIEW</span><h1>Ready to create the garage</h1><p>Nothing is uploaded externally. You can change every item later.</p><div class="first-run-review-grid"><article><small>Vehicle</small><strong>${esc([s.year,s.make,s.model].filter(Boolean).join(' ')||'Unnamed vehicle')}</strong><span>${esc(s.trim||s.type)} · ${esc(s.powertrain)}</span>${identityDetails.length?`<span class="first-run-review-detail">${esc(identityDetails.join(' · '))}</span>`:''}</article><article><small>Starting mileage</small><strong>${number(Number(s.mileage||0))} mi</strong><span>${esc(s.mileageDate||'Today')}</span></article><article><small>Bell alerts</small><strong>${s.localAlerts?'Enabled':'Disabled'}</strong><span>${s.odometerReminder?'Monthly odometer reminder included':'No starter odometer reminder'}</span></article><article><small>Email</small><strong>${s.emailEnabled?'Preference enabled':'Off'}</strong><span>Mail-server delivery is not configured yet.</span></article></div><div class="first-run-final-note">After setup, open Maintenance or Reminders to add manufacturer-specific service intervals. GarageLog will not create estimated maintenance schedules without your input.</div></div>`
}
window.firstRunVehicleTypeChanged=function(value){collectFirstRunSetup();const s=firstRunSetup();s.type=value;render()}

function firstRunSetupPage(){const s=firstRunSetup();return `<div class="first-run-page"><section class="first-run-card">${firstRunProgress(s.step)}<div class="first-run-body">${firstRunStepContent(s)}</div><div class="first-run-actions">${s.step>1?'<button class="secondary" type="button" onclick="firstRunSetupBack()">Back</button>':'<span></span>'}<button class="primary" type="button" onclick="${s.step===4?'finishFirstRunSetup()':'firstRunSetupNext()'}">${s.step===4?'Create Garage':'Continue'} ${svg(s.step===4?'check':'chevronRight')}</button></div></section></div>`}
window.firstRunSetupBack=function(){collectFirstRunSetup();const s=firstRunSetup();s.step=Math.max(1,s.step-1);render()}
window.firstRunSetupNext=function(){collectFirstRunSetup();const s=firstRunSetup();if(s.step===2){if(!String(s.make).trim()||!String(s.model).trim()){toast('Enter the vehicle make and model');return}if(s.type!=='Trailer'&&s.acquiredMileage!==''&&(!Number.isFinite(Number(s.acquiredMileage))||Number(s.acquiredMileage)<0)){toast('Enter a valid mileage at acquisition');return}}if(s.step===3){const currentMileage=Number(s.mileage);if(!Number.isFinite(currentMileage)||currentMileage<0){toast('Enter a valid current mileage');return}if(s.type!=='Trailer'&&s.acquiredMileage!==''&&Number(s.acquiredMileage)>currentMileage){toast('Mileage at acquisition cannot be greater than current mileage');return}}s.step=Math.min(4,s.step+1);render()}
window.finishFirstRunSetup=async function(){collectFirstRunSetup();const s=firstRunSetup(),button=document.querySelector('.first-run-actions .primary');if(!String(s.make).trim()||!String(s.model).trim()){s.step=2;render();toast('Enter the vehicle make and model');return}const mileage=Number(s.mileage||0),hasAcquiredMileage=s.type!=='Trailer'&&s.acquiredMileage!==''&&s.acquiredMileage!==null&&s.acquiredMileage!==undefined,acquiredMileage=hasAcquiredMileage?Number(s.acquiredMileage):null;if(!Number.isFinite(mileage)||mileage<0){s.step=3;render();toast('Enter a valid current mileage');return}if(hasAcquiredMileage&&(!Number.isFinite(acquiredMileage)||acquiredMileage<0)){s.step=2;render();toast('Enter a valid mileage at acquisition');return}if(hasAcquiredMileage&&acquiredMileage>mileage){s.step=3;render();toast('Mileage at acquisition cannot be greater than current mileage');return}if(button){button.disabled=true;button.textContent='Creating…'}const id=makeVehicleId(),readingDate=s.mileageDate||new Date().toISOString().slice(0,10),acquiredDate=String(s.acquiredDate||'').trim(),mileageHistory=[];if(hasAcquiredMileage&&acquiredDate)mileageHistory.push({date:acquiredDate,mileage:acquiredMileage,source:'Vehicle acquired'});if(!hasAcquiredMileage||!acquiredDate||acquiredMileage!==mileage||acquiredDate!==readingDate)mileageHistory.push({date:readingDate,mileage,source:'Initial setup'});const vehicle={id,type:s.type,powertrain:s.powertrain,year:String(s.year||'').trim(),make:String(s.make).trim(),model:String(s.model).trim(),name:[s.year,s.make,s.model].filter(Boolean).join(' '),trim:String(s.trim||'').trim(),engine:s.type==='Trailer'?'':String(s.engine||'').trim(),transmission:'',vin:String(s.vin||'').trim(),drivetrain:s.type==='Trailer'?'':String(s.drivetrain||'').trim(),color:String(s.color||'').trim(),acquiredDate,acquiredMileage:hasAcquiredMileage?acquiredMileage:null,imageStoredName:null,lifecycleStatus:'Active',mileage,mileageHistory,metrics:{averageMpg:0}};state.vehicles=[vehicle];state.activeVehicleId=id;state.vehicle=vehicle;state.mileage=mileage;state.mileageHistory=vehicle.mileageHistory;state.metrics=vehicle.metrics;state.setupStatus='complete';state.notificationSettings={...notificationSettings(),localAlertsEnabled:Boolean(s.localAlerts),emailEnabled:Boolean(s.emailEnabled)};const reminders=[];if(s.odometerReminder){const due=new Date(`${readingDate}T12:00:00`);due.setMonth(due.getMonth()+1);reminders.push({id:makeRecordId('reminder'),vehicleId:id,name:'Update Odometer Reading',rule:'Every month',due:due.toISOString().slice(0,10),status:'Upcoming',triggerType:'recurring',frequency:1,frequencyUnit:'months',createdAt:new Date().toISOString()})}if(s.registrationDate)reminders.push({id:makeRecordId('reminder'),vehicleId:id,name:'Registration Renewal',rule:'Specific date',due:s.registrationDate,status:'Upcoming',triggerType:'date',createdAt:new Date().toISOString()});if(s.insuranceDate)reminders.push({id:makeRecordId('reminder'),vehicleId:id,name:'Insurance Renewal',rule:'Specific date',due:s.insuranceDate,status:'Upcoming',triggerType:'date',createdAt:new Date().toISOString()});state.reminders.push(...reminders);state.systemNotices.push({id:`system:setup-complete:${Date.now()}`,title:'GarageLog setup complete',detail:`${vehicle.name} is ready. Open the bell to review notifications or add maintenance schedules.`,page:'Garage',tone:'green',icon:'check',createdAt:new Date().toISOString()});try{await saveNow();firstRunSetupState=null;current='Dashboard';toast('GarageLog setup complete');render()}catch(error){console.error(error);toast(error.message||'Unable to complete setup');if(button)button.disabled=false}}

function inferVehicleType(vehicle){const text=`${vehicle.make||''} ${vehicle.model||''}`.toLowerCase();if(/trailer|utility|hauler/.test(text))return'Trailer';if(/harley|motorcycle|bike|indian|ducati|yamaha|kawasaki|suzuki/.test(text))return'Motorcycle';if(/ram|silverado|f-?150|tundra|tacoma|sierra|truck/.test(text))return'Truck';return'Car'}
function activeVehicle(){return state?.vehicles?.find(v=>v.id===state.activeVehicleId)||state?.vehicles?.[0]||null}
function isVehicleArchived(vehicle){return ['Sold','Decommissioned'].includes(String(vehicle?.lifecycleStatus||'Active'))}
function activeFleetVehicles(){return (state?.vehicles||[]).filter(vehicle=>!isVehicleArchived(vehicle))}
function persistActiveVehicle(){const vehicle=activeVehicle();if(!vehicle)return;vehicle.mileage=Number(state.mileage||0);vehicle.mileageHistory=state.mileageHistory||[];vehicle.metrics=state.metrics||{averageMpg:0};state.vehicle={...vehicle}}
function activateVehicle(id,shouldRender=true){persistActiveVehicle();const vehicle=state.vehicles.find(v=>v.id===id)||state.vehicles[0];if(!vehicle)return;state.activeVehicleId=vehicle.id;state.vehicle=vehicle;state.mileage=Number(vehicle.mileage||0);state.mileageHistory=vehicle.mileageHistory;state.metrics=vehicle.metrics;if(shouldRender){if(canWrite())save('Active vehicle changed');render()}}
const VEHICLE_DEFAULT_IMAGES={Car:'/assets/default-car.png',Truck:'/assets/default-truck.png',Motorcycle:'/assets/default-motorcycle.png',Trailer:'/assets/default-trailer.png'};
function vehicleDefaultImageUrl(vehicle=state.vehicle){return VEHICLE_DEFAULT_IMAGES[normalizedVehicleType(vehicle)]||VEHICLE_DEFAULT_IMAGES.Car}
function vehicleImageUrl(vehicle=state.vehicle){return vehicle?.imageStoredName?`/api/vehicle-image/${encodeURIComponent(vehicle.imageStoredName)}`:vehicleDefaultImageUrl(vehicle)}
function vehicleFullName(vehicle=state.vehicle){return `${vehicle?.name||[vehicle?.year,vehicle?.make,vehicle?.model].filter(Boolean).join(' ')} ${vehicle?.trim||''}`.trim()}
function recordsFor(collection,vehicleId=state?.activeVehicleId){return (state?.[collection]||[]).filter(x=>String(x.vehicleId)===String(vehicleId))}
function activeExpenses(){return recordsFor('expenses')}
function activeMaintenance(){return recordsFor('maintenance')}
function activeDocuments(){return recordsFor('documents')}
function activeReminders(){return recordsFor('reminders')}
function recordGroupsForOtherVehicles(collection){
 const counts=new Map();
 for(const item of state[collection]||[]){const id=String(item?.vehicleId||'');if(!id||id===String(state.activeVehicleId))continue;counts.set(id,(counts.get(id)||0)+1)}
 return [...counts.entries()].map(([vehicleId,count])=>({vehicle:state.vehicles.find(v=>String(v.id)===vehicleId),vehicleId,count})).filter(x=>x.vehicle).sort((a,b)=>b.count-a.count)
}
function otherVehicleRecordNotice(collection,label){
 if(recordsFor(collection).length)return'';
 const groups=recordGroupsForOtherVehicles(collection);if(!groups.length)return'';
 const total=groups.reduce((sum,item)=>sum+item.count,0),plural=total===1?label:`${label}s`;
 return `<div class="record-context-notice"><span class="record-context-icon">${svg('info')}</span><div><strong>No ${esc(plural.toLowerCase())} are linked to ${esc(vehicleFullName(activeVehicle()))}.</strong><p>${number(total)} ${esc(plural.toLowerCase())} ${total===1?'is':'are'} linked to ${groups.length===1?esc(vehicleFullName(groups[0].vehicle)):'other vehicles'}.</p></div><div class="record-context-actions">${groups.slice(0,3).map(item=>`<button type="button" onclick="openVehicleRecords(${attrJs(item.vehicleId)},${attrJs(current)})">${esc(vehicleFullName(item.vehicle))} <b>${item.count}</b></button>`).join('')}</div></div>`
}
function otherVehicleDataNotice(){
 const collections=[['maintenance','maintenance item'],['expenses','expense'],['reminders','reminder'],['documents','document']];
 const activeTotal=collections.reduce((sum,[collection])=>sum+recordsFor(collection).length,0);if(activeTotal)return'';
 const vehicles=state.vehicles.filter(v=>String(v.id)!==String(state.activeVehicleId)).map(vehicle=>({vehicle,total:collections.reduce((sum,[collection])=>sum+recordsFor(collection,vehicle.id).length,0)})).filter(x=>x.total>0).sort((a,b)=>b.total-a.total);
 if(!vehicles.length)return'';
 return `<div class="record-context-notice dashboard-record-notice"><span class="record-context-icon">${svg('info')}</span><div><strong>This active vehicle has no linked records.</strong><p>Your existing data is still stored under another vehicle. Switch context to view it.</p></div><div class="record-context-actions">${vehicles.slice(0,3).map(item=>`<button type="button" onclick="openVehicleRecords(${attrJs(item.vehicle.id)},'Dashboard')">${esc(vehicleFullName(item.vehicle))} <b>${item.total}</b></button>`).join('')}</div></div>`
}
function parseRecordDate(value){
 if(!value)return null;
 if(value instanceof Date)return Number.isNaN(value.getTime())?null:new Date(value.getTime());
 const raw=String(value).trim();
 let match=raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
 if(match)return new Date(Number(match[1]),Number(match[2])-1,Number(match[3]),12);
 match=raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+.*)?$/);
 if(match)return new Date(Number(match[3]),Number(match[1])-1,Number(match[2]),12);
 const direct=new Date(raw);
 return Number.isNaN(direct.getTime())?null:direct
}
function recordYear(value){return parseRecordDate(value)?.getFullYear()??null}
function recordMonthKey(value){const date=parseRecordDate(value);return date?`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`:''}
function finitePositive(value){const numberValue=Number(value);return Number.isFinite(numberValue)&&numberValue>0?numberValue:null}
function fuelGallonsFromRecord(item){const stored=finitePositive(item?.gallons);if(stored)return stored;const match=String(item?.notes||'').match(/(?:^|\s)(\d+(?:\.\d+)?)\s*(?:gal(?:lons?)?)(?:\s|@|$)/i);return match?finitePositive(match[1]):null}
function fuelMpgFromRecord(item){const stored=finitePositive(item?.mpg);if(stored)return stored;const match=String(item?.notes||'').match(/(?:^|\s)(\d+(?:\.\d+)?)\s*mpg(?:\s|$)/i);return match?finitePositive(match[1]):null}
function odometerReadings(vehicleId=state.activeVehicleId){
 const vehicle=state.vehicles.find(item=>String(item.id)===String(vehicleId))||activeVehicle(),readings=[];
 (vehicle?.mileageHistory||[]).forEach((item,index)=>{const date=parseRecordDate(item?.date),mileage=Number(item?.mileage);if(date&&Number.isFinite(mileage)&&mileage>=0)readings.push({date,mileage,source:String(item?.source||'Recorded odometer'),kind:'history',recordId:String(item?.expenseId||item?.id||`history-${index}`)})});
 recordsFor('expenses',vehicleId).filter(item=>String(item?.category||'').toLowerCase()==='fuel').forEach(item=>{const date=parseRecordDate(item?.date),mileage=finitePositive(item?.odometer);if(date&&mileage)readings.push({date,mileage,source:`Fuel entry${item.vendor?` · ${item.vendor}`:''}`,kind:'fuel',recordId:String(item.id||'')})});
 readings.sort((a,b)=>a.date-b.date||a.mileage-b.mileage||a.kind.localeCompare(b.kind));
 const deduped=[],keys=new Set();
 for(const reading of readings){const key=`${reading.date.toISOString().slice(0,10)}|${reading.mileage}`;if(keys.has(key))continue;keys.add(key);deduped.push(reading)}
 return deduped
}
function fuelEconomyPoints(vehicleId=state.activeVehicleId){
 const readings=odometerReadings(vehicleId),fills=recordsFor('expenses',vehicleId).filter(item=>String(item?.category||'').toLowerCase()==='fuel').map(item=>({item,date:parseRecordDate(item.date),gallons:fuelGallonsFromRecord(item),odometer:finitePositive(item?.odometer),explicitMpg:fuelMpgFromRecord(item),fullTank:item?.fullTank!==false})).filter(fill=>fill.date).sort((a,b)=>a.date-b.date||Number(a.odometer||0)-Number(b.odometer||0));
 let previousFullOdometer=null;const points=[];
 for(const fill of fills){
   let mpg=fill.explicitMpg,source=mpg?'entered':'calculated',baselineMileage=null;
   if(!mpg&&fill.fullTank&&fill.gallons&&fill.odometer){
     if(previousFullOdometer!==null&&previousFullOdometer<fill.odometer)baselineMileage=previousFullOdometer;
     if(baselineMileage===null){
       const candidates=readings.filter(reading=>reading.recordId!==String(fill.item.id||'')&&reading.mileage<fill.odometer&&reading.date<=localDateEnd(fill.date));
       baselineMileage=candidates.at(-1)?.mileage??null;
       if(baselineMileage!==null)source='odometer-baseline';
     }
     if(baselineMileage!==null){const miles=fill.odometer-baselineMileage,computed=miles/fill.gallons;if(miles>0&&computed>=1&&computed<=200)mpg=computed}
   }
   if(mpg){const dateLabel=fill.date.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'2-digit'});points.push({key:`${fill.date.toISOString().slice(0,10)}-${fill.item.id||points.length}`,date:fill.date,label:dateLabel,value:mpg,count:1,source,item:fill.item,baselineMileage,provisional:source==='odometer-baseline'})}
   if(fill.fullTank&&fill.odometer)previousFullOdometer=fill.odometer;
 }
 return points
}
function filterFuelEconomyPoints(points,range,customMonths=6){const now=new Date(),year=now.getFullYear();if(range==='this-year')return points.filter(point=>point.date.getFullYear()===year);if(range==='last-year')return points.filter(point=>point.date.getFullYear()===year-1);const months=range==='3-months'?3:range==='6-months'?6:range==='custom'?Math.max(1,Number(customMonths)||6):null;if(!months)return [...points];const start=new Date(now.getFullYear(),now.getMonth()-months+1,1,0,0,0,0);return points.filter(point=>point.date>=start&&point.date<=now)}
function fuelAxisModel(points){const values=points.map(point=>Number(point.value)).filter(Number.isFinite);if(!values.length)return{min:0,max:30,ticks:[30,24,18,12,6,0]};let min=Math.max(0,Math.floor((Math.min(...values)-2)/5)*5),max=Math.ceil((Math.max(...values)+2)/5)*5;if(max-min<10){const midpoint=(max+min)/2;min=Math.max(0,Math.floor((midpoint-5)/5)*5);max=Math.ceil((midpoint+5)/5)*5}if(max<=min)max=min+10;return{min,max,ticks:Array.from({length:6},(_,index)=>max-(max-min)*(index/5))}}
function yearExpenses(vehicleId=state.activeVehicleId,year=new Date().getFullYear()){return recordsFor('expenses',vehicleId).filter(item=>recordYear(item.date)===Number(year))}
function monthlyExpenseSeries(){const totals=new Map();yearExpenses().forEach(item=>{const key=recordMonthKey(item.date);if(key)totals.set(key,(totals.get(key)||0)+Number(item.amount||0))});const months=[...totals.entries()].sort((a,b)=>a[0].localeCompare(b[0])).slice(-8);return months.length?months.map(([key,value])=>({label:new Date(`${key}-01T12:00:00`).toLocaleDateString('en-US',{month:'short'}),value})):[{label:'No data',value:0}]}

function localDateStart(value){
 const date=value instanceof Date?new Date(value):parseRecordDate(value);
 return date?new Date(date.getFullYear(),date.getMonth(),date.getDate(),0,0,0,0):null
}
function localDateEnd(value){
 const date=value instanceof Date?new Date(value):parseRecordDate(value);
 return date?new Date(date.getFullYear(),date.getMonth(),date.getDate(),23,59,59,999):null
}
function localMonthStart(value){
 const date=value instanceof Date?new Date(value):parseRecordDate(value);
 return date?new Date(date.getFullYear(),date.getMonth(),1,0,0,0,0):null
}
function localMonthEnd(value){
 const date=value instanceof Date?new Date(value):parseRecordDate(value);
 return date?new Date(date.getFullYear(),date.getMonth()+1,0,23,59,59,999):null
}
function expenseAvailableYears(expenses=activeExpenses()){
 return [...new Set((expenses||[]).map(item=>recordYear(item?.date)).filter(year=>Number.isInteger(year)))].sort((a,b)=>b-a)
}
function expensePeriodOptions(expenses=activeExpenses(),{includeRolling=true,includeCustom=true,includeAllTime=false}={}){
 const options=[['this-year','This Year'],['last-year','Last Year']];
 if(includeRolling)options.push(['last-6-months','Last 6 Months'],['last-3-months','Last 3 Months']);
 if(includeCustom)options.push(['custom','Custom Range…']);
 return options
}
function resolveExpenseDateRange(period='this-year',customRange={},expenses=activeExpenses(),referenceDate=new Date()){
 const now=referenceDate instanceof Date&&!Number.isNaN(referenceDate.getTime())?new Date(referenceDate):new Date();
 const currentYear=now.getFullYear(),todayEnd=localDateEnd(now);
 let start,end,label,normalized=period;
 const yearMatch=String(period||'').match(/^year-(\d{4})$/);
 if(yearMatch){
   const year=Number(yearMatch[1]);start=new Date(year,0,1,0,0,0,0);end=new Date(year,11,31,23,59,59,999);label=String(year);
 }else if(period==='last-year'){
   const year=currentYear-1;normalized='last-year';start=new Date(year,0,1,0,0,0,0);end=new Date(year,11,31,23,59,59,999);label=`Last Year (${year})`;
 }else if(period==='last-12-months'||period==='last-6-months'||period==='last-3-months'){
   const months=period==='last-12-months'?12:period==='last-6-months'?6:3;
   start=new Date(now.getFullYear(),now.getMonth()-months+1,1,0,0,0,0);end=todayEnd;label=`Last ${months} Months`;
 }else if(period==='all-time'){
   const dates=(expenses||[]).map(item=>parseRecordDate(item?.date)).filter(Boolean).sort((a,b)=>a-b);
   if(dates.length){start=localDateStart(dates[0]);end=localDateEnd(dates.at(-1));label='All Recorded'}
   else{start=new Date(currentYear,0,1,0,0,0,0);end=todayEnd;label='All Recorded'}
 }else if(period==='custom'&&customRange?.start&&customRange?.end){
   start=localDateStart(customRange.start);end=localDateEnd(customRange.end);label=`${start.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})} – ${end.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`;
 }else{
   normalized='this-year';start=new Date(currentYear,0,1,0,0,0,0);end=new Date(currentYear,11,31,23,59,59,999);label=`This Year (${currentYear})`;
 }
 if(!start||!end||Number.isNaN(start.getTime())||Number.isNaN(end.getTime())||start>end){
   normalized='this-year';start=new Date(currentYear,0,1,0,0,0,0);end=new Date(currentYear,11,31,23,59,59,999);label=`This Year (${currentYear})`;
 }
 return{period:normalized,start,end,label};
}
function expensesWithinRange(expenses,range){
 return (expenses||[]).filter(item=>{const date=parseRecordDate(item?.date);return date&&date>=range.start&&date<=range.end})
}
function reportPeriodSummarySuffix(period,range){
 const normalized=String(period||range?.period||'this-year');
 if(normalized==='this-year')return 'this year';
 if(normalized==='last-year')return 'last year';
 if(normalized==='last-6-months')return 'in the last 6 months';
 if(normalized==='last-3-months')return 'in the last 3 months';
 if(normalized==='last-12-months')return 'in the last 12 months';
 if(normalized==='all-time')return 'all time';
 if(normalized==='custom')return 'in the selected period';
 const yearMatch=normalized.match(/^year-(\d{4})$/);
 if(yearMatch)return `in ${yearMatch[1]}`;
 return 'in the selected period';
}
function buildExpenseMonthBuckets(expenses,range,categoryOrder,categoryResolver){
 const buckets=[];
 for(let cursor=localMonthStart(range.start),guard=0;cursor&&cursor<=range.end&&guard<240;cursor=new Date(cursor.getFullYear(),cursor.getMonth()+1,1,0,0,0,0),guard++){
   buckets.push({key:`${cursor.getFullYear()}-${String(cursor.getMonth()+1).padStart(2,'0')}`,label:cursor.toLocaleDateString('en-US',{month:'short'}),year:cursor.getFullYear(),values:Object.fromEntries(categoryOrder.map(category=>[category,0])),total:0});
 }
 const byKey=new Map(buckets.map(bucket=>[bucket.key,bucket]));
 expensesWithinRange(expenses,range).forEach(item=>{
   const bucket=byKey.get(recordMonthKey(item?.date));if(!bucket)return;
   const amount=Number(item?.amount||0);if(!Number.isFinite(amount))return;
   const category=categoryResolver(item?.category);if(!(category in bucket.values))return;
   bucket.values[category]+=amount;bucket.total+=amount;
 });
 return buckets
}
function mileageHistoryForRange(vehicle,range){
 const history=(vehicle?.mileageHistory||[]).map(item=>({date:parseRecordDate(item?.date),mileage:Number(item?.mileage)})).filter(item=>item.date&&Number.isFinite(item.mileage)).sort((a,b)=>a.date-b.date);
 if(!history.length)return[];
 const inside=history.filter(item=>item.date>=range.start&&item.date<=range.end);
 if(!inside.length)return[];
 const before=history.filter(item=>item.date<range.start).at(-1);
 const points=[...(before?[before]:[]),...inside];
 return points.filter((item,index,array)=>index===0||item.date.getTime()!==array[index-1].date.getTime()||item.mileage!==array[index-1].mileage)
}

function shortDate(value){const date=parseRecordDate(value);return date?date.toLocaleDateString('en-US',{month:'short',day:'numeric'}):String(value||'')}
function optionalMoney(value){return value===null||value===undefined||!Number.isFinite(Number(value))?'—':money(value)}
function normalizePanelColor(value,fallback='#ffffff'){const raw=String(value||'').trim();return /^#[0-9a-f]{6}$/i.test(raw)?raw.toLowerCase():fallback}
function panelColorPalette(value){const color=normalizePanelColor(value),r=parseInt(color.slice(1,3),16),g=parseInt(color.slice(3,5),16),b=parseInt(color.slice(5,7),16),toLinear=v=>{const n=v/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4},luminance=.2126*toLinear(r)+.7152*toLinear(g)+.0722*toLinear(b),dark=luminance<.42;return{foreground:dark?'#f8fafc':'#475569',heading:dark?'#ffffff':'#0f172a',muted:dark?'#cbd5e1':'#64748b',hover:dark?'rgba(255,255,255,.10)':'#f8fafc'}}
const garageAppearanceDefaults=Object.freeze({sidebarColor:'#ffffff',topbarColor:'#ffffff',highlightColor:'#2563eb'});
function appearanceSettings(){return state?.appearanceSettings||garageAppearanceDefaults}
function mixHexColors(colorA,colorB,weight=.5){const a=normalizePanelColor(colorA),b=normalizePanelColor(colorB),w=Math.min(1,Math.max(0,Number(weight)||0)),channel=(start,end)=>Math.round(start+(end-start)*w).toString(16).padStart(2,'0');return`#${channel(parseInt(a.slice(1,3),16),parseInt(b.slice(1,3),16))}${channel(parseInt(a.slice(3,5),16),parseInt(b.slice(3,5),16))}${channel(parseInt(a.slice(5,7),16),parseInt(b.slice(5,7),16))}`}
function applyHighlightColor(value){const color=normalizePanelColor(value,'#2563eb'),root=document.documentElement,palette=panelColorPalette(color);root.style.setProperty('--blue',color);root.style.setProperty('--blue-600',mixHexColors(color,'#000000',.18));root.style.setProperty('--blue-soft',mixHexColors(color,'#ffffff',.92));root.style.setProperty('--blue-line',mixHexColors(color,'#ffffff',.68));root.style.setProperty('--highlight-on',palette.heading)}
function applyAppearanceSettings(){const settings=appearanceSettings(),sidebar=normalizePanelColor(settings.sidebarColor),topbar=normalizePanelColor(settings.topbarColor),highlight=normalizePanelColor(settings.highlightColor,'#2563eb'),sidePalette=panelColorPalette(sidebar),topPalette=panelColorPalette(topbar),root=document.documentElement;root.style.setProperty('--sidebar-bg',sidebar);root.style.setProperty('--sidebar-fg',sidePalette.foreground);root.style.setProperty('--sidebar-heading',sidePalette.heading);root.style.setProperty('--sidebar-muted',sidePalette.muted);root.style.setProperty('--sidebar-hover',sidePalette.hover);root.style.setProperty('--topbar-bg',topbar);root.style.setProperty('--topbar-fg',topPalette.heading);root.style.setProperty('--topbar-muted',topPalette.muted);root.style.setProperty('--topbar-hover',topPalette.hover);applyHighlightColor(highlight)}
window.previewGarageChromeColor=function(target,value){if(!state)return;const color=normalizePanelColor(value,target==='highlight'?'#2563eb':'#ffffff'),palette=panelColorPalette(color),root=document.documentElement;if(target==='highlight'){applyHighlightColor(color)}else if(target==='topbar'){root.style.setProperty('--topbar-bg',color);root.style.setProperty('--topbar-fg',palette.heading);root.style.setProperty('--topbar-muted',palette.muted);root.style.setProperty('--topbar-hover',palette.hover)}else{root.style.setProperty('--sidebar-bg',color);root.style.setProperty('--sidebar-fg',palette.foreground);root.style.setProperty('--sidebar-heading',palette.heading);root.style.setProperty('--sidebar-muted',palette.muted);root.style.setProperty('--sidebar-hover',palette.hover)}const output=document.querySelector(`[data-color-value="${target}"]`);if(output)output.textContent=color.toUpperCase()}
async function saveAppearanceSettingsNow(){return authRequest('/api/settings/appearance',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(appearanceSettings())})}
window.saveGarageChromeColor=async function(target,value){if(!isAdministrator()){toast('Administrator access is required to change server appearance');render();return}const key=target==='topbar'?'topbarColor':target==='highlight'?'highlightColor':'sidebarColor',color=normalizePanelColor(value,target==='highlight'?'#2563eb':'#ffffff');state.appearanceSettings={...appearanceSettings(),[key]:color};applyAppearanceSettings();const label=target==='topbar'?'Top banner':target==='highlight'?'Highlight':'Left pane';try{await saveAppearanceSettingsNow();toast(`${label} color saved`)}catch(error){toast(error.message||'Unable to save appearance setting')}}
window.resetGarageChromeColors=async function(){if(!isAdministrator()){toast('Administrator access is required to change server appearance');return}state.appearanceSettings={...garageAppearanceDefaults};applyAppearanceSettings();['sidebar','topbar','highlight'].forEach(target=>{const key=target==='sidebar'?'sidebarColor':target==='topbar'?'topbarColor':'highlightColor',value=garageAppearanceDefaults[key],input=document.querySelector(`input[type=\"color\"][oninput*=\"'${target}'\"]`),output=document.querySelector(`[data-color-value=\"${target}\"]`);if(input)input.value=value;if(output)output.textContent=value.toUpperCase()});try{await saveAppearanceSettingsNow();toast('Server appearance reset');render()}catch(error){toast(error.message||'Unable to reset appearance')}}

function parseSizeText(value){
 const raw=String(value||'').trim();
 if(!raw)return 0;
 const match=raw.match(/([\d.]+)\s*(B|KB|MB|GB)/i);
 if(!match)return Number(raw)||0;
 const units={B:1,KB:1024,MB:1024**2,GB:1024**3};
 return Number(match[1])*(units[match[2].toUpperCase()]||1)
}
function parseDocumentDate(value){
 if(!value)return null;
 if(value instanceof Date&&!Number.isNaN(value.getTime()))return value;
 const direct=new Date(value);
 if(!Number.isNaN(direct.getTime()))return direct;
 const match=String(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM))?$/i);
 if(match){
   let hour=Number(match[4]||0),minute=Number(match[5]||0);const meridiem=String(match[6]||'').toUpperCase();
   if(meridiem==='PM'&&hour<12)hour+=12;
   if(meridiem==='AM'&&hour===12)hour=0;
   return new Date(Number(match[3]),Number(match[1])-1,Number(match[2]),hour,minute)
 }
 return null
}
function normalizeDocumentCategory(value='Other'){
 const key=String(value||'Other').trim().toLowerCase();
 const map={receipt:'Receipts',receipts:'Receipts',registration:'Registration',insurance:'Insurance',manual:'Manuals',manuals:'Manuals',warranty:'Warranties',warranties:'Warranties',photo:'Photos',photos:'Photos',other:'Other'};
 return map[key]||((key.charAt(0).toUpperCase()+key.slice(1))||'Other')
}
function documentTone(category){return ({Receipts:'green',Registration:'orange',Insurance:'purple',Manuals:'blue',Warranties:'amber',Photos:'sky',Other:'slate'})[normalizeDocumentCategory(category)]||'slate'}
function fileExtension(name=''){const match=String(name||'').toLowerCase().match(/\.([a-z0-9]+)$/);return match?match[1]:''}
function documentFileName(doc){return doc?.originalName||doc?.storedName||doc?.name||''}
function fileTypeMeta(doc){const ext=fileExtension(documentFileName(doc));if(ext==='pdf')return{label:'PDF',className:'pdf',icon:'fileText',preview:'pdf'};if(['doc','docx','odt'].includes(ext))return{label:ext==='odt'?'ODT':'DOC',className:'word',icon:'fileText',preview:'office'};if(['xls','xlsx','csv','ods'].includes(ext))return{label:ext==='csv'?'CSV':ext==='ods'?'ODS':'XLS',className:'sheet',icon:'table',preview:'office'};if(['ppt','pptx','odp'].includes(ext))return{label:'PPT',className:'presentation',icon:'presentation',preview:'office'};if(['jpg','jpeg','png','webp','gif','heic','tif','tiff','svg'].includes(ext))return{label:'IMG',className:'image',icon:'image',preview:'image'};if(['txt','rtf','md','log'].includes(ext))return{label:'TXT',className:'text',icon:'fileText',preview:'text'};if(['zip','rar','7z','tar','gz'].includes(ext))return{label:'ZIP',className:'archive',icon:'archive',preview:'unsupported'};return{label:(ext||'FILE').slice(0,4).toUpperCase(),className:'generic',icon:'file',preview:'unsupported'}}
function fileTypeIcon(doc,compact=false){const meta=fileTypeMeta(doc);return `<span class="filetype-icon ${meta.className} ${compact?'compact':''}"><span class="file-shape">${svg(meta.icon)}</span><em>${meta.label}</em></span>`}
function linkedDocumentIndexForExpense(expense){
 if(!expense)return-1;
 let index=-1;
 if(expense.linkedDocumentId)index=state.documents.findIndex(doc=>doc.id===expense.linkedDocumentId);
 if(index<0&&expense.linkedDocumentStoredName)index=state.documents.findIndex(doc=>doc.storedName===expense.linkedDocumentStoredName);
 if(index<0&&expense.id)index=state.documents.findIndex(doc=>doc.linkedExpenseId===expense.id);
 return index
}
function linkedDocumentForExpense(expense){const index=linkedDocumentIndexForExpense(expense);return index>=0?{index,doc:state.documents[index]}:null}
function expenseAttachmentMarkup(expense){const linked=linkedDocumentForExpense(expense);if(!linked)return'<span class="expense-no-attachment">—</span>';const meta=fileTypeMeta(linked.doc);return `<button type="button" class="expense-attachment-button ${meta.className}" title="Preview ${esc(linked.doc.name)}" aria-label="Preview attached ${esc(meta.label)} document" onclick="openDocument(${linked.index})">${fileTypeIcon(linked.doc,true)}</button>`}
function clearDocumentUploadPreview(){if(documentUploadPreviewUrl){URL.revokeObjectURL(documentUploadPreviewUrl);documentUploadPreviewUrl=null}}
function inferredDocumentCategory(file){const name=String(file?.name||'').toLowerCase(),ext=fileExtension(name);if(['jpg','jpeg','png','webp','gif','heic','tif','tiff','svg'].includes(ext))return'Photos';if(/insurance|policy|coverage|id.?card/.test(name))return'Insurance';if(/registration|title|license/.test(name))return'Registration';if(/manual|handbook|guide/.test(name))return'Manuals';if(/warranty|guarantee/.test(name))return'Warranties';if(/receipt|invoice|service|repair|oil|tire|parts/.test(name))return'Receipts';return'Receipts'}
function inferredDocumentTags(file){const ext=fileExtension(file?.name||''),base=String(file?.name||'').replace(/\.[^.]+$/,'').toLowerCase(),ignored=new Set(['the','and','for','from','copy','document','file','scan','scanned','pdf','doc','docx','jpg','jpeg','png']);const tags=base.split(/[^a-z0-9]+/).filter(token=>token.length>1&&!ignored.has(token)).slice(0,5);if(ext&&!tags.includes(ext))tags.push(ext);return tags.slice(0,6).join(', ')}
function documentUploadEmptyPreview(){return `<div class="document-upload-empty"><span>${svg('upload')}</span><h4>Select a document to preview</h4><p>PDFs, images, and text files preview immediately. Office files show a file summary before upload and can be converted for preview after upload.</p></div>`}
async function updateDocumentUploadPreview(file){
 const body=document.getElementById('documentUploadPreviewBody'),name=document.getElementById('documentUploadSelectedName'),meta=document.getElementById('documentUploadSelectedMeta'),icon=document.getElementById('documentUploadSelectedIcon');if(!body)return;clearDocumentUploadPreview();
 if(!(file instanceof File)||!file.size){body.innerHTML=documentUploadEmptyPreview();if(name)name.textContent='No file selected';if(meta)meta.textContent='Choose a file to begin';return}
 const type=fileTypeMeta(file),category=document.querySelector('#modalFields [name="Category"]'),displayName=document.querySelector('#modalFields [name="Display Name"]'),tags=document.querySelector('#modalFields [name="Tags"]');
 if(name)name.textContent=file.name;if(meta)meta.textContent=`${type.label} · ${formatBytes(file.size)}`;if(icon)icon.innerHTML=fileTypeIcon(file);
 if(category&&!category.dataset.userChanged)category.value=inferredDocumentCategory(file);
 if(displayName&&!displayName.dataset.userChanged)displayName.value=file.name;
 if(tags&&!tags.dataset.userChanged)tags.value=inferredDocumentTags(file);
 syncDocumentExpenseSuggestions();
 documentUploadPreviewUrl=URL.createObjectURL(file);
 if(type.preview==='pdf')body.innerHTML=`<iframe class="document-upload-preview-frame" src="${documentUploadPreviewUrl}#toolbar=0&navpanes=0" title="Preview of ${esc(file.name)}"></iframe>`;
 else if(type.preview==='image')body.innerHTML=`<div class="document-upload-image-preview"><img src="${documentUploadPreviewUrl}" alt="Preview of ${esc(file.name)}"></div>`;
 else if(type.preview==='text'){
   body.innerHTML='<div class="document-upload-preview-loading">Loading text preview…</div>';
   try{const content=(await file.text()).slice(0,120000);body.innerHTML=`<pre class="document-upload-text-preview">${esc(content||'The text file is empty.')}</pre>`}catch{body.innerHTML=`<div class="document-upload-generic-preview">${fileTypeIcon(file)}<h4>${esc(file.name)}</h4><p>GarageLog could not read this text file in the browser.</p></div>`}
 }else body.innerHTML=`<div class="document-upload-generic-preview">${fileTypeIcon(file)}<h4>${esc(file.name)}</h4><p>${type.preview==='office'?'A full Office-document preview will be generated after upload when LibreOffice is installed.':'This file type does not have an inline browser preview.'}</p><dl><div><dt>Type</dt><dd>${esc(type.label)}</dd></div><div><dt>Size</dt><dd>${formatBytes(file.size)}</dd></div><div><dt>Original name</dt><dd>${esc(file.name)}</dd></div></dl></div>`;
}
function documentExpenseCategorySuggestion(documentCategory){
 const category=normalizeDocumentCategory(documentCategory);
 return ({Registration:'Registration',Insurance:'Insurance',Receipts:'Maintenance',Warranties:'Other',Manuals:'Other',Photos:'Other',Other:'Other'})[category]||'Other'
}
function toggleDocumentExpensePanel(force,{reveal=false}={}){
 const checkbox=document.getElementById('documentCreateExpense'),panel=document.getElementById('documentExpenseFields');
 if(!checkbox||!panel)return;
 if(typeof force==='boolean')checkbox.checked=force;
 panel.hidden=!checkbox.checked;
 const amount=panel.querySelector('[name="Expense Amount"]');
 if(amount)amount.required=checkbox.checked;
 if(checkbox.checked&&reveal){
   requestAnimationFrame(()=>{
     const scroller=panel.closest('.document-upload-details-panel');
     if(scroller)scroller.scrollTo({top:Math.max(0,panel.offsetTop-18),behavior:'smooth'});
     panel.querySelector('input,select')?.focus({preventScroll:true})
   })
 }
}
function syncDocumentExpenseSuggestions(){
  const category=document.querySelector('#modalFields [name="Category"]'),expenseCategory=document.querySelector('#modalFields [name="Expense Category"]'),coverage=document.querySelector('#modalFields [name="Expense Coverage"]');
  if(expenseCategory&&!expenseCategory.dataset.userChanged)expenseCategory.value=documentExpenseCategorySuggestion(category?.value);
  if(coverage&&!coverage.dataset.userChanged)coverage.value=normalizeDocumentCategory(category?.value)==='Warranties'?'Warranty':'None';
  syncDocumentExpenseCoverageFields()
}
function normalizeExpenseCoverage(value){return ['Warranty','Recall'].includes(String(value||''))?String(value):'None'}
function expenseCoverageLabel(expense){const coverage=normalizeExpenseCoverage(expense?.coverageType);return coverage==='Warranty'?'Warranty covered':coverage==='Recall'?'Recall covered':''}
function expenseCoverageSummary(expense){const label=expenseCoverageLabel(expense),covered=Number(expense?.coveredAmount||0);return label?`${label}${covered>0?` · ${money(covered)} service value`:''}`:''}
function syncDocumentExpenseCoverageFields(){
  const coverage=document.querySelector('#modalFields [name="Expense Coverage"]'),coveredField=document.getElementById('documentCoveredValueField'),amountLabel=document.getElementById('documentExpenseAmountLabel');
  if(!coverage)return;const covered=normalizeExpenseCoverage(coverage.value)!=='None';if(coveredField)coveredField.hidden=!covered;if(amountLabel)amountLabel.textContent=covered?'Amount Paid':'Amount';
  const amount=document.querySelector('#modalFields [name="Expense Amount"]');if(covered&&amount&&amount.value==='')amount.value='0.00'
}
function normalizeServiceValues(value){
  const entries=Array.isArray(value)?value:String(value||'').split(','),seen=new Set(),result=[];
  entries.forEach(entry=>{const label=String(entry||'').trim().replace(/\s+/g,' '),key=label.toLowerCase();if(label&&!seen.has(key)){seen.add(key);result.push(label)}});
  return result.slice(0,20)
}
function serviceValuesText(value){return normalizeServiceValues(value).join(', ')}
function linkedExpenseForDocument(doc){
  if(!doc)return null;
  return state.expenses.find(expense=>(doc.linkedExpenseId&&String(expense.id)===String(doc.linkedExpenseId))||(doc.id&&String(expense.linkedDocumentId||'')===String(doc.id))||(doc.storedName&&String(expense.linkedDocumentStoredName||'')===String(doc.storedName)))||null
}
function documentServiceValues(doc){const expense=linkedExpenseForDocument(doc);return normalizeServiceValues(doc?.services?.length?doc.services:expense?.services?.length?expense.services:expense?.notes||'')}
function documentShopValue(doc){const expense=linkedExpenseForDocument(doc);return String(doc?.shop||expense?.vendor||'')}
function expenseServiceLabel(expense){const services=normalizeServiceValues(expense?.services);return services.length?services.join(', '):String(expense?.notes||expense?.category||'Service')}
function expenseCoverageBadge(expense){const coverage=normalizeExpenseCoverage(expense?.coverageType),summary=expenseCoverageSummary(expense);return summary?`<span class="expense-coverage-badge ${coverage.toLowerCase()}">${esc(summary)}</span>`:''}
function documentCategoryOptions(selected='Receipts'){const normalized=normalizeDocumentCategory(selected);return ['Receipts','Registration','Insurance','Manuals','Warranties','Photos','Other'].map(value=>`<option ${value===normalized?'selected':''}>${value}</option>`).join('')}
function documentEditFieldsHtml(doc={}){
  const category=normalizeDocumentCategory(doc.category||'Receipts'),services=serviceValuesText(documentServiceValues(doc)),shop=documentShopValue(doc);
  return `<label class="full">File Name<input name="File Name" type="text" value="${esc(doc.name||'')}" required></label><label>Category<select name="Category" required>${documentCategoryOptions(category)}</select></label><label class="full document-context-field" data-document-context="Receipts">Service<input name="Service" type="text" value="${esc(services)}" placeholder="Oil Change, Tire Rotation, Air Filter"><small class="wizard-field-help">Separate multiple services with commas.</small></label><label class="full document-context-field" data-document-context="Receipts">Shop<input name="Shop" type="text" value="${esc(shop)}" placeholder="Company or shop that performed the service"></label><label class="document-context-field" data-document-context="Registration,Insurance">Start Date<input name="Start Date" type="date" value="${esc(doc.startsOn||'')}"></label><label class="document-context-field" data-document-context="Registration,Insurance,Warranties">Expiration Date<input name="Expiration Date" type="date" value="${esc(doc.expiresOn||'')}"></label><label class="full">Tags<input name="Tags" type="text" value="${esc((doc.tags||documentTags(doc)).join(', '))}" placeholder="oil, receipt, 2026"></label>`
}
function documentCategorySupportsLinkedExpense(value){return ['Receipts','Registration','Insurance','Warranties','Other'].includes(normalizeDocumentCategory(value))}
function syncDocumentContextFields(){
  const categoryControl=document.querySelector('#modalFields [name="Category"]');if(!categoryControl)return;
  const category=normalizeDocumentCategory(categoryControl.value),supportsLinkedExpense=documentCategorySupportsLinkedExpense(category),isReceipt=category==='Receipts';
  document.querySelectorAll('#modalFields [data-document-context]').forEach(field=>{const allowed=String(field.dataset.documentContext||'').split(',').map(value=>value.trim()).filter(Boolean);field.hidden=!allowed.includes(category)});
  const linkedSection=document.querySelector('#modalFields .document-linked-expense'),checkbox=document.getElementById('documentCreateExpense');
  if(linkedSection)linkedSection.hidden=!supportsLinkedExpense;
  if(checkbox){if(!supportsLinkedExpense)checkbox.checked=false;else if(!checkbox.dataset.userChanged)checkbox.checked=isReceipt}
  toggleDocumentExpensePanel();
  syncDocumentExpenseSuggestions()
}
function initializeDocumentEditDialog(){const category=document.querySelector('#modalFields [name="Category"]');if(category)category.addEventListener('change',syncDocumentContextFields);syncDocumentContextFields()}
function documentUploadFieldsHtml(){return `<div class="document-upload-workspace full"><section class="document-upload-preview-panel"><label class="document-upload-file-picker">Choose document<input id="documentUploadFile" name="File" type="file" required></label><div class="document-upload-selected"><span id="documentUploadSelectedIcon">${fileTypeIcon({name:'file'})}</span><div><strong id="documentUploadSelectedName">No file selected</strong><small id="documentUploadSelectedMeta">Choose a file to begin</small></div></div><div id="documentUploadPreviewBody" class="document-upload-preview-body">${documentUploadEmptyPreview()}</div></section><aside class="document-upload-details-panel"><div class="document-upload-details-heading"><span class="wizard-eyebrow">DOCUMENT DETAILS</span><h4>Describe this file</h4></div><div class="document-upload-details-grid"><label>Category<select name="Category" required>${documentCategoryOptions('Receipts')}</select></label><label class="full">Display Name<input name="Display Name" type="text" placeholder="Uses the original filename by default"></label><label class="full document-context-field" data-document-context="Receipts">Service<input name="Service" type="text" placeholder="Oil Change, Tire Rotation, Air Filter"><small class="wizard-field-help">Separate multiple services with commas.</small></label><label class="full document-context-field" data-document-context="Receipts">Shop<input name="Shop" type="text" placeholder="Company or shop that performed the service"></label><label class="document-context-field" data-document-context="Registration,Insurance">Start Date<input name="Start Date" type="date"></label><label class="document-context-field" data-document-context="Registration,Insurance,Warranties">Expiration Date<input name="Expiration Date" type="date"></label><label class="full">Tags<input name="Tags" type="text" placeholder="oil, receipt, 2026"></label></div><section class="document-linked-expense" data-document-context="Receipts,Registration,Insurance,Warranties,Other"><label class="linked-expense-toggle"><input id="documentCreateExpense" name="Create Expense" type="checkbox" checked><span>${svg('dollar')}</span><span><strong>Create linked expense?</strong><small>Create an expense tied directly to this document.</small></span></label><div id="documentExpenseFields" class="document-expense-fields"><div class="document-expense-heading"><span class="wizard-eyebrow">EXPENSE DETAILS</span><p>The linked expense will appear in Expenses and applicable reports.</p></div><div class="document-upload-details-grid"><label>Expense Date<input name="Expense Date" type="date" value="${new Date().toISOString().slice(0,10)}"><small class="wizard-field-help">Used in expense charts and reports.</small></label><label>Category<select name="Expense Category">${['Maintenance','Repair','Parts','Insurance','Registration','Other'].map(value=>`<option ${value==='Maintenance'?'selected':''}>${value}</option>`).join('')}</select></label><label>Payment / Coverage<select name="Expense Coverage"><option value="None">Out of pocket</option><option value="Warranty">Warranty covered</option><option value="Recall">Recall covered</option></select></label><label><span id="documentExpenseAmountLabel">Amount</span><input name="Expense Amount" type="number" min="0" step="0.01" placeholder="0.00"></label><label id="documentCoveredValueField" class="full" hidden>Service / Invoice Value <span class="optional-label">Optional</span><input name="Covered Value" type="number" min="0" step="0.01" placeholder="0.00"><small class="wizard-field-help">The value covered by the warranty or recall. It is recorded for reference but is not counted as spending.</small></label></div><div class="linked-expense-note">The document remains in Documents and the linked expense appears in Expenses. Warranty- and recall-covered entries can record $0 paid while retaining the service record.</div></div></section></aside></div>`}

function initializeDocumentUploadDialog(){
  const file=document.getElementById('documentUploadFile');if(!file)return;
  ['Category','Display Name','Tags','Service','Shop'].forEach(name=>{const control=document.querySelector(`#modalFields [name="${name}"]`);if(!control)return;control.addEventListener(name==='Category'?'change':'input',()=>{control.dataset.userChanged='true';if(name==='Category')syncDocumentContextFields();else syncDocumentExpenseSuggestions()})});
  const expenseCategory=document.querySelector('#modalFields [name="Expense Category"]');if(expenseCategory)expenseCategory.addEventListener('change',()=>expenseCategory.dataset.userChanged='true');
  const expenseCoverage=document.querySelector('#modalFields [name="Expense Coverage"]');if(expenseCoverage)expenseCoverage.addEventListener('change',()=>{expenseCoverage.dataset.userChanged='true';syncDocumentExpenseCoverageFields()});
  const expenseToggle=document.getElementById('documentCreateExpense');if(expenseToggle)expenseToggle.addEventListener('change',()=>{expenseToggle.dataset.userChanged='true';toggleDocumentExpensePanel(undefined,{reveal:true})});
  file.addEventListener('change',()=>{updateDocumentUploadPreview(file.files?.[0]);queueMicrotask(syncDocumentContextFields)});
  syncDocumentContextFields()
}

function vehicleNameFromId(id){const vehicle=state.vehicles.find(v=>v.id===id)||state.vehicle;return vehicleFullName(vehicle)}
function documentDisplayDate(doc){const date=parseDocumentDate(doc?.addedAt||doc?.date);if(!date)return String(doc?.date||'');return `${date.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}<br><span>${date.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}</span>`}
function documentCoverageDates(doc){const start=parseDocumentDate(doc?.startsOn),expiry=parseDocumentDate(doc?.expiresOn);return{start,expiry,sortDate:expiry||start||null}}
function documentCoverageDateDisplay(doc){const {start,expiry}=documentCoverageDates(doc);if(!start&&!expiry)return '<span class="document-coverage-empty">—</span>';const format=date=>date.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});return `<span class="document-coverage-date">${start?`<span><small>Starts</small><strong>${format(start)}</strong></span>`:''}${expiry?`<span><small>Expires</small><strong>${format(expiry)}</strong></span>`:''}</span>`}
function relativeTime(value){const date=parseDocumentDate(value);if(!date)return 'Recently added';const diffMs=Date.now()-date.getTime();const hours=Math.max(0,Math.round(diffMs/36e5));if(hours<24)return hours<=1?'1 hour ago':`${hours} hours ago`;const days=Math.round(hours/24);if(days<7)return days===1?'1 day ago':`${days} days ago`;const weeks=Math.round(days/7);if(weeks<5)return weeks===1?'1 week ago':`${weeks} weeks ago`;const months=Math.round(days/30);return months<=1?'1 month ago':`${months} months ago`}
function documentTags(doc){if(Array.isArray(doc?.tags)&&doc.tags.length)return doc.tags.slice(0,3);const name=String(doc?.name||'').replace(/\.[^.]+$/,'').toLowerCase();const tokens=name.split(/[^a-z0-9]+/).filter(Boolean).filter(x=>!['pdf','jpg','jpeg','png','webp','and','the','owner','owners','document','copy','view','service'].includes(x));const category=normalizeDocumentCategory(doc?.category);const derived=[];const add=v=>{if(v&&!derived.includes(v))derived.push(v)};({Receipts:'receipts',Registration:'registration',Insurance:'insurance',Manuals:'manual',Warranties:'warranty',Photos:'photo'})[category]&&add(({Receipts:'receipts',Registration:'registration',Insurance:'insurance',Manuals:'manual',Warranties:'warranty',Photos:'photo'})[category]);tokens.slice(0,3).forEach(add);return derived.slice(0,3)}
function estimateDocumentExpiry(doc){
  const category=normalizeDocumentCategory(doc?.category),explicit=parseDocumentDate(doc?.expiresOn);
  if(explicit)return explicit;
  const start=parseDocumentDate(doc?.startsOn||doc?.date||doc?.addedAt);if(!start)return null;
  const expiry=new Date(start.getTime());
  if(category==='Registration')expiry.setFullYear(expiry.getFullYear()+1);
  else if(category==='Insurance')expiry.setMonth(expiry.getMonth()+6);
  else if(category==='Warranties')expiry.setFullYear(expiry.getFullYear()+1);
  else return null;
  return expiry
}
function documentFolderById(id){return state.documentFolders.find(folder=>folder.id===id)||null}
function documentAction(action){if(action==='share')return openDocumentShare();if(action==='shareManager')return openDocumentShareManager();if(action==='export')return openDocumentSelection('export');if(action==='print')return openDocumentSelection('print');if(action==='manageStorage')return openDocumentStorage();toast('Document action unavailable')}
function documentRowMenu(index,doc){return `<button type="button" class="document-row-menu-trigger" aria-label="Document actions" onclick="openDocumentRowMenu(event,${index})">${svg('more')}</button>`}
function closeDocumentRowActionMenu(){document.querySelector('.document-row-action-menu')?.remove()}
window.openDocumentRowMenu=function(event,index){
 event.preventDefault();event.stopPropagation();closeActionMenus();
 const trigger=event.currentTarget,doc=state.documents[index];if(!trigger||!doc)return;
 const menu=document.createElement('div');menu.className='document-row-action-menu';menu.innerHTML=`<button type="button" onclick="closeActionMenus();openDocument(${index})">${svg('external')} Preview</button><button type="button" onclick="closeActionMenus();editRecord('document',${index})">${svg('edit')} Edit details</button><button type="button" onclick="closeActionMenus();shareDocument(${index})">${svg('share')} Share</button><button type="button" class="delete" onclick="closeActionMenus();openDocumentDeleteConfirm(${index})">${svg('trash')} Delete</button>`;
 document.body.appendChild(menu);const rect=trigger.getBoundingClientRect(),margin=8,width=menu.offsetWidth||176,height=menu.offsetHeight||180;let left=Math.min(window.innerWidth-width-margin,Math.max(margin,rect.right-width)),top=rect.bottom+6;if(top+height>window.innerHeight-margin)top=Math.max(margin,rect.top-height-6);menu.style.left=`${left}px`;menu.style.top=`${top}px`
}
function ensureDynamicDialog(id,className='document-feature-dialog'){let dialog=document.getElementById(id);if(dialog)return dialog;dialog=document.createElement('dialog');dialog.id=id;dialog.className=className;document.body.appendChild(dialog);dialog.addEventListener('cancel',event=>{event.preventDefault();dialog.close()});return dialog}
function openCenteredWindow(url='',name='_blank',width=1100,height=800){
 const dualLeft=window.screenLeft??window.screenX??0,dualTop=window.screenTop??window.screenY??0;
 const viewportWidth=window.outerWidth||document.documentElement.clientWidth||screen.width;
 const viewportHeight=window.outerHeight||document.documentElement.clientHeight||screen.height;
 const left=Math.max(0,Math.round(dualLeft+(viewportWidth-width)/2));
 const top=Math.max(0,Math.round(dualTop+(viewportHeight-height)/2));
 const popup=window.open(url,name,`popup=yes,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`);
 if(popup)popup.focus();
 return popup
}
function closeActionMenus(except=null){
 closeDocumentRowActionMenu();
 document.querySelectorAll('details[open].expense-row-menu,details[open].reminder-more,details[open].maintenance-row-menu').forEach(menu=>{if(menu!==except)menu.open=false})
}
window.closeActionMenus=closeActionMenus;

function documentPreviewMarkup(doc){const meta=fileTypeMeta(doc),url=`/api/documents/${encodeURIComponent(doc.storedName)}/preview`;if(!doc.storedName)return `<div class="document-preview-unavailable">${fileTypeIcon(doc)}<h4>No stored file is attached</h4><p>This is a metadata-only document record.</p></div>`;if(meta.preview==='image')return `<div class="document-image-preview"><img src="${url}" alt="${esc(doc.name)}"></div>`;if(['pdf','office','text'].includes(meta.preview))return `<iframe class="document-preview-frame" src="${url}" title="Preview of ${esc(doc.name)}"></iframe>`;return `<div class="document-preview-unavailable">${fileTypeIcon(doc)}<h4>Preview is not available for this file type</h4><p>Download the original file and open it in its associated application.</p></div>`}
function isPendingMobileReceipt(doc){return Boolean(doc?.mobileCapture)&&normalizeDocumentCategory(doc?.category)==='Receipts'&&String(doc?.reviewStatus||'').toLowerCase()==='pending'}
let mobileReceiptRefreshTimer=null;
function mobileReceiptReviewMarkup(doc,index){
 if(!isPendingMobileReceipt(doc))return'';
 const ocr=doc.receiptOcr||{},captureType=String(doc.mobileCaptureType||ocr.captureType||'receipt').toLowerCase(),processing=String(doc.ocrStatus||'').toLowerCase()==='indexing'||String(ocr.status||'').toLowerCase()==='processing',captured=parseDocumentDate(doc.capturedUtc||doc.addedAt),date=String(ocr.purchaseDate||captured?.toISOString().slice(0,10)||new Date().toISOString().slice(0,10)),merchant=String(ocr.merchant||doc.shop||''),amount=processing?'':(Number(ocr.amount)>0?ocr.amount:''),gallons=processing?'':(Number(ocr.gallons)>0?ocr.gallons:''),price=processing?null:ocr.pricePerGallon,disabled=processing?' disabled':'',kind=captureType==='pump'?'PUMP DISPLAY':'PAPER RECEIPT',missingPumpValues=!processing&&captureType==='pump'&&(!amount||!gallons);
 const instruction=processing?'GarageLog is processing the image. Values will become editable when OCR finishes.':missingPumpValues?'GarageLog could not confidently read one or more pump values. Enter the amount and gallons manually, or retake the photo closer to the displays.':'Verify or correct the OCR values before creating the fuel expense.';
 return `<section class="mobile-receipt-review"><div class="mobile-receipt-review-heading"><div><span class="wizard-eyebrow">MOBILE ${kind} · PENDING REVIEW</span><strong>${instruction}</strong></div><span class="mobile-receipt-pending">${processing?'Processing OCR':'Pending'}</span></div><div class="mobile-receipt-review-grid"><label>Station / Merchant<input name="Mobile Receipt Merchant" value="${esc(merchant)}" placeholder="${processing?'Waiting for OCR':'Fuel station'}"${disabled}></label><label>Purchase Date<input name="Mobile Receipt Date" type="date" value="${esc(date)}"${disabled}></label><label>Total Amount<input name="Mobile Receipt Amount" type="number" min="0" step="0.01" value="${esc(amount)}" placeholder="${processing?'':'0.00'}"${disabled}></label><label>Gallons<input name="Mobile Receipt Gallons" type="number" min="0" step="0.001" value="${esc(gallons)}" placeholder="${processing?'':'0.000'}"${disabled}></label></div><div class="mobile-receipt-review-meta"><span>OCR: <strong>${processing?'Processing…':esc(documentOcrStatusLabel(doc))}</strong></span>${price?`<span>${captureType==='pump'?'Calculated':'Detected'} price/gal: <strong>$${Number(price).toFixed(3)}</strong></span>`:''}<label><input name="Mobile Receipt Full Tank" type="checkbox"${disabled}> Full-tank fill-up</label><button type="button" class="primary" onclick="approveMobileReceipt(${index})"${disabled}>${processing?'Waiting for OCR…':'Approve & Create Fuel Expense'}</button></div></section>`
}
async function refreshPendingMobileReceipt(documentId,attempt=0){
 if(attempt>=10)return;
 clearTimeout(mobileReceiptRefreshTimer);
 mobileReceiptRefreshTimer=setTimeout(async()=>{
  const dialog=document.getElementById('documentPreviewDialog');
  if(!dialog?.open)return;
  try{
   const response=await fetch('/api/state',{cache:'no-store'});
   if(!response.ok)return;
   const fresh=await response.json(),docs=Array.isArray(fresh.documents)?fresh.documents:[],freshDoc=docs.find(item=>String(item?.id||'')===String(documentId));
   if(!freshDoc)return;
   const stillProcessing=String(freshDoc.ocrStatus||'').toLowerCase()==='indexing'||String(freshDoc.receiptOcr?.status||'').toLowerCase()==='processing';
   state=fresh;normalizeState();
   const newIndex=state.documents.findIndex(item=>String(item?.id||'')===String(documentId));
   if(newIndex<0)return;
   if(stillProcessing){refreshPendingMobileReceipt(documentId,attempt+1);return}
   dialog.close();render();openDocumentPreview(newIndex)
  }catch(error){console.warn('Unable to refresh mobile receipt OCR status.',error)}
 },2000)
}
window.approveMobileReceipt=async function(index){
 const doc=state.documents[index];if(!doc||!isPendingMobileReceipt(doc)){toast('This receipt is no longer pending review');return}
 const dialog=document.getElementById('documentPreviewDialog'),merchant=String(dialog?.querySelector('[name="Mobile Receipt Merchant"]')?.value||'').trim(),date=String(dialog?.querySelector('[name="Mobile Receipt Date"]')?.value||'').trim(),amount=Number(dialog?.querySelector('[name="Mobile Receipt Amount"]')?.value),gallonsRaw=String(dialog?.querySelector('[name="Mobile Receipt Gallons"]')?.value||'').trim(),gallons=gallonsRaw===''?null:Number(gallonsRaw),fullTank=Boolean(dialog?.querySelector('[name="Mobile Receipt Full Tank"]')?.checked);
 if(!date){toast('Enter the fuel purchase date');return}
 if(!Number.isFinite(amount)||amount<=0){toast('Enter or verify the receipt total before approval');return}
 if(gallons!==null&&(!Number.isFinite(gallons)||gallons<=0)){toast('Enter a valid gallons value or leave it blank');return}
 const previous=JSON.parse(JSON.stringify(doc)),expenseId=makeRecordId('expense'),now=new Date().toISOString(),expense={id:expenseId,vehicleId:doc.vehicleId,date,category:'Fuel',vendor:merchant,notes:'Fuel receipt captured with GarageLog Mobile',amount,fullTank,linkedDocumentId:doc.id,linkedDocumentStoredName:doc.storedName,source:'mobile-receipt',createdAt:now,updatedAt:now};
 if(gallons!==null)expense.gallons=gallons;
 state.expenses.unshift(expense);doc.linkedExpenseId=expenseId;doc.reviewStatus='Approved';doc.reviewedAt=now;doc.shop=merchant;doc.receiptOcr={...(doc.receiptOcr||{}),merchant,amount,gallons,purchaseDate:date,reviewedAt:now};
 try{await saveNow();dialog?.close();render();toast('Receipt approved and fuel expense created')}catch(error){state.expenses=state.expenses.filter(item=>item.id!==expenseId);state.documents[index]=previous;console.error(error);toast(error.message||'Unable to approve the receipt')}
};
window.openDocumentPreview=function(index){const doc=state.documents[index];if(!doc)return;const pending=isPendingMobileReceipt(doc);doc.lastViewedAt=new Date().toISOString();if(!pending)save('Document opened');const dialog=ensureDynamicDialog('documentPreviewDialog','document-preview-dialog'),processing=pending&&(String(doc.ocrStatus||'').toLowerCase()==='indexing'||String(doc.receiptOcr?.status||'').toLowerCase()==='processing');dialog.innerHTML=`<div class="modal-header"><div class="document-preview-title">${fileTypeIcon(doc)}<div><h3>${esc(doc.name)}${pending?' <span class="mobile-receipt-pending">Pending review</span>':''}</h3><p>${esc(normalizeDocumentCategory(doc.category))} · ${esc(doc.size||formatBytes(doc.bytes))}</p></div></div><button type="button" class="icon-btn document-preview-close">${svg('close')}</button></div><div class="document-preview-body ${pending?'has-receipt-review':''}">${mobileReceiptReviewMarkup(doc,index)}${documentPreviewMarkup(doc)}</div><div class="document-preview-footer"><div class="document-preview-tags">${documentTags(doc).map(tag=>`<span>${esc(tag)}</span>`).join('')}</div><div class="modal-actions"><a class="secondary" href="/api/documents/${encodeURIComponent(doc.storedName||'')}" download="${esc(doc.name)}">${svg('download')} Download</a><button type="button" class="secondary document-preview-print">${svg('printer')} Print</button><button type="button" class="primary document-preview-done">Close</button></div></div>`;dialog.querySelector('.document-preview-close').onclick=()=>{clearTimeout(mobileReceiptRefreshTimer);dialog.close()};dialog.querySelector('.document-preview-done').onclick=()=>{clearTimeout(mobileReceiptRefreshTimer);dialog.close()};dialog.querySelector('.document-preview-print').onclick=()=>printDocument(index);dialog.showModal();if(processing)refreshPendingMobileReceipt(doc.id)}
window.openDocument=window.openDocumentPreview;
window.printDocument=function(index){const doc=state.documents[index];if(!doc?.storedName)return;const popup=window.open(`/api/documents/${encodeURIComponent(doc.storedName)}/preview`,'_blank');if(!popup){toast('Allow pop-ups to print this document');return}setTimeout(()=>{try{popup.focus();popup.print()}catch{}},1200)}
function openDocumentFolderManager(){toast('Custom document folders are no longer used. Use document categories and tags instead.')}
window.openDocumentFolderManager=openDocumentFolderManager;
function documentOcrStatusLabel(doc){const status=String(doc?.ocrStatus||'not-indexed');if(status==='indexed')return'Searchable';if(status==='empty')return'Indexed · no text';if(status==='indexing')return'Indexing…';if(status==='needs-ocr')return'OCR setup required';if(status==='unsupported')return'Search unavailable';if(status==='error')return'Index failed';return'Stored locally'}
async function indexDocumentRecord(index,{quiet=false}={}){const doc=state.documents[index];if(!doc?.storedName)return{ok:false,skipped:true,status:'missing'};doc.ocrStatus='indexing';doc.ocrError='';if(!quiet)render();try{const response=await fetch(`/api/documents/${encodeURIComponent(doc.storedName)}/extract-text`,{method:'POST'}),data=await response.json().catch(()=>({}));if(!response.ok){const error=new Error(data.error||'Unable to index document');error.ocrRequired=Boolean(data.ocrRequired||data.toolUnavailable);error.missingTools=Array.isArray(data.missingTools)?data.missingTools:[];throw error}doc.ocrText=data.text||'';doc.ocrMethod=data.method||'unknown';doc.ocrIndexedAt=data.indexedAtUtc||new Date().toISOString();doc.ocrError='';doc.ocrMissingTools=[];if(doc.ocrMethod==='unsupported')doc.ocrStatus='unsupported';else doc.ocrStatus=doc.ocrText?'indexed':'empty';await saveNow();if(!quiet)toast(doc.ocrStatus==='unsupported'?`${doc.name} is not a searchable file type`:doc.ocrText?`Indexed ${doc.name}`:`No searchable text found in ${doc.name}`);return{ok:doc.ocrStatus==='indexed'||doc.ocrStatus==='empty',status:doc.ocrStatus,method:doc.ocrMethod}}catch(error){doc.ocrStatus=error.ocrRequired?'needs-ocr':'error';doc.ocrError=error.message;doc.ocrMissingTools=error.missingTools||[];await saveNow();if(!quiet){toast(error.message);openOcrStatus()}return{ok:false,status:doc.ocrStatus,error:error.message,missingTools:doc.ocrMissingTools}}finally{if(!quiet)render()}}
window.indexDocument=indexDocumentRecord;
function updateDocumentIndexProgressUi(){
 const progress=documentIndexProgress;
 const cardButton=document.querySelector('.document-index-button');
 if(cardButton){
   cardButton.disabled=progress.running;
   cardButton.textContent=progress.running?`Indexing ${progress.completed} of ${progress.total}`:'Index All';
 }
 const copy=document.querySelector('.ocr-index-progress-copy');
 if(copy&&progress.running)copy.textContent=`Indexing ${progress.completed} of ${progress.total}${progress.currentName?` · ${progress.currentName}`:''}`;
 const bar=document.querySelector('.ocr-index-progress span');
 if(bar)bar.style.width=`${progress.total?Math.min(100,progress.completed/progress.total*100):0}%`;
}
async function indexAllDocuments(){
 if(documentIndexProgress.running)return;
 const indexes=activeDocuments().map(doc=>state.documents.indexOf(doc)).filter(index=>index>=0&&state.documents[index]?.storedName);
 if(!indexes.length){toast('No stored documents are available to index');return}
 documentIndexProgress={running:true,completed:0,total:indexes.length,currentName:''};
 render();
 await new Promise(resolve=>requestAnimationFrame(()=>resolve()));
 const summary={indexed:0,needsOcr:0,unsupported:0,failed:0};
 try{
   for(const index of indexes){
     const doc=state.documents[index];
     documentIndexProgress.currentName=doc?.name||'Document';
     updateDocumentIndexProgressUi();
     const result=await indexDocumentRecord(index,{quiet:true});
     if(result.status==='indexed'||result.status==='empty')summary.indexed++;
     else if(result.status==='needs-ocr')summary.needsOcr++;
     else if(result.status==='unsupported')summary.unsupported++;
     else summary.failed++;
     documentIndexProgress.completed++;
     updateDocumentIndexProgressUi();
     await new Promise(resolve=>requestAnimationFrame(()=>resolve()));
   }
 }catch(error){
   console.error('Index All failed',error);
   const remaining=Math.max(0,indexes.length-documentIndexProgress.completed);
   summary.failed+=remaining;
   toast(error?.message||'Document indexing stopped unexpectedly');
 }finally{
   documentIndexProgress={running:false,completed:0,total:0,currentName:''};
   render();
 }
 if(summary.failed||summary.needsOcr||summary.unsupported){
   toast(`Indexing complete: ${summary.indexed} searchable, ${summary.needsOcr+summary.unsupported+summary.failed} need attention`);
 }else{
   toast(`Document indexing complete`);
 }
}
window.indexAllDocuments=indexAllDocuments;
async function fetchOcrStatus(){try{const response=await fetch('/api/documents/ocr-status',{cache:'no-store'});if(!response.ok)throw new Error();return await response.json()}catch{return{managedPdfText:true,pdfText:false,pdfImages:false,imageOcr:false,scannedPdfOcr:false,platform:'unknown'}}}
function ocrCapabilityRow(label,available,detail){return `<div class="ocr-capability-row"><span class="ocr-capability-state ${available?'available':'missing'}">${available?svg('check'):svg('warning')}</span><span><strong>${esc(label)}</strong><small>${esc(detail)}</small></span><b>${available?'Available':'Missing'}</b></div>`}
window.openOcrStatus=async function(summary=null){
 const capabilities=await fetchOcrStatus();
 const dialog=ensureDynamicDialog('ocrStatusDialog','ocr-status-dialog');
 const stored=activeDocuments().filter(doc=>doc.storedName);
 const indexed=stored.filter(doc=>['indexed','empty'].includes(doc.ocrStatus)).length;
 const needsOcr=stored.filter(doc=>doc.ocrStatus==='needs-ocr').length;
 const failed=stored.filter(doc=>doc.ocrStatus==='error').length;
 const unsupported=stored.filter(doc=>doc.ocrStatus==='unsupported').length;
 const missing=[];
 if(!capabilities.pdfImages)missing.push('Poppler PDF rendering');
 if(!capabilities.imageOcr)missing.push('Tesseract OCR');
 const toolsMissing=missing.length>0;
 const resultSummary=summary?`<div class="ocr-run-summary"><strong>Indexing results</strong><span>${summary.indexed} indexed</span><span>${summary.needsOcr} need OCR setup</span><span>${summary.unsupported} unsupported</span><span>${summary.failed} failed</span></div>`:'';
 const setup=toolsMissing?`<div class="ocr-setup-panel"><div class="ocr-setup-copy"><strong>OCR tools are incomplete</strong><p>Install <b>Tesseract OCR</b> and <b>Poppler</b> on the computer or container running GarageLog, restart GarageLog, and return here. The official GarageLog Docker image includes both tools.</p><small>All document text extraction remains local to the GarageLog host.</small></div></div>`:`<div class="ocr-ready-note">${svg('check')} Scanned PDF and image OCR tools are available.</div>`;
 const footerAction=toolsMissing?`<button type="button" class="secondary ocr-recheck">${svg('search')} Recheck tools</button>`:`<button type="button" class="primary ocr-retry" ${documentIndexProgress.running?'disabled':''}>${svg('search')} ${documentIndexProgress.running?'Indexing…':'Index All'}</button>`;
 dialog.innerHTML=`<div class="modal-header"><div><span class="wizard-eyebrow">LOCAL DOCUMENT SEARCH</span><h3>OCR & Indexing Status</h3><p>GarageLog extracts searchable text locally. No document content is uploaded.</p></div><button type="button" class="icon-btn ocr-close">${svg('close')}</button></div><div class="ocr-status-body">${resultSummary}<div class="ocr-index-overview"><div><strong>${indexed}</strong><span>Indexed</span></div><div><strong>${needsOcr}</strong><span>Needs OCR</span></div><div><strong>${failed}</strong><span>Failed</span></div><div><strong>${unsupported}</strong><span>Unsupported</span></div></div><div class="ocr-capability-list">${ocrCapabilityRow('Text-based PDFs',true,'Built-in managed PDF text extraction')}${ocrCapabilityRow('Scanned PDF rendering',Boolean(capabilities.pdfImages),'Poppler pdftoppm')}${ocrCapabilityRow('Image text recognition',Boolean(capabilities.imageOcr),'Tesseract OCR')}${ocrCapabilityRow('Scanned PDF OCR',Boolean(capabilities.scannedPdfOcr),'Requires both Poppler and Tesseract')}</div>${setup}<div class="ocr-status-note">Word DOCX files and text formats index without external OCR tools. Image-only PDFs and photographs require Tesseract and Poppler.</div></div><div class="modal-actions ocr-status-actions"><button type="button" class="secondary ocr-close-bottom">Close</button>${footerAction}</div>`;
 dialog.querySelector('.ocr-close').onclick=()=>dialog.close();
 dialog.querySelector('.ocr-close-bottom').onclick=()=>dialog.close();
 const retry=dialog.querySelector('.ocr-retry');
 if(retry)retry.onclick=()=>{dialog.close();indexAllDocuments()};
 const recheck=dialog.querySelector('.ocr-recheck');
 if(recheck)recheck.onclick=()=>{dialog.close();setTimeout(()=>openOcrStatus(summary),60)};
 dialog.showModal();
}
function openDocumentStorage(){
 const dialog=ensureDynamicDialog('documentStorageDialog','document-storage-dialog'),docs=state.documents||[],capacity=5*1024**3,total=docs.reduce((sum,doc)=>sum+Number(doc.bytes||parseSizeText(doc.size)||0),0),stored=docs.filter(doc=>doc.storedName),indexed=stored.filter(doc=>['indexed','empty'].includes(String(doc.ocrStatus||'').toLowerCase())).length,attention=stored.filter(doc=>['needs-ocr','setup-required','failed','error','index-failed','unsupported'].includes(String(doc.ocrStatus||'').toLowerCase())).length,metadataOnly=docs.length-stored.length,usedPct=Math.min(100,total/capacity*100);
 const categoryMap=new Map();for(const doc of docs){const category=normalizeDocumentCategory(doc.category),bytes=Number(doc.bytes||parseSizeText(doc.size)||0);const entry=categoryMap.get(category)||{category,count:0,bytes:0};entry.count++;entry.bytes+=bytes;categoryMap.set(category,entry)}const categories=[...categoryMap.values()].sort((a,b)=>b.bytes-a.bytes),maxCategory=Math.max(1,...categories.map(item=>item.bytes)),largest=[...stored].sort((a,b)=>Number(b.bytes||parseSizeText(b.size)||0)-Number(a.bytes||parseSizeText(a.size)||0)).slice(0,5);
 dialog.innerHTML=`<div class="modal-header"><div><span class="wizard-eyebrow">LOCAL FILE STORAGE</span><h3>Manage Document Storage</h3><p>Review stored files, search readiness, and space usage without deleting anything automatically.</p></div><button class="icon-btn storage-close">${svg('close')}</button></div><div class="storage-manager-body"><section class="storage-hero"><div class="storage-ring-detail" style="--storage-used:${Math.max(1,usedPct)}%"><span><strong>${formatBytes(total)}</strong><small>${usedPct.toFixed(1)}% of 5 GB</small></span></div><div><h4>${stored.length} stored file${stored.length===1?'':'s'}</h4><p>${docs.length} document record${docs.length===1?'':'s'} are tracked by GarageLog.</p><div class="storage-meter"><span style="width:${usedPct}%"></span></div><small>${formatBytes(Math.max(0,capacity-total))} available in the display allowance</small></div></section><div class="storage-metric-grid"><article><span>${svg('file')}</span><div><small>Stored files</small><strong>${stored.length}</strong></div></article><article><span>${svg('search')}</span><div><small>Searchable</small><strong>${indexed}</strong></div></article><article><span>${svg(attention?'warning':'check')}</span><div><small>Index attention</small><strong>${attention}</strong></div></article><article><span>${svg('info')}</span><div><small>Metadata only</small><strong>${metadataOnly}</strong></div></article></div><div class="storage-manager-grid"><section><div class="storage-section-title"><h4>Usage by category</h4><small>Based on recorded file sizes</small></div><div class="storage-category-list">${categories.length?categories.map(item=>`<div><span><strong>${esc(item.category)}</strong><small>${item.count} file${item.count===1?'':'s'}</small></span><b>${formatBytes(item.bytes)}</b><i><em style="width:${item.bytes/maxCategory*100}%"></em></i></div>`).join(''):'<p class="storage-empty">No documents have been uploaded.</p>'}</div></section><section><div class="storage-section-title"><h4>Largest files</h4><small>Top five stored documents</small></div><div class="storage-largest-list">${largest.length?largest.map(doc=>`<div>${fileTypeIcon(doc,true)}<span><strong>${esc(doc.name)}</strong><small>${esc(normalizeDocumentCategory(doc.category))}</small></span><b>${formatBytes(Number(doc.bytes||parseSizeText(doc.size)||0))}</b></div>`).join(''):'<p class="storage-empty">No stored files are available.</p>'}</div></section></div><div class="storage-safety-note">GarageLog does not automatically delete files or indexes. Use each document's action menu when you intentionally want to remove it.</div></div><div class="modal-actions storage-manager-actions">${attention?'<button class="secondary storage-index">Review Indexing</button>':''}${stored.length?'<button class="secondary storage-export">Export Files</button>':''}<button class="primary storage-done">Done</button></div>`;
 const close=()=>dialog.close();dialog.querySelector('.storage-close').onclick=close;dialog.querySelector('.storage-done').onclick=close;dialog.querySelector('.storage-index')?.addEventListener('click',()=>{dialog.close();openOcrStatus()});dialog.querySelector('.storage-export')?.addEventListener('click',()=>{dialog.close();openDocumentSelection('export')});dialog.showModal()
}

async function documentShareRequest(url,options={}){
 return authRequest(url,{cache:'no-store',...options})
}
async function listDocumentShares(){
 const result=await documentShareRequest('/api/document-shares');
 return Array.isArray(result?.shares)?result.shares:[]
}
function documentShareUrl(share){return share?.token?`${location.origin}/shared/${share.token}`:''}
function documentShareQrUrl(share){const link=documentShareUrl(share);return link?`/api/qr?text=${encodeURIComponent(link)}&v=${encodeURIComponent(share.token)}`:''}
function activeDocumentShare(shares,storedName){return(shares||[]).find(share=>share.status==='Active'&&share.storedName===storedName)||null}
function shareExpirationText(share){
 if(!share?.expiresUtc)return'Never';
 const date=new Date(share.expiresUtc);
 return Number.isNaN(date.getTime())?'Never':date.toLocaleString()
}
function shareAccessText(share){
 if(!share?.lastAccessUtc)return'Never opened';
 const date=new Date(share.lastAccessUtc);
 return Number.isNaN(date.getTime())?'Never opened':`${date.toLocaleString()} · ${number(share.accessCount||0)} access${Number(share.accessCount||0)===1?'':'es'}`
}
function shareExpirationOptions(includeKeep=false){
 return `${includeKeep?'<option value="keep">Keep current</option>':''}<option value="">Never</option><option value="1">1 day</option><option value="7">7 days</option><option value="30">30 days</option><option value="365">1 year</option><option value="custom">Custom date/time</option>`
}
function shareExpirationPayload(select,input){
 const value=select?.value??'';
 if(value==='keep')return{keep:true};
 if(value==='custom'){
  const raw=String(input?.value||'').trim();
  if(!raw)throw new Error('Choose a custom expiration date and time.');
  const date=new Date(raw);
  if(Number.isNaN(date.getTime()))throw new Error('Choose a valid custom expiration date and time.');
  if(date.getTime()<=Date.now()+60000)throw new Error('Custom expiration must be at least one minute in the future.');
  return{expiresInDays:null,expiresAtUtc:date.toISOString()}
 }
 return{expiresInDays:value===''?null:Number(value),expiresAtUtc:null}
}
async function copyTextToClipboard(value){
 if(navigator.clipboard?.writeText){
  try{await navigator.clipboard.writeText(value);return true}catch{}
 }
 const field=document.createElement('textarea');
 field.value=value;
 field.setAttribute('readonly','');
 field.style.position='fixed';
 field.style.left='-9999px';
 field.style.top='0';
 document.body.appendChild(field);
 field.focus();
 field.select();
 field.setSelectionRange(0,field.value.length);
 let copied=false;
 try{copied=document.execCommand('copy')}catch{}
 field.remove();
 return copied
}
async function createOrReuseDocumentShare(doc,expiration={expiresInDays:null,expiresAtUtc:null}){
 const result=await documentShareRequest('/api/document-shares',{
  method:'POST',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({storedName:doc.storedName,...expiration})
 });
 return result.share
}
window.shareDocument=index=>openDocumentShare(index);
async function openDocumentShare(initialIndex=null,options={}){
 const stored=state.documents.map((doc,index)=>({doc,index})).filter(item=>item.doc.storedName);
 if(!stored.length){toast('Upload a document before creating a share link');return}
 const dialog=ensureDynamicDialog('documentShareDialog','document-share-dialog');
 let shares=[];
 try{shares=await listDocumentShares()}catch(error){toast(error.message||'Unable to load document shares');return}
 let selected=initialIndex!==null&&state.documents[initialIndex]?.storedName?initialIndex:stored[0].index;
 let currentShare=activeDocumentShare(shares,state.documents[selected].storedName);
 let qrVisible=Boolean(options?.showQr&&currentShare);
 let busy=false;

 const updateLocalShare=share=>{
  shares=shares.filter(item=>item.token!==share.token&&!(item.status==='Active'&&item.storedName===share.storedName));
  shares.unshift(share);
  currentShare=share.status==='Active'?share:null
 };

 const refreshShares=async()=>{
  shares=await listDocumentShares();
  currentShare=activeDocumentShare(shares,state.documents[selected].storedName)
 };

 const ensureSelectedShare=async(expiration={expiresInDays:null,expiresAtUtc:null})=>{
  const doc=state.documents[selected];
  const share=await createOrReuseDocumentShare(doc,expiration);
  updateLocalShare(share);
  return share
 };

 const selectDocument=async nextIndex=>{
  if(busy)return;
  selected=nextIndex;
  qrVisible=true;
  busy=true;
  draw({loading:true});
  try{
   await refreshShares();
   if(!currentShare)await ensureSelectedShare();
   draw();
   toast(`Share link and QR code updated for ${state.documents[selected].name||'selected document'}`)
  }catch(error){
   currentShare=null;
   qrVisible=false;
   draw();
   toast(error.message||'Unable to update the selected document share')
  }finally{
   busy=false
  }
 };

 const draw=({loading=false}={})=>{
  const doc=state.documents[selected];
  const link=documentShareUrl(currentShare);
  const qrUrl=documentShareQrUrl(currentShare);
  const documentOptions=stored.map(item=>`<option value="${item.index}" ${item.index===selected?'selected':''}>${esc(item.doc.name)}</option>`).join('');
  let shareWorkspace='';

  if(loading){
   shareWorkspace=`<div class="share-loading-panel">${svg('clock')}<div><strong>Updating document share</strong><p>Creating or loading the selected document's active link and QR code.</p></div></div>`
  }else if(currentShare){
   const qrWorkspace=qrVisible
    ?`<div class="share-qr-workspace"><div class="share-qr"><img src="${qrUrl}" alt="QR code linking to ${esc(doc.name)}" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span hidden>QR generation is unavailable. Install the QR utility on the GarageLog host.</span></div><div class="share-qr-copy"><strong>Document QR code</strong><p>Scanning this code opens the active link shown above.</p><small>${esc(shareAccessText(currentShare))}</small><a class="secondary" href="${qrUrl}" download="garagelog-document-qr.svg">${svg('download')} Download QR SVG</a></div></div>`
    :`<button type="button" class="share-qr-placeholder generate-qr">${svg('qr')}<span><strong>Generate a QR code</strong><small>Useful for labels, folders, or quickly opening this document from another device.</small></span></button>`;

   shareWorkspace=`<div class="share-link-panel"><div class="share-link-status-row"><span class="share-status-pill active">Active</span><small>Expires: ${esc(shareExpirationText(currentShare))}</small></div><label>Share link<input class="share-link-input" value="${esc(link)}" readonly></label><div class="share-link-actions"><button type="button" class="secondary copy-share">${svg('share')} Copy Link</button><a class="secondary" href="mailto:?subject=${encodeURIComponent(`GarageLog document: ${doc.name}`)}&body=${encodeURIComponent(link)}">Email Link</a><button type="button" class="secondary generate-qr">${svg('qr')} ${qrVisible?'Refresh QR Code':'Generate QR Code'}</button><button type="button" class="secondary revoke-share">Revoke</button></div>${qrWorkspace}</div>`
  }else{
   shareWorkspace=`<div class="share-create-panel">${fileTypeIcon(doc)}<div><strong>${esc(doc.name)}</strong><p>Create a revocable link. GarageLog will keep it until it is revoked, expires, or its entry is permanently deleted.</p><div class="share-create-expiration"><label>Expiration<select class="share-expiry">${shareExpirationOptions(false)}</select></label><label class="share-custom-expiration" hidden>Custom expiration<input class="share-expiry-custom" type="datetime-local"></label></div></div><button type="button" class="primary create-share">${svg('share')} Create Link</button></div>`
  }

  dialog.innerHTML=`<div class="modal-header"><div><span class="wizard-eyebrow">LOCAL SHARING</span><h3>Share Document</h3><p>Create and manage a revocable local link for a stored document.</p></div><button type="button" class="icon-btn share-close">${svg('close')}</button></div><div class="share-dialog-body"><label>Document<select class="share-doc-select" ${loading?'disabled':''}>${documentOptions}</select></label>${shareWorkspace}<div class="share-privacy-note">Shared links are anonymous while active. GarageLog records access time and count only; it does not store visitor IP addresses for document shares.</div></div><div class="modal-actions"><button type="button" class="primary share-done">Done</button></div>`;

  dialog.querySelector('.share-close').onclick=()=>dialog.close();
  dialog.querySelector('.share-done').onclick=()=>dialog.close();
  
  dialog.querySelector('.share-doc-select').onchange=e=>selectDocument(Number(e.target.value));

  const createExpiry=dialog.querySelector('.share-expiry');
  const createCustom=dialog.querySelector('.share-expiry-custom');
  if(createExpiry&&createCustom){
   const sync=()=>{createCustom.closest('label').hidden=createExpiry.value!=='custom';if(createExpiry.value==='custom'&&!createCustom.value){const date=new Date(Date.now()+24*60*60*1000);date.setSeconds(0,0);createCustom.value=new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16)}};
   createExpiry.onchange=sync;sync()
  }

  dialog.querySelector('.create-share')?.addEventListener('click',async()=>{
   if(busy)return;
   busy=true;
   try{
    const expiration=shareExpirationPayload(createExpiry,createCustom);
    await ensureSelectedShare(expiration);
    qrVisible=true;
    draw();
    toast('Share link created and QR code generated')
   }catch(error){
    toast(error.message||'Unable to create the share link')
   }finally{
    busy=false
   }
  });

  dialog.querySelector('.revoke-share')?.addEventListener('click',async()=>{
   if(!currentShare||busy)return;
   busy=true;
   try{
    await documentShareRequest(`/api/document-shares/${encodeURIComponent(currentShare.token)}/revoke`,{method:'POST'});
    await refreshShares();
    qrVisible=false;
    draw();
    toast('Share link revoked')
   }catch(error){
    toast(error.message||'Unable to revoke the share link')
   }finally{
    busy=false
   }
  });

  dialog.querySelector('.copy-share')?.addEventListener('click',async()=>{
   const copied=await copyTextToClipboard(link);
   toast(copied?'Share link copied':'Unable to copy the share link')
  });

  dialog.querySelectorAll('.generate-qr').forEach(button=>button.addEventListener('click',async()=>{
   if(!currentShare||busy)return;
   if(!qrVisible){
    qrVisible=true;
    draw();
    toast('QR code generated');
    return
   }
   busy=true;
   try{
    const result=await documentShareRequest(`/api/document-shares/${encodeURIComponent(currentShare.token)}/rotate`,{method:'POST'});
    updateLocalShare(result.share);
    qrVisible=true;
    draw();
    toast('QR code refreshed; previous share link revoked')
   }catch(error){
    toast(error.message||'Unable to refresh the QR code')
   }finally{
    busy=false
   }
  }))
 };

 draw();
 dialog.showModal()
}
window.openDocumentShare=openDocumentShare;

async function openDocumentShareManager(){
 const dialog=ensureDynamicDialog('documentShareManagerDialog','document-share-manager-dialog');
 let shares=[];
 const load=async()=>{shares=await listDocumentShares()};
 try{await load()}catch(error){toast(error.message||'Unable to load share links');return}

 const documentFor=share=>state.documents.find(doc=>doc.storedName===share.storedName)||null;
 const vehicleFor=doc=>doc?vehicleNameFromId(doc.vehicleId):'Document no longer in library';
 const formatShareDate=value=>{
  if(!value)return'—';
  const date=new Date(value);
  return Number.isNaN(date.getTime())?'—':date.toLocaleString()
 };
 const statusTone=status=>status==='Active'?'active':status==='Expired'?'expired':'revoked';

 const rowHtml=share=>{
  const doc=documentFor(share);
  const index=doc?state.documents.indexOf(doc):-1;
  const icon=doc?fileTypeIcon(doc,true):`<span class="mini-doc-icon slate">${svg('file')}</span>`;
  const historyNote=share.status==='Expired'
   ?'This link expired and no longer opens the document.'
   :'This link was revoked and no longer opens the document.';
  const activeActions=share.status==='Active'
   ?`<button type="button" class="secondary share-manager-action-button" data-share-copy="${esc(share.token)}">${svg('share')} Copy</button><button type="button" class="secondary share-manager-action-button" data-share-qr="${index}" ${index<0?'disabled':''}>${svg('qr')} QR</button><button type="button" class="secondary share-manager-action-button rotate-share-button" data-share-rotate="${esc(share.token)}">${svg('qr')} Rotate Link</button><label class="share-expiration-update"><span>Expiration</span><select data-share-expiry="${esc(share.token)}">${shareExpirationOptions(true)}</select><input data-share-custom="${esc(share.token)}" type="datetime-local" hidden></label><button type="button" class="secondary share-manager-action-button" data-share-expiry-save="${esc(share.token)}">Update</button><button type="button" class="danger-outline share-manager-action-button" data-share-revoke="${esc(share.token)}">Revoke</button>`
   :'';
  const deleteAction=`<button type="button" class="danger-outline share-manager-action-button delete-share-entry-button" data-share-delete="${esc(share.token)}">${svg('trash')} Delete Entry</button>`;

  return `<article class="share-manager-row ${statusTone(share.status)}" data-share-token="${esc(share.token)}"><div class="share-manager-document">${icon}<div><strong>${esc(doc?.name||share.storedName)}</strong><small>${esc(vehicleFor(doc))}</small></div><span class="share-status-pill ${statusTone(share.status)}">${esc(share.status)}</span></div><dl class="share-manager-meta"><div><dt>Created</dt><dd>${esc(formatShareDate(share.createdUtc))}</dd></div><div><dt>Created by</dt><dd>${esc(share.createdBy||'Legacy share')}</dd></div><div><dt>Last accessed</dt><dd>${esc(formatShareDate(share.lastAccessUtc))}</dd></div><div><dt>Accesses</dt><dd>${number(share.accessCount||0)}</dd></div><div><dt>Expires</dt><dd>${esc(shareExpirationText(share))}</dd></div></dl>${share.status==='Active'?`<div class="share-manager-actions">${activeActions}${deleteAction}</div>`:`<div class="share-manager-history-row"><div class="share-manager-history-note">${historyNote}</div>${deleteAction}</div>`}</article>`
 };

 const draw=()=>{
  const active=shares.filter(share=>share.status==='Active');
  const history=shares.filter(share=>share.status!=='Active');
  const rows=[...active,...history];
  const listHtml=rows.length
   ?rows.map(rowHtml).join('')
   :`<div class="share-manager-empty"><span>${svg('shield')}</span><strong>No share links yet</strong><p>Create a document share to begin tracking it here.</p></div>`;

  dialog.innerHTML=`<div class="modal-header"><div><span class="wizard-eyebrow">SHARING SECURITY</span><h3>Active Share Links</h3><p>Review active and historical document links, expiration, access history, and revocation status.</p></div><button type="button" class="icon-btn share-manager-close">${svg('close')}</button></div><div class="share-manager-body"><div class="share-manager-summary"><div><strong>${active.length}</strong><span>Active</span></div><div><strong>${shares.filter(share=>share.status==='Expired').length}</strong><span>Expired</span></div><div><strong>${shares.filter(share=>share.status==='Revoked').length}</strong><span>Revoked</span></div><button type="button" class="danger-outline revoke-all-shares" ${active.length?'':'disabled'}>${svg('trash')} Revoke All Active</button></div><div class="share-manager-list">${listHtml}</div><div class="share-manager-security-note">${svg('shield')}<span>Rotating or deleting an active entry immediately invalidates its URL. Permanent deletion removes that share-link history record from GarageLog.</span></div></div><div class="modal-actions"><button type="button" class="primary share-manager-done">Done</button></div>`;

  dialog.querySelector('.share-manager-close').onclick=()=>dialog.close();
  dialog.querySelector('.share-manager-done').onclick=()=>dialog.close();

  dialog.querySelectorAll('[data-share-expiry]').forEach(select=>{
   const custom=dialog.querySelector(`[data-share-custom="${CSS.escape(select.dataset.shareExpiry)}"]`);
   const sync=()=>{
    if(!custom)return;
    custom.hidden=select.value!=='custom';
    if(select.value==='custom'&&!custom.value){
     const date=new Date(Date.now()+24*60*60*1000);date.setSeconds(0,0);
     custom.value=new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16)
    }
   };
   select.addEventListener('change',sync);sync()
  });

  dialog.querySelector('.revoke-all-shares')?.addEventListener('click',async()=>{
   if(!confirm(`Revoke all ${active.length} active document share link${active.length===1?'':'s'}?`))return;
   try{
    const result=await documentShareRequest('/api/document-shares/revoke-all',{method:'POST'});
    await load();
    draw();
    toast(`${result.revoked||0} active share link${Number(result.revoked||0)===1?'':'s'} revoked`)
   }catch(error){
    toast(error.message||'Unable to revoke active share links')
   }
  });

  dialog.querySelectorAll('[data-share-copy]').forEach(button=>button.onclick=async()=>{
   const share=shares.find(item=>item.token===button.dataset.shareCopy);
   const copied=await copyTextToClipboard(documentShareUrl(share));
   toast(copied?'Share link copied':'Unable to copy the share link')
  });

  dialog.querySelectorAll('[data-share-qr]').forEach(button=>button.onclick=()=>{
   const index=Number(button.dataset.shareQr);
   if(index<0)return;
   dialog.close();
   openDocumentShare(index,{showQr:true})
  });

  dialog.querySelectorAll('[data-share-rotate]').forEach(button=>button.onclick=async()=>{
   try{
    await documentShareRequest(`/api/document-shares/${encodeURIComponent(button.dataset.shareRotate)}/rotate`,{method:'POST'});
    await load();
    draw();
    toast('Share link rotated; previous URL revoked')
   }catch(error){
    toast(error.message||'Unable to rotate the share link')
   }
  });

  dialog.querySelectorAll('[data-share-revoke]').forEach(button=>button.onclick=async()=>{
   try{
    await documentShareRequest(`/api/document-shares/${encodeURIComponent(button.dataset.shareRevoke)}/revoke`,{method:'POST'});
    await load();
    draw();
    toast('Share link revoked')
   }catch(error){
    toast(error.message||'Unable to revoke the share link')
   }
  });

  dialog.querySelectorAll('[data-share-delete]').forEach(button=>button.onclick=()=>{
   const token=button.dataset.shareDelete;
   const share=shares.find(item=>item.token===token);
   const confirmDialog=ensureDynamicDialog('shareLinkDeleteDialog','expense-delete-dialog');
   const documentRecord=documentFor(share);
   const activeWarning=share?.status==='Active'
    ?'<div class="expense-delete-note">This share link is currently active. Deleting the entry will immediately invalidate its URL.</div>'
    :'';
   confirmDialog.innerHTML=`<div class="modal-header"><div><span class="wizard-eyebrow danger">DELETE SHARE LINK</span><h3>Delete this share-link entry?</h3><p>Permanently remove this share-link history entry from GarageLog.</p></div><button type="button" class="icon-btn share-delete-close">${svg('close')}</button></div><div class="expense-delete-body"><div class="expense-delete-summary"><span class="expense-delete-icon">${svg('trash')}</span><div><strong>${esc(documentRecord?.name||share?.storedName||'Share link')}</strong><small>${esc(share?.status||'Share link')} · Created ${esc(formatShareDate(share?.createdUtc))}</small></div></div>${activeWarning}</div><div class="modal-actions"><button type="button" class="secondary share-delete-cancel">Cancel</button><button type="button" class="danger-button share-delete-confirm">${svg('trash')} Delete Entry</button></div>`;
   const close=()=>confirmDialog.close();
   confirmDialog.querySelector('.share-delete-close').onclick=close;
   confirmDialog.querySelector('.share-delete-cancel').onclick=close;
   confirmDialog.querySelector('.share-delete-confirm').onclick=async()=>{
    const confirmButton=confirmDialog.querySelector('.share-delete-confirm');
    confirmButton.disabled=true;
    try{
     await documentShareRequest(`/api/document-shares/${encodeURIComponent(token)}`,{method:'DELETE'});
     confirmDialog.close();
     await load();
     draw();
     toast('Share-link entry permanently deleted')
    }catch(error){
     confirmButton.disabled=false;
     toast(error.message||'Unable to delete the share-link entry')
    }
   };
   confirmDialog.showModal()
  });

  dialog.querySelectorAll('[data-share-expiry-save]').forEach(button=>button.onclick=async()=>{
   const token=button.dataset.shareExpirySave;
   const select=dialog.querySelector(`[data-share-expiry="${CSS.escape(token)}"]`);
   const custom=dialog.querySelector(`[data-share-custom="${CSS.escape(token)}"]`);
   let expiration;
   try{
    expiration=shareExpirationPayload(select,custom)
   }catch(error){
    toast(error.message);
    return
   }
   if(expiration.keep){toast('Choose a new expiration setting');return}
   try{
    await documentShareRequest(`/api/document-shares/${encodeURIComponent(token)}/expiration`,{
     method:'PUT',
     headers:{'Content-Type':'application/json'},
     body:JSON.stringify(expiration)
    });
    await load();
    draw();
    toast(expiration.expiresAtUtc?'Custom expiration updated':expiration.expiresInDays?`Share link expires in ${expiration.expiresInDays===365?'1 year':`${expiration.expiresInDays} day${expiration.expiresInDays===1?'':'s'}`}`:'Share link expiration removed')
   }catch(error){
    toast(error.message||'Unable to update link expiration')
   }
  })
 };

 draw();
 dialog.showModal()
}
window.openDocumentShareManager=openDocumentShareManager;
function openDocumentSelection(mode){
 const stored=state.documents.map((doc,index)=>({doc,index})).filter(item=>item.doc.storedName);
 if(!stored.length){toast('No stored documents are available');return}
 const dialog=ensureDynamicDialog('documentSelectionDialog','document-selection-dialog'),title=mode==='export'?'Export Documents as ZIP':'Print Documents';
 dialog.innerHTML=`<form><div class="modal-header"><div><h3>${title}</h3><p>${mode==='export'?'Choose files for one ZIP archive.':'Choose files for a printer-friendly queue.'}</p></div><button type="button" class="icon-btn selection-close">${svg('close')}</button></div><div class="document-selection-list">${stored.map(item=>`<label><input type="checkbox" name="documentIndex" value="${item.index}">${fileTypeIcon(item.doc,true)}<span><strong>${esc(item.doc.name)}</strong><small>${esc(item.doc.category)} - ${esc(item.doc.size||'')}</small></span></label>`).join('')}</div><div class="modal-actions"><div class="selection-bulk-actions"><button type="button" class="secondary selection-all">Select All</button><button type="button" class="secondary selection-none">Unselect All</button></div><button type="button" class="secondary selection-cancel">Cancel</button><button type="submit" class="primary">${mode==='export'?'Export ZIP':'Build Print Queue'}</button></div></form>`;
 dialog.querySelector('.selection-close').onclick=()=>dialog.close();
 dialog.querySelector('.selection-cancel').onclick=()=>dialog.close();
 const checkboxes=[...dialog.querySelectorAll('input[name="documentIndex"]')];
 dialog.querySelector('.selection-all').onclick=()=>{checkboxes.forEach(input=>input.checked=true);toast('All documents selected')};
 dialog.querySelector('.selection-none').onclick=()=>{checkboxes.forEach(input=>input.checked=false);toast('All documents unselected')};
 dialog.querySelector('form').onsubmit=async e=>{
  e.preventDefault();
  const indexes=new FormData(e.currentTarget).getAll('documentIndex').map(Number);
  if(!indexes.length){toast('Select at least one document');return}
  if(mode==='export')await exportSelectedDocuments(indexes);else openPrintQueue(indexes);
  dialog.close()
 };
 dialog.showModal()
}
window.openDocumentSelection=openDocumentSelection;
async function exportSelectedDocuments(indexes){const docs=indexes.map(index=>state.documents[index]).filter(doc=>doc?.storedName),fileNames=Object.fromEntries(docs.map(doc=>[doc.storedName,doc.name]));const response=await fetch('/api/documents/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storedNames:docs.map(doc=>doc.storedName),fileNames})});if(!response.ok){const data=await response.json().catch(()=>({}));toast(data.error||'Unable to export documents');return}const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download=`garagelog-documents-${new Date().toISOString().slice(0,10)}.zip`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1500);toast(`Exported ${docs.length} documents`)}
function openPrintQueue(indexes){const docs=indexes.map(index=>state.documents[index]).filter(doc=>doc?.storedName),popup=openCenteredWindow('','garageLogDocumentPrintQueue',960,760);if(!popup){toast('Allow pop-ups to open the print queue');return}popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>GarageLog Document Print Queue</title><link rel="icon" type="image/png" href="${APP_FAVICON_PATH}"><style>*{box-sizing:border-box}body{font-family:Segoe UI,Arial;margin:0;color:#172033;background:#f4f7fb}.shell{max-width:900px;margin:28px auto;background:white;border:1px solid #dbe3ee;border-radius:14px;overflow:hidden;box-shadow:0 18px 44px rgba(15,23,42,.12)}header{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;padding:24px 28px;border-bottom:1px solid #dbe3ee}h1{font-size:23px;margin:0 0 5px}p{margin:0;color:#64748b}.close{border:1px solid #cfd7e3;background:white;border-radius:8px;padding:8px 12px;cursor:pointer}.list{padding:4px 28px 24px}article{display:flex;justify-content:space-between;align-items:center;gap:20px;border-bottom:1px solid #e5eaf1;padding:16px 0}article:last-child{border-bottom:0}a{background:#2563eb;color:#fff;padding:9px 14px;border-radius:8px;text-decoration:none;white-space:nowrap}small{display:block;color:#64748b;margin-top:4px}.note{margin:18px 28px 0;padding:12px 14px;border-radius:9px;background:#eff6ff;color:#334155;font-size:13px}</style></head><body><main class="shell"><header><div><h1>Document Print Queue</h1><p>Review the selected files, then open and print each document when ready.</p></div><button class="close" onclick="window.close()">Close</button></header><div class="note">GarageLog will not open the browser print dialog automatically.</div><section class="list">${docs.map(doc=>`<article><div><strong>${esc(doc.name)}</strong><small>${esc(doc.category)} · ${esc(doc.size||'')}</small></div><a href="/api/documents/${encodeURIComponent(doc.storedName)}/preview" target="_blank">Open Document</a></article>`).join('')}</section></main></body></html>`);popup.document.close()}
function documentMatchesSearch(doc,value=documentSearchQuery){
 const query=String(value||'').trim().toLowerCase();
 if(!query)return true;
 const normalizedCategory=normalizeDocumentCategory(doc?.category);
  return searchMatches([doc?.name,doc?.originalName,normalizedCategory,documentShopValue(doc),...documentServiceValues(doc),vehicleNameFromId(doc?.vehicleId||state.activeVehicleId),doc?.ocrText,...documentTags(doc||{})].filter(Boolean).join(' '),query)
}
window.setDocumentSearchQuery=function(value){
 documentSearchQuery=String(value||'');
 if(current==='Documents'){
  topSearchQuery=documentSearchQuery;
  const topInput=document.getElementById('globalSearch');
  if(topInput&&topInput.value!==topSearchQuery)topInput.value=topSearchQuery;
 }
 const table=document.querySelector('.documents-table');
 if(!table)return;
 const rows=[...table.querySelectorAll('tbody tr[data-document-index]')];
 let shown=0;
 rows.forEach(row=>{
   const index=Number(row.dataset.documentIndex),doc=state.documents[index],matches=Boolean(doc)&&documentMatchesSearch(doc,documentSearchQuery);
   row.hidden=!matches;
   if(matches)shown++
 });
 const empty=table.querySelector('tbody .document-search-empty');
 if(empty)empty.hidden=shown>0;
 const footer=document.querySelector('.documents-table-card .documents-table-footer');
 if(footer){const total=Number(footer.dataset.documentTotal||rows.length);footer.textContent=`Showing ${shown?1:0} to ${shown} of ${total} items`}
}
window.useDocumentSearch=function(value){
 const input=document.getElementById('documentOcrSearch');
 if(input)input.value=value;
 setDocumentSearchQuery(value);
 if(input){input.focus();input.setSelectionRange(input.value.length,input.value.length)}
}


const TOP_SEARCH_FILTER_PAGES=new Set(['Documents','Expenses','Maintenance','Reminders']);
const TOP_SEARCH_GLOBAL_PAGES=new Set(['Dashboard','Garage','Reports']);
function normalizedSearchQuery(value=topSearchQuery){return String(value||'').trim().toLowerCase()}
function searchText(...values){return values.flat(Infinity).filter(value=>value!==null&&value!==undefined&&value!=='').map(value=>String(value)).join(' ').toLowerCase()}
function searchMatches(haystack,query){const q=normalizedSearchQuery(query);if(!q)return true;const text=String(haystack||'').toLowerCase(),terms=q.split(/\s+/).filter(Boolean);return terms.every(term=>text.includes(term))}
function recordVehicleForSearch(item){return state.vehicles.find(vehicle=>String(vehicle.id)===String(item?.vehicleId||state.activeVehicleId))||activeVehicle()}
function maintenanceMatchesTopSearch(item,query=topSearchQuery){const q=normalizedSearchQuery(query);if(!q)return true;const vehicle=recordVehicleForSearch(item);return searchMatches(searchText(item?.name,item?.interval,item?.rule,item?.due,item?.status,effectiveMaintenanceStatus(item),maintenanceDescription(item?.name),vehicleFullName(vehicle),vehicle?.vin),q)}
function expenseMatchesTopSearch(item,query=topSearchQuery){const q=normalizedSearchQuery(query);if(!q)return true;const vehicle=recordVehicleForSearch(item);return searchMatches(searchText(item?.date,item?.category,item?.vendor,item?.notes,item?.amount,item?.gallons,item?.odometer,item?.mpg,expenseCoverageLabel(item),item?.coveredAmount,vehicleFullName(vehicle),vehicle?.vin),q)}
function reminderMatchesTopSearch(item,query=topSearchQuery){const q=normalizedSearchQuery(query);if(!q)return true;const vehicle=recordVehicleForSearch(item);return searchMatches(searchText(item?.name,item?.rule,item?.due,item?.status,item?.triggerType,item?.repeatMiles,vehicleFullName(vehicle),vehicle?.vin),q)}
function topSearchMode(page=current){return TOP_SEARCH_FILTER_PAGES.has(page)?'filter':'global'}
function topSearchPlaceholder(page=current){return ({Documents:'Filter documents…',Expenses:'Filter expenses…',Maintenance:'Filter maintenance…',Reminders:'Filter reminders…'})[page]||'Search GarageLog…'}
function ensureTopSearchResults(){const shell=document.querySelector('.search-shell');if(!shell)return null;let panel=document.getElementById('topSearchResults');if(!panel){panel=document.createElement('section');panel.id='topSearchResults';panel.className='top-search-results';panel.setAttribute('aria-label','GarageLog search results');panel.hidden=true;shell.appendChild(panel)}return panel}
function hideTopSearchResults(){const panel=document.getElementById('topSearchResults');if(panel)panel.hidden=true}
function clearTopSearch({clearDocumentSearch=true,updateInput=true}={}){topSearchQuery='';if(clearDocumentSearch)documentSearchQuery='';const input=document.getElementById('globalSearch');if(updateInput&&input)input.value='';hideTopSearchResults()}
function globalSearchResultScore(title,text,query){const q=normalizedSearchQuery(query),name=String(title||'').toLowerCase();if(name===q)return 0;if(name.startsWith(q))return 1;if(name.includes(q))return 2;return searchMatches(text,q)?3:99}
function buildGlobalSearchResults(query){
 const q=normalizedSearchQuery(query);if(!q||!state)return[];
 const results=[],push=(result,terms)=>{const haystack=searchText(terms);if(!searchMatches(haystack,q))return;results.push({...result,score:globalSearchResultScore(result.title,haystack,q)})};
 (state.vehicles||[]).forEach((vehicle,index)=>push({type:'vehicle',page:'Garage',index,vehicleId:vehicle.id,icon:'car',title:vehicleFullName(vehicle),subtitle:[vehicle.vin?`VIN ${vehicle.vin}`:'',vehicle.mileage!==undefined?`${number(vehicle.mileage)} mi`:'',isVehicleArchived(vehicle)?'Archived':'Vehicle'].filter(Boolean).join(' · ')},[vehicleFullName(vehicle),vehicle.name,vehicle.year,vehicle.make,vehicle.model,vehicle.trim,vehicle.vin,vehicle.engine,vehicle.drivetrain,vehicle.color,vehicle.powertrain,vehicle.mileage]));
 (state.maintenance||[]).forEach((item,index)=>{const vehicle=recordVehicleForSearch(item);push({type:'maintenance',page:'Maintenance',index,vehicleId:vehicle?.id,icon:'wrench',title:item.name||'Maintenance item',subtitle:[vehicleFullName(vehicle),item.due||item.interval||'',effectiveMaintenanceStatus(item)].filter(Boolean).join(' · ')},[item.name,item.interval,item.rule,item.due,item.status,effectiveMaintenanceStatus(item),maintenanceDescription(item.name),vehicleFullName(vehicle),vehicle?.vin])});
 (state.expenses||[]).forEach((item,index)=>{const vehicle=recordVehicleForSearch(item);push({type:'expense',page:'Expenses',index,vehicleId:vehicle?.id,icon:'dollar',title:`${item.category||'Expense'}${item.vendor?` · ${item.vendor}`:''}`,subtitle:[vehicleFullName(vehicle),item.date||'',money(item.amount||0)].filter(Boolean).join(' · ')},[item.date,item.category,item.vendor,item.notes,item.amount,item.gallons,item.odometer,item.mpg,expenseCoverageLabel(item),item.coveredAmount,vehicleFullName(vehicle),vehicle?.vin])});
 (state.documents||[]).forEach((item,index)=>{const vehicle=recordVehicleForSearch(item);push({type:'document',page:'Documents',index,vehicleId:vehicle?.id,icon:'file',title:item.name||item.originalName||'Document',subtitle:[vehicleFullName(vehicle),normalizeDocumentCategory(item.category),documentOcrStatusLabel(item)].filter(Boolean).join(' · ')},[item.name,item.originalName,item.category,documentShopValue(item),documentServiceValues(item),documentTags(item),item.ocrText,vehicleFullName(vehicle),vehicle?.vin])});
 (state.reminders||[]).forEach((item,index)=>{const vehicle=recordVehicleForSearch(item);push({type:'reminder',page:'Reminders',index,vehicleId:vehicle?.id,icon:'bell',title:item.name||'Reminder',subtitle:[vehicleFullName(vehicle),item.due||item.rule||'',effectiveReminderStatus(item)].filter(Boolean).join(' · ')},[item.name,item.rule,item.due,item.status,item.triggerType,item.repeatMiles,vehicleFullName(vehicle),vehicle?.vin])});
 const order={vehicle:0,maintenance:1,expense:2,document:3,reminder:4};
 return results.sort((a,b)=>a.score-b.score||(order[a.type]??9)-(order[b.type]??9)||String(a.title).localeCompare(String(b.title))).slice(0,14)
}
function renderGlobalSearchResults(query=topSearchQuery){
 const panel=ensureTopSearchResults();if(!panel)return;
 const q=normalizedSearchQuery(query);if(!q||topSearchMode()!=='global'){panel.hidden=true;return}
 const results=buildGlobalSearchResults(q),label={vehicle:'Vehicle',maintenance:'Maintenance',expense:'Expense',document:'Document',reminder:'Reminder'};
 panel.innerHTML=`<div class="top-search-results-head"><strong>Search GarageLog</strong><small>${results.length} result${results.length===1?'':'s'}${results.length===14?' shown':''}</small></div><div class="top-search-results-list">${results.length?results.map(result=>`<button type="button" class="top-search-result" data-search-result="${esc(result.type)}:${result.index}" onclick="openTopSearchResult(${attrJs(result.page)},${attrJs(String(result.vehicleId??''))},${attrJs(result.type)},${result.index})"><span class="top-search-result-icon">${svg(result.icon)}</span><span><strong>${esc(result.title)}</strong><small>${esc(result.subtitle)}</small></span><em>${label[result.type]||'Record'}</em></button>`).join(''):`<div class="top-search-no-results">${svg('search')}<strong>No GarageLog records match “${esc(String(query).trim())}”</strong><small>Search vehicle details, maintenance, expenses, documents, reminders, VINs, vendors, notes, tags, and indexed document text.</small></div>`}</div>`;
 panel.hidden=false
}
function resultDestinationQuery(type,index){if(type==='maintenance'){const item=state.maintenance?.[index];return [item?.name,item?.due].filter(Boolean).join(' ')}if(type==='expense'){const item=state.expenses?.[index];return [item?.vendor,item?.date,item?.amount].filter(value=>value!==undefined&&value!==null&&value!=='').join(' ')||String(item?.category||'')}if(type==='document'){const item=state.documents?.[index];return String(item?.name||item?.originalName||'')}if(type==='reminder'){const item=state.reminders?.[index];return [item?.name,item?.due].filter(Boolean).join(' ')}return''}
window.openTopSearchResult=async function(page,vehicleId,type,index){
 hideTopSearchResults();
 if(vehicleId&&state.vehicles.some(vehicle=>String(vehicle.id)===String(vehicleId)))activateVehicle(String(vehicleId),false);
 current=page||'Dashboard';currentFilter='All';if(current==='Reports')reportViewMode='dashboard';if(current==='Expenses')expenseViewMode='expenses';if(current==='Reminders')reminderViewMode='list';
 topSearchQuery=type==='vehicle'?'':resultDestinationQuery(type,index);documentSearchQuery=current==='Documents'?topSearchQuery:'';const input=document.getElementById('globalSearch');if(input)input.value=topSearchQuery;render();
 requestAnimationFrame(()=>{const target=document.querySelector(`[data-search-key="${CSS.escape(`${type}:${index}`)}"]`);if(!target)return;target.scrollIntoView({behavior:'smooth',block:'center'});target.classList.add('search-target-flash');setTimeout(()=>target.classList.remove('search-target-flash'),1800)});
 if(vehicleId&&canWrite())try{await saveNow()}catch{}
}
function applySearch(){
 const input=document.getElementById('globalSearch');if(!input)return;input.placeholder=topSearchPlaceholder();input.setAttribute('aria-label',topSearchMode()==='filter'?topSearchPlaceholder().replace('…',''):'Search all GarageLog records');
 if(input.value!==topSearchQuery)input.value=topSearchQuery;
 if(topSearchMode()==='global')renderGlobalSearchResults(topSearchQuery);else hideTopSearchResults()
}
function handleTopSearchInput(event){
 topSearchQuery=String(event?.target?.value||'');
 if(current==='Documents')documentSearchQuery=topSearchQuery;
 if(current==='Expenses'&&expenseViewMode==='budget'&&normalizedSearchQuery()){expenseViewMode='expenses';render();return}
 if(current==='Reminders'&&reminderViewMode==='calendar'&&normalizedSearchQuery()){reminderViewMode='list';render();return}
 if(TOP_SEARCH_FILTER_PAGES.has(current))render();else renderGlobalSearchResults(topSearchQuery)
}

async function saveNow(){if(!canWrite())throw new Error('This account has read-only access.');persistActiveVehicle();const vehicle=activeVehicle();let mileage=Number(state?.mileage);if(!Number.isFinite(mileage)||mileage<0)mileage=Number(vehicle?.mileage);if(!Number.isFinite(mileage)||mileage<0)mileage=0;state.mileage=Math.round(mileage);if(vehicle)vehicle.mileage=state.mileage;const r=await fetch('/api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(state)});if(r.status===401){authSession={configured:true,authenticated:false};renderAuthScreen('login','Your session expired. Sign in again.');throw new Error('Session expired')}if(!r.ok){const d=await r.json().catch(()=>({}));throw new Error(d.error||`Unable to save (${r.status})`)}}
function save(message='Saved locally'){clearTimeout(saveTimer);saveTimer=setTimeout(()=>saveNow().then(()=>toast(message)).catch(e=>{console.error(e);toast('Save failed')}),120)}

function renderNav(){nav.innerHTML=navItems.map(x=>`<button class="nav-btn ${x===current?'active':''}" data-page="${x}">${navIcon(x)}<span>${x}</span></button>`).join('');nav.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>{clearTopSearch();current=b.dataset.page;currentFilter='All';render()})}
function pageHead(title,desc,action=''){return `<div class="page-head"><div><h1>${title}</h1><p>${desc}</p></div>${action}</div>`}
function primary(label,action,icon='plus'){return `<button class="primary" onclick="${action}">${svg(icon)}${label}</button>`}
function summaryCard(label,value,sub='',icon='gauge',tone='blue',change=''){return `<div class="card summary-card"><div class="summary-icon ${tone}">${svg(icon)}</div><div><div class="muted">${label}</div><div class="metric">${value}</div><div class="muted">${sub}</div>${change?`<div class="kpi-change">${change}</div>`:''}</div></div>`}
function actionButtons(type,index,allowOpen=false){return `<div class="action-menu">${allowOpen?`<button class="mini-btn" title="Open" onclick="openDocument(${index})">${svg('external')}</button>`:''}<button class="mini-btn" title="Edit" onclick="editRecord('${type}',${index})">${svg('edit')}</button><button class="mini-btn" title="Delete" onclick="deleteRecord('${type}',${index})">${svg('trash')}</button></div>`}
function expenseTotals(vehicleId=state.activeVehicleId){
 const expenses=recordsFor('expenses',vehicleId),sum=list=>list.reduce((total,item)=>total+Number(item.amount||0),0);
 const total=sum(expenses),yearly=sum(yearExpenses(vehicleId));
 const maintenance=sum(expenses.filter(item=>['Maintenance','Repair','Parts'].includes(item.category)));
 const fuel=sum(expenses.filter(item=>item.category==='Fuel'));
 const readings=odometerReadings(vehicleId);
 let trackedMiles=0,trackedCost=0,costPerMile=null,trackingStart=null,trackingEnd=null;
 if(readings.length>=2){
   const first=readings[0],last=readings[readings.length-1];
   trackedMiles=Math.max(0,last.mileage-first.mileage);trackingStart=localDateStart(first.date);trackingEnd=localDateEnd(last.date);
   if(trackedMiles>0){trackedCost=sum(expenses.filter(item=>{const date=parseRecordDate(item.date);return date&&date>=trackingStart&&date<=trackingEnd}));costPerMile=trackedCost/trackedMiles}
 }
 return{total,yearly,maintenance,fuel,trackedMiles,trackedCost,costPerMile,trackingStart,trackingEnd,readingCount:readings.length}
}
function maintenanceCounts(vehicleId=state.activeVehicleId){return recordsFor('maintenance',vehicleId).reduce((a,m)=>{const priority=maintenancePriorityMeta(m),status=effectiveMaintenanceStatus(m);if(priority.rank===0)a.overdue++;else if(priority.rank===1)a.due++;else if(status!=='Completed')a.track++;return a},{overdue:0,due:0,track:0})}

function parseMileageValue(value){const match=String(value||'').replaceAll(',','').match(/(-?\d+(?:\.\d+)?)/);return match?Number(match[1]):null}
function maintenanceIntervalMiles(item){
 const explicit=Number(item?.repeatMiles);if(Number.isFinite(explicit)&&explicit>0)return explicit;
 const interval=/mi|mile/i.test(String(item?.interval||item?.rule||''))?parseMileageValue(item?.interval||item?.rule):null;
 if(Number.isFinite(interval)&&interval>0)return interval;
 const max=Number(item?.max);return Number.isFinite(max)&&max>0?max:null
}
function recordVehicleMileage(item){const vehicle=state.vehicles.find(entry=>String(entry.id)===String(item?.vehicleId))||activeVehicle();return Number(vehicle?.mileage??state.mileage??0)}
function mileageScheduleMeta(item){
 const dueMileage=parseMileageValue(item?.due),interval=maintenanceIntervalMiles(item);
 if(dueMileage===null||!interval||!/mi|mile/i.test(String(item?.due||item?.interval||item?.rule||'')))return null;
 const linkedReminder=item?.reminderId?state.reminders.find(entry=>entry.id===item.reminderId):null,currentMileage=recordVehicleMileage(item);
 const rawStart=item?.serviceMileage??linkedReminder?.serviceMileage,storedStart=rawStart===''||rawStart===null||rawStart===undefined?null:Number(rawStart),serviceMileage=Number.isFinite(storedStart)?storedStart:dueMileage-interval;
 const rawLead=item?.leadTime??linkedReminder?.leadTime,storedLead=rawLead===''||rawLead===null||rawLead===undefined?null:Number(rawLead),remaining=dueMileage-currentMileage,lead=Number.isFinite(storedLead)?Math.max(0,storedLead):Math.min(1000,Math.max(100,Math.round(interval*.1)));
 const percent=Math.min(100,Math.max(0,remaining/interval*100));
 const status=String(item?.status||'')==='Completed'?'Completed':remaining<0?'Overdue':remaining<=lead||percent<=MAINTENANCE_WARNING_PERCENT?'Due Soon':'Upcoming';
 const beforeStart=currentMileage<serviceMileage;
 const label=remaining<0?`Overdue by ${number(Math.abs(remaining))} mi`:beforeStart?`${number(serviceMileage-currentMileage)} mi until interval begins`:`${number(Math.max(0,remaining))} mi remaining`;
 return{dueMileage,interval,currentMileage,serviceMileage,remaining,lead,percent,status,beforeStart,label,detail:`${number(currentMileage)} / ${number(dueMileage)} mi`}
}
function effectiveMaintenanceStatus(item){return mileageScheduleMeta(item)?.status||item?.status||'On track'}
function effectiveReminderStatus(item){return mileageScheduleMeta(item)?.status||item?.status||'Upcoming'}
function remainingLifeGauge(percent,status){
 const value=Math.min(100,Math.max(0,Number(percent||0))),overdue=/overdue/i.test(String(status||''));
 return{percent:value,tone:overdue||value<=MAINTENANCE_DANGER_PERCENT?'gauge-danger':value<=MAINTENANCE_WARNING_PERCENT?'gauge-warning':'gauge-healthy',width:value>0?Math.max(4,value):4}
}
function maintenanceGaugeMeta(item,meta=maintenanceProgressMeta(item),status=effectiveMaintenanceStatus(item)){
 const statusText=String(status||'').toLowerCase();
 if(statusText==='completed')return{percent:100,tone:'gauge-healthy',width:100};
 if(meta?.checklist){
   const value=Math.min(100,Math.max(0,Number(meta.percent||0)));
   return{percent:value,tone:value>=100?'gauge-healthy':'gauge-progress',width:value>0?Math.max(4,value):0};
 }
 if(!meta||(!meta.detail&&!meta.mileage))return{percent:0,tone:'gauge-neutral',width:0};
 return remainingLifeGauge(meta.percent,status)
}
function parseScheduleDate(value){
 if(!value)return null;
 const text=String(value),date=/^\d{4}-\d{2}-\d{2}$/.test(text)?new Date(`${text}T12:00:00`):new Date(text);
 return Number.isNaN(date.getTime())?null:date
}
function recurringReminderIntervalMonths(item){
 const match=String(item?.rule||'').match(/Every\s+([\d,]+)\s+(months?|years?)/i);
 if(!match)return 0;
 const amount=Number(String(match[1]).replaceAll(',',''))||0;
 return match[2].toLowerCase().startsWith('year')?amount*12:amount
}
function subtractCalendarMonths(date,months){
 const result=new Date(date),day=result.getDate();
 result.setDate(1);result.setMonth(result.getMonth()-months);
 result.setDate(Math.min(day,new Date(result.getFullYear(),result.getMonth()+1,0).getDate()));
 return result
}
function dateReminderScheduleMeta(item){
 const dueDate=parseScheduleDate(item?.due);if(!dueDate)return null;
 const now=new Date(),today=new Date(now.getFullYear(),now.getMonth(),now.getDate(),12),dayMs=86400000,intervalMonths=recurringReminderIntervalMonths(item);
 let cycleStart=intervalMonths?subtractCalendarMonths(dueDate,intervalMonths):parseScheduleDate(item?.startDate||item?.createdAt);
 if(!cycleStart||cycleStart>=dueDate)cycleStart=new Date(dueDate.getTime()-365*dayMs);
 const totalDays=Math.max(1,Math.round((dueDate-cycleStart)/dayMs)),remainingDays=Math.ceil((dueDate-today)/dayMs),beforeStart=today<cycleStart;
 const percent=beforeStart?100:Math.min(100,Math.max(0,remainingDays/totalDays*100)),lead=Math.max(0,Number(item?.leadTime??30)),upcomingWindow=Math.max(90,lead*2);
 const status=String(item?.status||'')==='Completed'?'Completed':remainingDays<0?'Overdue':remainingDays<=lead?'Due':remainingDays<=upcomingWindow?'Upcoming':'Active';
 const label=remainingDays<0?`Overdue by ${Math.abs(remainingDays)} day${Math.abs(remainingDays)===1?'':'s'}`:beforeStart?`${Math.ceil((cycleStart-today)/dayMs)} day${Math.ceil((cycleStart-today)/dayMs)===1?'':'s'} until renewal interval begins`:`${remainingDays} day${remainingDays===1?'':'s'} remaining`;
 return{dueDate,cycleStart,totalDays,remainingDays,beforeStart,percent,status,label,lead,upcomingWindow}
}
function parseLocalDate(value){if(!value)return null;const date=new Date(value);return Number.isNaN(date.getTime())?null:date}
function vehicleHealthStatus(vehicleId=state.activeVehicleId){
 const vehicle=state.vehicles.find(v=>v.id===vehicleId)||activeVehicle();
 const maintenance=recordsFor('maintenance',vehicleId),reminders=recordsFor('reminders',vehicleId);
 const urgent=[],warning=[],linkedMaintenanceIds=new Set(maintenance.map(item=>item.id).filter(Boolean));
 const addUnique=(collection,message)=>{if(message&&!collection.includes(message))collection.push(message)};
 maintenance.forEach(item=>{
   const schedule=mileageScheduleMeta(item),status=String(schedule?.status||item.status||'').toLowerCase();
   let overdueMiles=schedule?.remaining<0?Math.abs(schedule.remaining):0;
   if(!overdueMiles&&Number(item.progress||0)>Number(item.max||0))overdueMiles=Number(item.progress||0)-Number(item.max||0);
   if(status.includes('overdue')){
     const message=`${item.name||'Maintenance'} overdue${overdueMiles?` by ${number(overdueMiles)} mi`:''}`;
     addUnique(overdueMiles>=500?urgent:warning,message);
   }else if(schedule&&schedule.percent<=MAINTENANCE_WARNING_PERCENT){
     addUnique(warning,`${item.name||'Maintenance'} has ${number(Math.max(0,schedule.remaining))} mi remaining`);
   }else if(status.includes('soon'))addUnique(warning,`${item.name||'Maintenance'} due soon`);
 });
 reminders.forEach(item=>{
   if(item.maintenanceId&&linkedMaintenanceIds.has(item.maintenanceId))return;
   const mileageSchedule=mileageScheduleMeta(item);
   if(mileageSchedule){
     if(mileageSchedule.status==='Overdue')addUnique(warning,`${item.name||'Reminder'} overdue`);
     else if(mileageSchedule.percent<=MAINTENANCE_WARNING_PERCENT)addUnique(warning,`${item.name||'Reminder'} has ${number(Math.max(0,mileageSchedule.remaining))} mi remaining`);
     return
   }
   const dateSchedule=dateReminderScheduleMeta(item),status=String(dateSchedule?.status||item.status||'').toLowerCase();
   if(status==='overdue'){
     const days=Math.abs(dateSchedule?.remainingDays??Math.ceil((parseLocalDate(item.due)?.getTime()-Date.now())/86400000));
     const message=`${item.name||'Reminder'} overdue${Number.isFinite(days)?` by ${days} day${days===1?'':'s'}`:''}`;
     addUnique(days>=30?urgent:warning,message);
   }else if(status==='due')addUnique(warning,`${item.name||'Reminder'} due in ${Math.max(0,dateSchedule?.remainingDays||0)} day${dateSchedule?.remainingDays===1?'':'s'}`);
 });
 const overdueCount=maintenance.filter(x=>String(effectiveMaintenanceStatus(x)).toLowerCase().includes('overdue')).length+reminders.filter(x=>dateReminderScheduleMeta(x)?.status==='Overdue'||String(effectiveReminderStatus(x)).toLowerCase().includes('overdue')).length;
 if(overdueCount>=2&&!urgent.length)addUnique(urgent,`${overdueCount} overdue items need attention`);
 if(urgent.length)return{label:'Urgent',level:'urgent',reason:urgent[0],details:[...urgent,...warning]};
 if(warning.length)return{label:'Warning',level:'warning',reason:warning[0],details:warning};
 return{label:'Good',level:'good',reason:'No overdue or low-life maintenance items',details:[]};
}

function dashboardReminderMeta(reminder){
  const mileage=mileageScheduleMeta(reminder),date=dateReminderScheduleMeta(reminder),status=mileage?.status||date?.status||effectiveReminderStatus(reminder)||'Upcoming';
  const rank=({Overdue:0,Due:1,'Due Soon':1,Upcoming:2,Active:3,Completed:4})[status]??3;
  const due=mileage?Number(mileage.dueMileage||Number.MAX_SAFE_INTEGER):(parseLocalDate(reminder?.due)?.getTime()||Number.MAX_SAFE_INTEGER);
  return{status,rank,due}
}
function compareDashboardReminders(a,b){const left=dashboardReminderMeta(a),right=dashboardReminderMeta(b);return left.rank-right.rank||left.due-right.due||String(a?.name||'').localeCompare(String(b?.name||''))}
function dashboard(){
 const t=expenseTotals();
 const maintenance=activeMaintenance(),expenses=activeExpenses(),documents=activeDocuments(),allReminders=activeReminders();
 const powertrain=String(activeVehicle().powertrain||'Gasoline / Internal Combustion'),isElectric=/Electric \(EV\)/i.test(powertrain);
 const oil=maintenance.find(x=>x.templateKey==='oil-filter'||/oil(?:\s*&\s*filter)?\s+change/i.test(String(x.name||'')));
 const evHealth=maintenance.find(x=>/battery health|charging connector|cabin air filter/i.test(String(x.name)))||maintenance[0];
 const primaryService=isElectric?evHealth:oil;
 const tire=maintenance.find(x=>x.templateKey==='tire-rotation'||/\btire\s+rotation\b/i.test(String(x.name||'')));
 const registration=allReminders.find(x=>String(x.name||'').toLowerCase().includes('registration')&&String(x.status||'').toLowerCase()!=='completed')||allReminders.find(x=>String(x.name||'').toLowerCase().includes('registration'))||null;
 const primaryMeta=primaryService?maintenanceProgressMeta(primaryService):null,tireMeta=tire?maintenanceProgressMeta(tire):null,registrationMeta=registration?dateReminderScheduleMeta(registration):null;
 const primaryStatus=primaryService?effectiveMaintenanceStatus(primaryService):'Not configured',tireStatus=tire?effectiveMaintenanceStatus(tire):'Not configured',registrationStatus=registration?(registrationMeta?.status||effectiveReminderStatus(registration)):'Not configured';
 const primaryGauge=remainingLifeGauge(primaryMeta?.percent,primaryStatus),tireGauge=remainingLifeGauge(tireMeta?.percent,tireStatus),registrationGauge=remainingLifeGauge(registrationMeta?.percent,registrationStatus);
  const serviceHistory=expenses.filter(x=>['Maintenance','Repair','Parts'].includes(x.category)).slice(0,5);
  const docs=[...documents].sort((a,b)=>(parseDocumentDate(b.addedAt||b.date)?.getTime()||0)-(parseDocumentDate(a.addedAt||a.date)?.getTime()||0)).slice(0,8);
  const reminders=[...allReminders].sort(compareDashboardReminders).slice(0,8);
 const health=vehicleHealthStatus();
 const overviewNow=new Date();
 const dashboardExpenseCategoryOrder=['Maintenance','Repair','Fuel','Parts','Insurance','Registration','Other'];
 const dashboardExpenseCategoryColors={Maintenance:'#2563eb',Repair:'#f97316',Fuel:'#16a34a',Parts:'#7c3aed',Insurance:'#db2777',Registration:'#f59e0b',Other:'#94a3b8'};
 const dashboardExpenseCategory=value=>{const category=String(value||'Other');return dashboardExpenseCategoryOrder.includes(category)?category:'Other'};
 const dashboardExpensePeriod=resolveExpenseDateRange(dashboardExpenseRange,dashboardExpenseCustomRange,expenses,overviewNow);
 dashboardExpenseRange=dashboardExpensePeriod.period;
 const expenseMonths=buildExpenseMonthBuckets(expenses,dashboardExpensePeriod,dashboardExpenseCategoryOrder,dashboardExpenseCategory);
 const dashboardPeriodExpenses=expensesWithinRange(expenses,dashboardExpensePeriod);
 const expenseCategoryTotals=Object.fromEntries(dashboardExpenseCategoryOrder.map(category=>[category,0]));
 expenseMonths.forEach(month=>dashboardExpenseCategoryOrder.forEach(category=>expenseCategoryTotals[category]+=Number(month.values[category]||0)));
 const expenseLegendEntries=dashboardExpenseCategoryOrder.map(category=>({category,value:expenseCategoryTotals[category],color:dashboardExpenseCategoryColors[category]})).filter(entry=>entry.value>0);
 const expenseRangeTotal=expenseLegendEntries.reduce((total,entry)=>total+entry.value,0);
 const expenseAxisMax=Math.max(100,Math.ceil(Math.max(1,...expenseMonths.map(x=>x.total))/100)*100);
 const expenseTicks=[expenseAxisMax,expenseAxisMax*.75,expenseAxisMax*.5,expenseAxisMax*.25,0];
 const expenseChart={width:700,height:250,left:66,right:688,top:12,bottom:207};
 expenseChart.plotHeight=expenseChart.bottom-expenseChart.top;
 expenseChart.plotWidth=expenseChart.right-expenseChart.left;
 expenseChart.barStep=expenseChart.plotWidth/Math.max(1,expenseMonths.length);
 expenseChart.barWidth=Math.min(42,Math.max(8,expenseChart.barStep*.58));
 const expenseY=value=>expenseChart.bottom-(Number(value||0)/expenseAxisMax)*expenseChart.plotHeight;
 const expenseSpansYears=dashboardExpensePeriod.start.getFullYear()!==dashboardExpensePeriod.end.getFullYear();
 const expenseRangeOptions=expensePeriodOptions(expenses,{includeRolling:true,includeCustom:true});
 const fullFuelPoints=fuelEconomyPoints();
 const fuelSeries=filterFuelEconomyPoints(fullFuelPoints,dashboardFuelRange,dashboardFuelCustom.months);
 const enteredAverage=Number(state.metrics?.averageMpg||0);
 const calculatedAverage=fullFuelPoints.length?fullFuelPoints.reduce((sum,point)=>sum+point.value,0)/fullFuelPoints.length:0;
 const provisionalAverage=fullFuelPoints.some(point=>point.provisional);
 const mpgBase=calculatedAverage||enteredAverage||0;
 const fuelRangeOptions=[['this-year','This Year'],['6-months','6 Months'],['3-months','3 Months'],['last-year','Last Year'],['custom',dashboardFuelCustom.label]];
 const fuelAxis=fuelAxisModel(fuelSeries),mpgChartMax=fuelAxis.max,mpgChartMin=fuelAxis.min;
 const fuelChart={width:660,height:220,left:54,right:642,top:14,bottom:176};
 fuelChart.plotHeight=fuelChart.bottom-fuelChart.top;
 const mpgPointY=value=>fuelChart.bottom-((value-mpgChartMin)/(mpgChartMax-mpgChartMin))*fuelChart.plotHeight;
 const fuelStep=fuelSeries.length>1?(fuelChart.right-fuelChart.left)/(fuelSeries.length-1):0;
 const fuelPointX=index=>fuelSeries.length===1?(fuelChart.left+fuelChart.right)/2:fuelChart.left+index*fuelStep;
 const mpgPoints=fuelSeries.map((point,index)=>`${fuelPointX(index)},${mpgPointY(point.value)}`).join(' ');
 const fuelTicks=fuelAxis.ticks;
 const maintenanceItems=maintenance.slice(0,4);
 return `
 <section class="vehicle-context-banner card">
   <div class="vehicle-context-image"><img src="${vehicleImageUrl()}" alt="${esc(vehicleFullName())}" onerror="this.onerror=null;this.src='${vehicleDefaultImageUrl()}'"></div>
   <div class="vehicle-context-body">
     <div class="vehicle-context-heading"><div><div class="eyebrow">ACTIVE VEHICLE</div><h1>${esc(vehicleFullName())}</h1></div><span class="health-pill health-${health.level}" title="${esc(health.reason)}">${health.label}</span></div>
     <div class="vehicle-context-specs">
       <div><span>Mileage</span><strong>${number(state.mileage)} mi</strong></div>
       <div><span>VIN</span><strong>${esc(state.vehicle.vin||'Not entered')}</strong></div>
       <div><span>Engine</span><strong>${esc(state.vehicle.engine||'Not entered')}</strong></div>
       <div><span>Drivetrain</span><strong>${esc(state.vehicle.drivetrain||'Not entered')}</strong></div>
       <div><span>Color</span><strong>${esc(state.vehicle.color||'Not entered')}</strong></div>
     </div>
   </div>
   <div class="vehicle-context-actions"><button class="secondary" onclick="goPage('Garage')">View Vehicle Details ${svg('external')}</button></div>
 </section>
 ${otherVehicleDataNotice()}

 <section class="status-tile-grid" aria-label="Vehicle status overview">
   <article class="card status-tile ${isElectric?'status-ev':'status-oil'}">
     <div class="status-tile-top"><span class="status-tile-icon">${svg(isElectric?'battery':'oil')}</span><span class="status-tile-label">${isElectric?'EV System Health':'Next Oil Change'}</span></div>
     <strong class="${primaryStatus==='Overdue'?'status-bad':String(primaryStatus).toLowerCase().includes('soon')?'status-warn':''}">${primaryService?esc(primaryStatus):'Not configured'}</strong>
     <p>${primaryService?esc(primaryMeta?.label||primaryService.due||'Schedule active'):esc(isElectric?'Add an EV maintenance template':'No oil-change schedule is active')}</p>
     ${primaryService?`<div class="status-progress remaining-life ${primaryGauge.tone}" role="meter" aria-label="${isElectric?'Maintenance':'Oil-change'} service life remaining" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(primaryGauge.percent)}" title="${Math.round(primaryGauge.percent)}% of the service interval remaining"><span style="width:${primaryGauge.width}%"></span></div>`:`<button class="tile-link" onclick="openReminderWizardForTemplate('${isElectric?'Charging Connector Inspection':'Oil & Filter Change'}')">Set up ${isElectric?'maintenance':'oil changes'}</button>`}
   </article>
   <article class="card status-tile status-tires">
     <div class="status-tile-top"><span class="status-tile-icon">${svg('tire')}</span><span class="status-tile-label">Tire Rotation</span></div>
     <strong class="${tireStatus==='Overdue'?'status-bad':String(tireStatus).toLowerCase().includes('soon')?'status-warn':''}">${tire?esc(tireStatus):'Not configured'}</strong>
     <p>${tire?esc(tireMeta?.label||tire.due||'Schedule active'):'No tire-rotation schedule is active'}</p>
     ${tire?`<div class="status-progress remaining-life ${tireGauge.tone}" role="meter" aria-label="Tire-rotation service life remaining" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(tireGauge.percent)}" title="${Math.round(tireGauge.percent)}% of the tire-rotation interval remaining"><span style="width:${tireGauge.width}%"></span></div>`:`<button class="tile-link" onclick="openReminderWizardForTemplate('Tire Rotation')">Set up tire rotation</button>`}
   </article>
   <article class="card status-tile status-registration">
     <div class="status-tile-top"><span class="status-tile-icon">${svg('calendar')}</span><span class="status-tile-label">Registration Renewal</span></div>
     <strong class="${registrationStatus==='Overdue'?'status-bad':registrationStatus==='Due'?'status-warn':''}">${registration?esc(registration.due):'Not configured'}</strong>
     <p>${registration?esc(registrationStatus):'No registration-renewal reminder is active'}</p>
     ${registration?`<div class="status-progress remaining-life ${registrationGauge.tone}" role="meter" aria-label="Registration-renewal interval remaining" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(registrationGauge.percent)}" title="${esc(registrationMeta?.label||registrationStatus)} · ${Math.round(registrationGauge.percent)}% remaining"><span style="width:${registrationGauge.width}%"></span></div>`:`<button class="tile-link" onclick="openReminderWizardForTemplate('Registration Renewal')">Set up registration renewal</button>`}
   </article>
   <article class="card status-tile status-cost">
     <div class="status-tile-top"><span class="status-tile-icon">${svg('dollar')}</span><span class="status-tile-label">Total Yearly Cost</span></div>
     <strong>${money(t.yearly)}</strong>
     <p>Year to date from ${yearExpenses().length} recorded expenses</p>
     <button class="tile-link" onclick="goPage('Reports')">View report</button>
   </article>
 </section>

 <section class="dashboard-tile-row dashboard-primary-row">
   <article class="card command-tile upcoming-tile">
     <div class="section-title"><h2>Upcoming Maintenance</h2><button class="link-button" onclick="goPage('Maintenance')">View all</button></div>
     <div class="command-list">${maintenanceItems.length?maintenanceItems.map(m=>`<button onclick="goPage('Maintenance')"><span class="round-icon ${maintenanceTone(m.name)}">${svg(maintenanceIcon(m.name))}</span><span><strong>${esc(m.name)}</strong><small>${esc(m.status==='Overdue'?'Due now':m.due)}</small></span><em>${esc(m.interval)}</em></button>`).join(''):'<div class="tile-empty">No maintenance items have been added.</div>'}</div>
   </article>
   <article class="card command-tile service-history-tile">
     <div class="section-title"><h2>Service History</h2><button class="link-button" onclick="goPage('Expenses')">View all</button></div>
      <div class="compact-table"><div class="compact-table-head"><span>Date</span><span>Service</span><span>Shop</span><span>Cost</span></div>${serviceHistory.length?serviceHistory.map(x=>`<div class="compact-table-row"><span title="${esc(x.date)}">${esc(shortDate(x.date))}</span><span>${esc(expenseServiceLabel(x))}</span><span>${esc(x.vendor||'—')}</span><strong>${money(x.amount)}</strong></div>`).join(''):'<div class="tile-empty">Service expenses will appear here.</div>'}</div>
   </article>
   <article class="card command-tile expenses-tile expenses-overview-reference">
     <div class="section-title"><h2>Expenses Overview</h2><label class="select-shell"><select id="dashboardExpensePeriod" class="dashboard-range-select" onchange="setDashboardExpenseRange(this.value)">${expenseRangeOptions.map(([value,label])=>`<option value="${value}" ${dashboardExpenseRange===value?'selected':''}>${esc(label)}</option>`).join('')}</select></label></div>
     <div class="expense-chart-period-label dashboard-expense-period-label">${esc(dashboardExpensePeriod.label)} · ${dashboardPeriodExpenses.length} transaction${dashboardPeriodExpenses.length===1?'':'s'}</div>
     <div class="expense-overview-reference-layout">
       <div class="expense-overview-summary"><span>Total</span><strong>${money(expenseRangeTotal)}</strong><div class="expense-overview-legend vertical">${expenseLegendEntries.length?expenseLegendEntries.map(entry=>`<span title="${esc(entry.category)}: ${money(entry.value)}"><i style="background:${entry.color}"></i><b>${esc(entry.category)}</b><em>${money(entry.value)}</em></span>`).join(''):'<p class="muted expense-overview-empty">No expenses in this range.</p>'}</div></div>
       <div class="expense-overview-chart-wrap"><svg class="expense-svg-chart" viewBox="0 0 ${expenseChart.width} ${expenseChart.height}" role="img" aria-label="Monthly expenses shown as stacked bars by expense category">${expenseTicks.map(value=>{const y=expenseY(value);return `<g class="expense-grid-row"><line x1="${expenseChart.left}" y1="${y}" x2="${expenseChart.right}" y2="${y}"/><text x="${expenseChart.left-10}" y="${y+4}" text-anchor="end">${value?money(value).replace('.00',''):'$0'}</text></g>`}).join('')}<line class="expense-axis-baseline" x1="${expenseChart.left}" y1="${expenseChart.bottom}" x2="${expenseChart.right}" y2="${expenseChart.bottom}"/>${expenseMonths.map((x,index)=>{const center=expenseChart.left+expenseChart.barStep*(index+.5);const xPos=center-expenseChart.barWidth/2;let cursor=expenseChart.bottom;const segments=[];dashboardExpenseCategoryOrder.forEach(category=>{const amount=Number(x.values[category]||0);if(amount<=0)return;const height=amount/expenseAxisMax*expenseChart.plotHeight;cursor-=height;segments.push(`<rect class="expense-svg-segment" x="${xPos}" y="${cursor}" width="${expenseChart.barWidth}" height="${height}" fill="${dashboardExpenseCategoryColors[category]}"><title>${esc(category)}: ${money(amount)}</title></rect>`)});return `<g><title>${esc(x.label)} ${x.year}: ${money(x.total)}</title>${segments.join('')}<text class="expense-month-label" x="${center}" y="${expenseChart.bottom+23}" text-anchor="middle">${esc(x.label)}${expenseSpansYears?` '${String(x.year).slice(-2)}`:''}</text></g>`}).join('')}</svg></div>
     </div>
     <div class="card-footer-link"><button class="link-button" onclick="goPage('Reports')">View Full Report</button></div>
   </article>
 </section>

 <section class="dashboard-tile-row dashboard-secondary-row">
   <article class="card command-tile fuel-tile fuel-reference-tile">
     <div class="section-title"><h2>Fuel Economy</h2><label class="select-shell"><select class="dashboard-range-select" onchange="setDashboardFuelRange(this.value)">${fuelRangeOptions.map(([value,label])=>`<option value="${value}" ${dashboardFuelRange===value?'selected':''}>${esc(label)}</option>`).join('')}</select></label></div>
     <div class="fuel-command-kpis reference"><div><span>Average MPG</span><strong>${mpgBase?mpgBase.toFixed(1):'—'}</strong><small>${calculatedAverage?(provisionalAverage?'Includes a provisional odometer-baseline point':'Calculated from full-tank fuel entries'):enteredAverage?'Stored vehicle average':'No MPG data yet'}</small></div><div><span>Cost per Mile</span><strong>${optionalMoney(t.costPerMile)}</strong><small>${t.trackedMiles?`${number(t.trackedMiles)} tracked miles`:'Add another odometer reading'}</small></div></div>
     <div class="fuel-chart-section"><div class="mini-chart-label">MPG Trend</div>${fuelSeries.length?`<div class="fuel-line reference"><svg viewBox="0 0 ${fuelChart.width} ${fuelChart.height}" role="img" aria-label="Fuel economy trend">${fuelTicks.map(value=>{const y=mpgPointY(value);return `<g class="fuel-grid-row"><line x1="${fuelChart.left}" y1="${y}" x2="${fuelChart.right}" y2="${y}"/><text x="${fuelChart.left-9}" y="${y+4}" text-anchor="end">${Number.isInteger(value)?value:value.toFixed(1)}</text></g>`}).join('')}${fuelSeries.length>1?`<polyline class="fuel-trend-line" points="${mpgPoints}"/>`:''}${fuelSeries.map((point,index)=>`<circle class="fuel-trend-dot" cx="${fuelPointX(index)}" cy="${mpgPointY(point.value)}" r="4.2"><title>${esc(point.label)}: ${point.value.toFixed(1)} MPG${point.provisional?' · provisional odometer baseline':''}</title></circle>`).join('')}${fuelSeries.map((point,index)=>{if(fuelSeries.length>7&&index!==0&&index!==fuelSeries.length-1&&index%2!==0)return'';return `<text class="fuel-x-label" x="${fuelPointX(index)}" y="${fuelChart.bottom+24}" text-anchor="${index===0&&fuelSeries.length>1?'start':index===fuelSeries.length-1&&fuelSeries.length>1?'end':'middle'}">${esc(point.label)}</text>`}).join('')}</svg></div>`:`<div class="fuel-chart-empty"><strong>No calculable MPG points in this range</strong><p>A full-tank fuel entry needs gallons and an odometer. The first entry can use a prior odometer reading as a provisional baseline; later full-tank entries create the accurate tank-to-tank trend.</p><button type="button" class="link-button" onclick="openFuelExpense()">Add fuel entry</button></div>`}</div>
     <div class="card-footer-link"><button class="link-button" onclick="goPage('Reports')">View Fuel Log</button></div>
   </article>
   <article class="card command-tile documents-tile">
     <div class="section-title"><h2>Documents</h2><button class="link-button" onclick="openModal('document')">Upload</button></div>
     <div class="document-quick-list">${docs.length?docs.map(d=>{const i=state.documents.indexOf(d);return `<button onclick="${d.storedName?`openDocument(${i})`:`goPage('Documents')`}">${fileTypeIcon(d,true)}<span><strong>${esc(d.name)}</strong><small>${esc(d.category)} · ${esc(d.date)}</small></span><em>${esc(d.size)}</em></button>`}).join(''):'<div class="tile-empty">Upload insurance, registration, receipts, and manuals.</div>'}</div>
   </article>
   <article class="card command-tile reminders-tile">
     <div class="section-title"><h2>Quick Reminders</h2><button class="link-button" onclick="openReminderWizard()">Add reminder</button></div>
      <div class="reminder-quick-list">${reminders.length?reminders.map(r=>{const meta=dashboardReminderMeta(r);return `<button onclick="goPage('Reminders')"><span class="round-icon ${maintenanceTone(r.name)}">${svg(maintenanceIcon(r.name))}</span><span><strong>${esc(r.name)}</strong><small>${esc(r.due)}</small></span><em class="${meta.status==='Overdue'?'status-bad':String(meta.status).toLowerCase().includes('soon')||meta.status==='Due'?'status-warn':'status-good'}">${esc(meta.status)}</em></button>`}).join(''):'<div class="tile-empty">No reminders have been added.</div>'}</div>
   </article>
 </section>`;
}

function garage(){
 const vehicleTypes=['All Vehicles','Cars','Trucks','Motorcycles','Trailers'];
 const filtered=state.vehicles.filter(v=>currentGarageFilter==='All Vehicles'||`${v.type}s`===currentGarageFilter||v.type===currentGarageFilter.replace(/s$/,''));
 const vehicles=[...filtered].sort((a,b)=>{if(currentGarageSort==='Vehicle Name')return vehicleFullName(a).localeCompare(vehicleFullName(b));if(currentGarageSort==='Mileage')return Number(b.mileage||0)-Number(a.mileage||0);const aNext=nextMaintenanceForVehicle(a.id),bNext=nextMaintenanceForVehicle(b.id);if(!aNext&&!bNext)return vehicleFullName(a).localeCompare(vehicleFullName(b));if(!aNext)return 1;if(!bNext)return-1;return compareMaintenancePriority(aNext,bNext)||vehicleFullName(a).localeCompare(vehicleFullName(b))});
 const activeVehicles=activeFleetVehicles(),archivedVehicles=state.vehicles.filter(isVehicleArchived);
 const allCounts=activeVehicles.reduce((acc,v)=>{const c=maintenanceCounts(v.id);acc.due+=c.overdue+c.due;return acc},{due:0});
 const totalYearly=activeVehicles.reduce((sum,v)=>sum+expenseTotals(v.id).yearly,0);
 const mpgValues=activeVehicles.map(v=>Number(v.metrics?.averageMpg||0)).filter(Boolean);
 const avgMpg=mpgValues.length?mpgValues.reduce((a,b)=>a+b,0)/mpgValues.length:0;
 const counts={AllVehicles:state.vehicles.length,Cars:state.vehicles.filter(v=>v.type==='Car').length,Trucks:state.vehicles.filter(v=>v.type==='Truck').length,Motorcycles:state.vehicles.filter(v=>v.type==='Motorcycle').length,Trailers:state.vehicles.filter(v=>v.type==='Trailer').length};
 const pageActions=`<div class="page-actions garage-page-actions"><button class="secondary compact-action" onclick="goPage('Documents')">${svg('upload')} Import Records</button>${primary('Add Vehicle',"openModal('vehicle-add')",'plus')}</div>`;
 return pageHead('My Garage','Manage vehicles, mileage, and service status.',pageActions)+`
 <div class="garage-summary-strip">
   ${summaryCard('Total Vehicles',String(state.vehicles.length),`${activeVehicles.length} active · ${archivedVehicles.length} archived`,'car','blue')}
   ${summaryCard('Due Soon',String(allCounts.due),allCounts.due?'Service needs attention':'No service due','calendar','orange')}
   ${summaryCard('Total Yearly Cost',money(totalYearly),'Across all vehicles','dollar','purple')}
   ${summaryCard('Average MPG',avgMpg?avgMpg.toFixed(1):'—','Across all vehicles','gauge','green')}
 </div>
 <div class="garage-control-row">
   <div class="garage-filter-tabs" aria-label="Vehicle type filters">${vehicleTypes.map(label=>`<button class="${currentGarageFilter===label?'active':''}" onclick="setGarageFilter('${label}')">${label} <span>${counts[label.replace(/ /g,'')]||0}</span></button>`).join('')}</div>
   <label class="garage-sort">Sort by <select aria-label="Sort vehicles" onchange="setGarageSort(this.value)"><option ${currentGarageSort==='Service Due'?'selected':''}>Service Due</option><option ${currentGarageSort==='Vehicle Name'?'selected':''}>Vehicle Name</option><option ${currentGarageSort==='Mileage'?'selected':''}>Mileage</option></select></label>
 </div>
 <section class="garage-workspace">
   <div class="garage-vehicle-grid">${vehicles.length?vehicles.map(vehicle=>garageVehicleCard(vehicle)).join(''):'<div class="card garage-empty"><h2>No vehicles in this category</h2><p>Add a vehicle or select a different vehicle type.</p></div>'}</div>
   <aside class="garage-side-column">
     <section class="card garage-tools-card">
       <h2>Garage Tools</h2>
       <button onclick="openModal('vehicle-add')"><span class="tool-icon blue">${svg('plus')}</span><span><strong>Add Vehicle</strong><small>Add another car, truck, motorcycle, or trailer</small></span><b>›</b></button>
       <button onclick="openModal('mileage')"><span class="tool-icon purple">${svg('gauge')}</span><span><strong>Update Mileage</strong><small>Add an odometer reading for the active vehicle</small></span><b>›</b></button>
       <button onclick="openModal('document')"><span class="tool-icon green">${svg('file-plus')}</span><span><strong>Upload Receipt</strong><small>Store receipts and invoices</small></span><b>›</b></button>
       <button onclick="openGarageExport()"><span class="tool-icon orange">${svg('download')}</span><span><strong>Export Records</strong><small>Choose record types and export format</small></span><b>›</b></button>
       <button onclick="printServiceHistory()"><span class="tool-icon blue">${svg('printer')}</span><span><strong>Service History</strong><small>Open a printer-friendly service report</small></span><b>›</b></button>
     </section>
     <section class="card garage-tip-card"><span class="tool-icon blue">${svg('bell')}</span><div><strong>Tip</strong><p>Keep mileage and service records current for accurate maintenance reminders and cost insights.</p></div></section>
   </aside>
 </section>`;
}
function garageVehicleCard(vehicle){
 const vehicleIndex=state.vehicles.indexOf(vehicle),expenses=recordsFor('expenses',vehicle.id),totals=expenseTotals(vehicle.id);
 const next=nextMaintenanceForVehicle(vehicle.id),nextPriority=next?maintenancePriorityMeta(next):null,nextProgress=nextPriority?.progress;
 const lastService=expenses.filter(x=>['Maintenance','Repair','Parts'].includes(x.category))[0];
 const nextStatus=nextPriority?.status||next?.status,nextGauge=next?maintenanceGaugeMeta(next,nextProgress,nextStatus):{percent:0,tone:'gauge-neutral',width:0};
 const pct=nextGauge.percent,nextTone=nextGauge.tone==='gauge-danger'?'bad':nextGauge.tone==='gauge-warning'?'warn':'';
 const active=vehicle.id===state.activeVehicleId,archived=isVehicleArchived(vehicle),health=archived?{label:vehicle.lifecycleStatus,level:'archived',reason:`Vehicle marked ${String(vehicle.lifecycleStatus).toLowerCase()}`} : vehicleHealthStatus(vehicle.id);
 return `<article class="card garage-vehicle-card ${active?'active-vehicle-card':''} ${archived?'archived-vehicle-card':''}">
   <div class="garage-card-main">
     <div class="garage-card-image-wrap" tabindex="0">
       <img src="${vehicleImageUrl(vehicle)}" alt="${esc(vehicleFullName(vehicle))}" onerror="this.onerror=null;this.src='${vehicleDefaultImageUrl(vehicle)}'">
       <div class="garage-image-overlay">
         <label class="garage-image-action change-image">${svg('upload')}<span>${vehicle.imageStoredName?'Change':'Upload'} Image</span><input type="file" accept="image/png,image/jpeg,image/webp" onchange="uploadVehicleImage(this,'${vehicle.id}')"></label>
         ${vehicle.imageStoredName?`<button class="garage-image-action remove-image" onclick="event.stopPropagation();removeVehicleImage('${vehicle.id}')">${svg('trash')}<span>Remove</span></button>`:''}
       </div>
     </div>
     <div class="garage-card-details">
       <div class="garage-card-heading"><div><h2>${esc(vehicleFullName(vehicle))}</h2><span class="vehicle-use-tag">${esc(vehicle.type||'Vehicle')}</span></div><span class="badge health-${health.level}" title="${esc(health.reason)}">${active&&!archived?'Active · ':''}${health.label}</span></div>
       <div class="garage-card-specs"><div><span>Mileage</span><strong>${number(vehicle.mileage)} mi</strong></div><div><span>Powertrain</span><strong>${esc(vehicle.powertrain||'Gasoline / Internal Combustion')}</strong></div><div><span>VIN</span><strong>${esc(vehicle.vin||'Not entered')}</strong></div><div><span>Color</span><strong>${esc(vehicle.color||'Not entered')}</strong></div><div><span>Acquired</span><strong>${vehicle.acquiredDate?new Date(`${vehicle.acquiredDate}T12:00:00`).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'Not entered'}</strong></div>${normalizedVehicleType(vehicle)==='Trailer'?'':`<div><span>Mileage at Acquisition</span><strong>${vehicle.acquiredMileage===null||vehicle.acquiredMileage===undefined||vehicle.acquiredMileage===''?'Not entered':`${number(vehicle.acquiredMileage)} mi`}</strong></div>`}</div>
     </div>
   </div>
   <div class="garage-service-strip ${nextTone}">
     <span class="round-icon ${maintenanceTone(next?.name||'service')}">${svg(maintenanceIcon(next?.name||'service'))}</span>
     <div><strong>${next?`Next: ${esc(next.name)}`:'No maintenance scheduled'}</strong><small>${next?esc(nextStatus==='Overdue'?'Due now':nextProgress?.label||next.due||'No due date'):'Add a maintenance record to begin tracking'}</small></div>
     <div class="garage-service-progress"><div class="status-progress remaining-life maintenance-life-progress ${nextGauge.tone}" role="meter" aria-label="${next?esc(next.name):'Maintenance'} service life remaining" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}" title="${Math.round(pct)}% of the service interval remaining"><span style="width:${nextGauge.width}%"></span></div><small>${next?esc(nextProgress?.detail||next.due||''):''}</small></div>
   </div>
   <div class="garage-card-metrics">
     <div>${svg('calendar')}<span>Last Service<strong>${lastService?shortDate(lastService.date):'Not recorded'}</strong></span></div>
     <div>${svg('fuel')}<span>MPG (avg)<strong>${Number(vehicle.metrics?.averageMpg||0)?Number(vehicle.metrics.averageMpg).toFixed(1):'—'}</strong></span></div>
     <div>${svg('dollar')}<span>Yearly Cost<strong>${money(totals.yearly)}</strong></span></div>
   </div>
   <div class="garage-card-actions">
     ${archived?`<button class="secondary" disabled>${esc(vehicle.lifecycleStatus)}</button>`:`<button class="secondary" onclick="${active?`openVehicleDashboard('${vehicle.id}')`:`makeVehicleActive('${vehicle.id}')`}">${active?'View Dashboard':'Make Active'}</button>`}
     <button class="secondary" onclick="addVehicleRecord('${vehicle.id}')" ${archived?'disabled':''}>Add Record</button>
     <button class="mini-btn" title="Edit vehicle" onclick="openModal('vehicle',${vehicleIndex})">${svg('edit')}</button>
   </div>
 </article>`;
}
const STANDARD_MAINTENANCE_TERMS=['oil','tire','air filter','cabin filter','transmission','brake','coolant','antifreeze','spark','belt','differential','battery','wiper'];
function isCustomMaintenance(item){const name=String(item?.name||'').toLowerCase();return !STANDARD_MAINTENANCE_TERMS.some(term=>name.includes(term))}
function maintenanceTone(name){return taskVisual(name).tone}
function maintenanceDescription(name){
 const n=String(name||'').toLowerCase();
 if(n.includes('oil'))return'Engine oil and filter';
 if(n.includes('tire'))return'Rotate all four tires';
 if(n.includes('engine air'))return'Replace engine intake filter';
 if(n.includes('cabin'))return'Replace cabin air filter';
 if(n.includes('transmission'))return'Fluid and filter service';
 if(n.includes('brake'))return'Inspect or replace brake fluid';
 if(n.includes('coolant')||n.includes('antifreeze'))return'Drain, inspect, and refill';
 if(n.includes('spark'))return'Inspect or replace spark plugs';
 if(n.includes('belt'))return'Inspect drive belt condition';
 if(n.includes('differential'))return'Front and rear fluid service';
 if(n.includes('battery'))return'Test battery and charging system';
 if(n.includes('wiper'))return'Inspect or replace blades';
 return'Owner-defined maintenance item'
}
function maintenanceProgressMeta(item){
 const mileage=mileageScheduleMeta(item);
 if(mileage)return{percent:mileage.percent,label:mileage.label,detail:mileage.detail,checklist:false,mileage:true,status:mileage.status,beforeStart:mileage.beforeStart};
 const checklist=checklistItemsFromRecord(item);
 if(checklist.length){
   const completed=checklist.filter(entry=>entry.completed).length,total=checklist.length,remaining=total-completed;
   return{percent:Math.round(completed/total*100),label:completed===total?'Checklist complete':`${remaining} checklist item${remaining===1?'':'s'} remaining`,detail:`${completed} / ${total} checklist items`,checklist:true,completed,total,status:item?.status}
 }
 const progress=Number(item?.progress||0),max=Math.max(0,Number(item?.max||0));
 const interval=String(item?.interval||'').toLowerCase();
 if(!max)return{percent:0,label:'No interval configured',detail:'',status:item?.status};
 const percent=Math.min(100,Math.max(0,(max-progress)/max*100));
 const remaining=max-progress;
 const suffix=interval.includes('mi')?' mi':interval.includes('month')?' months':interval.includes('year')?' years':'';
 const label=remaining<0?`Overdue by ${number(Math.abs(remaining))}${suffix}`:`${number(Math.max(0,remaining))}${suffix} remaining`;
 return{percent,label,detail:`${number(progress)} / ${number(max)}${suffix}`,checklist:false,status:item?.status};
}
function maintenancePriorityMeta(item){
 const status=effectiveMaintenanceStatus(item),statusText=String(status||'').toLowerCase(),progress=maintenanceProgressMeta(item),mileage=mileageScheduleMeta(item);
 if(statusText==='completed')return{rank:5,percent:100,dueSort:Number.POSITIVE_INFINITY,status:'Completed',progress};
 let percent=Number(progress?.percent);
 if(!Number.isFinite(percent))percent=100;
 let rank=3;
 if(statusText.includes('overdue'))rank=0;
 else if(statusText==='due'||statusText.includes('soon')||percent<=MAINTENANCE_WARNING_PERCENT)rank=1;
 else if(percent<=40)rank=2;
 else if(!progress?.detail&&!item?.due&&!item?.interval)rank=4;
 let dueSort=Number.POSITIVE_INFINITY;
 if(mileage){
   dueSort=mileage.remaining;
 }else{
   const dueDate=parseScheduleDate(item?.due);
   if(dueDate)dueSort=Math.ceil((dueDate-new Date())/86400000);
   else if(Number.isFinite(percent))dueSort=percent;
 }
 return{rank,percent,dueSort,status,progress};
}
function compareMaintenancePriority(a,b){
 const pa=maintenancePriorityMeta(a),pb=maintenancePriorityMeta(b);
 return pa.rank-pb.rank||pa.percent-pb.percent||pa.dueSort-pb.dueSort||String(a?.name||'').localeCompare(String(b?.name||''));
}
function nextMaintenanceForVehicle(vehicleId){
 return recordsFor('maintenance',vehicleId).filter(item=>effectiveMaintenanceStatus(item)!=='Completed').sort(compareMaintenancePriority)[0]||null;
}
function maintenanceSeverity(item){return maintenancePriorityMeta(item).rank}
function completedServiceCount(){
 return activeMaintenance().filter(x=>x.status==='Completed').length+
   activeExpenses().filter(x=>['Maintenance','Repair','Parts'].includes(x.category)).length
}
function maintenanceRowActions(index){
 const item=state.maintenance[index],hasChecklist=Array.isArray(item?.checklist)&&item.checklist.length>0;
 return `<div class="maintenance-actions">
   <button class="maintenance-view" onclick="${hasChecklist?`openRecordChecklist('maintenance',${index})`:`editRecord('maintenance',${index})`}">${hasChecklist?'Checklist':'View'}</button>
   <details class="maintenance-more">
     <summary aria-label="More actions">${svg('chevronDown')}</summary>
     <div class="maintenance-more-menu">
       ${hasChecklist?`<button type="button" onclick="openRecordChecklist('maintenance',${index})">${svg('check')} View checklist</button>`:''}
       <button type="button" onclick="editRecord('maintenance',${index})">${svg('edit')} Edit item</button>
       <button type="button" class="delete" onclick="deleteRecord('maintenance',${index})">${svg('trash')} Delete item</button>
     </div>
   </details>
 </div>`
}
function maintenance(){
 const maintenance=activeMaintenance();
 const mc=maintenanceCounts();
 const completed=completedServiceCount();
 const onTrack=maintenance.filter(m=>{const status=effectiveMaintenanceStatus(m);return status!=='Overdue'&&status!=='Completed'&&!String(status).toLowerCase().includes('soon')}).length;
 const standardUpcoming=onTrack;
 const filterTabs=[
   {key:'All',label:'All Items',count:maintenance.length},
   {key:'Needs Attention',label:'Needs Attention',count:mc.overdue+mc.due},
   {key:'Upcoming',label:'Upcoming',count:standardUpcoming},
   {key:'Completed',label:'Completed',count:maintenance.filter(m=>effectiveMaintenanceStatus(m)==='Completed').length},
   {key:'Custom',label:'Custom',count:maintenance.filter(isCustomMaintenance).length}
 ];
 const maintenanceSearch=normalizedSearchQuery(current==='Maintenance'?topSearchQuery:'');
 const items=maintenance.filter(m=>(
   currentFilter==='All'||
   (currentFilter==='Needs Attention'&&(effectiveMaintenanceStatus(m)==='Overdue'||String(effectiveMaintenanceStatus(m)).toLowerCase().includes('soon')))||
   (currentFilter==='Upcoming'&&effectiveMaintenanceStatus(m)!=='Overdue'&&effectiveMaintenanceStatus(m)!=='Completed'&&!String(effectiveMaintenanceStatus(m)).toLowerCase().includes('soon'))||
   (currentFilter==='Completed'&&effectiveMaintenanceStatus(m)==='Completed')||
   (currentFilter==='Custom'&&isCustomMaintenance(m))
 )&&maintenanceMatchesTopSearch(m,maintenanceSearch));
 const maintenanceIntervalSortMeta=item=>{const text=String(item?.interval||item?.rule||'').toLowerCase(),value=parseMileageValue(text);if(/\bmi\b|mile/.test(text))return[0,value,String(item?.name||'')];const match=text.replaceAll(',','').match(/(-?\d+(?:\.\d+)?)\s*(days?|weeks?|months?|years?)/i);if(match){const amount=Number(match[1]),unit=match[2].toLowerCase(),days=unit.startsWith('year')?amount*365.25:unit.startsWith('month')?amount*30.4375:unit.startsWith('week')?amount*7:amount;return[1,days,String(item?.name||'')]}return[2,null,text,String(item?.name||'')]};
 const maintenanceDueSortMeta=item=>{const due=String(item?.due||''),mileage=/\bmi\b|mile/i.test(due)?parseMileageValue(due):null;if(mileage!==null)return[0,mileage,String(item?.name||'')];const date=parseScheduleDate(due);if(date)return[1,date.getTime(),String(item?.name||'')];return[2,null,String(item?.name||'')]};
 const maintenanceStatusSortMeta=item=>{const priority=maintenancePriorityMeta(item);return[priority.rank,priority.percent,priority.dueSort,String(item?.name||'')]};
 const maintenanceSort=listSortState.maintenance;
 const sortedItems=[...items].sort((a,b)=>{if(!maintenanceSort.key)return 0;const aMeta=maintenanceSort.key==='interval'?maintenanceIntervalSortMeta(a):maintenanceSort.key==='status'?maintenanceStatusSortMeta(a):maintenanceDueSortMeta(a),bMeta=maintenanceSort.key==='interval'?maintenanceIntervalSortMeta(b):maintenanceSort.key==='status'?maintenanceStatusSortMeta(b):maintenanceDueSortMeta(b);return compareListTuples(aMeta,bMeta,maintenanceSort.direction)});
 const recent=activeExpenses()
   .filter(x=>['Maintenance','Repair','Parts'].includes(x.category))
   .sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')))
   .slice(0,4);
 const calendar=[...maintenance]
   .filter(x=>effectiveMaintenanceStatus(x)!=='Completed')
   .sort((a,b)=>maintenanceSeverity(a)-maintenanceSeverity(b))
   .slice(0,4);
 const mileageHistory=[...(state.mileageHistory||[])].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
 const lastMileage=mileageHistory[0];
 const mileageUpdated=lastMileage?.date?new Date(lastMileage.date).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'Not recorded';
 return `<div class="maintenance-page"><div class="maintenance-workspace"><div class="maintenance-main-column">`+
 pageHead('Maintenance','Track, plan, and manage service intervals for the active vehicle.',primary('Add Maintenance',"openModal('service')"))+
 otherVehicleRecordNotice('maintenance','maintenance item')+
 `<div class="maintenance-tabs">${filterTabs.map(tab=>`<button class="${currentFilter===tab.key?'active':''}" onclick="setFilter('${tab.key}')"><span>${tab.label}</span><b>${tab.count}</b></button>`).join('')}</div>
   <section class="card maintenance-list-card">
     <div class="maintenance-list-head">
       <span>Maintenance Item</span><span>${listSortHeader('Interval','maintenance','interval')}</span><span>${listSortHeader('Status / Progress','maintenance','status')}</span><span>${listSortHeader('Next Due','maintenance','nextDue')}</span><span>Action</span>
     </div>
     <div class="maintenance-record-list">
       ${sortedItems.length?sortedItems.map(m=>{
         const i=state.maintenance.indexOf(m),meta=maintenanceProgressMeta(m),tone=maintenanceTone(m.name),effectiveStatus=effectiveMaintenanceStatus(m),gauge=maintenanceGaugeMeta(m,meta,effectiveStatus);
         const dueSub=effectiveStatus==='Completed'?'Service completed':meta.label;
         return `<article class="maintenance-record" data-search-key="maintenance:${i}">
           <div class="maintenance-item-cell">
             <span class="maintenance-type-icon ${tone}">${svg(maintenanceIcon(m.name))}</span>
             <span><strong>${esc(m.name)}</strong><small>${esc(maintenanceDescription(m.name))}</small></span>
           </div>
           <div class="maintenance-interval"><strong>${esc(m.interval)}</strong><small>${String(m.interval||'').toLowerCase().includes('mi')?'Mileage based':'Time based'}</small></div>
           <div class="maintenance-progress-cell">
             <div class="status-progress remaining-life maintenance-life-progress ${gauge.tone}" role="meter" aria-label="${esc(m.name)} ${meta.checklist?'checklist progress':'service life remaining'}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(gauge.percent)}" title="${meta.checklist?`${Math.round(gauge.percent)}% of checklist completed`:`${Math.round(gauge.percent)}% of the service interval remaining`}"><span style="width:${gauge.width}%"></span></div>
             <small class="${gauge.tone==='gauge-danger'?'status-bad':gauge.tone==='gauge-warning'?'status-warn':''}">${esc(meta.detail)}</small>
           </div>
           <div class="maintenance-due-cell">
             <strong class="${effectiveStatus==='Overdue'?'status-bad':''}">${esc(m.due||'Not scheduled')}</strong>
             <small class="${gauge.tone==='gauge-danger'?'status-bad':gauge.tone==='gauge-warning'?'status-warn':'status-good'}">${esc(dueSub)}</small>
           </div>
           ${maintenanceRowActions(i)}
         </article>`;
       }).join(''):`<div class="maintenance-empty"><h3>No maintenance items match this filter.</h3><p>Choose another tab or add a maintenance item.</p></div>`}
     </div>
     <div class="maintenance-list-footer">${maintenanceSearch?`Showing ${sortedItems.length} matching item${sortedItems.length===1?'':'s'} for “${esc(topSearchQuery.trim())}”`:`Showing ${sortedItems.length} of ${maintenance.length} items`}</div>
   </section>
   </div>
   <aside class="maintenance-side">
     <section class="card maintenance-summary-card">
       <div class="maintenance-card-heading"><h3>Maintenance Summary</h3><span title="Based on the active vehicle">${svg('info')}</span></div>
       <div class="maintenance-summary-grid">
         <div><strong class="status-bad">${mc.overdue}</strong><b>Overdue</b><small>Needs immediate attention</small></div>
         <div><strong class="status-warn">${mc.due}</strong><b>Due Soon</b><small>Approaching its interval</small></div>
         <div><strong class="summary-blue">${onTrack}</strong><b>On Track</b><small>Current schedule is healthy</small></div>
         <div><strong class="status-good">${completed}</strong><b>Completed</b><small>Recorded service history</small></div>
       </div>
     </section>
     <section class="card maintenance-mileage-card">
       <h3>Current Mileage</h3>
       <div class="maintenance-mileage-value"><span>${svg('gauge')}</span><strong>${number(state.mileage)} mi</strong></div>
       <p>Last updated ${esc(mileageUpdated)}</p>
       <button class="secondary" onclick="openModal('mileage')">${svg('edit')} Update Mileage</button>
     </section>
     <section class="card maintenance-recent-card">
       <div class="maintenance-card-heading"><h3>Recent Maintenance</h3><button class="link-button" onclick="goPage('Expenses')">View all</button></div>
       <div class="maintenance-recent-list">
         ${recent.length?recent.map(x=>`<div>
           <span class="recent-check">${svg('check')}</span>
           <span><strong>${esc(x.notes||x.category)}</strong><small>${esc(x.vendor||x.category)} · ${shortDate(x.date)}</small></span>
           <b>${money(x.amount)}</b>
         </div>`).join(''):`<p class="maintenance-empty-copy">No completed maintenance has been recorded.</p>`}
       </div>
     </section>
     <section class="card maintenance-calendar-card">
       <div class="maintenance-card-heading"><h3>Maintenance Calendar</h3><button class="link-button" onclick="openReminderCalendar()">View calendar</button></div>
       <div class="maintenance-calendar-list">
         ${calendar.length?calendar.map(x=>`<button onclick="goPage('Reminders')">
           <span class="calendar-status ${statusClass(x.status)}">${svg('calendar')}</span>
           <span><strong>${esc(x.due||'Not scheduled')}</strong><small>${esc(x.name)}</small></span>
           <em class="${x.status==='Overdue'?'status-bad':String(x.status||'').toLowerCase().includes('soon')?'status-warn':'status-good'}">${esc(x.status)}</em>
         </button>`).join(''):`<p class="maintenance-empty-copy">No upcoming maintenance dates are available.</p>`}
       </div>
     </section>
   </aside>
 </div></div>`;
}
function expenses(){
 const allExpenses=[...activeExpenses()].sort((a,b)=>(parseRecordDate(b.date)?.getTime()||0)-(parseRecordDate(a.date)?.getTime()||0));
 const activeDocs=activeDocuments();
 const groupCategory=category=>{
   const name=String(category||'Other');
   if(name==='Repair')return'Maintenance';
   if(['Fuel','Maintenance','Insurance','Registration','Parts'].includes(name))return name;
   return'Other';
 };
 const tabs=['All','Fuel','Maintenance','Insurance','Registration','Parts','Other'];
 const categoryFiltered=allExpenses.filter(item=>currentFilter==='All'||groupCategory(item.category)===currentFilter);
 const expenseSearch=normalizedSearchQuery(current==='Expenses'?topSearchQuery:'');
 const filtered=categoryFiltered.filter(item=>expenseMatchesTopSearch(item,expenseSearch));
 const today=new Date(),currentYear=today.getFullYear(),displayYear=currentYear;
 const dayEnd=new Date(today.getFullYear(),today.getMonth(),today.getDate(),23,59,59,999);
 const periodExpenses=allExpenses.filter(item=>{const date=parseRecordDate(item.date);return date&&date.getFullYear()===currentYear&&date<=dayEnd});
 const priorCutoff=new Date(currentYear-1,today.getMonth(),today.getDate(),23,59,59,999);
 const previousExpenses=allExpenses.filter(item=>{const date=parseRecordDate(item.date);return date&&date.getFullYear()===currentYear-1&&date<=priorCutoff});
 const sum=list=>list.reduce((total,item)=>total+Number(item.amount||0),0);
 const totalThisYear=sum(periodExpenses),totalLastYear=sum(previousExpenses);
 const elapsedMonths=today.getMonth()+1;
 const averageMonthly=totalThisYear/Math.max(1,elapsedMonths);
 const thirtyDaysAgo=new Date(today.getFullYear(),today.getMonth(),today.getDate()-29,0,0,0,0);
 const last30Items=allExpenses.filter(item=>{const date=parseRecordDate(item.date);return date&&date>=thirtyDaysAgo&&date<=dayEnd});
 const last30Days=sum(last30Items);
 const totals=expenseTotals();
 const yearOverYear=totalLastYear>0?((totalThisYear-totalLastYear)/totalLastYear)*100:null;
 const vehicle=activeVehicle();
 const vehicleLabel=[vehicle.make,vehicle.model].filter(Boolean).join(' ')||vehicle.name||'Vehicle';
 const categoryOrder=['Insurance','Fuel','Maintenance','Registration','Parts','Other'];
 const categoryColors={Insurance:'#ef4444',Fuel:'#16a34a',Maintenance:'#2563eb',Registration:'#f59e0b',Parts:'#7c3aed',Other:'#94a3b8'};
 const categoryTones={Insurance:'red',Fuel:'green',Maintenance:'blue',Registration:'orange',Parts:'purple',Other:'slate'};
 const expenseTimelineOptions=expensePeriodOptions(allExpenses,{includeRolling:true,includeCustom:true});
 const monthlyPeriod=resolveExpenseDateRange(expenseChartPeriod,expenseCustomRange,allExpenses,today);
 expenseChartPeriod=monthlyPeriod.period;
 const chartStart=monthlyPeriod.start,chartEnd=monthlyPeriod.end,chartPeriodLabel=monthlyPeriod.label,chartYearLabel=chartStart.getFullYear()===chartEnd.getFullYear()?String(chartStart.getFullYear()):`${chartStart.getFullYear()}–${chartEnd.getFullYear()}`;
 const chartExpenses=expensesWithinRange(allExpenses,monthlyPeriod);
 const chartMonths=buildExpenseMonthBuckets(allExpenses,monthlyPeriod,categoryOrder,groupCategory);
 const chartSpansYears=chartStart.getFullYear()!==chartEnd.getFullYear();
 const rawMaxMonth=Math.max(0,...chartMonths.map(month=>month.total));
 const niceAxisMax=value=>{if(value<=0)return 100;if(value<=100)return Math.ceil(value/25)*25;if(value<=500)return Math.ceil(value/100)*100;if(value<=1000)return Math.ceil(value/250)*250;const magnitude=10**Math.floor(Math.log10(value));return Math.ceil(value/(magnitude/2))*(magnitude/2)};
 const maxMonth=niceAxisMax(rawMaxMonth);

 const categoryPeriod=resolveExpenseDateRange(expenseCategoryPeriod,expenseCategoryCustomRange,allExpenses,today);
 expenseCategoryPeriod=categoryPeriod.period;
 const categoryPeriodLabel=categoryPeriod.label;
 const categoryExpenses=expensesWithinRange(allExpenses,categoryPeriod);
 const categoryTotalsForChart=Object.fromEntries(categoryOrder.map(category=>[category,0]));
 categoryExpenses.forEach(item=>categoryTotalsForChart[groupCategory(item.category)]+=Number(item.amount||0));
 const categoryChartTotal=sum(categoryExpenses);
 const categoryChartEntries=categoryOrder.map(category=>({category,value:categoryTotalsForChart[category]})).filter(item=>item.value>0);
 let donutCursor=0;
 const donutStops=categoryChartEntries.map(item=>{const start=donutCursor;donutCursor+=categoryChartTotal?item.value/categoryChartTotal*100:0;return `${categoryColors[item.category]} ${start.toFixed(2)}% ${donutCursor.toFixed(2)}%`});
 const donutBackground=donutStops.length?`conic-gradient(${donutStops.join(',')})`:'#e2e8f0';
 const monthlyBudget=Number(state.expenseSettings?.monthlyBudget||500);
 const budgetPercent=Math.min(100,averageMonthly/Math.max(1,monthlyBudget)*100);
 const recent=allExpenses.slice(0,5);
 const latestByCategory=category=>allExpenses.find(item=>groupCategory(item.category)===category);
 const nextAnnualDate=value=>{const date=parseRecordDate(value);if(!date)return'Not scheduled';date.setFullYear(date.getFullYear()+1);return date.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})};
 const inferredRecurring=[
   {label:'Insurance',item:latestByCategory('Insurance')},
   {label:'Registration',item:latestByCategory('Registration')}
 ].filter(entry=>entry.item);
 const expenseSettings=state.expenseSettings||{};
 const categoryBudgets=expenseSettings.categoryBudgets||{};
 const plannedRecurring=(expenseSettings.recurringItems||[]).filter(item=>String(item.vehicleId||state.activeVehicleId)===String(state.activeVehicleId));
 const monthlyEquivalent=item=>Number(item.amount||0)/(item.frequency==='Annually'?12:item.frequency==='Quarterly'?3:1);
 const plannedRecurringMonthly=plannedRecurring.reduce((sum,item)=>sum+monthlyEquivalent(item),0);
 const monthStart=new Date(today.getFullYear(),today.getMonth(),1,0,0,0,0),monthEnd=new Date(today.getFullYear(),today.getMonth()+1,0,23,59,59,999);
 const currentMonthExpenses=allExpenses.filter(item=>{const date=parseRecordDate(item.date);return date&&date>=monthStart&&date<=monthEnd});
 const currentMonthSpend=sum(currentMonthExpenses),budgetRemaining=monthlyBudget-currentMonthSpend,budgetUsedPercent=monthlyBudget?Math.max(0,currentMonthSpend/monthlyBudget*100):0;
 const currentMonthCategoryTotals=Object.fromEntries(categoryOrder.map(category=>[category,0]));
 currentMonthExpenses.forEach(item=>currentMonthCategoryTotals[groupCategory(item.category)]+=Number(item.amount||0));
 const categoryBudgetTotal=categoryOrder.reduce((sum,category)=>sum+Math.max(0,Number(categoryBudgets[category]||0)),0);
 const editingRecurring=plannedRecurring.find(item=>item.id===editingRecurringExpenseId)||null;
 const recurringSummary=plannedRecurring.length?plannedRecurring.slice(0,3).map(item=>({label:item.name,amount:Number(item.amount||0),detail:`${item.frequency}${item.nextDate?` · next ${shortDate(item.nextDate)}`:''}`})):inferredRecurring.map(entry=>({label:entry.label,amount:Number(entry.item.amount||0),detail:`Estimated annual renewal · ${nextAnnualDate(entry.item.date)}`}));
 const rowMenu=index=>`<details class="expense-row-menu"><summary aria-label="Expense actions">${svg('more')}</summary><div><button type="button" onclick="closeActionMenus();editRecord('expense',${index})">${svg('edit')} Edit Expense</button><button type="button" class="delete" onclick="closeActionMenus();openExpenseDeleteConfirm(${index})">${svg('trash')} Delete Expense</button></div></details>`;
 const expenseSort=listSortState.expenses;
 const sortedExpenses=[...filtered].sort((a,b)=>{if(expenseSort.key==='amount')return compareListValues(Number(a.amount),Number(b.amount),expenseSort.direction)||compareListValues(parseRecordDate(a.date)?.getTime(),parseRecordDate(b.date)?.getTime(),'desc');return compareListValues(parseRecordDate(a.date)?.getTime(),parseRecordDate(b.date)?.getTime(),expenseSort.direction)||compareListValues(Number(a.amount),Number(b.amount),'desc')});
 const displayed=expenseSearch?sortedExpenses:sortedExpenses.slice(0,12);
 const categorySymbol=category=>`<span class="expense-chart-category-icon ${categoryTones[category]}">${svg(categoryIcon(category))}</span>`;
 const expenseHeaderActions=`<div class="expense-header-actions"><button type="button" class="secondary expense-header-button ${expenseViewMode==='budget'?'active':''}" onclick="toggleExpenseView()">${svg(expenseViewMode==='budget'?'dollar':'chart')} ${expenseViewMode==='budget'?'Expense View':'Budget View'}</button><button type="button" class="primary expense-header-button" onclick="openModal('expense')">${svg('plus')} Add Expense</button></div>`;
 const budgetViewHtml=`<div class="expense-budget-view">
   <section class="expense-budget-kpis">
    <article class="card budget-kpi"><span class="expense-kpi-icon blue">${svg('dollar')}</span><div><small>Monthly Budget</small><strong>${money(monthlyBudget)}</strong><em>${expenseSettings.rollover?'Unused budget rolls forward':'Resets each month'}</em></div></article>
    <article class="card budget-kpi"><span class="expense-kpi-icon orange">${svg('chart')}</span><div><small>${today.toLocaleDateString('en-US',{month:'long'})} Spending</small><strong>${money(currentMonthSpend)}</strong><em>${currentMonthExpenses.length} recorded transaction${currentMonthExpenses.length===1?'':'s'}</em></div></article>
    <article class="card budget-kpi"><span class="expense-kpi-icon ${budgetRemaining>=0?'green':'red'}">${svg('gauge')}</span><div><small>${budgetRemaining>=0?'Remaining':'Over Budget'}</small><strong>${money(Math.abs(budgetRemaining))}</strong><em>${budgetUsedPercent.toFixed(0)}% of the monthly budget used</em></div></article>
    <article class="card budget-kpi"><span class="expense-kpi-icon purple">${svg('calendar')}</span><div><small>Planned Recurring</small><strong>${money(plannedRecurringMonthly)}/mo</strong><em>${plannedRecurring.length} recurring item${plannedRecurring.length===1?'':'s'}</em></div></article>
   </section>
   <section class="card expense-budget-overview-card">
    <div class="expense-card-heading"><div><h2>Monthly Budget Progress</h2><small>${today.toLocaleDateString('en-US',{month:'long',year:'numeric'})}</small></div><strong class="${budgetRemaining<0?'status-bad':budgetUsedPercent>=expenseSettings.alertPercent?'status-warn':'status-good'}">${money(currentMonthSpend)} of ${money(monthlyBudget)}</strong></div>
    <div class="budget-overall-progress ${budgetRemaining<0?'over':budgetUsedPercent>=expenseSettings.alertPercent?'warning':''}"><span style="width:${Math.min(100,budgetUsedPercent)}%"></span></div>
    <div class="budget-overall-caption"><span>Warning begins at ${Number(expenseSettings.alertPercent||85)}%</span><strong>${budgetRemaining>=0?`${money(budgetRemaining)} available`:`${money(Math.abs(budgetRemaining))} over budget`}</strong></div>
   </section>
   <section class="expense-budget-main-grid">
    <form class="card expense-budget-settings-form" onsubmit="saveExpenseBudgetSettings(event,this)">
     <div class="expense-card-heading"><div><h2>Budget Settings</h2><small>Set the active vehicle's planning targets.</small></div></div>
     <div class="budget-settings-grid"><label>Monthly budget<div class="money-input-shell"><span>$</span><input type="number" name="monthlyBudget" min="0" step="0.01" value="${Number(monthlyBudget).toFixed(2)}"></div></label><label>Warning threshold<select name="alertPercent">${[70,75,80,85,90,95,100].map(value=>`<option value="${value}" ${Number(expenseSettings.alertPercent)===value?'selected':''}>${value}%</option>`).join('')}</select></label></div>
     <label class="budget-rollover-option"><input type="checkbox" name="rollover" ${expenseSettings.rollover?'checked':''}><span><strong>Carry unused budget forward</strong><small>This is a planning preference only; GarageLog does not alter recorded expenses.</small></span></label>
     <div class="budget-category-heading"><div><strong>Category limits</strong><small>Optional monthly targets. Leave a category at $0 for no individual limit.</small></div><span>${categoryBudgetTotal?`${money(categoryBudgetTotal)} allocated`:'No category limits'}</span></div>
     <div class="budget-category-input-grid">${categoryOrder.map(category=>`<label>${categorySymbol(category)}<span>${category}</span><div class="money-input-shell compact"><span>$</span><input type="number" name="categoryBudget-${category}" min="0" step="0.01" value="${Number(categoryBudgets[category]||0).toFixed(2)}"></div></label>`).join('')}</div>
     <div class="budget-form-actions"><button class="primary budget-action-button" type="submit">${svg('check')}<span>Save Budget Settings</span></button></div>
    </form>
    <section class="card expense-category-budget-card">
     <div class="expense-card-heading"><div><h2>Category Progress</h2><small>Current-month spending against optional limits.</small></div></div>
     <div class="category-budget-progress-list">${categoryOrder.map(category=>{const spent=currentMonthCategoryTotals[category]||0,limit=Math.max(0,Number(categoryBudgets[category]||0)),percent=limit?spent/limit*100:0;return `<div><div class="category-budget-row-heading"><span>${categorySymbol(category)}<strong>${category}</strong></span><b>${money(spent)}${limit?` / ${money(limit)}`:''}</b></div><div class="category-budget-track ${limit&&percent>100?'over':limit&&percent>=expenseSettings.alertPercent?'warning':''}"><span style="width:${limit?Math.min(100,percent):0}%"></span></div><small>${limit?(percent>100?`${money(spent-limit)} over limit`:`${money(Math.max(0,limit-spent))} remaining`):'No category limit set'}</small></div>`}).join('')}</div>
    </section>
   </section>
   <section class="card recurring-budget-card">
    <div class="expense-card-heading"><div><h2>Recurring Expense Plan</h2><small>Track expected costs without creating expense transactions automatically.</small></div><span>${money(plannedRecurringMonthly)}/month equivalent</span></div>
    <div class="recurring-budget-layout">
     <div class="recurring-plan-list">${plannedRecurring.length?plannedRecurring.map(item=>`<article><span class="expense-list-icon ${categoryTones[groupCategory(item.category)]||'slate'}">${svg(categoryIcon(groupCategory(item.category)))}</span><div><strong>${esc(item.name)}</strong><small>${esc(item.category||'Other')} · ${esc(item.frequency)}${item.nextDate?` · next ${esc(shortDate(item.nextDate))}`:''}</small></div><b>${money(item.amount)}</b><div class="recurring-plan-actions"><button type="button" class="mini-btn" onclick="editRecurringExpensePlan('${item.id}')">${svg('edit')}</button><button type="button" class="mini-btn delete" onclick="deleteRecurringExpensePlan('${item.id}')">${svg('trash')}</button></div></article>`).join(''):`<div class="budget-empty-state">${svg('calendar')}<strong>No recurring plans yet</strong><p>Add insurance, registration, subscriptions, or other expected vehicle costs.</p></div>`}</div>
     <form class="recurring-plan-form" onsubmit="saveRecurringExpensePlan(event,this)"><h3>${editingRecurring?'Edit recurring item':'Add recurring item'}</h3><label>Name<input name="name" maxlength="80" value="${esc(editingRecurring?.name||'')}" placeholder="Insurance premium" required></label><div class="recurring-form-grid"><label>Category<select name="category">${categoryOrder.map(category=>`<option ${editingRecurring?.category===category?'selected':''}>${category}</option>`).join('')}</select></label><label>Amount<div class="money-input-shell"><span>$</span><input type="number" name="amount" min="0.01" step="0.01" value="${editingRecurring?Number(editingRecurring.amount).toFixed(2):''}" required></div></label><label>Frequency<select name="frequency">${['Monthly','Quarterly','Annually'].map(value=>`<option ${editingRecurring?.frequency===value?'selected':''}>${value}</option>`).join('')}</select></label><label>Next due date<input type="date" name="nextDate" value="${esc(editingRecurring?.nextDate||'')}"></label></div><div class="recurring-form-actions">${editingRecurring?`<button type="button" class="secondary" onclick="cancelRecurringExpenseEdit()">Cancel</button>`:''}<button type="submit" class="primary budget-action-button">${svg(editingRecurring?'check':'plus')}<span>${editingRecurring?'Save Changes':'Add Plan'}</span></button></div></form>
    </div>
   </section>
  </div>`;
 return `<div class="expenses-page">
   <section class="expense-workspace expense-workspace-aligned">
     <div class="expense-main-column">
       ${pageHead('Expenses',expenseViewMode==='budget'?'Plan monthly spending and recurring vehicle costs without changing recorded transactions.':'Track and analyze all ownership costs to understand your true cost of ownership.',expenseHeaderActions)}
       ${otherVehicleRecordNotice('expenses','expense')}
       ${expenseViewMode==='budget'?budgetViewHtml:`<div class="expense-main-toolbar">
         <div class="expense-filter-tabs">${tabs.map(tab=>`<button class="${currentFilter===tab?'active':''}" onclick="setFilter('${tab}')">${tab}${tab==='All'?` <span>${allExpenses.length}</span>`:''}</button>`).join('')}</div>
       </div>

       <section class="expense-kpi-grid">
         <article class="card expense-kpi"><span class="expense-kpi-icon blue">${svg('dollar')}</span><div><small>Year-to-Date Spend</small><strong>${money(totalThisYear)}</strong><em>${periodExpenses.length} transaction${periodExpenses.length===1?'':'s'} in ${displayYear}</em></div></article>
         <article class="card expense-kpi"><span class="expense-kpi-icon green">${svg('chart')}</span><div><small>Average Monthly Spend</small><strong>${money(averageMonthly)}</strong><em>Across ${elapsedMonths} elapsed month${elapsedMonths===1?'':'s'} in ${displayYear}</em></div></article>
         <article class="card expense-kpi"><span class="expense-kpi-icon purple">${svg('gauge')}</span><div><small>Cost Per Tracked Mile</small><strong>${optionalMoney(totals.costPerMile)}</strong><em>${totals.trackedMiles?`Based on ${number(totals.trackedMiles)} miles and ${money(totals.trackedCost)} in matching expenses`:'Add another odometer reading to calculate'}</em></div></article>
         <article class="card expense-kpi"><span class="expense-kpi-icon orange">${svg('calendar')}</span><div><small>Last 30 Days</small><strong>${money(last30Days)}</strong><em>${last30Items.length} transactions</em></div></article>
       </section>

       <article class="card expense-table-card">
         <div class="expense-table-scroll">
           <table class="expense-table">
             <thead><tr><th>${listSortHeader('Date','expenses','date')}</th><th>Category</th><th>Vendor</th><th>Notes</th><th>${listSortHeader('Amount','expenses','amount')}</th><th>Vehicle</th><th>Attachment</th><th></th></tr></thead>
             <tbody>${displayed.length?displayed.map(item=>{const index=state.expenses.indexOf(item);const category=groupCategory(item.category);return `<tr data-search-key="expense:${index}">
               <td><strong>${esc(shortDate(item.date))}</strong><small>${esc(String(item.date||'').slice(0,4))}</small></td>
               <td><span class="expense-category">${categorySymbol(category)}<span>${esc(category)}</span></span></td>
               <td>${esc(item.vendor||'—')}</td>
               <td class="expense-notes"><span>${esc(item.notes||'—')}</span>${expenseCoverageBadge(item)}</td>
               <td class="expense-amount-cell"><strong>${money(item.amount)}</strong>${expenseCoverageLabel(item)?'<small>paid by you</small>':''}</td>
               <td>${esc(vehicleLabel)}</td>
               <td class="expense-attachment-cell">${expenseAttachmentMarkup(item)}</td>
               <td>${rowMenu(index)}</td>
             </tr>`}).join(''):`<tr><td colspan="8" class="empty">No expenses match this category.</td></tr>`}</tbody>
           </table>
         </div>
         <footer class="expense-table-footer"><span>${expenseSearch?`Showing ${displayed.length} of ${filtered.length} matching expense${filtered.length===1?'':'s'} for “${esc(topSearchQuery.trim())}”`:`Showing ${displayed.length?1:0} to ${displayed.length} of ${filtered.length} expenses`}</span></footer>
       </article>

       <section class="expense-chart-grid">
         <article class="card expense-monthly-card">
           <div class="expense-card-heading"><div class="expense-heading-title"><h2>Monthly Spending</h2><span class="expense-chart-year">${esc(chartYearLabel)}</span></div><select id="expenseChartPeriod" aria-label="Expense chart period" onchange="changeExpenseChartPeriod(this.value,'monthly')">
             ${expenseTimelineOptions.map(([value,label])=>`<option value="${value}" ${expenseChartPeriod===value?'selected':''}>${esc(label)}</option>`).join('')}
           </select></div>
           <div class="expense-chart-period-label">${esc(chartPeriodLabel)} · ${chartExpenses.length} transaction${chartExpenses.length===1?'':'s'}</div>
           <div class="expense-monthly-chart">
             <div class="expense-axis"><span>${money(maxMonth)}</span><span>${money(maxMonth/2)}</span><span>$0</span></div>
             <div class="expense-bars" style="--expense-month-count:${Math.max(1,chartMonths.length)}">${chartMonths.map((month,index)=>`<div class="expense-month-column" title="${month.label} ${month.year}: ${money(month.total)}"><div class="expense-stack" style="height:${month.total?Math.max(8,month.total/maxMonth*100):2}%">${categoryOrder.map(category=>month.values[category]?`<span style="height:${month.values[category]/month.total*100}%;background:${categoryColors[category]}"></span>`:'').join('')}</div><small>${esc(month.label)}${chartSpansYears?` '${String(month.year).slice(-2)}`:''}</small></div>`).join('')}</div>
           </div>
           <div class="expense-chart-legend">${categoryOrder.map(category=>`<span>${categorySymbol(category)}${category}</span>`).join('')}</div>
         </article>

         <article class="card expense-category-card">
           <div class="expense-card-heading"><h2>Spending by Category</h2><select id="expenseCategoryPeriod" aria-label="Spending by category period" onchange="changeExpenseChartPeriod(this.value,'category')">
             ${expenseTimelineOptions.map(([value,label])=>`<option value="${value}" ${expenseCategoryPeriod===value?'selected':''}>${esc(label)}</option>`).join('')}
           </select></div>
           <div class="expense-chart-period-label">${esc(categoryPeriodLabel)} · ${categoryExpenses.length} transaction${categoryExpenses.length===1?'':'s'}</div>
           <div class="expense-donut-layout">
             <div class="expense-donut" style="background:${donutBackground}"><div><strong>${money(categoryChartTotal)}</strong><small>Total</small></div></div>
             <div class="expense-category-legend">${categoryChartEntries.length?categoryChartEntries.map(item=>`<div><span>${categorySymbol(item.category)}<b class="expense-category-name">${item.category}</b></span><b>${categoryChartTotal?Math.round(item.value/categoryChartTotal*100):0}%</b><strong>${money(item.value)}</strong></div>`).join(''):'<p class="muted">Add expenses to populate this chart.</p>'}<div class="expense-category-total"><span>Total</span><strong>${money(categoryChartTotal)}</strong></div></div>
           </div>
         </article>
       </section>`}
     </div>

     <aside class="expense-side-column expense-side-top">
       <section class="card expense-side-card">
         <div class="expense-card-heading"><h2>Expense Summary</h2><span>${svg('info')}</span></div>
         <div class="expense-summary-list">
           <div><span>Year to Date (${displayYear})</span><strong>${money(totalThisYear)}</strong></div>
           <div><span>Prior YTD (${displayYear-1})</span><strong>${previousExpenses.length?money(totalLastYear):'—'}</strong></div>
           <div><span>Year-over-Year</span><strong class="${yearOverYear===null?'':yearOverYear<=0?'status-good':'status-warn'}">${yearOverYear===null?'No comparable prior data':`${yearOverYear>0?'+':''}${yearOverYear.toFixed(1)}%`}</strong></div>
           <div><span>Current Odometer</span><strong>${number(state.mileage)} mi</strong></div>
           <div><span>Tracked Mileage</span><strong>${totals.trackedMiles?`${number(totals.trackedMiles)} mi`:'—'}</strong></div>
           <div><span>Cost Per Tracked Mile</span><strong>${optionalMoney(totals.costPerMile)}</strong></div>
         </div>
         <button class="secondary expense-wide-action" onclick="goPage('Reports')">View Full Report</button>
       </section>

       <section class="card expense-side-card">
         <div class="expense-card-heading"><h2>Recent Expenses</h2><button class="link-button" onclick="setFilter('All')">View All</button></div>
         <div class="recent-expense-list">${recent.length?recent.map(item=>{const category=groupCategory(item.category);return `<button onclick="setFilter('${category}')"><span class="expense-list-icon ${categoryTones[category]}">${svg(categoryIcon(category))}</span><span><strong>${esc(category)} — ${esc(item.vendor||'Unknown')}</strong><small>${esc(shortDate(item.date))}${expenseCoverageLabel(item)?` · ${esc(expenseCoverageLabel(item))}`:''}</small></span><b>${money(item.amount)}</b></button>`}).join(''):'<p class="muted">No recent expenses.</p>'}</div>
       </section>

       <section class="card expense-side-card">
         <div class="expense-card-heading"><h2>Budget & Recurring</h2><button class="link-button" onclick="openExpenseBudgetView()">Edit</button></div>
         <div class="expense-budget-row"><div><strong>Monthly Budget</strong><b>${money(monthlyBudget)}</b></div><div class="expense-budget-progress"><span style="width:${Math.min(100,budgetUsedPercent)}%"></span></div><small>${money(currentMonthSpend)} this month · ${budgetUsedPercent.toFixed(0)}% of budget</small></div>
         <div class="expense-recurring-list">${recurringSummary.length?recurringSummary.map(entry=>`<div><span><strong>${esc(entry.label)}</strong><small>${esc(entry.detail)}</small></span><b>${money(entry.amount)}</b></div>`).join(''):'<p class="muted">Open Budget View to add recurring expense plans.</p>'}</div>
       </section>

       <section class="card expense-side-card expense-export-card">
         <h2>Export & Actions</h2>
         <button onclick="exportExpenses()">${svg('download')}<span>Export Expenses (CSV)</span><b>›</b></button>
         <button onclick="printExpenseReport('tax')">${svg('file')}<span>Review Tax Summary</span><b>›</b></button>
         <button onclick="printExpenseReport('full')">${svg('printer')}<span>Open Expense Report</span><b>›</b></button>
       </section>
     </aside>
   </section>
 </div>`;
}
function documents(){
 const docsAll=activeDocuments().map(doc=>({...doc,_index:state.documents.indexOf(doc),category:normalizeDocumentCategory(doc.category),bytes:Number(doc.bytes||parseSizeText(doc.size)||0),addedAt:doc.addedAt||doc.date,vehicleId:doc.vehicleId||state.activeVehicleId}));
  const categories=['All Files','Receipts','Registration','Insurance','Manuals','Warranties','Photos','Other'];
 const counts=Object.fromEntries(categories.map(category=>[category,category==='All Files'?docsAll.length:docsAll.filter(doc=>doc.category===category).length]));
  if(String(currentFilter).startsWith('folder:'))currentFilter='All';
  const visibleByCategory=docsAll.filter(doc=>currentFilter==='All'||currentFilter==='All Files'||doc.category===currentFilter);
 const documentSort=listSortState.documents;
 const sortedByCategory=[...visibleByCategory].sort((a,b)=>{let result=0;if(documentSort.key==='fileName')result=compareListValues(a.name,b.name,documentSort.direction);else if(documentSort.key==='category')result=compareListValues(a.category,b.category,documentSort.direction)||compareListValues(a.name,b.name,'asc');else if(documentSort.key==='coverageDate')result=compareListValues(documentCoverageDates(a).sortDate?.getTime(),documentCoverageDates(b).sortDate?.getTime(),documentSort.direction)||compareListValues(a.name,b.name,'asc');else result=compareListValues(parseDocumentDate(a.addedAt||a.date)?.getTime(),parseDocumentDate(b.addedAt||b.date)?.getTime(),documentSort.direction)||compareListValues(a.name,b.name,'asc');return result});
 const query=documentSearchQuery.trim().toLowerCase();
 const docs=sortedByCategory.filter(doc=>documentMatchesSearch(doc,query));
 const stored=docsAll.reduce((sum,doc)=>sum+Number(doc.bytes||0),0),capacity=5*1024*1024*1024,usedPct=Math.min(100,stored/capacity*100),availablePct=100-usedPct;
 const recentViewed=[...docsAll].filter(doc=>doc.lastViewedAt).sort((a,b)=>(parseDocumentDate(b.lastViewedAt)?.getTime()||0)-(parseDocumentDate(a.lastViewedAt)?.getTime()||0)).slice(0,4),fallbackRecentViewed=recentViewed.length?recentViewed:[...docsAll].sort((a,b)=>(parseDocumentDate(b.addedAt||b.date)?.getTime()||0)-(parseDocumentDate(a.addedAt||a.date)?.getTime()||0)).slice(0,4);
 const expiring=[...docsAll].map(doc=>({doc,expiry:estimateDocumentExpiry(doc)})).filter(item=>item.expiry).sort((a,b)=>a.expiry-b.expiry).slice(0,4),recentUploads=[...docsAll].sort((a,b)=>(parseDocumentDate(b.addedAt||b.date)?.getTime()||0)-(parseDocumentDate(a.addedAt||a.date)?.getTime()||0)).slice(0,3);
 const popularSearches=['brake','oil change','registration','insurance','tires'];
  const filterButtons=categories.map(category=>`<button class="document-filter-pill ${(currentFilter==='All'&&category==='All Files')||currentFilter===category?'active':''}" onclick="setFilter('${category==='All Files'?'All':category}')">${esc(category)} <span>${counts[category]||0}</span></button>`).join('');
 return `<div class="documents-page-grid"><div class="documents-main-column">
  <div class="documents-page-header"><div><h1>Documents</h1><p>Store, preview, search, organize, print, and export vehicle records locally.</p></div><button class="documents-upload-button" onclick="openModal('document')">${svg('plus')}<span>Upload Document</span></button></div>
  ${otherVehicleRecordNotice('documents','document')}
  <div class="documents-filter-bar">${filterButtons}</div>
   <section class="card documents-table-card"><div class="documents-table-scroll"><table class="documents-table"><thead><tr><th>${listSortHeader('File Name','documents','fileName')}</th><th>${listSortHeader('Category','documents','category')}</th><th>Vehicle</th><th>${listSortHeader('Date Added','documents','dateAdded')}</th><th>Tags</th><th>${listSortHeader('Start / Expiration','documents','coverageDate')}</th><th></th></tr></thead><tbody>${sortedByCategory.map(doc=>{const tags=documentTags(doc),tone=documentTone(doc.category),matches=documentMatchesSearch(doc,query);return `<tr data-document-index="${doc._index}" data-search-key="document:${doc._index}" ${matches?'':'hidden'}><td><button class="document-file-button" onclick="openDocument(${doc._index})"><span class="document-file-cell">${fileTypeIcon(doc)}<span><strong>${esc(doc.name)}</strong><small>${doc.storedName?`${esc(fileTypeMeta(doc).label)} · ${documentOcrStatusLabel(doc)}${isPendingMobileReceipt(doc)?' · Pending review':''}`:'Metadata record'}</small></span></span></button></td><td><span class="document-category-pill ${tone}">${esc(doc.category)}</span></td><td>${esc(vehicleNameFromId(doc.vehicleId))}</td><td class="document-date-cell">${documentDisplayDate(doc)}</td><td><div class="document-tag-list">${tags.map(tag=>`<span class="document-tag ${tone}">${esc(tag)}</span>`).join('')}</div></td><td>${documentCoverageDateDisplay(doc)}</td><td class="document-menu-cell">${documentRowMenu(doc._index,doc)}</td></tr>`}).join('')}<tr class="document-search-empty" ${docs.length?'hidden':''}><td colspan="7" class="empty">No documents match this category or OCR search.</td></tr></tbody></table></div><div class="documents-table-footer" data-document-total="${visibleByCategory.length}">Showing ${docs.length?1:0} to ${docs.length} of ${visibleByCategory.length} items</div></section>
  <div class="documents-bottom-grid">
    <section class="card document-mini-card"><div class="section-title"><h3>Categories</h3></div><div class="folder-category-list">${categories.filter(category=>category!=='All Files'&&counts[category]).map(category=>`<div><span class="folder-tag ${documentTone(category)}">${svg('file')}</span><b>${esc(category)}</b><small>${counts[category]} file${counts[category]===1?'':'s'}</small></div>`).join('')}</div></section>
    <section class="card document-mini-card document-search-card"><div class="section-title"><h3>Search Documents (OCR)</h3><div class="ocr-heading-actions"><button type="button" class="link-button" onclick="openOcrStatus()">OCR Status</button><button type="button" class="link-button document-index-button" onclick="indexAllDocuments()" ${documentIndexProgress.running?'disabled':''}>${documentIndexProgress.running?'Indexing…':'Index All'}</button></div></div><p class="muted search-copy">Search names, tags, services, shops, PDF text, Word documents, and text found in images.</p><div class="document-ocr-search"><span>${svg('search')}</span><input id="documentOcrSearch" type="text" value="${esc(documentSearchQuery)}" placeholder="Search document contents..." autocomplete="off" oninput="setDocumentSearchQuery(this.value)"></div>${documentIndexProgress.running?`<div class="ocr-index-progress-copy">Indexing ${documentIndexProgress.completed} of ${documentIndexProgress.total}${documentIndexProgress.currentName?` · ${esc(documentIndexProgress.currentName)}`:''}…</div><div class="ocr-index-progress"><span style="width:${documentIndexProgress.total?documentIndexProgress.completed/documentIndexProgress.total*100:0}%"></span></div>`:''}<div class="document-popular-searches"><span>Popular searches</span><div>${popularSearches.map(tag=>`<button onclick="useDocumentSearch('${tag}')">${tag}</button>`).join('')}</div></div></section>
   <section class="card document-mini-card"><div class="section-title"><h3>Recent Uploads</h3></div><div class="mini-doc-list">${recentUploads.map(doc=>`<button onclick="openDocument(${doc._index})">${fileTypeIcon(doc,true)}<span><strong>${esc(doc.name)}</strong><small>${esc(relativeTime(doc.addedAt||doc.date))}</small></span></button>`).join('')||'<p class="muted">Upload a document to get started.</p>'}</div><button class="link-button folder-manage-link" onclick="goPage('Documents')">View All Documents</button></section>
  </div></div>
  <aside class="documents-side-column">
   <section class="card documents-side-card storage-summary-card"><div class="documents-side-heading"><h3>Storage Summary</h3><span class="info-icon">${svg('info')}</span></div><div class="storage-summary-layout"><div class="storage-ring storage-ring-large" style="background:conic-gradient(var(--blue) 0 ${Math.max(1,usedPct)}%, #e5e7eb ${Math.max(1,usedPct)}% 100%)"><span><strong>${formatBytes(stored)}</strong><small>of 5 GB used</small></span></div><div class="storage-summary-metrics"><div><i class="legend-blue"></i><span>Used</span><b>${formatBytes(stored)} (${Math.round(usedPct)}%)</b></div><div><i class="legend-slate"></i><span>Available</span><b>${formatBytes(capacity-stored)} (${Math.round(availablePct)}%)</b></div><button class="link-button" onclick="documentAction('manageStorage')">Manage Storage</button></div></div></section>
   <section class="card documents-side-card"><div class="documents-side-heading"><h3>Recently Viewed</h3></div><div class="documents-side-list">${fallbackRecentViewed.map(doc=>`<button onclick="openDocument(${doc._index})">${fileTypeIcon(doc,true)}<span><strong>${esc(doc.name)}</strong></span><em>${esc(relativeTime(doc.lastViewedAt||doc.addedAt||doc.date))}</em></button>`).join('')||'<p class="muted">Open a file to track recent activity.</p>'}<button class="link-button side-link-button" onclick="goPage('Documents')">View All</button></div></section>
   <section class="card documents-side-card"><div class="documents-side-heading"><h3>Expiring Documents</h3></div><div class="documents-side-list">${expiring.length?expiring.map(item=>{const days=Math.max(0,Math.ceil((item.expiry.getTime()-Date.now())/86400000));return `<button onclick="openDocument(${item.doc._index})"><span class="mini-doc-icon ${days<45?'orange':'slate'}">${svg('calendar')}</span><span><strong>${esc(item.doc.name)}</strong><small>Expires on ${item.expiry.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})} (${days} days)</small></span><em>›</em></button>`}).join(''):`<p class="muted">Insurance and registration documents will appear here when available.</p>`}<button class="link-button side-link-button" onclick="goPage('Documents')">View All Expiring</button></div></section>
<section class="card documents-side-card"><div class="documents-side-heading"><h3>Share & Export</h3></div><div class="documents-side-list action-list"><button onclick="documentAction('share')"><span class="mini-doc-icon slate">${svg('share')}</span><span><strong>Share Document</strong><small>Create or reuse a revocable local link and QR code</small></span><em>›</em></button><button onclick="documentAction('export')"><span class="mini-doc-icon slate">${svg('download')}</span><span><strong>Export Documents</strong><small>Package selected files as a ZIP archive</small></span><em>›</em></button><button onclick="documentAction('print')"><span class="mini-doc-icon slate">${svg('printer')}</span><span><strong>Print Documents</strong><small>Select files and build a print queue</small></span><em>›</em></button></div></section>
  </aside></div>`}


function reminders(){
 const all=activeReminders().map(item=>({...item,vehicleId:item.vehicleId||state.activeVehicleId,_index:state.reminders.indexOf(item)}));
 const calendarMode=reminderViewMode==='calendar';
 const statusKey=value=>{const status=String(value||'').toLowerCase();if(status.includes('overdue'))return'Overdue';if(status.includes('soon'))return'Due Soon';if(status.includes('complete'))return'Completed';if(status.includes('upcoming'))return'Upcoming';return'Custom'};
 const isMileageDue=value=>/\bmi\b/i.test(String(value||''));
 const parseReminderDate=value=>{if(!value||isMileageDue(value))return null;return parseRecordDate(value)};
 const reminderIcon=name=>taskVisual(name).icon;
 const reminderTone=item=>taskVisual(item.name).tone;
 const vehicleFor=item=>state.vehicles.find(v=>v.id===item.vehicleId)||activeVehicle();
 const counts={All:all.length,'Due Soon':all.filter(x=>statusKey(x.status)==='Due Soon').length,Overdue:all.filter(x=>statusKey(x.status)==='Overdue').length,Completed:all.filter(x=>statusKey(x.status)==='Completed').length,Custom:all.filter(x=>statusKey(x.status)==='Custom').length,Upcoming:all.filter(x=>statusKey(x.status)==='Upcoming').length};
 const allowed=['All','Due Soon','Overdue','Completed','Custom'],activeTab=allowed.includes(currentFilter)?currentFilter:'All';
 const reminderSearch=normalizedSearchQuery(current==='Reminders'?topSearchQuery:'');
 const items=all.filter(x=>(activeTab==='All'||statusKey(x.status)===activeTab)&&reminderMatchesTopSearch(x,reminderSearch));
 const sortScore=item=>{const date=parseReminderDate(item.due);if(date)return date.getTime();const mileage=parseMileageValue(item.due);if(mileage!==null)return Date.now()+Math.max(0,mileage-Number(state.mileage||0))*864000;return Number.MAX_SAFE_INTEGER};
 const reminderRuleSortMeta=item=>{const rule=String(item?.rule||''),mileageBased=item?.triggerType==='mileage'||isMileageDue(rule)||isMileageDue(item?.due);if(mileageBased)return[0,Number(item?.repeatMiles??parseMileageValue(rule)??parseMileageValue(item?.due)),String(item?.name||'')];if(item?.triggerType==='date'){const date=parseReminderDate(item?.due);return[1,date?.getTime()??null,String(item?.name||'')]}const match=rule.replaceAll(',','').match(/(-?\d+(?:\.\d+)?)\s*(days?|weeks?|months?|years?)/i);if(match){const amount=Number(match[1]),unit=match[2].toLowerCase(),days=unit.startsWith('year')?amount*365.25:unit.startsWith('month')?amount*30.4375:unit.startsWith('week')?amount*7:amount;return[2,days,String(item?.name||'')]}return[2,null,rule,String(item?.name||'')]};
 const reminderDueSortMeta=item=>{const date=parseReminderDate(item?.due);if(date)return[0,date.getTime(),String(item?.name||'')];const mileage=isMileageDue(item?.due)?parseMileageValue(item?.due):null;if(mileage!==null)return[1,mileage,String(item?.name||'')];return[2,null,String(item?.name||'')]};
 const reminderSort=listSortState.reminders;
 const sortedItems=[...items].sort((a,b)=>{if(reminderSort.key==='name')return compareListValues(a.name,b.name,reminderSort.direction);if(reminderSort.key==='rule')return compareListTuples(reminderRuleSortMeta(a),reminderRuleSortMeta(b),reminderSort.direction);return compareListTuples(reminderDueSortMeta(a),reminderDueSortMeta(b),reminderSort.direction)});
 const timelineAll=[...all].filter(x=>statusKey(x.status)!=='Completed').sort((a,b)=>sortScore(a)-sortScore(b));
 if(timelineAll.length&&reminderTimelineOffset>=timelineAll.length)reminderTimelineOffset=0;
 const timelineCount=Math.min(4,timelineAll.length),timelineCards=[];
 for(let i=0;i<timelineCount;i++)timelineCards.push(timelineAll[(reminderTimelineOffset+i)%timelineAll.length]);
 const timelineMeta=(item,index)=>{const date=parseReminderDate(item.due),mileage=parseMileageValue(item.due),today=new Date();let eyebrow=index===0?'NEXT':'';let title='Not set';if(date){title=date.toLocaleDateString('en-US',{month:'short',day:'numeric'});if(date.toDateString()===today.toDateString())eyebrow='TODAY'}else if(mileage!==null){title=`${number(mileage)} mi`;if(mileage<=Number(state.mileage||0))eyebrow='DUE'}return{eyebrow,title,detail:isMileageDue(item.due)?String(item.rule||item.due||'Mileage based'):String(item.rule||'Date based')}};
 const rowMenu=(index,item)=>`<div class="action-menu reminder-row-actions">${reminderHasChecklist(item)?`<button class="mini-btn checklist-action" title="Open checklist" onclick="openRecordChecklist('reminder',${index})">${svg('check')}</button>`:''}<button class="mini-btn" title="Edit reminder rule" onclick="editReminderRule(${index})">${svg('edit')}</button><details class="reminder-more"><summary class="mini-btn" aria-label="More reminder options">${svg('more')}</summary><div class="reminder-more-menu"><button onclick="markReminderComplete(${index})">${svg('check')} Mark completed</button><button onclick="duplicateReminderRule(${index})">${svg('plus')} Duplicate rule</button><button class="delete" onclick="deleteReminderRule(${index})">${svg('trash')} Delete reminder</button></div></details></div>`;
 const summaryCards=[{label:'Overdue',value:counts.Overdue,copy:'Require immediate attention',tone:'red'},{label:'Due Soon',value:counts['Due Soon'],copy:'Within 30 days',tone:'orange'},{label:'Upcoming',value:counts.Upcoming,copy:'Next 90 days',tone:'blue'},{label:'Completed',value:counts.Completed,copy:'Last 12 months',tone:'green'}];
 const now=new Date(),thisMonthItems=all.filter(item=>{const d=parseReminderDate(item.due);return d&&d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear()}).sort((a,b)=>sortScore(a)-sortScore(b));
 const upcomingList=(thisMonthItems.length?thisMonthItems:timelineAll).slice(0,4),upcomingHeading=thisMonthItems.length?'Upcoming This Month':'Next Upcoming';
 const recentActivity=[...all].slice(0,3).map((item,idx)=>({title:idx===0?`${item.name} Updated`:idx===1?'Reminder Updated':'Reminder Created',detail:item.rule||item.due||item.name,meta:'Local record',tone:idx===0?'green':idx===1?'blue':'purple',icon:idx===0?'check':idx===1?'edit':'plus'}));

 const addCalendarMonths=(value,months)=>{const source=new Date(value.getFullYear(),value.getMonth(),value.getDate(),12),day=source.getDate();source.setDate(1);source.setMonth(source.getMonth()+months);source.setDate(Math.min(day,new Date(source.getFullYear(),source.getMonth()+1,0).getDate()));return source};
 const calendarStart=new Date(reminderCalendarCursor.getFullYear(),reminderCalendarCursor.getMonth(),1,12),calendarEnd=new Date(calendarStart.getFullYear(),calendarStart.getMonth()+1,0,12);
 const calendarKey=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
 const occurrenceStatus=(item,date)=>{if(statusKey(item.status)==='Completed')return'Completed';const today=new Date();today.setHours(0,0,0,0);const due=new Date(date.getFullYear(),date.getMonth(),date.getDate());const days=Math.ceil((due-today)/86400000),lead=Math.max(0,Number(item.leadTime||30));return days<0?'Overdue':days<=lead?'Due Soon':'Upcoming'};
 const calendarEvents=[];
 all.forEach(item=>{
   const firstDue=parseReminderDate(item.due);if(!firstDue)return;
   const match=String(item.rule||'').match(/Every\s+([\d,]+)\s+(months?|years?)/i),recurring=item.triggerType==='recurring'||Boolean(match);
   if(!recurring){if(firstDue>=calendarStart&&firstDue<=calendarEnd)calendarEvents.push({item,date:firstDue,status:occurrenceStatus(item,firstDue)});return}
   const amount=Math.max(1,Number(String(match?.[1]||1).replaceAll(',',''))||1),unit=String(match?.[2]||'months').toLowerCase(),stepMonths=unit.startsWith('year')?amount*12:amount;
   let occurrence=new Date(firstDue),guard=0;
   if(occurrence>calendarEnd)return;
   while(occurrence<calendarStart&&guard<2400){occurrence=addCalendarMonths(occurrence,stepMonths);guard++}
   while(occurrence<=calendarEnd&&guard<2500){if(occurrence>=calendarStart)calendarEvents.push({item,date:new Date(occurrence),status:occurrenceStatus(item,occurrence),recurring:true});occurrence=addCalendarMonths(occurrence,stepMonths);guard++}
 });
 const calendarEventMap=new Map();
 calendarEvents.sort((a,b)=>a.date-b.date||sortScore(a.item)-sortScore(b.item)).forEach(event=>{const key=calendarKey(event.date);if(!calendarEventMap.has(key))calendarEventMap.set(key,[]);calendarEventMap.get(key).push(event)});
 const gridStart=new Date(calendarStart.getFullYear(),calendarStart.getMonth(),1-calendarStart.getDay(),12),calendarDays=Array.from({length:42},(_,index)=>new Date(gridStart.getFullYear(),gridStart.getMonth(),gridStart.getDate()+index,12));
 const todayKey=calendarKey(new Date());
 const calendarCells=calendarDays.map(date=>{const key=calendarKey(date),events=calendarEventMap.get(key)||[],outside=date.getMonth()!==calendarStart.getMonth(),today=key===todayKey;return `<div class="reminder-calendar-day ${outside?'outside-month':''} ${today?'today':''}"><div class="reminder-calendar-day-head"><span>${date.getDate()}</span>${events.length?`<em>${events.length}</em>`:''}</div><div class="reminder-calendar-events">${events.map(event=>{const item=event.item,tone=reminderTone(item),statusClassName=event.status.toLowerCase().replaceAll(' ','-'),action=reminderHasChecklist(item)?`openRecordChecklist('reminder',${item._index})`:`editReminderRule(${item._index})`;return `<button type="button" class="reminder-calendar-event ${statusClassName}" onclick="${action}" title="${esc(item.name)} — ${esc(event.status)}"><span class="reminder-calendar-event-icon ${tone}">${svg(reminderIcon(item.name))}</span><span><strong>${esc(item.name)}</strong><small>${esc(event.status)}${event.recurring?' · Repeats':''}</small></span></button>`}).join('')}</div></div>`}).join('');
 const nonCalendarItems=all.filter(item=>!parseReminderDate(item.due)).sort((a,b)=>sortScore(a)-sortScore(b));
 const calendarContent=`<section class="card reminder-calendar-card"><div class="reminder-calendar-toolbar"><div><span class="wizard-section-kicker">Reminder schedule</span><h2>${calendarStart.toLocaleDateString('en-US',{month:'long',year:'numeric'})}</h2><p>${calendarEvents.length} scheduled occurrence${calendarEvents.length===1?'':'s'} this month</p></div><div class="reminder-calendar-controls"><button type="button" class="secondary" onclick="shiftReminderCalendar(-1)" aria-label="Previous month">‹</button><button type="button" class="secondary reminder-calendar-today" onclick="showReminderCalendarToday()">Today</button><button type="button" class="secondary" onclick="shiftReminderCalendar(1)" aria-label="Next month">›</button></div></div><div class="reminder-calendar-legend"><span class="upcoming">Upcoming</span><span class="due-soon">Due Soon</span><span class="overdue">Overdue</span><span class="completed">Completed</span></div><div class="reminder-calendar-scroll"><div class="reminder-calendar-grid"><div class="reminder-calendar-weekday">Sun</div><div class="reminder-calendar-weekday">Mon</div><div class="reminder-calendar-weekday">Tue</div><div class="reminder-calendar-weekday">Wed</div><div class="reminder-calendar-weekday">Thu</div><div class="reminder-calendar-weekday">Fri</div><div class="reminder-calendar-weekday">Sat</div>${calendarCells}</div></div></section>${nonCalendarItems.length?`<section class="card reminder-unscheduled-card"><div class="section-title"><div><h3>Mileage & Unscheduled Reminders</h3><p class="muted">These reminders cannot be placed on a calendar date, but remain part of the active schedule.</p></div><span class="badge blue">${nonCalendarItems.length}</span></div><div class="reminder-unscheduled-grid">${nonCalendarItems.map(item=>{const tone=reminderTone(item),status=statusKey(item.status),action=reminderHasChecklist(item)?`openRecordChecklist('reminder',${item._index})`:`editReminderRule(${item._index})`;return `<button type="button" class="reminder-unscheduled-item" onclick="${action}"><span class="reminder-item-icon ${tone}">${svg(reminderIcon(item.name))}</span><span><strong>${esc(item.name)}</strong><small>${esc(item.rule||'No schedule rule')}</small></span><span><b>${esc(item.due||'Not scheduled')}</b><small>${esc(status)}</small></span></button>`}).join('')}</div></section>`:''}`;
 const listContent=`<div class="maintenance-tabs reminders-tabs">${['All','Due Soon','Overdue','Completed','Custom'].map(tab=>`<button class="${activeTab===tab?'active':''}" onclick="setFilter('${tab}')">${tab} <b>${counts[tab]||0}</b></button>`).join('')}</div><section class="card reminder-timeline-card"><div class="section-title"><h3>Upcoming Timeline</h3></div><div class="reminder-timeline-viewport"><div class="reminder-timeline-strip" style="--timeline-columns:${Math.max(1,timelineCards.length)}">${timelineCards.length?timelineCards.map((item,index)=>{const meta=timelineMeta(item,index),tone=reminderTone(item);return `<button class="timeline-entry ${index===0?'active':''}" onclick="${reminderHasChecklist(item)?`openRecordChecklist('reminder',${item._index})`:`editReminderRule(${item._index})`}"><span class="timeline-icon ${tone}">${svg(reminderIcon(item.name))}</span><span class="timeline-copy"><span class="timeline-label">${esc(meta.eyebrow)}</span><strong>${esc(meta.title)}</strong><b>${esc(item.name)}</b><small>${esc(meta.detail)}${reminderHasChecklist(item)?' · Checklist':''}</small></span></button>`}).join(''):'<div class="timeline-empty">No active reminders. Use the guided setup to create one.</div>'}<button class="timeline-next" title="Show next reminders" ${timelineAll.length<=timelineCount?'disabled':''} onclick="advanceReminderTimeline()">${svg('chevronRight')}</button></div></div></section><section class="card table-card reminder-table-card"><div class="reminder-table-scroll"><table class="data-table reminder-table"><thead><tr><th>${listSortHeader('Reminder','reminders','name')}</th><th>Vehicle</th><th>${listSortHeader('Trigger / Rule','reminders','rule')}</th><th>${listSortHeader('Due','reminders','due')}</th><th>Status</th><th>Actions</th></tr></thead><tbody>${sortedItems.map(item=>{const index=item._index,vehicle=vehicleFor(item),dueDate=parseReminderDate(item.due),dueMain=dueDate?dueDate.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):esc(item.due),dueSub=isMileageDue(item.due)?esc(item.due):esc(item.rule||''),tone=reminderTone(item);return `<tr data-search-key="reminder:${index}"><td><div class="reminder-item-cell"><span class="reminder-item-icon ${tone}">${svg(reminderIcon(item.name))}</span><span><strong>${esc(item.name)}</strong><small>${esc(item.rule||'')}</small></span></div></td><td><strong>${esc(vehicleFullName(vehicle))}</strong><small>${esc(vehicle.trim||'')}</small></td><td><strong>${isMileageDue(item.rule)||isMileageDue(item.due)?'Mileage':item.triggerType==='date'?'Specific date':'Time'}</strong><small>${esc(item.rule||'')}</small></td><td><strong>${dueMain}</strong><small>${dueSub}</small></td><td>${statusBadge(statusKey(item.status)==='Due Soon'?'Due Soon':statusKey(item.status))}</td><td>${rowMenu(index,item)}</td></tr>`}).join('')}</tbody></table></div><div class="documents-table-footer">${reminderSearch?`Showing ${items.length} matching reminder${items.length===1?'':'s'} for “${esc(topSearchQuery.trim())}”`:`Showing ${items.length?1:0} to ${items.length} of ${all.length} reminders`}</div></section>`;
 return `<div class="reminders-page-grid ${calendarMode?'calendar-view-mode':''}">
   <div class="reminders-main-column">
     <div class="reminders-page-header"><div><h1>Reminders</h1><p>Stay on top of important due items and upcoming alerts.</p></div><div class="reminders-header-actions"><button type="button" class="secondary reminders-view-toggle ${calendarMode?'active':''}" aria-pressed="${calendarMode}" onclick="toggleReminderView()">${svg(calendarMode?'table':'calendar')} ${calendarMode?'List View':'Calendar View'}</button><button class="primary reminders-primary-button" onclick="openReminderWizard()">${svg('plus')} New Reminder</button></div></div>
     ${otherVehicleRecordNotice('reminders','reminder')}
     ${calendarMode?calendarContent:listContent}
   </div>
   <aside class="reminders-side-column">
     <section class="card reminders-summary-card"><div class="documents-side-heading"><h3>Reminder Summary</h3><span class="info-icon">${svg('info')}</span></div><div class="reminder-summary-grid">${summaryCards.map(card=>`<div class="reminder-summary-box ${card.tone}"><strong>${card.value}</strong><span>${card.label}</span><small>${card.copy}</small></div>`).join('')}</div></section>
     <section class="card reminders-side-card"><div class="documents-side-heading"><h3>Notification Rules</h3></div><div class="notification-rule-list"><div><span class="rule-copy"><strong>Email Notifications</strong><small>Preference is stored locally; outbound mail delivery is not configured yet.</small></span><button type="button" class="toggle-pill ${state.notificationSettings.emailEnabled?'on':'off'}" ${canWrite()?'':'disabled'} onclick="toggleNotificationRule('email')">${state.notificationSettings.emailEnabled?'On':'Off'}</button></div><div><span class="rule-copy"><strong>Pop-up Alerts</strong><small>Reminder alerts appear in the GarageLog bell notification center.</small></span><button type="button" class="toggle-pill ${state.notificationSettings.localAlertsEnabled?'on':'off'}" ${canWrite()?'':'disabled'} onclick="toggleNotificationRule('local')">${state.notificationSettings.localAlertsEnabled?'On':'Off'}</button></div><button class="secondary manage-notification-button" onclick="openReminderWizard()">Create Reminder Rule</button></div></section>
     <section class="card reminders-side-card"><div class="section-title"><h3>${upcomingHeading}</h3><button class="link-button" onclick="goPage('Reminders')">View All</button></div><div class="upcoming-month-list">${upcomingList.map(item=>{const dueDate=parseReminderDate(item.due),dueLabel=dueDate?dueDate.toLocaleDateString('en-US',{month:'short',day:'numeric'}):String(item.due||'');return `<div><strong>${esc(dueLabel)}</strong><span><b>${esc(item.name)}</b><small>${esc(item.due||'')}</small></span><em>${esc(item.rule||'')}</em></div>`}).join('')||'<p class="muted">No upcoming reminders.</p>'}</div><button class="secondary full-width-button" onclick="openReminderWizard()">Add Reminder Rule</button></section>
     <section class="card reminders-side-card recent-activity-card"><div class="section-title"><h3>Recent Activity</h3><button class="link-button" onclick="goPage('Reminders')">View All</button></div><div class="recent-activity-list">${recentActivity.map(item=>`<div><span class="activity-icon ${item.tone}">${svg(item.icon)}</span><span><strong>${esc(item.title)}</strong><small>${esc(item.detail)}</small></span><em>${esc(item.meta)}</em></div>`).join('')||'<p class="muted">No reminder activity yet.</p>'}</div></section>
   </aside>
 </div>`}

function reportTemplateById(id=selectedReportTemplateId){return REPORT_TEMPLATES.find(item=>item.id===id)||REPORT_TEMPLATES[0]}
function reportRangeForCurrentVehicle(){const expenses=[...activeExpenses()],range=resolveExpenseDateRange(reportPeriod,reportCustomRange,expenses,new Date());reportPeriod=range.period;return range}
function currentUserSavedReports(){const userId=String(sessionUser()?.id||'');return (state.savedReports||[]).filter(item=>String(item.ownerUserId||'')===userId&&state.vehicles.some(vehicle=>String(vehicle.id)===String(item.vehicleId))).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')))}
function reportTemplateAvailability(id){return reportTemplateRangeAvailability(id,reportRangeForCurrentVehicle())}
function reportTemplateRangeAvailability(id,range=reportRangeForCurrentVehicle(),vehicleId=state.activeVehicleId){
 const expenses=expensesWithinRange(recordsFor('expenses',vehicleId),range),maintenance=recordsFor('maintenance',vehicleId),documents=recordsFor('documents',vehicleId),reminders=recordsFor('reminders',vehicleId),vehicle=state.vehicles.find(item=>String(item.id)===String(vehicleId))||activeVehicle(),mileage=reportMileageHistory(vehicle,range),fuelEntries=expenses.filter(item=>String(item.category||'').toLowerCase()==='fuel'),fuelPoints=fuelEconomyPoints(vehicleId).filter(point=>point.date>=range.start&&point.date<=range.end),serviceExpenses=expenses.filter(item=>['Maintenance','Repair','Parts'].includes(String(item.category)));
 const matchingRegistration=[...expenses,...documents,...reminders].filter(item=>/registration|insurance/i.test(`${item.category||''} ${item.name||''} ${item.notes||''}`));
 const map={
  'ownership-cost':{count:expenses.length,label:`expense transaction${expenses.length===1?'':'s'}`},
  'maintenance-history':{count:serviceExpenses.length,label:`completed service record${serviceExpenses.length===1?'':'s'}`},
  'maintenance-schedule':{count:maintenance.length,label:`scheduled maintenance item${maintenance.length===1?'':'s'}`},
  'fuel-efficiency':{count:fuelPoints.length,label:fuelPoints.length?`calculable MPG point${fuelPoints.length===1?'':'s'} from ${fuelEntries.length} fuel entr${fuelEntries.length===1?'y':'ies'}`:`fuel entr${fuelEntries.length===1?'y':'ies'}; no calculable MPG points`},
  'mileage-history':{count:mileage.length,label:`dated odometer reading${mileage.length===1?'':'s'}`},
  'tax-expense':{count:expenses.length,label:`expense record${expenses.length===1?'':'s'}`},
  'document-inventory':{count:documents.length,label:`stored document${documents.length===1?'':'s'}`},
  'registration-insurance':{count:matchingRegistration.length,label:`matching record${matchingRegistration.length===1?'':'s'}`},
  'vehicle-health':{count:maintenance.length+reminders.length,label:`tracked schedule${maintenance.length+reminders.length===1?'':'s'}`},
  'complete-vehicle':{count:expenses.length+maintenance.length+documents.length+reminders.length,label:`linked record${expenses.length+maintenance.length+documents.length+reminders.length===1?'':'s'}`}
 };
 return map[id]||{count:0,label:'records'}
}
function reportMileageHistory(vehicle,range){
 const vehicleId=vehicle?.id||state.activeVehicleId,all=odometerReadings(vehicleId).map(item=>({...item,source:item.source||'Recorded reading'})),today=new Date(),currentMileage=Number(vehicle?.mileage),inside=all.filter(item=>item.date>=range.start&&item.date<=range.end);
 if(today>=range.start&&today<=range.end&&Number.isFinite(currentMileage)){const last=inside.at(-1);if(!last||last.mileage!==currentMileage)inside.push({date:today,mileage:currentMileage,source:'Current odometer',kind:'current',recordId:'current'})}
 inside.sort((a,b)=>a.date-b.date||a.mileage-b.mileage);
 const before=all.filter(item=>item.date<range.start).at(-1),history=[...(before&&inside.length?[before]:[]),...inside];
 const deduped=[],keys=new Set();for(const item of history){const key=`${item.date.toISOString().slice(0,10)}|${item.mileage}`;if(keys.has(key))continue;keys.add(key);deduped.push(item)}return deduped
}
function reportTemplatesPage(){return `<div class="report-template-page"><div class="report-template-header"><div><button class="link-button report-back-link" onclick="closeReportTemplates()">${svg('chevronRight')} Back to Reports</button><h1>Report Templates</h1><p>Open a printable report using recorded GarageLog data. Templates show honest empty states when the required records are unavailable.</p></div><span class="report-template-count">${REPORT_TEMPLATES.length} templates</span></div><div class="report-template-grid">${REPORT_TEMPLATES.map(template=>{const availability=reportTemplateAvailability(template.id);return `<article class="card report-template-card"><span class="report-template-icon">${svg(template.icon)}</span><div class="report-template-copy"><h2>${esc(template.name)}</h2><p>${esc(template.description)}</p><div class="report-template-sources">${template.sources.map(source=>`<span>${esc(source)}</span>`).join('')}</div></div><div class="report-template-footer"><span><strong>${availability.count}</strong> ${esc(availability.label)}</span><button class="secondary" onclick="openReportTemplate('${template.id}')">Open Template</button></div></article>`}).join('')}</div></div>`}
window.openReportTemplates=function(){reportViewMode='templates';render()}
window.closeReportTemplates=function(){reportViewMode='dashboard';render()}
window.selectReportTemplate=function(id){selectedReportTemplateId=reportTemplateById(id).id;reportViewMode='dashboard';render()}
window.openReportTemplate=function(id){selectedReportTemplateId=reportTemplateById(id).id;reportViewMode='dashboard';render();requestAnimationFrame(()=>openSelectedReportTemplate())}
window.openSelectedReportTemplate=function(){const id=reportTemplateById().id;if(id==='ownership-cost'){window.printExpenseReport('selected');return}if(id==='tax-expense'){window.printExpenseReport('tax');return}if(id==='maintenance-history'){window.printServiceHistory();return}printGenericReportTemplate(id)}
window.saveReportSetupForTemplate=async function(id){selectedReportTemplateId=reportTemplateById(id).id;return window.saveCurrentReport()}
window.saveCurrentReport=async function(){if(!canWrite()){toast('Read-only accounts cannot save report setups');return}const template=reportTemplateById(),range=reportRangeForCurrentVehicle(),vehicle=activeVehicle(),expenses=expensesWithinRange(activeExpenses(),range),availability=reportTemplateRangeAvailability(template.id,range,vehicle.id),record={id:makeRecordId('saved-report'),ownerUserId:String(sessionUser()?.id||''),vehicleId:String(vehicle.id),templateId:template.id,templateName:template.name,name:`${template.name} — ${range.label}`,period:range.period,periodLabel:range.label,customRange:{...reportCustomRange},createdAt:new Date().toISOString(),createdBy:sessionUser()?.displayName||sessionUser()?.username||'Local user',summary:{expenseTotal:expenses.reduce((sum,item)=>sum+Number(item.amount||0),0),expenseCount:expenses.length,recordCount:availability.count,recordLabel:availability.label}};state.savedReports.unshift(record);try{await saveNow();toast('Report setup saved');render()}catch(err){state.savedReports=state.savedReports.filter(item=>item.id!==record.id);toast(err.message)}}
window.openSavedReport=function(id){const saved=(state.savedReports||[]).find(item=>item.id===id);if(!saved){toast('Saved report not found');return}const vehicle=state.vehicles.find(item=>String(item.id)===String(saved.vehicleId));if(!vehicle){toast('The saved report vehicle is no longer available');return}activateVehicle(vehicle.id,false);reportPeriod=saved.period||'this-year';reportCustomRange={...(saved.customRange||{start:'',end:''})};selectedReportTemplateId=reportTemplateById(saved.templateId).id;render();requestAnimationFrame(()=>openSelectedReportTemplate())}
window.deleteSavedReport=async function(id){if(!canWrite()){toast('Read-only accounts cannot delete saved reports');return}const index=state.savedReports.findIndex(item=>item.id===id);if(index<0)return;const [removed]=state.savedReports.splice(index,1);try{await saveNow();toast('Saved report removed');render()}catch(err){state.savedReports.splice(index,0,removed);toast(err.message)}}
function genericReportShell(title,period,body){const vehicle=activeVehicle(),popup=openCenteredWindow('','garageLogTemplateReport',1120,820);if(!popup){toast('Allow pop-ups to open the report');return}popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>GarageLog ${esc(title)}</title><link rel="icon" type="image/png" href="${APP_FAVICON_PATH}"><style>*{box-sizing:border-box}body{font-family:Segoe UI,Arial,sans-serif;margin:32px;color:#172033;font-size:12px;line-height:1.45}.actions{position:sticky;top:0;display:flex;justify-content:flex-end;gap:8px;background:white;padding:8px 0 14px;z-index:2}.actions button{padding:8px 12px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;cursor:pointer}.actions .primary{background:#2563eb;color:#fff;border-color:#2563eb}header{display:grid;grid-template-columns:minmax(0,1fr) 180px auto;gap:20px;align-items:center;border-bottom:3px solid #2563eb;padding-bottom:16px;margin-bottom:20px}.brand{font-size:17px;font-weight:800;color:#2563eb}h1{font-size:25px;margin:3px 0}.vehicle-photo{height:90px;border:1px solid #dbe3ee;border-radius:10px;display:grid;place-items:center;background:#f8fafc}.vehicle-photo img{max-width:100%;max-height:86px;object-fit:contain}.generated{text-align:right;color:#64748b}.meta{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px;margin-bottom:20px}.meta span{display:block;color:#64748b;font-size:9px;text-transform:uppercase}.meta strong{display:block;margin-top:4px}h2{font-size:16px;margin:24px 0 9px}.metric-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:14px 0}.metric{border:1px solid #dbe3ee;border-radius:9px;padding:12px}.metric span{display:block;color:#64748b;font-size:10px}.metric strong{display:block;font-size:19px;margin-top:4px}table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #e2e8f0;padding:9px;text-align:left;vertical-align:top}th{background:#f8fafc;color:#475569;font-size:10px}.amount{text-align:right}.status{font-weight:700}.empty{padding:24px;text-align:center;color:#64748b;border:1px dashed #cbd5e1;border-radius:10px}.footer{margin-top:26px;padding-top:10px;border-top:1px solid #e2e8f0;color:#64748b;font-size:10px}@media print{body{margin:0}.actions{display:none}}@media(max-width:760px){header,.meta,.metric-grid{grid-template-columns:1fr}.generated{text-align:left}}</style></head><body><div class="actions"><button onclick="window.close()">Close</button><button onclick="window.opener?.saveCurrentReport?.()">Save Report Setup</button><button class="primary" onclick="window.print()">Print / Save as PDF</button></div><header><div><div class="brand">GarageLog</div><h1>${esc(title)}</h1><p>${esc(vehicleFullName(vehicle))}</p></div><div class="vehicle-photo"><img src="${vehicleImageUrl(vehicle)}" alt="${esc(vehicleFullName(vehicle))}" onerror="this.onerror=null;this.src='${vehicleDefaultImageUrl(vehicle)}'"></div><div class="generated"><strong>${esc(period)}</strong><br>Generated ${new Date().toLocaleString()}</div></header><section class="meta"><div><span>Mileage</span><strong>${number(vehicle.mileage)} mi</strong></div><div><span>VIN</span><strong>${esc(vehicle.vin||'Not entered')}</strong></div><div><span>Engine</span><strong>${esc(vehicle.engine||'Not entered')}</strong></div><div><span>Drivetrain</span><strong>${esc(vehicle.drivetrain||'Not entered')}</strong></div><div><span>Powertrain</span><strong>${esc(vehicle.powertrain||'Not entered')}</strong></div></section>${body}<div class="footer">Private local report generated by GarageLog. Values reflect accessible, user-entered records.</div></body></html>`);popup.document.close();popup.focus()}
function printGenericReportTemplate(id){const template=reportTemplateById(id),range=reportRangeForCurrentVehicle(),expenses=expensesWithinRange(activeExpenses(),range),maintenance=activeMaintenance(),documents=activeDocuments(),reminders=activeReminders(),vehicle=activeVehicle();let body='';
 if(id==='maintenance-schedule'){const rows=maintenance.map(item=>{const meta=mileageScheduleMeta(item);return `<tr><td>${esc(item.name)}</td><td>${esc(item.interval||item.rule||'—')}</td><td>${esc(item.due||'—')}</td><td>${meta?`${number(Math.max(0,meta.remaining))} mi`:esc(item.progress||'—')}</td><td class="status">${esc(effectiveMaintenanceStatus(item))}</td></tr>`}).join('');body=`<h2>Maintenance Schedule</h2>${rows?`<table><thead><tr><th>Item</th><th>Interval</th><th>Next Due</th><th>Remaining</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`:'<div class="empty">No maintenance schedules are recorded.</div>'}`}
 else if(id==='fuel-efficiency'){const fuel=expenses.filter(item=>String(item.category)==='Fuel'),points=fuelEconomyPoints().filter(point=>point.date>=range.start&&point.date<=range.end),total=fuel.reduce((sum,item)=>sum+Number(item.amount||0),0),avg=points.length?points.reduce((sum,item)=>sum+item.value,0)/points.length:null;const rows=fuel.map(item=>`<tr><td>${esc(item.date)}</td><td>${esc(item.vendor||'—')}</td><td>${item.gallons?`${Number(item.gallons).toFixed(2)} gal`:'—'}</td><td>${item.odometer?`${number(item.odometer)} mi`:'—'}</td><td>${item.mpg?`${Number(item.mpg).toFixed(1)} MPG`:'—'}</td><td class="amount">${money(item.amount)}</td></tr>`).join('');body=`<div class="metric-grid"><div class="metric"><span>Fuel Spend</span><strong>${money(total)}</strong></div><div class="metric"><span>Fuel Entries</span><strong>${fuel.length}</strong></div><div class="metric"><span>Average MPG</span><strong>${avg?avg.toFixed(1):'—'}</strong></div></div><h2>Fuel Entries</h2>${rows?`<table><thead><tr><th>Date</th><th>Vendor</th><th>Gallons</th><th>Odometer</th><th>MPG</th><th class="amount">Amount</th></tr></thead><tbody>${rows}</tbody></table>`:'<div class="empty">No fuel entries exist in this period.</div>'}`}
 else if(id==='mileage-history'){const points=reportMileageHistory(vehicle,range),change=points.length>=2?Math.max(0,points.at(-1).mileage-points[0].mileage):null,rows=points.map(item=>`<tr><td>${item.date.toLocaleDateString()}</td><td>${esc(item.source)}</td><td class="amount">${number(item.mileage)} mi</td></tr>`).join('');body=`<div class="metric-grid"><div class="metric"><span>First Reading</span><strong>${points.length?`${number(points[0].mileage)} mi`:'—'}</strong></div><div class="metric"><span>Latest Reading</span><strong>${points.length?`${number(points.at(-1).mileage)} mi`:'—'}</strong></div><div class="metric"><span>Recorded Change</span><strong>${change===null?'—':`${number(change)} mi`}</strong></div></div><h2>Dated Odometer Readings</h2>${rows?`<table><thead><tr><th>Date</th><th>Source</th><th class="amount">Odometer</th></tr></thead><tbody>${rows}</tbody></table>`:'<div class="empty">No dated odometer readings exist in this period.</div>'}`}
 else if(id==='document-inventory'){const rows=documents.map(item=>`<tr><td>${esc(item.name)}</td><td>${esc(item.category||'—')}</td><td>${esc((item.tags||[]).join(', ')||'—')}</td><td>${esc(item.size||'—')}</td><td>${esc(item.expiresOn||'—')}</td><td>${esc(item.ocrStatus||'not indexed')}</td></tr>`).join('');body=`<div class="metric-grid"><div class="metric"><span>Documents</span><strong>${documents.length}</strong></div><div class="metric"><span>Searchable</span><strong>${documents.filter(item=>item.ocrStatus==='indexed').length}</strong></div><div class="metric"><span>Expiring</span><strong>${documents.filter(item=>item.expiresOn).length}</strong></div></div><h2>Stored Documents</h2>${rows?`<table><thead><tr><th>Name</th><th>Category</th><th>Tags</th><th>Size</th><th>Expires</th><th>Search Status</th></tr></thead><tbody>${rows}</tbody></table>`:'<div class="empty">No documents are stored for this vehicle.</div>'}`}
 else if(id==='registration-insurance'){const matches=[...expenses.map(item=>({...item,kind:'Expense',title:item.category,detail:item.vendor||item.notes,date:item.date})),...documents.map(item=>({...item,kind:'Document',title:item.name,detail:item.category,date:item.addedAt||item.date})),...reminders.map(item=>({...item,kind:'Reminder',title:item.name,detail:item.rule,date:item.due}))].filter(item=>/registration|insurance/i.test(`${item.title||''} ${item.detail||''}`));const rows=matches.map(item=>`<tr><td>${esc(item.kind)}</td><td>${esc(item.title||'—')}</td><td>${esc(item.detail||'—')}</td><td>${esc(item.date||'—')}</td><td>${item.amount?money(item.amount):esc(item.status||'—')}</td></tr>`).join('');body=`<h2>Registration & Insurance Records</h2>${rows?`<table><thead><tr><th>Type</th><th>Record</th><th>Details</th><th>Date / Due</th><th>Amount / Status</th></tr></thead><tbody>${rows}</tbody></table>`:'<div class="empty">No registration or insurance records were found.</div>'}`}
 else if(id==='vehicle-health'){const rows=[...maintenance.map(item=>({type:'Maintenance',name:item.name,due:item.due,status:effectiveMaintenanceStatus(item)})),...reminders.map(item=>({type:'Reminder',name:item.name,due:item.due,status:effectiveReminderStatus(item)}))].sort((a,b)=>String(a.status).localeCompare(String(b.status))).map(item=>`<tr><td>${esc(item.type)}</td><td>${esc(item.name)}</td><td>${esc(item.due||'—')}</td><td class="status">${esc(item.status)}</td></tr>`).join('');const overdue=[...maintenance.filter(item=>effectiveMaintenanceStatus(item)==='Overdue'),...reminders.filter(item=>effectiveReminderStatus(item)==='Overdue')].length,dueSoon=[...maintenance.filter(item=>effectiveMaintenanceStatus(item)==='Due Soon'),...reminders.filter(item=>effectiveReminderStatus(item)==='Due Soon')].length;body=`<div class="metric-grid"><div class="metric"><span>Overdue</span><strong>${overdue}</strong></div><div class="metric"><span>Due Soon</span><strong>${dueSoon}</strong></div><div class="metric"><span>Total Tracked</span><strong>${maintenance.length+reminders.length}</strong></div></div><h2>Health & Schedule Status</h2>${rows?`<table><thead><tr><th>Type</th><th>Item</th><th>Due</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`:'<div class="empty">No maintenance or reminder schedules are recorded.</div>'}`}
 else if(id==='complete-vehicle'){const total=activeExpenses().reduce((sum,item)=>sum+Number(item.amount||0),0),overdue=maintenance.filter(item=>effectiveMaintenanceStatus(item)==='Overdue').length+reminders.filter(item=>effectiveReminderStatus(item)==='Overdue').length;body=`<div class="metric-grid"><div class="metric"><span>Recorded Expenses</span><strong>${money(total)}</strong></div><div class="metric"><span>Linked Records</span><strong>${activeExpenses().length+maintenance.length+documents.length+reminders.length}</strong></div><div class="metric"><span>Overdue Items</span><strong>${overdue}</strong></div></div><h2>Record Summary</h2><table><tbody><tr><th>Expenses</th><td>${activeExpenses().length}</td></tr><tr><th>Maintenance</th><td>${maintenance.length}</td></tr><tr><th>Reminders</th><td>${reminders.length}</td></tr><tr><th>Documents</th><td>${documents.length}</td></tr><tr><th>Mileage readings</th><td>${(vehicle.mileageHistory||[]).length}</td></tr></tbody></table>`}
 genericReportShell(template.name,range.label,body)}

function reports(){
 if(reportViewMode==='templates')return reportTemplatesPage();
 const expenses=[...activeExpenses()].sort((a,b)=>(parseRecordDate(b.date)?.getTime()||0)-(parseRecordDate(a.date)?.getTime()||0));
 const vehicle=activeVehicle(),now=new Date(),template=reportTemplateById();
 const periodOptions=expensePeriodOptions(expenses,{includeRolling:true,includeCustom:true});
 const selectedRange=resolveExpenseDateRange(reportPeriod,reportCustomRange,expenses,now);reportPeriod=selectedRange.period;
 const scopedExpenses=expensesWithinRange(expenses,selectedRange);
 const templateAvailability=reportTemplateRangeAvailability(template.id,selectedRange,vehicle.id);
 const sum=list=>list.reduce((total,item)=>total+Number(item?.amount||0),0);
 const totalSpend=sum(scopedExpenses),maintenanceExpenseCategories=['Maintenance','Repair','Parts'];
 const maintenanceSpend=sum(scopedExpenses.filter(item=>maintenanceExpenseCategories.includes(String(item.category||''))));
 const fuelSpend=sum(scopedExpenses.filter(item=>String(item.category||'')==='Fuel'));
 const otherSpend=Math.max(0,totalSpend-maintenanceSpend-fuelSpend);
 const allFuelPoints=fuelEconomyPoints(),reportFuelPoints=allFuelPoints.filter(point=>point.date>=selectedRange.start&&point.date<=selectedRange.end);
 const storedAverageMpg=Number(state.metrics?.averageMpg||vehicle.metrics?.averageMpg||0);
 const averageMpg=reportFuelPoints.length?reportFuelPoints.reduce((total,point)=>total+point.value,0)/reportFuelPoints.length:0;
 const reportFuelAxis=fuelAxisModel(reportFuelPoints),reportFuelChart={width:760,height:190,left:44,right:720,top:14,bottom:145};
 reportFuelChart.plotHeight=reportFuelChart.bottom-reportFuelChart.top;
 const reportFuelY=value=>reportFuelChart.bottom-((value-reportFuelAxis.min)/(reportFuelAxis.max-reportFuelAxis.min))*reportFuelChart.plotHeight;
 const reportFuelStep=reportFuelPoints.length>1?(reportFuelChart.right-reportFuelChart.left)/(reportFuelPoints.length-1):0;
 const reportFuelX=index=>reportFuelPoints.length===1?(reportFuelChart.left+reportFuelChart.right)/2:reportFuelChart.left+index*reportFuelStep;
 const reportFuelLinePoints=reportFuelPoints.map((point,index)=>`${reportFuelX(index)},${reportFuelY(point.value)}`).join(' ');
 const reportCategory=value=>maintenanceExpenseCategories.includes(String(value||''))?'maintenance':String(value||'')==='Fuel'?'fuel':'other';
 const monthSpan=(selectedRange.end.getFullYear()-selectedRange.start.getFullYear())*12+selectedRange.end.getMonth()-selectedRange.start.getMonth()+1;
 let spendBuckets=[];
 if(monthSpan<=24){
  const raw=buildExpenseMonthBuckets(scopedExpenses,selectedRange,['maintenance','fuel','other'],reportCategory);
  spendBuckets=raw.map(bucket=>({...bucket,displayLabel:`${bucket.label}${selectedRange.start.getFullYear()!==selectedRange.end.getFullYear()?` '${String(bucket.year).slice(-2)}`:''}`}));
 }else{
  for(let year=selectedRange.start.getFullYear();year<=selectedRange.end.getFullYear();year++)spendBuckets.push({key:String(year),label:String(year),displayLabel:String(year),year,values:{maintenance:0,fuel:0,other:0},total:0});
  const byYear=new Map(spendBuckets.map(bucket=>[bucket.year,bucket]));
  scopedExpenses.forEach(item=>{const date=parseRecordDate(item.date),bucket=date?byYear.get(date.getFullYear()):null;if(!bucket)return;const amount=Number(item.amount||0),category=reportCategory(item.category);bucket.values[category]+=amount;bucket.total+=amount});
 }
 const niceReportAxis=value=>{if(value<=0)return 100;if(value<=100)return Math.ceil(value/25)*25;if(value<=500)return Math.ceil(value/100)*100;if(value<=1000)return Math.ceil(value/250)*250;const magnitude=10**Math.floor(Math.log10(value));return Math.ceil(value/(magnitude/2))*(magnitude/2)};
 const maxMonthly=niceReportAxis(Math.max(0,...spendBuckets.map(bucket=>bucket.total))),spendTicks=[maxMonthly,maxMonthly*.75,maxMonthly*.5,maxMonthly*.25,0];
 const breakdownColors={Maintenance:'#2563eb',Repair:'#f97316',Parts:'#7c3aed'};
 const maintenanceBreakdown=maintenanceExpenseCategories.map(category=>{const matching=scopedExpenses.filter(item=>String(item.category||'')===category),value=sum(matching);return{label:category,value,count:matching.length,average:matching.length?value/matching.length:0,color:breakdownColors[category]}}).filter(item=>item.value>0);
 let donutCursor=0;
 const donutStops=maintenanceBreakdown.map(item=>{const start=donutCursor;donutCursor+=maintenanceSpend?item.value/maintenanceSpend*100:0;return `${item.color} ${start.toFixed(2)}% ${donutCursor.toFixed(2)}%`});
 const donutBackground=donutStops.length?`conic-gradient(${donutStops.join(',')})`:'#e2e8f0';
 const mileagePoints=reportMileageHistory(vehicle,selectedRange),milesDriven=mileagePoints.length>=2?Math.max(0,mileagePoints.at(-1).mileage-mileagePoints[0].mileage):0,costPerMile=milesDriven>0?totalSpend/milesDriven:null;
 const mileageChart={width:760,height:210,left:82,right:720,top:18,bottom:155},mileageValues=mileagePoints.map(point=>point.mileage),mileageMin=mileageValues.length?Math.min(...mileageValues):0,mileageMax=mileageValues.length?Math.max(...mileageValues):1,mileageSpan=Math.max(1,mileageMax-mileageMin);
 const mileageX=index=>mileagePoints.length===1?(mileageChart.left+mileageChart.right)/2:mileageChart.left+index*((mileageChart.right-mileageChart.left)/Math.max(1,mileagePoints.length-1));
 const mileageY=value=>mileageChart.bottom-((value-mileageMin)/mileageSpan)*(mileageChart.bottom-mileageChart.top);
 const mileageLinePoints=mileagePoints.map((point,index)=>`${mileageX(index)},${mileageY(point.mileage)}`).join(' ');
 const mileageAreaPath=mileagePoints.length>=2?`M ${mileageX(0)} ${mileageChart.bottom} L ${mileagePoints.map((point,index)=>`${mileageX(index)} ${mileageY(point.mileage)}`).join(' L ')} L ${mileageX(mileagePoints.length-1)} ${mileageChart.bottom} Z`:'';
 const mileageTicks=Array.from({length:5},(_,index)=>mileageMax-(mileageSpan*(index/4)));
 const categoryOrder=['Maintenance','Repair','Parts','Fuel','Insurance','Registration','Other'];
 const categoryTotals=categoryOrder.map(category=>({category,value:sum(scopedExpenses.filter(item=>String(item.category||'Other')===category))})).filter(item=>item.value>0).sort((a,b)=>b.value-a.value);
 const topCategory=categoryTotals[0]||null,mostExpensiveBucket=[...spendBuckets].sort((a,b)=>b.total-a.total)[0]||null,expenseDates=scopedExpenses.map(item=>parseRecordDate(item.date)).filter(Boolean).sort((a,b)=>a-b),insights=[];
 if(topCategory)insights.push(['green',`${topCategory.category} is the largest category in this period at ${money(topCategory.value)}.`]);
 if(mostExpensiveBucket?.total>0)insights.push(['purple',`${mostExpensiveBucket.displayLabel} is the highest-spend period at ${money(mostExpensiveBucket.total)}.`]);
 if(reportFuelPoints.length>=2)insights.push(['orange',`Fuel economy changed ${(reportFuelPoints.at(-1).value-reportFuelPoints[0].value)>=0?'+':''}${(reportFuelPoints.at(-1).value-reportFuelPoints[0].value).toFixed(1)} MPG across the selected period.`]);else if(reportFuelPoints.length===1)insights.push(['orange',`One MPG point is available (${reportFuelPoints[0].value.toFixed(1)} MPG). Add another full-tank fuel entry to create a trend.`]);else insights.push(['orange','No calculable fuel-economy points exist in the selected period.']);
 if(expenseDates.length)insights.push(['blue',`${scopedExpenses.length} transaction${scopedExpenses.length===1?'':'s'} recorded from ${expenseDates[0].toLocaleDateString()} through ${expenseDates.at(-1).toLocaleDateString()}.`]);else insights.push(['blue','No expenses are recorded in the selected period.']);
 const kpiCards=[
  ['green','dollar','Total Spend',money(totalSpend),`${scopedExpenses.length} transaction${scopedExpenses.length===1?'':'s'}`],
  ['blue','wrench','Maintenance Spend',money(maintenanceSpend),`${totalSpend?((maintenanceSpend/totalSpend)*100).toFixed(1):'0.0'}% of period total`],
  ['orange','fuel','Fuel Spend',money(fuelSpend),`${totalSpend?((fuelSpend/totalSpend)*100).toFixed(1):'0.0'}% of period total`],
  ['purple','chart','Cost Per Tracked Mile',optionalMoney(costPerMile),milesDriven?`Between ${mileagePoints.length} dated readings`:'At least two readings required'],
  ['teal','gauge','Average MPG',averageMpg?averageMpg.toFixed(1):'—',reportFuelPoints.length?`${reportFuelPoints.length} calculable fuel point${reportFuelPoints.length===1?'':'s'}${reportFuelPoints.some(point=>point.provisional)?' · includes odometer-baseline estimate':''}`:storedAverageMpg?'Stored average excluded without matching dated entries':'No calculable fuel entries'],
  ['blue-outline','gauge','Recorded Mileage Change',milesDriven?number(milesDriven):'—',milesDriven?`${mileagePoints[0].date.toLocaleDateString()} – ${mileagePoints.at(-1).date.toLocaleDateString()}`:'Not enough dated readings']
 ];
 const saved=currentUserSavedReports();
 const headerActions=`<div class="reports-header-actions"><button class="secondary" onclick="openReportTemplates()">${svg('table')} View Templates</button>${canWrite()?`<button class="secondary" onclick="saveCurrentReport()">${svg('archive')} Save Report Setup</button>`:''}<button class="primary reports-export-button" onclick="openSelectedReportTemplate()">${svg('external')} Open ${esc(template.name)}</button></div>`;
 const spendChart={width:760,height:225,left:62,right:734,top:18,bottom:170},spendPlotHeight=spendChart.bottom-spendChart.top,spendStep=(spendChart.right-spendChart.left)/Math.max(1,spendBuckets.length),spendBarWidth=Math.min(38,Math.max(12,spendStep*.58)),spendY=value=>spendChart.bottom-(Number(value||0)/Math.max(1,maxMonthly))*spendPlotHeight,spendLabelEvery=spendBuckets.length>18?3:spendBuckets.length>10?2:1;
 const spendChartHtml=scopedExpenses.length&&spendBuckets.length?`<div class="report-spend-chart-wrap"><svg viewBox="0 0 ${spendChart.width} ${spendChart.height}" role="img" aria-label="Spend trend shown as stacked bars for maintenance, fuel, and other expenses">${spendTicks.map(value=>{const y=spendY(value);return `<g class="report-spend-grid"><line x1="${spendChart.left}" y1="${y}" x2="${spendChart.right}" y2="${y}"/><text x="${spendChart.left-10}" y="${y+4}" text-anchor="end">${money(value).replace('.00','')}</text></g>`}).join('')}<line class="report-spend-axis" x1="${spendChart.left}" y1="${spendChart.bottom}" x2="${spendChart.right}" y2="${spendChart.bottom}"/>${spendBuckets.map((bucket,index)=>{const center=spendChart.left+spendStep*(index+.5),x=center-spendBarWidth/2;let cursor=spendChart.bottom;const segments=[];for(const category of ['maintenance','fuel','other']){const value=Number(bucket.values[category]||0);if(value<=0)continue;const height=value/Math.max(1,maxMonthly)*spendPlotHeight;cursor-=height;segments.push(`<rect class="report-spend-segment ${category}" x="${x}" y="${cursor}" width="${spendBarWidth}" height="${height}"><title>${esc(bucket.displayLabel)} · ${category[0].toUpperCase()+category.slice(1)}: ${money(value)}</title></rect>`)}const totalLabel=bucket.total>0&&spendBuckets.length<=14?`<text class="report-spend-total" x="${center}" y="${Math.max(12,cursor-6)}" text-anchor="middle">${money(bucket.total).replace('.00','')}</text>`:'';const xLabel=index%spendLabelEvery===0||index===spendBuckets.length-1?`<text class="report-spend-label" x="${center}" y="${spendChart.bottom+25}" text-anchor="middle">${esc(bucket.displayLabel)}</text>`:'';return `<g><title>${esc(bucket.displayLabel)} total: ${money(bucket.total)}</title>${segments.join('')}${totalLabel}${xLabel}</g>`}).join('')}</svg></div>`:`<div class="report-chart-empty"><strong>No spending data in this period</strong><p>Choose another range to review backdated expenses.</p></div>`;
 const maintenanceExpenseCount=maintenanceBreakdown.reduce((count,item)=>count+item.count,0);
 const maintenanceHtml=maintenanceBreakdown.length?`<div class="reports-donut-layout refined"><div class="reports-donut" style="background:${donutBackground}"><span><strong>${money(maintenanceSpend)}</strong><small>${maintenanceExpenseCount} expense${maintenanceExpenseCount===1?'':'s'}</small></span></div><div class="reports-breakdown-list refined">${maintenanceBreakdown.map(item=>`<div class="reports-breakdown-row"><div class="breakdown-row-heading"><span><i style="background:${item.color}"></i>${esc(item.label)}</span><b>${money(item.value)}</b></div><div class="breakdown-progress"><span style="width:${maintenanceSpend?(item.value/maintenanceSpend)*100:0}%;background:${item.color}"></span></div><small>${item.count} expense${item.count===1?'':'s'} · ${money(item.average)} average · ${maintenanceSpend?((item.value/maintenanceSpend)*100).toFixed(1):'0.0'}%</small></div>`).join('')}</div></div>`:`<div class="report-chart-empty"><strong>No maintenance expenses in this period</strong><p>Maintenance, repair, and parts expenses will appear here using their entered dates.</p></div>`;
 const fuelHtml=reportFuelPoints.length?`<div class="line-chart-wrap fuel-report-chart"><svg viewBox="0 0 ${reportFuelChart.width} ${reportFuelChart.height}" role="img" aria-label="Fuel economy trend for the selected report period">${reportFuelAxis.ticks.map(value=>{const y=reportFuelY(value);return `<g class="fuel-grid-row"><line x1="${reportFuelChart.left}" y1="${y}" x2="${reportFuelChart.right}" y2="${y}"/><text x="${reportFuelChart.left-8}" y="${y+4}" text-anchor="end">${Number.isInteger(value)?value:value.toFixed(1)}</text></g>`}).join('')}${reportFuelPoints.length>1?`<polyline class="trend-line" points="${reportFuelLinePoints}"/>`:''}<g class="trend-dots">${reportFuelPoints.map((point,index)=>`<circle cx="${reportFuelX(index)}" cy="${reportFuelY(point.value)}" r="4"><title>${esc(point.label)}: ${point.value.toFixed(1)} MPG${point.provisional?' · provisional odometer baseline':''}</title></circle>`).join('')}</g>${reportFuelPoints.map((point,index)=>{if(reportFuelPoints.length>7&&index!==0&&index!==reportFuelPoints.length-1&&index%2!==0)return'';return `<text class="fuel-x-label" x="${reportFuelX(index)}" y="${reportFuelChart.bottom+27}" text-anchor="${index===0&&reportFuelPoints.length>1?'start':index===reportFuelPoints.length-1&&reportFuelPoints.length>1?'end':'middle'}">${esc(point.label)}</text>`}).join('')}</svg></div>`:`<div class="report-chart-empty"><strong>No calculable MPG points in this period</strong><p>Add a full-tank fuel entry with gallons and an odometer. A prior odometer reading can establish the first provisional point; the next full-tank entry creates a tank-to-tank trend.</p></div>`;
 const mileageHtml=mileagePoints.length>=2?`<div class="mileage-report-metrics"><span><small>Start</small><strong>${number(mileagePoints[0].mileage)} mi</strong></span><span><small>Latest</small><strong>${number(mileagePoints.at(-1).mileage)} mi</strong></span><span><small>Readings</small><strong>${mileagePoints.length}</strong></span></div><div class="line-chart-wrap mileage"><svg viewBox="0 0 ${mileageChart.width} ${mileageChart.height}" role="img" aria-label="Recorded odometer history for the selected period"><defs><linearGradient id="reportAreaFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b82f6" stop-opacity=".20"/><stop offset="1" stop-color="#3b82f6" stop-opacity="0"/></linearGradient></defs>${mileageTicks.map(value=>{const y=mileageY(value);return `<g class="mileage-grid-row"><line x1="${mileageChart.left}" y1="${y}" x2="${mileageChart.right}" y2="${y}"/><text x="${mileageChart.left-10}" y="${y+4}" text-anchor="end">${number(Math.round(value))}</text></g>`}).join('')}<path class="mileage-area" d="${mileageAreaPath}" fill="url(#reportAreaFill)"/><polyline class="trend-line" points="${mileageLinePoints}"/><g class="trend-dots">${mileagePoints.map((point,index)=>`<circle cx="${mileageX(index)}" cy="${mileageY(point.mileage)}" r="4"><title>${point.date.toLocaleDateString()}: ${number(point.mileage)} mi · ${esc(point.source)}</title></circle>`).join('')}</g>${mileagePoints.map((point,index)=>{if(mileagePoints.length>6&&index!==0&&index!==mileagePoints.length-1&&index%2!==0)return'';return `<text class="fuel-x-label" x="${mileageX(index)}" y="${mileageChart.bottom+28}" text-anchor="${index===0?'start':index===mileagePoints.length-1?'end':'middle'}">${esc(point.date.toLocaleDateString('en-US',{month:'short',year:'2-digit'}))}</text>`}).join('')}</svg></div>`:`<div class="report-chart-empty"><strong>Not enough mileage history in this period</strong><p>At least two dated odometer readings inside the selected period are required. GarageLog does not estimate missing mileage.</p></div>`;
 let savedHtml=`<div class="report-empty-history"><strong>No saved report setups yet</strong><p>Choose a template and period, then save the setup for quick reopening. Printable PDF files are created from the report window.</p></div>`;
 if(saved.length){
  const rows=saved.map(item=>{const savedVehicle=state.vehicles.find(vehicle=>String(vehicle.id)===String(item.vehicleId));return `<tr><td><div class="report-name-cell"><span class="report-file-icon pdf">${svg(reportTemplateById(item.templateId).icon)}</span><span><strong>${esc(item.templateName||reportTemplateById(item.templateId).name)}</strong><small>${esc(item.createdBy||'Local user')}</small></span></div></td><td>${esc(savedVehicle?vehicleFullName(savedVehicle):'Unavailable vehicle')}</td><td>${esc(item.periodLabel||item.period||'Saved range')}</td><td>${new Date(item.createdAt).toLocaleString()}</td><td><div class="saved-report-actions"><button class="mini-btn" onclick="openSavedReport('${item.id}')">Open</button>${canWrite()?`<button class="mini-btn delete" onclick="deleteSavedReport('${item.id}')">Delete</button>`:''}</div></td></tr>`}).join('');
  savedHtml=`<div class="reports-table-scroll"><table class="reports-table"><thead><tr><th>Report</th><th>Vehicle</th><th>Period</th><th>Saved</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
 }
 const libraryHtml=REPORT_TEMPLATES.slice(0,6).map(item=>`<button onclick="openReportTemplate('${item.id}')"><span>${svg(item.icon)}<strong>${esc(item.name)}</strong></span><em>›</em></button>`).join('');
 const insightHtml=insights.map(item=>`<div><span class="activity-icon ${item[0]}">${svg(item[0]==='green'?'chart':item[0]==='orange'?'fuel':item[0]==='purple'?'wrench':'gauge')}</span><p>${esc(item[1])}</p></div>`).join('');
 return `<div class="reports-page-grid">
  <div class="reports-main-column">
   <div class="reports-page-header"><div><h1>Reports</h1><p>Insights and printable reports based only on recorded GarageLog data.</p></div>${headerActions}</div>
   <div class="reports-range-control card"><div><strong>${esc(template.name)}</strong><small>${esc(selectedRange.label)} · ${templateAvailability.count} ${esc(templateAvailability.label)}</small></div><label class="select-shell"><select id="reportPeriodSelect" class="dashboard-range-select" onchange="setReportPeriod(this.value)">${periodOptions.map(([value,label])=>`<option value="${value}" ${reportPeriod===value?'selected':''}>${esc(label)}</option>`).join('')}</select></label></div>
   <div class="reports-kpi-grid">${kpiCards.map(card=>`<article class="card reports-kpi-card"><span class="reports-kpi-icon ${card[0]}">${svg(card[1])}</span><div><small>${card[2]}</small><strong>${card[3]}</strong><em>${card[4]}</em></div></article>`).join('')}</div>
   <div class="reports-chart-grid">
    <section class="card reports-chart-card monthly-spend-card"><div class="section-title"><h3>Spend Trend</h3><strong class="chart-summary">${esc(selectedRange.label)}</strong></div><div class="reports-chart-content">${spendChartHtml}<div class="stacked-legend"><span><i class="maintenance"></i>Maintenance ${money(maintenanceSpend)}</span><span><i class="fuel"></i>Fuel ${money(fuelSpend)}</span><span><i class="other"></i>Other ${money(otherSpend)}</span></div></div></section>
    <section class="card reports-chart-card maintenance-breakdown-card"><div class="section-title"><h3>Maintenance Expense Breakdown</h3><strong class="chart-summary">${maintenanceExpenseCount} maintenance-related expense${maintenanceExpenseCount===1?'':'s'} ${reportPeriodSummarySuffix(reportPeriod,selectedRange)}</strong></div>${maintenanceHtml}</section>
    <section class="card reports-chart-card line-chart-card"><div class="section-title"><h3>Fuel Economy Trend (MPG)</h3><strong class="chart-summary">${averageMpg?`${averageMpg.toFixed(1)} avg`:'No data'}</strong></div>${fuelHtml}</section>
    <section class="card reports-chart-card line-chart-card mileage-report-card"><div class="section-title"><h3>Mileage Accumulation</h3><strong class="chart-summary">${milesDriven?`${number(milesDriven)} mi recorded`:'No range data'}</strong></div>${mileageHtml}</section>
   </div>
   <section class="card saved-reports-card"><div class="section-title saved-reports-heading"><div><h3>Saved Report Setups</h3><p>These are reusable template, vehicle, and date-range selections. Use Print / Save as PDF inside an opened report to create a fixed file.</p></div>${canWrite()?`<button class="link-button" onclick="saveCurrentReport()">Save current setup</button>`:''}</div>${savedHtml}</section>
  </div>
  <aside class="reports-side-column">
   <section class="card reports-side-card"><div class="documents-side-heading"><h3>Report Library</h3></div><div class="reports-library-list">${libraryHtml}<button class="link-button side-link-button" onclick="openReportTemplates()">View All Templates</button></div></section>
   <section class="card reports-side-card"><div class="documents-side-heading"><h3>Selected Template</h3></div><div class="reports-export-box"><div class="report-export-row"><span class="report-file-icon pdf">${svg(template.icon)}</span><span><strong>${esc(template.name)}</strong><small>${esc(selectedRange.label)} · ${templateAvailability.count} ${esc(templateAvailability.label)}</small></span></div><button class="secondary report-download-button" onclick="openSelectedReportTemplate()">${svg('external')} <span>Open Printable Report</span></button>${canWrite()?`<button class="secondary report-download-button subtle" onclick="saveCurrentReport()">${svg('archive')} <span>Save Report Setup</span></button>`:''}</div></section>
   <section class="card reports-side-card"><div class="documents-side-heading"><h3>Key Insights</h3></div><div class="reports-insight-list">${insightHtml}</div></section>
  </aside>
 </div>`;
}

function syncDocumentsListHeight(){
 const page=document.querySelector('.documents-page-grid'),table=page?.querySelector('.documents-table-card');
 if(!page||!table)return;
 if(window.innerWidth<=1120){table.style.removeProperty('height');return}
 const main=page.querySelector('.documents-main-column'),side=page.querySelector('.documents-side-column');
 if(!main||!side)return;
 table.style.height='520px';
 requestAnimationFrame(()=>{
  const mainHeight=main.getBoundingClientRect().height,tableHeight=table.getBoundingClientRect().height,sideHeight=side.getBoundingClientRect().height;
  const nonTableHeight=Math.max(0,mainHeight-tableHeight),desired=Math.max(360,Math.min(680,Math.round(sideHeight-nonTableHeight)));
  table.style.height=`${desired}px`;
 });
}
function syncExpensesListHeight(){
 const page=document.querySelector('.expenses-page'),table=page?.querySelector('.expense-table-card');
 if(!page||!table)return;
 if(window.innerWidth<=1180){table.style.removeProperty('height');return}
 const main=page.querySelector('.expense-main-column'),side=page.querySelector('.expense-side-column');
 if(!main||!side)return;
 table.style.height='560px';
 requestAnimationFrame(()=>{
  const mainHeight=main.getBoundingClientRect().height,tableHeight=table.getBoundingClientRect().height,sideHeight=side.getBoundingClientRect().height;
  const nonTableHeight=Math.max(0,mainHeight-tableHeight),desired=Math.max(360,Math.min(720,Math.round(sideHeight-nonTableHeight)));
  table.style.height=`${desired}px`;
 });
}
function syncReminderCalendarHeight(){
 const page=document.querySelector('.reminders-page-grid.calendar-view-mode');
 if(!page)return;
 const calendarGrid=page.querySelector('.reminder-calendar-grid'),unscheduled=page.querySelector('.reminder-unscheduled-card'),recent=page.querySelector('.recent-activity-card');
 if(!calendarGrid||!unscheduled||!recent)return;
 if(window.innerWidth<=980){calendarGrid.style.removeProperty('--reminder-calendar-row-height');return}
 const days=[...calendarGrid.querySelectorAll('.reminder-calendar-day')];
 if(!days.length)return;
 calendarGrid.style.setProperty('--reminder-calendar-row-height','129px');
 const adjust=()=>{
  const currentHeight=days[0].getBoundingClientRect().height||129;
  const difference=unscheduled.getBoundingClientRect().bottom-recent.getBoundingClientRect().bottom;
  if(Math.abs(difference)<=1)return;
  const nextHeight=Math.max(62,Math.min(150,currentHeight-difference/6));
  calendarGrid.style.setProperty('--reminder-calendar-row-height',`${nextHeight.toFixed(2)}px`);
 };
 requestAnimationFrame(()=>{adjust();requestAnimationFrame(adjust)});
}
function accessDescription(user=sessionUser()){
 if(!user)return'';const write=user.accessLevel==='ReadOnly'?'Read only':'Read and write';const visibility=user.visibilityScope==='SelectedVehicles'?`${user.assignedVehicleIds?.length||0} assigned vehicle${(user.assignedVehicleIds?.length||0)===1?'':'s'}`:'All vehicles';return`${write} · ${visibility}`
}
function managedUserEditor(){if(!managedUserEditorOpen)return'';const existing=managedUsers.find(user=>user.id===managedUserEditorId),user=existing||{role:'User',accessLevel:'ReadWrite',visibilityScope:'AllVehicles',assignedVehicleIds:[],isActive:true};const selected=new Set(user.assignedVehicleIds||[]);const passwordFields=existing?`<div class="account-password-reset full"><div><strong>Reset password</strong><small>Leave these fields blank to keep the current password.</small></div><div class="account-password-reset-grid"><label>New password<input name="password" type="password" minlength="12" maxlength="128" autocomplete="new-password"></label><label>Confirm new password<input name="confirmPassword" type="password" minlength="12" maxlength="128" autocomplete="new-password"></label></div></div>`:`<label>Initial password<input name="password" type="password" minlength="12" maxlength="128" required autocomplete="new-password"></label><label>Confirm initial password<input name="confirmPassword" type="password" minlength="12" maxlength="128" required autocomplete="new-password"></label>`;return `<section class="card account-editor-card"><div class="account-section-heading"><div><h2>${existing?'Edit user':'Add user'}</h2><p>${existing?'Update account identity, access, visibility, or reset the password.':'Create another local GarageLog account.'}</p></div><button type="button" class="secondary" onclick="closeManagedUserEditor()">Cancel</button></div><form class="managed-user-form" onsubmit="saveManagedUser(event)"><div class="account-form-grid"><label>Display name<input name="displayName" maxlength="80" required value="${esc(user.displayName||'')}"></label><label>Username<input name="username" minlength="3" maxlength="40" pattern="[A-Za-z0-9._-]{3,40}" required value="${esc(user.username||'')}"></label>${passwordFields}<label>Role<select name="role" onchange="syncManagedUserAccessFields(this.form)"><option value="User" ${user.role==='User'?'selected':''}>Regular user</option><option value="Administrator" ${user.role==='Administrator'?'selected':''}>Administrator</option></select></label><label>Permission<select name="accessLevel"><option value="ReadWrite" ${user.accessLevel==='ReadWrite'?'selected':''}>Read and write</option><option value="ReadOnly" ${user.accessLevel==='ReadOnly'?'selected':''}>Read only</option></select></label><label>Visibility<select name="visibilityScope" onchange="syncManagedUserAccessFields(this.form)"><option value="AllVehicles" ${user.visibilityScope==='AllVehicles'?'selected':''}>All vehicles</option><option value="SelectedVehicles" ${user.visibilityScope==='SelectedVehicles'?'selected':''}>Selected vehicles</option></select></label><label class="account-active-check"><input name="isActive" type="checkbox" ${user.isActive!==false?'checked':''}><span>Account active</span></label></div><fieldset class="vehicle-access-fieldset"><legend>Visible vehicles</legend><p>Selected-vehicle users only receive these vehicles and their linked maintenance, expenses, reminders, and documents from the server.</p><div class="vehicle-access-grid">${state.vehicles.map(vehicle=>`<label><input type="checkbox" name="assignedVehicleIds" value="${esc(vehicle.id)}" ${selected.has(vehicle.id)?'checked':''}><span>${esc(vehicleFullName(vehicle))}</span></label>`).join('')||'<span class="muted">No vehicles are available.</span>'}</div></fieldset><div class="account-form-actions"><button class="primary" type="submit">${existing?'Save user':'Create user'}</button></div></form></section>`}
function userManagementSection(){if(!isAdministrator())return'';return `<section class="account-admin-section"><div class="account-section-heading"><div><h2>User management</h2><p>Create local users and control write access and vehicle visibility.</p></div><button class="primary" type="button" onclick="openManagedUserEditor()">${svg('plus')} Add User</button></div>${managedUsersLoading?'<div class="card account-loading">Loading users…</div>':`<div class="account-user-list">${managedUsers.map(user=>`<article class="card account-user-row"><div class="account-user-identity">${profileAvatarMarkup(user,false)}<span><strong>${esc(user.displayName)}</strong><small>@${esc(user.username)}</small></span></div><div class="account-user-badges"><span class="badge ${user.role==='Administrator'?'purple':'blue'}">${esc(user.role)}</span><span class="badge ${user.accessLevel==='ReadOnly'?'orange':'green'}">${user.accessLevel==='ReadOnly'?'Read only':'Read & write'}</span><span class="badge ${user.isActive?'green':'red'}">${user.isActive?'Active':'Disabled'}</span></div><div class="account-user-scope"><strong>${user.visibilityScope==='SelectedVehicles'?'Selected vehicles':'All vehicles'}</strong><small>${user.visibilityScope==='SelectedVehicles'?`${user.assignedVehicleIds?.length||0} assigned`:'Full fleet visibility'}</small></div><div class="account-user-actions"><button class="secondary" type="button" onclick="openManagedUserEditor('${user.id}')">Edit account</button></div></article>`).join('')||'<div class="card empty">No users found.</div>'}</div>`}${managedUserEditor()}</section>`}
function profileSettings(){
 const user=sessionUser();
 if(!user)return'<div class="card"><h2>Profile unavailable</h2></div>';
 return `<div class="account-settings-page"><div class="account-page-header"><div><span class="account-eyebrow">GARAGELOG ACCOUNT</span><h1>Profile & Access</h1><p>Manage your local identity, sign-in security, and account privileges.</p></div><span class="account-access-summary">${esc(accessDescription(user))}</span></div><section class="account-primary-grid"><article class="card account-profile-card"><div class="account-photo-column">${profileAvatarMarkup(user,true)}<label class="secondary account-photo-button">Upload photo<input type="file" accept="image/png,image/jpeg,image/webp" onchange="uploadProfileImage(this)" hidden></label>${user.profileImageUrl?'<button class="link-button" type="button" onclick="removeProfileImage()">Remove photo</button>':''}</div><form class="account-details-form" onsubmit="saveProfileSettings(event)"><div><h2>Profile details</h2><p>This name and photo appear in the GarageLog header.</p></div><label>Display name<input name="displayName" maxlength="80" value="${esc(user.displayName)}" required></label><label>Username<input name="username" minlength="3" maxlength="40" pattern="[A-Za-z0-9._-]{3,40}" value="${esc(user.username)}" required><small>Letters, numbers, periods, underscores, and hyphens only.</small></label><button class="primary" type="submit">Save profile</button></form></article><article class="card account-security-card"><div><h2>Password</h2><p>Changing your password signs out any older browser sessions for this account.</p></div><form onsubmit="changeProfilePassword(event)"><label>Current password<input name="currentPassword" type="password" autocomplete="current-password" required></label><label>New password<input name="newPassword" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></label><label>Confirm new password<input name="confirmPassword" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></label><button class="primary" type="submit">Change password</button></form></article></section><section class="card account-access-card"><div class="account-section-heading"><div><h2>Your access</h2><p>Permissions are enforced by the GarageLog server, not only hidden in the interface.</p></div></div><div class="account-access-grid"><div><span>Role</span><strong>${esc(user.role)}</strong></div><div><span>Permission</span><strong>${user.accessLevel==='ReadOnly'?'Read only':'Read and write'}</strong></div><div><span>Visibility</span><strong>${user.visibilityScope==='SelectedVehicles'?'Selected vehicles':'All vehicles'}</strong></div><div><span>Last sign-in</span><strong>${user.lastLoginUtc?new Date(user.lastLoginUtc).toLocaleString():'Current setup session'}</strong></div></div></section>${userManagementSection()}</div>`
}
window.openProfilePage=async function(){setProfileMenu(false);clearTopSearch();current='Profile';currentFilter='All';render();if(isAdministrator())await refreshManagedUsers()}
window.openSettingsPage=async function(){setProfileMenu(false);clearTopSearch();current='Settings';currentFilter='All';try{await refreshSettingsData()}catch(error){toast(error.message||'Unable to load Settings')}render()}
window.saveProfileSettings=async function(event){event.preventDefault();const form=event.currentTarget,button=form.querySelector('button[type=submit]'),fd=new FormData(form);button.disabled=true;try{const user=await authRequest('/api/profile',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName:fd.get('displayName'),username:fd.get('username')})});authSession.user=user;updateProfileChrome();toast('Profile updated');render()}catch(err){toast(err.message)}finally{button.disabled=false}}
window.changeProfilePassword=async function(event){event.preventDefault();const form=event.currentTarget,fd=new FormData(form),button=form.querySelector('button[type=submit]');if(fd.get('newPassword')!==fd.get('confirmPassword')){toast('The new passwords do not match');return}button.disabled=true;try{await authRequest('/api/profile/password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({currentPassword:fd.get('currentPassword'),newPassword:fd.get('newPassword')})});form.reset();toast('Password changed')}catch(err){toast(err.message)}finally{button.disabled=false}}
window.uploadProfileImage=async function(input){const file=input.files?.[0];if(!file)return;const data=new FormData();data.append('file',file);try{authSession.user=await authRequest('/api/profile/image',{method:'POST',body:data});updateProfileChrome();toast('Profile picture updated');render()}catch(err){toast(err.message)}finally{input.value=''}}
window.removeProfileImage=async function(){try{authSession.user=await authRequest('/api/profile/image',{method:'DELETE'});updateProfileChrome();toast('Profile picture removed');render()}catch(err){toast(err.message)}}
window.refreshManagedUsers=async function(){if(!isAdministrator())return;managedUsersLoading=true;if(current==='Profile')render();try{managedUsers=await authRequest('/api/admin/users')}catch(err){toast(err.message)}finally{managedUsersLoading=false;if(current==='Profile')render()}}
window.openManagedUserEditor=function(id=null){managedUserEditorId=id;managedUserEditorOpen=true;render();requestAnimationFrame(()=>document.querySelector('.account-editor-card')?.scrollIntoView({behavior:'smooth',block:'start'}))}
window.closeManagedUserEditor=function(){managedUserEditorOpen=false;managedUserEditorId=null;render()}
window.syncManagedUserAccessFields=function(form){const admin=form.elements.role.value==='Administrator',selected=form.elements.visibilityScope.value==='SelectedVehicles';form.elements.accessLevel.disabled=admin;form.elements.visibilityScope.disabled=admin;const field=form.querySelector('.vehicle-access-fieldset');field.hidden=admin||!selected}
window.saveManagedUser=async function(event){event.preventDefault();const form=event.currentTarget,fd=new FormData(form),existing=managedUsers.find(user=>user.id===managedUserEditorId),password=String(fd.get('password')||''),confirmPassword=String(fd.get('confirmPassword')||''),payload={displayName:fd.get('displayName'),username:fd.get('username'),role:fd.get('role'),accessLevel:fd.get('accessLevel')||'ReadWrite',visibilityScope:fd.get('visibilityScope')||'AllVehicles',assignedVehicleIds:fd.getAll('assignedVehicleIds'),isActive:fd.get('isActive')==='on'};if(payload.role!=='Administrator'&&payload.visibilityScope==='SelectedVehicles'&&!payload.assignedVehicleIds.length){toast('Assign at least one visible vehicle');return}if(password!==confirmPassword){toast('The passwords do not match');return}if(!existing&&!password){toast('Enter an initial password');return}if(password&&password.length<12){toast('Password must be at least 12 characters');return}if(!existing)payload.password=password;const button=form.querySelector('button[type=submit]');button.disabled=true;try{await authRequest(existing?`/api/admin/users/${encodeURIComponent(existing.id)}`:'/api/admin/users',{method:existing?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});if(existing&&password)await authRequest(`/api/admin/users/${encodeURIComponent(existing.id)}/reset-password`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({newPassword:password})});managedUserEditorOpen=false;managedUserEditorId=null;const session=await authRequest('/api/auth/session');if(session.authenticated)authSession=session;toast(existing?(password?'User and password updated':'User updated'):'User created');if(isAdministrator())await refreshManagedUsers();else{managedUsers=[];render()}updateProfileChrome()}catch(err){toast(err.message)}finally{button.disabled=false}}
function notificationSettings(){return state?.notificationSettings||{emailEnabled:false,localAlertsEnabled:true,readIds:[],dismissedIds:[]}}
function buildNotificationItems(){if(!state)return[];const settings=notificationSettings(),items=[],now=new Date(),push=item=>items.push({...item,id:String(item.id),createdAt:item.createdAt||now.toISOString()}),taskKey=item=>`${String(item.vehicleId||'').toLowerCase()}|${String(item.name||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()}`,notifiedTaskKeys=new Set();
 for(const notice of state.systemNotices||[]){if(notice.active===false)continue;push({type:'system',tone:notice.tone||'blue',icon:notice.icon||'info',title:notice.title,detail:notice.detail||'GarageLog system notice.',page:notice.page||'Dashboard',recordId:notice.recordId||'',createdAt:notice.createdAt,id:notice.id})}
 if(availableUpdate?.updateAvailable)push({id:updateNoticeId(),type:'system',tone:'indigo',icon:'download',title:`GarageLog ${availableUpdate.latestVersion} is available`,detail:availableUpdate.releaseName||'View release notes and download the latest version from GitHub.',page:'Dashboard',url:availableUpdate.releaseUrl||'',createdAt:availableUpdate.publishedAtUtc||now.toISOString()})
 if(settings.localAlertsEnabled){for(const item of state.reminders||[]){const status=effectiveReminderStatus(item);if(!['Overdue','Due Soon'].includes(status)||status==='Completed')continue;const vehicle=state.vehicles.find(vehicle=>String(vehicle.id)===String(item.vehicleId));notifiedTaskKeys.add(taskKey(item));push({id:`reminder:${item.id}:${status}`,type:'reminder',tone:status==='Overdue'?'red':'orange',icon:'bell',title:`${item.name} — ${status}`,detail:`${vehicle?vehicleFullName(vehicle):'Vehicle'} · ${item.due||item.rule||'Schedule due'}`,page:'Reminders',recordId:item.id,createdAt:item.updatedAt||item.createdAt||now.toISOString()})}
  const linkedMaintenanceIds=new Set((state.reminders||[]).map(item=>String(item.maintenanceId||'')).filter(Boolean)),linkedReminderIds=new Set((state.maintenance||[]).map(item=>String(item.reminderId||'')).filter(Boolean));for(const item of state.maintenance||[]){if(linkedMaintenanceIds.has(String(item.id))||linkedReminderIds.has(String(item.reminderId||''))||notifiedTaskKeys.has(taskKey(item)))continue;const status=effectiveMaintenanceStatus(item);if(!['Overdue','Due Soon'].includes(status))continue;const vehicle=state.vehicles.find(vehicle=>String(vehicle.id)===String(item.vehicleId));notifiedTaskKeys.add(taskKey(item));push({id:`maintenance:${item.id}:${status}`,type:'maintenance',tone:status==='Overdue'?'red':'orange',icon:'wrench',title:`${item.name} — ${status}`,detail:`${vehicle?vehicleFullName(vehicle):'Vehicle'} · ${item.due||item.interval||'Service due'}`,page:'Maintenance',recordId:item.id,createdAt:item.updatedAt||item.createdAt||now.toISOString()})}}
 const docs=state.documents||[],ocrAttention=docs.filter(item=>['needs-ocr','setup-required','failed','index-failed'].includes(String(item.ocrStatus||'').toLowerCase()));if(ocrAttention.length)push({id:`system:ocr:${ocrAttention.length}`,type:'system',tone:'orange',icon:'search',title:`${ocrAttention.length} document${ocrAttention.length===1?' needs':'s need'} search attention`,detail:'Open Documents to review OCR or indexing status.',page:'Documents'});
 for(const item of docs){const expires=parseRecordDate(item.expiresOn);if(!expires)continue;const days=Math.ceil((expires-now)/86400000);if(days>30)continue;push({id:`document-expiry:${item.id}:${item.expiresOn}`,type:'system',tone:days<0?'red':'orange',icon:'file',title:days<0?`${item.name} expired`:`${item.name} expires soon`,detail:days<0?`${Math.abs(days)} day${Math.abs(days)===1?'':'s'} overdue`:`${days} day${days===1?'':'s'} remaining`,page:'Documents',recordId:item.id,createdAt:item.updatedAt||item.addedAt||now.toISOString()})}
 if(settings.emailEnabled)push({id:'system:email-not-configured',type:'system',tone:'blue',icon:'info',title:'Email notification preference is on',detail:'Outbound email delivery still requires a mail-server configuration in a future update.',page:'Reminders'});
 const dismissed=new Set(settings.dismissedIds||[]),severity={red:0,orange:1,blue:2,green:3};return items.filter(item=>!dismissed.has(item.id)).sort((a,b)=>(severity[a.tone]??9)-(severity[b.tone]??9)||String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,40)}
function renderNotificationCenter(){const panel=document.getElementById('notificationPanel'),badge=document.getElementById('notificationCount'),trigger=document.getElementById('notificationIcon');if(!panel||!badge||!trigger||!state)return;const settings=notificationSettings(),read=new Set(settings.readIds||[]),items=buildNotificationItems(),unread=items.filter(item=>!read.has(item.id)).length;badge.hidden=unread===0;badge.textContent=unread>99?'99+':String(unread);trigger.classList.toggle('has-unread',unread>0);trigger.setAttribute('aria-expanded',notificationPanelOpen?'true':'false');panel.hidden=!notificationPanelOpen;panel.innerHTML=`<div class="notification-panel-header"><div><strong>Notifications</strong><small>${unread} unread · ${items.length} total</small></div>${items.length?`<div class="notification-header-actions"><button class="link-button" onclick="markAllNotificationsRead()">Mark all read</button>${canWrite()?`<button class="link-button clear" onclick="clearAllNotifications()">Clear all</button>`:''}</div>`:''}</div><div class="notification-panel-settings"><span class="${settings.localAlertsEnabled?'on':'off'}">Pop-up alerts ${settings.localAlertsEnabled?'on':'off'}</span><span class="${settings.emailEnabled?'on':'off'}">Email preference ${settings.emailEnabled?'on':'off'}</span></div><div class="notification-list">${items.length?items.map(item=>`<button class="notification-item ${read.has(item.id)?'read':'unread'}" onclick="openGarageNotification(${attrJs(item.id)},${attrJs(item.page)},${attrJs(item.recordId||'')},${attrJs(item.url||'')})"><span class="notification-item-icon ${item.tone}">${svg(item.icon)}</span><span><strong>${esc(item.title)}</strong><small>${esc(item.detail)}</small></span>${!read.has(item.id)?'<i aria-label="Unread"></i>':''}</button>`).join(''):`<div class="notification-empty">${svg('bell')}<strong>No active notifications</strong><p>Due reminders and local system tasks will appear here.</p></div>`}</div><div class="notification-panel-footer"><button class="secondary" onclick="goPage('Reminders');closeNotificationPanel()">Notification Settings</button></div>`}
window.toggleNotificationPanel=function(){notificationPanelOpen=!notificationPanelOpen;setProfileMenu(false);renderNotificationCenter()}
window.closeNotificationPanel=function(){notificationPanelOpen=false;renderNotificationCenter()}
window.markAllNotificationsRead=async function(){const settings=notificationSettings();settings.readIds=[...new Set([...settings.readIds,...buildNotificationItems().map(item=>item.id)])].slice(-250);renderNotificationCenter();if(canWrite())try{await saveNow()}catch(err){toast(err.message)}}
window.clearAllNotifications=async function(){if(!canWrite()){toast('Read-only accounts cannot clear notifications');return}const items=buildNotificationItems();if(!items.length)return;const settings=notificationSettings(),ids=new Set(items.map(item=>item.id));settings.dismissedIds=[...new Set([...(settings.dismissedIds||[]),...ids])].slice(-500);settings.readIds=(settings.readIds||[]).filter(id=>!ids.has(id));state.systemNotices=(state.systemNotices||[]).filter(notice=>!ids.has(String(notice.id)));renderNotificationCenter();try{await saveNow();toast('Notifications cleared')}catch(err){toast(err.message)}}
window.openGarageNotification=async function(id,page,recordId,url){const settings=notificationSettings();if(!settings.readIds.includes(id))settings.readIds.push(id);notificationPanelOpen=false;clearTopSearch();current=page||'Dashboard';currentFilter='All';render();if(canWrite())try{await saveNow()}catch{};if(url){window.open(url,'_blank','noopener,noreferrer');return}requestAnimationFrame(()=>{if(recordId){const target=document.querySelector(`[data-record-id="${CSS.escape(recordId)}"]`);target?.scrollIntoView({behavior:'smooth',block:'center'})}})}
window.toggleNotificationRule=async function(kind){if(!canWrite()){toast('Read-only accounts cannot change notification rules');return}const settings=notificationSettings();if(kind==='email')settings.emailEnabled=!settings.emailEnabled;else settings.localAlertsEnabled=!settings.localAlertsEnabled;const enabled=kind==='email'?settings.emailEnabled:settings.localAlertsEnabled;try{await saveNow();toast(`${kind==='email'?'Email preference':'Pop-up alerts'} ${enabled?'enabled':'disabled'}`);render()}catch(err){toast(err.message)}}
function applyPermissionUi(){if(canWrite())return;document.querySelectorAll('[data-action],button[onclick]').forEach(button=>{const action=button.dataset.action||button.getAttribute('onclick')||'';if(button.dataset.action||/openModal|openReminderWizard|editRecord|deleteRecord|deleteReminder|markReminder|duplicateReminder|addVehicleRecord|archiveVehicle|deleteVehicle|makeVehicleActive|upload|removeVehicleImage|openExpenseDeleteConfirm|indexAllDocuments|indexDocumentRecord|openDocumentFolderManager|saveDocumentFolder|deleteDocumentFolder|openDocumentShare|createDocumentShare|revokeDocumentShare|finishFirstRunSetup|clearAllNotifications|saveExpenseBudgetSettings|saveRecurringExpensePlan|deleteRecurringExpensePlan/i.test(action)){button.classList.add('permission-disabled');button.setAttribute('aria-disabled','true');button.title='Read-only account'}})}
function render(){
 if(!state)return;
 applyAppearanceSettings();
 if(!(state.vehicles||[]).length){document.body.classList.add('garage-setup-active');content.innerHTML=firstRunSetupPage();updateProfileChrome();renderNotificationCenter();return}
 document.body.classList.remove('garage-setup-active');renderNav();
 document.getElementById('sidebarMileage').textContent=number(state.mileage)+' mi';
 document.getElementById('sidebarVehicleName').textContent=state.vehicle?.name||vehicleFullName();
 document.getElementById('sidebarVehicleTrim').textContent=state.vehicle?.trim||'';
 document.getElementById('sidebarVehicleEngine').textContent=state.vehicle?.engine||'';
 const sidebarImage=document.getElementById('sidebarVehicleImage');sidebarImage.src=vehicleImageUrl();sidebarImage.onerror=()=>{sidebarImage.onerror=null;sidebarImage.src=vehicleDefaultImageUrl()};
 const page=({Dashboard:dashboard,Garage:garage,Maintenance:maintenance,Expenses:expenses,Documents:documents,Reminders:reminders,Reports:reports,Profile:profileSettings,Settings:settingsPage})[current]||dashboard;content.innerHTML=(['Profile','Settings'].includes(current)?'':permissionNotice())+updateAvailableBanner()+page();updateProfileChrome();applySearch();applyPermissionUi();if(current==='Documents')requestAnimationFrame(()=>requestAnimationFrame(syncDocumentsListHeight));if(current==='Expenses')requestAnimationFrame(()=>requestAnimationFrame(syncExpensesListHeight));if(current==='Reminders'&&reminderViewMode==='calendar')requestAnimationFrame(()=>requestAnimationFrame(syncReminderCalendarHeight));if(current==='Profile')requestAnimationFrame(()=>{const form=document.querySelector('.managed-user-form');if(form)syncManagedUserAccessFields(form)});renderNotificationCenter();
}
window.goPage=p=>{clearTopSearch();current=p;currentFilter='All';if(p==='Reports')reportViewMode='dashboard';render()}
window.openVehicleRecords=async function(vehicleId,page){closeRecordModal();clearTopSearch();activateVehicle(String(vehicleId),false);current=page;currentFilter='All';if(canWrite())await saveNow();render()}
window.setFilter=f=>{currentFilter=f;render()}
window.toggleExpenseView=()=>{expenseViewMode=expenseViewMode==='budget'?'expenses':'budget';currentFilter='All';editingRecurringExpenseId=null;render()}
window.openExpenseBudgetView=()=>{expenseViewMode='budget';editingRecurringExpenseId=null;current='Expenses';currentFilter='All';render()}
window.saveExpenseBudgetSettings=async function(event,form){event?.preventDefault();if(!canWrite()){toast('Read-only accounts cannot change budget settings');return}const fd=new FormData(form),monthlyBudget=Number(fd.get('monthlyBudget')||0),alertPercent=Number(fd.get('alertPercent')||85);if(!Number.isFinite(monthlyBudget)||monthlyBudget<0){toast('Enter a valid monthly budget');return}const categoryBudgets={};for(const category of ['Insurance','Fuel','Maintenance','Registration','Parts','Other']){const value=Number(fd.get(`categoryBudget-${category}`)||0);if(!Number.isFinite(value)||value<0){toast(`Enter a valid ${category} budget`);return}categoryBudgets[category]=value}state.expenseSettings={...(state.expenseSettings||{}),monthlyBudget,alertPercent,rollover:fd.get('rollover')==='on',categoryBudgets,recurringItems:Array.isArray(state.expenseSettings?.recurringItems)?state.expenseSettings.recurringItems:[]};try{await saveNow();toast('Budget settings saved');render()}catch(err){toast(err.message)}}
window.editRecurringExpensePlan=function(id){editingRecurringExpenseId=String(id);expenseViewMode='budget';current='Expenses';render();requestAnimationFrame(()=>document.querySelector('.recurring-plan-form')?.scrollIntoView({behavior:'smooth',block:'center'}))}
window.cancelRecurringExpenseEdit=function(){editingRecurringExpenseId=null;render()}
window.saveRecurringExpensePlan=async function(event,form){event?.preventDefault();if(!canWrite()){toast('Read-only accounts cannot change recurring plans');return}const fd=new FormData(form),name=String(fd.get('name')||'').trim(),amount=Number(fd.get('amount')||0),category=String(fd.get('category')||'Other'),frequency=String(fd.get('frequency')||'Monthly'),nextDate=String(fd.get('nextDate')||'');if(!name){toast('Enter a recurring expense name');return}if(!Number.isFinite(amount)||amount<=0){toast('Enter an amount greater than zero');return}state.expenseSettings=state.expenseSettings||{};const items=Array.isArray(state.expenseSettings.recurringItems)?state.expenseSettings.recurringItems:[];const existing=items.find(item=>item.id===editingRecurringExpenseId);if(existing)Object.assign(existing,{name,amount,category,frequency,nextDate,updatedAt:new Date().toISOString()});else items.unshift({id:makeRecordId('recurring-expense'),vehicleId:state.activeVehicleId,name,amount,category,frequency,nextDate,createdAt:new Date().toISOString()});state.expenseSettings.recurringItems=items;editingRecurringExpenseId=null;try{await saveNow();toast(existing?'Recurring plan updated':'Recurring plan added');render()}catch(err){toast(err.message)}}
window.deleteRecurringExpensePlan=async function(id){if(!canWrite()){toast('Read-only accounts cannot change recurring plans');return}const items=Array.isArray(state.expenseSettings?.recurringItems)?state.expenseSettings.recurringItems:[],index=items.findIndex(item=>item.id===id);if(index<0)return;const [removed]=items.splice(index,1);if(editingRecurringExpenseId===id)editingRecurringExpenseId=null;try{await saveNow();toast('Recurring plan removed');render()}catch(err){items.splice(index,0,removed);toast(err.message)}}
window.toggleReminderView=()=>{reminderViewMode=reminderViewMode==='calendar'?'list':'calendar';render()}
window.openReminderCalendar=()=>{const today=new Date();reminderViewMode='calendar';reminderCalendarCursor=new Date(today.getFullYear(),today.getMonth(),1,12);current='Reminders';currentFilter='All';render()}
window.shiftReminderCalendar=offset=>{reminderCalendarCursor=new Date(reminderCalendarCursor.getFullYear(),reminderCalendarCursor.getMonth()+Number(offset||0),1,12);render()}
window.showReminderCalendarToday=()=>{const today=new Date();reminderCalendarCursor=new Date(today.getFullYear(),today.getMonth(),1,12);render()}
window.setGarageFilter=f=>{currentGarageFilter=f;render()}
window.setGarageSort=s=>{currentGarageSort=s;render()}
window.setReportPeriod=p=>changeExpenseChartPeriod(p,'report')
window.setDashboardExpenseRange=v=>changeExpenseChartPeriod(v,'dashboard')
window.setDashboardFuelRange=v=>{if(v==='custom'){const months=Math.min(24,Math.max(1,Number(prompt('How many recent months should the custom fuel view include?','6'))||dashboardFuelCustom.months));const label=(prompt('Custom range label','Custom Range')||dashboardFuelCustom.label).trim()||'Custom Range';dashboardFuelCustom={label,months};}dashboardFuelRange=v;render()}
window.openVehicleDashboard=id=>{const vehicle=state.vehicles.find(item=>item.id===id);if(!vehicle||isVehicleArchived(vehicle)){toast('Archived vehicles cannot be opened as the active dashboard');return}activateVehicle(id,false);current='Dashboard';if(canWrite())save('Active vehicle changed');render()}
window.makeVehicleActive=id=>{const vehicle=state.vehicles.find(item=>item.id===id);if(!vehicle||isVehicleArchived(vehicle)){toast('Sold or decommissioned vehicles cannot be made active');return}activateVehicle(id,false);current='Garage';save('Active vehicle changed');render()}
window.addVehicleRecord=id=>{const vehicle=state.vehicles.find(item=>item.id===id);if(!vehicle||isVehicleArchived(vehicle)){toast('Archived vehicles cannot receive new maintenance records');return}activateVehicle(id,false);openModal('service')}
window.changeExpenseChartPeriod=(value,target='monthly')=>{
 const config={
   monthly:{period:expenseChartPeriod,range:expenseCustomRange,selectId:'expenseChartPeriod',title:'Custom Monthly Spending Range',subtitle:'Choose the transaction dates shown in Monthly Spending.'},
   category:{period:expenseCategoryPeriod,range:expenseCategoryCustomRange,selectId:'expenseCategoryPeriod',title:'Custom Category Range',subtitle:'Choose the transaction dates shown in Spending by Category.'},
   dashboard:{period:dashboardExpenseRange,range:dashboardExpenseCustomRange,selectId:'dashboardExpensePeriod',title:'Custom Dashboard Expense Range',subtitle:'Choose the transaction dates shown in the dashboard Expenses Overview.'},
   report:{period:reportPeriod,range:reportCustomRange,selectId:'reportPeriodSelect',title:'Custom Report Range',subtitle:'Choose the transaction dates used throughout the Reports page and printable selected-period report.'}
 }[target]||null;
 if(!config)return;
 if(value==='custom'){
   const select=config.selectId?document.getElementById(config.selectId):null;if(select)select.value=config.period;
   expenseRangeTarget=target;
   const modal=document.getElementById('expenseRangeModal');
   const defaultEnd=config.range.end||new Date().toISOString().slice(0,10);
   const defaultStart=config.range.start||(()=>{const date=new Date();date.setMonth(date.getMonth()-5);date.setDate(1);return date.toISOString().slice(0,10)})();
   document.getElementById('expenseRangeStart').value=defaultStart;
   document.getElementById('expenseRangeEnd').value=defaultEnd;
   const title=document.getElementById('expenseRangeTitle');if(title)title.textContent=config.title;
   const subtitle=document.getElementById('expenseRangeSubtitle');if(subtitle)subtitle.textContent=config.subtitle;
   modal.showModal();return;
 }
 if(target==='category')expenseCategoryPeriod=value;
 else if(target==='dashboard')dashboardExpenseRange=value;
 else if(target==='report')reportPeriod=value;
 else expenseChartPeriod=value;
 render();
}


const VEHICLE_POWERTRAINS=['Gasoline / Internal Combustion','Diesel / Internal Combustion','Hybrid','Plug-in Hybrid','Electric (EV)'];
const VEHICLE_TEMPLATE_CATALOG=[
 {key:'tire-pressure',group:'Essential care',name:'Check Tire Pressure',description:'Monthly pressure and visible-damage check.',target:'maintenance',months:1,recommended:true,powertrains:['all'],checklist:['Check tire pressures when the tires are cold','Set pressure to the vehicle or tire placard specification','Inspect tread and sidewalls for cuts, cracks, bulges, or embedded objects','Inspect valve stems and replace missing valve caps','Record any repeated pressure loss for leak diagnosis']},
 {key:'tire-rotation',group:'Essential care',name:'Tire Rotation',description:'Promotes even tread wear and longer tire life.',target:'maintenance',miles:7500,recommended:true,powertrains:['all']},
 {key:'brake-inspection',group:'Essential care',name:'Brake Inspection',description:'Inspect pads, rotors, hoses, and braking performance.',target:'maintenance',miles:12000,recommended:true,powertrains:['all']},
 {key:'wiper-inspection',group:'Essential care',name:'Inspect Wipers and Washer System',description:'Check blade condition, washer fluid, and spray pattern.',target:'maintenance',months:6,recommended:true,powertrains:['all'],checklist:['Inspect wiper blades for cracking, splitting, or streaking','Test front and rear washers where equipped','Fill washer fluid with a seasonally appropriate product','Verify washer nozzles spray the intended windshield area','Inspect wiper arms for looseness or damage']},
 {key:'battery-test',group:'Essential care',name:'Battery and Charging Test',description:'Test the 12-volt battery and charging system.',target:'maintenance',months:12,recommended:true,powertrains:['all'],checklist:['Inspect the battery case and hold-down','Inspect terminals and cables for corrosion or looseness','Test resting voltage and battery condition','Test charging-system voltage where applicable','Record battery age and replacement date']},
 {key:'recall-check',group:'Essential care',name:'Check Open Recalls',description:'Review manufacturer safety recalls twice each year.',target:'reminder',months:6,recommended:true,powertrains:['all']},
 {key:'oil-filter',group:'Powertrain care',name:'Oil & Filter Change',description:'Default interval; replace with the manufacturer schedule.',target:'maintenance',miles:7500,recommended:true,powertrains:['Gasoline / Internal Combustion','Diesel / Internal Combustion','Hybrid','Plug-in Hybrid']},
 {key:'engine-air-filter',group:'Powertrain care',name:'Engine Air Filter',description:'Inspect or replace the engine intake filter.',target:'maintenance',miles:15000,recommended:true,powertrains:['Gasoline / Internal Combustion','Diesel / Internal Combustion','Hybrid','Plug-in Hybrid']},
 {key:'coolant-service',group:'Powertrain care',name:'Coolant Service',description:'Inspect coolant condition and cooling-system protection.',target:'maintenance',months:60,recommended:false,powertrains:['Gasoline / Internal Combustion','Diesel / Internal Combustion','Hybrid','Plug-in Hybrid','Electric (EV)']},
 {key:'transmission-service',group:'Powertrain care',name:'Transmission Service',description:'Fluid and filter interval; verify manufacturer guidance.',target:'maintenance',miles:60000,recommended:false,powertrains:['Gasoline / Internal Combustion','Diesel / Internal Combustion','Hybrid','Plug-in Hybrid']},
 {key:'spark-plugs',group:'Powertrain care',name:'Spark Plug Service',description:'Inspect or replace spark plugs at the specified interval.',target:'maintenance',miles:100000,recommended:false,powertrains:['Gasoline / Internal Combustion','Hybrid','Plug-in Hybrid']},
 {key:'diesel-fuel-filter',group:'Diesel care',name:'Diesel Fuel Filter',description:'Replace the diesel fuel filter and drain water separator.',target:'maintenance',miles:15000,recommended:true,powertrains:['Diesel / Internal Combustion']},
 {key:'def-check',group:'Diesel care',name:'Check DEF Level',description:'Monthly diesel exhaust fluid level and quality check.',target:'maintenance',months:1,recommended:true,powertrains:['Diesel / Internal Combustion'],checklist:['Review the DEF level or range estimate','Inspect the filler area for contamination or crystallization','Top off only with specification-compliant DEF if needed','Check for DEF-system warning messages','Record the amount added']},
 {key:'cabin-air-filter',group:'Electrified vehicle care',name:'Cabin Air Filter',description:'Inspect or replace the passenger-compartment filter.',target:'maintenance',months:24,recommended:true,powertrains:['Hybrid','Plug-in Hybrid','Electric (EV)']},
 {key:'brake-fluid',group:'Electrified vehicle care',name:'Brake Fluid Service',description:'Inspect moisture content and replace when required.',target:'maintenance',months:24,recommended:true,powertrains:['Hybrid','Plug-in Hybrid','Electric (EV)']},
 {key:'charging-connector',group:'Electrified vehicle care',name:'Charging Connector Inspection',description:'Inspect charging cable, inlet, seals, and contacts.',target:'maintenance',months:6,recommended:true,powertrains:['Plug-in Hybrid','Electric (EV)'],checklist:['Inspect the charge cable and plug for cuts, heat damage, or deformation','Inspect the vehicle charge inlet and protective door','Check seals and covers for damage or contamination','Verify connector pins are clean and undamaged','Confirm charging begins and ends normally']},
 {key:'traction-battery-health',group:'Electrified vehicle care',name:'High-Voltage Battery Health Review',description:'Review range, charging behavior, and battery-health indicators.',target:'maintenance',months:12,recommended:true,powertrains:['Hybrid','Plug-in Hybrid','Electric (EV)'],checklist:['Review displayed battery-health or diagnostic indicators','Compare typical range or efficiency with prior records','Review charging speed and completion behavior','Check for battery, cooling, or charging warning messages','Record notable degradation or schedule professional diagnosis if needed']}
];
const MOTORCYCLE_TEMPLATE_CATALOG=[
 {key:'motorcycle-pre-ride',group:'Motorcycle care',name:'Pre-Ride Safety Check',description:'A quick safety walk-around before regular riding.',target:'reminder',months:1,lead:3,recommended:true,powertrains:['all'],checklist:['Check front and rear tire pressure and visible damage','Test front and rear brakes before moving','Verify headlight, brake light, turn signals, and horn','Check mirrors, controls, throttle return, and clutch operation','Look for fuel, oil, coolant, or brake-fluid leaks','Confirm side stand or center stand retracts correctly','Inspect chain, belt, or shaft-drive area for obvious problems']},
 {key:'motorcycle-tires',group:'Motorcycle care',name:'Motorcycle Tire & Wheel Check',description:'Inspect pressure, tread, sidewalls, valves, and wheel condition.',target:'maintenance',months:1,lead:3,recommended:true,powertrains:['all'],checklist:['Set cold tire pressure to the manufacturer specification','Measure tread depth and inspect wear pattern','Inspect sidewalls for cracks, cuts, bulges, or aging','Check valve stems and caps for damage or leaks','Inspect wheels and spokes for damage or looseness']},
 {key:'motorcycle-brakes',group:'Motorcycle care',name:'Motorcycle Brake System Inspection',description:'Inspect pads, discs, fluid, hoses, and brake operation.',target:'maintenance',months:6,lead:14,recommended:true,powertrains:['all'],checklist:['Inspect front and rear brake-pad thickness','Check rotors or drums for scoring, heat damage, or wear','Inspect brake hoses and fittings for leaks or cracking','Verify brake-fluid level and condition where applicable','Test lever and pedal feel and brake-light activation']},
 {key:'motorcycle-final-drive',group:'Motorcycle care',name:'Final Drive Inspection',description:'Inspect the motorcycle chain, belt, or shaft-drive system.',target:'maintenance',miles:1000,lead:100,recommended:true,powertrains:['all'],checklist:['Identify whether the motorcycle uses chain, belt, or shaft drive','For chains, inspect slack, lubrication, sprockets, and tight spots','For belts, inspect tension, alignment, cracks, and missing teeth','For shaft drive, inspect seals and check the manufacturer fluid interval','Confirm guards and fasteners are secure']},
 {key:'motorcycle-controls',group:'Motorcycle care',name:'Controls, Cables & Fasteners Check',description:'Inspect steering controls, cables, levers, pedals, and critical fasteners.',target:'maintenance',months:6,lead:14,recommended:true,powertrains:['all'],checklist:['Check throttle for smooth movement and positive return','Inspect clutch and brake levers and pedal operation','Inspect exposed cables and hoses for wear or binding','Check steering movement and handlebar security','Inspect visible safety-critical fasteners for looseness']},
 {key:'motorcycle-lights',group:'Motorcycle care',name:'Lights, Horn & Switches Check',description:'Verify all rider controls and visibility equipment operate correctly.',target:'maintenance',months:3,lead:7,recommended:true,powertrains:['all'],checklist:['Test low and high beam','Test front and rear turn signals','Test tail light and both brake-light switches','Test horn and dashboard warning lamps','Inspect reflectors and license-plate light']},
 {key:'motorcycle-suspension',group:'Motorcycle care',name:'Suspension & Steering Inspection',description:'Inspect forks, shocks, steering bearings, and wheel bearings.',target:'maintenance',months:12,lead:30,recommended:false,powertrains:['all'],checklist:['Inspect fork seals and shock absorbers for leaks','Check steering-head bearings for looseness or notchiness','Check wheel bearings for play or roughness','Inspect suspension linkage and mounting hardware','Review suspension settings after major load or riding changes']},
 {key:'motorcycle-fluids',group:'Motorcycle care',name:'Motorcycle Fluids & Leak Check',description:'Inspect applicable fluids and look for developing leaks.',target:'maintenance',months:3,lead:7,recommended:true,powertrains:['all'],checklist:['Inspect engine oil level where applicable','Inspect coolant level on liquid-cooled motorcycles','Check brake and clutch fluid reservoirs where fitted','Inspect fuel lines, engine cases, forks, and final drive for leaks','Verify fluid caps and drain plugs appear secure']},
 {key:'motorcycle-storage',group:'Seasonal motorcycle care',name:'Motorcycle Storage Preparation',description:'Prepare the motorcycle for extended or winter storage.',target:'maintenance',months:12,lead:30,recommended:false,powertrains:['all'],checklist:['Clean and dry the motorcycle thoroughly','Stabilize fuel or follow the manufacturer storage procedure','Charge or connect a compatible battery maintainer','Set tire pressure and reduce long-term flat-spot risk','Lubricate applicable controls, chain, and exposed metal','Protect exhaust and intake openings from pests where appropriate','Record mileage and photograph condition before storage']},
 {key:'motorcycle-return',group:'Seasonal motorcycle care',name:'Return-to-Road Motorcycle Check',description:'Inspect the motorcycle before riding after extended storage.',target:'maintenance',months:12,lead:14,recommended:false,powertrains:['all'],checklist:['Inspect tires, wheels, and pressure before moving','Test battery condition and electrical operation','Check all applicable fluid levels and look for leaks','Test brakes, controls, lights, horn, and throttle return','Inspect final drive and lubricate a chain if fitted','Start and warm the motorcycle according to manufacturer guidance','Perform a short low-speed function check before normal riding']}
];
const TRAILER_TEMPLATE_CATALOG=[
 {key:'trailer-pre-trip',group:'Trailer care',name:'Pre-Trip Trailer Safety Check',description:'A general safety inspection before towing any trailer.',target:'reminder',months:1,lead:3,recommended:true,powertrains:['all'],checklist:['Confirm the coupler is fully seated and latched','Cross and secure safety chains with adequate turning clearance','Connect and test the breakaway cable where equipped','Test tail, brake, turn-signal, marker, and license lights','Check tire pressure, tread, sidewalls, and the spare tire','Verify cargo, doors, ramps, jacks, and loose equipment are secured','Walk around the trailer after a short distance and recheck connections']},
 {key:'trailer-tires',group:'Trailer care',name:'Trailer Tire, Wheel & Spare Check',description:'Inspect all tires, wheels, valves, and the spare.',target:'maintenance',months:1,lead:3,recommended:true,powertrains:['all'],checklist:['Set cold tire pressure to the trailer or tire specification','Inspect tread and sidewalls for cracks, cuts, bulges, and aging','Check tire manufacturing age and replace aged tires as appropriate','Inspect wheels for cracks, bends, rust, or damaged studs','Check the spare tire pressure and mounting security']},
 {key:'trailer-lug-torque',group:'Trailer care',name:'Trailer Lug Nut Torque Check',description:'Verify wheel fastener torque, especially after wheel removal.',target:'maintenance',months:1,lead:3,recommended:true,powertrains:['all'],checklist:['Use the trailer or wheel manufacturer torque specification','Check torque in the specified star or cross pattern','Recheck after wheel service and after the initial towing distance','Inspect studs and nuts for damage, corrosion, or movement']},
 {key:'trailer-wheel-bearings',group:'Trailer care',name:'Wheel Bearing Inspection & Service',description:'Inspect, adjust, and lubricate wheel bearings as required.',target:'maintenance',months:12,lead:30,recommended:true,powertrains:['all'],checklist:['Check each hub for play, roughness, heat, or noise','Inspect grease seals for leakage or contamination','Clean, inspect, and repack serviceable bearings when due','Replace damaged bearings, races, seals, or cotter pins','Torque spindle hardware and verify free wheel rotation']},
 {key:'trailer-brakes',group:'Trailer care',name:'Trailer Brake & Breakaway Check',description:'Inspect trailer brakes, controller response, and breakaway equipment.',target:'maintenance',months:6,lead:14,recommended:true,powertrains:['all'],checklist:['Test trailer-brake operation at low speed','Verify brake-controller gain and manual activation','Inspect brake wiring, magnets, hydraulic lines, or actuators as applicable','Inspect brake adjustment and lining condition where serviceable','Test the breakaway switch and battery where equipped']},
 {key:'trailer-electrical',group:'Trailer care',name:'Trailer Lights, Wiring & Connector Check',description:'Inspect connector pins, wiring, grounds, and all exterior lights.',target:'maintenance',months:3,lead:7,recommended:true,powertrains:['all'],checklist:['Inspect the tow-vehicle and trailer connectors for corrosion or damage','Test tail, stop, turn, marker, and license lights','Inspect wiring routing for abrasion, pinching, or loose supports','Clean and protect connector contacts as appropriate','Verify frame grounds are clean and secure']},
 {key:'trailer-coupler',group:'Trailer care',name:'Coupler, Hitch & Safety Chain Inspection',description:'Inspect the full connection system between trailer and tow vehicle.',target:'maintenance',months:3,lead:7,recommended:true,powertrains:['all'],checklist:['Inspect the coupler socket, latch, and adjustment','Inspect the hitch ball or pintle for wear and correct size','Inspect safety chains, hooks, attachment points, and ratings','Check the breakaway cable routing and condition','Lubricate moving coupler parts according to manufacturer guidance']},
 {key:'trailer-frame',group:'Trailer care',name:'Trailer Suspension, Axle & Frame Inspection',description:'Inspect structural, suspension, axle, and underbody components.',target:'maintenance',months:12,lead:30,recommended:true,powertrains:['all'],checklist:['Inspect frame rails, crossmembers, welds, and mounting points','Inspect leaf springs, equalizers, shackles, bushings, or torsion axles','Check axle condition and alignment indicators','Inspect U-bolts and suspension fasteners for movement or corrosion','Inspect the floor, deck, ramps, and tie-down points']},
 {key:'trailer-lubrication',group:'Trailer care',name:'Trailer Jack, Coupler & Hinge Lubrication',description:'Lubricate moving trailer hardware and inspect operation.',target:'maintenance',months:6,lead:14,recommended:false,powertrains:['all'],checklist:['Clean and lubricate the tongue jack or landing gear','Lubricate coupler-latch pivot points as permitted','Lubricate door, ramp, gate, and stabilizer hinges','Inspect cables, winches, pulleys, and latches where fitted','Wipe away excess lubricant that could attract road grit']},
 {key:'trailer-storage',group:'Seasonal trailer care',name:'Trailer Storage Preparation',description:'Prepare the trailer for extended storage and weather exposure.',target:'maintenance',months:12,lead:30,recommended:false,powertrains:['all'],checklist:['Clean the trailer and remove trapped dirt or road salt','Dry and protect electrical connectors','Set tire pressure and reduce long-term tire loading where appropriate','Secure doors, vents, ramps, covers, and loose accessories','Charge or disconnect auxiliary and breakaway batteries as appropriate','Inspect roof, seams, seals, and drains where fitted','Photograph condition and record storage location and date']}
];
function normalizedVehicleType(vehicle=activeVehicle()){
 const raw=String(vehicle?.type||'Car').toLowerCase();
 if(raw.includes('motor'))return'Motorcycle';
 if(raw.includes('trailer'))return'Trailer';
 if(raw.includes('truck'))return'Truck';
 return'Car'
}
function powertrainMatchesTemplate(item,powertrain){return item.powertrains.includes('all')||item.powertrains.includes(powertrain)}
function applicableVehicleTemplates(powertrain,vehicle=activeVehicle()){
 const type=normalizedVehicleType(vehicle),base=VEHICLE_TEMPLATE_CATALOG.filter(item=>powertrainMatchesTemplate(item,powertrain));
 if(type==='Motorcycle'){
   const allowed=new Set(['battery-test','recall-check','oil-filter','engine-air-filter','charging-connector','traction-battery-health']);
   return [...base.filter(item=>allowed.has(item.key)),...MOTORCYCLE_TEMPLATE_CATALOG.filter(item=>powertrainMatchesTemplate(item,powertrain))]
 }
 if(type==='Trailer'){
   return [...base.filter(item=>item.key==='recall-check'),...TRAILER_TEMPLATE_CATALOG]
 }
 return base
}
function vehicleTemplatePickerHtml(powertrain,vehicle={type:'Car'}){
 const templates=applicableVehicleTemplates(powertrain,vehicle),groups=[...new Set(templates.map(item=>item.group))],vehicleType=normalizedVehicleType(vehicle),contextLabel=vehicleType==='Trailer'?'Trailer':`${vehicleType} · ${powertrain}`;
 return `<div class="vehicle-template-picker full"><div class="vehicle-template-heading"><div><h4>Maintenance & reminder templates</h4><p>Recommended starting points for <strong>${esc(contextLabel)}</strong>. Uncheck anything you do not want.</p></div><div class="vehicle-template-actions"><button type="button" onclick="setVehicleTemplateChecks(true)">Select recommended</button><button type="button" onclick="setVehicleTemplateChecks(false)">Clear all</button></div></div><div class="vehicle-template-groups">${groups.map(group=>`<section><h5>${esc(group)}</h5><div class="vehicle-template-grid">${templates.filter(item=>item.group===group).map(item=>`<label class="vehicle-template-option"><input type="checkbox" name="Maintenance Template" value="${item.key}" ${item.recommended?'checked':''}><span class="vehicle-template-icon ${maintenanceTone(item.name)}">${svg(maintenanceIcon(item.name))}</span><span><strong>${esc(item.name)}</strong><small>${esc(item.description)}</small><em>${item.miles?`${number(item.miles)} mi`:`Every ${item.months} month${item.months===1?'':'s'}`}</em></span></label>`).join('')}</div></section>`).join('')}</div><div class="vehicle-template-note">Intervals are starting defaults only. Manufacturer schedules, severe-duty use, and local regulations should take priority.</div></div>`
}
function pendingVehicleAddType(){return document.querySelector('#modal input[name="Vehicle Type"]:checked')?.value||'Car'}
function pendingVehicleAddPowertrain(){
 const type=pendingVehicleAddType();
 return type==='Trailer'?'Not Applicable':document.getElementById('vehicleAddPowertrain')?.value||'Gasoline / Internal Combustion'
}
function refreshVehicleTemplatePicker(powertrain=pendingVehicleAddPowertrain(),vehicleType=pendingVehicleAddType()){
 const host=document.getElementById('vehicleTemplatePickerHost');
 if(host)host.innerHTML=vehicleTemplatePickerHtml(powertrain,{type:vehicleType})
}
window.setVehicleTemplateChecks=function(recommended){
 const type=pendingVehicleAddType(),powertrain=pendingVehicleAddPowertrain(),catalog=new Map(applicableVehicleTemplates(powertrain,{type}).map(item=>[item.key,item]));
 document.querySelectorAll('#vehicleTemplatePickerHost input[name="Maintenance Template"]').forEach(input=>input.checked=recommended?Boolean(catalog.get(input.value)?.recommended):false)
}
function vehicleAddTypeCard(type,label,description){
 const image=VEHICLE_DEFAULT_IMAGES[type]||VEHICLE_DEFAULT_IMAGES.Car;
 return `<label class="vehicle-add-type-card"><input type="radio" name="Vehicle Type" value="${type}" ${type==='Car'?'checked':''}><span class="vehicle-add-type-art"><img src="${image}" alt=""></span><span class="vehicle-add-type-copy"><strong>${label}</strong><small>${description}</small></span><i>${svg('check')}</i></label>`
}
function vehicleAddContextFieldsHtml(type){
 if(type==='Trailer'){
  return `<section class="vehicle-add-section trailer-spec-section"><div class="vehicle-add-section-head"><span class="wizard-eyebrow">TRAILER DETAILS</span><h4>Towing and chassis information</h4><p>Trailer records use towing, capacity, axle, hitch, and brake information instead of engine, transmission, drivetrain, or odometer fields.</p></div><div class="vehicle-add-grid">${vehicleField('Trailer Type','Trailer Type','Utility','select',['Utility','Enclosed Cargo','Flatbed','Travel Trailer','Boat Trailer','Car Hauler','Equipment','Dump','Livestock','Other'])}${vehicleField('GVWR (lb)','GVWR','', 'number')}${vehicleField('Empty Weight (lb)','Empty Weight','', 'number')}${vehicleField('Axle Count','Axle Count','1','number')}${vehicleField('Coupler / Hitch Type','Coupler Type','2 in Ball','select',['1-7/8 in Ball','2 in Ball','2-5/16 in Ball','Pintle','Fifth Wheel','Gooseneck','Other'],'wide-field')}${vehicleField('Brake Type','Brake Type','Electric','select',['Electric','Surge / Hydraulic','Electric-over-Hydraulic','None / Unbraked','Other'],'wide-field')}</div></section>`
 }
 const detailTitle=type==='Motorcycle'?'Motorcycle mechanical details':'Mechanical details';
 const detailCopy=type==='Motorcycle'
  ?'Record the motorcycle powertrain, engine, transmission, final drive, and current odometer.'
  :'These details drive maintenance templates and service forecasting.';
 return `<section class="vehicle-add-section"><div class="vehicle-add-section-head"><span class="wizard-eyebrow">POWERTRAIN & ODOMETER</span><h4>${detailTitle}</h4><p>${detailCopy}</p></div><div class="vehicle-add-grid">${vehicleField('Powertrain','Powertrain','Gasoline / Internal Combustion','select',VEHICLE_POWERTRAINS,'powertrain-field').replace('<select name="Powertrain">','<select name="Powertrain" id="vehicleAddPowertrain">')}${vehicleField('Trim','Trim','')}${vehicleField('Engine','Engine','')}${vehicleField('Transmission','Transmission','')}${vehicleField(type==='Motorcycle'?'Final Drive / Drivetrain':'Drivetrain','Drivetrain','')}${vehicleField('Mileage at Acquisition','Mileage at Acquisition','', 'number',null,'mileage-field')}${vehicleField('Current Mileage','Current Mileage',0,'number',null,'mileage-field')}</div></section>`
}
function vehicleAddFieldsHtml(){
 return `<div class="vehicle-add-workspace"><section class="vehicle-add-section vehicle-add-type-section"><div class="vehicle-add-section-head"><span class="wizard-eyebrow">VEHICLE TYPE</span><h4>What are you adding?</h4><p>Selecting a type changes the form and the recommended maintenance automatically.</p></div><div class="vehicle-add-type-grid">${vehicleAddTypeCard('Car','Car','Passenger car or crossover')}${vehicleAddTypeCard('Truck','Truck','Pickup or light truck')}${vehicleAddTypeCard('Motorcycle','Motorcycle','Street, touring, cruiser, or sport bike')}${vehicleAddTypeCard('Trailer','Trailer','Towable trailer with no powertrain or odometer')}</div></section><section class="vehicle-add-section"><div class="vehicle-add-section-head"><span class="wizard-eyebrow">IDENTITY</span><h4>Vehicle identification</h4><p>Add the manufacturer information you have available. VIN is optional.</p></div><div class="vehicle-add-grid">${vehicleField('Year','Year','')}${vehicleField('Make / Manufacturer','Make','')}${vehicleField('Model','Model','')}${vehicleField('Color','Color','')}${vehicleField('VIN','VIN','', 'text',null,'wide-field')}${vehicleField('Purchase / Acquired Date','Purchase / Acquired Date','', 'date')}</div></section><div id="vehicleAddContextHost">${vehicleAddContextFieldsHtml('Car')}</div><section class="vehicle-add-section vehicle-add-templates-section"><div id="vehicleTemplatePickerHost">${vehicleTemplatePickerHtml('Gasoline / Internal Combustion',{type:'Car'})}</div></section></div>`
}
function initializeVehicleAddDialog(){
 const contextHost=document.getElementById('vehicleAddContextHost');
 if(!contextHost)return;
 const renderContext=()=>{
  const type=pendingVehicleAddType();
  contextHost.innerHTML=vehicleAddContextFieldsHtml(type);
  const powertrainSelect=document.getElementById('vehicleAddPowertrain');
  if(powertrainSelect)powertrainSelect.onchange=()=>refreshVehicleTemplatePicker(powertrainSelect.value,type);
  refreshVehicleTemplatePicker(type==='Trailer'?'Not Applicable':powertrainSelect?.value||'Gasoline / Internal Combustion',type)
 };
 document.querySelectorAll('#modal input[name="Vehicle Type"]').forEach(input=>input.onchange=renderContext);
 renderContext()
}
function addMonthsFromToday(months){const date=new Date();date.setHours(12,0,0,0);date.setMonth(date.getMonth()+Number(months||0));return date.toISOString().slice(0,10)}
function applyVehicleTemplates(vehicle,keys){
 const selected=new Set(keys||[]),mileage=Number(vehicle.mileage||0);
 applicableVehicleTemplates(vehicle.powertrain,vehicle).filter(item=>selected.has(item.key)).forEach(item=>{
   if(item.target==='maintenance'){
     const isMileage=Number(item.miles||0)>0,intervalValue=isMileage?Number(item.miles):Number(item.months);
     state.maintenance.unshift({vehicleId:vehicle.id,name:item.name,interval:isMileage?`${number(intervalValue)} mi`:`${number(intervalValue)} months`,progress:0,max:intervalValue,due:isMileage?`${number(mileage+intervalValue)} mi`:addMonthsFromToday(intervalValue),status:'On track',templateKey:item.key,source:'vehicle-template'});
   }else{
     state.reminders.unshift({vehicleId:vehicle.id,name:item.name,rule:`Every ${number(item.months)} month${Number(item.months)===1?'':'s'}`,due:addMonthsFromToday(item.months),status:'Upcoming',templateKey:item.key,source:'vehicle-template'});
   }
 });
}

function modalConfig(type,index=null){const isEdit=index!==null&&index!==undefined;let item=null;if(isEdit){const map={service:'maintenance',expense:'expenses',document:'documents',reminder:'reminders'};item=type==='vehicle'?state.vehicles[index]:state[map[type]][index]}
const blankVehicle={year:'',make:'',model:'',trim:'',type:'Car',powertrain:'Gasoline / Internal Combustion',vin:'',engine:'',transmission:'',drivetrain:'',color:'',acquiredDate:'',acquiredMileage:null,mileage:0};
const vehicleItem=type==='vehicle-add'?blankVehicle:(item||state.vehicle);
const configs={
 mileage:{title:'Update Mileage',subtitle:`Add an odometer reading for ${vehicleFullName()}.`,fields:[['Mileage','number',state.mileage,'half'],['Source','select','Manual update','half',['Manual update','OBD sync','Service record','Fuel entry']]]},
 expense:{title:isEdit?'Edit Expense':'Add Expense',subtitle:`Included in ownership reports for ${vehicleFullName()}.`,fields:[['Date','date',item?.date||new Date().toISOString().slice(0,10),'half'],['Category','select',item?.category||'Maintenance','half',['Maintenance','Repair','Fuel','Parts','Insurance','Registration','Other']],['Vendor','text',item?.vendor||'','half'],['Amount','number',item?.amount||'','half'],['Notes','text',item?.notes||'','full']]},
 service:{title:isEdit?'Edit Maintenance':'Add Maintenance',subtitle:`Track service intervals for ${vehicleFullName()}.`,fields:[['Service Name','text',item?.name||'','full'],['Interval','text',item?.interval||'7,500 mi','half'],['Interval Value','number',item?.max||7500,'half'],['Progress','number',item?.progress||0,'half'],['Next Due','text',item?.due||'','half'],['Status','select',item?.status||'On track','half',['On track','Due soon','Overdue','Completed']]]},
 reminder:{title:isEdit?'Edit Reminder':'New Reminder',subtitle:`Stored for ${vehicleFullName()}.`,fields:[['Reminder Name','text',item?.name||'','full'],['Rule','text',item?.rule||'','half'],['Due','text',item?.due||'','half'],['Status','select',item?.status||'Upcoming','half',['Upcoming','Due Soon','Overdue','Completed']]]},
 vehicle:{title:'Edit Vehicle',subtitle:'Update vehicle details, status, and odometer.',fields:[['Vehicle Status','select',vehicleItem.lifecycleStatus||'Active','full',['Active','Sold','Decommissioned']],['Vehicle Type','select',vehicleItem.type||inferVehicleType(vehicleItem),'half',['Car','Truck','Motorcycle','Trailer']],['Powertrain','select',vehicleItem.powertrain||'Gasoline / Internal Combustion','half',VEHICLE_POWERTRAINS],['Year','text',vehicleItem.year,'half'],['Make','text',vehicleItem.make,'half'],['Model','text',vehicleItem.model,'half'],['Trim','text',vehicleItem.trim,'half'],['VIN','text',vehicleItem.vin,'full'],['Engine','text',vehicleItem.engine,'half'],['Transmission','text',vehicleItem.transmission,'half'],['Drivetrain','text',vehicleItem.drivetrain,'half'],['Color','text',vehicleItem.color,'half'],['Purchase / Acquired Date','date',vehicleItem.acquiredDate||'','half'],['Mileage at Acquisition','number',vehicleItem.acquiredMileage??'','half'],['Current Mileage','number',vehicleItem.mileage,'half']]},
  'vehicle-add':{title:'Add Vehicle',subtitle:'Add a car, truck, motorcycle, or trailer with type-specific details and recommended maintenance.',fields:[]},
  document:{title:isEdit?'Edit Document':'Upload Document',subtitle:isEdit?'Update contextual metadata for this stored document.':`Store a file for ${vehicleFullName()}.`,fields:[]}
};return configs[type]}
function expenseFieldsHtml(item={}){
 const category=item?.category||'Maintenance',isFuel=category==='Fuel',coverage=normalizeExpenseCoverage(item?.coverageType),isCovered=coverage!=='None';
 return `<div class="expense-entry-workspace"><section class="expense-entry-card"><div class="expense-entry-section-heading"><h5>Transaction details</h5></div><div class="expense-entry-grid"><label class="expense-entry-field expense-date-field"><span>Expense Date *</span><input name="Date" type="date" value="${esc(item?.date||new Date().toISOString().slice(0,10))}" required></label><label class="expense-entry-field"><span>Category *</span><select name="Category" required>${['Maintenance','Repair','Fuel','Parts','Insurance','Registration','Other'].map(option=>`<option ${option===category?'selected':''}>${option}</option>`).join('')}</select></label><label class="expense-entry-field"><span>Vendor</span><input name="Vendor" type="text" value="${esc(item?.vendor||'')}" placeholder="Shop, station, insurer, or seller"></label><label class="expense-entry-field expense-amount-field"><span id="expenseAmountLabel">${isCovered?'Amount Paid':'Amount'} *</span><div class="expense-currency-input"><span aria-hidden="true">$</span><input id="expenseAmountInput" name="Amount" type="number" value="${esc(item?.amount??'')}" min="0" step="0.01" inputmode="decimal" placeholder="0.00" aria-label="Expense amount paid in US dollars" required></div></label><label id="expenseCoverageField" class="expense-entry-field" ${isFuel?'hidden':''}><span>Payment / Coverage</span><select id="expenseCoverageSelect" name="Coverage"><option value="None" ${coverage==='None'?'selected':''}>Out of pocket</option><option value="Warranty" ${coverage==='Warranty'?'selected':''}>Warranty covered</option><option value="Recall" ${coverage==='Recall'?'selected':''}>Recall covered</option></select></label><label id="expenseCoveredValueField" class="expense-entry-field" ${isCovered&&!isFuel?'':'hidden'}><span>Service / Invoice Value <em>Optional</em></span><div class="expense-currency-input"><span aria-hidden="true">$</span><input name="Covered Value" type="number" value="${esc(item?.coveredAmount??'')}" min="0" step="0.01" inputmode="decimal" placeholder="0.00"></div><small>Reference value covered by the warranty or recall; excluded from spending totals.</small></label><label class="expense-entry-field expense-notes-field"><span>Notes</span><textarea name="Notes" rows="2" placeholder="What was purchased or serviced?">${esc(item?.notes||'')}</textarea></label></div></section><section id="expenseFuelFields" class="expense-fuel-fields" ${isFuel?'':'hidden'}><div class="expense-fuel-heading"><span>${svg('fuel')}</span><strong>Fuel economy details</strong></div><div class="expense-fuel-grid"><label>Gallons<input name="Gallons" type="number" value="${esc(item?.gallons??'')}" min="0" step="0.001" placeholder="e.g. 17.245"></label><label>Odometer<input name="Odometer" type="number" value="${esc(item?.odometer??'')}" min="0" step="1" placeholder="Mileage at fill-up"></label><label>MPG override<input name="MPG" type="number" value="${esc(item?.mpg??'')}" min="0" step="0.1" placeholder="Optional"></label><label class="expense-full-tank"><input name="Full Tank" type="checkbox" ${item?.fullTank===false?'':'checked'}><span><strong>Full tank fill-up</strong></span></label></div></section></div>`
}
function syncExpenseFuelFields(){const category=document.querySelector('#modalFields [name="Category"]'),panel=document.getElementById('expenseFuelFields'),coverageField=document.getElementById('expenseCoverageField'),coverage=document.getElementById('expenseCoverageSelect');if(!category||!panel)return;const isFuel=category.value==='Fuel';panel.hidden=!isFuel;if(coverageField)coverageField.hidden=isFuel;if(isFuel&&coverage)coverage.value='None';syncExpenseCoverageFields()}
function syncExpenseCoverageFields(){const category=document.querySelector('#modalFields [name="Category"]'),coverage=document.getElementById('expenseCoverageSelect'),coveredField=document.getElementById('expenseCoveredValueField'),amount=document.getElementById('expenseAmountInput'),amountLabel=document.getElementById('expenseAmountLabel');if(!coverage)return;const covered=category?.value!=='Fuel'&&normalizeExpenseCoverage(coverage.value)!=='None';if(coveredField)coveredField.hidden=!covered;if(amountLabel)amountLabel.textContent=`${covered?'Amount Paid':'Amount'} *`;if(covered&&amount&&amount.value==='')amount.value='0.00';syncExpenseAmountPreview()}
function syncExpenseAmountPreview(){const input=document.getElementById('expenseAmountInput'),preview=document.getElementById('expenseAmountPreview');if(!input||!preview)return;const value=Number(input.value);preview.textContent=money(Number.isFinite(value)&&value>=0?value:0)}
function initializeExpenseDialog(){const category=document.querySelector('#modalFields [name="Category"]'),amount=document.getElementById('expenseAmountInput'),coverage=document.getElementById('expenseCoverageSelect');if(category){category.addEventListener('change',syncExpenseFuelFields);syncExpenseFuelFields()}if(coverage)coverage.addEventListener('change',syncExpenseCoverageFields);if(amount){amount.addEventListener('input',syncExpenseAmountPreview);amount.addEventListener('blur',()=>{if(amount.value!==''&&Number.isFinite(Number(amount.value)))amount.value=Number(amount.value).toFixed(2);syncExpenseAmountPreview()});syncExpenseAmountPreview()}syncExpenseCoverageFields()}
window.openFuelExpense=function(){openModal('expense');const category=document.querySelector('#modalFields [name="Category"]');if(category){category.value='Fuel';syncExpenseFuelFields()}}
function vehicleRecordCounts(vehicleId){return{expenses:recordsFor('expenses',vehicleId).length,maintenance:recordsFor('maintenance',vehicleId).length,reminders:recordsFor('reminders',vehicleId).length,documents:recordsFor('documents',vehicleId).length}}
function vehicleStatusField(vehicle){
 const status=vehicle.lifecycleStatus||'Active',archived=isVehicleArchived(vehicle),description=archived?'Archived vehicles remain available for historical records.':'Available as an active GarageLog vehicle.';
 return `<label class="vehicle-edit-field status-field vehicle-status-readonly"><span>Vehicle Status</span><div class="vehicle-status-display ${archived?'archived':'active'}">${svg(archived?'archive':'check')}<span><strong>${esc(status)}</strong><small>${esc(description)}</small></span></div><input type="hidden" name="Vehicle Status" value="${esc(status)}"></label>`
}
function queueVehicleLifecycleSubmit(index,newStatus,message){
 const form=document.getElementById('modalForm'),statusInput=form?.querySelector('[name="Vehicle Status"]');
 if(!form||editing?.type!=='vehicle'||editing.index!==index||!statusInput){toast('Reopen Edit Vehicle and try again');return}
 statusInput.value=newStatus;pendingVehicleLifecycleToast=message;form.requestSubmit()
}
window.openVehicleArchivePrompt=function(index){
 const vehicle=state.vehicles[index];if(!vehicle){toast('Vehicle not found');return}if(isVehicleArchived(vehicle)){toast('This vehicle is already archived');return}
 if(activeFleetVehicles().length<=1){toast('Add or restore another active vehicle before archiving this one');return}
 const counts=vehicleRecordCounts(vehicle.id),dialog=ensureDynamicDialog('vehicleLifecycleDialog','vehicle-lifecycle-dialog');
 dialog.innerHTML=`<div class="modal-header"><div><span class="wizard-eyebrow archive">ARCHIVE VEHICLE</span><h3>Archive ${esc(vehicleFullName(vehicle))}?</h3><p>Choose why the vehicle is leaving the active garage.</p></div><button type="button" class="icon-btn lifecycle-close">${svg('close')}</button></div><div class="vehicle-lifecycle-body"><div class="lifecycle-warning archive">${svg('archive')}<div><strong>All linked records will be retained</strong><p>The vehicle will no longer be available for new records or as the active dashboard vehicle until it is restored.</p></div></div><div class="vehicle-archive-options"><label><input type="radio" name="Archive Status" value="Sold" checked><span><strong>Sold</strong><small>The vehicle was sold or transferred to another owner.</small></span></label><label><input type="radio" name="Archive Status" value="Decommissioned"><span><strong>Decommissioned</strong><small>The vehicle was retired, dismantled, or permanently taken out of service.</small></span></label></div><div class="lifecycle-record-grid"><div><span>Expenses retained</span><strong>${counts.expenses}</strong></div><div><span>Maintenance retained</span><strong>${counts.maintenance}</strong></div><div><span>Reminders retained</span><strong>${counts.reminders}</strong></div><div><span>Documents retained</span><strong>${counts.documents}</strong></div></div></div><div class="modal-actions"><button type="button" class="secondary lifecycle-cancel">Cancel</button><button type="button" class="archive-button lifecycle-confirm">${svg('archive')} Archive Vehicle</button></div>`;
 const close=()=>dialog.close();dialog.querySelector('.lifecycle-close').onclick=close;dialog.querySelector('.lifecycle-cancel').onclick=close;dialog.querySelector('.lifecycle-confirm').onclick=()=>{const status=dialog.querySelector('input[name="Archive Status"]:checked')?.value||'Sold';dialog.close();queueVehicleLifecycleSubmit(index,status,`Vehicle archived as ${status}`)};dialog.showModal()
}
window.openVehicleRestorePrompt=function(index){
 const vehicle=state.vehicles[index];if(!vehicle){toast('Vehicle not found');return}if(!isVehicleArchived(vehicle)){toast('This vehicle is already active');return}
 const counts=vehicleRecordCounts(vehicle.id),dialog=ensureDynamicDialog('vehicleRestoreDialog','vehicle-lifecycle-dialog');
 dialog.innerHTML=`<div class="modal-header"><div><span class="wizard-eyebrow restore">RESTORE VEHICLE</span><h3>Restore ${esc(vehicleFullName(vehicle))}?</h3><p>The vehicle will return to the active garage and can receive new records again.</p></div><button type="button" class="icon-btn lifecycle-close">${svg('close')}</button></div><div class="vehicle-lifecycle-body"><div class="lifecycle-warning restore">${svg('check')}<div><strong>Historical records remain attached</strong><p>Restoring changes the vehicle status to Active. It does not alter existing expenses, maintenance, reminders, or documents.</p></div></div><div class="lifecycle-record-grid"><div><span>Expenses</span><strong>${counts.expenses}</strong></div><div><span>Maintenance</span><strong>${counts.maintenance}</strong></div><div><span>Reminders</span><strong>${counts.reminders}</strong></div><div><span>Documents</span><strong>${counts.documents}</strong></div></div></div><div class="modal-actions"><button type="button" class="secondary lifecycle-cancel">Cancel</button><button type="button" class="primary lifecycle-confirm">${svg('check')} Restore Vehicle</button></div>`;
 const close=()=>dialog.close();dialog.querySelector('.lifecycle-close').onclick=close;dialog.querySelector('.lifecycle-cancel').onclick=close;dialog.querySelector('.lifecycle-confirm').onclick=()=>{dialog.close();queueVehicleLifecycleSubmit(index,'Active','Vehicle restored to Active')};dialog.showModal()
}
window.openVehicleDeletePrompt=function(index){
 const vehicle=state.vehicles[index];if(!vehicle){toast('Vehicle not found');return}if(state.vehicles.length<=1){toast('Add another vehicle before deleting the only vehicle in GarageLog');return}
 const counts=vehicleRecordCounts(vehicle.id),dialog=ensureDynamicDialog('vehicleDeleteDialog','vehicle-lifecycle-dialog');
 dialog.innerHTML=`<div class="modal-header"><div><span class="wizard-eyebrow danger">DELETE VEHICLE</span><h3>Delete ${esc(vehicleFullName(vehicle))}?</h3><p>The vehicle and all records assigned to it will be removed.</p></div><button type="button" class="icon-btn vehicle-delete-close">${svg('close')}</button></div><div class="vehicle-lifecycle-body"><div class="lifecycle-warning delete">${svg('trash')}<div><strong>Vehicle data will be permanently removed</strong><p>${counts.expenses} expenses · ${counts.maintenance} maintenance items · ${counts.reminders} reminders · ${counts.documents} documents</p></div></div></div><div class="modal-actions"><button type="button" class="secondary vehicle-delete-cancel">Cancel</button><button type="button" class="danger-button vehicle-delete-confirm">${svg('trash')} Delete Vehicle</button></div>`;
 const close=()=>dialog.close();dialog.querySelector('.vehicle-delete-close').onclick=close;dialog.querySelector('.vehicle-delete-cancel').onclick=close;dialog.querySelector('.vehicle-delete-confirm').onclick=async()=>{
   const documents=state.documents.filter(doc=>doc.vehicleId===vehicle.id);for(const doc of documents){if(doc.storedName)await fetch(`/api/documents/${encodeURIComponent(doc.storedName)}`,{method:'DELETE'}).catch(()=>{})}
   if(vehicle.imageStoredName)await fetch(`/api/vehicle-image/${encodeURIComponent(vehicle.imageStoredName)}`,{method:'DELETE'}).catch(()=>{});
   state.expenses=state.expenses.filter(item=>item.vehicleId!==vehicle.id);state.maintenance=state.maintenance.filter(item=>item.vehicleId!==vehicle.id);state.reminders=state.reminders.filter(item=>item.vehicleId!==vehicle.id);state.documents=state.documents.filter(item=>item.vehicleId!==vehicle.id);state.vehicles=state.vehicles.filter(item=>item.id!==vehicle.id);
   const next=state.vehicles.find(item=>!isVehicleArchived(item))||state.vehicles[0];state.activeVehicleId=next.id;state.vehicle=next;state.mileage=Number(next.mileage||0);state.mileageHistory=next.mileageHistory||[];state.metrics=next.metrics||{averageMpg:0};await saveNow();dialog.close();closeRecordModal();toast('Vehicle deleted');current='Garage';render();
 };dialog.showModal()
}
function vehicleField(label,name,value,type='text',options=null,span=''){
 if(options)return `<label class="vehicle-edit-field ${span}"><span>${label}</span><select name="${name}">${options.map(option=>`<option ${String(option)===String(value)?'selected':''}>${esc(option)}</option>`).join('')}</select></label>`;
 return `<label class="vehicle-edit-field ${span}"><span>${label}</span><input name="${name}" type="${type}" value="${esc(value??'')}" ${type==='number'?'min="0" step="1"':''}></label>`
}
function vehicleEditFieldsHtml(vehicle,index){
 const counts=vehicleRecordCounts(vehicle.id),total=counts.expenses+counts.maintenance+counts.reminders+counts.documents,archived=isVehicleArchived(vehicle);
 return `<div class="vehicle-edit-workspace">
  <section class="vehicle-edit-section vehicle-edit-overview">
   <div class="vehicle-edit-section-head"><div><span class="wizard-eyebrow">VEHICLE PROFILE</span><h4>Identity and status</h4><p>Core details used throughout GarageLog.</p></div><span class="vehicle-record-total">${total} linked records</span></div>
   <div class="vehicle-edit-grid status-grid">
    ${vehicleStatusField(vehicle)}
    ${vehicleField('Vehicle Type','Vehicle Type',vehicle.type||inferVehicleType(vehicle),'select',['Car','Truck','Motorcycle','Trailer'])}
    ${vehicleField('Powertrain','Powertrain',vehicle.powertrain||'Gasoline / Internal Combustion','select',VEHICLE_POWERTRAINS,'powertrain-field')}
    ${vehicleField('Year','Year',vehicle.year)}${vehicleField('Make','Make',vehicle.make)}${vehicleField('Model','Model',vehicle.model)}${vehicleField('Trim','Trim',vehicle.trim)}
    ${vehicleField('VIN','VIN',vehicle.vin,'text',null,'wide-field')}
    ${vehicleField('Purchase / Acquired Date','Purchase / Acquired Date',vehicle.acquiredDate||'','date')}
    ${normalizedVehicleType(vehicle)==='Trailer'?'':vehicleField('Mileage at Acquisition','Mileage at Acquisition',vehicle.acquiredMileage??'','number')}
   </div>
  </section>
  <section class="vehicle-edit-section">
   <div class="vehicle-edit-section-head"><div><span class="wizard-eyebrow">MECHANICAL DETAILS</span><h4>Configuration and odometer</h4></div></div>
   <div class="vehicle-edit-grid mechanical-grid">
    ${vehicleField('Engine','Engine',vehicle.engine)}${vehicleField('Transmission','Transmission',vehicle.transmission)}${vehicleField('Drivetrain','Drivetrain',vehicle.drivetrain)}${vehicleField('Color','Color',vehicle.color)}${vehicleField('Current Mileage','Current Mileage',vehicle.mileage,'number',null,'mileage-field')}
   </div>
  </section>
  <div class="vehicle-edit-bottom-grid">
   <section class="vehicle-edit-section vehicle-linked-records">
    <div class="vehicle-edit-section-head"><div><span class="wizard-eyebrow">LINKED DATA</span><h4>Records assigned to this vehicle</h4><p>These counts confirm which records GarageLog currently associates with this vehicle.</p></div></div>
    <div class="vehicle-record-count-grid">
     <button type="button" onclick="openVehicleRecords(${attrJs(vehicle.id)},'Maintenance')"><span class="record-count-icon green">${svg('wrench')}</span><span><strong>${counts.maintenance}</strong><small>Maintenance</small></span></button>
     <button type="button" onclick="openVehicleRecords(${attrJs(vehicle.id)},'Expenses')"><span class="record-count-icon purple">${svg('dollar')}</span><span><strong>${counts.expenses}</strong><small>Expenses</small></span></button>
     <button type="button" onclick="openVehicleRecords(${attrJs(vehicle.id)},'Reminders')"><span class="record-count-icon orange">${svg('bell')}</span><span><strong>${counts.reminders}</strong><small>Reminders</small></span></button>
     <button type="button" onclick="openVehicleRecords(${attrJs(vehicle.id)},'Documents')"><span class="record-count-icon blue">${svg('file')}</span><span><strong>${counts.documents}</strong><small>Documents</small></span></button>
    </div>
    ${total===0?`<div class="vehicle-data-empty-note">No records are currently linked to this vehicle. Add maintenance, expenses, reminders, and documents from the page actions when you are ready.</div>`:''}
   </section>
   <section class="vehicle-edit-section vehicle-lifecycle-panel-redesign ${archived?'archived':''}">
    <div><span class="wizard-eyebrow ${archived?'restore':'archive'}">VEHICLE LIFECYCLE</span><h4>${archived?'Restore or permanently remove vehicle':'Archive or permanently remove vehicle'}</h4><p>${archived?'Restore returns this vehicle to Active status. Delete Vehicle permanently removes the vehicle and every linked record.':'Archive removes the vehicle from active use while retaining every linked record. Delete Vehicle permanently removes everything.'}</p></div>
    <div class="vehicle-lifecycle-actions">${archived?`<button type="button" class="restore-outline vehicle-restore-from-edit">${svg('check')} Restore Vehicle</button>`:`<button type="button" class="archive-outline vehicle-archive-from-edit">${svg('archive')} Archive Vehicle</button>`}<button type="button" class="danger-outline vehicle-delete-from-edit">${svg('trash')} Delete Vehicle</button></div>
   </section>
  </div>
 </div>`
}
window.openModal=function(type,index=null){
 if(!canWrite()){toast('This account has read-only access.');return}
 if(type==='reminder'&&(index===null||index===undefined)){openReminderWizard();return}
 if(type==='service'&&(index===null||index===undefined)){openMaintenanceWizard();return}
 editing={type,index};
 const c=modalConfig(type,index),modal=document.getElementById('modal');
 document.getElementById('modalTitle').textContent=c.title;
 document.getElementById('modalSubtitle').textContent=c.subtitle;
 modal.classList.toggle('vehicle-add-dialog',type==='vehicle-add');
 modal.classList.toggle('vehicle-edit-dialog',type==='vehicle');
 modal.classList.toggle('document-upload-dialog',type==='document'&&index===null);
 modal.classList.toggle('expense-dialog',type==='expense');
 clearDocumentUploadPreview();
 const saveModal=document.getElementById('saveModal');
 if(saveModal){
  saveModal.innerHTML=type==='expense'
   ?`${svg('dollar')} ${index!==null&&index!==undefined?'Save Changes':'Add Expense'}`
   :type==='vehicle-add'
    ?`${svg('plus')} Add Vehicle`
    :'Save'
 }
 const modalFields=document.getElementById('modalFields');
 if(type==='vehicle-add'){
  modalFields.innerHTML=vehicleAddFieldsHtml()
 }else if(type==='vehicle'){
  const vehicle=state.vehicles[index];
  modalFields.innerHTML=vehicleEditFieldsHtml(vehicle,index);
  modalFields.querySelector('.vehicle-delete-from-edit').onclick=()=>openVehicleDeletePrompt(index);
  const archiveButton=modalFields.querySelector('.vehicle-archive-from-edit'),restoreButton=modalFields.querySelector('.vehicle-restore-from-edit');
  if(archiveButton)archiveButton.onclick=()=>openVehicleArchivePrompt(index);
  if(restoreButton)restoreButton.onclick=()=>openVehicleRestorePrompt(index)
 }else{
  if(type==='document')modalFields.innerHTML=index===null||index===undefined?documentUploadFieldsHtml():documentEditFieldsHtml(state.documents[index]);
  else if(type==='expense')modalFields.innerHTML=expenseFieldsHtml(index!==null&&index!==undefined?state.expenses[index]:{});
  else modalFields.innerHTML=c.fields.map(([n,t,v,w,options,accept])=>{
   const cls=w==='full'?'full':'';
   if(t==='select')return `<label class="${cls}">${n}<select name="${n}" required>${options.map(o=>`<option ${String(o)===String(v)?'selected':''}>${esc(o)}</option>`).join('')}</select></label>`;
   const required=t==='file'&&type==='document'&&index===null?'required':'',acceptAttr=accept?`accept="${accept}"`:'';
   return `<label class="${cls}">${n}<input name="${n}" type="${t}" value="${t==='file'?'':esc(v)}" ${required} ${acceptAttr} step="${t==='number'?'0.01':'any'}"></label>`
  }).join('')
 }
 modal.showModal();
 if(type==='vehicle-add')initializeVehicleAddDialog();
 if(type==='document'){if(index===null||index===undefined)initializeDocumentUploadDialog();else initializeDocumentEditDialog()}
 if(type==='expense')initializeExpenseDialog()
}
window.openExpenseDeleteConfirm=function(index){
 const expense=state.expenses[index];if(!expense){toast('Expense not found');return}
 const linked=linkedDocumentForExpense(expense),dialog=ensureDynamicDialog('expenseDeleteDialog','expense-delete-dialog');
 dialog.innerHTML=`<div class="modal-header"><div><span class="wizard-eyebrow danger">DELETE EXPENSE</span><h3>Delete this expense?</h3><p>This removes the expense from totals and reports.</p></div><button type="button" class="icon-btn expense-delete-close">${svg('close')}</button></div><div class="expense-delete-body"><div class="expense-delete-summary"><span class="expense-delete-icon">${svg('trash')}</span><div><strong>${esc(expense.vendor||expense.notes||expense.category||'Expense')}</strong><small>${esc(shortDate(expense.date))} · ${esc(expense.category||'Other')} · ${money(expense.amount)}</small></div></div>${linked?`<div class="expense-delete-attachment">${fileTypeIcon(linked.doc,true)}<div><strong>${esc(linked.doc.name)}</strong><small>The linked document will remain in Documents.</small></div></div>`:''}</div><div class="modal-actions"><button type="button" class="secondary expense-delete-cancel">Cancel</button><button type="button" class="danger-button expense-delete-confirm">${svg('trash')} Delete Expense</button></div>`;
 const close=()=>dialog.close();dialog.querySelector('.expense-delete-close').onclick=close;dialog.querySelector('.expense-delete-cancel').onclick=close;dialog.querySelector('.expense-delete-confirm').onclick=async()=>{if(linked?.doc&&linked.doc.linkedExpenseId===expense.id)linked.doc.linkedExpenseId=null;state.expenses.splice(index,1);await saveNow();dialog.close();toast('Expense deleted');render()};dialog.showModal()
}
window.openDocumentDeleteConfirm=function(index){
 const documentRecord=state.documents[index];if(!documentRecord){toast('Document not found');return}
 const linkedExpenses=state.expenses.filter(expense=>expense.linkedDocumentId===documentRecord.id||expense.linkedDocumentStoredName===documentRecord.storedName||documentRecord.linkedExpenseId===expense.id),dialog=ensureDynamicDialog('documentDeleteDialog','document-delete-dialog');
 dialog.innerHTML=`<div class="modal-header"><div><span class="wizard-eyebrow danger">DELETE DOCUMENT</span><h3>Delete this document?</h3><p>The stored file and its local search index will be removed.</p></div><button type="button" class="icon-btn document-delete-close">${svg('close')}</button></div><div class="expense-delete-body"><div class="expense-delete-summary"><span class="expense-delete-icon">${fileTypeIcon(documentRecord,true)}</span><div><strong>${esc(documentRecord.name||'Document')}</strong><small>${esc(documentRecord.category||'Other')} · ${esc(documentRecord.size||formatBytes(documentRecord.bytes))}</small></div></div>${linkedExpenses.length?`<div class="expense-delete-attachment">${svg('dollar')}<div><strong>${linkedExpenses.length} linked expense${linkedExpenses.length===1?'':'s'} will be retained</strong><small>Only the attachment link will be cleared.</small></div></div>`:''}</div><div class="modal-actions"><button type="button" class="secondary document-delete-cancel">Cancel</button><button type="button" class="danger-button document-delete-confirm">${svg('trash')} Delete Document</button></div>`;
 const close=()=>dialog.close();dialog.querySelector('.document-delete-close').onclick=close;dialog.querySelector('.document-delete-cancel').onclick=close;dialog.querySelector('.document-delete-confirm').onclick=async()=>{const button=dialog.querySelector('.document-delete-confirm');button.disabled=true;try{if(documentRecord.storedName){const response=await fetch(`/api/documents/${encodeURIComponent(documentRecord.storedName)}`,{method:'DELETE'});if(!response.ok&&response.status!==404)throw new Error((await response.json().catch(()=>({}))).error||'Stored file could not be deleted')}linkedExpenses.forEach(expense=>{delete expense.linkedDocumentId;delete expense.linkedDocumentStoredName});state.documents.splice(index,1);await saveNow();dialog.close();toast('Document deleted');render()}catch(error){console.error(error);toast(error.message||'Unable to delete document');button.disabled=false}};dialog.showModal()
}
window.editRecord=function(type,index){const modalType=({maintenance:'service',service:'service',expense:'expense',expenses:'expense',document:'document',documents:'document',reminder:'reminder',reminders:'reminder',vehicle:'vehicle'})[type]||type;openModal(modalType,index)}
window.deleteRecord=async function(type,index){if(type==='reminder'){await deleteReminderRule(index);return}if(type==='expense'){openExpenseDeleteConfirm(index);return}if(type==='document'){openDocumentDeleteConfirm(index);return}const map={maintenance:'maintenance',expense:'expenses',document:'documents',reminder:'reminders'},arr=state[map[type]],item=arr?.[index];if(!item){toast('Record not found');return}if(type!=='maintenance'&&!confirm(`Delete ${item.name||item.vendor||'this record'}?`))return;arr.splice(index,1);save(type==='maintenance'?'Maintenance item deleted':'Record deleted');render()}
window.uploadVehicleImage=async function(input,vehicleId=state.activeVehicleId){
 const image=input?.files?.[0],vehicle=state.vehicles.find(v=>v.id===vehicleId);if(!image||!vehicle)return;
 try{
   const upload=new FormData();upload.append('file',image);if(vehicle.imageStoredName)upload.append('previousStoredName',vehicle.imageStoredName);
   const r=await fetch('/api/vehicle-image',{method:'POST',body:upload});if(!r.ok)throw new Error((await r.json().catch(()=>({}))).error||'Vehicle image upload failed');
   vehicle.imageStoredName=(await r.json()).storedName;await saveNow();toast('Vehicle image updated');render();
 }catch(err){console.error(err);toast(err.message||'Unable to upload image')}finally{if(input)input.value=''}
}
window.removeVehicleImage=async function(vehicleId=state.activeVehicleId){const vehicle=state.vehicles.find(v=>v.id===vehicleId);if(!vehicle?.imageStoredName||!confirm('Remove the uploaded vehicle image and return to the default image?'))return;await fetch(`/api/vehicle-image/${encodeURIComponent(vehicle.imageStoredName)}`,{method:'DELETE'}).catch(()=>{});vehicle.imageStoredName=null;await saveNow();toast('Vehicle image removed');render()}


function closeRecordModal(){const modal=document.getElementById('modal');clearDocumentUploadPreview();if(modal?.open)modal.close();modal?.classList.remove('document-upload-dialog');editing=null;const form=document.getElementById('modalForm');if(form)form.reset()}

function setProfileMenu(open){const menu=document.getElementById('profileMenu'),trigger=document.getElementById('profileTrigger');if(!menu||!trigger)return;menu.hidden=!open;trigger.setAttribute('aria-expanded',String(open));trigger.classList.toggle('open',open)}
async function openInfoModal(kind){
 setProfileMenu(false);
 const modal=document.getElementById('infoModal'),title=document.getElementById('infoModalTitle'),subtitle=document.getElementById('infoModalSubtitle'),body=document.getElementById('infoModalBody'),primary=document.getElementById('infoModalPrimary'),secondary=document.getElementById('infoModalSecondary');
 infoModalAction=null;primary.hidden=true;primary.textContent='Continue';secondary.textContent='Close';
 if(kind==='profile'){
   title.textContent='My Profile';subtitle.textContent='Local GarageLog account information.';
   body.innerHTML=`<div class="profile-info-card"><span class="profile-info-avatar">L</span><div><strong>Local User</strong><small>Private, self-hosted account</small></div></div><dl class="profile-detail-list"><div><dt>Storage mode</dt><dd>Local GarageLog instance</dd></div><div><dt>Active vehicle</dt><dd>${esc(vehicleFullName())}</dd></div><div><dt>Vehicles</dt><dd>${state.vehicles.length}</dd></div><div><dt>Data sharing</dt><dd>External sharing disabled</dd></div></dl>`;
 }else if(kind==='about'){
   const runtimeVersion=await getApplicationVersion();
   title.textContent='Help & About';subtitle.textContent='GarageLog local-first vehicle records.';
   body.innerHTML=`<div class="about-logo">${svg('shield')}<div><strong>GarageLog ${esc(runtimeVersion)}</strong><small>Local-first self-hosted release</small></div></div><div class="info-section"><h4>About</h4><p>GarageLog keeps vehicle, maintenance, expense, reminder, and document records on your own instance.</p></div><div class="info-section"><h4>Help</h4><p>Use Garage for vehicle details, Maintenance for service intervals, Documents for local files, and Reminders for date- or mileage-based rules.</p></div><div class="info-callout">GarageLog authentication is local to this self-hosted instance. Account records and vehicle data remain in the GarageLog data folder.</div>`;
 }else{
   title.textContent='Log out';subtitle.textContent='End this local browser session.';
   body.innerHTML=`<div class="logout-warning">${svg('logout')}<div><strong>Log out of GarageLog?</strong><p>Your local records will remain saved. This only closes the current interface session.</p></div></div>`;
   primary.hidden=false;primary.textContent='Log out';secondary.textContent='Cancel';infoModalAction=performLocalLogout;
 }
 modal.showModal();
}
async function performLocalLogout(){const modal=document.getElementById('infoModal');if(modal.open)modal.close();try{await fetch('/api/auth/logout',{method:'POST'})}catch{}authSession={configured:true,authenticated:false};state=null;managedUsers=[];renderAuthScreen('login')}


const REMINDER_OWNERSHIP_TEMPLATES=[
 {key:'registration-renewal',group:'Documents & compliance',name:'Registration Renewal',description:'Renew registration before the expiration date.',months:12,lead:45,recommended:true,powertrains:['all']},
 {key:'insurance-renewal',group:'Documents & compliance',name:'Insurance Renewal',description:'Review coverage and replace the stored insurance card.',months:6,lead:30,recommended:true,powertrains:['all']},
 {key:'state-inspection',group:'Documents & compliance',name:'State Inspection',description:'Schedule state safety or emissions inspection when required.',months:12,lead:45,recommended:false,powertrains:['all']},
 {key:'emergency-kit',group:'Ownership habits',name:'Review Emergency Kit',description:'Check first aid, flashlight, tools, and seasonal supplies.',months:6,lead:14,recommended:false,powertrains:['all'],checklist:['Check first-aid supplies and expiration dates','Test flashlight and replace weak batteries','Verify jumper cables or jump pack are charged','Check warning triangle, reflective vest, and roadside tools','Replace seasonal water, blanket, gloves, or sun protection']},
 {key:'odometer-update',group:'Ownership habits',name:'Update Odometer Reading',description:'Record current mileage so service forecasts remain accurate.',months:1,lead:3,recommended:true,powertrains:['all']},
 {key:'records-backup',group:'Ownership habits',name:'Back Up Vehicle Records',description:'Export a local copy of maintenance, expenses, and reminders.',months:3,lead:7,recommended:false,powertrains:['all']},
 {key:'condition-photos',group:'Ownership habits',name:'Photograph Vehicle Condition',description:'Keep periodic exterior and interior condition photos.',months:6,lead:14,recommended:false,powertrains:['all']},
 {key:'alignment-check',group:'Essential care',name:'Wheel Alignment Check',description:'Inspect alignment and tire wear, especially after an impact.',months:12,lead:30,recommended:false,powertrains:['all']},
 {key:'underbody-wash',group:'Seasonal care',name:'Underbody Wash & Corrosion Check',description:'Remove road salt and inspect exposed underbody components.',months:4,lead:14,recommended:false,powertrains:['all'],checklist:['Wash the underbody, wheel wells, and rocker panels','Inspect brake lines, fuel lines, and suspension hardware','Check frame, body seams, and fasteners for early corrosion','Clean trapped debris around shields and drain openings','Photograph and treat new rust before it spreads']},
 {key:'pre-winter-check',group:'Seasonal care',name:'Pre-Winter Vehicle Check',description:'Review battery, tires, antifreeze, washer fluid, and emergency supplies.',months:12,lead:30,recommended:false,powertrains:['all'],checklist:['Test the 12-volt battery and charging system','Check tire pressure, tread depth, and winter-tire condition','Verify coolant or antifreeze freeze protection','Install winter washer fluid and inspect wiper blades','Test heater, defroster, heated mirrors, and exterior lights','Inspect brakes and confirm the parking brake releases normally','Restock scraper, blanket, flashlight, gloves, and emergency supplies']},
 {key:'pre-summer-check',group:'Seasonal care',name:'Pre-Summer Cooling & A/C Check',description:'Inspect cooling performance, A/C operation, and travel readiness.',months:12,lead:30,recommended:false,powertrains:['all'],checklist:['Inspect coolant level, hoses, radiator, and visible leaks','Test air-conditioning temperature and blower operation','Check tire pressure, tread, and spare-tire condition','Test the battery and charging system','Inspect wipers and refill washer fluid','Check lights, brakes, and roadside emergency supplies','Review towing, travel, and cargo equipment before long trips']},
 {key:'twelve-volt-ev-battery',group:'Electrified vehicle care',name:'12-Volt Battery Test',description:'Test the low-voltage accessory battery used by hybrid and EV systems.',months:12,lead:30,recommended:true,powertrains:['Hybrid','Plug-in Hybrid','Electric (EV)']},
 {key:'ev-software-review',group:'Electrified vehicle care',name:'Vehicle Software Update Review',description:'Check for manufacturer software and charging-system updates.',months:6,lead:14,recommended:false,powertrains:['Plug-in Hybrid','Electric (EV)']},
 {key:'serpentine-belt',group:'Powertrain care',name:'Serpentine Belt & Hose Inspection',description:'Inspect accessory belts and cooling-system hoses for wear.',miles:30000,lead:1000,recommended:false,powertrains:['Gasoline / Internal Combustion','Diesel / Internal Combustion','Hybrid','Plug-in Hybrid']},
 {key:'differential-service',group:'Powertrain care',name:'Differential / Transfer Case Service',description:'Inspect or replace driveline fluids according to usage.',miles:60000,lead:1500,recommended:false,powertrains:['Gasoline / Internal Combustion','Diesel / Internal Combustion','Hybrid','Plug-in Hybrid']}
];
function reminderWizardTemplateCatalog(){
 const vehicle=activeVehicle(),powertrain=String(vehicle.powertrain||'Gasoline / Internal Combustion'),type=normalizedVehicleType(vehicle);
 const vehicleTemplates=applicableVehicleTemplates(powertrain,vehicle).map(item=>({...item,lead:item.lead??(item.miles?Math.min(1000,Math.max(100,Math.round(item.miles*.1))):30)}));
 const contextualOwnershipKeys={
   Motorcycle:new Set(['registration-renewal','insurance-renewal','state-inspection','odometer-update','records-backup','condition-photos']),
   Trailer:new Set(['registration-renewal','insurance-renewal','state-inspection','records-backup','condition-photos'])
 };
 const ownership=REMINDER_OWNERSHIP_TEMPLATES.filter(item=>powertrainMatchesTemplate(item,powertrain)&&(contextualOwnershipKeys[type]?contextualOwnershipKeys[type].has(item.key):true));
 const seen=new Set();
 return [...vehicleTemplates,...ownership].filter(item=>{const key=String(item.name).toLowerCase();if(seen.has(key))return false;seen.add(key);return true})
}
function maintenanceWizardTemplateCatalog(){return reminderWizardTemplateCatalog().filter(item=>item.target==='maintenance')}
function activeWizardTemplateCatalog(){return reminderWizardState?.mode==='maintenance'?maintenanceWizardTemplateCatalog():reminderWizardTemplateCatalog()}
function reminderTemplateByName(name,mode=reminderWizardState?.mode||'reminder'){const catalog=mode==='maintenance'?maintenanceWizardTemplateCatalog():reminderWizardTemplateCatalog();return catalog.find(item=>item.name===name)||null}
function templateChecklistFor(item){
 if(!item)return[];
 const list=Array.isArray(item.checklist)?[...item.checklist]:[];
 const powertrain=String(activeVehicle().powertrain||'');
 if(item.key==='pre-winter-check'&&/Electric \(EV\)|Plug-in Hybrid/i.test(powertrain))list.push('Review cold-weather range, battery preconditioning, and charging-cable operation');
 return list.map((entry,index)=>typeof entry==='string'?{id:`${item.key||'check'}-${index+1}`,label:entry,completed:false}:{id:entry.id||`${item.key||'check'}-${index+1}`,label:entry.label||entry.name||`Checklist item ${index+1}`,completed:Boolean(entry.completed)})
}
function calculateRecurringDue(startDate,frequency,unit){
 const date=new Date(`${startDate||new Date().toISOString().slice(0,10)}T12:00:00`);
 if(unit==='years')date.setFullYear(date.getFullYear()+Number(frequency||1));else date.setMonth(date.getMonth()+Number(frequency||1));
 return date.toISOString().slice(0,10)
}
function reminderWizardTemplateOptions(selected){
 const catalog=activeWizardTemplateCatalog(),groups=[...new Set(catalog.map(item=>item.group))],customLabel=reminderWizardState?.mode==='maintenance'?'Custom Maintenance':'Custom Reminder';
 return groups.map(group=>`<optgroup label="${esc(group)}">${catalog.filter(item=>item.group===group).map(item=>`<option value="${esc(item.name)}" ${item.name===selected?'selected':''}>${esc(item.name)}</option>`).join('')}</optgroup>`).join('')+`<optgroup label="Other"><option value="Custom" ${selected==='Custom'?'selected':''}>${customLabel}</option></optgroup>`
}
function isoDateValue(value){
 if(!value)return new Date().toISOString().slice(0,10);
 if(/^\d{4}-\d{2}-\d{2}$/.test(String(value)))return String(value);
 const date=new Date(value);return Number.isNaN(date.getTime())?new Date().toISOString().slice(0,10):new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,10)
}
function reminderTemplateCanCreateMaintenance(item){return Boolean(item&&(item.target==='maintenance'||templateChecklistFor(item).length>0))}
function reminderTemplateDefaults(template,mode=reminderWizardState?.mode||'reminder'){
 const item=reminderTemplateByName(template,mode),maintenanceMode=mode==='maintenance';
 if(!item||template==='Custom')return{checklist:[],createMaintenance:maintenanceMode,target:maintenanceMode?'maintenance':'reminder'};
 const checklist=templateChecklistFor(item),base={templateKey:item.key,target:item.target||'reminder',checklist,createMaintenance:maintenanceMode||reminderTemplateCanCreateMaintenance(item)};
 if(item.miles)return{...base,trigger:'mileage',repeatMiles:Number(item.miles),lead:Number(item.lead||500),leadUnit:'miles'};
 return{...base,trigger:'recurring',frequency:Number(item.months||12),frequencyUnit:'months',lead:Number(item.lead||30),leadUnit:'days'}
}
function reminderWizardDefaults(editIndex=null,mode='reminder'){
 const today=new Date().toISOString().slice(0,10),powertrain=String(activeVehicle().powertrain||'Gasoline / Internal Combustion');
 if(editIndex!==null&&state.reminders[editIndex]){
   const record=state.reminders[editIndex],catalog=reminderWizardTemplateCatalog(),matched=catalog.find(item=>item.key===record.templateKey||item.name===record.name),trigger=record.triggerType||(parseMileageValue(record.due)!==null?'mileage':/^Every /i.test(record.rule||'')?'recurring':'date');
   const mileage=parseMileageValue(record.due),repeatMatch=String(record.rule||'').match(/Every\s+([\d,]+)\s+miles?/i),timeMatch=String(record.rule||'').match(/Every\s+([\d,]+)\s+(months?|years?)/i),repeatMiles=Number(String(record.repeatMiles||repeatMatch?.[1]||'7500').replaceAll(',','')),rawServiceMileage=record.serviceMileage,storedServiceMileage=rawServiceMileage!==null&&rawServiceMileage!==undefined&&rawServiceMileage!==''&&Number.isFinite(Number(rawServiceMileage))?Number(rawServiceMileage):null,dueMileage=Number.isFinite(Number(mileage))?Number(mileage):Math.max(0,Number((storedServiceMileage??state.mileage)||0)+repeatMiles),serviceMileage=storedServiceMileage??Math.max(0,dueMileage-repeatMiles),dueDate=trigger==='mileage'?today:isoDateValue(record.due),startDate=isoDateValue(record.startDate||today);
   return{step:1,editIndex,mode:'reminder',template:matched?.name||'Custom',templateKey:record.templateKey||matched?.key||'',name:record.name||'',trigger,serviceMileage,dueMileage,dueMileageCustomized:true,repeatMiles,startMode:startDate===today?'today':'future',startDate,dueDate,frequency:Number(String(timeMatch?.[1]||'12').replaceAll(',','')),frequencyUnit:String(timeMatch?.[2]||'months').toLowerCase().startsWith('year')?'years':'months',lead:Number(record.leadTime??30),leadUnit:record.leadUnit||(trigger==='mileage'?'miles':'days'),checklist:checklistItemsFromRecord(record),checklistCustomized:true,createMaintenance:Boolean(record.maintenanceId||state.maintenance.some(item=>item.reminderId===record.id)||(matched&&reminderTemplateCanCreateMaintenance(matched)&&!record.maintenanceOptOut)),target:'reminder'}
 }
 const vehicleType=normalizedVehicleType(activeVehicle()),maintenanceMode=mode==='maintenance',preferred=vehicleType==='Motorcycle'?(maintenanceMode?'Motorcycle Tire & Wheel Check':'Pre-Ride Safety Check'):vehicleType==='Trailer'?(maintenanceMode?'Trailer Tire, Wheel & Spare Check':'Pre-Trip Trailer Safety Check'):/Electric \(EV\)/i.test(powertrain)?'Charging Connector Inspection':/Diesel/i.test(powertrain)?'Diesel Fuel Filter':'Oil & Filter Change',catalog=maintenanceMode?maintenanceWizardTemplateCatalog():reminderWizardTemplateCatalog(),first=catalog.find(item=>item.name===preferred)||catalog.find(item=>item.recommended)||catalog[0],defaults=reminderTemplateDefaults(first?.name||'Custom',mode);
 const serviceMileage=Number(state.mileage||0),repeatMiles=Number(defaults.repeatMiles||7500),result={step:1,editIndex:null,mode,template:first?.name||'Custom',templateKey:defaults.templateKey||'',name:first?.name||'',trigger:defaults.trigger||'recurring',serviceMileage,dueMileage:serviceMileage+repeatMiles,dueMileageCustomized:false,repeatMiles,startMode:'today',startDate:today,dueDate:today,frequency:Number(defaults.frequency||12),frequencyUnit:defaults.frequencyUnit||'months',lead:Number(defaults.lead??30),leadUnit:defaults.leadUnit||(defaults.trigger==='mileage'?'miles':'days'),checklist:defaults.checklist||[],checklistCustomized:false,createMaintenance:maintenanceMode||Boolean(defaults.createMaintenance),target:maintenanceMode?'maintenance':defaults.target||'reminder'};
 if(result.trigger==='recurring')result.dueDate=calculateRecurringDue(today,result.frequency,result.frequencyUnit);return result
}
function reminderWizardCollect(){
 const body=document.getElementById('reminderWizardBody');if(!body||!reminderWizardState)return;
 body.querySelectorAll('[data-wizard-field]').forEach(input=>{if(input.type==='radio'&&!input.checked)return;const key=input.dataset.wizardField;if(input.type==='checkbox')reminderWizardState[key]=input.checked;else reminderWizardState[key]=input.type==='number'?Number(input.value||0):input.value});
 if(reminderWizardState.trigger==='mileage')reminderWizardState.serviceMileage=Math.max(0,Number(reminderWizardState.dueMileage||0)-Math.max(0,Number(reminderWizardState.repeatMiles||0)))
}
window.selectReminderTrigger=function(trigger){
 reminderWizardCollect();const s=reminderWizardState,today=new Date().toISOString().slice(0,10);s.trigger=trigger;s.leadUnit=trigger==='mileage'?'miles':'days';
 if(trigger==='mileage'){if(!Number(s.repeatMiles))s.repeatMiles=7500;if(!Number.isFinite(Number(s.dueMileage))||Number(s.dueMileage)<=0){s.dueMileage=Number(state.mileage||0)+Number(s.repeatMiles||0);s.dueMileageCustomized=false}s.serviceMileage=Math.max(0,Number(s.dueMileage||0)-Number(s.repeatMiles||0))}
 if(trigger==='date'&&!s.dueDate)s.dueDate=today;
 if(trigger==='recurring'){s.startDate=s.startDate||today;s.dueDate=calculateRecurringDue(s.startMode==='future'?s.startDate:today,s.frequency||1,s.frequencyUnit||'months')}
 renderReminderWizard()
}
function renderReminderWizard(){
 const s=reminderWizardState,body=document.getElementById('reminderWizardBody'),subtitle=document.getElementById('reminderWizardSubtitle');if(!s||!body)return;
 const maintenanceMode=s.mode==='maintenance',wizard=document.getElementById('reminderWizard'),item=reminderTemplateByName(s.template,s.mode),vehicle=activeVehicle(),powertrain=String(vehicle.powertrain||'Gasoline / Internal Combustion'),templateChecklist=templateChecklistFor(item),selectedChecklist=Array.isArray(s.checklist)?s.checklist:templateChecklist,selectedCount=selectedChecklist.length;
 wizard.classList.toggle('maintenance-wizard-mode',maintenanceMode);
 wizard.querySelector('h3').textContent=maintenanceMode?'Add Maintenance':s.editIndex===null?'Create Reminder Rule':'Edit Reminder Rule';
 document.getElementById('reminderWizardSave').textContent=maintenanceMode?'Add Maintenance':s.editIndex===null?'Save Reminder':'Save Changes';
 wizard.dataset.step=String(s.step);
 document.querySelectorAll('#reminderWizard .wizard-progress-step').forEach((el,index)=>el.classList.toggle('active',index<s.step));
 document.querySelectorAll('#reminderWizard .wizard-progress-step span').forEach((el,index)=>el.classList.toggle('active',index<s.step));
 document.getElementById('reminderWizardBack').hidden=s.step===1;
 document.getElementById('reminderWizardNext').hidden=s.step===4;
 document.getElementById('reminderWizardSave').hidden=s.step!==4;

 if(s.step===1){
   subtitle.textContent=maintenanceMode?'Choose a vehicle-specific maintenance template and starting schedule.':'Choose a vehicle-specific template and checklist.';
   const detail=item?`<div class="wizard-template-detail horizontal"><div><span class="wizard-template-badge">${esc(item.group)}</span><strong>${esc(item.description)}</strong><small>${maintenanceMode?'This creates a Maintenance item and a synchronized reminder.':reminderTemplateCanCreateMaintenance(item)?'This task can create a linked Maintenance item.':'This is normally a reminder-only rule.'}${templateChecklist.length?` ${selectedCount} of ${templateChecklist.length} checklist steps selected.`:''}</small></div>${templateChecklist.length?`<button type="button" class="secondary checklist-preview-button" onclick='openWizardChecklistByName(${jsQuote(item.name)})'>${svg('check')} Select checklist (${selectedCount})</button>`:''}</div>`:`<div class="wizard-template-detail horizontal"><div><span class="wizard-template-badge">Custom</span><strong>${maintenanceMode?'Create a custom maintenance schedule.':'Create a reminder without a preset schedule.'}</strong><small>You will choose the name, trigger, and schedule in the next steps.</small></div></div>`;
   body.innerHTML=`<div class="wizard-step wizard-step-template"><div class="wizard-template-layout"><div class="wizard-template-column"><div class="wizard-template-context"><span>${svg(/Electric \(EV\)/i.test(powertrain)?'battery':'car')}</span><div><small>Active vehicle</small><strong>${esc(vehicleFullName(vehicle))}</strong><em>${esc(normalizedVehicleType(vehicle))} · ${esc(powertrain)}</em></div></div><label>${maintenanceMode?'Maintenance':'Reminder'} template<select data-wizard-field="template">${reminderWizardTemplateOptions(s.template)}</select><small class="wizard-field-help">Filtered by vehicle type and powertrain. Manufacturer schedules should override GarageLog defaults.</small></label></div><div class="wizard-template-column wizard-template-preview"><div class="wizard-section-kicker">Template details</div>${detail}</div></div></div>`;
   const template=body.querySelector('[data-wizard-field="template"]');
   template.addEventListener('change',()=>{reminderWizardCollect();const mode=reminderWizardState.mode||'reminder',defaults=reminderTemplateDefaults(template.value,mode),today=new Date().toISOString().slice(0,10),editIndex=reminderWizardState.editIndex,serviceMileage=Number(state.mileage||0);reminderWizardState={...reminderWizardState,...defaults,mode,step:1,editIndex,template:template.value,name:template.value==='Custom'?'':template.value,startMode:'today',startDate:today,checklistCustomized:false,createMaintenance:mode==='maintenance'||Boolean(defaults.createMaintenance)};if(defaults.trigger==='mileage'){reminderWizardState.serviceMileage=serviceMileage;reminderWizardState.dueMileage=serviceMileage+Number(defaults.repeatMiles||0);reminderWizardState.dueMileageCustomized=false}else reminderWizardState.dueDate=defaults.trigger==='recurring'?calculateRecurringDue(today,defaults.frequency||1,defaults.frequencyUnit||'months'):today;renderReminderWizard()});
 }
 else if(s.step===2){
   subtitle.textContent=maintenanceMode?'Name the maintenance task and choose how its interval is measured.':'Name the task, choose its trigger, and decide whether it belongs in Maintenance.';
   body.innerHTML=`<div class="wizard-step wizard-step-task"><div class="wizard-task-layout"><div class="wizard-task-details"><div class="wizard-section-kicker">Task details</div><label>${maintenanceMode?'Maintenance name':'Reminder name'}<input data-wizard-field="name" value="${esc(s.name)}" placeholder="${maintenanceMode?'Maintenance task':'Reminder name'}"></label>${maintenanceMode?`<div class="wizard-maintenance-option maintenance-required"><span>${svg('bell')}</span><span><strong>Maintenance and reminder stay synchronized</strong><small>GarageLog creates the Maintenance item and its due alert together.</small></span></div>`:`<label class="wizard-maintenance-option"><input type="checkbox" data-wizard-field="createMaintenance" ${s.createMaintenance?'checked':''}><span><strong>Create linked maintenance item?</strong><small>${reminderTemplateCanCreateMaintenance(item)?'Recommended for this actionable vehicle-care task.':'Optional for this reminder.'}</small></span></label>`}${templateChecklist.length?`<div class="wizard-inline-checklist"><span>${svg('check')}</span><div><strong>${selectedCount} checklist item${selectedCount===1?'':'s'} selected</strong><small>The checklist follows both the reminder and linked maintenance item.</small></div><button type="button" class="link-button" onclick='openWizardChecklistByName(${jsQuote(s.template)})'>Edit</button></div>`:''}</div><fieldset class="wizard-choice-grid horizontal"><legend>Trigger type</legend>${[['mileage','Mileage','Based on odometer mileage','gauge'],['date','Specific date','One-time calendar date','calendar'],['recurring','Recurring','Repeats by month or year','clock']].map(([value,label,copy,icon])=>`<label class="wizard-choice ${s.trigger===value?'selected':''}" onclick="selectReminderTrigger('${value}')"><input type="radio" data-wizard-field="trigger" value="${value}" ${s.trigger===value?'checked':''}><span>${svg(icon)}</span><strong>${label}</strong><small>${copy}</small></label>`).join('')}</fieldset></div></div>`;
 }
 else if(s.step===3){
   subtitle.textContent='Set the due point and repeat schedule.';
   let schedule='';
   if(s.trigger==='mileage')schedule=`<div class="wizard-schedule-grid mileage"><div class="wizard-schedule-hero"><span>${svg('gauge')}</span><div><small>Current odometer</small><strong>${number(state.mileage)} mi</strong><em>GarageLog calculated the next due mileage from the current odometer and service interval. Adjust it if needed.</em></div></div><label><span class="wizard-field-label"><span>Next due mileage</span><span class="wizard-auto-badge">${s.dueMileageCustomized?(s.editIndex!==null?'Saved value':'Adjusted'):'Auto-calculated'}</span></span><input type="number" data-wizard-field="dueMileage" value="${Number(s.dueMileage||0)}" min="0"><small class="wizard-field-help">Editable mileage when this service should next be completed</small></label><label>Repeat every<input type="number" data-wizard-field="repeatMiles" value="${Number(s.repeatMiles||0)}" min="1"><small class="wizard-field-help">Recommended mileage interval</small></label></div>`;
   else if(s.trigger==='date')schedule=`<div class="wizard-schedule-grid date"><div class="wizard-schedule-hero"><span>${svg('calendar')}</span><div><small>One-time reminder</small><strong>Specific calendar date</strong><em>No repeat rule will be created.</em></div></div><label>Reminder date<input type="date" data-wizard-field="dueDate" value="${esc(s.dueDate)}"></label><div class="wizard-schedule-note">GarageLog will notify you before this date using the warning setting on the next step.</div></div>`;
   else schedule=`<div class="wizard-schedule-grid recurring"><div class="wizard-schedule-hero"><span>${svg('clock')}</span><div><small>Recurring schedule</small><strong>${esc(s.name||'Reminder')}</strong><em>Choose when the cycle begins and how often it repeats.</em></div></div><label>Schedule begins<select data-wizard-field="startMode"><option value="today" ${s.startMode==='today'?'selected':''}>Today</option><option value="future" ${s.startMode==='future'?'selected':''}>Future date</option></select></label>${s.startMode==='future'?`<label>Future start date<input type="date" data-wizard-field="startDate" min="${new Date().toISOString().slice(0,10)}" value="${esc(s.startDate)}"></label>`:'<div class="wizard-schedule-note compact">The recurrence is anchored to today.</div>'}<label>First due date<input type="date" data-wizard-field="dueDate" value="${esc(s.dueDate)}"></label><label>Repeat every<div class="wizard-inline-fields"><input type="number" data-wizard-field="frequency" value="${Number(s.frequency||1)}" min="1"><select data-wizard-field="frequencyUnit"><option value="months" ${s.frequencyUnit==='months'?'selected':''}>Months</option><option value="years" ${s.frequencyUnit==='years'?'selected':''}>Years</option></select></div></label><button type="button" class="secondary wizard-recalculate" onclick="recalculateReminderDue()">Recalculate first due date</button></div>`;
   body.innerHTML=`<div class="wizard-step wizard-step-schedule"><div class="wizard-section-kicker">${s.trigger==='mileage'?'Mileage schedule':s.trigger==='date'?'Calendar schedule':'Recurring schedule'}</div>${schedule}</div>`;
   body.querySelector('[data-wizard-field="startMode"]')?.addEventListener('change',event=>{reminderWizardCollect();const stateRef=reminderWizardState,today=new Date().toISOString().slice(0,10);if(event.target.value==='future'&&(!stateRef.startDate||stateRef.startDate===today)){const future=new Date();future.setMonth(future.getMonth()+1);stateRef.startDate=future.toISOString().slice(0,10)}else if(event.target.value==='today')stateRef.startDate=today;stateRef.dueDate=calculateRecurringDue(stateRef.startDate,stateRef.frequency,stateRef.frequencyUnit);renderReminderWizard()});
 }
 else{
   subtitle.textContent='Review the rule and choose the advance warning.';
   const mileage=s.trigger==='mileage',summaryDue=mileage?`${number(Number(s.dueMileage||0))} mi`:new Date(`${s.dueDate}T12:00:00`).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}),repeatCopy=mileage?`Every ${number(s.repeatMiles)} miles`:s.trigger==='recurring'?`Every ${number(s.frequency)} ${esc(s.frequencyUnit)}`:'One-time reminder';
   body.innerHTML=`<div class="wizard-step wizard-step-review"><div class="wizard-review-layout"><div class="wizard-review-settings"><div class="wizard-section-kicker">Advance warning</div><div class="wizard-two-column"><label>Warn me<input type="number" data-wizard-field="lead" value="${Number(s.lead||0)}" min="0"></label><label>Before due<select data-wizard-field="leadUnit"><option value="${mileage?'miles':'days'}">${mileage?'Miles':'Days'}</option></select></label></div>${maintenanceMode?`<div class="wizard-maintenance-option compact maintenance-required"><span>${svg('wrench')}</span><span><strong>Maintenance schedule with linked reminder</strong><small>${selectedChecklist.length?`Includes ${selectedChecklist.length} checklist step${selectedChecklist.length===1?'':'s'}.`:'The due alert stays synchronized with this maintenance item.'}</small></span></div>`:`<label class="wizard-maintenance-option compact"><input type="checkbox" data-wizard-field="createMaintenance" ${s.createMaintenance?'checked':''}><span><strong>Create linked maintenance item</strong><small>${selectedChecklist.length?`Includes ${selectedChecklist.length} checklist step${selectedChecklist.length===1?'':'s'}.`:'Keeps Maintenance synchronized with this rule.'}</small></span></label>`}${templateChecklist.length?`<button type="button" class="secondary checklist-preview-button final" onclick='openWizardChecklistByName(${jsQuote(s.template)})'>${svg('check')} Edit checklist (${selectedCount})</button>`:''}</div><div class="wizard-summary review"><span class="wizard-summary-icon ${maintenanceTone(s.name)}">${svg(maintenanceIcon(s.name))}</span><div><small>Rule summary</small><strong>${esc(s.name)}</strong><dl><div><dt>${mileage?'Next due':'Due'}</dt><dd>${esc(summaryDue)}</dd></div><div><dt>Repeats</dt><dd>${repeatCopy}</dd></div>${s.trigger==='recurring'?`<div><dt>Starts</dt><dd>${new Date(`${s.startDate}T12:00:00`).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</dd></div>`:''}<div><dt>Vehicle</dt><dd>${esc(vehicleFullName(vehicle))}</dd></div></dl><p>Warning begins ${number(s.lead)} ${mileage?'miles':'days'} before due.</p></div></div></div></div>`;
 }
 body.querySelectorAll('[data-wizard-field]').forEach(input=>input.addEventListener('input',event=>{const field=event.currentTarget.dataset.wizardField;if(field==='dueMileage'){reminderWizardState.dueMileageCustomized=true;const badge=body.querySelector('.wizard-auto-badge');if(badge)badge.textContent='Adjusted'}reminderWizardCollect();if(field==='repeatMiles'&&reminderWizardState.trigger==='mileage'&&!reminderWizardState.dueMileageCustomized){reminderWizardState.dueMileage=Number(state.mileage||0)+Math.max(0,Number(reminderWizardState.repeatMiles||0));reminderWizardState.serviceMileage=Math.max(0,Number(reminderWizardState.dueMileage||0)-Number(reminderWizardState.repeatMiles||0));const dueInput=body.querySelector('[data-wizard-field="dueMileage"]');if(dueInput)dueInput.value=String(reminderWizardState.dueMileage);const badge=body.querySelector('.wizard-auto-badge');if(badge)badge.textContent='Auto-calculated'}}));
}
window.recalculateReminderDue=function(){reminderWizardCollect();const s=reminderWizardState;s.dueDate=calculateRecurringDue(s.startDate,s.frequency,s.frequencyUnit);renderReminderWizard();toast('First due date recalculated')};
window.openReminderWizard=function(index=null){if(!canWrite()){toast('This account has read-only access.');return}reminderWizardState=reminderWizardDefaults(index,'reminder');renderReminderWizard();document.getElementById('reminderWizard').showModal()};
window.openMaintenanceWizard=function(){reminderWizardState=reminderWizardDefaults(null,'maintenance');reminderWizardState.createMaintenance=true;renderReminderWizard();document.getElementById('reminderWizard').showModal()};
window.openReminderWizardForTemplate=function(name){if(!canWrite()){toast('This account has read-only access.');return}const defaults=reminderTemplateDefaults(name,'reminder'),today=new Date().toISOString().slice(0,10),serviceMileage=Number(state.mileage||0),repeatMiles=Number(defaults.repeatMiles||7500);reminderWizardState={...reminderWizardDefaults(null,'reminder'),...defaults,mode:'reminder',step:1,editIndex:null,template:name,name,serviceMileage,repeatMiles,dueMileage:serviceMileage+repeatMiles,dueMileageCustomized:false,startMode:'today',startDate:today,checklist:defaults.checklist||[],checklistCustomized:false,createMaintenance:Boolean(defaults.createMaintenance)};if(defaults.trigger==='recurring')reminderWizardState.dueDate=calculateRecurringDue(today,defaults.frequency||1,defaults.frequencyUnit||'months');renderReminderWizard();document.getElementById('reminderWizard').showModal()};
window.editReminderRule=function(index){openReminderWizard(index)};
function checklistItemsFromRecord(record){return(Array.isArray(record?.checklist)?record.checklist:[]).map((item,index)=>typeof item==='string'?{id:`item-${index+1}`,label:item,completed:false}:{id:item.id||`item-${index+1}`,label:item.label||item.name||`Checklist item ${index+1}`,completed:Boolean(item.completed)})}
function reminderChecklistItems(record){
 const own=checklistItemsFromRecord(record);
 if(own.length)return own;
 if(record?.maintenanceId){
   const linked=state.maintenance.find(item=>item.id===record.maintenanceId);
   const linkedItems=checklistItemsFromRecord(linked);
   if(linkedItems.length)return linkedItems
 }
 return[]
}
function reminderHasChecklist(record){return reminderChecklistItems(record).length>0}

function openChecklistDialog(title,subtitle,items,context){
 checklistDialogContext={...(context||{mode:'preview'}),items:items.map(item=>({...item}))};const mode=checklistDialogContext.mode,dialog=document.getElementById('checklistDialog'),save=document.getElementById('checklistDialogSave');document.getElementById('checklistDialogTitle').textContent=title;document.getElementById('checklistDialogSubtitle').textContent=subtitle;save.hidden=mode==='preview';save.textContent=mode==='wizard'?'Save Checklist':'Save Progress';
 document.getElementById('checklistDialogBody').innerHTML=`<div class="checklist-progress-copy">${items.length} available step${items.length===1?'':'s'}</div><div class="checklist-items">${items.map((item,index)=>{const checked=mode==='wizard'?item.selected!==false:Boolean(item.completed),small=mode==='wizard'?(checked?'Included in this reminder':'Not included'):(checked?'Completed':'Not completed');return `<label><input type="checkbox" data-checklist-index="${index}" ${checked?'checked':''}><span><strong>${esc(item.label)}</strong><small>${small}</small></span></label>`}).join('')}</div>${mode==='preview'?'<div class="checklist-preview-note">This is a preview.</div>':mode==='wizard'?'<div class="checklist-preview-note">Choose the steps that should be attached to this reminder and maintenance item.</div>':''}`;dialog.showModal()
}
window.openWizardChecklistByName=function(name){const item=reminderTemplateByName(name),available=templateChecklistFor(item);if(!available.length){toast('This template does not include a checklist');return}const selectedIds=new Set((reminderWizardState?.checklist||[]).map(entry=>entry.id));openChecklistDialog(item.name,item.description,available.map(entry=>({...entry,selected:selectedIds.has(entry.id)})),{mode:'wizard',templateName:name})};
window.openTemplateChecklistByName=function(name){if(reminderWizardState&&document.getElementById('reminderWizard').open){openWizardChecklistByName(name);return}const item=reminderTemplateByName(name),items=templateChecklistFor(item);if(!items.length){toast('This template does not include a checklist');return}openChecklistDialog(item.name,item.description,items,{mode:'preview',templateName:name})};
window.openRecordChecklist=function(type,index){const collection=type==='maintenance'?state.maintenance:state.reminders,record=collection[index],items=type==='reminder'?reminderChecklistItems(record):checklistItemsFromRecord(record);if(!record||!items.length){toast('No checklist is attached to this item');return}if(type==='reminder'&&!checklistItemsFromRecord(record).length)record.checklist=items.map(item=>({...item}));openChecklistDialog(record.name,`${type==='maintenance'?'Maintenance':'Reminder'} checklist for ${vehicleFullName()}.`,items,{mode:'record',type,index})};
async function saveChecklistProgress(){
 const context=checklistDialogContext;if(!context)return;
 if(context.mode==='wizard'){const selected=context.items.filter((item,index)=>Boolean(document.querySelector(`#checklistDialog [data-checklist-index="${index}"]`)?.checked)).map(item=>({id:item.id,label:item.label,completed:false}));reminderWizardState.checklist=selected;reminderWizardState.checklistCustomized=true;document.getElementById('checklistDialog').close();toast(`${selected.length} checklist item${selected.length===1?'':'s'} selected`);renderReminderWizard();return}
 if(context.mode!=='record')return;const collection=context.type==='maintenance'?state.maintenance:state.reminders,record=collection[context.index];if(!record)return;const prior=checklistItemsFromRecord(record);record.checklist=prior.map((item,index)=>({...item,completed:Boolean(document.querySelector(`#checklistDialog [data-checklist-index="${index}"]`)?.checked)}));record.checklistUpdatedAt=new Date().toISOString();
 const applyChecklistProgress=target=>{if(!target)return;const items=checklistItemsFromRecord(target),completed=items.filter(item=>item.completed).length;target.progress=completed;target.max=items.length;target.checklistProgress=true;target.checklistUpdatedAt=record.checklistUpdatedAt};
 applyChecklistProgress(record);
 if(context.type==='reminder'&&record.maintenanceId){const linked=state.maintenance.find(item=>item.id===record.maintenanceId);if(linked){linked.checklist=record.checklist.map(item=>({...item}));applyChecklistProgress(linked)}}else if(context.type==='maintenance'&&record.reminderId){const linked=state.reminders.find(item=>item.id===record.reminderId);if(linked){linked.checklist=record.checklist.map(item=>({...item}));applyChecklistProgress(linked)}}
 await saveNow();document.getElementById('checklistDialog').close();toast('Checklist progress saved');render()
}
async function saveReminderWizard(){
 reminderWizardCollect();const s=reminderWizardState,maintenanceMode=s.mode==='maintenance';if(maintenanceMode)s.createMaintenance=true;if(!s.name?.trim()){toast(maintenanceMode?'Enter a maintenance name':'Enter a reminder name');s.step=2;renderReminderWizard();return}
 let due='',rule='',status='Upcoming';
 if(s.trigger==='mileage'){const dueMileage=Number(s.dueMileage),repeatMiles=Number(s.repeatMiles);if(!Number.isFinite(dueMileage)||dueMileage<0||!Number.isFinite(repeatMiles)||repeatMiles<=0){toast('Enter a valid next due mileage and repeat interval');s.step=3;renderReminderWizard();return}s.dueMileage=dueMileage;s.serviceMileage=Math.max(0,dueMileage-repeatMiles);due=`${number(dueMileage)} mi`;rule=`Every ${number(repeatMiles)} miles`;const remaining=dueMileage-Number(state.mileage||0);status=remaining<0?'Overdue':remaining<=Number(s.lead||0)?'Due Soon':'Upcoming'}
 else{if(!s.dueDate){toast('Choose a due date');s.step=3;renderReminderWizard();return}due=s.dueDate;rule=s.trigger==='recurring'?`Every ${number(s.frequency)} ${s.frequencyUnit}`:'One-time date';const days=Math.ceil((new Date(`${s.dueDate}T12:00:00`).getTime()-Date.now())/86400000);status=days<0?'Overdue':days<=Number(s.lead||0)?'Due Soon':'Upcoming'}
 const item=reminderTemplateByName(s.template),checklist=(Array.isArray(s.checklist)?s.checklist:templateChecklistFor(item)).map(entry=>({...entry,completed:Boolean(entry.completed)})),existing=s.editIndex!==null?state.reminders[s.editIndex]:null,reminderId=existing?.id||makeRecordId('reminder');
 const reminder={...existing,id:reminderId,vehicleId:existing?.vehicleId||state.activeVehicleId,name:s.name.trim(),rule,due,status,triggerType:s.trigger,serviceMileage:s.trigger==='mileage'?Number(s.serviceMileage):null,repeatMiles:s.trigger==='mileage'?Number(s.repeatMiles):null,startDate:s.trigger==='recurring'?s.startDate:null,leadTime:Number(s.lead||0),leadUnit:s.trigger==='mileage'?'miles':'days',templateKey:item?.key||s.templateKey||null,checklist,maintenanceOptOut:!s.createMaintenance,createdAt:existing?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString(),source:maintenanceMode?'maintenance-wizard':'reminder-wizard'};
 if(existing)state.reminders[s.editIndex]=reminder;else state.reminders.unshift(reminder);
 let linked=existing?.maintenanceId?state.maintenance.find(entry=>entry.id===existing.maintenanceId):state.maintenance.find(entry=>entry.reminderId===reminderId);
 if(s.createMaintenance){const interval=s.trigger==='mileage'?`${number(s.repeatMiles||0)} mi`:s.trigger==='recurring'?`${number(s.frequency||1)} ${s.frequencyUnit}`:'One-time',intervalMax=s.trigger==='mileage'?Number(s.repeatMiles||0):s.trigger==='recurring'?Number(s.frequency||1):1,completedChecklist=checklist.filter(entry=>entry.completed).length,progress=s.trigger==='mileage'?Math.max(0,Number(state.mileage||0)-Number(s.serviceMileage||0)):checklist.length?completedChecklist:0,max=s.trigger==='mileage'?intervalMax:checklist.length||intervalMax,checklistProgress=s.trigger!=='mileage'&&checklist.length>0,linkedFields={name:s.name.trim(),interval,progress,max,due,status,serviceMileage:s.trigger==='mileage'?Number(s.serviceMileage):null,repeatMiles:s.trigger==='mileage'?Number(s.repeatMiles):null,leadTime:Number(s.lead||0),templateKey:item?.key||s.templateKey||null,checklist:checklist.map(entry=>({...entry})),checklistProgress,reminderId};if(linked){Object.assign(linked,linkedFields)}else{linked={id:makeRecordId('maintenance'),vehicleId:reminder.vehicleId,...linkedFields,source:maintenanceMode?'maintenance-wizard':'reminder-wizard'};state.maintenance.unshift(linked)}reminder.maintenanceId=linked.id}
 else if(linked){state.maintenance=state.maintenance.filter(entry=>entry.id!==linked.id);delete reminder.maintenanceId}
 await saveNow();document.getElementById('reminderWizard').close();toast(maintenanceMode?'Maintenance schedule and reminder created':existing?'Reminder rule updated':s.createMaintenance?'Reminder and maintenance item created':'Reminder rule created');render()
}
window.advanceReminderTimeline=function(){const count=activeReminders().filter(item=>String(item.status||'').toLowerCase()!=='completed').length;if(count<=4)return;reminderTimelineOffset=(reminderTimelineOffset+1)%count;render()};
window.markReminderComplete=async function(index){const reminder=state.reminders[index];if(!reminder)return;reminder.status='Completed';reminder.completedAt=new Date().toISOString();if(reminder.maintenanceId){const linked=state.maintenance.find(item=>item.id===reminder.maintenanceId);if(linked)linked.status='Completed'}await saveNow();toast('Reminder marked completed');render()};
window.duplicateReminderRule=async function(index){const source=state.reminders[index];if(!source)return;const copy={...source,id:makeRecordId('reminder'),name:`${source.name} Copy`,status:'Upcoming',createdAt:new Date().toISOString(),updatedAt:null,maintenanceId:null,checklist:checklistItemsFromRecord(source).map(item=>({...item,completed:false}))};delete copy.maintenanceId;state.reminders.unshift(copy);await saveNow();toast('Reminder rule duplicated');render()};
window.deleteReminderRule=async function(index){const reminder=state.reminders[index];if(!reminder)return;state.maintenance=state.maintenance.filter(item=>item.id!==reminder.maintenanceId&&item.reminderId!==reminder.id);state.reminders.splice(index,1);await saveNow();toast('Reminder and associated checklist removed');render()};

window.openGarageExport=function(){document.getElementById('exportRecordsDialog').showModal()}
function downloadLocalFile(filename,content,type){const url=URL.createObjectURL(new Blob([content],{type})),link=document.createElement('a');link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function exportGarageRecords(form){
 const selected=new Set(new FormData(form).getAll('recordType')),format=new FormData(form).get('format')||'csv',vehicle=activeVehicle(),payload={exportedAt:new Date().toISOString(),vehicle:{...vehicle,imageStoredName:undefined},maintenance:selected.has('maintenance')?activeMaintenance():[],expenses:selected.has('expenses')?activeExpenses():[],reminders:selected.has('reminders')?activeReminders():[],documents:selected.has('documents')?activeDocuments().map(({storedName,...doc})=>doc):[]};
 const safeName=vehicleFullName().replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'').toLowerCase()||'vehicle';
 if(format==='json'){downloadLocalFile(`garagelog-${safeName}-records.json`,JSON.stringify(payload,null,2),'application/json');return}
 const rows=[['Record Type','Date / Due','Name / Category','Details','Amount / Status','Vehicle']];
 if(selected.has('maintenance'))payload.maintenance.forEach(x=>rows.push(['Maintenance',x.due,x.name,x.interval,x.status,vehicleFullName()]));
 if(selected.has('expenses'))payload.expenses.forEach(x=>rows.push(['Expense',x.date,x.category,`${x.vendor||''}${x.notes?` - ${x.notes}`:''}`,x.amount,vehicleFullName()]));
 if(selected.has('reminders'))payload.reminders.forEach(x=>rows.push(['Reminder',x.due,x.name,x.rule,x.status,vehicleFullName()]));
 if(selected.has('documents'))payload.documents.forEach(x=>rows.push(['Document',x.date,x.name,x.category,x.size,vehicleFullName()]));
 const csv=rows.map(row=>row.map(value=>`"${String(value??'').replaceAll('"','""')}"`).join(',')).join('\n');downloadLocalFile(`garagelog-${safeName}-records.csv`,csv,'text/csv;charset=utf-8');
}
window.printServiceHistory=function(){
 const vehicle=activeVehicle(),services=activeExpenses().filter(x=>['Maintenance','Repair','Parts'].includes(x.category)).sort((a,b)=>String(b.date).localeCompare(String(a.date))),schedule=activeMaintenance(),total=services.reduce((sum,x)=>sum+Number(x.amount||0),0),popup=openCenteredWindow('','garageLogServiceHistory',1040,780);if(!popup){toast('Allow pop-ups to open the printable service report');return}
 const serviceRows=services.map(x=>`<tr><td>${esc(x.date)}</td><td>${esc(x.notes||x.category)}</td><td>${esc(x.vendor||'—')}</td><td>${esc(x.category)}</td><td>${esc(expenseCoverageSummary(x)||'Out of pocket')}</td><td class="amount">${money(x.amount)}</td></tr>`).join('')||'<tr><td colspan="6">No completed service expenses recorded.</td></tr>';
 const scheduleRows=schedule.map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.interval||'—')}</td><td>${esc(x.due||'—')}</td><td>${esc(x.status||'—')}</td></tr>`).join('')||'<tr><td colspan="4">No maintenance schedule recorded.</td></tr>';
 popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>GarageLog Service History - ${esc(vehicleFullName())}</title><link rel="icon" type="image/png" href="${APP_FAVICON_PATH}"><style>body{font-family:Segoe UI,Arial,sans-serif;color:#172033;margin:36px;font-size:12px}.report-actions{position:sticky;top:0;display:flex;justify-content:flex-end;gap:8px;padding:10px 0 16px;background:#fff;z-index:2}.report-actions button{border:1px solid #cfd7e3;background:#fff;border-radius:7px;padding:8px 12px;cursor:pointer}.report-actions .primary{background:#2563eb;color:#fff;border-color:#2563eb}header{display:grid;grid-template-columns:minmax(0,1fr) 190px auto;gap:22px;align-items:center;border-bottom:3px solid #2563eb;padding-bottom:18px;margin-bottom:22px}h1{margin:0;font-size:26px}.report-vehicle-photo{height:100px;display:grid;place-items:center;border:1px solid #dde3ec;border-radius:10px;background:#f8fafc;overflow:hidden}.report-vehicle-photo img{display:block;max-width:100%;max-height:96px;object-fit:contain}.generated{text-align:right;color:#667085}@media(max-width:760px){header{grid-template-columns:1fr}.generated{text-align:left}}h2{font-size:16px;margin:28px 0 10px}.brand{color:#2563eb;font-weight:800;font-size:18px}.meta{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;background:#f6f8fb;border:1px solid #dde3ec;border-radius:10px;padding:14px}.meta span{display:block;color:#667085;font-size:10px}.meta strong{display:block;margin-top:4px}table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #dde3ec;padding:10px;text-align:left}th{background:#f6f8fb;color:#475467;font-size:10px;text-transform:uppercase}.amount{text-align:right;font-weight:700}.total{display:flex;justify-content:flex-end;margin-top:12px;font-size:15px}.footer{margin-top:30px;padding-top:12px;border-top:1px solid #dde3ec;color:#667085;font-size:10px}@page{margin:.55in}@media print{body{margin:0}.report-actions{display:none}}</style></head><body><div class="report-actions"><button onclick="window.close()">Close</button><button onclick="window.opener?.saveReportSetupForTemplate?.('maintenance-history')">Save Report Setup</button><button class="primary" onclick="window.print()">Print / Save as PDF</button></div><header><div><div class="brand">GarageLog</div><h1>Service History</h1><p>${esc(vehicleFullName())}</p></div><div class="report-vehicle-photo"><img src="${vehicleImageUrl(vehicle)}" alt="${esc(vehicleFullName(vehicle))}" onerror="this.onerror=null;this.src='${vehicleDefaultImageUrl(vehicle)}'"></div><div class="generated">Generated ${new Date().toLocaleString()}</div></header><section class="meta"><div><span>Mileage</span><strong>${number(vehicle.mileage)} mi</strong></div><div><span>VIN</span><strong>${esc(vehicle.vin||'Not entered')}</strong></div><div><span>Engine</span><strong>${esc(vehicle.engine||'Not entered')}</strong></div><div><span>Drivetrain</span><strong>${esc(vehicle.drivetrain||'Not entered')}</strong></div></section><h2>Completed Service & Repairs</h2><table><thead><tr><th>Date</th><th>Service</th><th>Shop</th><th>Category</th><th>Coverage</th><th class="amount">Paid</th></tr></thead><tbody>${serviceRows}</tbody></table><div class="total"><strong>Total out-of-pocket service cost: ${money(total)}</strong></div><h2>Maintenance Schedule</h2><table><thead><tr><th>Item</th><th>Interval</th><th>Next Due</th><th>Status</th></tr></thead><tbody>${scheduleRows}</tbody></table><div class="footer">Private local report generated by GarageLog. Review vehicle manufacturer recommendations before relying on maintenance intervals.</div></body></html>`);popup.document.close();popup.focus();
}


window.printExpenseReport=function(mode='full'){
 const vehicle=activeVehicle(),all=[...activeExpenses()].sort((a,b)=>(parseRecordDate(b.date)?.getTime()||0)-(parseRecordDate(a.date)?.getTime()||0)),now=new Date(),year=now.getFullYear();
 const selectedRange=resolveExpenseDateRange(reportPeriod,reportCustomRange,all,now);
 const taxRange={start:new Date(year,0,1,0,0,0,0),end:new Date(year,11,31,23,59,59,999),label:`January 1 – December 31, ${year}`};
 const activeRange=mode==='tax'?taxRange:mode==='selected'?selectedRange:null;
 const expenses=activeRange?expensesWithinRange(all,activeRange):all;
 const title=mode==='tax'?`${year} Tax & Expense Summary`:mode==='selected'?`Expense Report — ${selectedRange.label}`:'Expense Report';
 const period=activeRange?activeRange.label:'All recorded expenses';
 const total=expenses.reduce((sum,item)=>sum+Number(item.amount||0),0);
 const categories=['Maintenance','Repair','Parts','Fuel','Insurance','Registration','Other'];
 const categoryRows=categories.map(category=>({category,total:expenses.filter(item=>String(item.category||'Other')===category).reduce((sum,item)=>sum+Number(item.amount||0),0)})).filter(item=>item.total>0);
 const attachedName=expense=>{const linked=linkedDocumentForExpense(expense);return linked?.doc?.name||'—'};
 const rows=expenses.map(item=>`<tr><td>${esc(item.date||'—')}</td><td>${esc(item.category||'Other')}</td><td>${esc(item.vendor||'—')}</td><td>${esc(item.notes||'—')}</td><td>${esc(expenseCoverageSummary(item)||'Out of pocket')}</td><td>${esc(attachedName(item))}</td><td class="amount">${money(item.amount)}</td></tr>`).join('')||'<tr><td colspan="7">No expenses were recorded for this period.</td></tr>';
 const summaryRows=categoryRows.map(item=>`<tr><td>${esc(item.category)}</td><td class="amount">${money(item.total)}</td><td class="percent">${total?((item.total/total)*100).toFixed(1):'0.0'}%</td></tr>`).join('')||'<tr><td colspan="3">No category totals available.</td></tr>';
 const popup=openCenteredWindow('',mode==='tax'?'garageLogTaxSummary':'garageLogExpenseReport',1120,820);if(!popup){toast('Allow pop-ups to open the printable expense report');return}
 popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>GarageLog ${esc(title)} - ${esc(vehicleFullName())}</title><link rel="icon" type="image/png" href="${APP_FAVICON_PATH}"><style>
 :root{color-scheme:light}*{box-sizing:border-box}body{font-family:Segoe UI,Arial,sans-serif;color:#172033;margin:34px;font-size:11px;line-height:1.35}header{display:grid;grid-template-columns:minmax(0,1fr) 170px auto;gap:20px;align-items:center;border-bottom:3px solid #2563eb;padding-bottom:16px;margin-bottom:18px}.report-vehicle-photo{height:88px;display:grid;place-items:center;border:1px solid #dde3ec;border-radius:9px;background:#f8fafc;overflow:hidden}.report-vehicle-photo img{display:block;max-width:100%;max-height:84px;object-fit:contain}.brand{color:#2563eb;font-weight:800;font-size:17px}h1{font-size:25px;margin:3px 0 4px}h2{font-size:15px;margin:23px 0 9px}.generated{text-align:right;color:#667085}.vehicle-meta{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;background:#f6f8fb;border:1px solid #dde3ec;border-radius:9px;padding:12px;margin-bottom:18px}.vehicle-meta span,.summary-card span{display:block;color:#667085;font-size:9px;text-transform:uppercase;letter-spacing:.04em}.vehicle-meta strong,.summary-card strong{display:block;margin-top:4px}.summary-strip{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:14px 0}.summary-card{border:1px solid #dde3ec;border-radius:9px;padding:12px}.summary-card strong{font-size:18px}.report-grid{display:grid;grid-template-columns:280px minmax(0,1fr);gap:18px;align-items:start}table{width:100%;border-collapse:collapse;page-break-inside:auto}thead{display:table-header-group}tr{page-break-inside:avoid}th,td{border-bottom:1px solid #dde3ec;padding:8px 7px;text-align:left;vertical-align:top}th{background:#f6f8fb;color:#475467;font-size:9px;text-transform:uppercase;letter-spacing:.03em}.amount{text-align:right;font-weight:700;white-space:nowrap}.percent{text-align:right;color:#667085}.notes{margin-top:16px;padding:11px;border-left:3px solid #f59e0b;background:#fffbeb;color:#665c3c}.footer{margin-top:25px;padding-top:10px;border-top:1px solid #dde3ec;color:#667085;font-size:9px}.no-print{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:16px;padding:10px 12px;border:1px solid #dbe3ee;border-radius:9px;background:#f8fafc;color:#475467}.no-print>div{display:flex;gap:8px}.no-print button{border:1px solid #cfd7e3;background:white;border-radius:7px;padding:8px 12px;cursor:pointer}.no-print .primary{background:#2563eb;color:white;border-color:#2563eb}@page{size:landscape;margin:.45in}@media print{body{margin:0}.no-print{display:none}.report-grid{grid-template-columns:230px minmax(0,1fr)}}
 </style></head><body><div class="no-print report-review-actions"><span>Save the live report setup in GarageLog, or create a fixed PDF through the browser print dialog.</span><div><button onclick="window.close()">Close</button><button onclick="window.opener?.saveReportSetupForTemplate?.('${mode==='tax'?'tax-expense':'ownership-cost'}')">Save Report Setup</button><button class="primary" onclick="window.print()">Print / Save as PDF</button></div></div><header><div><div class="brand">GarageLog</div><h1>${esc(title)}</h1><div>${esc(vehicleFullName())}</div></div><div class="report-vehicle-photo"><img src="${vehicleImageUrl(vehicle)}" alt="${esc(vehicleFullName(vehicle))}" onerror="this.onerror=null;this.src='${vehicleDefaultImageUrl(vehicle)}'"></div><div class="generated"><strong>${esc(period)}</strong><br>Generated ${new Date().toLocaleString()}</div></header><section class="vehicle-meta"><div><span>Mileage</span><strong>${number(vehicle.mileage)} mi</strong></div><div><span>VIN</span><strong>${esc(vehicle.vin||'Not entered')}</strong></div><div><span>Engine</span><strong>${esc(vehicle.engine||'Not entered')}</strong></div><div><span>Drivetrain</span><strong>${esc(vehicle.drivetrain||'Not entered')}</strong></div><div><span>Powertrain</span><strong>${esc(vehicle.powertrain||'Not entered')}</strong></div></section><section class="summary-strip"><div class="summary-card"><span>Out-of-Pocket Total</span><strong>${money(total)}</strong></div><div class="summary-card"><span>Transactions</span><strong>${expenses.length}</strong></div><div class="summary-card"><span>Categories</span><strong>${categoryRows.length}</strong></div></section><div class="report-grid"><section><h2>Category Summary</h2><table><thead><tr><th>Category</th><th class="amount">Amount</th><th class="percent">Share</th></tr></thead><tbody>${summaryRows}</tbody></table>${mode==='tax'?'<div class="notes"><strong>Recordkeeping note:</strong> This report summarizes entered vehicle expenses. It does not determine tax deductibility; retain original receipts and consult a qualified tax professional for classification.</div>':''}</section><section><h2>${mode==='tax'?'Transactions for the Tax Year':'Expense Transactions'}</h2><table><thead><tr><th>Date</th><th>Category</th><th>Vendor</th><th>Notes</th><th>Coverage</th><th>Attachment</th><th class="amount">Paid</th></tr></thead><tbody>${rows}</tbody></table></section></div><div class="footer">Private local report generated by GarageLog. Values reflect user-entered records for the active vehicle.</div></body></html>`);popup.document.close();popup.focus()
}

document.getElementById('modalForm').addEventListener('submit',async e=>{if(e.submitter?.value==='cancel')return;e.preventDefault();const form=e.currentTarget;if(form.dataset.submitting==='true')return;const {type,index}=editing,fd=new FormData(form),submitter=e.submitter||form.querySelector('button[type="submit"]:not([value="cancel"]),input[type="submit"]:not([value="cancel"])'),submitControls=[...form.querySelectorAll('button[type="submit"],input[type="submit"]')].map(control=>({control,disabled:control.disabled})),originalSubmitHtml=submitter instanceof HTMLButtonElement?submitter.innerHTML:null,originalSubmitValue=submitter instanceof HTMLInputElement?submitter.value:null;let skipFinalSave=false;form.dataset.submitting='true';submitControls.forEach(({control})=>control.disabled=true);if(type==='document'&&(index===null||index===undefined)&&submitter){if(submitter instanceof HTMLButtonElement)submitter.innerHTML=`${svg('upload')} Uploading…`;else if(submitter instanceof HTMLInputElement)submitter.value='Uploading…'}try{
 if(type==='mileage'){state.mileage=Number(fd.get('Mileage'));state.mileageHistory.push({date:new Date().toISOString(),mileage:state.mileage,source:fd.get('Source')});persistActiveVehicle()}
 else if(type==='expense'){
   const existing=index!==null?state.expenses[index]:null,category=String(fd.get('Category')||'Other'),expenseDate=String(fd.get('Date')||'').trim(),parsedExpenseDate=parseRecordDate(expenseDate);
   if(!/^\d{4}-\d{2}-\d{2}$/.test(expenseDate)||!parsedExpenseDate)throw new Error('Choose a valid expense date.');
   const amount=Number(fd.get('Amount')),coverageType=category==='Fuel'?'None':normalizeExpenseCoverage(fd.get('Coverage')),coveredValueRaw=String(fd.get('Covered Value')||'').trim(),coveredAmount=coveredValueRaw===''?null:Number(coveredValueRaw);
   if(!Number.isFinite(amount)||amount<0)throw new Error('Enter a valid non-negative amount.');
   if(coveredAmount!==null&&(!Number.isFinite(coveredAmount)||coveredAmount<0))throw new Error('Enter a valid non-negative service or invoice value.');
   const now=new Date().toISOString(),x={...existing,id:existing?.id||makeRecordId('expense'),vehicleId:existing?.vehicleId||state.activeVehicleId,date:expenseDate,category,vendor:fd.get('Vendor'),notes:fd.get('Notes'),amount,coverageType,coveredAmount:coverageType==='None'?null:coveredAmount,createdAt:existing?.createdAt||now,updatedAt:now};
   if(category==='Fuel'){x.gallons=finitePositive(fd.get('Gallons'));x.odometer=finitePositive(fd.get('Odometer'));x.mpg=finitePositive(fd.get('MPG'));x.fullTank=fd.get('Full Tank')==='on';delete x.coverageType;delete x.coveredAmount}else{delete x.gallons;delete x.odometer;delete x.mpg;delete x.fullTank;if(coverageType==='None'){delete x.coverageType;delete x.coveredAmount}}
   const vehicle=state.vehicles.find(item=>String(item.id)===String(x.vehicleId))||activeVehicle();
   vehicle.mileageHistory=(vehicle.mileageHistory||[]).filter(reading=>String(reading?.expenseId||'')!==String(x.id));
   if(category==='Fuel'&&x.odometer){vehicle.mileageHistory.push({date:expenseDate,mileage:x.odometer,source:'Fuel entry',expenseId:x.id});vehicle.mileageHistory.sort((a,b)=>(parseRecordDate(a.date)?.getTime()||0)-(parseRecordDate(b.date)?.getTime()||0));if(x.odometer>Number(vehicle.mileage||0))vehicle.mileage=x.odometer}
   if(String(vehicle.id)===String(state.activeVehicleId)){state.vehicle=vehicle;state.mileage=Number(vehicle.mileage||0);state.mileageHistory=vehicle.mileageHistory}
   index!==null?state.expenses[index]=x:state.expenses.unshift(x)
 }
 else if(type==='service'){const existing=index!==null?state.maintenance[index]:null;const x={...existing,vehicleId:existing?.vehicleId||state.activeVehicleId,name:fd.get('Service Name'),interval:fd.get('Interval'),progress:Number(fd.get('Progress')),max:Number(fd.get('Interval Value')),due:fd.get('Next Due'),status:fd.get('Status')};index!==null?state.maintenance[index]=x:state.maintenance.unshift(x)}
 else if(type==='reminder'){const existing=index!==null?state.reminders[index]:null;const x={...existing,vehicleId:existing?.vehicleId||state.activeVehicleId,name:fd.get('Reminder Name'),rule:fd.get('Rule'),due:fd.get('Due'),status:fd.get('Status')};index!==null?state.reminders[index]=x:state.reminders.unshift(x)}
 else if(type==='vehicle'||type==='vehicle-add'){
    const existing=type==='vehicle'?state.vehicles[index]:null;
    const vehicleType=String(fd.get('Vehicle Type')||existing?.type||'Car'),isTrailer=vehicleType==='Trailer';
    const year=String(fd.get('Year')||'').trim(),make=String(fd.get('Make')||'').trim(),model=String(fd.get('Model')||'').trim(),mileage=isTrailer?0:Number(fd.get('Current Mileage')||0),powertrain=isTrailer?'Not Applicable':String(fd.get('Powertrain')||existing?.powertrain||'Gasoline / Internal Combustion'),lifecycleStatus=existing?String(fd.get('Vehicle Status')||existing.lifecycleStatus||'Active'):'Active';
    const acquiredDate=String(fd.get('Purchase / Acquired Date')??existing?.acquiredDate??'').trim(),acquiredMileageRaw=isTrailer?'':String(fd.get('Mileage at Acquisition')??existing?.acquiredMileage??'').trim(),acquiredMileage=acquiredMileageRaw===''?null:Number(acquiredMileageRaw);
    if(!year&&!make&&!model)throw new Error('Enter at least a year, make, or model.');
    if(!isTrailer&&(!Number.isFinite(mileage)||mileage<0))throw new Error('A valid non-negative mileage value is required.');
    if(!isTrailer&&acquiredMileage!==null&&(!Number.isFinite(acquiredMileage)||acquiredMileage<0))throw new Error('Mileage at acquisition must be a valid non-negative value.');
    if(!isTrailer&&acquiredMileage!==null&&acquiredMileage>mileage)throw new Error('Mileage at acquisition cannot be greater than current mileage.');
    if(existing&&!isVehicleArchived(existing)&&['Sold','Decommissioned'].includes(lifecycleStatus)&&activeFleetVehicles().length<=1)throw new Error('Add or restore another active vehicle before archiving this one.');
    const trailerValue=(name,fallback='')=>isTrailer?String(fd.get(name)??existing?.[name==='Trailer Type'?'trailerType':name==='GVWR'?'gvwr':name==='Empty Weight'?'emptyWeight':name==='Axle Count'?'axleCount':name==='Coupler Type'?'couplerType':'brakeType']??fallback):null;
    const priorMileageHistory=existing?.mileageHistory||[];
    let initialMileageHistory=isTrailer?[]:(existing?priorMileageHistory:[{date:new Date().toISOString(),mileage,source:'Vehicle added'}]);
    if(!existing&&!isTrailer&&acquiredDate&&acquiredMileage!==null){initialMileageHistory=[{date:acquiredDate,mileage:acquiredMileage,source:'Vehicle acquired'},...initialMileageHistory.filter(item=>String(item.date||'').slice(0,10)!==acquiredDate||Number(item.mileage)!==acquiredMileage)]}
    const vehicle={...(existing||{}),id:existing?.id||makeVehicleId(),type:vehicleType,powertrain,lifecycleStatus,archivedAt:['Sold','Decommissioned'].includes(lifecycleStatus)?(existing?.archivedAt||new Date().toISOString()):null,year,make,model,name:[year,make,model].filter(Boolean).join(' '),trim:isTrailer?'':String(fd.get('Trim')??existing?.trim??''),engine:isTrailer?'':String(fd.get('Engine')??existing?.engine??''),transmission:isTrailer?'':String(fd.get('Transmission')??existing?.transmission??''),drivetrain:isTrailer?'':String(fd.get('Drivetrain')??existing?.drivetrain??''),vin:String(fd.get('VIN')??existing?.vin??''),color:String(fd.get('Color')??existing?.color??''),acquiredDate,acquiredMileage:isTrailer?null:acquiredMileage,trailerType:trailerValue('Trailer Type'),gvwr:trailerValue('GVWR'),emptyWeight:trailerValue('Empty Weight'),axleCount:trailerValue('Axle Count','1'),couplerType:trailerValue('Coupler Type'),brakeType:trailerValue('Brake Type'),imageStoredName:existing?.imageStoredName||null,mileage,mileageHistory:initialMileageHistory,metrics:existing?.metrics||{averageMpg:0}};
    if(existing){
      if(!isTrailer&&mileage!==Number(existing.mileage||0))vehicle.mileageHistory=[...vehicle.mileageHistory,{date:new Date().toISOString(),mileage,source:'Vehicle edit'}];
      const wasActive=existing.id===state.activeVehicleId;state.vehicles[index]=vehicle;
      if(wasActive&&isVehicleArchived(vehicle)){const next=state.vehicles.find(item=>item.id!==vehicle.id&&!isVehicleArchived(item));if(next){state.activeVehicleId=next.id;state.vehicle=next;state.mileage=Number(next.mileage||0);state.mileageHistory=next.mileageHistory||[];state.metrics=next.metrics||{averageMpg:0}}else{state.vehicle=vehicle;state.mileage=vehicle.mileage;state.mileageHistory=vehicle.mileageHistory;state.metrics=vehicle.metrics}}
      else if(wasActive){state.vehicle=vehicle;state.mileage=vehicle.mileage;state.mileageHistory=vehicle.mileageHistory;state.metrics=vehicle.metrics}
    }else{
      persistActiveVehicle();state.vehicles.push(vehicle);state.activeVehicleId=vehicle.id;state.vehicle=vehicle;state.mileage=vehicle.mileage;state.mileageHistory=vehicle.mileageHistory;state.metrics=vehicle.metrics;
      applyVehicleTemplates(vehicle,fd.getAll('Maintenance Template'))
    }
  }
else if(type==='document'){
    const isEdit=index!==null&&index!==undefined,category=normalizeDocumentCategory(fd.get('Category')),tags=String(fd.get('Tags')||'').split(',').map(tag=>tag.trim().toLowerCase()).filter(Boolean).slice(0,12),services=category==='Receipts'?normalizeServiceValues(fd.get('Service')):[],shop=category==='Receipts'?String(fd.get('Shop')||'').trim():'',startsOn=['Registration','Insurance'].includes(category)?String(fd.get('Start Date')||''):'' ,expiresOn=['Registration','Insurance','Warranties'].includes(category)?String(fd.get('Expiration Date')||''):'';
    if(startsOn&&expiresOn&&startsOn>expiresOn)throw new Error('The start date must be on or before the expiration date.');
    if(isEdit){
      const doc=state.documents[index],now=new Date().toISOString();doc.name=String(fd.get('File Name')||doc.name).trim()||doc.name;doc.category=category;doc.tags=tags;doc.services=services;doc.shop=shop;doc.startsOn=startsOn||null;doc.expiresOn=expiresOn||null;doc.updatedAt=now;
      const linkedExpense=linkedExpenseForDocument(doc);if(linkedExpense&&category==='Receipts'){linkedExpense.services=services;linkedExpense.vendor=shop;linkedExpense.notes=services.join(', ')||linkedExpense.notes||doc.name;linkedExpense.updatedAt=now}
    }else{
      const file=fd.get('File');if(!(file instanceof File)||!file.size)throw new Error('Choose a file to upload.');
      const createExpense=documentCategorySupportsLinkedExpense(category)&&fd.get('Create Expense')==='on',expenseAmount=Number(fd.get('Expense Amount')||0),expenseCoverage=createExpense?normalizeExpenseCoverage(fd.get('Expense Coverage')):'None',coveredValueRaw=String(fd.get('Covered Value')||'').trim(),coveredAmount=coveredValueRaw===''?null:Number(coveredValueRaw);if(createExpense&&(!Number.isFinite(expenseAmount)||expenseAmount<0))throw new Error('Enter a valid non-negative amount.');if(createExpense&&expenseCoverage==='None'&&(!(expenseAmount>0)))throw new Error('Enter an expense amount greater than zero, or mark the entry as warranty or recall covered.');if(createExpense&&coveredAmount!==null&&(!Number.isFinite(coveredAmount)||coveredAmount<0))throw new Error('Enter a valid non-negative service or invoice value.');
      const upload=new FormData();upload.append('file',file);const r=await fetch('/api/documents',{method:'POST',body:upload});if(!r.ok)throw new Error((await r.json().catch(()=>({}))).error||'Upload failed');const result=await r.json();
      const documentId=makeRecordId('document'),expenseId=createExpense?makeRecordId('expense'):null,now=new Date().toISOString();
      const documentRecord={id:documentId,vehicleId:state.activeVehicleId,name:String(fd.get('Display Name')||'').trim()||file.name,originalName:result.originalName||file.name,extension:result.extension||fileExtension(file.name),contentType:result.contentType||file.type,category,tags,services,shop,startsOn:startsOn||null,expiresOn:expiresOn||null,date:new Date().toLocaleDateString('en-US'),addedAt:now,size:formatBytes(file.size),bytes:file.size,storedName:result.storedName,lastViewedAt:null,ocrStatus:'not-indexed',ocrText:'',linkedExpenseId:expenseId};
      state.documents.unshift(documentRecord);
      if(createExpense){const expenseDate=String(fd.get('Expense Date')||new Date().toISOString().slice(0,10));state.expenses.unshift({id:expenseId,vehicleId:state.activeVehicleId,date:expenseDate,category:String(fd.get('Expense Category')||'Maintenance'),vendor:shop,services,notes:services.join(', ')||documentRecord.name,amount:expenseAmount,...(expenseCoverage==='None'?{}:{coverageType:expenseCoverage,coveredAmount}),linkedDocumentId:documentId,linkedDocumentStoredName:documentRecord.storedName,source:'document-upload',createdAt:now,updatedAt:now})}
      await saveNow();await indexDocumentRecord(0,{quiet:true});skipFinalSave=true
    }
  }
 if(!skipFinalSave)await saveNow();clearDocumentUploadPreview();const recordModal=document.getElementById('modal');recordModal.close();recordModal.classList.remove('document-upload-dialog');const successMessage=pendingVehicleLifecycleToast||(type==='vehicle-add'?'Vehicle added':index!==null?'Record updated':'Record added');pendingVehicleLifecycleToast=null;toast(successMessage);render();
 }catch(err){pendingVehicleLifecycleToast=null;console.error(err);toast(err.message||'Unable to save')}finally{delete form.dataset.submitting;submitControls.forEach(({control,disabled})=>control.disabled=disabled);if(submitter instanceof HTMLButtonElement&&originalSubmitHtml!==null)submitter.innerHTML=originalSubmitHtml;else if(submitter instanceof HTMLInputElement&&originalSubmitValue!==null)submitter.value=originalSubmitValue}})

const expenseRangeForm=document.getElementById('expenseRangeForm');
if(expenseRangeForm)expenseRangeForm.addEventListener('submit',event=>{
 if(event.submitter?.value==='cancel')return;
 event.preventDefault();
 const start=document.getElementById('expenseRangeStart').value,end=document.getElementById('expenseRangeEnd').value;
 if(!start||!end){toast('Choose a start and end date');return}
 if(start>end){toast('The start date must be before the end date');return}
 if(expenseRangeTarget==='category'){expenseCategoryCustomRange={start,end};expenseCategoryPeriod='custom'}
 else if(expenseRangeTarget==='dashboard'){dashboardExpenseCustomRange={start,end};dashboardExpenseRange='custom'}
 else if(expenseRangeTarget==='report'){reportCustomRange={start,end};reportPeriod='custom'}
 else{expenseCustomRange={start,end};expenseChartPeriod='custom'}
 document.getElementById('expenseRangeModal').close();render();
});
const expenseRangeClose=document.getElementById('expenseRangeClose');if(expenseRangeClose)expenseRangeClose.innerHTML=svg('close');

const globalSearchInput=document.getElementById('globalSearch');
if(globalSearchInput){
 globalSearchInput.addEventListener('input',handleTopSearchInput);
 globalSearchInput.addEventListener('focus',()=>{if(topSearchMode()==='global'&&normalizedSearchQuery())renderGlobalSearchResults(topSearchQuery)});
 globalSearchInput.addEventListener('keydown',event=>{
  if(event.key==='Escape'){event.preventDefault();clearTopSearch();if(TOP_SEARCH_FILTER_PAGES.has(current))render();globalSearchInput.blur();return}
  if(event.key==='Enter'&&topSearchMode()==='global'){const first=document.querySelector('#topSearchResults .top-search-result');if(first){event.preventDefault();first.click()}}
 });
}
document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>openModal(b.dataset.action));
document.getElementById('sidebarVehicle').onclick=()=>goPage('Garage');
const brandIcon=document.getElementById('brandIcon');if(brandIcon)brandIcon.innerHTML=svg('shield');applySidebarBranding();
document.getElementById('searchIcon').innerHTML=svg('search');
document.getElementById('notificationIcon').insertAdjacentHTML('afterbegin',svg('bell'));document.getElementById('notificationIcon').addEventListener('click',event=>{event.stopPropagation();toggleNotificationPanel()});
document.getElementById('modalClose').innerHTML=svg('close');
document.getElementById('profileChevron').innerHTML=svg('chevronDown');
document.querySelectorAll('[data-icon]').forEach(x=>x.innerHTML=svg(x.dataset.icon));
document.querySelectorAll('[data-profile-icon]').forEach(x=>x.innerHTML=svg(x.dataset.profileIcon));
const profileTrigger=document.getElementById('profileTrigger');if(profileTrigger)profileTrigger.addEventListener('click',event=>{event.stopPropagation();setProfileMenu(document.getElementById('profileMenu').hidden)});
document.querySelectorAll('[data-profile-action]').forEach(button=>button.addEventListener('click',()=>button.dataset.profileAction==='profile'?openProfilePage():button.dataset.profileAction==='settings'?openSettingsPage():openInfoModal(button.dataset.profileAction)));
document.addEventListener('click',event=>{if(canWrite())return;const button=event.target.closest('button');if(!button)return;const action=button.dataset.action||button.getAttribute('onclick')||'';if(button.dataset.action||/openModal|openReminderWizard|editRecord|deleteRecord|deleteReminder|markReminder|duplicateReminder|addVehicleRecord|archiveVehicle|deleteVehicle|makeVehicleActive|upload|removeVehicleImage|openExpenseDeleteConfirm|indexAllDocuments|indexDocumentRecord|openDocumentFolderManager|saveDocumentFolder|deleteDocumentFolder|openDocumentShare|createDocumentShare|revokeDocumentShare|finishFirstRunSetup|clearAllNotifications|saveExpenseBudgetSettings|saveRecurringExpensePlan|deleteRecurringExpensePlan/i.test(action)){event.preventDefault();event.stopImmediatePropagation();toast('This account has read-only access.')}},true);
document.addEventListener('click',event=>{const wrap=document.querySelector('.profile-wrap');if(wrap&&!wrap.contains(event.target))setProfileMenu(false);const notificationWrap=document.querySelector('.notification-wrap');if(notificationWrap&&!notificationWrap.contains(event.target)&&notificationPanelOpen)closeNotificationPanel();const searchShell=document.querySelector('.search-shell');if(searchShell&&!searchShell.contains(event.target))hideTopSearchResults();const activeMenu=event.target.closest('details.expense-row-menu,details.reminder-more,details.maintenance-row-menu');if(activeMenu){closeActionMenus(activeMenu)}else{closeActionMenus()}});
document.addEventListener('toggle',event=>{const menu=event.target;if(menu instanceof HTMLDetailsElement&&menu.open&&menu.matches('.expense-row-menu,.reminder-more,.maintenance-row-menu'))closeActionMenus(menu)},true);
window.addEventListener('resize',()=>{closeDocumentRowActionMenu();if(current==='Documents')syncDocumentsListHeight();if(current==='Expenses')syncExpensesListHeight();if(current==='Reminders'&&reminderViewMode==='calendar')syncReminderCalendarHeight()});window.addEventListener('scroll',closeDocumentRowActionMenu,true);
const modalClose=document.getElementById('modalClose'),modalCancel=document.getElementById('modalCancel');if(modalClose)modalClose.addEventListener('click',closeRecordModal);if(modalCancel)modalCancel.addEventListener('click',closeRecordModal);
const recordModal=document.getElementById('modal');if(recordModal)recordModal.addEventListener('cancel',event=>{event.preventDefault();closeRecordModal()});
const expenseRangeCancel=document.getElementById('expenseRangeCancel');if(expenseRangeCancel)expenseRangeCancel.addEventListener('click',()=>document.getElementById('expenseRangeModal').close());if(expenseRangeClose)expenseRangeClose.addEventListener('click',()=>document.getElementById('expenseRangeModal').close());
const wizard=document.getElementById('reminderWizard');document.getElementById('reminderWizardForm').addEventListener('submit',event=>event.preventDefault());document.getElementById('reminderWizardClose').innerHTML=svg('close');document.getElementById('reminderWizardClose').addEventListener('click',()=>wizard.close());document.getElementById('reminderWizardCancel').addEventListener('click',()=>wizard.close());document.getElementById('reminderWizardBack').addEventListener('click',()=>{reminderWizardCollect();reminderWizardState.step=Math.max(1,reminderWizardState.step-1);renderReminderWizard()});document.getElementById('reminderWizardNext').addEventListener('click',()=>{reminderWizardCollect();const s=reminderWizardState;if(s.step===2&&!String(s.name||'').trim()){toast('Enter a reminder name');return}if(s.step===3){const today=new Date().toISOString().slice(0,10);if(s.trigger==='mileage'&&(!Number.isFinite(Number(s.dueMileage))||Number(s.dueMileage)<0||!Number(s.repeatMiles))){toast('Enter the next due mileage and repeat interval');return}if(s.trigger==='date'&&!s.dueDate){toast('Choose a reminder date');return}if(s.trigger==='recurring'){if(s.startMode==='today')s.startDate=today;else if(!s.startDate){toast('Choose a future start date');return}else if(s.startDate<today){toast('The recurring start date cannot be in the past');return}if(!s.dueDate)s.dueDate=calculateRecurringDue(s.startDate,s.frequency,s.frequencyUnit)}}s.step=Math.min(4,s.step+1);renderReminderWizard()});document.getElementById('reminderWizardSave').addEventListener('click',saveReminderWizard);wizard.addEventListener('cancel',event=>{event.preventDefault();wizard.close()});
const checklistDialog=document.getElementById('checklistDialog');document.getElementById('checklistDialogCloseX').innerHTML=svg('close');document.getElementById('checklistDialogCloseX').addEventListener('click',()=>checklistDialog.close());document.getElementById('checklistDialogClose').addEventListener('click',()=>checklistDialog.close());document.getElementById('checklistDialogSave').addEventListener('click',saveChecklistProgress);checklistDialog.addEventListener('cancel',event=>{event.preventDefault();checklistDialog.close()});
const exportDialog=document.getElementById('exportRecordsDialog');document.getElementById('exportRecordsClose').innerHTML=svg('close');document.getElementById('exportRecordsClose').addEventListener('click',()=>exportDialog.close());document.getElementById('exportRecordsCancel').addEventListener('click',()=>exportDialog.close());document.getElementById('exportRecordsForm').addEventListener('submit',event=>{event.preventDefault();const selected=new FormData(event.target).getAll('recordType');if(!selected.length){toast('Select at least one record type');return}exportGarageRecords(event.target);exportDialog.close();toast('Garage records exported')});
const infoModal=document.getElementById('infoModal');document.getElementById('infoModalClose').innerHTML=svg('close');document.getElementById('infoModalClose').addEventListener('click',()=>infoModal.close());document.getElementById('infoModalSecondary').addEventListener('click',()=>infoModal.close());document.getElementById('infoModalPrimary').addEventListener('click',()=>{if(infoModalAction)infoModalAction();else infoModal.close()});
window.exportExpenses=function(){const rows=[['Date','Category','Vendor','Notes','Coverage','Covered Service Value','Amount Paid'],...activeExpenses().map(x=>[x.date,x.category,x.vendor,x.notes,expenseCoverageLabel(x)||'Out of pocket',x.coveredAmount??'',x.amount])];const csv=rows.map(r=>r.map(v=>`"${String(v??'').replaceAll('"','""')}"`).join(',')).join('\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='garagelog-expenses.csv';a.click();URL.revokeObjectURL(a.href)}
function formatBytes(bytes){bytes=Number(bytes||0);if(bytes<1024)return`${bytes} B`;if(bytes<1024**2)return`${(bytes/1024).toFixed(1)} KB`;if(bytes<1024**3)return`${(bytes/1024**2).toFixed(1)} MB`;return`${(bytes/1024**3).toFixed(2)} GB`}

bootstrapGarageLog();

