const fs=require('fs');const {JSDOM}=require('jsdom');
const dom=new JSDOM(fs.readFileSync('conversation-detail-preview.html','utf8'),{runScripts:'dangerously',pretendToBeVisual:true});
const d=dom.window.document; const errs=[];
dom.window.addEventListener('error',e=>errs.push(String(e.error||e.message)));
setTimeout(()=>{
  d.querySelector('.ev[data-ev="e3"]').click();
  console.log(JSON.stringify({jumpOK:d.getElementById('t-timeline').classList.contains('active') && d.querySelector('.tlitem[data-id="e3"]').classList.contains('hl'), jsErrors:errs}));
},150);
