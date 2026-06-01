const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async()=>{
  const r = await p.liveChatConfig.findFirst({ where: { orgId: 'api' } });
  if (r) {
    console.log('=== LiveChat Config (api vendor) ===');
    console.log('orgId:', r.orgId);
    console.log('licenseId:', r.licenseId);
    console.log('botAccessToken:', r.botAccessToken ? r.botAccessToken.slice(0,10)+'...' : '(empty)');
    console.log('webhookSecret:', r.webhookSecret ? '***configured***' : '(not set)');
    console.log('region:', r.region);
    console.log('authType:', r.authType);
    console.log('accountId:', r.accountId);
    console.log('agentAccountId:', r.agentAccountId);
    console.log('showSkillStatus:', r.showSkillStatus);
    console.log('enabled:', r.enabled);
    console.log('transferGroupId:', r.transferGroupId);
    console.log('transferMessage:', r.transferMessage);
  } else {
    console.log('No LiveChatConfig found for api');
  }
  // Also check default
  const d = await p.liveChatConfig.findFirst({ where: { orgId: 'default' } });
  if (d) {
    console.log('');
    console.log('=== LiveChat Config (default vendor) ===');
    console.log('orgId:', d.orgId);
    console.log('licenseId:', d.licenseId);
    console.log('botAccessToken:', d.botAccessToken ? d.botAccessToken.slice(0,10)+'...' : '(empty)');
    console.log('enabled:', d.enabled);
  } else {
    console.log('No LiveChatConfig found for default');
  }
  await p.$disconnect();
})().catch(e => console.error(e.message.slice(0,300)));
