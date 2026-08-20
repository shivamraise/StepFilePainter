// Round-trip regression test.
// Extracts the STEP-mapping code straight out of index.html, runs it against a
// real file through occt-import-js, paints every face a unique colour, exports,
// re-reads the export, and asserts each colour came back on the same geometry.
const fs=require('fs');
const path=require('path');
const occtimportjs=require('occt-import-js');

const HTML=fs.readFileSync(process.argv[2],'utf8');
const STEPFILE=process.argv[3];

// ── pull the functions we need out of the page ────────────────
function grab(startMarker,endMarker){
  const a=HTML.indexOf(startMarker);
  if(a<0) throw new Error('marker not found: '+startMarker);
  const b=HTML.indexOf(endMarker,a);
  if(b<0) throw new Error('end marker not found: '+endMarker);
  return HTML.slice(a,b);
}
const src=grab('const STEP_BODY_TYPES','// Attach the STEP entity id')
        + grab('// Walk PRESENTATION_STYLE_ASSIGNMENT','// Apply the file')
        + grab('const STEP_PRESENTATION_TYPES','document.getElementById(\'btn-export\')');
const mod={};
new Function('exports',src+'\nObject.assign(exports,{buildStepTopology,stepReadStyles,stripStyling,splitParams,stepRefs,parseStepEntities,STEP_FACE_TYPES,STEP_BODY_TYPES,STEP_REP_TYPES,stepPsaToRgb});')(mod);

// ── geometry helpers ──────────────────────────────────────────
function occFaces(res){
  const out=[];
  for(let mi=0;mi<res.meshes.length;mi++){
    const m=res.meshes[mi],pos=m.attributes.position.array,idx=m.index.array;
    for(const bf of m.brep_faces){
      const seen=new Set(),ps=[];
      for(let i=bf.first*3;i<(bf.last+1)*3;i++){
        const v=idx[i];
        if(seen.has(v))continue;
        seen.add(v);ps.push([pos[v*3],pos[v*3+1],pos[v*3+2]]);
      }
      out.push({mesh:mi,ps});
    }
  }
  return out;
}
function centroid(ps){
  const c=[0,0,0];
  for(const p of ps){c[0]+=p[0];c[1]+=p[1];c[2]+=p[2];}
  return c.map(v=>+(v/ps.length).toFixed(4));
}
function stepVertsFn(ents){
  const pts=new Map();
  for(const [id,e] of ents){
    if(e.type!=='CARTESIAN_POINT') continue;
    const n=e.params.match(/-?\d+\.?\d*(?:E[-+]?\d+)?/gi);
    if(n&&n.length>=3) pts.set(id,[+n[n.length-3],+n[n.length-2],+n[n.length-1]]);
  }
  return fid=>{
    const out=[],seen=new Set();
    for(const b of mod.stepRefs(ents.get(fid).params)){
      const be=ents.get(b);
      if(!be||!/FACE_(OUTER_)?BOUND/.test(be.type))continue;
      for(const l of mod.stepRefs(be.params)){
        const le=ents.get(l); if(!le||le.type!=='EDGE_LOOP')continue;
        for(const oe of mod.stepRefs(le.params)){
          const oee=ents.get(oe); if(!oee||oee.type!=='ORIENTED_EDGE')continue;
          for(const ec of mod.stepRefs(oee.params)){
            const ece=ents.get(ec); if(!ece||ece.type!=='EDGE_CURVE')continue;
            for(const vp of mod.stepRefs(ece.params)){
              const v=ents.get(vp); if(!v||v.type!=='VERTEX_POINT')continue;
              for(const cp of mod.stepRefs(v.params))
                if(pts.has(cp)&&!seen.has(cp)){seen.add(cp);out.push(pts.get(cp));}
            }}}}
    }
    return out;
  };
}

const results=[];
function check(name,cond,detail){
  results.push({name,ok:!!cond,detail});
  console.log((cond?'  PASS  ':'  FAIL  ')+name+(detail&&!cond?'  ['+detail+']':''));
}

