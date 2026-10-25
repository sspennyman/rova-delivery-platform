(() => {
  'use strict';
  const key='rivoAppearanceV1', allowed=new Set(['auto','light','dark']), root=document.documentElement;
  const cookieValue=()=>document.cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith('rivo_theme='))?.slice(11);
  let preference='auto';
  try {const saved=cookieValue() || localStorage.getItem(key);if(allowed.has(saved))preference=saved;}catch{}
  const resolved=()=>preference==='auto'?(new Date().getHours()>=7 && new Date().getHours()<19?'light':'dark'):preference;
  let dialog, previousFocus;
  function apply() {
    root.dataset.theme=resolved();root.dataset.themePreference=preference;
    document.querySelectorAll('meta[name="theme-color"]').forEach(meta=>meta.content=root.dataset.theme==='light'?'#f4f7fb':'#050506');
    document.querySelectorAll('[data-rivo-light-src]').forEach(img=>{const src=root.dataset.theme==='light'?img.dataset.rivoLightSrc:img.dataset.rivoDarkSrc;if(src && img.getAttribute('src')!==src)img.setAttribute('src',src);});
    document.querySelectorAll('[data-rivo-theme-select]').forEach(select=>select.value=preference);
    document.querySelectorAll('[data-rivo-theme-choice]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.rivoThemeChoice===preference)));
    document.querySelectorAll('[data-rivo-current-theme]').forEach(label=>label.textContent=preference==='auto'?'Auto · by time of day':preference==='light'?'Light':'Dark');
  }
  function setPreference(value) {
    if(!allowed.has(value))return;
    preference=value;
    try {localStorage.setItem(key,value);}catch{}
    const shared=location.hostname==='floraljet.llc'||location.hostname==='app.floraljet.llc'||location.hostname==='www.floraljet.llc';
    try {document.cookie=`rivo_theme=${value}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol==='https:'?'; Secure':''}${shared?'; Domain=floraljet.llc':''}`;}catch{}
    apply();
  }
  function open() {
    if(!dialog){
      dialog=document.createElement('dialog');dialog.className='rivo-appearance-dialog';dialog.setAttribute('aria-labelledby','rivo-display-title');
      dialog.innerHTML='<div class="rivo-appearance-heading"><h2 id="rivo-display-title">Display theme</h2><button type="button" data-rivo-close aria-label="Close display settings">✕</button></div><p>Choose the same look for the Rivo website and app on this browser.</p><div class="rivo-appearance-choices"><button type="button" data-rivo-theme-choice="auto">Automatic<small>Light 7 am–7 pm. Dark overnight.</small></button><button type="button" data-rivo-theme-choice="light">Light<small>A bright workspace, all day.</small></button><button type="button" data-rivo-theme-choice="dark">Dark<small>A dark workspace, all day.</small></button></div><p class="rivo-appearance-note">Automatic uses your device’s local time.</p>';
      dialog.querySelector('[data-rivo-close]').addEventListener('click',()=>dialog.close());
      dialog.addEventListener('close',()=>{if(previousFocus?.isConnected)previousFocus.focus();});document.body.append(dialog);
    }
    previousFocus=document.activeElement;apply();dialog.showModal();
  }
  function settingsHtml() {
    return '<section class="panel rivo-display-settings"><div class="panel-body"><h3>Display theme</h3><p>Automatic uses light from 7 am to 7 pm and dark overnight, in your local time.</p><label>Appearance<select class="select" data-rivo-theme-select aria-label="Display theme"><option value="auto"'+(preference==='auto'?' selected':'')+'>Automatic · time of day</option><option value="light"'+(preference==='light'?' selected':'')+'>Light</option><option value="dark"'+(preference==='dark'?' selected':'')+'>Dark</option></select></label></div></section>';
  }
  window.RivoAppearance={getPreference:()=>preference,setPreference,settingsHtml,open};
  apply();
  document.addEventListener('click',event=>{
    const choice=event.target.closest('[data-rivo-theme-choice]');if(choice){setPreference(choice.dataset.rivoThemeChoice);return;}
    if(event.target.closest('[data-rivo-appearance]'))open();
  });
  document.addEventListener('change',event=>{if(event.target.matches('[data-rivo-theme-select]'))setPreference(event.target.value);});
  function ready(){
    const app=Boolean(document.getElementById('app'));
    root.dataset.rivoApp=String(app);
    const launcher=document.createElement('button');launcher.type='button';launcher.className='rivo-appearance-launcher';launcher.dataset.rivoAppearance='';launcher.setAttribute('aria-label','Change display theme');launcher.title='Display theme';
    launcher.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5"/></svg>';
    document.body.append(launcher);
    // Signed-in layouts provide Settings and sidebar controls instead of covering
    // the driver's bottom navigation with another floating action.
    const refresh=()=>{launcher.hidden=app && Boolean(document.querySelector('.app-shell'));};
    refresh();if(app)new MutationObserver(refresh).observe(document.getElementById('app'),{childList:true,subtree:true});
    apply();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready,{once:true});else ready();
  const refresh=()=>{const shared=cookieValue(),before=preference;if(allowed.has(shared))preference=shared;if(before!==preference || root.dataset.theme!==resolved())apply();};
  setInterval(refresh,1000);window.addEventListener('focus',refresh);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  window.addEventListener('storage',event=>{if(event.key===key && allowed.has(event.newValue)){preference=event.newValue;apply();}});
})();
