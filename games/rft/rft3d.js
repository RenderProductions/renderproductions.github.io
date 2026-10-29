/* Render's File Tycoon — optional 3D board.
   A second renderer over the SAME game data (G.nodes / G.wires): nothing in the
   simulation knows this file exists. The 2D DOM keeps running hidden underneath, and
   this file reads node text/progress from it, so what you see is always what the sim says.

   World mapping: 2D (x, y) px  ->  3D (x / S, 0, y / S).
   Controls: left-drag empty board = orbit · right/middle-drag = pan · wheel = zoom
             drag a block = move it (Shift snaps) · drag from a port = wire
             double-click a block = upgrades · hover + U / D still work */
(function(){
'use strict';
const S=40;                 // px per 3D unit
const BLOCK_H=0.9;          // block height
const PORT_Y=0.45;
const LS_KEY='rft_view3d';

let THREEready=false, on=false, raf=0;
let host, renderer, scene, camera, ray, ground, raycaster, mouse;
let nodeMeshes={};          // id -> {group, block, top, tex, canvas, ports:[], sig, w, h}
let wireMeshes=[];          // [{key, mesh, curve, pulses}]
let pickables=[];
let temp=null;              // temp wire line while connecting
let hoverId=null, mode=null, dragOff=null, hoverPort=null;
let lastSync=0;
const cam={target:null, theta:0.0, phi:0.75, dist:30};
const pulseGeo=()=>pulseGeo.g||(pulseGeo.g=new THREE.BoxGeometry(0.22,0.22,0.22));
let pulses=[];              // {curve, t, mesh}

/* ---------- loading ---------- */
function loadScript(src){
  return new Promise((res,rej)=>{
    const s=document.createElement('script');
    s.src=src;s.onload=res;s.onerror=()=>rej(new Error('could not load '+src));
    document.head.appendChild(s);
  });
}
async function ensureThree(){
  if(window.THREE){THREEready=true;return;}
  await loadScript('vendor/three.min.js');
  THREEready=!!window.THREE;
}
function webglOK(){
  try{const c=document.createElement('canvas');return !!(c.getContext('webgl2')||c.getContext('webgl'));}catch(e){return false;}
}

/* ---------- helpers ---------- */
const colorOf=id=>{const n=G.nodes[id];const d=n&&MODULE_DEFS.find(m=>m.id===n.defId);return d?d.color:'#4f78b4';};
const portColor=t=>({file:0x4f9eff,bandwidth:0x3dd68c,upload:0xffb340,upload_queue:0xffb340,sold:0xff6b9a}[t]||0x9fb0cc);
function nodeSize(id){
  const el=document.getElementById('node_'+id);
  return el?{w:el.offsetWidth||158,h:el.offsetHeight||110}:{w:158,h:110};
}
function ports3(id,type){
  const n=G.nodes[id];if(!n)return[];
  const def=MODULE_DEFS.find(d=>d.id===n.defId);
  return type==='in'?getEffectiveInputs(n,def):getEffectiveOutputs(n,def);
}
function portPos(id,type,idx){
  const n=G.nodes[id],m=nodeMeshes[id];
  const w=m?m.w:158,h=m?m.h:110;
  const count=ports3(id,type).length;
  const sp=h/(count+1);
  const px=type==='in'?n.x:n.x+w, pz=n.y+sp*(idx+1);
  return new THREE.Vector3(px/S,PORT_Y,pz/S);
}
function wireCurve(a,b){
  const cx=(a.x+b.x)/2;
  return new THREE.CubicBezierCurve3(a.clone(),new THREE.Vector3(cx,PORT_Y,a.z),new THREE.Vector3(cx,PORT_Y,b.z),b.clone());
}

/* ---------- scene ---------- */
function build(){
  host=document.createElement('div');
  host.id='view3d';
  document.getElementById('canvas-wrap').appendChild(host);
  renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
  renderer.setClearColor(0x070b12,1);
  host.appendChild(renderer.domElement);
  scene=new THREE.Scene();
  scene.fog=new THREE.Fog(0x070b12,60,170);
  camera=new THREE.PerspectiveCamera(45,1,0.1,400);
  scene.add(new THREE.AmbientLight(0x8aa0c8,0.75));
  const sun=new THREE.DirectionalLight(0xffffff,0.9);sun.position.set(14,26,10);scene.add(sun);
  const rim=new THREE.DirectionalLight(0x4f78b4,0.35);rim.position.set(-20,8,-14);scene.add(rim);
  // board: an enormous plane + two grids (fine and coarse), so the board has no edges
  ground=new THREE.Mesh(new THREE.PlaneGeometry(2000,2000),new THREE.MeshBasicMaterial({color:0x090e18}));
  ground.rotation.x=-Math.PI/2;ground.position.y=-0.02;scene.add(ground);
  const g1=new THREE.GridHelper(1100,1100/1.1,0x1a2640,0x121b30);g1.position.y=0;g1.material.transparent=true;g1.material.opacity=0.7;scene.add(g1);
  const g2=new THREE.GridHelper(1100,1100/5.5,0x2a3d66,0x2a3d66);g2.position.y=0.005;g2.material.transparent=true;g2.material.opacity=0.55;scene.add(g2);
  raycaster=new THREE.Raycaster();mouse=new THREE.Vector2();
  ray=new THREE.Plane(new THREE.Vector3(0,1,0),-PORT_Y*0);   // y = 0 ground plane for dragging
  cam.target=new THREE.Vector3(10,0,6);
  new ResizeObserver(resize).observe(host);
  attachInput();
  resize();
}
function resize(){
  if(!renderer)return;
  const w=host.clientWidth||800,h=host.clientHeight||600;
  renderer.setSize(w,h,false);
  renderer.domElement.style.width='100%';renderer.domElement.style.height='100%';
  camera.aspect=w/h;camera.updateProjectionMatrix();
}
function placeCamera(){
  cam.phi=Math.min(1.5,Math.max(0.15,cam.phi));
  cam.dist=Math.min(140,Math.max(5,cam.dist));
  const sp=Math.sin(cam.phi),cp=Math.cos(cam.phi);
  camera.position.set(cam.target.x+cam.dist*sp*Math.sin(cam.theta),cam.target.y+cam.dist*cp,cam.target.z+cam.dist*sp*Math.cos(cam.theta));
  camera.lookAt(cam.target);
}
function fit(){
  const ids=Object.keys(G.nodes);
  if(!ids.length){cam.target.set(10,0,6);cam.dist=30;cam.theta=0;cam.phi=0.95;return;}
  let x0=1e9,x1=-1e9,z0=1e9,z1=-1e9;
  ids.forEach(id=>{const n=G.nodes[id],s=nodeSize(id);x0=Math.min(x0,n.x/S);x1=Math.max(x1,(n.x+s.w)/S);z0=Math.min(z0,n.y/S);z1=Math.max(z1,(n.y+s.h)/S);});
  cam.target.set((x0+x1)/2,0,(z0+z1)/2);
  const asp=(host&&host.clientWidth&&host.clientHeight)?host.clientWidth/host.clientHeight:1.6;
  cam.dist=Math.max(12,Math.max(((x1-x0)/2)/(0.414*asp),((z1-z0)/2)/(0.414*0.8))*1.12+4);
  cam.theta=0;cam.phi=0.75;
}

/* ---------- node blocks ---------- */
function makeNode(id){
  const def=MODULE_DEFS.find(d=>d.id===G.nodes[id].defId);
  const group=new THREE.Group();
  const col=new THREE.Color(def.color);
  const mat=new THREE.MeshStandardMaterial({color:col.clone().multiplyScalar(0.35),roughness:0.55,metalness:0.2,emissive:col.clone().multiplyScalar(0.0)});
  const block=new THREE.Mesh(new THREE.BoxGeometry(1,BLOCK_H,1),mat);
  block.userData={kind:'node',id};
  group.add(block);
  const canvas=document.createElement('canvas');
  const tex=new THREE.CanvasTexture(canvas);tex.anisotropy=4;
  const top=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({map:tex,transparent:true}));
  top.rotation.x=-Math.PI/2;top.position.y=BLOCK_H/2+0.01;top.userData={kind:'node',id};
  group.add(top);
  scene.add(group);
  const rec={group,block,top,tex,canvas,ports:[],sig:'',w:158,h:110,def,mat,glow:0};
  nodeMeshes[id]=rec;
  return rec;
}
function removeNode(id){
  const m=nodeMeshes[id];if(!m)return;
  scene.remove(m.group);
  m.tex.dispose();m.block.geometry.dispose();m.mat.dispose();
  m.ports.forEach(p=>{p.mesh.geometry.dispose();p.mesh.material.dispose();});
  delete nodeMeshes[id];
}
function syncPorts(id,rec){
  const n=G.nodes[id];
  ['in','out'].forEach(type=>{
    const list=ports3(id,type);
    for(let i=0;i<list.length;i++){
      let p=rec.ports.find(x=>x.type===type&&x.idx===i);
      if(!p){
        const mesh=new THREE.Mesh(new THREE.SphereGeometry(0.2,14,10),new THREE.MeshStandardMaterial({color:portColor(list[i]),emissive:portColor(list[i]),emissiveIntensity:0.5}));
        mesh.userData={kind:'port',id,type,idx:i};
        scene.add(mesh);
        p={type,idx:i,mesh};rec.ports.push(p);
      }
      p.mesh.userData.ptype=list[i];
      p.mesh.material.color.setHex(portColor(list[i]));p.mesh.material.emissive.setHex(portColor(list[i]));
      p.mesh.position.copy(portPos(id,type,i));
      const wired=G.wires.some(w=>type==='in'?(w.toNode===id&&w.toPort===i):(w.fromNode===id&&w.fromPort===i));
      p.mesh.scale.setScalar(wired?1.0:0.8);
      p.mesh.material.emissiveIntensity=wired?0.9:0.35;
    }
    // drop ports that no longer exist (binder inputs shrink etc.)
    rec.ports=rec.ports.filter(p=>{
      if(p.type!==type)return true;
      if(p.idx<list.length)return true;
      scene.remove(p.mesh);return false;
    });
  });
}
// Reads the hidden 2D node's text, so labels always match the real numbers
function readLabel(id){
  const el=document.getElementById('node_'+id);
  if(!el)return null;
  const title=(el.querySelector('.node-title')||{}).textContent||'';
  const rows=[];
  const body=el.querySelector('.node-body');
  if(body)[...body.children].forEach(c=>{
    if(c.classList.contains('node-stat'))rows.push({t:'s',text:c.textContent.trim(),cls:c.classList.contains('warn')?'warn':c.classList.contains('hi')?'hi':''});
    else if(c.classList.contains('node-progress')){
      const b=c.querySelector('.node-progress-bar');
      rows.push({t:'p',frac:b?parseFloat(b.style.width)/100||0:0,color:b?b.style.background:'#4f9eff'});
    }
  });
  return{title,rows,state:el.className};
}
function drawLabel(id,rec,lab){
  const w=rec.w,h=rec.h,k=2.4;
  const c=rec.canvas;c.width=Math.max(64,Math.round(w*k));c.height=Math.max(64,Math.round(h*k));
  const g=c.getContext('2d');
  g.clearRect(0,0,c.width,c.height);
  g.fillStyle='#0c1220';g.fillRect(0,0,c.width,c.height);
  g.fillStyle=rec.def.color+'30';g.fillRect(0,0,c.width,30*k);
  g.fillStyle=rec.def.color;g.fillRect(0,0,5*k,c.height);
  g.fillStyle='#e8eefc';g.font=`600 ${14*k}px system-ui,sans-serif`;g.textBaseline='middle';
  g.fillText(lab.title,14*k,15*k);
  let y=44*k;
  lab.rows.forEach(r=>{
    if(y>c.height-6*k)return;
    if(r.t==='s'){
      g.font=`${11*k}px system-ui,sans-serif`;
      g.fillStyle=r.cls==='warn'?'#ffb340':r.cls==='hi'?'#3dd68c':'#9fb0cc';
      g.fillText(r.text,14*k,y,c.width-24*k);y+=16*k;
    } else {
      g.fillStyle='#1b2740';g.fillRect(14*k,y-3*k,c.width-28*k,6*k);
      g.fillStyle=r.color||'#4f9eff';g.fillRect(14*k,y-3*k,(c.width-28*k)*Math.max(0,Math.min(1,r.frac)),6*k);
      y+=14*k;
    }
  });
  rec.tex.needsUpdate=true;
}
function syncNodes(force){
  const ids=Object.keys(G.nodes);
  Object.keys(nodeMeshes).forEach(id=>{if(!G.nodes[id])removeNode(id);});
  ids.forEach(id=>{
    const n=G.nodes[id];
    const rec=nodeMeshes[id]||makeNode(id);
    const s=nodeSize(id);
    if(s.w!==rec.w||s.h!==rec.h){rec.w=s.w;rec.h=s.h;}
    rec.group.position.set((n.x+rec.w/2)/S,BLOCK_H/2,(n.y+rec.h/2)/S);
    rec.block.scale.set(rec.w/S,1,rec.h/S);
    rec.top.scale.set(rec.w/S-0.12,rec.h/S-0.12,1);
    const lab=force?readLabel(id):null;
    if(lab){
      const sig=JSON.stringify(lab.rows)+lab.title+rec.w+rec.h;
      if(sig!==rec.sig){rec.sig=sig;drawLabel(id,rec,lab);}
      rec.state=/active|uploading/.test(lab.state)?1:/error/.test(lab.state)?-1:0;
    }
    syncPorts(id,rec);
  });
  pickables=[];
  Object.values(nodeMeshes).forEach(r=>{pickables.push(r.block);r.ports.forEach(p=>pickables.push(p.mesh));});
}

/* ---------- wires ---------- */
function syncWires(dt,now){
  // rebuild tubes only when a wire's endpoints moved or the wire set changed
  const want=G.wires.filter(w=>G.nodes[w.fromNode]&&G.nodes[w.toNode]);
  const keyOf=w=>{const a=portPos(w.fromNode,'out',w.fromPort),b=portPos(w.toNode,'in',w.toPort);return{a,b,k:a.x.toFixed(2)+','+a.z.toFixed(2)+'>'+b.x.toFixed(2)+','+b.z.toFixed(2)};};
  while(wireMeshes.length>want.length){const m=wireMeshes.pop();scene.remove(m.mesh);m.mesh.geometry.dispose();m.mesh.material.dispose();}
  want.forEach((w,i)=>{
    const {a,b,k}=keyOf(w);
    let m=wireMeshes[i];
    if(!m){m={key:'',mesh:new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshStandardMaterial({color:0x35507f,emissive:0x1a2c4d,roughness:0.5})),curve:null};scene.add(m.mesh);wireMeshes[i]=m;}
    if(m.key!==k){
      m.key=k;m.curve=wireCurve(a,b);
      m.mesh.geometry.dispose();
      m.mesh.geometry=new THREE.TubeGeometry(m.curve,36,0.07,6,false);
    }
    const act=!!w._active;
    m.mesh.material.color.setHex(act?0x3dd68c:0x35507f);
    m.mesh.material.emissive.setHex(act?0x1d8f5a:0x1a2c4d);
    // a file "travels" the wire each time it is pushed
    if(act&&(!w._lastPulse||now-w._lastPulse>260)){
      w._lastPulse=now;
      if(pulses.length<400){
        const pm=new THREE.Mesh(pulseGeo(),new THREE.MeshBasicMaterial({color:0xcffff0}));
        scene.add(pm);pulses.push({curve:m.curve,t:0,mesh:pm});
      }
    }
  });
  for(let i=pulses.length-1;i>=0;i--){
    const p=pulses[i];p.t+=dt/0.75;
    if(p.t>=1){scene.remove(p.mesh);p.mesh.material.dispose();pulses.splice(i,1);continue;}
    p.mesh.position.copy(p.curve.getPoint(p.t));p.mesh.rotation.y+=dt*6;
  }
}

