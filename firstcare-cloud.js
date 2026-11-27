const firstcareUrl='https://wkckxwxuqavtrsphnqld.supabase.co';
const firstcarePublicKey='sb_publishable_0tnQBm13VPQDAaJZisTkmQ_9cbWhKnP';
const bucketName='firstcare-videos';
async function publishedVideos(){
 const r=await fetch(firstcareUrl+'/rest/v1/rpc/firstcare_catalog',{method:'POST',headers:{apikey:firstcarePublicKey,'Content-Type':'application/json'},body:'{}'});
 if(!r.ok)throw Error('تعذر تحميل قائمة الفيديوهات.');
 const rows=await r.json();
 return rows.map(v=>({...v,type:'mp4',url:firstcareUrl+'/storage/v1/object/public/'+bucketName+'/'+encodeURIComponent(v.path)}));
}
