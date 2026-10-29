/* ==========================================================
   Render's File Tycoon · Render Productions
   Split from the original single-file build.
   Added: market link (/prices.json), save system, frequency flags.
   ========================================================== */
const CELL=44;

let hoveredNodeId = null;

/* ── PC HARDWARE CONFIG ── */
const HW_SLOTS = {
  cpu: {
    label:'CPU', icon:'ti-cpu',
    desc:'Raises the total CPU % cap. Processors over the limit throttle all processing nodes.',
    tiers:[
      {name:'Intel i3-12100',cores:4,  cpuCap:100, cost:0,     sub:'4C · Starter'},
      {name:'Intel i5-13600K',cores:10,cpuCap:220, cost:1200,  sub:'10C · Mid-range'},
      {name:'Intel i7-14700K',cores:20,cpuCap:500, cost:3500,  sub:'20C · Workstation'},
      {name:'AMD Threadripper',cores:64,cpuCap:1500,cost:12000,sub:'64C · Server-grade'},
      {name:'The Gregulator',cores:128,cpuCap:30000,cost:999999999,sub:'Jesus Killer'},
    ]
  },
  ram: {
    label:'RAM', icon:'ti-device-desktop',
    desc:'More RAM increases buffer capacity and allows more parallel downloads.',
    tiers:[
      {name:'8 GB DDR4-3200', ramGB:8,  cost:0,    sub:'DDR4 · Starter'},
      {name:'16 GB DDR4-3600',ramGB:16, cost:400,  sub:'DDR4 · Gaming'},
      {name:'32 GB DDR5-5600',ramGB:32, cost:1100, sub:'DDR5 · Creator'},
      {name:'128 GB DDR5-6400',ramGB:128,cost:6000,sub:'DDR5 · Workstation'},
      {name:'264 GB MOTHERLOAD',ramGB:264,cost:999999999,sub:'MOTHERLOAD'},
    ]
  },
  storage: {
    label:'Storage', icon:'ti-database',
    desc:'Sets your disk capacity and read/write speed. Large video/database pipelines fill your disk fast.',
    tiers:[
      {name:'240 GB SATA SSD', capGB:240,  rwMBs:500,  cost:0,    sub:'500 MB/s'},
      {name:'1 TB HDD',        capGB:1000, rwMBs:120,  cost:300,  sub:'120 MB/s · cheap capacity'},
      {name:'2 TB NVMe M.2',   capGB:2000, rwMBs:3500, cost:1800, sub:'3500 MB/s'},
      {name:'16 TB NAS RAID',  capGB:16000,rwMBs:1000, cost:9000, sub:'1 GB/s · massive'},
      {name:'400 TB KICKER',   capGB:40000,rwMBs:30000, cost:999999999, sub:'Lord have mercy'},
    ]
  },
  nic: {
    label:'Network Card', icon:'ti-network',
    desc:'Sets the maximum bandwidth your network connections can deliver.',
    tiers:[
      {name:'WiFi 5 (onboard)', maxBwMBs:62,  cost:0,    sub:'500 Mbps WiFi'},
      {name:'1 GbE Ethernet',   maxBwMBs:125, cost:200,  sub:'Gigabit wired'},
      {name:'2.5 GbE Ethernet', maxBwMBs:312, cost:600,  sub:'2.5G wired'},
      {name:'10 GbE SFP+',      maxBwMBs:1250,cost:2500, sub:'10G fiber/DAC'},
      {name:'GOD HELP US',      maxBwMBs:90000,cost:999999999,sub:'Oh my god.'},
    ]
  },
  cooler: {
    label:'CPU Cooler', icon:'ti-wind',
    desc:'Controls thermal capacity. High temps throttle all processing nodes.',
    tiers:[
      {name:'Stock Cooler',      maxTempC:85, throttleC:75, cost:0,   sub:'Included · runs hot'},
      {name:'Tower Air Cooler',  maxTempC:80, throttleC:70, cost:350, sub:'be quiet! Pure Rock'},
      {name:'240mm AIO Liquid',  maxTempC:70, throttleC:60, cost:900, sub:'Corsair H100'},
      {name:'Custom Loop',       maxTempC:55, throttleC:45, cost:4000,sub:'Hardline · silent'},
      {name:'Icepack',           maxTempC:10, throttleC:5 , cost:999999999,sub:'Ice cube cold.'},
    ]
  }
};

// current HW tier indices
const HW = {cpu:0, ram:0, storage:0, nic:0, cooler:0};

function hwGet(slot){ return HW_SLOTS[slot].tiers[HW[slot]]; }

/* ── PACING & LIMITS (tune the whole game's speed here) ──
   THE PER-SECOND RULE: every speed is in MB/s and every time follows from it.
     time = size / speed. A link's speed is shared between everything it feeds,
     a downloader's speed is shared between its slots, and an uploader's speed is
     shared between its threads. Nothing gets bandwidth for free.
   proc:       slows every processor's job time (applied once to the numbers shown)
   sell:       slows every seller's delay between sales (applied once to the numbers shown)
   threadCap:  the most one upload thread can push (MB/s); more threads use more of the line
   queueCap:   how many files an ordinary node holds before it blocks the node feeding it
   Hard limits: a node that can't hand its file on, can't start a job, or has no
   RAM/disk/CPU/cooling headroom simply stops and waits until room frees up. */
const PACE={
  startMoney:150,
  proc:2.5,
  sell:3,
  threadCap:4,
  queueCap:10,
  thermalResume:3   // degrees below the throttle point before processors restart
};
const PC_LOCK={thermal:false};

function capOf(n){
  const def=MODULE_DEFS.find(d=>d.id===n.defId);
  if(!def)return PACE.queueCap;
  if(n.defId==='network_binder')return (nodeStat(n,'queueSize')||5)*Math.max(1,nodeStat(n,'fileInputs')||1);
  if(def.isBuffer)return nodeStat(n,'bufSize')||8;
  if(def.isSSDCache)return nodeStat(n,'cacheSize')||20;
  return PACE.queueCap;
}
function roomIn(id,fromId){
  const n=G.nodes[id];if(!n)return true;
  const q=n.queue||[],cap=capOf(n);
  if(q.length>=cap)return false;
  // binder: every wired input gets an equal slice, so one fast downloader can't fill the whole queue
  if(n.defId==='network_binder'&&fromId){
    const srcs=new Set(G.wires.filter(w=>w.toNode===id&&w.toPort!==1).map(w=>w.fromNode));
    if(srcs.size>1){
      const slice=Math.ceil(cap/srcs.size);
      if(q.filter(f=>f._src===fromId).length>=slice)return false;
    }
  }
  return true;
}
// true when the node fed by (id, port) has room (or nothing is wired)
function outRoom(id,port,all){
  const outs=G.wires.filter(w=>w.fromNode===id&&w.fromPort===port);
  if(!outs.length)return true;
  return all?outs.every(w=>roomIn(w.toNode,id)):roomIn(outs[0].toNode,id);
}

/* ── BANDWIDTH SHARING ──
   fairShare: everyone gets what they ask for, and anything left over is split
   equally among those who want more (max-min fairness). */
function fairShare(total,demands){
  const out=new Array(demands.length).fill(0);
  const order=demands.map((d,i)=>i).sort((a,b)=>demands[a]<demands[b]?-1:demands[a]>demands[b]?1:0);
  let left=Math.max(0,total),n=order.length;
  order.forEach(i=>{
    const give=Math.min(demands[i],left/n);
    out[i]=give;left-=give;n--;
  });
  return out;
}
// How much download bandwidth a node can actually use
function bwDemand(toNode){
  const n=G.nodes[toNode];if(!n)return 0;
  const def=MODULE_DEFS.find(d=>d.id===n.defId);
  return Infinity;   // a download takes whatever the link gives it
}
// Splits `total` MB/s across every wire leaving (fromId, port)
function distribute(fromId,port,total,map,byDemand){
  const outs=G.wires.filter(w=>w.fromNode===fromId&&w.fromPort===port);
  if(!outs.length||!(total>0))return;
  const shares=fairShare(total,outs.map(w=>byDemand?bwDemand(w.toNode):Infinity));
  outs.forEach((w,i)=>{const k=w.toNode+'_'+w.toPort;map[k]=(map[k]||0)+shares[i];});
}

/* ── PC RESOURCE STATE ── */
const PC = {
  cpuUsed: 0,       // % consumed by processors this tick
  ramUsedGB: 0,     // GB consumed by active downloads/buffers
  diskUsedGB: 0,    // GB of files currently "on disk" (in pipeline)
  tempC: 35,        // current temperature
};

/* ── FILE TYPES ── */
const FILE_DEFS={
  Document: {sizeMB:0.05,  sizeLabel:'~50 KB',  baseVal:8,   icon:'ti-file-text', color:'#185FA5',  ramMB:32},
  Image:    {sizeMB:3,     sizeLabel:'~3 MB',   baseVal:18,  icon:'ti-photo',      color:'#0F6E56',    ramMB:64},
  Audio:    {sizeMB:8,     sizeLabel:'~8 MB',   baseVal:45,  icon:'ti-music',      color:'#854F0B',    ramMB:128},
  Video:    {sizeMB:700,   sizeLabel:'~700 MB', baseVal:220, icon:'ti-video',      color:'#993556',   ramMB:512},
  Software: {sizeMB:250,   sizeLabel:'~250 MB', baseVal:380, icon:'ti-cpu',        color:'#533AB7',   ramMB:256},
  Archive:  {sizeMB:150,   sizeLabel:'~150 MB', baseVal:200, icon:'ti-archive',    color:'#3B6D11',   ramMB:192},
  Database: {sizeMB:500,   sizeLabel:'~500 MB', baseVal:550, icon:'ti-database',   color:'#A32D2D',   ramMB:1024},
  Ebook:    {sizeMB:2,     sizeLabel:'~2 MB',   baseVal:14,  icon:'ti-book',       color:'#0C447C',    ramMB:48},
};

// CPU load per processor type (%)
const PROC_CPU = {scanner:5, antivirus:8, compressor:15, decoder:25, metadata:6, encryptor:35};
// Heat added per active processor
const PROC_HEAT = {scanner:2, antivirus:3, compressor:5, decoder:8, metadata:2, encryptor:10};

function fmtSize(mb){
  if(mb<0.001)return Math.round(mb*1000000)+'B';
  if(mb<1)return Math.round(mb*1000)+'KB';
  if(mb<1000)return mb.toFixed(mb<10?1:0)+'MB';
  return (mb/1000).toFixed(2)+'GB';
}
function fmtSpeed(mbps){
  if(mbps<1)return Math.round(mbps*1000)+'KB/s';
  if(mbps<1000)return mbps.toFixed(mbps<10?1:0)+'MB/s';
  return (mbps/1000).toFixed(2)+'GB/s';
}
function fmtTime(s){
  if(s<10)return s.toFixed(1)+'s';
  if(s<60)return Math.round(s)+'s';
  const m=Math.floor(s/60);return m+'m '+Math.round(s%60)+'s';
}
function fmtMoney(n){return Math.round(n).toLocaleString()+' ◆'}

