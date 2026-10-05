import json,sys,re
from pathlib import Path
base=Path(__file__).resolve().parent.parent
inputs=json.loads((base/'ebook-input.json').read_text())['records']
idx={r['sku']:r for r in json.loads((base/'ebook-research/captures-index.json').read_text())['records']}
p=base/'ebook-proposals.json'; records=json.loads(p.read_text())['records'] if p.exists() else []
by={r['sku']:r for r in records}
for line in sys.stdin:
 if not line.strip():continue
 i,body=line.rstrip().split('|',1); r=inputs[int(i)]; sources=[]
 for s in idx[r['sku']]['sources']:
  if 'capture_path' not in s:continue
  tp=Path(s.get('text_path',s['capture_path'])); tp=tp if tp.is_absolute() else Path.cwd()/tp
  t=tp.read_text(errors='replace'); start=t.find('Materias:'); end=t.find('Acceso en línea:',start)
  evidence=t[start:end] if start>=0 and end>=0 else t[:1000]
  sources.append({'url':s['url'],'basis':'Título, autor y materias de la ficha bibliográfica verificada. '+re.sub(r'\s+',' ',evidence).strip()})
 by[r['sku']]={'sku':r['sku'],'book_id':r['book_id'],'title':r['title'],'synopsis':body,'sources':sources,'basis_kind':'TITLE_SUBJECT_EDITORIAL_DESCRIPTION'}
p.write_text(json.dumps({'records':[by[r['sku']] for r in inputs if r['sku'] in by]},ensure_ascii=False,indent=2)+'\n')
print('persisted',len(by),'records')
