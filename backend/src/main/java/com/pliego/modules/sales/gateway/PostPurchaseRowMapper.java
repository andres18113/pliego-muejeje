package com.pliego.modules.sales.gateway;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.List;

import com.pliego.modules.sales.application.PostPurchaseModels.*;
import tools.jackson.core.JacksonException;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

/** Maps routine projections; direct BigDecimal binding preserves decimal precision. */
final class PostPurchaseRowMapper {
    private final ObjectMapper mapper;
    PostPurchaseRowMapper(ObjectMapper mapper) { this.mapper = mapper; }

    Extras detail(ResultSet rs) throws SQLException {
        return detail(rs, OfferPricing.unavailable());
    }
    Extras detail(ResultSet rs, OfferPricing offerPricing) throws SQLException {
        return new Extras(rs.getString("purchase_state"), read(rs,"fulfillment",Fulfillment.class),
                read(rs,"shipment",Shipment.class),read(rs,"invoice",Invoice.class),
                readList(rs,"credit_notes",new TypeReference<List<CreditNote>>() { }),
                read(rs,"available_actions",Actions.class),new com.pliego.foundation.money.MonetaryAmounts(rs.getBigDecimal("subtotal"),
                    rs.getBigDecimal("tax_rate"),rs.getBigDecimal("tax_amount"),rs.getBigDecimal("shipping_amount"),rs.getBigDecimal("total")), offerPricing);
    }
    SummaryExtras summary(ResultSet rs) throws SQLException {
        return summary(rs, OfferPricing.unavailable());
    }
    SummaryExtras summary(ResultSet rs, OfferPricing offerPricing) throws SQLException {
        return summary(rs, offerPricing, null);
    }
    SummaryExtras summary(ResultSet rs, OfferPricing offerPricing,
            com.pliego.foundation.money.MonetaryAmounts amounts) throws SQLException {
        return new SummaryExtras(rs.getString("purchase_state"),rs.getString("fulfillment_method"),
                rs.getString("shipment_state"),timestamp(rs,"estimated_delivery_from"),timestamp(rs,"estimated_delivery_to"),
                rs.getLong("item_count"),rs.getLong("unit_count"),
                readList(rs,"item_summary",new TypeReference<List<ItemSummary>>() { }),
                rs.getString("invoice_state"),rs.getBoolean("invoice_pdf_available"),rs.getBoolean("invoice_xml_available"), offerPricing, amounts);
    }
    static OfferPricing offerPricing(ResultSet rs) throws SQLException {
        return new OfferPricing(rs.getBigDecimal("original_subtotal"), rs.getBigDecimal("savings_total"),
                rs.getBigDecimal("current_subtotal"), rs.getBoolean("pricing_snapshot_available"));
    }
    private <T> T read(ResultSet rs,String column,Class<T> type) throws SQLException {
        String value=rs.getString(column);
        if (value==null) return null;
        try { return mapper.readValue(value,type); }
        catch (JacksonException error) { throw new SQLException("Invalid post-purchase projection: " + column,"XX000",error); }
    }
    private <T> List<T> readList(ResultSet rs,String column,TypeReference<List<T>> type) throws SQLException {
        try {
            List<T> values=mapper.readValue(rs.getString(column),type);
            if (values==null) throw new SQLException("Missing post-purchase array: " + column,"XX000");
            return List.copyOf(values);
        } catch (JacksonException error) { throw new SQLException("Invalid post-purchase array: " + column,"XX000",error); }
    }
    private static String timestamp(ResultSet rs,String column) throws SQLException {
        var value=rs.getObject(column,OffsetDateTime.class);
        return value==null?null:value.toInstant().toString();
    }
}
