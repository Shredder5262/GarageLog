let settingsApiTokens=[];
let settingsShares=[];
let settingsObdDevices=[];
let settingsObdVehicles=[];
let settingsOdometerProposals=[];
let settingsNotificationData=null;

async function settingsCopyText(text,container){
  // Modern Clipboard API first. This works on HTTPS and localhost in
  // browsers that permit clipboard writes from the current user gesture.
  try{
    if(navigator.clipboard&&navigator.clipboard.writeText){
      await navigator.clipboard.writeText(text);
      return true;
    }
  }catch{}

  // Fallback for self-hosted HTTP. When a <dialog> is open with showModal(),
  // nodes outside that dialog can be inert. Keep the temporary copy control
  // inside the active dialog so focus/select/copy remains permitted.
  let textarea=null;
  try{
    textarea=document.createElement('textarea');
    textarea.value=text;
    textarea.readOnly=true;
    textarea.setAttribute('aria-hidden','true');
    textarea.style.position='fixed';
    textarea.style.left='16px';
    textarea.style.bottom='16px';
    textarea.style.width='1px';
    textarea.style.height='1px';
    textarea.style.opacity='0';
    textarea.style.pointerEvents='none';

    const host=container||document.querySelector('dialog[open]')||document.body;
    host.appendChild(textarea);

    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0,textarea.value.length);

    const copied=document.execCommand('copy');
    textarea.remove();
    return !!copied;
  }catch{
    if(textarea&&textarea.isConnected)textarea.remove();
    return false;
  }
}

function settingsFormatDate(value){
  if(!value)return 'Never';
  const date=new Date(value);
  return Number.isNaN(date.getTime())?'-':date.toLocaleString();
}

function settingsTokenStatusClass(status){
  return String(status||'').toLowerCase();
}

function settingsScopeLabel(scope){
  return ({
    'vehicles:read':'Vehicle Read',
    'telemetry:write':'Mobile Data Write',
    'device:sync':'Device Sync',
    'notifications:read':'Notification Read'
  })[scope]||scope;
}

function settingsTokenRows(){
  if(!isAdministrator()){
    return `<div class="settings-empty">
      <strong>Administrator access required</strong>
      <p>API/device tokens can only be created or managed by a GarageLog administrator.</p>
    </div>`;
  }

  if(!settingsApiTokens.length){
    return `<div class="settings-empty">
      <strong>No API tokens</strong>
      <p>Create a scoped token when an app or device needs to connect to this GarageLog instance.</p>
    </div>`;
  }

  return settingsApiTokens.map(token=>`
    <article class="settings-token-row">
      <div class="settings-token-main">
        <div class="settings-token-title">
          <strong>${esc(token.name)}</strong>
          <span class="settings-status ${settingsTokenStatusClass(token.status)}">${esc(token.status)}</span>
        </div>
        <code>${esc(token.tokenPrefix)}&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;</code>
        <div class="settings-scope-list">
          ${(token.scopes||[]).map(scope=>`<span>${esc(settingsScopeLabel(scope))}</span>`).join('')}
        </div>
      </div>
      <dl class="settings-meta">
        <div><dt>Created</dt><dd>${esc(settingsFormatDate(token.createdUtc))}</dd></div>
        <div><dt>Created by</dt><dd>${esc(token.createdBy||'Administrator')}</dd></div>
        <div><dt>Expires</dt><dd>${esc(token.expiresUtc?settingsFormatDate(token.expiresUtc):'Never')}</dd></div>
        <div><dt>Last used</dt><dd>${esc(token.lastUsedUtc?settingsFormatDate(token.lastUsedUtc):'Never')}</dd></div>
      </dl>
      <div class="settings-row-actions">
        ${token.status==='Active'
          ?`<button class="secondary" type="button" onclick="revokeApiToken('${esc(token.id)}')">Revoke</button>`
          :''}
        <button class="danger-outline" type="button" onclick="deleteApiToken('${esc(token.id)}')">Delete</button>
      </div>
    </article>`).join('');
}

function settingsShareRows(){
  if(!settingsShares.length){
    return `<div class="settings-empty">
      <strong>No share links</strong>
      <p>Document share links you create will be managed here.</p>
    </div>`;
  }

  return settingsShares.slice(0,6).map(share=>{
    const doc=state?.documents?.find(item=>item.storedName===share.storedName);
    return `<article class="settings-share-row">
      <div>
        <div class="settings-token-title">
          <strong>${esc(doc?.name||share.storedName)}</strong>
          <span class="settings-status ${String(share.status||'').toLowerCase()}">${esc(share.status)}</span>
        </div>
        <small>${esc(doc?vehicleNameFromId(doc.vehicleId):'Document share')}</small>
      </div>
      <dl class="settings-meta compact">
        <div><dt>Expires</dt><dd>${esc(shareExpirationText(share))}</dd></div>
        <div><dt>Last accessed</dt><dd>${esc(share.lastAccessUtc?settingsFormatDate(share.lastAccessUtc):'Never')}</dd></div>
        <div><dt>Accesses</dt><dd>${number(share.accessCount||0)}</dd></div>
      </dl>
    </article>`;
  }).join('');
}


