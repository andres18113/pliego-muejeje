"""Controlled aging for disposable PostgreSQL lifecycle/HTTP fixtures."""
from checkout_last_unit import query


def age_shipment(order, minutes):
    query(f"""UPDATE pliego.envio SET
        fecha_confirmacion=fecha_confirmacion-make_interval(mins=>{minutes}),
        transito_desde=transito_desde-make_interval(mins=>{minutes}),
        reparto_desde=reparto_desde-make_interval(mins=>{minutes}),
        entrega_desde=entrega_desde-make_interval(mins=>{minutes}) WHERE pedido_id={order}""")
