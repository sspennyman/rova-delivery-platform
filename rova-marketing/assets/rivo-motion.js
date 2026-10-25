(()=>{
 const root=document.querySelector('.rivo-site');if(!root)return;
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 if(!reduced.matches){root.classList.add('motion-ready');const observer=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting){e.target.classList.add('is-visible');observer.unobserve(e.target)}},{threshold:.08});root.querySelectorAll('.workflow .intro,.steps article,.product-detail .intro,.workspace-disclosure,.industry-section .intro,.industry-card,.pricing .intro,.plans,.contact,.closing').forEach(el=>{el.dataset.reveal='';observer.observe(el)});}
 reduced.addEventListener('change',()=>{if(reduced.matches){root.classList.remove('motion-ready');root.querySelectorAll('[data-reveal]').forEach(el=>el.classList.add('is-visible'));}});
})();
