"""Real PostgreSQL 18 lifecycle regressions; run only against a disposable database."""
import concurrent.futures
import os
import subprocess
import unittest
import uuid

from checkout_last_unit import PSQL, fixture, query, wait_for_activity


class HomeDeliveryLifecycle(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        actors, cls.edition = fixture()
        cls.actor, cls.address = actors[0]
        initial_item = query(f"SELECT ci.carrito_item_id FROM pliego.carrito_item ci JOIN pliego.carrito c USING(carrito_id) JOIN pliego.cliente cl USING(cliente_id) WHERE cl.usuario_id={cls.actor} AND c.estado='ACTIVE'")
        query(f'CALL pliego.sp_cart_remove_item({cls.actor},{initial_item})')
        cls.admin = query("SELECT usuario_id FROM pliego.usuario WHERE rol='ADMIN' AND estado='ACTIVE' LIMIT 1")
        query(f"CALL pliego.sp_inventory_entry({cls.admin},{cls.edition},100,'lifecycle fixture',NULL,NULL,NULL)")

    def order(self, pickup=False):
        query(f"CALL pliego.sp_cart_add_item({self.actor},{self.edition},1,NULL,NULL,NULL)")
        location = query('SELECT pickup_location_id FROM pliego.fn_pickup_locations() LIMIT 1') if pickup else 'NULL'
        address = 'NULL' if pickup else str(self.address)
        mode = 'STORE_PICKUP' if pickup else 'HOME_DELIVERY'
        return query(f"CALL pliego.sp_checkout_idempotent({self.actor},'{uuid.uuid4()}',{address},'CARD','APPROVED',NULL,'{mode}',{location},NULL,NULL,NULL,NULL,NULL)").split('|')[0]

    def age(self, order, seconds):
        # Controlled persisted deadlines; production never accepts a client clock.
        query(f"""UPDATE pliego.envio SET
            fecha_confirmacion=clock_timestamp()-make_interval(secs=>{seconds}),
            transito_desde=clock_timestamp()-make_interval(secs=>{seconds})+INTERVAL '2 minutes',
            reparto_desde=clock_timestamp()-make_interval(secs=>{seconds})+INTERVAL '4 minutes',
            entrega_desde=clock_timestamp()-make_interval(secs=>{seconds})+INTERVAL '6 minutes'
            WHERE pedido_id={order}""")

    def state(self, order):
        return query(f'SELECT estado FROM pliego.envio WHERE pedido_id={order}')

    def status_emails(self, order):
        return query(f"""SELECT string_agg(datos->>'state',',' ORDER BY correo_id)
            FROM pliego.correo_outbox WHERE evento_clave LIKE 'ORDER_STATUS:{order}:HOME_DELIVERY:%'""")

    def detail_state(self, order, admin=False):
        fn = 'fn_admin_order_detail_priced' if admin else 'fn_customer_order_detail_priced'
        actor = self.admin if admin else self.actor
        return query(f"SELECT shipment->>'state' FROM pliego.{fn}({actor},{order})")

    def test_confirmed_home_starts_preparing_with_persisted_deadlines(self):
        order = self.order()
        self.assertEqual('PREPARING', self.state(order))
        self.assertEqual('ORDER_CONFIRMED,ORDER_STATUS', query(f"""SELECT string_agg(tipo,',' ORDER BY correo_id)
            FROM pliego.correo_outbox WHERE usuario_id=(SELECT usuario_id FROM pliego.pedido p
             JOIN pliego.cliente c USING(cliente_id) WHERE p.pedido_id={order})
             AND evento_clave IN ('ORDER_CONFIRMED:{order}','ORDER_STATUS:{order}:HOME_DELIVERY:PREPARING')"""))
        self.assertEqual('PREPARING', self.status_emails(order))
        self.assertEqual('HOME_DELIVERY|PREPARING|I8-CONC-', query(f"""SELECT (datos->>'method')||'|'||(datos->>'state')||'|'||
            left(((datos->'items')->0)->>'sku',8) FROM pliego.correo_outbox
            WHERE evento_clave='ORDER_STATUS:{order}:HOME_DELIVERY:PREPARING'"""))
        self.assertEqual('t', query(f"""SELECT datos->>'customerName'='Cliente Conc'
            AND datos->>'customerEmail'=(SELECT email_normalizado FROM pliego.usuario WHERE usuario_id={self.actor})
            AND datos->>'actionPath'='/orders/{order}' AND ((datos->'items')->0) ? 'originalSubtotal'
            AND ((datos->'items')->0) ? 'lineSavings' AND datos->>'fulfillmentState'='PREPARING'
            FROM pliego.correo_outbox WHERE evento_clave='ORDER_STATUS:{order}:HOME_DELIVERY:PREPARING'"""))
        self.assertEqual('t', query(f"""SELECT fecha_preparacion=fecha_confirmacion
            AND transito_desde=fecha_confirmacion+INTERVAL '2 minutes'
            AND reparto_desde=fecha_confirmacion+INTERVAL '4 minutes'
            AND entrega_desde=fecha_confirmacion+INTERVAL '6 minutes'
            AND fecha_confirmacion=(SELECT min(fecha) FROM pliego.pedido_estado_historial
                WHERE pedido_id={order} AND estado_nuevo='CONFIRMED')
            FROM pliego.envio WHERE pedido_id={order}"""))

    def test_each_exact_transition_boundary(self):
        for seconds, expected in [(0,'PREPARING'), (119.999999,'PREPARING'), (120,'IN_TRANSIT'),
                                  (239.999999,'IN_TRANSIT'), (240,'OUT_FOR_DELIVERY'),
                                  (359.999999,'OUT_FOR_DELIVERY'), (360,'DELIVERED'), (86400,'DELIVERED')]:
            with self.subTest(seconds=seconds):
                self.assertEqual(expected, query(f"""SELECT pliego.fn_home_delivery_state_at(
                    '2030-01-01 00:02:00Z', '2030-01-01 00:04:00Z', '2030-01-01 00:06:00Z',
                    '2030-01-01 00:00:00Z'::timestamptz+make_interval(secs=>{seconds}))"""))

    def test_reconciliation_at_each_stage(self):
        expected_events = {
            'PREPARING': 'PREPARING',
            'IN_TRANSIT': 'PREPARING,IN_TRANSIT',
            'OUT_FOR_DELIVERY': 'PREPARING,IN_TRANSIT,OUT_FOR_DELIVERY',
            'DELIVERED': 'PREPARING,IN_TRANSIT,OUT_FOR_DELIVERY,DELIVERED',
        }
        for seconds, expected in [(119,'PREPARING'), (121,'IN_TRANSIT'), (241,'OUT_FOR_DELIVERY'), (361,'DELIVERED')]:
            with self.subTest(seconds=seconds):
                order = self.order()
                self.age(order, seconds)
                self.assertEqual(expected, self.detail_state(order))
                self.assertEqual(expected_events[expected], self.status_emails(order))
                self.assertEqual('CONFIRMED|APPROVED', query(f"SELECT p.estado,pa.estado FROM pliego.pedido p JOIN pliego.pago pa USING(pedido_id) WHERE p.pedido_id={order}"))

    def test_cancellation_before_leaving_preparing(self):
        order = self.order()
        self.age(order,119)
        self.assertEqual('true', query(f"SELECT available_actions->>'cancel' FROM pliego.fn_customer_order_detail({self.actor},{order})"))
        before = int(query(f'SELECT stock_actual FROM pliego.inventario WHERE edicion_id={self.edition}'))
        query(f'CALL pliego.sp_order_cancel({self.actor},{order},NULL,NULL,NULL,NULL,NULL)')
        query('CALL pliego.sp_home_delivery_advance_due(100)')
        self.assertEqual('CANCELLED',self.state(order))
        self.assertEqual(str(before+1),query(f'SELECT stock_actual FROM pliego.inventario WHERE edicion_id={self.edition}'))
        self.assertEqual('1',query(f"SELECT count(*) FROM pliego.correo_outbox WHERE evento_clave='ORDER_CANCELLED:{order}' AND tipo='ORDER_CANCELLED'"))
        self.assertEqual('t',query(f"""SELECT datos->>'paymentState'='REFUNDED'
            AND datos->>'refundAmount'=datos->>'total'
            AND ((datos->'items')->0)->>'originalSubtotal' IS NOT NULL
            AND ((datos->'items')->0)->>'lineSavings' IS NOT NULL
            AND NOT (datos ? 'inventory' OR datos ? 'grant' OR datos ? 'restoredUnits')
            FROM pliego.correo_outbox WHERE evento_clave='ORDER_CANCELLED:{order}'"""))

    def test_overdue_cancel_rejected_without_prior_detail_or_scheduler(self):
        for seconds, expected_events in ((121,'PREPARING,IN_TRANSIT'),
                (241,'PREPARING,IN_TRANSIT,OUT_FOR_DELIVERY'),
                (361,'PREPARING,IN_TRANSIT,OUT_FOR_DELIVERY,DELIVERED')):
            with self.subTest(seconds=seconds):
                order = self.order()
                self.age(order,seconds)
                before = query(f'SELECT stock_actual FROM pliego.inventario WHERE edicion_id={self.edition}')
                result = subprocess.run(PSQL+['-c',f'CALL pliego.sp_order_cancel({self.actor},{order},NULL,NULL,NULL,NULL,NULL)'],capture_output=True,text=True)
                self.assertNotEqual(0,result.returncode)
                self.assertIn('P5003',result.stderr)
                self.assertEqual(before,query(f'SELECT stock_actual FROM pliego.inventario WHERE edicion_id={self.edition}'))
                self.assertEqual('APPROVED',query(f'SELECT estado FROM pliego.pago WHERE pedido_id={order}'))
                self.assertEqual('false',query(f"SELECT available_actions->>'cancel' FROM pliego.fn_customer_order_detail({self.actor},{order})"))
                self.assertEqual('0',query(f"SELECT count(*) FROM pliego.correo_outbox WHERE evento_clave='ORDER_CANCELLED:{order}'"))
                self.assertEqual(expected_events,self.status_emails(order))

    def test_server_downtime_catches_up_with_once_only_history(self):
        order = self.order()
        self.age(order,86400)
        self.assertEqual('DELIVERED',self.detail_state(order,admin=True))
        for _ in range(3):
            query('CALL pliego.sp_home_delivery_advance_due(100)')
            self.assertEqual('DELIVERED',self.detail_state(order))
        self.assertEqual('PREPARING,IN_TRANSIT,OUT_FOR_DELIVERY,DELIVERED',query(f"SELECT string_agg(estado_nuevo,',' ORDER BY envio_historial_id) FROM pliego.envio_historial WHERE envio_id=(SELECT envio_id FROM pliego.envio WHERE pedido_id={order}) AND tipo='STATUS'"))
        self.assertEqual('3',query(f"SELECT count(*) FROM pliego.envio_historial h JOIN pliego.envio e USING(envio_id) WHERE e.pedido_id={order} AND ((h.estado_nuevo='IN_TRANSIT' AND h.fecha=e.transito_desde) OR (h.estado_nuevo='OUT_FOR_DELIVERY' AND h.fecha=e.reparto_desde) OR (h.estado_nuevo='DELIVERED' AND h.fecha=e.entrega_desde))"))
        self.assertEqual('PREPARING,IN_TRANSIT,OUT_FOR_DELIVERY,DELIVERED', self.status_emails(order))
        self.assertEqual('4',query(f"SELECT count(*) FROM pliego.correo_outbox WHERE evento_clave LIKE 'ORDER_STATUS:{order}:HOME_DELIVERY:%'"))
        self.assertEqual('t',query(f'SELECT fecha_envio=transito_desde AND fecha_en_reparto=reparto_desde AND fecha_entrega=entrega_desde FROM pliego.envio WHERE pedido_id={order}'))

    def test_repeated_scheduler_execution_is_idempotent(self):
        order = self.order()
        self.age(order,241)
        for _ in range(4):
            query('CALL pliego.sp_home_delivery_advance_due(100)')
        self.assertEqual('OUT_FOR_DELIVERY',self.state(order))
        self.assertEqual('3',query(f'SELECT count(*) FROM pliego.envio_historial WHERE envio_id=(SELECT envio_id FROM pliego.envio WHERE pedido_id={order})'))
        self.assertEqual('3',query(f"SELECT count(*) FROM pliego.correo_outbox WHERE evento_clave LIKE 'ORDER_STATUS:{order}:HOME_DELIVERY:%'"))

    def test_invalid_shipment_transition_does_not_enqueue_status_email(self):
        order = self.order()
        result = subprocess.run(PSQL+['-c',f"CALL pliego.sp_shipment_transition({self.admin},{order},'OUT_FOR_DELIVERY')"],
            capture_output=True,text=True)
        self.assertNotEqual(0,result.returncode)
        self.assertIn('P5002',result.stderr)
        self.assertEqual('PREPARING',self.status_emails(order))

    def test_concurrent_advancement_and_reconciliation_do_not_duplicate_events(self):
        order = self.order()
        self.age(order,361)
        commands = [f'CALL pliego.sp_home_delivery_reconcile({order})',
                    'CALL pliego.sp_home_delivery_advance_due(100)',
                    f'SELECT order_id FROM pliego.fn_customer_order_detail_priced({self.actor},{order})'] * 4
        with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
            list(pool.map(query,commands))
        self.assertEqual('DELIVERED',self.state(order))
        self.assertEqual('4|4',query(f'SELECT count(*),count(DISTINCT estado_nuevo) FROM pliego.envio_historial WHERE envio_id=(SELECT envio_id FROM pliego.envio WHERE pedido_id={order})'))

    def test_config_changes_only_affect_new_shipments(self):
        old = self.order()
        try:
            query('CALL pliego.sp_home_delivery_configure(3,4,5)')
            new = self.order()
            self.assertEqual('00:03:00|00:07:00|00:12:00',query(f'SELECT transito_desde-fecha_confirmacion,reparto_desde-fecha_confirmacion,entrega_desde-fecha_confirmacion FROM pliego.envio WHERE pedido_id={new}'))
            self.assertEqual('00:02:00|00:04:00|00:06:00',query(f'SELECT transito_desde-fecha_confirmacion,reparto_desde-fecha_confirmacion,entrega_desde-fecha_confirmacion FROM pliego.envio WHERE pedido_id={old}'))
            for invalid in ('0,2,2','2,-1,2','2,2,NULL'):
                result = subprocess.run(PSQL+['-c',f'CALL pliego.sp_home_delivery_configure({invalid})'],capture_output=True,text=True)
                self.assertNotEqual(0,result.returncode)
                self.assertIn('P1001',result.stderr)
        finally:
            query('CALL pliego.sp_home_delivery_configure(2,2,2)')

    def test_cancel_waiting_on_lock_uses_time_after_lock_acquisition(self):
        order = self.order()
        app = 'home-lock-' + uuid.uuid4().hex
        holder = subprocess.Popen(PSQL + ['-c','BEGIN', '-c',f'SELECT pedido_id FROM pliego.pedido WHERE pedido_id={order} FOR UPDATE',
            '-c',f"UPDATE pliego.envio SET fecha_confirmacion=clock_timestamp()-INTERVAL '119 seconds',transito_desde=clock_timestamp()+INTERVAL '1 second',reparto_desde=clock_timestamp()+INTERVAL '121 seconds',entrega_desde=clock_timestamp()+INTERVAL '241 seconds' WHERE pedido_id={order}",
            '-c','SELECT pg_sleep(3)', '-c','COMMIT'],env={**os.environ,'PGAPPNAME':app},stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        cancel = None
        try:
            wait_for_activity(app,"wait_event='PgSleep'")
            cancel = subprocess.Popen(PSQL + ['-c','BEGIN','-c',f'CALL pliego.sp_order_cancel({self.actor},{order},NULL,NULL,NULL,NULL,NULL)','-c','COMMIT'],
                env={**os.environ,'PGAPPNAME':app+'-cancel'},stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
            wait_for_activity(app+'-cancel',"wait_event_type='Lock'")
            # A worker must skip this order rather than hold shipment locks in reverse order.
            worker = subprocess.run(PSQL+['-c','CALL pliego.sp_home_delivery_advance_due(100)'],capture_output=True,text=True,timeout=2)
            self.assertEqual(0,worker.returncode,worker.stderr)
            _,err = holder.communicate(timeout=10)
            self.assertEqual(0,holder.returncode,err)
            _,err = cancel.communicate(timeout=10)
            self.assertNotEqual(0,cancel.returncode)
            self.assertIn('P5003',err)
            self.assertEqual('IN_TRANSIT',self.detail_state(order))
            self.assertEqual('APPROVED',query(f'SELECT estado FROM pliego.pago WHERE pedido_id={order}'))
        finally:
            for process in (holder,cancel):
                if process is not None and process.poll() is None:
                    process.terminate()
                    process.communicate(timeout=5)

    def test_cancel_and_overdue_advancement_serialize_without_refunds(self):
        order = self.order()
        self.age(order,121)
        commands = [f'CALL pliego.sp_order_cancel({self.actor},{order},NULL,NULL,NULL,NULL,NULL)',
                    f'CALL pliego.sp_home_delivery_reconcile({order})',
                    'CALL pliego.sp_home_delivery_advance_due(100)'] * 3
        with concurrent.futures.ThreadPoolExecutor(max_workers=9) as pool:
            results = list(pool.map(lambda sql: subprocess.run(PSQL+['-c',sql],capture_output=True,text=True),commands))
        for command,result in zip(commands,results):
            if 'sp_order_cancel' in command:
                self.assertNotEqual(0,result.returncode)
                self.assertIn('P5003',result.stderr)
            else:
                self.assertEqual(0,result.returncode,result.stderr)
        self.assertEqual('IN_TRANSIT',self.state(order))
        self.assertEqual('0',query(f"SELECT count(*) FROM pliego.movimiento_inventario WHERE pedido_id={order} AND tipo='CANCELLATION'"))

    def test_store_pickup_stays_separate(self):
        order = self.order(pickup=True)
        before = query(f'SELECT pliego.fn_order_fulfillment({order})')
        query('CALL pliego.sp_home_delivery_advance_due(100)')
        query(f'CALL pliego.sp_home_delivery_reconcile({order})')
        self.assertEqual(before,query(f'SELECT pliego.fn_order_fulfillment({order})'))
        self.assertEqual('0',query(f'SELECT count(*) FROM pliego.envio WHERE pedido_id={order}'))
        self.assertEqual('CONFIRMED',query(f'SELECT estado FROM pliego.pedido WHERE pedido_id={order}'))
        query(f'CALL pliego.sp_order_cancel({self.actor},{order},NULL,NULL,NULL,NULL,NULL)')

    def test_unauthorized_detail_cannot_advance_someone_elses_order(self):
        order = self.order()
        self.age(order,361)
        result = subprocess.run(PSQL+['-c',f'SELECT * FROM pliego.fn_customer_order_detail({self.admin},{order})'],capture_output=True,text=True)
        self.assertNotEqual(0,result.returncode)
        self.assertEqual('PREPARING',self.state(order))


if __name__ == '__main__':
    unittest.main(verbosity=2)
