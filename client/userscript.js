(function(){
  if (window.__mcBlocksStrict) return;
  const wait=(ms)=>new Promise(r=>setTimeout(r,ms));

  // ==== config your backend origin ====
  const BACKEND = "https://YOUR_DOMAIN_OR_PORT"; // e.g., https://mcai.yourdomain.com
  const APP_TOKEN = ""; // optional: if you set SERVER_APP_TOKEN on the server

  // ==== UI ====
  const ui=document.createElement('div');
  ui.style.cssText='position:fixed;right:12px;bottom:12px;width:460px;max-height:84vh;overflow:auto;background:#0b1020;color:#e6e8ef;font-family:system-ui,Segoe UI,Arial,sans-serif;border:1px solid #21304f;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.35);display:flex;flex-direction:column;z-index:2147483647';
  ui.innerHTML=''
  +'<div id="h" style="cursor:move;display:flex;align-items:center;padding:10px 12px;background:#111936;border-bottom:1px solid #21304f">'
  +'  <span style="font-weight:600;font-size:13px">MakeCode AI</span>'
  +'  <span id="status" style="margin-left:10px;font-size:11px;color:#9bb1dd">Idle</span>'
  +'  <button id="x" style="margin-left:auto;background:transparent;border:none;color:#93a4c4;font-size:16px;cursor:pointer">x</button>'
  +'</div>'
  +'<div style="padding:10px 12px;display:grid;gap:8px;border-bottom:1px solid #21304f">'
  +'  <div style="display:flex;gap:8px">'
  +'    <select id="engine" style="flex:1;padding:8px;border-radius:8px;border:1px solid #29324e;background:#0b1020;color:#e6e8ef">'
  +'      <option value="">Loading engines…</option>'
  +'    </select>'
  +'    <button id="setEngine" style="padding:8px 12px;border:1px solid #2b3a5a;border-radius:8px;background:#223058;color:#e6e8ef;cursor:pointer">Use</button>'
  +'  </div>'
  +'  <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">'
  +'    <select id="target" style="flex:1 1 48%;padding:8px;border-radius:8px;border:1px solid #29324e;background:#0b1020;color:#e6e8ef">'
  +'      <option value="microbit">micro:bit</option>'
  +'      <option value="arcade">Arcade</option>'
  +'      <option value="maker">Maker</option>'
  +'    </select>'
  +'    <label style="display:flex;gap:6px;align-items:center;font-size:12px;color:#c7d2fe"><input id="inc" type="checkbox" checked>Use current code</label>'
  +'  </div>'
  +'  <textarea id="p" rows="3" placeholder="Describe what you want the block code to do-try to be specific" style="resize:vertical;min-height:64px;padding:8px;border-radius:8px;border:1px solid #29324e;background:#0b1020;color:#e6e8ef"></textarea>'
  +'  <div style="display:flex;gap:8px;flex-wrap:wrap">'
  +'    <button id="go" style="flex:1 1 48%;padding:10px;border:none;border-radius:8px;background:#3b82f6;color:#fff;font-weight:600;cursor:pointer">Generate & Paste</button>'
  +'    <button id="revert" style="flex:1 1 48%;padding:10px;border:1px solid #2b3a5a;border-radius:8px;background:#223058;color:#e6e8ef;cursor:pointer" disabled>Revert</button>'
  +'  </div>'
  +'</div>'
  +'<div id="fb" style="display:none;margin:12px;margin-top:0;padding:12px;border-radius:10px;background:linear-gradient(135deg,#1b2441,#101a33);border:1px solid #354b7d;box-shadow:0 4px 18px rgba(0,0,0,.3);">'
  +'  <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;">'
  +'    <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#8fb7ff;display:flex;align-items:center;gap:6px;">'
  +'      <span style="display:inline-flex;width:16px;height:16px;align-items:center;justify-content:center;border-radius:50%;background:#3b82f6;color:#0b1020;font-weight:700;font-size:10px;">i</span>'
  +'      Model Feedback'
  +'    </div>'
  +'    <button id="fbToggle" aria-label="Toggle feedback" style="background:rgba(148,163,255,0.15);color:#cdd9ff;border:1px solid rgba(148,163,255,0.3);border-radius:16px;padding:2px 10px;font-size:11px;font-weight:500;cursor:pointer;">Hide</button>'
  +'  </div>'
  +'  <div id="fbLines" style="display:grid;gap:6px;font-size:12px;color:#e4ecff;line-height:1.35;"></div>'
  +'</div>'
  +'<div id="log" style="padding:10px 12px;font-size:11px;color:#9bb1dd;display:block;max-height:200px;overflow:auto"></div>'
  +'<div id="rz" style="position:absolute;width:14px;height:14px;right:2px;bottom:2px;cursor:nwse-resize;background:linear-gradient(135deg,transparent 50%,#2b3a5a 50%);opacity:.9"></div>';
  document.body.appendChild(ui);

  const $=(s)=>ui.querySelector(s);
  const hdr=$('#h'), statusEl=$('#status'), closeBtn=$('#x'), resizer=$('#rz');
  const engine=$('#engine'), setEngine=$('#setEngine');
  const tgtSel=$('#target'), inc=$('#inc');
  const promptEl=$('#p'), go=$('#go'), revertBtn=$('#revert'), log=$('#log');
  const feedbackBox=$('#fb'), feedbackLines=$('#fbLines'), feedbackToggle=$('#fbToggle');

  let __lastCode=''; let __undoStack=[]; let busy=false;
  const setStatus=(t)=>statusEl.textContent=t;
  const logLine=(t)=>{ const d=document.createElement('div'); d.textContent=t; log.appendChild(d); log.scrollTop=log.scrollHeight; };
  const clearLog=()=>{ log.innerHTML=''; };

  // feedback ui
  let feedbackCollapsed=false;
  const applyFeedbackCollapse=()=>{
    if(!feedbackBox || !feedbackLines || !feedbackToggle) return;
    if(feedbackCollapsed){ feedbackLines.style.display='none'; feedbackToggle.textContent='Show'; feedbackToggle.setAttribute('aria-expanded','false'); feedbackBox.style.paddingBottom='8px'; }
    else{ feedbackLines.style.display='grid'; feedbackToggle.textContent='Hide'; feedbackToggle.setAttribute('aria-expanded','true'); feedbackBox.style.paddingBottom='12px'; }
  };
  const renderFeedback=(items)=>{
    if(!feedbackBox || !feedbackLines) return;
    feedbackLines.innerHTML='';
    const list=(items||[]).filter(x=>x&&x.trim());
    if(!list.length){
      feedbackCollapsed=false; feedbackBox.style.display='none'; feedbackBox.setAttribute('aria-hidden','true');
      if(feedbackToggle) feedbackToggle.style.visibility='hidden';
      return;
    }
    list.forEach(msg=>{
      const bubble=document.createElement('div');
      bubble.textContent=msg.trim();
      bubble.style.cssText='padding:8px 10px;border-left:3px solid #3b82f6;border-radius:6px;background:rgba(59,130,246,0.14);color:#f1f5ff;';
      feedbackLines.appendChild(bubble);
    });
    feedbackCollapsed=false;
    if(feedbackToggle){ feedbackToggle.style.visibility='visible'; }
    feedbackBox.style.display='block'; feedbackBox.setAttribute('aria-hidden','false');
    applyFeedbackCollapse();
  };
  if(feedbackToggle){
    feedbackToggle.style.visibility='hidden';
    feedbackToggle.onclick=function(){
      if(!feedbackBox || feedbackBox.style.display==='none') return;
      feedbackCollapsed=!feedbackCollapsed; applyFeedbackCollapse();
    };
  }

  // monaco helpers (unchanged)
  const clickLike=(root,labels)=>{
    const arr=labels.map(x=>x.toLowerCase());
    const q=[...root.querySelectorAll('button,[role="tab"],a,[aria-label]')].filter(e=>e&&e.offsetParent!==null);
    for(const el of q){
      const txt=((el.innerText||el.textContent||'')+' '+(el.getAttribute('aria-label')||'')).trim().toLowerCase();
      if(arr.some(s=>txt===s||txt.includes(s))){ el.click(); return el; }
    }
    return null;
  };
  const findMonacoCtx=(timeoutMs=18000)=>{
    const deadline=performance.now()+timeoutMs;
    const cands=[window,...[...document.querySelectorAll('iframe')].map(f=>{try{return f.contentWindow}catch(e){return null}})].filter(Boolean);
    cands.forEach(w=>{try{clickLike(w.document,['javascript','typescript','text']);}catch(e){}});
    return new Promise((resolve,reject)=>{
      (function poll(){
        if(performance.now()>=deadline){reject(new Error('Monaco not found. Open the project editor, not the home page.'));return;}
        for(const w of cands){
          try{
            const m=w.monaco;
            if(m&&m.editor){
              const models=m.editor.getModels();
              if(models&&models.length){
                const editors=m.editor.getEditors?m.editor.getEditors():[];
                const ed=(editors&&editors.length)?editors[0]:null;
                const model=(ed&&ed.getModel&&ed.getModel())||models[0];
                if(model){ resolve({win:w,monaco:m,editor:ed,model:model}); return; }
              }
            }
          }catch(e){}
        }
        setTimeout(poll,100);
        cands.forEach(w=>{try{clickLike(w.document,['javascript','typescript','text']);}catch(e){}});
      })();
    });
  };
  const pasteToMakeCode=(code)=>{
    return findMonacoCtx().then((ctx)=>{
      logLine('Switching to JavaScript tab.');
      clickLike(ctx.win.document,['javascript','typescript','text']);
      return wait(20).then(()=>{
        try{
          const prev = ctx.model.getValue() || '';
          __undoStack.push(prev);
          revertBtn.disabled = false;
          logLine('Snapshot saved for revert.');
        }catch(e){ logLine('Snapshot failed: '+e); }
        logLine('Pasting generated code into editor.');
        ctx.model.setValue(code);
        if(ctx.editor && ctx.editor.setPosition) ctx.editor.setPosition({lineNumber:1,column:1});
        logLine('Switching back to Blocks.');
        clickLike(ctx.win.document,['blocks']) || (function(){ const m=ctx.win.document.querySelector('button[aria-label*="More"],button[aria-label*="Editor"],.menu-button,.more-button'); if(m){ m.click(); return clickLike(ctx.win.document,['blocks']); }})();
      });
    });
  };
  const revertEditor=()=>{
    return findMonacoCtx().then((ctx)=>{
      if(!__undoStack.length){ throw new Error('No snapshot to revert to.'); }
      const prev = __undoStack.pop();
      logLine('Switching to JavaScript tab for revert.');
      clickLike(ctx.win.document,['javascript','typescript','text']);
      return wait(20).then(()=>{
        logLine('Restoring previous code.');
        ctx.model.setValue(prev);
        if(ctx.editor && ctx.editor.setPosition) ctx.editor.setPosition({lineNumber:1,column:1});
        logLine('Switching back to Blocks.');
        clickLike(ctx.win.document,['blocks']) || (function(){ const m=ctx.win.document.querySelector('button[aria-label*="More"],button[aria-label*="Editor"],.menu-button,.more-button'); if(m){ m.click(); return clickLike(ctx.win.document,['blocks']); }})();
      });
    }).then(()=>{ if(!__undoStack.length) revertBtn.disabled = true; });
  };

  // feedback toggle hookup
  const applyEngineOptions = (cfg) => {
    engine.innerHTML = "";
    (cfg.presets || []).forEach(p => {
      const opt = document.createElement('option');
      opt.value = p; opt.textContent = p;
      engine.appendChild(opt);
    });
    if (cfg.activePreset && [...engine.options].some(o => o.value === cfg.activePreset)) {
      engine.value = cfg.activePreset;
    }
  };

  // fetch presets
  function fetchConfig() {
    const headers = APP_TOKEN ? { "Authorization": "Bearer " + APP_TOKEN } : {};
    return fetch(BACKEND + "/mcai/config", { headers })
      .then(r => r.json())
      .then(cfg => { applyEngineOptions(cfg); })
      .catch(e => { logLine("Config load failed: " + (e && e.message ? e.message : e)); });
  }
  fetchConfig();

  setEngine.onclick = function(){
    const preset = engine.value;
    if (!preset) return;
    const headers = { "Content-Type": "application/json" };
    if (APP_TOKEN) headers["Authorization"] = "Bearer " + APP_TOKEN;
    fetch(BACKEND + "/mcai/config", {
      method: "POST",
      headers,
      body: JSON.stringify({ preset })
    }).then(r => {
      if (!r.ok) return r.json().then(j => { throw new Error(j && j.error || ('HTTP ' + r.status)); });
      return r.json();
    }).then(j => {
      setStatus("Engine set");
      logLine("Active engine: " + j.activePreset);
    }).catch(e => {
      setStatus("Error"); logLine("Set engine failed: " + (e && e.message ? e.message : e));
    });
  };

  // main action
  go.onclick=function(){
    if(busy) return; busy=true;
    clearLog(); renderFeedback([]);
    setStatus('Working'); logLine('Generating…');

    const req=promptEl.value.trim(); if(!req){ setStatus('Idle'); logLine('Please enter a request.'); busy=false; return; }
    const t=tgtSel.value.trim();

    const origText = go.textContent;
    go.textContent='Loading…'; go.disabled=true; go.style.opacity='0.7'; go.style.cursor='not-allowed';

    const curP = inc.checked ? (findMonacoCtx().then(ctx=>{ logLine('Reading current JavaScript.'); return ctx.model.getValue()||''; }).catch(()=>{ logLine('Could not read current code.'); return ''; })) : Promise.resolve('');

    curP.then(cur=>{
      const headers = { "Content-Type": "application/json" };
      if (APP_TOKEN) headers["Authorization"] = "Bearer " + APP_TOKEN;
      return fetch(BACKEND + "/mcai/generate", {
        method: "POST",
        headers,
        body: JSON.stringify({ target: t, request: req, currentCode: cur })
      }).then(r=>{
        if(!r.ok) return r.json().then(j=>{ throw new Error(j && j.error || ('HTTP '+r.status)); });
        return r.json();
      }).then(result=>{
        const feedback=(result && Array.isArray(result.feedback))?result.feedback:[];
        renderFeedback(feedback);
        __lastCode=(result && result.code)||'';
        if(!__lastCode){ setStatus('No code'); logLine('No code returned.'); busy=false; return; }
        setStatus('Pasting');
        return pasteToMakeCode(__lastCode).then(()=>{ setStatus('Done'); logLine('Pasted and switched back to Blocks.'); });
      });
    }).catch(e=>{
      setStatus('Error'); logLine('Proxy error: '+(e&&e.message?e.message:String(e)));
    }).finally(()=>{
      busy=false;
      go.textContent=origText; go.disabled=false; go.style.opacity=''; go.style.cursor='pointer';
    });
  };

  // revert
  const revertBtn=$('#revert');
  revertBtn.onclick=function(){
    if(revertBtn.disabled) return;
    const orig = revertBtn.textContent;
    revertBtn.textContent='Reverting…'; revertBtn.disabled=true; revertBtn.style.opacity='0.7'; revertBtn.style.cursor='not-allowed';
    setStatus('Reverting'); logLine('Reverting to previous snapshot…');
    revertEditor().then(()=>{
      setStatus('Reverted'); logLine('Revert complete: restored previous code and switched back to Blocks.');
    }).catch(e=>{
      setStatus('Error'); logLine('Revert failed: '+(e&&e.message?e.message:String(e)));
    }).finally(()=>{
      revertBtn.textContent=orig;
      revertBtn.style.opacity=''; revertBtn.style.cursor='pointer';
      if(__undoStack.length) revertBtn.disabled=false;
    });
  };

  // drag/resize/close
  (function(){let ox=0,oy=0,sx=0,sy=0,drag=false;
    hdr.addEventListener('mousedown',(e)=>{drag=true;ox=e.clientX;oy=e.clientY;const r=ui.getBoundingClientRect();sx=r.left;sy=r.top;document.body.style.userSelect='none';});
    window.addEventListener('mousemove',(e)=>{if(!drag)return;const nx=sx+(e.clientX-ox),ny=sy+(e.clientY-oy);ui.style.left=Math.max(0,Math.min(window.innerWidth-ui.offsetWidth,nx))+'px';ui.style.top=Math.max(0,Math.min(window.innerHeight-60,ny))+'px';ui.style.right='auto';ui.style.bottom='auto';});
    window.addEventListener('mouseup',()=>{drag=false;document.body.style.userSelect='';});
  })();
  (function(){let rx=0,ry=0,startW=0,startH=0,res=false;
    const resizer=document.querySelector('#rz');
    resizer.addEventListener('mousedown',(e)=>{res=true;rx=e.clientX;ry=e.clientY;startW=ui.offsetWidth;startH=ui.offsetHeight;document.body.style.userSelect='none';});
    window.addEventListener('mousemove',(e)=>{if(!res)return;const w=Math.max(380,startW+(e.clientX-rx)),h=Math.max(260,startH+(e.clientY-ry));ui.style.width=w+'px';ui.style.height=h+'px';});
    window.addEventListener('mouseup',()=>{res=false;document.body.style.userSelect='';});
  })();
  closeBtn.onclick=function(){ ui.remove(); };

  window.__mcBlocksStrict=1;
})();