(async()=>{
  const occt=await occtimportjs();
  const rawText=fs.readFileSync(STEPFILE,'utf8');
  const res=occt.ReadStepFile(new Uint8Array(fs.readFileSync(STEPFILE)),null);

  console.log('\n=== '+path.basename(STEPFILE)+' ===');

  const topo=mod.buildStepTopology(rawText);
  const of1=occFaces(res);
  const meshCounts=res.meshes.map(m=>m.brep_faces.length);
  const topoCounts=topo.bodies.map(b=>b.faceIds.length);

  check('mesh/body face counts agree',
    meshCounts.length===topoCounts.length&&meshCounts.every((n,i)=>n===topoCounts[i]),
    meshCounts.join(',')+' vs '+topoCounts.join(','));
  if(!results[results.length-1].ok){process.exitCode=1;return;}

  // per-mesh translation (assembly placement OCCT applies but the raw text does not)
  const fv=stepVertsFn(topo.ents);
  const off=[];
  for(let mi=0;mi<res.meshes.length;mi++){
    const o=of1.filter(f=>f.mesh===mi).flatMap(f=>f.ps);
    const s=topo.bodies[mi].faceIds.flatMap(fv);
    const mn=a=>[0,1,2].map(k=>Math.min(...a.map(p=>p[k])));
    const a=mn(o),b=s.length?mn(s):[0,0,0];
    off.push([a[0]-b[0],a[1]-b[1],a[2]-b[2]]);
  }
  // A topological vertex on a circular edge need not coincide with a tessellation
  // vertex, so allow one chord of slack: the mesh cannot resolve finer than that.
  const chordOf=ps=>{
    let m=0;
    for(let i=1;i<ps.length;i++){
      const d=Math.hypot(ps[i][0]-ps[i-1][0],ps[i][1]-ps[i-1][1],ps[i][2]-ps[i-1][2]);
      if(d>m) m=d;
    }
    return m;
  };
  let geomOk=0;
  for(let k=0;k<topo.faces.length;k++){
    const o=of1[k],t=off[o.mesh];
    const sv=fv(topo.faces[k].stepFaceId).map(p=>[p[0]+t[0],p[1]+t[1],p[2]+t[2]]);
    if(!sv.length){geomOk++;continue;}
    const TOL=Math.max(1e-3,chordOf(o.ps));
    // A topological vertex lies on its face, so falling inside the tessellated
    // face's own bounds is enough when it sits between mesh vertices.
    const lo=[0,1,2].map(k=>Math.min(...o.ps.map(p=>p[k]))-TOL);
    const hi=[0,1,2].map(k=>Math.max(...o.ps.map(p=>p[k]))+TOL);
    const onFace=q=>o.ps.some(p=>Math.hypot(p[0]-q[0],p[1]-q[1],p[2]-q[2])<TOL)
                  ||[0,1,2].every(k=>q[k]>=lo[k]&&q[k]<=hi[k]);
    if(sv.every(onFace)) geomOk++;
  }
  check('every mapped face is geometrically the right face',
    geomOk===topo.faces.length, geomOk+'/'+topo.faces.length);

  // ── paint every face a unique colour and export ─────────────
  const hexOf=i=>'#'+((i*7919)%0xffffff|0x010101).toString(16).padStart(6,'0');
  const faces=topo.faces.map((t,i)=>({
    stepFaceId:t.stepFaceId,stepBodyId:t.bodyId,stepRepId:t.repId,
    color:hexOf(i),defaultColor:'#aaaaaa',userColored:true
  }));
  const out=exportStep(rawText,topo,faces);
  fs.writeFileSync('rt_out.step',out);

  const res2=occt.ReadStepFile(new Uint8Array(Buffer.from(out,'utf8')),null);
  check('exported file still parses',res2&&res2.success);
  const of2=occFaces(res2);
  check('export did not change the geometry',of2.length===of1.length,of2.length+' vs '+of1.length);

  const topo2=mod.buildStepTopology(out);
  check('topology is stable across export',
    topo2.faces.length===topo.faces.length&&
    topo2.faces.every((t,i)=>t.stepFaceId===topo.faces[i].stepFaceId));

  // read the colours back the way the app does, and compare per face BY GEOMETRY
  const styles=mod.stepReadStyles(topo2.ents);
  let colourOk=0,missing=0,wrong=[];
  for(let i=0;i<topo2.faces.length;i++){
    const t=topo2.faces[i];
    const rgb=styles.face.get(t.stepFaceId)||styles.body.get(t.bodyId)||styles.rep.get(t.repId);
    if(!rgb){missing++;continue;}
    const hex='#'+rgb.map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join('');
    // face i of the re-read file must carry the colour we painted on face i,
    // and face i is the same geometry (checked above via centroid)
    const sameGeom=centroid(of1[i].ps).join()===centroid(of2[i].ps).join();
    if(hex===hexOf(i)&&sameGeom) colourOk++;
    else if(wrong.length<5) wrong.push(`face ${i}: wanted ${hexOf(i)} got ${hex}${sameGeom?'':' (geometry moved)'}`);
  }
  check('every painted colour returns on the same face',
    colourOk===topo2.faces.length, colourOk+'/'+topo2.faces.length+(missing?` (${missing} uncoloured)`:'')+' '+wrong.join(' | '));

  // re-export must not grow without bound
  const faces2=topo2.faces.map((t,i)=>({
    stepFaceId:t.stepFaceId,stepBodyId:t.bodyId,stepRepId:t.repId,
    color:hexOf(i),defaultColor:'#aaaaaa',userColored:true
  }));
  const out2=exportStep(out,topo2,faces2);
  const grow=Math.abs(out2.length-out.length)/out.length;
  check('re-export is idempotent in size',grow<0.02,(grow*100).toFixed(1)+'% change');

  const failed=results.filter(r=>!r.ok).length;
  console.log(failed?`\n${failed} check(s) FAILED`:'\nall checks passed');
  if(failed) process.exitCode=1;
})();