function settingsDeviceRows(){
  if(!isAdministrator())return '';
  if(!settingsObdDevices.length){
    return `<div class="settings-empty"><strong>No GarageLog OBD devices yet</strong><p>A device will appear after GarageLog Mobile identifies itself during a sync.</p></div>`;
  }
  return settingsObdDevices.map(device=>{
    const options=settingsObdVehicles.map(vehicle=>`<option value="${esc(vehicle.id)}" ${vehicle.id===device.vehicleId?'selected':''}>${esc(vehicle.name)} · ${number(vehicle.mileage||0)} mi</option>`).join('');
    const associated=Boolean(device.vehicleId);
    const trusted=Boolean(device.isTrusted&&associated);
    const autoApprove=Boolean(device.autoApproveMileage&&trusted);
    return `<article class="settings-obd-row">
      <div class="settings-obd-main">
        <div class="settings-token-title"><strong>${esc(device.displayName||'GarageLog OBD')}</strong><span class="settings-status ${associated?'active':'expired'}">${associated?'Associated':'Needs vehicle'}</span></div>
        <code>${esc(device.deviceId)}</code>
        <small>Last seen ${esc(settingsFormatDate(device.lastSeenUtc))}${device.lastVin?` · VIN ${esc(device.lastVin.slice(-8))}`:''}</small>
      </div>
      <div class="settings-obd-management">
        <div class="settings-obd-association">
          <label>GarageLog vehicle<select id="obd-vehicle-${esc(device.deviceId)}"><option value="">Not associated</option>${options}</select></label>
          <button class="secondary" type="button" onclick="associateSettingsObdDevice('${esc(device.deviceId)}')">Save association</button>
        </div>
        <div class="settings-obd-controls">
          <div class="settings-obd-vehicle-name">${esc(device.vehicleName||'Choose a vehicle to enable trust settings.')}</div>
          <label class="settings-toggle-row ${associated?'':'disabled'}">
            <span><strong>Trusted device</strong><small>${trusted?`Validated for ${esc(device.vehicleName||'this vehicle')}`:'Enable after you verify the mileage readings are accurate.'}</small></span>
            <input type="checkbox" role="switch" ${trusted?'checked':''} ${associated?'':'disabled'} onchange="setSettingsObdTrusted('${esc(device.deviceId)}',this.checked)">
          </label>
          <label class="settings-toggle-row ${trusted?'':'disabled'}">
            <span><strong>Automatically approve mileage</strong><small>Future valid readings update this vehicle and its mileage history automatically.</small></span>
            <input type="checkbox" role="switch" ${autoApprove?'checked':''} ${trusted?'':'disabled'} onchange="setSettingsObdAutoApprove('${esc(device.deviceId)}',this.checked)">
          </label>
        </div>
      </div>
    </article>`;
  }).join('');
}

function settingsOdometerRows(){
  const actionable=settingsOdometerProposals.filter(item=>!['applied','dismissed','superseded','unavailable','waiting-for-vehicle'].includes(item.storedStatus));
  if(!actionable.length){
    return `<div class="settings-empty"><strong>No odometer updates waiting</strong><p>OBD mileage readings that still need review will appear here.</p></div>`;
  }
  return actionable.map(item=>{
    const covered=item.effectiveStatus==='covered-by-current-reading'||item.storedStatus==='covered';
    return `<article class="settings-odometer-row">
      <div><strong>${esc(item.vehicleName||'Unassigned trip')}</strong><small>${esc(new Date(item.endedAt).toLocaleString())} · ${number(item.distanceMiles||0)} trip mi · ${esc(item.candidateSource||'OBD')}</small></div>
      <div class="settings-odometer-values"><span><small>Current</small><strong>${item.currentMileage==null?'—':number(item.currentMileage)+' mi'}</strong></span><span><small>Proposed</small><strong>${item.candidateOdometer==null?'—':number(item.candidateOdometer)+' mi'}</strong></span></div>
      <div class="settings-row-actions">${covered?`<span class="settings-status active">Covered by current reading</span>`:`<button class="primary" type="button" onclick="applySettingsOdometer('${esc(item.tripId)}')">Apply</button>`}<button class="secondary" type="button" onclick="dismissSettingsOdometer('${esc(item.tripId)}')">Dismiss</button></div>
    </article>`;
  }).join('');
}

