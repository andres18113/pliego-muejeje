import json,pathlib,requests,hashlib,datetime,re,concurrent.futures,importlib.util
BASE=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('retrieve',BASE/'retrieve.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
EXTRA={
'PLG-BK-000074':'https://editorialverbum.es/libro/la-confesion/',
'PLG-BK-000088':'https://www.digitaliapublishing.com/a/160115/manual-de-practica-de-semiologia-clinica',
'PLG-BK-000108':'https://www.planetadelibros.com/libro-piramides-templos-y-estrellas/67478',
'PLG-BK-000111':'https://editorialverbum.es/libro/novelas-amorosas-y-ejemplares/',
'PLG-BK-000130':'https://fce.com.ar/tienda/literatura/novela-negra-con-argentinos/',
'PLG-BK-000147':'https://www.alianzaeditorial.es/libro/bibliotecas-de-autor/las-novelas-de-torquemada-benito-perez-galdos-9788420689586/',
'PLG-BK-000174':'https://alianzaeditorial.es/libro/bibliotecas-de-autor/lady-susan-y-otras-novelas-jane-austen-9788413621302/',
'PLG-BK-000186':'https://www.anayamultimedia.es/libro/manuales-imprescindibles/arduino-practico-edicion-2022-daniel-lozano-equisoain-9788441544987/',
'PLG-BK-000213':'https://www.letrasmexicanas.mx/obra-visor/como-se-hace-una-novela-785438/html/3afaf268-9b02-4b00-b225-221b10a99140_2.html',
'PLG-BK-000227':'https://www.planetadelibros.com/libro-historia-de-la-psicologia/267060',
'PLG-BK-000279':'https://play.google.com/store/books/details/Camille_Bordas_C%C3%B3mo_comportarse_en_la_multitud?id=JG85DwAAQBAJ',
'PLG-BK-000293':'https://www.storytel.com/ar/books/el-retorno-de-los-desplazados-12320520',
'PLG-BK-000294':'https://search.worldcat.org/es/title/1528347086',
'PLG-BK-000307':'https://www.alianzaeditorial.es/libro/ciencias-sociales/psicologia-de-la-musica-daniele-schon-9788491817178/',
}
def fetch(item):
 sku,u=item
 try:
  resp=requests.get(u,timeout=45,headers={'User-Agent':'Mozilla/5.0'});t=m.clean(resp.text)
  patterns={
   'editorialverbum.es':['#','Características del libro'],
  }
  # Capture a bounded excerpt centered on the book's descriptive content, plus page heading.
  if 'alianzaeditorial.es' in u or 'anayamultimedia.es' in u:
   start=t.find('Sinopsis');end=t.find('Ficha técnica',start)
   if end<0:end=t.find('Colección',start)
   if start>=0:t=t[start:end if end>start else start+5000]
  elif 'planetadelibros.com' in u:
   start=t.find('Sinopsis de ');end=t.find('Opciones de compra',start)
   if start>=0:t=t[start:end if end>start else start+4000]
  elif 'editorialverbum.es' in u:
   start=t.find('Características del libro');t=t[start:start+5000] if start>=0 else t[:5000]
  else:t=t[:7000]
  p=BASE/(sku+'.json');d=json.load(open(p));d['sources'].append({'url':u,'http_status':resp.status_code,'retrieved_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'response_sha256':hashlib.sha256(resp.content).hexdigest(),'extraction_sha256':hashlib.sha256(t.encode()).hexdigest(),'text':t});p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n');return sku,resp.status_code,len(t)
 except Exception as e:return sku,str(e)
if __name__=='__main__':
 with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
  for x in ex.map(fetch,EXTRA.items()):print(x,flush=True)