/* ── MODULE DEFINITIONS ── */
const MODULE_DEFS=[
 /* ── NETWORK (now named after real hardware) ── */
 {cat:'Network',id:'wifi_onboard',name:'WiFi Modem',icon:'ti-wifi',
  desc:'Basic WiFi — good starter, shared airtime',cost:0,color:'#185FA5',isLink:true,
  inputs:[],outputs:['bandwidth','upload'],
  upgrades:[
   {label:'Download speed',stat:'dlSpeed',unit:'MB/s',base:10,  levels:[20,40,80],  costs:[200,600,1800]},
   {label:'Upload speed',  stat:'ulSpeed',unit:'MB/s',base:1.5, levels:[4,10,25],   costs:[300,800,2400]},
  ]},
 {cat:'Network',id:'eth_1gbe',name:'1GbE Router',icon:'ti-router',
  desc:'Wired Gigabit — stable, fast',cost:120,color:'#185FA5',isLink:true,
  inputs:[],outputs:['bandwidth','upload'],
  upgrades:[
   {label:'Download speed',stat:'dlSpeed',unit:'MB/s',base:50,  levels:[80,110,125],costs:[300,700,2000]},
   {label:'Upload speed',  stat:'ulSpeed',unit:'MB/s',base:10,  levels:[20,50,100],  costs:[400,1000,3000]},
  ]},
 {cat:'Network',id:'eth_25gbe',name:'2.5GbE Router',icon:'ti-router',
  desc:'2.5G wired — mid-range throughput',cost:450,color:'#0F6E56',isLink:true,
  inputs:[],outputs:['bandwidth','upload'],
  upgrades:[
   {label:'Download speed',stat:'dlSpeed',unit:'MB/s',base:150, levels:[220,280,312],costs:[500,1400,4000]},
   {label:'Upload speed',  stat:'ulSpeed',unit:'MB/s',base:30,  levels:[60,120,250], costs:[700,1800,5000]},
  ]},
 {cat:'Network',id:'fiber_modem',name:'Fiber Modem',icon:'ti-line',
  desc:'ISP fiber — high DL/UL symmetry',cost:900,color:'#854F0B',isLink:true,
  inputs:[],outputs:['bandwidth','upload'],
  upgrades:[
   {label:'Download speed',stat:'dlSpeed',unit:'MB/s',base:250, levels:[500,800,1000],costs:[1000,3000,8000]},
   {label:'Upload speed',  stat:'ulSpeed',unit:'MB/s',base:100, levels:[250,500,800], costs:[1200,3500,10000]},
  ]},
 {cat:'Network',id:'link_aggregator',name:'Link Aggregator',icon:'ti-network',
  desc:'Bonds multiple connections for combined bandwidth',cost:350,color:'#185FA5',isAggregator:true,
  inputs:['bandwidth','bandwidth','bandwidth','bandwidth'],outputs:['bandwidth','upload'],
  upgrades:[
   {label:'Input ports',stat:'aggPorts',unit:'',  base:2,  levels:[3,4,5,6],    costs:[200,500,1200,3000]},
   {label:'Efficiency',  stat:'aggEff',  unit:'%',base:90, levels:[95,98,100,100],costs:[300,800,2000,6000]},
  ]},
 {cat:'Network',id:'network_binder',name:'Network Binder',icon:'ti-plug-connected',
  desc:'Binds files to your upload pipeline · upgrade for more file inputs',cost:0,color:'#185FA5',
  inputs:['file','upload'],outputs:['upload_queue'],
  upgrades:[
   {label:'Queue size',stat:'queueSize',unit:'files',base:5,levels:[10,20,40,80,160],costs:[100,300,700,1800,5000]},
   {label:'File inputs',stat:'fileInputs',unit:'',base:1,levels:[2,3,4,6,8],costs:[150,400,1000,2500,6000]},
  ]},

 /* ── DOWNLOADS ── */
 {cat:'Downloads',id:'dl_document',name:'Doc Downloader',icon:'ti-file-text',
  desc:'Documents (~50 KB) · 32 MB RAM',cost:100,color:'#0F6E56',fileType:'Document',
  inputs:['bandwidth'],outputs:['file'],
  upgrades:[
   {label:'Parallel slots',stat:'slots',unit:'',base:1,levels:[2,3,5,8],costs:[150,400,900,2500]},
  ]},
 {cat:'Downloads',id:'dl_image',name:'Image Downloader',icon:'ti-photo',
  desc:'Images (~3 MB) · 3 MB/s · 64 MB RAM',cost:120,color:'#0F6E56',fileType:'Image',
  inputs:['bandwidth'],outputs:['file'],
  upgrades:[
   {label:'Parallel slots',stat:'slots',unit:'',base:1,levels:[2,3,5,8],costs:[150,400,900,2500]},
  ]},
 {cat:'Downloads',id:'dl_audio',name:'Audio Downloader',icon:'ti-music',
  desc:'Audio (~8 MB) · 8 MB/s · 128 MB RAM',cost:200,color:'#0F6E56',fileType:'Audio',
  inputs:['bandwidth'],outputs:['file'],
  upgrades:[
   {label:'Parallel slots',stat:'slots',unit:'',base:1,levels:[2,3,5,8],costs:[200,500,1100,3000]},
  ]},
 {cat:'Downloads',id:'dl_video',name:'Video Downloader',icon:'ti-video',
  desc:'Videos (~700 MB) · 50 MB/s · 512 MB RAM',cost:650,color:'#0F6E56',fileType:'Video',
  inputs:['bandwidth'],outputs:['file'],
  upgrades:[
   {label:'Parallel slots',stat:'slots',unit:'',base:1,levels:[2,3,4,6],costs:[600,1500,4000,10000]},
  ]},
 {cat:'Downloads',id:'dl_software',name:'Software Downloader',icon:'ti-cpu',
  desc:'Software (~250 MB) · 25 MB/s · 256 MB RAM',cost:400,color:'#0F6E56',fileType:'Software',
  inputs:['bandwidth'],outputs:['file'],
  upgrades:[
   {label:'Parallel slots',stat:'slots',unit:'',base:1,levels:[2,3,5,8],costs:[400,1000,2500,7000]},
  ]},
 {cat:'Downloads',id:'dl_archive',name:'Archive Downloader',icon:'ti-archive',
  desc:'Archives (~150 MB) · 15 MB/s · 192 MB RAM',cost:300,color:'#0F6E56',fileType:'Archive',
  inputs:['bandwidth'],outputs:['file'],
  upgrades:[
   {label:'Parallel slots',stat:'slots',unit:'',base:1,levels:[2,3,5,8],costs:[300,800,2000,5500]},
  ]},
 {cat:'Downloads',id:'dl_database',name:'DB Downloader',icon:'ti-database',
  desc:'Databases (~500 MB) · 80 MB/s · 1 GB RAM',cost:1500,color:'#A32D2D',fileType:'Database',
  inputs:['bandwidth'],outputs:['file'],
  upgrades:[
   {label:'Parallel slots',stat:'slots',unit:'',base:1,levels:[2,3,4],costs:[800,2000,6000]},
  ]},
 {cat:'Downloads',id:'dl_ebook',name:'Ebook Downloader',icon:'ti-book',
  desc:'Ebooks (~2 MB) · 2 MB/s · 48 MB RAM',cost:80,color:'#0C447C',fileType:'Ebook',
  inputs:['bandwidth'],outputs:['file'],
  upgrades:[
   {label:'Parallel slots',stat:'slots',unit:'',base:1,levels:[2,3,5,8],costs:[100,250,600,1600]},
  ]},

 /* ── PROCESSING ── */
 {cat:'Processing',id:'scanner',name:'File Scanner',icon:'ti-scan',
  desc:'Inspects files · +15% value · 5% CPU · +2°C',cost:250,color:'#854F0B',
  inputs:['file'],outputs:['file'],procType:'scanner',procTime:0.8,
  upgrades:[
   {label:'Speed',     stat:'procTime',unit:'s', base:0.8,levels:[0.5,0.3,0.15,0.08],costs:[200,500,1200,3500],invert:true},
   {label:'Value bonus',stat:'valBonus',unit:'%',base:15, levels:[20,28,38,50],        costs:[300,700,1800,5000]},
  ]},
 {cat:'Processing',id:'antivirus',name:'Antivirus',icon:'ti-shield-check',
  desc:'Repairs corrupt files · 8% CPU · +3°C',cost:300,color:'#854F0B',
  inputs:['file'],outputs:['file'],procType:'antivirus',procTime:0.6,
  upgrades:[
   {label:'Speed',stat:'procTime',unit:'s',base:0.6,levels:[0.4,0.25,0.12],costs:[250,600,1500],invert:true},
  ]},
 {cat:'Processing',id:'compressor',name:'Compressor',icon:'ti-file-zip',
  desc:'Shrinks file size · faster uploads · 15% CPU · +5°C',cost:350,color:'#854F0B',
  inputs:['file'],outputs:['file'],procType:'compressor',procTime:0.5,
  upgrades:[
   {label:'Speed',         stat:'procTime', unit:'s', base:0.5, levels:[0.3,0.15,0.08],    costs:[200,500,1200],       invert:true},
   {label:'Compress ratio',stat:'compRatio',unit:'%', base:50,  levels:[60,72,80,88],       costs:[250,600,1500,4500]},
  ]},
 {cat:'Processing',id:'decoder',name:'File Decoder',icon:'ti-lock-open',
  desc:'Decodes encrypted files · +30% · 25% CPU · +8°C',cost:600,color:'#854F0B',
  inputs:['file'],outputs:['file'],procType:'decoder',procTime:2,
  upgrades:[
   {label:'Speed',      stat:'procTime',unit:'s', base:2,  levels:[1.2,0.7,0.35,0.15],costs:[300,800,2000,6000],invert:true},
   {label:'Value bonus',stat:'valBonus', unit:'%',base:30, levels:[40,55,75,100],      costs:[400,1000,2500,8000]},
  ]},
 {cat:'Processing',id:'metadata',name:'Metadata Tagger',icon:'ti-tag',
  desc:'Adds tags · +20% value · 6% CPU · +2°C',cost:220,color:'#854F0B',
  inputs:['file'],outputs:['file'],procType:'metadata',procTime:0.4,
  upgrades:[
   {label:'Speed',      stat:'procTime',unit:'s', base:0.4,levels:[0.25,0.12,0.06],costs:[150,350,900],invert:true},
   {label:'Value bonus',stat:'valBonus', unit:'%',base:20, levels:[28,38,52,70],   costs:[250,600,1500,4500]},
  ]},
 {cat:'Processing',id:'encryptor',name:'Encryptor',icon:'ti-lock',
  desc:'Premium re-encrypt · +50% · 35% CPU · +10°C',cost:1200,color:'#A32D2D',
  inputs:['file'],outputs:['file'],procType:'encryptor',procTime:3,
  upgrades:[
   {label:'Speed',      stat:'procTime',unit:'s', base:3, levels:[2,1.2,0.6,0.25],costs:[600,1500,4000,12000],invert:true},
   {label:'Value bonus',stat:'valBonus', unit:'%',base:50,levels:[65,85,110,150], costs:[700,1800,5000,15000]},
  ]},

 /* ── UPLOAD / SELL ── */
 {cat:'Upload & Sell',id:'uploader',name:'File Uploader',icon:'ti-upload',
  desc:'Uploads queued files to market. Speed = min(NIC, disk write)',cost:0,color:'#533AB7',
  inputs:['upload_queue'],outputs:['sold'],
  upgrades:[
   {label:'Upload threads',stat:'threads',unit:'',base:1,levels:[2,4,6,10],costs:[200,500,1200,3500]},
  ]},
 {cat:'Upload & Sell',id:'market_basic',name:'Basic Market',icon:'ti-shopping-cart',
  desc:'Sells uploaded files at 1× value',cost:0,color:'#3B6D11',
  inputs:['sold'],outputs:[],isSeller:true,sellMult:1.0,
  upgrades:[
   {label:'Sales speed',stat:'sellDelay',unit:'s',base:0.5,levels:[0.4,0.3,0.2,0.12],costs:[250,700,1800,5000],invert:true},
   {label:'Commission cut',stat:'commission',unit:'%',base:20,levels:[15,10,5,0],costs:[300,800,2000,6000],invert:true},
  ]},
 {cat:'Upload & Sell',id:'market_premium',name:'Premium Market',icon:'ti-building-store',
  desc:'Sells at 1.4× value',cost:1000,color:'#3B6D11',
  inputs:['sold'],outputs:[],isSeller:true,sellMult:1.4,
  upgrades:[
   {label:'Sales speed',stat:'sellDelay',unit:'s',base:0.5,levels:[0.4,0.3,0.2,0.12],costs:[500,1400,3500,9000],invert:true},
   {label:'Commission cut',stat:'commission',unit:'%',base:15,levels:[10,5,2,0],costs:[400,1000,2500,7000],invert:true},
  ]},
 {cat:'Upload & Sell',id:'auction',name:'Auction House',icon:'ti-gavel',
  desc:'Highest bidder · 1.8× · slow but lucrative',cost:2000,color:'#3B6D11',
  inputs:['sold'],outputs:[],isSeller:true,sellMult:1.8,sellDelay:5,
  upgrades:[
   {label:'Auction speed', stat:'sellDelay',unit:'s', base:5,   levels:[3.5,2.5,1.5,0.8],costs:[800,2000,5500,16000],invert:true},
   {label:'Sell multiplier',stat:'sellMult', unit:'×',base:1.8, levels:[2.0,2.3,2.7,3.2], costs:[1000,2500,6500,20000]},
  ]},
 {cat:'Upload & Sell',id:'seeder',name:'Seeder',icon:'ti-seeding',
  desc:'Keeps sold files seeding · passive income per second · files pass on to a market',cost:1200,color:'#3B6D11',
  inputs:['sold'],outputs:['sold'],isSeeder:true,
  upgrades:[
   {label:'Seed slots',stat:'seedSlots',unit:'files',base:10,levels:[20,40,80,160],costs:[500,1300,3200,8000]},
   {label:'Seed rate',stat:'seedRate',unit:'%/s',base:1,levels:[1.5,2.2,3.2,4.5],costs:[600,1600,4000,10000]},
  ]},
 {cat:'Upload & Sell',id:'mirror',name:'Mirror Server',icon:'ti-copy',
  desc:'Sells one file to two markets · each pays a share of its value',cost:1500,color:'#3B6D11',
  inputs:['sold'],outputs:['sold','sold'],isMirror:true,
  upgrades:[
   {label:'Value per copy',stat:'mirrorMult',unit:'×',base:0.6,levels:[0.7,0.8,0.9,1.0],costs:[800,2200,6000,15000]},
  ]},
 /* ── SECRET (unlocked by a frequency-scanner flag) ── */
 {cat:'Upload & Sell',id:'backstage_market',name:'Backstage Market',icon:'ti-antenna',
  locked:'rft_backstage_market',
  desc:'Off-the-books buyer · 2.2× · no questions asked',cost:1500,color:'#ff6b6b',
  inputs:['sold'],outputs:[],isSeller:true,sellMult:2.2,
  upgrades:[
   {label:'Sales speed',stat:'sellDelay',unit:'s',base:0.5,levels:[0.4,0.3,0.2,0.12],costs:[600,1600,4000,10000],invert:true},
   {label:'Commission cut',stat:'commission',unit:'%',base:10,levels:[7,4,2,0],costs:[500,1200,3000,8000],invert:true},
  ]},

 /* ── STORAGE NODES ── */
 {cat:'Storage',id:'ssd_cache',name:'SSD Cache',icon:'ti-bolt',
  desc:'Hot-file cache · +200% read speed on repeat files · uses 16 GB disk',cost:600,color:'#533AB7',
  inputs:['file'],outputs:['file'],isSSDCache:true,
  upgrades:[
   {label:'Cache size',stat:'cacheSize',unit:'files',base:20,levels:[40,80,160],costs:[400,1000,3000]},
  ]},
 {cat:'Storage',id:'ram_disk',name:'RAM Disk',icon:'ti-stack-2',
  desc:'Ultra-fast temp storage · 8 GB RAM · 0 disk I/O',cost:800,color:'#993556',
  inputs:['file'],outputs:['file'],isRAMDisk:true,
  upgrades:[
   {label:'Size',stat:'rdSize',unit:'GB',base:8,levels:[16,32,64],costs:[500,1400,4000]},
  ]},
 {cat:'Storage',id:'backup_drive',name:'Backup Drive',icon:'ti-device-floppy',
  desc:'Prevents corrupt file loss · re-queues crashed files',cost:500,color:'#3B6D11',
  inputs:['file'],outputs:['file'],isBackup:true,
  upgrades:[
   {label:'Recovery speed',stat:'recoverTime',unit:'s',base:2,levels:[1.2,0.6,0.2],costs:[300,800,2500],invert:true},
  ]},

 /* ── UTILITIES ── */
 {cat:'Utilities',id:'splitter',name:'Splitter',icon:'ti-git-fork',
  desc:'Clones file to 2 outputs',cost:250,color:'#993556',
  inputs:['file'],outputs:['file','file'],isSplit:true,
  upgrades:[]},
 {cat:'Utilities',id:'file_sorter',name:'File Sorter',icon:'ti-arrows-split-2',
  desc:'Routes by size · small files out 1, large files out 2',cost:350,color:'#993556',
  inputs:['file'],outputs:['file','file'],outLabels:['small','large'],isSorter:true,
  upgrades:[
   {label:'Large-file cutoff',stat:'cutoffMB',unit:'MB',base:5,levels:[1,20,100,400],costs:[150,400,1000,2500]},
   {label:'Sort speed',stat:'sortTime',unit:'s',base:0.4,levels:[0.25,0.15,0.08,0.03],costs:[200,500,1200,3000],invert:true},
  ]},
 {cat:'Utilities',id:'honeypot',name:'Honeypot',icon:'ti-bug',
  locked:'rft_honeypot',
  desc:'Traps corrupt files for a bounty · clean files pass through',cost:900,color:'#ff6b6b',
  inputs:['file'],outputs:['file'],isHoneypot:true,
  upgrades:[
   {label:'Bounty',stat:'bounty',unit:'×',base:0.4,levels:[0.6,0.9,1.3,2],costs:[500,1400,3500,9000]},
   {label:'Trap speed',stat:'trapTime',unit:'s',base:0.5,levels:[0.35,0.2,0.1],costs:[300,900,2500],invert:true},
  ]},
 {cat:'Utilities',id:'bandwidth_amp',name:'BW Amplifier',icon:'ti-bolt',
  desc:'Multiplies bandwidth signal',cost:400,color:'#993556',
  inputs:['bandwidth'],outputs:['bandwidth'],
  upgrades:[
   {label:'Multiply factor',stat:'bwMult',unit:'×',base:1.5,levels:[2,2.5,3,4],costs:[300,700,1800,5000]},
  ]},
 {cat:'Utilities',id:'priority',name:'Priority Queue',icon:'ti-arrows-sort',
  desc:'Sends highest-value files first',cost:320,color:'#993556',
  inputs:['file'],outputs:['file'],isPriority:true,
  upgrades:[]},
 {cat:'Utilities',id:'task_scheduler',name:'Task Scheduler',icon:'ti-list-check',
  desc:'Pauses low-value jobs when CPU > 90% · saves headroom',cost:450,color:'#533AB7',
  inputs:['file'],outputs:['file'],isScheduler:true,
  upgrades:[
   {label:'CPU threshold',stat:'schedThresh',unit:'%',base:90,levels:[80,70,60],costs:[300,700,1800],invert:true},
  ]},
 {cat:'Utilities',id:'buffer',name:'File Buffer',icon:'ti-layers-intersect',
  desc:'Decouples pipeline stages',cost:150,color:'#533AB7',
  inputs:['file'],outputs:['file'],isBuffer:true,
  upgrades:[
   {label:'Buffer size',stat:'bufSize',unit:'files',base:8,levels:[16,32,64,128],costs:[150,400,1000,3000]},
  ]},
];

