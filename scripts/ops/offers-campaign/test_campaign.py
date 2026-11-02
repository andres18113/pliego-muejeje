"""Offline behavioral gates for the API-only campaign operator."""
import copy
from datetime import datetime
from decimal import Decimal
import importlib.util
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location("campaign", Path(__file__).with_name("campaign.py"))


def edition(index, kind="EBOOK", price="12.99", **changes):
    row = dict(editionId=str(index), sku=f"PLG-BK-{index:06d}", format=kind,
               bookTitle=f"Libro {index}", price=price, state="ACTIVE", stockActual=None,
               coverUrl="https://covers.pliegolibros.com/covers/fixture.webp", offerRowExists=False)
    if kind in {"PAPERBACK", "HARDCOVER"}:
        row["stockActual"] = 4
    row.update(changes)
    return row


class ApiFixture:
    def __init__(self, rows):
        self.rows = copy.deepcopy(rows)
        self.writes = []
        self.before_lookup = None

    def editions(self, sku=None):
        if self.before_lookup:
            self.before_lookup(self)
        return [copy.deepcopy(r) for r in self.rows if sku is None or r["sku"] == sku]

    def detail(self, edition_id):
        r = next(r for r in self.rows if r["editionId"] == edition_id)
        return dict(r, title=r["bookTitle"], available=True, offer=None)

    def put_offer(self, edition_id, payload, expected_base, expected_stock):
        self.writes.append((edition_id, payload))

    def offers(self):
        return []


class CampaignTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert Path(__file__).with_name("campaign.py").exists(), "Campaign safety implementation is missing"
        cls.c = importlib.util.module_from_spec(SPEC)
        SPEC.loader.exec_module(cls.c)

    def catalog(self):
        return [edition(i + offset, kind, price) for offset, kind in
                [(0, "PAPERBACK"), (100, "EBOOK"), (200, "AUDIOBOOK")]
                for i, price in [(1, "7.99"), (2, "17.99"), (3, "29.99"), (4, "8.99"),
                                 (5, "19.99"), (6, "31.99"), (7, "9.99"), (8, "21.99")]]

    def plan(self, api=None):
        return self.c.generate_plan(api or ApiFixture(self.catalog()), set(), set(), 7,
                                    "http://127.0.0.1:18081")

    def test_price_tiers_and_half_up_rounding_match_authorized_policy(self):
        for kind, base, percent, price in [("PAPERBACK", "14.95", 10, "13.46"),
                ("HARDCOVER", "15.00", 15, "12.75"), ("PAPERBACK", "25.00", 20, "20.00"),
                ("EBOOK", "9.99", 15, "8.49"), ("EBOOK", "10.00", 20, "8.00"),
                ("EBOOK", "18.00", 25, "13.50"), ("AUDIOBOOK", "24.99", 15, "21.24")]:
            self.assertEqual((percent, Decimal(price)), self.c.discount(kind, base))

    def test_balanced_plan_has_only_durations_and_three_and_seven_day_windows(self):
        plan = self.plan()
        self.assertEqual(21, len(plan["editions"]))
        self.assertEqual({"PHYSICAL": 7, "EBOOK": 7, "AUDIOBOOK": 7}, plan["counts"])
        self.assertEqual({3, 5, 7}, {r["durationDays"] for r in plan["editions"]})
        self.assertTrue(all("startsAt" not in r and "endsAt" not in r for r in plan["editions"]))

    def test_existing_expired_row_and_both_prior_id_and_sku_are_excluded(self):
        rows = self.catalog()
        rows.extend([edition(9, "PAPERBACK"), edition(10, "PAPERBACK")])
        rows[0]["offerRowExists"] = True
        plan = self.c.generate_plan(ApiFixture(rows), {"2"}, {"PLG-BK-000003"}, 6,
                                    "http://127.0.0.1:18081")
        self.assertTrue({"1", "2", "3"}.isdisjoint({r["editionId"] for r in plan["editions"]}))

    def test_unsafe_inventory_cover_or_missing_presence_is_ineligible(self):
        for changes in [{"stockActual": 0}, {"stockActual": None}, {"state": "INACTIVE"},
                        {"coverUrl": "https://example.com/cover.webp"}, {"offerRowExists": True},
                        {"sku": "INVALID"}, {"price": "0.00"}]:
            self.assertFalse(self.c.eligible(edition(1, "PAPERBACK", **changes), set(), set()))
        row = edition(1)
        del row["offerRowExists"]
        self.assertFalse(self.c.eligible(row, set(), set()))

    def test_insufficient_candidates_fail_instead_of_weakening_eligibility(self):
        with self.assertRaises(self.c.CampaignError):
            self.c.generate_plan(ApiFixture([edition(1)]), set(), set(), 7, "http://127.0.0.1:18081")

    def test_apply_time_is_guayaquil_and_calendar_days_match_duration(self):
        rows = self.c.requests_for(self.plan(), datetime.fromisoformat("2026-11-02T02:30:00+00:00"))
        self.assertEqual("2026-11-01T21:30:00-05:00", rows[0]["request"]["startsAt"])
        self.assertEqual("2026-11-04T21:30:00-05:00", rows[0]["request"]["endsAt"])

    def test_dry_run_never_sends_put(self):
        api = ApiFixture(self.catalog())
        self.c.run(api, self.plan(api), apply=False)
        self.assertEqual([], api.writes)

    def test_full_preflight_refuses_last_changed_base_before_any_put(self):
        api = ApiFixture(self.catalog())
        plan = self.plan(api)
        last = plan["editions"][-1]["editionId"]
        next(r for r in api.rows if r["editionId"] == last)["price"] = "88.00"
        with self.assertRaises(self.c.CampaignError):
            self.c.run(api, plan, apply=True)
        self.assertEqual([], api.writes)

    def test_stock_change_or_new_offer_row_refuses_entire_batch(self):
        for field, value in [("stockActual", 3), ("offerRowExists", True)]:
            api = ApiFixture(self.catalog())
            plan = self.plan(api)
            api.rows[0][field] = value
            with self.assertRaises(self.c.CampaignError):
                self.c.run(api, plan, apply=True)
            self.assertEqual([], api.writes)

    def test_offer_created_after_batch_preflight_is_rechecked_before_first_put(self):
        api = ApiFixture(self.catalog())
        plan = self.plan(api)
        target = plan['editions'][0]['editionId']
        lookups = [0]

        def mutate_after_batch(client):
            lookups[0] += 1
            if lookups[0] == 22:
                next(r for r in client.rows if r['editionId'] == target)['offerRowExists'] = True

        api.before_lookup = mutate_after_batch
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(self.c.CampaignError):
                self.c.run(api, plan, apply=True, journal=Path(folder) / 'writes.jsonl')
        self.assertEqual([], api.writes)

    def test_tampered_price_duration_or_duplicate_plan_refuses_before_write(self):
        for field, value in [("offerPrice", "0.01"), ("durationDays", 15), ("format", "VIDEO")]:
            api = ApiFixture(self.catalog())
            plan = self.plan(api)
            plan["editions"][0][field] = value
            with self.assertRaises(self.c.CampaignError):
                self.c.run(api, plan, apply=True)
            self.assertEqual([], api.writes)
        plan = self.plan()
        plan["editions"][1] = plan["editions"][0]
        with self.assertRaises(self.c.CampaignError):
            self.c.run(ApiFixture(self.catalog()), plan, apply=True)

    def test_nonlocal_target_or_credentials_in_url_refused_without_authorization(self):
        for url in ["https://api.pliegolibros.com", "http://127.0.0.1.evil.test", "http://secret@127.0.0.1"]:
            with self.assertRaises(self.c.CampaignError):
                self.c.validate_target(url, "local", None)

    def test_public_detail_unavailable_refuses_even_if_admin_state_is_active(self):
        api = ApiFixture(self.catalog())
        plan = self.plan(api)
        original = api.detail
        api.detail = lambda edition_id: dict(original(edition_id), available=False)
        with self.assertRaises(self.c.CampaignError):
            self.c.run(api, plan, apply=True)
        self.assertEqual([], api.writes)

    def test_preflight_prints_all_fields_before_a_write(self):
        import contextlib
        import io
        output = io.StringIO()
        api = ApiFixture(self.catalog())
        with contextlib.redirect_stdout(output):
            self.c.run(api, self.plan(api), apply=False, on_preflight=self.c.print_preflight,
                       now=datetime.fromisoformat("2026-11-01T10:00:00-05:00"))
        lines = output.getvalue().splitlines()
        self.assertEqual(22, len(lines))
        self.assertIn("SKU\tformato\tstock\tbase\toferta\t% solicitado\tinicio\tfin", lines[0])
        self.assertIn("2026-11-01T10:00:00-05:00", lines[1])
        self.assertEqual([], api.writes)

    def test_archive_draft_has_real_candidates_and_declares_current_state_unknown(self):
        plan = self.c.archive_plan("https://api.pliegolibros.com", 7)
        self.assertEqual(21, len(plan["editions"]))
        self.assertEqual("UNKNOWN", plan["evidence"]["currentOfferRowPresence"])
        self.assertEqual(3, len(plan["evidence"]["sources"]))
        self.c.validate_plan(plan)

    def test_each_put_sends_server_enforced_creation_price_and_stock_conditions(self):
        from http.server import BaseHTTPRequestHandler, HTTPServer
        import threading
        received = []

        class Handler(BaseHTTPRequestHandler):
            def do_PUT(self):
                received.append((self.path, dict(self.headers)))
                self.rfile.read(int(self.headers['Content-Length']))
                self.send_response(204)
                self.end_headers()

            def log_message(self, *args):
                pass

        server = HTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            api = self.c.Api(f'http://127.0.0.1:{server.server_port}', 'fixture')
            api.put_offer('7', {'offerPrice': '8.00'}, '10.00', 4)
            api.put_offer('8', {'offerPrice': '8.00'}, '10.00', None)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
        self.assertEqual('/api/v1/admin/editions/7/offer', received[0][0])
        self.assertEqual('*', received[0][1]['If-None-Match'])
        self.assertEqual('10.00', received[0][1]['X-Expected-Base-Price'])
        self.assertEqual('4', received[0][1]['X-Expected-Stock'])
        self.assertEqual('NONE', received[1][1]['X-Expected-Stock'])

    def test_public_sort_verification_rejects_wrong_price_expiry_or_relevance_order(self):
        rows = [dict(price='8.00', offer=dict(discountAmount='2.00', endsAt='2026-11-04T10:00:00-05:00')),
                dict(price='12.00', offer=dict(discountAmount='3.00', endsAt='2026-11-08T10:00:00-05:00'))]
        self.c.verify_order(rows, 'PRICE_ASC')
        self.c.verify_order(rows, 'ENDING_SOON')
        for sort, wrong in [('PRICE_DESC', rows), ('PRICE_ASC', list(reversed(rows))),
                            ('ENDING_SOON', list(reversed(rows))), ('RELEVANCE', rows)]:
            with self.assertRaises(self.c.CampaignError):
                self.c.verify_order(wrong, sort)


if __name__ == "__main__":
    unittest.main(verbosity=2)
