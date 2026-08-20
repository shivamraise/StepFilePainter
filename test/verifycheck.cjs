// Checks the in-app safety net: the planarity cross-check must accept a correct
// mapping and reject a shuffled one.
const fs=require('fs');
const path=require('path');
const occtimportjs=require('occt-import-js');

const HTML=fs.readFileSync(process.argv[2],'utf8');
function grab(a,b){
  const i=HTML.indexOf(a);
  if(i<0) throw new Error('marker: '+a);
  const j=HTML.indexOf(b,i);
  return HTML.slice(i,j);
}
const src=grab('function tessellationArea','// ── STEP topology')
        + grab('const STEP_BODY_TYPES','// Surfaces that can never tessellate flat')
        + grab('const STEP_CURVED_SURFACES','// Cross-check the mapping');
const mod={};
new Function('exports',src+'\nObject.assign(exports,{isPlanarTessellation,tessellationArea,buildStepTopology,stepFaceSurfaceType,stepPoints,stepPlanarFaceArea,STEP_CURVED_SURFACES});')(mod);

function facesOf(res){
  const out=[];
  for(let mi=0;mi<res.meshes.length;mi++){
    const m=res.meshes[mi],pos=m.attributes.position.array,idx=m.index.array;
    for(const bf of m.brep_faces){
      const slice=idx.slice(bf.first*3,(bf.last+1)*3);
      const used=[...new Set(slice)].sort((a,b)=>a-b);
      const remap=new Map(used.map((v,i)=>[v,i]));
      const fp=new Float32Array(used.length*3);
      used.forEach((v,i)=>{fp[i*3]=pos[v*3];fp[i*3+1]=pos[v*3+1];fp[i*3+2]=pos[v*3+2];});
      const fi=slice.map(v=>remap.get(v));
      out.push({meshIndex:mi,planarTess:mod.isPlanarTessellation(fp,fi),tessArea:mod.tessellationArea(fp,fi)});
    }
  }
  return out;
}

// mirror of verifyStepMapping, fed an explicit face->entity assignment
function verify(ents,tess,ids){
  const pts=mod.stepPoints(ents);
  let checked=0,wrong=0;
  for(let i=0;i<tess.length;i++){
    if(tess[i].planarTess===null||tess[i].planarTess===undefined) continue;
    const surf=mod.stepFaceSurfaceType(ents,ids[i]);
    if(!surf) continue;
    if(surf==='PLANE'){
      checked++;
      if(!tess[i].planarTess){wrong++;continue;}
      const area=mod.stepPlanarFaceArea(ents,pts,ids[i]);
      if(area!==null&&area>0&&tess[i].tessArea>0&&
         Math.abs(area-tess[i].tessArea)/Math.max(area,tess[i].tessArea)>0.02) wrong++;
    }
    else if(mod.STEP_CURVED_SURFACES.has(surf)){checked++; if(tess[i].planarTess) wrong++;}
  }
  return {ok:checked===0||wrong<=Math.max(1,checked*0.02),checked,wrong};
}

(async()=>{
  const occt=await occtimportjs();
  let bad=0;
  for(const file of process.argv.slice(3)){
    const text=fs.readFileSync(file,'utf8');
    const res=occt.ReadStepFile(new Uint8Array(fs.readFileSync(file)),null);
    const topo=mod.buildStepTopology(text);
    const tess=facesOf(res);
    const counts=res.meshes.map(m=>m.brep_faces.length);
    const tCounts=topo.bodies.map(b=>b.faceIds.length);
    const countsMatch=counts.length===tCounts.length&&counts.every((n,i)=>n===tCounts[i]);
    console.log('\n=== '+path.basename(file)+' ===');
    console.log('  face counts line up: '+countsMatch+'  ('+tess.length+' tessellated / '+topo.faces.length+' in text)');
    if(!countsMatch){
      console.log('  PASS  mapping refused before it could mislabel anything');
      continue;
    }
    const ids=topo.faces.map(t=>t.stepFaceId);
    const good=verify(topo.ents,tess,ids);
    console.log((good.ok?'  PASS  ':'  FAIL  ')+'correct mapping accepted  ('+good.wrong+'/'+good.checked+' surface mismatches)');
    if(!good.ok) bad++;

    // shuffle within each mesh: the failure mode this whole fix is about
    const shuffled=ids.slice();
    let start=0;
    for(const n of counts){
      const seg=shuffled.slice(start,start+n);
      for(let i=seg.length-1;i>0;i--){const j=(i*7+3)%(i+1);[seg[i],seg[j]]=[seg[j],seg[i]];}
      for(let i=0;i<n;i++) shuffled[start+i]=seg[i];
      start+=n;
    }
    const shuf=verify(topo.ents,tess,shuffled);
    console.log((!shuf.ok?'  PASS  ':'  FAIL  ')+'shuffled mapping rejected  ('+shuf.wrong+'/'+shuf.checked+' surface mismatches)');
    if(shuf.ok) bad++;
  }
  console.log(bad?`\n${bad} check(s) FAILED`:'\nall checks passed');
  process.exitCode=bad?1:0;
})();