/* Apply the pacing multipliers once, to the definitions themselves, so the numbers
   on screen (node stats, upgrade screens, sidebar) are the numbers the game uses. */
(function bakePacing(){
  const r3=v=>Math.round(v*1000)/1000;
  const names={Document:'Documents',Image:'Images',Audio:'Audio',Video:'Videos',Software:'Software',Archive:'Archives',Database:'Databases',Ebook:'Ebooks'};
  MODULE_DEFS.forEach(d=>{
    if(d.procTime!=null)d.procTime=r3(d.procTime*PACE.proc);
    if(d.isSeller)d.sellDelay=r3((d.sellDelay||0.5)*PACE.sell);
    (d.upgrades||[]).forEach(u=>{
      const k=u.stat==='procTime'?PACE.proc:u.stat==='sellDelay'?PACE.sell:0;
      if(k){u.base=r3(u.base*k);u.levels=u.levels.map(v=>r3(v*k));}
    });
    if(d.fileType){
      const fd=FILE_DEFS[d.fileType];
      d.desc=names[d.fileType]+' ('+fd.sizeLabel+') · '+fd.ramMB+' MB RAM';
    }
    if(d.id==='uploader')d.desc='Uploads queued files. Line speed = min(link UL, NIC, disk), shared by all threads (max '+fmtSpeed(PACE.threadCap)+' each)';
  });
})();

let CLAIMED={};
let G={money:PACE.startMoney,totalEarned:0,soldCount:0,nodes:{},wires:[],nextId:1,
  draggingNode:null,draggingOffset:{x:0,y:0},connectingPort:null,incomeLog:[],clock:0,
  incomePs:0,upgModal:null};

const canvasWrap=document.getElementById('canvas-wrap');
const nodeLayer=document.getElementById('node-layer');
const svgLayer=document.getElementById('svg-layer');
const tempWireSvg=document.getElementById('temp-wire');
const gridCanvas=document.getElementById('grid-canvas');

/* ── Viewport / Pan / Zoom ── */
const WORLD=4000;
let vp={x:0,y:0,zoom:1};
const viewport=document.getElementById('viewport');

function applyViewport(){
  viewport.style.transform=`translate(${vp.x}px,${vp.y}px) scale(${vp.zoom})`;
  document.getElementById('zoom-hud').textContent=Math.round(vp.zoom*100)+'%';
}
function screenToWorld(sx,sy){return{x:(sx-vp.x)/vp.zoom,y:(sy-vp.y)/vp.zoom};}

