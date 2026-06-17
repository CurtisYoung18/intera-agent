const fs=require('fs');const {JSDOM}=require('jsdom');
const html=fs.readFileSync('procedure-orchestration-preview.html','utf8');
const errors=[];
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,
  beforeParse(w){w.addEventListener('error',e=>errors.push(String(e.error||e.message)));}});
const d=dom.window.document;
setTimeout(()=>{
  const spineSteps=d.querySelectorAll('#spine .step').length;
  const inspectorHasTitle=/检查器/.test(d.getElementById('inspector').textContent);
  const receipt=d.getElementById('receipt').textContent.trim();
  // simulate clicking the "deposit" toggle
  const tgl=d.querySelector('.toggle[data-sim="deposit"]');
  tgl.click();
  const litBranch=d.querySelectorAll('#spine .brow.lit').length;
  const receiptAfter=d.getElementById('receipt').textContent.trim();
  // switch to lanes view
  d.querySelector('.tab[data-view="lanes"]').click();
  const laneCount=d.querySelectorAll('#lanes .lane').length;
  const laneHooks=d.querySelectorAll('#lanes .hk').length;
  // compiled view
  d.querySelector('.tab[data-view="compiled"]').click();
  const compiledLen=d.getElementById('compiled').textContent.length;
  console.log(JSON.stringify({spineSteps,inspectorHasTitle,receiptHasContent:receipt.length>0,
    litBranchAfterDepositToggle:litBranch,receiptChanged:receiptAfter!==receipt,
    laneCount,laneHooks,compiledHasContent:compiledLen>50,jsErrors:errors},null,1));
},200);