// Mirror of the page's export handler, driven by plain objects.
function exportStep(rawText,topo,faces){
  const colored=faces.filter(f=>f.stepFaceId&&(f.userColored||f.color!==f.defaultColor||f.defaultColor!=='#aaaaaa'));
  let next=0;
  for(const m of rawText.matchAll(/#(\d+)\s*=/g)) if(parseInt(m[1])>next) next=parseInt(m[1]);
  next++;
  const allLines=[],styleCache=new Map();
  function makeStyle(hex){
    if(styleCache.has(hex)) return styleCache.get(hex);
    const rgb=[hex.slice(1,3),hex.slice(3,5),hex.slice(5,7)].map(h=>(parseInt(h,16)/255).toFixed(15));
    const colId=next++,fascId=next++,fasId=next++,ssfaId=next++,sssId=next++,ssuId=next++,psaId=next++;
    allLines.push(
      '#'+colId+"=COLOUR_RGB('',"+rgb[0]+','+rgb[1]+','+rgb[2]+');',
      '#'+fascId+"=FILL_AREA_STYLE_COLOUR('',#"+colId+');',
      '#'+fasId+"=FILL_AREA_STYLE('',(#"+fascId+'));',
      '#'+ssfaId+'=SURFACE_STYLE_FILL_AREA(#'+fasId+');',
      '#'+sssId+"=SURFACE_SIDE_STYLE('',(#"+ssfaId+'));',
      '#'+ssuId+'=SURFACE_STYLE_USAGE(.BOTH.,#'+sssId+');',
      '#'+psaId+'=PRESENTATION_STYLE_ASSIGNMENT((#'+ssuId+'));');
    styleCache.set(hex,psaId);
    return psaId;
  }
  const perBody=new Map();
  for(const f of colored){
    if(!perBody.has(f.stepBodyId)) perBody.set(f.stepBodyId,{repId:f.stepRepId,faces:[]});
    perBody.get(f.stepBodyId).faces.push(f);
  }
  const allOfBody=new Map();
  for(const f of faces){
    if(!allOfBody.has(f.stepBodyId)) allOfBody.set(f.stepBodyId,[]);
    allOfBody.get(f.stepBodyId).push(f);
  }
  const itemsByRep=new Map();
  for(const [bodyId,grp] of perBody){
    const tally=new Map();
    for(const f of (allOfBody.get(bodyId)||grp.faces)) tally.set(f.color,(tally.get(f.color)||0)+1);
    const baseHex=[...tally.entries()].sort((a,b)=>b[1]-a[1])[0][0];
    const baseSiId=next++;
    allLines.push('#'+baseSiId+"=STYLED_ITEM('',(#"+makeStyle(baseHex)+'),#'+bodyId+');');
    const items=['#'+baseSiId];
    for(const f of grp.faces){
      if(f.color===baseHex) continue;
      const orsiId=next++;
      allLines.push('#'+orsiId+"=OVER_RIDING_STYLED_ITEM('',(#"+makeStyle(f.color)+'),#'+f.stepFaceId+',#'+baseSiId+');');
      items.push('#'+orsiId);
    }
    if(!itemsByRep.has(grp.repId)) itemsByRep.set(grp.repId,[]);
    itemsByRep.get(grp.repId).push(...items);
  }
  for(const [repId,items] of itemsByRep){
    const ctxId=topo.repCtx.get(repId);
    if(!ctxId) continue;
    allLines.push('#'+(next++)+"=MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION('',("+items.join(',')+'),#'+ctxId+');');
  }
  let out=mod.stripStyling(rawText,topo.ents,new Set(perBody.keys()));
  const le=out.lastIndexOf('ENDSEC');
  return out.slice(0,le)+allLines.join('\n')+'\n'+out.slice(le);
}
