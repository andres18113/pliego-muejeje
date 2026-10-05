import pathlib,json,re,hashlib,collections,unicodedata
BASE=pathlib.Path(__file__).resolve().parent;p=BASE.parent/'audiobook-proposals.json';d=json.load(open(p));r=json.load(open(BASE.parent/'audiobook-input.json'))['records']
changes={
23:('un marco temporal que el catálogo sitúa entre','el periodo comprendido entre'),
26:('rama especializada de la geometría que el catálogo vincula también con problemas y ejercicios','rama especializada de la geometría, desde una perspectiva vinculada también con problemas y ejercicios'),
78:('El catálogo también la relaciona con','Su ámbito también se relaciona con'),
96:('un problema histórico que el catálogo relaciona con los siglos XIX y XX','un problema histórico relacionado con los siglos XIX y XX'),
98:('El catálogo sitúa parte de ese marco histórico en el siglo XX','El marco histórico remite a las corrientes políticas del siglo XX'),
101:('con un marco que el catálogo sitúa entre 1959 y 1990','con atención al periodo comprendido entre 1959 y 1990'),
}
kinds={6:'PUBLISHER_SYNOPSIS_PARAPHRASE',14:'DISTRIBUTOR_SYNOPSIS_PARAPHRASE',19:'PUBLISHER_SYNOPSIS_PARAPHRASE',22:'PUBLISHER_SYNOPSIS_PARAPHRASE',30:'PUBLISHER_SYNOPSIS_PARAPHRASE',40:'PUBLISHER_SYNOPSIS_PARAPHRASE',51:'PUBLISHER_SYNOPSIS_PARAPHRASE',57:'PUBLISHER_SYNOPSIS_PARAPHRASE',70:'PRIMARY_TEXT_PARAPHRASE',72:'PUBLISHER_SYNOPSIS_PARAPHRASE',73:'PUBLISHER_SYNOPSIS_PARAPHRASE',86:'DISTRIBUTOR_SYNOPSIS_PARAPHRASE',94:'DISTRIBUTOR_SYNOPSIS_PARAPHRASE',103:'DISTRIBUTOR_SYNOPSIS_PARAPHRASE',104:'PUBLISHER_SYNOPSIS_PARAPHRASE',109:'PUBLISHER_SYNOPSIS_PARAPHRASE',111:'INSTITUTIONAL_SYNOPSIS_PARAPHRASE'}
issues=[];title_differences=[]
def normalize(t):return re.sub(r'[^a-z0-9]+',' ',unicodedata.normalize('NFKD',t.lower()).encode('ascii','ignore').decode()).strip()
for i,x in enumerate(d['records']):
 if i in changes:x['synopsis']=x['synopsis'].replace(*changes[i])
 kind=kinds.get(i,'TITLE_SUBJECT_EDITORIAL_DESCRIPTION');x['basis_kind']=kind
 e=json.load(open(BASE/(x['sku']+'.json')));valid=[s for s in e['sources'] if s.get('http_status')==200 and not s.get('text','').startswith('Ha ocurrido')]
 assert valid,(i,x['title'])
 s=valid[-1] if i in kinds and i!=73 else valid[0]
 prefix='Paráfrasis original de la sinopsis editorial pública' if kind=='PUBLISHER_SYNOPSIS_PARAPHRASE' else 'Paráfrasis original de la descripción pública de distribución' if kind=='DISTRIBUTOR_SYNOPSIS_PARAPHRASE' else 'Paráfrasis original de la descripción institucional pública' if kind=='INSTITUTIONAL_SYNOPSIS_PARAPHRASE' else 'Descripción original conservadora a partir del texto primario publicado' if kind=='PRIMARY_TEXT_PARAPHRASE' else 'Descripción original conservadora a partir del título y de las materias bibliográficas verificadas; no es una sinopsis proporcionada por el editor'
 digest=s.get('capture_sha256',s.get('response_sha256'));assert digest
 x['sources']=[{'url':s['url'],'basis':prefix+f". Evidencia: audiobook-research/{x['sku']}.json; SHA-256 de "+('captura web extraída: ' if 'capture_sha256' in s else 'respuesta HTTP: ')+digest}]
 n=len(x['synopsis'].split());sentences=len(re.findall(r'[.!?](?:\s|$)',x['synopsis']))
 if not 45<=n<=90:issues.append({'index':i,'sku':x['sku'],'words':n})
 if not 2<=sentences<=4:issues.append({'index':i,'sku':x['sku'],'sentences':sentences})
 if s.get('observed_page_title') and normalize(x['title']) not in normalize(s['observed_page_title']):title_differences.append({'sku':x['sku'],'catalog_title':x['title'],'source_title':s['observed_page_title']})
 assert (x['sku'],x['book_id'],x['title'])==(r[i]['sku'],r[i]['book_id'],r[i]['title'])
 assert not re.search(r'\b(DEMO|SIMULATED|PENDIENTE|narrador|formato|precio|catálogo)\b',x['synopsis'],re.I)
 assert len(x['synopsis'])<1400
 # Word-sequence overlap. Longest contiguous runs remain short; external text is paraphrased.
 sw=normalize(s.get('text','')).split();tw=normalize(x['synopsis']).split();longest=0
 for a in range(len(tw)):
  for b in range(len(sw)):
   nmatch=0
   while a+nmatch<len(tw) and b+nmatch<len(sw) and tw[a+nmatch]==sw[b+nmatch]:nmatch+=1
   longest=max(longest,nmatch)
 if longest>25:issues.append({'sku':x['sku'],'longest_verbatim_word_sequence':longest})
p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n');assert len(d['records'])==len(r)==114;assert len(set(x['synopsis'] for x in d['records']))==114
summary={'records':114,'unique_synopses':114,'exact_input_set':True,'basis_kinds':dict(collections.Counter(x['basis_kind'] for x in d['records'])),'issues':issues,'title_variants':title_differences,'word_min':min(len(x['synopsis'].split()) for x in d['records']),'word_max':max(len(x['synopsis'].split()) for x in d['records'])}
(BASE/'validation.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n');print(json.dumps(summary,ensure_ascii=False,indent=2))
