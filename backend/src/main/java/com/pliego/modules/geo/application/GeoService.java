package com.pliego.modules.geo.application;

import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.pliego.modules.geo.gateway.GeoGateway;

@Service
public class GeoService {
    private final GeoGateway gateway;

    public GeoService(GeoGateway gateway) {
        this.gateway = gateway;
    }

    @Transactional(readOnly = true)
    public List<GeoProvince> provinces() {
        return gateway.listProvinces().stream()
                .map(row -> new GeoProvince(Long.toString(row.id()), row.code(), row.name())).toList();
    }

    @Transactional(readOnly = true)
    public List<GeoCity> cities(long provinceId) {
        return gateway.listCities(provinceId).stream()
                .map(row -> new GeoCity(Long.toString(row.id()), row.code(), row.name(), row.kind(),
                        row.cantonName(), row.aliases())).toList();
    }
}
