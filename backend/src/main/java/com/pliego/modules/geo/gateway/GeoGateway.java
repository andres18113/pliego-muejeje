package com.pliego.modules.geo.gateway;

import java.util.List;

public interface GeoGateway {
    List<ProvinceRow> listProvinces();
    List<CityRow> listCities(long provinceId);

    record ProvinceRow(long id, String code, String name) { }
    record CityRow(long id, String code, String name, String kind, String cantonName, List<String> aliases) {
        public CityRow { aliases = List.copyOf(aliases); }
        public CityRow(long id, String code, String name, String kind, String cantonName) {
            this(id, code, name, kind, cantonName, List.of());
        }
    }
}
