"""Every REST purchase is billed (ADR 0040): the cédula, buyer name and billing address are required.

Gates whose subject is not billing send this one synthetic, algorithm-valid cédula. The first billed
purchase binds it to each fixture customer, so later purchases by the same customer must repeat it.
Never evidence of a real identity.
"""

CEDULA = "0912345675"
BILLING = {
    "billingIdentity": {"type": "EC_CEDULA", "number": CEDULA},
    "buyerName": "Cliente Prueba",
    "billingAddress": {"line1": "Calle Fiscal", "city": "Quito", "province": "Pichincha", "countryCode": "EC"},
}


def billed(body):
    """Add the synthetic fiscal data unless the gate supplies its own."""
    return body if "billingIdentity" in body else {**BILLING, **body}