/* ---------- picking & input ---------- */
function setMouse(e){
  const r=renderer.domElement.getBoundingClientRect();
  mouse.set(((e.clientX-r.left)/r.width)*2-1,-((e.clientY-r.top)/r.height)*2+1);
  raycaster.setFromCamera(mouse,camera);
}
function pick(e){
  setMouse(e);
  const hits=raycaster.intersectObjects(pickables,false);
  for(const h of hits){
    if(h.object.userData.kind==='port')return h.object.userData;
  }
  return hits.length?hits[0].object.userData:null;
}
function groundPoint(e,y){
  setMouse(e);
  const pl=new THREE.Plane(new THREE.Vector3(0,1,0),-(y||0));
  const v=new THREE.Vector3();
  return raycaster.ray.intersectPlane(pl,v)?v:null;
}
const fakeEv={preventDefault(){}};
let orbit=null;     // {x,y,theta,phi} | {pan:true,...}
function attachInput(){
  const el=host;
  const stop=e=>e.stopPropagation();
  ['mousedown','wheel','dblclick'].forEach(t=>el.addEventListener(t,e=>{if(t!=='dblclick')stop(e);},{passive:false}));
  el.addEventListener('dragover',e=>{e.preventDefault();});
  el.addEventListener('drop',e=>{
    e.preventDefault();e.stopPropagation();
    const defId=e.dataTransfer.getData('defId');if(!defId)return;
    const p=groundPoint(e,0);if(!p)return;
    spawnNode(defId,p.x*S-79,p.z*S-55);
  });
  el.addEventListener('contextmenu',e=>e.preventDefault());
  el.addEventListener('wheel',e=>{
    e.preventDefault();e.stopPropagation();
    cam.dist*=e.deltaY<0?0.9:1.1;
  },{passive:false});
  el.addEventListener('dblclick',e=>{
    const h=pick(e);
    if(h&&h.kind==='node'&&typeof openUpgrade==='function')openUpgrade(h.id,e);
  });
  el.addEventListener('pointerdown',e=>{
    el.setPointerCapture&&el.setPointerCapture(e.pointerId);
    if(e.button===0){
      const h=pick(e);
      if(h&&h.kind==='port'){
        mode='connect';
        startConnect(fakeEv,h.id,h.type,h.idx);
        if(!connectStart){mode=null;}      // pressed an empty input: nothing to pull off
        return;
      }
      if(h&&h.kind==='node'){
        const g=groundPoint(e,0);const n=G.nodes[h.id];
        if(g&&n){mode='drag';G.draggingNode=h.id;dragOff={x:g.x*S-n.x,z:g.z*S-n.y};return;}
      }
    }
    // empty board: orbit (left) or pan (right / middle)
    orbit={x:e.clientX,y:e.clientY,pan:e.button!==0,theta:cam.theta,phi:cam.phi,tx:cam.target.x,tz:cam.target.z};
  });
  el.addEventListener('pointermove',e=>{
    if(mode==='drag'&&G.draggingNode){
      const n=G.nodes[G.draggingNode];const g=groundPoint(e,0);
      if(n&&g){
        let nx=g.x*S-dragOff.x,ny=g.z*S-dragOff.z;
        if(e.shiftKey){nx=Math.round(nx/CELL)*CELL;ny=Math.round(ny/CELL)*CELL;}
        n.x=Math.round(nx);n.y=Math.round(ny);
        renderNode(G.draggingNode);
      }
      return;
    }
    if(mode==='connect'&&connectStart){
      const a=portPos(connectStart.nodeId,'out',connectStart.idx);
      const g=groundPoint(e,PORT_Y)||a;
      const c=wireCurve(a,new THREE.Vector3(g.x,PORT_Y,g.z));
      if(temp){scene.remove(temp);temp.geometry.dispose();}
      temp=new THREE.Mesh(new THREE.TubeGeometry(c,24,0.05,5,false),new THREE.MeshBasicMaterial({color:0x4f9eff}));
      scene.add(temp);
      return;
    }
    if(orbit){
      const dx=e.clientX-orbit.x,dy=e.clientY-orbit.y;
      if(orbit.pan){
        const k=cam.dist*0.0018;
        const sx=Math.cos(cam.theta),sz=-Math.sin(cam.theta);      // screen-right on the ground
        const fx=-Math.sin(cam.theta),fz=-Math.cos(cam.theta);     // screen-up on the ground
        cam.target.x=orbit.tx-dx*sx*k+dy*fx*k;
        cam.target.z=orbit.tz-dx*sz*k+dy*fz*k;
      } else {
        cam.theta=orbit.theta-dx*0.006;
        cam.phi=orbit.phi-dy*0.006;
      }
      return;
    }
    // hover
    const h=pick(e);
    const id=h&&h.kind!=='port'?h.id:(h&&h.kind==='port'?h.id:null);
    if(id!==hoverId){hoverId=id;hoveredNodeId=id;}
    hoverPort=h&&h.kind==='port'?h:null;
    el.style.cursor=h?(h.kind==='port'?'crosshair':'grab'):'default';
    el.title=hoverPort?(hoverPort.type==='in'?'input: ':'output: ')+(hoverPort.ptype||''):'';
  });
  const up=e=>{
    if(mode==='connect'){
      const h=pick(e);
      if(h&&h.kind==='port'&&h.type==='in')endConnect(h.id,'in',h.idx);
      // anything else: the game's own mouseup handler drops / cuts the wire
      if(temp){scene.remove(temp);temp.geometry.dispose();temp=null;}
    }
    if(mode==='drag')G.draggingNode=null;
    mode=null;orbit=null;
  };
  el.addEventListener('pointerup',up);
  el.addEventListener('pointercancel',up);
}

