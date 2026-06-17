const fs=require('fs');const {JSDOM}=require('jsdom');
const dom=new JSDOM(fs.readFileSync('conversation-detail-preview.html','utf8'),{runScripts:'dangerously',pretendToBeVisual:true});
const d=dom.window.document; const errs=[]; dom.window.addEventListener('error',e=>errs.push(String(e.error||e.message)));
setTimeout(()=>{
  const codeBlocks=d.querySelectorAll('#tl pre.code').length;
  const copyBtns=d.querySelectorAll('#tl .cp').length;
  const hasPromptTag=/PROMPT/.test(d.getElementById('tl').textContent) && /原始 Prompt/.test(d.getElementById('tl').textContent);
  const hasInOut=/输入 \(input\)/.test(d.getElementById('tl').textContent)&&/输出 \(output\)/.test(d.getElementById('tl').textContent);
  // expand a single item via click
  const item=d.querySelector('.tlitem[data-id="e2"]'); item.click();
  const expanded=item.classList.contains('open');
  // toggle all
  d.getElementById('toggleAll').click();
  const allOpen=[...d.querySelectorAll('.tlitem')].every(i=>i.classList.contains('open'));
  // jump from transcript handoff -> opens e3 in timeline
  d.querySelector('.ev[data-ev="e3"]').click();
  const e3=d.querySelector('.tlitem[data-id="e3"]');
  const jumpOpensAndHl=e3.classList.contains('open')&&e3.classList.contains('hl')&&d.getElementById('t-timeline').classList.contains('active');
  console.log(JSON.stringify({codeBlocks,copyBtns,hasPromptTag,hasInOut,singleExpand:expanded,toggleAllOpens:allOpen,jumpOpensAndHl,jsErrors:errs},null,1));
},180);
