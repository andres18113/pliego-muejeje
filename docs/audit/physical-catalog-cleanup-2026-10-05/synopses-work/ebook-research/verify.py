import json,hashlib,re,collections
from pathlib import Path
b=Path(__file__).resolve().parent.parent
a=json.loads((b/'ebook-input.json').read_text())['records'];d=json.loads((b/'ebook-proposals.json').read_text())['records'];idx=json.loads((b/'ebook-research/captures-index.json').read_text())['records'];by={r['sku']:r for r in idx};failures=[]
if {r['sku'] for r in a}!={r['sku'] for r in d}:failures.append('SKU mismatch')
if len(d)!=len({r['sku'] for r in d}):failures.append('duplicate SKU')
if len(d)!=len({r['synopsis'] for r in d}):failures.append('duplicate synopsis')
original={r['sku']:r for r in a};verified_captures=set()
for r in d:
 if any(r[k]!=original[r['sku']][k] for k in ['book_id','title']):failures.append(r['sku']+' identity mismatch')
 n=len(r['synopsis'].split())
 if not 45<=n<=90:failures.append(r['sku']+' word count '+str(n))
 count=len(re.findall(r'[.!?](?=\s|$)',r['synopsis']))
 if not 2<=count<=4:failures.append(r['sku']+' sentence count '+str(count))
 if re.search(r'(?i)\bDEMO\b|SIMULAD|precio|ebook|e-book|digitalia|ISBN|ficha bibliográfica|editorial_description',r['synopsis']):failures.append(r['sku']+' public annotation')
 for src in r['sources']:
  if not src['url'].startswith('https://') or not src['basis'].strip():failures.append(r['sku']+' invalid source')
  match=[s for s in by[r['sku']]['sources'] if s['url']==src['url'] and 'capture_path' in s]
  if not match:failures.append(r['sku']+' absent source capture '+src['url'])
  for s in match:
   path=Path(s['capture_path']);path=path if path.is_absolute() else Path.cwd()/path
   if not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest()!=s['capture_sha256']:failures.append(r['sku']+' capture hash invalid')
   else:verified_captures.add(str(path))
 if not r['sources']:failures.append(r['sku']+' no source')
report={'records':len(d),'input_records':len(a),'sku_set_exact':{r['sku'] for r in a}=={r['sku'] for r in d},'identity_exact':all(all(r[k]==original[r['sku']][k] for k in ['book_id','title']) for r in d),'unique_synopses':len({r['synopsis'] for r in d}),'word_range':[min(len(r['synopsis'].split()) for r in d),max(len(r['synopsis'].split()) for r in d)],'sentence_range':[min(len(re.findall(r'[.!?](?=\s|$)',r['synopsis'])) for r in d),max(len(re.findall(r'[.!?](?=\s|$)',r['synopsis'])) for r in d)],'verified_capture_files':len(verified_captures),'basis_kinds':dict(collections.Counter(r['basis_kind'] for r in d)),'output_sha256':hashlib.sha256((b/'ebook-proposals.json').read_bytes()).hexdigest(),'failures':failures}
(b/'ebook-research/verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,ensure_ascii=False));assert not failures
