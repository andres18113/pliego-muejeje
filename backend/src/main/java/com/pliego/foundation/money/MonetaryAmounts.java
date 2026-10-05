package com.pliego.foundation.money;

import java.math.BigDecimal;
import io.swagger.v3.oas.annotations.media.Schema;

/** Values calculated/persisted by the Database API. Contains no pricing calculations. */
public record MonetaryAmounts(BigDecimal subtotal,
        @Schema(description="Tasa porcentual de IVA: 15.00 representa 15%.") BigDecimal taxRate,
        BigDecimal taxAmount, BigDecimal shippingAmount, BigDecimal total) { }
