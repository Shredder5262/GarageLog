let settingsApiTokens=[];
let settingsShares=[];
let settingsObdDevices=[];
let settingsObdVehicles=[];
let settingsOdometerProposals=[];

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
    'telemetry:write':'Telemetry Write',
    'device:sync':'Device Sync'
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
      <div class="settings-obd-association"><label>GarageLog vehicle<select id="obd-vehicle-${esc(device.deviceId)}"><option value="">Not associated</option>${options}</select></label><button class="secondary" type="button" onclick="associateSettingsObdDevice('${esc(device.deviceId)}')">Save association</button></div>
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
    </article>`;
  }).join('');
}

function settingsOdometerRows(){
  const actionable=settingsOdometerProposals.filter(item=>!['applied','dismissed'].includes(item.storedStatus));
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
  try{const result=await authRequest(`/api/odometer-proposals/${encodeURIComponent(tripId)}/apply`,{method:'POST'});await refreshSettingsData();render();toast(result.message||'Odometer proposal processed')}catch(error){toast(error.message||'Unable to apply odometer proposal')}
};
window.dismissSettingsOdometer=async function(tripId){
  try{await authRequest(`/api/odometer-proposals/${encodeURIComponent(tripId)}/dismiss`,{method:'POST'});await refreshSettingsData();render();toast('Odometer proposal dismissed')}catch(error){toast(error.message||'Unable to dismiss odometer proposal')}
};

function settingsPage(){
  const activeShares=settingsShares.filter(share=>share.status==='Active').length;
  const expiredShares=settingsShares.filter(share=>share.status==='Expired').length;
  const revokedShares=settingsShares.filter(share=>share.status==='Revoked').length;

  return `<div class="settings-page">
    <div class="account-page-header">
      <div>
        <span class="account-eyebrow">GARAGELOG SETTINGS</span>
        <h1>Settings</h1>
        <p>Manage integrations, API access, and externally shared document links.</p>
      </div>
      <span class="account-access-summary">Local instance</span>
    </div>

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
  const jobs=[listDocumentShares().then(shares=>{settingsShares=shares||[]})];

  if(isAdministrator()){
    jobs.push(
      authRequest('/api/api-tokens')
        .then(result=>{settingsApiTokens=result.tokens||[]}),
      authRequest('/api/obd-devices')
        .then(result=>{settingsObdDevices=result.devices||[];settingsObdVehicles=result.vehicles||[];settingsOdometerProposals=result.odometerProposals||[]})
    );
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
          <label class="settings-check"><input type="checkbox" name="scope" value="telemetry:write" checked><span><strong>Upload telemetry</strong><small>telemetry:write</small></span></label>
          <label class="settings-check"><input type="checkbox" name="scope" value="device:sync" checked><span><strong>Device synchronization</strong><small>device:sync</small></span></label>
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
