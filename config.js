module.exports = {
  bot:{name:'Project One',prefix:'!',owners:process.env.OWNER_IDS?process.env.OWNER_IDS.split(',').map(function(x){return x.trim()}).filter(Boolean):[]},
  colors:{primary:0x5865F2,success:0x57F287,danger:0xED4245,warning:0xFEE75C},
  database:{file:'./data/database.json'},
  logs:{enabled:true,channelId:'',events:{messageDelete:true,messageUpdate:true,memberJoin:true,memberLeave:true,moderation:true,ticket:true,protection:true}},
  protection:{enabled:true,spam:{enabled:true,maxMessages:6,windowMs:5000,timeoutMs:60000},mentions:{enabled:true,maxMentions:8},links:{enabled:false,blockInvites:true},caps:{enabled:false,threshold:0.8,minimumLength:12},raid:{enabled:true,joins:8,windowMs:10000,timeoutMs:300000}},
  automod:{enabled:true,badWords:[],deleteMessages:true,warnOnViolation:true},
  tickets:{enabled:true,categoryId:'',staffRoleId:'',naming:'ticket-{number}',panelTitle:'Support Tickets',panelDescription:'اضغط الزر لفتح تذكرة.'},
  welcome:{enabled:false,channelId:'',message:'Welcome {user} to {server}!'},
  autorole:{enabled:false,roleId:''},
  suggestions:{enabled:true,channelId:''},
  giveaways:{enabled:true},
  api:{enabled:false,baseUrl:''}
};
