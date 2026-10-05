import json,requests,re,hashlib,concurrent.futures,html,datetime,pathlib,subprocess
BASE=pathlib.Path(__file__).resolve().parent
records=json.load(open(BASE.parent/'audiobook-input.json'))['records']
def clean(raw):
 raw=re.sub(r'<(script|style)\b[^>]*>.*?</\1>','',raw,flags=re.S|re.I)
 return re.sub(r'\s+',' ',html.unescape(re.sub('<[^>]*>',' ',raw))).strip()
def fetch(r):
 sources=list(dict.fromkeys(x['source_url'] for x in r['primary_cached_sources']))
 if not sources:sources=['https://catalogo.uns.edu.ar/vufind/Record/elibro.ELB'+r['source_url'].rsplit('/',1)[1]]
 urls=[]
 for u in sources:
  urls.append(u)
  if 'catalogo.uns.edu.ar' in u and not u.endswith('/Details'):urls.append(u+'/Details')
 out=[]
 for u in dict.fromkeys(urls):
  try:
   response=requests.get(u,timeout=45);raw=response.content
   if 'pdf' in response.headers.get('content-type','') or u.endswith('.pdf'):
    temp=pathlib.Path('/tmp')/(r['sku']+'.pdf');temp.write_bytes(raw)
    result=subprocess.run(['pdftotext',str(temp),'-'],capture_output=True,text=True);text=result.stdout[:8000]
   else:
    text=clean(response.text)
    if 'catalogo.uns.edu.ar' in u:
     start=text.find('Guardado en:');end=text.find('Etiquetas:',start)
     metadata=text[start:end] if start>=0 else text[:2000]
     summary=''
     if u.endswith('/Details'):
      tail=text[end:];start2=tail.find('Descripción');last=tail.find('Ejemplares similares',start2+len('Descripción'))
      tail=tail[start2:]
      # Only bounded record descriptive section; no navigation or unrelated titles.
      marker=re.search(r'(Sumario:|Resumen:|Descripción Física:|ISBN:|Nota de bibliografía:)',tail)
      if marker:summary=tail[marker.start():][:8000]
     heading=re.search(r'<h1\b[^>]*>(.*?)</h1>',response.text,re.S|re.I)
     text=('Título: '+clean(heading.group(1))+' ' if heading else '')+metadata+' '+summary
    else:text=text[:14000]
   out.append({'url':u,'http_status':response.status_code,'retrieved_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'response_sha256':hashlib.sha256(raw).hexdigest(),'extraction_sha256':hashlib.sha256(text.encode()).hexdigest(),'text':text})
  except Exception as e:out.append({'url':u,'error':str(e)})
 data={'sku':r['sku'],'title':r['title'],'sources':out};(BASE/(r['sku']+'.json')).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
 return r['sku'],[(s.get('http_status'),len(s.get('text',''))) for s in out]
if __name__=='__main__':
 with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
  for i,x in enumerate(ex.map(fetch,records),1):
   if i%10==0 or i==len(records):print(i,x,flush=True)