function initCanvas(){
  const W=WORLD,H=WORLD;
  gridCanvas.width=W;gridCanvas.height=H;
  svgLayer.setAttribute('width',W);svgLayer.setAttribute('height',H);
  tempWireSvg.setAttribute('width',W);tempWireSvg.setAttribute('height',H);
  const ctx=gridCanvas.getContext('2d');
  ctx.clearRect(0,0,W,H);
  ctx.strokeStyle='rgba(99,130,180,0.06)';ctx.lineWidth=0.5;
  for(let x=0;x<=W;x+=CELL){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
  for(let y=0;y<=H;y+=CELL){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
  ctx.strokeStyle='rgba(99,130,180,0.12)';ctx.lineWidth=0.5;
  for(let x=0;x<=W;x+=CELL*5){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
  for(let y=0;y<=H;y+=CELL*5){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
  applyViewport();
}
function resetView(){vp={x:0,y:0,zoom:1};applyViewport();}

canvasWrap.addEventListener('wheel',e=>{
  e.preventDefault();
  const r=canvasWrap.getBoundingClientRect();
  const mx=e.clientX-r.left,my=e.clientY-r.top;
  const zf=e.deltaY<0?1.1:1/1.1;
  const nz=Math.min(3,Math.max(0.2,vp.zoom*zf));
  vp.x=mx-(mx-vp.x)*(nz/vp.zoom);vp.y=my-(my-vp.y)*(nz/vp.zoom);vp.zoom=nz;
  applyViewport();
},{passive:false});

window.addEventListener('keydown', e => {
  // If the user is typing in an input field (e.g. rename box), don't trigger game actions
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  // Make it case-insensitive
  const key = e.key.toLowerCase();

  if (hoveredNodeId !== null) {
    if (key === 'u') {
      // Open the upgrades modal for the active module
      if (typeof openUpgrade === 'function') {
        openUpgrade(hoveredNodeId);
      }
    } 
    else if (key === 'd') {
      // Delete the active module immediately
      if (typeof deleteNode === 'function') {
        deleteNode(hoveredNodeId);
        hoveredNodeId = null; // Clear hover tracking since node is destroyed
      }
    }
  }
});

let isPanning=false,panStart={x:0,y:0},panOrigin={x:0,y:0};
let spaceDown=false;
document.addEventListener('keydown',e=>{if(e.code==='Space'&&!e.target.matches('input,textarea')){spaceDown=true;canvasWrap.classList.add('panning');e.preventDefault();}});
document.addEventListener('keyup',e=>{if(e.code==='Space'){spaceDown=false;canvasWrap.classList.remove('panning');}});
canvasWrap.addEventListener('mousedown',e=>{
  // CRITICAL FIX: If you click on a module node or any of its inner buttons, 
  // do not let the canvas background handle or block the click!
  if (e.target.closest('.node') || e.target.closest('.port')) {
    return;
  }

  if(e.button===1||(e.button===0&&spaceDown)){
    isPanning=true;
    panStart={x:e.clientX,y:e.clientY};
    panOrigin={x:vp.x,y:vp.y};
    e.preventDefault();
  }
});

/* ── SIDEBAR ── */
function renderSidebar(){
  const ml=document.getElementById('module-list');
  const cats=[...new Set(MODULE_DEFS.map(m=>m.cat))];
  ml.innerHTML=cats.map(cat=>`
    <div class="cat-label">${cat}</div>
    ${MODULE_DEFS.filter(m=>m.cat===cat&&(!m.locked||hasFlag(m.locked))).map(m=>`
      <div class="mod-card${m.locked?' is-secret':''}" draggable="true" data-def="${m.id}">
        <div class="mod-card-name"><i class="ti ${m.icon}" style="font-size:10px;margin-right:2px"></i>${m.name}</div>
        <div class="mod-card-desc">${m.desc}</div>
        <div class="mod-card-cost">${m.cost===0?'Free':m.cost.toLocaleString()+' ◆'}${m.upgrades&&m.upgrades.length?' · upgradable':''}</div>
      </div>`).join('')}
  `).join('');
  ml.querySelectorAll('.mod-card').forEach(c=>{
    c.addEventListener('dragstart',e=>e.dataTransfer.setData('defId',c.dataset.def));
  });
}

/* ── HARDWARE PANEL ── */
function openHardware(){
  const content=document.getElementById('hw-content');
  content.innerHTML=Object.entries(HW_SLOTS).map(([key,slot])=>{
    const cur=HW[key];
    return`<div class="hw-slot">
      <div class="hw-slot-head">
        <i class="ti ${slot.icon} hw-slot-icon" style="color:var(--accent)"></i>
        <span class="hw-slot-name">${slot.label}</span>
        <span class="hw-slot-cur">${slot.tiers[cur].name}</span>
      </div>
      <div class="hw-slot-desc">${slot.desc}</div>
      <div class="hw-upgrades">
        ${slot.tiers.map((t,i)=>{
          const owned=i<=cur;
          const isCur=i===cur;
          const canBuy=i===cur+1&&G.money>=t.cost;
          const disabled=i>cur+1||(i===cur+1&&G.money<t.cost);
          return`<div class="hw-upg-btn${isCur?' current':''}" 
            ${!isCur&&i===cur+1?`onclick="buyHardware('${key}',${i})"`:''}
            ${disabled?'style="opacity:.4;cursor:not-allowed"':''}>
            <div>
              <div class="hw-upg-label">${t.name} ${isCur?'✓':''}</div>
              <div class="hw-upg-stats">${t.sub}</div>
            </div>
            <div class="hw-upg-price ${owned?'owned':''}">
              ${owned?'Owned':t.cost===0?'Free':t.cost.toLocaleString()+' ◆'}
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }).join('');
  document.getElementById('hw-modal').classList.add('open');
}

function buyHardware(key,tierIdx){
  const tier=HW_SLOTS[key].tiers[tierIdx];
  if(G.money<tier.cost){log('Not enough money for '+tier.name,'err');return;}
  G.money-=tier.cost;
  HW[key]=tierIdx;
  log('Installed: '+tier.name,'info');
  updateStats();
  updateHUD();
  openHardware(); // refresh panel
}

function closeHardware(){document.getElementById('hw-modal').classList.remove('open');}

/* ── Node stat helpers ── */
function nodeStat(n,stat){
  const def=MODULE_DEFS.find(d=>d.id===n.defId);
  if(!def||!def.upgrades)return null;
  const upg=def.upgrades.find(u=>u.stat===stat);
  if(!upg)return null;
  const lvl=n.upgLevels?.[stat]||0;
  return lvl===0?upg.base:upg.levels[lvl-1];
}

function spawnNode(defId,x,y){
  const def=MODULE_DEFS.find(d=>d.id===defId);
  if(!def)return;
  if(def.locked&&!hasFlag(def.locked))return;
  if(def.cost>0&&G.money<def.cost){log('Not enough money for '+def.name,'err');return;}
  if(def.cost>0)G.money-=def.cost;
  const id='n'+(G.nextId++);
  const sx=Math.round(x/CELL)*CELL,sy=Math.round(y/CELL)*CELL;
  G.nodes[id]={id,defId,x:sx,y:sy,progress:0,queue:[],state:'idle',
    upgLevels:{},_sellTimer:0,_slots:[],_bwOut:0};
  renderNode(id);
  log('Placed '+def.name+(def.cost>0?' (-'+def.cost.toLocaleString()+' ◆)':''),'info');
  updateStats();
}

function getAggregatorPorts(n){
  const ports=nodeStat(n,'aggPorts')||2;
  const inputs=[];
  for(let i=0;i<ports;i++)inputs.push('bandwidth');
  return inputs;
}

function getBinderPorts(n){
  const extra=Math.max(0,(nodeStat(n,'fileInputs')||1)-1);
  const ports=['file','upload'];
  for(let i=0;i<extra;i++)ports.push('file');
  return ports;
}
function portLabelIn(n,def,i,p){
  if(def.isAggregator)return p+' '+(i+1);
  if(n.defId==='network_binder'&&p==='file'&&(nodeStat(n,'fileInputs')||1)>1)return 'file '+(i===0?1:i);
  return p;
}
function getEffectiveInputs(n,def){
  if(def.isAggregator)return getAggregatorPorts(n);
  if(n.defId==='network_binder')return getBinderPorts(n);
  return def.inputs||[];
}
function getEffectiveOutputs(n,def){return def.outputs||[];}

function getPortPos(nodeId,portType,portIdx){
  const n=G.nodes[nodeId];
  const el=document.getElementById('node_'+nodeId);
  if(!el||!n)return{x:0,y:0};
  const def=MODULE_DEFS.find(d=>d.id===n.defId);
  const w=el.offsetWidth,h=el.offsetHeight;
  const ports=portType==='in'?getEffectiveInputs(n,def):getEffectiveOutputs(n,def);
  const count=ports.length;
  const spacing=h/(count+1);
  if(portType==='in')return{x:n.x,y:n.y+spacing*(portIdx+1)};
  else return{x:n.x+w,y:n.y+spacing*(portIdx+1)};
}

function renderAllWires(){
  svgLayer.innerHTML='';
  G.wires.forEach(w=>{
    const p1=getPortPos(w.fromNode,'out',w.fromPort);
    const p2=getPortPos(w.toNode,'in',w.toPort);
    drawWireSVG(svgLayer,p1,p2,w._active);
    if(w._active)setTimeout(()=>w._active=false,400);
  });
}

function drawWireSVG(svg,p1,p2,active){
  const cx=(p1.x+p2.x)/2;
  const path=document.createElementNS('http://www.w3.org/2000/svg','path');
  path.setAttribute('d',`M${p1.x},${p1.y} C${cx},${p1.y} ${cx},${p2.y} ${p2.x},${p2.y}`);
  path.setAttribute('stroke',active?'#3dd68c':'rgba(79,120,180,0.35)');
  const sw=1.5/vp.zoom;
  path.setAttribute('stroke-width',active?sw*1.5:sw);
  path.setAttribute('fill','none');
  if(active)path.setAttribute('stroke-dasharray',`${6/vp.zoom},${3/vp.zoom}`);
  svg.appendChild(path);
}

/* Progress bars: every node that does timed work shows one, always present
   (an empty track), so node height doesn't jump when work starts. */
function progBar(frac,color){
  const p=Math.max(0,Math.min(1,frac||0));
  return `<div class="node-progress"><div class="node-progress-bar" style="width:${Math.round(p*100)}%;background:${color}"></div></div>`;
}
function fillColor(frac,base){return frac>=0.9?'var(--red)':frac>=0.7?'var(--amber)':base;}

function renderNode(id){
  const n=G.nodes[id];
  const def=MODULE_DEFS.find(d=>d.id===n.defId);
  let el=document.getElementById('node_'+id);
  if(!el){
    el=document.createElement('div');
    el.id='node_'+id;
    nodeLayer.appendChild(el);
    el.addEventListener('mousedown',e=>startDragNode(e,id));

    // ─── VISUAL INDICATOR STATE HOOKS ───
    el.addEventListener('mouseenter', () => { 
      hoveredNodeId = id; 
      el.classList.add('hovered');
    });
    el.addEventListener('mouseleave', () => { 
      if(hoveredNodeId === id) hoveredNodeId = null; 
      el.classList.remove('hovered');
    });
  }
  
  el.className='node'+(n.state==='active'?' active':n.state==='error'?' error':n.state==='uploading'?' uploading':'');
  el.style.left=n.x+'px';el.style.top=n.y+'px';

  // Re-apply hover highlight if this node is currently target tracker
  if(hoveredNodeId === id) el.classList.add('hovered');

  const inPorts=getEffectiveInputs(n,def).map((p,i)=>`
    <div class="port-row">
      <div class="port${isPortConnected(id,'in',i)?' connected':''}${isCutTarget(id,i)?' cut':''}" id="port_${id}_in_${i}" data-node="${id}" data-type="in" data-idx="${i}"></div>
      <span class="port-label">${portLabelIn(n,def,i,p)}</span>
    </div>`).join('');
  const outPorts=getEffectiveOutputs(n,def).map((p,i)=>`
    <div class="port-row" style="justify-content:flex-end">
      <span class="port-label">${def.outLabels?def.outLabels[i]:p+(def.outputs.length>1?' '+(i+1):'')}</span>
      <div class="port out${isPortConnected(id,'out',i)?' connected':''}" id="port_${id}_out_${i}" data-node="${id}" data-type="out" data-idx="${i}"></div>
    </div>`).join('');

  let body='';
  if(def.isLink){
    const dl=nodeStat(n,'dlSpeed')||(def.upgrades.find(u=>u.stat==='dlSpeed')?.base||10);
    const ul=nodeStat(n,'ulSpeed')||(def.upgrades.find(u=>u.stat==='ulSpeed')?.base||1);
    const nicMax=hwGet('nic').maxBwMBs;
    const effDl=Math.min(dl,nicMax);
    body=`<div class="node-stat">DL: ${fmtSpeed(effDl)} · UL: ${fmtSpeed(ul)}</div>`;
    const wiredDl=G.wires.filter(w=>w.fromNode===id&&w.fromPort===0).length;
    if(wiredDl)body+=`<div class="node-stat hi">↗ feeding ${wiredDl} node${wiredDl>1?'s':''}</div>`;
    if(dl>nicMax)body+=`<div class="node-stat warn">⚠ NIC cap: ${fmtSpeed(nicMax)}</div>`;
  }
  if(def.isAggregator){
    const ports=nodeStat(n,'aggPorts')||2;
    const eff=nodeStat(n,'aggEff')||90;
    body=`<div class="node-stat">Ports: ${ports} · Eff: ${eff}%</div>`;
    if(n._dlSpeed!=null)body+=`<div class="node-stat hi">Bonded DL: ${fmtSpeed(n._dlSpeed||0)}</div>`;
  }
  if(def.fileType){
    const fd=FILE_DEFS[def.fileType];
    const slots=nodeStat(n,'slots')||1;
    const activeSlots=(n._slots||[]).filter(s=>s).length;
    const ramPerSlot=fd.ramMB/1024;
    body=`<div class="node-stat">${fd.sizeLabel}</div>`;
    body+=`<div class="node-stat">Slots: ${activeSlots}/${slots} · ${(ramPerSlot*slots).toFixed(1)} GB RAM</div>`;
    if(n._speeds&&n._speeds.length){
      const spd=n._speeds.reduce((a,b)=>a+b,0);
      body+=`<div class="node-stat hi">${fmtSpeed(spd)} · ~${fmtTime(fd.sizeMB/(spd/n._speeds.length))}/file</div>`;
    }
    for(let si=0;si<Math.min(slots,4);si++){
      const s=(n._slots||[])[si];
      body+=progBar(s&&s.total?s.progress/s.total:0,def.color);
    }
  }
  if(def.procType){
    const pt=nodeStat(n,'procTime')||def.procTime;
    const vb=nodeStat(n,'valBonus')||def.valBonus||0;
    const cpu=PROC_CPU[def.procType]||0;
    body=`<div class="node-stat">Time: ${pt.toFixed(2)}s · +${vb}% · ${cpu}% CPU</div>`;
    body+=`<div class="node-stat">Queue: ${(n.queue||[]).length}</div>`;
    body+=progBar(n.progress,def.color);
  }
  if(n.defId==='network_binder'){
    const qs=capOf(n);
    const q=(n.queue||[]).length;
    if(q>=qs*0.8)body=`<div class="node-stat warn">Queue: ${q}/${qs} ⚠</div>`;
    else body=`<div class="node-stat">Queue: ${q}/${qs}</div>`;
    const fi=nodeStat(n,'fileInputs')||1;
    if(fi>1){
      const wiredIn=G.wires.filter(w=>w.toNode===id&&w.toPort!==1).length;
      body+=`<div class="node-stat">File inputs: ${wiredIn}/${fi}</div>`;
    }
    body+=progBar(q/qs,fillColor(q/qs,'var(--accent)'));
  }
  if(n.defId==='uploader'){
    const thr=nodeStat(n,'threads')||1;
    const diskRW=hwGet('storage').rwMBs;
    const nicBW=hwGet('nic').maxBwMBs;
    const effUL=Math.min(diskRW,nicBW);
    body=`<div class="node-stat">Threads: ${thr} · ${fmtSpeed(PACE.threadCap)} each, shared line</div>`;
    if(n._ulSpeed)body+=`<div class="node-stat hi">${fmtSpeed(n._ulSpeed)} uploading</div>`;
    body+=progBar(n.progress,'var(--purple)');;
  }
  if(def.isSorter){
    body=`<div class="node-stat">Large ≥ ${nodeStat(n,'cutoffMB')||5} MB → out 2</div><div class="node-stat">Queue: ${(n.queue||[]).length}</div>`;
  }
  if(def.isHoneypot){
    body=`<div class="node-stat">Bounty ${(nodeStat(n,'bounty')||0.4).toFixed(1)}× value</div><div class="node-stat hi">Trapped: ${n._trapped||0}${n._lastBounty?' · last '+fmtMoney(n._lastBounty):''}</div>`;
  }
  if(def.isMirror){
    const mm=nodeStat(n,'mirrorMult')||0.6;
    body=`<div class="node-stat">${mm.toFixed(1)}× per copy · ${(mm*2).toFixed(1)}× total</div><div class="node-stat">Queue: ${(n.queue||[]).length}</div>`;
  }
  if(def.isSeeder){
    const sl=nodeStat(n,'seedSlots')||10;
    body=`<div class="node-stat">Seeding ${(n.seeds||[]).length}/${sl} files</div><div class="node-stat hi">+${fmtMoney(n._seedPs||0)}/s</div>`;
  }
  if(def.isSeller){
    const comm=nodeStat(n,'commission')??def.commission??20;
    const sm=nodeStat(n,'sellMult')||def.sellMult||1;
    body=`<div class="node-stat">${sm.toFixed(1)}× value · ${comm}% fee</div>`;
    if(n._lastSell)body+=`<div class="node-stat hi">Last: ${fmtMoney(n._lastSell)}</div>`;
    const sDelay=(nodeStat(n,'sellDelay')||def.sellDelay||1.5)/sellNetFactor();
    body+=`<div class="node-stat">1 sale / ${fmtTime(sDelay)}${sellNetFactor()>1?' · NIC ×'+sellNetFactor().toFixed(1):''}</div>`;
    body+=progBar((n.queue||[]).length?(n._sellTimer||0)/sDelay:0,def.color);
  }
  if(def.isBuffer||def.isPriority||def.isSSDCache||def.isRAMDisk||def.isBackup||def.isScheduler){
    const cap=nodeStat(n,'bufSize')||nodeStat(n,'cacheSize')||nodeStat(n,'rdSize')||8;
    body=`<div class="node-stat">Queue: ${(n.queue||[]).length}${cap?'/'+cap:''}</div>`;
    if(def.isRAMDisk)body+=`<div class="node-stat warn">8 GB RAM reserved</div>`;
    const qf=(n.queue||[]).length/cap;
    body+=progBar(qf,fillColor(qf,'var(--accent)'));
  }

  // ─── UPDATED: CLEAN INNERHTML HEAD TEMPLATE (NO BUTTONS AT ALL) ───
  el.innerHTML=`
    <div class="node-head" style="background:${def.color}18;border-bottom-color:${def.color}30">
      <i class="ti ${def.icon} node-icon" style="color:${def.color}"></i>
      <span class="node-title">${def.name}</span>
    </div>
    <div class="node-body">
      <div class="port-section">${inPorts}</div>
      ${body}
      <div class="port-section">${outPorts}</div>
    </div>`;

  el.querySelectorAll('.port').forEach(p=>{
    p.addEventListener('mousedown',e=>{e.stopPropagation();startConnect(e,id,p.dataset.type,+p.dataset.idx);});
    p.addEventListener('mouseup',e=>{e.stopPropagation();endConnect(id,p.dataset.type,+p.dataset.idx);});
  });
}

function createBinaryExplosion(startX, startY) {
  const particleCount = 25; // More particles for high density cinematic look
  
  for (let i = 0; i < particleCount; i++) {
    const p = document.createElement('div');
    p.className = 'binary-particle';
    p.textContent = Math.random() > 0.5 ? '1' : '0';
    
    // Vary size slightly for fake 3D depth field
    const scale = 0.6 + Math.random() * 0.8;
    p.style.left = startX + 'px';
    p.style.top = startY + 'px';
    p.style.transform = `scale(${scale})`;
    
    nodeLayer.appendChild(p);

    // Physics vectors
    const angle = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 5;
    let vx = Math.cos(angle) * speed;
    let vy = Math.sin(angle) * speed - 1; // Slight upward bias
    
    let curX = startX;
    let curY = startY;
    let opacity = 1;
    let rotation = Math.random() * 360;
    const rotationSpeed = (Math.random() - 0.5) * 10;

    // Smooth frame-by-frame animation loop
    function updateParticle() {
      curX += vx;
      curY += vy;
      
      // Simulate light atmosphere drift drag
      vx *= 0.96;
      vy *= 0.96;
      vy += 0.05; // Tiny gravity pull downward
      
      opacity -= 0.025; // Fade out curve
      rotation += rotationSpeed;

      p.style.left = curX + 'px';
      p.style.top = curY + 'px';
      p.style.transform = `scale(${scale}) rotate(${rotation}deg)`;
      p.style.opacity = opacity;

      if (opacity > 0) {
        requestAnimationFrame(updateParticle);
      } else {
        p.remove();
      }
    }
    
    requestAnimationFrame(updateParticle);
  }
}

function isPortConnected(nodeId,type,idx){
  return G.wires.some(w=>type==='out'?(w.fromNode===nodeId&&w.fromPort===idx):(w.toNode===nodeId&&w.toPort===idx));
}
function deleteNode(id) {
  if (!G.nodes[id]) return;

  const n = G.nodes[id];
  if (n) {
    // Spawns the coordinates near the structural center of the module
    createBinaryExplosion(n.x + 85, n.y + 65);
  }

  G.wires = G.wires.filter(w => w.fromNode !== id && w.toNode !== id);
  document.getElementById('node_' + id)?.remove();
  delete G.nodes[id];
  
  renderAllWires();
  updateStats();
  log('Module decoupled into raw matrix bits.', 'info');
}

function startDragNode(e,id){
  if(spaceDown)return;
  
  // If we clicked a button or port, kill the event and DO NOT start dragging!
  if (e.target.closest('.port') || e.target.closest('.node-del') || e.target.closest('.node-lvl')) {
    e.stopPropagation();
    return;
  }
  
  G.draggingNode=id;
  const n=G.nodes[id];
  const r=canvasWrap.getBoundingClientRect();
  const{x:wx,y:wy}=screenToWorld(e.clientX-r.left,e.clientY-r.top);
  G.draggingOffset={x:wx-n.x,y:wy-n.y};
  e.preventDefault();
}

let connectStart=null;
function nodeName(id){
  const n=G.nodes[id];const d=n&&MODULE_DEFS.find(x=>x.id===n.defId);
  return d?d.name:'node';
}
// Highlights the input ports that dragging from the current output would disconnect
function isCutTarget(nodeId,idx){
  if(!connectStart||connectStart.type!=='out')return false;
  return G.wires.some(w=>w.fromNode===connectStart.nodeId&&w.fromPort===connectStart.idx&&w.toNode===nodeId&&w.toPort===idx);
}
function finishConnectUI(){
  connectStart=null;tempWireSvg.innerHTML='';
  document.body.classList.remove('connecting');
  Object.keys(G.nodes).forEach(renderNode);
  renderAllWires();
}
function logCut(w){log('Disconnected: '+nodeName(w.fromNode)+' ✕ '+nodeName(w.toNode),'info');}

/* Drag from an output port to start a wire.
   Drag from an input port that already has a wire to pull that wire off:
   drop it on another input to move it, or anywhere else to disconnect it. */
function startConnect(e,nodeId,type,idx){
  e.preventDefault();
  if(type==='in'){
    const w=G.wires.find(x=>x.toNode===nodeId&&x.toPort===idx);
    if(!w)return;
    G.wires=G.wires.filter(x=>x!==w);
    connectStart={nodeId:w.fromNode,type:'out',idx:w.fromPort,detached:{fromNode:w.fromNode,fromPort:w.fromPort,toNode:w.toNode,toPort:w.toPort}};
    document.body.classList.add('connecting');
    renderAllWires();
    return;
  }
  connectStart={nodeId,type,idx};
  document.body.classList.add('connecting');
}
function endConnect(nodeId,type,idx){
  const cs=connectStart;
  const det=cs&&cs.detached;
  const restore=()=>{if(det)G.wires.push({...det,_active:false});};
  if(!cs||type!=='in'){
    // dropped on an output port or nothing: a pulled-off wire stays disconnected
    if(det)logCut(det);
    finishConnectUI();return;
  }
  const fromNode=cs.nodeId,fromPort=cs.idx;
  const toNode=nodeId,toPort=idx;
  if(fromNode===toNode){restore();finishConnectUI();return;}
  // dropped back on the port it was pulled from: nothing changes
  if(det&&det.toNode===toNode&&det.toPort===toPort){restore();finishConnectUI();return;}
  const def=MODULE_DEFS.find(d=>d.id===G.nodes[fromNode].defId);
  const tdef=MODULE_DEFS.find(d=>d.id===G.nodes[toNode].defId);
  const outType=getEffectiveOutputs(G.nodes[fromNode],def)[fromPort];
  const inType=getEffectiveInputs(G.nodes[toNode],tdef)[toPort];
  if(outType!==inType){
    restore();
    log(`Type mismatch: "${outType}" → "${inType}"`,'err');
    finishConnectUI();return;
  }
  // dragging between two nodes that are already connected disconnects them
  const existing=G.wires.find(w=>w.fromNode===fromNode&&w.fromPort===fromPort&&w.toNode===toNode&&w.toPort===toPort);
  if(existing&&!det){
    G.wires=G.wires.filter(w=>w!==existing);
    logCut(existing);
    finishConnectUI();return;
  }
  G.wires=G.wires.filter(w=>!(w.toNode===toNode&&w.toPort===toPort));
  G.wires.push({fromNode,fromPort,toNode,toPort,_active:false});
  log((det?'Moved: ':'')+def.name+' → '+tdef.name,'info');
  finishConnectUI();
}

document.addEventListener('mousemove',e=>{
  const r=canvasWrap.getBoundingClientRect();
  const sx=e.clientX-r.left,sy=e.clientY-r.top;
  if(isPanning){
    vp.x=panOrigin.x+(e.clientX-panStart.x);vp.y=panOrigin.y+(e.clientY-panStart.y);
    applyViewport();return;
  }
  const{x:wx,y:wy}=screenToWorld(sx,sy);
  if(G.draggingNode){
    const n=G.nodes[G.draggingNode];
    n.x=Math.max(0,Math.round((wx-G.draggingOffset.x)/CELL)*CELL);
    n.y=Math.max(0,Math.round((wy-G.draggingOffset.y)/CELL)*CELL);
    renderNode(G.draggingNode);renderAllWires();
  }
  if(connectStart){
    const p1=getPortPos(connectStart.nodeId,'out',connectStart.idx);
    const{x:wmx,y:wmy}=screenToWorld(sx,sy);
    const cx=(p1.x+wmx)/2;
    tempWireSvg.innerHTML=`<path d="M${p1.x},${p1.y} C${cx},${p1.y} ${cx},${wmy} ${wmx},${wmy}" stroke="#4f9eff" stroke-width="${1.5/vp.zoom}" fill="none" stroke-dasharray="${5/vp.zoom},${3/vp.zoom}"/>`;
  }
});
document.addEventListener('mouseup',e=>{
  document.body.classList.remove('connecting');
  if(isPanning){isPanning=false;return;}
  if(G.draggingNode){G.draggingNode=null;renderAllWires();}
  if(connectStart){
    if(connectStart.detached)logCut(connectStart.detached);
    finishConnectUI();
  }
});
canvasWrap.addEventListener('dragover',e=>e.preventDefault());
canvasWrap.addEventListener('drop',e=>{
  e.preventDefault();
  const defId=e.dataTransfer.getData('defId');
  if(!defId)return;
  const r=canvasWrap.getBoundingClientRect();
  const{x,y}=screenToWorld(e.clientX-r.left,e.clientY-r.top);
  spawnNode(defId,x,y);
});

function openUpgrade(id, event) {
  if (event) event.stopPropagation(); // ◄ CRITICAL: Prevents click passing through to the node!
  
  const n = G.nodes[id];
  if (!n) return;
  const def = MODULE_DEFS.find(d => d.id === n.defId);
  if (!def || !def.upgrades) return;

  // Track the node we are editing
  window.currentUpgradeNodeId = id;

  document.getElementById('upg-title').textContent = `Upgrade ${def.name}`;
  
  // Render each individual upgrade type defined for this module
  const html = def.upgrades.map(upg => {
    const curLvl = n.upgLevels?.[upg.stat] || 0;
    const maxLvl = upg.levels.length;
    const isMaxed = curLvl >= maxLvl;
    
    const currentVal = curLvl === 0 ? upg.base : upg.levels[curLvl - 1];
    const nextVal = isMaxed ? null : upg.levels[curLvl];
    const cost = isMaxed ? null : upg.costs[curLvl];

    return `
      <div class="upg-row">
        <div>
          <strong>${upg.label}</strong> (Lvl ${curLvl}/${maxLvl})
          <div class="upg-stat">Current: ${currentVal}${upg.unit} ${!isMaxed ? `➔ Next: ${nextVal}${upg.unit}` : ''}</div>
        </div>
        <div>
          ${isMaxed ? 
            `<span class="upg-maxed">MAX</span>` : 
            `<button class="upg-btn" ${G.money < cost ? 'disabled' : ''} onclick="buyNodeUpgrade('${id}', '${upg.stat}', ${cost})">
              ${cost.toLocaleString()} ◆
             </button>`
          }
        </div>
      </div>
    `;
  }).join('');

  document.getElementById('upg-content').innerHTML = html;
  document.getElementById('upg-modal').classList.add('open');
}

function buyNodeUpgrade(nodeId, statKey, cost) {
  if (G.money < cost) return;
  
  const n = G.nodes[nodeId];
  if (!n) return;

  G.money -= cost;
  if (!n.upgLevels) n.upgLevels = {};
  n.upgLevels[statKey] = (n.upgLevels[statKey] || 0) + 1;

  log(`Upgraded module stat: ${statKey}`, 'info');
  
  updateStats();
  renderNode(nodeId);
  openUpgrade(nodeId); 
}

function closeUpgrade() {
  document.getElementById('upg-modal').classList.remove('open');
  window.currentUpgradeNodeId = null;
}

function doUpgrade(id,stat){
  const n=G.nodes[id];
  const def=MODULE_DEFS.find(d=>d.id===n.defId);
  const upg=def.upgrades.find(u=>u.stat===stat);
  if(!upg)return;
  const lvl=n.upgLevels?.[stat]||0;
  if(lvl>=upg.levels.length)return;
  const cost=upg.costs[lvl];
  if(G.money<cost){log('Not enough money','err');return;}
  G.money-=cost;
  if(!n.upgLevels)n.upgLevels={};
  n.upgLevels[stat]=(n.upgLevels[stat]||0)+1;
  log(def.name+' — '+upg.label+' upgraded to level '+(lvl+1),'info');
  openUpgrade(id,{stopPropagation:()=>{}});
  updateStats();
}
function closeUpgrade(){document.getElementById('upg-modal').classList.remove('open');G.upgModal=null;}

/* ── PC RESOURCE HELPERS ── */
function calcPCResources(){
  const cpuTier=hwGet('cpu');
  const ramTier=hwGet('ram');
  const diskTier=hwGet('storage');
  const coolerTier=hwGet('cooler');

  let cpuUsed=0;
  let ramUsedMB=0;
  let diskUsedMB=0;
  let heatGenerated=0;

  Object.values(G.nodes).forEach(n=>{
    const def=MODULE_DEFS.find(d=>d.id===n.defId);
    if(!def)return;

    // CPU & heat from processing nodes (only when active)
    if(def.procType&&n._proc&&!n._blocked){
      cpuUsed+=PROC_CPU[def.procType]||0;
      if(!PC_LOCK.thermal)heatGenerated+=PROC_HEAT[def.procType]||0;
    }

    // RAM from active downloaders
    if(def.fileType&&n.state==='active'){
      const fd=FILE_DEFS[def.fileType];
      const slots=nodeStat(n,'slots')||1;
      const activeSlots=(n._slots||[]).filter(s=>s).length;
      ramUsedMB+=fd.ramMB*activeSlots;
    }

    // RAM for RAM disk
    if(def.isRAMDisk){
      ramUsedMB+=8*1024; // 8 GB reserved
    }

    // Disk usage: files currently in all queues
    if(n.queue&&n.queue.length){
      n.queue.forEach(f=>diskUsedMB+=f.sizeMB||0);
    }
    // Also count files being processed
    if(n._proc)diskUsedMB+=(n._proc.sizeMB||0);
    // Files in upload threads
    if(n._threads)n._threads.forEach(t=>t&&(diskUsedMB+=t.file.sizeMB||0));
  });

  // Temperature: baseline 35°C, rises with heat, falls toward ambient
  const targetTemp=35+heatGenerated;
  PC.tempC=PC.tempC+(targetTemp-PC.tempC)*0.05;
  PC.tempC=Math.max(35,PC.tempC);

  return{
    cpuUsed,
    cpuCap:cpuTier.cpuCap,
    ramUsedGB:ramUsedMB/1024,
    ramCapGB:ramTier.ramGB,
    diskUsedGB:diskUsedMB/1024,
    diskCapGB:diskTier.capGB,
    tempC:PC.tempC,
    throttleC:coolerTier.throttleC,
    maxTempC:coolerTier.maxTempC,
  };
}

function barClass(pct){
  if(pct>90)return'crit';
  if(pct>70)return'warn';
  return'ok';
}

function updateHUD(){
  const r=calcPCResources();

  // CPU
  const cpuPct=Math.min(100,Math.round(r.cpuUsed/r.cpuCap*100));
  document.getElementById('hud-cpu-val').textContent=Math.round(r.cpuUsed)+'%';
  document.getElementById('hud-cpu-pct').textContent=cpuPct+'%';
  document.getElementById('hud-cpu-sub').textContent=hwGet('cpu').name;
  const cpuBar=document.getElementById('hud-cpu-bar');
  cpuBar.style.width=cpuPct+'%';
  cpuBar.className='hud-bar-fill '+barClass(cpuPct);

  // RAM
  const ramPct=Math.min(100,Math.round(r.ramUsedGB/r.ramCapGB*100));
  document.getElementById('hud-ram-val').textContent=r.ramUsedGB.toFixed(1)+' / '+r.ramCapGB+' GB';
  document.getElementById('hud-ram-sub').textContent=hwGet('ram').sub;
  const ramBar=document.getElementById('hud-ram-bar');
  ramBar.style.width=ramPct+'%';
  ramBar.className='hud-bar-fill '+barClass(ramPct);

  // Disk
  const diskPct=Math.min(100,Math.round(r.diskUsedGB/r.diskCapGB*100));
  document.getElementById('hud-disk-val').textContent=r.diskUsedGB.toFixed(0)+' / '+r.diskCapGB+' GB';
  document.getElementById('hud-disk-sub').textContent=hwGet('storage').name.split(' ').slice(-2).join(' ');
  const diskBar=document.getElementById('hud-disk-bar');
  diskBar.style.width=diskPct+'%';
  diskBar.className='hud-bar-fill '+barClass(diskPct);

  // Temperature
  const tempPct=Math.min(100,Math.round((r.tempC-35)/(r.maxTempC-35)*100));
  document.getElementById('hud-temp-val').textContent=Math.round(r.tempC)+'°C';
  const cooler=hwGet('cooler');
  const isThrottling=r.tempC>=r.throttleC;
  document.getElementById('hud-temp-sub').textContent=PC_LOCK.thermal?'⚠ Overheated · processors paused':cooler.name;
  const tempBar=document.getElementById('hud-temp-bar');
  tempBar.style.width=Math.max(0,tempPct)+'%';
  tempBar.className='hud-bar-fill '+(r.tempC>=r.throttleC?'crit':r.tempC>=(r.throttleC-10)?'warn':'ok');

  // CPU over cap warning
  const cpuOverCap=r.cpuUsed>r.cpuCap;
  const diskFull=r.diskUsedGB>=r.diskCapGB*0.95;
  const ramFull=r.ramUsedGB>=r.ramCapGB*0.95;

  // These conditions are checked each game tick for throttling logic
  G._pcState={cpuOverCap,isThrottling,diskFull,ramFull,r};
}

/* ── GAME LOOP ── */
let lastTick=null;
// Rotates the starting node each tick so no input is always served first
function rotatedNodes(){
  const e=Object.entries(G.nodes);
  if(e.length<2)return e;
  const k=(G._rot=(G._rot||0)+1)%e.length;
  return e.slice(k).concat(e.slice(0,k));
}

function gameTick(ts){
  if(!lastTick)lastTick=ts;
  const dt=Math.min((ts-lastTick)/1000,0.1);
  lastTick=ts;
  let incomeNow=0;
  G.clock+=dt;

  const bwMap={};
  const ulMap={};

  // Update PC state first
  updateHUD();
  const pcState=G._pcState||{};

  /* PASS 1a: Network links. The NIC is the ceiling for ALL downloading together;
     each link's speed is then shared between the wires it feeds. */
  const links=[];
  Object.entries(G.nodes).forEach(([id,n])=>{
    const def=MODULE_DEFS.find(d=>d.id===n.defId);
    if(!def||!def.isLink)return;
    links.push({id,n,def,
      dl:nodeStat(n,'dlSpeed')||(def.upgrades.find(u=>u.stat==='dlSpeed')?.base||10),
      ul:nodeStat(n,'ulSpeed')||(def.upgrades.find(u=>u.stat==='ulSpeed')?.base||1)});
  });
  const nicMax=hwGet('nic').maxBwMBs;
  const dlSum=links.reduce((s,l)=>s+l.dl,0);
  const nicScale=dlSum>nicMax?nicMax/dlSum:1;
  links.forEach(l=>{
    const dl=l.dl*nicScale;
    l.n._dlSpeed=dl;l.n._ulSpeed=l.ul;
    distribute(l.id,0,dl,bwMap,true);
    distribute(l.id,1,l.ul,ulMap,false);
    l.n.state='active';
  });

  /* PASS 1b: Link aggregator */
  Object.entries(G.nodes).forEach(([id,n])=>{
    const def=MODULE_DEFS.find(d=>d.id===n.defId);
    if(!def||!def.isAggregator)return;
    const activePorts=nodeStat(n,'aggPorts')||2;
    const eff=(nodeStat(n,'aggEff')||90)/100;
    let totalDl=0,totalUl=0,anyIn=false;
    for(let pi=0;pi<activePorts;pi++){
      totalDl+=bwMap[id+'_'+pi]||0;totalUl+=ulMap[id+'_'+pi]||0;
      if(bwMap[id+'_'+pi]||ulMap[id+'_'+pi])anyIn=true;
    }
    totalDl*=eff;totalUl*=eff;
    n._dlSpeed=totalDl;n._ulSpeed=totalUl;
    distribute(id,0,totalDl,bwMap,true);
    distribute(id,1,totalUl,ulMap,false);
    n.state=anyIn?'active':'idle';
  });

  /* PASS 2: BW amplifier */
  Object.entries(G.nodes).forEach(([id,n])=>{
    if(n.defId!=='bandwidth_amp')return;
    const inBw=bwMap[id+'_0']||0;
    const mult=nodeStat(n,'bwMult')||1.5;
    distribute(id,0,Math.min(inBw*mult,hwGet('nic').maxBwMBs*2),bwMap,true);
    n.state=inBw>0?'active':'idle';
  });

  /* PASS 3: Downloaders — disk full or RAM full blocks downloads */
  rotatedNodes().forEach(([id,n])=>{
    const def=MODULE_DEFS.find(d=>d.id===n.defId);
    if(!def||!def.fileType)return;
    const fd=FILE_DEFS[def.fileType];
    const bw=bwMap[id+'_0']||0;
    const slots=nodeStat(n,'slots')||1;
    if(!n._slots||n._slots.length!==slots)n._slots=Array(slots).fill(null);
    n._speeds=[];

    if(bw<=0){n.state='idle';return;}
    if(pcState.diskFull){n.state='error';return;}

    // RAM check: each slot needs ramMB of RAM
    const ramTier=hwGet('ram');
    const ramCapMB=ramTier.ramGB*1024;
    const r=calcPCResources();
    const ramAvailMB=(ramTier.ramGB-r.ramUsedGB)*1024;

    let ramLeftMB=ramAvailMB;
    n._blocked=false;
    // start a download in every free slot that has RAM for it
    n._slots.forEach((slot,si)=>{
      if(!slot&&ramLeftMB>fd.ramMB){
        ramLeftMB-=fd.ramMB;
        n._slots[si]={progress:0,total:fd.sizeMB};   // MB downloaded / file size
      }
    });
    // this node's share of the link is split between the files it is downloading;
    const occ=n._slots.filter(s=>s&&s.progress<s.total).length;
    const rate=occ?bw/occ:0;   // time = size ÷ this slot's share of the link
    n._slots.forEach((slot,si)=>{
      if(!slot)return;
      if(slot.progress<slot.total){
        slot.progress=Math.min(slot.total,slot.progress+rate*dt);
        n._speeds.push(rate);
      }
      if(slot.progress>=slot.total){
        // Hard limit: the next node is full, so this file waits here
        if(!outRoom(id,0)){slot.progress=slot.total;n._blocked=true;return;}
        n._slots[si]=null;
        const corrupt=Math.random()<0.07;
        const file={id:'f'+(G.nextId++),type:def.fileType,sizeMB:fd.sizeMB,
          value:fd.baseVal*(0.85+Math.random()*0.3),corrupt,tags:[]};
        const outs=G.wires.filter(w=>w.fromNode===id&&w.fromPort===0);
        if(outs.length){pushToNode(outs[0].toNode,file,id);outs[0]._active=true;}
        n.state='active';
      }
    });
    n.state=n._blocked?'waiting':n._slots.some(s=>s)?'active':'idle';
  });

  /* PASS 4: Processing — slowed by CPU over-cap or thermal throttle */
  // Hard limits: overheating pauses every processor until it cools down;
  // a job only starts if there is CPU headroom for it.
  const rNow=pcState.r;
  if(rNow){
    if(rNow.tempC>=rNow.throttleC)PC_LOCK.thermal=true;
    else if(rNow.tempC<=rNow.throttleC-PACE.thermalResume)PC_LOCK.thermal=false;
  }
  let cpuRun=0;
  Object.values(G.nodes).forEach(pn=>{
    const pd=MODULE_DEFS.find(d=>d.id===pn.defId);
    if(pd&&pd.procType&&pn._proc&&!pn._blocked)cpuRun+=PROC_CPU[pd.procType]||0;
  });
  const cpuCapNow=hwGet('cpu').cpuCap;
  rotatedNodes().forEach(([id,n])=>{
    const def=MODULE_DEFS.find(d=>d.id===n.defId);
    if(!def||!def.procType)return;
    n.queue=n.queue||[];
    n._blocked=false;
    n._waitCpu=false;
    if(!n._proc&&n.queue.length){
      const need=PROC_CPU[def.procType]||0;
      if(!PC_LOCK.thermal&&cpuRun+need<=cpuCapNow){
        n._proc=n.queue.shift();n.progress=0;cpuRun+=need;
      } else n._waitCpu=true;
    }
    if(n._proc){
      const pt=nodeStat(n,'procTime')||def.procTime||1;
      if(!PC_LOCK.thermal&&n.progress<1)n.progress+=dt/pt;
      if(n.progress>=1){
        if(!outRoom(id,0)){n.progress=1;n._blocked=true;n.state='waiting';return;}
        let f={...n._proc};
        const vb=nodeStat(n,'valBonus')||def.valBonus||0;
        if(['scanner','metadata','decoder','encryptor'].includes(def.procType))f.value=f.value*(1+vb/100);
        if(def.procType==='antivirus')f.corrupt=false;
        if(def.procType==='compressor'){const cr=nodeStat(n,'compRatio')||50;f.sizeMB=f.sizeMB*(1-cr/100);}
        f.tags=[...(f.tags||[]),def.procType];
        n._proc=null;n.progress=0;
        const outs=G.wires.filter(w=>w.fromNode===id&&w.fromPort===0);
        if(outs.length){pushToNode(outs[0].toNode,f,id);outs[0]._active=true;}
        n.state='active';
      } else n.state=PC_LOCK.thermal?'waiting':'active';
    } else n.state=n._waitCpu?'waiting':n.queue.length?'active':'idle';
  });

  /* PASS 5: Utilities */
  Object.entries(G.nodes).forEach(([id,n])=>{
    const def=MODULE_DEFS.find(d=>d.id===n.defId);
    if(!def)return;
    n.queue=n.queue||[];

    if(def.isBuffer){
      const cap=nodeStat(n,'bufSize')||8;
      n._rTimer=(n._rTimer||0)+dt;
      if(n._rTimer>=0.05&&n.queue.length&&outRoom(id,0)){
        n._rTimer=0;
        const f=n.queue.shift();
        const outs=G.wires.filter(w=>w.fromNode===id&&w.fromPort===0);
        if(outs.length){pushToNode(outs[0].toNode,f,id);outs[0]._active=true;}
      }
      n.state=n.queue.length>=(cap*0.9)?'error':n.queue.length?'active':'idle';
    }

    if(def.isSSDCache){
      const cap=nodeStat(n,'cacheSize')||20;
      n._rTimer=(n._rTimer||0)+dt;
      if(n._rTimer>=0.02&&n.queue.length&&outRoom(id,0)){ // faster throughput
        n._rTimer=0;
        const f=n.queue.shift();
        const outs=G.wires.filter(w=>w.fromNode===id&&w.fromPort===0);
        if(outs.length){pushToNode(outs[0].toNode,f,id);outs[0]._active=true;}
      }
      n.state=n.queue.length>=(cap*0.9)?'error':n.queue.length?'active':'idle';
    }

    if(def.isRAMDisk){
      // Ultra-fast — near-instant pass through
      n._rTimer=(n._rTimer||0)+dt;
      if(n._rTimer>=0.01&&n.queue.length&&outRoom(id,0)){
        n._rTimer=0;
        const f=n.queue.shift();
        const outs=G.wires.filter(w=>w.fromNode===id&&w.fromPort===0);
        if(outs.length){pushToNode(outs[0].toNode,f,id);outs[0]._active=true;}
      }
      n.state=n.queue.length?'active':'idle';
    }

    if(def.isBackup&&n.queue.length){
      const rt=nodeStat(n,'recoverTime')||2;
      n._rTimer=(n._rTimer||0)+dt;
      if(n._rTimer>=rt&&outRoom(id,0)){
        n._rTimer=0;
        const f=n.queue.shift();
        if(f.corrupt)f.corrupt=false; // backup recovers corrupt
        const outs=G.wires.filter(w=>w.fromNode===id&&w.fromPort===0);
        if(outs.length){pushToNode(outs[0].toNode,f,id);outs[0]._active=true;}
      }
      n.state='active';
    }

    if(def.isScheduler){
      // Task scheduler: drops low-value files when CPU overloaded
      const thresh=nodeStat(n,'schedThresh')||90;
      n._rTimer=(n._rTimer||0)+dt;
      if(n._rTimer>=0.05&&n.queue.length&&outRoom(id,0)){
        n._rTimer=0;
        // Sort so highest value goes first
        n.queue.sort((a,b)=>b.value-a.value);
        const r2=calcPCResources();
        const cpuPct=r2.cpuUsed/r2.cpuCap*100;
        let f;
        if(cpuPct>thresh){
          // Drop lowest value files — only pass top half
          f=n.queue.shift();
        } else {
          f=n.queue.shift();
        }
        const outs=G.wires.filter(w=>w.fromNode===id&&w.fromPort===0);
        if(outs.length){pushToNode(outs[0].toNode,f,id);outs[0]._active=true;}
      }
      n.state=n.queue.length?'active':'idle';
    }

    if(def.isSorter&&n.queue.length){
      n._rTimer=(n._rTimer||0)+dt;
      if(n._rTimer>=(nodeStat(n,'sortTime')||0.4)){
        const f=n.queue[0];
        const cut=nodeStat(n,'cutoffMB')||5;
        const want=f.sizeMB>=cut?1:0;
        const wired=pi=>G.wires.some(w=>w.fromNode===id&&w.fromPort===pi);
        // if the chosen output isn't wired, use the other one so nothing jams
        const port=wired(want)?want:wired(1-want)?1-want:want;
        if(outRoom(id,port)){
          n._rTimer=0;n.queue.shift();
          const o=G.wires.find(w=>w.fromNode===id&&w.fromPort===port);
          if(o){pushToNode(o.toNode,f,id);o._active=true;}
          n._lastPort=port;
        }
      }
      n.state='active';
    } else if(def.isSorter)n.state='idle';

    if(def.isHoneypot&&n.queue.length){
      n._rTimer=(n._rTimer||0)+dt;
      if(n._rTimer>=(nodeStat(n,'trapTime')||0.5)){
        const f=n.queue[0];
        if(f.corrupt){
          n._rTimer=0;n.queue.shift();
          const pay=Math.round(f.value*(nodeStat(n,'bounty')||0.4));
          G.money+=pay;G.totalEarned+=pay;incomeNow+=pay;G.incomeLog.push({t:G.clock,v:pay});
          n._trapped=(n._trapped||0)+1;n._lastBounty=pay;
          log('Honeypot trapped a corrupt '+f.type+' → '+fmtMoney(pay),'info');
        } else if(outRoom(id,0)){
          n._rTimer=0;n.queue.shift();
          const o=G.wires.find(w=>w.fromNode===id&&w.fromPort===0);
          if(o){pushToNode(o.toNode,f,id);o._active=true;}
        }
      }
      n.state='active';
    } else if(def.isHoneypot)n.state='idle';

    if(def.isMirror&&n.queue.length&&outRoom(id,0,true)&&outRoom(id,1,true)){
      const f=n.queue.shift();
      const mm=nodeStat(n,'mirrorMult')||0.6;
      [0,1].forEach(pi=>{
        G.wires.filter(w=>w.fromNode===id&&w.fromPort===pi).forEach(w=>{
          pushToNode(w.toNode,{...f,id:'f'+(G.nextId++),value:f.value*mm},id);w._active=true;});
      });
      n.state='active';
    } else if(def.isMirror)n.state='idle';

    if(def.isSeeder){
      n.seeds=n.seeds||[];
      const slots=nodeStat(n,'seedSlots')||10;
      n._rTimer=(n._rTimer||0)+dt;
      if(n.queue.length&&n._rTimer>=0.1&&outRoom(id,0)){
        n._rTimer=0;
        const f=n.queue.shift();
        if(!f.corrupt){n.seeds.push({type:f.type,val:f.value});while(n.seeds.length>slots)n.seeds.shift();}
        const o=G.wires.find(w=>w.fromNode===id&&w.fromPort===0);
        if(o){pushToNode(o.toNode,f,id);o._active=true;}
      }
      // each seed earns a % of its value every second; a faster NIC seeds better
      const rate=(nodeStat(n,'seedRate')||1)/100*sellNetFactor();
      let inc=0;n.seeds.forEach(sd=>{inc+=sd.val*rate*marketMult(sd.type)*dt;});
      n._seedAcc=(n._seedAcc||0)+inc;
      n._seedPs=n.seeds.reduce((a,sd)=>a+sd.val*rate*marketMult(sd.type),0);
      if(n._seedAcc>=1){
        const pay=Math.floor(n._seedAcc);n._seedAcc-=pay;
        G.money+=pay;G.totalEarned+=pay;incomeNow+=pay;G.incomeLog.push({t:G.clock,v:pay});
      }
      n.state=n.seeds.length?'active':'idle';
    }

    if(def.isSplit&&n.queue.length&&outRoom(id,0,true)&&outRoom(id,1,true)){
      const f=n.queue.shift();
      [0,1].forEach(pi=>{
        const outs=G.wires.filter(w=>w.fromNode===id&&w.fromPort===pi);
        outs.forEach(w=>{pushToNode(w.toNode,{...f,id:'f'+(G.nextId++)});w._active=true;});
      });
      n.state='active';
    }
    if(def.isPriority){
      n.queue.sort((a,b)=>b.value-a.value);
      if(n.queue.length&&outRoom(id,0)){
        const f=n.queue.shift();
        const outs=G.wires.filter(w=>w.fromNode===id&&w.fromPort===0);
        if(outs.length){pushToNode(outs[0].toNode,f,id);outs[0]._active=true;}
        n.state='active';
      } else n.state='idle';
    }
  });

  /* PASS 6: Network binder */
  Object.entries(G.nodes).forEach(([id,n])=>{
    if(n.defId!=='network_binder')return;
    const qs=nodeStat(n,'queueSize')||5;
    const ul=ulMap[id+'_1']||0;
    n.queue=n.queue||[];
    const outs=G.wires.filter(w=>w.fromNode===id&&w.fromPort===0);
    n._rTimer=(n._rTimer||0)+dt;
    if(n._rTimer>=0.1&&n.queue.length&&ul>0&&outs.length&&outRoom(id,0)){
      n._rTimer=0;
      const f=n.queue.shift();
      f._boundUl=ul;
      pushToNode(outs[0].toNode,f,id);outs[0]._active=true;
    }
    n.state=ul<=0?'error':n.queue.length?'active':'idle';
  });

  /* PASS 7: Uploader. The line (min of link UL, NIC and disk) is shared by every
     active thread; one thread can't push more than PACE.threadCap. Time = size / speed. */
  const upl=[];
  Object.entries(G.nodes).forEach(([id,n])=>{
    if(n.defId!=='uploader')return;
    n.queue=n.queue||[];
    const threads=nodeStat(n,'threads')||1;
    if(!n._threads)n._threads=Array(threads).fill(null);
    if(n._threads.length!==threads)n._threads=n._threads.slice(0,threads).concat(Array(Math.max(0,threads-n._threads.length)).fill(null));
    n._threads.forEach((t,ti)=>{
      if(!t&&n.queue.length)n._threads[ti]={file:n.queue.shift(),progress:0};
    });
    const act=n._threads.filter(t=>t&&t.progress<1);
    let line=Math.min(hwGet('storage').rwMBs,hwGet('nic').maxBwMBs);
    act.forEach(t=>{if(t.file._boundUl)line=Math.min(line,t.file._boundUl);});
    upl.push({id,n,threads,count:act.length,per:act.length?Math.min(PACE.threadCap,line/act.length):0});
  });
  // all uploaders together can't exceed the disk or the NIC
  const upHw=Math.min(hwGet('storage').rwMBs,hwGet('nic').maxBwMBs);
  const upWant=upl.reduce((s,u)=>s+u.per*u.count,0);
  const upScale=upWant>upHw?upHw/upWant:1;
  upl.forEach(({id,n,threads,per})=>{
    const rate=per*upScale;
    let used=0;
    n._threads.forEach((t,ti)=>{
      if(!t)return;
      if(t.progress<1){
        t.progress=Math.min(1,t.progress+rate*dt/Math.max(1e-6,t.file.sizeMB));
        used+=rate;
      }
      if(t.progress>=1){
        if(!outRoom(id,0)){t.progress=1;return;}
        const sold=t.file;
        n._threads[ti]=null;
        const outs=G.wires.filter(w=>w.fromNode===id&&w.fromPort===0);
        if(outs.length){pushToNode(outs[0].toNode,sold,id);outs[0]._active=true;}
        n.state='uploading';
      }
    });
    n._ulSpeed=used;
    n.progress=n._threads.filter(t=>t).length/threads;
    n.state=n._threads.some(t=>t)?'uploading':n.queue.length?'active':'idle';
  });

  /* PASS 8: Sellers */
  Object.entries(G.nodes).forEach(([id,n])=>{
    const def=MODULE_DEFS.find(d=>d.id===n.defId);
    if(!def||!def.isSeller)return;
    n.queue=n.queue||[];
    const delay=(nodeStat(n,'sellDelay')||def.sellDelay||1.5)/sellNetFactor();
    n._sellTimer=(n._sellTimer||0)+dt;
    if(n._sellTimer>=delay&&n.queue.length){
      n._sellTimer=0;
      const f=n.queue.shift();
      const sm=nodeStat(n,'sellMult')||def.sellMult||1;
      const comm=(nodeStat(n,'commission')??20)/100;
      const mm=marketMult(f.type);
      let val=f.value*sm*mm;
      if(f.corrupt)val*=0.1;
      val=val*(1-comm);
      val=Math.round(val);
      G.money+=val;G.totalEarned+=val;G.soldCount++;incomeNow+=val;G.incomeLog.push({t:G.clock,v:val});
      if(G.soldCount===100)setFlag('rft_sold_100');
      if(G.soldCount===1000)setFlag('rft_sold_1000');
      n._lastSell=val;
      n.state='active';
      log(`Sold ${f.type} (${fmtSize(f.sizeMB)}) → ${fmtMoney(val)} · ${TYPE_TICKER[f.type]} ×${mm.toFixed(2)}${f.tags.length?' ['+f.tags.join(',')+']':''}${f.corrupt?' ⚠CORRUPT':''}`,f.corrupt?'err':'ok');
    } else n.state=n.queue.length?'active':'idle';
  });

  Object.keys(G.nodes).forEach(renderNode);
  renderAllWires();

  // income per second = what was earned in the last 15 game-seconds / those seconds
  while(G.incomeLog.length&&G.incomeLog[0].t<G.clock-15)G.incomeLog.shift();
  G.incomePs=G.incomeLog.reduce((a,e)=>a+e.v,0)/Math.max(1,Math.min(15,G.clock));
  updateStats();
  requestAnimationFrame(gameTick);
}

// Selling goes over your connection: a faster NIC means faster sales (WiFi 5 = 1×)
function sellNetFactor(){return Math.max(1,Math.sqrt(hwGet('nic').maxBwMBs/62));}

function pushToNode(toId,file,fromId){
  const n=G.nodes[toId];if(!n)return;
  if(!n.queue)n.queue=[];
  if(fromId)file._src=fromId;   // lets a shared queue (the binder) keep one source from hogging it
  n.queue.push(file);
}

function updateStats(){
  document.getElementById('st-money').textContent=fmtMoney(G.money);
  document.getElementById('st-ips').textContent=(G.incomePs<10?G.incomePs.toFixed(1):Math.round(G.incomePs).toLocaleString())+' ◆/s';
  document.getElementById('st-sold').textContent=G.soldCount;
  document.getElementById('st-total').textContent=fmtMoney(G.totalEarned);
}

const logEl=document.getElementById('log-bar');
function log(msg,cls=''){
  const d=document.createElement('div');
  d.className='log-line'+(cls?' '+cls:'');
  d.textContent=msg;
  logEl.prepend(d);
  while(logEl.children.length>40)logEl.lastChild.remove();
}

function autoLayout(){
  const cats=['Network','Downloads','Processing','Storage','Upload & Sell','Utilities'];
  const byId={};
  Object.entries(G.nodes).forEach(([id,n])=>{
    const def=MODULE_DEFS.find(d=>d.id===n.defId);
    const cat=def?def.cat:'Utilities';
    if(!byId[cat])byId[cat]=[];
    byId[cat].push(id);
  });
  let cx=40;
  cats.forEach(cat=>{
    const ids=byId[cat]||[];
    ids.forEach((id,i)=>{G.nodes[id].x=cx;G.nodes[id].y=40+i*180;renderNode(id);});
    if(ids.length)cx+=190;
  });
  renderAllWires();
  vp={x:20,y:20,zoom:1};applyViewport();
}

function clearAll(){
  if(!confirm('Remove all nodes and wires?'))return;
  Object.keys(G.nodes).forEach(id=>document.getElementById('node_'+id)?.remove());
  G.nodes={};G.wires=[];svgLayer.innerHTML='';
  log('Canvas cleared...','info');
  saveGame();
}

// ─── PLACE STEP 3 KEYBOARD LISTENER HERE ───
window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  const key = e.key.toLowerCase();

  if (hoveredNodeId !== null) {
    if (key === 'u') {
      if (typeof openUpgrade === 'function') openUpgrade(hoveredNodeId);
    } 
    else if (key === 'd') {
      if (typeof deleteNode === 'function') {
        const targetId = hoveredNodeId;
        hoveredNodeId = null; // Clear tracking state immediately
        deleteNode(targetId);
      }
    }
  }
});

/* ── RENDER PRODUCTIONS: MARKET LINK ──
   Reads /prices.json (updated by the GitHub Action). Each file type is bought
   by one company; payouts scale with that company's price vs. its starting price.
   Keep `base` in sync with the `start` values in .github/scripts/tick.js. */
const MARKET_URL='/prices.json';
const MARKET_REFRESH_MS=60*1000;
const TICKERS={
  BNW: {base:12.80, types:['Document','Database']},
  BLU: {base:78.25, types:['Software','Archive']},
  RRM: {base:120.00,types:['Video','Audio']},
  NACH:{base:45.50, types:['Image','Ebook']}
};
const TYPE_TICKER={};
Object.keys(TICKERS).forEach(t=>TICKERS[t].types.forEach(ty=>{TYPE_TICKER[ty]=t;}));
const MARKET={prices:null,online:false};

function tickerMult(tk){
  if(!MARKET.prices||!MARKET.prices[tk])return 1;
  return Math.min(1.75,Math.max(0.5,MARKET.prices[tk]/TICKERS[tk].base));
}
function marketMult(type){return tickerMult(TYPE_TICKER[type]);}

function renderMarket(){
  const rows=document.getElementById('mkt-rows');
  const st=document.getElementById('mkt-status');
  if(!rows||!st)return;
  st.textContent=MARKET.online?'LIVE':'OFFLINE ×1.00';
  st.className=MARKET.online?'':'off';
  rows.innerHTML=Object.keys(TICKERS).map(tk=>{
    const m=tickerMult(tk);
    const cls=m>1.005?'up':m<0.995?'down':'';
    const arrow=m>1.005?' ▲':m<0.995?' ▼':'';
    return `<div class="mkt-row"><span class="tk">${tk}</span><span class="ty">${TICKERS[tk].types.join(', ')}</span><span class="mx ${cls}">×${m.toFixed(2)}${arrow}</span></div>`;
  }).join('');
}
function loadMarket(){
  fetch(MARKET_URL+'?t='+Date.now(),{cache:'no-store'})
    .then(r=>{if(!r.ok)throw new Error(r.status);return r.json();})
    .then(d=>{
      if(!d||!d.prices)throw new Error('bad data');
      MARKET.prices=d.prices;MARKET.online=true;renderMarket();
    })
    .catch(()=>{MARKET.online=false;renderMarket();})
    .then(()=>setTimeout(loadMarket,MARKET_REFRESH_MS));
}

/* ── RENDER PRODUCTIONS: FREQUENCY FLAGS ──
   The frequency scanner writes flags to localStorage 'rp_flags'.
   This game reads them and unlocks things. It also sets flags of its own
   (rft_sold_100, rft_sold_1000) that the scanner can look for. */
const FLAG_KEY='rp_flags';
function getFlags(){try{return JSON.parse(localStorage.getItem(FLAG_KEY))||{};}catch(e){return{};}}
function hasFlag(name){return !!getFlags()[name];}
function setFlag(name){
  try{
    const f=getFlags();
    if(!f[name]){f[name]=Date.now();localStorage.setItem(FLAG_KEY,JSON.stringify(f));}
  }catch(e){}
}
// EXAMPLE rewards. Rename the flags or add more to match your scanner codes.
const FLAG_REWARDS={
  rft_bonus:{cash:2500,msg:'Backstage signal accepted: +2,500 ◆ transferred.'},
  rft_backstage_market:{module:true,msg:'Backstage Market unlocked. Check Upload & Sell.'},
  rft_honeypot:{module:true,msg:'Honeypot unlocked. Check Utilities.'}
};
let seenFlags={};
function applyFlags(){
  const flags=getFlags();
  let changed=false;
  Object.keys(FLAG_REWARDS).forEach(name=>{
    if(!flags[name])return;
    const r=FLAG_REWARDS[name];
    if(r.cash&&!CLAIMED[name]){G.money+=r.cash;CLAIMED[name]=true;log(r.msg,'ok');changed=true;}
    if(r.module&&!seenFlags[name]){
      seenFlags[name]=true;changed=true;
      if(!CLAIMED[name]){CLAIMED[name]=true;log(r.msg,'ok');}
    }
  });
  if(changed){renderSidebar();updateStats();saveGame();}
}
window.addEventListener('storage',e=>{if(e.key===FLAG_KEY)applyFlags();});
window.addEventListener('focus',applyFlags);

/* ── TERMINAL ──
   Codes live in terminal.json (next to this page). An entry has either a plain
   "code" or a "sha256" of the code (UPPERCASE, trimmed). Normalisation matches
   the frequency scanner: trim + uppercase. Rewards: cash, flag/flags. */
const TERMINAL_URL='terminal.json';
const TERM={codes:null,loading:null,greeted:false};

function termEls(){
  return{modal:document.getElementById('term-modal'),out:document.getElementById('term-out'),
         form:document.getElementById('term-form'),input:document.getElementById('term-input')};
}
function termPrint(text,cls){
  const{out}=termEls();
  const d=document.createElement('div');
  d.className='tl'+(cls?' '+cls:'');
  d.textContent=text;
  out.appendChild(d);
  out.scrollTop=out.scrollHeight;
}
function openTerminal(){
  const{modal,input}=termEls();
  modal.classList.add('open');
  if(!TERM.greeted){
    TERM.greeted=true;
    termPrint('RENDER TERMINAL // ONLINE','ok');
    termPrint('Enter a code to redeem it. Type HELP for commands.','dim');
  }
  setTimeout(()=>input.focus(),30);
}
function closeTerminal(){termEls().modal.classList.remove('open');}

function termLoad(){
  if(!TERM.loading){
    TERM.loading=fetch(TERMINAL_URL,{cache:'no-store'})
      .then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.json();})
      .then(d=>{
        if(!d||!Array.isArray(d.codes))throw new Error('bad format');
        TERM.codes=d.codes;return d.codes;
      })
      .catch(e=>{TERM.loading=null;throw e;});
  }
  return TERM.loading;
}
function termNorm(s){return String(s).trim().toUpperCase();}
async function sha256Hex(s){
  const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

function termRedeem(entry){
  const key='t:'+(entry.id||entry.sha256||termNorm(entry.code));
  if(entry.once!==false&&CLAIMED[key]){termPrint('Already redeemed.','warn');return;}
  const got=[];
  const cash=Number(entry.cash);
  if(isFinite(cash)&&cash!==0){
    G.money=Math.max(0,G.money+cash);   // a negative amount takes Polygons away (never below 0)
    got.push((cash>0?'+':'-')+Math.abs(Math.round(cash)).toLocaleString()+' ◆');
  }
  const flags=[].concat(entry.flags||[],entry.flag?[entry.flag]:[]).filter(f=>typeof f==='string'&&f);
  flags.forEach(setFlag);
  CLAIMED[key]=true;
  termPrint(entry.message||'Code accepted.','ok');
  if(got.length)termPrint(got.join('  '),'ok');
  updateStats();
  applyFlags();   // unlocks anything tied to the flags just set
  saveGame();
}

async function termSubmit(raw){
  const code=termNorm(raw);
  if(!code)return;
  termPrint('> '+code,'cmd');
  if(code==='HELP'){
    termPrint('Enter a code to redeem it. Codes are not case-sensitive.');
    termPrint('Commands: HELP, CLEAR, EXIT','dim');return;
  }
  if(code==='CLEAR'){termEls().out.innerHTML='';return;}
  if(code==='EXIT'){closeTerminal();return;}
  let list;
  try{list=await termLoad();}
  catch(e){termPrint('Terminal offline. Could not load terminal.json.','err');return;}
  let hash=null;
  for(const entry of list){
    if(!entry)continue;
    if(entry.code&&termNorm(entry.code)===code){termRedeem(entry);return;}
    if(entry.sha256){
      if(!(window.crypto&&crypto.subtle)){continue;}
      if(hash===null)hash=await sha256Hex(code);
      if(hash===String(entry.sha256).toLowerCase()){termRedeem(entry);return;}
    }
  }
  termPrint('UNKNOWN CODE','err');
}
(function(){
  const{form,input}=termEls();
  form.addEventListener('submit',e=>{
    e.preventDefault();
    const v=input.value;input.value='';
    termSubmit(v);
  });
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&termEls().modal.classList.contains('open'))closeTerminal();
  });
  termEls().modal.addEventListener('mousedown',e=>{if(e.target===termEls().modal)closeTerminal();});
})();

