package com.pliego.modules.customer.api;

import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** ISO 3166 countries with Spanish display names for delivery forms. */
@RestController
@RequestMapping(path = "/api/v1/reference", produces = MediaType.APPLICATION_JSON_VALUE)
public class CountryReferenceController {
    private static final Locale SPANISH = Locale.forLanguageTag("es-EC");

    @GetMapping("/countries")
    public List<Country> countries() {
        return Arrays.stream(Locale.getISOCountries())
                .map(code -> new Country(code, new Locale.Builder().setRegion(code).build().getDisplayCountry(SPANISH)))
                .sorted(Comparator.comparing(Country::name, String.CASE_INSENSITIVE_ORDER))
                .toList();
    }

    public record Country(String code, String name) { }
}
