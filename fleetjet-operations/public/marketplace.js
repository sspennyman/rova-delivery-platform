const provider=location.pathname.endsWith('/wix')?'wix':'shopify';
const params=new URLSearchParams(location.search),instance=params.get('instance')||'';
const status=document.querySelector('#status'),form=document.querySelector('#connect'),signin=document.querySelector('#signin'),connected=document.querySelector('#connected');
document.querySelector('#platform').textContent=provider==='wix'?'Wix store connection':'Shopify store connection';
const shop=document.querySelector('#shop');shop.value=params.get('shop')||'';
if(provider==='wix'){document.querySelector('#shop-label').hidden=true;shop.hidden=true;}
async function api(path,options={}) {const r=await fetch(path,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json'},...(options.body?{body:JSON.stringify(options.body)}:{})});const data=await r.json();if(!r.ok)throw Object.assign(Error(data.error||'Please retry.'),{status:r.status});return data;}
async function check() {
  form.hidden=true;signin.hidden=true;connected.hidden=true;status.textContent='Checking this installation…';
  try {
    const configuration=await api(`/api/marketplace/${provider}/status`);
    if(!configuration.configured){status.textContent='This marketplace app is being prepared for release. Existing Rivo store connections are unaffected. Contact Rivo for setup help.';return;}
    if(provider==='wix'&&!instance){status.textContent='Open Rivo from your Wix site’s dashboard to authorize this connection.';return;}
    if(provider==='wix'&&window.top!==window){const link=document.querySelector('#open-rivo');link.href=location.href;link.hidden=false;status.textContent='Open a secure Rivo window to connect your dispatcher workspace.';return;}
    const me=await api('/api/me');
    if(provider==='shopify'&&me.session?.role==='dispatcher')void loadPrivacy();
    if(me.session?.role!=='dispatcher')throw Object.assign(Error('Dispatcher sign-in required.'),{status:401});
    if(params.get('connected')==='1' && configuration.connected){status.textContent='Your store is connected.';connected.hidden=false;return;}
    status.textContent=`Connect this store to ${me.snapshot?.company?.name||'your Rivo workspace'}.`;
    form.hidden=false;
  } catch(error) {if(error.status===401){status.textContent='Sign in to Rivo to connect your store.';signin.hidden=false;}else status.textContent=error.message;}
}
form.addEventListener('submit',async event=>{event.preventDefault();const button=document.querySelector('#connect-button');button.disabled=true;status.textContent='Opening store authorization…';try{const result=await api(`/api/marketplace/${provider}/connect`,{method:'POST',body:provider==='wix'?{instance}:{shop:shop.value.trim()}});if(result.authorizationUrl){location.assign(result.authorizationUrl);return;}status.textContent='Your store is connected.';form.hidden=true;connected.hidden=false;history.replaceState(null,'',location.pathname+'?connected=1');}catch(error){status.textContent=error.message;}finally{button.disabled=false;}});
document.querySelector('#check-login').addEventListener('click',check);
void check();

async function loadPrivacy() {
  const panel=document.querySelector('#privacy-panel'),list=document.querySelector('#privacy-list'),message=document.querySelector('#privacy-status');
  try {
    const {requests}=await api('/api/marketplace/shopify/privacy');panel.hidden=false;list.replaceChildren();
    message.textContent=requests.length?'Requests are restricted to your workspace.':'No privacy requests received.';
    for(const request of requests) {
      const row=document.createElement('article'),title=document.createElement('h3'),meta=document.createElement('p');
      title.textContent=request.type;meta.textContent=`${request.shop} · ${new Date(request.createdAt).toLocaleDateString()} · ${request.status}`;row.append(title,meta);
      if(request.status!=='complete') {
        const download=document.createElement('button');download.className='market-secondary';download.textContent='Download request and matching records';
        download.addEventListener('click',async()=>{download.disabled=true;try{const data=await api('/api/marketplace/shopify/privacy/'+request.id);const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='rivo-privacy-'+request.id.slice(0,12)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);message.textContent='Keep this export private. No delivery records have been erased.';}catch(e){message.textContent=e.message;}finally{download.disabled=false;}});
        const form=document.createElement('form'),note=document.createElement('input'),confirmation=document.createElement('input'),submit=document.createElement('button');
        note.placeholder='Describe the completed privacy work and retention review';note.setAttribute('aria-label','Resolution details');note.required=true;note.minLength=20;note.maxLength=1000;
        confirmation.placeholder='Type RESOLVED after completing the request';confirmation.setAttribute('aria-label','Type RESOLVED');confirmation.required=true;
        submit.className='market-secondary';submit.textContent='Record completed resolution';form.append(note,confirmation,submit);
        form.addEventListener('submit',async e=>{e.preventDefault();submit.disabled=true;try{await api('/api/marketplace/shopify/privacy/'+request.id+'/resolve',{method:'POST',body:{note:note.value,confirmation:confirmation.value}});await loadPrivacy();}catch(error){message.textContent=error.message;submit.disabled=false;}});
        row.append(download,form);
      } else {const resolution=document.createElement('p');resolution.textContent=request.resolution;row.append(resolution);}
      list.append(row);
    }
  }catch(e){if(e.status!==401)message.textContent=e.message;}
}
