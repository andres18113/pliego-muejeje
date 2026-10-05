import json,pathlib,sys
BASE=pathlib.Path(__file__).resolve().parent
r=json.load(open(BASE.parent/'audiobook-input.json'))['records'];p=BASE.parent/'audiobook-proposals.json'
d=json.load(open(p)) if p.exists() else {'records':[]}
out={x['sku']:x for x in d['records']}
start=int(sys.argv[1]);texts=sys.stdin.read().strip().split('\n')
for i,text in enumerate(texts,start):
 x=r[i];e=json.load(open(BASE/(x['sku']+'.json')));valid=[s for s in e['sources'] if s.get('http_status')==200 and not s.get('text','').startswith('Ha ocurrido')]
 source=valid[-1] if len(e['sources'])>2 and valid else (valid[0] if valid else {'url':x['source_url']})
 kinds={6:'PUBLISHER_SYNOPSIS_PARAPHRASE',14:'DISTRIBUTOR_SYNOPSIS_PARAPHRASE',19:'PUBLISHER_SYNOPSIS_PARAPHRASE',22:'PUBLISHER_SYNOPSIS_PARAPHRASE',30:'PUBLISHER_SYNOPSIS_PARAPHRASE',40:'PUBLISHER_SYNOPSIS_PARAPHRASE',51:'PUBLISHER_SYNOPSIS_PARAPHRASE',57:'PUBLISHER_SYNOPSIS_PARAPHRASE',70:'PRIMARY_TEXT_PARAPHRASE',72:'PUBLISHER_SYNOPSIS_PARAPHRASE',73:'PUBLISHER_SYNOPSIS_PARAPHRASE',94:'DISTRIBUTOR_SYNOPSIS_PARAPHRASE',103:'DISTRIBUTOR_SYNOPSIS_PARAPHRASE',109:'PUBLISHER_SYNOPSIS_PARAPHRASE'}
 kind=kinds.get(i,'TITLE_SUBJECT_EDITORIAL_DESCRIPTION')
 out[x['sku']]={'sku':x['sku'],'book_id':x['book_id'],'title':x['title'],'synopsis':text,'sources':[{'url':source['url'],'basis':('Paráfrasis original de descripción pública; ' if 'SYNOPSIS' in kind else 'Descripción original conservadora a partir del título y las materias verificadas; ')+f"evidencia: audiobook-research/{x['sku']}.json; SHA-256 de respuesta: "+source.get('response_sha256','PENDIENTE')}],'basis_kind':kind}
d['records']=[out[x['sku']] for x in r if x['sku'] in out];p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n');print('Persistidas',len(d['records']))
