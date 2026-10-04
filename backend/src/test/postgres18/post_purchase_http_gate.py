"""Live post-purchase contract tests; real JDBC/PostgreSQL, no frontend fixtures."""
import unittest
import uuid

from admin_orders_http_gate import request
from checkout_last_unit import query
from order_cancel_concurrency import two_item_order


class PostPurchaseHttpGate(unittest.TestCase):
    def setUp(self):
        self.customer, self.order, self.editions = two_item_order()
        self.admin = int(query("SELECT min(usuario_id) FROM pliego.usuario WHERE rol='ADMIN'"))
        self.customer_path = f"/api/v1/orders/{self.order}"
        self.admin_path = f"/api/v1/admin/orders/{self.order}"

    def detail(self):
        status, detail = request(self.customer_path, self.customer, "CUSTOMER")
        self.assertEqual(200, status, detail)
        return detail

    def test_compact_list_detail_consistency_and_actions(self):
        detail = self.detail()
        self.assertEqual("CONFIRMED", detail.get("purchaseState"))
        self.assertEqual("PENDING", detail["shipment"]["state"])
        self.assertEqual("HOME_DELIVERY", detail["fulfillment"]["method"])
        self.assertEqual({"cancel": True, "changeShippingAddress": False}, detail["availableActions"])
        self.assertIsNone(detail["invoice"])
        self.assertEqual([], detail["creditNotes"])
        status, page = request("/api/v1/orders", self.customer, "CUSTOMER")
        self.assertEqual(200, status)
        summary = page["items"][0]
        self.assertEqual(detail["orderId"], summary["orderId"])
        self.assertEqual(detail["total"], summary["total"])
        self.assertEqual(detail["purchaseState"], summary["purchaseState"])
        self.assertEqual(2, summary["itemCount"])
        self.assertEqual(2, summary["unitCount"])
        self.assertEqual(detail["items"][0]["title"], summary["itemSummary"][0]["title"])
        self.assertNotIn("address", summary)
        self.assertNotIn("history", summary)
        self.assertIsNone(summary["invoiceState"])
        status, admin = request(self.admin_path, self.admin)
        self.assertEqual(200, status)
        self.assertEqual(detail["shipment"], admin["shipment"])

    def test_delivery_and_terminal_transitions(self):
        status, result = request(self.admin_path + "/shipment/tracking", self.admin,
            method="PUT", body={"carrier": "Carrier fixture", "trackingCode": "FIXTURE-1",
                "trackingUrl": "https://example.invalid/track/1",
                "estimatedDeliveryFrom": "2026-11-01T08:00:00Z",
                "estimatedDeliveryTo": "2026-11-03T18:00:00Z"})
        self.assertEqual(200, status, result)
        for state in ("PREPARING", "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED"):
            status, result = request(self.admin_path + "/shipment/transitions", self.admin,
                                    method="POST", body={"targetState": state})
            self.assertEqual(200, status, result)
            self.assertEqual(state, result["shipment"]["state"])
        detail = self.detail()
        self.assertEqual("CONFIRMED", detail["purchaseState"])
        self.assertEqual("DELIVERED", detail["orderState"])
        self.assertEqual("APPROVED", detail["payment"]["state"])
        self.assertEqual("DELIVERED", detail["shipment"]["state"])
        self.assertEqual("FIXTURE-1", detail["shipment"]["trackingCode"])
        self.assertIsNotNone(detail["shipment"]["deliveredAt"])
        self.assertEqual(6, len(detail["shipment"]["history"]))
        self.assertFalse(detail["availableActions"]["cancel"])
        status, problem = request(self.admin_path + "/shipment/transitions", self.admin,
                                 method="POST", body={"targetState": "PREPARING"})
        self.assertEqual(409, status, problem)
        self.assertEqual("P5002", problem["code"])

    def test_invoice_refund_credit_note_preserve_history(self):
        invoice_request = {"documentNumber": "COMM-" + uuid.uuid4().hex,
            "buyerName": "Comprador facturado", "identityType": "OTHER", "identityNumber": "fixture-identity",
            "buyerEmail": "billing@example.invalid", "billingAddress": {"line1": "Dirección de cobro",
            "line2": None, "city": "Quito", "province": "Pichincha", "countryCode": "EC", "postalCode": None}}
        status, result = request(self.admin_path + "/invoice", self.admin, method="POST", body=invoice_request)
        self.assertEqual(201, status, result)
        invoice = self.detail()["invoice"]
        self.assertEqual("ISSUED", invoice["state"])
        self.assertIsInstance(invoice["invoiceId"], str)
        self.assertEqual("18.65", invoice["total"])
        self.assertEqual("0.00", invoice["taxTotal"])
        self.assertEqual("Dirección de cobro", invoice["billingAddress"]["line1"])
        self.assertEqual("NOT_ASSESSED", invoice["items"][0]["taxTreatment"])
        self.assertFalse(invoice["pdfAvailable"])
        self.assertFalse(invoice["xmlAvailable"])
        status, duplicate = request(self.admin_path + "/invoice", self.admin, method="POST", body=invoice_request)
        self.assertEqual(409, status, duplicate)
        status, result = request(self.customer_path + "/cancel", self.customer, "CUSTOMER", method="POST")
        self.assertEqual(200, status, result)
        canceled = self.detail()
        self.assertEqual(("CANCELLED", "REFUNDED", "CANCELLED"),
            (canceled["purchaseState"], canceled["payment"]["state"], canceled["shipment"]["state"]))
        self.assertEqual(invoice, canceled["invoice"])
        status, result = request(self.admin_path + "/credit-notes", self.admin, method="POST",
            body={"documentNumber": "CN-" + uuid.uuid4().hex, "reason": "Cancelación reembolsada"})
        self.assertEqual(201, status, result)
        detail = self.detail()
        self.assertEqual(invoice, detail["invoice"])
        self.assertEqual("ISSUED", detail["creditNotes"][0]["state"])
        self.assertEqual("18.65", detail["creditNotes"][0]["total"])

    def test_admin_commands_reject_customer_and_invalid_input(self):
        for suffix, method, body in (("/invoice", "POST", {}), ("/credit-notes", "POST", {}),
                ("/shipment/transitions", "POST", {"targetState": "DELIVERED"}),
                ("/shipment/tracking", "PUT", {})):
            status, problem = request(self.admin_path + suffix, self.customer, "CUSTOMER", method, body)
            self.assertEqual(403, status, problem)
        status, problem = request(self.admin_path + "/invoice", self.admin, method="POST", body={})
        self.assertEqual(400, status, problem)
        self.assertEqual("VALIDATION_ERROR", problem["code"])
        status, problem = request(self.admin_path + "/shipment/tracking", self.admin, method="PUT",
            body={"carrier": "Carrier", "trackingCode": "X", "trackingUrl": "javascript:alert(1)"})
        self.assertEqual(400, status, problem)
        status, problem = request(self.admin_path + "/shipment/transitions", self.admin,
                                 method="POST", body={"targetState": "DELIVERED"})
        self.assertEqual(409, status, problem)


if __name__ == "__main__":
    unittest.main(verbosity=2)
