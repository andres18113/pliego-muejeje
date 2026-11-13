"""Empty disposable local PG18 only: preserve V092 acceptance receipts through V093."""
import json
import os
from billing_identity_upgrade_gate import start
from checkout_last_unit import query


def main():
    assert os.environ['PGHOST'] in ('127.0.0.1', 'localhost'), 'Disposable localhost database required'
    start(92)
    actor = query("INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado) VALUES('delivery-upgrade@example.invalid','fixture','ADMIN','ACTIVE') RETURNING usuario_id").splitlines()[0]
    query(f"INSERT INTO pliego.correo_outbox(evento_clave,tipo,usuario_id,destinatario,datos,estado,id_mensaje_proveedor) VALUES('delivery-upgrade','ORDER_CONFIRMED',{actor},'delivery-upgrade@example.invalid','{{}}','SENT','legacy-receipt')")
    old = json.loads(query("SELECT to_jsonb(o) FROM pliego.correo_outbox o WHERE evento_clave='delivery-upgrade'"))
    start(93)
    after = json.loads(query("SELECT to_jsonb(o)-ARRAY['entrega_estado','entrega_evento_en','entrega_evento_id','entrega_prioridad','destinatario_capturado_en'] FROM pliego.correo_outbox o WHERE evento_clave='delivery-upgrade'"))
    assert old == after, 'Migration changed historical recipient, state, payload or receipt'
    query("SELECT pliego.fn_mail_event_record('legacy-bounce','legacy-receipt','BOUNCED','HARD_BOUNCE',clock_timestamp(),'MAILTRAP')")
    assert query('SELECT pliego.fn_mail_event_project_next()') == 't'
    assert query("SELECT entrega_estado FROM pliego.correo_outbox WHERE evento_clave='delivery-upgrade'") == 'BOUNCED'
    assert query(f'SELECT email_entrega_motivo FROM pliego.usuario WHERE usuario_id={actor}') == 'HARD_BOUNCE'
    print('Mail deliverability upgrade passed: V092->V093, unchanged historical acceptance/recipient/payload, legacy receipt correlation.')


if __name__ == '__main__':
    main()