window.associateSettingsObdDevice=async function(deviceId){
  const select=document.getElementById(`obd-vehicle-${deviceId}`),vehicleId=select?.value||'';
  if(!vehicleId){toast('Choose a GarageLog vehicle');return}
  try{await authRequest(`/api/obd-devices/${encodeURIComponent(deviceId)}/associate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({vehicleId})});await refreshSettingsData();render();toast('OBD device association saved')}catch(error){toast(error.message||'Unable to associate OBD device')}
};
async function saveSettingsObdDeviceFlags(deviceId,trusted,autoApproveMileage){
  try{
    await authRequest(`/api/obd-devices/${encodeURIComponent(deviceId)}/settings`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({trusted:Boolean(trusted),autoApproveMileage:Boolean(autoApproveMileage)})
    });
    await refreshSettingsData();
    render();
    return true;
  }catch(error){
    await refreshSettingsData().catch(()=>{});
    render();
    toast(error.message||'Unable to update OBD device settings');
    return false;
  }
}

window.setSettingsObdTrusted=async function(deviceId,trusted){
  const device=settingsObdDevices.find(item=>item.deviceId===deviceId);
  if(!device?.vehicleId){toast('Associate this OBD device with a vehicle first');render();return}
  const saved=await saveSettingsObdDeviceFlags(deviceId,trusted,trusted&&Boolean(device.autoApproveMileage));
  if(saved)toast(trusted?'OBD device marked trusted':'OBD device trust removed');
};

window.setSettingsObdAutoApprove=async function(deviceId,enabled){
  const device=settingsObdDevices.find(item=>item.deviceId===deviceId);
  if(!device?.isTrusted){toast('Mark this device trusted before enabling automatic approval');render();return}
  const saved=await saveSettingsObdDeviceFlags(deviceId,true,enabled);
  if(saved)toast(enabled?'Automatic mileage approval enabled':'Automatic mileage approval disabled');
};

window.applySettingsOdometer=async function(tripId){
  try{const result=await authRequest(`/api/odometer-proposals/${encodeURIComponent(tripId)}/apply`,{method:'POST'});await loadState({persistNormalization:false});await refreshSettingsData();render();toast(result.message||'Odometer proposal processed')}catch(error){toast(error.message||'Unable to apply odometer proposal')}
};
window.dismissSettingsOdometer=async function(tripId){
  try{await authRequest(`/api/odometer-proposals/${encodeURIComponent(tripId)}/dismiss`,{method:'POST'});await refreshSettingsData();render();toast('Odometer proposal dismissed')}catch(error){toast(error.message||'Unable to dismiss odometer proposal')}
};

function settingsNotificationConfig(){
  return settingsNotificationData?.settings||{
    enabled:false,
    reminderNotificationsEnabled:false,
    recallNotificationsEnabled:false,
    reminderLeadDays:7,
    mileageLeadMiles:500,
    recallCheckSchedule:'monthly'
  };
}

function settingsRecallSummary(){
  return settingsNotificationData?.recall||{
    provider:'NHTSA Recall API',providerUrl:'https://www.nhtsa.gov/recalls',eligibleVehicleCount:0,cachedRecallCount:0,
    lastCheckedUtc:null,lastSuccessUtc:null,lastError:null,nextAutomaticCheckUtc:null,vehicles:[]
  };
}

function normalizeRecallSchedule(value){const key=String(value||'monthly').toLowerCase();return ['manual','startup','monthly','quarterly','semiannual'].includes(key)?key:'monthly'}
function recallScheduleLabel(value){return ({manual:'Manual only',startup:'At server startup',monthly:'Once a month',quarterly:'Every 3 months',semiannual:'Every 6 months'})[normalizeRecallSchedule(value)]}
function recallNextCheckText(recall,config){const schedule=normalizeRecallSchedule(config.recallCheckSchedule);if(schedule==='manual')return'Manual checks only';if(schedule==='startup')return'Next server startup';return recall.nextAutomaticCheckUtc?`Next ${settingsFormatDate(recall.nextAutomaticCheckUtc)}`:'Will check when due'}

function settingsRecallStatusCardMarkup(){
  const recall=settingsRecallSummary(),config=settingsNotificationConfig(),vehicles=Array.isArray(recall.vehicles)?recall.vehicles:[],validatedCount=vehicles.filter(vehicle=>vehicle.isValidated).length,needsSetup=vehicles.some(vehicle=>!vehicle.isValidated);
  const status=needsSetup?'Setup required':recall.lastError&&!recall.lastSuccessUtc?'Error':recall.lastSuccessUtc?'Connected':'Not checked';
  const statusClass=status==='Connected'?'active':status==='Error'?'revoked':'expired';
  return `<section class="settings-recall-status-card">
    <div class="settings-recall-card-heading">
      <div><span class="settings-card-kicker">RECALL STATUS</span><h3>Current status</h3></div>
      <span class="settings-status ${statusClass}">${esc(status)}</span>
    </div>
    <div class="settings-recall-status-grid">
      <div><small>Recall source</small><strong>${esc(recall.provider||'NHTSA Recall API')}</strong></div>
      <div><small>Tracked vehicles</small><strong>${number(recall.eligibleVehicleCount||0)}</strong><span>${number(validatedCount)} validated for NHTSA</span></div>
      <div><small>Cached campaigns</small><strong>${number(recall.cachedRecallCount||0)}</strong><span>latest NHTSA results</span></div>
      <div><small>Last successful check</small><strong>${recall.lastSuccessUtc?esc(settingsFormatDate(recall.lastSuccessUtc)):'Not yet'}</strong><span>${esc(recallNextCheckText(recall,config))}</span></div>
    </div>
  </section>`;
}
function settingsRecallIssueMarkup(){
  const recall=settingsRecallSummary();
  return recall.lastError?`<div class="settings-recall-issue"><span class="settings-recall-issue-icon">!</span><span><strong>Last recall check issue</strong><small>${esc(recall.lastError)}</small></span></div>`:'';
}
function settingsRecallResultsMarkup(){
  const recall=settingsRecallSummary(),vehicles=Array.isArray(recall.vehicles)?recall.vehicles:[];
  return `<section class="settings-recall-results">
    <div class="settings-recall-results-heading"><div><span class="settings-card-kicker">VEHICLE RESULTS</span><h3>Vehicle Recall Results</h3></div><span>${number(vehicles.length)} tracked</span></div>
    ${vehicles.length?`<div class="settings-recall-vehicle-list">${vehicles.map(vehicle=>{
      const count=Number(vehicle.recallCount||0),validated=Boolean(vehicle.isValidated),vehicleStatus=!validated?'Setup required':vehicle.lastError?'Error':count>0?'Recall found':'No campaigns';
      return `<div class="settings-recall-vehicle-row ${validated?'validated':'needs-match'}">
        <span class="settings-recall-vehicle-main"><strong>${esc(vehicle.vehicleName)}</strong><small>GarageLog: ${esc(vehicle.garageQuery||vehicle.vehicleName||'')}</small>${validated?`<em>${svg('check')} NHTSA: ${esc(vehicle.query||'')}</em>`:`<em class="needs-match">${svg('warning')} Validate the NHTSA vehicle identity before recall checks run.</em>`}</span>
        <span class="settings-recall-vehicle-result"><b>${number(count)}</b><small>campaign${count===1?'':'s'}</small><em class="${!validated?'setup':vehicle.lastError?'error':count>0?'attention':'clear'}">${esc(vehicleStatus)}</em></span>
        ${isAdministrator()?`<button type="button" class="secondary compact-action settings-recall-match-button" onclick="openRecallVehicleMatch('${esc(vehicle.vehicleId)}')">${validated?'Change Match':'Match Vehicle'}</button>`:''}
      </div>`}).join('')}</div>`:`<div class="settings-recall-results-empty">No eligible vehicles are available for recall checks yet.</div>`}
  </section>`;
}

let recallVehicleMatchState=null;
function recallMatchOption(value,selected){return `<option value="${esc(value)}" ${String(value)===String(selected)?'selected':''}>${esc(value)}</option>`}
function recallMatchDialogMarkup(match){
  const suggestions=Array.isArray(match.suggestions)?match.suggestions:[],makes=Array.isArray(match.availableMakes)?match.availableMakes:[],models=Array.isArray(match.availableModels)?match.availableModels:[];
  const year=String(match.nhtsaYear||match.garageYear||''),make=String(match.nhtsaMake||suggestions[0]?.make||''),model=String(match.nhtsaModel||suggestions[0]?.model||'');
  return `<div class="modal-header"><div><span class="account-eyebrow">NHTSA VEHICLE MATCH</span><h3>${esc(match.vehicleName)}</h3><p>Confirm the NHTSA identity GarageLog should use for automated recall checks.</p></div><button type="button" class="icon-btn recall-match-close">${svg('close')}</button></div>
    <div class="recall-match-body">
      <section class="recall-match-garage"><small>GARAGELOG VEHICLE</small><strong>${esc(`${match.garageYear} ${match.garageMake} ${match.garageModel}`)}</strong><span>This vehicle record will not be changed.</span></section>
      ${suggestions.length?`<section class="recall-match-suggestions"><div><small>SUGGESTED NHTSA MATCH${suggestions.length===1?'':'ES'}</small><p>Select a suggestion or adjust the NHTSA fields below.</p></div><div>${suggestions.slice(0,4).map((item,index)=>`<button type="button" class="${index===0&&!match.isValidated?'recommended':''}" onclick="applyRecallMatchSuggestion('${esc(item.year)}','${esc(item.make)}','${esc(item.model)}')"><span>${esc(`${item.year} ${item.make} ${item.model}`)}</span>${index===0&&!match.isValidated?'<b>Recommended</b>':''}</button>`).join('')}</div></section>`:''}
      <section class="recall-match-fields"><div class="recall-match-fields-heading"><small>NHTSA LOOKUP IDENTITY</small><strong>Adjust query information</strong></div><div class="recall-match-grid">
        <label><span>Model Year</span><input id="recallMatchYear" type="number" min="1900" max="2100" value="${esc(year)}" onchange="reloadRecallMatchMakes()"></label>
        <label><span>Make</span><select id="recallMatchMake" onchange="reloadRecallMatchModels()">${makes.map(value=>recallMatchOption(value,make)).join('')}</select></label>
        <label><span>Model</span><select id="recallMatchModel">${models.map(value=>recallMatchOption(value,model)).join('')}</select></label>
      </div><p class="recall-match-help">GarageLog validates these values against NHTSA's recall catalog before saving them.</p></section>
    </div>
    <div class="modal-actions"><button type="button" class="secondary recall-match-cancel">Cancel</button><button type="button" class="primary recall-match-save">${match.isValidated?'Save Match':'Confirm NHTSA Match'}</button></div>`;
}
window.openRecallVehicleMatch=async function(vehicleId){
  if(!isAdministrator())return;
  const dialog=ensureDynamicDialog('recallVehicleMatchDialog','recall-vehicle-match-dialog');
  dialog.innerHTML=`<div class="modal-header"><div><h3>NHTSA Vehicle Match</h3><p>Looking up NHTSA vehicle catalog…</p></div><button type="button" class="icon-btn recall-match-close">${svg('close')}</button></div><div class="recall-match-loading">${svg('refresh')} Loading vehicle matches…</div>`;
  dialog.querySelector('.recall-match-close').onclick=()=>dialog.close();dialog.showModal();
  try{recallVehicleMatchState=await authRequest(`/api/recalls/match/${encodeURIComponent(vehicleId)}`);renderRecallVehicleMatchDialog(dialog)}catch(error){dialog.close();toast(error.message||'Unable to load NHTSA vehicle matches')}
};
function renderRecallVehicleMatchDialog(dialog=document.getElementById('recallVehicleMatchDialog')){
  if(!dialog||!recallVehicleMatchState)return;dialog.innerHTML=recallMatchDialogMarkup(recallVehicleMatchState);
  const close=()=>dialog.close();dialog.querySelector('.recall-match-close').onclick=close;dialog.querySelector('.recall-match-cancel').onclick=close;dialog.querySelector('.recall-match-save').onclick=saveRecallVehicleMatch;
}
window.applyRecallMatchSuggestion=async function(year,make,model){
  const yearInput=document.getElementById('recallMatchYear');if(yearInput)yearInput.value=year;
  await loadRecallMatchMakes(year,make);await loadRecallMatchModels(year,make,model);
};
async function loadRecallMatchMakes(year,selectedMake=''){
  const select=document.getElementById('recallMatchMake');if(!select)return;select.disabled=true;
  try{const data=await authRequest(`/api/recalls/catalog/makes?year=${encodeURIComponent(year)}`),makes=Array.isArray(data.makes)?data.makes:[];select.innerHTML=makes.map(value=>recallMatchOption(value,selectedMake)).join('');if(!select.value&&makes.length)select.value=makes[0]}finally{select.disabled=false}
}
async function loadRecallMatchModels(year,make,selectedModel=''){
  const select=document.getElementById('recallMatchModel');if(!select)return;select.disabled=true;
  try{const data=await authRequest(`/api/recalls/catalog/models?year=${encodeURIComponent(year)}&make=${encodeURIComponent(make)}`),models=Array.isArray(data.models)?data.models:[];select.innerHTML=models.map(value=>recallMatchOption(value,selectedModel)).join('');if(!select.value&&models.length)select.value=models[0]}finally{select.disabled=false}
}
window.reloadRecallMatchMakes=async function(){
  const year=document.getElementById('recallMatchYear')?.value||'';await loadRecallMatchMakes(year);const make=document.getElementById('recallMatchMake')?.value||'';await loadRecallMatchModels(year,make)
};
window.reloadRecallMatchModels=async function(){const year=document.getElementById('recallMatchYear')?.value||'',make=document.getElementById('recallMatchMake')?.value||'';await loadRecallMatchModels(year,make)};
async function saveRecallVehicleMatch(){
  if(!recallVehicleMatchState)return;const dialog=document.getElementById('recallVehicleMatchDialog'),button=dialog?.querySelector('.recall-match-save');
  const year=document.getElementById('recallMatchYear')?.value||'',make=document.getElementById('recallMatchMake')?.value||'',model=document.getElementById('recallMatchModel')?.value||'';
  if(button){button.disabled=true;button.textContent='Validating…'}
  try{const result=await authRequest('/api/recalls/match',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({vehicleId:recallVehicleMatchState.vehicleId,year,make,model})});settingsNotificationData={settings:settingsNotificationConfig(),recall:result.summary};dialog?.close();recallVehicleMatchState=null;render();toast(`NHTSA match saved: ${year} ${make} ${model}`)}catch(error){toast(error.message||'Unable to save NHTSA vehicle match');if(button){button.disabled=false;button.textContent=recallVehicleMatchState.isValidated?'Save Match':'Confirm NHTSA Match'}}
}

function settingsNotificationsSection(){
  const config=settingsNotificationConfig(),disabled=isAdministrator()?'':'disabled',nestedDisabled=!isAdministrator()||!config.enabled?'disabled':'',recallDisabled=!isAdministrator()||!config.recallNotificationsEnabled?'disabled':'';
  return `<section class="card settings-section settings-recalls-section">
    <div class="settings-section-heading settings-notifications-heading settings-recalls-heading">
      <div class="settings-recall-heading-copy">
        <span class="account-eyebrow">VEHICLE SAFETY</span>
        <h2>Recall Monitoring</h2>
        <p>Check active GarageLog vehicles against NHTSA's official year/make/model recall catalog.</p>
      </div>
      <div class="settings-recall-heading-actions">
        <img class="settings-nhtsa-logo" src="/assets/nhtsa-logo.png" alt="NHTSA" loading="lazy">
        ${isAdministrator()?`<button class="primary compact-action settings-recall-check-button" type="button" ${recallDisabled} onclick="checkVehicleRecallsNow()">${svg('refresh')} Check NHTSA Now</button>`:''}
      </div>
    </div>

    <div class="settings-recall-standalone-body">
      <div class="settings-recall-overview-grid">
        <section class="settings-recall-settings-card">
          <div class="settings-recall-card-heading"><div><span class="settings-card-kicker">RECALL SETTINGS</span><h3>Monitoring</h3></div></div>
          <label class="settings-feature-toggle settings-recall-master-toggle">
            <span><strong>Monitor vehicle recalls</strong><small>Disabled by default because this sends year, make, and model to NHTSA.</small></span>
            <input type="checkbox" role="switch" ${config.recallNotificationsEnabled?'checked':''} ${disabled} onchange="updateServerNotificationSetting('recallNotificationsEnabled',this.checked)">
          </label>
          <label class="settings-recall-interval ${config.recallNotificationsEnabled?'':'disabled'}">
            <span>Automatic check schedule</span>
            <select ${!isAdministrator()||!config.recallNotificationsEnabled?'disabled':''} onchange="updateServerNotificationSetting('recallCheckSchedule',this.value)">
              ${[['manual','Manual only'],['startup','At server startup'],['monthly','Once a month'],['quarterly','Every 3 months'],['semiannual','Every 6 months']].map(([value,label])=>`<option value="${value}" ${normalizeRecallSchedule(config.recallCheckSchedule)===value?'selected':''}>${label}</option>`).join('')}
            </select>
            <small>${normalizeRecallSchedule(config.recallCheckSchedule)==='manual'?'GarageLog checks only when Check NHTSA Now is selected.':normalizeRecallSchedule(config.recallCheckSchedule)==='startup'?'GarageLog checks once when the server starts.':`GarageLog checks automatically ${recallScheduleLabel(config.recallCheckSchedule).toLowerCase()}.`}</small>
          </label>
        </section>
        ${settingsRecallStatusCardMarkup()}
      </div>
      ${settingsRecallIssueMarkup()}
      ${settingsRecallResultsMarkup()}
    </div>
  </section>

  <section class="card settings-section settings-notifications-section">
    <div class="settings-section-heading settings-notifications-heading">
      <div>
        <div class="settings-notifications-title-row"><span class="account-eyebrow">SERVER NOTIFICATIONS</span><span class="settings-experimental-badge">Experimental</span></div>
        <h2>Notifications</h2>
        <p>Control the server-side alerts GarageLog can surface now and deliver to GarageLog Mobile later.</p>
        <p class="settings-experimental-note"><strong>Experimental:</strong> Server-side alert events work now; mobile push delivery is still being developed.</p>
      </div>
      ${isAdministrator()?`<button class="secondary compact-action" type="button" onclick="runServerNotificationEvaluation()">${svg('bell')} Evaluate Now</button>`:''}
    </div>

    <div class="settings-notification-standalone-body">
      <label class="settings-feature-toggle settings-server-master">
        <span><strong>Server notifications</strong><small>Master switch for persisted notification events.</small></span>
        <input type="checkbox" role="switch" ${config.enabled?'checked':''} ${disabled} onchange="updateServerNotificationSetting('enabled',this.checked)">
      </label>

      <label class="settings-feature-toggle ${config.enabled?'':'disabled'}">
        <span><strong>Reminder &amp; maintenance alerts</strong><small>Create alerts as date and mileage reminders approach.</small></span>
        <input type="checkbox" role="switch" ${config.reminderNotificationsEnabled?'checked':''} ${nestedDisabled} onchange="updateServerNotificationSetting('reminderNotificationsEnabled',this.checked)">
      </label>

      <div class="settings-notification-inline-fields ${config.enabled?'':'disabled'}">
        <label>
          <span>Reminder lead time</span>
          <div><input type="number" min="0" max="90" step="1" value="${Number(config.reminderLeadDays||0)}" ${nestedDisabled} onchange="updateServerNotificationSetting('reminderLeadDays',Number(this.value))"><em>days</em></div>
          <small>Alert this many days before a due date.</small>
        </label>
        <label>
          <span>Mileage lead</span>
          <div><input type="number" min="0" max="10000" step="50" value="${Number(config.mileageLeadMiles||0)}" ${nestedDisabled} onchange="updateServerNotificationSetting('mileageLeadMiles',Number(this.value))"><em>miles</em></div>
          <small>Alert this many miles before a mileage target.</small>
        </label>
      </div>
    </div>
  </section>`;
}

window.updateServerNotificationSetting=async function(key,value){
  if(!isAdministrator()){toast('Administrator access is required');return}
  const current=settingsNotificationConfig(),next={...current,[key]:value};
  next.reminderLeadDays=Math.max(0,Math.min(90,Number(next.reminderLeadDays||0)));
  next.mileageLeadMiles=Math.max(0,Math.min(10000,Number(next.mileageLeadMiles||0)));
  next.recallCheckSchedule=normalizeRecallSchedule(next.recallCheckSchedule);
  try{
    settingsNotificationData=await authRequest('/api/settings/notifications',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(next)});
    await refreshServerNotifications().catch(()=>{});
    render();
    toast(key.startsWith('recall')?'Recall monitoring settings saved':'Notification settings saved');
    if(key==='recallNotificationsEnabled'&&value){const unmatched=(settingsRecallSummary().vehicles||[]).find(vehicle=>!vehicle.isValidated);if(unmatched)setTimeout(()=>openRecallVehicleMatch(unmatched.vehicleId),80)}
  }catch(error){toast(error.message||'Unable to save notification settings')}
};

window.runServerNotificationEvaluation=async function(){
  if(!isAdministrator())return;
  try{await authRequest('/api/notifications/evaluate',{method:'POST'});await Promise.all([refreshSettingsData(),refreshServerNotifications()]);render();toast('Notification rules evaluated')}catch(error){toast(error.message||'Unable to evaluate notifications')}
};

window.checkVehicleRecallsNow=async function(){
  if(!isAdministrator())return;
  const button=document.querySelector('.settings-recall-check-button');if(button){button.disabled=true;button.textContent='Checking NHTSA…'}
  try{
    const result=await authRequest('/api/recalls/check',{method:'POST'});
    settingsNotificationData={settings:settingsNotificationConfig(),recall:result.summary};
    await refreshServerNotifications().catch(()=>{});
    render();
    const checked=Number(result.result?.vehiclesChecked||0),found=Number(result.result?.campaignsFound||0),errors=Number(result.result?.errors||0),needsValidation=Number(result.result?.vehiclesNeedingValidation||0);
    toast(needsValidation?`${needsValidation} vehicle${needsValidation===1?' needs':'s need'} NHTSA matching before recall checks can run`:errors?`Checked ${checked} vehicle${checked===1?'':'s'} · ${errors} issue${errors===1?'':'s'}`:`Checked ${checked} vehicle${checked===1?'':'s'} · ${found} campaign${found===1?'':'s'}`);
  }catch(error){toast(error.message||'Unable to check NHTSA recalls');if(button){button.disabled=false;button.textContent='Check NHTSA Now'}}
};

function settingsPage(){
  const activeShares=settingsShares.filter(share=>share.status==='Active').length;
  const expiredShares=settingsShares.filter(share=>share.status==='Expired').length;
  const revokedShares=settingsShares.filter(share=>share.status==='Revoked').length;
  const appearance=appearanceSettings();
  const appearanceDisabled=isAdministrator()?'':'disabled';

  return `<div class="settings-page">
    <div class="account-page-header">
      <div>
        <span class="account-eyebrow">GARAGELOG SETTINGS</span>
        <h1>Settings</h1>
        <p>Manage server appearance, integrations, API access, and externally shared document links.</p>
      </div>
      <span class="account-access-summary">Local instance</span>
    </div>

    <section class="card settings-section settings-appearance-section">
      <div class="settings-section-heading">
        <div>
          <span class="account-eyebrow">SERVER APPEARANCE</span>
          <h2>Navigation Colors</h2>
          <p>Choose the background color for the left navigation pane and top banner. Cards and content containers keep their existing colors.</p>
        </div>
        ${isAdministrator()?`<button class="secondary" type="button" onclick="resetGarageChromeColors()">Reset to Default</button>`:''}
      </div>
      <div class="settings-appearance-grid">
        <label class="settings-color-control">
          <span><strong>Left pane</strong><small>Navigation background</small></span>
          <span class="settings-color-picker-wrap">
            <input type="color" value="${esc(appearance.sidebarColor)}" aria-label="Left pane color" ${appearanceDisabled} oninput="previewGarageChromeColor('sidebar',this.value)" onchange="saveGarageChromeColor('sidebar',this.value)">
            <output data-color-value="sidebar">${esc(String(appearance.sidebarColor).toUpperCase())}</output>
          </span>
        </label>
        <label class="settings-color-control">
          <span><strong>Top banner</strong><small>Header background</small></span>
          <span class="settings-color-picker-wrap">
            <input type="color" value="${esc(appearance.topbarColor)}" aria-label="Top banner color" ${appearanceDisabled} oninput="previewGarageChromeColor('topbar',this.value)" onchange="saveGarageChromeColor('topbar',this.value)">
            <output data-color-value="topbar">${esc(String(appearance.topbarColor).toUpperCase())}</output>
          </span>
        </label>
        <label class="settings-color-control">
          <span><strong>Highlight color</strong><small>Selected navigation, unread notification accents, primary actions, and accent text</small></span>
          <span class="settings-color-picker-wrap">
            <input type="color" value="${esc(appearance.highlightColor)}" aria-label="Highlight color" ${appearanceDisabled} oninput="previewGarageChromeColor('highlight',this.value)" onchange="saveGarageChromeColor('highlight',this.value)">
            <output data-color-value="highlight">${esc(String(appearance.highlightColor).toUpperCase())}</output>
          </span>
        </label>
      </div>
      <div class="settings-appearance-note">${isAdministrator()?'These colors apply to the GarageLog server interface for all users. Highlight color changes selected navigation, unread notification accents, and interactive accents without changing the bell background or semantic status colors such as warning, success, or danger. Text contrast adjusts automatically for darker panel selections.':'Server appearance can only be changed by an administrator.'}</div>
    </section>

    ${settingsNotificationsSection()}

    <section class="card settings-section">
      <div class="settings-section-heading">
        <div>
          <span class="account-eyebrow">INTEGRATIONS</span>
          <h2>API &amp; Devices</h2>
          <p>Create scoped tokens for GarageLog Bridge and future local integrations. Token values are only shown once.</p>
        </div>
        ${isAdministrator()?`<button class="primary" type="button" onclick="openApiTokenCreator()">${svg('plus')} New API Token</button>`:''}
      </div>
      <div class="settings-token-list">${settingsTokenRows()}</div>
    </section>

    <section class="card settings-section">
      <div class="settings-section-heading">
        <div>
          <span class="account-eyebrow">OBD TELEMETRY</span>
          <h2>OBD Devices &amp; Mileage</h2>
          <p>Associate each OBD device with the vehicle it monitors. Trust and automatic mileage approval are configured for that device and vehicle pairing.</p>
        </div>
      </div>
      <h3 class="settings-subheading">Devices</h3>
      <div class="settings-obd-list">${settingsDeviceRows()}</div>
      <h3 class="settings-subheading">Odometer proposals</h3>
      <div class="settings-odometer-list">${settingsOdometerRows()}</div>
    </section>

    <section class="card settings-section">
      <div class="settings-section-heading">
        <div>
          <span class="account-eyebrow">SHARING SECURITY</span>
          <h2>Share Links</h2>
          <p>Review and manage active, expired, and revoked document share links from one location.</p>
        </div>
        <button class="secondary" type="button" onclick="openDocumentShareManager()">${svg('shield')} Manage Share Links</button>
      </div>
      <div class="settings-summary-grid">
        <div><strong>${activeShares}</strong><span>Active</span></div>
        <div><strong>${expiredShares}</strong><span>Expired</span></div>
        <div><strong>${revokedShares}</strong><span>Revoked</span></div>
      </div>
      <div class="settings-share-list">${settingsShareRows()}</div>
      ${settingsShares.length>6?`<div class="settings-more-note">${settingsShares.length-6} additional share-link record${settingsShares.length-6===1?'':'s'} available in Manage Share Links.</div>`:''}
    </section>
  </div>`;
}

async function refreshSettingsData(){
  const jobs=[listDocumentShares().then(shares=>{settingsShares=shares||[]}),authRequest('/api/settings/notifications').then(result=>{settingsNotificationData=result})];

  if(isAdministrator()){
    jobs.push(
      authRequest('/api/api-tokens')
        .then(result=>{settingsApiTokens=result.tokens||[]}),
      authRequest('/api/obd-devices')
        .then(result=>{settingsObdDevices=result.devices||[];settingsObdVehicles=result.vehicles||[];settingsOdometerProposals=result.odometerProposals||[]})    );
  }else{
    settingsApiTokens=[];
  }

  await Promise.all(jobs);
}

window.openApiTokenCreator=function(){
  if(!isAdministrator()){
    toast('Administrator access is required to create API tokens');
    return;
  }

  const dialog=ensureDynamicDialog('apiTokenDialog','api-token-dialog');
  dialog.innerHTML=`
    <form id="apiTokenCreateForm">
      <div class="modal-header">
        <div>
          <span class="wizard-eyebrow">API &amp; DEVICES</span>
          <h3>Create API Token</h3>
          <p>Create a limited token for GarageLog Bridge or another trusted local integration.</p>
        </div>
        <button type="button" class="icon-btn api-token-close">${svg('close')}</button>
      </div>
      <div class="settings-token-form">
        <label>Name
          <input name="name" maxlength="80" value="GarageLog Mobile" required>
        </label>

        <fieldset>
          <legend>Permissions</legend>
          <label class="settings-check"><input type="checkbox" name="scope" value="vehicles:read" checked><span><strong>Read vehicle information</strong><small>vehicles:read</small></span></label>
          <label class="settings-check"><input type="checkbox" name="scope" value="telemetry:write" checked><span><strong>Write mobile data</strong><small>telemetry:write · telemetry, mileage, receipts</small></span></label>
          <label class="settings-check"><input type="checkbox" name="scope" value="device:sync" checked><span><strong>Device synchronization</strong><small>device:sync</small></span></label>
          <label class="settings-check"><input type="checkbox" name="scope" value="notifications:read" checked><span><strong>Read server notifications</strong><small>notifications:read · prepares GarageLog Mobile for notification delivery</small></span></label>
        </fieldset>

        <label>Expiration
          <select name="expiration" id="apiTokenExpiration">
            <option value="">Never</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="365">1 year</option>
            <option value="custom">Custom</option>
          </select>
        </label>

        <label id="apiTokenCustomWrap" hidden>Custom expiration
          <input name="customExpiration" type="datetime-local">
        </label>
      </div>
      <div class="modal-actions">
        <button type="button" class="secondary api-token-cancel">Cancel</button>
        <button type="submit" class="primary">Create Token</button>
      </div>
    </form>`;

  const close=()=>dialog.close();
  dialog.querySelector('.api-token-close').onclick=close;
  dialog.querySelector('.api-token-cancel').onclick=close;

  const expiration=dialog.querySelector('#apiTokenExpiration');
  const customWrap=dialog.querySelector('#apiTokenCustomWrap');
  expiration.onchange=()=>{
    customWrap.hidden=expiration.value!=='custom';
    const input=customWrap.querySelector('input');
    if(expiration.value==='custom'&&!input.value){
      const date=new Date(Date.now()+365*24*60*60*1000);
      date.setSeconds(0,0);
      input.value=new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);
    }
  };

  dialog.querySelector('#apiTokenCreateForm').onsubmit=async event=>{
    event.preventDefault();
    const form=event.currentTarget;
    const button=form.querySelector('button[type=submit]');
    const fd=new FormData(form);
    const scopes=fd.getAll('scope').map(String);

    if(!scopes.length){
      toast('Select at least one API permission');
      return;
    }

    let expiresInDays=null;
    let expiresAtUtc=null;
    const expiry=String(fd.get('expiration')||'');

    if(expiry==='custom'){
      const raw=String(fd.get('customExpiration')||'');
      const date=new Date(raw);
      if(!raw||Number.isNaN(date.getTime())){
        toast('Choose a valid custom expiration');
        return;
      }
      expiresAtUtc=date.toISOString();
    }else if(expiry){
      expiresInDays=Number(expiry);
    }

    button.disabled=true;
    try{
      const result=await authRequest('/api/api-tokens',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          name:String(fd.get('name')||'').trim(),
          scopes,
          expiresInDays,
          expiresAtUtc
        })
      });

      await refreshSettingsData();
      render();
      dialog.close();
      showCreatedApiToken(result.token,result.apiToken);
    }catch(error){
      toast(error.message||'Unable to create API token');
    }finally{
      button.disabled=false;
    }
  };

  dialog.showModal();
};

function showCreatedApiToken(token,apiToken){
  const dialog=ensureDynamicDialog('apiTokenCreatedDialog','api-token-created-dialog');
  dialog.innerHTML=`
    <div class="modal-header">
      <div>
        <span class="wizard-eyebrow">TOKEN CREATED</span>
        <h3>${esc(apiToken?.name||'GarageLog API Token')}</h3>
        <p>Copy this token now. GarageLog will not display the complete value again.</p>
      </div>
      <button type="button" class="icon-btn api-created-close">${svg('close')}</button>
    </div>
    <div class="api-token-reveal">
      <textarea id="createdApiTokenValue" class="api-token-value" readonly spellcheck="false" aria-label="Generated API token">${esc(token)}</textarea>
      <div class="settings-security-note warning">
        ${svg('warning')}
        <span>Store this token only in the trusted application or device that needs it.</span>
      </div>
    </div>
    <div class="modal-actions">
      <button type="button" class="secondary api-created-copy">${svg('share')} Copy Token</button>
      <button type="button" class="primary api-created-done">Done</button>
    </div>`;

  const close=()=>dialog.close();
  dialog.querySelector('.api-created-close').onclick=close;
  dialog.querySelector('.api-created-done').onclick=close;
  dialog.querySelector('.api-created-copy').onclick=async()=>{
    const tokenElement=dialog.querySelector('#createdApiTokenValue');
    const tokenValue=tokenElement?.value||token||'';
    const copied=await settingsCopyText(tokenValue,dialog);

    if(copied){
      toast('API token copied');
      return;
    }

    if(tokenElement){
      tokenElement.focus();
      tokenElement.select();
      tokenElement.setSelectionRange(0,tokenElement.value.length);
    }

    toast('Copy was blocked. Token selected - press Ctrl+C.');
  };

  const tokenElement=dialog.querySelector('#createdApiTokenValue');
  if(tokenElement){
    tokenElement.onclick=()=>{
      tokenElement.focus();
      tokenElement.select();
      tokenElement.setSelectionRange(0,tokenElement.value.length);
    };
  }
  dialog.showModal();
}

function openSettingsTokenConfirm({title,message,confirmLabel,onConfirm}){
  const dialog=ensureDynamicDialog('settingsTokenConfirmDialog','settings-confirm-dialog');
  dialog.innerHTML=`
    <div class="modal-header">
      <div><span class="wizard-eyebrow">API &amp; DEVICES</span><h3>${esc(title)}</h3><p>${esc(message)}</p></div>
      <button type="button" class="icon-btn settings-confirm-close">${svg('close')}</button>
    </div>
    <div class="modal-actions">
      <button type="button" class="secondary settings-confirm-cancel">Cancel</button>
      <button type="button" class="danger settings-confirm-action">${esc(confirmLabel)}</button>
    </div>`;
  const close=()=>dialog.close();
  dialog.querySelector('.settings-confirm-close').onclick=close;
  dialog.querySelector('.settings-confirm-cancel').onclick=close;
  dialog.querySelector('.settings-confirm-action').onclick=async()=>{
    const button=dialog.querySelector('.settings-confirm-action');
    button.disabled=true;
    try{
      await onConfirm();
      dialog.close();
    }catch(error){
      button.disabled=false;
      toast(error.message||'Unable to complete that action');
    }
  };
  dialog.showModal();
}

window.revokeApiToken=function(id){
  const token=settingsApiTokens.find(item=>item.id===id);
  openSettingsTokenConfirm({
    title:'Revoke API Token?',
    message:`${token?.name||'This API token'} will stop authenticating apps and devices immediately. The token record will remain in GarageLog.`,
    confirmLabel:'Revoke Token',
    onConfirm:async()=>{
      await authRequest(`/api/api-tokens/${encodeURIComponent(id)}/revoke`,{method:'POST'});
      await refreshSettingsData();
      render();
      toast('API token revoked');
    }
  });
};

window.deleteApiToken=function(id){
  const token=settingsApiTokens.find(item=>item.id===id);
  const active=token?.status==='Active';
  openSettingsTokenConfirm({
    title:'Delete API Token?',
    message:`Permanently remove ${token?.name||'this API token'} from GarageLog.${active?' Because it is active, any app or device using it will stop working immediately.':''}`,
    confirmLabel:'Delete Token',
    onConfirm:async()=>{
      await authRequest(`/api/api-tokens/${encodeURIComponent(id)}`,{method:'DELETE'});
      await refreshSettingsData();
      render();
      toast('API token deleted');
    }
  });
};