/* ---------- loop ---------- */
let last=0;
function frame(ts){
  if(!on)return;
  raf=requestAnimationFrame(frame);
  const dt=Math.min(0.1,(ts-last)/1000||0.016);last=ts;
  const force=ts-lastSync>180;
  if(force)lastSync=ts;
  syncNodes(force);
  syncWires(dt,ts);
  // glow: working blocks pulse softly, hovered block brightens
  Object.entries(nodeMeshes).forEach(([id,r])=>{
    const target=(r.state===1?0.28:r.state===-1?0.0:0.06)+(id===hoverId?0.2:0);
    r.glow+=(target-r.glow)*0.15;
    const base=new THREE.Color(r.def.color);
    r.mat.emissive.copy(base).multiplyScalar(r.state===-1?0:r.glow);
    if(r.state===-1)r.mat.emissive.setHex(0x5a1010);
  });
  placeCamera();
  renderer.render(scene,camera);
}

/* ---------- public ---------- */
async function enable(){
  if(on)return true;
  if(!webglOK()){log('3D needs WebGL, which this browser does not provide.','err');return false;}
  try{await ensureThree();}catch(e){log('Could not load the 3D engine ('+e.message+').','err');return false;}
  if(!host){build();fit();}
  on=true;
  document.getElementById('canvas-wrap').classList.add('mode3d');
  document.getElementById('viewport').style.visibility='hidden';
  host.style.display='block';
  resize();syncNodes(true);
  last=performance.now();lastSync=0;
  raf=requestAnimationFrame(frame);
  const b=document.getElementById('btn-3d');if(b){b.classList.add('on');b.textContent='2D view';}
  try{localStorage.setItem(LS_KEY,'1');}catch(e){}
  return true;
}
function disable(){
  if(!on)return;
  on=false;cancelAnimationFrame(raf);
  if(host)host.style.display='none';
  document.getElementById('canvas-wrap').classList.remove('mode3d');
  document.getElementById('viewport').style.visibility='';
  const b=document.getElementById('btn-3d');if(b){b.classList.remove('on');b.textContent='3D view';}
  try{localStorage.setItem(LS_KEY,'0');}catch(e){}
  Object.keys(G.nodes).forEach(renderNode);renderAllWires();
}
function _screen(id,type,idx){
  const v=type?portPos(id,type,idx):nodeMeshes[id].group.position.clone().setY(BLOCK_H);
  const p=v.clone().project(camera);const r=renderer.domElement.getBoundingClientRect();
  return{x:r.left+(p.x+1)/2*r.width,y:r.top+(1-p.y)/2*r.height};
}
window.RFT3D={_screen,enable,disable,toggle:()=>on?disable():enable(),fit:()=>{if(host){fit();}},isOn:()=>on,
  _debug:()=>({nodes:Object.keys(nodeMeshes).length,wires:wireMeshes.length,pulses:pulses.length,cam:{...cam,target:cam.target&&cam.target.toArray()}})};

// Reset view re-frames the board when in 3D
const _reset=window.resetView;
window.resetView=function(){if(on)fit();else _reset&&_reset();};

try{if(localStorage.getItem(LS_KEY)==='1')window.addEventListener('load',()=>setTimeout(enable,300));}catch(e){}
})();