/* ── SAVE SYSTEM ── */
const SAVE_KEY='rft_save_v1';
let noSave=false;
function saveGame(manual){
  if(noSave)return;
  try{
    const data={
      v:1,money:G.money,totalEarned:G.totalEarned,soldCount:G.soldCount,nextId:G.nextId,
      HW:Object.assign({},HW),claimed:CLAIMED,
      nodes:Object.values(G.nodes).map(n=>({id:n.id,defId:n.defId,x:n.x,y:n.y,upgLevels:n.upgLevels||{},seeds:n.seeds||undefined,trapped:n._trapped||undefined})),
      wires:G.wires.map(w=>({fromNode:w.fromNode,fromPort:w.fromPort,toNode:w.toNode,toPort:w.toPort})),
      vp:{x:vp.x,y:vp.y,zoom:vp.zoom}
    };
    localStorage.setItem(SAVE_KEY,JSON.stringify(data));
    if(manual===true)log('Game saved.','ok');
  }catch(e){if(manual===true)log('Could not save (browser storage is blocked).','err');}
}
function loadGame(){
  let d;
  try{d=JSON.parse(localStorage.getItem(SAVE_KEY));}catch(e){d=null;}
  if(!d||d.v!==1)return false;
  try{
    G.money=+d.money||0;G.totalEarned=+d.totalEarned||0;G.soldCount=+d.soldCount||0;G.nextId=+d.nextId||1;
    CLAIMED=d.claimed||{};
    Object.keys(HW).forEach(k=>{
      const i=d.HW&&d.HW[k];
      if(Number.isInteger(i)&&i>=0&&i<HW_SLOTS[k].tiers.length)HW[k]=i;
    });
    (d.nodes||[]).forEach(s=>{
      if(!MODULE_DEFS.find(m=>m.id===s.defId))return;
      G.nodes[s.id]={id:s.id,defId:s.defId,x:s.x,y:s.y,progress:0,queue:[],state:'idle',
        upgLevels:s.upgLevels||{},_sellTimer:0,_slots:[],_bwOut:0,seeds:Array.isArray(s.seeds)?s.seeds.slice(0,500):undefined,_trapped:s.trapped};
    });
    G.wires=(d.wires||[]).filter(w=>G.nodes[w.fromNode]&&G.nodes[w.toNode]).map(w=>({
      fromNode:w.fromNode,fromPort:w.fromPort,toNode:w.toNode,toPort:w.toPort,_active:false}));
    Object.keys(G.nodes).forEach(renderNode);
    renderAllWires();
    if(d.vp&&isFinite(d.vp.zoom)){vp={x:+d.vp.x||0,y:+d.vp.y||0,zoom:d.vp.zoom};applyViewport();}
    return true;
  }catch(e){console.error('[RFT] Save could not be loaded:',e);return false;}
}
function resetSave(){
  if(!confirm('Delete your saved progress and start over?'))return;
  noSave=true;
  try{localStorage.removeItem(SAVE_KEY);}catch(e){}
  location.reload();
}
setInterval(saveGame,10000);
window.addEventListener('beforeunload',()=>saveGame());
document.addEventListener('visibilitychange',()=>{if(document.hidden)saveGame();});

/* ── INIT ── */
initCanvas();renderSidebar();
const restored=loadGame();
renderMarket();loadMarket();
updateStats();
if(restored){
  log('Save restored. Welcome back to Render\'s File Tycoon.','info');
}else{
  log('Welcome to Render\'s File Tycoon!','info');
  log('💡 Start: WiFi Modem → Doc Downloader → Network Binder → Uploader → Basic Market','info');
}
log('📈 Each file type sells to one Rend-Conomy company. Check Market demand in the sidebar.','info');
log('🖥️ Open Hardware Upgrades to boost CPU, RAM, Storage & NIC — they affect real bottlenecks!');
log('📏 Speeds are real: time = size ÷ MB/s, and a link, a downloader and an uploader share their speed between everything using it.');
log('⚠ Limits are hard: no CPU headroom, a full next node, no free RAM/disk, or overheating makes a node wait (amber) until it clears.');
applyFlags();
requestAnimationFrame(gameTick);

document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&connectStart){
    if(connectStart.detached)G.wires.push({...connectStart.detached,_active:false});
    finishConnectUI();
  }
});