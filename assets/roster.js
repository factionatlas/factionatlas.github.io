// Roster filter: vanilla JS, no framework. Rows are server-rendered; JS only hides/shows and pages.
(function(){
 var t=document.getElementById('roster');if(!t)return;
 var tb=t.tBodies[0],q=document.getElementById('rf-q'),k=document.getElementById('rf-kind'),s=document.getElementById('rf-status'),
     c=document.getElementById('rf-count'),more=document.getElementById('rf-more'),PAGE=100,limit=PAGE;
 function apply(){var qq=q.value.trim().toLowerCase(),kk=k?k.value:'',ss=s?s.value:'',rows=tb.rows,m=0,shown=0;
  for(var i=0;i<rows.length;i++){var r=rows[i],ok=(!qq||r.dataset.name.indexOf(qq)>-1)&&(!kk||r.dataset.kind===kk)&&(!ss||r.dataset.status===ss);
   if(ok){m++;if(shown<limit){r.hidden=false;shown++;}else r.hidden=true;}else r.hidden=true;}
  c.textContent='Showing '+shown.toLocaleString()+' of '+m.toLocaleString()+(m!==rows.length?' matching ('+rows.length.toLocaleString()+' total)':'');
  more.hidden=shown>=m;}
 [q,k,s].forEach(function(el){if(el)el.addEventListener('input',function(){limit=PAGE;apply();});});
 more.addEventListener('click',function(){limit+=PAGE;apply();});
 apply();
})();
