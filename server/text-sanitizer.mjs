export function cleanText(value,max=256){
 const requested=Number(max);
 const limit=Number.isFinite(requested)?Math.max(0,Math.min(4000,Math.trunc(requested))):256;
 return String(value??'')
  .replace(/[\u0000-\u001f\u007f]/g,' ')
  .replace(/\s+/g,' ')
  .trim()
  .slice(0,limit);
}
